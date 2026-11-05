---
runbook: slow-loop
symptom: "a change takes minutes-to-hours to verify; the suite, a seat turn, or one test dominates wall-clock; a test is red only because it needs a key/network/a model; you are about to run the whole suite 'to be safe'"
writes: false
precondition: "read-only"
last_verified: 2026-11-05
verified_by: delegate
evidence: "measured 2026-11-05 (Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0): `node scripts/test.mjs` → 257/258 in 57.0s (1 FAIL = demo/deepinfra-catalog.test.mjs, needs DEEPINFRA_API_KEY); per-area broker 25.4s/63, rig 24.0s/63 (demo/cli.test.mjs alone 20.1s), tui 12.4s/46, toolchain 11.1s/16, worktree 7.8s/23, check 6.3s/12, readapi 3.8s/5, guard 2.0s/24, docs 1.2s/6; `node demo/offline.mjs` (full pm→worker→done loop on faux models, no network) 0.301s; tools/latency-budget.mjs cost 3.1s over 63,172 generations: model-call p50 52ms p95 9.0s p99 1.8m max 2.0h; tool-call p50 59ms p95 4.7s p99 2.9m max 28.8m; compaction p50 23.2s p95 4.2m max 8.3h; 50.8% of generations ≤5s hold 1.8% of busy time while 185 (0.29%) >10min hold 517.5h = 64.6%; item latency WAIT 72.4% / WORK 13.0% / HELD 5.9%; 308.7h with 0 generations in flight; provider waste 14,377 generations 22.5h"
check_rule: null
---

# Fast iteration: find the loop cost, then isolate the slow part

**This runbook implements the operator's architecture policy (D213).** Its premise: iteration speed is an architectural
property, every piece owes a fast loop of its own, and a part that restricts iteration gets **isolated**, not tolerated.
Read it before "just run the whole suite" and before accepting "the LLM part is just slow".

## When to use

- You are about to verify one change and are unsure what to run.
- A suite/area/test/turn is slow, and you need to know *which* one and by how much.
- A test is red only because of a key, a network, a model server, or a sleep — i.e. the loop is lying to you.
- You are reviewing a design and want to know what it costs to change.

## Impact

A slow loop is not a tax you pay; it changes what gets tested. At 57 s you run the suite on every change; at 1672 s you
start skipping it, and the rig's verification claims become prose. Every number below exists because the alternative was
measured: the same 258 tests cost **57 s** run parallel and **1672 s** in the degraded (sequential/cold-deps) shape a
previous session recorded.

## Diagnose (read-only, cheap first)

Run the ladder in order; stop at the first row that explains your cost. All four are reads.

```bash
cd ~/Git/Durian-Pi
node scripts/test.mjs --list                                   # areas + counts (0.1 s)
node scripts/test.mjs --area <area> 2>&1 | tail -3             # one area: total + the 5 slowest files
node tools/what-to-test.mjs --base=main --json | tail -20      # tests derived from YOUR diff
node tools/latency-budget.mjs 2>&1 | sed -n '/MACHINE WALL-CLOCK/,/^3\./p'   # the LLM cost shape (3.1 s)
grep -l "API_KEY\|127.0.0.1\|https://" demo/*.test.mjs         # which tests touch the outside world
grep -l "setTimeout" demo/*.test.mjs | wc -l                   # how much of the suite sleeps (43/258 today)
```

Read the output for these shapes (measured 2026-11-05, Linux Fedora 45, node v24.22.1):

1. **One file owns an area.** `demo/cli.test.mjs` = **20.1 s** of the `rig` area's 24.0 s. Fixing one file beats tuning the
   runner.
2. **The LLM's cost is a tail, not the median.** Model calls are **p50 52 ms / p95 9.0 s**; **50.8%** of generations end in
   **0–5 s** and hold **1.8%** of busy time; **185 generations (0.29%)** exceed 10 minutes and hold **64.6%** of it. The top
   of the tail was ten **~2,120-minute** generations (one per seat, `events=2–3`, `outcome=completed`) — a turn *open*, not
   a turn *working*. Do not buy a faster model to fix this; bound the turn.
3. **Compaction is a cost center of its own**: p50 **23.2 s**, p95 **4.2 min**, max **8.3 h**, **55.5 h** total in the store.
   A test lane that forces compaction is paying production-scale cost.
4. **The largest single latency in the rig is waiting, not computing**: **WAIT 72.4%** of item latency vs **WORK 13.0%**;
   **308.7 h** of store lifetime had **0 generations in flight** (channel down/idle). A "slow rig" is usually a dead channel.
5. **Waste is measurable and preventable**: **14,377** generations ended in refusals (**22.5 h** busy), including
   `402 You need positive balance`, and this session's `401 Invalid API key` (a `send` run without `--env-file`). The fix is
   to fail **before** the request (`tools/channel-preflight.mjs`, `tools/broker-serve.mjs --dry-run`), never to retry faster.

## Do — the isolation menu, cheapest first

The operator's ruling names the techniques; these are the ones this tree already has.

1. **Run the area, not the suite.** `node scripts/test.mjs --area <name>` (manifest `demo/test-areas.json`, selection in
   `src/testareas.mjs`, coverage enforced by `demo/test-areas.test.mjs` — an unlisted test is a failure, so you cannot hide
   a slow one by omission). `--list` prints the map.
2. **Let the diff pick the tests.** `tools/what-to-test.mjs --base=main --json` returns the derived set plus
   `scanFindings` (the seat report format for #5145 used it: `ok:true, 25 derived tests, 0 scanFindings`).
3. **Put behavior tests on the faux plane.** `@earendil-works/pi-ai/providers/faux` (`fauxProvider`, `fauxText`,
   `fauxToolCall`, `fauxAssistantMessage`) is already used by **77 of 258** demos; `node demo/offline.mjs` proves the **whole
   delegation loop** (pm `send_work` → worker `claim_work` → `complete_work` → DONE notice) in **0.301 s**, no network, no
   keys. Copy `demo/offline.mjs`'s shape for any new seat-behavior test. **Trap (from that file's header, learned in spike
   R2): scripted responses drain in GLOBAL call order across conversations** — count your turns, or the script drifts and the
   test goes red for a reason that looks like a regression.
4. **Use a cheaper model for the test lane, deliberately.** Test lanes may name a different (smaller/faster) model than
   production; the cross-family author/verifier invariant is a *production* staffing rule (D210/D211) and is not what a
   deterministic lane is measured against. If a lane needs a real model, give it an explicit budget and keep it **out of the
   default loop** (see 6).
5. **Replace sleeps with an event or a fake clock.** 43 of 258 demos use `setTimeout` waits; every fixed sleep is a floor on
   every future run. `src/eventfeed.mjs` (the durable read-only feed) is the seam for "wait until X happened" instead of
   "wait 10 s".
6. **Move anything that needs a key/network into an explicitly-invoked lane.** Today
   `demo/deepinfra-catalog.test.mjs` is **red without `DEEPINFRA_API_KEY`** in the 57 s offline loop — that is the exact
   defect this clause targets. A metered/vendor-catalog check belongs in a lane you name on purpose (and whose report says
   which credential it used, by presence, never by value).
7. **Keep the fast path fast when you must run everything.** `DEFAULT_JOBS = min(8, cores)` (`scripts/test.mjs:41`),
   per-test `--timeout <ms>` (default 120 s) so **a hung test is a FAIL, never a hang** — that rule is what keeps a 57 s
   loop from becoming a 28-minute accident.
8. **Declare the loop cost on every piece.** When a row proposes a new piece (extension, gate, daemon, lane), its
   acceptance line must state the seconds to iterate on it and which seam keeps the fast path. If it raises the loop cost,
   it must also name the compensation.

## Verify

The loop got faster **and** the claim is checkable:

```bash
node scripts/test.mjs --area <area> 2>&1 | grep -E "passed in|slowest"   # before/after, same command
node scripts/test.mjs 2>&1 | tail -2                                     # full: 257/258 in 57.0s today
node demo/offline.mjs >/dev/null; echo $?                                # the 0.3 s end-to-end proof
```

Exit criterion for any "slow loop" fix: the **area** that contains the change runs in the time its budget declares, the
default loop stays hermetic (no key/network-dependent test in it), and nothing that got faster stopped asserting the thing
it used to assert — a test that passes because it no longer exercises the seam is a fake green, not a speed-up.

## If it fails

- **A test is slow because it is honestly end-to-end** (it must spawn a seat, a broker, a worktree, or a real model). Do not
  delete it: **quarantine it into a named lane** with a declared budget, and add or restore a faux-plane test that covers the
  same behavior. Keep the id in the area manifest so coverage stays honest.
- **The suite is slow only in your shell.** Compare `node scripts/test.mjs --list` + one area; check you are not in a fresh
  worktree without the seat-root's vendored deps (the `ERR_MODULE_NOT_FOUND @earendil-works/pi-durable` class) or running
  sequentially. Run from the seat root where deps are installed: `~/Git/durian-dev/seatroot`.
- **A turn is open for minutes with `events=2–3`.** That is the long-tail shape (ten ~2,120-minute generations, 64.6% of
  busy time). `tools/latency-budget.mjs` names the generation ids; the class is degenerate-seat / channel state, so read
  `docs/runbooks/degenerate-seat.md` and `docs/runbooks/broker-down.md` rather than optimizing prompts.
- **You cannot tell what a change should run.** That is a missing area mapping, not a reason to run everything: fix
  `demo/test-areas.json` (the coverage rule will tell you if you got it wrong).

## Escalate to

`lead` for decomposition (the fast-iteration rows are **ROADMAP 282–287**), and the **operator** for anything that trades
verification depth for speed — dropping a real-model lane from the default loop is a product decision, not an optimization.

## Evidence

`docs/DECISIONS.md` **D213** (the ruling and its measurements), **D212** (the extension-plane policy this pairs with),
`docs/reviews/base-agent-product-topology-research-prompt.md` question **8** (competitor iteration architecture), and the
numbers in the front-matter `evidence` line, all run 2026-11-05 on Linux Fedora 45 `7.2.15-300.fc45.x86_64` node v24.22.1.
