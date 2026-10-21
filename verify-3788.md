# Verification for #3788 — land.md fresh-worktree suite note

## Claim 1: NOT nested sets (3 red seat root, 7 red fresh worktree; pitui flips)
- Seat root pitui: RED (exit 1) — confirmed in seat root
- Fresh worktree pitui: GREEN (exit 0) — confirmed in this worktree (lockfile state)
- Fresh worktree 7 reds confirmed: broker-one-connection (1), seat-instruction-encoding (1), + 5 tui-durable-* (boot, compaction, compaction-tui, persistence, tools) all exit 1
- pitui is NOT in the fresh worktree red set, so 3 + 5 ≠ 7. Sets are NOT nested.
VERIFIED.

## Claim 2: Root cause — sync-pi --link fails in fresh worktrees
- src/worktree.mjs lines 155-188: prepare_workspace runs sync-pi --link before and after npm ci
- In a fresh worktree, vendor/pi-main is absent, so sync-pi --link fails with "nothing built yet"
- The caller only console.warns and continues — npm ci installs lockfile versions (pi-durable 1.1.0)
- This means pi-durable@1.1.0 (no ./codemode export) is installed, causing the 5 tui-durable-* reds
VERIFIED.

## Claim 3: Fix is its own held item (#3712)
- Item #3767 shows #3712 exists as a DEFECT registration, held (not fixed yet)
- Item body confirms: package-lock pins pi-durable 1.1.0 while src needs 1.3.0
VERIFIED.

## Doc corrections
The note corrects the earlier claim that "a worktree is safe and the shared tree is the exposed one" — both are exposed, for different reasons (shared tree has sync-pi clobber, worktree has lockfile version). This is accurate.

land-helper.test.mjs -> exit 0. No new failures.
