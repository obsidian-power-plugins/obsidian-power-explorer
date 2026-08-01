<#
.SYNOPSIS
    Scans OneNote for notebook, section group, section, and page names that the
    Obsidian importer rejects ("File names cannot end with a dot or a space"),
    and optionally fixes them.

.DESCRIPTION
    Two modes:
      SCAN (default) - reports every problem name. Changes NOTHING.
      FIX  (-Fix)    - renames offending pages, sections, and section groups.
                       Notebook names are reported only (rename those by hand).

    A "problem name" is one that:
      - ends with a space (including invisible non-breaking spaces) or a period
      - starts with a space
      - contains characters illegal in Windows file names:  \ / : * ? " < > |

    How names are cleaned:
      - \ / : |          are replaced with a dash  ("A/B" -> "A-B")
      - * ? " < >        are removed               ("Rewrite?" -> "Rewrite")
      - trailing spaces/periods and leading spaces are trimmed

.REQUIREMENTS
    - Run in Windows PowerShell 5.1 (the built-in powershell.exe),
      NOT PowerShell 7 / pwsh (OneNote's COM interface is unreliable there)
    - Desktop OneNote (the full Win32 app) installed and signed in
    - Password-protected sections must be UNLOCKED first, or their pages fail

.USAGE
    # 1. Scan everything, change nothing:
    powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1

    # 2. Scan one notebook only:
    powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1 -Notebook "Test"

    # 3. Fix one notebook (do this on a throwaway notebook FIRST):
    powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1 -Notebook "Test" -Fix

    # 4. Fix everything:
    powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1 -Fix

    # Optional: save the scan results to a CSV file as well:
    powershell -ExecutionPolicy Bypass -File .\Fix-OneNoteNames.ps1 -ReportPath .\onenote-report.csv

.NOTES
    After fixing, let OneNote FINISH SYNCING to the cloud before re-running the
    Obsidian importer. The importer reads Microsoft's cloud copy, not this PC.
#>

[CmdletBinding()]
param(
    [switch]$Fix,
    [string]$Notebook = "",
    [string]$ReportPath = "",
    [switch]$Force          # skip the "are you sure" prompt in -Fix mode
)

# --- Cleaning rules (edit these two lines if you want different behavior) ----
$ReplaceWithDash = '[\\/:\|]'      # these become '-'
$RemoveEntirely  = '[\*\?"<>]'     # these are deleted

function Get-CleanName {
    param([string]$Name)
    $clean = $Name -replace $ReplaceWithDash, '-'
    $clean = $clean -replace $RemoveEntirely, ''
    $clean = $clean -replace '^\s+', ''        # leading whitespace
    $clean = $clean -replace '[\s\.]+$', ''    # trailing whitespace (any kind, incl. invisible) and periods
    if ([string]::IsNullOrWhiteSpace($clean)) { $clean = 'Untitled' }
    return $clean
}

function Get-ProblemReasons {
    param([string]$Name)
    $reasons = @()
    if ($Name.Length -gt 0 -and $Name[-1] -eq [char]0x00A0) {
        $reasons += 'ends with a NON-BREAKING space (the invisible kind)'
    }
    elseif ($Name -match '\s$') {
        $reasons += 'ends with a space'
    }
    if ($Name -match '\.$') { $reasons += 'ends with a period' }
    if ($Name -match '^\s') { $reasons += 'starts with a space' }
    $bad = [regex]::Matches($Name, '[\\/:\*\?"<>\|]') |
        ForEach-Object { $_.Value } | Select-Object -Unique
    if ($bad) { $reasons += ('contains illegal character(s): ' + ($bad -join ' ')) }
    return ,$reasons
}

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
    Write-Host 'Make sure desktop OneNote is installed, and run this in Windows PowerShell 5.1 (powershell.exe), not PowerShell 7.' -ForegroundColor Red
    exit 1
}

[string]$hierXml = ''
$one.GetHierarchy('', 4, [ref]$hierXml)    # 4 = hsPages: full tree down to pages
[xml]$doc = $hierXml
$ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace('one', $doc.DocumentElement.NamespaceURI)

# --- Pick notebooks -----------------------------------------------------------
$notebooks = @($doc.SelectNodes('//one:Notebook', $ns))
if ($Notebook) {
    $notebooks = @($notebooks | Where-Object {
        $_.GetAttribute('name') -eq $Notebook -or $_.GetAttribute('nickname') -eq $Notebook
    })
    if ($notebooks.Count -eq 0) {
        Write-Host "ERROR: No notebook named '$Notebook' found. Notebooks available:" -ForegroundColor Red
        @($doc.SelectNodes('//one:Notebook', $ns)) | ForEach-Object {
            Write-Host ('  - ' + $_.GetAttribute('name'))
        }
        exit 1
    }
}

# --- Scan ----------------------------------------------------------------------
$offenders = New-Object System.Collections.Generic.List[object]

foreach ($nb in $notebooks) {
    $nbName = $nb.GetAttribute('name')
    Write-Host "Scanning notebook: $nbName" -ForegroundColor Cyan

    # The notebook's own name (report-only; rename notebooks by hand)
    $reasons = Get-ProblemReasons $nbName
    if ($reasons.Count -gt 0) {
        $offenders.Add([pscustomobject]@{
            Type    = 'Notebook (manual fix)'
            Path    = ''
            Name    = $nbName
            NewName = (Get-CleanName $nbName)
            Reasons = ($reasons -join '; ')
            Id      = $nb.GetAttribute('ID')
            Node    = $nb
        })
    }

    # Section groups and sections (these become FOLDERS in Obsidian)
    $containers = @($nb.SelectNodes('.//one:SectionGroup', $ns)) + @($nb.SelectNodes('.//one:Section', $ns))
    foreach ($el in $containers) {
        if ($el.GetAttribute('isRecycleBin') -eq 'true') { continue }
        if (Test-InRecycleBin $el) { continue }
        $name    = $el.GetAttribute('name')
        $reasons = Get-ProblemReasons $name
        if ($reasons.Count -gt 0) {
            $offenders.Add([pscustomobject]@{
                Type    = $el.LocalName          # 'Section' or 'SectionGroup'
                Path    = (Get-NodePath $el)
                Name    = $name
                NewName = (Get-CleanName $name)
                Reasons = ($reasons -join '; ')
                Id      = $el.GetAttribute('ID')
                Node    = $el
            })
        }
    }

    # Pages (these become FILES in Obsidian)
    foreach ($pg in @($nb.SelectNodes('.//one:Page', $ns))) {
        if (Test-InRecycleBin $pg) { continue }
        $name    = $pg.GetAttribute('name')
        $reasons = Get-ProblemReasons $name
        if ($reasons.Count -gt 0) {
            $offenders.Add([pscustomobject]@{
                Type    = 'Page'
                Path    = (Get-NodePath $pg)
                Name    = $name
                NewName = (Get-CleanName $name)
                Reasons = ($reasons -join '; ')
                Id      = $pg.GetAttribute('ID')
                Node    = $pg
            })
        }
    }
}

# --- Report ---------------------------------------------------------------------
Write-Host ''
if ($offenders.Count -eq 0) {
    Write-Host 'No problem names found in the scanned notebooks.' -ForegroundColor Green
    Write-Host '(If the Obsidian importer STILL fails on some pages after this, the trailing junk may be hidden somewhere this scan cannot see - a deeper page-by-page scan is the fallback.)'
    exit 0
}

Write-Host ("Found {0} problem name(s). Brackets [ ] are shown so trailing spaces are visible:" -f $offenders.Count) -ForegroundColor Yellow
Write-Host ''
foreach ($o in ($offenders | Sort-Object Type, Path, Name)) {
    Write-Host ("{0}  in: {1}" -f $o.Type, $o.Path) -ForegroundColor DarkGray
    Write-Host ("    Current: [{0}]" -f $o.Name)
    Write-Host ("    Fixed:   [{0}]" -f $o.NewName) -ForegroundColor Green
    Write-Host ("    Why:     {0}" -f $o.Reasons) -ForegroundColor DarkYellow
}

if ($ReportPath) {
    $offenders | Select-Object Type, Path, Name, NewName, Reasons |
        Export-Csv -Path $ReportPath -NoTypeInformation -Encoding UTF8
    Write-Host ("`nReport saved to {0}" -f $ReportPath) -ForegroundColor Cyan
}

if (-not $Fix) {
    Write-Host "`nSCAN ONLY - nothing was changed. Re-run with -Fix to rename these." -ForegroundColor Cyan
    Write-Host 'Tip: test the fix on one throwaway notebook first:  -Notebook "NotebookName" -Fix' -ForegroundColor Cyan
    exit 0
}

# --- Fix mode --------------------------------------------------------------------
Write-Host "`n--- FIX MODE ---" -ForegroundColor Yellow
if (-not $Force) {
    $answer = Read-Host ("About to rename {0} item(s) listed above. Type YES to continue" -f $offenders.Count)
    if ($answer -ne 'YES') {
        Write-Host 'Cancelled. Nothing was changed.' -ForegroundColor Cyan
        exit 0
    }
}

$fixedPages = 0; $fixedSections = 0; $manual = 0; $failed = 0

# 1) Sections and section groups first (one batched hierarchy update)
$containerOffenders = @($offenders | Where-Object { $_.Type -eq 'Section' -or $_.Type -eq 'SectionGroup' })
if ($containerOffenders.Count -gt 0) {
    foreach ($o in $containerOffenders) {
        $o.Node.SetAttribute('name', $o.NewName)
        Write-Host ("QUEUED {0} rename: [{1}] -> [{2}]" -f $o.Type, $o.Name, $o.NewName) -ForegroundColor Green
    }
    try {
        $one.UpdateHierarchy($doc.OuterXml)
        $fixedSections = $containerOffenders.Count
        Write-Host 'Section / section group renames applied.' -ForegroundColor Green
    }
    catch {
        Write-Host ("FAILED applying section renames: {0}" -f $_.Exception.Message) -ForegroundColor Red
        Write-Host '  Common cause: the cleaned name collides with an existing section name in the same place. Rename those by hand.' -ForegroundColor Red
        $failed += $containerOffenders.Count
    }
}

# 2) Pages (title is rewritten as plain text; title-only font styling is not kept)
foreach ($o in @($offenders | Where-Object { $_.Type -eq 'Page' })) {
    try {
        [string]$pageStr = ''
        $one.GetPageContent($o.Id, [ref]$pageStr, 0)   # 0 = piBasic
        [xml]$pageXml = $pageStr
        $pns = New-Object System.Xml.XmlNamespaceManager($pageXml.NameTable)
        $pns.AddNamespace('one', $pageXml.DocumentElement.NamespaceURI)
        $tNode = $pageXml.SelectSingleNode('//one:Title/one:OE/one:T', $pns)

        if ($null -eq $tNode) {
            Write-Host ("SKIPPED (manual): page [{0}] has no title element (untitled page) - retype its title by hand." -f $o.Name) -ForegroundColor Magenta
            $manual++
        }
        else {
            while ($tNode.HasChildNodes) { [void]$tNode.RemoveChild($tNode.FirstChild) }
            [void]$tNode.AppendChild($pageXml.CreateCDataSection($o.NewName))
            $one.UpdatePageContent($pageXml.OuterXml, [System.DateTime]::MinValue)
            Write-Host ("FIXED page: [{0}] -> [{1}]" -f $o.Name, $o.NewName) -ForegroundColor Green
            $fixedPages++
        }
    }
    catch {
        Write-Host ("FAILED page: [{0}] - {1}" -f $o.Name, $_.Exception.Message) -ForegroundColor Red
        Write-Host '  (If this section is password-protected, unlock it and re-run.)' -ForegroundColor Red
        $failed++
    }
}

# 3) Notebooks are never auto-renamed
foreach ($o in @($offenders | Where-Object { $_.Type -like 'Notebook*' })) {
    Write-Host ("MANUAL: rename notebook [{0}] yourself (in OneNote and/or OneDrive), suggested name: [{1}]" -f $o.Name, $o.NewName) -ForegroundColor Magenta
    $manual++
}

# --- Summary ----------------------------------------------------------------------
Write-Host ''
Write-Host ("Done. Pages fixed: {0}   Sections/groups fixed: {1}   Manual: {2}   Failed: {3}" -f $fixedPages, $fixedSections, $manual, $failed) -ForegroundColor Cyan
Write-Host ''
Write-Host 'IMPORTANT: Let OneNote finish syncing to the cloud BEFORE re-running the Obsidian importer.' -ForegroundColor Yellow
Write-Host '(In OneNote: File > Info > View Sync Status > Sync All. The importer reads the cloud copy, not this PC.)' -ForegroundColor Yellow
