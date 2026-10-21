# reclaim-root-leftovers.ps1 -- reclaim LEFTOVER PLAIN DIRECTORIES at the repo root.
#
# ASCII-ONLY ON PURPOSE: Windows PowerShell 5.1 reads a .ps1 as ANSI unless it carries a BOM, so any
# non-ASCII character in this file (an em-dash, a curly quote) becomes mojibake and BREAKS THE PARSE.
# A BOM would fix the encoding and is the other trap this repo has spent a session removing, so the
# script is written in plain ASCII instead. Do not "prettify" the punctuation.
#
# WHY THIS EXISTS (#4656/#4678): a gate refuses EVERY landing while ten `item-*/` directories sit at the
# shared repo root, because `scripts/land.mjs` reads the root's DIRECTORY LIST and compares it to
# `git worktree list`. NINE of the ten carry content, so a blanket delete would destroy residue that
# exists nowhere else.
#
# THE HEADLINE, AND WHY THE RUNBOOK'S RECIPE DOES NOT APPLY: ALL TEN ARE PLAIN DIRECTORIES, NOT
# WORKTREES. None has a `.git` file and none is registered in `git worktree list`, so
# `git worktree move` FAILS on them -- the leaked-worktrees RELOCATE recipe is for REGISTERED worktrees
# and is the WRONG TOOL here. `item-2801` is the proof: its REGISTERED worktree lives at
# `../pi-opendurig.worktrees/item-2801`, so the `item-2801/` at the root is a LEFTOVER AFTER a relocate
# pass. "Registered ELSEWHERE" is a different thing from "registered HERE", with a different remedy.
#
# WHAT IT DOES, per directory, PRESERVE-THEN-REMOVE:
#   1. refuse if the directory is MISSING (something else moved it) -- idempotent, safe to re-run;
#   2. copy it to the archive, then VERIFY the copy by file count and total bytes;
#   3. only then remove the original.
# NOTHING IS REMOVED UNTIL ITS VERIFIED COPY EXISTS.
#
# AND IT DOES NOT RUN `git worktree prune`: nothing here is registered, and `git worktree list` must be
# UNCHANGED. The script captures it before and after and DIFFS it -- a difference means something was
# registered after all and the pass must stop.
#
# RUN IT FROM THE SHARED ROOT, WITH SHARED-ROOT OWNERSHIP. It writes outside every seat root by design,
# which is exactly why a SEAT must not run it and the OPERATOR (or a delegate holding that authority)
# must. It touches no store, so the broker may keep driving.
#
#   powershell -NoProfile -File scripts/reclaim-root-leftovers.ps1 -Repo <shared root> -DryRun
#   powershell -NoProfile -File scripts/reclaim-root-leftovers.ps1 -Repo <shared root>

[CmdletBinding()]
param(
  # The SHARED repo root (the directory the stray item-*/ dirs sit in).
  [Parameter(Mandatory = $true)][string]$Repo,
  # Where the preserved copies go. Defaults to the sibling archive the runbook already uses.
  [string]$Archive,
  # Print what WOULD happen and change nothing.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path $Repo).Path
if (-not $Archive) { $Archive = Join-Path (Split-Path $Repo -Parent) 'pi-opendurig.worktrees' }

# ORDERED DELIBERATELY: the empty one first (proves the procedure on the trivial case), the small ones
# next, and the 473-entry one LAST -- so the risky removal happens after the procedure has run eight times.
$ORDER = @('item-3645','item-2757','item-4559','item-2801','item-3922','item-3216','item-1754','item-1581','item-2632','item-2608')

function Say($m) { Write-Host "[reclaim] $m" }
function Stop-Refuse($m) { Write-Host "[reclaim] REFUSING: $m" -ForegroundColor Red; exit 1 }
# Files only: a DIRECTORY has no Length, and Measure-Object throws on the property being absent for ANY
# input -- which is why this filters rather than relying on -ErrorAction (measured on item-2757, whose
# single entry is a directory).
function Sum-Bytes($items) {
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  if ($files.Count -eq 0) { return [long]0 }
  $s = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $s) { return [long]0 }
  return [long]$s
}

# -- capture the registered set BEFORE, so the pass can prove it did not touch it ------------------
$before = (& git -C $Repo worktree list --porcelain) -join "`n"
$registered = @($before -split "`n" | Where-Object { $_ -like 'worktree *' } | ForEach-Object { ($_ -replace '^worktree ','').Trim() })
Say "repo       = $Repo"
Say "archive    = $Archive"
Say "registered = $($registered.Count) worktrees (captured BEFORE)"
if ($DryRun) { Say "DRY RUN -- nothing will be copied or removed" }

foreach ($name in $ORDER) {
  $dir = Join-Path $Repo $name
  $dest = Join-Path $Archive ($name + '-root-leftover')

  # 1. IDEMPOTENT: a missing directory means someone else already handled it (or it never existed).
  if (-not (Test-Path -LiteralPath $dir)) { Say "$name -- MISSING, skipping (already handled)"; continue }

  # 2. IT MUST BE A PLAIN DIRECTORY. If it is a REGISTERED worktree, this script is the wrong tool.
  if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
    Stop-Refuse "$name has a .git file -- it IS a worktree, not a leftover. Use the leaked-worktrees RELOCATE recipe (git worktree move), not this script."
  }
  if ($registered -contains ($dir -replace '\\','/')) {
    Stop-Refuse "$name IS registered in git worktree list -- this script must not touch it."
  }

  $files = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue)
  $bytes = Sum-Bytes $files
  Say "$name -- $($files.Count) entries, $bytes bytes"

  if ($DryRun) { Say "  would copy to $dest, verify, then remove $dir"; continue }

  # 3. PRESERVE: refuse if a DIFFERENT copy already exists (never overwrite residue we did not make).
  if (Test-Path -LiteralPath $dest) {
    $dfiles = @(Get-ChildItem -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue)
    $dbytes = Sum-Bytes $dfiles
    if ($dfiles.Count -eq $files.Count -and $dbytes -eq $bytes) {
      Say "  $dest already exists with matching content ($($dfiles.Count) entries) -- using it"
    } else {
      Stop-Refuse "$dest exists with DIFFERENT content ($($dfiles.Count) vs $($files.Count) entries). Resolve by hand; do not overwrite."
    }
  } else {
    New-Item -ItemType Directory -Force -Path $Archive | Out-Null
    Copy-Item -LiteralPath $dir -Destination $dest -Recurse -Force
    # 4. VERIFY the copy before anything is removed -- a count AND a byte total, not an assumption.
    $cfiles = @(Get-ChildItem -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue)
    $cbytes = Sum-Bytes $cfiles
    if ($cfiles.Count -ne $files.Count -or $cbytes -ne $bytes) {
      Stop-Refuse "copy VERIFICATION FAILED for $name -- original $($files.Count) entries / $bytes bytes, copy $($cfiles.Count) / $cbytes. Nothing removed."
    }
    Say "  copied + verified: $($cfiles.Count) entries, $cbytes bytes -> $dest"
  }

  # 5. REMOVE the original ONLY now that a verified copy exists.
  Remove-Item -LiteralPath $dir -Recurse -Force
  Say "  removed $dir"
}

# -- capture the registered set AFTER and DIFF it -- it must be UNCHANGED --------------------------
$after = (& git -C $Repo worktree list --porcelain) -join "`n"
if ($after -ne $before) {
  Stop-Refuse "git worktree list CHANGED during the pass -- stop and inspect. (This script does not run 'worktree prune' and must not alter the registered set.)"
}
Say "git worktree list UNCHANGED ($($registered.Count) registered worktrees) -- no prune needed, nothing was registered"

# -- and the GATE itself: the root should now have no stray item-*/ child -------------------------
$stillStray = @(Get-ChildItem -LiteralPath $Repo -Directory -Filter 'item-*' -ErrorAction SilentlyContinue |
  Where-Object { $registered -notcontains ($_.FullName -replace '\\','/') } | ForEach-Object { $_.Name })
if ($stillStray.Count -gt 0) { Say "STILL STRAY (not in this script's list): $($stillStray -join ', ')" }
else { Say "no stray item-*/ left at the root -- the landing gate should now pass" }
