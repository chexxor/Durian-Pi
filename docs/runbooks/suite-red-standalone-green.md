---
runbook: suite-red-standalone-green
symptom: "a demo exits 0 on its own but the suite reports it FAIL or TIMED OUT; OR the inverse - it is red standalone AND red in the suite, yet green in a tree built a different way"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: devtools
evidence: "item 6104; fixture demo/test-runner-concurrency.test.mjs §8 (leak); runs 2026-11-10. The inverse shape, measured 2026-11-11 (#6207): the SAME tree main `35001c3a` in two dependency sets - unlinked (`dependencySet: lockfile-released`, pi-durable **1.3.0** from the lockfile, `dist/index.js` sha256 `467d9cf6b27c…`) gives **279/300, exit 1, 134.5 s**, and every one of the 21 failures is ALSO red standalone (`node demo/<f>.test.mjs` exit 1 each; `demo/broker.test.mjs` hangs to the 120 s kill); the identical tree with the pin built and linked (`dependencySet: built-pin`, **1.5.1**) gives **300/300, exit 0, 89.7 s** (item-6200). Signatures: 4 broker demos `SessionFailed: Session failed after a storage error; close and reopen it`, 4 `TypeError: Cannot read properties of undefined (reading 'id')`, 5 tui-durable assertion mismatches, and `demo/commit-discipline-personas.test.mjs` dying with `ERR_MODULE_NOT_FOUND: @earendil-works/pi-schema` - a workspace package that only exists when the pin is built. All 21 are dependency-graph artefacts, not content defects."
check_rule: null
---

# A demo that is green alone and red in the suite

## When to use
`node demo/<name>.test.mjs` prints PASS and exits 0, and `node scripts/test.mjs --all` prints
`FAIL` or `TIMEOUT` for the same file. Also when a red appears only while another suite run, a
seat turn, or a model server is live.

## Impact
A gate that is red for a reason it cannot name is not a gate. Two earlier reports of exactly this
shape were **attributed, never reproduced** ("`checkup-citation`: exit 0 standalone,
order-dependent" — DECISIONS.md; "running the suite while a seat run is live manufactures reds —
241/244 with `seat-turn-shape` + `broker-stop-audit` red, both green standalone 40 s later" —
NEXT-ARCHIVE.md). The reason nobody could pin it is the report itself: the runner printed only the
**last 8 lines** of a failing test, and for a crash the cause sits above the tail.

## The inverse shape: red standalone too, but green in the other dependency set

If the demo is red on its own as well, ordering and load are not the cause - the **dependency set** is.
Ask the tree which pi it is running before blaming the code:

```bash
node scripts/sync-pi.mjs                  # dependencySet: built-pin | lockfile-released | mixed
node scripts/test.mjs --all --jobs 6      # the count, and (since #6196/#6202) a PROVENANCE header naming the tree and the set
```

`lockfile-released` means the vendored pin build was never linked, so the tree measures the released npm
package. `mixed` - some pin packages linked, the rest from the lockfile - is the state to be suspicious of,
because a demo can straddle two graphs in one run.

Do not call a red "environmental" until you have compared like with like: run the same demo in a tree where
`node scripts/sync-pi.mjs --sync --link` has run. If it turns green there, the red belongs to the graph, and
the citation has to say which graph (`node demo/<name>.test.mjs -> exit 1 in <worktree>, dependencySet=lockfile-released`).

## Preconditions
None: every command here reads. The suite writes only to its own `/tmp` scratch.

## Diagnose (read-only)

```bash
node scripts/test.mjs --all                       # the gate: note file + exit code
node demo/<name>.test.mjs                         # the same file, alone
node scripts/test.mjs --area <area>               # the file with fewer neighbours
awk '/MemAvailable|SwapTotal|SwapFree/{print}' /proc/meminfo
ps -e -o pid,comm,rss --sort=-rss | head -10
ls -t /tmp/durig-suite-*/output.txt | head -5     # full capture of each failed test
```

Read the exit code the report prints, and classify it:

1. **`TIMEOUT ... (exit 0)`** — the demo **exited 0**; the runner simply never saw its stdio close.
   This is the runner's verdict rule, not contention and not ordering. Measured 2026-11-10 with a
   one-file fixture (`demo/test-runner-concurrency.test.mjs` §8: spawn a detached child, print
   `PASS`, `process.exit(0)`): against the pre-fix `scripts/test.mjs` the run reported
   `TIMEOUT demo/linger.test.mjs (60.1s)` even with `--timeout 5000` — the SIGKILL to the process
   group missed the detached grandchild, so the run stayed open until it exited — while the demo's
   own exit code was 0. With the verdict taken from `exit` instead of `close`, the same fixture
   reports `PASS ... (0.0s)`, exit 0.
2. **`exit 1` with an unreadable stack** — the tail is 8 lines and the cause is above it. Open the
   `full output: /tmp/durig-suite-<x>/output.txt` path the runner now prints and read the first
   lines. `spawnSync git ENOENT` / `Fatal process out of memory` are environmental, not a defect in
   the demo.
3. **A red that only appears with other work running** — that is contention, and the resource is
   the box, not CPU. Measured 2026-11-10, two `scripts/test.mjs --all` runs in one tree: **612
   processes**, `SwapFree` **0 kB** (zram, 8 GiB) while `MemAvailable` held ~19 GB. One run came
   back 260/282, the other 261/282; the extra red was `demo/init.test.mjs` (exit 1, `ENOENT ...
   open 'rig.json'` on its own `mkdtemp` directory). Demos that write in the shared working tree,
   or that spawn a broker, contend with each other.
4. **Red standalone AND red in the suite, but green in a tree built from the pin** — the cause is the
   dependency graph, not the code. `node scripts/sync-pi.mjs` prints `dependencySet: built-pin | lockfile-released | mixed`.
   Measured 2026-11-11 (#6207) on the same main `35001c3a` in two sets: unlinked (**1.3.0** from the
   lockfile) **279/300, exit 1**, with all 21 failures also red standalone; with the pin built and linked
   (**1.5.1**) **300/300, exit 0**. The same tree can therefore be red and green, and the verdict is only
   meaningful if it names the set it ran in.

## Do
1. [judgement] A red is a defect only if it survives a **single, quiet** run: `node scripts/test.mjs
   --area <area>` with no other suite run or seat turn live. Anything else is classified first.
2. Compare the two exit codes (alone vs in the gate). If the gate says TIMEOUT and the file exits 0,
   the demo left a child alive — fix the demo's cleanup, not the timeout.
3. Quote the `full output:` path in the ticket, not the tail.
4. **Group the reds by cause before you write anything down.** The runner's `--- <file> (exit N) ---`
   blocks are machine-readable, so a red set is a set of causes, not a list of filenames:

```bash
node scripts/test.mjs --all --jobs 8 > .spike/suite.out 2> .spike/suite.err
node tools/suite-signature.mjs .spike/suite.err    # exit 0 with reds, 1 with none, 2 on bad usage
```

Measured 2026-11-10 on a real capture from an un-linked worktree: **22 reds, 18 distinct causes**; the largest
group was four broker demos sharing `SessionFailed at util.js:56:69` ("Session failed after a storage error").
Merging those four into one line is correct. The scratch classifier used during the pi 1.5.1 move merged eight
different causes into one line — its key was the first line matching `AssertionError|Error:|TIMEOUT`, else
`"(no stderr line)"` — and the resulting brief said "8 pre-existing reds", which no one could check. The tool
prints a `MERGED:` note whenever it groups, so a merge is always a claim you can dispute. It also distinguishes
what the old one could not: a killed test reports `exit null` (SIGKILL has no code), and a thrown class that
does not end in "Error" (`SessionFailed`) is still a named cause.

## Verify
```bash
node demo/test-runner-concurrency.test.mjs   # exit 0, prints TEST-RUNNER-CONCURRENCY TEST PASS
node demo/suite-signature.test.mjs           # exit 0, prints SUITE-SIGNATURE TEST PASS
node scripts/sync-pi.mjs                     # exit 0; read "dependencySet" in the JSON
```
Measured 2026-11-10: both exit 0. And the verdict change is provably verdict-neutral on real failures:
`node scripts/test.mjs --all` → exit 1, `261/282 passed`, the same 21 reds before and after.
The dependency-set check was run 2026-11-11 on the same main `35001c3a` in two worktrees: unlinked
(`dependencySet: lockfile-released`, `built: 0 linked: 0`) → **279/300, exit 1**; after
`node scripts/sync-pi.mjs --sync --link` (36 s, 10 packages) → **300/300, exit 0**.

## If it fails
If the leak fixture reports TIMEOUT again, `runOne` has gone back to waiting on `close`; restore the
`child.on("exit", ...)` verdict in `scripts/test.mjs`. If `/tmp/durig-suite-*` keeps growing, the
runner is not cleaning scratch for passing tests — file it, do not delete by hand.

## Escalate to
`devtools` — a red that survives a quiet single run is real. Note that **`scripts/suite.mjs` still
takes its verdict from `close`** (`runOne`, ~line 89), so that runner has the same manufactured-red
path; it is not fixed here.

## Evidence
Item 6104, 2026-11-10. Old-vs-new pair, one command each: `node scripts/old-test.mjs --area leak
--timeout 5000` → exit 1, `TIMEOUT demo/linger.test.mjs (60.1s)`; `node scripts/test.mjs --area leak
--timeout 5000` → exit 0, `PASS demo/linger.test.mjs (0.0s)`. The cause classifier is #6167/#6176: it was
built after the 1.5.1 pin move flattened eight distinct failures into one bucket, and `demo/suite-signature.test.mjs
runs it and the predecessor on the same nine-fixture capture (9 signatures vs 6 buckets, 4 of them in the
catch-all).
