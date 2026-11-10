---
runbook: broker-down-or-stalled
symptom: "seats idle with queued work; no `serve` process, or a fresh heartbeat with a stale PASS (dormant); log stops after a storage error or `database is locked`; `cli.mjs status` exits 1 with `read health: timed out awaiting the broker's result`, or hangs to exit 124 with no output at all, while the store itself answers fine"
writes: true
precondition: "broker-stopped"   # diagnosis half is read-only; the Do half writes
last_verified: unverified
verified_by: delegate
evidence: "2026-10-16 (items 54/66/68) + the 2026-10-18 recurrence (docs/incidents/2026-10-18-broker-dormant-stalled.md)"
evidence_addendum: "2026-11-06 (Linux Fedora 45, node v24.22.1): the post-`--max-duration` linger signature below was run end-to-end — pid 483056 alive 1 h 39 m, fresh heartbeatAt, lastPassAt frozen 75 min, no genlock, CLI reads timing out at 120 s while a direct read-only store open answered in 111 ms. The `taskkill` half of Do stays Windows-only and unverified here; on Linux the sequence was `serve --stop` (refused) then `kill <pid>` (logged `EXIT reason=deadline passes=-`). Registered as ROADMAP 303. Addendum 2026-11-08T07:4xZ (impl, #5663): the three read shapes in the section below were reproduced deterministically in an item worktree of main `7ccb2163` on a 139,264 B store made by `node cli.mjs up rig.starter.json` — no live store, no broker process, so the shape is NOT size- or load-dependent. No state file: `node cli.mjs status --json` exit 0. Forged state naming a live pid (a `sleep 400`) with a fresh heartbeat and nothing draining the spool: exit 1 after 120 s, and exit 124 with ZERO bytes when an external `timeout 60` killed the wait. The `Do` half (kill, `resume`, restart) was NOT run in that repro and stays unverified. 2026-11-08 (Linux Fedora 45, node v24.22.1): the **silent** variant measured — reads exit 124 with 0 bytes and no error line at all (two reads at an 8 s cap, eight concurrent at 25 s) while a direct read-only store open answered the same minute; pass loop dead since 21:26:06Z after `PASS-FAILED … database is locked errcode=5` — 11 dated 2026-11-08 out of 23 in the cumulative log (the log is cumulative; time-box any count). Diagnose half verified read-only via `docs/evidence/2026-11-08-context-window/read-path-probe.mjs`; the `Do` half still unverified here. Addendum 2026-11-07 (same host, the 05:18Z diagnostic pass, pid 1673276, `--max-duration 120`, 14 passes): the signature recurred, and three instrument facts were measured — `pgrep -a node | grep \"cli.mjs serve\"` returned NOTHING while the broker was ALIVE (do not call a run uncleanly exited off it); the reads that work are `cat <db>.broker.json` then `ps -o pid,etime,args -p <pid>`; and that broker's `EXIT … reason=deadline passes=-` is a hard-coded CLI-side line (`cli.mjs:2105`, on the stop-grace force timer) whose reason and pass count are both untrustworthy — see ROADMAP 328. 2026-11-08 (Linux Fedora 45, node v24.22.1): the **silent** variant measured — reads exit 124 with 0 bytes and no error line at all (two reads at an 8 s cap, eight concurrent at 25 s) while a direct read-only store open answered the same minute; pass loop dead since 21:26:06Z after `PASS-FAILED … database is locked errcode=5` — 11 dated 2026-11-08 out of 23 in the cumulative log (the log is cumulative; time-box any count). Diagnose half verified read-only via `docs/evidence/2026-11-08-context-window/read-path-probe.mjs`; the `Do` half still unverified here. #5829 re-ran that recipe and found the exit-1 step does NOT reproduce when the forged heartbeat is written once and reused: by the second read it is older than the 60 s liveness gate, the routing falls back to `readLocal`, and the verb exits 0. The recipe below now refreshes the heartbeat before each read; both shapes re-measured green. Addendum 2026-11-10 (architect, #5630, read-only): the CLASSIFYING probe in the Diagnose block was run on this rig — `node tools/stranded-inbox.mjs selfdev.sqlite` exit 0 printing `inbox=9 drainStranded=9 resultFiles=0 hbAgeS=5 progressAgeS=22731`; nine undrained reads, zero result rows. That command has no `check` rule behind it, so the population is invisible until someone thinks to run it."
check_rule: null
---
# Broker down or stalled

## When to use
Seats sit idle with queued/claimed work, `status` shows `idle_with_queued_work` or `admitted_not_started`,
and the broker log stops advancing. Two shapes: **(a)** no `serve` process is running, or one is present
but parked mid-pass; or **(b)** the broker is ALIVE but **dormant** — a fresh heartbeat, no `PASS` for
minutes, no genlock held — while a seat holds queued work. (b) is the general revisity gap: a pass runs
only on a store-commit signal, so after a seat's normal settle the per-seat cooldown suppresses its
re-wake and nothing marks the scheduler dirty again, leaving the seat unwoken until an unrelated commit
or a restart.

## Impact
If you do nothing, queued/claimed work sits idle: seats stay unwoken (`idle_with_queued_work` /
`admitted_not_started`) while the broker log stops advancing, so the queue looks healthy and is dead.
A dormant broker (shape b) is worse because nothing is obviously wrong — a fresh heartbeat and no
genlock hide that no pass will ever fire until an unrelated commit or restart. Blast radius is the
whole queue, but recovery is cheap (resume/restart) once the shape is diagnosed.
## Preconditions
None for diagnosis. The fix writes, so it needs no other writer.

## Diagnose (read-only)
```bash
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId,CreationDate"
tail -12 selfdev.sqlite.broker.log        # last START? any EXIT? a long ms=? 
cat selfdev.sqlite.broker.json 2>/dev/null  # a live pid, or gone?
cat selfdev.sqlite.genlock.* 2>/dev/null    # a live generation means do NOT kill
tail -8 .spike/serve.err 2>/dev/null
```

**Native Linux (measured present 2026-10-28, procedure NOT yet run end-to-end here — see Evidence).** Name the OS in
every measurement: the Windows half above cannot run on this box, and the process probe below answers a
different question (`pgrep -af` matches a command line, where `broker.json`'s heartbeat is the identity proxy).
```bash
node tools/broker-serve.mjs --status      # one read: state + genlock + spool depth AND intent AGE + provider reachability
DURIG_DB=./selfdev.sqlite node cli.mjs status   # DURIG_*, not DURIAN_PI_* — the CLI ignores the latter (D103)
pgrep -af 'cli.mjs serve'                 # a serve process? (empty is a real answer, not an error)
tail -12 selfdev.sqlite.broker.log
cat selfdev.sqlite.broker.json 2>/dev/null   # THE identity read: it names the pid
ps -o pid,etime,args -p <pid from broker.json>   # the liveness read: alive, and for how long
ls -1 selfdev.sqlite.genlock* 2>/dev/null  # a live generation means do NOT kill
tail -8 .spike/serve.err 2>/dev/null
```
**Order matters on Linux (measured 2026-11-07):** read `broker.json` for the pid, then `ps -o pid,etime,args -p <pid>`.
The `pgrep` probe is NOT a substitute — it returned **nothing** while a broker with a fresh heartbeat was alive, and a
session reported a false "exited uncleanly" from that empty result. It answers "did my pattern match a command line",
not "is the broker alive"; `broker.json` + `ps` answer liveness and are the two to quote in a report.
The instrument is delegate-side (`tools/`, ROADMAP 209 asks for the productized `scripts/serve.mjs`). Without it, the
same read is the six commands above — what the instrument adds is the two facts a human forgets to ask for: **how long
each spooled intent has been waiting**, and **whether the provider each seat names actually advertises that model**.
- `START` with **no** `EXIT` = the broker died abnormally.
- The preflight's `env:` line reports a credential as `set (N chars, from env)` or `unset`, **never the value**
  (#5700 / ROADMAP 295, operator ruling: fix the print, do not rotate). Before that fix it spread every
  `DURIG_LOCAL_*` / `DURIG_VERIFIER_*` variable verbatim into JSON — and a pasted preflight is a credential leak
  channel. Non-credential config (`*_BASE_URL`, `*_MODEL`, `*_CONTEXT`) still prints its value, because a preflight
  that reports nothing is not a preflight. Pinned by `demo/broker-serve-env-presence.test.mjs`.
- A live `genlock` slot means a generation is in flight — do not kill the broker.
- `serve.err` ending in `Session failed after a storage error` → go to `store-corruption-recovery.md`.
- `serve.err` with **`Error: database is locked`** (SQLite busy/lock contention) is a SECOND dormant
  signature (2026-10-18T02:37Z recurrence): the broker stays up, fresh heartbeat, but stops passing.
  Concurrent store openers are the suspect class — a test/`serve --max-duration` broker from an item
  worktree must not open the shared selfdev store. Same recovery as case (b): terminate (no genlock),
  `resume`, restart.
- **Third signature — the deadline linger: the read path is dark while the store is healthy** (2026-11-06, ROADMAP 303).
  A broker started with `--max-duration` reaches its deadline, stops logging `PASS`, and **stays alive** — here for 75
  minutes with a **fresh** `heartbeatAt` (03:35:55, 03:42:35) and a **frozen** `lastPassAt` (02:28:23), no `genlock.*`, and
  no run block in `serve.out` for that run. Everything that routes **through** the broker then fails: `cli.mjs status` and
  `cli.mjs queue` return nothing and time out, and only the bounded run shows the body —
  `{"ok":false,"error":"read health: timed out awaiting the broker's result"}`. **Do not conclude the store is broken.**
  The discriminator is a read that bypasses the broker: a direct read-only open answered `select count(*) from entries` →
  150,347 in **111 ms**, and `tools/latency-budget.mjs` (which opens the store itself) returned full numbers throughout.
  `serve --stop` does **not** fix it: `"stopped": false … "did not exit within the stop grace; no forced kill"`. With no
  `genlock` held, `kill <pid>` is the remedy (Linux; the runbook's `taskkill /F` is the Windows half) and the broker then
  logs `EXIT reason=deadline passes=-` — **do not read that line as the record of how the run ended**: on the forced path
  it is a hard-coded CLI-side literal (`cli.mjs:2105`, fired by the stop-grace force timer), so `deadline` means *the stop
  grace expired* (not the run's `--max-duration` bound) and `passes=-` is a dash because the CLI cannot see the loop's
  counter, even when the same log holds `PASS 1`…`PASS 14` (measured twice; ROADMAP 328). The suspect class named here in
  2026-11-06 — `SKIP <seat> reason=pending conv=…` lines just before it goes quiet — is **not** a discriminator and must
  not be used as one: `reason=pending` is back-pressure from the wake the previous pass issued (76,337 such lines in one
  day, and a working rig prints them), while the wedge signature is the `admitted_not_started` **notice** being raised and
  never cleared (measured: 0 notices at 05:18Z with the SKIP lines still streaming, i.e. NOT wedged — ROADMAP 314).
  A run with in-flight seat conversations drains instead of exiting, while the prior run with none exited cleanly
  (`reason=max-duration passes=1245`). **Never write to the store to fix this signature.**
- **Alive but dormant** (case b): `START` present, `broker.json` heartbeat fresh, last `PASS` minutes
  old, no `genlock.*`. The broker rests in `signal.wait` with `scheduler.shouldRun()` false.
  **THE DISCRIMINATOR — idle, not wedged:** a FRESH `heartbeatAt` with a FROZEN `lastPassAt` means the
  loop is IDLE, not stuck — and that is why a restart alone cannot help a suppressed seat: the startup
  pass runs the same `placed`-only filter (`src/broker.mjs:829`) and the pending set still suppresses
  it. Restart is NECESSARY-but-INSUFFICIENT for a suppressed seat (it is right for a wedged loop).
  **The one-seat variant:** a SINGLE seat silent while others work is NOT "broker down" — it is a
  per-seat suppression, and no broker-level remedy fixes it. **The remedy TODAY:** stop the broker,
  `resume` (which WITHDRAWS the stranded submission — `resume` must run with the broker STOPPED), then
  restart. **HOW AN OPERATOR NOTICES — an existing surface that works:** `cli.mjs status` already emits
  `admitted_not_started` WITH the submission id and its age (`admittedAt` is read at src/attention.mjs;
  e.g. "submission #N admitted 55s ago, no run started and no slot held"). Do not wait for a new alarm
  — this is the alarm. **Automatic recovery IS coming, and is not here yet:** an admission deadline
  exists (`admissionVerdict` / `ADMISSION_DEADLINE_MS`); once the reconciler consults it, a
  never-started submission is withdrawn without an operator. Until that lands, `resume` is the remedy.
- **A brand-new broker can read `up` before it has done any work (#5698, re-issue of #4819).** `lastPassAt`
  is the stamp of a COMPLETED pass. When the loop takes over a state file with no numeric `lastPassAt` it
  used to seed it with `now()` — the ATTEMPT to start counted as progress — so a broker that throws on
  every pass read `up` for one whole progress bound (default 300 s + 60 s margin) while doing nothing, and
  `queue`/`watch`/`status` routed to it and hung for the full 120 s inside that window. It now stays `null`
  until a pass completes, and `brokerHealth` says `degraded` with the reason `no pass has completed yet`.
  **How to tell them apart:** `PASS-FAILED` lines in `<db>.broker.log` plus `"lastPassAt": null` in
  `<db>.broker.json` = the broker never progressed, no matter how fresh the heartbeat is. Prove it:
  `node demo/broker-progress-is-a-completed-pass.test.mjs` (exit 0).
  **Separate clause — the suppression-semantics fix:** a suppression-semantics fix is on a branch with
  its own landing entry and is not on main yet. When it lands it changes how a suppression is READ, not
  the recovery path — `resume` remains the remedy for a never-started submission.
- **A seat reading its own queue mid-turn (the in-turn read deadlock, #5640 / #5699 interim discipline).**
  A read spooled by a verb while THAT seat's turn is in flight cannot be answered: the broker answers read
  intents inside a pass, and `drainIntentInbox` begins with `harness.documentState(...)` — the same session
  the seat's turn is holding. The read waits on the work it is part of. Measured cost: **155.3 min of broker
  time against a 75 min per-turn bound (2.07x)** (#5640), and the clock-in digest's own `cli.mjs status` read
  **timed out twice at the 120 s bound** with `read health: timed out awaiting the broker's result` (#5644),
  which is why the digest's acceptance command is unrunnable while the fleet is busy.
  **What a seat does instead, TODAY (this is the discipline, not a workaround to be skipped):**
  1. do NOT run `cli.mjs queue` / `cli.mjs status` / `scripts/clockin.mjs --db` inside your own turn when a
     broker is resident; the numbers are handed to you in the item body, or
  2. use ONE multi-id read (`node cli.mjs queue --id <a> --id <b> --json --no-body`) at a clock-in boundary,
     when the broker is between passes, or
  3. read a **snapshot copy** of the store (`cp selfdev.sqlite .snapshot/selfdev.sqlite`) for anything that
     needs volume, and say which tree/copy the number came from.
  **Verify (ran on 2026-11-08, read-only, no model spend):** `node demo/broker-read.test.mjs` and
  `node demo/broker-read-nopass.test.mjs` both exit 0 — they are the demos that pin what a spooled read does
  when no pass runs. The BUILD half of #5699 (a seam that resolves the read in-turn) is NOT shipped: the
  bound and the semantics need a ruling, see below.
- **`WAKE-RETRY` logged but no `PASS` follows** (2026-10-18 recurrence 8): the dormant-revisit fix
  (`991567d`) re-arms the loop after a `wake-failed` and logs `WAKE-RETRY in=<ms>ms seats=<names>`. If
  that line appears and then **no `PASS`** for minutes (fresh heartbeat, no genlock, idle CPU), the retry
  pass either did not run or hung before its `PASS` line — a hung pass is invisible because `cmdServe`
  does not log `pass-failed` (ROADMAP 78). Same recovery as case (b).
- **`WAKE-RETRY` logged repeatedly at ~0.5 s apart — a HOT LOOP** (2026-10-18): the opposite of case (b);
  the broker SPINS. `WAKE-RETRY in=<ms>ms … pass-threw` lines whose timestamps are far closer together
  than the logged `in=` mean the scheduled backoff is not gating the next pass, and `serve --stop` may not
  be honoured (it was not). Recovery: `taskkill /F /PID <pid>` (only when no `genlock.*` is held), then
  restart — a fresh broker's first pass drains any stranded intents (`INTENT delivered=<n>`). If the
  `pass-threw` RETURNS after that restart (a PERSISTENT cause — the log shows clean passes then freezes),
  the restart is insufficient: read `.spike/serve.err` for the named `wake-failed … <seat> conv <N> …
  Session failed after a storage error`, and repair that conversation with
  `scripts/repair-pi-live.mjs <db> <N>` (`store-corruption-recovery.md`) BEFORE restarting. See
  `docs/incidents/2026-10-18-broker-retry-hotloop.md`.
- **Stopping an unresponsive broker (foreground or detached).** `serve` traps `SIGINT`/`SIGTERM` into a
  graceful stop: it only sets a stop flag, and the loop honours it at a **pass boundary**
  (`src/broker.mjs:1085` and `:1281`), after which it still runs `await harness.waitForIdle()`
  (`:1293`). A pass wedged on a hung wake/generation therefore defeats **Ctrl+C, `SIGTERM`, and
  `serve --stop` alike**, and `serve --stop` can return `stopped:true` while the process lives. Escalate
  to a hard stop (Windows) and clear the stranded run:
  ```bash
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'cli.mjs serve' } | Select-Object ProcessId"
  taskkill /F /PID <pid>          # or: Stop-Process -Id <pid> -Force
  DURIAN_PI_DB=./selfdev.sqlite node cli.mjs resume
  ```
  A foreground `serve` in the operator's shell is expected to receive Ctrl+C; if it does not, it is
  wedged, not detached. The bounded graceful stop is owed as `#2237`.

## Reads when the broker is gone or dark — the three exit shapes (#5663)

"There is no broker-less reader for the store" is the wrong lesson, and it has been repeated three times
(#5574, #5636, #5637/#5640). Every CLI read verb (`status`, `queue`, `show`, `log`, `watch`, `metrics`, and
`scripts/clockin.mjs` through `cli.mjs status`) goes through `src/readclient.mjs`'s `readData`, which
branches on `brokerAliveFor(dbPath)`:

| state of `<db>.broker.json` | what the verb actually does | exit |
|---|---|---|
| **no state file** | `readLocal` opens the store in this process — it is then the sole owner, exactly the condition the fallback is built for | **0**, normal payload |
| **state file naming a pid that is alive with a heartbeat inside 60 s** (`BROKER_HEARTBEAT_TIMEOUT_MS`) | the read is spooled to the broker and this process waits up to **120 s** (`readclient.mjs`, `timeoutMs = 120_000`) for the broker's answer | **1** with `{"ok":false,"error":"read health: timed out awaiting the broker's result"}` if the broker never drains the spool |
| **the same, and an external timeout shorter than that 120 s bound** | the process is killed mid-wait | **124**, **zero bytes of output** |

`1` and `124` are different failures and must be recorded differently: `1` is the CLI reporting that the
spool wait expired; `124` is the harness killing the wait before the CLI could say anything. Neither is a
store fault, and neither means "the measurement is unmet".

**Why the fallback does not fire when you need it.** `brokerAliveFor` is a **liveness** test — signal 0 on
the pid plus a heartbeat within 60 s. It never asks whether the broker is draining its inbox. A broker that
has hit its deadline, or one sitting inside a seat's own turn, keeps a fresh heartbeat and never drains, so
the read is routed to a broker that cannot answer and the direct path is never tried. `brokerHealth` already
computes the **progress** leg (`lastPassAt` past the pass bound ⇒ `degraded`) and `status` prints it — the
read routing simply does not consult it. Making the routing use progress, or refuse fast instead of hanging
120 s, is #5657 / #5699 / #5647; it is not this row.

**The probe that costs nothing and opens nothing** — run it before touching the store:
```bash
pgrep -af 'cli.mjs serve'                      # is there a serve process at all? empty is a real answer
cat selfdev.sqlite.broker.json                 # pid, heartbeatAt, lastPassAt — a file beside the db, no store open
ls -1 selfdev.sqlite.broker.inbox | wc -l      # undrained intents = every routed read will time out
node tools/stranded-inbox.mjs selfdev.sqlite    # the same population CLASSIFIED: drain-stranded vs
                                              # shutdown-stranded, each age, plus hbAgeS/progressAgeS
```
Fresh `heartbeatAt` + frozen `lastPassAt` + a non-empty inbox ⇒ the reads are dark: the store is readable,
the route is not. Measured 2026-11-10 with that command on this rig: `inbox=9 drainStranded=9
resultFiles=0 hbAgeS=5 progressAgeS=22731` — nine spooled reads, ages 3,437–22,078 s, and **no** result
row for any of them. Note the blind spot: `tools/stranded-inbox.mjs` is a command, not a check rule —
`grep -n inbox src/checkup.mjs` finds no rule, so the population is only visible to whoever remembers to
run it (#5630 §3.4).

**Do not** fix a dark read by opening the store from a second process while a wedged broker is still
running. `readLocal` is safe only because it is the *sole* owner: pi-durable cannot open a store read-only
and `SqliteStorage.document()` takes `BEGIN IMMEDIATE` even for a read — that contention is what this module
exists to avoid (ROADMAP 69/item 83, `docs/incidents/2026-10-19-read-storage-handle.md`). A direct open that
answers (the ROADMAP 303 discriminator, `select count(*) from entries` → 150,347 in 111 ms) proves the
store is healthy; it does not license writing to it.

**What to write down when an acceptance bar is a measurement on the live store.** If the broker is not
progressing, the bar is **BLOCKED — state the exit code you got** — not unmet and not met. Verbatim sentence:
*"not measurable with the broker down: `node cli.mjs status --json` exit 1 (`read health: timed out awaiting
the broker's result`) or exit 124 (killed before the 120 s spool bound) — BLOCKED, not unmet."* Otherwise a
down broker turns a missing measurement into a silent green.

### Verify this section (ran 2026-11-08, Linux, node v24.22.1, item worktree of main `7ccb2163`; re-run and corrected 2026-11-09 by #5829)

```bash
node cli.mjs up rig.starter.json                       # makes ./rig.sqlite here; broker: started=false
node cli.mjs status --json > status-probe.txt; echo $? # 0 — broker-less read works; broker block {"state":"down","reason":"no broker state"}
nohup sleep 400 > probe.out 2>&1 & BPID=$!            # a live pid that is NOT a broker
forge() { BPID=$BPID node -e "const fs=require('node:fs');fs.writeFileSync('rig.sqlite.broker.json',JSON.stringify({pid:Number(process.env.BPID),since:Date.now(),runToken:'repro',heartbeatAt:Date.now(),lastPassAt:Date.now()}))" }
forge; timeout 60  node cli.mjs status --json > hang-probe.txt; echo $?   # 124; wc -c hang-probe.txt = 0
forge; timeout 150 node cli.mjs status --json > dark-probe.txt; echo $?   # 1; read health: timed out awaiting the broker's result
kill $BPID
rm rig.sqlite rig.sqlite.broker.json status-probe.txt hang-probe.txt dark-probe.txt probe.out
rm -r rig.sqlite.broker.inbox rig.sqlite.broker.inbox.out rig.sqlite.broker.inbox.error   # the timed reads spooled intents here
```
All three exit codes were measured this way. The state file's pid only has to be *alive* — signal 0 plus a
heartbeat under 60 s is the whole predicate, and that is the finding.

**`forge` before EVERY read, not once.** `brokerAliveFor` decides routing the instant the verb starts, and its
window is `BROKER_HEARTBEAT_TIMEOUT_MS = 60_000` (`src/broker.mjs`, `src/storeownership.mjs`). A heartbeat forged
once and left in place is older than 60 s by the time the next read starts — the liveness gate fails, `readData`
takes `readLocal`, and the verb answers normally with **exit 0**. That is not a different shape; it is the
broker-less shape (row 1) arriving by accident, and it is what the recipe printed here used to produce when the
heartbeat was written once and reused for both timed reads. If you are driving the probe by hand, re-run `forge`
immediately before each read; if you are watching a real broker, refresh the probe read itself inside 60 s.

## The read bound: the ruling (#5807)

**Measured live, 2026-11-10 00:2x–00:3xZ, on the selfdev rig (this is the shape, not a hypothesis):**
`kill -0 1581519` exit **0** and `<db>.broker.json` `heartbeatAt` 1794271626336 (fresh) while `lastPassAt`
1794269654105 sat **1,972 s** stale; the last `<db>.broker.log` line was `PASS 53 ms=11 woke=-` at
00:14:14Z; **9** `read` intents were still sitting in `<db>.broker.inbox`; and
`node cli.mjs status --db selfdev.sqlite --json` → **exit 1** after 2 m 0.5 s with
`{"ok":false,"error":"read health: timed out awaiting the broker's result"}`. The broker had also run past
its `--max-duration 1800` bound (started 23:47:41Z) without exiting — the deadline-linger signature above.

**Why the wait is the wrong knob.** Reads are drained in exactly TWO places, both inside the driver loop:
at the START of a pass (`drivePass`, `src/broker.mjs:1322`) and in the idle branch (`src/broker.mjs:1801-1815`).
The heartbeat is a separate `setInterval` (`src/broker.mjs:1736`). So the process can keep beating while the
loop is parked in a long `await` — parked inside a pass, or parked on the retry backoff at
`src/broker.mjs:1827` (`await signal.wait(cooldownRevisitAt - now())`), which does **not** drain the inbox.
The routing gate (`brokerAliveFor`) only asks *is the pid alive and the heartbeat under 60 s*; it never asks
*is this broker draining*. That gap is the whole defect: the read is routed to a broker that cannot answer,
and the sole-owner fallback is (correctly) refused.

**RULING — three decisions, in this order:**
1. **Do NOT lengthen the 120 s grace.** A longer wait makes the clock-in digest slower and changes nothing
   about when the answer arrives.
2. **Do NOT route reads on `lastPassAt` (the progress leg).** `lastPassAt` moves only on a COMPLETED pass
   (`src/broker.mjs:1911`), and reads are legitimately served with **zero** passes —
   `demo/broker-read-nopass.test.mjs`, exit 0. A progress-gated reader refuses a healthy idle rig: a false
   positive on the instrument. `brokerHealth`'s progress leg stays a *report*, not a routing predicate.
3. **Serve reads off the heartbeat, not off the pass loop.** In `runBroker`, alongside the heartbeat
   interval, add a pump with the same cadence: if `readIntentFiles(dbPath).length > 0 && onlyReadIntents(dbPath)`,
   call the SAME `drainIntentInbox(h, p, {dbPath, context, onDiagnostic, readStorage: r})` the idle branch uses,
   guarded by a `pumpInFlight` flag. It must **not** `markDirty` (a read changes nothing, so there is no wake
   to evaluate — the #2321 property that stopped reads hammering the broker), and it must **not** drain a
   non-read intent (a mutating intent still waits for a pass, per #2237). Duplicate draining is already safe:
   `drainIntentInbox` skips a `requestId` whose result is recorded in the idempotency ledger
   (`src/broker.mjs:782`), and Node's single thread means the pump and a pass drain interleave, not race.
4. **Make the client bound self-diagnosing.** Keep 120 s as the ceiling, but when no answer arrives after
   ~3 heartbeat cadences, re-read `<db>.broker.json` and the spool depth and throw a structured cause
   (add `BROKER_WEDGE_CAUSE = "broker_wedged"` to `src/causes.mjs`, alongside `NO_STORE_CAUSE`) carrying
   `pid`, `heartbeatAgeMs`, `lastPassAtAgeMs`, `pendingReadIntents`. `1` with that payload is a diagnosis;
   `124` with zero bytes is not. A gate built on the digest then says **BLOCKED — broker wedged (evidence)**,
   never "unmet".

**The answer to "what is the bound for a read issued during a legitimate long pass (300 s + 60 s)?"** There
is none: a read must never queue behind a pass. The pass bound is not a read bound.

### Verify the ruling's premise (ran 2026-11-10, Linux, node v24.22.1, live selfdev rig — read-only)

```bash
kill -0 $(node -e 'console.log(JSON.parse(require("node:fs").readFileSync("selfdev.sqlite.broker.json","utf8")).pid)'); echo $?   # 0 = alive
node -e 'const s=JSON.parse(require("node:fs").readFileSync("selfdev.sqlite.broker.json","utf8"));console.log("heartbeatAgeMs",Date.now()-s.heartbeatAt,"lastPassAtAgeMs",Date.now()-s.lastPassAt)'   # fresh vs stale
ls -1 selfdev.sqlite.broker.inbox | wc -l            # undrained reads: 9 measured
node cli.mjs status --db selfdev.sqlite --json; echo $?   # 1, "read health: timed out awaiting the broker's result"
```
That sequence reproduced the wedge on the live rig while the store itself was healthy; the pump fix and its
demo are the work item (impl, #5807 ruling handed to them).

## Do
1. If a **wedged** `serve` process exists and **no** genlock slot is held, terminate it:
   ```bash
   taskkill /F /PID <pid>
   ```
2. With the broker down, clear anything stranded while it was gone:
   ```bash
   DURIAN_PI_DB=./selfdev.sqlite node cli.mjs resume
   ```
3. Restart the broker **without `DURIAN_PI_SEAT_ROOT`** (a seat's own prepared cwd wins; a global root trips
   the F12 guard):
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
   ```
   **Native Linux: there is no `*.sh` launcher in `scripts/`** (measured 2026-10-28 — `scripts/` holds
   `serve-noroot.ps1` and nothing POSIX, which is why this store has never been served on this box and two operator
   intents have sat in the spool since `2026-10-27T05:04:46Z`). The equivalent is two lines, or the delegate
   instrument that refuses when a seat's persisted cwd does not resolve or the live tree is dirty (F12/F23):
   ```bash
   node tools/broker-serve.mjs --dry-run                          # preflight; exit 1 names the blockers
   node tools/broker-serve.mjs --start --max-duration 600          # only past the preflight's acks
   tail -8 selfdev.sqlite.broker.log                              # START / INTENT delivered= / PASS advancing
   ```
   **The local key no longer has to be exported.** The block below (written 2026-10-18) says a plain restart makes
   local seats fail `No API key for provider: local`. `src/providers/local.mjs:145-147` now falls back to
   `"local-placeholder"` and records `source: "none"`, so on 2026-10-28 (Linux) the preflight reported
   `DURIG_LOCAL_API_KEY` unset as a NOTE, not a failure, and both providers answered `/v1/models`. Keep exporting it
   only if a server actually demands a credential. What DOES still have to be right is the base URL / model / context,
   and those live in `durig.config.json` (`DURIG_LOCAL_*`, `DURIG_VERIFIER_*`) — check them with
   `node tools/broker-serve.mjs --status`, which fetches `/v1/models` and fails when the configured model is not
   advertised. There are now TWO local provider prefixes (`local/`, `verifier/` — `src/providers/local.mjs:36-42`),
   so a rig can hold two model families without a paid API.
   ```powershell
   $env:DURIG_LOCAL_BASE_URL='http://127.0.0.1:8080/v1'; $env:DURIG_LOCAL_MODEL='swift-1.5-iq2_xs'; `
   $env:DURIG_LOCAL_CONTEXT='65536'; $env:DURIG_LOCAL_API_KEY='local'; `
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1
   ```
   (`DURIG_LOCAL_BASE_URL`/`_MODEL`/`_CONTEXT` also live in `durig.config.json`; only the key is env-only.)

## Verify
```bash
tail -8 selfdev.sqlite.broker.log
```
Expect a fresh `START`, `WAKE <seat>`, and `PASS` lines. `status` shows the previously idle seats
generating. (The broker also logs `STRANDED settled=N` / `RECONCILE …` when it heals on start.)

### Reading a seat that wakes but never works (#5741)
If a seat is woken repeatedly while holding nothing claimable, look for `PARKED-WAKE seat=<seat>
reason=<set-changed|deduped>` lines in the same log. Since #5741 a parked seat is woken only when its
parked SET changes; `reason=deduped` means the broker saw the same set again and deliberately did not wake
it, so the silence is recorded rather than inferred. A seat still waking every ~30 s with the same set
means the dedup is not in effect - check that the broker is the build that carries
`src/scheduler.mjs::parkedChanged`, and that the queue rows for that seat really are unchanged
(`node cli.mjs queue --status held --with-gates` is the bounded read; do not dump the whole queue).

Re-run check: `node demo/parked-wake-dedup.test.mjs` (exit 0), and the integration probe from the ruling -
one held row, `DURIG_PROVIDER=faux node cli.mjs serve --max-duration 120`, then
`grep -c 'WAKE <seat>' <db>.broker.log`: 4 before the fix, 1 after (measured 2026-11-09 on main
f5a73c61 and on the fix branch).

## If it fails
- Won't start, or dies again with a storage error → `store-corruption-recovery.md`.
- Starts but a seat still will not run → `seat-reset.md`.
- A dead broker stays dead: this is the supervision gap, ROADMAP items 61–64 (host daemon).

## Escalate to
`pm` — when the dormant-revisit gap (shape b) recurs, it is the supervision gap ROADMAP 61–64 targets;
`lead` — when a dead broker stays dead after resume (the host-daemon gap).
## Evidence
2026-10-16 (items 54, 66, 68): a broker that died on a storage error stalled `impl`; `resume` cleared 5
stranded submissions, and the restart woke pm/impl/scribe. Item 54 makes a *stoppable* broker honest.
2026-10-16 (dormant case b): pid 16628 was ALIVE with a fresh heartbeat, last `PASS 82` at `21:09:19`,
**no pass for ~9.5 min**, no genlock, while `impl` held 23 queued items (`idle_with_queued_work`). The
dormant-revisit gap is still owed; the diagnostic is the fresh heartbeat + stale `PASS` + no genlock.
2026-10-18 (recurrence, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): the broker stayed
**alive with a fresh heartbeat** while its log froze at `PASS 1` for ~6.5 min; `.spike/serve.err` named
`wake-failed … Session failed after a storage error` for impl (conv 9) and qa (conv 15). Recovery per
this runbook: terminate the wedged pid (no genlock) -> `resume` (1 pm run) -> restart -> `START
pid=15720`, `INTENT delivered=2`, passes resume. Note: a **fresh heartbeat is not a health signal** —
read the last `PASS` line, not `broker.json`.
2026-10-18T02:37Z (recurrence, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): the SAME dormant
shape, pid 28168, log froze at `PASS 176` while fresh-heartbeat and no genlock. `.spike/serve.err` showed
a NEW signature — `Error: database is locked` (devtools/auditor) plus `Session failed after a storage
error` (pm/qa) — proving #1698's pass-survival is INSUFFICIENT (the broker still stopped driving; the
runbook also covers the surviving-pass proof `demo/broker-pass-survival.test.mjs`). Two spooled intents
sat undrained. Recovery per this runbook: `taskkill /F /PID 28168` (no genlock) -> `resume` (3
run-cancelled) -> restart (`START pid=37496`).
2026-10-18T17:12-17:41Z (recurrences 4-6, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): the
same dormant shape recurred three more times (pids `7404`, `3604`, `6124`), each after a per-seat
`wake-failed … Session failed after a storage error`; recurrence 5 removed the long-lived `ui.mjs` store
viewer (the concurrent-opener class), and recurrence 6 showed the fresh heartbeat was **frozen**, not
merely stale (`PASS` frozen ~2.7 min). Recovery each time: stop (cooperative `serve --stop` where the
process still answered) -> `resume` -> restart. **The dormant-revisit gap (prevention item 3) is now
FIXED** by `0c0d4d3` +
`991567d`: a pass that emitted any `wake-failed` schedules a retry with bounded exponential backoff and
logs `WAKE-RETRY in=<ms>ms seats=<names>`, so a transient storage error self-heals instead of parking the
broker (`demo/broker-wake-retry.test.mjs`, 3 scenarios). The scheduling is done AFTER the pass settles,
because `0c0d4d3` alone still parked when the SAME pass threw later (`superviseOnce` hitting the same
storage error) — recurrence 7. Still owed: `pass-failed` is not logged by `cmdServe`, so a swallowed
pass throw is invisible; and `SessionFailed.cause` logging (ROADMAP 78) + a stale-`PASS`+heartbeat
watchdog (ROADMAP 61-64).
2026-10-18T19:06Z (recurrence 8, `docs/incidents/2026-10-18-broker-dormant-stalled.md`): after the host
commit-exhaustion reboot the broker was DOWN (dead pid `16612`, `PASS 6` at `18:51:27Z`); `resume`
cleared 4 stranded submissions (pm `90494`, impl `90497`, scribe `90500`, auditor `90559`); restart with
the local env (per step 3) -> `START pid=10728`, `WAKE pm,impl,scribe,auditor`, `PASS 1..6`. `PASS 6`
emitted `wake-failed` for `qa` conv 15 (`Session failed after a storage error`) and logged
`WAKE-RETRY in=2000ms seats=qa`, but no `PASS` followed for ~3.5 min (fresh heartbeat, no genlock, idle
CPU); terminated (no genlock) and restart -> `START pid=11816`, which ran 30+ passes with `qa` woken and
zero `wake-failed`. `qa`'s three `Connection error.` runs in that window were the local server being down
(`local-provider-down.md`).
2026-10-18T20:27Z (hot loop, `docs/incidents/2026-10-18-broker-retry-hotloop.md`): the broker logged 823
`WAKE-RETRY … pass-threw` lines (each `in=60000ms`) at ~0.5 s spacing, the intent inbox did not drain, and
`serve --stop` returned `stopped:true` while pid `5840` kept spinning. `taskkill /F /PID 5840` (no genlock)
+ restart (`START pid=3296`) drained both spooled intents (`INTENT delivered=2 dead=0 dup=0`) and resumed
passes.
2026-10-18T20:56-21:15Z (hot loop recurrence, `docs/incidents/2026-10-18-broker-retry-hotloop.md`): the
restart alone was INSUFFICIENT. `START pid=5768` (`20:47:55Z`) ran clean to `PASS 90 ms=5056`
(`20:56:54Z`), then re-entered the ~0.5 s `WAKE-RETRY … pass-threw` spin (`1414` lines by `21:15:43Z`)
with a fresh heartbeat. `.spike/serve.err` named `wake-failed … pm conv 3 … Session failed after a
storage error` BOTH before and after the restart — a persistent cause. Recovery: terminate (no genlock),
then `repair-pi-live.mjs ./selfdev.sqlite 3`, then restart.
2026-10-19 (stop-defeat, `#2237`): a foreground `node cli.mjs serve` (pid `4092`) hot-looped on
`supervisor: escalated … seat: devtools, reason: degeneration`; repeated Ctrl+C had no effect and
`serve --stop` had already returned `stopped:true` while the process lived. `Stop-Process -Id 4092 -Force`
stopped it; `resume` cleared 3 stranded runs (scribe/auditor/devtools); the orphaned `genlock.0` (holder
`4092`) was removed. Earlier the same day a wedged broker (pid `4296`) was likewise force-killed. The
bounded-grace fix is routed: `#2237` + `.spike/delegate/intent-2237-bounded-stop.md`.
2026-10-19 (read path exposed by a healthy restart, `docs/incidents/2026-10-19-read-storage-handle.md`):
a broker restarted healthy (pid `17828`) dead-lettered every spooled CLI `read`
(`read: the broker has no storage handle (probeStorage)`), so `ps`/`queue`/`watch`/`ui` all failed.
Cause: `dispatchRead(harness.storage)`, a field pi-durable does not expose. Fix `a70c30d` (thread the
harness's real `Storage`); restart pid `5116`. The CLI had read the store directly (`readLocal`) while
the broker was down — which is why the broken handler stayed hidden until the restart.

2026-10-20 (delegate): **shape (b) recurred, and the obvious explanation was wrong.** pid 4528 was alive with
a fresh heartbeat, **no pass for 51 minutes**, no genlock held, empty `serve.err` — the textbook wedge. The
tempting conclusion was RAM starvation, because the local model (Swift 1.5 IQ2_XS) was holding ~22 GB of
experts on a 32 GB box at 95% load. **The discriminator settled it:** stopping the model dropped the machine
to 23% load / 24 GB free and the broker *still* did not pass, so it was the WEDGE, not starvation. It then
cleared on its own and `passAgeMs` went to single seconds.
**Reusable check, do it before naming a cause:**
```bash
ls -1 <db>.genlock*                       # none held => no pass in flight (not a slow pass)
# stop the heavy local model, wait one pass window, re-read status:
node cli.mjs status                       # passAgeMs resuming => starvation; unchanged => wedge
```
**Do not restart the broker while a 22 GB local model is loaded** — the restart needs ~1 GB of headroom to
fork, and with 96% RAM it fails in ways that look like a store problem. Free the model first, then restart.

2026-10-28T15:05-15:20Z (delegate, **Linux**, `node v24.22.1`): **read-only half of this runbook only — the `Do` steps
were NOT run here, so `last_verified` stays `unverified` on both OSes.** `node tools/broker-serve.mjs --dry-run`
reported `broker: down (no broker state)`, no genlock, and the spool holding 2 `pm` intents aged **2,037 min**; both
local providers answered `/v1/models` (`local/iq3_s` at `127.0.0.1:47831`, `verifier/mistralai/ministral-3-14b-reasoning`
at `127.0.0.1:1234`), so the 2026-10-18 "must export the local env" clause is now only about base URL/model/context.
The start was **refused by the preflight on purpose**, on two facts the old Diagnose block cannot see: `devtools.cwd`
in `rig.selfdev.json` names `C:/Users/Alex/dsh-Projects/pi-opendurig/item-2801` (unresolvable on Linux, and
`up --refresh --dry-run` reports `changes:{}` for all 12 seats because the rig file itself carries it — ROADMAP 210),
and 3 tracked files are modified in the live tree that a woken seat would edit (F12/F23). Full evidence:
`docs/reviews/delivery-channel-linux-2026-10-28.md`.

2026-11-08T22:12Z (delegate, **Linux Fedora 45**, kernel `7.2.15-300.fc45.x86_64`, `node v24.22.1`): **the silent
variant — reads hang with 0 bytes and no error text at all.** `node docs/evidence/2026-11-08-context-window/read-path-probe.mjs
--n=2 --timeout=8` printed `broker: degraded pid=3521203 heartbeat 17s ago last pass 2757s ago`, `spool: 21 pending
intent(s) … 56 DEAD-LETTER(s)`, then `read 1: 8009 ms, 0 bytes, HUNG (killed at cap)` and `read 2: 8009 ms, 0 bytes,
HUNG (killed at cap)` — while a direct read-only sqlite query in the same minute answered (128,248 tasks). Eight
concurrent `cli.mjs queue --json --no-body` at a 25 s cap all exited 124 with 0 bytes. No `read health: timed out`
message appeared, so this reads as an empty queue.

**Why:** `src/readclient.mjs:106-111` routes every read to the broker when one is alive
(`if (brokerAliveFor(dbPath)) return await readViaBroker(...)`). The pass loop had not run since 21:26:06.898Z after
23 `PASS-FAILED SessionFailed: Session failed after a storage error … errcode=5 errstr=database is locked` entries in
the log — **11** of them dated 2026-11-08; the log is cumulative since store creation, so time-box the count.
The run loop was still alive — conv 9 (impl) made 58 generations in 10 minutes, last at 22:12:19Z — so the fleet
looked busy while being unable to read anything.

**Two checks that this runbook did not have before, do them before naming a cause:**
```bash
node docs/evidence/2026-11-08-context-window/read-path-probe.mjs --n=2 --timeout=8
node --experimental-sqlite -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});console.log(db.prepare("select conversation_id,max(json_extract(record,\x27$.startedAt\x27)) mx from tasks where kind=\x27\"pi.generation\"\x27 group by 1 order by mx desc limit 4").all())'
```
**And the correction to the `genlock` rule above:** an empty `ls -1 <db>.genlock*` is **not** proof no generation is in
flight — measured empty at 22:06:57Z while a generation record was created at 22:06:48Z. Require both: no genlock
slots **and** no `pi.generation` record in the last two minutes. Otherwise a hard stop aborts live seat runs.

### When `serve --stop` cannot be honoured (added 2026-11-08, delegate)

`cli.mjs serve --stop` writes a stop **file**, and `src/broker.mjs:1651` is explicit about what that means:
"A raised SIGNAL (SIGINT/SIGTERM) stops at once. A `.stop` FILE is deliberately NOT [immediate]" — the file is
honoured at a **pass boundary**. So if the pass loop is dead, `--stop` deadlocks by design: the stop request can
never reach a pass. Measured 22:22Z: `serve --stop` twice, both times `pid 3521203 STILL ALIVE — not stopped`,
while the last pass was 21:26:06Z.

**The ladder, in order, with the safety check the old ladder lacked:**
```bash
node --experimental-sqlite -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});console.log(db.prepare("select conversation_id,max(json_extract(record,\x27$.startedAt\x27)) mx from tasks where kind=\x27\"pi.generation\"\x27 group by 1 order by mx desc limit 3").all())'
#   proceed only if the newest generation is more than ~2 minutes old. genlock being empty is NOT enough (see above).
node cli.mjs serve --stop            # will not take effect while the pass loop is dead — expect "STILL ALIVE"
kill -TERM <pid>; sleep 30; pgrep -af "cli.mjs serve"   # SIGTERM drains at once; prove the pid is gone
node tools/broker-serve.mjs --resume # clear stranded runs
set -a; . "$HOME/.config/durig/env"; set +a
node tools/broker-serve.mjs --start --max-duration 1800 --yes-pm-wakes
grep INTENT selfdev.sqlite.broker.log | tail -1          # the spool drains only after a real pass
```
**[judgement]** SIGTERM cuts live seat runs. If seats are mid-run (they were here: conv 9 generating 38 s before the
check), the honest options are to wait for the runs to settle, or to accept the abort. This delegate chose to wait
and report, not to kill.

## The ladder, exercised successfully at 2026-11-08 23:30Z

Sequence that worked on Linux/Fedora 45, node v24.22.1, with one seat mid-run:

```bash
kill -TERM <pid>; sleep 10; pgrep -af "cli.mjs serve" | grep -v "bin/bash"   # expect: nothing
grep -E "STOP-REQUESTED|EXIT" <db>.broker.log | tail -2                        # expect an EXIT line
node tools/broker-serve.mjs --status                                            # preflight; "broker: down"
set -a; . "$HOME/.config/durig/env"; set +a                                    # keys live out of tree
node tools/broker-serve.mjs --start --max-duration 1800 --yes-pm-wakes
grep -E "START|INTENT|PASS" <db>.broker.log | tail -6
```

Evidence from the run: `EXIT pid=3521203 reason=deadline passes=-` (the wedged process exited with **zero** passes
recorded), then `START pid=3941969`, then **`INTENT delivered=37 dead=0 dup=0`** and `PASS 1 ms=12633 woke=qa,lead,scribe,devtools,auditor,security,architect`
— seven seats woke on the first pass and the spool went to **0** pending intents. `node cli.mjs status` returned
`{"ok": true, ...}` in **2.0 s** where it had just spent 120 s timing out.

Two things the ladder does **not** fix, so do not expect them: the **56 dead letters** stay in
`<db>.broker.inbox.error` (they are history, not a live block), and `--max-duration` still only bites at a pass
boundary — set it, but do not treat it as a kill switch (pitfall 160).

## Variant: the pass loop is stalled, the store is not, and nobody else holds the store

Symptom: `cli.mjs status` / `cli.mjs queue` print nothing for a long time. Measured exactly, they are **bounded,
not hung**:

```
$ time timeout 130 node cli.mjs status
real    2m0.569s   exit 1
{"ok": false, "error": "read health: timed out awaiting the broker's result"}
```

`src/readclient.mjs:35 readViaBroker(..., { timeoutMs = 120_000 })` — the CLI waits **120 s** and then reports the
timeout. Cut it off earlier (as a seat or a script with an 8 s cap would) and you see 0 bytes and exit 124, which
reads like a hang but is not. Meanwhile a direct read-only SQLite query on the same store answers in milliseconds.

Measure who holds the store before improvising (Linux; `/proc` is the instrument):

```bash
for p in $(pgrep -f "cli.mjs|node"); do n=$(ls -l /proc/$p/fd 2>/dev/null | grep -c "selfdev.sqlite");
  [ "$n" -gt 0 ] && echo "pid $p holds $n handle(s)  $(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-80)"; done
```

Measured 2026-11-08 23:02Z: **only** the broker (pid 3521203) holds the store, with **5 handles** — two sqlite
connections (fd 20/21/22 and 28/29) plus `-wal`/`-shm`. That is the shape of the `PASS-FAILED … database is locked
errcode=5` lines: the broker is contending **with its own second connection**, not with another process. So the
lock is not caused by a competing reader, and stopping your own CLI invocations will not help.

Why the CLI hangs anyway: `src/readclient.mjs:106-111` — if `brokerAliveFor(dbPath)` is true the read goes through
`readViaBroker`, which waits for a pass. A stalled pass loop means the read never returns; `readLocal` is only
reached when the broker is *not* resident. A hung read is therefore evidence about the **read path**, not the data.

Also note `--max-duration` is not a kill switch. `ps -o etime -p <pid>` on a broker started with
`--max-duration 1800` showed **02:05:25** elapsed — the duration, like the `.stop` file, is honoured only at a pass
boundary (`src/broker.mjs:1651`), so a stalled pass loop makes the broker unkillable by design. Only SIGTERM/SIGINT
stops it at once, and that aborts live seat runs.

## Why a hung `cli.mjs status` prints nothing: the read was dead-lettered

The spool's error directory holds one pair of files per failed intent: `<id>.error.json` (the request) and
`<id>.error.json.reason` (why it failed). Census, read-only:

```bash
node -e 'const fs=require("node:fs");const d="selfdev.sqlite.broker.inbox.error";
const r=fs.readdirSync(d).filter(f=>f.endsWith(".reason")).map(f=>fs.readFileSync(d+"/"+f,"utf8").trim());
const g={};for(const x of r)g[x]=(g[x]||0)+1;console.log(r.length,"dead letters",g);'
```

Measured 2026-11-08 23:21Z: **56** dead letters, **all** with the same reason, **all** `op: "read"`:

```
56 × apply failed: SqliteStorage is closed
```

which is thrown at `node_modules/@earendil-works/pi-durable/dist/storage/sqlite/storage.js:670`. So the CLI is not
slow — its read intent was rejected, and `src/readclient.mjs:106-111` still waits for a broker result that will never
arrive. Read the reason files before debugging the store; they name the failure class.

**Since #5822 a closed handle does not consume the intent.** `drainIntentInbox` classifies the error with
`isClosedStoreError` (src/broker.mjs) and, while the handle is closed, leaves the intent in the spool, records an
attempt on a sidecar `<spool file>.json.retry`, logs `INTENT-RETRY op=... request=... attempts=N/3 reason=...`, and
rethrows — so `runWakeLoop` reaches its reopen branch (a closed store is now treated like `SessionFailed there`) and
the SAME intent is delivered against the fresh handle. Only after `INTENT_RETRY_LIMIT` (3) attempts is it dead-lettered,
and then the `.error.json` carries a structured `refusal` (`code: "apply-failed"`, `requestId`, `attempts`) that
`readIntentError(db, requestId)` surfaces to the producer instead of a silent timeout.

Verify (both checks were run in this tree):

```bash
node demo/broker-closed-store-retry.test.mjs   # exit 0: delayed, bounded, visible, delivered after reopen
node -e 'const fs=require("node:fs");const d="selfdev.sqlite.broker.inbox.error";const r=fs.existsSync(d)?fs.readdirSync(d).filter(f=>f.endsWith(".reason")).map(f=>fs.readFileSync(d+"/"+f,"utf8").trim()):[];const g={};for(const x of r)g[x]=(g[x]||0)+1;console.log(r.length,"dead letters",g);'
```

**Do not confuse this with the pass loop being merely slow.** `<db>.broker.json` separates the two legs
(`src/broker.mjs:1628-1631`): `heartbeatAt` is LIVENESS (the event loop is turning, every 20 s), `lastPassAt` is
PROGRESS (the last COMPLETED pass). A fresh heartbeat with a frozen `lastPassAt` is the documented wedge signature —
"alive" is not "healthy".
