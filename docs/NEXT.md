# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-14, operator's delegate session (Phase 2 #330 delivered — P2-1..P2-6)._

## NEXT SESSION — START HERE: TUI C3 (#335), then the qa backlog, and the operator's integration

**#330 PHASE 2 IS DONE AND qa-VERIFIED (#351–#356).** All six parts landed in the LIVE tree
(uncommitted — the operator commits): per-task worktree lifecycle, per-worktree
`npm ci --prefer-offline`, git-identity validation, rebase-before-merge + `rerere`,
`git worktree remove`-only cleanup (refuse dirty/junction), and Windows Job-Object process reaping.
Verification artifacts #365/#367/#369/#371/#373/#376 are DONE (qa re-ran the demos: PASS).

**Operator action owed:** integrate/commit the Phase 2 work — `src/worktree.mjs` (modified),
`src/job-object.mjs` (new), `demo/worktree-lifecycle.test.mjs` (new), `demo/job-object.test.mjs` (new) —
plus the earlier TUI C1/C2 work already in the tree: `demo/readapi.test.mjs` (new),
`demo/viewmodel.test.mjs` (modified). Nothing is pushed.

Exact next command (drive the selfdev team; the seat root is the live tree):

`DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`

What remains, in priority order:

0. **Docs refresh owed (operator-flagged).** Phase 2 is a feature and `docs/FEATURES.md` is stale:
   line 43 still says `worktree <path>` uses a `node_modules` junction (Phase 1 removed it), and there
   are no entries for the per-task lifecycle, git-identity validation, rebase+rerere,
   `git worktree remove`-only cleanup, or `src/job-object.mjs` Job-Object reaping. `docs/STATUS.md`
   predates both the TUI read layer and Phase 2. Route to **scribe** (it owns FEATURES.md/STATUS.md).
1. **TUI C3 (#335)** — `src/tui/client.mjs` (seat list + transcript + streaming row + status bar +
   footer); then **C4 (#336, qa + auditor)** headless render tests at 80×24 / 60 / 48 cols + lifecycle
   cleanup. (C1 #333 and C2 #334 are DONE.)
2. **qa backlog** — older artifacts still queued: #331 (#329), #345 (#300), #347 (#330 Phase 1),
   #349 (#339), #359 (#333), #363 (#334), plus qa's own reports to impl (#378–#383).
3. **Housekeeping** — #357 (the "cancel #327" item) is complete in effect (#327 is `cancelled`) but
   the row still reads `queued`; #358 is a stale `DONE #303` ack. Have pm settle both. The `events`
   feed publishes durable events, so a reader can confirm the transitions.
4. **#328 (CRLF/LF drift + stale starter)** — still logged for later; unchanged. Regenerate
   `rig.starter.json`'s `constitutionInline` as part of it.

**Known hard detail (do not re-derive):** `src/job-object.mjs` uses a runtime PowerShell `Add-Type`
P/Invoke helper. It only works if `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` is passed at exactly
**144 bytes** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`) at offset 16; any other size gives
`STATUS_HEAP_CORRUPTION` (0xC0000374). This deserves a deliberate review (or a native addon) before
being trusted in production. The earlier failed scratch is at `.spike/delegate/p2-6-scratch/`.

## Recovered in an earlier session (now COMMITTED on main)

The repo split kept the worktree's COMMITTED work (broker, cancel/revise, TUI) and lost its
UNCOMMITTED work. The snapshot branch **`pi-rebase` (commit `3bf61b1`)** held it; it was adapted onto
`main` as one-concern items (author=impl, verifier=qa):

- **#307 claim-by-id** — `claim_work({itemId})`, same queued-only whitelist (a `held` item stays
  unclaimable by id too). DONE, demo `rearmclaim`.
- **#308 worktree dirty-source guard** — `uncommittedInSource(source)` refuses a fork over
  uncommitted work. DONE, demo `worktree`.
- **#309 `held` + hold_work/release_work** — DONE, demo `defer`.
- **#310 store-write retry** — NEW `src/storewrite.mjs` wired into `cmdSend`. DONE, demo `storewrite`.
  KNOWN LIMIT: `up`/`run` not covered.
- **#311 event feed** — NEW `src/eventfeed.mjs` + the `events` verb (`--since`/`--follow`). DONE,
  demo `events`. `main`'s FEATURES.md advertised `events`; it now exists.
- **#312 bounded peek_queue** — landed. DONE, demo `peekqueue`.
- **F34 (#299)** — a broker-driven generation now names the seat in the genlock lease (`drivePass`
  sets `DURIG_ACTIVE_SEAT` before `waitForIdle`; `wrapProviderWithSlots` `getSeat` names it). DONE,
  demo `f34`. **KNOWN LIMIT:** multi-seat concurrency attributes to the *last-woken* seat.

## Branch audit — DONE (earlier delegate session)

Full audit: **`docs/BRANCH-AUDIT-2026-10-14.md`**. Outcome:

- `selfdev-f12`, `selfdev-item10`, `selfdev-stall` — **fully integrated** into `main`; local branches
  DELETED (origin keeps them). `selfdev-110` — superseded regression; deleted.
- **`pi-rebase` — fully recovered; local branch deleted.** Its one lost artifact,
  **`demo/pitui.test.mjs`** (the #192 pi-tui dependency proof, blob `36d97417`), was landed by impl
  via item **#339 (DONE)** and verifies green. `origin/pi-rebase` remains as backup until the operator
  commits the working tree.
- **`item-148` stays untouched** (operator paused #148 per #180; it also carries the still-missing
  #43(a) reasoning-effort map). **`selfdev-borrow`** ratchet stays with deferred #60.
- Remaining local branches: `main`, `item-148`, `selfdev-borrow`.

## Safety backups from the stash incident

- `.spike/delegate/recovery-WIP.patch` — full tracked-WIP diff (859 lines).
- `.spike/delegate/storewrite-WIP.mjs`, `.spike/delegate/impl-peek-redo.patch`.
- `stash@{0}` still holds the original sweep; do **not** drop it until the operator integrates.

## Open backlog (ids)

- **Done recently:** #330 Phase 2 (#351–#356) + verifications (#365/#367/#369/#371/#373/#376);
  #327 cancelled; #333/#334 TUI C1/C2; F35 #300, #251, #329, #339.
- **Open:** TUI C3 #335, TUI C4 #336; qa backlog #331/#345/#347/#349/#359/#363; qa→impl reports
  #378–#383; stale rows #357/#358 (settle); long waits #289/#290; seat ergonomics #291/#292.
- **Earlier deferred:** #252, #253, #254, #258, #275, #156; #120/#220 wait on the human.

## Traps (learned — do not repeat)

- **NEVER run `git stash`/`reset`/`checkout`/`restore`/`clean` from a seat — not with a trailing
  `;`/`&&`/`|`.** The guard misses those forms and one wiped the tree in an earlier session (see the
  gap above). (The anchored refusal landed in #329; the regex denylist is still only a backstop.)
- **Only a write-side process wakes seats** (`send`/`run`/`serve`); viewers never do (D11).
- **Never run two CLI write processes at once** (F24); `send` now retries entry-id conflicts (#310).
- **`send` blocks until the generation settles** — background it or use `run --max-duration`.
- **The broker's harness is turn-based**; a wake is an event injection that STARTS a turn.
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat.
- **A seat can wander or thrash** (F29) — a tight direct steer + `reset <seat> <handoff>` recovers it;
  a seat that ignores a bounded instruction should be `stop`ped and re-scoped, not left running.
- **Keep scratch under `.spike/`** — a thrashing seat wrote ~10 scratch files into `src/` this session;
  they were moved to `.spike/delegate/p2-6-scratch/` and removed from the tree.
- **An abandoned `send` parent can linger after `stop <seat>`** (the seat run aborts, the send wrapper
  does not). Confirm no genlock and no active generation, then `taskkill /F /PID <that node>`.

## Where main is

`main` is `30632a1` ("docs(durig): add LLM long-term memory research notes"); local `main` is ahead of
`origin/main` and **unpushed** (the operator holds push). Untracked: `.spike/`, `AGENTS.md`,
`pi-warden.md`, `vendor/`, `docs/LLM_Agent_Long_Term_Memory_Strategies.md`.

**Uncommitted team work in the tree (verified by the delegate; the operator integrates/commits):**

- **#351–#356 (Phase 2)** — `src/worktree.mjs` (modified, +231 lines), `src/job-object.mjs` (new),
  `demo/worktree-lifecycle.test.mjs` (new, 19/19 green), `demo/job-object.test.mjs` (new, green).
  qa re-verified #365/#367/#369/#371/#373/#376 → PASS. **Amendment after that PASS:** the four
  Phase 2 files had swallowed `catch` blocks (empty/comment-only); these were fixed to report the
  best-effort error (operator-flagged) with no control-flow change. The delegate re-ran both demos
  after the amendment → exit 0, so the verification still holds.
- **TUI C1/C2** — `demo/readapi.test.mjs` (new), `demo/viewmodel.test.mjs` (modified). Not yet committed.

Full suite at this state: the P2 demos are green; the only known failure remains the pre-existing
`demo/starter.test.mjs` LF/CRLF drift (#328/#291, out of scope).
