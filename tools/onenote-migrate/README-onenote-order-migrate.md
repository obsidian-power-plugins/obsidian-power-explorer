# OneNote → Power Explorer sort-order migration

Mirrors a OneNote notebook's real structure and ordering into an Obsidian
vault that was imported with **obsidian-importer**:

- vault-root folders take the **notebook order**
- section folders take their **section-group order**
- pages take their **true page order**, with subpage folders sitting right
  after their parent page
- subpage groups the importer flattened (a level-2 page with its own
  subpages) are **moved back inside** their parent page's folder, restoring
  OneNote's drill-down — which Power Explorer's pages pane renders with
  expand/collapse

Everything unmatched is left untouched (it just sorts below ranked items),
the OneNote recycle bin is skipped, and only confident matches (≥3 title
hits or ≥50% overlap) take an order. Idempotent: re-running changes nothing.

## Prerequisites

- **OneNote desktop** (the COM API — the Store/web version won't work)
- **Node.js**
- **Power Explorer ≥ 0.7.0** deployed and enabled in the target vault
  (0.7.0 adopts external `data.json` edits live; on older versions, close
  Obsidian while migrating)

## Steps

1. **Export the hierarchy.** Paste into a PowerShell window (read-only; it
   writes one XML file to your Desktop):

   ```powershell
   $on = New-Object -ComObject OneNote.Application
   $xml = ""
   $on.GetHierarchy("", 4, [ref]$xml)
   $xml | Out-File -Encoding utf8 "$env:USERPROFILE\Desktop\onenote-hierarchy.xml"
   ```

   If line 1 errors, you only have the Store version of OneNote.

2. **Dry run** — prints the folder moves and the sort plan, changes nothing:

   ```
   node onenote-order-migrate.cjs "%USERPROFILE%\Desktop\onenote-hierarchy.xml" "D:\Path\To\Vault"
   ```

3. **Apply** — moves the flattened subpage folders, recomputes ranks on the
   moved tree, backs up `data.json` beside itself, writes, prunes stale keys:

   ```
   node onenote-order-migrate.cjs "%USERPROFILE%\Desktop\onenote-hierarchy.xml" "D:\Path\To\Vault" --apply
   ```

4. **Reload Obsidian** (Ctrl+R). Power Explorer 0.7.0+ usually adopts the
   change live, but a reload makes it unambiguous.

## Caveats & recovery

- **Renamed notebook folders stay unranked at the root** (e.g. a vault
  folder `Development` for a notebook named `Programming` can't be matched
  by name). The dry run lists them; drag them into place in Obsidian, or add
  the folder name at the right position in `orders["/"]` in
  `.obsidian/plugins/powerexplorer/data.json`.
- **Order revert**: copy the `data.json.backup-YYYY-MM-DD` written on apply
  back over `data.json` and reload. The **folder moves** are separate — the
  apply output lists every move if you need to reverse one.
- Duplicate page titles within one section may order arbitrarily among
  themselves; attachments travel with their folders, so links keep working.
