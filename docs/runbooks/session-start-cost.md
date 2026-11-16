---
runbook: session-start-cost
symptom: "a session burns its first 30–60 minutes re-deriving rig state that an instrument already reports; the delegate 'verifies' numbers by hand that a tool prints in seconds"
writes: false
precondition: "read-only"
last_verified: 2026-11-08
verified_by: delegate, impl, devtools
evidence: "measured 2026-10-31 on `label-withheld-per-D205` (Linux, node v24.22.1): `cli.mjs queue --json` 1.5 s and 21,710,535 B; `tools/what-to-test.mjs --base=HEAD~1` 0.13 s → 6 derived tests against a 239-test suite; `tools/doc-integrity-guard.mjs` 0.10 s exit 0; `tools/instrument-provenance.mjs` 0.07 s exit 0; `tools/seat-turn-shape.mjs` 3.6 s, 58,566 entries read, 0 writes. One batched `send` to `lead` (8 min) produced rows #4947–#4950 plus three closures; one `impl` turn (70 min) produced three rows. Rows #4947–#4950 exist because a delegate MEASUREMENT was carried to a seat instead of a re-derivation.
  Re-read 2026-11-08 (devtools, `item-5398` linked worktree, Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0): §26's diagnosis shipped as §27. Verify steps actually run: `node demo/clockin-digest.test.mjs` exit **0** (12.8 s), and `node scripts/clockin.mjs --db <snapshot of ./selfdev.sqlite>` printed **15,013 B · exit 0** where the same command at `7a1b80e2` printed **40,161 B · exit 0** (365 deferred rows). NOT re-runnable against the live store while a broker was attached: `cli.mjs status` inside the digest timed out twice at 120 s (`read health: timed out awaiting the broker's result`) — recorded in §27, not fixed here.
  Re-read 2026-11-05 (delegate, main checkout, Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0): the ~7 s clock-in is still the cheap path, and `scripts/clockin.mjs` cost **6,998 ms / 22,537 B printed** at `24fe6c98`; what it CANNOT tell you is whether work exists — at that same commit `queue --status queued` printed `queued rows: 0` while `status` stayed calm and `last_run_failed` named `no_model` for all ten seats. New step 7 below closes that with two one-second reads.
  Re-read 2026-11-04 (impl, `item-4955` worktree, Linux node v24.22.1): the §Preconditions claim about a relative path was understated — a READ at an
  absent path CREATED a 118,784 B store (measured: `readData(...) -> []` with the file present afterwards, `cli.mjs status -> {ok:true, seats:0}` exit 0).
  Fixed in #4955 (`e2a3cb5a`); `node demo/read-no-create-store.test.mjs` exits 0 and `node scripts/test.mjs --all --jobs 8` is 250/250. NOT re-run from this
  thin worktree: the live-store Diagnose reads above, because the pinned `pi-durable@1.3.0` here refuses the live store (`schema version 2 is newer than
  supported version 1`) — from a worktree this shallow, those steps answer with that error, so run them in the seat root.
  Re-read 2026-11-02 (D189, same box): every Diagnose step above still costs the same, but TWO of its reads now print false verdicts — §5's served-window pair (LM Studio has no instance loaded at all) and `scripts/clockin.mjs`'s `## PROVIDER` line — see §7–§9 below.
  Re-measured 2026-11-02 in #4986: the census is **21,927,512 B**, and there is now a row-scoped read — measured on a fixture the same library wrote, the dump grows with the store (126,629 B at 60 rows, 1,114,112 B at 600 rows) while `queue --id`/`show <id>` stays flat at 2,201 B → 2,202 B: 57.5×, then 506× cheaper.
  Re-measured 2026-11-04 in #5079, the re-cut of #4955 onto `main` 7567a0ff (devtools, linked worktree, node v24.22.1): the defect is live on that trunk — with `DURIG_DB` at a path that does not exist, `status`, `queue` and `ps` exit **0** and create a **122,880 B** store answering `{ok:true, seats:0}`, and `log lead` creates the same file while exiting 1. At the re-cut all four exit **1**, create nothing, and name `cause: no_store` with the absolute `db`. `node demo/read-no-create-store.test.mjs` exits 0 at the merged tree. The schema-era byte count moved (118,784 B → 122,880 B); the false verdict did not.
  Added 2026-11-08 (delegate session N8, Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0): **§27** prices the provider preflight that belongs BEFORE `serve --start` — `GET /props` (with the key) prints `total_slots: 3, n_ctx: 204800` for the seat box in ~2 s, and `broker-serve --status` re-run twice costs ~1 s. The avoided cost is measured: with the model server down inside a live window, `deferred` went 207 → 376 and the store's actionable surface collapsed (`queued 123 → 7`, `claimed 35 → 11`) — ~158 rows parked on a human, none of it visible in the broker log."
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

## 23. MAY THIS SEAT BE WOKEN AT ALL — two reads, ~4 s, and they outrank every send decision (2026-11-07T07:2xZ, delegate session N4; Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0)

The failure this prices: the broker **admits** a wake, the provider refuses it before any window is reached, the run never
starts, and `status` reports `admitted_not_started`. Measured live in one bounded pass: **5** such notices, plus
`pass-failed 100% (band 1)` and `repeated_failure pm — 3 consecutive failed runs; the supervisor escalates it to the human`.
**7 of 12 seats** were in that state (pm, impl, qa, scribe, architect, advocate, designer) while their fractions looked
comfortable (pm 0.4546, impl 0.2402, qa 0.1284 of 200,000) — the number that decides it is the **last element of the counted
projection**, not the fraction and not the head marker (§2b, §14).

```bash
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs 2>/dev/null | grep -E "^seat |counted projection" | paste - -
DURIG_DB=./selfdev.sqlite node cli.mjs status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const j=JSON.parse(s.slice(s.indexOf("{")));const k={};for(const n of (j.attention||[]))k[n.kind]=(k[n.kind]||0)+1;console.log(k)})'
```

What each verdict means, measured on this store:

- **projection ends on `user`** → do not send, and do not start a broker pass expecting that seat to act. `resume` clears
  the *notice* (the `placed` submission is settled `unanswered` / `run-cancelled`, `cli.mjs:1328-1356`) but **the `pi.user`
  entry stays** — after a successful `resume` pm went from `user,user,user` to `user,user,user,user`, because the broker
  had already appended another wake. The only working repair is §22's `reset` with a handoff; `compact` answers `no-op`.
- **`SKIP <seat> reason=pending` with no `age=`** in `<db>.broker.log` → the wedge, not a wait: `src/broker.mjs:118`
  suppresses the wake because `pendingConvIds` reads any pending submission as "a run is in flight", and the design note at
  `src/broker.mjs:790-800` says the `placed` submission "stays `placed` forever". Confirm with one **read-only** store read
  (§2c's shape) rather than a send: a `placed` newest submission plus no `selfdev.sqlite.genlock*` entry is the signature.
  Rows **#5215/#5373/#5407** carry the mechanism; the delegate registers none.
- **before any `reset`**, read who holds claimed work — it is a decision about in-flight context, not hygiene (§22's rule,
  measured again here: impl 8 claimed, pm 7, qa 5, scribe 5, devtools 4, lead 3, architect 1):
  `DURIG_DB=./selfdev.sqlite node cli.mjs queue --status claimed` then group by `to`. One read, ~1 s.

And the cost of getting this wrong is not only wall-clock: a pass over un-wakeable seats still woke the **metered** family —
`WAKE auditor` firing while `SKIP auditor reason=pending` printed for it every pass, **$0.008080 across 16 ledger rows in
about four minutes** of broker time. These two reads cost ~4 s.

**The preview of the repair, and its argument-order trap (~0.4 s per seat, writes 0).**
`node cli.mjs reset <seat> --dry-run` → `{"wouldReset":true,"handoff":null,"writes":0}` (measured for all seven
un-sendable seats: no live lease blocks any of them). `node cli.mjs reset --dry-run <seat>` — flag first — answers
`{"wouldReset":false,"reason":"unknown-seat"}` for **every** seat, including real ones. That refusal is the parser's
shape complaint, not the rig's; reporting "the seat cannot be reset" from it would be a false verdict about the store.

## 24. IS THIS PASS PRODUCING WORK? four reads, ~25 s, run them before you spend another hour driving (2026-11-07T09:5xZ, delegate session N5; Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0)

The situation this prices: a broker pass that looks alive — 133 wakes, every seat `SKIP … reason=pending`, the pass
counter climbing — and lands **nothing**. Measured over 130 minutes (07:33:22Z → 09:42Z):
`done +24`, **`claimed 33 → 64`**, **0 commits**, **worktrees 41 → 62 / branches 43 → 63**, and **$0.09892** metered.
None of that is visible in `status`, which reports health, not throughput.

```bash
# 1. concurrency vs the cap (the #5488 specimen): expect 1 on this rig, get 9–10
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});
 console.log("running:",db.prepare("select count(*) n from tasks where status=?").all("running")[0].n,
             "placed:",db.prepare("select count(*) n from submissions where status=?").all("placed")[0].n)'
for i in $(seq 1 20); do ls -1 selfdev.sqlite.genlock* 2>/dev/null | wc -l; sleep 0.4; done   # 0 on every sample = no lease is being taken
# 2. did anything LAND, and how much is waiting to land (pitfall 93 — use refs/heads/, never the bare name)
git log --all --oneline --since=<pass-start-ISO> | wc -l
git for-each-ref --format='%(refname:short)' refs/heads | grep '^item-' |
  while read b; do git rev-list --count "main..refs/heads/$b"; done | awk '{s+=$1}END{print "unlanded commits:",s+0}'
# 3. is the queue converging or just getting claimed? compare claimed against done, both timestamps
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --status done --status claimed | head -c 400   # retry on `SqliteStorage is closed` (pitfall 92)
# 4. what the pass actually cost (the ledger field is `at`, and it only sees the metered family)
node -e 'const L=require("fs").readFileSync("selfdev.sqlite.spend.jsonl","utf8").split(/\n/).filter(Boolean).map(s=>JSON.parse(s));
 const s=L.filter(r=>r.at>=<pass-start-ISO>); console.log(s.length,"calls",s.reduce((a,r)=>a+r.usd,0).toFixed(5),"cumulative",L.at(-1).totalAfter)'
```

Read the verdict this way, measured on this store: **wakes + `reason=pending` with 9–10 `running` generations and 0 lease
files** = the concurrency cap is not gating the provider (`#5488`), so more seats does not mean more throughput;
**`claimed` rising while `git log --all --since` stays empty** = the team is queue-plumbing, not landing, and every claim
is minting a worktree and a branch that #5408 cannot yet reap. The two reads that cost seconds are the difference between
stopping the pass and paying another hour for it.

## 25. IS THE WINDOW STILL ALIVE? three reads that never touch the broker, ~2 s — the only reads that work while a broker is busy or draining (2026-11-07T22:3xZ, delegate session N7; Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0)

The situation this prices: a bounded window (`--max-duration 2100`) that outlived its deadline by 36 minutes because two
generations were still in flight, and a delegate who could not tell, because **every CLI queue read failed** with
`{"ok":false,"error":"read queue-census: timed out awaiting the broker's result"}` (3 consecutive attempts, ~40–60 s
each, from ~21:19Z to 22:21Z; `SqliteStorage is closed` on the rest — pitfall 92). §24's four reads are the right read
**at rest**; mid-window they are unavailable, and burning 6 minutes on retries is how a 35-minute window becomes 76.

```bash
# 1. is anything running, and is work queued for it? (store read, ~0.3 s, no broker round-trip)
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});
 console.log("running:",db.prepare("select count(*) n from tasks where status=?").all("running")[0].n,
             "placed:",db.prepare("select count(*) n from submissions where status=?").all("placed")[0].n);db.close()'
# 2. is the broker alive, and past its bound? (0.2 s)  — the log stops advancing when it enters the drain
ps -eo pid,etime,args | grep '[c]li.mjs serve'; tail -2 ./selfdev.sqlite.broker.log
# 3. is it producing, and what is it costing? (~1 s) — git and the ledger are files, not the store
git log --all --oneline --since=<window-start-ISO> | wc -l
node -e 'const L=require("fs").readFileSync("selfdev.sqlite.spend.jsonl","utf8").split(/\n/).filter(Boolean).map(s=>JSON.parse(s));
 const s=L.filter(r=>String(r.at)>=<window-start-ISO>);console.log(s.length,"calls",s.reduce((a,r)=>a+(r.usd||0),0).toFixed(5),"cumulative",L.at(-1).totalAfter)'
```

Read the verdict this way, all three measured in the 21:05:17Z→22:21:52Z window: **`running > 0` with the broker log's
last `PASS` minutes old** = the broker is draining, not working — no read will succeed until it exits, so decide the
SIGTERM now rather than polling (the exit line will still say `reason=deadline passes=-` whatever caused it, pitfall
100). **`running` above 1 while `DURIG_MAX_CONCURRENT_SEATS=1`** = the cap is not gating the `local/*` providers
(**#5488**; measured 10 concurrent generations), so "wake more seats" buys nothing. **`git log --all --since` rising
while `main` does not move** = the team is producing artifacts on item branches that still need a landing entry — which
is exactly the shape of this window: 4 commits on `item-*` refs, 0 on `main`, and the milestone's landing entry
**#5569** minted in the same pass.

What the trio cannot see: item state. The queue is **one document** (`"durig.queue"`, revisions to seq 3,021,562), not a
table, so there is no SQL for `claimed`/`queued` (pitfall 105). For item state use **one multi-id read** —
`node cli.mjs show 5569 5306 5309 5310 3128 5271` — at rest, not during a drain. A probe that wraps these reads with
read-race retry lives in `.spike/delegate-20261107f/poll3.mjs` (gitignored; needs a `lead` row to promote it to
`tools/`, ROADMAP 233).

## 26. WHAT MAKES THE DIGEST OVERFLOW IS THE DEFERRED LIST, NOT THE POINTER — measure the sections before trimming the pointer (2026-11-07T22:3xZ, delegate session N7; Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0)

Measured at `c7e41021` + one docs commit: the digest printed **28,495 B** against its **20,000 B** budget (#5398's
subject). Split it by section before reaching for the pointer — `scripts/clockin.mjs` prints the whole deferred backlog
inline, and that one list is the bulk of it:

```bash
node scripts/clockin.mjs > .spike/clockin.txt 2>&1
awk '/^## /{sec=$0; next} {n[sec]+=length($0)+1} END{for(s in n) printf "%8d  %s\n", n[s], s}' .spike/clockin.txt | sort -rn | head
```

| section | bytes (measured 22:3xZ) | note |
|---|---|---|
| `## QUEUE` | **15,061** | of which **14,959 B is the single inline `deferred (awaiting the operator)` list** — 52% of the whole digest |
| `## NEXT SESSION` (the pointer) | 7,455 | the section people try to shrink |
| `## READ MAP` | 2,924 | SELFDEV headings, with anchors |
| `## RIG` / `## RUNBOOKS` / `## GIT` | 846 / 769 / 633 | |

The list grows with a store state that itself grows: `deferred` went **174 → 207** in one window, and **206 rows are
`deferredTo:"human"`** (34 of them manufactured by one unkeyed broker pass — pitfall 102). So every supervisor
escalation permanently inflates the cheapest clock-in read. The fix is not a shorter pointer: it is to **aggregate that
list** — per-seat counts plus the ids in a file the reader can grep — and it belongs with `scripts/clockin.mjs`'s
existing digest rows (**#5398**, and the §19 byte-cap family). `lead` should mint it; this section is the measurement,
not the build. **Delivered 2026-11-08T01:3xZ by #5398 — the aggregation shipped; see §27 for the shape, the
measured before/after and the gate.** The `awk` split above is still the 0.2 s way to settle "what should we cut"
when a digest goes over budget again.

Two clarifications about the guard itself, both measured here. (a) `demo/clockin-digest.test.mjs`'s byte assertion runs
against a **fixture** store, so its digest is small and that assert passes while the **live** digest prints 28,385 B —
the live overage is visible only in `scripts/clockin.mjs`'s own stderr warning line. (b) Its
`"the pointer still links its own archive"` assertion is evaluated on the **printed pointer range**, not the whole file:
with the `NEXT-ARCHIVE.md` mention sitting in the header *above* `## NEXT SESSION`, the test was **red at `c7e41021`**
(pre-change digest: 0 occurrences of `NEXT-ARCHIVE`), and naming the archive inside the `## NEXT SESSION` block makes it
green again — one line, no re-derivation. Put the archive link in the pointer body, not the header.

## 27. BEFORE YOU START A WINDOW: prove the provider answers and count its slots — 3 s, and it prevents a 169-row sweep
(2026-11-07T23:5xZ, delegate session N8; Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
git 2.56.0)

Two failures this session cost real rows, and both are visible for seconds before `--start`:

```bash
cd /home/chexxor/Git/Durian-Pi
# 1. is the seat provider actually answering, and how many requests can it take at once? (needs the key, 2 s)
set -a; . "$HOME/.config/durig/env"; set +a
curl -s --max-time 15 -H "authorization: Bearer $DURIG_LOCAL_API_KEY" http://127.0.0.1:8080/props | head -c 200
#    -> {"default_generation_settings":{"n_ctx":204800,...},"total_slots":3,"model_alias":"qwen3.8-flash-next-iq3_s",...}
# 2. is the metered verifier answering? re-run `--status` twice before believing one BLOCK (0.5 s each)
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status | grep -E 'completes|BLOCK'
```

Measured at `total_slots: 3` (Linux, same command as the numbers): **3 concurrent** 96-token completions in
**3,436 ms wall** (individual 3,115 / 3,179 / 3,408 ms) vs **3 sequential in 799 ms** (282 / 257 / 260 ms warm).
So this box genuinely serves three at once now — and `DURIG_MAX_CONCURRENT_SEATS` does not gate `local/*` (#5488),
which is why `running` sits at **9-10** while the cap says 1. Read the two numbers together before "wake more seats":
the slot count is the real concurrency, and the cap is currently a no-op for every seat on this rig.

Why the first read is worth 3 seconds: the operator took the server down mid-window for maintenance and the broker
kept waking seats. The broker log shows only `WAKE` / `SKIP` / `STRANDED settled=N`; the failure is only visible in
`cli.mjs status` attention — `last_run_failed: stranded: Connection error.` + `repeated_failure: 5 consecutive
failed runs` for **9 of 12 seats** — and the supervisor then deferred **169 rows to the human in 25 seconds**
(`deferred 207 -> 376`), including the rows the window existed to land. Repairing that costs a seat turn per lane,
so the 3-second preflight is the whole saving.

What it does not cover: `GET /v1/models` without the key answers `authentication_error: missing or wrong API key`,
which is the same string as the unkeyed-broker incident (pitfall 102). Always probe with the key.

A probe that does both reads and adds the latency shape is at
`.spike/delegate-20261107g/provider-slots-probe.mjs` — **unpromoted** (gitignored, so it may be gone; `docs/NEXT.md`
(F) asks `lead` for the row that moves it into `tools/`). Measured with it at 00:5xZ on this box: `slots 3`,
`qwen3.8-flash-next-iq3_s`, `n_ctx 204800`, 3 concurrent **2,306 ms** vs 3 sequential **905 ms**.
## 28. THE DEFERRED LIST IS NOW AGGREGATED, AND THE BYTE BUDGET IS AN EXIT CODE (2026-11-08T01:3xZ, #5398; Linux, Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

§26's diagnosis shipped. Two changes in `scripts/clockin.mjs`, and one rule about how to make a byte guard stop
being decorative:

1. **Aggregate, do not shorten.** `deferredTerm()` prints `deferred (awaiting the operator): N rows across M seat(s)`
   + one `seat=count` per seat + the **2 oldest ids per seat** (a seat works its own backlog oldest-first, the same
   order the broker claims in, so those are the rows it can act on). The bound is **seats**, a design constant, never
   rows: 160 → 4,000 deferred rows grows the inline term by < 200 B, where the old line-per-row shape grows ~10×.
   Under 24 rows the whole list is still printed inline — indirection costs more than it saves on a small backlog.
2. **The bytes move to a file a seat GRES, not a doc a session reads.** All 365 ids go to
   `.durig/clockin-deferred.txt` (gitignored), one row per id: `#id <TAB> seat <TAB> deferredTo <TAB> subject`. The
   digest names the path; it is a **snapshot**, stale the moment the store moves, and the file says so in its header.
   Header lines carry **no real tab characters** — with them, `grep -c -P "\tdevtools\t"` counted **90** while the
   digest said **devtools=89** (measured live); a residue sweep that over-counts by one is worse than no sweep.
   Moving those bytes into `docs/` instead would re-create exactly the cost this tool removes.
3. **The cap is a gate.** Over budget is **exit 1** (was a stderr comment with exit 0). The digest still prints, so
   the session sees why it failed. `--budget <B>` is the seam that makes the cap bite on demand instead of only once
   the store has grown — that is what let the demo prove the gate without a 561 MB store.

Measured on a **snapshot copy** of the live store (561 MB, 5,636 queue rows, 365 deferred rows — a measurement, not a ROADMAP id — pitfall 177), same tree,
same command, both code paths:

| shape | digest bytes | exit | cost (`real`) |
|---|---|---|---|
| old (one inline line per row) | **40,161** | 0 | 10.6 s |
| new (aggregate + snapshot) | **15,013** | 0 | 11.8 s |

Section costs at the new shape: POINTER 7,993 · READ MAP 2,661 · QUEUE 1,562 (deferred term ~1,300 of it) · RIG 760 ·
RUNBOOKS 735 · GIT 634 · PROVIDER 23. So the pointer people wanted to trim is 53% of the digest and the deferred list
was 67% of it.

**The vacuity rule, which is the part to carry to every byte guard:** `demo/clockin-digest.test.mjs` printed
`PASS` for two sessions while the live digest ran 28–44 KB, because its byte assert ran on a **7-row fixture**. §8 of
that demo now builds **160 `deferredTo:"human"` rows** plus a rest-of-digest sized like production (asserted > 10,000 B;
production is ~13,400 B) and asserts the **old** shape is *over* budget at that size. A fixture assertion is only
evidence when the same file shows the pre-fix shape failing on it.

**Not fixed here (measured, routed):** with a broker ATTACHED, the `cli.mjs status` read the digest makes timed out
twice at the 120 s bound (`read health: timed out awaiting the broker's result`), so `node scripts/clockin.mjs` costs
~4 min and fails during a driving window. The 11.8 s figure is the no-broker direct-read path. A gate you cannot run
while the rig is busy is a gate that gets skipped.

**Verify (run it; exit 0 = the shape is intact):**

```bash
node demo/clockin-digest.test.mjs            # exit 0, prints "… NON-VACUOUS at a 160-row deferred backlog …"
node scripts/clockin.mjs --db ./selfdev.sqlite | wc -c   # ≤ 20000 on the live store; exit 1 if it is not
```

## 29. HOW FAR IS THE MILESTONE? two reads, ~2 s total, and neither touches the broker (2026-11-09T10:0xZ, delegate session N19; Linux, Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

The session that starts by reading `docs/ROADMAP.md`'s 6,300 lines to work out "where are we" is spending the
session, not measuring it. Two committed probes answer it directly:

```bash
node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite   # 1.6 s, exit 1: 3 PASS, 1 PARTIAL, 4 FAIL
node docs/evidence/2026-11-09-milestone-m5/escape-baseline.mjs              # 0.24 s: 6 of 9 escapes reach no rule
```

Both are read-only (one opens the store `readOnly: true`, the other imports two `src/` functions and spawns
nothing), so they work with the broker down, no key, no model. `docs/MILESTONES.md` is the ledger they report
into: previous milestone, current milestone, next milestone, and the command that decides each.

**Registered intent that is not yet work, measured in one second.** `node tools/roadmap-queue-coverage.mjs`
(1.0 s, one queue read) prints: queue rows 6,021 — `done=4154, cancelled=873, held=461, deferred=383,
claimed=12, queued=138`; **CLAIMABLE 150**; registered items ≥200: **150**, named by ≥1 row: **54**, with **no**
row naming them: **96**. The last number is the one a session should not guess: roadmap intent without a queue row
is not work, and `cli.mjs status` does not show it. (Measured 2026-11-09; pitfall **207**.)

## 30. THE POINTER IS A CUT, AND THE DIGEST NOW STATES THE CUT (2026-11-10T00:5xZ, devtools, #6067; Linux, Fedora Linux 45, node v24.22.1, git 2.56.0)

`pointerSection()` renders the first `## NEXT SESSION` section verbatim and nothing else — at main `09a94b4c`
that is **lines 25-68 of 182**, so **114 lines are dropped**, and the file's own link to the verbatim history
(`docs/NEXT-ARCHIVE.md`, line 181) sits outside that section. A digest that cuts without saying it cut leaves a
cold session with 44 lines and no route to the rest.

After the verbatim section the renderer now prints:

```
pointer tail: lines 69-182 of 182 NOT rendered; full history verbatim: Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
``

The line is **derived from the file**, not hard-coded: strip the archive link from the source and the digest loses
it — the demo asserts that direction too, so the check cannot go vacuous.

**Verify (ran 2026-11-10; exit codes from the run):**
```bash
node demo/clockin-digest.test.mjs   # exit 0; RED at 09a94b4c: "the pointer still links its own archive"
node -e "import('./scripts/clockin.mjs').then(m=>{const p=m.pointerSection(require('node:fs').readFileSync('docs/NEXT.md','utf8'));console.log(p.start,p.end,p.fileLines,'tail',p.tail)})"   # 25 68 182 tail 114
```

**The one number these do NOT give you, and the read that does.** Cache economics are not in the spend ledger —
`selfdev.sqlite.spend.jsonl` records `cached_tokens: 0` on all 2,030 rows because a row is only written for a
*metered* endpoint. The durable entries carry the real usage. `.spike/delegate/usage-census.mjs` reads it in about
2 s and prints per-model hit rates (DeepSeek-V4.1-Flash-1017 99.3%, the seat model 88.6%, the verifier 0.0% over
1,476 turns). That probe is gitignored; promoting it into `tools/` is a row from `lead` (ROADMAP **349**, the
same promotion rule as **312**) — until it is promoted, the next session re-derives it, and the runbook's snippet
in `docs/runbooks/milestone-gate.md` is the copy that survives.

## 31. THE LANDING PLAN IN ONE CALLED COMMAND — AND THE TWO NUMBERS THAT PROVE THE FLEET IS NOT LANDING (2026-11-12T10:35Z, delegate; Linux, Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

Two reads tell you whether the team is closing work or only minting branches. Run them in **one** bounded call:

```bash
git rev-parse --short main; git for-each-ref refs/heads | wc -l; git worktree list | wc -l   # ~0.2 s
```

If `main` is unchanged while refs and worktrees climb tick-over-tick, nothing is landing — the ledger written by
`tools/broker-keepalive.mjs` (`.spike/fleet-ledger.jsonl`, one JSON per minute: `refs=`, `itemBranches=`,
`worktrees=`) is the time series to diff. Measured 2026-11-12: refs **114 → 118** and worktrees **104 → 108** in
six minutes with `main` pinned at `60380781`.

The plan itself, not the diagnosis:

```bash
node tools/landing-batch-plan.mjs --max 12      # 12.5 s, exit 0 — ~10 s is branch-census, 67 merge-tree calls
```

Prints every ref that needs a landing decision packed into **verified merge chains** with the exact
`node scripts/land.mjs <refs> --suite` command for each bin (measured: 53 refs → bins 12,12,12,12,4,1, 101 commits
ahead, 0 unlandable). `--pairwise` adds the O(n²) conflict-pair diagnostics if you want the pairs, not the order.

**What it does not tell you:** whether a seat has actually run those commands. `main` moving is the only evidence;
the queue rows for landing passes can sit `queued` for hours while the broker is healthy.


## 32. IS THE BACKLOG GROWING — two reads, 2.2 s, and `check` already QUOTES the second one (renumbered from §29 on 2026-11-15, delegate; `df0c891f` registered it as §29, which collided with the `## 29. HOW FAR IS THE MILESTONE?` section already in this file — a cited section number must be UNIQUE, and this file is an append-only journal whose numbers were already out of order; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

The operator's complaint "the queue is overwhelming" now has THREE cheap answers, and only the first is a census:

```bash
DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs   # 2.109 s, exit 1 — split, ages, per-DAY rate, band verdict, plan for pm
node tools/backlog-burn.mjs                              # 0.049 s, exit 0 — the fleet LEDGER's own burn-rate verdict
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json --json 2>/dev/null | grep -o queue-pressure   # 6.1 s, exit 1 — the same two numbers, side by side
```

Read the numbers in that order: the census answers "how much is there, and is it per-DAY mint outpacing close"
(measured 2026-11-15: `net +719 (273.71/d minted, 171/d closed, 102.71/d net): GROWING` over 7 d, band 120 vs 1024 open work);
`backlog-burn` answers "what did the fleet record while it was running" — it reads the JSONL ledger, NOT the store, so
its window ends at the newest snapshot (`2026-11-13T22:13:03.207Z` there, 2,136 min before the check that quoted it).
**The gap is an outage of the LEDGER, not of the fleet** (pitfall 390 in `docs/SELFDEV.md`): `tools/broker-keepalive.mjs`
appends only while the broker runs, so a down broker stops the time series and the quote keeps its window and its
staleness caveat in the finding. Do not "reconcile" the two by editing either number; do not quote one without the other
while the broker is down.

**What it does not tell you:** whether the band is the problem or the plan is. The band FAIL is a decision for the
operator (the knobs `DURIG_BAND_PER_SEAT` / `DURIG_MINT_BURST_CAP` / `DURIG_PRESSURE_WINDOW_DAYS` in `src/config.mjs`);
the census's `plan for pm` line is the verb that retires non-work rows, and pm applies it, not the delegate (AGENTS.md).

## 33. THE CLOCK-IN DIGEST HAS 19 BYTES OF HEADROOM — AND THE COMMIT TABLE IS NOT IN IT (2026-11-15, delegate at `508d1ea25`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

Pitfall 392 says the digest has a byte budget and that the budget reads `docs/NEXT.md` verbatim. It does not say
WHERE it reads, and that is the whole difference between paying the budget and fighting it. Two reads, 6 s:

```bash
node scripts/clockin.mjs > /dev/null; echo $?
node scripts/clockin.mjs --json > .spike/clockin.json; node -e 'const j=require("fs").readFileSync(".spike/clockin.json");console.log(Buffer.from(JSON.parse(j).text).length)'
```

Measured at `508d1ea25` on 2026-11-15: the digest is **19,981 B of the `DIGEST_BUDGET_BYTES = 20000`** budget at
`scripts/clockin.mjs:46` — **19 B of headroom**, exit 0. The `--json` pointer field says
`docs/NEXT.md lines 71-127 of 127`, so the slice is the `## NEXT SESSION` block ONLY:

- **the commit table (lines 1-70) costs the budget ZERO bytes** — a table row can be added byte-free, and a row that
  must be moved out to pay the budget can equally be moved INTO the table;
- **prose inside the `## NEXT SESSION` block costs byte for byte** — that is where the budget actually lives;
- **every new `## heading` in `docs/SELFDEV.md` costs ~300-430 B** — the digest prints the heading map (`SELFDEV (4936
  lines, headings below)`), so adding a pitfall heading needs a compensating move of the same size, or `scripts/clockin.mjs`
  exits 1 and no session can clock in;
- `docs/runbooks/*.md` bodies are NOT in the digest (only the staleness probe's one-line summary), so **a state read
  written into a runbook is free**, while the same sentence written into NEXT.md is not — which is why the new cheap
  reads go to this file and not to the pointer.

**What this does not prove:** that the headroom stays. `demo/clockin-digest.test.mjs` pins a production figure of
18,367 B against a 5,773-row fixture census; the LIVE store is 7,742 rows and prints 19,981 B, so the demo has 1,633 B
of margin while the real entry point has 19 B. A green digest demo is not evidence the entry point will clock in —
queue row `#7290` (claimed, `devtools`) is exactly "the clockin digest test asserts against a stale census — make it
read the live queue". Until that lands, re-measure `node scripts/clockin.mjs` before the first edit to the pointer's
`## NEXT SESSION` block, and move text VERBATIM to `docs/NEXT-ARCHIVE.md` in the same commit (never raise
`DIGEST_BUDGET_BYTES` — the budget is the rule, not a knob).

## 34. IS THE FAN-OUT BUDGET BITING — one census line, ~0.3 s extra on `check`, and it rides the read that already happened (2026-11-15, delegate at `63c7f23a2`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

**Symptom:** a seat's `send_work` came back refused by `mintGate` (burst / lineage / duplicate) and nobody can say
whether the budget is actually biting on the live fleet, or whether the cap has been quietly raised — which is the
inert-default shape ROADMAP 272 rules against. Measured before the seam: `rg -n mintRefusals --glob '"'"'!src/rig.mjs'"'"' --glob '"'"'!demo/**'"'"' .`
returned ONE hit, `docs/ROADMAP.md:6215` (row 378 prose) — the record had a writer and **no reader**, and
`cli.mjs queue --json --no-body` top keys were `projection,ok,command,rows,counts,pool,attention,narrowed,items`.

**The read that now exists (no new tool, no second store read for the view):** `src/rig.mjs` `recordMintRefusal`
writes `queue.mintRefusals`; `cli.mjs queue --json --no-body` carries `mintRefusals` — the **census**
`src/queueclass.mjs` `mintRefusalCensus` derives: `inWindow`, `inWindowByKind` split by
`burst`/`lineage`/`duplicate`/`unknown`, `bySeat`, `newest`, `ledger`, `cap`, `saturated`. It rides the read that
already happened, so `tools/queue-pressure.mjs` pays the same ~1.7-2.0 s it paid before — the census adds ~436 B to
an 18 MB dump, it does not add a read:

```bash
DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs | grep "mint refusals"   # 1.7 s, one line
```

Measured at `63c7f23a2` with the command above: `mint refusals: 0 in 7 d (burst 0, lineage 0, duplicate 0) of 0 on
the ledger`. **A printed zero is a MEASURED zero, not an absent field** — an absent field prints
`NOT MEASURED — the queue view carried no mintRefusals field` and `check`'s finding prints `NOT MEASURED here`;
`ledger: 0` and a missing field are different answers, and only the second one licenses raising a knob.

`check` reads the RAW events through its own read view (`mint-refusals`, added to `src/brokerread.mjs` `READ_VIEWS`)
and derives the SAME census, so the gate and the instrument cannot spell the number differently (#5047). Measured
cost of that read on this store: `node cli.mjs check rig.selfdev.json --json` went 6.413 s -> 6.683 s (**+0.27 s**)
with the same 31 checks and the same 3 error findings.

**Never do:** pull the ledger out of the queue dump (`cli.mjs queue --json --no-body > f` then read `f` whole) —
that file is the whole-store read, 18,270,766 B measured 2026-11-15. And the ledger is bounded by the WRITER at
`MINT_REFUSAL_LEDGER_CAP = 100` events (`src/rig.mjs` `slice(-MINT_REFUSAL_LEDGER_CAP)`), so when `saturated` is
true the `ledger` number is a **FLOOR**, not a total — the older refusals were dropped on the floor.

## 35. IS THE MINT BUDGET PRICED, OR IS IT AN OUTAGE? — one call, 3.3 s, and the number that makes the operator's knob ruling answerable (2026-11-15, delegate at `2566c14ff`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

**The question §34 cannot answer.** §34 reads the ledger of refusals, and an empty ledger is BOTH "the budget
is working and nothing fanned out" and "the cap is so small it would refuse half the fleet, and nobody has
minted since the gate shipped". The other question — is the cap sized to this fleet, or is it an outage wearing
a gate — is answered by replaying the mints THIS STORE recorded inside the window through the shipped rules.

```bash
DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs --price-budget   # 3.3 s, exit 1 (the band verdict is unchanged)
DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs --price-budget --mint-burst-cap 600   # price a CANDIDATE cap
```

Measured at `2566c14ff` on this box, one command: of **1,153 work mints** in the 7-day window (763 notice mints
exempt) the caps as configured would have refused **523 (45.4%)** — burst **506**, lineage **6**, duplicate **11**
— and six seats sit above the 100/seat cap by the shipped `mintedBySeat` (impl 567, pm 474, devtools 264, lead
170, qa 158, scribe 154). `--json` carries the same shape as `mintBudgetPrice` (`work`, `exempt`, `refused` by
kind, `allowed`, `perSeatWindow`, `bandArmed`, `capOverride`).

**Two reads, and which number came from which.** The back-test needs BODY text, so it pays a second bounded read
(`cli.mjs queue --json`, 1.3 s / 32.3 MB measured); the `mintRefusals` census exists only on the `--no-body`
form, because the whole-document form is deliberately unchanged bytes (#5016). The tool prints which read each
number came from; do not "save the second read" by switching the census read to the whole-document form — that
read carries no census, and the line turns into `NOT MEASURED`, which is not zero.

**Never do:** quote a mint cap as "it stops pathological fan-out" without the back-test number next to it. A cap
below the fleet's own window rate stops REAL work; measured here, 45.4% of the window's mints. A priced number
and an unpriced number look the same in prose, and only one of them is a fact about the fleet.

**Addendum (2026-11-15, delegate at `da4a9395`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1): the pair drifts by the MINUTE, not by the session.** Two `--price-budget` calls minutes apart read **519 of 1,147 (45.2%)** then **516 of 1,144 (45.1%)** — burst 499, lineage 6, duplicate 11 — and the census `net` slid +715/7 d -> +714/7 d in the same span. The window is anchored to the wall clock, so every mint that ages past 7 d drops BOTH sides of the fraction, and the ratio barely moves while the pair does. Never diff a quoted pair against a fresh read to hunt for a store change: compare the **exit code**, the **band verdict** and the **census totals** (`rows 7742 · live 1200 = work 1024 + notice 5 + registration 171`), which are window-stable. Costs at this tree: 2.79 s / 2.87 s for `--price-budget`, 1.48 s / 1.52 s plain. Runbook bodies cost the clock-in digest ZERO bytes (only the `## NEXT SESSION` slice is read), so an addendum like this pays nothing — a new `SELFDEV.md` `##` heading would cost it 300-430 B.

## 36. THE KNOB CURVE — what the mint cap refuses at every window and every candidate cap, 20 calls in 60 s (2026-11-15, delegate at `2df624a2`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

§35 prices ONE point (the rig's own cap in the rig's own window). The operator's ruling on
`DURIG_MINT_BURST_CAP` / `DURIG_PRESSURE_WINDOW_DAYS` needs the CURVE, and the curve is 20 bounded calls,
not a guess. Sweep (one loop, exit code captured WITHOUT a pipe):

```bash
time { for w in 3 7 14 30; do for c in 100 200 300 500 600; do
  DURIG_DB=./selfdev.sqlite timeout 60 node tools/queue-pressure.mjs --price-budget --window-days $w --mint-burst-cap $c > .spike/sw.out 2>&1
  grep -E "would have refused" .spike/sw.out | head -1
done; done; }   # 2.5-3.5 s per call (printed by the tool), 65.9 s for the 20 (measured 2026-11-15 at `2df624a2`)
```

Measured refusal rate (of the work mints this store recorded inside the window; every call exits **1** — a
priced budget never changes the band verdict):

| window | work mints replayed | cap 100 | cap 200 | cap 300 | cap 500 | cap 600 |
|---|---|---|---|---|---|---|
| 3 d | 152 | 13 (8.6%) | 13 (8.6%) | 13 (8.6%) | 13 (8.6%) | 13 (8.6%) |
| 7 d | 1,153 | 523 (45.4%) | 212 (18.4%) | 110 (9.5%) | 36 (3.1%) | 36 (3.1%) |
| 14 d | 1,592 | 903 (56.7%) | 490 (30.8%) | 219 (13.8%) | 41 (2.6%) | 41 (2.6%) |
| 30 d | 3,638 | 2,762 (75.9%) | 2,142 (58.9%) | 1,583 (43.5%) | 806 (22.2%) | 648 (17.8%) |

**What the curve says, in the numbers it printed.** (1) The BURST rule is a function of the WINDOW, not only the
cap: at 3 d the busiest seat's window fan-out stays under 100, so burst refuses **0** and the only refusals are
duplicate 12 + lineage 1; at 30 d even a cap of 600 still refuses **587** real mints. (2) The knee at the rig's
7 d window is **between 300 and 500**: 9.5% → 3.1%, and from 500 up the residual is duplicate + lineage only
(3.1%, flat to 600). (3) The `duplicate` and `lineage` legs barely move with the cap (duplicate 11→28 across
100→600 at 7 d) — the cap is the BURST knob and the band is the CHECK signal, two different knobs.

**Caveats that belong next to every row here:** the `duplicate` leg is a LOWER BOUND (a duplicate whose twin sits
outside the window is not counted); the lineage exemption proxy reads a row still `held` as "was minted parked";
the window denominator is anchored to the WALL clock, so these counts slide when the store does not. None of it
is a recommendation: the knob is the operator's (`src/config.mjs`), and this section is the curve, not a decision.

## 37. WHICH COST A `watch --once` PAYS — the same command costs 1.5 s or 10.9 s depending on whether a broker is routing it, and the drift reads as a defect (2026-11-15, delegate at `fbe129ab5`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

**Symptom:** a doc quotes ONE wall clock for `cli.mjs watch --once --human` and the next session measures a number
7× away, so the row looks like a regression. `docs/ROADMAP.md` row **377** shipped `watch --once` at **10.9 s**; the
identical command on this box returned **1.515 s** at `fbe129ab5`. Nothing in the store changed size-wise between the
two readings — the difference is **broker state**, and it is invisible in the row as written.

```bash
# 1) name the broker state in the SAME command as the measurement (303/329's discriminator)
cat selfdev.sqlite.broker.json 2>/dev/null || echo "no broker.json — the read is direct"
# 2) measure the read, exit captured WITHOUT a pipe
t0=$(date +%s%N); DURIG_DB=./selfdev.sqlite node cli.mjs watch --once --human > .spike/watch.out 2> .spike/watch.err; e=$?; t1=$(date +%s%N); echo "exit=$e"; echo "scale=3; ($t1-$t0)/1000000000" | bc
```

Measured on this box, 2026-11-15, with the broker **down** (`selfdev.sqlite.broker.json` absent, no `cli.mjs serve`
process in `ps -o pid,etime,args -C node`): **1.515 s, exit 0, 3,939 B on stdout, 0 B on stderr**, and the footer
still printed the census line (`of the 1200 live rows: 1024 work (537 in the claim lane) · 5 notices (not work) ·
171 ROADMAP registrations · 286 awaiting you`). Row 377's **10.9 s** is the **broker-up** shape.

**The rule for the next reader:** a `watch`/`status`/`queue` cost is only meaningful beside the broker state, and the
two shapes are different reads — a broker-routed read pays the router's turn, a direct read pays the store. Row 329
carries the failure half: against a broker that is **alive but dark** (fresh `heartbeatAt`, frozen `lastPassAt`, no
`genlock.*`) the same command printed **0 bytes on both streams for 90+ s** and exited on the bound, and the read was
*destroyed*, not delayed — so a slow `watch` is not "the store is big", and an empty `watch` is not "nothing is
waiting". When quoting a read cost, write the state with it: `1.5 s (broker down)` / `10.9 s (broker up)`.

**Never do:** re-measure a read cost and overwrite the old number in a row. Keep both numbers and name which shape
each is, or the drift becomes indistinguishable from a regression — which is exactly how 377's `10.9 s` came to look.

**ADDENDUM (2026-11-15 at `af281f2d5`, delegate; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
node v24.22.1, git 2.56.0): a `scripts/test.mjs` area cost is only meaningful beside its `--jobs` flag — a third shape
of the same trap, and the pointer had already written it.** Same tree, same suite, unchanged store, measured in one
window: `node scripts/test.mjs --area check` → **18/18 in 9.4 s** at the harness default (`scripts/test.mjs --list`
usage line: `--jobs <n>` default **8**); `node scripts/test.mjs --area rig --jobs 4` → **98/98 in 24.8 s**; `node
scripts/test.mjs --area docs --jobs 4` → **8/8 in 64.7 s**; `node scripts/test.mjs --area readapi` → **7/7 in 5.9 s**.
`docs/NEXT.md` quoted the same areas as **check 25.9 s, rig 15.7 s, readapi 5.3 s** with **no flag recorded at all** —
a 2.7× swing on `check` that is fully explained by the flag (4 jobs is slower than 8), not by the suite. So:

- **write the flag with the number**, or an area cost is ambiguous by construction: `check 18/18 in 9.4 s (default 8)`,
  `rig 98/98 in 24.8 s (--jobs 4)`. The inference that the quoted 25.9 s ran at `--jobs 4` is *inferred* from the
  slower-job shape, not recorded — which is exactly the defect this addendum names.
- **compare a cost only against the identical command line**, flag included, and re-measure rather than subtract:
  the drift that is a flag is not a regression, and a doc that quotes one bare number makes the two indistinguishable.
- **the same shape applies to broker-state reads:** `cli.mjs watch --once --human` re-measured **1.331 s** at
  `af281f2d5` against this section's own **1.515 s** at `fbe129ab5` — both broker-down, 12 % apart on an unchanged
  store (rows 7742 / live 1200 identical). A shape label (`1.3-1.5 s, broker down`) is the durable claim; the exact
  decimal is a measurement, not a fact about the rig.
- **know the pointer's digest headroom BEFORE writing a truth swap — one bounded call, 14.8 s.** `node scripts/clockin.mjs --budget 1` exits **1** and its stderr prints the EXACT digest size: **`digest is 19993 B`** at `9c4c8700` against `DIGEST_BUDGET_BYTES = 20000` (`scripts/clockin.mjs:46`) — **7 B of headroom**. The human form prints the number only when it is OVER budget, and its `COST … B printed` footer is NOT the digest (**19,708 B printed vs 19,993 B digest** at this tree), so subtracting printed-from-budget reads a failing swap as a legal one. At single-digit headroom, prose must PAY the archive in the SAME commit (pitfall 392: move the paragraph VERBATIM to `docs/NEXT-ARCHIVE.md`), not in the next one. Byte-neutral swaps (`519 of 1,147` -> `516 of 1,144`, `0.29 s` -> `0.34 s`, flag inserted against the alignment padding) cost ZERO and are the cheap shape.
- **table rows cost the digest ZERO bytes because the table sits ABOVE the slice**: at `9c4c8700` the digest is `docs/NEXT.md` lines **134-200 of 200** (clockin's own `--json` fields `pointer.start`/`pointer.end`/`pointer.fileLines`), the `## NEXT SESSION` heading is at line 134, and the pointer table lives at lines **11-122**. This is why pitfall 384's cadence chase costs bytes but costs one commit per pointer commit — a rows-only commit grows the file, not the digest (measured: at `9c4c8700` the digest is **19,993 B** with **112** table rows, all of them above the slice, so no table row is ever inside it). The `--json` form also carries the digest itself in `.text`, so `Buffer.byteLength` of it is the same number without the `--budget 1` trick (22.8 s vs 14.8 s).


## 38. THE CLOCK-IN DIGEST IS A BYTE BUDGET THE POINTER PAYS — read the headroom BEFORE the edit, and the archive is the only free destination (2026-11-15, delegate at `aebebd9f`/`e1c4cfe5`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

**Symptom:** `node scripts/clockin.mjs` exits **1** at session start with `digest is 20053 B, over its 20000 B budget`,
so every session that clocks in pays a debt it did not create, and the number of bytes to cut is unknown until the
debt has already been paid. This window closed it; the chain below is the measurement to reuse, not a fix to re-derive.

Measured in this window, each number from the command that printed it:

- `node scripts/clockin.mjs` at HEAD `b5c0a247` with the working tree mid-move → exit **1**, stderr `digest is 20053 B`
  against `DIGEST_BUDGET_BYTES = 20000`.
- five VERBATIM prose moves out of the slice (`.spike/cut-1.mjs`: the `**Known red:**` paragraph, the tranche-chain
  parenthesis, the `**Suite tally:**` paragraph, the `Run these first` suite comment; `.spike/cut-2.mjs`: the whole
  `**Operator decisions owed.**` paragraph) → the slice measured by `awk -v n="$(grep -n '^## NEXT SESSION$' docs/NEXT.md | cut -d: -f1)" 'NR>=n' docs/NEXT.md | wc -c"` goes **8,539 B → 8,108 B**;
  `node scripts/clockin.mjs --budget 1` → **`digest is 19622 B`**.
- two truth swaps inside the slice (the suite comment and the tally paragraph re-pointed at a run whose own
  PROVENANCE line names the tree) → slice **8,063 B**, `node scripts/clockin.mjs --budget 1` → **`digest is 19577 B`**,
  headroom **423 B**, and `node scripts/clockin.mjs` exit **0** (13.0 s) printing `COST 12931 ms, 19301 B printed`.
- the commit that shipped ONLY the two cadence rows re-measured `node scripts/clockin.mjs` exit **0** (12.98 s) at
  `e1c4cfe5` with a clean working tree — the fourth proof that table rows cost the digest ZERO bytes (§37's fact above).

**The rules this window proves:**

- **Pay the byte budget by MOVING, and prove the move is VERBATIM, not a paraphrase.** The proof that costs nothing:
  put each replacement back into the new file and require the result to be byte-identical to the pre-cut file
  (`back === orig`), and require the archive to contain the moved block (`a2.lastIndexOf(MOVED) >= 0`). A pointer that
  says "moved VERBATIM" without that proof is pitfall 398's shape wearing the coat of a hygiene note.
- **Extract every moved block FROM THE FILE BY INDEX in a `.spike/` script, never retype it.** A retyped anchor fails
  on the file's real typographic characters — the `…` in a chain list and the U+2019 in `cap's` — and a failed move
  script writes **nothing**, so the digest debt reads as unchanged rather than half-applied. `awk`/`sed` line slices
  work; hand-typed `oldText` is what fails.
- **Read the headroom before writing a swap, in one 14 s call:** `node scripts/clockin.mjs --budget 1` exits 1 and
  its stderr prints the exact digest. The human form's `COST … B printed` footer is NOT the digest and is not a fixed
  offset from it: measured in this window it was 19,664 B printed against a 19,945 B digest (mid-move at `b5c0a247`,
  87 B above) and 19,301 B printed against a 19,577 B digest (clean at `e1c4cfe5`, 276 B below), because the footer
  counts the store/git dumps as well and both halves move. Only `--budget 1` states the digest.
- **Headroom in the low hundreds is the state that reopens next window.** Prose in the `## NEXT SESSION` slice pays it
  byte for byte; table rows, `docs/NEXT-ARCHIVE.md`, `docs/SELFDEV.md` bodies, and runbook bodies cost it none. So the
  durable half of a doc edit goes in a body, the actionable half stays in the slice, and the actionable half stays
  short by pointing at the body.

## 39. A DOCS-ONLY COMMIT OWES A PER-AREA TALLY AT THE SHIPPING TREE, NOT A FULL-SUITE TALLY — 108 s for the four carrier areas, 28 s for a `tools/` edit (2026-11-15, delegate at `ed7ed55ec`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0)

The doc gates are cheap, but the honest claim is not "the suite is green" — it is "the area that carries this
pin is green AT the tree this commit ships on". Measured in one window on this box, every number beside the
command that printed it, `--jobs 4` on every area run:

- `node scripts/test.mjs --area rig --jobs 4` **98/98 in 24.8 s** exit 0, 0 `FAILED` lines, `.err` 0 B, artifact
  opens `PROVENANCE tree=c77c65535` (carries `demo/notice-not-work.test.mjs`, the notice/fan-out pin);
- `node scripts/test.mjs --area readapi --jobs 4` **7/7 in 6.1 s** exit 0 (carries `demo/status-view-bound.test.mjs`
  section C2, the census split);
- `node scripts/test.mjs --area check --jobs 4` **18/18 in 10.4 s** exit 0 (carries `demo/queue-pressure.test.mjs`, the gate);
- `node scripts/test.mjs --area docs --jobs 4` **8/8 in 66.9 s** exit 0 (the pointer cap and the digest budget —
  `demo/runbook-diagnose.test.mjs` is almost all of it, §37's point);
- the four together: **108.2 s**, against the full suite's 364 members at ~171.4 s at the tree that tally names.
  A docs carrier that ran the suite paid 63 s to re-verify code it never touched, and its tally still named an older tree.
- For a `tools/` edit the loop is `node scripts/test.mjs --area toolchain --jobs 4` → **42/42 in 27.8 s exit 0**,
  0 FAILED, `.err` 0 B at PROVENANCE `tree=c77c65535`, and the CHEAPER claim for the instrument's own text is the
  derived set: `node tools/what-to-test.mjs --paths=tools/queue-pressure.mjs --run --direct-only` → **8.3 s**,
  "all derived tests passed", `.err` 0 B. Run both when a header's numbers move: the demo proves the assertions,
  the area proves nothing broke around it, and the derived set names which guards read that file.
- Gate set for a docs commit, measured in one call at `ed7ed55ec`: `tools/pointer-sha-coverage.mjs --base 8b5a19e1`
  exit 0 (1.5 s) · `tools/doc-integrity-guard.mjs` **0 hard / 25 soft** exit 0 (0.3 s) · `demo/next-pointer.test.mjs`
  exit 0 (0.03 s) · `node scripts/clockin.mjs --budget 1` prints the digest (**19,612 B of 20000**, 11–13 s) ·
  `node tools/pointer-row-for-predecessor-test.mjs` PASS, `.err` 0 B. Total under 20 s — cheaper than one area.

**The trap this section closes:** a pointer that quotes "363/363 in 171.4 s" as proof its own commit is green is
pitfall 384's lie unless the artifact's PROVENANCE names the tree the commit ships on, and the suite is the wrong
loop for a docs change anyway — it is 1.6× the carrier areas and re-verifies nothing they do not. State the per-area
tallies, each with its PROVENANCE tree, and say explicitly when no full-suite run names the current tree.

## 40. IS A BROKER WINDOW EVEN POSSIBLE? — one SOURCED dry-run names the refusals in 8.4 s, and the zero it leaves behind is not a verdict (2026-11-15, delegate at `ad35570d3`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host measured in the same command as every number here)

Before anyone commissions a lease — including the shortest one — one read says whether a window could run at all. It
is the SAME preflight `--start` runs, without the spawn, so it is read-only and cheap:

```bash
set -a; . "$HOME/.config/durig/env"; set +a          # keys are the rig's own file, mode 0600, out of tree
node tools/broker-serve.mjs --status                 # SOURCED 24.9 s, exit 0, 4 blocking / 5 noted (0.9 s UNSOURCED at `ef21d221c` — §37: the cost names its flags AND its sourcing)
node tools/broker-serve.mjs --start --dry-run        # SOURCED 8.4 s, exit 1 — `DRY RUN — no process started. A start would be refused: provider-DURIG_LOCAL_-model-absent, provider-verifier-refuses-inference, provider-DURIG_LOCAL2_-unreachable, provider-local2-completion-failed`
node tools/stranded-inbox.mjs selfdev.sqlite         # spool shape: 0 pending intent(s), 90 DEAD-LETTER(s) at this window
```

What each leg costs and what it answers, in one call at `ad35570d3`:

| Read | Cost | The question it answers |
|---|---|---|
| `broker-serve.mjs --status` SOURCED | 24.9 s | is a seat turn possible at all? provider reachability, advertised models, and **one real completion per provider**, plus the spool depth and the genlock slots |
| `broker-serve.mjs --start --dry-run` SOURCED | 8.4 s | would `--start` REFUSE, and by which rule? exit 1 with the block list; the identical block list `--start` would die on is printed as `START REFUSED` |
| `tools/stranded-inbox.mjs <db>` | 0.22 s | is there an intent to drain? at this window `inbox=0 drainStranded=0 resultFiles=2` — NOTHING spooled, so a lease would deliver no intent, and `progressAgeS=53499` says the pass loop has been idle since the last run exited |

**Read it before the lease, not after.** Every queue instrument in this goal degrades silently while the channel is
refused: `tools/backlog-burn.mjs` (0.04 s, exit 0) quotes a ledger window whose newest snapshot ages by the minute
(**2,941 min** at `ad35570d3`), and `tools/queue-pressure.mjs` prints `mint refusals: 0 in 7 d (burst 0, lineage 0,
duplicate 0) of 0 on the ledger`. A ZERO from a dark channel is a measured fact about the READ, not proof the fan-out
budget fires — the read path is pinned by `demo/queue-pressure.test.mjs` and `demo/notice-not-work.test.mjs` §10, the
write path is only exercised in a window. Say which one you have.

**Who fixes a refusal, and what the fix is not.** The block list decomposes by owner, and none of it is a code change:
an empty meter on a metered family (`answers /v1/models … refused a 1-token completion — HTTP 402: You need positive
balance`) is the operator's funding; a `model-absent` block on a server that COMPLETES is the operator's provider move
(`docs/runbooks/local-provider-down.md:37` — restoring provider values in `rig.selfdev.json` is an OPERATOR call, lead
R1); an EHOSTUNREACH LAN box is the operator's hardware. The delegate's honest report is `a lease is REFUSED`, with the
refusal line quoted, not a lease forced past the preflight.

## 41. THE LEDGER HALF OF THAT DEGRADATION IS NOT THE OPERATOR'S — ONE `--once --no-restart` call refreshes the window in 1.7 s, and the refresh FLIPS the verdict `check` quotes (2026-11-15, delegate, the window after `b11df9b26`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host measured in the same command as every number here)

§40 says the ledger stops being appended while the broker is DOWN, and pitfall 402 says the zero it leaves behind is
not a verdict. What neither says is the half that matters for a delegate: **which half of that degradation needs a
grant.** Appending a snapshot does not. A dark channel makes the fleet ledger stale for two days and nobody asks
whether it needed to.

```bash
stat -c '%y %s' selfdev.sqlite                                            # BEFORE: 2026-11-15 02:28:46.948765114 -0600 810074112
node tools/broker-keepalive.mjs --once --no-restart                        # 1.7 s, exit 0 — ONE snapshot, no broker touched
stat -c '%y %s' selfdev.sqlite                                            # AFTER: byte-for-byte IDENTICAL (no store write)
node tools/backlog-burn.mjs                                                # 0.04 s, exit 0 — the window now ends NOW
```

`--once` takes the snapshot at the top of the loop (`tools/broker-keepalive.mjs:286` is
`snapshot(db, ledger, tick % 10 === 0)`, and `tick = 0` at the first pass, so the queue shape IS in the line), prints
it, and exits at `:314`; `--no-restart` (`:48`, `--no-restart measure only; never stop or start a broker`) skips the
re-arm leg at `:292`. Nothing is stopped, started, killed, claimed, or spent. Measured line, same call as the host:
`2026-11-15T23:36:44.027Z pid=- hb=nulls lastPass=nulls intents=0 refs=55 itemBranches=51 worktrees=29 main=b11df9b26
queued=553 claimed=28 held=319 deferred=300 leased=120` — and those four counts are the census's three classes summed
(`537 work + 0 notice + 16 registration = 553 queued`; `20 + 5 = 28 claimed`), which is why the ledger can be
RECONCILED against `tools/queue-pressure.mjs` but cannot be substituted for it.

What the append changed, before and after, on the SAME day and the SAME store:

| Read | Before (newest snapshot 2,964 min old) | After (newest 2 min before the measurement) |
|---|---|---|
| `node tools/backlog-burn.mjs` (0.04 s, exit 0) | `390 rows closed, +166 open rows in the window -> backlog GROWING` over 126 snapshots | `876 rows closed, -284 open rows in the window -> backlog shrinking` over 127/127 snapshots, window `2026-11-12T08:35:19.154Z -> 2026-11-15T23:36:44.027Z` = **5,221 min** |
| `cli.mjs check rig.selfdev.json --json` (6.7 s, exit 1, 31 checks / 131 findings) | quotes the GROWING sentence | quotes the SHRINKING sentence **verbatim**, with its window and `newest snapshot 2 min before this measurement` |

**Read the two rates as two questions, and say which one you are answering.** A refreshed ledger that says
`shrinking` and a census that says `GROWING` are NOT a contradiction and not a defect — they ask different questions
over different spans and different classes:

- The ledger counts **rows by status** across its snapshot span (here 5,221 min). Its `-284 open rows` INCLUDES the
  sweep's notice retirements — a bulk-acknowledge is a closure of a NON-WORK row, so the ledger's rate is class-blind
  by construction, and a sweep reads as burn-down whether or not one work row closed.
- The census (`tools/queue-pressure.mjs`, 1.5 s, exit 1) answers the CLASS question over its own 7 d window: at this
  window `mint 1835 (1112 work, 723 notice) vs close 1144 (730 work, 414 notice) -> net +691 (262.14/d minted,
  163.43/d closed, 98.71/d net): GROWING` — the WORK-only rate is **+382 rows over 7 d**, which is what a fleet
  decision needs, and the pair slides by the MINUTE (§35, pitfall 398: the window is anchored to the wall clock).
- So: direction over the ledger's span = SHRINKING; direction over 7 d by class = GROWING. Quote both with their span
  and class, or quote neither. `check` already prints both faces in one finding; the sentence inside it is the LEDGER's,
  so a doc that repeats it as "the backlog is shrinking" is quoting a class-blind window.

**What still needs the grant after the refresh:** only the MINTING half. `tools/queue-pressure.mjs` still prints
`mint refusals: 0 in 7 d (burst 0, lineage 0, duplicate 0) of 0 on the ledger` after the append — that zero is about
rows that were never minted, and minting is what the four provider BLOCKs (§40) gate. Refresh the ledger every window
(1.7 s, free); commission a lease only for a mint/ack intent (24.9 s of preflight to find out, then the refusal).

**Cost of keeping the ledger honest:** one snapshot is ~933 B (`325,822 B -> 326,755 B` here), and
`src/fleetledger.mjs` `FLEET_LEDGER_MAX_BYTES = 4_194_304` bounds the read with truncation reported, so a session
can append dozens without making a reader drift.

**Worth spending next, and who owns it:** the ledger line carries only `byStatus`, so the class-blindness above is a
format fact, not a reading error. Growing `snapshot()` to carry the census split (`work` / `notice` / `registration`)
would let `tools/backlog-burn.mjs` print a WORK-only rate — a `tools/`-plane change (§39's loop: `--area toolchain`
42/42, ~28 s; the derived guard set is the cheaper claim), owned by a seat/pm, not by the delegate, and older lines
missing the field must read as "class unknown", never as zero.

## 42. THE OWED CARRIER TALLY AT A CLOSED TREE, AND THE FOUR CLAIMS RE-VERIFIED IN ~6 s — 64.2 s + 56.9 s for the tally, 6 s for the claims (2026-11-15, delegate at `60840ae9d`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host measured in the SAME command as every number below)

§39 says a docs commit owes per-area tallies AT the tree it closes on. The tree `60840ae9d` closed on had NEVER been
tallied — the previous window shipped the four doc gates and stopped before the area runs, so the tally claim it left
behind was owed, not met. It is closed here in TWO calls, each into an artifact that names the tree:

| the tally | command | what it printed | wall clock | exit | `.err` |
|---|---|---|---|---|---|
| the `docs` area | `timeout 300 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed in 64.2 s**, slowest `demo/runbook-diagnose.test.mjs` 64.1 s (all of it), and the runner stamps `PROVENANCE tree=60840ae9d branch=main node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1` inside the artifact | 64.2 s | 0 | 0 B |
| the derived guard loop | `timeout 180 node tools/what-to-test.mjs --paths=docs/NEXT.md,docs/NEXT-ARCHIVE.md,docs/SELFDEV.md,docs/runbooks/session-start-cost.md --run --direct-only` | **16/16 PASS**, `all derived tests passed`, 32 guards considered (16 direct + 16 mention), `changed: 4 path(s) · doc-only: YES` | 56.9 s | 0 | 0 B |

Artifacts `.spike/area-docs-60840ae9d.out` and `.spike/what-to-test-60840ae9d.out` (each with its `.err`). The asymmetry
worth recording: **`scripts/test.mjs` prints the PROVENANCE line itself, so the tree is stamped by the tool, not by the
scribe; `tools/what-to-test.mjs` does NOT**, so that artifact carries the tree in its FILE NAME only. A tally with
neither is un-checkable (§39); a tally whose tree drifted is pitfall 398's staleness shape.

**The tranche's four shipped claims, re-verified at this tree** (one bounded call each — the point of re-running them
is that the pointer's `Run these first` costs were measured at OLDER trees, and a drifted cost is the same class of
lie as an unstamped tally, pitfall 384):

- `node demo/notice-not-work.test.mjs` → **exit 0, `NOTICE-NOT-WORK TEST PASS (0 failures)`** — task-2's clause (a notice
  is not claimable work, the mint gate refuses it, the recipient's next read acknowledges it with no seat turn) plus
  the §10 cap-refusal legs (`the cap refusal is committed as a transition-shaped event`, `the ledger is still bounded
  at 100, so the cap cannot become a second queue`, `no row was minted by the cap refusal`).
- `node demo/status-view-bound.test.mjs` → **exit 0**, printing exactly 160 B: `STATUS VIEW BOUND OK (fixture 400 rows:
  unbounded 747,627 B -> bounded view 428,201 B shown=200 droppedTerminal=100; --full-queue refused with a count, exit 1)`.
  Read it as the FIXTURE half of task-3; the live half is the footer below.
- `node cli.mjs watch --once --human` → **exit 0**, and the footer names the buckets instead of one number:
  `of the 1200 live rows: 1024 work (537 in the claim lane) · 5 notices (not work) · 171 ROADMAP registrations · 286 awaiting you`.
  The three CLASS buckets sum to the live count EXACTLY (1024 + 5 + 171 = 1200), so `awaiting you` is an ATTRIBUTE of a
  bucket, not a fourth addend — a footer that summed all four would print 1,486 for 1,200 rows.
- `cli.mjs check rig.selfdev.json --json` → **exit 1, 31 checks / 131 findings / 3 errors** — `queue-pressure` (out of
  band: 1024 open work vs a band of 120, `net +686 in 7 d` ≥ one full band, and the finding QUOTES the fleet ledger's
  own sentence with its span: `"876 rows closed, -284 open rows in the window -> backlog shrinking" — the fleet LEDGER
  over 2026-11-12T08:35:19.154Z -> 2026-11-15T23:36:44.027Z (5221 min window, 127 of 127 snapshots)`), `pool-dead-gate`
  (#7660 requires docs, no seat advertises it), `ready-ref-stale` (`item-3570-recut` 33 h against a 24 h SLA — wall-clock
  relative, never a constant). `.err` 772 B = two provider-registration refusals (`catalog-refused`, `registration-refused`),
  not a crash. **The net inside that finding moved `+691` → `+686` across calls the SAME day** (§35 / pitfalls 398/403:
  the window is anchored to the wall clock and slides by the MINUTE) — quote it beside the command that printed it.

**Handing `--paths=` to an instrument that does not read one is a false CLEAN — the fourth face of the flag-family trap
(SELFDEV pitfall 404).** `node tools/instrument-provenance.mjs --paths=<artifact>`, `--paths=/definitely/not/a/path`
and `--nonsense-xyz` all print the SAME 2,178 B census and exit **0** with `PROVENANCE CLEAN (cite drift 2 — soft)`;
its header documents exactly `--quiet` and `--strict-cites`. What this call DOES prove, and the only three questions it
answers: **suite membership is clean — `git=365 disk=365`** (no member vanished from the declared roots — ROADMAP 233's
silent-shrink fact), ROADMAP cites resolve 433 distinct paths with **100 unresolved reported SOFT** (hard only under
`--strict-cites`), and the pinned member count. Bite the count: the suite is **365** members while the pointer's tallies
quote **363** (`tree=16f70cf8`, `tree=880cf030`) and **364** (`tree=e1c4cfe5c`), so a suite tally is re-measured at the
tree it is quoted for, never reused.

**The pointer's two caps, measured BEFORE the edit that follows (§38/§401 — a slice edit costs BYTES, a table row costs a
LINE):** at `60840ae9d` the closer `node tools/pointer-row-for-predecessor.mjs --base=8b5a19e1 --for=HEAD --order` ran in
**3.8 s, exit 0**, over **277 range commits** (carrier exempt `60840ae9d`), wrote **1 row at line 109**, re-audited **0
holes / 0 ordering defects**, and left the digest UNCHANGED at **19,894 B of `DIGEST_BUDGET_BYTES = 20000`** while
`wc -l docs/NEXT.md` went **188 → 189** of the 200-line cap — the row costs a line and ZERO bytes, which is §33/pitfall
392's fact re-proven on a 277-commit range.

**The same two tallies re-run at the tree that CARRIES this section** (`tree=be5165f79`, the commit whose row is in
the pointer table): `timeout 300 node scripts/test.mjs --area docs --jobs 4` → **8/8 in 66.3 s, exit 0, `.err` 0 B**
(slowest `demo/runbook-diagnose.test.mjs` 66.2 s, and the runner stamps `PROVENANCE tree=be5165f79 branch=main
node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1` inside `.spike/area-docs-be5165f7.out`), and the
derived loop → **16/16 `all derived tests passed`, exit 0 in 56.6 s, `.err` 0 B** (`.spike/what-to-test-be5165f7.out`).
The store stayed byte-identical across both runs — `stat -c '%y %s' selfdev.sqlite` = `2026-11-15 02:28:46.948765114
-0600 810074112` — which is the proof that a carrier tally is a READ, not a mutation, and that the two loops cost
**66.3 s + 56.6 s** of a docs window instead of a 171 s suite (§39's point, priced). A docs commit therefore owes
TWO numbers, not one: the tally at the tree it CLOSES on (the row's tree) and the tally at the tree it CARRIES on
(its own); naming only the first is how a docs session comes to believe its own change was never run.

## 43. HOW MUCH OF THE ROADMAP-LEDGER PASS THE REGISTRATION ROWS ACTUALLY ASK FOR — one bounded census, 1.1 s, and the answer is ZERO items (2026-11-15, delegate at `660dd94d`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host measured in the SAME command as every number below)

A seat told "write the 171 registration rows into `docs/ROADMAP.md`" spends the window discovering there is nothing to
write, and the queue row stays open on a question that had no number. The question is a measurement, so it became an
instrument (AGENTS.md rule 2: promote, do not leave it in `.spike/`).

| the read | command | what it printed | wall clock | exit | `.err` |
|---|---|---|---|---|---|
| the gap | `timeout 60 DURIG_DB=./selfdev.sqlite node tools/registration-ledger-gap.mjs > .spike/reggap-meas-660dd94d.out 2> .spike/reggap-meas-660dd94d.err` | `queue rows 7742 · live 1200 = 1024 work + 5 notice + 171 registration · terminal registration 299`; `naming a ROADMAP item 33 · naming NO item 138 · item ALREADY in the ledger 33 · item NOT in the ledger 0`; `DUPLICATES … 0 items`; `THE GAP: none`; `read shape: flagless live rows 1200`; `live registration rows by status: held=135 claimed=3 deferred=17 queued=16`; ledger side = 380 registered items | **1.1 s** (the tool's own cost line) / 1.14 s shell `time` | **0** | 42 B = the shell `time` builtin only, 0 B of tool stderr |
| its pin | `timeout 60 node tools/registration-ledger-gap-test.mjs > .spike/reggap-green-660dd94d.out 2> .spike/reggap-green-660dd94d.err` | **17 ok, 0 FAIL**, `REGISTRATION LEDGER GAP TEST PASS`, store-free (`--fixture=` + `--ledger=`) | **0.17 s** | **0** | 42 B = `time` only, 0 B tool stderr |

**What the answer is, and what it is NOT.** The 171 live registration rows do not ask for a bulk ledger write: **33** name
a `ROADMAP <n>` that is **already** in the 380-item registry, **0** name an item the registry is missing, and **138**
name NO item at all (they are parked intent — subjects read `BACKLOG — hold, do not start`, `CODEmode TIER T0 (BACKLOG …)`).
Duplicates over the LIVE rows are **0** (a `DUPLICATES` count only appears once terminal rows are folded in). So the
residual of that pass is a **de-duplication ruling** and a home for 138 itemless rows — pm's verbs, not a seat's edit.
**DENOMINATOR, printed by the tool and never silent:** it counts NAMES (`ROADMAP <n>` in a subject), not foreign keys —
a row that registers an item without writing that phrase is invisible here. Same caveat as `tools/roadmap-queue-coverage.mjs`,
read in the other direction.

**The read-shape fact the tool prints rather than assumes:** `flagless 1200` of 1200 live rows — NEITHER CLI read carries
the structural `registration` flag (`cli.mjs queue --json --no-body` row keys are `id from to subject optimizedVia status
transitions resultSummary`, and the whole-document form is flagless too), so any classification from a CLI read runs on
`src/queueclass.mjs`'s pattern fallback (`REGISTRATION_RE`, line 32 at this commit). A HAND pattern-match measured
**180** of 1,200 where `classifyRow` says **171** — the 9 are notice subjects carrying registration words, because a
notice is checked BEFORE a registration (`src/queueclass.mjs:25`). A tool that reports class counts must name WHICH read
it used, or its count is a pattern count wearing a class name (SELFDEV pitfall 405).

**Red-first provenance for the pin** (`docs/failing-first-recipe.md` METHOD 1 — test first, confirm RED, then implement,
NO git revert verb): the test was written before the tool and exited **1 / 14 FAIL / 0.16 s** at `tree=b2f4d4833`
(`.spike/reggap-red.out`, `.err` 0 B); re-measured against the finished tool at `tree=660dd94d` it exits **0 / 17 ok**
(0.17 s, `.err` 0 B).

**The carrier tally `660dd94d` owed, and the one repair it forced.** `660dd94d` is a `tools/` commit, so §39 says it owes
per-area tallies at its own tree. Running the area BEFORE the manifest knew about the new member is the failure mode:
`timeout 120 node scripts/test.mjs --area toolchain --jobs 4` → **41/42 in 27.7 s, exit 1**, `FAILED: demo/test-areas.test.mjs`,
naming it — `manifest does not cover the suite: "tools/registration-ledger-gap-test.mjs" is on disk but not mapped to any
area (add it to demo/test-areas.json)`. Membership is DATA in `demo/test-areas.json` and the rule that fires lives in the
`toolchain` area itself, so mapping the member there is the fix: after it, **43/43 in 25.8 s, exit 0**, `PASS tools/registration-ledger-gap-test.mjs (0.2s)`,
PROVENANCE `tree=660dd94d5` (`.spike/area-toolchain-660dd94d.out`). `node tools/instrument-provenance.mjs --quiet` then prints
**`suite members: git=366 disk=366`** and `PROVENANCE CLEAN` in 0.4 s, exit 0, `.err` 0 B — the count moved from the
**365** §42 quoted at `60840ae9d`, which is pitfall 404's point re-fired: a suite tally is re-measured at the tree it is
quoted for, never reused.

**The two backlog verdicts still disagree on this store, and both are true** (§41/§42, restated here because the ledger
pass is what an operator reads next): `node tools/backlog-burn.mjs` quotes the fleet ledger `876 rows closed, -284 open
rows in the window -> backlog shrinking` over a 5,221-min span, while the class-aware census says `net +681 in 7 d …
GROWING` (work-only +382). `cli.mjs check` QUOTES the first inside the FAILING `queue-pressure` finding. Say which
question, span and class a rate answered before choosing either word.

**§43 ADDENDUM (2026-11-16T00:5xZ, delegate at `b5b1f8cbb`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host measured in the SAME command as every number below): the carrier tally AT the tree the docs commit CARRIES, and the FULL suite, which a manifest edit obliges.**
`demo/test-areas.json` is a suite-control path, so `tools/what-to-test.mjs` stopped calling this commit doc-only and said so
literally: `changed: 5 path(s) · doc-only: no` and `not doc-only: 1 non-doc path(s) changed, so the pre-landing gate is the FULL
suite`. Its derived loop still ran first and passed — **19 direct guards (37 considered: 19 direct + 18 family mention), `all
derived tests passed`, exit 0, 63.8 s**, `.err` 0 B (`.spike/derived-b5b1f8c.out`) — and it then named the gate the areas cannot
answer. Measured at `tree=b5b1f8cbb` (this pointer's own commit), each into an artifact whose PROVENANCE the runner stamps:

| the tally | command | verdict | wall clock | exit | `.err` |
|---|---|---|---|---|---|
| FULL suite | `timeout 560 node scripts/test.mjs --all --jobs 4` | **366/366 passed**, slowest `demo/runbook-diagnose.test.mjs` 67.4 s | **167.9 s** | **0** | **0 B** |
| `docs` area | `timeout 200 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed** | 70.8 s | 0 | 0 B |
| `toolchain` area | `timeout 120 node scripts/test.mjs --area toolchain --jobs 4` | **43/43 passed**, `PASS tools/registration-ledger-gap-test.mjs (0.2s)` | 30.4 s | 0 | 0 B |

The suite COUNT is the fact that bites (pitfall 404): **366** members at this tree, against the 365 §42 quoted at `60840ae9d`
and the 363/364 tallies further back — so a quoted tally names its tree AND its member count. The doc gates at the same tree,
one bounded pass: `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit 0 over 281 range commits (verdict `every range commit is
named`, carrier exempt `b5b1f8cbb`), `demo/next-pointer.test.mjs` exit 0, `tools/doc-integrity-guard.mjs` 0 hard / 25 soft exit 0,
`node scripts/clockin.mjs` exit 0 with the digest at **19,853 B of `DIGEST_BUDGET_BYTES = 20000`** (147 B headroom) and `wc -l
docs/NEXT.md` 183 of the 200-line cap. **Cadence, measured:** `node tools/pointer-row-for-predecessor.mjs --base=8b5a19e1 --for=HEAD
--order` ran exit 0 in ~4 s BEFORE each commit and wrote the row the coming commit owes (2 rows at `b5b1f8cbb`, 1 row at the next),
each re-audit printing **0 holes / 0 ordering defects**, `.err` 0 B.

**§43 SECOND ADDENDUM (2026-11-16T01:0xZ, delegate at `02129ec4a`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host measured in the SAME command as every number below): the four doc gates and the three pinned demos, re-measured at the FINAL tree of the window.**
One bounded pass, every exit code captured, `.err` folded into the same artifact: `demo/next-pointer.test.mjs` exit **0**; `tools/doc-integrity-guard.mjs` exit **0** (`0 hard, 25 soft` — the soft set is the pre-existing `docs/DECISIONS.md` duplicate-body pairs, not this window's); `node scripts/clockin.mjs` exit **0** with the digest at **19,965 B of `DIGEST_BUDGET_BYTES = 20000`** (35 B headroom — the pointer is ONE prose clause away from its byte budget again, pitfall 401's rule: measure BEFORE the next slice edit); `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit **0**, `verdict: every range commit is named`, `.err` 0 B; `wc -l docs/NEXT.md` **185 of the 200-line cap**.
The tranche's pinned demos, same pass: `demo/notice-not-work.test.mjs` exit **0** (`NOTICE-NOT-WORK TEST PASS (0 failures)`), `demo/status-view-bound.test.mjs` exit **0** (exactly the fixture line, `unbounded 747,627 B -> bounded view 428,201 B shown=200 droppedTerminal=100`), `tools/registration-ledger-gap-test.mjs` exit **0** (`REGISTRATION LEDGER GAP TEST PASS`), and `DURIG_DB=./selfdev.sqlite node cli.mjs watch --once --human` exit **0** printing `of the 1200 live rows: 1024 work (537 in the claim lane) · 5 notices (not work) · 171 ROADMAP registrations · 286 awaiting you` (the three CLASS buckets sum to 1200 exactly).
**The pointer's `Known red` claim, re-measured rather than trusted:** `node demo/offline.mjs` exit **1** — stdout 483 B (`546 total`, the mocked loop settling `QUEUE #1 [done]` and leaving `QUEUE #2 [queued]` unsettled), stderr 63 B. That red is pm's row #6924, not this tranche's; a session that reads it as "the demo plane is broken" has mistaken a pinned known-red for a regression.

**§43 THIRD ADDENDUM (2026-11-16, delegate at the CLEAN tree `dee33d7d6`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0` — host measured in the SAME command as every number below): the §39 carrier tallies CLOSED at the tree the last pointer commit carries, and the promoted tool's cost DRIFT corrected in place.**
`git status --short -- .` named ONLY the pre-existing untracked `docs/reviews/basic-world-model-implementation-for-agent-team.md` before these runs, so every row below is a CLEAN-tree verdict with the runner's own PROVENANCE stamp `tree=dee33d7d6 branch=main node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1 dependencySet=built-pin pin=main@dd30101cfc5b`:

| the tally | command | verdict | shell wall | exit | `.err` |
|---|---|---|---|---|---|
| FULL suite | `timeout 560 node scripts/test.mjs --all --jobs 4` | **366/366 passed**, slowest `demo/runbook-diagnose.test.mjs` 71.8 s, then `clockin-digest` 28.4 s / `broker-wakepath` 16.9 s / `cli` 16.6 s / `broker-cooperative-stop` 12.7 s | **176.1 s** (176.3 s wall) | **0** | **0 B** |
| `docs` area | `timeout 120 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed** | 68.8 s (68.9 s wall) | 0 | 0 B |
| `toolchain` area | `timeout 90 node scripts/test.mjs --area toolchain --jobs 4` | **43/43 passed**, `PASS tools/registration-ledger-gap-test.mjs (0.2s)` | 28.4 s (28.5 s wall) | 0 | 0 B |

Artifacts: `.spike/suite-dee33d7d.out`, `.spike/area-docs-dee33d7d.out`, `.spike/area-toolchain-dee33d7d.out`, each `.err` 0 B and each first line the PROVENANCE above. **The suite count is 366 at this tree** — the same member count as `b5b1f8cbb`, reached by an unchanged `demo/test-areas.json`; a tally that does not name its tree and its count is the pitfall 404 shape.

**The promoted tool's cost, corrected IN PLACE (AGENTS.md "improve on contact", no second tool):** `DURIG_DB=./selfdev.sqlite timeout 60 node tools/registration-ledger-gap.mjs` → **cost 1.50 s on the tool's own line, 1.544 s shell wall, exit 0, `.err` 0 B** (`.spike/reggap-clean-dee33d7d.out`), printing the same census as §43 above (`queue rows 7742 · live 1200 = 1024 work + 5 notice + 171 registration`, `naming a ROADMAP item 33 · naming NO item 138 · item ALREADY in the ledger 33 · item NOT in the ledger 0`, `THE GAP: none`). The SAME call at `660dd94d` measured **1.10 s / 1.141 s** — so the header's single number `1.39 s` was a 26% lie on a call whose cost follows broker state, the §37 shape one instrument further out: **the header now prints the range 1.1–1.5 s and says re-measure.** The `DUPLICATES` line, which the header had claimed as `13 such items, worst 126 x3, 130 x3, 217 x3`, prints **`0 items`** here and did at `660dd94d` and `b2f4d4833` alike; `rg "126 x3"` across the repo hits ONLY that header, so the claim was unsourced and is replaced by the measured number plus its falsifier. Pinned demo re-ran green standalone at this tree: `node tools/registration-ledger-gap-test.mjs` → **17 ok / 0 FAIL, exit 0, 0.21 s wall** (`.spike/reggap-test-dee33d7d.out`).

**Two shapes this pass adds to SELFDEV pitfall 406 (the heading block renumbered 405 → 405-406, which costs the clock-in digest ZERO bytes because `scripts/clockin.mjs:706-709` builds `selfdevHeadings` as `${l.slice(3, 52)}@${n}` over `/^## /` lines):** (1) the pointer's `**nothing pushed**` wording was true of the delegate's own verbs and FALSE of the repo — `timeout 30 git ls-remote --refs origin main` (exit 0) printed `066f1ed64def777db32c2151a6ebcabaedccb444\trefs/heads/main`, `git rev-list --count origin/main..HEAD` printed **3**, and every doc gate stayed exit 0 because no gate reads the remote; (2) the tool's own header carried an unsourced number that its own live-call line contradicted. Both are corrected from a measurement, not from memory.

**The doc gates and the derived selector at the working tree that becomes this commit** (one bounded pass, host in the same command as the numbers: Linux, `7.2.15-300.fc45.x86_64`, Fedora Linux 45 (Forty Five), node v24.22.1, `git version 2.56.0`): `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit **0**, verdict `every range commit is named`, 0 holes / 0 ordering defects over 285 range commits, `carrier (exempt, cannot name itself): dee33d7d6`, `table rows: 108 in docs/NEXT.md + 237 in docs/NEXT-ARCHIVE.md`, `.err` 0 B (`.spike/cov-44.out`); `demo/next-pointer.test.mjs` exit **0** (`NEXT POINTER TEST PASS … live file within the pointer cap`), `wc -l docs/NEXT.md` **187 of 200**; `tools/doc-integrity-guard.mjs` exit **0** — `0 hard, 25 soft` (`380 items; 65 runbooks; 315 headings, 0 collisions, 0 unnumbered, 25 duplicate-body pairs`; the 25 soft pairs are pre-existing `docs/DECISIONS.md` bodies); `node scripts/clockin.mjs` exit **0** with the digest at **19,831 B of `DIGEST_BUDGET_BYTES = 20000`** — the window PAID 123 B back (19,954 B → 19,831 B) because the Tallies paragraph was swapped in place, not appended, so `node scripts/clockin.mjs --budget 1` prints `digest is 19831 B` and exits 1 by design (169 B headroom now, not 46 B).
**The derived selector, measured, says the full suite is owed here:** `node tools/what-to-test.mjs --paths=tools/registration-ledger-gap.mjs,docs/SELFDEV.md,docs/runbooks/session-start-cost.md,docs/NEXT.md --run` → **exit 2 in 0.244 s**, `changed: 4 path(s) · doc-only: no`, `not doc-only: 1 non-doc path(s) changed, so the pre-landing gate is the FULL suite: node scripts/test.mjs --all (366 tests)`, and it REFUSED to run its own 33 derived guards (`> 25`) — so the areas are a working loop, not the gate. The gate for a comment edit to a `tools/` header is therefore the FULL suite at the tree that carries it: **run it at the shipping tree and quote its PROVENANCE**, which is what the FOURTH addendum below does.

**§43 FOURTH ADDENDUM (2026-11-16, delegate at the CLEAN tree `adba860d9` — the commit that carried the tool-header fix and SELFDEV pitfall 406; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`, measured in the SAME command as every number below): the FULL-suite gate this commit owed, and a suite run that is RED without being broken.**
The tree was clean before the runs (`git status --short -- .` = 1 line, the pre-existing untracked `docs/reviews/basic-world-model-implementation-for-agent-team.md`; `stat -c '%y %s' selfdev.sqlite` = `2026-11-15 02:28:46.948765114 -0600 810074112`, byte-identical across the whole window — no lease, no transition, no seat woken, $0).

| the tally | command | verdict | shell wall | exit | `.err` |
|---|---|---|---|---|---|
| FULL suite, run A | `timeout 560 node scripts/test.mjs --all --jobs 4` | **365/366**, `FAILED: demo/restart-limit-behaviour.test.mjs` (`FAIL restartLimit 5 + 5 crashes: ENDS with restart_limit`, `charged 5, not 3 -- restarts=4`) | 166.0 s | **1** | **1,157 B** |
| FULL suite, run B (same tree) | same command | **366/366 passed**, slowest `runbook-diagnose` 68.4 s | 165.2 s | **0** | **0 B** |
| `docs` area | `timeout 150 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed** | 65.7 s | 0 | 0 B |
| `toolchain` area | `timeout 90 node scripts/test.mjs --area toolchain --jobs 4` | **43/43 passed**, `PASS tools/registration-ledger-gap-test.mjs (0.2s)` | 28.6 s | 0 | 0 B |
| `rig` area x2 | `timeout 200 node scripts/test.mjs --area rig --jobs 4` | **98/98** both runs (21.6 s / 20.9 s) | — | 0 | 0 B |
| the failed member standalone x5 | `timeout 60 node demo/restart-limit-behaviour.test.mjs` | **5/5 exit 0** (~1.4 s each) | — | 0 | 0 B |
| suite membership | `node tools/instrument-provenance.mjs --quiet` | **`suite members: git=366 disk=366`**, `PROVENANCE CLEAN (cite drift 2 — soft)`, 29 worktree registrations | — | 0 | 0 B |

**A suite run that is RED without being broken — the fifth face of the load family, and the rule it forces.** Runs A and B are the SAME command on the SAME clean tree and DISAGREE; the one FAILED member is green 5/5 standalone and 98/98 in its own area twice. Its own fixture already names the shape at `demo/restart-limit-behaviour.test.mjs:119-121` — "under suite load (`--all --jobs 4`) 5 planted crashes charged only 4 restarts — the 6 s poll bound expired before a partial reached storage" — so the red is a **load-induced false failure the fixture already works around, not a regression** (same family as the `broker-health` flake fixed at the fixture in commit `144185c8`). **Rule: a full-suite RED after a docs/tool commit is disambiguated by THREE bounded reads before any code touch — the failed member standalone (1.4 s), its own area (21-29 s), a second full-suite run (165 s) — ~190 s total, against a six-minute hunt for a defect that is not there.** Report such a run as `365/366 + the named flake + the three reads`, never as "the suite is green", and never by hiding `.err` (1,157 B of assertion text is the evidence).
**The gates at this tree, one pass:** `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit **0**, `verdict: every range commit is named`, carrier exempt `adba860d9`; `demo/next-pointer.test.mjs` exit **0**; `tools/doc-integrity-guard.mjs` exit **0**, `0 hard, 25 soft` (380 items, 65 runbooks, 315 headings); `node scripts/clockin.mjs --budget 1` prints **`digest is 19831 B`** (exit 1 by design; the plain call exits **0**) — **169 B of headroom**, unchanged because the window swapped prose in place rather than appending.
**The cost line was falsified AGAIN, one commit later, and widened in place:** `DURIG_DB=./selfdev.sqlite timeout 60 node tools/registration-ledger-gap.mjs` at this clean tree -> **2.31 s** (exit 0, `.err` 0 B, `.spike/reggap-adba860.out`), the SAME census as §43 (`live 1200 = 1024 work + 5 notice + 171 registration`, `item NOT in the ledger 0`, `DUPLICATES 0 items`). Against 1.10 s at `660dd94d` and 1.50 s at `dee33d7d6` that is a **2.1x spread over three clean trees**, so the header now quotes **1.1-2.3 s and says re-measure**: a cost line needs at least THREE data points before it is safe, and a NARROW range is falsified by the very next tree — the session that wrote the narrow range is the session that had to widen it. `node --check tools/registration-ledger-gap.mjs` passes and the pinned demo re-ran **17 ok / 0 FAIL / exit 0** against the fixed file (`.spike/` probes re-run each commit).

**§43 FIFTH ADDENDUM (2026-11-16, delegate at the CLEAN tree `6063d1b56` — the commit that carried the load-flake rule and the byte-budget move; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`, host measured in the SAME command as every number below): the FULL-suite gate at the tree the tool-header fix CARRIES, and the cost line held by a fourth data point.**
The tree was clean before the runs (`git status --short -- .` = the one pre-existing untracked `docs/reviews/...` file; `stat -c '%y %s' selfdev.sqlite` = `2026-11-15 02:28:46.948765114 -0600 810074112`, unchanged — no lease, no transition, no seat woken, $0). Every row below carries the runner's PROVENANCE `tree=6063d1b56 branch=main node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1 dependencySet=built-pin pin=main@dd30101cfc5b`:

| the tally | command | verdict | shell wall | exit | `.err` |
|---|---|---|---|---|---|
| FULL suite | `timeout 560 node scripts/test.mjs --all --jobs 4` | **366/366 passed**, slowest `runbook-diagnose` 70.0 s | 170.5 s | **0** | **0 B** |
| `docs` area | `timeout 150 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed** | 71.4 s | 0 | 0 B |
| `toolchain` area | `timeout 90 node scripts/test.mjs --area toolchain --jobs 4` | **43/43 passed**, `PASS tools/registration-ledger-gap-test.mjs (0.2s)` | 30.0 s | 0 | 0 B |
| the pinned demo | `timeout 30 node tools/registration-ledger-gap-test.mjs` | **17 ok / 0 FAIL / `REGISTRATION LEDGER GAP TEST PASS`** | 0.21 s | 0 | 0 B |
| the instrument | `DURIG_DB=./selfdev.sqlite timeout 30 node tools/registration-ledger-gap.mjs` | **cost 1.40 s**, same census (`live 1200 = 1024 work + 5 notice + 171 registration`, `item NOT in the ledger 0`, `DUPLICATES 0 items`) | 1.4 s | 0 | 0 B |
| suite membership | `node tools/instrument-provenance.mjs --quiet` | **`suite members: git=366 disk=366`** | — | 0 | 0 B |

**The cost line held at the fourth data point, which is the check that makes a range honest rather than a shrug:** the four clean-tree measurements are **1.10 s (`660dd94d`), 1.50 s (`dee33d7d6`), 2.31 s (`adba860d9`), 1.40 s (`6063d1b56`)** — the widened **1.1–2.3 s** covers all four, and the header says RE-MEASURE rather than trusting either end. A cost line with one number is falsified by the next tree; a cost line with a range and no re-measure instruction is falsified the same way, so an instrument's cost line carries BOTH the range and the instruction.
**The pointer's byte budget, measured where it was paid:** mid-edit `node scripts/clockin.mjs --budget 1` printed **`digest is 20465 B`**, over `DIGEST_BUDGET_BYTES = 20000` (`scripts/clockin.mjs:46`); the Blocker's two residual paragraphs (**901 B**) were cut VERBATIM out of the `## NEXT SESSION` slice into `docs/NEXT-ARCHIVE.md` under a dated heading with the proof `pre[:start] + block + pre[end] == pre`, the pointer keeping a 640 B summary that still names both commands and both exit codes. At the shipping file the same call prints **19,948 B (exit 0, 52 B headroom)**; `wc -l docs/NEXT.md` **185 of the 200-line cap**; `demo/next-pointer.test.mjs` exit **0**; `tools/doc-integrity-guard.mjs` **0 hard / 25 soft** exit **0**; `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit **0**, `verdict: every range commit is named`, carrier exempt `adba860d9`, `.err` 0 B. **Cadence, measured:** `node tools/pointer-row-for-predecessor.mjs --base=8b5a19e1 --for=HEAD --order` exit **0** in 3.9 s before each commit, 1 row each time, every re-audit **0 holes / 0 ordering defects**, `.err` 0 B.

**§43 SIXTH ADDENDUM (2026-11-16, delegate at the CLEAN tree `f7254d92d`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0` — host measured in the SAME command as every number below): the tranche's FIVE contracts re-measured at the newest tree, so no row of this section is quoted from memory.**
`git status --short -- .` = the one pre-existing untracked `docs/reviews/...` file; `stat -c '%y %s' selfdev.sqlite` = `2026-11-15 02:28:46.948765114 -0600 810074112` (unchanged — no lease, no transition, no seat woken, $0). Every call below was bounded and its exit code captured:

| the contract | command | what it printed, measured | exit | `.err` |
|---|---|---|---|---|
| task-1 the census instrument | `DURIG_DB=./selfdev.sqlite timeout 60 node tools/queue-pressure.mjs` | `open work rows against a band of 120 (10/seat x 12 seats)`; `net +679 (255.14/d minted, 158.14/d closed, 97/d net): GROWING`; per-seat `impl=439 devtools=239 pm=121 scribe=99 qa=81 lead=23 auditor=11 security=4 qa2=2 advocate=2 unaddressed=2 architect=1`; **`mint refusals: 0 in 7 d (burst 0, lineage 0, duplicate 0) of 0 on the ledger`** — the fan-out budget's READ path, a measured zero because no broker window ran | **1** (out of band, by arithmetic) | 0 B |
| the ledger verdict it QUOTES | `node tools/backlog-burn.mjs` | the fleet ledger's own burn-rate sentence (pitfall 390: ONE derivation, so the gate and the tool cannot spell the verdict differently) | 0 | 0 B |
| task-3 the split view | `timeout 60 node cli.mjs watch --once --human` | footer **`of the 1200 live rows: 1024 work (537 in the claim lane) · 5 notices (not work) · 171 ROADMAP registrations · 286 awaiting you`** — 1024+5+171 = 1200 exactly; `awaiting` is an ATTRIBUTE of the work bucket, not a fourth class | 0 | 0 B |
| task-2 notices are not work | `timeout 60 node demo/notice-not-work.test.mjs` | `NOTICE-NOT-WORK TEST PASS (0 failures)` — the mint gate and the mechanical-ack plan, on the mocked `fauxProvider` plane | 0 | 0 B |
| task-3's pin, the bound | `timeout 90 node demo/status-view-bound.test.mjs` | `STATUS VIEW BOUND OK (fixture 400 rows: unbounded 747,627 B -> bounded view 428,201 B shown=200 droppedTerminal=100; --full-queue refused with a count, exit 1)` | 0 | 0 B |
| the promoted ledger instrument | `DURIG_DB=./selfdev.sqlite timeout 30 node tools/registration-ledger-gap.mjs` | **cost 1.40 s**, `live 1200 = 1024 work + 5 notice + 171 registration`, `naming a ROADMAP item 33 · naming NO item 138 · item ALREADY in the ledger 33 · item NOT in the ledger 0`, `DUPLICATES 0 items`, `THE GAP: none` — the ledger pass asks for ZERO items, so the residual is pm's ruling, not a seat edit | 0 | 0 B |
| the FAILING `check` rule | `timeout 90 node cli.mjs check rig.selfdev.json --json` | exit **1**: the finding set names `queue-pressure` (x4), `pool-dead-gate`, `ready-ref-stale`, `registration-as-work` — "the backlog is growing" is a rule that FAILS, with the census and the refusal read inside it | **1** | 0 B |
| the pointer cadence | `timeout 60 node tools/pointer-sha-coverage.mjs --base 8b5a19e1` | `verdict: every range commit is named`, carrier exempt `f7254d92d`, 0 holes / 0 ordering defects | 0 | 0 B |

**The known red, re-measured rather than trusted:** `timeout 60 node demo/offline.mjs` exits **1** in 0.27 s — stdout **483 B** (`546 total`; `QUEUE #1 [done]` pm→worker, `QUEUE #2 [queued]` worker→pm unsettled), stderr **63 B** = `ASSERT FAIL: the fresh context should be short, got 7 messages`. That is pm's row #6924, not this tranche's; the mocked plane still runs a full pm→worker→done delegation loop in **0.27 s** with no network and no key, which is the fast loop D213 requires.
**What the newest tree does NOT prove, stated rather than softened:** the mint-refusal counters are a **measured ZERO** because `tools/broker-serve.mjs --start --dry-run` SOURCED still REFUSES a lease (four provider rules, §40 / pitfall 402) — funding, model pins and LAN hardware are the operator's. The fan-out budget's WRITE path is pinned by demos only (`demo/queue-pressure.test.mjs` 67 checks, 12 of them new budget legs); no live window has exercised it. Close it with ONE bounded lease once the operator fixes the provider channel: `timeout <= 560`, `nohup timeout --signal=TERM --kill-after=60 <N> node cli.mjs serve --max-duration 3600 &`, then `cli.mjs resume`.

**§43 SEVENTH ADDENDUM (2026-11-16, delegate at the CLEAN tree `ab5c4f1b6` — the docs-only commit that carries this addendum; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`, host measured in the SAME command as every number below): §39's rule PAID at a DOCS-only commit — the PER-AREA pair at ITS tree, 102 s, and the census rate slides while the store does not.**

The tree was clean before the runs (`git status --short -- .` = the one pre-existing untracked `docs/reviews/basic-world-model-implementation-for-agent-team.md`; `stat -c '%y %s' selfdev.sqlite` = `2026-11-15 02:28:46.948765114 -0600 810074112`, byte-identical across the whole window — no lease, no transition, no seat woken, $0). Every row below carries the runner's own PROVENANCE line, unchanged: `tree=ab5c4f1b6 branch=main node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1 dependencySet=built-pin pin=main@dd30101cfc5b`.

| the tally | command | verdict | shell wall | exit | `.err` |
|---|---|---|---|---|---|
| `docs` area | `timeout 150 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed**, slowest `demo/runbook-diagnose.test.mjs` 70.6 s (the other 7 under 0.7 s) | 70.87 s | 0 | **26 B — `/usr/bin/time`'s report line, 0 B from the runner** |
| `toolchain` area | `timeout 90 node scripts/test.mjs --area toolchain --jobs 4` | **43/43 passed**, `PASS tools/registration-ledger-gap-test.mjs (0.3s)`, slowest `demo/clockin-digest.test.mjs` 30.9 s | 30.99 s | 0 | **13 B — the same `/usr/bin/time` line** |

Artifacts, named FROM the disk listing (not from what was typed): `.spike/area-docs-ab5c4f1.out` (778 B) and `.spike/area-toolchain-ab5c4f.out` (2,358 B); `wc -c` of the two `.err` files is 26 B and 13 B, and `cat` of them prints only `wall=70.87 s exit ignored` and `wall=30.99 s`. **So a non-zero `.err` byte count is NOT proof a tool was silent once a shell timer writes into the same artifact — the falsifier is the CONTENT of `.err`, and the tool stderr is the part of it that is not the timer line.** That is pitfall 398's `wc -c` falsifier worn one step thin: it works because the instrument does not print the timer, so the cheapest honest shape is **not to add a timer at all** — `scripts/test.mjs` states its own cost in its last line (`8/8 passed in 70.8s`, `43/43 passed in 30.9s`), which is the number the runner measured, not the one a wrapper guessed.

**§39's number, re-proven at a fifth tree: 102 s for the pair, against 165–170 s for the FULL suite.** The `toolchain` area's cost is now ONE member — `demo/clockin-digest.test.mjs` is 30.9 s of the area's 30.9 s — so a `tools/` comment edit gates in 31 s and the promoted instrument's pin (`tools/registration-ledger-gap-test.mjs`, 0.3 s) is 1% of it; the `docs` area is all `demo/runbook-diagnose.test.mjs` (70.6 s of 70.8 s), the same shape §39 measured at `ed7ed55ec` and §43's THIRD/FIFTH addenda re-proved at `dee33d7d6`/`6063d1b56`. **A DOCS-only commit owes the pair, not the suite; the newest green FULL suite stays `tree=6063d1b56` at 366/366 in 170.5 s exit 0 `.err` 0 B** (§43 FIFTH), and a RED of `365/366` naming `demo/restart-limit-behaviour.test.mjs` is §43 FOURTH's named load flake, disambiguated by three bounded reads (~190 s) before any code touch.

**The promoted instrument's cost line, held by a FIFTH data point, and the census rate that is not store-derived:** `DURIG_DB=./selfdev.sqlite timeout 60 node tools/registration-ledger-gap.mjs` at this clean tree printed **`cost 1.38s`** (exit 0, `.err` 12 B = the timer line, `.spike/reggap-ab5c4f.out`), same census as §43 (`queue rows 7742 · live 1200 = 1024 work + 5 notice + 171 registration`, `naming a ROADMAP item 33 · naming NO item 138 · item ALREADY in the ledger 33 · item NOT in the ledger 0`, `DUPLICATES … 0 items`, `THE GAP: none`); the five clean-tree points are **1.10 / 1.50 / 2.31 / 1.40 / 1.38 s**, so the header's **1.1–2.3 s + re-measure** holds without widening — a range earns a data point per tree, not per session. `DURIG_DB=./selfdev.sqlite timeout 60 node tools/queue-pressure.mjs` exit **1** printed **`net +681 (254.57/d minted, 157.29/d closed, 97.29/d net): GROWING`** and `1024 open work rows against a band of 120 (10/seat x 12 seats), over by 904`, against **`net +679`** measured at `f7254d92d` with the store **byte-identical** — pitfall 398's rolling-window rate, live again (the window is anchored to the wall clock), which is why the pointer quotes the SHAPE and this addendum quotes the number WITH its tree.

**The gates and the pointer caps at this commit, one bounded pass:** `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit **0** — `range 8b5a19e1 (--base)..ab5c4f1b (289 commits)`, `table rows: 111 in docs/NEXT.md + 237 in docs/NEXT-ARCHIVE.md`, carrier exempt `ab5c4f1b6`, `verdict: every range commit is named`, `.err` 0 B (`.spike/cov-50.out`); `demo/next-pointer.test.mjs` exit **0**; `tools/doc-integrity-guard.mjs` exit **0** — `0 hard, 25 soft` (380 items, 65 runbooks, 315 headings, 25 duplicate-body pairs pre-existing in `docs/DECISIONS.md`); `wc -l docs/NEXT.md` **187 of the 200-line cap** before this commit's cadence row; `node scripts/clockin.mjs` exit **0** with the digest at **19,990 B of `DIGEST_BUDGET_BYTES = 20000`** (`scripts/clockin.mjs:46`, **10 B of headroom**) — the window PAID the budget by MOVING the superseded Tallies paragraph VERBATIM into `docs/NEXT-ARCHIVE.md` under a dated heading, proof `pre[:start] + block + pre[end:] == pre`. `git ls-remote --refs origin main` exit 0 → `066f1ed64def777db32c2151a6ebcabaedccb444  refs/heads/main`; `git rev-list --count origin/main..HEAD` → **7** at this commit — **no push BY THE DELEGATE** (pitfall 406's reading, not the delegate's memory).

**§43 EIGHTH ADDENDUM (2026-11-16, delegate at the CLEAN tree `617561fb5` — the commit that carried the `tools/what-to-test.mjs` header fix and the cadence row for `9a94b37c5`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`, host measured in the SAME command as every number below): the FULL-suite gate a `tools/` path OWES, paid at the tree it carries — and the three-loop ladder in ONE tree's numbers.**

| the loop | command | verdict | cost the instrument printed | exit | `.err` |
|---|---|---|---|---|---|
| FULL suite, run A | `timeout 300 node scripts/test.mjs --all --jobs 4` | **365/366 passed**, `FAILED: demo/restart-limit-behaviour.test.mjs` (`FAIL restartLimit 5 + 5 crashes: ENDS with restart_limit`, `FAIL charged 5, not 3 -- restarts=4`) | `365/366 passed in 168.4s` | **1** | **1,157 B of assertion text** (`.spike/suite-617561.err`) |
| the failed member standalone ×3 | `timeout 60 node demo/restart-limit-behaviour.test.mjs` | **3/3 exit 0** | — (silent on both streams) | 0 | **0 B** ×3 (`.spike/restart-alone-{1,2,3}.err`) |
| its own area | `timeout 120 node scripts/test.mjs --area rig --jobs 4` | **98/98 passed** | `98/98 passed in 27.5s` | 0 | **0 B** |
| FULL suite, run B | `timeout 300 node scripts/test.mjs --all --jobs 4` | **366/366 passed** | `366/366 passed in 172.4s` | **0** | **0 B** |
| `docs` area | `timeout 150 node scripts/test.mjs --area docs --jobs 4` | **8/8 passed**, slowest `demo/runbook-diagnose.test.mjs` | `8/8 passed in 67.6s` | 0 | **0 B** |
| `toolchain` area | `timeout 90 node scripts/test.mjs --area toolchain --jobs 4` | **43/43 passed**, `slowest: demo/clockin-digest.test.mjs 26.1s, demo/local-slot-gate.test.mjs 10.9s, demo/gate-clean-scorer.test.mjs 8.7s` | `43/43 passed in 26.9s` | 0 | **0 B** |
| the derived direct tier | `node tools/what-to-test.mjs --paths=docs/NEXT.md,docs/NEXT-ARCHIVE.md,docs/SELFDEV.md,docs/DECISIONS.md,docs/runbooks/session-start-cost.md --direct-only --run` | **exit 0, 19 direct guards, `all derived tests passed`** | **wall 66.29 s** (`.spike/derived-direct-docs.out`, 7,546 B) | 0 | 13 B = one `/usr/bin/time` line, **0 B from the tool** |
| the selector, plan-only | `timeout 60 node tools/what-to-test.mjs --paths=src/seatguard.mjs --json` | exit 0, **12 direct guards**, one JSON doc (17,569 B) | **wall 0.13 s** | 0 | **0 B** |

**Every run above carries PROVENANCE `tree=617561fb5 branch=main node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1`** — the same clean tree, so the two FULL-suite runs A and B are ONE command on ONE tree that DISAGREE. §43 FOURTH's rule paid again at the second tree: a full-suite RED after a `tools/`/docs commit is disambiguated by THREE bounded reads before any code touch — standalone 3/3 (read 1), own area 98/98 (read 2), a second full suite (read 3) — and the fixture already names the shape at `demo/restart-limit-behaviour.test.mjs:121` (`under suite load (--all --jobs 4) 5 planted crashes charged only 4 restarts - the 6 s poll bound expired before a partial reached storage`). **The newest green FULL suite is now `tree=617561fb5` at 366/366 in 172.4 s exit 0 `.err` 0 B** (superseding §43 FIFTH's `tree=6063d1b56` at 366/366 in 170.5 s).

**The ladder, in ONE tree's numbers (this is the shape a session picks a loop from):** derived direct tier **66.3 s** < per-area pair **94.5 s** (67.6 s + 26.9 s) < FULL suite **172.4 s** — and the selector with NO `--run` is **0.13 s** because it only plans. So: plan (0.1 s) → if docs-only, pay the pair at the tree (94.5 s) → if a `tools/` path moved, pay the suite (172.4 s); the direct tier is NOT free (66.3 s) and its cost is the SUM of its own printed per-test times (**27.9 + 11.1 + 8.0 + 4.3 + 3.6 + 3.0 = 57.9 s for the six named members, 65.8 s for all 19**) — never call it sub-second. A `tools/`-only commit can skip the direct tier entirely (the suite is stricter and only 1.8x dearer than the pair).

**The in-place fix this commit carried (AGENTS.md "improve on contact", no second instrument):** `tools/what-to-test.mjs`'s `USAGE` block called `--direct-only` "the sub-second 'did I break the pointer / a runbook?' check"; the 19-guard set misses that claim by ~2 orders of magnitude. Corrected to "MINUTES, not sub-second: 19 direct guards measured 66.3 s on a 5-path docs change set at 9a94b37c5", plus a dated header addendum and `last_verified: 2026-11-16`. **NO behaviour and no assertion moved**: `node --check tools/what-to-test.mjs` exit 0, the `NEVER LAND ON THE SUBSET` banner still prints (grep count 1, and `demo/land-changed-suite.test.mjs:76` asserts the needle `/NEVER LAND ON THE SUBSET/` against the tool's own text — green at 0.9 s in run B, alongside `demo/test-areas.test.mjs` 0.1 s which asserts `tools/what-to-test.mjs` stays a DECLARED exclusion in the suite manifest, `src/testareas.mjs:31`, `demo/landing-gate.test.mjs` 1.2 s and `demo/self-merge-seat.test.mjs` 0.9 s which copy the tool into throwaway repos). `tools/README.md:32` still prints `0.04 s · 0` for the plan-only call against this box's measured **0.13 s** — same-family drift, left as an owed row rather than edited un-gated this commit.

**§43 NINTH ADDENDUM (2026-11-16, delegate at the clean tree `9cf8b83e`; Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`, host measured in the SAME command as every number below): the digest's POINTER slice is a LINE WINDOW, and a TABLE CUT moves it — the §38/§39 "a row costs ZERO bytes" rule has a falsifier the cut itself creates.**

| the read | command | verdict | cost | exit | `.err` |
|---|---|---|---|---|---|
| digest, before the cut | `timeout 30 node scripts/clockin.mjs --budget 1` | `digest is 19948 B` (52 B headroom of `DIGEST_BUDGET_BYTES = 20000`, `scripts/clockin.mjs:46`) | 16.3 s | 0 | 0 B |
| the cut itself | `python3 .spike/cut-43m.py` (8 OLDEST table rows, line slice, proof `pre.replace(block+"\n","",1) == post`) | `docs/NEXT.md` 195 → **187 lines**, −3,468 B | 0.02 s | 0 | 0 B |
| digest, AFTER the cut | `timeout 30 node scripts/clockin.mjs --budget 1` | **`digest is 20041 B` — 41 B OVER budget** | 17.4 s | **1** | 0 B |
| the doc gates after the cut | `tools/pointer-sha-coverage.mjs --base 8b5a19e1` · `demo/next-pointer.test.mjs` · `tools/doc-integrity-guard.mjs` | exit **0 / 0 / 0** — `table rows: 111 in docs/NEXT.md + 245 in docs/NEXT-ARCHIVE.md`, `verdict: every range commit is named`, cap honoured | 1.4 s · 0.04 s · 0.3 s | 0 | 0 B |
| the derived guard loop for a README edit | `timeout 240 node tools/what-to-test.mjs --paths=tools/README.md,docs/NEXT.md --direct-only --run` | exit **0**, **12 direct guards**, `all derived tests passed` — and it covers BOTH demos that read `tools/README.md`: `demo/compaction-acceptance-gate.test.mjs` 2.8 s, `demo/queue-compat-args.test.mjs` 7.0 s | **wall 62 s** | 0 | **0 B** |

**The mechanism, read from the source (`scripts/clockin.mjs:77`), not inferred:** the digest renders `## POINTER (docs/NEXT.md lines N-55..N of N; cap 200)` — the LAST 56 LINES of the file, whatever they happen to contain — plus one line built by `lines.find((l) => /ARCHIVE\.md/i.test(l))`, i.e. **the FIRST line in the whole file that mentions `ARCHIVE.md`, printed in full as `full history verbatim: …`**. That first mention is a commit-table row of 500–700 B, so cutting the 8 oldest rows changes WHICH row prints, and the digest moved **+93 B** for a cut that removed 3,468 B from the file. **So §39's and pitfall 398's "a table row costs the clock-in digest ZERO bytes" is true only while the cut leaves the first `ARCHIVE.md`-bearing row in place** — it was re-proven across many row-only commits because none of them removed that bearer.

**Rule, in order, for the next cap cut:** (1) read the digest BEFORE the cut (`clockin.mjs --budget 1` prints the exact byte count, 16–18 s); (2) cut rows that keep the first `ARCHIVE.md`-bearing row (cut AFTER it), or cut and then RE-READ: a cut that raises the digest needs a second VERBATIM prose move paid in the SAME commit, not a follow-up; (3) the cap and the budget are different gates — the cut above cleared the 200-line cap (187 of 200) and kept all three doc gates exit 0 while BREAKING the byte budget (exit 1), and only the digest read exposes the second; (4) the cut was reverted here by rebuilding the pre-cut bytes exactly (`git show <sha>:<path>` bytes re-written to disk — no forbidden worktree verb, `git status` returned to clean) rather than by re-typing 3,468 B, and the rebuild was proven by `pre.replace(block+"\n","",1) == post` before the restore.

**Cost of the loop that gates a README edit:** the derived tier is the honest gate for `tools/README.md` — **62 s / 12 guards / exit 0 / `.err` 0 B**, and it names the two demos that read the README — cheaper than the §39 pair (102–123 s measured this turn at `940b36a64` and `b1fecefde`) and ~2.8x cheaper than the full suite (172.4 s at `617561fb5`). The tier's cost tracks its biggest member, not its size: 12 guards cost 62 s here because `demo/clockin-digest.test.mjs` alone is 31.3 s of it.
