# Power Explorer

Drag-and-drop manual ordering for Obsidian's file explorer, built to stay fast in huge vaults. Arrange folders and notes in exactly the order you want, and the order sticks.

![The notebook tree on the left with colored notebooks, a section pane in the middle listing its pages, and a page group expanded to show two indented subpages](docs/images/power-explorer.png)

[![Buy me a coffee](docs/images/buy-me-a-coffee.png)](https://buymeacoffee.com/powerplugins)

Notebooks on the left go exactly one folder deep, and clicking a section lists
its pages beside it. **Bramble bed** is a page group: a folder and a note of the
same name, drawn as one row with its subpages folded underneath a chevron
rather than as a folder sitting next to a duplicate note. Recent Pages is
pinned above the tree.

## Why another sorting plugin

The existing manual-sort plugins work by fighting the file explorer's DOM: drag libraries attached per folder, mutation observers watching the whole tree, and full re-sorts on every vault event. That approach falls over somewhere north of 10,000 notes. Power Explorer was built for 20,000+ note vaults and takes the opposite approach:

- **It hooks the sort computation, not the DOM.** The explorer keeps rendering everything itself; Power Explorer only changes the order it hands back for each folder. That hook runs lazily, per rendered folder, so cost scales with what's on screen, never with vault size.
- **Zero idle cost.** No mutation observers, no timers, no per-item listeners. One delegated pointer handler serves the entire tree, and it does nothing until you actually drag.
- **Sparse storage, O(1) lookups.** Only folders you have arranged store anything (a small list of child names). Sorting uses a per-folder rank map with constant-time lookups.

## Use

- **Drag an item and drop it between two siblings** to set its position. The insertion line shows where it will land. The first drag in a folder freezes that folder's current layout as its manual order.
- **Drop onto a folder's middle** to move the item into that folder (it arrives unarranged).
- Dragging between different folders works positionally too: the item is moved and lands exactly where you dropped it.
- New and never-dragged items keep Obsidian's own sort among themselves and appear at the bottom of arranged folders (or the top; see settings).
- Right-click a folder for **Reset manual order**; folders without a manual order follow Obsidian's default sort untouched.
- Press **Escape** during a drag to cancel it.

## Sections layout (notebooks and pages)

Pick anything but **Obsidian default** in the **Desktop layout** setting and the Files pane splits in place, no separate view to hunt for: the native folder tree on the left shows folders only (your sections), and a pages pane on the right lists the selected folder's notes. Click a folder to see its pages; click a page to open it; opening a note from anywhere follows it to its section. The same drag ordering works in both panes and dragging a page onto a folder in the tree moves it there. Drag the divider to resize; big folders render in chunks so even a 13,000-file folder can't stall the pane. Set it back to **Obsidian default** and the stock Files pane returns exactly as it was.

Arrow keys and Enter move through and open pages; **Ctrl/Cmd+click and Shift+click select several pages at once**, and a right-click on the selection offers bulk **open in tabs**, **pin/unpin**, and **delete** (one confirmation for the lot). A modifier-click extends the page you already clicked rather than starting a second selection beside it, so what you see selected is what the menu acts on. Dragging any row of the selection carries the whole thing: the pages land together as one block at the drop point, in the order the list had them, and a name already taken at the destination holds back that one page and no others. A right-click outside the selection drops it, because the menu that opens acts on that row alone. Deleting a selection takes any page groups in it whole (folder and subpages) the same way deleting one does.

### Cut and paste

Dragging is the direct way to move a page and the wrong way to move seven of them into a folder three screens up. **Cut** (right-click → Cut, or Ctrl/Cmd+X) marks the selection and leaves it exactly where it is, dimmed and italic; then go find the destination, however long that takes, and **Paste**: right-click a folder anywhere (the tree, the notebooks pane, the Folders block) for **Paste here**, or right-click a page for **Paste above** / **Paste below** to land at a position in that section's order. Ctrl/Cmd+V pastes below the current row. Escape calls the whole thing off, and the pages have not moved.

Pasting into a folder is the same move as dropping onto one (the pages arrive unranked); pasting above or below a page is the same as dropping between two rows (they land ranked, as one block, in the order the list had them). Page groups travel whole, folder and subpages included, and a name already taken at the destination holds back that one page and says so.

A page group is a folder, so it takes drops like one: the middle of a group row means **inside it**, the edges mean before and after, and its menu offers **Paste inside** between above and below. Filing a page under another page is a drag onto its row, the same gesture as filing it into a folder.

A **plain page takes drops too, by becoming a group.** Drop onto the middle of any page and it gains a folder of its own with the dropped pages inside; its menu offers **Paste inside** for the same thing. The folder is made *beside* the note rather than around it. A folder and a same-named note read as one row either way, and beside means the note never moves, so nothing is renamed or re-linked and the row keeps its place in the order. The zone is the middle fifth only, narrower than the middle a folder gets: this one makes something rather than moving into something that already exists, so it should not be easy to hit while reordering.

### Desktop layouts

The **Desktop layout** setting picks what the left pane shows (each also has a toggle command); it is a view preference only, nothing about ordering or storage changes with it. Drag ordering works in every variant: notebook, section, and folder rows reorder at their edges and nest when dropped on a row's middle, and dragging a page from the right pane onto a notebook or section row moves it there.

- **Full folder tree** (default): the native tree, every level, exactly as before.
- **Notebooks only**: the left pane lists just your root folders, one notebook per row, with a vault row on top so loose root notes stay reachable. The right pane picks up the whole remaining hierarchy: the selected folder's subfolders sit above its pages, clicking one steps deeper, and a back row steps out.
- **Notebooks and sections**: the left pane goes exactly one folder deep. Each notebook expands with a chevron (or a double-click anywhere on its row) to show its sections; clicking a section shows its pages on the right. Anything deeper than a section lives in the right pane: subpage groups expand in place among the pages (their arrows hang in a gutter so folder and page names align), plain subfolders show as rows above them, and a back row appears once you step below the section level.
- **Drill (one level at a time)**: the phone navigator with desktop-compact rows; see On phones below.

### Page groups

A subfolder containing a note with the folder's own name (the folder-note pattern, which notebook imports produce naturally) renders in the pages pane as a **page group**: the folder note is the page, with its sibling notes indented beneath a collapsible chevron, like subpages under a parent page. Groups start expanded, participate in filtering, and drag like everything else. The chevron toggles a group, and so does a **double-click anywhere on its row**. The first click of the double opens the page as always, so this takes nothing away, it just stops the chevron being the only target. What you shut stays shut through a reload, a restart, and a rename or move of the folder; only the exceptions are stored, so a group you have never touched arrives expanded and a deleted folder leaves nothing behind: the group row reorders the folder among the section's pages, subpages reorder within the group, and positional drops move notes in and out.

A group's two halves stay together when you rename either one. Retitling the page from the editor renames its folder to match, and renaming the folder renames the page: rename one alone and the pairing would dissolve, dropping the row out of the pages list and putting the folder back in the Folders block as though it had never been a page. This rides the vault's own rename event, so it holds whatever did the renaming (this pane, the explorer, the inline title, another plugin) and covers both shapes (the note inside the folder, and the note beside it). A name already taken is left alone, with a notice.

A folder without that note has nothing to anchor a row, so it can only appear in the **Folders** block above the section header, outside the order that ranks everything else there. New folders made in this pane arrive holding their page; for the ones that did not (made in Obsidian's own explorer, imported, or older than the convention), right-click → **Turn into a page** writes the folder note, using the folder's page template, and the row drops into the pages list at the position the folder already held. The item appears only on folders that can take one: below section level, with the folder-note setting on, and with nothing anchoring them yet.

A notebook import leaves these in drifts, so they convert in bulk too. Right-click any folder for **Turn N folders inside into pages**, or run the command **Turn plain folders into pages (whole vault)**. Both count first and ask once, then write one note per folder. Nothing is deleted, renamed, or moved, and hidden folders and the attachment folder are left out.

### Section colors

Right-click a folder → **Section color** for an accent bar on its row (curated palette, readable in light and dark). Colors are painted by one generated stylesheet, so they cost nothing at any vault size, live in plugin settings, and follow renames.

Root folders count as notebooks: the right-click menu reads **Notebook color** there, and a colored notebook draws its whole cover in that color in the notebooks pane and the phone drill. A notebook with a custom emoji icon keeps the emoji and shows the color as an accent bar instead.

### Recent Pages

A pinned **Recent Pages** entry sits above the folder tree. Click it and the pages pane shows your last-opened notes, newest first, each with its section name for context; click to reopen, right-click for **Go to section** or **Remove from Recent**. The list stays put while you click through it (opening a recent page doesn't yank you to its section), holds the last 30 notes, survives restarts, follows renames, and drops deleted files. Recency is tracked even while the entry is toggled off (settings), so it's warm the moment you turn it on. The list is a view, not a folder: no dragging, no New page.

### Reveal active page

The locate button (crosshair icon) in the pages pane header jumps to the note you are editing: it switches to that note's section, expands its notebook and any page groups on the way, scrolls the row into view, and flashes it, in every layout including the phone drill. The same button sits on the explorer's own header, standing in for the separate Reveal Active File Button plugin, and the command **Reveal active page** takes a hotkey. In the full-tree layout it also runs Obsidian's native reveal so the tree expands alongside.

### One tab per page

Clicking a page steps to the tab it is already open in, wherever that tab is, rather than opening a second copy of it in the tab you happen to be standing in. Two copies of a note is two scroll positions and two undo histories, with your edits landing in whichever one you looked at last. The same holds for Recent Pages, for search results, and for Enter on a selected row. Right-click a page for **Open in new tab** when a second copy is what you actually want, and Ctrl/Cmd+Enter still opens a search hit in a new tab. A note you deliberately popped out into its own window is left where it is, as are sidebar previews.

### The explorer toolbar

**Buttons in the explorer toolbar** in settings is the whole row, the way the ribbon's own configuration is: **add any command** from the command palette, turn off the ones you do not use, and **drag them into the order you want** by the grip at the left. Obsidian's own buttons are in the list too.

The list is read from the live pane rather than kept in the plugin, so whatever your Obsidian puts there is what you are offered, and a button a future version adds appears in it rather than being invisible to it. Obsidian's buttons are recognized by their icon and never by their name, because names are translated. A button that cannot be recognized is one that is never touched, so the worst an Obsidian update can do is hand you a button back; it can never hide or move the wrong one.

An added command takes the icon it registered, or failing that the one its own plugin put on the ribbon under the same name (most plugins set an icon there and not on the command, so without that step every added button would look the same). Press the icon on its row to choose any other.

Only the exceptions are stored, so an untouched toolbar stores nothing and looks exactly as Obsidian drew it. A button with no stored position stays at the end rather than being sorted somewhere you would not look. The collapse button counts as one button even though it swaps its own icon as it toggles, so hiding it stays hidden when pressed. Hidden buttons keep working as commands and hotkeys; only the icon goes, and an added command whose plugin is off simply does not draw until it comes back. There is a reset beside the heading.

### On phones

On a phone the sections layout becomes drill navigation: one screen at a time. You see the current folder's subfolders as big tappable rows with its pages beneath; tap a folder to step into it, moving through notebooks, sections, and pages one level at a time. The row at the top names the folder you are in and steps back out one level when tapped. The top-level screen lists your notebooks only (its pages block appears just when loose root notes exist), and Recent Pages sits above them. Rows, buttons, and the filter box are sized for fingers, and a long press on any row opens its menu (rename, move, pin, delete, and the rest). Obsidian's own explorer buttons are tucked away on phones to save space; a setting brings them back. Groups, filtering, and New page all work; drag reordering stays a desktop affair for now. Tablets keep the two-pane layout, and nothing changes on desktop by default.

Like the drill enough to use it with a mouse? Pick **Drill** as the Desktop layout (settings or command) and the Files pane steps one level at a time everywhere, with desktop-compact rows and Obsidian's explorer buttons kept in place.

### Page templates

Right-click a folder and choose **Set page template…** to point it at a note; from then on, every new page created in that folder (via the pages-pane **+ New page**) starts as a copy of that template. Templates are inherited: set one on a notebook and every section under it uses it, unless a section sets its own. The mapping lives in plugin settings and follows the template note and the folders through renames and moves.

A template is configured by its own properties, none of which are copied into the pages it makes:

| Property | What it does |
| --- | --- |
| `icon` | The gallery card's icon: an emoji, a Lucide icon name, or a vault image. |
| `description` | The one-line blurb under the card's title. |
| `filename` | What to name the pages it makes. See the tokens below. |
| `folders` | Which folders it belongs to, comma-separated or as a list. Subfolders count. |
| `destination` | One folder to file its pages in, wherever you pressed **+**. Created if missing. |
| `unique` | `day` opens today's page instead of making a second one; `true` matches the whole name. |
| `ask` | `false` skips this template's questions; `true` asks even with the setting off. |

Every template also gets its own command, named **New page: <template>**, so the ones you reach for daily can take a hotkey and skip the gallery entirely. The command puts the page in the template's `destination` when it sets one, and otherwise in the folder you are looking at. The list keeps itself current as templates come and go.

### Naming pages

Give a template a `filename` and its pages arrive already named. A meeting template with `filename: "{{date}} {{name:Meeting Name}}"` makes `2026-07-28 Meeting Name` and opens it with just `Meeting Name` selected, so you type the meeting's name over it and the date stays put. Two pages the same day get `-2`, `-3`, and so on rather than clashing.

The same tokens work in a template's body, so a note can open with the date it was made:

| Token | Gives |
| --- | --- |
| `{{date}}`, `{{date:YYYY-MM}}` | Today, `YYYY-MM-DD` unless you pass a format. |
| `{{date+1d}}`, `{{date-1w:dddd}}` | Shifted by `d`, `w`, `m`, or `y`. Month steps clamp, so the 31st plus a month is the 28th, not March. |
| `{{time}}`, `{{time:HH-mm}}` | The time now, `HH:mm` unless you pass a format. |
| `{{name:Text}}` | The generic part, preselected when the page opens. |
| `{{cursor}}` | Body only: where to leave the cursor. |
| `{{ask:Question}}` | Asked in a dialog before the page is made. `{{ask:Client=Acme}}` gives it a default. |
| `{{rollover}}` | Body only: unfinished tasks from the previous dated page. |
| `{{folder}}`, `{{parent}}`, `{{vault}}` | Where the page is being made. |

Date offsets are what make a daily note navigable: `← [[{{date-1d}} {{date-1d:dddd}}]]` links yesterday without you knowing what yesterday was.

`{{ask:Question}}` is opt-in three times over, so nothing ever asks you something unexpectedly. A template is only asked about if it *uses* the token; **Ask for template answers** in settings turns prompting off across the vault; and a single template overrules that either way with an `ask` property of `true` or `false`. When prompting is off the tokens still fill in, from their own defaults, so `{{ask:…}}` never survives into a finished page. Answers can land in the filename as well as the body, one dialog covers both, the same question asked twice is one field, and Enter walks the fields and creates from the last one. Cancelling makes no page at all.

`{{rollover}}` copies the unchecked tasks out of the most recent *earlier* dated page in the same folder, so Monday collects Friday's leftovers rather than finding an empty weekend. It only ever reads that page: work moves forward by being copied, and nothing edits a note you are not looking at. Give it a fallback for quiet days with `{{rollover:Nothing carried over}}`.

`{{cursor}}` earns its keep in Live Preview, where the cursor decides what renders. A daily note whose body opens with a code block shows that block's raw source until you click away, because the cursor is sitting inside it. Put `{{cursor}}` under the heading you actually write beneath and the page renders right the moment it opens.

A page whose name is fully decided (a daily note called `2026-07-28 Tuesday`, with no `{{name}}` in its pattern) opens ready to write in rather than in rename mode, so a stray keystroke cannot cost it its name.

Formats take `YYYY YY MMMM MMM MM M dddd ddd DD D HH hh mm ss A a`, and `[text in brackets]` passes through unformatted. Anything else in braces is left alone, so a cheat-sheet note that mentions `{{title}}` as prose survives being used as a template. Templates that set no `filename` fall back to the **Page name** setting, and if that is empty too, to plain `Untitled`. One YAML catch: a pattern that starts with a brace needs quotes around it, or the properties editor reads it as a list.

### Which templates a folder offers

Templates sort themselves to the top of the gallery in the folders they claim in `folders`, so adding a page in Meetings puts your meeting templates first. Nothing is ever hidden: the rest of the gallery is still below, and the search box spans all of them. To override a folder by hand, right-click it and choose **Templates for this folder…**, then tick the ones it should offer. A hand-set shortlist wins over what the templates claim, and subfolders inherit it until one sets its own.

## Hidden folders

Right-click any folder and choose **Hide folder** to tuck it out of the tree, made for attachment dumps and archives you never browse. Hidden folders are filtered inside the same per-folder sort hook, so hiding costs nothing at any vault size, and the list lives in plugin settings (never in your notes). To peek, run **Show/hide hidden folders** (command) or click the eye button in the pages pane header; showing is per session, so a peek can never quietly become permanent. Unhide from the folder's right-click menu while shown, or from the list in settings. Hidden folders keep their manual position: reordering their siblings while they're hidden won't cost them their spot.

## Search everywhere

One box, zero ceremony: click the **ribbon search icon** or run **Search everywhere** (a command; bind a hotkey like Ctrl+E for the full muscle memory) and just type. Results appear as you type, every word must match, and matching is **word-prefix**: "budg" finds budget, budgets, and budgeting. Nothing fuzzy, so a result always visibly contains what you typed. Wrap words in "quotes" to require an exact phrase (hyphens and line breaks between the words still count).

Ranking follows your spatial memory. Exact and prefix title matches come first; your recent pages, pinned notes, manually ordered notes, and the section you are browsing all get a lift; everything else lands by plain relevance, newest first on ties. Matches in a page **title** are split out above matches in the body text ("In title" / "In text"), and within each, results group under notebook › section headers so you recognize a hit by where it lives. The **Titles** switch in the search box collapses every result to a clean list of page names (on by default); flip it off to see a body-text snippet under each. Enter opens the note, Ctrl+Enter opens a new tab, and Tab cycles the scope chips (Everywhere, the current notebook, the current section); the scope choice sticks between searches. An empty query lists your recent pages, so the modal is useful the moment it opens.

When you open a result, Power Explorer **highlights your search terms right in the note and scrolls to the nearest match**, so you land on the passage, not just the page. The highlight fades on its own and clears the moment you start editing.

Matches cover titles, aliases, headings, body text, tags, and folder names. With **Search PDF text** on, the text layer of PDFs is indexed too, and a PDF hit opens the file at its page. The index builds in the background on first launch (a few seconds per few thousand notes, progress in the status bar), keeps itself current as you edit, rename, and delete, and is cached in the plugin folder for instant warm starts. Folders you never want searched go in **Folders search skips**.

### Images are searchable too

The other half of the search magic: text inside screenshots. With **Search image text (OCR)** on and the [Power Extract](https://github.com/obsidian-power-plugins/power-extract) companion plugin installed, Power Explorer reads every image in the background exactly once (progress in the status bar; the sweep resumes where it left off if you quit) and caches the text by file. From then on, searching finds words inside your screenshots, and a hit opens the note that embeds the image, scrolled right to it. Images nothing embeds show up as their own results with a type badge. Without it, everything else works and a one-time notice tells you how many images are waiting.

### Filtering a section by content

The pages pane's filter box now matches inside notes, not just names, using the same word-prefix rules, scoped to the section you are looking at. That is "search this section" in the place your hands expect it.

### Ask AI (with Power Assistant)

When the companion Power Assistant plugin is installed, an **Ask AI** chip appears in the search modal. Click it (or Tab into it), type a question, press Enter: Claude answers from your own notes with clickable [[citations]], retrieving through this same index, so PDF pages and OCR'd screenshots inform answers too. Tab returns to plain search.

## Settings

- **Drag to reorder**: master toggle (also a command, assignable to a hotkey).
- **Unarranged items go**: bottom (default) or top of arranged folders.
- **Clear all**: remove every stored manual order.
- **Search everywhere**: the vault-wide search index and modal (on by default).
- **Search PDF text**: index PDF text layers; hits open the PDF at the page.
- **Search image text (OCR)**: index text inside images via the Power Extract plugin; hits open the embedding note at the image.
- **Folders search skips**: comma-separated folder paths the index ignores.

## Coming from OneNote

The [OneNote to Obsidian Migration Toolkit](https://github.com/obsidian-power-plugins/onenote-to-obsidian) is a companion set of scripts for notebook imports. It repairs the page and section names Obsidian's official importer rejects, cleans up importer artifacts across the imported Markdown afterwards (tables, checkboxes, spacing, stray placeholders), and restores the notebook, section, and page order the importer drops, writing it straight into Power Explorer's own order.

Imported notebooks are also where page groups come from: the folder-note pattern the importer produces renders here as an expandable group in the pages pane, so a OneNote page with subpages arrives looking like one.

## Compatibility notes

- Disable other sorting plugins (Flexplorer / Manual Sorting, Custom File Explorer sorting, Bartender) while using Power Explorer; two plugins overriding the same sort will fight.
- The manual order is stored in the plugin's settings and syncs with your vault when community plugin folders sync (Obsidian Sync's "Installed community plugins", or any file-level sync).
- Ordering internals are feature-detected: if a future Obsidian version changes them, the explorer falls back to its default sort rather than breaking.

## Build from source

```
npm install
npm run build     # type-check + bundle main.js
npm test          # pure-logic unit tests (Node)
npm run deploy    # build and copy into every local vault
```

## Support

Power Explorer is built and maintained by one person. If it earns a place in your
daily vault, you can [buy me a coffee](https://buymeacoffee.com/powerplugins).
Nothing in the plugin is held back either way.
