<#
.SYNOPSIS
  Rename the durig workspace directory (default pi-opendurig -> durian-pi) and repair
  everything that carries its absolute path: git linked worktrees, sibling archive
  directories, the local rig store pointer, and pi's per-path state.

.DESCRIPTION
  DRY RUN BY DEFAULT. Prints every planned action and every preflight result.
  Nothing is moved or written unless -Execute is passed.

  Must be run from a plain terminal whose cwd is the PARENT directory
  (default C:\Users\Alex\dsh-Projects), with no pi session, no broker, no seat and
  no `node ui.mjs` running. Windows refuses the move otherwise.

  The script stops at the first failed precondition. It never runs `git worktree prune`,
  never deletes a worktree, never rewrites tracked documentation, and never pushes.

.EXAMPLE
  powershell -NoProfile -File .\scripts\rename-workspace.ps1

.EXAMPLE
  powershell -NoProfile -File .\scripts\rename-workspace.ps1 -Execute
#>
[CmdletBinding()]
param(
  [string]$ParentDir = 'C:\Users\Alex\dsh-Projects',
  [string]$OldName   = 'pi-opendurig',
  [string]$NewName   = 'durian-pi',
  [switch]$Execute,
  [switch]$AllowDirty,
  [switch]$IgnoreLocks,
  [switch]$IgnoreProcesses,
  [switch]$SkipBackup,
  [string]$PiAgentDir = (Join-Path $HOME '.pi\agent')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$OldRoot = Join-Path $ParentDir $OldName
$NewRoot = Join-Path $ParentDir $NewName
$OldWts  = Join-Path $ParentDir "$OldName.worktrees"
$NewWts  = Join-Path $ParentDir "$NewName.worktrees"
$OldLand = Join-Path $ParentDir "$OldName.land"
$NewLand = Join-Path $ParentDir "$NewName.land"
$Stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup  = Join-Path $ParentDir "$NewName.pre-rename-$Stamp"

$script:Plan    = New-Object System.Collections.Generic.List[string]
$script:Blocked = New-Object System.Collections.Generic.List[string]
$script:Warned  = New-Object System.Collections.Generic.List[string]

function Step([string]$msg) { $script:Plan.Add($msg) }
function Block([string]$msg) { $script:Blocked.Add($msg) }
function Warn([string]$msg) { $script:Warned.Add($msg) }
function WarnNow([string]$msg) { $script:Warned.Add($msg); Write-Host "  ! $msg" -ForegroundColor Yellow }

function Norm([string]$p) { if ($null -eq $p) { return '' }; $p.Replace('\', '/') }
function Write-TextNoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}
function Under([string]$p, [string]$prefix) {
  $p = Norm $p; $prefix = Norm $prefix
  return ($p -ieq $prefix) -or $p.StartsWith($prefix + '/', [StringComparison]::OrdinalIgnoreCase)
}

Write-Host ''
Write-Host "=== rename workspace: $OldName -> $NewName ===" -ForegroundColor Cyan
Write-Host ("mode: " + $(if ($Execute) { 'EXECUTE' } else { 'DRY RUN (pass -Execute to apply)' }))
Write-Host "parent: $ParentDir"
Write-Host ''

# ---------------------------------------------------------------- preflight 1: location
if ((Norm (Get-Location).Path).TrimEnd('/') -ne (Norm $ParentDir).TrimEnd('/')) {
  Block "cwd is '$((Get-Location).Path)' but must be the parent '$ParentDir' (nothing may hold the tree)."
}
$rootExists = Test-Path -LiteralPath $OldRoot
if (-not $rootExists) {
  if (Test-Path -LiteralPath $NewRoot) {
    Warn "$NewRoot already exists and $OldRoot is gone - assuming an interrupted run; the directory move will be skipped."
  } else {
    Block "neither $OldRoot nor $NewRoot exists."
  }
}
$resume = (-not (Test-Path -LiteralPath $OldRoot)) -and (Test-Path -LiteralPath $NewRoot)
# On a resumed run the tree is already at the new path; preflight reads the store and git from there.
$SourceRoot = if ($resume) { $NewRoot } else { $OldRoot }

# ---------------------------------------------------------------- preflight 2: broker / locks
$brokerFile = Join-Path $SourceRoot 'selfdev.sqlite.broker.json'
$genlocks = @(Get-ChildItem -LiteralPath $SourceRoot -Filter 'selfdev.sqlite.genlock.*' -File -ErrorAction SilentlyContinue)
if (Test-Path -LiteralPath $brokerFile) {
  try { $broker = Get-Content -LiteralPath $brokerFile -Raw | ConvertFrom-Json } catch { $broker = $null }
  if ($null -ne $broker) {
    $alive = $null -ne (Get-Process -Id $broker.pid -ErrorAction SilentlyContinue)
    if ($alive) {
      Block "broker is alive (pid $($broker.pid)). Stop it and let the rig settle first."
    } else {
      Step "stale broker marker (pid $($broker.pid) not running) -> archived, not carried into the new name"
    }
  }
}
if ($genlocks.Count -gt 0) {
  if ($IgnoreLocks) { Warn "ignoring $($genlocks.Count) genlock file(s) (-IgnoreLocks)" }
  else { Block "$($genlocks.Count) genlock file(s) present (a seat may still be mid-pass). Re-run with -IgnoreLocks only after confirming no seat process exists." }
}

# ---------------------------------------------------------------- preflight 3: processes holding the tree
# Build the ancestor set first: the terminal that launched this script necessarily has a
# command line mentioning the path, and it is not a blocker.
$self = New-Object System.Collections.Generic.HashSet[int]
$walk = $PID
for ($i = 0; $i -lt 12 -and $walk; $i++) {
  [void]$self.Add([int]$walk)
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$walk" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { break }
  $walk = $proc.ParentProcessId
}
$needles = @((Norm $OldRoot), $OldRoot, (Norm $OldWts), $OldWts)
$procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    if ($self.Contains([int]$_.ProcessId) -or -not $_.CommandLine) { return $false }
    $cmd = $_.CommandLine
    foreach ($n in $needles) {
      if ($n -and $cmd.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
  })
if ($procs.Count -gt 0) {
  $list = ($procs | ForEach-Object { "$($_.ProcessId) $($_.Name)" }) -join ', '
  if ($IgnoreProcesses) { Warn "ignoring $($procs.Count) process(es) whose command line mentions the path: $list" }
  else { Block "$($procs.Count) process(es) still reference the workspace path ($list). Close pi / ui.mjs / seats / stray shells first, or pass -IgnoreProcesses only if you are certain none holds the tree as cwd." }
}

# ---------------------------------------------------------------- preflight 4: repo state
$worktrees = @()
if (Test-Path -LiteralPath (Join-Path $SourceRoot '.git')) {
  $dirty = @(& git -C $SourceRoot status --porcelain 2>&1)
  if ($LASTEXITCODE -ne 0) { Block "git status failed inside $SourceRoot"; $dirty = @() }
  elseif ($dirty.Count -gt 0) {
    if ($AllowDirty) { Warn "main worktree has $($dirty.Count) uncommitted path(s) (-AllowDirty)" }
    else { Block "main worktree has $($dirty.Count) uncommitted path(s); commit or stash before renaming (or pass -AllowDirty)." }
  }

  $raw = @(& git -C $SourceRoot worktree list --porcelain 2>&1)
  if ($LASTEXITCODE -ne 0) { Block "git worktree list failed inside $SourceRoot" }
  $cur = $null
  foreach ($line in $raw) {
    if ($line -match '^worktree (.+)$') { $cur = $Matches[1].Trim(); $worktrees += $cur }
    elseif ($line -match '^prunable') { Warn "worktree '$cur' is already prunable (missing on disk)" }
  }
  if ($worktrees.Count -gt 0) {
    $adminCount = @(Get-ChildItem -LiteralPath (Join-Path $SourceRoot '.git\worktrees') -Directory -ErrorAction SilentlyContinue).Count
    Step ("main worktree + {0} linked worktree(s) registered; {1} admin dir(s) in .git/worktrees" -f ($worktrees.Count - 1), $adminCount)
  }
} else {
  Block "$SourceRoot\.git not found."
}

# ---------------------------------------------------------------- plan: path mapping
function Map-Path([string]$p) {
  $n = Norm $p
  if ($n -ieq (Norm $OldRoot)) { return (Norm $NewRoot) }
  if ($n.StartsWith((Norm $OldRoot) + '/', [StringComparison]::OrdinalIgnoreCase)) { return (Norm $NewRoot) + $n.Substring((Norm $OldRoot).Length) }
  if ($n.StartsWith((Norm $OldWts) + '/', [StringComparison]::OrdinalIgnoreCase)) { return (Norm $NewWts) + $n.Substring((Norm $OldWts).Length) }
  return $n
}

$moved   = @()
$repair  = @()
$inPlace = @()
foreach ($w in $worktrees) {
  $n = Map-Path $w
  if ((Norm $n) -ine (Norm $w)) { $moved += ,@((Norm $w), (Norm $n)) }
  if ((Norm $w) -ine (Norm $OldRoot)) {
    if (Test-Path -LiteralPath $w) { $repair += $n; if ((Norm $n) -ieq (Norm $w)) { $inPlace += $w } }
    else { Warn "skipping missing worktree $w (already stale registration)" }
  }
}
$relocated = @($worktrees | Where-Object { Under $_ $OldWts })

if ($resume) { Warn "resumed run: $NewRoot already in place; only repairs and pi-state carry-over will run" }
else { Step ("move {0} -> {1}" -f $OldRoot, $NewRoot) }
if (Test-Path -LiteralPath $OldWts)  { Step ("move {0} -> {1}  ({2} worktree(s) inside)" -f $OldWts, $NewWts, $relocated.Count) }
if (Test-Path -LiteralPath $OldLand) { Step ("move {0} -> {1}" -f $OldLand, $NewLand) }
Step ("git worktree repair for {0} worktree(s): {1} path(s) change, {2} stay in place (e.g. %TEMP%) but need re-linking" -f $repair.Count, $moved.Count, $inPlace.Count)
Step 'rewrite rig.selfdev.json live cwd pointer(s) old-root -> new-root (original kept in backup)'
Step "archive stale broker marker, genlock files and broker inbox dirs into $Backup\broker-bookkeeping"
Step "rename the pi session dir ...-$OldName-- -> ...-$NewName-- (keeps --continue history)"
Step "rename the warden prefs file <sha256(old cwd)>.json -> <sha256(new cwd)>.json (keeps standing lessons)"
Step "re-key ~/.pi/agent/trust.json: $NewRoot inherits the old path's trust"
Step "report (not rewrite) tracked files still containing '$OldName'"
if (-not $SkipBackup) { Step "backup -> $Backup (store, broker json, rig.selfdev.json, worktree inventory, HEAD)" }

# ---------------------------------------------------------------- report preflight
Write-Host '--- preflight ---' -ForegroundColor Cyan
if ($script:Blocked.Count -eq 0) { Write-Host 'PASS: no blockers' -ForegroundColor Green }
else {
  Write-Host "BLOCKED ($($script:Blocked.Count)):" -ForegroundColor Red
  foreach ($b in $script:Blocked) { Write-Host "  x $b" -ForegroundColor Red }
}
if ($script:Warned.Count -gt 0) {
  Write-Host "warnings ($($script:Warned.Count)):" -ForegroundColor Yellow
  foreach ($w in $script:Warned) { Write-Host "  ! $w" -ForegroundColor Yellow }
}
Write-Host ''
Write-Host '--- plan ---' -ForegroundColor Cyan
foreach ($s in $script:Plan) { Write-Host "  - $s" }
Write-Host ''

if (-not $Execute) {
  Write-Host 'DRY RUN: nothing changed. Pass -Execute inside the operator window.' -ForegroundColor Yellow
  exit 0
}
if ($script:Blocked.Count -gt 0) {
  Write-Host 'Refusing to execute with blockers.' -ForegroundColor Red
  exit 1
}

# ================================================================ EXECUTE
function Run([string]$what, [scriptblock]$sb) {
  Write-Host "-> $what" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $sb
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

if (-not $SkipBackup) {
  New-Item -ItemType Directory -Path $Backup -Force | Out-Null
  foreach ($f in @('selfdev.sqlite', 'selfdev.sqlite-wal', 'selfdev.sqlite-shm',
                   'selfdev.sqlite.broker.json', 'selfdev.sqlite.broker.log',
                   'rig.selfdev.json', 'durig.config.json')) {
    $src = Join-Path $SourceRoot $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $Backup -Force }
  }
  & git -C $SourceRoot worktree list --porcelain | Set-Content -LiteralPath (Join-Path $Backup 'worktrees-before.txt') -Encoding utf8
  (& git -C $SourceRoot rev-parse HEAD) | Set-Content -LiteralPath (Join-Path $Backup 'HEAD.txt') -Encoding utf8
  (& git -C $SourceRoot status --porcelain) | Set-Content -LiteralPath (Join-Path $Backup 'status-before.txt') -Encoding utf8
  Write-Host "   backup: $Backup"
}

# archive stale broker bookkeeping: it names the old pid/paths and must not survive the rename
if ((Test-Path -LiteralPath $brokerFile) -or ($genlocks.Count -gt 0)) {
  $archive = Join-Path $Backup 'broker-bookkeeping'
  New-Item -ItemType Directory -Path $archive -Force | Out-Null
  if (Test-Path -LiteralPath $brokerFile) { Move-Item -LiteralPath $brokerFile -Destination $archive -Force }
  foreach ($g in $genlocks) { Move-Item -LiteralPath $g.FullName -Destination $archive -Force }
  foreach ($n in @('selfdev.sqlite.broker.inbox', 'selfdev.sqlite.broker.inbox.out', 'selfdev.sqlite.broker.inbox.error')) {
    $p = Join-Path $SourceRoot $n
    if (Test-Path -LiteralPath $p) { Move-Item -LiteralPath $p -Destination $archive -Force }
  }
  Write-Host "   archived broker bookkeeping -> $archive"
}

# move the three directories
if ((Test-Path -LiteralPath $OldRoot) -and -not (Test-Path -LiteralPath $NewRoot)) {
  Run "Move-Item $OldRoot -> $NewRoot" { Move-Item -LiteralPath $OldRoot -Destination $NewRoot }
}
if ((Test-Path -LiteralPath $OldWts) -and -not (Test-Path -LiteralPath $NewWts)) {
  Run "Move-Item $OldWts -> $NewWts" { Move-Item -LiteralPath $OldWts -Destination $NewWts }
}
if ((Test-Path -LiteralPath $OldLand) -and -not (Test-Path -LiteralPath $NewLand)) {
  Run "Move-Item $OldLand -> $NewLand" { Move-Item -LiteralPath $OldLand -Destination $NewLand }
}

# repair libgit2's absolute links
Push-Location $NewRoot
try {
  if ($repair.Count -gt 0) {
    Write-Host "-> git worktree repair ($($repair.Count) path(s))" -ForegroundColor Cyan
    & git worktree repair @repair
    if ($LASTEXITCODE -ne 0) { throw "git worktree repair failed (exit $LASTEXITCODE)" }
  }
  $verify = @(& git worktree list)
  $bad = @($verify | Where-Object { $_ -match '\(error\)|prunable' })
  if ($bad.Count -gt 0) {
    Write-Host '   ! worktree list still reports problems:' -ForegroundColor Yellow
    foreach ($b in $bad) { Write-Host "     $b" -ForegroundColor Yellow }
  } else {
    Write-Host "   git worktree list: $($verify.Count) entries, clean" -ForegroundColor Green
  }

  $rig = Join-Path $NewRoot 'rig.selfdev.json'
  if (Test-Path -LiteralPath $rig) {
    $txt = Get-Content -LiteralPath $rig -Raw
    $new = $txt.Replace((Norm $OldRoot), (Norm $NewRoot)).Replace($OldRoot, $NewRoot)
    if ($new -ne $txt) {
      Write-TextNoBom $rig $new
      Write-Host "   rig.selfdev.json: live cwd pointer rewritten to $NewRoot" -ForegroundColor Green
    } else {
      Write-Host '   rig.selfdev.json: no live absolute pointer to rewrite'
    }
  }

  $tracked = @(& git grep -l --fixed-strings $OldName -- . 2>$null)
  if ($tracked.Count -gt 0) {
    Write-TextNoBom (Join-Path $Backup 'tracked-old-name-files.txt') (($tracked -join "`n") + "`n")
    Write-Host "   ! $($tracked.Count) tracked file(s) still contain '$OldName' (left untouched; list saved in backup dir)" -ForegroundColor Yellow
  }
} finally { Pop-Location }

# ---- pi per-path state
$piAgent = $PiAgentDir

$sessRoot = Join-Path $piAgent 'sessions'
$sessDirs = @(Get-ChildItem -LiteralPath $sessRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*-$OldName--" })
foreach ($d in $sessDirs) {
  $target = Join-Path $sessRoot ($d.Name.Substring(0, $d.Name.Length - ("-$OldName--").Length) + "-$NewName--")
  if (Test-Path -LiteralPath $target) { WarnNow "session dir already exists: $target (merge $($d.FullName) by hand)"; continue }
  Run "rename session dir $($d.Name)" { Move-Item -LiteralPath $d.FullName -Destination $target }
}

$trustFile = Join-Path $piAgent 'trust.json'
if (Test-Path -LiteralPath $trustFile) {
  try { $trust = Get-Content -LiteralPath $trustFile -Raw | ConvertFrom-Json } catch { $trust = $null; WarnNow "trust.json could not be parsed ($($_.Exception.Message)); re-key it by hand" }
  if ($null -ne $trust) {
    $props = @($trust.PSObject.Properties)
    $oldKey = ($props | Where-Object { $_.Name -replace '/', '\' -ieq ($OldRoot -replace '/', '\') } | Select-Object -First 1)
    if ($null -ne $oldKey) {
      $val = $oldKey.Value
      if (-not $SkipBackup) { Copy-Item -LiteralPath $trustFile -Destination (Join-Path $Backup 'trust.json') -Force }
      $trust.PSObject.Properties.Remove($oldKey.Name)
      $trust | Add-Member -NotePropertyName ($NewRoot -replace '/', '\') -NotePropertyValue $val -Force
      Write-TextNoBom $trustFile (($trust | ConvertTo-Json -Depth 5) + "`n")
      Write-Host "   trust.json: re-keyed $($oldKey.Name) -> $($NewRoot -replace '/', '\')" -ForegroundColor Green
    } else {
      Write-Host '   trust.json: no key for the old path (nothing to carry)'
    }
  }
}

function Key-Of([string]$p) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($p)) } finally { $sha.Dispose() }
  (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 12)
}
$prefsDir  = Join-Path $piAgent 'pi-warden\prefs'
$prefsOld  = Join-Path $prefsDir ((Key-Of (Norm $OldRoot)) + '.json')
$prefsNew  = Join-Path $prefsDir ((Key-Of (Norm $NewRoot)) + '.json')
if ((Test-Path -LiteralPath $prefsOld) -and -not (Test-Path -LiteralPath $prefsNew)) {
  Run "rename warden prefs $(Split-Path $prefsOld -Leaf) -> $(Split-Path $prefsNew -Leaf)" { Move-Item -LiteralPath $prefsOld -Destination $prefsNew }
} elseif (Test-Path -LiteralPath $prefsOld) {
  WarnNow "warden prefs already exist for the new path; merge $prefsOld by hand"
} else {
  Write-Host "   warden prefs: none for the old path (nothing to carry)"
}

# ---- verify
Write-Host ''
Write-Host '--- post-rename verification ---' -ForegroundColor Cyan
$savedDb = $env:DURIG_DB
Push-Location $NewRoot
try {
  Write-Host '   git status --short -- .'
  & git status --short -- .
  Write-Host ''
  Write-Host '   DURIG_DB=./selfdev.sqlite node cli.mjs status'
  $env:DURIG_DB = './selfdev.sqlite'
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    if (Test-Path -LiteralPath (Join-Path $NewRoot 'cli.mjs')) {
      $out = & node cli.mjs status 2>&1 | Out-String
      ($out -split "`r?`n" | Where-Object { $_ -ne '' } | Select-Object -First 12) | ForEach-Object { Write-Host "   $_" }
    } else {
      Write-Host '   ! cli.mjs not present; skipped the store check' -ForegroundColor Yellow
    }
  } catch {
    Write-Host "   ! store check could not run: $($_.Exception.Message)" -ForegroundColor Yellow
  } finally {
    $ErrorActionPreference = $prevEap
  }
} finally {
  Pop-Location
  if ($null -eq $savedDb) { Remove-Item Env:DURIG_DB -ErrorAction SilentlyContinue } else { $env:DURIG_DB = $savedDb }
}

Write-Host ''
Write-Host 'Done. Remaining manual steps (operator / scribe, tracked docs are left untouched):' -ForegroundColor Yellow
Write-Host ' 1. Update live doc pointers (docs/NEXT.md, docs/runbooks/, reconcile-538/README.md, demo fixtures);'
Write-Host '    annotate - do not erase - historical incident/audit records.'
Write-Host ' 2. Run the gates: node scripts/suite.mjs (or each demo/*.test.mjs) and npm run test:tui.'
Write-Host ' 3. Only once `git worktree list` is clean: optionally `git worktree prune` (never --force).'
Write-Host ' 4. Rollback if needed: move the dirs back, then `git worktree repair` again with the original paths.'
