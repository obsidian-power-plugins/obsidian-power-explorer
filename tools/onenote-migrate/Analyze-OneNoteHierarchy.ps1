<#
.SYNOPSIS
    READ-ONLY analyzer: finds OneNote subpage structures that will confuse the
    Obsidian importer. Changes NOTHING.

.DESCRIPTION
    OneNote stores pages as a flat list where each page has an indent level
    (1, 2, or 3). Importers rebuild folders from those numbers. Trouble happens
    when levels "skip" - e.g. a level-3 page appears right after a level-1 page
    with no level-2 parent in between. OneNote renders that fine visually, but
    an importer has to guess the parent, and guesses wrong.

    This script prints, for every section:
      - anomalies (level skips, sections starting deeper than level 1)
      - the true level-indented page tree for any section with anomalies,
        which is what the importer actually sees.

.USAGE
    # Analyze everything:
    powershell -ExecutionPolicy Bypass -File .\Analyze-OneNoteHierarchy.ps1

    # One notebook only:
    powershell -ExecutionPolicy Bypass -File .\Analyze-OneNoteHierarchy.ps1 -Notebook "Comtech"

    # Also print the full tree of EVERY section (verbose):
    powershell -ExecutionPolicy Bypass -File .\Analyze-OneNoteHierarchy.ps1 -ShowAll

    # Save anomalies to CSV:
    powershell -ExecutionPolicy Bypass -File .\Analyze-OneNoteHierarchy.ps1 -ReportPath .\hierarchy-report.csv

.REQUIREMENTS
    Windows PowerShell 5.1 (powershell.exe), desktop OneNote installed.
#>

[CmdletBinding()]
param(
    [string]$Notebook = "",
    [string]$ReportPath = "",
    [switch]$ShowAll
)

function Test-InRecycleBin {
    param($Node)
    if ($Node.GetAttribute('isInRecycleBin') -eq 'true') { return $true }
    if ($Node.GetAttribute('isDeletedPages') -eq 'true') { return $true }
    $p = $Node.ParentNode
    while ($null -ne $p -and $p.NodeType -eq 'Element') {
        if ($p.GetAttribute('isRecycleBin') -eq 'true')   { return $true }
        if ($p.GetAttribute('isInRecycleBin') -eq 'true') { return $true }
        $p = $p.ParentNode
    }
    return $false
}

function Get-NodePath {
    param($Node)
    $parts = @()
    $p = $Node.ParentNode
    while ($null -ne $p -and $p.NodeType -eq 'Element' -and $p.LocalName -ne 'Notebooks') {
        $parts = ,($p.GetAttribute('name')) + $parts
        $p = $p.ParentNode
    }
    return ($parts -join ' / ')
}

# --- Connect to OneNote -------------------------------------------------------
Write-Host 'Connecting to OneNote...' -ForegroundColor Cyan
try {
    $one = New-Object -ComObject OneNote.Application
}
catch {
    Write-Host 'ERROR: Could not connect to OneNote via COM.' -ForegroundColor Red
    Write-Host 'Run this in Windows PowerShell 5.1 (powershell.exe) with desktop OneNote installed.' -ForegroundColor Red
    exit 1
}

[string]$hierXml = ''
$one.GetHierarchy('', 4, [ref]$hierXml)    # 4 = hsPages
[xml]$doc = $hierXml
$ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace('one', $doc.DocumentElement.NamespaceURI)

$notebooks = @($doc.SelectNodes('//one:Notebook', $ns))
if ($Notebook) {
    $notebooks = @($notebooks | Where-Object {
        $_.GetAttribute('name') -eq $Notebook -or $_.GetAttribute('nickname') -eq $Notebook
    })
    if ($notebooks.Count -eq 0) {
        Write-Host "ERROR: No notebook named '$Notebook' found." -ForegroundColor Red
        exit 1
    }
}

$anomalies        = New-Object System.Collections.Generic.List[object]
$sectionsScanned  = 0
$sectionsWithSubs = 0
$sectionsWithBad  = 0

foreach ($nb in $notebooks) {
    $nbName = $nb.GetAttribute('name')
    Write-Host "Analyzing notebook: $nbName" -ForegroundColor Cyan

    foreach ($sec in @($nb.SelectNodes('.//one:Section', $ns))) {
        if ($sec.GetAttribute('isRecycleBin') -eq 'true') { continue }
        if (Test-InRecycleBin $sec) { continue }

        $secPath = (Get-NodePath $sec)
        if ($secPath) { $secPath = "$secPath / " + $sec.GetAttribute('name') }
        else          { $secPath = $sec.GetAttribute('name') }

        $pages = @($sec.SelectNodes('one:Page', $ns)) | Where-Object {
            $_.GetAttribute('isInRecycleBin') -ne 'true'
        }
        if ($pages.Count -eq 0) { continue }
        $sectionsScanned++

        $rows      = @()   # name, level, issue
        $prevLevel = 0
        $lastAt    = @{}   # level -> last page name seen at that level
        $first     = $true
        $secBad    = $false
        $maxLevel  = 1

        foreach ($pg in $pages) {
            $name = $pg.GetAttribute('name')
            $lvlAttr = $pg.GetAttribute('pageLevel')
            $lvl = 1
            if ($lvlAttr -match '^\d+$') { $lvl = [int]$lvlAttr }
            if ($lvl -gt $maxLevel) { $maxLevel = $lvl }

            $issue = ''
            if ($first -and $lvl -gt 1) {
                $issue = "section STARTS at level $lvl (no possible parent)"
            }
            elseif ($lvl -gt ($prevLevel + 1)) {
                $parentGuess = '(none)'
                if ($lastAt.ContainsKey($lvl - 1)) { $parentGuess = $lastAt[$lvl - 1] }
                $issue = "LEVEL SKIP: level $lvl right after level $prevLevel - importer will guess parent [$parentGuess]"
            }

            if ($issue) {
                $secBad = $true
                $anomalies.Add([pscustomobject]@{
                    Notebook = $nbName
                    Section  = $secPath
                    Page     = $name
                    Level    = $lvl
                    AfterLevel = $prevLevel
                    Issue    = $issue
                })
            }

            $rows += [pscustomobject]@{ Name = $name; Level = $lvl; Issue = $issue }
            $lastAt[$lvl] = $name
            $prevLevel = $lvl
            $first = $false
        }

        if ($maxLevel -gt 1) { $sectionsWithSubs++ }
        if ($secBad)         { $sectionsWithBad++ }

        # Print the level-indented tree for problem sections (or all, with -ShowAll)
        if ($secBad -or $ShowAll) {
            Write-Host ""
            if ($secBad) {
                Write-Host ("  SECTION WITH PROBLEMS: {0}" -f $secPath) -ForegroundColor Yellow
            } else {
                Write-Host ("  Section: {0}" -f $secPath) -ForegroundColor DarkGray
            }
            foreach ($r in $rows) {
                $indent = '    ' + ('    ' * ($r.Level - 1))
                if ($r.Issue) {
                    Write-Host ("{0}{1}   (L{2})  <-- {3}" -f $indent, $r.Name, $r.Level, $r.Issue) -ForegroundColor Red
                } else {
                    Write-Host ("{0}{1}   (L{2})" -f $indent, $r.Name, $r.Level)
                }
            }
        }
    }
}

# --- Summary -------------------------------------------------------------------
Write-Host ""
Write-Host '----- SUMMARY -----' -ForegroundColor Cyan
Write-Host ("Sections scanned:               {0}" -f $sectionsScanned)
Write-Host ("Sections using subpages:        {0}" -f $sectionsWithSubs)
Write-Host ("Sections with level problems:   {0}" -f $sectionsWithBad)
Write-Host ("Total problem pages:            {0}" -f $anomalies.Count)

if ($ReportPath -and $anomalies.Count -gt 0) {
    $anomalies | Export-Csv -Path $ReportPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Report saved to {0}" -f $ReportPath) -ForegroundColor Cyan
}

Write-Host ""
Write-Host 'READ-ONLY: nothing was changed. Use this report to decide on a fix strategy.' -ForegroundColor Green
