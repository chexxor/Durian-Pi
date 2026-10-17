# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-17 (delegate, **thirteenth pass** — merged-branch cleanup, the merge/landing
runbook (W6), and ROADMAP item 100 for landing-health metrics. See **NEXT SESSION** below.)_

## NEXT SESSION

**Current item (clock-out):** wait for the team's **landing pass**, then verify + clean up. `pm` was
routed to land the 15 verified-but-unlanded branches (`opr-20261017-landing-pass`, with the pre-flight
`opr-20261017-landing-preflight`: 11 clean / 4 conflict). After it runs, re-audit and delete only the
**merged** branches; then pick up the top-three: **`#1087`** (ROADMAP 97, qa, measure-first) → TUI
**`#1109`** (99 bug) and **`#1108`** (98 feature) → **`#1151`** (seat-root guard).

**Known blocker:** none blocking the delegate; the team's landing pass is the dependency. The operator
holds **push**; the **#994** quiet window is undeclared. **Do NOT delete a branch with
`git rev-list --count main..<b>` > 0** — that loses unlanded work.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

**Next-session checklist (the landing cleanup):**
1. Audit: `for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do echo "$b ahead=$(git rev-list --count main..$b)"; done`
2. Delete **only** `ahead=0` branches: `git branch -d <b>` (safe — refuses anything unmerged).
3. Any still `ahead>0` means the landing pass is incomplete: report to `pm`; never `-D`.
4. See `docs/runbooks/merge.md` for the per-type checklist and the audit.

**This pass (all done):**
1. **Branch cleanup:** deleted the 18 fully-merged local branches (`git branch -d`, all succeeded); 18
   local branches remain (17 with unique work + `main`).
2. **Merge/landing process added:** `docs/runbooks/merge.md` (universal gate + per-type checklists
   bugfix/feature/research/docs-only; the landing procedure + read-only audit), a **W6** workflow in
   `docs/WORKFLOWS.md`, and an index row in `docs/runbooks/README.md`. Operator preference honored:
   **instructions + a later read-only audit, no new broker automation.**
3. **ROADMAP item 100** — measure landing health (unlanded-verified count + time-to-land): a read-only
   metric (no auto-merge/broker hook) so the delegate can verify later; explicitly tied to the operator's
   "trust, but verify later" preference.
4. **Landing pass routed to `pm`** (intent `opr-20261017-landing-pass`): land the 15 verified-but-unlanded
   branches once, and register item 100.
5. **Top-three directive delivered** (intent `opr-20261017-top-three`): `#1087`/ROADMAP 97 (qa,
   measure-first) → TUI `#1109`(99)/`#1108`(98) → `#1151` (seat-root guard).
6. The prior pass (D85 language-drift guard + qa reset) is done and verified.

`#1036`/`#916` and the second reload are DONE (the broker restarted at 02:12 UTC, after #916 landed at
01:58 UTC).

**NEXT SESSION — prior pass detail (twelfth, done):** D85 language-drift guard (`06e08f8`:
`src/attention.mjs` + `src/degeneration.mjs` + `src/supervisor.mjs`, RED→GREEN, suite 102/0); qa reset
via an operator-authorized broker-safe stop (pid 35640 force-killed in the F11 drain, `reset qa`
English-only handoff, broker restarted **pid 13712**, qa back in English); TUI items 98/99 registered.

## CLOCK-OUT — tenth pass (2026-10-16, delegate) — historical

**HEAD at clock-in:** `f3c3179`. Delegate commits this session: the cooldown-revisit fix (`7a0ae0f` —
`src/broker.mjs`, `src/driver.mjs`, `src/scheduler.mjs`, `demo/broker-cooldown-revisit.test.mjs`) and
the spooled-intent wake fix (`src/broker.mjs`, `demo/broker-intent-wake.test.mjs`).

**WHAT THIS PASS DID (all verified):**
1. **Fixed the still-owed general broker revisit gap (delegate-owned).** `selectWakes` produced real
   candidates, `seatFilter` silently dropped cooldown-suppressed ones, and nothing re-ran a pass when
   the cooldown later elapsed — so a seat whose run settled INSIDE the 30 s cooldown sat with queued
   work until an unrelated commit. Fix: `driveOnce` reports dropped candidates via `onSuppressed`;
   `WakeScheduler.msUntilSeatReady(name)` gives the wait; `runWakeLoop` schedules a revisit pass for
   the earliest suppressed seat's deadline and un-parks to mark itself dirty (recomputed each pass so
   a stale deadline cannot spin the loop). Proof: `demo/broker-cooldown-revisit.test.mjs` — RED against
   pre-fix code (1 wake in 3000 ms), GREEN after (re-wake ~1545 ms in, after a 1500 ms cooldown).
2. **Fixed the spooled-intent wake gap (delegate-owned; closes item 66's incomplete half).** A resident
   broker drains `<db>.broker.inbox` only at the START of a pass, but ran a pass only on a
   wake-relevant commit — so an operator intent written by `intent.mjs` sat until an unrelated commit.
   `runWakeLoop` now treats a non-empty inbox like a wake-relevant change (no spin risk: every file is
   submitted+unlinked or dead-lettered within the pass). Proof: `demo/broker-intent-wake.test.mjs` — RED
   against pre-fix code (no delivery in 3000 ms), GREEN after.
3. **Operator-authorized broker reload DONE (#1032).** `serve --stop` reported `stopped: true`; each time
   the process stayed alive in the F11 drain (the first, pid 4644, was force-killed with NO genlock at
   the stop; the second, pid 6804, later exited on its own `reason=stop`). Restarted via
   `scripts/serve-noroot.ps1`; constitution intact. The #822 npm-ci fix is now LIVE. **Final broker: pid
   35640, started `2026-10-17T01:13:17Z`.** **Caveat:** `#916` (`dd79fa3`) is not yet landed, so `#1036`
   must land it and a SECOND reload will be needed to activate that half.
4. **Operator CRLF/EOL ruling delivered to `pm`** (inbox intent `opr-20261016-eol-policy-944`; broker
   logged `INTENT delivered=1 dead=0`). Ruling (**D83**): EOL-insensitive assertions APPROVED (lead #948
   option 1) and a narrow `.gitattributes` APPROVED (file-scoped `eol=lf`); repo-wide `* text=auto eol=lf`
   NOT approved. #328's hold is lifted for this scope; #975/#976 remain separate.
5. **Full demo suite: 97 pass / 3 fail** (two new demos this pass). The 3 failures are the PRE-EXISTING
   constitution-drift class (`demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`,
   `demo/starter.test.mjs` — starter inline vs `constitution.txt`), registered as **#976**; none touches
   this pass's changes.

**THE POINTER WAS STALE.** The ninth-pass pointer named **#885** (`cmdInit`) as priority; it has LANDED
(`5cb8123`), and the team has since landed #915/#1013 (`7c2fb52`, `f3c3179`), verified
#874/#875/#910/#911/#916/#890, and registered the TUI-89 / formatter-90 / multi-instance-91 /
runbook-81/82/86 work. **Trust the queue + `status`, not the ninth-pass text below.**

**PRIORITY — CURRENT CRITICAL PATH (all `impl`):**
1. **LANDING TRAIN `#1040`** — land the verified DONE-on-branch artifacts in order: `#890` → (`#874`
   `7013294`, then `#875` `50bc585`) → (`#910` `c2fa6ee`, then `#911` `07ae6a6`); **`git merge --no-ff`**,
   explicit paths, never push, then mark the rows DELIVERED.
2. **`#1036`** — land `#916` (`dd79fa3`); pairs with the #915 landing so one rig reload activates both.
3. Then the serialized `cli.mjs` chain **`#934` → `#873` → `#966`** (one writer at a time; `#920` stays
   on the ENV seam). Then the held daemon items **`#723` → `#724` → `#725`** (`impl` must release them).
**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

**⚠ OPERATOR DECISIONS — RECEIVED this session (recorded: D83):**
- **`#1032` — rig reload: DONE** (final pid 35640). The `#916` half still needs landing (#1036) and a
  second reload.
- **`#944`/`#328` — CRLF/EOL: RULED** — EOL-insensitive assertions + a narrow `.gitattributes`
  (`eol=lf`, file-scoped). Repo-wide rewrite NOT approved. Delivered to `pm`.
- Still operator-owned: the **#994** whole-tree Prettier normalize quiet window (trigger-gated). The
  operator holds push (origin/main == main).
- **Priority order ACCEPTED (2026-10-17):** `#1040` (landing train) first, then `#1036` (land #916 →
  2nd reload), `#977`+`#1055` (EOL), `#975`+`#976`, `#964`→`#965`→`#966`, `#873`, `#998`/`#1002`/`#993`,
  then the held daemon `#723`→`#725`. Delivered to `pm` (inbox intent `opr-20261017-priority-order`;
  broker logged `INTENT delivered=1 dead=0`). **Still open for the operator:** `#1059` (KEEP vs reset
  `#940`'s shared-main commit `e3a8e53`).
- **Compaction research follow-up DRAFTED (2026-10-17):**
  `docs/reviews/context-compaction-followup-research-prompt.md` — the questions the operator's
  `docs/reviews/chat-session-compaction-best-practices.md` left open (trigger/effective-window,
  thinking-token replay, mid-item safety, verifier isolation, masking primitive, evaluation). Awaiting the
  operator routing it to the research agent; **do NOT update ROADMAP 27–30 until the report lands**
  (`docs/reviews/context-compaction-followup.md`).

**BROKER:** pid `35640` (`scripts/serve-noroot.ps1`), started `2026-10-17T01:13:17Z`; loaded the
delegate's broker fixes. Inbox empty (the EOL ruling was delivered). At start it woke `impl` + `qa`.
`status.attention` = deferred-awaiting-answer (old parked rows) + `queue-ageing`. **Do NOT `serve --stop`
while a `genlock.*` is held**; `"stopped": true` is NOT proof the process exited — pid 4644 hung in the
F11 drain and was force-killed, and pid 6804 exited on its own after a multi-minute drain.

**TREE:** clean at clock-in; this pass's edits committed with explicit paths. `item-*` worktrees are
leaked/locked detachments (known defect `#998`), not tree dirt.

## CLOCK-OUT — ninth pass (2026-10-16, delegate) — historical

**HEAD at clock-out:** `d5c1dfb`. Delegate commits this session: `f579bb2` (thinkingLevel on the 5
DeepSeek seats), `072bfe6` (ROADMAP 89 TUI), `b2ff656` (pointer), `89c50d4` (ROADMAP 90 formatter),
`d5c1dfb` (ROADMAP 91 multi-instance).

**WHAT THE DELEGATE DID (all verified):**
1. **impl degradation fixed** — `rig.selfdev.json` had no `thinkingLevel`, so DeepSeek seats ran with
   `thinking:{type:"disabled"}` + no `reasoning_effort` (pi-ai `openai-completions.js:668-679`) and
   every recent `impl` turn showed `usage.reasoning:0` (ROADMAP 43a). Added `thinkingLevel:"high"` to
   pm/impl/lead/scribe/devtools (`f579bb2`), applied broker-safe (stop → `up --refresh --no-serve` →
   `reset impl` entry `38233` → restart). Verified 5 seats read `thinkingLevel="high"` in AgentState.
2. **Four operator intents routed to `pm`** (inbox; all delivered, `dead=0`): broker-safe writes,
   request-TRACE, TUI seat-transcript (ROADMAP 89), app-level formatter (ROADMAP 90), multi-instance
   (ROADMAP 91). **The team registered all of them the same session** — see the queue.
3. **Roadmap:** added items **89** (TUI seat-detail transcript), **90** (app-level `format` verb),
   **91** (multiple instances / instance identity for the daemon).

**PRIORITY — CURRENT ITEM:** **#885 (LAND #624 `cmdInit`: `M cli.mjs` + `?? demo/init.test.mjs`)** is
STILL `queued` to `impl` — NOT landed. The delegate delivered a claim-by-id priority steer to `impl`
(`opr-20261016-impl-priority-885`, `.spike/delegate/intent-impl-priority-885.md`): claim #885, run
`node --check cli.mjs` + `demo/init.test.mjs`, commit explicit paths only, complete, report to qa.
**lead #913 rules #885 lands FIRST** — it gates #910 (69), #911 (70), #912 (71), #873 (`compact`), and
#934/#940/#927 (all edit `cli.mjs`). **Exact next command (read-only):**
`DURIG_DB=./selfdev.sqlite node cli.mjs status`.

**ORDER after #885:** #874 (wall-clock, first) → #873 (`compact`) → #875 (degen-text registry); then
#910/#911 → #912. Registered from this session's intents: #920/#922/#923 (trace), #927/#928 (TUI 89;
designer CLAIMED #928), #933/#934 (formatter 90; devtools CLAIMED #933), #939/#940 (multi-instance 91).

**⚠ OPERATOR POLICY QUESTION PENDING (surface to the operator):** **#944 / #948** — a SCOPE+POLICY
ruling on the **CRLF / line-ending stance** (ROADMAP #328, #766); lead split the scope and ruled POLICY
is the OPERATOR's (#328 on hold). Same width as formatter item 90. The delegate has NOT ruled it.

**TREE STATE — NOT the delegate's (do NOT commit or discard):** `M cli.mjs`, `?? demo/init.test.mjs`
(#624/#885); `M package.json`, `M package-lock.json`, `?? .prettierrc.json`, `?? docs/FORMATTER.md`
(devtools/impl #933/#934 — Prettier tool choice in flight). Delegate's own edits are all COMMITTED.

**BROKER:** pid `4644` (`scripts/serve-noroot.ps1`), started `21:58:43Z`; `genlock.0` held at clock-out
(one run in flight). Inbox empty, no dead-letter. **Do NOT poll runs — the operator notifies.**

**Do NOT `serve --stop` while a `genlock.*` is held** (`docs/runbooks/broker-safe-change.md`);
`"stopped": true` is not proof the process exited.

## OPERATOR INTENT ROUTED — broker-safe writes (2026-10-16, delegate)

**Operator instructed: prioritize and get ROADMAP 69/70/71 moving.** Delivered to `pm` via the inbox
(`intent.mjs`, requestId `opr-20261016-broker-safe-writes-69-71`); broker log shows
`INTENT delivered=1 dead=0` at `21:48:29Z`; inbox empty, no dead-letter. Body:
`.spike/delegate/intent-prioritize-broker-safe-writes.md`.

- **69** refuse/route writes while the broker drives (impl, `cli.mjs`); **70** read-boundary hardening
  (impl); **71** command spool / mailbox — the "all commands through the broker" piece (devtools +
  delegate consulting). Order: 68→69→70→71, then daemon 61–64. 68 already delivered.
- **Prerequisite:** the `cli.mjs` gate (#624 `cmdInit`, uncommitted) — that is PRIORITY 1 below.
- **Status: REGISTERED.** `pm` created **#910** (69, impl) and **#911** (70, impl); **#912** (71, devtools) is `held`. `lead` ruled **#913** and sequenced: **#885 (land #624 `cmdInit`) lands FIRST** — three families contend for the dirty `cli.mjs` (#885, 69/70/71, and the `compact` verb #873) and must not be open at once. `pm`'s reply is **#914**.
- **Do NOT poll `pm`;** hand back and wait for the operator.

## THIS SESSION — live changes + two new routed items (2026-10-16 late, delegate)

**impl degradation fixed operationally (thinking was disabled).** `rig.selfdev.json` had no
`thinkingLevel` on any seat, so pi-ai's DeepSeek branch sent `thinking:{type:"disabled"}` and no
`reasoning_effort` (`openai-completions.js:668-679`); every recent `impl` turn showed `usage.reasoning:
0` and the seat narrated its own loop (ROADMAP 43a named this exactly). Applied: added
`"thinkingLevel": "high"` to the five DeepSeek seats (pm, impl, lead, scribe, devtools) — **committed `f579bb2`** — then broker-safe stop → `up rig.selfdev.json --refresh --no-serve`
(all 9 `refreshed`) → `reset impl` (entry `38233`) → broker restarted (**pid 4644**). Verified the five
seats read `thinkingLevel="high"` from AgentState (`.spike/delegate/check-thinking.mjs`).

**Four operator intents routed to `pm` (inbox; all delivered, `dead=0`):**
- **request-TRACE surface** (`opr-20261016-request-trace`): a verb/env to dump the ACTUAL serialized
  request payload per model call, via pi-ai's unused `ProviderRequestOptions.onPayload`/`onResponse`/
  `fetch` seam (`types.d.ts:52-83`) — realizes ROADMAP 43(c) and lets a user see the real DeepInfra
  DeepSeek args, not the programmed config. Body: `.spike/delegate/intent-request-trace.md`.
- **ROADMAP 89 — TUI seat-detail transcript** (`opr-20261016-tui-seat-transcript`): load a seat's full
  chat log on opening its details, not only the live tail (the 24-entry `SCAN_LIMIT` page). Added to
  `docs/ROADMAP.md` (Mid-term, next to item 17). Body: `.spike/delegate/intent-tui-seat-transcript.md`.

- **ROADMAP 90 — app-level formatter** (`opr-20261016-formatter-backlog`): an explicit
  `format [--check] [-- <paths>]` verb; body `.spike/delegate/intent-formatter-backlog.md`.
- **ROADMAP 91 — multiple instances** (`opr-20261016-multi-instance`): instance identity for the OS
  trigger / markers / lock; body `.spike/delegate/intent-multi-instance-backlog.md`.

**Delegate edits this session are ALL COMMITTED** (`f579bb2`, `072bfe6`, `b2ff656`, `89c50d4`,
`d5c1dfb`). The remaining dirty tree is OTHER seats' in-flight work — do NOT commit or discard.

## CLOCK-OUT — eighth pass (2026-10-16, delegate) — historical

**`main` HEAD:** `978574d`. Commits this session: `8ae8fff` (impl: seatguard #673/#780), `191c481` (a
swallowed-catch fix the warden flagged), `97a3c6d` (D78 prose guard) then `449e870` (**REVERTED** — it
false-reset lead/advocate/scribe/auditor/impl), `689416a` + `978574d` (pointer/runbooks).

**PRIORITY 1 — operator ruling (routed to `pm`, intent delivered `21:39:38Z`, D79):** land ALL
uncommitted shared-tree work on `main`:
- `cli.mjs` + `demo/init.test.mjs` = **#624 `cmdInit`** (the gate; complete but in no commit);
- `docs/SEAT-LIFECYCLE.md` = **#819 (scribe)**, after its #823 verify;
- `docs/ROADMAP.md` edit = fold into its registering item.
Explicit-path commits only; no push. **This unblocks items 69/70/71/74/78.**

**PRIORITY 2 — routed to `pm` (intent delivered `21:37:29Z`):** the three ordered build items —
(1) `compact` verb; (2) a HIGH per-turn wall-clock bound as a separate guard cause (implement first);
(3) a revived degenerate-text guard as an **extensible named-pattern registry**, with positive AND
negative fixtures pulled from the seats' own conversations, **zero false positives on all real pages
before enabling**, then verified against `impl`'s entry-`36368` loop. Bodies:
`.spike/delegate/intent-compact-wallclock-degentext.md` and `intent-land-uncommitted-priority.md`.

**Still open:** the `impl` prose loop (`36368`) is UNCAUGHT until item (3) lands; the dormant-broker
revisit gap is unfixed; item 69's hard write guard still depends on the `cli.mjs` landing.

**Broker:** `pid 29372` (`scripts/serve-noroot.ps1`), reverted guard loaded; `pm` + `scribe` generating.
A broker restart is the only reliable way to drain the inbox if it is dormant — spool the intent, then
restart. **Never `serve --stop` while a `genlock.*` is held** (the F11 drain hangs; `"stopped": true` is
not proof the process exited — see `broker-safe-change.md`).

**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

## SEVENTH PASS — 2026-10-16 (delegate)

- **ROUTED to `pm`** (intent spooled + delivered, `INTENT delivered=1`; body
  `.spike/delegate/intent-compact-wallclock-degentext.md`). Three ordered items, each with a
  runbook + FEATURES row + a D-entry:
  1. **`compact` verb** — expose pi-durable's `Conversation.compact` as `node cli.mjs compact <seat>
     [instructions]`, mirroring `resetSeatContext` (unknown-seat fail + live-generation-lease refusal),
     and make the verb truthful about how its background task completes (no enqueue-and-exit stub).
  2. **HIGH per-turn wall-clock bound** as a SEPARATE guard cause (propose ~5 min, operator-tunable),
     so a legitimately long text/tool turn never trips it. Implemented FIRST.
  3. **Revive the degenerate-text guard EXTENSIBLY** (a named-pattern registry) with positive AND
     negative fixtures PULLED FROM THE SEATS' OWN CONVERSATIONS, validated against ALL seats' real
     pages with a false-positive count of 0 BEFORE enabling; then verify it catches `impl`'s entry-36368
     loop specifically. (D78's lesson: a context-resetting heuristic must be validated against real
     pages, not just synthetic fixtures.)
- **Completed this session (committed):** `8ae8fff` impl landed the seatguard work (#673/#780);
  `191c481` fixed a swallowed catch flagged by the warden; `97a3c6d` added the D78 prose guard and
  `449e870` REVERTED it (it false-reset `lead`, `advocate`, `scribe`, `auditor`, and `impl`); `689416a`
  and this pass keep the pointer true.
- **Docs updated this pass:** `docs/runbooks/seat-reset.md` (a GUARD reset can be a false positive;
  read the run before trusting it); `broker-safe-change.md` (`"stopped": true` is NOT proof the process
  exited — the F11 drain hangs; never kill while a genlock is held); `broker-down-or-stalled.md` (the
  alive-but-DORMANT revisit gap: fresh heartbeat + stale `PASS` + no genlock).
- **Still owed / open:** the `impl` prose loop (entry `36368`) is UNCAUGHT until Task 3 lands; the
  dormant-broker revisit gap is unfixed; the `cli.mjs` gate (#624) still blocks items 69/70/71/74/78.
- **Broker:** restarted `pid 29372` (`scripts/serve-noroot.ps1`); the reverted guard is loaded (no
  degeneration escalations). Do NOT call `serve --stop` while a `genlock.*` is held.
- **Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

## SIXTH PASS — 2026-10-16 (delegate)

- **impl committed the seatguard work the operator asked for: `8ae8fff`** (`src/seatguard.mjs` +
  `demo/seatguard.test.mjs`, #673/#780) on explicit paths; the shared tree is now clean of them. The
  inbox intent that asked for it was delivered while the broker ran (`INTENT delivered=1`), no second
  writer.
- **THE `cli.mjs` GATE STILL STANDS.** `cli.mjs` + untracked `demo/init.test.mjs` are still uncommitted
  (#624's artifact); items 69/70/71/74/78 stay blocked until it lands.
- **REVERTED `97a3c6d` (D78): the prose-degeneration detector false-positived and was removed.** It
  did catch the real `impl` loop (entry `36368`: "Let me emit. Emit. OK. Go. Now." ~30× per turn while
  still emitting tool calls, so every structural signal read clean), but on the broker's FIRST pass it
  also reset `lead`, `advocate`, `scribe`, and `auditor` — coherent transcripts with low *fragment*
  diversity. Sentence heuristics over markdown cannot separate a word-salad loop from a normal long
  document (the length cap discards the varied sentences and keeps the repeated ones). The guard is back
  to its pre-D78 structural signals; **the `impl` prose loop remains UNCAUGHT**. A signal that does not
  parse prose (a per-turn wall-clock latency bound — degenerate turns ran 56 s then 122 s) is the
  candidate. See D78's **Status: REVERTED**.
- **Broker restarted 21:20 (pid 35812)** to drain the impl question and load D78; it then false-reset the
  four seats above. It **MUST be restarted again** after the D78 revert lands, or it keeps resetting them.
  Stop first (`serve --stop`; proceed only on `stopped:true` and confirm no `cli.mjs serve` remains),
  then `scripts/serve-noroot.ps1`.
- **`impl` went dormant with 23 queued items — the GENERAL revisit gap.** After a NORMAL settle the
  per-seat cooldown suppresses the re-wake, and no further pass fires without a store commit, so a seat
  with queued work sits until an unrelated commit or a restart. Verified: pid 16628's last `PASS 82` at
  `21:09:19`, heartbeat fresh, no genlocks. Still owed.
- **No compaction verb exists.** pi-durable ships `CompactionTask`, but durig calls it nowhere and
  `help` has no `compact`; ROADMAP #62 (owner: impl) is the ordered context-pressure + one-compaction
  item. `reset` is the only context-reducing verb — a full reset, not a summary.
- **Open sqlite lock (transient, by design):** any opener can hit "database is locked" because EVERY
  open runs schema-migration DDL (`BEGIN IMMEDIATE`) and the resident broker holds the single write
  lock; the adapter's busy_timeout is 5000 ms, so a retry succeeds. Aggravated by stale
  `log --follow` viewers holding connections. It clears when the broker is stopped (and viewers reaped);
  the durable fix (skip migrations for read-only opens) is a code item for the team.
- **Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

> **Operator working agreement (2026-10-15): do not poll or wait on background seat runs.** Dispatch
> the `send`/`run` detached, note the pid and its `.spike/delegate/*.out` file, then hand back. The
> operator notifies you when a run completes. Do not loop `sleep`/`tasklist` to watch it.

## CLOCK-OUT — 2026-10-16 (delegate, fifth pass) — START HERE

**What this session did (all LOCAL, unpushed):**
- Applied the pending **P3 Runbooks** constitution (`up rig.selfdev.json --refresh --no-serve`); doc 28
  now carries `prepare_workspace` + `P3 Language` + `P3 Runbooks` (verified).
- Fixed the **recurring `impl` stall**: a tool call written as TEXT using DeepSeek's **DSML**
  special-token delimiter (U+FF5C `DSML` U+FF5C). **A terminal STRIPS the delimiter, so a screen read
  shows a clean `<parameter>` block and HIDES the fault — read the stored bytes.** `src/attention.mjs`
  `isPseudoToolCallTurn`/`countPseudoToolCalls`; `assessRun` (`src/degeneration.mjs`) trips on the first
  occurrence; `src/supervisor.mjs` reset handoff names it; `src/scheduler.mjs` + `src/broker.mjs` clear
  the reset seat's cooldown so the next pass re-drives it. Commits `f086382` → `c38815f` → `7d62929`;
  decision **D77**. Verified against the real stored entry `35382` and live (reset written, seat re-woken
  and generating).
- Registered via `pm`: **#819 → scribe** (seat lifecycle + environment doc; CLAIMED, in progress;
  `docs/SEAT-LIFECYCLE.md` is untracked in the tree), runbook items **#814/#815 → impl, #816 → qa (held),
  #817 → lead (deferred)**, and the **queue-view + directed-graph** item **#841 → designer (surface,
  CLAIMED) / #842 → impl (data) / #843 → lead (sequencing)**. Design recorded in the registration:
  build the VIEW first, keep dependencies ADVISORY, and adopt pi-durable's `TaskGraphState.waiting`
  (`on`/`policy`) if enforcement is ever wanted — do NOT build a parallel DAG scheduler in `RigQueue`.
- Full suite after the fix: `demo/*.test.mjs` = **94 pass / 3 fail**; `npm run test:tui` = **14/14**;
  `npm run demo` = **PASS**. The 3 failures are **pre-existing constitution drift, not this session**:
  `rig.starter.json`'s `constitutionInline` is missing `P3 Language` (`a0ab993`) and `P3 Runbooks`
  (`fe0c74c`), so `demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`, and
  `demo/starter.test.mjs` fail their `starter === constitution.txt` assertion. **Unblocked, high-value
  next item: sync the starter's inline copy with `constitution.txt` → suite 97/97** (route to the
  constitution's owner, or take as a clean-path fix).

**Broker:** running **pid 16628** (`scripts/serve-noroot.ps1`), started after a clean
`EXIT pid=9444 reason=stop`; it loads the DSML fix. pm was generating at clock-out (see
`selfdev.sqlite.genlock.*`). Log: `selfdev.sqlite.broker.log`.

**Open decision / blocker needing an OPERATOR RULING:**
1. **The `cli.mjs` gate.** The working-tree `cli.mjs` is **#624's complete-but-UNCOMMITTED** `cmdInit`
   artifact: `demo/init.test.mjs` exits 0, `node --check cli.mjs` is clean, queue row **#624 is `done`**,
   yet `cmdInit` is in **no commit** (`git log --all -S cmdInit` empty; no `item-*` worktree HEAD has it).
   **Items 69/78 are blocked until it lands.** Question for the operator: **may the delegate commit
   `cli.mjs` + `demo/init.test.mjs` (explicit paths only) to clear the gate?** Items 69/78 are also still
   NOT registered as queue rows.

**Still owed (delegate):** the GENERAL broker revisit gap — a seat suppressed by the per-seat cooldown
   after a NORMAL settle (not a reset) still waits for an unrelated commit; the reset path is fixed
   (`7d62929`). Fix by scheduling a pass when a candidate is cooldown-suppressed.

**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.
**Restart a down broker:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1`
(never set `DURIG_SEAT_ROOT`).

**Do NOT commit the tree's other-seat work:** `cli.mjs`, `demo/init.test.mjs`, `src/seatguard.mjs`,
`demo/seatguard.test.mjs`, `docs/ROADMAP.md`, `docs/SEAT-LIFECYCLE.md`. Stage explicit paths only.

## LATEST — 2026-10-16 fourth pass (delegate): impl recovered; P3 Runbooks applied

**Broker:** stopped pid 14536 cleanly (`EXIT pid=14536 reason=stop` at `20:03:12Z`, after a long `lead`
drain) and restarted as **pid 32276** at `20:06:55Z` (`scripts/serve-noroot.ps1`; logs
`.spike/serve.{out,err}` and `selfdev.sqlite.broker.log`).

**Constitution:** `up rig.selfdev.json --refresh --no-serve` applied **P3 Runbooks**; doc 28 now carries
`prepare_workspace`, `P3 Language`, and `P3 Runbooks` (verified with `scripts/read-constitution.mjs`).

**impl recovered (the operator's ask).** impl claimed **#700** (no-secrets config guard) at 19:56:43,
wrote coherent `SECRET_VALUE_PATTERNS` / `looksLikeSecret` / `assertNoSecretsInFile` code into
`src/config.mjs`, then its run ended on a **malformed pseudo-tool-call** (`<parameter name="edit">`
arrived as text; `stopReason:"stop"`) at ~20:01, leaving the item incomplete. **Cause, corrected from
this session's first draft (which claimed it "skipped" `prepare_workspace`):** in the pre-malformed run
there is no `prepare_workspace` call after `claim_work #700` (entry `34390`) — but the shared-tree write
is a **tool-path resolution defect**, because on the later attempt `prepare_workspace(700)` itself FAILED
(`npm ci --prefer-offline failed`, entry `34577`) while the worktree still existed (entry `34585`,
`item-700` at `f802d5f`), and the edit had landed in BOTH main and `item-700` (entries `34591`–`34595`).
Recovery: backed up the
tree (`.spike/delegate/impl-recovery-20261016-200534/`: `tracked.patch`, `init.test.mjs`), then spooled a
steer via `intent.mjs` (`.spike/delegate/intent-impl-resume-700.txt`) = call `prepare_workspace(700)`
FIRST, re-apply the guard inside `item-700`, revert the shared-tree block with the edit tool (never
`git restore`), write the failing-first demo, verify, commit #700; then #806. impl re-woke (lease
`seat:impl` from `20:07:37Z`) and is generating. **Do not poll; hand back.**

**Two defects found this session (feed item 69 / item 66):**
1. **`serve --stop` returned `stopped:true` while pid 14536 was still alive** in its final F11 drain.
   `runWakeLoop` clears the heartbeat interval *before* `await harness.waitForIdle`, so `brokerAlive`
   reads stale, `cmdStopBroker` clears `broker.json`, and the stop reports success. **Never trust
   `stopped:true` alone — confirm no `cli.mjs serve` process remains** (the runbook already requires this).
2. **A spooled inbox intent drains only when a pass runs**, and passes fire only on wake-relevant store
   commits; the operator's runbook intent (`requestId c9557fe6…`) sat from 19:49 to 19:56 until an
   unrelated commit. Item 66's "drain each pass" is incomplete — a spooled operator intent should force
   a pass rather than wait for one.

**Gate unchanged:** `cli.mjs` is still dirty (cmdInit C9/C10 + untracked `demo/init.test.mjs`) and
`src/seatguard.mjs` + `demo/seatguard.test.mjs` are dirty in main; **items 69/78 remain blocked on
`cli.mjs`**. The main-tree seatguard copy is **NOT** the committed #802 work: `git diff 0102f3c --
src/seatguard.mjs` is `+11/−89` (and impl's own entry `34305` calls it "an earlier/alternate copy"
lacking the async `absoluteSeatPath`/`seatGraphRoot` work), so it is a **divergent draft** — establish its
provenance before treating it as in-flight. (This session's first draft wrongly called it a stale
duplicate of `0102f3c`; that was inferred, not checked.)

**The `cli.mjs` gate is #624's complete-but-UNCOMMITTED artifact (checked 2026-10-16).** The working-tree
`cmdInit` is the #624 "INIT META-DEFAULTS" implementation; `node --check cli.mjs` is clean and
`demo/init.test.mjs` exits 0 (`INIT TEST PASS`), and queue row **#624 is `done`** — but `cmdInit` appears
in **no commit**: `git log --all -S "async function cmdInit"` and `-S cmdInit` both return nothing, and no
`item-*` worktree's `HEAD:cli.mjs` contains it. So the gate is a **landing/ownership decision** (commit
`cli.mjs` + `demo/init.test.mjs`, explicit paths only), not unfinished code. `NEXT.md` reserved it to the
owner or an operator ruling; do not `git add` another item's artifact without one.

**Runbook work is now registered and in flight (pm delivered the operator intent):** **#819 → scribe**
(seat-lifecycle + environment narrative — CLAIMED and being written; the operator's request this session,
after a prior check showed no such doc exists); **#814 → impl** (runbook check rules 81/82/86, reuses item
46's machinery); **#815 → impl** (`--dry-run` 84); **#816 → qa** (executable Diagnose blocks 85, held until
81/82 land); **#817 → lead** (delegate-owned 87/88, deferred). Clean-path NEXT items 81/85/86 are therefore
no longer "available now" — they are queued.

**Recurring `impl` stall — malformed tool call emitted AS TEXT (root cause, 2026-10-16 evening).** impl
stalled the same way twice: the turn ends with `stopReason:"stop"`, `hasToolCall:false`, and the tool
call written into the CONTENT as `<parameter name="powershell">…` (entries `34844`, `34898`; earlier
`34495`). The harness reads that as a normal completed turn — no rejected call, no error — so
`countMalformedToolCalls` (`src/attention.mjs`, which matches only the harness marker
`[error] Validation failed for tool "`) and the D64 degeneration guard never fire, and the
`malformed-tool-call` metric stays 0 (its own documented blind spot). impl's model is
`deepseek-ai/DeepSeek-V4.1-Flash` (deepinfra, `api: openai-completions`). **Fix LANDED (`f086382` +
`c38815f`, D77):**
durig now detects a tool call emitted as text (`isPseudoToolCallTurn`/`countPseudoToolCalls` in
`src/attention.mjs`; `assessRun` trips on the FIRST one) and the supervisor resets the seat with a handoff
naming the fault — NO translation layer (a synthesized half-parsed call would execute without the model's
validation). **Grounding trap:** the terminal strips the DSML special-token delimiter, so a screen read of
the entry shows a clean `<parameter>` block and HIDES the fault; the detector reads the stored bytes
(the U+FF5C `DSML` delimiter, or the plain nested `<parameter>` pair). The operator keeps the model.
**Still open:** (c) auto re-drive — **DONE for the reset path (`7d62929`)**: a reset clears that
seat's cooldown and marks the scheduler dirty, so the next pass re-wakes it (verified live: impl
reset at `20:35:20Z`, and after the restart its re-drive fix produced a `generation_in_flight` impl at
`20:40:48Z`). (d) the GENERAL revisit — a seat suppressed by the per-seat cooldown after a NORMAL
settle still waits for an unrelated commit (runs usually outlast the 30 s cooldown, so it is rare);
surfaced by the broker sitting idle `20:14:13Z → 20:19:54Z` while impl had queued work. Recovery used
both times: spool a corrective steer via `intent.mjs` (latest
`.spike/delegate/intent-impl-finish-700-v2.txt`); impl re-woke to finish #700 (commit `28c7ba5`).

**Full-suite result after the D77 fix (2026-10-16):** `demo/*.test.mjs` = **94 pass / 3 fail**;
`npm run test:tui` = **14/14**; `npm run demo` = **PASS**. The 3 failures are **pre-existing
constitution drift, NOT this session's diff**: `constitution.txt` carries `P3 Language` (`a0ab993`) and
`P3 Runbooks` (`fe0c74c`) but `rig.starter.json`'s `constitutionInline` carries neither, so
`demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`, and `demo/starter.test.mjs` fail
their starter-inline `=== constitution.txt` assertion (deterministic on re-run; none of those files is in
the session diff). Fix: sync `rig.starter.json`'s inline copy with `constitution.txt` (a constitution-drift
item-75/80 case) — route to the constitution's owner.

## NEXT SESSION — START HERE

**STATE.** Five clean-path items **DONE**: 54, 65, 66, 68, 73 (commits `58cbac2`, `6fae68d`+`559f967`,
`47507f1`, `037213f`, `243f175`). The runbook set is started (`docs/runbooks/`) and the research folded
(items 74–88 registered). **THE GATE IS `cli.mjs`:** it is dirty with **two seats' in-flight work** —
`cmdInit` (`cli.mjs` + untracked `demo/init.test.mjs`) and a `seatguard` change (`src/seatguard.mjs` +
`demo/seatguard.test.mjs`). Until those land, items **69/70/71/74/78** cannot be edited or committed
cleanly.

**CURRENT ITEM → NEXT ACTION.** Highest priority: **item 69 — hard write guard on every write verb** (make
"never proceed on a false `stopped` signal" code, not prose; the research report's #1 fix and the cause of
**two** store corruptions on 2026-10-16). Then **item 78** (broker crash forensics / survive a
conversation storage error). Both are **blocked on `cli.mjs`**. Anchors: item 65 = **#745**, item 66 =
**#728**; items 69–78 are **pending `pm` registration**.
**Clean-path work available NOW (no `cli.mjs`):** **item 85** (run each runbook's read-only `Diagnose`
block in CI — the set is currently unverified), **item 81** (`runbook-stale`/`runbook-unverified` `check`
rules), **item 86** (runbook verification in the `check` provenance line) — `src/checkup.mjs` + `demo/` only.
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

**Maintenance done (`806ce7f`):** broker stopped → `up rig.selfdev.json --refresh` → restarted
(`pid 14536`, `START 2026-10-16T19:33:43Z`). `impl` is now `deepseek-ai/DeepSeek-V4.1-Flash`, and the
constitution (`durig.constitution` doc 28) now carries **`prepare_workspace`** and **`P3 Language`**.
The root cause was constitution **drift**: `rig.selfdev.json` set `constitutionInline`, which
`cmdUp` prefers over `constitution.txt`, so the file edit never applied; the rig now sources
`constitution.txt` (single source). **New ROADMAP items 74–80** capture the recurrences.
**Second-writer mistake (again):** `serve --stop` returned `stopped:false` and I ran `up --refresh`
anyway, corrupting impl's `pi.live` (doc 12105); recovered from `store-backup-20261016-143336` +
`.spike/delegate/repair-live.mjs`. It reinforces items **69** (hard write guard, incl. `serve --stop`
exit confirmation) and **78** (crash forensics).

**Runbooks — research reviewed and folded (`<pending>`):** `docs/reviews/runbooks-sop-best-practices.md`
(the operator's research agent) found our conventions already match published practice; the gap is
**machinery**, not prose. Actions taken: ROADMAP items **81–88** (stale/unverified `check` rules,
mandatory front-matter, the hard write guard = item 69, `--dry-run`, executable `Diagnose`, provenance,
capability-gated agent runtime, the daemon runbook); `docs/runbooks/README.md` now carries the
front-matter, maintenance policy, agent-execution guardrails and anti-patterns; added
`_template.md`, `daemon-not-running.md`, `research-request.md`; and **P3 Runbooks** was added to
`constitution.txt` (applies on `up --refresh`). A request to author/maintain runbooks for its recent
work was spooled to `pm` via the broker inbox. The set is **unverified** where a `Verify` step has not run.
- **Item 68 DONE (`037213f`):** `reconcileStrandedSubmissions` settles a `placed` submission with no live
task before the pending set is built, so the blocked seat re-wakes. Verified live: `STRANDED settled=2`
→ `WAKE qa`, `WAKE lead`. `demo/broker-strand.test.mjs` (RED: symbol absent at HEAD).
- **Item 54 DONE (`58cbac2`):** `drivePass` takes `waitForWakes`; `runWakeLoop` passes `false` and drains
once on loop exit (F11). Fixes the loop park that made `serve --stop` hang. `demo/broker-wake-return.test.mjs`
(RED: HEAD takes 4014ms; GREEN ~0.2s).
- **Item 66 DONE (`47507f1`):** every inbox intent carries a `requestId` (so a crash between submit and
unlink re-drains idempotently), and the broker reconciles dead `genlock.*` leases at start (ESRCH only;
EPERM holders kept) and logs `RECONCILE leases=N`. `demo/broker-reconcile.test.mjs`. The orphaned-worktree
sweep is split to **item 73** — `removeClaimedWorktree` force-rm's a dirty tree, so a sweep needs a
clean-only guard first.
- **Item 73 DONE (`243f175`):** `removeClaimedWorktree` refuses a dirty worktree without `force` (D60;
fixes a latent `rm -rf` data-loss path), and the broker sweeps orphaned `item-*` worktrees at start
(clean removed; dirty reported and kept). `demo/broker-worktree-sweep.test.mjs` (RED before).
- **Item 65 DONE (`6fae68d`, `559f967`):** lease renewal + a 660 s staleness (above the 600 s stream
timeout), an EPERM-safe `holderAlive`, and heartbeat-based broker identity so a reused pid is not the
broker. The operator view and the acquire path now share `slotIsStale`. `demo/genlock-hardening.test.mjs`
(RED before).
- **Next:** clean-path items are exhausted; items **69–71** need `cli.mjs` (dirty/blocked). The command
spool (71) is the durable-plan unlock.
**Language:** the `P3 Language` constitution rule (`a0ab993`) covers all seats once the constitution is
re-applied (`up --refresh`); immediate English directives were spooled to `impl` and `qa` via the inbox.
**⛔ Gate — `cli.mjs`:** dirty with two seats' in-flight work (`cmdInit`: `cli.mjs` + `demo/init.test.mjs`;
`seatguard`: `src/seatguard.mjs` + `demo/seatguard.test.mjs`). **Do not commit those** (not this seat's
work). Resolve/land them (their owners, or an operator ruling) before items 69/70/71/74/78.
**Broker:** running `pid 14536` (`START 2026-10-16T19:33:43Z`); `.broker.json` carries `runToken` +
`heartbeatAt` (item 65 identity). Start a down broker with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1` (never set
`DURIG_SEAT_ROOT`). **Nothing restarts a dead broker — the supervision gap is items 61–64.** A broker that
died on a storage error stalled `impl` (2026-10-16); `resume` + restart recovered it.
**Pending apply — one broker stop + `up --refresh`:** the **`P3 Runbooks`** rule in `constitution.txt`
(`fe0c74c`) is not yet live for seats (the `P3 Language` rule and the impl→DeepSeek model were applied at
`806ce7f`). ⚠️ On `serve --stop`, proceed **only** on `"stopped": true` — never `false`; that is how the
store was corrupted twice. See `docs/runbooks/broker-safe-change.md`.
**Owed:** wire `reconcileStrandedSubmissions` into `cli.mjs cmdResume` (blocked on `cli.mjs`).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; restart a down broker with
`scripts/serve-noroot.ps1`. Design of record: `docs/BROKER-SUPERVISION.md` (D71/D72),
`docs/COMMANDS-AND-THE-BROKER.md` (command paths + mailbox).

**INCIDENT (2026-10-16, delegate) — a second writer crashed the broker and corrupted two run-control
docs.** 🚨 Do **not** run `resume`/`doctor` (or any write verb) while the broker is running: they are
write-side and **ignore `--help`** (they execute!). `node cli.mjs resume --help` against the live broker
was a second writer; it crashed the broker (`Task 30658 is already terminal` in `serve.err`) and left
the `pi.live` documents for qa (doc 16) and lead (doc 22) corrupt (`unresolvable path:
["generation","message","content",0]` — a mid-stream `generation` reset orphaned later appends). That
wedged **every** write-side open: the F12 guard reads each seat's persisted cwd and one bad read kills
the pi-durable session (`SessionFailed`), so `serve`/`run`/`send` all died.
**Recovery (all under `.spike/`, gitignored — no repo code changed):** backed up the store
(`.spike/delegate/store-backup-20261016-121820/`); killed 11 stale 1–2-day-old `log --follow`/`watch`
viewers; reset docs 16/22 to the clean empty-base state (`.spike/delegate/repair-live.mjs`, 69+52
deltas dropped); verified all 10 `pi.live` materialize and all 9 seat agents read in one session; ran
`resume`; restarted the broker. **If it recurs, restore the backup or re-run `repair-live.mjs`.**

**RESIDUAL DEFECT (open; needs a code fix, not store surgery):** qa (conv 15 #30661) and lead (conv 21
#30674) have a submission **stuck `placed` while its run task is already `terminal`** — a finished run
that never settled its submission. `resume` reports `run-cancelled` but does not settle it, so
`selectWakes` skips those conversations forever (`admitted_not_started` persists). Fix candidate: on
start / in `resume`, settle any `placed`/`queued` submission whose task is terminal (folds into ROADMAP
37(b) / item 66). qa owning the chaos suite (#727) is therefore not yet running.

**Seat-root trap (do not repeat):** start the selfdev broker **without `DURIG_SEAT_ROOT`** — a seat's
own prepared cwd wins (`src/seattools.mjs` `makeSeatEnv`), so a single global root conflicts with the
per-item worktree model and trips the F12 guard. Use `scripts/serve-noroot.ps1`.

**Do not poll** the running broker — the operator notifies the delegate when runs complete.

**Active queue:** current — claimed #658 (impl) and #727 (qa); queued #660/#662/#663/#665/#673/#674/
#676/#696/#700/#702/#705/#710/#713–#715/#718/#719/#723–#725/#728. All ancient rows (#60–#172) remain
`deferred` (parked on questions, not claimable). After the restart, pm/impl/advocate/scribe were woken
and progressing (advocate generating; impl working `demo/tui-client.test.mjs`).

**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; broker log is
`selfdev.sqlite.broker.log`. Restart a down broker with `.spike/delegate/dispatch-serve-noroot.ps1`
(never set `DURIG_SEAT_ROOT`) once no writer is in flight.

**Delegate clock-out this session (2026-10-16, second pass):** operational + incident recovery, no repo
code changed (the `.spike/` repair scripts are gitignored). Committed only `docs/NEXT.md`. Added
`docs/COMMANDS-AND-THE-BROKER.md` (new-maintainer command-path map: every read/write path, why one
owner, and where the daemon/mailbox fit; recommends logging the broker's start source). Tree still
holds other items' files (`cli.mjs`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `docs/STATUS.md`,
`docs/WORKFLOWS.md`, `demo/init.test.mjs`) — untouched. No push.

**Queue work running alongside:** **#662** (TUI C4 close-out — 48-col golden + lifecycle cleanup,
queued to `impl`) and **#710** (the `src/tui/driver.mjs` comment fix, queued to `impl`). ROADMAP item
54's own queue id is pending `pm` registration of the 51–58 batch.

**Landed this session (2026-10-16, delegate):** H3 DECSET 2026 synchronized output (`40f454b`); H4
grapheme-cell width, `src/textwidth.mjs` (`09e6d8d`); the TUI testing framework — shared fixtures + a
cell `ScreenBuffer` + 8 golden frames incl. the 48-col floor, `demo/tui-suite.mjs` (`aea7e74`;
`npm run test:tui` now **14/14**); B1+H5 — the type-to-seat input line (`i`, Enter → `writeIntent`,
Esc/Ctrl+C) with bracketed paste (`9af85d0`); and docs — `docs/BROKER-ARCHITECTURE.md`,
`docs/PI-DURABLE-INTEGRATION.md`, the two research reports, and the roadmap backlog items **45–59**.
The test harness immediately found a real bug (the conversation header overflowed 48 columns) — fixed
and frozen in a golden.

**Broker (diagnosed):** the resident broker (pid 34440) was parked ~15 minutes on a degenerate `qa` run
(`PASS 185` → `PASS 186`); `PASS 186` then delivered the `advocate`+`scribe` intents
(`INTENT delivered=2 dead=0`). Two `pm` intents are **spooled, not yet delivered** (registration for
the ownership items 45–50 and the doc-site item 59). The diagnosis and the fix are item 54.

**Open rulings:** the security position (55); the D11/Level-2 ruling for the TUI attach (52); and TUI
plan §D-G1–G4 (prose-measure cap, alt-screen receipts, D69/D61 supersession). `pm` registers/sequences
backlog 52–59 — the delegate does not route queue items.

**Blockers / owed:** (a) the `docs/DECISIONS.md` alignment entry is **owed** but editing it is blocked
because `DECISIONS.md` is dirty with **another item's** edit (the D61 citation correction) and staging
the file would carry that work — leave it to that item's owner. (b) The working tree holds other items'
files (`cli.mjs`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `docs/STATUS.md`, `demo/init.test.mjs`) —
**do not discard**.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; run the hermetic TUI
regression with `npm run test:tui`. If the broker is stopped, restart it with
`DURIG_DB=./selfdev.sqlite node cli.mjs serve` once no writer is in flight.

**State at this refresh (2026-10-16, delegate session, paused):** store is single-writer; the broker is
the owner; `vendor/eval/` (reference clones) and `vendor/pi-main/` are gitignored.

**.

**Test flakiness under a live broker — finding + mitigations (2026-10-16):** running
`demo/*.test.mjs` while the broker drives gave **71/78**; re-running the 8 failures individually gave
**7 pass** (flaky) + `config.test.mjs` (a legit #621 failing-first RED). Grounded causes and fixes:
- **Inherited repo config**: demos spawn `cli.mjs` with `{...process.env}` and so pick up the local
  `durig.config.json` (`DURIG_MAX_CONCURRENT_SEATS: 4`, a real provider/model, and — the worst part —
  `DURIG_DB: C:/Users/Alex/dsh-Projects/tapl-decompile/durig/tutor-pi.sqlite`, a DIFFERENT project's
  store, so a demo that forgets to override `DURIG_DB` reads the wrong database — this is the live
  `no seats in …tutor-pi.sqlite` error seen in impl's log). Fix: a hermetic test env (temp `DURIG_DB`,
  `DURIG_MAX_CONCURRENT_SEATS=1`, `DURIG_PROVIDER=faux`, and do not read the repo config).
- **Live working tree**: tests `copyFileSync("rig.starter.json", …)` and read other tracked files a seat
  is mid-editing. Fix: read fixtures from HEAD (`git show HEAD:<path>`) or run the suite from a frozen
  worktree.
- **Fixed-timeout waits**: several demos `setTimeout(…, 5–10s)`; under CPU load the wait fires early.
  Fix: poll-until-condition with a generous deadline.
- **Resource contention**: concurrent `serve`/sqlite/temp-dir churn. Fix: run the suite **with the broker
  stopped** (or in a per-task worktree) via a single `npm test` runner that isolates the env and retries
  a timeout-flake once.

Known blockers: none for the delegate work. The shared tree is dirty with #623's in-flight `cli.mjs`
and a seat's `docs/STATUS.md` edit — **DO NOT discard**; stage explicit paths only. The resident
broker is **stopped** (it exited `reason=stop` after the delegate session); restart it with
`DURIG_DB=./selfdev.sqlite node cli.mjs serve` once no `send`/`run` writer is in flight (the advocate
consult is one). **Docs landed:** D63/D64 (`0ecf9cf`), D65 (`b81e171`), D66 (this session).

_Historical (superseded): the #480-era notes below were written for the 2026-10-15 handoff._

**Future work (candidate items — not yet queued):**
- **TUI app implementation plan** — the operator-approved plan of record is
  `docs/TUI-IMPLEMENTATION-PLAN.md`. Its §C hardening items H1–H5 (sanitise untrusted text at every
  render boundary; synchronous restore on abnormal exit; DECSET 2026; grapheme/EAW-correct width;
  bracketed paste with the input line) carry the D70 posture and await `pm` registration. §D holds the
  open rulings (prose-measure cap, alt-screen receipts/search/copy/plain, D69/D61 supersession).
  Recorded facts: `ui.mjs` declares `pi-tui` but imports it nowhere, and the conversation scroll
  window is capped to the 24-entry page (`SCAN_LIMIT`).
- **TUI hardening (D70, operator-approved — folded into the plan above):** sanitise untrusted text at
  the render boundary; synchronous restore on `uncaughtException`/`unhandledRejection`/`exit`;
  DECSET 2026 around `paintScreen`; grapheme/EAW-correct width. Bracketed paste (DECSET 2004) is
  required by the type-to-seat input line, not optional polish.
- **Agent ownership (from `docs/reviews/Agent_Ownership_Review.md`)** — action items 45–50 in
  `docs/ROADMAP.md` §“Agent ownership and accountability”. Verdict: no RACI/DACI/RAPID/MOCHA; keep
  artifact-keyed ownership but make it `check`-enforced (item 46, `src/checkup.mjs`); record the
  no-RACI decision (item 45, advocate); verification must **re-execute evidence** (item 48); finish the
  review's governance/cost passes (item 49). Surface decision (item 47) is already routed to
  advocate/scribe. Awaiting `pm` sequencing.
- **pi-durable alignment (research landed; items 51–58)** — `docs/reviews/pi-durable-alignment.md` is
  complete and its verdict is folded into `docs/ROADMAP.md` §“pi-durable alignment”. durig reimplements
  exactly two things the harness already provides: **client state** (the TUI poller → item 52, adopt,
  gated by the socket security position in item 55) and **busy-input** (`whenBusy:"steer"` → item 56).
  The rank-1 change is **wake-and-return in `drivePass`** (item 54). The review's explicit keep-list is
  recorded. **How-we-build doc for maintainers and upstream: `docs/PI-DURABLE-INTEGRATION.md`.**
  Awaiting `pm` sequencing.
- **Public doc site (item 59)** — `scribe` builds a GitHub Pages static site with a landing page,
  end-user pages, and maintainer pages, projecting from `docs/` (no duplication); the framework is an
  open decision. Depends on item 22 (the public repo). Awaiting `pm` sequencing.
- **Zero trust to zero agent (research requested 2026-10-16; ROADMAP item 60)** — narrow,
  per-seat / per-item least-privilege permissions for durig's seats. Owner: operator's research agent;
  report at `docs/reviews/zero-trust-zero-agent.md`; depends on item 55 (a `security.sec` position)
  before any new trust boundary. An operator intent to `pm` to register/sequence item 60 is **spooled
  in `selfdev.sqlite.broker.inbox/`** (pending the next broker pass), alongside the two earlier pm
  intents.
- **Broker supervision / host daemon (design recorded 2026-10-16; refined after round 3; ROADMAP items
  61–67; D71)** — `docs/BROKER-SUPERVISION.md` is the design of record: a per-user agent (Windows Task /
  macOS LaunchAgent / `systemd --user`) by default, or a system daemon opt-in (Windows Service /
  LaunchDaemon / systemd system unit), hosting a **portable** thin **`src/host.mjs`** (never opens the
  store) that supervises the sole-writer broker — exit-code taxonomy, a durable `<db>.broker.down` marker
  distinct from the existing `.broker.stop`, liveness/progress heartbeats (sleep is a resume-gap, not a
  clock), and a per-platform kill-tree primitive (Job Object vs POSIX process group). Only the trigger
  file, the kill primitive, and the stop signal are OS-specific — the host is identical on Windows,
  macOS, and Linux distros.
  Sequenced **after item 54** — and **item 54 is NOT done** (the scoped D65 wait still awaits the woken
  runs; wake-and-return is pending). Item **65** is a live single-writer hazard (genlock age-steals a
  live long generation, swallows `EPERM`, trusts reused pids) and should land regardless. Per-user agent vs system daemon is an
  operator ruling. Registered, not scheduled — awaiting `pm` sequencing.
- **Broker intent-inbox** — deliver intent to a seat WITHOUT stopping the broker (a file the broker
drains each pass, sibling to `.broker.stop`). Today `cmdSend` has no broker guard, so routing needs a
`serve --stop`, which interrupts in-flight work.
- **Reset at WORK-ITEM boundaries only** (deferred mitigation 3): clear a seat's context when it
finishes a work item — explicitly NOT finer item boundaries yet.
- **Mid-run cut** (optional): the degeneration guard resets BETWEEN runs; a provider-level turn cap
would cut a single runaway run mid-flight. (Bounded runs are mitigated; this is the residual gap.)
- **Worktree leak + recursion (NEW, observed 2026-10-16):** the broker's per-task worktrees
  (`item-1/`, `item-2/` in the repo root) are **not gitignored** and **not cleaned up**, so they
  pollute `git status`; and because the #506 fix “forks the visible state”, each new worktree
  **copies the existing untracked worktrees** (`item-2` nests a full `item-1/`) — recursive growth.
  Needs a lifecycle fix (ignore the worktree root + clean up on completion).
- **`docs/DECISIONS.md` entries** — LANDED (`0ecf9cf`): D63 (broker audit) + D64 (degeneration guard),
  plus the seat's stranded D54–D62. Remaining: fix D62's text corruption (`headless \tenderTui/Frame`).

## LANDED — broker liveness: re-wake per seat, not after the slowest run (delegate-owned; D65)

**Status: DONE.** `src/broker.mjs` `drivePass` waits only on the conversations a pass woke, races
that against the loop's commit signal, and `runWakeLoop` drains globally once on exit (F11);
`createWakeSignal` gained `race(promise)`; `PASS <n> ms=<dur> woke=<a,b>` is logged. Proof:
`demo/broker-liveness.test.mjs` (RED: 1 fast wake in 2 s → GREEN: 2nd wake ~27 ms in while the other
seat still generates). Commit `b81e171`. The narrative plan below is kept as the record of WHY.

**Why delegate-owned:** the fix is to the process that DRIVES the queue (the broker). A routed item
would sit behind the very broker it is meant to fix, so it must be done in the delegate seat directly
(code + tests + commit), then handed to the operator. The operator explicitly preferred this over the
durig team for that reason.

### Symptom (observed 2026-10-16, pid 17424)
`<db>.broker.log`: `PASS 5` at `02:26:13`, its wakes fired, then **no `PASS 6` for 40+ min** (still
none at `03:10`). Measured pass intervals for this broker: 20.5, 20.3, 4.5, 27 min. Meanwhile `status`
showed **pm idle with 9 queued DONE-notices** and **qa idle with 2 queued artifacts**
(`idle_with_queued_work`), and a generation was live (genlock `scribe` since `03:10:05`). So seats with
queued work sat idle while a run was in flight.

### Root cause — what is VERIFIED vs INFERRED
**Verified (code + vendored contract):**
- `src/broker.mjs:146` (`drivePass`) calls `await harness.waitForIdle(context)` — the HARNESS method.
- Its contract (`node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:668-669`):
  > `Harness.waitForIdle` — “Resolve when the ordinary ownership scope of **every** ownerless
  > conversation has no live non-background task.”

  (A per-conversation wait exists too: `Conversation.waitForIdle`, line 87.)
- Therefore every pass blocks until **all** ownerless conversations are idle. And `src/scheduler.mjs`
  treats a submission settling as wake-relevant (“a submission settling … is exactly when a stalled
  claim becomes wakeable again”) — so the loop cannot act on that per-submission intent while parked in
  the global wait.
- **Code path (the decisive one):** `src/broker.mjs:258-274` does `await drivePass(...)` and THEN
  `passes++; logBrokerLine(dbPath, \`PASS ${passes}\`)`. So `PASS` is written **only after `drivePass`
  returns**, and `drivePass` returns **only after line 146's `harness.waitForIdle` resolves**, which is
  only when **every** ownerless conversation is idle. Consequence (a code-path FACT, not an inference):
  **no pass boundary — and therefore no next wake of ANY seat — until every in-flight run settles**; a
  seat that finished early is not re-woken until the slowest run finishes.

**UNVERIFIED (relative contribution):** how much of the 20–44-min pass time is this wait versus the
pass TAIL (`worktreeClaimed` cleanup, `supervise`). There is **no per-pass duration instrumentation**
(`grep -n 'Date.now() - |durationMs' src/broker.mjs` → none), so the split cannot be isolated without
adding it (the Observability step below) or a controlled experiment — and a controlled experiment is
blocked by the single-writer rule plus the running broker. **The mechanism is code-verified; only the
proportion is not.**

### The tool that exists to fix it
`Scheduler.waitForIdle(conversationId | undefined, context)` and `Conversation.waitForIdle(context)`
wait for **one** conversation (`harness/scheduler.d.ts:86`, `harness/types.d.ts:669`). The loop can
wait per-WOKEN-seat and re-wake others as they settle.

### The fix (chosen direction)
1. In `drivePass`, replace the single global `await harness.waitForIdle(context)` with a wait that
   settles when every conversation **this pass woke** is idle (track the woken conversation ids; wait
   on those only — do NOT wait on conversations this pass did not wake). A settle that the commit
   subscription raises should be able to end the wait early so the next pass starts promptly.
2. Preserve the F11 invariant that actually matters: **never close the harness with a live run**
   (keep it open while ANY run is in flight), rather than “wait for global idle”.
3. Leave the scheduler floor (`minIntervalMs = 500`) and per-seat cooldown
   (`SERVE_SEAT_COOLDOWN_MS = 30_000`) as-is; optionally lower the cooldown once passes are short.
4. Keep the per-pass `supervise`, but it must not gate the wake path.

### Observability (part of the fix)
- Log each pass with its DURATION and the seats it woke: `PASS <n> ms=<dur> woke=<a,b,c>`.
- Add a liveness notice/measure: “seat has queued work and **no live generation lease** for > N s” —
distinct from the existing `idle_with_queued_work`, which cannot tell “waiting for the pass” from
“wedged”. Surface in `status` and as a `check` rule.

### Tests (failing-first)
- **New `demo/broker-liveness.test.mjs`:** two seats; make one run long (faux provider with a delay /
  multi-turn script), give the other queued work; assert the second seat's wake appears in the broker
  log within a bound (≈5 s) **while the first is still running**. RED against the current
  global-`waitForIdle` broker; GREEN after the fix.
- Keep `broker.test.mjs`, `broker-max-duration`, `broker-cooperative-stop`, `broker-wakepath`,
  `broker-log`, `autostart` green; `node --check` clean; whole `demo/*.test.mjs` suite green.

### Acceptance
- A long run on one seat does NOT delay waking another seat with queued work (proven by the demo).
- Pass duration ≈ the pass's own work, not the longest run.
- Never closes the harness with a live run (no stranded submissions).
- `stop` / `serve --stop` / `--max-duration` semantics unchanged.

### Constraints / gotchas
- **Restart the broker to test the fix** — editing source does not affect the running process.
- Single-writer: only one `serve`/`run`/`send` at a time on `./selfdev.sqlite`.
- The tree may hold in-flight seat work (#623 etc.) — **stage explicit paths only**, never `git add -A`.
- Native Windows only; never push/publish.
- Related, lower priority: the **broker intent-inbox** (below) would let a delegate deliver intent
  without a `serve --stop`; and the worktree-leak defect (below) shares the same pass lifecycle.

**Earlier this session: `pi-rebase` recovery (C) re-verified COMPLETE — no action taken.**
Evidence: `git diff --diff-filter=A main origin/pi-rebase -- . ':(exclude).spike'` is empty (no
tracked file on the snapshot is absent from `main`); `demo/pitui.test.mjs` is present on `main`;
the local branch is already deleted; `docs/BRANCH-AUDIT-2026-10-14.md` records the recovery as
executed. Do NOT re-apply the snapshot (D48: adapt onto `main`, never restore a whole snapshot).

**Then (next queued item): #480 (U1) — build the `durig ui` driver (queue id #480; TOP PRIORITY; UNBLOCKED).**
The rest of the interactive-client series is **#481–#487 (U2–U7)**. U1 is the missing piece between
`src/tui/client.mjs` (a headless renderer) and the operator: a separate entrypoint that owns raw mode
+ key handling + the poll loop and paints `renderTui` frames (`cli.mjs` stays non-interactive, D21;
read-only, D11/D40).

Exact next command (drive the selfdev team; the seat root is the live tree):

`DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs send impl --body-file <body>`

and have impl `claim_work({ itemId: 480 })` FIRST — a plain `run` makes impl take its oldest queued row
(impl has ~36). Bounded alternative: `DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`.

Known blocker: the store is **single-writer** — never run two `send`/`run`/`serve` at once. No
genlock/broker is held at handoff.

**Session state (2026-10-15 delegate handoff — do not re-derive):**
- **#473 (worktree lifecycle wiring) DONE and qa-VERIFIED.** qa's #477 verdict = PASS (68/68,
  `node --check` clean). qa's caveats: the demo does NOT exercise the live `drivePass` claim path
  (reviewed only), and 5 pre-existing silent-return catches remain (`src/broker.mjs:317,375`;
  `src/worktree.mjs:104,216,394`).
- **Model swap (D51):** the five former Qwen seats (`impl`, `qa`, `advocate`, `auditor`, `designer`)
  now run `zai-org/GLM-5.3-Flash`; `rig.selfdev.json` edited + `up --refresh` applied. No context reset
  was written — the operator may `reset <seat>` the five.
- **TUI re-prioritized** by pm into **#480–#487 (U1–U7)**: U1 driver, U2 team-wide multi-pane of
  actively-generating seats (live generation state, NOT queue depth), U3 in-place tool-call block,
  U4 pi-style tool bg/fg, U5 thinking parity, U6 re-open the bogus C4 verification, U7 poll-first vs
  Level 2 to lead/operator. pm also cleared the #188/#193 deferrals (#487).
- **Lower priority, NOT registered** (operator deferred): `watch`/`seatActivity` shows green "working"
  for ANY `claimed` row, so impl's **6 stale claims (#287, #289, #290, #291, #294, #335)** read as active.
  Two-part fix: resolve those rows (impl completes/cancels; pm cancels its five; #287 is lead's), and
  make green require a live lease/in-flight submission.

Then, in order:
1. **#473** — wire worktrees into claim/completion: on claim, create the item's worktree+branch and
   point the working seat's cwd/`DURIG_SEAT_ROOT` at it; on completion, commit ONLY the item's files
   on its branch, release the lock, `git worktree remove`. **#474 is GATED on #473** — do NOT put
   "commit before finishing" into any seat's instructions until the wiring is proven, or seats will
   commit from the shared tree and stage each other's work. #475 documents the model.
2. **GROOM THE QUEUE** — it is churning: **135 non-terminal** (impl 65, pm 44, qa 15). Most are
   `DONE`-report rows pm must process and artifacts qa must verify. `peek_queue(all=true)` is now
   uncapped (#433), so pm can enumerate; use `cancel_work` (D47) for stale/duplicate rows.
3. **qa verification backlog** — #391/#393/#395/#449 (commit policy), #456/#458/#460/#462/#464/#466
   (broker + help + coordinator), #451 (TUI C3). qa's own DONE reports back to impl (#410–#448) also
   need settling.
4. **TUI** — C3 (#404) built, C4 (#405) reported "done but blocked" by qa; the corrected C4
   verification is owed. Designer UX follow-ups #437 (C6, done via #428), #439 (C7 defaults),
   #440 (C8 error messages), #442 (C9 rig auto-discovery), #444 (C10 meta-defaults). Advocate #407.
5. **#400** broker wake-path verification; **#402** #148 half-2 seam (cmdUp --refresh); **#415**
   verify the concurrency statement against code.
6. **Docs gate items #390/#398/#401/#468–#471** — much of this was written by the delegate this
   session (FEATURES/STATUS/SELFDEV), but the items are still open; have scribe verify and close them
   rather than redo the work. `scribe` is `last_run_failed` (wedged on #468) — `reset scribe` first.

## What landed this session (all LOCAL — unpushed; operator holds push)

`main` is at the handoff commit; the six code/doc commits through **`ddd9c49`** are now on
**`origin/main`** (pushed externally — NOT by the delegate), and only the handoff commit is local.
Tree clean, suite **68/68**.

| Commit | Content |
|---|---|
| `80ac4d5` | **#330 Phase 2** — per-task worktree lifecycle + Windows Job-Object reaping |
| `5b21763` | **#384–#386/D50** — developer commit authority; commits scoped to the item |
| `5ecddd1` | **#428–#433** — broker bounds/cooperative-stop/log/concurrent attribution; `--help`; uncapped `peek_queue` |
| `e28a653` | **TUI C3** client (`src/tui/client.mjs`) + read-layer proofs |
| `82a89f2` | **docs** truth-up (FEATURES/STATUS/DECISIONS/SELFDEV/WORKFLOWS/SELF-ADMIN/NEXT) |
| `ddd9c49` | **fix(test)** — broker demos no longer swallow cleanup errors |

Note: `git grep -n "claimWorktree" -- cli.mjs src/` returns only `src/worktree.mjs` — the wiring is
the whole point of #473.

## Pitfalls that slowed this session down (read before driving)

- **`run`/`serve --max-duration` is now a real bound (#429), but it was not** — a `--max-duration 300`
  broker ran >15 min. If you see that again, it is the defect, not your invocation.
- **`stop <seat>` aborts the run but leaves the `send` parent process alive.** `resume` finds nothing.
  After a `stop`, check for a lingering `node cli.mjs send ...` and `taskkill /F /PID` it. (Recorded
  lesson.)
- **A forced kill leaves a STALE genlock slot** (`.genlock.N`, dead pid) and the next driver may warn
  `held by pid <dead>` / `pid undefined` and stall. Check `selfdev.sqlite.genlock.*`; remove the ones
  whose pid is dead (they are lock files with no work).
- **A stop can also leave `cli.mjs serve --help`-style stray processes.** `Get-CimInstance Win32_Process`
  filtered on `cli.mjs (send|run|serve)` is the fast check.
- **Seats thrash on hard native-interop work** (the P2-6 Job Object cost ~2 h across two abort/reset
  cycles). Give a bounded instruction; if the seat ignores it, `stop` + `reset <seat> <handoff>` and
  re-scope — do not let it run.
- **The broker/driver order is oldest-first per seat.** New priority items sit behind a 60-item
  backlog, so `claim_work({itemId})` via a direct `send <seat> --body-file` is the way to prioritize;
  grooming is the structural fix.
- **Two writers, precisely.** One *store/harness* writer per DB (two `run`/`send` drivers race on the
  entry id, F24; `run`/`up` are not retried). Concurrency is `serve` + `DURIG_MAX_CONCURRENT_SEATS`.
  Per-task worktrees will make concurrent *editing* safe once #473 lands.
- **Full suite > 120 s** so a single tool call times out; loop `demo/*.test.mjs` per file with a long
  timeout, or background it. Baseline is now **68/68** (the old `starter.test.mjs` CRLF failure is FIXED).
- **`edit` needs exact indentation and line endings.** The demo tests use 2-space indent; `src/rig.mjs`
  and others are CRLF. When a match misses, run `sed -n 'A,Bp' file | cat -A` before retrying.
- **Empty `catch {}` violates "errors are not swallowed"** and the warden flags it. Reporting it
  surfaced two real bugs in the broker demos (a scoped `broker` ReferenceError and `require` in ESM).
- **Seats clean up badly:** scratch appeared as `docs/WORKFLOWS.md.tmp`, `test.log`, and
  `undefined.broker.log`. The last one is a real bug: `src/broker.mjs` `brokerLogPath(dbPath)`
  returns `` `${dbPath}.broker.log` ``, so a falsy `dbPath` writes `undefined.broker.log` (it
  regenerates on a suite run). Guard against a falsy `dbPath` (no-op or throw). `git status` before
  every commit.
- **qa sometimes marks an item done while reporting it blocked** (#336/C4). Check the result text.

## Workspace state for the next agent

- **No writer is running on `./selfdev.sqlite`** except the detached `send advocate` consult
  (`.spike/delegate/advocate-consult.*`) — do **not** start a second `serve`/`run`/`send` until it
  exits, then restart the broker with `DURIG_DB=./selfdev.sqlite node cli.mjs serve`. Two drivers on
  one store double-wake (D45/D46).
- **The tree is DIRTY with #621's in-flight work** (`cli.mjs`, `src/config.mjs`, `demo/config.test.mjs`,
  `durig.config.default.json`) — **DO NOT discard**; it belongs to the claimed item. `item-1/`,`item-2/`
  are leaked worktrees (see the NEXT SESSION note).
- **Backups under `.spike/delegate/`**: `recovery-WIP.patch`, `storewrite-WIP.mjs`,
  `p2-6-scratch/` (the Job-Object attempts), `scratch-backup/` (the removed scratch), and the
  intent bodies used this session. `.spike/` is gitignored.
- **Env**: run with `DURIG_DB=./selfdev.sqlite` and `DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig`.
  `durig.config.json` sets `DURIG_MAX_CONCURRENT_SEATS=4` (local, gitignored) for concurrency testing.
- **Native Windows only** — never `wsl`, `docker`, `docker-compose`.

## Traps (standing — do not repeat)

- **NEVER run `git stash`/`reset`/`checkout`/`restore`/`clean` from a seat** — not with a trailing
  `;`/`&&`/`|`. The guard catches the anchored forms (#329) but the denylist is only a backstop.
- **Only a write-side process wakes seats** (`send`/`run`/`serve`); viewers never do (D11).
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat;
  `peek_queue(all=true)` now mitigates the enumeration half.
- **A seat can wander or degenerate** (F29) — `reset <seat> <handoff>` then re-drive.

## Where main is

`main` = **`6cfe481`** (this handoff commit); **`origin/main` = `c3a2671`** — `main` is **ahead by 30
commits**, all local (the operator holds push). Do not assume anything is pushed.
Untracked/ignored: `.spike/`, `pi-warden.md`, `vendor/`, and `item-1/`+`item-2/` (leaked worktrees —
currently NOT ignored, which is the defect).
