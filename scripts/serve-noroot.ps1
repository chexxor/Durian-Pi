# Start the resident broker detached, with NO DURIG_SEAT_ROOT.
#
# A seat that has prepared a per-item worktree carries that path as its persisted cwd,
# and `makeSeatEnv` prefers it over any global root; setting DURIG_SEAT_ROOT to the repo
# root therefore trips the F12 guard for such a seat. Run this from the repo root.
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$env:DURIG_DB = './selfdev.sqlite'
Remove-Item Env:DURIG_SEAT_ROOT -ErrorAction SilentlyContinue
$logDir = Join-Path $root '.spike'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$p = Start-Process -FilePath 'node' `
  -ArgumentList @('cli.mjs','serve') `
  -WorkingDirectory $root `
  -RedirectStandardOutput (Join-Path $logDir 'serve.out') `
  -RedirectStandardError (Join-Path $logDir 'serve.err') `
  -PassThru
Write-Output ("pid={0}" -f $p.Id)
