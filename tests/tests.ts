// Node unit tests for the pure ordering logic. Run: npm test
import {
	applyOrder,
	applyPins,
	applySortMode,
	autoAccent,
	mergeForSave,
	hasDeviceKeys,
	overlayDeviceState,
	pickDeviceKeys,
	withoutDeviceKeys,
	drillDirection,
	insertOrder,
	insertOrderMany,
	isAttachmentName,
	joinPath,
	nameOf,
	dropSection,
	pairPages,
	parentPathOf,
	pathDepth,
	sortChildren,
	pruneHidden,
	pushRecent,
	removeFromHidden,
	renameSection,
	stripTemplateMeta,
	removeFromOrders,
	removeFromRecents,
	rangeSelect,
	removePathKeyed,
	renameInHidden,
	renameInOrders,
	renameInRecents,
	renamePathKeyed,
} from "../src/order";
import { applyAnswers, askFields, dateKeyIn, folderScopes, formatDate, previousDatedName, renderBody, renderBodyAt, renderName, renderTokens, sanitizeFilename, shiftDate, templateRank, unfinishedTasks, uniqueMatch, uniqueName } from "../src/template";

// --- rangeSelect (multi-select) ---
const ORDER = ["a.md", "b.md", "c.md", "d.md"];
eq(rangeSelect(ORDER, "b.md", "d.md"), ["b.md", "c.md", "d.md"], "range spans anchor to target");
eq(rangeSelect(ORDER, "d.md", "b.md"), ["b.md", "c.md", "d.md"], "range is order-agnostic");
eq(rangeSelect(ORDER, "b.md", "b.md"), ["b.md"], "a single-row range is just that row");
eq(rangeSelect(ORDER, "zzz", "c.md"), ["c.md"], "unknown anchor degrades to the target");
eq(rangeSelect(ORDER, "b.md", "zzz"), [], "unknown target selects nothing");

let failures = 0;
function ok(cond: unknown, msg: string) {
	if (cond) console.log("  ok -", msg);
	else {
		failures++;
		console.error("  FAIL -", msg);
	}
}
function eq(a: unknown, b: unknown, msg: string) {
	const sa = JSON.stringify(a);
	const sb = JSON.stringify(b);
	if (sa === sb) console.log("  ok -", msg);
	else {
		failures++;
		console.error("  FAIL -", msg, "\n    got:     ", sa, "\n    expected:", sb);
	}
}

// --- paths ---
eq(parentPathOf("a/b/c.md"), "a/b", "parent of nested file");
eq(parentPathOf("c.md"), "/", "parent of root file is /");
eq(parentPathOf("a"), "/", "parent of root folder is /");
eq(nameOf("a/b/c.md"), "c.md", "name of nested file");
eq(nameOf("c.md"), "c.md", "name of root file");
eq(joinPath("a/b", "c.md"), "a/b/c.md", "a child of a nested folder");
eq(joinPath("/", "c.md"), "c.md", "a child of the root carries no leading slash");
eq(joinPath("", "c.md"), "c.md", "the empty root reads the same as /");
// the round trip the rename pairing relies on: rebuild a sibling's path from
// the parent it came from, at any depth, including the root
eq(joinPath(parentPathOf("a/b/c.md"), "d.md"), "a/b/d.md", "a nested sibling");
eq(joinPath(parentPathOf("c.md"), "d.md"), "d.md", "a root sibling");

// --- autoAccent (notebooks arrive colored without being configured) ---
{
	const PAL = ["#0063B1", "#00B7C3", "#107C10", "#FFB900", "#E81123"];
	eq(autoAccent(0, PAL), "#0063B1", "the first notebook takes the first color");
	eq(autoAccent(2, PAL), "#107C10", "colors follow position");
	// The whole point: no two neighbours share a color, which a name hash could
	// not promise (it averaged ~7 distinct over 12 notebooks).
	const run = [0, 1, 2, 3, 4].map((i) => autoAccent(i, PAL));
	eq(new Set(run).size, 5, "a palette-length run is all distinct");
	eq(autoAccent(5, PAL), "#0063B1", "past the end it wraps around");
	eq(autoAccent(0, []), null, "no palette, no color (never undefined)");
	eq(autoAccent(-1, PAL), null, "a nonsense index yields no color, never undefined");
}

// --- sortChildren (the explorer's sort, for when mobile can't be asked) ---
{
	type N = { n: string; folder: boolean; ct: number; mt: number };
	const F = (n: string, ct: number, mt: number): N => ({ n, folder: false, ct, mt });
	const D = (n: string): N => ({ n, folder: true, ct: 0, mt: 0 });
	const nameOf = (x: N) => x.n;
	const isDir = (x: N) => x.folder;
	const timeOf = (x: N) => (x.folder ? null : { ctime: x.ct, mtime: x.mt });
	const names = (a: N[]) => a.map((x) => x.n);
	const set = [F("banana.md", 30, 5), D("Zeta"), F("apple.md", 10, 50), D("alpha")];

	eq(names(sortChildren(set, "alphabetical", nameOf, isDir, timeOf)), ["alpha", "apple.md", "banana.md", "Zeta"], "alphabetical treats files and folders alike, case-insensitive");
	eq(names(sortChildren(set, "alphabeticalReverse", nameOf, isDir, timeOf)), ["Zeta", "banana.md", "apple.md", "alpha"], "reverse alphabetical");
	// byCreatedTime: folders lead (no timestamp) in name order, then files newest-first
	eq(names(sortChildren(set, "byCreatedTime", nameOf, isDir, timeOf)), ["alpha", "Zeta", "banana.md", "apple.md"], "created: folders lead by name, files newest first");
	eq(names(sortChildren(set, "byCreatedTimeReverse", nameOf, isDir, timeOf)), ["alpha", "Zeta", "apple.md", "banana.md"], "created reverse: files oldest first");
	// byModifiedTime uses mtime, a different key: apple (50) is newest, banana (5) oldest
	eq(names(sortChildren(set, "byModifiedTime", nameOf, isDir, timeOf)), ["alpha", "Zeta", "apple.md", "banana.md"], "modified sorts on mtime, not ctime");
	eq(names(sortChildren(set, "somethingNew", nameOf, isDir, timeOf)), ["alpha", "apple.md", "banana.md", "Zeta"], "an unknown order falls back to alphabetical");
	eq(names(sortChildren([], "byCreatedTime", nameOf, isDir, timeOf)), [], "an empty folder is empty");
}

// --- pathDepth (notebook / section / page levels) ---
eq(pathDepth("Research"), 1, "a root folder is a notebook");
eq(pathDepth("Research/Apple"), 2, "a notebook's child is a section");
eq(pathDepth("Research/Apple/Apple iPhone"), 3, "inside a section is page depth");
eq(pathDepth("Research/Apple/Apple iPhone/iPad"), 4, "subpages nest deeper still");
eq(pathDepth("/"), 0, "the vault root is 0");
eq(pathDepth(""), 0, "an empty path is the root");

// --- per-device settings never reach the synced file ---
{
	const s = { recentPages: ["a.md", "b.md"], orders: { X: ["p"] }, showRecent: true };
	eq(withoutDeviceKeys(s), { orders: { X: ["p"] }, showRecent: true }, "the recent list is dropped on its way to disk");
	ok(!("recentPages" in withoutDeviceKeys(s)), "dropped, not blanked: a blank would wipe a device still on the old build");
	eq(s.recentPages, ["a.md", "b.md"], "and the original object is untouched");
	eq(pickDeviceKeys(s), { recentPages: ["a.md", "b.md"] }, "the stash carries only device keys");
	eq(pickDeviceKeys({ orders: {} }), {}, "nothing to stash from settings that have none");
	ok(hasDeviceKeys({ recentPages: [] }), "an empty list still counts as present, so migration runs once");
	ok(!hasDeviceKeys({ orders: {} }), "a file already stripped needs no migration");

	// the overlay puts this device's own list back over a disk-built object
	const fromDisk = { recentPages: [] as string[], showRecent: true };
	eq(overlayDeviceState({ ...fromDisk }, JSON.stringify({ recentPages: ["mine.md"] })), { recentPages: ["mine.md"], showRecent: true }, "the stash lands over the default");
	eq(overlayDeviceState({ ...fromDisk }, null), fromDisk, "no stash yet leaves the object alone");

	// local storage is plain text anything can corrupt; a bad stash costs the
	// list, never a crash in the renderer that maps over it
	eq(overlayDeviceState({ ...fromDisk }, "{not json"), fromDisk, "unparseable stash is ignored");
	eq(overlayDeviceState({ ...fromDisk }, "[1,2]"), fromDisk, "an array stash is ignored");
	eq(overlayDeviceState({ ...fromDisk }, JSON.stringify({ recentPages: "oops" })), fromDisk, "a non-list value is ignored");
	eq(overlayDeviceState({ ...fromDisk }, JSON.stringify({ recentPages: ["ok.md", 7] })), fromDisk, "a list with a non-string in it is ignored");
	eq(overlayDeviceState({ ...fromDisk }, JSON.stringify({ orders: { X: ["p"] } })), fromDisk, "a stash may not smuggle in a synced key");
}
{
	// The whole point: two devices with different recent lists stop fighting.
	// Each keeps its own, and neither publishes it, so the file they share has
	// nothing to disagree about.
	const laptop = { recentPages: ["laptop.md"], orders: { X: ["p"] } };
	const phone = { recentPages: ["phone.md"], orders: { X: ["p"] } };
	eq(withoutDeviceKeys(laptop), withoutDeviceKeys(phone), "the two devices write identical files despite different recents");
	eq(overlayDeviceState(withoutDeviceKeys(laptop) as typeof laptop, JSON.stringify(pickDeviceKeys(phone))).recentPages, ["phone.md"], "each device reads back its own list");
}

// --- mergeForSave (data.json is synced; never clobber another device) ---
{
	// We changed favs; recentPages moved on disk under us. Ours wins for what we
	// touched, disk wins for what we did not.
	const baseline = { favs: ["a"], recent: ["x.md"], width: 240 };
	const ours = { favs: ["a", "b"], recent: ["x.md"], width: 240 };
	const disk = { favs: ["a"], recent: ["y.md"], width: 240 };
	eq(mergeForSave(ours, baseline, disk), { favs: ["a", "b"], recent: ["y.md"], width: 240 }, "our change wins, untouched key takes disk");
}
{
	// THE BUG: a phone holding an old snapshot opens a note (recentPages only).
	// Its save must not carry its stale empty favs over the laptop's seven.
	const phoneBaseline = { favs: [] as string[], recent: ["old.md"] };
	const phoneMemory = { favs: [] as string[], recent: ["tapped.md"] };
	const diskFromLaptop = { favs: ["1", "2", "3", "4", "5", "6", "7"], recent: ["old.md"] };
	eq(
		mergeForSave(phoneMemory, phoneBaseline, diskFromLaptop),
		{ favs: ["1", "2", "3", "4", "5", "6", "7"], recent: ["tapped.md"] },
		"an idle device's save keeps another device's favorites and carries only its own change"
	);
}
{
	// Deliberately clearing a setting is still a change, and must survive.
	const baseline = { favs: ["a", "b"] };
	eq(mergeForSave({ favs: [] as string[] }, baseline, { favs: ["a", "b"] }), { favs: [] }, "an intentional clear is a change and wins");
}
{
	// An older version wrote disk without the key: keep ours, do not reset.
	const baseline = { favs: ["a"], width: 240 };
	const ours = { favs: ["a"], width: 240 };
	eq(mergeForSave(ours, baseline, { width: 300 } as Partial<typeof ours>), { favs: ["a"], width: 300 }, "a key absent from disk keeps ours");
}
eq(mergeForSave({ a: 1 }, { a: 1 }, null), { a: 1 }, "no disk state yet = write ours");
{
	// THE BUG, five devices deep: `orders` is ONE key holding every folder's
	// arrangement. This device drags a page in Phase 1; another device arranged
	// Phase 2 an hour ago and this one has never seen it. Whole-key merge marked
	// `orders` as ours and published a map with no Phase 2 in it, and a folder
	// with no entry silently falls back to the app's own sort.
	const baseline = { orders: { "Phase 1": ["a.md", "b.md"] } };
	const ours = { orders: { "Phase 1": ["b.md", "a.md"] } };
	const disk = { orders: { "Phase 1": ["a.md", "b.md"], "Phase 2": ["x.md", "y.md"] } };
	eq(
		mergeForSave(ours, baseline, disk),
		{ orders: { "Phase 1": ["b.md", "a.md"], "Phase 2": ["x.md", "y.md"] } },
		"one folder's drag publishes that folder, not the whole map"
	);
}
{
	// Reset manual order has to survive too: an entry we deliberately dropped
	// must not come back from the disk copy we started from.
	const baseline = { orders: { A: ["1"], B: ["2"] } };
	const ours = { orders: { A: ["1"] } };
	const disk = { orders: { A: ["1"], B: ["2"] } };
	eq(mergeForSave(ours, baseline, disk), { orders: { A: ["1"] } }, "an order we cleared stays cleared");
}
{
	// Two devices, same folder: one folder loses the race, not the vault.
	const baseline = { orders: { A: ["1", "2"] } };
	const ours = { orders: { A: ["2", "1"] } };
	const disk = { orders: { A: ["1", "2", "3"], B: ["9"] } };
	eq(mergeForSave(ours, baseline, disk), { orders: { A: ["2", "1"], B: ["9"] } }, "a contested folder is ours; the rest is theirs");
}
{
	// An idle device must still not touch a thing.
	const baseline = { orders: { A: ["1"] } };
	eq(
		mergeForSave({ orders: { A: ["1"] } }, baseline, { orders: { A: ["2"] } }),
		{ orders: { A: ["2"] } },
		"we changed nothing, so the disk stands"
	);
}
{
	// Arrays are values, not maps: a list's membership is the thing itself, and
	// merging it entry by entry would resurrect what another device removed.
	const baseline = { hidden: ["A", "B"] };
	eq(mergeForSave({ hidden: ["A"] }, baseline, { hidden: ["A", "B"] }), { hidden: ["A"] }, "an array key still merges whole");
}
{
	// A boot that could not read data.json runs on defaults, baseline included.
	// When the file finally reads, the heal merge must take the whole file back
	// and keep only what the user really did since boot: nothing of a 786-folder
	// orders map may be lost to a transient read failure.
	const bootDefaults = { orders: {} as Record<string, string[]>, layout: false, recent: [] as string[] };
	const sinceBoot = { orders: {}, layout: false, recent: ["tapped.md"] };
	const realFile = { orders: { Research: ["b.md", "a.md"], Meetings: ["z.md"] }, layout: true, recent: ["old.md"] };
	eq(
		mergeForSave(sinceBoot, bootDefaults, realFile),
		{ orders: { Research: ["b.md", "a.md"], Meetings: ["z.md"] }, layout: true, recent: ["tapped.md"] },
		"a failed-boot heal readopts the file wholesale, keeping only real since-boot changes"
	);
}

// --- applySortMode (per-folder forced sort) ---
eq(applySortMode(["Ben.md", "abe.md", "Cal.md"], "az"), ["abe.md", "Ben.md", "Cal.md"], "A to Z ignores case");
eq(applySortMode(["Ben.md", "abe.md", "Cal.md"], "za"), ["Cal.md", "Ben.md", "abe.md"], "Z to A reverses");
eq(applySortMode(["Note 10.md", "Note 2.md"], "az"), ["Note 2.md", "Note 10.md"], "digit runs compare as numbers");
eq(applySortMode(["c", "a"], "manual"), ["c", "a"], "manual leaves the incoming order alone");
eq(applySortMode(["c", "a"], undefined), ["c", "a"], "unset folders are manual");
// a forced sort must beat a stored drag order, not merge with it
eq(applySortMode(applyOrder(["a", "b", "c"], ["c", "b", "a"]), "az"), ["a", "b", "c"], "forced sort overrides a manual order");

// --- applyPins ---
eq(applyPins(["a", "b", "c", "d"], ["c", "a"]), ["c", "a", "b", "d"], "pinned float in pin order");
eq(applyPins(["a", "b"], ["zz"]), ["a", "b"], "stale pins are ignored");
eq(applyPins(["a", "b"], undefined), ["a", "b"], "no pins, no change");

// --- pairPages ---
const it = (name: string, folder = false) => ({ name, folder });
eq(
	pairPages([it("A.md"), it("B.md"), it("B", true), it("C", true), it("D", true), it("x.png")], (f) => f === "C"),
	[
		{ page: "A.md", group: null },
		{ page: "B.md", group: "B" },
		{ page: null, group: "C" },
		{ page: "x.png", group: null },
	],
	"sibling note anchors its folder; inside-note folder is a group; plain folder is skipped"
);
eq(pairPages([it("B", true), it("B.md")], () => false), [{ page: "B.md", group: "B" }], "folder before its note still pairs");
eq(pairPages([it("B", true), it("B.md")], () => true), [{ page: "B.md", group: "B" }], "sibling pairing beats an inside note");

// --- applyOrder ---
const LIVE = ["AI", "Azure", "Team Meetings", "Acme Alpha", "zNew.md"];
eq(applyOrder(LIVE, undefined), LIVE, "no order = untouched");
eq(applyOrder(LIVE, []), LIVE, "empty order = untouched");
eq(
	applyOrder(LIVE, ["Acme Alpha", "AI"]),
	["Acme Alpha", "AI", "Azure", "Team Meetings", "zNew.md"],
	"ranked first, unranked keep their sort at the bottom"
);
eq(
	applyOrder(LIVE, ["Acme Alpha", "AI"], "top"),
	["Azure", "Team Meetings", "zNew.md", "Acme Alpha", "AI"],
	"unranked-at-top placement"
);
eq(
	applyOrder(LIVE, ["Ghost.md", "Azure"]),
	["Azure", "AI", "Team Meetings", "Acme Alpha", "zNew.md"],
	"stale names in the order are ignored"
);
eq(applyOrder(LIVE, ["Ghost.md"]), LIVE, "order with only stale names = untouched");

// --- insertOrder ---
eq(insertOrder(["a", "b", "c"], "c", "b"), ["a", "c", "b"], "drop before a sibling");
eq(insertOrder(["a", "b", "c"], "a", null), ["b", "c", "a"], "drop at the end");
eq(insertOrder(["a", "b", "c"], "a", "a"), ["b", "c", "a"], "before itself degrades to end");
eq(insertOrder(["a", "b", "c"], "a", "ghost"), ["b", "c", "a"], "unknown before-name degrades to end");
eq(insertOrder(["a", "b", "c"], "b", "a"), ["b", "a", "c"], "move to the front");

// --- insertOrderMany (dragging a multi-selection) ---
// one item behaves exactly as insertOrder does, case for case, so a single drag
// can go through this and change nothing
eq(insertOrderMany(["a", "b", "c"], ["c"], "b"), ["a", "c", "b"], "one item: drop before a sibling");
eq(insertOrderMany(["a", "b", "c"], ["a"], null), ["b", "c", "a"], "one item: drop at the end");
eq(insertOrderMany(["a", "b", "c"], ["a"], "a"), ["b", "c", "a"], "one item: before itself degrades to end");
eq(insertOrderMany(["a", "b", "c"], ["a"], "ghost"), ["b", "c", "a"], "one item: unknown before-name degrades to end");
eq(insertOrderMany(["a", "b", "c"], ["b"], "a"), ["b", "a", "c"], "one item: move to the front");
eq(insertOrderMany(["a", "b", "c", "d"], ["a", "c"], "d"), ["b", "a", "c", "d"], "a selection lands as one block");
eq(insertOrderMany(["a", "b", "c", "d"], ["d", "b"], "a"), ["b", "d", "a", "c"], "the block keeps LIST order, not click order");
eq(insertOrderMany(["a", "b", "c", "d"], ["a", "b"], null), ["c", "d", "a", "b"], "a selection dropped at the end");
eq(insertOrderMany(["a", "b", "c"], ["a", "b"], "b"), ["c", "a", "b"], "dropping onto the selection degrades to end");
eq(insertOrderMany(["a", "b"], ["c"], "b"), ["a", "c", "b"], "a name the list has not caught up with still lands");

// --- renameInOrders ---
const O1 = { "/": ["Acme", "Archive"], Acme: ["AI", "Acme Alpha"], "Acme/AI": ["x.md"] };
eq(
	renameInOrders(O1, "Acme/Acme Alpha", "Acme/Alpha", false),
	{ "/": ["Acme", "Archive"], Acme: ["AI", "Alpha"], "Acme/AI": ["x.md"] },
	"file/folder rename in place updates the parent's entry"
);
eq(
	renameInOrders(O1, "Acme", "Nova", true),
	{ "/": ["Nova", "Archive"], Nova: ["AI", "Acme Alpha"], "Nova/AI": ["x.md"] },
	"folder rename re-keys its own and nested orders and its parent entry"
);
eq(
	renameInOrders(O1, "Acme/AI", "Archive/AI", true),
	{ "/": ["Acme", "Archive"], Acme: ["Acme Alpha"], "Archive/AI": ["x.md"] },
	"moving a folder out removes it from the old parent's order and re-keys"
);
eq(
	renameInOrders({ "/": ["a.md", "b.md"] }, "a.md", "sub/a.md", false),
	{ "/": ["b.md"] },
	"moving a file to another folder drops it from the old order"
);

// --- removeFromOrders ---
eq(
	removeFromOrders(O1, "Acme/AI", true),
	{ "/": ["Acme", "Archive"], Acme: ["Acme Alpha"] },
	"deleting a folder drops its subtree orders and its parent entry"
);
eq(
	removeFromOrders({ "/": ["only.md"] }, "only.md", false),
	{},
	"a parent order emptied by a delete is removed entirely"
);
eq(
	removeFromOrders({ Acme: ["AI", "x"] }, "Acme/x", false),
	{ Acme: ["AI"] },
	"deleting a file prunes it from the parent order"
);

// --- path-keyed maps (section colors) ---
eq(
	renamePathKeyed({ Acme: "#D13438", "Acme/AI": "#3D7EE8", Other: "#7BA35A" }, "Acme", "Nova"),
	{ Nova: "#D13438", "Nova/AI": "#3D7EE8", Other: "#7BA35A" },
	"renaming a folder re-keys its color and its descendants' colors"
);
eq(
	removePathKeyed({ Acme: "#D13438", "Acme/AI": "#3D7EE8", Other: "#7BA35A" }, "Acme"),
	{ Other: "#7BA35A" },
	"deleting a folder drops its color subtree"
);

// --- hidden folders ---
eq(
	renameInHidden(["_attachments", "Acme/Old", "Acme/Old/Sub"], "Acme/Old", "Archive/Old"),
	["_attachments", "Archive/Old", "Archive/Old/Sub"],
	"renaming a hidden folder re-keys it and its hidden descendants"
);
eq(
	renameInHidden(["_attachments"], "Other", "Elsewhere"),
	["_attachments"],
	"unrelated renames leave the hidden list alone"
);
eq(
	removeFromHidden(["_attachments", "Acme/Old", "Acme/Old/Sub"], "Acme/Old"),
	["_attachments"],
	"deleting a hidden folder drops it and its hidden subtree"
);
{
	// The reported bug: _attachments was renamed + moved to _resources/attachments
	// OUTSIDE our rename hook, so its old path is stranded. pruneHidden keeps only
	// the paths that still resolve to a folder, clearing the phantom "1 hidden".
	const live = new Set(["_resources/attachments", "Acme/Keep"]);
	eq(
		pruneHidden(["_attachments", "_resources/attachments", "Acme/Keep"], (p) => live.has(p)),
		["_resources/attachments", "Acme/Keep"],
		"pruneHidden drops the stranded old path, keeps folders that still exist"
	);
	eq(
		pruneHidden(["_attachments"], (p) => live.has(p)),
		[],
		"a hidden list of only-missing folders prunes to empty (no phantom count)"
	);
	eq(pruneHidden([], () => true), [], "pruneHidden on an empty list is empty");
}

// --- section pointer follows folder renames/deletes (no ghost sections) ---
eq(renameSection("_attachments", "_attachments", "_resources/attachments"), "_resources/attachments", "the remembered section follows a folder rename");
eq(renameSection("Acme/Old/Sub", "Acme/Old", "Archive/Old"), "Archive/Old/Sub", "a section inside a renamed folder is re-keyed");
eq(renameSection("Other", "Acme/Old", "Archive/Old"), "Other", "an unrelated section path is left alone");
eq(renameSection(":recent:", "Acme/Old", "Archive/Old"), ":recent:", "the Recent sentinel is never touched");
eq(renameSection(null, "a", "b"), null, "a null section stays null");
eq(dropSection("_attachments", "_attachments"), null, "deleting the section's folder drops the pointer");
eq(dropSection("Acme/Old/Sub", "Acme/Old"), null, "deleting an ancestor drops a nested section pointer");
eq(dropSection("Keep", "_attachments"), "Keep", "deleting an unrelated folder leaves the section pointer");
eq(dropSection(":recent:", "_attachments"), ":recent:", "the Recent sentinel survives a delete");

// --- template card metadata stripping ---
eq(
	stripTemplateMeta("---\nicon: 📅\ndescription: Turn meetings into action.\n---\n## Agenda\n- [ ] item\n"),
	"## Agenda\n- [ ] item\n",
	"a frontmatter block of only card keys is removed whole"
);
eq(
	stripTemplateMeta("---\npe-icon: 📅\npe-desc: legacy keys still strip\n---\nBody\n"),
	"Body\n",
	"the original pe-icon/pe-desc aliases are still stripped"
);
eq(
	stripTemplateMeta("---\nicon: ✅\ntags: [work]\nstatus: todo\n---\nBody here\n"),
	"---\ntags: [work]\nstatus: todo\n---\nBody here\n",
	"real frontmatter keys survive; only card keys are dropped"
);
eq(
	stripTemplateMeta("## No frontmatter\njust content\n"),
	"## No frontmatter\njust content\n",
	"a body without frontmatter is returned unchanged"
);
eq(
	stripTemplateMeta("---\ntags: [a]\n---\nkeep it all"),
	"---\ntags: [a]\n---\nkeep it all",
	"a block with no card keys is left intact"
);
eq(
	stripTemplateMeta('---\nfilename: "{{date}} {{name:Meeting Name}}"\nfolders: Meetings\n---\n## Agenda\n'),
	"## Agenda\n",
	"the naming pattern and folder scope never reach the page"
);
eq(
	stripTemplateMeta('---\ndestination: Daily\nunique: day\ndate: "{{date}}"\n---\nBody\n'),
	'---\ndate: "{{date}}"\n---\nBody\n',
	"where a template files its pages and whether it makes one a day are its business, not the page's"
);
eq(
	stripTemplateMeta("---\nfolders:\n  - Meetings\n  - Acme\ntags: [work]\n---\nBody\n"),
	"---\ntags: [work]\n---\nBody\n",
	"a key whose value is an indented list takes its whole block with it"
);
eq(
	stripTemplateMeta("---\nfolders:\n  - Meetings\naliases:\n  - Standup\n---\nBody\n"),
	"---\naliases:\n  - Standup\n---\nBody\n",
	"and stops at the next real key rather than eating the rest"
);

// ---- Recent Pages recency list ----
eq(pushRecent(["a.md", "b.md"], "c.md", 30), ["c.md", "a.md", "b.md"], "new page lands at the front");
eq(pushRecent(["a.md", "b.md"], "b.md", 30), ["b.md", "a.md"], "reopening moves a page to the front without duplicating");
eq(pushRecent(["a.md", "b.md", "c.md"], "d.md", 3), ["d.md", "a.md", "b.md"], "the list caps by dropping the oldest");
eq(
	renameInRecents(["Acme/Alpha.md", "Acme/Sub/Note.md", "Other.md"], "Acme", "Work", true),
	["Work/Alpha.md", "Work/Sub/Note.md", "Other.md"],
	"folder renames rewrite recent paths beneath them"
);
eq(renameInRecents(["a.md"], "a.md", "b.md", false), ["b.md"], "file renames follow");
eq(
	removeFromRecents(["Acme/Alpha.md", "Other.md"], "Acme", true),
	["Other.md"],
	"deleting a folder drops its recents"
);
eq(removeFromRecents(["a.md", "b.md"], "a.md", false), ["b.md"], "deleting a file drops it");

// ---- drillDirection (phone drill navigation) ----
const R = ":recent:";
eq(drillDirection("/", "Acme", R), "push", "root into a folder is a push");
eq(drillDirection("Acme", "Acme/AI", R), "push", "into a child is a push");
eq(drillDirection("Acme/AI", "Acme", R), "pop", "back to the parent is a pop");
eq(drillDirection("Acme", "/", R), "pop", "back to the root is a pop");
eq(drillDirection("Acme", "Azure", R), null, "a sibling jump has no direction");
eq(drillDirection("Acme", "AcmeAlpha", R), null, "a shared name prefix is not ancestry");
eq(drillDirection("/", R, R), "push", "into Recent Pages is a push");
eq(drillDirection(R, "/", R), "pop", "leaving Recent Pages is a pop");
eq(drillDirection("a", "a", R), null, "same section means no move");

// ---- search engine (search.ts) ----
import { VaultIndex, chunkNote, editorMatchRanges, makeSnippet, persistOverdue, tokenize, type DocInput } from "../src/search";

// --- the ceiling on the index-write debounce ---
{
	const MAX = 30_000;
	eq(persistOverdue(1000, null, MAX), false, "nothing waiting is never overdue");
	eq(persistOverdue(1000, 1000, MAX), false, "a change made this instant can wait");
	eq(persistOverdue(30_999, 1000, MAX), false, "and can keep waiting right up to the ceiling");
	eq(persistOverdue(31_000, 1000, MAX), true, "at the ceiling it has waited long enough");
	eq(persistOverdue(500_000, 1000, MAX), true, "and well past it, obviously");

	// The regression this exists for. The OCR sweep asks for a write every 25
	// images; the debounce is 10s and every ask resets it. Walk the sweep at
	// both recognizer speeds and count how many writes actually land.
	const DEBOUNCE = 10_000;
	const sweep = (msPerCheckpoint: number, checkpoints: number) => {
		let dirtySince: number | null = null;
		let lastAsk = 0;
		let writes = 0;
		for (let i = 1; i <= checkpoints; i++) {
			const now = i * msPerCheckpoint;
			// the debounce fires only if nothing asked again within its window
			if (dirtySince != null && now - lastAsk >= DEBOUNCE) {
				writes++;
				dirtySince = null;
			}
			if (dirtySince == null) dirtySince = now;
			if (persistOverdue(now, dirtySince, MAX)) {
				writes++;
				dirtySince = null;
			}
			lastAsk = now;
		}
		return writes;
	};
	// tesseract: 25 images took well over a minute, so the debounce expired
	// between checkpoints and every one of them wrote
	ok(sweep(75_000, 20) >= 19, "at the old recognizer's pace every checkpoint reached disk");
	// power extract: 25 images in under a second. Before the ceiling this was
	// zero writes across the whole sweep, which is the bug.
	const fast = sweep(875, 600);
	ok(fast > 0, "at the new pace the sweep still checkpoints instead of writing nothing");
	// once every MAX_PERSIST_AGE, near enough: 600 checkpoints * 875ms is 525s
	ok(fast >= 15 && fast <= 20, `and does so about every ${MAX / 1000}s (got ${fast} over 525s)`);
}

// --- editorMatchRanges (jump-to-match highlighting) ---
eq(editorMatchRanges("The budget report", ["budget"]), [[4, 10]], "one term, one range at the word");
eq(editorMatchRanges("budget budgets budgeting", ["budget"]).length, 3, "a term lights every occurrence including inflections");
eq(editorMatchRanges("budgeting season", ["budg"]), [[0, 9]], "a prefix term extends over the whole word");
eq(editorMatchRanges("Claude Teams account", ["claude", "teams"]).length, 2, "multiple terms each match");
eq(editorMatchRanges("nothing here", ["budget"]), [], "no match, no ranges");
eq(editorMatchRanges("text", []), [], "no terms, no ranges");
eq(editorMatchRanges("a.b (c)", ["a.b"]).length >= 0, true, "regex-special terms do not throw");

// --- tokenize ---
eq(tokenize("The Budget-Report v2"), ["budget", "report", "v2"], "tokenize lowercases, splits, drops stopwords");
eq(tokenize("a I to"), [], "stopwords and single letters vanish");

// --- chunkNote: line anchors survive frontmatter and wrapping ---
{
	const note = ["---", "type: capture", "---", "intro line", "", "# Alpha", "alpha body", "", "## Beta", "beta body"].join("\n");
	const cs = chunkNote(note);
	eq(
		cs.map((c) => [c.heading, c.text, c.anchor]),
		[
			["", "intro line", 3],
			["Alpha", "alpha body", 5],
			["Beta", "beta body", 8],
		],
		"frontmatter skipped but counted; sections anchor at their heading line"
	);
}
{
	const cs = chunkNote("# Empty\n# Next\nbody");
	eq(
		cs.map((c) => [c.heading, c.text, c.anchor]),
		[
			["Empty", "", 0],
			["Next", "body", 1],
		],
		"a heading with no body still yields a findable chunk"
	);
}
{
	const long = "# Big\n" + Array.from({ length: 40 }, (_, i) => `line ${i} ` + "x".repeat(95)).join("\n");
	const cs = chunkNote(long);
	ok(cs.length > 1, "a long section wraps into several chunks");
	eq(cs[0].anchor, 0, "the first slice anchors at the heading");
	ok(cs[1].anchor > 0 && cs.every((c, i) => i === 0 || c.anchor >= cs[i - 1].anchor), "later slices anchor into the section");
}

// --- the index ---
const doc = (path: string, title: string, body: string, extra: Partial<DocInput> = {}): DocInput => ({
	path,
	title,
	aliases: [],
	tags: [],
	mtime: 0,
	chunks: chunkNote(body),
	...extra,
});
const ix = new VaultIndex();
ix.addDoc(doc("Acme/Meetings/Budget Report.md", "Budget Report", "Quarterly numbers and forecasts."));
ix.addDoc(doc("Acme/Notes/Note B.md", "Note B", "The budget was discussed at length. Alpha beta gamma."));
ix.addDoc(doc("Personal/Note C.md", "Note C", "Nothing relevant here.", { tags: ["budget"] }));
ix.addDoc(doc("Acme/Ledger/Pricing.md", "Pricing", "List prices."));
ix.addDoc(doc("Tools/Power.md", "Power", "The power-tables plugin handles colors."));

{
	const r = ix.search("budget");
	eq(r[0]?.path, "Acme/Meetings/Budget Report.md", "title match outranks body and tag matches");
	ok(r.some((h) => h.path === "Acme/Notes/Note B.md"), "body match is found");
	ok(r.some((h) => h.path === "Personal/Note C.md"), "tag match is found");
}
{
	const r = ix.search("budg");
	ok(r.length >= 3, "prefix matching: 'budg' finds budget docs");
	eq(r[0]?.path, "Acme/Meetings/Budget Report.md", "prefix results keep title-first ranking");
}
eq(ix.search("alpha beta").map((h) => h.path), ["Acme/Notes/Note B.md"], "AND semantics: both words required");
eq(ix.search("alpha zzznope"), [], "a token matching nothing yields no results, predictably");
eq(ix.search('"discussed at length"').map((h) => h.path), ["Acme/Notes/Note B.md"], "quoted phrase matches in order");
eq(ix.search('"length discussed"'), [], "quoted phrase in the wrong order does not match");
eq(ix.search('"power tables"').map((h) => h.path), ["Tools/Power.md"], "phrase crosses a hyphen");

// --- phrase proximity + quoted precision (the "em dash" case) ---
const pix = new VaultIndex();
pix.addDoc(doc("Design/Claude Design.md", "Claude Design", "Do not use em dashes ( - ) in prose."));
pix.addDoc(doc("BI/Reports.md", "Reports", "Embedded reports need a dashboard workspace."));
pix.addDoc(doc("BI/Sys.md", "Sys", "Emails go to the system dashboard for review."));
// A coincidental match with ONE query word ("Embedded" → em*) IN its title: the
// old titleRanges split floated this above the real page. titleAll must drop it.
pix.addDoc(doc("BI/Embedded.md", "Power BI Embedded", "Financials on the dashboard."));
{
	const r = pix.search("em dash").map((h) => h.path);
	eq(r[0], "Design/Claude Design.md", "unquoted: adjacent 'em dash' outranks scattered em*/dash*");
	ok(r.includes("BI/Reports.md"), "unquoted: the scattered match is still found, just lower");
	const emb = pix.search("em dash").find((h) => h.path === "BI/Embedded.md");
	eq(emb?.titleAll, false, "one stray title word (Embedded) is NOT a full title match → In text, not In title");
	eq(pix.search("em dash").find((h) => h.path === "Design/Claude Design.md")?.titleAll, false, "the real page also splits to In text (title is 'Claude Design'), but proximity puts it first");
}
eq(pix.search('"em dash"').map((h) => h.path), ["Design/Claude Design.md"], "quoted phrase is exact: excludes scattered 'embedded ... dashboard'");
eq(pix.search('"em dash"').every((h) => h.path !== "BI/Sys.md"), true, "quoted phrase does not match 'system dashboard' (em is mid-word)");
eq(ix.search("budget", { scope: "Personal" }).map((h) => h.path), ["Personal/Note C.md"], "scope restricts to a folder");
{
	const r = ix.search("budget", { docBoost: (p) => (p === "Personal/Note C.md" ? 50 : 0) });
	eq(r[0]?.path, "Personal/Note C.md", "caller-injected boosts can promote a document");
}
{
	const r = ix.search("ledger");
	eq(r[0]?.path, "Acme/Ledger/Pricing.md", "a note is findable by its folder name");
}
{
	ix.addDoc(doc("Acme/Budget.md", "Budget", "Totals only."));
	const r = ix.search("budget");
	eq(r[0]?.path, "Acme/Budget.md", "exact-title match outranks title-prefix match");
	eq(r[1]?.path, "Acme/Meetings/Budget Report.md", "title-prefix match stays second");
	ix.removeDoc("Acme/Budget.md");
}
{
	const r = ix.search("quarterly");
	ok(r[0]?.snippet != null, "body hits carry a snippet");
	const s = r[0]!.snippet!;
	ok(s.ranges.length > 0, "snippet has highlight ranges");
	ok(/quarterly/i.test(s.text.slice(s.ranges[0][0], s.ranges[0][1])), "the first range covers the matched term");
}
{
	const s = makeSnippet("aaa budget bbb", ["budget"])!;
	eq(s.text.slice(s.ranges[0][0], s.ranges[0][1]), "budget", "makeSnippet ranges align with the text");
}
{
	ix.addDoc({
		path: "Docs/spec.pdf",
		title: "spec",
		aliases: [],
		tags: [],
		mtime: 0,
		chunks: [],
		attach: [{ heading: "p. 3", text: "The flux capacitor spec sheet.", anchor: 3 }],
	});
	const r = ix.search("flux");
	eq(r[0]?.path, "Docs/spec.pdf", "attachment text is searchable");
	eq(r[0]?.kind, "attach", "attachment hits are marked");
	eq(r[0]?.anchor, 3, "attachment hits carry their page anchor");
}
{
	ix.addDoc(doc("Old.md", "Old", "unicorns"));
	ix.addDoc(doc("Old.md", "Old", "dragons"));
	eq(ix.search("unicorns"), [], "re-adding a path replaces its old content");
	eq(ix.search("dragons").map((h) => h.path), ["Old.md"], "…with the new content");
	ix.removeDoc("Old.md");
	eq(ix.search("dragons"), [], "removeDoc drops the document");
}
{
	ix.addDoc(doc("H1.md", "H One", "zebra crossing", { mtime: 1 }));
	ix.addDoc(doc("H2.md", "H Two", "zebra crossing", { mtime: 2 }));
	eq(ix.search("zebra").map((h) => h.path), ["H2.md", "H1.md"], "equal scores tiebreak newest first");
}
eq(ix.search(""), [], "an empty query returns nothing");
eq(ix.search("   "), [], "a blank query returns nothing");

// --- review-pass regressions ---
import { isUnder } from "../src/order";

eq(isUnder("a/b/c.md", "a/b"), true, "a nested file is under its folder");
eq(isUnder("a/bc/d.md", "a/b"), false, "sibling name prefixes are not containment");
eq(isUnder("x.md", "/"), true, "the root holds everything");
eq(isUnder("a/b", "a/b"), true, "a path is under itself");

{
	const ix2 = new VaultIndex();
	ix2.addDoc(doc("Plans/Q3 Roadmap.md", "Q3 Roadmap", "The plan lives here. Roadmap details follow, but q3 sits far away."));
	eq(ix2.search('"q3 roadmap"').map((h) => h.path), ["Plans/Q3 Roadmap.md"], "a quoted phrase can match the title alone");
	ix2.addDoc(doc("Notes/Fmt.md", "Fmt", "budget\n\n> **Report** for the year"));
	eq(ix2.search('"budget report"').map((h) => h.path), ["Notes/Fmt.md"], "a phrase survives markdown decoration between its words");
}
{
	const r = ix.search("budget");
	ok(r[0]!.titleRanges.length > 0, "title matches carry highlight ranges");
	const [s, e] = r[0]!.titleRanges[0];
	ok(/budg/i.test(r[0]!.title.slice(s, e)), "the title range covers the matched word");
}
{
	const ix3 = new VaultIndex();
	ix3.addDoc(doc("U.md", "U", "xylophone practice"));
	ix3.search("xylophone"); // builds the sorted dictionary
	ix3.removeDoc("U.md");
	eq(ix3.search("xylophone"), [], "a removed doc's terms stop matching without a dictionary rebuild");
	ix3.addDoc(doc("V.md", "V", "xylophone lessons"));
	eq(ix3.search("xylophone").map((h) => h.path), ["V.md"], "and the term matches again after re-adding");
}

// --- retrieveChunks: OR-mode RAG retrieval ---
{
	const ix4 = new VaultIndex();
	ix4.addDoc(doc("A.md", "Alpha", "# Plans\nkiwi and mango salad recipes"));
	ix4.addDoc(doc("B.md", "Beta", "mango export tariffs"));
	ix4.addDoc(doc("C.md", "Cherry", "nothing tropical here"));
	const r = ix4.retrieveChunks(["kiwi", "mango", "papaya"], 5);
	ok(r.length === 2, "OR semantics: any term qualifies a chunk, missing terms don't zero it");
	eq(r[0]?.path, "A.md", "the chunk matching more terms scores higher");
	ok(r[0]!.text.includes("kiwi and mango"), "retrieval returns the FULL chunk text, not a snippet");
	eq(ix4.retrieveChunks(["mango"], 5).length, 2, "unscoped retrieval sees every doc");
	eq(ix4.retrieveChunks(["tropical"], 5).length, 1, "single-term retrieval works");
	eq(ix4.retrieveChunks(["nomatch"], 5), [], "no matching terms, no chunks");
	// a title match now reaches the note, but never AS the excerpt: what comes
	// back is the note's own body, which is what an answer can be quoted from
	const byTitle = ix4.retrieveChunks(["alpha"], 5);
	eq(byTitle.map((h) => h.path), ["A.md"], "a title-only term reaches its note");
	ok(byTitle[0]!.text.includes("kiwi and mango"), "and returns the BODY, not the bare title");
	ok(!byTitle.some((h) => h.text.trim() === "Alpha"), "the title chunk itself is still never an excerpt");

	// THE CLICKBAIT CASE: a note whose body shares not one word with its title.
	// Asking by title used to match only the chunk that could never be returned.
	const ix5 = new VaultIndex();
	ix5.addDoc(doc("Y.md", "ChatGPT Offered Me $2m To Keep Quiet", "# Summary\nKokotajlo argues superintelligence arrives this decade"));
	ix5.addDoc(doc("Z.md", "Grocery list", "kiwi mango papaya bananas"));
	const clickbait = ix5.retrieveChunks(["chatgpt", "offered", "2m", "keep", "quiet"], 5);
	eq(clickbait.map((h) => h.path), ["Y.md"], "the note is reachable by its own title");
	ok(clickbait[0]!.text.includes("Kokotajlo"), "and the excerpt is its summary, which is what the answer needs");
	ok(!ix5.retrieveChunks(["kokotajlo"], 5).some((h) => h.path === "Z.md"), "an unrelated note is not dragged in");

	// one title hit must not flood the results with a single note
	const ix6 = new VaultIndex();
	const many = Array.from({ length: 9 }, (_, i) => `# H${i}\nparagraph ${i} about widgets`).join("\n");
	ix6.addDoc(doc("W.md", "Widget compendium", many));
	ix6.addDoc(doc("O.md", "Other", "widgets appear here too"));
	const flood = ix6.retrieveChunks(["widget", "compendium"], 20).filter((h) => h.path === "W.md");
	ok(flood.length <= 3, `a title match lifts at most three of a note's chunks (got ${flood.length})`);
}

// --- page template engine: dates, tokens, names, scoping ---
{
	const NOW = new Date(2026, 6, 28, 14, 5, 9); // Tue 28 July 2026, 14:05:09
	const CTX = { now: NOW, folder: "Meetings", folderPath: "Acme/Meetings", parent: "Acme", vault: "Steve" };

	// formatDate
	eq(formatDate(NOW, "YYYY-MM-DD"), "2026-07-28", "the everyday date format");
	eq(formatDate(NOW, "YY-M-D"), "26-7-28", "unpadded month and day");
	eq(formatDate(NOW, "dddd, D MMMM YYYY"), "Tuesday, 28 July 2026", "long day and month names");
	eq(formatDate(NOW, "ddd MMM"), "Tue Jul", "short day and month names");
	eq(formatDate(NOW, "HH:mm:ss"), "14:05:09", "24-hour time pads");
	eq(formatDate(NOW, "hh:mm a"), "02:05 pm", "12-hour time with a meridiem");
	eq(formatDate(NOW, "[Week of] YYYY"), "Week of 2026", "square brackets pass through unformatted");
	eq(formatDate(NOW, "[YYYY]"), "YYYY", "an escaped token is not a token");

	// renderTokens
	eq(renderTokens("{{date}} standup", CTX), "2026-07-28 standup", "the date token defaults to YYYY-MM-DD");
	eq(renderTokens("{{date:YYYY/MM}}", CTX), "2026/07", "the date token takes a format argument");
	eq(renderTokens("{{ date }}", CTX), "2026-07-28", "whitespace inside the braces is tolerated");
	eq(renderTokens("{{DATE}}", CTX), "2026-07-28", "token names are case-insensitive");
	eq(renderTokens("{{folder}} / {{parent}} / {{vault}}", CTX), "Meetings / Acme / Steve", "folder, parent, and vault tokens");
	eq(renderTokens("{{time}}", CTX), "14:05", "the time token defaults to HH:mm");
	eq(renderTokens("{{name:Meeting Name}}", CTX), "Meeting Name", "an unmarked name token renders its default text");
	eq(renderTokens("{{title}} stays", CTX), "{{title}} stays", "an unknown token is left verbatim, so template prose survives");
	eq(renderTokens("no tokens here", CTX), "no tokens here", "a pattern without tokens is untouched");
	eq(renderBody("# {{date}}\n\n{{folder}} notes\n", CTX), "# 2026-07-28\n\nMeetings notes\n", "bodies share the filename vocabulary");

	// renderBodyAt: where the cursor lands
	{
		const daily = renderBodyAt("```power-desk\n```\n\n## Focus\n- {{cursor}}\n", CTX);
		eq(daily.body, "```power-desk\n```\n\n## Focus\n- \n", "the cursor token leaves no trace in the page");
		eq(daily.cursor, 30, "and reports where it was");
		eq(daily.body.slice(0, daily.cursor!), "```power-desk\n```\n\n## Focus\n- ", "the offset lands after the bullet, clear of the code block that would otherwise show its source");
		eq(renderBodyAt("no marker here\n", CTX), { body: "no marker here\n", cursor: null }, "a template that does not ask gets no cursor");
		const withDate = renderBodyAt("{{date}}\n{{cursor}}x", CTX);
		eq(withDate.cursor, 11, "tokens rendered before the cursor shift its offset");
		eq(withDate.body[withDate.cursor!], "x", "so the offset still points at the right character");
		const afterName = renderBodyAt("{{name:Topic}} {{cursor}}!", CTX);
		eq(afterName.body, "Topic !", "a name token in a body renders as its default text");
		eq(afterName.body[afterName.cursor!], "!", "and its hidden marks do not shift the cursor offset");
		eq(renderBody("keep {{cursor}}clean", CTX), "keep clean", "renderBody drops the token rather than leaking a marker");
	}

	// date math
	eq(renderTokens("{{date+1d}}", CTX), "2026-07-29", "a day forward");
	eq(renderTokens("{{date-1d}}", CTX), "2026-07-27", "a day back");
	eq(renderTokens("{{date-1d:dddd}}", CTX), "Monday", "an offset composes with a format");
	eq(renderTokens("{{date+1w}}", CTX), "2026-08-04", "a week forward crosses the month");
	eq(renderTokens("{{date + 2 d}}", CTX), "2026-07-30", "spaces inside the offset are tolerated");
	eq(renderTokens("{{date+1m}}", CTX), "2026-08-28", "a month forward");
	eq(renderTokens("{{date+1y}}", CTX), "2027-07-28", "a year forward");
	eq(formatDate(shiftDate(new Date(2026, 0, 31), "+1m"), "YYYY-MM-DD"), "2026-02-28", "a month step clamps instead of skidding into March");
	eq(formatDate(shiftDate(new Date(2026, 6, 28), "+0d"), "YYYY-MM-DD"), "2026-07-28", "a zero offset is a no-op");
	eq(formatDate(shiftDate(new Date(2026, 6, 28), "nonsense"), "YYYY-MM-DD"), "2026-07-28", "an unparseable offset changes nothing");
	eq(renderTokens("{{name+1d:X}}", CTX), "X", "the offset is ignored by tokens that have no date in them");

	// {{ask:Question}}: what to collect before the page is made
	{
		eq(askFields("{{ask:Client}}"), [{ question: "Client", fallback: "" }], "one question");
		eq(
			askFields("{{date}} {{ask:Client}}", "# {{ask:Client}}\n{{ask:Project=Untitled}}"),
			[{ question: "Client", fallback: "" }, { question: "Project", fallback: "Untitled" }],
			"filename and body share one dialog, and the same question is only asked once"
		);
		eq(askFields("{{ask: Spaced Out = A Default }}"), [{ question: "Spaced Out", fallback: "A Default" }], "whitespace around the parts is trimmed");
		eq(askFields("{{ask:}}"), [], "a question with no text is not a field");
		eq(askFields("nothing to ask"), [], "a template that asks nothing gets no dialog");
		eq(askFields("{{ASK:Shouty}}"), [{ question: "Shouty", fallback: "" }], "the token is case-insensitive like the others");

		eq(applyAnswers("{{ask:Client}} sync", { Client: "Alpha" }), "Alpha sync", "the answer lands in the text");
		eq(applyAnswers("{{ask:Client}} and {{ask:Client}}", { Client: "Alpha" }), "Alpha and Alpha", "a repeated question reuses its one answer");
		eq(applyAnswers("{{ask:Client=Acme}}", {}), "Acme", "no answer falls back to the token's default");
		eq(applyAnswers("{{ask:Client=Acme}}", { Client: "   " }), "Acme", "and so does an answer of only spaces");
		eq(applyAnswers("{{ask:Client}}", {}), "", "with no default, an unanswered question leaves nothing");
		eq(applyAnswers("{{date}} {{ask:X}}", { X: "y" }), "{{date}} y", "other tokens are left for the renderer");
	}

	// dateKeyIn / uniqueMatch: open today's page instead of making a second one
	eq(dateKeyIn("2026-07-28 Tuesday"), "2026-07-28", "a leading date is found");
	eq(dateKeyIn("Standup 2026-07-28"), "2026-07-28", "so is one in the middle");
	eq(dateKeyIn("2026-13-01 nope"), null, "month 13 is not a date");
	eq(dateKeyIn("no date at all"), null, "and a name without one has none");
	{
		const daily = ["2026-07-27 Monday", "2026-07-28 Tuesday"];
		eq(uniqueMatch("day", daily, "2026-07-28 Tuesday"), "2026-07-28 Tuesday", "today's page is found and opened");
		eq(uniqueMatch("day", daily, "2026-07-29 Wednesday"), null, "tomorrow's does not exist yet, so create it");
		eq(uniqueMatch("day", ["2026-07-28 Tuesday retro"], "2026-07-28 Tuesday"), "2026-07-28 Tuesday retro", "a renamed daily note is still that day");
		eq(uniqueMatch(true, ["Reading list"], "Reading list"), "Reading list", "exact mode matches the whole name");
		eq(uniqueMatch(true, ["Reading list"], "Other"), null, "and only that name");
		eq(uniqueMatch(false, daily, "2026-07-28 Tuesday"), null, "unset means duplicates are fine, as before");
		eq(uniqueMatch(undefined, daily, "2026-07-28 Tuesday"), null, "a template that says nothing behaves as it always did");
		eq(uniqueMatch("day", ["Untitled"], "Untitled"), "Untitled", "day mode falls back to the name when there is no date to match on");
	}

	// rollover: the previous dated page, and what is still unfinished in it
	{
		const week = ["2026-07-24 Friday", "2026-07-27 Monday", "2026-07-28 Tuesday", "Notes"];
		eq(previousDatedName(week, "2026-07-28"), "2026-07-27 Monday", "the page before today");
		eq(previousDatedName(week, "2026-07-27"), "2026-07-24 Friday", "Monday collects Friday, not an empty weekend");
		eq(previousDatedName(week, "2026-07-24"), null, "nothing before the first page");
		eq(previousDatedName(["Notes", "Ideas"], "2026-07-28"), null, "undated pages are not candidates");
		const md = [
			"## Action Items",
			"- [ ] Call Dylan",
			"- [x] Ship the build",
			"  - [ ] Nested follow-up",
			"* [ ] Star bullets count too",
			"- [ ] ",
			"- not a task",
			"Some prose",
		].join("\n");
		eq(
			unfinishedTasks(md),
			["- [ ] Call Dylan", "  - [ ] Nested follow-up", "- [ ] Star bullets count too"],
			"only unchecked tasks carry over, indentation intact, empty ones skipped"
		);
		eq(unfinishedTasks("nothing here"), [], "a note with no tasks rolls nothing over");
		eq(unfinishedTasks("- [X] done"), [], "a capital X is still done");
	}

	// sanitizeFilename
	eq(sanitizeFilename("a/b\\c"), "a-b-c", "path separators become dashes, never folders");
	eq(sanitizeFilename("14:30 sync"), "14.30 sync", "a colon becomes a dot so times stay readable");
	eq(sanitizeFilename('bad *?"<>|#^[] chars'), "bad chars", "characters Obsidian refuses are dropped");
	eq(sanitizeFilename("  padded  out  "), "padded out", "runs of whitespace collapse and the edges are trimmed");
	eq(sanitizeFilename("...dots..."), "dots", "leading and trailing dots go");
	eq(sanitizeFilename("x".repeat(200)).length, 120, "absurd names are capped");

	// renderName: the name plus the range to preselect
	const meeting = renderName("{{date}} {{name:Meeting Name}}", CTX);
	eq(meeting.name, "2026-07-28 Meeting Name", "a dated page name renders end to end");
	eq(meeting.select, { start: 11, end: 23 }, "the editable segment is located in the final name");
	eq(meeting.name.slice(meeting.select!.start, meeting.select!.end), "Meeting Name", "and the range covers exactly the generic part");
	const bare = renderName("{{date}} {{name}}", CTX);
	eq(bare.name, "2026-07-28", "a bare name token leaves nothing to type over");
	eq(bare.select, { start: 10, end: 10 }, "so the caret lands at the end rather than selecting");
	const noName = renderName("{{date}} standup", CTX);
	eq(noName.name, "2026-07-28 standup", "a pattern with no name token still names the page");
	eq(noName.select, null, "and asks for no preselection");
	eq(renderName("", CTX).name, "Untitled", "an empty pattern falls back rather than making a nameless file");
	eq(renderName("{{name:}}", CTX).name, "Untitled", "so does a pattern that renders to nothing");
	const midName = renderName("{{name:Topic}} - {{date}}", CTX);
	eq(midName.name, "Topic - 2026-07-28", "the editable segment can lead the name");
	eq(midName.select, { start: 0, end: 5 }, "and is still found when it does");
	const dirty = renderName("{{date}}/{{name:Q3 Review}}", CTX);
	eq(dirty.name, "2026-07-28-Q3 Review", "sanitising runs before the range is read off");
	eq(dirty.name.slice(dirty.select!.start, dirty.select!.end), "Q3 Review", "so the range survives characters being rewritten");

	// uniqueName
	const taken = (names: string[]) => (n: string) => names.includes(n);
	eq(uniqueName("2026-07-28 Sync", taken([])), "2026-07-28 Sync", "a free name is used as is");
	eq(uniqueName("2026-07-28 Sync", taken(["2026-07-28 Sync"])), "2026-07-28 Sync-2", "two pages the same day suffix rather than clash");
	eq(uniqueName("2026-07-28 Sync", taken(["2026-07-28 Sync", "2026-07-28 Sync-2"])), "2026-07-28 Sync-3", "and keep counting");
	eq(uniqueName("Untitled", taken(["Untitled"]), " ", 1), "Untitled 1", "blank pages keep their old counting");

	// folderScopes
	eq(folderScopes("Meetings"), ["Meetings"], "a single folder");
	eq(folderScopes("Meetings, Acme/Projects"), ["Meetings", "Acme/Projects"], "a comma-separated list");
	eq(folderScopes(["Meetings", "./Research/"]), ["Meetings", "Research"], "a YAML list, with stray slashes tidied");
	eq(folderScopes("Meetings, Meetings"), ["Meetings"], "duplicates collapse");
	eq(folderScopes(undefined), [], "no property, no scopes");
	eq(folderScopes(42), [], "a nonsense value is ignored rather than fatal");
	eq(folderScopes(["ok", 7]), ["ok"], "and a nonsense entry is skipped");

	// templateRank
	eq(templateRank(["Acme/Meetings"], "Acme/Meetings"), 2, "naming the folder exactly ranks highest");
	eq(templateRank(["Acme"], "Acme/Meetings"), 1, "naming an ancestor still matches, one rank down");
	eq(templateRank(["Research"], "Acme/Meetings"), 0, "an unrelated folder does not match");
	eq(templateRank([], "Acme/Meetings"), 0, "a template that claims no folders never outranks one that does");
	eq(templateRank(["Research", "Acme"], "Acme/Meetings"), 1, "the best of several scopes wins");
	eq(templateRank(["Acme/Meet"], "Acme/Meetings"), 0, "a partial name is not a parent folder");
}

// --- pages versus the files filed beside them ---
{
	eq(isAttachmentName("Stijn Hendrikse.md"), false, "a note is a page");
	eq(isAttachmentName("Board.canvas"), false, "so is a canvas");
	eq(isAttachmentName("Customers.base"), false, "and so is a Base");
	eq(isAttachmentName("Notes.MD"), false, "the extension is read whatever its case");
	eq(isAttachmentName("30-60-90.pdf"), true, "a PDF is an attachment");
	eq(isAttachmentName("shot.png"), true, "so is an image");
	eq(isAttachmentName("Rates.xlsx"), true, "and a spreadsheet");
	eq(isAttachmentName("LICENSE"), true, "a file with no extension is not a note either way");
	eq(isAttachmentName("Meeting notes 2026.05.12.md"), false, "only the last dot decides");
	eq(isAttachmentName("Diagram.excalidraw.md"), false, "an Excalidraw drawing is a note and stays");
}

// --- the deploy guard ---
// Two sessions building this plugin at once is enough for the second to
// overwrite the first with an older build, silently. The comparison is where a
// bug would disable the guard without failing anything, so it is pinned here.
{
	const { compareVersions, isDowngrade, versionFromManifest } = require("../deploy-guard.mjs");

	eq(compareVersions("1.89.1", "1.89.0") > 0, true, "a later patch sorts after");
	eq(compareVersions("1.89.0", "1.89.1") < 0, true, "and an earlier one before");
	eq(compareVersions("1.89.1", "1.89.1"), 0, "the same version ties");
	// the whole reason this compares numbers: as strings, "1.9.0" sorts after
	// "1.10.0", which is exactly backwards
	eq(compareVersions("1.10.0", "1.9.0") > 0, true, "10 is a later minor than 9, not an earlier one");
	eq(compareVersions("1.88.10", "1.88.9") > 0, true, "and the same holds for the patch");
	eq(compareVersions("2.0.0", "1.99.99") > 0, true, "a major bump outranks everything under it");
	eq(compareVersions("1.89", "1.89.0"), 0, "a missing part counts as zero");
	eq(compareVersions("", ""), 0, "two unreadable versions tie rather than throwing");

	eq(isDowngrade("1.89.1", "1.88.1"), true, "deploying an older build over a newer one is the collision this catches");
	eq(isDowngrade("1.88.1", "1.89.1"), false, "the ordinary direction is not");
	eq(isDowngrade("1.89.1", "1.89.1"), false, "and neither is redeploying the same version, which is what developing looks like");
	eq(isDowngrade(null, "1.89.1"), false, "a vault with nothing installed has nothing to lose");
	eq(isDowngrade("", "1.89.1"), false, "nor one whose version could not be read");

	eq(versionFromManifest("{ not json"), null, "a manifest too broken to parse names no version");
	eq(versionFromManifest("{}"), null, "and neither does one with no version key");
	eq(versionFromManifest('{"version":"1.2.3"}'), "1.2.3", "otherwise the version is read off it");
	eq(versionFromManifest('{"version":"  "}'), null, "a blank version is no version");
}

// The summary runs last on purpose: a test added below it would print FAILED
// without failing the build.
if (failures) {
	console.error(`\n${failures} test(s) FAILED.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
