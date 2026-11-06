---
runbook: session-start-cost
symptom: "a session burns its first 30–60 minutes re-deriving rig state that an instrument already reports; the delegate 'verifies' numbers by hand that a tool prints in seconds"
writes: false
precondition: "read-only"
last_verified: 2026-11-05
verified_by: delegate, impl, devtools
evidence: "measured 2026-10-31 on `label-withheld-per-D205` (Linux, node v24.22.1): `cli.mjs queue --json` 1.5 s and 21,710,535 B; `tools/what-to-test.mjs --base=HEAD~1` 0.13 s → 6 derived tests against a 239-test suite; `tools/doc-integrity-guard.mjs` 0.10 s exit 0; `tools/instrument-provenance.mjs` 0.07 s exit 0; `tools/seat-turn-shape.mjs` 3.6 s, 58,566 entries read, 0 writes. One batched `send` to `lead` (8 min) produced rows #4947–#4950 plus three closures; one `impl` turn (70 min) produced three rows. Rows #4947–#4950 exist because a delegate MEASUREMENT was carried to a seat instead of a re-derivation.
  Re-read 2026-11-05 (delegate, main checkout, Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0): the ~7 s clock-in is still the cheap path, and `scripts/clockin.mjs` cost **6,998 ms / 22,537 B printed** at `24fe6c98`; what it CANNOT tell you is whether work exists — at that same commit `queue --status queued` printed `queued rows: 0` while `status` stayed calm and `last_run_failed` named `no_model` for all ten seats. New step 7 below closes that with two one-second reads.
  Re-read 2026-11-04 (impl, `item-4955` worktree, Linux node v24.22.1): the §Preconditions claim about a relative path was understated — a READ at an
  absent path CREATED a 118,784 B store (measured: `readData(...) -> []` with the file present afterwards, `cli.mjs status -> {ok:true, seats:0}` exit 0).
  Fixed in #4955 (`e2a3cb5a`); `node demo/read-no-create-store.test.mjs` exits 0 and `node scripts/test.mjs --all --jobs 8` is 250/250. NOT re-run from this
  thin worktree: the live-store Diagnose reads above, because the pinned `pi-durable@1.3.0` here refuses the live store (`schema version 2 is newer than
  supported version 1`) — from a worktree this shallow, those steps answer with that error, so run them in the seat root.
  Re-read 2026-11-02 (D189, same box): every Diagnose step above still costs the same, but TWO of its reads now print false verdicts — §5's served-window pair (LM Studio has no instance loaded at all) and `scripts/clockin.mjs`'s `## PROVIDER` line — see §7–§9 below.
  Re-measured 2026-11-02 in #4986: the census is **21,927,512 B**, and there is now a row-scoped read — measured on a fixture the same library wrote, the dump grows with the store (126,629 B at 60 rows, 1,114,112 B at 600 rows) while `queue --id`/`show <id>` stays flat at 2,201 B → 2,202 B: 57.5×, then 506× cheaper.
  Re-measured 2026-11-04 in #5079, the re-cut of #4955 onto `main` 7567a0ff (devtools, linked worktree, node v24.22.1): the defect is live on that trunk — with `DURIG_DB` at a path that does not exist, `status`, `queue` and `ps` exit **0** and create a **122,880 B** store answering `{ok:true, seats:0}`, and `log lead` creates the same file while exiting 1. At the re-cut all four exit **1**, create nothing, and name `cause: no_store` with the absolute `db`. `node demo/read-no-create-store.test.mjs` exits 0 at the merged tree. The schema-era byte count moved (118,784 B → 122,880 B); the false verdict did not."
check_rule: "demo/read-no-create-store.test.mjs"
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
`DURIG_DB` when your cwd is not the checkout — `src/config.mjs` reads only `DURIG_*`. It used to be worse than
that: a relative path **silently created** an empty `./rig.sqlite` and the read answered `ok:true` about a rig
the instrument had just manufactured (#4955). That half is closed — the store path is resolved absolutely and a
READ verb refuses a path with no store, `{ok:false, cause:"no_store", db:<abs>}`, and creates nothing, not even
the parent directory (pi-durable's open is what forces creation: `mkdir` + `new DatabaseSync`, with no read-only
mode in the pinned version). `node cli.mjs config` prints the effective values and their source.

## Diagnose (read-only) — this is the whole clock-in read, and it costs ~7 s

```bash
cd /home/chexxor/Git/Durian-Pi
# 1. rows, not the census. Ask for the rows BY ID first — it is one read and it costs only those rows.
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs show 4947 4948 4950 4949   # bodies verbatim; exit 1 + `missing` if an id is absent
#    (the census is 21.9 MB: file it and filter it ONLY when you really want the whole store)
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/<session>/q.json
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
git worktree list | grep ' locked$'                          # terse form: the lock flag is on the SAME line
# 7. the claimable head and the deferral wave — added 2026-11-05, both one queue read (~1 s each), neither in any
#    existing instrument. A green `status` does NOT say whether work exists; these two do.
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status queued | python3 -c "import json,sys;print('queued rows:',len(json.load(sys.stdin)['items']))"      # measured 0 = nothing is claimable
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status deferred | python3 -c "import json,sys;print(len(json.load(sys.stdin)['items']))"                    # measured 183; each row's transitions[] carries {at,by,to,event}, so the wave is dateable WITHOUT any full-feed read
#    Why this row exists: a broker started with --max-duration self-exits, and supervisor deferral parks rows on
#    `human`, which is not a seat — so the histogram can read `done/cancelled/held/deferred` with **no `queued`**
#    while `status` stays calm. Do NOT reach for `cli.mjs events --tail N` instead: `--tail 400` returned **15,425**
#    events (2026-10-11 -> 2026-11-05), `events --since` wants a numeric cursor (`cli.mjs:3455`), and `queue` has no
#    time flag at all (`unknown argument --since=…`) — ROADMAP 291.
#    KNOWN-RED instrument: `tools/channel-preflight.mjs` throws since 8160b8be (#5125 via 807f24a0) because line 57
#    passes the RIG file as DURIG_CONFIG — ROADMAP 293. Absence of preflight output is a crash, not health.
```

## Do
1. **Read rows, never the census.** The status line (`done 3,771 / cancelled 790 …`) is case-insensitive
   noise and is not evidence; the named rows are. Since #4986 the row-scoped read exists: `cli.mjs show <id…>`
   (or `queue --id <id…>`) prints exactly those rows with bodies, and its cost is flat in the size of the
   store (2,201 B measured at both 60 and 600 rows, against a dump of 126,629 B → 1,114,112 B). Reach for
   `queue --json` — 21.9 MB — only when the question is actually about the whole store, and file it then.
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
If an instrument answers `no store at <abs> - reading does not create one`, that is the instrument naming the
file it was pointed at (#4955). Fix the pointer (`DURIG_DB`, or `node cli.mjs config` to see what is in effect);
do not create the path to make the message go away — a store you manufactured is a subject you can then read as
healthy, which is the defect, not the fix.

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

# 7. THE PROVIDER TRUTH — three reads, ~2 s, and the digest is NOT one of them. Measured 2026-11-02 (D189):
curl -s "$(node -e 'console.log(JSON.parse(require("fs").readFileSync("durig.config.json","utf8")).DURIG_LOCAL_BASE_URL)')/v1/models"
ss -ltnp | grep -E '47831|1234|18500'                                   # which ports actually LISTEN
node tools/model-probes/probe-preflight.mjs                              # GO/REFUSE + per-GPU free + swap %
#    `scripts/clockin.mjs` prints `local=NOT SET` and `local endpoint: DOWN (fetch failed)` on a box where the seat
#    engine was up and serving an 8-minute seat turn minutes later. TWO causes, both in source: `describeConfig`
#    (src/config.mjs:328-344) omits every DURIG_LOCAL_*/DURIG_VERIFIER_* key, so clockin.mjs:352 cannot see the base
#    URL; and probeLocal() (clockin.mjs:306) hardcodes `STRATA_PORT || 8080`, so it probes a port this rig does not
#    use. Do NOT spend a wake "fixing" a provider the digest says is down — rows #4977-#4979/#4985-#4987 are the same
#    family (an instrument printing a confidently wrong verdict).

# 8. SUITE VERDICT WITHOUT RUNNING THE SUITE — 0 s. Measured 2026-11-02: the suite is 52-58 s (244 demos, --jobs 8),
#    and `node scripts/test.mjs --red` is NOT a command (no --red flag; exit 2 on the usage block). Write the marker:
#      .spike/delegate/suite-marker.json  = {"pass":N,"total":M,"at":"ISO","main":"<sha>","note":"..."}
#    and `scripts/clockin.mjs` prints `last suite: N/M at <time> (main <sha>)` with a STALE flag against current main.
#    Name the DEPENDENCY SET in the note (187 node_modules entries + vendor/pi-main ≠ a thin 80-entry worktree).

# 9. MAY A MODEL LOAD AT ALL — one read, and it outranks every window argument. Measured 2026-11-02:
node tools/model-probes/probe-preflight.mjs
#    → REFUSE: swap 79% used (max 50%) — zram is the ceiling here, not RAM, with GPU0 (A4000) 16,329 MiB FREE and
#    GPU1 (3090) 94% full because the SEAT engine (`iq3_s`, `gpus:[1]`) now lives on the 3090. Re-derive the GPU
#    assignment every session (0.2 s, `nvidia-smi --query-gpu=index,name,memory.used,memory.total`): the topology in
#    `verifier-model-server.md` is from 2026-10-29 and has since flipped, which changes which verifier file can load
#    at all (flint Q4_K_M 24.17 GB cannot fit the free 16 GB card; ministral Q6_K 11.09 GB can).

# 10. BEFORE ANY WRITE VERB — 0.1 s, and it is the difference between a turn and a `no_model` death:
test -f "$PWD/durig.config.json" && echo "config present" || echo "NO CONFIG IN THIS CWD"
#    `durig.config.json` is gitignored, so NO worktree has one (`item-4977`, `seatroot/item-4955`: absent). A `send`
#    whose cwd is a claimed worktree resolves a config-less rig and settles `{"settledStatus":"unanswered",
#    "settledReason":"no_model","reply":null}` in <20 s with zero tokens. Dispatch write verbs from a tree that has the
#    file (the operator checkout or the approved seat root), and pin DURIG_LOCAL_CONTEXT explicitly when the two
#    private copies disagree (160000 vs 200000 — row #4970 HALF B is the operator's).

# 11. LANDING, WITHOUT LOSING THE SESSION TO THE GATE — measured 2026-11-02, Linux, `main` e2f85719 → c80bd7f0.
#     The cheap reads first, all of them seconds:
#       git merge-base --is-ancestor <branch-tip> main   # per branch: is it ALREADY on main? (4966, 4977 were)
#       git log --oneline main..<branch>                  # what is actually unlanded (and is it a RE-CUT of another?)
#       git diff --stat main...<branch>                   # two branches touching the same files = one is superseded debt
#       git show main:<file> | grep -c <symbol>           # the CONTENT check: ancestry passes even if the block was lost
#       node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 1.5 s: 70 of 89 LANDING rows already fully on main
#     `scripts/land.mjs` counts **untracked** paths as a dirty tree, so an uncited file in `inputs/fetched/` blocks every
#     landing (`?? inputs/fetched/strata-batching.md` blocked the first attempt). Move it to gitignored `.spike/`, do not
#     `git stash`/`clean` (AGENTS.md non-negotiable), and name the move where the next session will read it.

# 12. THE LANDING GATE IS NOT GREEN-ABLE TODAY — so buy the evidence back differently, and say which gate you ran.
#     Measured: `--changed-suite` STOPPED twice on a clean landing. Causes, both environment, both proven by re-running
#     ONE demo in a throwaway detached worktree (`cli.mjs worktree <path>`, then `git worktree remove <path>` — inventory
#     back to 14):
#       demo/clockin-digest.test.mjs:215 → `git rev-list --count main..(no branch)` in the DETACHED scratch (the #4985
#         defect: land that class of fix BEFORE anything gated on it — landing order was load-bearing);
#       demo/local-model-pointer.test.mjs:40 → needs the gitignored `durig.config.json`; GREEN with the four provider vars
#         exported, so **export DURIG_LOCAL_BASE_URL/_MODEL + DURIG_VERIFIER_BASE_URL/_MODEL in the shell that runs the
#         lander**;
#       demo/deepinfra-catalog.test.mjs → no `DEEPINFRA_API_KEY` in this shell (`cli.mjs config` says `unset`).
#     Then land ungated with the note `land.mjs` prints, and compare two FULL suite runs (50-58 s each, and never while a
#     seat is writing): `node scripts/test.mjs --all --jobs 8 --json > before.json` before the landing, same after, and diff
#     the `failed[]` arrays — 243/245 both sides was the evidence that nothing regressed. `main` red-at-HEAD (2 of 245) is
#     why `--suite` cannot pass at all until a known-red baseline exists (minted 2026-11-02).

# 13. PRE-FLIGHT A `send` THE WAY YOU PRE-FLIGHT A LANDING — measured 2026-11-03, Linux, `main` 0cc8c9c1.
#     The two cheapest reads in this rig are the two nobody runs:
#       node tools/seat-turn-shape.mjs                 # 1.1 s, read-only: every seat's `next send: ADMISSIBLE | AT RISK`
#       DURIG_DB=./selfdev.sqlite node cli.mjs status  # seconds: the attention kinds carry the provider's CAUSE
#     Measured: 10 of 12 seats `AT RISK` (6 with a counted-projection parity break), `pm` and `qa` admissible. A
#     pre-flight costs ~1 s; a refused send costs a seat turn AND appends another `pi.user` entry, which makes the next
#     turn less admissible. Run the first before every `send`, not after the third failure.
#     The cause never appears in `cli.mjs log` for these turns — there is no error entry. It is in `status`'s attention
#     detail (`src/readapi.mjs:317-328`, `src/attention.mjs:296`): `repeated_failure` → `model_error: terminated`, and for
#     `auditor` the engine's own words, `While executing CallExpression at line 48, column 32`.
#     And price the DISPROOF of a context hypothesis before you act on it: a tiny probe, a ~38k-token turn, and a
#     120k-token turn against the served endpoint all run on a free local provider (the 120k one answered 200 in 54.1 s).
#     `compact`/`reset`/`doctor`/`resume` are **CLI/broker verbs, not seat tools** (`src/rig.mjs` exposes only
#     `send_work`/`claim_work`/`complete_work`/`revise_work`) — do not spend a send asking a seat to do one.

# 14. THE COMPACTION BAND — and why `compact` is a CAPACITY verb, never a SHAPE verb. Measured 2026-11-03 (D196), Linux:
DURIG_DB=./selfdev.sqlite node cli.mjs status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const j=JSON.parse(s.slice(s.indexOf("{")));
 for(const[k,v]of Object.entries(j.context)){const band=v.window.value-16384; // each seat against ITS OWN window (verifier seats are 24,576)
  console.log(k.padEnd(10),String(v.consumed).padStart(7),"/",v.window.value,"band",band,v.consumed>band?"OVER THE BAND":"under")}})'
#    `thresholdCompaction` (vendor/pi-main/…/harness/generation.js) fires on `estimateContext(view, planned) >
#    DURIG_LOCAL_CONTEXT − policy.reserveTokens`, and durian-pi sets NO compaction policy, so the pinned defaults apply
#    (`reserveTokens 16384, keepRecentTokens 20000` — harness/agent.js:10-15). At 160000 the local band is **143,616**:
#    `lead` 145,429 (over AT REST), `devtools` 143,426, `impl` 143,278 — and `planned` includes the send you are about to
#    append, so "190 under at rest" is not a green light. Read §2c's `detail` FIRST; when it says `Summarization hit the
#    token limit` the failing number is the summary's OUTPUT budget (§2c), and the operator's lever is #4970 HALF B.
#    Two readings that mislead if taken alone: `status.context.consumed` is measured PRE-send and is usage-derived, so it
#    can exceed the declared window after a reset (`architect` 218,645/160,000 = fraction 1.367, `advocate` 9.96) — it is
#    not the live window; and a compaction-class failure costs **zero tokens** while still keeping the `pi.user` entry it
#    was woken with, so every blind retry makes the next turn LESS admissible.
#    A SUCCESSFUL compaction does not restore sendability either: `selectCut` keeps the most recent `keepRecentTokens`
#    = 20,000 (harness/compaction.js:211-234), so the trailing `user` entries survive the cut. Live proof, same store:
#    `impl` head marker `pi.compaction@278205` still projects `user,assistant,user,assistant,user`; `devtools` took
#    `pi.compaction@279624` at 05:19Z and still reports a parity break. **Read the LAST element of the counted projection
#    (§2b), never the head marker.** And `doctor` is an ALIAS of `resume` (`cli.mjs:3102`) — there is no read-only
#    `doctor`; the read-only diagnosis is §2c.
#    THE VERIFIER FAMILY IS WORSE BY CONSTRUCTION (same read, one line): `DURIG_VERIFIER_CONTEXT=24576 − 16384` is a band of
#    **8,192** — the pinned reserve is two thirds of the declared window — and its summary output budget is
#    `min(0.8·16384, DURIG_VERIFIER_MAX_TOKENS=3000)` = **3,000**. So any verifier seat above 8,192 consumed cannot take a
#    turn without a compaction that cannot succeed at 3,000 tokens. Tonight: `qa` 20,110, `architect` 218,645,
#    `advocate` 244,751 are over their own bands; the zeros are seats with no turn recorded. Re-pointing the verifier
#    (#5024/#5015/#5025) must set the context AND the max-tokens pair together, or the same failure walks over to DeepInfra.

# 15. WHO HOLDS THE VERB ON A PARKED ROW — one field pair, 1.5 s, and it deletes a whole coordinator wake.
#    Measured 2026-11-03 (D197), Linux, `main f25075c3`:
#      src/rig.mjs:1223-1245 — `release_work` accepts **the sender OR the recipient** (`item.to !== me &&
#      item.from !== me` is the refusal), and `held → queued` is its only forward edge besides `cancel_work`.
#    So a `held` row addressed to a seat needs NO send to the coordinator that parked it: the recipient releases it
#    inside its own turn. D196 spent a whole session thinking #5027 (pm→devtools) needed `pm` to move; `devtools`
#    holds that verb. Read the pair, not the attention label:
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const j=JSON.parse(s.slice(s.indexOf("{")));for(const i of j.items) if(i.status==="held"||i.status==="deferred")
  console.log(i.id, i.status, i.from+"→"+i.to)})' | sort -k2 | head -40   # 1.5 s; add `| grep -E "^(5027|5028|5029|5030) "` for a named set
#    TWO consequences that are not obvious from either tool: (a) **a `queued` row wakes its seat automatically**
#    (`docs/WORK-ITEM-LIFECYCLE.md:112-115`: queued always wakes, held never does), so while seats are un-sendable,
#    starting `run`/`serve` spends those seats for you — "no broker" is a safety property, not an absence of one;
#    (b) `revise_work` only works on a QUEUED row, so a body you want corrected must be released first.

# 16. THE TWO LOCAL KEYS THAT DECIDE A WAKE — 0.2 s, and they are host files, not repo files. Measured 2026-11-03:
#      DURIG_LOCAL_CONTEXT      (default 65536; this checkout declares 160000) → band = CONTEXT − 16384
#      DURIG_LOCAL_MAX_TOKENS   (UNSET ⇒ 8192, src/providers/local.mjs:76,85)  → summary OUTPUT budget
#    with the band and the summary budget both pinned in §14. `durig.config.json` is **gitignored and exists only in
#    the operator checkout and the approved seat root**, and the two copies are independent — moving one and reporting
#    the change as done is the #4970 drift. Name the file you edited, or use a per-verb environment prefix and say so.

# 17. PRICE AN INSTRUMENT-FIX BEFORE BUILDING IT — 0.3 s, read-only. Measured 2026-11-03 over 18 gate transcripts:
node .spike/delegate-20261102/cleanrescore.mjs   # gitignored probe; row #5022 is the promotion row
#    Prints per-run clean tallies and `TOTAL clean turns 552 | recorded FALSE-ALARM 468 | recorded CLEAN-PASSED 0
#    | declines mis-scored as FALSE-ALARM 15`. That last number is the SIZE of the #5027 defect: the substring
#    collision is real (5 of 12 `DECLINE` phrases contain an `ASSERT` substring, so `declined && !asserted` at
#    gate.mjs:218 is unreachable for those phrasings) but it rescues 15 turns, not 468. **A probe like this turns
#    "the scorer is broken" into "the scorer is broken by 15/552 turns of this kind", which is the only version a
#    fix can be scored against.** Unpromoted probes are gone next session — that is row #5022.

# 18. A SEAT CANNOT SEE YOUR `.spike/` — seed the evidence into the root you dispatch from. Measured 2026-11-03 (D197b):
#    A brief that says "re-run `node .spike/…/probe.mjs`" is inert in the tree the seat wakes in: `.spike/` is
#    gitignored, so it does not travel with `main`, and the seat's cwd is the cwd of the write-side command that
#    wakes it (F12). What worked: copy the probe AND its inputs into the approved seat root's own gitignored
#    `.spike/` at identical relative paths, then **run it there yourself before the send** —
#      cp .spike/delegate-20261102/cleanrescore.mjs <seatroot>/.spike/delegate-20261102/
#      cp .spike/gate/*.json <seatroot>/.spike/gate/            # 37 files, 14 MB
#      cd <seatroot> && node .spike/delegate-20261102/cleanrescore.mjs | tail -1
#    which printed the identical verdict (552 clean turns, CLEAN-PASSED 0, 15 flips) in a different tree — that is
#    also an axis of independence for the claim (execution, not the operator's checkout). Keep it under `.spike/`
#    (SELFDEV "keep the seat root clean"): nothing there is ever committed, and `git status` in the root stayed clean.
#    Two dispatch facts measured in the same breath: `cli.mjs send` prints
#    `send is DEPRECATED (opens a full writing harness = a second owner)` — legal only with **no broker up**, and with
#    a broker the sanctioned form is `node intent.mjs <seat> --body-file <file>`; and the root's branch here is
#    `seatroot/linux`, fast-forwarded with `git -C <seatroot> merge --ff-only main` before the dispatch.

## 19. The pointer has a second, undocumented cap — bytes, not lines (2026-11-03, D198; measured in Linux)

`scripts/clockin.mjs` embeds the `## NEXT SESSION` section of `docs/NEXT.md` **verbatim** into the cold-start digest
(`:39` "verbatim. Nothing else", printed at `:189`, read at `:426`) and the whole digest has a **20,000 B** budget
(`DIGEST_BUDGET_BYTES`, `:37`; enforced at `:463`), which `demo/clockin-digest.test.mjs` asserts with the **live**
`docs/NEXT.md` (`:219`). Measured the same hour: pointer 17,905 B → digest 21,002 B → **suite red**; pointer 17,003 B
→ digest 20,100 B → **still red**; pointer 16,892 B → **green**. So the pointer's practical ceiling is ≈ **16.9 KB**,
while `demo/next-pointer.test.mjs` only caps it at 200 **lines** — a dense 175-line pointer passes one guard and breaks
the other.

**Measure:** `wc -c docs/NEXT.md` before committing a pointer edit, then run **both** `node demo/next-pointer.test.mjs`
**and** `node demo/clockin-digest.test.mjs` (35 s). If a session genuinely has more to hand off than 16.9 KB, cut the
older section into `docs/NEXT-ARCHIVE.md` (the pointer cap rule) rather than shrinking the facts — DECISIONS.md and the
runbooks keep the detail.

**The row to mint** (delegate does not mint): either express the pointer cap in **bytes** in
`demo/next-pointer.test.mjs`, or have clockin **summarize** the pointer (first N lines of §0 only) instead of embedding
it. Until then this coupling is a silent suite red caused by a documentation edit — precisely the class the known-red
baseline (**#4997**) exists to absorb.

### 20. The band the operator's `MAX_TOKENS` ruling opens is now **measured**, not inferred (2026-11-03, Linux, `devtools`)

A compaction fired **mid-turn** and survived: the conversation head marker moved `pi.compaction@279624 →
pi.compaction@280362`, `context.consumed` went **156,614 → 88,069**, and the counted projection still ended
`assistant` (`user,assistant,assistant,user,assistant,user,assistant`). Before the ruling the same compaction died
at the summary output cap and settled `unanswered/model_error` at zero counted tokens. The summary budget is
`min(0.8 × policy.reserveTokens, model.maxTokens)` = `min(13,107, 16,384)` with `DURIG_LOCAL_MAX_TOKENS=16384`.
**Cheap pre-flight pair before any wake (~1.5 s, read-only, run from the rig root):**
`node tools/seat-turn-shape.mjs | grep -A2 "seat devtools"` (read the **last** element of the counted projection)
and `status --json`'s `context.devtools.consumed` compared against **183,616** (= 200,000 − 16,384, the band *with
the prefix*), not 143,616 (the 160,000-declared band). As of the D199 clock-out: ends `assistant`, 88,069 consumed
⇒ **~95,500 of headroom with the prefix**.

### 21. Verifying a clean-side **scorer** change: re-score saved transcripts, on the right axis, and land with two full suite runs

- **Use the instrument, don't reimplement it:** `tools/model-probes/gate.mjs --rescore` re-scores saved transcripts
  with no prompt, no GPU, no API. The arms are selectable (`GATE_SCORER=raw|strip|strip+neg`); **`raw` reproduces
  the pre-fix scorer**, so a "before" number is reproducible rather than a remembered claim.
- **Name the axis AND the denominator.** `gate.mjs`'s clean-side cell is **`cond !== "defect"`** — clean *and*
  neutral. Tallying `cond === "clean"` alone reported **zero** flips for a fix that moves 15–21 turns (553 cells →
  `raw` FALSE-ALARM 502 / CLEAN-PASSED 0; 537 cells → `strip+neg` FALSE-ALARM 460 / CLEAN-PASSED 21 / AMBIGUOUS 5).
  A wrong axis looks exactly like a refutation.
- **Do not import `gate.mjs` from a test** — it has no import guard, so importing it RUNS the gate (GPU, API spend).
  That is why the scorer lists went untested for 24 runs; the fix moved them into
  `tools/model-probes/assertscan.mjs` and the demo fixture-copies its transcript.
- **`--suite` can be unusable for every landing while the tree has no installed dependencies.** `land.mjs … --suite`
  stopped on `demo/commit-discipline-personas.test.mjs` with `ERR_MODULE_NOT_FOUND
  @earendil-works/pi-durable` from `/tmp/durig-discipline-personas-*`; proved a landing-shape defect by running the
  same demo **exit 0** in the operator checkout and **exit 1 in a throwaway detached worktree at plain `main`**.
  Land without `--suite` and prove with **two full `node scripts/test.mjs --all` runs** (base, then merge) and diff
  `failed[]` — 52 s each, and never while a seat is generating. Name the **tree + dependency set** with the count.

### 22. Repairing a seat you cannot send to: `reset` works, `compact` does not, and the number lags by one turn (2026-11-03, Linux)

Symptom shapes, all three measured on this rig: a seat whose **counted projection ends on `user`** (a strict
alternating template refuses another user turn — `tools/seat-turn-shape.mjs` prints `AT RISK`), a seat whose last
turn's `consumed` exceeds its declared window (`advocate` 244,751 / 24,576 = **9.96**; `architect` was 218,645 /
160,000), and a seat whose provider is simply gone (nothing on `127.0.0.1:1234` for the five `verifier/…` seats — not
repairable by any seat verb, see `verifier-model-server.md` and `verifier-serving-headroom.md`).

`compact` is **not** the remedy on this rig while the knobs are unset: `compact architect` returned
`{"state":"no-op","summaryEntryId":null,"window":null,"policy":{}}`. (This is the #4887 family — the three-state
reporting from #4898 is what makes it legible rather than a bare "no entry was written".) The working verb is
`reset`, and it is a **write** verb: no broker must be up, and a `--dry-run` preview (`{"wouldReset":true,
"writes":0}`) costs nothing.

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs reset --dry-run <seat>
DURIG_DB=./selfdev.sqlite node cli.mjs reset <seat> "<handoff naming the rows and the trunk sha>"
node tools/seat-turn-shape.mjs | grep -A3 "seat <seat>"          # projection becomes (1): user
DURIG_DB=./selfdev.sqlite node cli.mjs status --json | node -e '…project context…'   # still the OLD number
```

**Verify at the seat's next turn, not at the reset:** measured after real turns — `lead` 145,429 → **7,892**;
`architect` 218,645 → **135,567** with `pi.compaction@281000` (a compaction that fired and survived, which is what the
operator's `DURIG_LOCAL_MAX_TOKENS=16384` prefix buys). A handoff is not decoration: name the trunk sha, the row ids,
and the constraints the seat must not re-derive (the delegate's briefs at
`.spike/delegate-20261103c/brief-*.md` are the worked examples). Before resetting a seat that holds **claimed** rows,
check first (`impl` holds #4799 and #4955, so it was left alone unasked).

## 20. The dispatch-channel preflight costs 12 s and is the cheapest true read of "can I wake anyone?" (2026-11-05, D211; measured in Linux)

Before planning any dispatch, run the two reads that answer it directly instead of discovering the refusal mid-send:

```bash
node tools/broker-serve.mjs --dry-run        # ~12 s, READ-ONLY: preflight + the exact start command + findings
test -e "$DURIG_SPEND_LEDGER" && echo "metered spend recorded" || echo "no metered request has ever run"
curl -s -m 5 "$DURIG_LOCAL_BASE_URL/v1/models" | head -c 400   # the ids the endpoint ACTUALLY advertises
grep -o '"DURIG_LOCAL_[A-Z_]*": *"[^"]*"' durig.config.json     # the ids the rig believes
```

What each one buys:

- `broker-serve --dry-run` prints the checkup verdict **and** whether a start would be refused, so the two
  `provider-DURIG_VERIFIER_-*` BLOCKs show up before you commit to a plan that needs the broker. It also prints
  `NOTE stranded-intent: N … the delivery channel, not the backlog, is the critical path` — the single cheapest line that
  says the rig is not delivering work, and `supervisor: escalated` per seat (degeneration) for free.
- The ledger test is how you **prove $0 spent** rather than assert it: a `catalog-refused` / `model-unpriced` refusal
  happens before any request, so on a rig whose `$DURIG_SPEND_LEDGER` file does not exist nothing metered ever ran. Do not
  report a spend number you cannot see in that file.
- The `curl`/`grep` pair catches the class that cost a session to find: an operator restarting a local server changes the
  **advertised model id** (`qwen3.8-flash-next-iq3_s` vs the configured `iq3_s`) while the endpoint happily serves both via
  `/chat/completions`. Availability is the intersection of those two lines, not the completion probe alone.

For queue hygiene, `node tools/queue-drain-audit.mjs --db ./selfdev.sqlite` costs **0.1 s** and is the read that replaces a
hand-count of `queued`: it separates `held` age, non-terminal LANDING rows already fully on `main`, orphan candidates and
unresolvable citations — and `queued` itself is misleading because `notice` rows are counted as claimable work (67 of 162 on
this rig, 2026-11-05).
