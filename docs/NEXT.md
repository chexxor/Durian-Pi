# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-14, operator's delegate session (broker verification + doc truth-up)._

## NEXT SESSION — START HERE: the resident broker is DONE; close its two follow-ups

**The broker the previous pointer asked for is built and committed.** `node cli.mjs serve`
(`src/broker.mjs` + `src/scheduler.mjs`, D45), `up` auto-starts it on a TTY (D46), and it was
observed **auto-waking `devtools`** against `selfdev.sqlite` with no manual `run`/`send` — the #238
goal. The supersede-D11 D-entry exists (D45) and no socket was opened, so no `security` position was
triggered. #238 is `cancelled`; the old "build the auto-wake" pointer is obsolete.

Verify before trusting: `node demo/broker.test.mjs`, `node demo/scheduler.test.mjs`,
`node demo/autostart.test.mjs` (all exit 0 on this HEAD).

**Two follow-ups from the broker's first live run are the natural next work** (`docs/ROADMAP.md`,
both registered, neither fixed):

- **F34 — a broker-driven generation carries no seat in the genlock lease**
  (`src/genlock.mjs:83` still records `options.seat ?? null`; the broker is not a seat), so
  `status`/`watch` show an ownerless in-flight generation. Fix: carry the driven seat's name onto
  the wake submission, or have `readGenerationSlots` fall back to the conversation's seat.
- **F35 — `serve --stop` on Windows tears the broker down mid-pass** (Node does not deliver
  `SIGTERM`; no `<db>.broker.stop` cooperative path exists), which can strand the in-flight run.
  Fix: a cooperative, pass-settling stop on every platform, killing only as a last resort.

Exact drive command (one write process at a time; SHORT bounded chunks):

`cd durig && DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`

## State of the broker work (verified this session)

- **`serve` + scheduler + autostart: DONE, committed, verified.** Commits (on `main`):
  `8337d0a` (change-triggered wake scheduler, piece 1/2), `6cfef88` (resident `serve` broker +
  shared wake pass, piece 2/2), `ddf7cca` (`up` auto-starts the broker, TTY-gated, D46),
  `b542936` (`revise_work`/`cancel_work`, D47). `src/broker.mjs` 223 lines, `src/scheduler.mjs`
  199 lines. Demos `broker`/`scheduler`/`autostart` all exit 0.
- **No-wake-storm invariants** live in `src/scheduler.mjs` (coalescing, global floor, per-seat
  cooldown); the wake decision itself is still `selectWakes`/`driveOnce` in `src/driver.mjs`, so the
  bounded `run` loop and the resident broker cannot drift.
- **F36 (queue cannot be curated) is FIXED** by D47 (`cancel_work`/`revise_work`, terminal
  `cancelled`). The *triage* of the ~40 stale items it exposed is still owed (`docs/QUEUE-TRIAGE-2026-10-14.md`).
- **The old worktree `C:/tmp/durig-dev/pi-rebase/durig` no longer exists.** Its work is now on
  `main`; do not go looking for it.
- **Suite health: 53 demos, 52 PASS / 1 FAIL at HEAD `762d95f`.** `demo/starter.test.mjs` fails on a
  **LF/CRLF drift**: with `core.autocrlf=true` and no `.gitattributes`, `constitution.txt` checks out
  CRLF while the `constitutionInline` string in `rig.starter.json` is LF, so they no longer compare
  equal. Pre-existing and unrelated to docs; it is the F32/#291 LF-vs-CRLF family (normalize endings).
  The broker demos (`broker`/`scheduler`/`autostart`) all exit 0.

## Open backlog (ids)

- **Broker follow-ups (next):** **F34** (lease seat attribution), **F35** (Windows cooperative stop).
- **Queue hygiene:** item **#287** is `claimed` by `impl` but **stale** — it proposed a doc update
  whose content ("broker GATED; do not write the D-entry") D45/D46 have overtaken. It needs
  re-scoping or cancelling, not executing as written. ~48 non-terminal items remain, many stale DONE
  acks; a `pm` triage pass (F36's other half) is the lever.
- **Long waits / context:** **#289** (handoff/compact on a long wait) + **#290** (4th option: refresh
  the cache — measure-first).
- **Seat ergonomics:** **#291** (`edit` LF vs CRLF `src/rig.mjs` → normalize endings), **#292** (a
  doc proxy escaping `api.commit` → `Cannot use a settled overlay`; shared snapshot helper).
- **Earlier:** #251 (pin JSON guard), #252 (`send --max-duration`), #253 (root-name guard), #254
  (confine/shell parity), #258 (stale genlock slot), #275 (degenerate-loop notice), #156 (B1 read gap).

## Traps (learned — do not repeat)

- **Only a write-side process wakes seats** (`send`/`run`/`serve`); `watch`/`log` never do (D11).
  The broker is the single long-lived writer that *is* the harness (D45).
- **Never run two CLI write processes at once** (F24) — and `run` now refuses while a `serve` broker
  drives. At most one broker per database (`<db>.broker.json`).
- **`send` blocks until the whole generation settles** (no `--max-duration`, F19/#252) — background
  it (`Start-Process`) or use `run --max-duration`.
- **A seat can loop** (F29) — `reset <seat> <handoff>`; a corrupt `pi.live` needs
  `scripts/repair-pi-live.mjs` (retire).
- **`edit` miss on a CRLF file → re-read the region, never shell-edit** (F32); **never let a doc
  proxy escape `api.commit`** (F33); keep the seat root clean (scratch under `.spike/`).
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat.

## Where main is

`main` is `762d95f`; the tracked tree is **clean** (the earlier uncommitted viewmodel/readapi/
livestream work landed in `789ead6`). Untracked only: `AGENTS.md`, `pi-warden.md`, `vendor/`.
Nothing was pushed. Integration and publishing remain the operator's call.
