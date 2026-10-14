# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-14, operator's delegate session (broker verification + lost-tranche recovery)._

## NEXT SESSION — START HERE: Phase 2 (#330) per-task worktrees, then F35 (#300) and qa

**Current item: #330 (Phase 2 — per-task worktrees, the load-bearing isolation).** **Known
blocker:** Git for Windows here is **2.42.0**, below the **2.54.0** that fixed `git worktree remove`
deleting *through* a junction; the existing `node_modules` junction must be removed and none may
remain (or upgrade Git). **Decision: stay on npm** (`npm ci --prefer-offline`, measured 12 s / 111 MB,
committed suite 52/53) — not pnpm.

Exact next command (drive the selfdev team; the seat root is the live tree):

`cd durig && DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`

**The resident broker is DONE** (`serve`, D45/D46) and was observed auto-waking `devtools` with no
manual action. **The lost worktree tranche is RECOVERED** onto the working tree (#307–#312). **F34 is
fixed.** **Phase 1 (#329) is DONE** (guard anchors + refusal-redirect, the norm, the failing-first
recipe, demo cases; suite 55/56). What remains:

1. **#330 Phase 2 (per-task worktrees, load-bearing)** — one worktree + one branch per queue item,
   create-on-claim / remove-on-completion, rebase-before-merge; **replace the `node_modules` junction
   with an independent `npm ci --prefer-offline`** (never a junction); git-identity validation
   (`--show-toplevel` == path, `--absolute-git-dir` != `--git-common-dir`, `.git` is a file);
   **Job-Object reaping** (no SIGTERM); cleanup via `git worktree remove` only. Shares the Windows
   signal gap with F35 — consider landing together. Full design: `docs/Shared_Working_Tree_Safety_Research.md`.
2. **F35 (#300)** — `serve --stop` on Windows tears the broker down mid-pass (no `SIGTERM`); make the
   stop cooperative and pass-settling (poll `<db>.broker.stop`, wait for the state file to clear,
   kill only as a last resort).
3. **CRLF/LF drift + stale starter — #328, LOGGED FOR LATER** — with `core.autocrlf=true` and no
   `.gitattributes`, `constitution.txt` checks out CRLF while `rig.starter.json`'s inline copy stays
   LF, so `demo/starter.test.mjs` fails at HEAD. Same family as #291. **Also:** #329 edited
   `constitution.txt` (added P1 Evidence, P2 Isolation/Authority, P3 Safety) but did not regenerate
   the starter's inline copy, so the test now drifts on CONTENT too — **regenerate
   `rig.starter.json`'s `constitutionInline` as part of #328.** Do not start until the higher items clear.
4. **qa** — artifacts queued but not yet verified: #313 (#307), #315 (#308), #317 (#309), #319 (#310),
   #321 (#311), #323 (#312), #325 (F34).

## Recovered this session (working tree; NOT committed — integration is the operator's)

The repo split kept the worktree's COMMITTED work (broker, cancel/revise, TUI) and lost its
UNCOMMITTED work. The snapshot branch **`pi-rebase` (commit `3bf61b1`)** held it; it was adapted onto
current `main` as one-concern items (author=impl, verifier=qa):

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

All recovered files: `src/{rig,worktree,broker}.mjs`, `cli.mjs`, NEW `src/{storewrite,eventfeed}.mjs`,
demos `{rearmclaim,worktree,defer,storewrite,events,peekqueue,f34}.test.mjs`, plus the doc truth-up.

## Safety backups from the stash incident

- `.spike/delegate/recovery-WIP.patch` — full tracked-WIP diff (859 lines).
- `.spike/delegate/storewrite-WIP.mjs`, `.spike/delegate/impl-peek-redo.patch`.
- `stash@{0}` still holds the original sweep; do **not** drop it until the operator integrates.

## Open backlog (ids)

- **F35 #300** (broker stop) · **#325/#313/#315/#317/#319/#321/#323** (qa artifacts).
- **Long waits / context:** #289 + #290. **Seat ergonomics:** #291 (LF/CRLF), #292 (doc-proxy).
- **Earlier:** #251, #252, #253, #254, #258, #275, #156.
- **Stale queue rows:** #287 (obsolete doc item) and ~40 old DONE acks; a `pm` triage with
  `cancel_work` (now that the queue can be curated, D47) is owed.

## Traps (learned — do not repeat)

- **NEVER run `git stash`/`reset`/`checkout`/`restore`/`clean` from a seat — not with a trailing
  `;`/`&&`/`|`.** The guard misses those forms and one wiped the tree this session (see the gap above).
- **Only a write-side process wakes seats** (`send`/`run`/`serve`); viewers never do (D11).
- **Never run two CLI write processes at once** (F24); `send` now retries entry-id conflicts (#310).
- **`send` blocks until the generation settles** — background it or use `run --max-duration`.
- **The broker's harness is turn-based**; a wake is an event injection that STARTS a turn.
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat.
- **A seat can wander** (F29) — a tight direct steer + `reset <seat> <handoff>` recovers it; do not
  let it run on stale backlog items.

## Where main is

`main` is `762d95f`; the tracked tree is dirty with the recovered tranche + doc truth-up (uncommitted
by design — the operator integrates and commits; seats are guard-blocked from committing). Untracked:
`.spike/`, `AGENTS.md`, `pi-warden.md`, `vendor/`, `docs/LLM_Agent_Long_Term_Memory_Strategies.md`,
`src/{storewrite,eventfeed}.mjs`, and several new demos. Nothing was pushed.
