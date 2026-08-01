# OneNote to Obsidian Migration Toolkit

Three PowerShell scripts (plus one optional CSS file) that take a OneNote
notebook from "locked in Microsoft's format" to "clean Markdown in an
Obsidian vault." Built and battle-tested on a 15-year, 9-notebook,
2,700+ page migration.

The official Obsidian importer does the actual conversion. These scripts do
everything the importer cannot: they repair OneNote data BEFORE import so
pages do not fail or land in the wrong folders, and they clean up the
Markdown AFTER import so tables, checkboxes, and spacing render correctly.

## What is in this package

| File | When | What it does |
|------|------|--------------|
| Fix-OneNoteNames.ps1 | Before import | Finds and fixes page and section names the importer rejects (trailing spaces or periods, illegal characters like ? / : \| " < >) |
| Analyze-OneNoteHierarchy.ps1 | Before import | Read-only report of subpage structures that confuse the importer (level skips, such as a level 3 page directly under a level 1 page) |
| Clean-ObsidianVault.ps1 | After import | Repairs 11 known importer artifacts across every Markdown file in the vault (details below) |
| onenote-look.css | Optional | Obsidian CSS snippet that restyles the vault closer to OneNote: table header fill, Calibri-friendly spacing, solid bullets |

## Requirements

- Windows with desktop OneNote installed and signed in (the full Win32 app)
- Windows PowerShell 5.1 (the built-in powershell.exe, NOT PowerShell 7;
  OneNote's automation interface is unreliable in 7)
- The OneNote notebooks you want to migrate must be OPEN in desktop OneNote
  (the scripts can only see open notebooks)
- Password-protected sections must be unlocked first
- For the import itself: Obsidian with the official Importer plugin, and a
  PERSONAL Microsoft account (the importer does not support work or school
  accounts)

## The workflow, in order

Every destructive step defaults to a dry run. Nothing is changed until you
add -Fix and confirm. Test on a throwaway notebook first if in doubt.

### Phase 1: Repair OneNote (before importing)

1. Open ALL notebooks you plan to migrate in desktop OneNote.
2. Scan for bad names (changes nothing):

       powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1

3. Review the report, then fix. Test one notebook first if you like
   (-Notebook "Name"), then run everything:

       powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1 -Fix

4. Check the subpage structure (read-only):

       powershell -ExecutionPolicy Bypass -File .\Analyze-OneNoteHierarchy.ps1

   Fix any flagged LEVEL SKIP pages by hand in OneNote: right-click the
   page and Promote Subpage until its indent makes sense. There are
   usually only a handful.

5. Let OneNote FULLY SYNC to the cloud (File > Info > View Sync Status >
   Sync All). The importer reads Microsoft's cloud copy, not your PC.
   Skipping this step means importing the old, broken names.

### Phase 2: Import with the official Obsidian importer

1. In Obsidian, install the "Importer" plugin and choose OneNote.
2. Import into a STAGING vault, not your real one, one notebook at a time.
3. Leave the importer's folder settings at their defaults (changing them
   has caused errors and broken folder structures).
4. Make sure "save already imported notes" is enabled so a pause or crash
   does not create duplicates on resume.
5. Expect heavy rate limiting from Microsoft on big notebooks. The
   importer pauses and retries on its own. A large notebook can take 12+
   hours. Let it run; 0 failed / 0 skipped is the number that matters.
6. After each notebook verifies, move its folder from the staging vault
   into your real vault with File Explorer, and move loose "Exported
   image..." files into one _attachments folder (links are by filename
   and survive the move; verify with a few files first).

### Phase 3: Clean the Markdown (after importing)

1. Dry run first. It prints per-file and total counts and changes nothing:

       powershell -ExecutionPolicy Bypass -File .\Clean-ObsidianVault.ps1 -VaultPath "D:\Path\To\Vault"

2. Review the counts, then apply with backups and a CSV report:

       powershell -ExecutionPolicy Bypass -File .\Clean-ObsidianVault.ps1 -VaultPath "D:\Path\To\Vault" -Fix -BoldToHeadings -BackupDir "D:\VaultBackup" -ReportPath .\cleanup-report.csv

   Close Obsidian while it runs. Reopen afterward and let Sync catch up.

3. Run the dry run once more. It should report zero or near-zero changes.
   That is the proof the pass is complete and the rules are stable.

What the 11 cleanup rules fix:

1. Trailing whitespace at line ends (invisible glue that merges blocks)
2. Missing blank line before tables
3. Missing blank line after tables (formula comment lines stay attached)
4. Missing blank line before headings
5. Runs of 3+ blank lines collapsed
6. OPT-IN (-BoldToHeadings): standalone bold lines become real ## headings
7. The importer's blank first table row: deleted, with the real label row
   promoted into the header position
8. Tables trapped inside bullets (render as raw pipes): lifted out of the
   list as standalone tables
9. Leftover embedded-object placeholders (show as [OBJ]): become line
   breaks inside table cells, spaces elsewhere
10. OneNote To-Do checkboxes imported as literal "- - [x]" text: become
    real clickable Obsidian checkboxes, keeping their checked state
11. Checkbox text inside table cells: dash clutter stripped so the
    "Table Checkbox Renderer" community plugin can make them clickable

Rules never touch fenced code blocks or YAML frontmatter.

## Known limitations (things no script here can fix)

- The official importer only supports ONE level of folder nesting below a
  section. Three-level subpage trees import with the deepest folders
  hoisted up a level. Fix by dragging folders in Obsidian afterward, or
  evaluate the ConvertOneNote2MarkDown tool for a local, deeper-nesting
  alternative.
- Manual page order in OneNote does not survive the trip. Reorder in
  Obsidian afterward (a drag-to-order plugin, or number prefixes).
- Cell fills, text colors, and highlights inside OneNote pages are
  dropped by the importer and are not recoverable.
- Handwritten ink, drawings, and free-floating text boxes convert poorly
  or not at all.

## Safety model

- Fix-OneNoteNames and Clean-ObsidianVault are dry-run by default and
  print exactly what they would change before you commit.
- Clean-ObsidianVault is idempotent: running it twice makes no further
  changes. If a second pass still wants changes, stop and investigate.
- Use -BackupDir on the real cleanup run. Combined with Obsidian Sync
  history and any file backup you already run, that gives multiple ways
  back.
- Test new territory on a throwaway notebook or a copied folder first.

## Version

Toolkit assembled 2026-07-12. Scripts verified on Windows 11, desktop
OneNote (Microsoft 365), Obsidian 1.5+, Windows PowerShell 5.1.
