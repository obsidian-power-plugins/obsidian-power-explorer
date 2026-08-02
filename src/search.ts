// Power Explorer: pure full-text search engine. No Obsidian imports, everything
// here is unit-tested with Node (npm test); main.ts supplies the vault glue
// (reading files, watching events, persistence, and the modal UI).
//
// Design goals, in order: PREDICTABLE (word-prefix matching, never
// fuzzy, a result always visibly contains what was typed), ranked the way
// spatial memory expects (title hits first, then recency/pins via caller-injected
// boosts, then body relevance), and incremental (one file in, one file out).
//
// The index unit is a heading-scoped CHUNK (adapted from Power Capture's
// ask-your-vault BM25). Each document also gets two synthetic chunks, its
// title+aliases and its tags+folder path, so a note is findable by name, tag,
// or the section it lives in, and AND semantics work across all of them.

import { isUnder } from "./order";

/** One indexable piece of a document. `anchor` is a 0-based line for markdown
 *  chunks and a 1-based page number for attachment (PDF) chunks. */
export interface Chunk {
	heading: string;
	text: string;
	anchor: number;
}

export type ChunkKind = "body" | "attach" | "title" | "meta";

export interface DocInput {
	path: string;
	/** Display title (usually the basename without extension). */
	title: string;
	aliases: string[];
	/** Tags without the leading '#'. */
	tags: string[];
	mtime: number;
	chunks: Chunk[];
	/** Extracted attachment text (e.g. PDF pages), anchored by page number. */
	attach?: Chunk[];
}

export interface SearchOptions {
	limit?: number;
	/** Folder path to search under ("" or "/" = whole vault). */
	scope?: string;
	/** Caller-supplied per-document boost (recency, pins, manual order …). */
	docBoost?: (path: string) => number;
}

export interface SearchHit {
	path: string;
	title: string;
	score: number;
	/** Display chunk: where the best match lives. */
	kind: ChunkKind;
	heading: string;
	anchor: number;
	/** Context excerpt with [start, end) highlight ranges into `text`.
	 *  Null when only the title/tags/path matched (nothing to excerpt). */
	snippet: { text: string; ranges: [number, number][] } | null;
	/** Highlight ranges into `title`, built by the same matcher as snippets so
	 *  titles and excerpts always light up identically. */
	titleRanges: [number, number][];
	/** Every query word (or a prefix) is in the title, a real title match, not
	 *  a coincidental single-word hit. Drives the "In title" vs "In text" split. */
	titleAll: boolean;
	/** The surface terms that matched (exact terms plus prefix completions). */
	terms: string[];
}

export const MAX_CHUNK = 1600;

const STOPWORDS = new Set(
	"a an and are as at be but by for from has have i in is it its of on or that the this to was we were what when where which who will with you your".split(" ")
);

export function tokenize(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Split note content into heading-scoped chunks with real line anchors, so a
 * hit can scroll the editor to its section. Frontmatter lines are skipped but
 * still counted (anchors match the file on disk). Sections longer than
 * MAX_CHUNK wrap, each slice anchored at the line its text starts on, so a hit
 * deep inside a long transcript lands near the hit: not at the heading.
 * A heading with no body still yields a chunk, so headings are searchable.
 */
export function chunkNote(content: string): Chunk[] {
	const lines = content.split("\n");
	let start = 0;
	if (lines[0]?.trim() === "---") {
		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === "---") {
				start = i + 1;
				break;
			}
		}
	}
	const out: Chunk[] = [];
	let heading = "";
	let headingLine: number | null = null;
	let buf: { line: number; text: string }[] = [];
	const flush = () => {
		while (buf.length && !buf[0].text.trim()) buf.shift();
		while (buf.length && !buf[buf.length - 1].text.trim()) buf.pop();
		if (!buf.length) {
			// a heading with no body is still findable at its own line
			if (heading && headingLine != null) out.push({ heading, text: "", anchor: headingLine });
			buf = [];
			return;
		}
		const text = buf.map((b) => b.text).join("\n");
		const offsets: number[] = [];
		let o = 0;
		for (const b of buf) {
			offsets.push(o);
			o += b.text.length + 1;
		}
		for (let i = 0; i < text.length; i += MAX_CHUNK) {
			let li = 0;
			while (li + 1 < offsets.length && offsets[li + 1] <= i) li++;
			const anchor = i === 0 && headingLine != null ? headingLine : buf[li].line;
			out.push({ heading, text: text.slice(i, i + MAX_CHUNK), anchor });
		}
		buf = [];
	};
	for (let i = start; i < lines.length; i++) {
		const h = lines[i].match(/^#{1,6}\s+(.*)/);
		if (h) {
			flush();
			heading = h[1].trim();
			headingLine = i;
		} else buf.push({ line: i, text: lines[i] });
	}
	flush();
	return out;
}

/** How much each chunk kind counts. Title chunks are short (BM25 already
 *  favors them); the multiplier just keeps a title hit ahead of a body hit. */
const KIND_WEIGHT: Record<ChunkKind, number> = { body: 1, attach: 0.85, title: 1.6, meta: 1.1 };

/** Prefix completions score lower than the exactly-typed term. */
const EXPANSION_WEIGHT = 0.6;
/** At most this many completions per query token (highest document frequency
 *  first), so a two-letter prefix can't fan out into thousands of terms. */
const MAX_EXPANSIONS = 64;

/** Title tier bonuses, deterministic "the title IS what I typed" ranking
 *  that BM25 alone can't promise. Sized to outrank typical chunk scores. */
const TIER_EXACT_TITLE = 7;
const TIER_TITLE_PREFIX = 5;
const TIER_ALL_IN_TITLE = 3;
/** A literal phrase (the typed words adjacent) is the strongest relevance
 *  signal there is, so it outranks even a coincidental exact-title match
 *  "em dash" puts the page that says "em dashes" first, above pages that
 *  merely have "embedded" and "dashboard" somewhere. */
const TIER_PROXIMITY = 8;

interface IChunk {
	id: number;
	path: string;
	kind: ChunkKind;
	heading: string;
	text: string;
	anchor: number;
	len: number;
}

interface IDoc {
	title: string;
	titleLower: string;
	titleTokens: string[];
	mtime: number;
}

/**
 * The vault-wide index: BM25 over chunks, word-prefix expansion against a
 * sorted term dictionary, hard AND across query tokens (every token must match
 * somewhere in a document, its body, title, tags, or folder path), quoted
 * phrases as a substring post-filter. Pure and incremental; persistence is the
 * caller's job (store raw DocInputs, feed them back through addDoc on load).
 */
export class VaultIndex {
	private chunks = new Map<number, IChunk>();
	private postings = new Map<string, Map<number, number>>();
	private byPath = new Map<string, number[]>();
	/** Every distinct term a document put into the postings, so removal costs
	 *  O(doc terms), never O(dictionary), folder deletes stay instant. */
	private docTerms = new Map<string, Set<string>>();
	private docs = new Map<string, IDoc>();
	private nextId = 1;
	private totalLen = 0;
	private sortedTerms: string[] = [];
	private termsDirty = true;

	has(path: string) {
		return this.docs.has(path);
	}

	addDoc(doc: DocInput) {
		this.removeDoc(doc.path);
		const ids: number[] = [];
		const terms = new Set<string>();
		const add = (kind: ChunkKind, heading: string, text: string, anchor: number) => {
			const tokens = tokenize(`${heading} ${text}`);
			if (!tokens.length) return;
			const id = this.nextId++;
			this.chunks.set(id, { id, path: doc.path, kind, heading, text, anchor, len: tokens.length });
			this.totalLen += tokens.length;
			for (const t of tokens) {
				let post = this.postings.get(t);
				if (!post) {
					this.postings.set(t, (post = new Map<number, number>()));
					this.termsDirty = true; // only a genuinely new dictionary word re-sorts
				}
				post.set(id, (post.get(id) ?? 0) + 1);
				terms.add(t);
			}
			ids.push(id);
		};
		add("title", "", [doc.title, ...doc.aliases].join(" "), 0);
		const folders = doc.path.split("/").slice(0, -1).join(" ");
		add("meta", "", [...doc.tags, folders].filter(Boolean).join(" "), 0);
		for (const c of doc.chunks) add("body", c.heading, c.text, c.anchor);
		for (const c of doc.attach ?? []) add("attach", c.heading, c.text, c.anchor);
		this.byPath.set(doc.path, ids);
		this.docTerms.set(doc.path, terms);
		this.docs.set(doc.path, {
			title: doc.title,
			titleLower: doc.title.toLowerCase(),
			titleTokens: tokenize(doc.title),
			mtime: doc.mtime,
		});
	}

	removeDoc(path: string) {
		const ids = this.byPath.get(path);
		if (!ids) return;
		for (const id of ids) {
			const c = this.chunks.get(id);
			if (!c) continue;
			this.totalLen -= c.len;
			this.chunks.delete(id);
		}
		const gone = new Set(ids);
		for (const term of this.docTerms.get(path) ?? []) {
			const post = this.postings.get(term);
			if (!post) continue;
			for (const id of gone) post.delete(id);
			// an emptied term stays in sortedTerms until the next rebuild;
			// search skips terms with no postings, so stale entries are inert
			if (!post.size) this.postings.delete(term);
		}
		this.byPath.delete(path);
		this.docTerms.delete(path);
		this.docs.delete(path);
	}

	private ensureTerms() {
		if (!this.termsDirty) return;
		this.sortedTerms = [...this.postings.keys()].sort();
		this.termsDirty = false;
	}

	/** The typed term (if it exists) plus up to MAX_EXPANSIONS completions,
	 *  highest document frequency first. Empty = this token matches nothing. */
	private expand(token: string): string[] {
		this.ensureTerms();
		const terms = this.sortedTerms;
		let lo = 0;
		let hi = terms.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (terms[mid] < token) lo = mid + 1;
			else hi = mid;
		}
		const completions: string[] = [];
		let exact = false;
		for (let i = lo; i < terms.length && terms[i].startsWith(token); i++) {
			if (terms[i] === token) exact = true;
			else completions.push(terms[i]);
			if (completions.length >= 2000) break; // plenty to pick the top from
		}
		if (completions.length > MAX_EXPANSIONS) {
			completions.sort((a, b) => (this.postings.get(b)?.size ?? 0) - (this.postings.get(a)?.size ?? 0));
			completions.length = MAX_EXPANSIONS;
		}
		return exact ? [token, ...completions] : completions;
	}

	private inScope(path: string, scope: string): boolean {
		return isUnder(path, scope);
	}

	search(query: string, opts: SearchOptions = {}): SearchHit[] {
		const limit = opts.limit ?? 50;
		const scope = opts.scope ?? "";
		const phrases: string[] = [];
		const rest = query.replace(/"([^"]*)"/g, (_, p: string) => {
			if (p.trim()) phrases.push(p.trim());
			return " ";
		});
		const tokens = [...new Set(tokenize(rest + " " + phrases.join(" ")))];
		if (!tokens.length && !phrases.length) return [];

		// hard AND: every token (or a completion of it) must appear in the doc
		const expansions = new Map<string, string[]>();
		let candidates: Set<string> | null = null;
		for (const token of tokens) {
			const exps = this.expand(token);
			if (!exps.length) return [];
			expansions.set(token, exps);
			const docsWith = new Set<string>();
			for (const e of exps) {
				for (const id of this.postings.get(e)?.keys() ?? []) {
					const c = this.chunks.get(id);
					if (c && this.inScope(c.path, scope)) docsWith.add(c.path);
				}
			}
			if (!docsWith.size) return [];
			if (!candidates) candidates = docsWith;
			else {
				for (const p of candidates) if (!docsWith.has(p)) candidates.delete(p);
				if (!candidates.size) return [];
			}
		}
		if (!candidates) {
			// phrase-only query (e.g. every word was a stopword): scan everything in scope
			candidates = new Set();
			for (const p of this.docs.keys()) if (this.inScope(p, scope)) candidates.add(p);
		}

		// quoted phrases: a candidate must contain each phrase as a real substring
		// (words in order, any short separator, space, newline, hyphen, dot).
		// Tested against CLEANED text and against every chunk kind, so a phrase
		// that only lives in a title, tag, or folder name still matches, and
		// markdown decoration between the words can't hide one.
		const phraseRegexes = phrases.map((p) => {
			const words = p.toLowerCase().match(/[a-z0-9]+/g) ?? [];
			if (!words.length) return null;
			// anchor the first word at a word boundary so "em dash" matches
			// "em dashes" but not "system dashboard" (em there is mid-word)
			return new RegExp("\\b" + words.map((w) => escapeRegex(w)).join("[^a-z0-9]{1,5}"), "i");
		});
		const phraseChunk = new Map<string, number>();
		for (const re of phraseRegexes) {
			if (!re) continue;
			for (const path of [...candidates]) {
				let hit = false;
				let display = -1;
				for (const id of this.byPath.get(path) ?? []) {
					const c = this.chunks.get(id)!;
					if (!re.test(cleanText(c.text))) continue;
					hit = true;
					if (c.kind === "body" || c.kind === "attach") {
						display = id;
						break;
					}
				}
				if (!hit) candidates.delete(path);
				else if (display >= 0 && !phraseChunk.has(path)) phraseChunk.set(path, display);
			}
			if (!candidates.size) return [];
		}

		// implicit proximity: mark docs where the typed words appear ADJACENT as
		// a real phrase: each word but the last matched WHOLE (so "em dashes"
		// counts, "email dashboard" and "embedded dashboard" do not), the last
		// may be a prefix. Filtering still uses plain AND, so this only RERANKS:
		// the phrase page floats to the top; scattered matches stay found.
		const proxHit = new Set<string>();
		if (tokens.length >= 2) {
			const body = tokens.map((t, i) => escapeRegex(t) + (i < tokens.length - 1 ? "\\b" : "[a-z0-9]*")).join("[^a-z0-9]{1,3}");
			const proxRe = new RegExp("\\b" + body, "i");
			for (const path of candidates) {
				for (const id of this.byPath.get(path) ?? []) {
					if (proxRe.test(cleanText(this.chunks.get(id)!.text))) {
						proxHit.add(path);
						break;
					}
				}
			}
		}

		// BM25 over the candidates' chunks; completions score below exact terms
		const N = this.chunks.size;
		const avgdl = N ? this.totalLen / N : 1;
		const k1 = 1.5;
		const b = 0.75;
		const scores = new Map<number, number>();
		for (const token of tokens) {
			for (const e of expansions.get(token)!) {
				const post = this.postings.get(e);
				if (!post) continue;
				const w = e === token ? 1 : EXPANSION_WEIGHT;
				const idf = Math.log(1 + (N - post.size + 0.5) / (post.size + 0.5));
				for (const [id, tf] of post) {
					const c = this.chunks.get(id)!;
					if (!candidates.has(c.path)) continue;
					const s = w * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.len) / avgdl)));
					scores.set(id, (scores.get(id) ?? 0) + s);
				}
			}
		}

		// per document: best chunk overall drives the score; the best body or
		// attachment chunk (a phrase hit wins) is what gets shown
		const best = new Map<string, { score: number; display: IChunk | null; displayScore: number }>();
		for (const [id, raw] of scores) {
			const c = this.chunks.get(id)!;
			const s = raw * KIND_WEIGHT[c.kind];
			let d = best.get(c.path);
			if (!d) best.set(c.path, (d = { score: 0, display: null, displayScore: -1 }));
			if (s > d.score) d.score = s;
			if ((c.kind === "body" || c.kind === "attach") && s > d.displayScore && !phraseChunk.has(c.path)) {
				d.display = c;
				d.displayScore = s;
			}
		}
		for (const [path, id] of phraseChunk) {
			const c = this.chunks.get(id)!;
			let d = best.get(path);
			if (!d) best.set(path, (d = { score: 0, display: null, displayScore: -1 }));
			d.display = c;
		}

		const queryLower = query.replace(/"/g, "").trim().toLowerCase();
		const joined = tokens.join(" ");
		const ranked: { path: string; score: number; display: IChunk | null; titleAll: boolean }[] = [];
		for (const path of candidates) {
			const d = best.get(path);
			const doc = this.docs.get(path);
			if (!doc) continue;
			let score = d?.score ?? 1; // phrase-only match with no scored terms still ranks
			// a real title match: every query word (or a prefix) is in the title,
			// not just one coincidental word, drives both the tier and the split
			const titleAll = tokens.length > 0 && tokens.every((t) => doc.titleTokens.some((tt) => tt === t || tt.startsWith(t)));
			if (tokens.length) {
				if (doc.titleTokens.join(" ") === joined) score += TIER_EXACT_TITLE;
				else if (queryLower && doc.titleLower.startsWith(queryLower)) score += TIER_TITLE_PREFIX;
				else if (titleAll) score += TIER_ALL_IN_TITLE;
			}
			if (proxHit.has(path)) score += TIER_PROXIMITY;
			score += opts.docBoost?.(path) ?? 0;
			ranked.push({ path, score, display: d?.display ?? null, titleAll });
		}
		ranked.sort((a, b2) => {
			if (b2.score !== a.score) return b2.score - a.score;
			const ma = this.docs.get(a.path)?.mtime ?? 0;
			const mb = this.docs.get(b2.path)?.mtime ?? 0;
			if (mb !== ma) return mb - ma;
			return a.path < b2.path ? -1 : 1;
		});

		const surfaces = [...new Set([...expansions.values()].flat())].sort((a, b2) => b2.length - a.length);
		const finder = buildFinder(surfaces, phraseRegexes);
		return this.assembleHits(ranked.slice(0, limit), surfaces, phraseRegexes, finder);
	}

	private assembleHits(
		ranked: { path: string; score: number; display: IChunk | null; titleAll?: boolean }[],
		surfaces: string[],
		phraseRegexes: (RegExp | null)[],
		finder: RegExp | null
	): SearchHit[] {
		const out: SearchHit[] = [];
		for (const r of ranked) {
			const doc = this.docs.get(r.path)!;
			const c = r.display;
			out.push({
				path: r.path,
				title: doc.title,
				score: r.score,
				kind: c?.kind ?? "title",
				heading: c?.heading ?? "",
				anchor: c?.anchor ?? 0,
				snippet: c ? makeSnippet(c.text, surfaces, phraseRegexes) : null,
				titleRanges: findRanges(doc.title, finder),
				titleAll: r.titleAll ?? false,
				terms: surfaces,
			});
		}
		return out;
	}

	/**
	 * OR-mode BM25 over content chunks with their FULL text, for RAG consumers
	 * (Power Capture's Ask-your-vault). No AND gate, no prefix expansion, no
	 * title tiers, the caller brings its own expanded synonym terms, where
	 * requiring every one would guarantee zero results.
	 */
	retrieveChunks(
		terms: string[],
		k: number,
		scope = ""
	): { path: string; heading: string; text: string; score: number }[] {
		const N = this.chunks.size;
		if (!N) return [];
		const avgdl = this.totalLen / N;
		const k1 = 1.5;
		const b = 0.75;
		const scores = new Map<number, number>();
		// A title or meta match says WHICH note, never what to quote from it, so
		// its score is banked per path rather than scored as a chunk.
		const byTitle = new Map<string, number>();
		for (const term of new Set(terms)) {
			const post = this.postings.get(term);
			if (!post) continue;
			const idf = Math.log(1 + (N - post.size + 0.5) / (post.size + 0.5));
			for (const [id, tf] of post) {
				const c = this.chunks.get(id)!;
				if (!isUnder(c.path, scope)) continue;
				const s = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.len) / avgdl)));
				if (c.kind === "title" || c.kind === "meta") {
					byTitle.set(c.path, (byTitle.get(c.path) ?? 0) + s);
					continue;
				}
				scores.set(id, (scores.get(id) ?? 0) + s);
			}
		}

		// Carry each title match down onto that note's own body.
		//
		// Returning the title chunk itself would hand the answer layer a bare
		// filename as evidence, which is why it was skipped outright. But
		// skipping made a note unreachable by its own name whenever the name is
		// not repeated inside it, a YouTube capture titled "ChatGPT Offered Me
		// $2m To Keep Quiet" whose transcript is about superintelligence
		// timelines and contains none of those words. Asking about it by title
		// matched only the one chunk that could never be returned.
		//
		// At most TITLE_SPREAD chunks per note take the boost, so one title hit
		// lifts a note into the running without flooding the results with it.
		const TITLE_SPREAD = 3;
		for (const [path, titleScore] of byTitle) {
			const body = (this.byPath.get(path) ?? []).filter((id) => {
				const c = this.chunks.get(id);
				return !!c && c.kind !== "title" && c.kind !== "meta";
			});
			if (!body.length) continue; // a note with nothing but a title has nothing to quote
			const scored = body.filter((id) => scores.has(id)).sort((x, y) => (scores.get(y) ?? 0) - (scores.get(x) ?? 0));
			// chunks that already matched on their own text are the best excerpts;
			// with none, the opening chunks stand in, which is where these notes
			// keep their summary
			const targets = (scored.length ? scored : body).slice(0, TITLE_SPREAD);
			for (const id of targets) scores.set(id, (scores.get(id) ?? 0) + titleScore);
		}
		return [...scores.entries()]
			.sort((x, y) => y[1] - x[1])
			.slice(0, k)
			.map(([id, score]) => {
				const c = this.chunks.get(id)!;
				return { path: c.path, heading: c.heading, text: c.text, score };
			});
	}
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-anchored match ranges of the given surface terms in raw editor text,
 *  each term extended over the rest of its word so a prefix lights the whole
 *  word. Longest term first so overlaps prefer the fuller match; capped. */
export function editorMatchRanges(text: string, terms: string[], cap = 2000): [number, number][] {
	const uniq = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
	if (!uniq.length) return [];
	const src = uniq.sort((a, b) => b.length - a.length).map((t) => "\\b" + escapeRegex(t) + "\\w*");
	const re = new RegExp("(" + src.join(")|(") + ")", "gi");
	const out: [number, number][] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m[0].length) out.push([m.index, m.index + m[0].length]);
		else re.lastIndex++;
		if (out.length >= cap) break;
	}
	return out;
}

/** Markdown decoration stripped and whitespace collapsed: what a reader sees.
 *  Snippets are cut from this, and phrases are matched against it. */
export function cleanText(text: string): string {
	return text.replace(/[#*_`>|]|\[\[|\]\]|!\[|\]\(([^)]*)\)/g, " ").replace(/\s+/g, " ").trim();
}

/** The one matcher both titles and snippets highlight with: every phrase, then
 *  every surface term, word-anchored. Null when there is nothing to find. */
function buildFinder(surfaces: string[], phraseRegexes: (RegExp | null)[]): RegExp | null {
	const sources = [
		...phraseRegexes.filter((r): r is RegExp => !!r).map((r) => r.source),
		...surfaces.map((s) => "\\b" + escapeRegex(s)),
	];
	return sources.length ? new RegExp("(" + sources.join(")|(") + ")", "gi") : null;
}

/** Every [start, end) match of the finder in the text. */
export function findRanges(text: string, finder: RegExp | null): [number, number][] {
	if (!finder) return [];
	const ranges: [number, number][] = [];
	finder.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = finder.exec(text))) {
		if (m[0].length) ranges.push([m.index, m.index + m[0].length]);
		else finder.lastIndex++;
	}
	return ranges;
}

/** A ~170-char excerpt around the first match, markdown noise stripped, with
 *  [start, end) ranges for every term or phrase occurrence inside it. */
export function makeSnippet(
	text: string,
	surfaces: string[],
	phraseRegexes: (RegExp | null)[] = []
): { text: string; ranges: [number, number][] } | null {
	const clean = cleanText(text);
	if (!clean) return null;
	const finder = buildFinder(surfaces, phraseRegexes);
	if (!finder) return { text: clean.slice(0, 170), ranges: [] };
	const first = finder.exec(clean);
	if (!first) return { text: clean.slice(0, 170), ranges: [] };
	const from = Math.max(0, first.index - 40);
	const start = from === 0 ? 0 : clean.indexOf(" ", from) + 1 || from;
	let excerpt = clean.slice(start, start + 170);
	if (start > 0) excerpt = "…" + excerpt;
	if (start + 170 < clean.length) excerpt = excerpt + "…";
	return { text: excerpt, ranges: findRanges(excerpt, finder) };
}
