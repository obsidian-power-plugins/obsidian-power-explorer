// Power Explorer: the page template engine. No Obsidian imports — everything
// here is unit-tested with Node (npm test).
//
// Two jobs, one token vocabulary: work out what a new page is CALLED and what
// it CONTAINS. A template note declares its own naming with a `filename`
// property, so "a page in Meetings" and "a page in Research" can differ in
// both shape and name without the creating code knowing anything about either.
//
// Dates are formatted here rather than through Obsidian's bundled moment so
// this module stays runnable in Node. The trade is a fixed English locale for
// day and month names, which is what the format strings people write for
// filenames (YYYY-MM-DD and friends) overwhelmingly want anyway.

import { isUnder } from "./order";

/** What the tokens resolve against: the moment of creation and the folder the
 *  page is being made in. `now` is injected so tests aren't clock-dependent. */
export interface TokenContext {
	now: Date;
	/** The folder's own name, e.g. "Meetings". */
	folder: string;
	/** Its full vault path, e.g. "Acme/Meetings"; "/" at the root. */
	folderPath: string;
	/** The parent folder's name, e.g. "Acme". */
	parent: string;
	/** The vault's name. */
	vault: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Longest-first, so YYYY is never read as YY+YY and MMMM never as MMM+M. */
const DATE_TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|hh|mm|ss|A|a/g;

const pad = (n: number) => (n < 10 ? "0" + n : String(n));

/** Format a date the moment way, for the subset of tokens that earn their keep
 *  in a filename. `[literal]` passes through untouched, so [Week] W stays a
 *  word rather than becoming a day name. */
export function formatDate(d: Date, fmt: string): string {
	return fmt.replace(DATE_TOKENS, (tok, literal?: string) => {
		if (literal !== undefined) return literal;
		const h12 = d.getHours() % 12 || 12;
		switch (tok) {
			case "YYYY": return String(d.getFullYear());
			case "YY": return pad(d.getFullYear() % 100);
			case "MMMM": return MONTHS[d.getMonth()];
			case "MMM": return MONTHS[d.getMonth()].slice(0, 3);
			case "MM": return pad(d.getMonth() + 1);
			case "M": return String(d.getMonth() + 1);
			case "dddd": return DAYS[d.getDay()];
			case "ddd": return DAYS[d.getDay()].slice(0, 3);
			case "DD": return pad(d.getDate());
			case "D": return String(d.getDate());
			case "HH": return pad(d.getHours());
			case "hh": return pad(h12);
			case "mm": return pad(d.getMinutes());
			case "ss": return pad(d.getSeconds());
			case "A": return d.getHours() < 12 ? "AM" : "PM";
			case "a": return d.getHours() < 12 ? "am" : "pm";
			default: return tok;
		}
	});
}

/** The editable segment of a name, bracketed while the string is still being
 *  built so sanitising and de-colliding can move it around without losing
 *  track of where it ended up. Control characters: nothing a user types, and
 *  nothing the sanitiser strips. */
const MARK_START = "\u0001";
const MARK_END = "\u0002";
/** The same trick for {{cursor}}: a character no template can contain,
 *  carried through rendering so the offset survives the substitutions made
 *  around it. */
const MARK_CURSOR = "\u0003";

const TOKEN = /\{\{\s*([a-zA-Z]+)\s*([+-]\s*\d+\s*[dwmy])?\s*(?::([^}]*))?\}\}/g;

/** Shift a date by a token's offset ("+1d", "-2w", "+3m", "+1y"). Month and
 *  year steps clamp rather than overflow, so a month step from the 31st lands
 *  on the last day of the shorter month instead of skidding into the next one. */
export function shiftDate(d: Date, offset: string | undefined): Date {
	const m = offset?.replace(/\s+/g, "").match(/^([+-])(\d+)([dwmy])$/);
	if (!m) return d;
	const n = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
	const out = new Date(d.getTime());
	if (m[3] === "d") out.setDate(out.getDate() + n);
	else if (m[3] === "w") out.setDate(out.getDate() + n * 7);
	else {
		const day = out.getDate();
		out.setDate(1);
		if (m[3] === "m") out.setMonth(out.getMonth() + n);
		else out.setFullYear(out.getFullYear() + n);
		const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
		out.setDate(Math.min(day, last));
	}
	return out;
}

/**
 * Substitute `{{...}}` tokens. Unknown tokens are left verbatim on purpose: a
 * template that documents `{{title}}` as prose (the Cheat Sheet note does) must
 * survive being used as a template.
 *
 * `markName` brackets what `{{name:...}}` produced, for renderName below.
 */
export function renderTokens(pattern: string, ctx: TokenContext, markName = false): string {
	return pattern.replace(TOKEN, (whole, rawName: string, offset: string | undefined, arg?: string) => {
		const name = rawName.toLowerCase();
		const a = arg?.trim();
		switch (name) {
			case "date": return formatDate(shiftDate(ctx.now, offset), a || "YYYY-MM-DD");
			case "time": return formatDate(shiftDate(ctx.now, offset), a || "HH:mm");
			case "folder": return ctx.folder;
			case "parent": return ctx.parent;
			case "vault": return ctx.vault;
			// The bit you're meant to type over. Bare {{name}} leaves an empty
			// slot, which lands the cursor there with nothing to delete first.
			case "name": return markName ? MARK_START + (a ?? "") + MARK_END : (a ?? "");
			// Where to leave the cursor. Marked while rendering, located and
			// removed by renderBodyAt; renderBody just drops it.
			case "cursor": return markName ? MARK_CURSOR : "";
			default: return whole;
		}
	});
}

/** Characters Windows, macOS, or Obsidian itself refuse in a filename. Colons
 *  become dots so a stray {{time}} reads as 14.30 rather than 1430, and path
 *  separators become dashes so a name can never quietly become a folder. */
export function sanitizeFilename(name: string): string {
	return name
		.replace(/:/g, ".")
		.replace(/[/\\]/g, "-")
		.replace(/[*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.replace(/^[\s.]+|[\s.]+$/g, "")
		.slice(0, 120)
		.trim();
}

/** A rendered page name plus where its editable segment ended up, in character
 *  offsets into `name`. `select` is null when the pattern had no {{name}}. */
export interface RenderedName {
	name: string;
	select: { start: number; end: number } | null;
}

/**
 * Render a filename pattern: tokens, then sanitising, then the offsets of the
 * `{{name:...}}` segment in what survived. An empty result falls back to
 * "Untitled" rather than to a nameless file.
 */
export function renderName(pattern: string, ctx: TokenContext): RenderedName {
	const marked = sanitizeFilename(renderTokens(pattern, ctx, true));
	const start = marked.indexOf(MARK_START);
	const end = start < 0 ? -1 : marked.indexOf(MARK_END, start);
	// The marks hold the sanitiser off the edges of the name, so trim once more
	// with them gone: a bare {{name}} at the end leaves a dangling separator,
	// and a filename may not begin or end with a space or a dot.
	const raw = strip(marked);
	const lead = raw.length - raw.replace(/^[\s.]+/, "").length;
	const name = raw.replace(/^[\s.]+|[\s.]+$/g, "");
	if (!name) return { name: "Untitled", select: null };
	if (start < 0 || end < 0) return { name, select: null };
	// -1 for the opening mark that is now gone; the closing one sits past `end`.
	const from = clamp(start - lead, 0, name.length);
	return { name, select: { start: from, end: clamp(end - 1 - lead, from, name.length) } };
}

const strip = (s: string) => s.split(MARK_START).join("").split(MARK_END).join("");
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Render a template's body. Same vocabulary as the filename, so a note can
 *  open with the date it was made without a second syntax to learn. */
export function renderBody(body: string, ctx: TokenContext): string {
	return renderTokens(body, ctx);
}

/**
 * Render a body and say where the cursor belongs: the offset `{{cursor}}` was
 * at, or null if the template didn't ask.
 *
 * Worth the trouble because of what a cursor left at the top of the page does
 * in Live Preview. A note that opens with a code block first (a daily note with
 * an agenda block) shows that block's raw source until you click away, because
 * the cursor is inside it. Landing the cursor where you actually write instead
 * means the page renders right the first time.
 */
export function renderBodyAt(body: string, ctx: TokenContext): { body: string; cursor: number | null } {
	// Name marks come out FIRST: a {{name}} ahead of the cursor in the body
	// would otherwise shift the offset by the two characters bracketing it.
	const cleaned = strip(renderTokens(body, ctx, true));
	const at = cleaned.indexOf(MARK_CURSOR);
	if (at < 0) return { body: cleaned, cursor: null };
	return { body: cleaned.split(MARK_CURSOR).join(""), cursor: at };
}

/**
 * The first free name in a folder. `sep` and `start` differ by caller: pattern
 * names collide as "-2", "-3" (the convention Power Assistant's meeting notes
 * already use), while plain untitled pages keep counting "Untitled 1".
 */
export function uniqueName(base: string, exists: (name: string) => boolean, sep = "-", start = 2): string {
	if (!exists(base)) return base;
	for (let n = start; ; n++) {
		const candidate = `${base}${sep}${n}`;
		if (!exists(candidate)) return candidate;
	}
}

/** A question a template wants answered before its page is made. */
export interface AskField {
	/** The prompt shown as the field's label, and the key its answer is filed
	 *  under. Asking the same thing twice is one field, answered once. */
	question: string;
	/** What to use when the answer is left blank, from `{{ask:Question=Default}}`. */
	fallback: string;
}

const ASK = /\{\{\s*ask\s*:([^}]*)\}\}/gi;

/** The questions in a template, in the order they are first asked. Filename and
 *  body are passed together so one dialog covers the whole page. */
export function askFields(...texts: string[]): AskField[] {
	const out: AskField[] = [];
	for (const text of texts) {
		for (const m of text.matchAll(ASK)) {
			const [q, ...rest] = m[1].split("=");
			const question = q.trim();
			if (!question || out.some((f) => f.question === question)) continue;
			out.push({ question, fallback: rest.join("=").trim() });
		}
	}
	return out;
}

/** Fill the questions in with what was answered. A blank answer falls back to
 *  the token's own default, so a field you tabbed past still reads sensibly. */
export function applyAnswers(text: string, answers: Record<string, string>): string {
	return text.replace(ASK, (_w, body: string) => {
		const [q, ...rest] = body.split("=");
		const question = q.trim();
		const given = (answers[question] ?? "").trim();
		return given || rest.join("=").trim();
	});
}

/** A YYYY-MM-DD anywhere in a name, which is what makes a page a dated one.
 *  Deliberately loose: "2026-07-28 Tuesday" and "Standup 2026-07-28" both
 *  count, so renaming a daily note doesn't make it a different day. */
export function dateKeyIn(name: string): string | null {
	const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	const mo = +m[2];
	const d = +m[3];
	return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * The page a template with `unique` set should OPEN rather than duplicate, or
 * null to go ahead and create one.
 *
 * "day" matches on the date in the name, not the whole name, so a daily note
 * you renamed to "2026-07-28 Tuesday retro" is still today's page. Anything
 * else truthy matches the name exactly, which is what a template with a
 * {{name}} slot in its pattern wants.
 */
export function uniqueMatch(mode: unknown, existing: string[], name: string): string | null {
	if (mode == null || mode === false || mode === "" || mode === "false") return null;
	const byDay = typeof mode === "string" && /^(day|date|daily)$/i.test(mode.trim());
	if (!byDay) return existing.includes(name) ? name : null;
	const key = dateKeyIn(name);
	if (!key) return existing.includes(name) ? name : null;
	return existing.find((n) => dateKeyIn(n) === key) ?? null;
}

/** The most recent dated page before `key`, for pulling yesterday's unfinished
 *  work forward. "Yesterday" means the previous page that exists, not the
 *  previous calendar day: a Monday note should collect Friday's leftovers. */
export function previousDatedName(existing: string[], key: string): string | null {
	let best: { name: string; key: string } | null = null;
	for (const n of existing) {
		const k = dateKeyIn(n);
		if (!k || k >= key) continue;
		if (!best || k > best.key || (k === best.key && n < best.name)) best = { name: n, key: k };
	}
	return best?.name ?? null;
}

/**
 * The unchecked task lines of a note, indentation kept so a nested checklist
 * arrives shaped the way it was written. Checked boxes and every other kind of
 * line are left behind; a task carrying no text is skipped, since an empty
 * "- [ ]" is a template artefact rather than work someone owes.
 */
export function unfinishedTasks(markdown: string): string[] {
	const out: string[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const m = line.match(/^([ \t]*)[-*+][ \t]+\[([ xX])\][ \t]*(.*)$/);
		if (m && m[2] === " " && m[3].trim()) out.push(`${m[1]}- [ ] ${m[3].trim()}`);
	}
	return out;
}

/** The folders a template's `folders` property claims. Accepts a comma-separated
 *  string or a YAML list, since both are natural to type in the properties UI. */
export function folderScopes(value: unknown): string[] {
	const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const p = item.trim().replace(/^\.?\//, "").replace(/\/+$/, "");
		if (p && !out.includes(p)) out.push(p);
	}
	return out;
}

/** How well a template fits the folder being added to: 2 named it exactly, 1
 *  named an ancestor of it, 0 didn't name it at all. Templates that claim no
 *  folders score 0 and simply sort below the ones that do. */
export function templateRank(scopes: string[], folderPath: string): number {
	let best = 0;
	for (const s of scopes) {
		if (s === folderPath) return 2;
		if (isUnder(folderPath, s)) best = Math.max(best, 1);
	}
	return best;
}
