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
The expensive verbs are the ones that spend a model turn. Measured: a `lead` turn ≈ 8 minutes (a second `lead`
brief this session cost ≈ 19 minutes for a 16-part turn), an `impl`-working turn ≈ 34 minutes for **three rows of
work in one wake**, and an `impl` turn that died mid-flight cost the whole wake anyway — `settledStatus:
unanswered`, `settledReason: model_error`, empty reply, at 0.9041 of its window, leaving an orphan
`admitted_not_started` submission in `status.attention` that the **resume/doctor verb** re-arms (re-sending a fresh
brief is not the repair). Every failed or redundant wake **deposits rows** (a cancel alone emitted four queued
rows, #4932/#4941–#4943). Re-deriving state by hand does three things: it burns wall-clock before anything was
asked of the team, it produces numbers with no provenance (a hand query cannot be re-run by the next session), and
it invents defects — the delegate "fixed" a provider that was healthy because a probe's single sample was read as a
verdict (D183). Meanwhile the read-only instruments cost **hundredths of a second** and write nothing.

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
# 2. may I send at all, and what is the seat's REAL window? 0.4-3.6 s, ~58.6k entries, 0 writes.
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs   # prints `window N messages` + head marker + parity breaks per seat
#    `AT RISK` here is a STRICT-ALTERNATING-TEMPLATE warning, NOT a do-not-send gate on this host: measured 2026-10-31,
#    `scribe` (window 175, marker pi.reset) and `security` (100, pi.reset) were both flagged AT RISK and both completed
#    rows minutes later on the local model. Do not cancel a verify leg on that verdict alone.
#    PAIR IT with `status.context`, and understand which number is which: `consumed` = input+cacheRead+output of the
#    LAST model call, so it goes STALE the moment a reset/compaction moves the head marker. Measured contradiction:
#    `architect` consumed 218,645 = fraction 1.0932 while its live window is 1 message; `advocate` 244,751 = 9.9589, same
#    artifact. So an over-1 fraction on a post-reset seat is NOT an emergency, and #4959's fix should print the head
#    marker and the window length next to the fraction. A post-`compact` grant question starts here: `impl` carries
#    `pi.compaction@276279` in the live store although no `compact` verb was fired this session, which means the serving
#    path can compact on its own — check for a marker before asking the operator to fire one.
# 2b. MAY I SEND AT ALL — one field, 0.4 s, and it is NOT the `AT RISK` flag. Measured 2026-10-31 (D186):
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs \
  | grep -E '^seat |counted projection'   # read the LAST comma-separated element per seat
#    ends on `user`      ⇒ DO NOT SEND. The provider call is refused before the window is reached: attention
#                         `last_run_failed: model_error`, empty reply, and **zero tokens** — `status.context.consumed`
#                         does not move at all. The refused send still APPENDS a user entry, so the seat moves further
#                         from admissible every attempt (impl went proj 5 → 6).
#    ends on `assistant` ⇒ the turn runs; it may still die at the END on size, which is a different class and leaves
#                         its tool calls applied (lead minted four rows and then settled model_error at 185,156).
#    Measured split: ends-on-user = impl 6, pm 15, advocate 1, designer 1, architect 1 — exactly the seats carrying
#    `last_run_failed`; ends-on-assistant = qa 4, lead 27, scribe 11, devtools 7, auditor 11, security 5, qa2 4 — all
#    of which completed rows while ALSO flagged `AT RISK`. So the `AT RISK` verdict (a parity break ANYWHERE in the
#    window) is not the gate; the boundary slot is. Correcting both docs is row **#4967**; do not "fix" a stuck seat
#    by re-sending it.
# 3. are the seats pointed at the approved root? THE INSTRUMENT ANSWERS THIS — read the JSON field, not prose. 1.3 s.
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite \
  node cli.mjs up rig.selfdev.json --refresh --dry-run > .spike/<session>/updry.json
node -e 'const j=JSON.parse(require("fs").readFileSync(".spike/<session>/updry.json","utf8"));
 console.log((j.wouldRefresh||[]).filter(w=>Object.keys(w.changes||{}).length).map(w=>w.seat+" "+JSON.stringify(w.changes)).join("\n")||"no drift")'
#    The field is `wouldRefresh[].changes.cwd = {from,to}`. Grepping the output for the word "drifted" finds NOTHING and
#    will make you clock out claiming a clean roster while `scribe` sits parked in its own item worktree (measured
#    2026-10-31T19:4xZ: one entry, scribe seatroot/item-4958 -> seatroot). This dry run previews model/cwd writes and
#    NEVER removals — see docs/runbooks/leaked-worktrees.md before deleting anything. Do NOT hand-query the roster
#    document instead: `documents.kind` values are JSON-QUOTED (`"durig.seats"`), and that document's `record` is only
#    a header (`{id,kind,scope,createdAt}`, 0 `cwd` occurrences) while the real seats sit in `document_revisions.content`
#    whose shape I could not resolve — a hand probe there returned "count 0" and is NOT evidence of an empty roster.
# 4. what did real verifier turns cost, from the store? (the sizing question, answered without loading a model)
node .spike/fix-20261101b/turncost.mjs   # gitignored probe; row #4960 (devtools) exists to promote these into tools/
# 5. the loaded slot, without asking the model server — AND the pair that decides a verifier wake:
ps -eo args | tr '\0' ' ' | grep -oE -- '--ctx-size [0-9]+|--max-context [0-9]+'   # SERVED (llama-server / strata)
node -e 'console.log(require("fs").readFileSync("durig.config.json","utf8"))'      # DECLARED
#    0.1 s. Measured 2026-11-01 (D188): served `--ctx-size 8192 --parallel 4` (LM Studio llama-server, Ministral-3-14B
#    Q6_K, GPU0 12,618/16,376 MiB) against DURIG_VERIFIER_CONTEXT "24576" — the #4959 mismatch, live. A verifier wake
#    costs ~3x less context than status.context will claim, so it reads as context death, not as a config error.
#    Read this pair BEFORE sending a verify leg (#4974 on `qa` is exactly such a wake), and name the dial you moved.
# 5b. which shell can a seat actually start — 0.2 s, and it is NOT the broker-serve verdict:
node -e 'import("./src/shellregistry.mjs").then(m=>console.log(m.seatShellSelection.name, "degraded:"+m.seatShellSelection.degraded))'
#    Measured 2026-11-01: `bash degraded:false` on this Linux box, while `tools/broker-serve.mjs --status` printed
#    `BLOCK seat-shell-availability … registered as "bash" and spawns [pwsh, powershell]`. That BLOCK was the
#    instrument reading the VENDORED default (`vendor/pi-main/packages/durable/src/tools/bash.ts:169` `programs ??
#    ["pwsh", "powershell"]`, which belongs to createPowerShellTool) instead of the registry — `createBashTool` hands
#    the string to env.exec. It was fixed in `refs/heads/item-4977` (#4977): section 7 now asks
#    `tools/shell-availability.mjs`, which asks `src/shellregistry.mjs`, and on this box `--status --no-probe` prints
#    `NOTE … the seat shell tool "bash" CAN start on linux — /usr/bin/bash` (measured exit 0, thin worktree; the same
#    command at `43e26dcc` still prints the BLOCK — that difference is the fix, and it is NOT yet on `main`).
#    Proof the shell works: `node demo/seatguard.test.mjs` PASS and `node demo/seattools.test.mjs` PASS in the
#    187-package + vendor/pi-main tree at 238ff91d, and again at `ac5e1d37` in the thin 80-entry worktree (the fix
#    removed the vendor read, so a thin tree is now admissible for THIS instrument). If a `--status` BLOCK names a
#    shell, believe it only when `shellPlan()` in the SAME tree says `degraded:true` — and pin the verdict with
#    `node demo/broker-serve-shell-availability.test.mjs`.
#    Same file, second wrong verdict: `NOTE stranded-intent` counts `op:"read"` health requests left by `cli.mjs status`
#    (both 2026-11-01 spool files are `{"op":"read","view":"health","from":"cli"}`) because line 182 uses `pending`
#    rather than the `intents` filter line 322 introduces. Read the spool files before concluding the channel is jammed.
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
9. **Check the seat's context fraction and its `settledReason` before the NEXT wake.** A seat over 0.88 is in the
   measured break-class edge; `impl` at 0.9041 died mid-turn and the wake bought nothing. If the row is already
   `claimed`, the work survived the death — re-arm, don't re-brief.
10. **Give `node --check` one path per invocation.** It checks only the FIRST path and ignores the rest: two
    deliberately broken files in one call printed only the first and exited 1, so a multi-file call is a false
    green whenever the first file is fine.
11. **Land first, THEN fast-forward the approved seat root, then wake.** `scripts/land.mjs` advances `main` and the
    seat root does not follow, so a brief written before the landing can carry a STOP clause ("STOP unless the root
    equals `main`") that the landing itself trips. Measured 2026-10-31: landing `item-4958` moved `main`
    `7844fcff → 9ee578b1` and left the root one behind; `git -C <root> merge --ff-only main` exit 0, roster dry run
    then printed no drift, and the bare-name inventory diff across the whole session was exactly the removals.
12. **The full demo gate is 48 s, not 10 minutes.** `node scripts/suite.mjs --jobs 8` = 240 demos in 47.8 s in a
    deps-complete tree (measured at `9ee578b1`, shared tree = `main`, `node_modules` + `vendor/pi-main`). Prefer it
    over a derived subset after a landing; name the tree and the dependency set with the verdict, and prove any red
    is pre-existing by checking that its input paths were last touched by ancestors of the PRE-landing tip.
13. **Remove your proof scratch before a landing, and never leave it at the repo root.** `scripts/land.mjs` refused
    the whole pass on one untracked path (`.main-check/`); the stray-worktree gate (#4139) reads the directory
    list, not `git status --porcelain`.

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
D183 and D184 in `docs/DECISIONS.md` (the placement class, the single-sample probes, the empty-reply `done`
settle, the cancel-deposits mechanism, the create-on-read opener, the landing proof pair). Rows #4947–#4950,
#4955–#4960. Timings measured 2026-10-31 in the Diagnose block above. The delegate's ad-hoc probes for this
session live in `.spike/fix-20261101/` and `.spike/fix-20261101b/` and are **gitignored — unpromoted, so they are
already partly lost**; `lead` minted **#4960** to `devtools` to promote them into `tools/`.

# 2c. WHY A RUN DIED — one field, ~2 s, and it beats every shape read. Measured 2026-11-01 (D187):
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/home/chexxor/Git/Durian-Pi/selfdev.sqlite",{readOnly:true});
 for(const [s,c] of Object.entries({pm:3,impl:9,lead:21,scribe:4924,auditor:4936}))
  for(const r of db.prepare("select id,status,record from submissions where conversation_id=? order by id desc limit 2").all(c)){
   const j=JSON.parse(r.record);console.log(s,r.id,r.status,j.reason,JSON.stringify(j.detail||null).slice(0,180));}'
#    `submissions.detail` is the field that names the cause. Four seats were un-sendable overnight and every one of
#    them read "Compaction failed: Summarization hit the token limit; the summary is incomplete" — a summarization
#    OUTPUT budget (compaction.ts:148 = min(0.8*reserveTokens 16384, model maxTokens) and a local seat's maxTokens is
#    DURIG_LOCAL_MAX_TOKENS ?? 8192, src/providers/local.mjs:76), not a window and not a shape. status collapses the
#    same fact to `last_run_failed: model_error` and truncates the rest, so nobody found it for a session.
#    Do NOT hand-query the store for anything else first; this read is the whole diagnosis for the compaction class.
#    A `node:sqlite` readOnly open writes nothing, but the opener CREATES the file if the path is wrong — pin absolute.
