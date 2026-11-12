# Incident 2026-11-11 — a parked broker answers reads for 13 hours and strands a mutating intent

**Measured on:** Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
git 2.56.0 — host probe run in the same session as the numbers below:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## What happened

A delegate spooled an operator intent to `pm` (`node intent.mjs pm --body-file …`, requestId
`0a956629-78f6-4b3b-8438-d3642995f211`). It sat in `<db>.broker.inbox` for 15 minutes while
`cli.mjs status`, `cli.mjs log <seat>` and `cli.mjs watch --once` all returned
`read health: timed out awaiting the broker's result (broker pid 2876055 is resident and 4 seat(s)
hold live generation leases, so a direct read is not safe)`.

The broker was **alive and beating**, and **reads were being served** — the log shows
`READ-DRAIN served=1 …` lines at 22:11, 22:20, 22:26, 22:33, 22:36, 22:39, 23:09, 23:21. But it had
not run a **PASS** since 10:12:53Z.

| Read | Value | Command |
|---|---|---|
| broker pid | 2876055, `since 2026-11-11T08:13:03.831Z`, started with `--max-duration 7200` | `cat selfdev.sqlite.broker.json` |
| heartbeat age | 9 s | `node tools/stranded-inbox.mjs selfdev.sqlite` |
| last-pass age | **48,370 s (13 h 26 m)** | same |
| spool | `inbox=1 drainStranded=1 resultFiles=1` — the one pending intent is `op=message`, classified **DRAIN-STRANDED** | same |
| genlock | 4 slot files, `seat: architect`, `since 2026-11-11T23:41:12Z` | `for f in selfdev.sqlite.genlock*; do cat $f; done` |
| last commit on any ref | 23:19Z local — 30 min before the probe | `git for-each-ref --sort=-committerdate … | head` |

## Why the read path answered and the intent did not move

The out-of-band read drain (`docs/runbooks/broker-down-or-stalled.md`, the #5807 ruling) is
deliberately scoped to **reads only**: `src/broker.mjs:1809` —
`if (!onlyReadIntents(dbPath)) return;`. A mutating op (`message`, `send`, `hold`, `reset`) still
needs a real pass, because delivering it inside the pump would bypass wake scheduling
(`src/broker.mjs:1894-1909`).

The wake loop had already left its loop: it breaks on `maxDurationMs` (`src/broker.mjs:1855-1857`)
setting `stoppedBy = "max-duration"`, then takes the drain. The bounded drain leg is
`src/broker.mjs:2216` (`settleWithin(h.waitForIdle(context), remaining)`) and it is chosen only
when `stoppedBy === "deadline"` **or** `graceExpired()`. A `max-duration` break with no stop request
satisfies neither, so the broker takes the **unbounded** leg at `src/broker.mjs:2218` and waits on
runs that never settle. `serve --stop` writes a `.stop` file the wake loop checks — but the loop has
already left the loop, so it is invisible: it returned
`serve --stop: broker pid 2876055 did not exit within the grace; pass may still be in-flight`.

`kill -TERM` reached the signal handler, `graceExpired()` was true (the stop request had been written
earlier), so the bounded leg ran with `remaining = 0` and the process exited **10 s** later:
`2026-11-11T23:53:32.924Z EXIT pid=2876055 reason=deadline passes=-`. Per ROADMAP 328 the
`passes=-` in that line is a CLI-side literal, not the loop's counter.

## What was done, in order (the runbook's `Do`, run end-to-end on Linux)

```bash
node cli.mjs serve --stop            # refused: "did not exit within the grace" — the loop is not in the loop
kill -TERM 2876055                   # EXIT logged 10 s later
node cli.mjs resume                  # found=1602; run-cancelled / abortSubmission:settled on the stranded runs
set -a; . "$HOME/.config/durig/env"; set +a
DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --no-probe --yes-pm-wakes --max-duration 3600
# START pid=1948745 23:53:47Z → PASS 1..6 within 60 s, INTENT delivered=1 dead=0 dup=0 at 23:53:54Z
```

`pm` received the intent and decomposed it within two minutes (rows #6924–#6927). The fleet was
working again within 90 s of the restart.

## The rule this establishes

1. **`READ-DRAIN` lines in the log are not progress.** They prove the event loop is turning; they say
   nothing about the wake loop. The progress read is `lastPassAt` in `<db>.broker.json`, and the
   instrument that says it in one line is `node tools/stranded-inbox.mjs <db>` (`hbAgeS` / `progressAgeS`).
2. **A mutating intent in the spool is the discriminator.** Reads served + a pending
   `op=message` classified `DRAIN-STRANDED` + `progressAgeS` in the thousands ⇒ the wake loop is parked.
   Do not conclude the store is broken.
3. **`genlock` files held by a parked broker are not evidence of a live generation worth protecting.**
   Four slots were held here while no pass had run for 13 hours. Read `lastPassAt` before deciding
   whether a genlock is a reason to leave a broker alone.
4. **`--max-duration` is not a hard bound in this shape.** A run that breaks out at the bound with no
   stop request drains without a bound. If you need a broker to stop, send it a signal.

## Would have been faster

`tools/stranded-inbox.mjs` already prints everything needed; the diagnostic cost was 1 s. The
six-command manual sequence in the runbook is not needed when that tool exists. What is missing is a
**check rule** so the population is visible without remembering to run a command (#5630 §3.4 records the
same blind spot). Register: a `check` rule that reports `broker-parked` when
`progressAgeS > pass bound` and the inbox holds a non-read intent.
