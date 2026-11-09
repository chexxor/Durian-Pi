# Verification for #4961 — independent verify of the #4931 compaction re-cut

Verdict: PASS — the re-cut is sound and introduces no regressions. Checks were re-run at the exact artifact, not accepted from the author's description.

## Artifact and tree
- Tip checked: 8fa8f3a2 ("#4931 fold-in: register the five DURIG_COMPACTION_* keys in CONFIG_KEYS and assert membership"), stack c97e1f11 on top of base 6d63a3c5.
- Method: two throwaway detached worktrees (scratch at 8fa8f3a2 and at base 6d63a3c5) forked from this checkout; both removed after the run. Caveat: prepare_workspace reported `sync-pi --link` FAILED for this worktree (vendor/pi-main unbuilt), so the suite ran against lockfile-resolved deps; name this tree when citing the numbers.

## demo/config.test.mjs — exit 0 at the tip
Full pass including "COMPACTION POLICY OK (unset invents nothing, verifier triple reaches Harness.open, bad values fail loudly, three report states)". Membership section green.

## The fold-in is real, not claimed
- src/config.mjs at 8fa8f3a2: 24 `DURIG_COMPACTION_` occurrences; CONFIG_KEYS lists DURIG_COMPACTION_ENABLED / MODEL_OVERRIDES / RESERVE_TOKENS / KEEP_RECENT_TOKENS / BACKGROUND_TOKENS (lines 140-144).
- At base 6d63a3c5: 0 occurrences — the keys genuinely arrive with this commit pair.

## Full gate at the tip: 234/239 (60.0 s)
Red: clockin-digest, deepinfra-catalog, local-model-pointer, seat-turn-shape, test-areas. All five are ALSO red at base 6d63a3c5 (each exit 1, re-run), and their failure shapes are environmental (machine config lacks `local` provider / catalog entries; store seat lookups; clockin-digest needs branch context). None is attributable to the three files #4931 touches (cli.mjs, src/config.mjs, demo/config.test.mjs).

## Drift check on current main (f1be5157)
260/261 pass; only clockin-digest red. No later damage from the fold-in.

## Syntax
`node --check cli.mjs` and `node --check src/config.mjs` both pass at the tip.

## Status note
Tip 8fa8f3a2 is already an ancestor of main (`git merge-base --is-ancestor` true) — this verify confirms the landed state; nothing here needs landing.
