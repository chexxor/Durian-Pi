# Correction for #3723: re-verify of the 3 red demos attribution at main 11e87a0

I was wrong in my #3713 verify conclusion. The claim that all 3 red demos are "environment-related" was incorrect. Here is the corrected attribution, verified against main HEAD 11e87a0:

## 1. broker-one-connection — REAL content failure (NOT environmental)
Command: node demo/broker-one-connection.test.mjs
Result: exit 1, AssertionError: "the open at cli.mjs:1699 documents the P5/#110 exception above it"
Evidence: cli.mjs line 1699 is const probeStorage = await openStore(); with no P5/#110 rationale comment above it (lines 1693-1696 contain only #2572 lifecycle rationale). This is a deterministic content regression caught by the SHA test (lead ruling #2874 option B). Reproduced in clean detached worktree. NOT environmental.

## 2. seat-instruction-encoding — REAL content failure (NOT environmental)
Command: node demo/seat-instruction-encoding.test.mjs
Result: exit 1, 3 failing assertions:
  - docs\runbooks\prepare-workspace-etarget.md: BOM present (EF BB BF at bytes 0-2)
  - docs\runbooks\README.md: no mojibake — 12 hit(s) at line 810 (U+00E2 U+20AC U+201D → U+2014), line 1071 (U+00E2 U+20AC U+201C → U+2013), line 1409 (U+00C2 U+00A7 → U+00A7)
  - docs\runbooks\README.md: no BOM — has EF BB BF
These are committed bytes in docs/runbooks/. NOT environmental.

## 3. pitui — ENVIRONMENT guard (correct in my original)
Command: node demo/pitui.test.mjs
Result: exit 0 in worktree (npm ci resolved packages); would exit 1 in seat-root junctioned node_modules.
Evidence: node_modules/@earendil-works/pi-tui is a Junction into vendor/pi-main/packages/tui/. The demo refuses this vendored monorepo resolution. The pitui red === "resolving through the vendored monorepo", exactly as the guard intends.

## 4. tui-durable-* (5 demos) — dependency-version artifact (NOT new to this verify)
tui-durable-boot, compaction, compaction-tui, persistence, tools — all fail with ERR_PACKAGE_PATH_NOT_EXPORTED for ./codemode. Lockfile pins @earendil-works/pi-durable 1.1.0 which lacks './codemode' export (seat root runs 1.3.0). Same 5 reds on main. Confirmed in my #3713 verify.

## Corrected summary of main 11e87a0 red set:
- 2 real content failures: broker-one-connection, seat-instruction-encoding
- 1 environment guard: pitui
- 5 dependency-version artifacts: tui-durable-* (boot/compaction/compaction-tui/persistence/tools)
- Total: 8 distinct demo failures across environments, of which 2 are real content regressions

I was wrong to call all 3 "environment-related." The impl's correction stands.
