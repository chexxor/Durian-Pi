# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-11-01T00:5xZ (**D187**), host-local 2026-10-31 20:5x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D187).
Updated **in place** — the cut is named below.

**Archive cut:** the superseded D186 pointer (through the 2026-10-31T20:5xZ clock-out) is kept **verbatim** in
`docs/NEXT-ARCHIVE.md`. Re-derive the cut from `git log --oneline -- docs/NEXT.md`; do not re-point by hand.

## THE HEADLINE: the "do-not-send gate" in the D186 pointer is a FALSE DIAGNOSIS

Four seats died in one night (`pm`, `impl`, `lead`, `scribe`) and **none of them died of conversation shape**. The
cause is stored in one field no instrument printed — the `submissions` table column **`detail`**:

```
pm    sub 275488, 275424   unanswered  reason=model_error  detail="Compaction failed: Summarization hit the token
lead  sub 277352           unanswered  reason=model_error  detail="Compaction failed: Summarization hit the token
impl  sub 277348, 276834   unanswered  reason=model_error  detail="Compaction failed: Summarization hit the token
scribe sub 277515          unanswered  reason=model_error  detail="Compaction failed: Summarization hit the token
```

Read it in one command (read-only; pin the absolute path — the opener CREATES a file on read):

```bash
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/home/chexxor/Git/Durian-Pi/selfdev.sqlite",{readOnly:true});
for(const [s,c] of Object.entries({pm:3,impl:9,lead:21,scribe:4924,qa:15}))
 for(const r of db.prepare("select id,status,record from submissions where conversation_id=? order by id desc limit 2").all(c)){
  const j=JSON.parse(r.record);console.log(s,r.id,r.status,j.reason,JSON.stringify(j.detail||null).slice(0,180));}'
```

**Mechanism, grounded in the vendored code (this is the product defect, not operator error):**
`vendor/pi-main/packages/durable/src/harness/compaction.ts:363` raises that text when the **summarizer call** ends
`stopReason: "length"`. Its output budget is `compaction.ts:148` → `Math.min(Math.floor(0.8 * policy.reserveTokens),
model.maxTokens)`; the default policy is `harness/agent.ts:29-30` (`reserveTokens 16384`, `keepRecentTokens 20000`)
so `0.8 × 16384 = 13,107`, and `model.maxTokens` for a local seat is `src/providers/local.mjs:76` →
`DURIG_LOCAL_MAX_TOKENS ?? **8192**` — a key `durig.config.json` does NOT set. **So a seat whose window has grown to
~100–150k tokens can never summarize its prefix inside 8192 output tokens, compaction always fails, and the seat is
un-sendable until an outside `reset` writes a boundary.** It is a liveness failure *and* a data-loss path (a failure
mid-item abandons in-flight work).

**What the shape read actually measures.** `tools/seat-turn-shape.mjs` predicates are the *strict-template* rule and
they are real — but they belong to the **verifier** engine here, not the seat model. Measured this session by direct
request to `:47831`: two consecutive `user` turns returned **HTTP 200, 64 prompt tokens** (`tools/seat-turn-shape.mjs`
`AT RISK` did not predict it). The Jinja refusal is verbatim in `auditor` sub 276042 detail: `Engine protocol predict
request returned 500 … Jinja Exception: After the optional system message, conversation roles must alternate user and
assistant ro…`. Seats whose projection ends on `user` (e.g. `scribe` 11, `devtools` 7, `security` 5, `auditor` 11)
completed rows. **Do not cancel a wake on the projection verdict; read `detail` first.** Row **#4967** (re-scoped by
`lead` at `2026-11-01T00:01:50Z`, now `claimed` by `scribe`) owns the docs correction.

## Current item: `#4966` — the operator-granted persona-files re-cut — is IN FLIGHT on `impl`

`#4966` (`lead→impl`, tier `feature`) = re-cut `wip/seat-prompt-files @04e3ba6b` onto current `main`, fix the two
demos the WIP breaks, add the resolver demo. It is **`claimed` by `impl` @2026-11-01T00:23Z-ish**, in worktree
**`/home/chexxor/Git/Durian-Pi/item-4966`** (locked, based on `613028f9` = `main`; `cli.mjs` modified, `prompts/*.md`
staged, nothing committed yet). **It is stalled, not lost** — see Blocker.

**State at this clock-out (2026-11-01T01:2xZ, measured):** `impl` is **actively working #4966** — it has committed
**`ca59b43e` `feat(rig): seat personas move to prompts/<seat>.md behind instructionsFile (#4966)`** on top of
`613028f9`, still has 5 changed paths in `item-4966`, and its window is at **consumed 114,856 = 0.718** of 160,000.
**Watch it:** past ~0.9 the compaction class returns and the arm dies. `scribe` holds **#4967 `claimed`** with **both
its worktree (`item-4967`, at the repo root, locked) and `seatroot` clean** — the arm was cut by the 8192 output cap,
so it needs a follow-up arm, not a reset. Two sends I wrote but did **not** run (one-writer rule): `lead` re-scope of
#4970/#4973 (`.spike/fix-20261103/lead-correct-4970.md`, ready) and `pm` triage of #4826/#4897/#4900. Docs records
landed on `main` this session: **`09f8d247`** (D187 + this pointer) and **`7c8ce1d5`** (runbook step 2c + the D187
pitfalls block), and the approved seat root was fast-forwarded to `7c8ce1d5` — **root == main == `7c8ce1d5`**.
**Ref trap:** `git rev-parse seatroot/linux` fails with `Needed a single revision`; use `refs/heads/seatroot/linux`.

**Blocker (three parts, all delegate-caused or delegate-recoverable):**
1. `impl`'s first run was **cancelled by my own `cli.mjs resume`** — `resume` reported `{"seat":"impl","submission":
   277446,"status":"placed","action":"run-cancelled"}` and the seat then showed `last_run_failed: aborted`. A recovery
   verb that cancels in-flight work; registered as **#4972**-adjacent, `lead` asked to file/extend it.
2. My retry `send` then failed: **`Session failed after a storage error; close and reopen it`** — the
   `store-corruption-recovery.md` symptom. Diagnosis at clock-out: **`status` stderr prints no `unreadable pi.live`**,
   `-wal` is 49,472 B, no `genlock.*`, broker `down`, so **no repair has been run and none is yet proven necessary**.
3. **The writer mistake that produced it: I ran two `cli.mjs send` harnesses concurrently (`impl` + `scribe`).** Each
   `send` opens a full writing harness = a second owner. The single-writer rule (`docs/runbooks/README.md`) forbids
   it. **Serialize sends, or run a resident broker and deliver with `intent.mjs`.** Broker state: down since
   `2026-10-30T04:55:33Z EXIT pid=3085999 reason=deadline`; the spool holds **2 intents waiting ~2,632 min**
   (`node tools/broker-serve.mjs --status`).

## Next commands (delegate, Linux; block 1 is the actual next act)

```bash
# 1. ONE WRITER AT A TIME. Confirm nothing owns the store, then re-arm impl on its claimed row:
pgrep -af "cli.mjs (send|serve|run)" | grep -v "bash -c" || echo "no writer alive"
ls -1 selfdev.sqlite.genlock* 2>/dev/null; DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status >/dev/null   # stderr clean?
git -C /home/chexxor/Git/Durian-Pi/item-4966 status --short | head    # staged work survives
node cli.mjs send impl --body-file .spike/fix-20261103/impl-4966-resume.md --no-stream   # brief already written
# 2. then the two cheap, uncontested sends, ONE AT A TIME (never concurrently):
node cli.mjs send lead   --body-file .spike/fix-20261103/lead-correct-4970.md --no-stream  # re-scope #4970/#4973 to the 8192 budget
node cli.mjs send scribe --body-file <finish the claimed #4967 in worktree item-4967> --no-stream   # arm was cut at 8192 output tokens
node cli.mjs send pm     --body-file <triage: #4826 #4897 #4900 + #4813 needs the human> --no-stream
# 3. clock-in reads (all read-only, priced in docs/runbooks/session-start-cost.md):
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs | grep -E '^seat |counted projection'
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/<s>/q.json   # ~0.8 s, 21.9 MB
node .spike/fix-20261101/rows.mjs 4966 4967 4968 4970 4971 4972 4973 4893 < .spike/<s>/q.json
node tools/broker-serve.mjs --status    # broker + genlock + spool age + provider reachability in one read
# 4. the granted landing, ONLY once a re-cut of #4966 lands:
git merge-tree --write-tree main item-4931 && node scripts/land.mjs item-4931 --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite
git merge-base --is-ancestor item-4931 main && node scripts/suite.mjs --jobs 8; echo "exit=$?"
git -C /home/chexxor/Git/durian-dev/seatroot merge --ff-only main    # LAND, then re-point the root, then wake
# 5. withheld -D (condition = #4931 landed; NOT met): git merge-base --is-ancestor item-4898 main && git branch -D item-4898
```

## Operator decisions now open (all measured)

1. **The compaction fix.** Four candidate levers, none built: raise `DURIG_LOCAL_MAX_TOKENS` (currently the 8192
   default at `src/providers/local.mjs:76`) or give compaction its own budget; retune `reserveTokens`/
   `keepRecentTokens`; chunk/hierarchically summarize the prefix; or refuse compaction and re-anchor. `lead` minted
   **#4970** (`architect`, feature, QUEUED — the seam ruling) and **#4973** (`impl`, held, `blockedBy=[4970]`). My
   stopgap `DURIG_LOCAL_CONTEXT` **200000 → 160000** in `durig.config.json` moves *when* compaction fires and does
   **not** stop it failing (measured: `scribe` failed at 0.944 of 160000). Revert it if you prefer the bigger window.
2. **Broker policy.** Broker has been down since `2026-10-30T04:55Z`; without it `send` is the only delivery verb and
   every `send` is a second-owner writer. Grant a resident `serve` (then `intent.mjs`) or accept serialized `send`s.
3. **Verifier capacity.** GPU0 is still **47 / 16,376 MiB** — no verifier model loaded, so `qa`/`auditor`/`qa2`
   verifier grammar cannot run; `verifier` completes on :1234 in the preflight but the seats' model is unloaded.
4. **`#4813`, `#4354` wait on a human answer** (`pm` 2 parked, `impl` 13 parked).

## Rig state, re-measured 2026-11-01T00:5xZ (Linux) — re-read, do not trust

Resets fired this session (all `--dry-run`-free, operator-granted): `lead` entry **277390** (no handoff), `impl`
**277443** (+ handoff), `pm` **277511** (+ handoff), `scribe` **277526** (+ handoff). After each, the window is 1
message and `last_run_failed` clears; `lead` then ran twice, `settledStatus: done` both times (consumed 26,254 →
44,534 of the new 160,000 window = 0.278). `impl` claimed #4966 and staged real work before the abort.
**`cli.mjs send` prints `send is DEPRECATED (opens a full writing harness = a second owner): prefer node intent.mjs
<seat> --body-file <file>`** on every call.

`status` attention at clock-out: `pm` deferred(2, #4813 human) + idle_with_queued_work(3); `impl` deferred(13, #4354
human); `lead` idle_with_queued_work(9); `scribe` working #4967. **No `last_run_failed` on `pm`/`impl`/`lead`.**
Windows: `DURIG_LOCAL_CONTEXT 160000` (local `iq3_s`, GPU1 23,053/24,576 MiB), verifier `24576` (GPU0 47 MiB,
unloaded). Provider preflight: `local` answers and advertises `iq3_s`; its `/chat/completions` timed out once at 20 s
under load (`BLOCK provider-local-completion-failed` in `tools/broker-serve.mjs`). Store
`/home/chexxor/Git/Durian-Pi/selfdev.sqlite` 446,296,064 B; rows 4,973; census (noise) `done 3777 / cancelled 792 /
held 328 / queued 57 / deferred 17 / claimed 2`. **`git worktree list` 8** — added `item-4966` **at the repo root**
(`/home/chexxor/Git/Durian-Pi/item-4966`), alongside `item-4937`; `up --refresh --dry-run` wants to move `impl`'s cwd
back to `seatroot` and prints no removals — do not refresh while a seat is mid-run. `main` = **`613028f9`**;
`seatroot/linux` = `613028f9`; **61 commits ahead of `origin/main`, nothing pushed, no push grant.**

## Do not "fix" these on the strength of the docs

- **Never run two store writers at once.** Two concurrent `cli.mjs send` produced `Session failed after a storage
  error; close and reopen it` this session. Serialize, or broker + `intent.mjs`.
- **`resume`/`doctor` cancels in-flight work** (`action: run-cancelled`, then `last_run_failed: aborted`). The
  runbook `store-corruption-recovery.md` already names a `resume`-during-drain cycle as the top candidate writer of a
  corrupt `pi.live`. Do not reach for it while a seat is running.
- **`cli.mjs compact` has no `--dry-run` and its own failure mode is this class**; `reset` has `--dry-run`; the
  licensed offline read is `scripts/compact-eval.mjs item --seat <name>` without `--yes`.
- **`status.context.consumed` is the LAST model call's accounting** — stale after a reset (`pm` still reads 184,507 =
  1.153 of the new 160,000 window). Do not treat a post-reset over-1 fraction as an emergency.
- **A seat's tool surface is its `capabilities`** (`rig.selfdev.json`: `lead` = `decide, adjudicate` → queue verbs
  only, no shell). Briefing `lead` to run `cli.mjs status` or a store query wastes an arm; it wrote the tool-call
  markup into its text turn doing it (#4972 registers the prompt-vs-inventory mismatch that caused it).
- **`item-4931` is still 2 ahead / 20 behind `main`** (`merge-base --is-ancestor main item-4931` exit 1). Do not land
  it by hand; the grant fires only through #4966.
- Every 40-hex value inside a seat transcript is redacted as `secret-shaped value`; `node --check` proves only the
  FIRST path; `better-sqlite3` is absent — use `node:sqlite`; the store opener CREATES a file on READ; `up --refresh
  --dry-run` previews model/cwd writes and NEVER removals; scratch written inside a worktree dies with it.
