---
incident: delegate-session-lost-to-host-memory-pressure
date: 2026-10-30
severity: sev3
status: mitigated
symptom: "the delegate's own pi session died mid-`send` with a bash failure and had to be restarted; the seat run it had launched silently died with it"
runbook: null
fix: null
prevention: "docs/NEXT.md do-not list (detach seat runs with `setsid`; check host RAM before loading the 441 MB store) + next-session command block step 6; NO runbook covers this symptom yet — named as the gap"
last_reviewed: 2026-10-30
---

# The delegate's session died mid-`send`; the backgrounded seat run died with it and left a `placed` submission

_Incident 2026-10-30; detected by the operator ("this session crashed with a bash failure and I had to restart
it"); analysis by the delegate, in the restarted session, from the session JSONL + cgroup counters + `coredumpctl`._

## Summary

At ~19:57–19:58Z the delegate's pi process died while it was generating a turn, and the seat run it had launched
three minutes earlier with `nohup … &` died with it. No queue item was lost and nothing was corrupted: the brief
survived as a conversation entry, and re-arming it got the answer. The proximate cause of the harness death is
**UNVERIFIED**, but every surviving instrument points at host memory exhaustion: the user cgroup peaked at **95 % of
physical RAM**, the kernel OOM killer has killed **7** processes in this slice, and **no core dump exists in the crash
window** (a SIGKILL leaves none, while node aborts on this box do leave one). The one _proven_ failure in the same
window is a different one and is documented in D177: `pm`'s run died inside compaction at its context ceiling.

## Timeline

- `19:56:54Z` the bash tool call that launched `nohup env … node cli.mjs send lead --body-file …` returned normally
  (shape pre-flight output + `pid 3686784`); this is the **last record in the session JSONL** — the file
  `2026-10-30T18-20-36-365Z_01a18e0a-….jsonl` then jumps straight to the operator's next message.
- `~19:57–19:58Z` the harness died. **No failed tool call and no assistant turn was written**, so the death was not a
  tool error the agent saw: the process disappeared mid-generation.
- `19:58Z` last write to `selfdev.sqlite` and `selfdev.sqlite-wal` — the seat run outlived the harness by ~1 minute,
  then died; `.spike/fix-20261031/send-lead-out.json` was left **empty** (the verb never wrote its result), and its
  stderr ends at `sending to lead; waiting for its run to settle (a real model can take minutes)…`.
- `19:59:02Z` the operator's message arrives in the restarted session.
- `20:07:44Z` re-arm: `resume` returned `found: 0` because the orphan had **already been cancelled** by an accidental
  `cli.mjs doctor --help` (see Root cause / pitfalls), then the nudge was re-launched **detached with `setsid`**.
- `20:08:39Z` lead's run completed `stopReason=stop` and wrote **#4898 `queued`** and **#4899 `held`**.

## Impact

One delegate session lost mid-act; one seat run lost (lead's submission 275494 left `placed`, i.e. admitted but not
started, which `status` reported as attention `admitted_not_started`). The operator's ruling reached the team ~11
minutes late. **No queue item, no conversation entry, and no source file was lost**: lead's copy of the brief is entry
**275493** and is still in that conversation. No data risk to the store (`selfdev.sqlite` was intact; a pre-write
backup exists at `.spike/fix-20261031/store-backup-20261030-135039.sqlite`).

## Root cause

**Harness death — UNVERIFIED as to the exact killer, host memory pressure is the only hypothesis the instruments
support.** Evidence and its limits, all measured in the restarted session:

- `/proc/vmstat` → `oom_kill 7`; `user.slice`, `user-1000.slice`, `user@1000.service` and `app.slice` each report
  `oom 6 oom_kill 7` — **7 kernel-forced kills inside this user's slice**.
- `user.slice/memory.peak = 96,140,943,360 B` (96.1 GB) against `MemTotal: 98,780,144 kB` (101.2 GB) = **95 %**;
  `memory.current` 90.2 GB at the time of measurement; `SwapFree 3,215,692 kB` of `SwapTotal 8,388,604 kB` = 62 % used.
- The largest consumer is the model host, not the agent: **`strata-host` 50.6 GB RSS**, `llama-server` 7.7 GB.
- `coredumpctl list --since '2026-10-30 14:50'` → **`No coredumps found`**, while node **does** core on this box
  (SIGABRT cores at 02:30:54, 02:30:55, 02:43:07, 11:28:09, 11:29:05). So the death was **not** a V8 abort; a
  SIGKILL leaves no core, which is what an OOM kill is.
- Attribution is impossible without root: the killed cgroup was a **transient scope** (konsole tab / app scope) and is
  deleted, so its own `memory.events` is gone — surviving sibling tab scopes all read `oom_kill 0`. The journal is
  root-only here (`sudo -n journalctl …` produced nothing). **The operator can settle this in one command:**
  `journalctl -k --since '2026-10-30 14:54' --until '2026-10-30 15:02' | grep -iE 'oom|Killed process'` and
  `journalctl --since '2026-10-30 14:54' --until '2026-10-30 15:02' | grep -i oomd` (`systemd-oomd` is `active`).
- Plausible contributors, explicitly **not proven**: five 441 MB copies of the store under `.spike` (**3.3 GB** total)
  and `node` opening 441 MB copies read-only during a store probe; a **second live pi session** on the box
  (`--home-chexxor-Git-mathloco--/…jsonl`, 6.6 MB, written at 15:02 in the same window).

**Why the seat run died too — proven by construction, not inferred:** the run was launched with `nohup … &`, which
detaches from the _terminal_ but not from the harness's process group, so when the harness died the child went with
it. `setsid` fixes that, and the re-launched nudge under `setsid` completed.

**Two instrument pitfalls surfaced in the same window (both real, both measured):** (1) **`cli.mjs <verb> --help` runs
the verb** — there is no per-verb help, so the delegate's `node cli.mjs doctor --help` performed a real compound write
and cancelled lead's orphaned submission. Harmless here (that was the intent of the deliberate call that followed, and
`resume` then reported `found: 0`), but it was an unintended write and is recorded as such. (2) **`resume`/`doctor`
CANCELS a `placed` run, it does not retry it**: `cli.mjs:1101-1112` — `abortSubmission` returns `already_placed`, then
`conv.abort()`, and the action string is `run-cancelled`. Re-running the brief is a separate act.

## Detection

Nothing in the rig detected it; the **operator noticed** by seeing the terminal die, which is the worst detector. A
durable pre-flight now sits in `docs/NEXT.md` next-session step 6: `free -h`, `awk '$1=="oom_kill"' /proc/vmstat`,
and `/sys/fs/cgroup/user.slice/memory.peak`, checked **before** loading the 441 MB store. `status` did its part: it
reported the orphan as attention `admitted_not_started` with the instruction "re-arm it with the resume/doctor verb
(item 37(b))", and it carried the separate, unrelated `pm` failure detail
(`Compaction failed: Summarization hit the token limit; the summary is incomplete`).

## Resolution

`resume` (already effectively performed by the accidental `doctor --help`) cleared the stranded submission; the brief
was **not** re-sent as a new deposit — a **short nudge referencing entry 275493** was sent instead, **detached with
`setsid`**, and lead answered `stopReason=stop`, producing #4898 and #4899. The delegate did not touch `pm`, whose
context ceiling is a separate defect (#4887/#4886/#4876).

## Prevention

- `docs/NEXT.md` do-not list: **a backgrounded seat run dies with the harness unless detached with `setsid`**;
  **`resume` cancels rather than retries**; **`cli.mjs <verb> --help` runs the verb**; **check host RAM before loading
  the 441 MB store** and keep **one** store copy, not five.
- `docs/NEXT.md` next-session block step 6 = the RAM pre-flight (three read-only commands).
- **Gap, stated plainly:** `docs/runbooks/README.md` has **no** runbook for "the delegate's own session died / the host
  is out of RAM / a seat run was orphaned" — the closest are `verifier-serving-headroom` (GPU capacity) and
  `local-provider-down`. A row for that runbook (and for an attention kind that flags a `placed` submission plus a
  nonzero `oom_kill` delta) has **not** been minted: minting is the team's act, and `pm` is currently unreachable.
- `prevention: null` for the host itself: no durable mechanism stops the box from running out of RAM. That is an
  operator decision (LM Studio holds 50.6 GB RSS on a 94 GiB box while two pi sessions run).

## Evidence

- Session JSONL: `/home/chexxor/.pi/agent/sessions/--home-chexxor-Git-Durian-Pi--/2026-10-30T18-20-36-365Z_01a18e0a-d28d-7381-bae3-68f739755b50.jsonl`
  — last pre-crash record `2026-10-30T19:56:54.590Z` (a successful tool result), next record
  `2026-10-30T19:59:02.199Z` (the operator). Nothing between them.
- `.spike/fix-20261031/send-lead-out.json` (0 bytes of result), `.spike/fix-20261031/send-lead-err.log` (ends at
  `waiting for its run to settle`).
- Store: lead entries **275493** (the brief, `placed`) and **275506** (the answer, `stopReason=stop`); rows **#4898**
  (`queued` at 20:08:39.757Z, lead→impl) and **#4899** (`held` at 20:08:39.766Z, lead→devtools); `status`
  `latestByConv["21"] = {"status":"placed","entry":275494,…}` before the re-arm.
- `coredumpctl list --no-pager --since '2026-10-30 14:50'` → `No coredumps found`; full-day list shows the five
  SIGABRT node cores above.
- `grep '^oom_kill' /proc/vmstat` → `oom_kill 7`; `cat /sys/fs/cgroup/user.slice/memory.peak` → `96140943360`;
  `/proc/meminfo` → `MemTotal 98780144 kB`, `SwapTotal 8388604 kB`, `SwapFree 3215692 kB`; `ps -eo pid,rss,comm
--sort=-rss` → `strata-host 50.6 GB`.
- `du -sh .spike` → **3.3 GB**; five `*.sqlite` copies of 438–441 MB each.
- `systemctl is-active systemd-oomd` → `active`.

## Links

`docs/NEXT.md` (grants 13–15, blocker, do-not list, next-session step 6) · `docs/DECISIONS.md` **D177** ·
rows **#4887**, **#4886**, **#4876** (compaction cannot repair a seat at its ceiling), **#4898**, **#4899** ·
`docs/runbooks/compact-a-seat.md`, `docs/runbooks/verifier-serving-headroom.md`,
`docs/runbooks/resume-while-broker-runs.md` (why an external `resume` is safe only while the broker is down).
