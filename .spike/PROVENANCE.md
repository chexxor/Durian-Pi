# Spike #176 — provenance (native Windows, no wsl/docker)

Seat root: C:/tmp/durig-dev/pi-rebase/durig (isolated worktree; node_modules is a REAL dir, not the junction to the live tree).

## Pin move
- old pin: 4270522473e677ddba7b093caa0064a3df51d459
- new pin: 7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6  (pi main tip)
- distance: 42 commits (`git rev-list --count <old>..FETCH_HEAD` → 42, exit 0)
- v1.2.0 `06a4669` is inside the gap (ancestor of tip, exit 0; NOT ancestor of old pin, exit 1)

## Commands actually run (exit codes)
1. `node scripts/sync-pi.mjs`               → exit 0, drift:true, upstreamSha=7d75a0e... (upstream has moved)
2. `node scripts/sync-pi.mjs --update`      → exit 0, 31.1s; pin written; built all 5 packages from source:
   pi-telemetry, chord, pi-codemode, pi-ai, pi-durable; buildTree HEAD=7d75a0e
3. `node scripts/sync-pi.mjs --link`        → exit 0, 10s; npm install --no-save of 5 file: specs into worktree
   node_modules/@earendil-works/* → worktree vendor/pi-main/packages/* (Junctions, LinkType=Junction)
   package.json UNCHANGED (still ^1.0.0 ranges — --no-save held)
4. demo suite: `for f in demo/*.test.mjs: node $f` → 47/47 exit 0
5. `node --check` on scripts/*.mjs, src/*.mjs, demo/*.mjs → 0 syntax failures

## Resolution proof (tests ran against the NEW tree, not a stale copy)
- `import.meta.resolve('@earendil-works/chord/context')` → file:///C:/tmp/durig-dev/pi-rebase/durig/vendor/pi-main/packages/chord/dist/context/index.js
- `git -C vendor/pi-main rev-parse HEAD` → 7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6
- vendor/pi-main/packages/chord/package.json version → 1.2.0

## Suite count
- demo/*.test.mjs on disk = 47 (recursive *.test.mjs = 47). Item said "49"; repo's own docs/NEXT.md:12 says "green 47/47". 47 is correct.

## Isolation
- git status (toplevel C:/tmp/durig-dev/pi-rebase): only `M durig/pi-main.pin.json` + `?? durig/.spike/` — both inside seat root. vendor/ gitignored. No writes outside durig/. No push/publish.
- Build notes: `--update` build ran clean with NO script-shell override and NO esbuild fix needed (npm run build scripts did not require bash; esbuild postinstall block did not affect the chord build).
