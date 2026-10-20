# scan-dangling-cites.ps1 (v2) - one-pass scan v2: doc-relative resolution, ellipsis/artifact classes, tracked-prefix unjamming
$ErrorActionPreference = 'Stop'
$tracked = @(git ls-files)
$trackedSet = @{}
foreach ($t in $tracked) {
  $n = ($t -replace '\\','/')
  $trackedSet[$n] = $true
  $parts = $n -split '/'
  for ($i = 0; $i -lt $parts.Count - 1; $i++) { $trackedSet[(($parts[0..$i]) -join '/')] = $true }
}
$mds = @(git ls-files '*.md')
$exts = 'md|mjs|js|json|ps1|ts|txt|html|css|sh|cmd|py|yml|yaml|toml|csv|log|lock|png|jpg|gif|webp|svg|env|ini|cfg'
$pattern = "(?<token>[\w.][\w.\-]*[/\\][\w./\\\-]+\.(?:$exts))"
function Test-Path-Tok([string]$base, [string]$docDir) {
  $cands = @()
  if ($base.StartsWith('./') -or $base.StartsWith('../')) { $cands = @((Join-Path $docDir $base)) }
  else { $cands = @((Join-Path $docDir $base), $base) }
  foreach ($c in $cands) {
    $n = ($c -replace '\\','/') -replace '^\./',''
    while ($n -match '[^/]+/\.\./') { $n = $n -replace '[^/]+/\.\./','' }
    $n = $n.Trim('/')
    if ($n -and $trackedSet.ContainsKey($n)) { return $true }
  }
  return $false
}
function Test-Token([string]$tok, [string]$docDir) {  # returns $true if SOME interpretation resolves
  if ($tok -match '\.\.' -and $tok -notmatch '\.\./|\.\.\\') { return $true }   # ellipsis abbreviations: uncheckable
  if ($tok -match 'ANGSTRIPPED') { return $true }                                # my strip artifact
  $tok = ($tok -replace '//+','/')
  if ($tok -match '^\.git(/|\\)') { return $true }                               # inside .git, not a tree path
  foreach ($seg in ($tok -split '[/\\]')) { if ($seg -eq '...') { return $true } }
  if (Test-Path-Tok $tok $docDir) { return $true }
  # unjam at tracked prefixes: demo/confine.test.mjs/demo/seatguard.test.mjs
  $segs = $tok -split '/'
  for ($i = 0; $i -lt $segs.Count - 1; $i++) {
    $pre = (($segs[0..$i]) -join '/')
    if ($pre -notmatch "\.($exts)$") { continue }
    if (Test-Path-Tok $pre $docDir) {
      $rem = (($segs[($i+1)..($segs.Count-1)]) -join '/')
      if (-not $rem) { return $true }
      if (Test-Token $rem $docDir) { return $true }
    }
  }
  return $false
}
$rows = @(); $unchecked = @{}
foreach ($f in $mds) {
  $docDirFull = Split-Path $f -Parent
  if (-not $docDirFull) { $docDirFull = '.' }
  $docDir = $docDirFull
  $text = Get-Content -Raw -LiteralPath $f
  $text = $text -replace 'https?://\S+', 'URLSTRIPPED'
  $text = $text -replace '>.*?>', 'ANGSTRIPPED'
  foreach ($m in [regex]::Matches($text, $pattern)) {
    $raw = $m.Groups['token'].Value
    if ($raw -match '\.\.' -and $raw -notmatch '\.\./|\.\.\\') { $unchecked['ellipsis']++; continue }
    if ($raw -match 'ANGSTRIPPED') { $unchecked['strip-artifact']++; $raw=$raw -replace 'ANGSTRIPPED','' }
    if ($raw -notmatch '^\.\.?/') {
      $first = ($raw -split '[/\\]')[0]
      if ($first -match '\.(org|com|net|io|dev|ai|dev)$') { $unchecked['web-url']++; continue }
      if ($raw -match '^\.js(jx)?/' -or $raw -match '^\.ts/|^\.py/|^\.ps1/') { $unchecked['ext-list']++; continue }
    }
    if ($raw -match '^\.git(/|\\)') { $unchecked['git-dir']++; continue }
    if (Test-Token $raw $docDir) { continue }
    $line = ($text.Substring(0, $m.Index) -split "`n").Count
    $rows += [pscustomobject]@{ doc = $f; missing = $raw; line = $line }
  }
}
$rows | Export-Csv -LiteralPath 'scan-raw.csv' -NoTypeInformation
$uniq = @{}
foreach ($r in $rows) { $k = "$($r.doc)`t$($r.missing)"; if (-not $uniq.ContainsKey($k)) { $uniq[$k] = $r } }
"docs=$($mds.Count) flagged_pairs=$($uniq.Count) skipped_classes=$($unchecked.Keys.Count)"
foreach ($k in $unchecked.Keys) { "  skipped[$k]=$($unchecked[$k])" }
foreach ($g in ($uniq.Values | Group-Object doc | Sort-Object Count -Descending)) {
  "=== $($g.Name) ($($g.Count)) ==="
  ($g.Group | Sort-Object line | ForEach-Object { "  L$($_.line): $($_.missing)" })
}


