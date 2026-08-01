#!/usr/bin/env node
// OneNote → Power Explorer sort-order migration.
//
//   node onenote-order-migrate.cjs <onenote-hierarchy.xml> <vaultPath> [--apply]
//
// Mirrors a OneNote notebook's real order into an Obsidian vault that was
// imported with obsidian-importer, in two phases (order matters):
//
//   1. NESTING  — the importer flattens subpage groups to section depth; a
//      level-2 page with its own subpages gets its folder moved inside its
//      level-1 parent's folder, restoring OneNote's drill-down.
//   2. ORDERING — writes Power Explorer's manual sort (data.json orders):
//      notebooks at the vault root, section-group children, and pages with
//      their subpage folders interleaved in true page order.
//
// Dry run by default: prints both plans and touches nothing. --apply moves
// the folders, recomputes ranks on the moved tree, backs up data.json, and
// writes. Matching is tolerant (importer-style filename sanitizing, best-
// overlap section/container matching); unmatched items are left alone and
// sort below ranked ones. The OneNote recycle bin is skipped.
//
// See README.md next to this script for the full walkthrough.
const fs = require("fs");
const path = require("path");

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const XML = args[0];
const VAULT = args[1];
const APPLY = flags.has("--apply");
if (!XML || !VAULT || !fs.existsSync(XML) || !fs.existsSync(VAULT)) {
	console.log("Usage: node onenote-order-migrate.cjs <onenote-hierarchy.xml> <vaultPath> [--apply]");
	console.log("Dry run by default — prints the nesting moves and sort plan without changing anything.");
	process.exit(1);
}
const DATA = path.join(VAULT, ".obsidian", "plugins", "powerexplorer", "data.json");

/* ---------------- parse the OneNote hierarchy ---------------- */

const raw = fs.readFileSync(XML, "utf8").replace(/^﻿/, "");
const decode = (s) =>
	s
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");

const sections = []; // { notebook, name, pages: [{ t, l }] in document order }
const notebooks = []; // { name, children: [section/group names in order] }
const containers = []; // notebooks + section groups
const stack = [];
const tagRe = /<(\/?)(?:one:)?(Notebook|SectionGroup|Section|Page)\b([^>]*?)(\/?)>/g;
let m;
while ((m = tagRe.exec(raw))) {
	const [, close, kind, attrs, selfClose] = m;
	if (close) {
		while (stack.length && stack[stack.length - 1].kind !== kind) stack.pop();
		stack.pop();
		continue;
	}
	const name = decode(attrs.match(/\bname="([^"]*)"/)?.[1] ?? "");
	if (kind === "Notebook") {
		const nb = { name, children: [] };
		notebooks.push(nb);
		containers.push(nb);
		if (!selfClose) stack.push({ kind, name, node: nb });
		continue;
	}
	const parent = stack[stack.length - 1];
	if (kind === "SectionGroup") {
		if (attrs.includes("isRecycleBin")) {
			if (!selfClose) {
				let depth = 1;
				let mm;
				while (depth > 0 && (mm = tagRe.exec(raw))) {
					if (mm[2] === "SectionGroup") depth += mm[1] ? -1 : mm[4] ? 0 : 1;
				}
			}
			continue;
		}
		const g = { name, children: [] };
		containers.push(g);
		if (parent?.node?.children) parent.node.children.push(name);
		if (!selfClose) stack.push({ kind, name, node: g });
		continue;
	}
	if (kind === "Section") {
		const sec = { notebook: stack[0]?.name ?? "?", name, pages: [] };
		sections.push(sec);
		if (parent?.node?.children) parent.node.children.push(name);
		if (!selfClose) stack.push({ kind, name, node: sec });
		continue;
	}
	if (kind === "Page") {
		const sec = [...stack].reverse().find((s) => s.kind === "Section");
		const level = +(attrs.match(/pageLevel="(\d)"/)?.[1] ?? 1);
		if (sec?.node?.pages) sec.node.pages.push({ t: name, l: level });
		if (!selfClose) stack.push({ kind, name, node: null });
	}
}

const sanitize = (s) =>
	s
		.toLowerCase()
		.replace(/[*"\\/<>:|?#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();

for (const sec of sections) {
	sec.keys = new Map(sec.pages.map((p, i) => [sanitize(p.t), i]));
	// level-2 pages that own subpages, with their level-1 parent: these become
	// nested folders under the parent's folder
	sec.nests = [];
	let last1 = null;
	sec.pages.forEach((p, i) => {
		if (p.l === 1) last1 = p.t;
		const next = sec.pages[i + 1];
		if (p.l === 2 && next && next.l > 2 && last1) sec.nests.push({ child: p.t, parent: last1 });
	});
}
for (const g of containers) g.keys = new Map(g.children.map((c, i) => [sanitize(c), i]));

console.log(
	`Parsed: ${notebooks.length} notebooks, ${containers.length - notebooks.length} section groups, ` +
		`${sections.length} sections, ${sections.reduce((n, s) => n + s.pages.length, 0)} pages`
);
console.log("Notebook order: " + notebooks.map((n) => n.name).join(" · "));
console.log("");

/* ---------------- shared vault helpers ---------------- */

function children(dir) {
	const entries = fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => !e.name.startsWith(".") && e.name !== "_attachments");
	return {
		files: entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name),
		dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name),
	};
}

function bestSection(kidKeys) {
	let best = null;
	let hits = 0;
	for (const sec of sections) {
		let h = 0;
		for (const k of kidKeys) if (sec.keys.has(k)) h++;
		if (h > hits) {
			hits = h;
			best = sec;
		}
	}
	return { best, hits };
}

/* ---------------- phase 1: nesting moves ---------------- */

const moves = [];
(function planMoves(dir, rel) {
	const { files, dirs } = children(dir);
	const kidKeys = [...files.map((f) => sanitize(f.replace(/\.md$/, ""))), ...dirs.map(sanitize)];
	const { best, hits } = bestSection(kidKeys);
	if (best && best.nests.length && (hits >= 3 || hits >= Math.ceil(kidKeys.length / 2))) {
		const dirKeys = new Map(dirs.map((d) => [sanitize(d), d]));
		for (const n of best.nests) {
			// only when child and parent sit here as SIBLINGS — inside the parent
			// folder itself the child is already where it belongs (idempotence)
			if (sanitize(path.basename(dir)) === sanitize(n.parent)) continue;
			const childDir = dirKeys.get(sanitize(n.child));
			const parentDir = dirKeys.get(sanitize(n.parent));
			if (!childDir || !parentDir) continue;
			const from = path.join(dir, childDir);
			const to = path.join(dir, parentDir, childDir);
			if (fs.existsSync(to)) continue;
			moves.push({ from, to, rel: `${rel || "/"}: ${childDir} → ${parentDir}/` });
		}
	}
	for (const d of dirs) planMoves(path.join(dir, d), rel ? `${rel}/${d}` : d);
})(VAULT, "");

console.log(`Nesting moves: ${moves.length}`);
for (const mv of moves) console.log("  " + mv.rel);
console.log("");

if (APPLY) {
	for (const mv of moves) {
		const parent = path.dirname(mv.to);
		if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
		fs.renameSync(mv.from, mv.to);
	}
	if (moves.length) console.log(`Moved ${moves.length} folders.\n`);
}

/* ---------------- phase 2: sort orders (walks the post-move tree) ---------------- */

const orders = {};
const report = [];
(function walkOrders(dir, rel) {
	const { files, dirs } = children(dir);
	const key = rel === "" ? "/" : rel;
	const ranked = [];
	const claimed = new Set();

	if (rel === "") {
		const nbOrder = new Map(notebooks.map((n, i) => [sanitize(n.name), i]));
		for (const d of dirs) {
			const i = nbOrder.get(sanitize(d));
			if (i != null) {
				ranked.push({ name: d, rank: i });
				claimed.add(d);
			}
		}
		if (ranked.length > 1) report.push(`/  ←  notebook order (${ranked.length} notebooks)`);
		const unmatched = dirs.filter((d) => !claimed.has(d));
		if (unmatched.length) report.push(`/  ·  unranked root folders (rename or drag to place): ${unmatched.join(", ")}`);
	} else {
		// pages: files and subpage-folders interleaved, from the best section
		const kids = [
			...files.map((f) => ({ name: f, k: sanitize(f.replace(/\.md$/, "")), d: 0 })),
			...dirs.map((d) => ({ name: d, k: sanitize(d), d: 1 })),
		];
		const { best, hits } = bestSection(kids.map((c) => c.k));
		if (best && (hits >= 3 || hits >= Math.ceil(kids.length / 2))) {
			for (const c of kids) {
				const i = best.keys.get(c.k);
				if (i != null) {
					ranked.push({ name: c.name, rank: i * 2 + c.d }); // page file just before its subpage folder
					claimed.add(c.name);
				}
			}
			report.push(`${key}  ←  ${best.notebook} › ${best.name}   (${hits}/${kids.length} items ranked)`);
		}
		// leftover subfolders: section-group / notebook container order
		const rest = dirs.filter((d) => !claimed.has(d));
		if (rest.length > 1) {
			let bc = null;
			let bh = 0;
			for (const g of containers) {
				let h = 0;
				for (const d of rest) if (g.keys.has(sanitize(d))) h++;
				if (h > bh) {
					bh = h;
					bc = g;
				}
			}
			if (bc && (bh >= 2 || bh >= Math.ceil(rest.length / 2))) {
				for (const d of rest) {
					const i = bc.keys.get(sanitize(d));
					if (i != null) {
						ranked.push({ name: d, rank: 1e6 + i });
						claimed.add(d);
					}
				}
				report.push(`${key}  ←  group "${bc.name}" orders ${bh} subfolders`);
			}
		}
	}

	if (ranked.length > 1) {
		ranked.sort((a, b) => a.rank - b.rank);
		orders[key] = ranked.map((r) => r.name);
	}
	for (const d of dirs) walkOrders(path.join(dir, d), rel ? `${rel}/${d}` : d);
})(VAULT, "");

for (const r of report) console.log(r);
console.log("");
console.log(`Folders that will get a manual order: ${Object.keys(orders).length}`);

if (!APPLY) {
	console.log("");
	console.log("(dry run — nothing changed; re-run with --apply to move folders and write the order)");
	console.log("(on --apply, ranks are recomputed on the tree AFTER the nesting moves)");
	process.exit(0);
}

/* ---------------- write data.json (backed up, stale keys pruned) ---------------- */

const defaults = {
	orders: {},
	unranked: "bottom",
	dragEnabled: true,
	sectionsLayout: false,
	sectionWidth: 240,
	lastSection: null,
	hidden: [],
	colors: {},
	pins: {},
	icons: {},
};
let data = defaults;
if (fs.existsSync(DATA)) {
	fs.copyFileSync(DATA, DATA + ".backup-" + new Date().toISOString().slice(0, 10));
	try {
		data = Object.assign({}, defaults, JSON.parse(fs.readFileSync(DATA, "utf8")));
	} catch {
		/* unreadable — start from defaults */
	}
}
data.orders = Object.assign({}, data.orders, orders);
for (const k of Object.keys(data.orders)) {
	if (k !== "/" && !fs.existsSync(path.join(VAULT, k))) delete data.orders[k];
}
fs.mkdirSync(path.dirname(DATA), { recursive: true });
fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
console.log(`Wrote ${DATA} (previous file backed up beside it)`);
console.log("Reload Obsidian; Power Explorer 0.7.0+ also picks the change up live.");
