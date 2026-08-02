// Power Explorer: pure ordering logic. No Obsidian imports, everything here
// is unit-tested with Node (npm test).
//
// The data model is deliberately sparse: `Orders` maps a folder path to the
// manual order of its children BY NAME, and only folders the user has
// actually arranged have an entry. A 20,000-note vault with ten arranged
// folders stores ten small arrays, and every lookup the sort hook does is
// O(1) against a per-folder rank map.

/** folderPath -> child names (files keep their extension) in manual order. */
export type Orders = Record<string, string[]>;

/** Is a vault path at or under a folder? The root ("" or "/") holds everything.
 *  The one containment rule shared by search scoping, boosts, and exclusions. */
export function isUnder(path: string, folder: string): boolean {
	if (!folder || folder === "/") return true;
	return path === folder || path.startsWith(folder + "/");
}

/** Parent folder path of a vault path; the vault root is "/". */
export function parentPathOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "/" : path.slice(0, i) || "/";
}

/** Last segment of a vault path. */
export function nameOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}

/** A child path inside a folder. The vault root is "/" (or ""), and a child of
 *  the root is just its name, "/Foo" is not a path this vault would recognize. */
export function joinPath(dir: string, name: string): string {
	return !dir || dir === "/" ? name : dir + "/" + name;
}

/**
 * Order a folder's live children by the stored manual order. Names missing
 * from the order (new/unarranged items) keep their incoming relative order
 * Obsidian's own sort, and land at the bottom (or top). Stale names in the
 * order (deleted/renamed away) are simply ignored, never fatal.
 */
export function applyOrder(names: string[], order: string[] | undefined, unranked: "top" | "bottom" = "bottom"): string[] {
	if (!order || !order.length) return names;
	const rank = new Map<string, number>();
	order.forEach((n, i) => rank.set(n, i));
	const ranked: string[] = [];
	const rest: string[] = [];
	for (const n of names) (rank.has(n) ? ranked : rest).push(n);
	if (!ranked.length) return names;
	ranked.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
	return unranked === "top" ? [...rest, ...ranked] : [...ranked, ...rest];
}

/**
 * Sort a folder's children the way the file explorer's own sort menu would, for
 * when the explorer cannot be asked directly, mobile has no getSortedFolderItems,
 * so without this its children fall back to raw vault order.
 *
 * `mode` is the explorer's own sortOrder, read from its view state, so this
 * matches whatever that device is set to rather than guessing. The alphabetical
 * orders treat files and folders alike. The time orders are the wrinkle: a TFile
 * carries a stat with its times but a TFolder carries none in Obsidian's API, so
 * under a time sort files order by their stat while folders, having nothing to
 * sort by, lead in name order. Deterministic, and stable within each group.
 */
export function sortChildren<T>(
	items: T[],
	mode: string,
	nameOf: (t: T) => string,
	isFolder: (t: T) => boolean,
	timeOf: (t: T) => { ctime: number; mtime: number } | null
): T[] {
	const arr = [...items];
	const byName = (a: T, b: T) => compareNames(nameOf(a), nameOf(b));
	if (mode === "alphabeticalReverse") return arr.sort((a, b) => byName(b, a));
	if (mode === "byModifiedTime" || mode === "byModifiedTimeReverse" || mode === "byCreatedTime" || mode === "byCreatedTimeReverse") {
		const key = mode.startsWith("byCreated") ? "ctime" : "mtime";
		const oldestFirst = mode.endsWith("Reverse");
		return arr.sort((a, b) => {
			const fa = isFolder(a);
			const fb = isFolder(b);
			if (fa || fb) return fa && fb ? byName(a, b) : fa ? -1 : 1; // folders have no time; lead, name-ordered
			const ta = timeOf(a);
			const tb = timeOf(b);
			const va = ta ? ta[key] : 0;
			const vb = tb ? tb[key] : 0;
			return oldestFirst ? va - vb : vb - va;
		});
	}
	return arr.sort(byName); // "alphabetical" and anything unrecognised
}

/**
 * How deep a folder sits: 1 = a root folder (a notebook), 2 = its child (a
 * section), 3+ = a folder inside a section. The root itself is 0.
 *
 * This is what separates the two things a folder holding a same-named note can
 * mean, because nothing about the two differs on disk. At the notebook and
 * section levels that note is a page that happens to share the name of the place
 * it lives in, and the place stays a place you step into. Deeper, the same shape
 * is a page with its subpages beneath it.
 */
export function pathDepth(path: string): number {
	if (!path || path === "/") return 0;
	return path.split("/").length;
}

/**
 * The accent for a notebook the user has not colored: walk the palette by
 * position so neighbours never share a color, and nothing has to be stored.
 *
 * Position, not a hash of the name: hashing names into a fixed palette collides
 * badly (twelve notebooks over twelve colors averages about seven distinct, and
 * three identical covers in a row reads as a bug rather than a scheme). The cost
 * is that colors follow the arrangement, so an explicit color is how you pin
 * one to a notebook for good.
 */
export function autoAccent(index: number, palette: string[]): string | null {
	if (!palette.length || !Number.isInteger(index) || index < 0) return null;
	return palette[index % palette.length];
}

/**
 * Merge our settings over what is on disk RIGHT NOW, for a save.
 *
 * data.json is a synced file: other devices write it, and a device that has been
 * idle still holds whatever it read when its plugin loaded. Writing that whole
 * object back reverts every change made anywhere else since, which is how a
 * phone that merely opened a note (touching recentPages) erased favorites pinned
 * on a laptop hours earlier.
 *
 * So a save may only carry the keys we actually changed. `baseline` is the state
 * we last read from or wrote to disk, so anything differing from it is ours:
 * those keys overwrite. Every untouched key takes the disk's value. A key absent
 * from disk was written by a version that did not know it, and keeps ours rather
 * than resetting to a default.
 *
 * A key holding one value per folder (`orders` above all) needs that same rule
 * one level down, and this is where it used to stop. `orders` is ONE key holding
 * every folder's manual arrangement, so dragging a single page in a single folder
 * marked the whole key as ours and published this device's entire map over the
 * disk's. Every folder arranged on another device since this one last read was
 * erased by a device that had never seen it, and a folder whose entry vanishes
 * silently falls back to the app's own sort, which is what "my order changed
 * again" looks like from the outside. Per-entry, one drag publishes one folder.
 */
export function mergeForSave<T extends object>(ours: T, baseline: T, disk: Partial<T> | null): T {
	const out = { ...ours };
	if (!disk) return out;
	for (const k of Object.keys(ours) as (keyof T)[]) {
		if (!(k in disk)) continue; // disk has never heard of this key; ours stands
		const o = ours[k];
		const b = baseline[k];
		const d = disk[k];
		if (isRecord(o) && isRecord(b) && isRecord(d)) {
			out[k] = mergeEntries(o, b, d) as T[keyof T];
			continue;
		}
		const changedByUs = JSON.stringify(o) !== JSON.stringify(b);
		if (!changedByUs) out[k] = d as T[keyof T];
	}
	return out;
}

/** A per-folder map, as opposed to a value that means something whole. Arrays
 *  are values here: a list's order and membership are the thing itself. */
function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Settings that describe THIS device rather than the vault, and so never belong
 * in data.json.
 *
 * data.json is a synced file. A phone's recently-opened list is not the
 * laptop's: publishing one over the other is wrong on its face, and it is also
 * the single busiest write this plugin makes, because merely opening a note
 * changes it. Every one of those writes was a chance for two devices to edit
 * the file between syncs, which is the state that forces a merge. Keeping this
 * list out of the file removes both the wrong content and most of the traffic.
 *
 * These live in Obsidian's per-vault local storage instead, the same place the
 * rest of the suite keeps per-device state.
 */
export const DEVICE_KEYS = ["recentPages"] as const;

/** A copy without the per-device keys. Used on both sides of the file: what is
 *  read from disk never reaches memory, and what memory writes never reaches
 *  disk. Deleting rather than blanking matters while a fleet is mid-upgrade
 *  a blank published over a device still on the old build would wipe the list
 *  it is actively keeping. */
export function withoutDeviceKeys<T extends object>(o: T): Partial<T> {
	const out = { ...o } as Record<string, unknown>;
	for (const k of DEVICE_KEYS) delete out[k];
	return out as Partial<T>;
}

/** Just the per-device keys, for the local-storage stash. */
export function pickDeviceKeys<T extends object>(o: Partial<T>): Record<string, unknown> {
	const src = o as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const k of DEVICE_KEYS) if (k in src) out[k] = src[k];
	return out;
}

/** Does an object carry any per-device key? Asks whether a data.json predates
 *  the split and still holds this device's own history. */
export function hasDeviceKeys<T extends object>(o: Partial<T>): boolean {
	return DEVICE_KEYS.some((k) => k in (o as Record<string, unknown>));
}

/** Lay this device's stashed state over a settings object built from disk.
 *
 *  Every device key is a list of vault paths, and local storage is plain text
 *  that anything can corrupt or half-write, so a value that is not a list of
 *  strings is dropped rather than trusted: a bad stash costs the recent list,
 *  never a crash in the renderer that reads it. */
export function overlayDeviceState<T extends object>(target: T, raw: string | null): T {
	let parsed: unknown;
	try {
		parsed = raw ? JSON.parse(raw) : null;
	} catch {
		return target;
	}
	if (!isRecord(parsed)) return target;
	const dest = target as Record<string, unknown>;
	for (const k of DEVICE_KEYS) {
		const v = parsed[k];
		if (Array.isArray(v) && v.every((x) => typeof x === "string")) dest[k] = v;
	}
	return target;
}

/**
 * The same three-way rule, entry by entry.
 *
 * Start from the disk, so every folder another device arranged survives; drop
 * only what we deliberately removed (present in the baseline, gone from ours
 * a "Reset manual order"); then lay our own changed entries over the top. Two
 * devices arranging the SAME folder still settles last-writer-wins, but that is
 * one folder losing a race rather than a whole vault losing its arrangement.
 */
function mergeEntries(
	ours: Record<string, unknown>,
	baseline: Record<string, unknown>,
	disk: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(disk)) {
		const removedByUs = k in baseline && !(k in ours);
		if (!removedByUs) out[k] = disk[k];
	}
	for (const k of Object.keys(ours)) {
		const changedByUs = JSON.stringify(ours[k]) !== JSON.stringify(baseline[k]);
		if (changedByUs || !(k in disk)) out[k] = ours[k];
	}
	return out;
}

/**
 * How one folder decides its own order. "manual" is the default and the only
 * mode that honors a stored drag order; the name modes force a sort and ignore
 * that order, for folders that should stay filed alphabetically no matter what
 * lands in them (a People folder that plugins keep adding notes to).
 */
export type SortMode = "manual" | "az" | "za";

/** Name compare in the app's own style: case-insensitive, and digit runs
 *  compare as numbers so "Note 2" precedes "Note 10". */
export function compareNames(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Names under a folder's forced sort. "manual" (or unset) hands the list back
 *  untouched, so the caller's stored order and the app's sort still decide. */
export function applySortMode(names: string[], mode: SortMode | undefined): string[] {
	if (mode !== "az" && mode !== "za") return names;
	const out = [...names].sort(compareNames);
	return mode === "za" ? out.reverse() : out;
}

/** Float the pinned names (in pin order) above the rest. Names in the pin
 *  list that aren't present are ignored, never fatal. */
export function applyPins(names: string[], pinned: string[] | undefined): string[] {
	if (!pinned || !pinned.length) return names;
	const rank = new Map<string, number>();
	pinned.forEach((n, i) => rank.set(n, i));
	const pin: string[] = [];
	const rest: string[] = [];
	for (const n of names) (rank.has(n) ? pin : rest).push(n);
	if (!pin.length) return names;
	pin.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
	return [...pin, ...rest];
}

export interface PaneEntry {
	/** File name of the entry's page (null = the group's inside folder note anchors it). */
	page: string | null;
	/** Folder name when the entry is an expandable page group. */
	group: string | null;
}

/**
 * Pair a folder's ordered children into pages-pane entries. A note with a
 * same-named sibling folder anchors that folder as its page group (how
 * notebook importers lay out subpages); a folder alone is a group when it has
 * an inside folder note (hasNote); any other folder belongs to the tree, not
 * the pane. Entries keep the incoming order, a group sitting at its page's
 * position.
 */
export function pairPages(
	ordered: { name: string; folder: boolean }[],
	hasNote: (folderName: string) => boolean
): PaneEntry[] {
	const folders = new Set<string>();
	for (const o of ordered) if (o.folder) folders.add(o.name);
	const siblingBases = new Set<string>();
	for (const o of ordered) {
		if (!o.folder && o.name.endsWith(".md") && folders.has(o.name.slice(0, -3))) siblingBases.add(o.name.slice(0, -3));
	}
	const out: PaneEntry[] = [];
	for (const o of ordered) {
		if (!o.folder) {
			const base = o.name.endsWith(".md") ? o.name.slice(0, -3) : o.name;
			out.push({ page: o.name, group: o.name.endsWith(".md") && folders.has(base) ? base : null });
		} else if (!siblingBases.has(o.name) && hasNote(o.name)) {
			out.push({ page: null, group: o.name });
		}
	}
	return out;
}

/**
 * The new explicit order after dropping `dragged` before `before` (null =
 * at the end) in a folder whose current visible sequence is `visible`.
 * The result ranks every visible item, freezing the layout the user saw.
 */
export function insertOrder(visible: string[], dragged: string, before: string | null): string[] {
	const rest = visible.filter((n) => n !== dragged);
	if (before == null || before === dragged) return [...rest, dragged];
	const i = rest.indexOf(before);
	if (i < 0) return [...rest, dragged];
	return [...rest.slice(0, i), dragged, ...rest.slice(i)];
}

/**
 * The same for a whole selection: every dragged name lands as one block at the
 * drop point, and the block keeps the order the LIST had them in, not the order
 * they were clicked, what you saw picked up is what lands.
 *
 * Dropping onto the selection itself degrades to the end, the way a single item
 * dropped before itself does. One rule for both, however many are moving.
 */
export function insertOrderMany(visible: string[], dragged: string[], before: string | null): string[] {
	const moving = new Set(dragged);
	const block = visible.filter((n) => moving.has(n));
	// a dragged name the list has not caught up with yet still travels, in the
	// order it was handed over
	for (const n of dragged) if (!block.includes(n)) block.push(n);
	const rest = visible.filter((n) => !moving.has(n));
	if (before == null || moving.has(before)) return [...rest, ...block];
	const i = rest.indexOf(before);
	if (i < 0) return [...rest, ...block];
	return [...rest.slice(0, i), ...block, ...rest.slice(i)];
}

/**
 * Rename/move maintenance. Handles a rename in place, a move to a new parent
 * (the item leaves the old order and arrives unranked unless a positional
 * drop writes it explicitly), and for folders re-keys every stored order at
 * or under the old path.
 */
export function renameInOrders(orders: Orders, oldPath: string, newPath: string, isFolder: boolean): Orders {
	const out: Orders = {};
	const oldPrefix = oldPath + "/";
	for (const [k, v] of Object.entries(orders)) {
		let key = k;
		if (isFolder) {
			if (k === oldPath) key = newPath;
			else if (k.startsWith(oldPrefix)) key = newPath + k.slice(oldPath.length);
		}
		out[key] = v;
	}
	const oldParent = parentPathOf(oldPath);
	const newParent = parentPathOf(newPath);
	const oldName = nameOf(oldPath);
	const newName = nameOf(newPath);
	const arr = out[oldParent];
	if (arr) {
		out[oldParent] =
			oldParent === newParent ? arr.map((n) => (n === oldName ? newName : n)) : arr.filter((n) => n !== oldName);
	}
	return out;
}

/** Re-key a path-keyed map (e.g. section colors) after a rename/move. Generic in
 *  the value, since what hangs off a folder path is a color, a sort mode, or a
 *  list of template paths depending on the caller. */
export function renamePathKeyed<V>(map: Record<string, V>, oldPath: string, newPath: string): Record<string, V> {
	const out: Record<string, V> = {};
	const oldPrefix = oldPath + "/";
	for (const [k, v] of Object.entries(map)) {
		const key = k === oldPath ? newPath : k.startsWith(oldPrefix) ? newPath + k.slice(oldPath.length) : k;
		out[key] = v;
	}
	return out;
}

/** Drop a deleted path (and everything beneath it) from a path-keyed map. */
export function removePathKeyed<V>(map: Record<string, V>, path: string): Record<string, V> {
	const out: Record<string, V> = {};
	const prefix = path + "/";
	for (const [k, v] of Object.entries(map)) {
		if (k === path || k.startsWith(prefix)) continue;
		out[k] = v;
	}
	return out;
}

/** Re-key hidden-folder paths after a rename/move (a folder carries its
 *  hidden descendants with it). */
export function renameInHidden(hidden: string[], oldPath: string, newPath: string): string[] {
	const oldPrefix = oldPath + "/";
	return hidden.map((h) =>
		h === oldPath ? newPath : h.startsWith(oldPrefix) ? newPath + h.slice(oldPath.length) : h
	);
}

/** Drop a deleted path (and anything hidden beneath it) from the hidden list. */
export function removeFromHidden(hidden: string[], path: string): string[] {
	const prefix = path + "/";
	return hidden.filter((h) => h !== path && !h.startsWith(prefix));
}

/** Drop hidden-folder paths that no longer point to a real folder. A folder
 *  renamed or moved WITHOUT our rename hook seeing it (the filesystem, Sync from
 *  another device, or a move made while the plugin was off) leaves a stale path
 *  behind, otherwise a phantom "N hidden" the show-hidden toggle can never
 *  reveal or clear. `exists` reports whether a path is currently a folder. */
export function pruneHidden(hidden: string[], exists: (path: string) => boolean): string[] {
	return hidden.filter((h) => exists(h));
}

/** Re-key a single stored section path after a folder rename/move. null stays
 *  null; a sentinel (Recent) or unrelated path is returned unchanged. */
export function renameSection(path: string | null, oldPath: string, newPath: string): string | null {
	if (path === null) return null;
	if (path === oldPath) return newPath;
	if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
	return path;
}

/** Drop a stored section path when its folder (or an ancestor) is deleted, so
 *  the pages pane can't keep pointing at a folder that no longer exists. */
export function dropSection(path: string | null, deleted: string): string | null {
	if (path === null) return null;
	if (path === deleted || path.startsWith(deleted + "/")) return null;
	return path;
}

/** Frontmatter keys that describe the TEMPLATE, how its gallery card looks,
 *  what it names the page, and which folders it belongs to, rather than the
 *  page's real content. `icon`/`description` are the friendly names;
 *  `pe-icon`/`pe-desc` are the original aliases, still honored so templates
 *  made before the rename keep working. */
export const TEMPLATE_META_KEYS = ["icon", "description", "filename", "folders", "destination", "unique", "ask", "pe-icon", "pe-desc"];

/** Strip the template-only frontmatter keys from a template body so a page
 *  created from it doesn't inherit the gallery card, the naming pattern, or the
 *  folder scoping. Only the leading `---` block is touched; other keys (tags,
 *  status, …) are preserved, and a key whose value is an indented block (a YAML
 *  list, as `folders` often is) takes its whole block with it. If nothing but
 *  template keys was in there, the block goes entirely. */
export function stripTemplateMeta(body: string): string {
	const m = body.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
	if (!m) return body;
	const rest = body.slice(m[0].length);
	let dropping = false;
	const kept = m[1].split(/\r?\n/).filter((line) => {
		const key = line.match(/^([A-Za-z0-9_-]+)[ \t]*:/);
		if (key) dropping = TEMPLATE_META_KEYS.includes(key[1]);
		else if (dropping && !/^[ \t]/.test(line)) dropping = false; // block ended
		return !dropping;
	});
	if (kept.join("").trim() === "") return rest; // nothing real was left
	return `---\n${kept.join("\n")}\n---\n${rest}`;
}

/**
 * Delete maintenance: drop the child from its parent's order, and for folders
 * drop every stored order at or under the deleted path. A parent order that
 * becomes empty is removed entirely (the folder falls back to default sort).
 */
export function removeFromOrders(orders: Orders, path: string, isFolder: boolean): Orders {
	const out: Orders = {};
	const prefix = path + "/";
	for (const [k, v] of Object.entries(orders)) {
		if (isFolder && (k === path || k.startsWith(prefix))) continue;
		out[k] = v;
	}
	const parent = parentPathOf(path);
	const name = nameOf(path);
	const arr = out[parent];
	if (arr) {
		const next = arr.filter((n) => n !== name);
		if (next.length) out[parent] = next;
		else delete out[parent];
	}
	return out;
}

/**
 * Which way a phone drill navigation moves: into a descendant ("push"), back
 * out to an ancestor ("pop"), or a jump with no direction (null). `recent` is
 * the Recent Pages pseudo-section sentinel, treated as one level below root.
 */
export function drillDirection(from: string, to: string, recent: string): "push" | "pop" | null {
	if (from === to) return null;
	if (to === recent) return "push";
	if (from === recent) return "pop";
	const under = (anc: string, p: string) => (anc === "/" ? p !== "/" : p.startsWith(anc + "/"));
	if (under(from, to)) return "push";
	if (under(to, from)) return "pop";
	return null;
}

/** Recency list update: newest first, deduped, capped. */
export function pushRecent(list: string[], path: string, cap: number): string[] {
	const next = [path, ...list.filter((p) => p !== path)];
	return next.length > cap ? next.slice(0, cap) : next;
}

export function renameInRecents(list: string[], oldPath: string, newPath: string, isFolder: boolean): string[] {
	return list.map((p) => {
		if (p === oldPath) return newPath;
		if (isFolder && p.startsWith(oldPath + "/")) return newPath + p.slice(oldPath.length);
		return p;
	});
}

export function removeFromRecents(list: string[], path: string, isFolder: boolean): string[] {
	return list.filter((p) => p !== path && !(isFolder && p.startsWith(path + "/")));
}

/** The paths spanning anchor..target inclusive over a visible order, for
 *  Shift+click multi-select. Order-agnostic (anchor may sit after target).
 *  Unknown endpoints degrade to just the target when it exists. */
export function rangeSelect(order: string[], anchor: string, target: string): string[] {
	const a = order.indexOf(anchor);
	const b = order.indexOf(target);
	if (b < 0) return [];
	if (a < 0) return [target];
	const [lo, hi] = a <= b ? [a, b] : [b, a];
	return order.slice(lo, hi + 1);
}
