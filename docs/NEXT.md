# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-14, operator's delegate session (peek_queue fix + corruption repair + auto-wake investigation)._

## NEXT SESSION — START HERE: build the auto-wake (the broker)

**Goal (operator):** seats must be **auto-notified when they are stuck, waiting, or have queued work**,
with no external clock. Today nothing drives the queue unless a human runs `run` or `send`.

**Verified finding that motivates it:** only **read-only viewers** were running (`node cli.mjs watch`,
several `log … --follow`). Viewers are forbidden from waking seats by design — `src/driver.mjs`
*"a passive viewer never schedules (D11)"*, `cli.mjs:274`. `devtools` sat idle with 3 queued items + a
stalled claim because no write-side driver ran. The wake rule (`selectWakes`) is correct — it *would*
wake `devtools`; nothing invokes it.

**Build PIECE 3 — the resident broker** (`docs/PUSH-ARCHITECTURE.md` §3.2/§3.3), registered **gated as #238**:
- (a) a recorded **D-entry that supersedes (not erases) D11** — D11's evidence (SQLite has no
  cross-process notify; a separate viewer must not attach a harness) is *why* the broker owns the
  harness; (b) a **security position only if it opens a socket** (loopback+auth; prefer an in-process
  handoff, no socket); (c) sequenced after PIECE 2 (done).
- **Cheaper interim worth considering:** a **watchdog** that wakes exactly the stuck cases —
  stalled claim, `admitted_not_started`, `deferred`-to-a-seat aged — reusing `src/supervisor.mjs`'s
  residual set, without a full broker. A stuck-claim wake is the concrete thing `devtools` needed.
- The D-entry must be written by a **file-capable seat**: `lead` is a coordinator with no write tool
  (**#156**), so route the D-entry text to `impl`/`scribe` to record.

Exact drive command (worktree seat root; SHORT bounded chunks):
`cd durig && DURIG_SEAT_ROOT=C:/tmp/durig-dev/pi-rebase/durig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`

## State of this session's work

- **`peek_queue` fix: DONE + verified** (worktree): bounded inline view — counts + first 20 + footer,
  never a bare path — `demo/peekqueue.test.mjs` PASS, `node --check src/rig.mjs` ok; artifact to qa
  **#293**. (The operator's complaint: it returned only a file path.)
- **`impl` corrupt `pi.live`: REPAIRED.** `stop`+`resume` did not clear it; `reset` threw; a `["r",{}]`
  root-replace did **not** reset the materialization base. **Retiring** the corrupt incarnation fixed
  it. Tool: **`scripts/repair-pi-live.mjs <db> <conversationId>`**. Verified: `watch --once` silent,
  `reset impl` succeeds.
- **Viewer resilience (live tree):** `src/readapi.mjs` `readLiveState` now catches an unreadable
  `pi.live`, warns once, returns `{}`, so `log --follow`/`watch` no longer crash on one corrupt seat.
  (The worktree **inlines** `readRigHealth`; apply the same guard there on merge — F23.)
- **`impl` seat:** model → `Qwen/Qwen3.6-35B-A3B`, context reset, healthy.
- **Findings F30–F33** + "Server-side cache and long waits" in `docs/DOGFOOD.md`.

## Open backlog (ids)

- **Auto-wake:** **#238** (broker, gated) — the priority; **#294** (mid-turn steering: Pi has `steer`,
  pi-durable's submit is `type:"input"` only).
- **Long waits / context:** **#289** (handoff/compact on a long wait) + **#290** (4th option: refresh
  the cache — measure-first).
- **Seat ergonomics:** **#291** (`edit` LF vs CRLF `src/rig.mjs` → normalize endings), **#292** (a doc
  proxy escaping `api.commit` → `Cannot use a settled overlay`; shared snapshot helper).
- **Earlier:** #251 (pin JSON guard), #252 (`send --max-duration`), #253 (root-name guard), #254
  (confine/shell parity), #258 (stale genlock slot), #275 (degenerate-loop notice), #156 (B1 read gap).
- **Pending qa:** #293 (peek), and artifacts #280/#282/#288.

## Integration state (F23 — read carefully)

All recent **code** is in the seat worktree `C:/tmp/durig-dev/pi-rebase/durig` (uncommitted): the
PIECE 1 spike `.spike/pi-wake/`, `src/eventfeed.mjs` + `events`, `src/storewrite.mjs`,
`hold_work`/`release_work`, `claim_work({itemId})`, the F25–F28 fixes, the peek fix, `src/worktree.mjs`
dirty-source refusal, and docs. **Live docs are authoritative** this session (DECISIONS D41–D43,
ROADMAP, FEATURES, STATUS, SELFDEV, DOGFOOD, this file), and the live tree also has the viewer guard
in `src/readapi.mjs`. On merge, reconcile `cli.mjs`'s read path: live uses `src/readapi.mjs`; the
worktree inlines `readRigHealth`.

## Traps (learned this session — do not repeat)

- **Only a write-side process wakes seats** (`send`/`run`); `watch`/`log` never do (D11).
- **Never run two CLI write processes at once** (F24); the worktree `send` retries, `up`/`run` do not.
- **`send` blocks until the whole generation settles** (no `--max-duration`, F19/#252) — background it
  (`Start-Process`) or use `run --max-duration`.
- **A seat can loop** (F29) — `reset <seat> <handoff>`; a corrupt `pi.live` needs
  `scripts/repair-pi-live.mjs` (retire).
- **`edit` miss on a CRLF file → re-read the region, never shell-edit** (F32); **never let a doc proxy
  escape `api.commit`** (F33); keep the seat root clean (scratch under `.spike/`).
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat.

## Where main is

`main` is `a43ef44`. The operator's uncommitted direct work (viewmodel/readapi/livestream, and the
`pi-main.pin.json` bump) is still **uncommitted**; integration and publishing are the operator's call.
Nothing was pushed.
