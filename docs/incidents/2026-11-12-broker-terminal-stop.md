# 2026-11-12 — the resident broker stopped terminally at 21:17Z and looked healthy for four minutes

**Host:** Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0.
Probe: `uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

**Status:** root cause fixed (`575a67e8`, D274); the live broker was re-armed by the keepalive and the fix takes
effect at its next re-arm. One fact remains unresolved and is the operator's to answer (the push, below).

## What happened

| time (Z) | event | evidence |
| --- | --- | --- |
| 21:15:40 | a broker pass met `database is locked errcode=5` | `PASS-FAILED SessionFailed: Session failed after a storage error; close and reopen it cause=Error: database is locked errcode=5 errstr=database is locked` |
| 21:15:48 → 21:16:45 | every later pass met the CLOSED handle | `INTENT-RETRY op=read … reason=SqliteStorage is closed`, `PASS-FAILED Error: SqliteStorage is closed` |
| 21:16:50 / 21:17:01 / 21:17:21 | reopen attempts 2, 3, 4 with 5 s / 10 s / 20 s backoff | `HARNESS-REOPEN attempt=2 in=10000ms`, `attempt=3 in=20000ms` |
| 21:17:21 | **reopen cap exhausted — the broker stops TERMINALLY** | `HARNESS-REOPEN-CAP-EXCEEDED attempts=4` |
| 21:17:21 → 21:21:44 | **the fleet is dead and nothing says so** | see "Why it looked healthy" |
| 21:21:29 | the keepalive's supervisory leg notices | `broker STRANDED (no pass 305s, 1 intent(s) waiting) -> re-arming` |
| 21:21:44.987 | old broker exits | `EXIT pid=2523876 reason=deadline passes=-` |
| 21:21:46.784 | new broker starts, first pass 0.6 s later | `START pid=2808072`, `PASS 1 ms=824 woke=impl,qa,lead,…` |

## Why it looked healthy (the trap)

`src/broker.mjs` sets `stoppedBy = "session-failed"` and `break`s out of its loop, but the `serve` process stays up
serving `READ-DRAIN`. So ALL of these read healthy during the outage:

- `ps -o pid,etime` — the process had been up 42 minutes;
- the keepalive heartbeat — `hb=8s`, printed every minute;
- the log's last `START pid=2523876` line — present and plausible;
- `status --json` — answered, `ok: true`, because the read-drain server was still there.

**The only symptom was `lastPass` climbing** (185 s → 245 s → 305 s). Judge fleet liveness by `PASS n` advancing,
never by the process, the heartbeat or a `START` line (SELFDEV pitfall 304).

The measurement that made it unambiguous: two `status --json` snapshots 90 s apart were **identical** — queue
`done 4,845 / queued 793 / deferred 431 / claimed 16` and **1,175** queued submissions, unchanged. The rig was
frozen, not slow (pitfall 309).

## Root cause

pi-durable's default SQLite busy timeout is **5 s** (`DEFAULT_BUSY_TIMEOUT_MS` in
`@earendil-works/chord/dist/sqlite/node.js`), and this store is **750 MB**; a contended write can exceed 5 s.
ONE `database is locked` is enough to close the Session, and the reopen cap then makes that terminal. Contributing:
`src/readclient.mjs`'s `readLocal` can fall back to a **write-mode open while a broker is resident** (it only
refuses when a generation lease is live), so an ordinary CLI read can take the write lock against the broker — the
second-writer collision ROADMAP 69 exists to prevent.

## Fix (D274, `575a67e8`)

- `STORE_BUSY_TIMEOUT_MS = 30_000` in `src/readclient.mjs`, next to the other store-timeout policy.
- `cli.mjs openStore()` passes it — that call is the harness's ONE connection *and* the probe's.
- `src/readonlystore.mjs` passes `timeout` to `DatabaseSync`, so a checkpoint-contended read cannot bounce onto the
  write-mode fallback.
- `demo/store-busy-timeout.test.mjs` is the check rule (static over every open site), mapped in
  `demo/test-areas.json` under `broker`.

Evidence: `node scripts/test.mjs --area broker` → 81/81 in 27.2 s; `node demo/test-areas.test.mjs` → 326 tests / 9
areas.

**Still unverified:** that 30 s is enough under the heaviest checkpoint (no lock longer than 5 s has been observed
since), and the live broker was NOT restarted, so pid 2808072 still holds the old 5 s connection until it re-arms.

## The unresolved fact: a push this session did not make

`git reflog show origin/main` records `update by push` to `7e215e4b` at `1794518222 -0600` (= **21:17:02Z**), and
`git ls-remote origin refs/heads/main` returns **`7e215e4b`**, so the remote really holds it: the 43 landings plus
the delegate's prior work are **public — 150 commits**.

The delegate did not run `git push` in this session. Ruled out, each by a check: `src/confine.mjs:297` blocks
`git push` for a seat; `scripts/land.mjs` and `tools/broker-keepalive.mjs` contain no push; there are **no git
hooks** (`ls .git/hooks` shows only `*.sample`) and no push config (`git config core.hooksPath` empty). The actor is
therefore outside this session. **The operator must confirm whether that push was theirs**; the four commits after
it (`575a67e8`, `6a0da485`, `6f47898a`, `618560d5`) remain local.

## Leak reaped in the same window

`node demo/broker.test.mjs` (pid 1451343) had been hung **20,136 s (5.6 h)** under a reparented
`bash -c for f in demo/*.test.mjs …` loop (pid 1451342, itself under pid 1445534 reparented to systemd).
`tools/process-leak-scan.mjs` answered `clean` because that bash IS a live ancestor. Fixed by bounding supervision
(`DEFAULT_MAX_SUPERVISED_AGE_S = 3600`, `--max-supervised-age`): a supervised runner past an hour is a HUNG CHAIN,
since the full suite is ~140 s and the slowest demo 40 s (`6f47898a`, `demo/process-leak-guard.test.mjs` pins the
boundary). The chain was then reaped top-down so the loop could not respawn, plus a 2-day-old detached
`node -e setInterval` pair the default pattern does not match. Re-scan: 0 orphans.
