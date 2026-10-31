---
runbook: session-start-cost
symptom: "a session burns its first 30–60 minutes re-deriving rig state that an instrument already reports; the delegate 'verifies' numbers by hand that a tool prints in seconds"
writes: false
precondition: "read-only"
last_verified: 2026-10-31
verified_by: delegate
evidence: "measured 2026-10-31 on `Alex-Desktop-Win10` (Linux, node v24.22.1): `cli.mjs queue --json` 1.5 s and 21,710,535 B; `tools/what-to-test.mjs --base=HEAD~1` 0.13 s → 6 derived tests against a 239-test suite; `tools/doc-integrity-guard.mjs` 0.10 s exit 0; `tools/instrument-provenance.mjs` 0.07 s exit 0; `tools/seat-turn-shape.mjs` 3.6 s, 58,566 entries read, 0 writes. One batched `send` to `lead` (8 min) produced rows #4947–#4950 plus three closures; one `impl` turn (70 min) produced three rows. Rows #4947–#4950 exist because a delegate MEASUREMENT was carried to a seat instead of a re-derivation."
check_rule: null
---

# A session is spending its budget re-deriving state

## When to use
You are about to write a query, a probe, or a loop over `selfdev.sqlite`, or you are about to re-run
something an instrument in `tools/` already prints, or a session's first hour has produced no send and no
row. Also use it when you are deciding **how many seats to wake** — each wake is the expensive verb, and
this file prices the cheap ones.

## Impact
The expensive verbs are the ones that spend a model turn. Measured: a `lead` turn ≈ 8 minutes, an `impl`
working turn ≈ 70 minutes, and every failed or redundant wake **deposits rows** (a cancel alone emitted
four queued rows, #4932/#4941–#4943). Re-deriving state by hand does three things: it burns wall-clock
before anything was asked of the team, it produces numbers with no provenance (a hand query cannot be
re-run by the next session), and it invents defects — the delegate "fixed" a provider that was healthy
because a probe's single sample was read as a verdict (D183). Meanwhile the read-only instruments cost
**hundredths of a second** and write nothing.

## Preconditions
Read-only. The broker may be down (it was, on 2026-10-31). None of the commands below opens a writing
`Harness`; `queue --json` and the `tools/*.mjs` probes write 0 rows. Pin the store with an **absolute**
`DURIG_DB` when your cwd is not the checkout — `src/config.mjs` reads only `DURIG_*`, so a relative path
silently opens an empty `./rig.sqlite` (AGENTS.md step 4).

## Diagnose (read-only) — this is the whole clock-in read, and it costs ~7 s

```bash
cd /home/chexxor/Git/Durian-Pi
# 1. rows, not the census. 1.5 s, 21.7 MB → redirect; never read the queue into a terminal.
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/<session>/q.json
node .spike/fix-20261101/rows.mjs 4947 4948 4950 4949 4937 4931 4934 < .spike/<session>/q.json
# 2. may I send at all? 3.6 s, 58,566 entries, 0 writes. AT RISK ⇒ do not send that seat.
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs
# 3. are the seats pointed at the approved root? (up --refresh --dry-run does NOT answer this)
node .spike/fix-20261101/read-cwd4.mjs
# 4. what did real verifier turns cost, from the store? (the sizing question, answered without loading a model)
node .spike/fix-20261101b/turncost.mjs
# 5. the loaded slot, without asking the model server
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"
# 6. docs/git state, all sub-second, all exit 0 when clean
node tools/doc-integrity-guard.mjs; node tools/instrument-provenance.mjs
node tools/what-to-test.mjs --base=<sha-before-the-diff>     # 0.13 s; derived guard set vs the 239-test suite
git worktree list | grep ' locked$'                          # terse form: the lock flag is on the SAME line
```

## Do
1. **Read rows, never the census.** The status line (`done 3,771 / cancelled 790 …`) is case-insensitive
   noise and is not evidence; the named rows are. `queue --json` is 21.7 MB, so file it and filter it.
2. **Batch one brief per seat, not one brief per row.** Measured 2026-10-31: a single `send` to `lead`
   carrying three questions minted #4947, #4948, #4949, #4950, closed #4944–#4946 and revised #4923 — one
   8-minute turn. Three separate sends would have cost three turns and added context to a seat already at
   0.7364.
3. **Carry your own measurement to the seat; do not re-derive the seat's work.** `lead` minted two rows
   (#4947/#4950) from a delegate measurement of worktree placement; that is the productive direction. The
   delegate must not implement, claim, complete or route (AGENTS.md).
4. **Run every `send` with cwd at the approved seat root.** Placement follows the serving process's tree,
   not the root the guard checks (`src/seattools.mjs:35-37` passes `worktreeRoot: source`), so sending from
   the operator's checkout forks `item-*` trees into the operator's checkout and then the roster-wide
   `DURIG_SEAT_ROOT` guard refuses every later write verb. Measured twice on 2026-10-31; see
   `.spike/fix-20261101b/inv-bare-*.txt` inventories.
5. **Treat any provider BLOCK from `tools/broker-serve.mjs --status` as one sample, not a verdict.** It
   blocked `local` during a live seat turn (the engine serves one request at a time) and `verifier` at idle
   85 minutes later, when a direct probe answered in 8.45 s. Confirm with `/v1/models` plus one direct
   completion before you spend a wake "fixing" a provider.
6. **Do not hand-query the store with `better-sqlite3`.** It is not installed in either tree — `node -e`
   with it returns `MODULE_NOT_FOUND` from both `/home/chexxor/Git/Durian-Pi` and the seat root. Use
   `node:sqlite` (`DatabaseSync`), and note the store's tables are opaque JSON `record` blobs, so an ad-hoc
   query is slower and less trustworthy than `cli.mjs log <seat>` / `queue --json` / `worktree audit`.
7. **Take inventories in bare names around a writing verb** (`inv.sh`): `git worktree list --porcelain`
   paths + `git branch` short names, sorted, one per line. A count or a decorated table hides the verdict;
   a name diff shows exactly what a verb changed (the 2026-10-31 removals diffed by exactly 4 lines).
8. **Write the speed-up down, in the doc, not only in the report** (operator directive 2026-10-31). New
   cheap read → this file. New trap → the next `## Operational pitfalls` block in `docs/SELFDEV.md`. A
   probe worth keeping → ask `lead` to mint a row to promote it from `.spike/` into `tools/`; `.spike/` is
   gitignored, so an unpromoted probe is gone next session.

## Verify
Every instrument above ran on 2026-10-31 with the costs in the front-matter `evidence:` line, and both doc
guards exited 0. Re-check in one line that you are reading, not re-deriving: your session's clock-in
should cost seconds, and the first artefact it produces should be a brief or a report, not a query.

## If it fails
If an instrument contradicts another instrument, **name the signal source and probe it directly** before
minting or acting on anything — that is how the stale shell-name probe (#4938) and the single-sample
provider probe (#4949) were separated instead of folded into one untestable row. If the state you need has
no instrument, do not build a throwaway: route it (next step).

## Escalate to
`lead` — to mint a row that promotes a useful `.spike/` probe into `tools/` (it owns decomposition; the
delegate must not build the rig's instruments by hand). `devtools` — when an existing instrument prints a
confidently wrong verdict (#4938, #4949 are its rows). The operator — any decision about verifier capacity
or GPU spend; capacity is never a delegate or seat ruling.

## Evidence
D183 in `docs/DECISIONS.md` (the placement class, the single-sample probes, the empty-reply `done` settle,
the cancel-deposits mechanism). Rows #4947, #4948, #4949, #4950. Timings measured 2026-10-31 in the
Diagnose block above. The delegate's ad-hoc probes for this session live in `.spike/fix-20261101/` and
`.spike/fix-20261101b/` and are **gitignored — unpromoted, so they are already partly lost**; promoting
them is the standing speed-up.
