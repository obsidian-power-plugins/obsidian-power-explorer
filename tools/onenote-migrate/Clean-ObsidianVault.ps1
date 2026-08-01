<#
.SYNOPSIS
    Cleans up OneNote-import artifacts in Obsidian Markdown files.
    DRY-RUN by default - reports what it WOULD change. Use -Fix to apply.

.DESCRIPTION
    Fixes, in every .md file (OUTSIDE code blocks and YAML frontmatter):
      1. Trailing spaces/tabs at line ends (invisible "glue" between blocks)
      2. Missing blank line BEFORE a table
      3. Missing blank line AFTER a table
      4. Missing blank line before headings (#, ##, ...)
      5. Collapses 3+ consecutive blank lines down to one
      6. OPT-IN (-BoldToHeadings): converts standalone bold lines
         (e.g. **SLS vs Starship**) into ## headings
      7. Importer's blank first table row: deletes the empty header row and
         promotes the real label row (e.g. **Service** | **Songs** | ...)
         into the header position, removing its redundant bold markers
      8. Tables trapped inside bullets (first row welded to the bullet
         marker, so Obsidian renders raw pipes instead of a table):
         lifts the table out of the list as its own block and applies
         the same header repair as rule 7
      9. OneNote's leftover embedded-object placeholders (show as [OBJ]):
         replaced with <br> inside table rows, a space elsewhere
     10. OneNote To-Do checkboxes imported as literal text
         ("- - [x] Item") become real, clickable Obsidian checkboxes
         ("- [x] Item"), preserving checked/unchecked state
     11. Checkbox text inside TABLE cells: strips doubled-dash clutter
         ("- - [x]" -> "[x]", "1. - [ ]" -> "1. [ ]"). Pair with the
         "Table Checkbox Renderer" community plugin to make these
         clickable - plain Markdown cannot render checkboxes in tables.

    Never touches: fenced code blocks (``` or ~~~), YAML frontmatter,
    files in .obsidian or .trash folders.

.USAGE
    # 1. Dry run (changes nothing, prints a report):
    powershell -ExecutionPolicy Bypass -File .\Clean-ObsidianVault.ps1 -VaultPath "D:\Obsidian\Import-Staging"

    # 2. Apply fixes, with backups of every modified file:
    powershell -ExecutionPolicy Bypass -File .\Clean-ObsidianVault.ps1 -VaultPath "D:\Obsidian\Import-Staging" -Fix -BackupDir "D:\VaultBackup"

    # 3. Also convert standalone bold lines to headings:
    powershell -ExecutionPolicy Bypass -File .\Clean-ObsidianVault.ps1 -VaultPath "..." -Fix -BoldToHeadings

    # 4. Save the full report to CSV:
    powershell -ExecutionPolicy Bypass -File .\Clean-ObsidianVault.ps1 -VaultPath "..." -ReportPath .\cleanup-report.csv

.NOTES
    - Test on a COPY of the vault first (open the copy in Obsidian to verify).
    - Removing trailing double-spaces is invisible in Obsidian's default
      config. If you enabled "Strict line breaks" in Settings > Editor,
      those double-spaces are meaningful line breaks - skip this cleanup.
    - Works in Windows PowerShell 5.1.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$VaultPath,
    [switch]$Fix,
    [switch]$BoldToHeadings,
    [string]$BackupDir = "",
    [string]$ReportPath = ""
)

if (-not (Test-Path -LiteralPath $VaultPath)) {
    Write-Host "ERROR: Vault path not found: $VaultPath" -ForegroundColor Red
    exit 1
}
$VaultPath = (Resolve-Path -LiteralPath $VaultPath).Path

$files = Get-ChildItem -LiteralPath $VaultPath -Recurse -Filter *.md -File | Where-Object {
    $_.FullName -notmatch '\\\.obsidian\\' -and $_.FullName -notmatch '\\\.trash\\'
}
Write-Host ("Scanning {0} Markdown files under {1}" -f $files.Count, $VaultPath) -ForegroundColor Cyan
if (-not $Fix) { Write-Host 'DRY RUN - nothing will be modified.' -ForegroundColor Yellow }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$results   = New-Object System.Collections.Generic.List[object]
$changedCount = 0

foreach ($f in $files) {
    $raw = [System.IO.File]::ReadAllText($f.FullName)
    if ([string]::IsNullOrEmpty($raw)) { continue }

    $eol   = "`n"
    if ($raw -match "`r`n") { $eol = "`r`n" }
    $lines = $raw -split "`r?`n"

    $cTrail = 0; $cTblBefore = 0; $cTblAfter = 0; $cHead = 0; $cCollapse = 0; $cBold = 0; $cHdrFix = 0; $cNestTbl = 0; $cObj = 0; $cChk = 0; $cTblChk = 0
    $out    = New-Object System.Collections.Generic.List[string]
    $inCode = $false
    $inFM   = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        # --- YAML frontmatter: pass through untouched ---
        if ($i -eq 0 -and $line.Trim() -eq '---') { $inFM = $true; $out.Add($line); continue }
        if ($inFM) {
            $out.Add($line)
            if ($line.Trim() -eq '---') { $inFM = $false }
            continue
        }

        # --- Fenced code blocks: pass through untouched ---
        if ($line -match '^\s*(```|~~~)') {
            $inCode = -not $inCode
            $out.Add($line)
            continue
        }
        if ($inCode) { $out.Add($line); continue }

        # Rule 7: importer's blank table header row.
        # Fingerprint: an all-empty table row, then a separator row (---),
        # then a real table row. Fix: drop the empty row, promote the real
        # row into the header slot, and unbold its cells.
        $sepPattern = '^\s*\|(\s*:?-+:?\s*\|)+\s*$'

        # Rule 8: table trapped inside a bullet. The importer put row 1 on the
        # bullet line itself, so Obsidian sees bullet text, not a table.
        # Fix: lift the whole table out of the list as a standalone block.
        if ($line -match '^\s*[-*+]\s*\|.*\|\s*$') {
            $tbl = New-Object System.Collections.Generic.List[string]
            $tbl.Add(($line -replace '^\s*[-*+]\s*', ''))
            $j = $i + 1
            while ($j -lt $lines.Count -and $lines[$j] -match '^\s*\|.*\|\s*$') {
                $tbl.Add($lines[$j].Trim())
                $j++
            }
            $hasSep = $false
            foreach ($t in $tbl) { if ($t -match $sepPattern) { $hasSep = $true; break } }

            if ($hasSep -and $tbl.Count -ge 2) {
                # drop an all-empty first row (importer artifact)
                if ($tbl[0] -match '^\s*\|(\s*\|)+\s*$') { $tbl.RemoveAt(0) }
                # if the separator now leads, promote the next row to header
                if ($tbl.Count -ge 2 -and $tbl[0] -match $sepPattern -and $tbl[1] -notmatch $sepPattern) {
                    $hdr   = $tbl[1]
                    $cells = ($hdr.Trim() -replace '^\|', '' -replace '\|$', '') -split '\|'
                    $clean = foreach ($c in $cells) {
                        $t2 = $c.Trim()
                        if ($t2 -match '^\*\*(.+)\*\*$') { $Matches[1] } else { $t2 }
                    }
                    $hdr = '| ' + ($clean -join ' | ') + ' |'
                    $sep = $tbl[0]
                    $tbl.RemoveAt(1)
                    $tbl.RemoveAt(0)
                    $tbl.Insert(0, $sep)
                    $tbl.Insert(0, $hdr)
                }
                if ($out.Count -gt 0 -and $out[$out.Count - 1].Trim() -ne '') { $out.Add('') }
                foreach ($t in $tbl) { $out.Add(($t -replace '[ \t]+$', '')) }
                $i = $j - 1          # skip the lines we consumed
                $cNestTbl++
                continue
            }
            # no separator found -> not actually a table; fall through untouched
        }

        if ($line -match '^\s*\|(\s*\|)+\s*$' -and
            ($i + 2) -lt $lines.Count -and
            $lines[$i + 1] -match $sepPattern -and
            $lines[$i + 2] -match '^\s*\|' -and
            $lines[$i + 2] -notmatch $sepPattern) {

            $hdr   = $lines[$i + 2] -replace '[ \t]+$', ''
            $cells = ($hdr.Trim() -replace '^\|', '' -replace '\|$', '') -split '\|'
            $clean = foreach ($c in $cells) {
                $t = $c.Trim()
                if ($t -match '^\*\*(.+)\*\*$') { $Matches[1] } else { $t }
            }
            $hdr = '| ' + ($clean -join ' | ') + ' |'

            # keep the blank-line-before-table rule for the promoted header
            $prevLine = ''
            if ($out.Count -gt 0) { $prevLine = $out[$out.Count - 1] }
            if ($out.Count -gt 0 -and $prevLine.Trim() -ne '' -and $prevLine -notmatch '^\s*\|') {
                $out.Add(''); $cTblBefore++
            }

            $out.Add($hdr)
            $out.Add(($lines[$i + 1] -replace '[ \t]+$', ''))
            $i += 2          # skip the separator and the promoted row
            $cHdrFix++
            continue
        }

        # Rule 9: OneNote object-placeholder characters (render as [OBJ]).
        # Runs BEFORE the trailing-whitespace rule so a placeholder at the
        # end of a line cannot leave a fresh trailing space behind.
        $objCount = ([regex]::Matches($line, '\uFFFC')).Count
        if ($objCount -gt 0) {
            if ($line -match '^\s*\|') { $line = $line -replace '\uFFFC', '<br>' }
            else                       { $line = $line -replace '\uFFFC', ' ' }
            $cObj += $objCount
        }

        # Rule 1: strip trailing whitespace
        $trimmed = $line -replace '[ \t]+$', ''
        if ($trimmed -ne $line) { $cTrail++ }
        $line = $trimmed

        # Rule 10: OneNote To-Do checkboxes imported as literal text.
        # "- - [x] Item" -> "- [x] Item"  (a real, clickable checkbox;
        # keeps the original checked/unchecked state and indentation)
        if ($line -match '^(\s*)-\s+-\s+\[([ xX])\]\s*(.*)$') {
            $line = $Matches[1] + '- [' + $Matches[2] + '] ' + $Matches[3]
            $cChk++
        }

        # Rule 11: checkbox text inside TABLE cells. Strips doubled-dash
        # clutter so cells read cleanly; the Table Checkbox Renderer
        # plugin can then make them clickable.
        if ($line -match '^\s*\|' -and $line -match '\[[ xX]\]') {
            $n = ([regex]::Matches($line, '-\s+-\s+\[[ xX]\]|\d+\.\s+-\s+\[[ xX]\]')).Count
            if ($n -gt 0) {
                $line = $line -replace '-\s+-\s+(\[[ xX]\])', '$1'
                $line = $line -replace '(\d+\.)\s+-\s+(\[[ xX]\])', '$1 $2'
                $cTblChk += $n
            }
        }

        # Rule 6 (opt-in): standalone bold line -> heading
        if ($BoldToHeadings -and $line.Length -le 80 -and $line -match '^\*\*([^*].*?)\*\*$') {
            $line = '## ' + $Matches[1]
            $cBold++
        }

        $isBlank   = ($line.Trim() -eq '')
        $isTable   = ($line -match '^\s*\|')
        $isHeading = ($line -match '^#{1,6}\s')

        $prev        = ''
        if ($out.Count -gt 0) { $prev = $out[$out.Count - 1] }
        $prevIsBlank = ($prev.Trim() -eq '')
        $prevIsTable = ($prev -match '^\s*\|')

        # Rule 2: blank line before a table
        if ($isTable -and $out.Count -gt 0 -and -not $prevIsBlank -and -not $prevIsTable) {
            $out.Add(''); $cTblBefore++
        }
        # Rule 3: blank line after a table (but NOT between a table and its
        # Advanced Tables formula line, which must stay directly attached)
        elseif (-not $isTable -and -not $isBlank -and $prevIsTable -and
                $line -notmatch '^\s*<!--\s*TBLFM') {
            $out.Add(''); $cTblAfter++
        }
        # Rule 4: blank line before a heading
        elseif ($isHeading -and $out.Count -gt 0 -and -not $prevIsBlank) {
            $out.Add(''); $cHead++
        }

        # Rule 5: collapse 3+ blank lines into one
        if ($isBlank -and $out.Count -ge 2 -and
            $out[$out.Count - 1].Trim() -eq '' -and
            $out[$out.Count - 2].Trim() -eq '') {
            $cCollapse++
            continue
        }

        $out.Add($line)
    }

    $newText = [string]::Join($eol, $out)
    $total   = $cTrail + $cTblBefore + $cTblAfter + $cHead + $cCollapse + $cBold + $cHdrFix + $cNestTbl + $cObj + $cChk + $cTblChk

    if ($newText -ne $raw -and $total -gt 0) {
        $changedCount++
        $rel = $f.FullName.Substring($VaultPath.Length).TrimStart('\')
        $results.Add([pscustomobject]@{
            File            = $rel
            TrailingSpaces  = $cTrail
            BlankBeforeTbl  = $cTblBefore
            BlankAfterTbl   = $cTblAfter
            BlankBeforeHead = $cHead
            BlanksCollapsed = $cCollapse
            BoldToHeading   = $cBold
            TblHeadersFixed = $cHdrFix
            NestedTblFreed  = $cNestTbl
            ObjRemoved      = $cObj
            Checkboxes      = $cChk
            TblCellChk      = $cTblChk
        })

        if ($Fix) {
            if ($BackupDir) {
                $dest = Join-Path $BackupDir $rel
                $destDir = Split-Path $dest -Parent
                if (-not (Test-Path -LiteralPath $destDir)) {
                    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                }
                Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
            }
            [System.IO.File]::WriteAllText($f.FullName, $newText, $utf8NoBom)
        }
    }
}

# --- Report ---------------------------------------------------------------------
Write-Host ''
if ($results.Count -eq 0) {
    Write-Host 'No files need changes.' -ForegroundColor Green
    exit 0
}

$show = $results | Select-Object -First 30
foreach ($r in $show) {
    Write-Host ("{0}" -f $r.File) -ForegroundColor DarkGray
    Write-Host ("    trailing: {0}  tbl-before: {1}  tbl-after: {2}  headings: {3}  collapsed: {4}  bold->head: {5}  tbl-headers: {6}  nested-tbl: {7}  obj: {8}  checkbox: {9}  tbl-checkbox: {10}" -f `
        $r.TrailingSpaces, $r.BlankBeforeTbl, $r.BlankAfterTbl, $r.BlankBeforeHead, $r.BlanksCollapsed, $r.BoldToHeading, $r.TblHeadersFixed, $r.NestedTblFreed, $r.ObjRemoved, $r.Checkboxes, $r.TblCellChk)
}
if ($results.Count -gt 30) {
    Write-Host ("...and {0} more files (use -ReportPath for the full list as CSV)." -f ($results.Count - 30)) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '----- SUMMARY -----' -ForegroundColor Cyan
Write-Host ("Files needing changes: {0} of {1}" -f $changedCount, $files.Count)
Write-Host ("Trailing whitespace fixes:      {0}" -f ($results | Measure-Object TrailingSpaces -Sum).Sum)
Write-Host ("Blank lines added before tables: {0}" -f ($results | Measure-Object BlankBeforeTbl -Sum).Sum)
Write-Host ("Blank lines added after tables:  {0}" -f ($results | Measure-Object BlankAfterTbl -Sum).Sum)
Write-Host ("Blank lines before headings:     {0}" -f ($results | Measure-Object BlankBeforeHead -Sum).Sum)
Write-Host ("Extra blank lines collapsed:     {0}" -f ($results | Measure-Object BlanksCollapsed -Sum).Sum)
Write-Host ("Bold lines made headings:        {0}" -f ($results | Measure-Object BoldToHeading -Sum).Sum)
Write-Host ("Blank table headers fixed:       {0}" -f ($results | Measure-Object TblHeadersFixed -Sum).Sum)
Write-Host ("Nested tables freed from lists:  {0}" -f ($results | Measure-Object NestedTblFreed -Sum).Sum)
Write-Host ("Object placeholders removed:     {0}" -f ($results | Measure-Object ObjRemoved -Sum).Sum)
Write-Host ("Checkboxes made clickable:       {0}" -f ($results | Measure-Object Checkboxes -Sum).Sum)
Write-Host ("Table-cell checkboxes cleaned:   {0}" -f ($results | Measure-Object TblCellChk -Sum).Sum)

if ($ReportPath) {
    $results | Export-Csv -Path $ReportPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Full report saved to {0}" -f $ReportPath) -ForegroundColor Cyan
}

if (-not $Fix) {
    Write-Host ''
    Write-Host 'DRY RUN complete - nothing was changed. Re-run with -Fix to apply.' -ForegroundColor Yellow
}
