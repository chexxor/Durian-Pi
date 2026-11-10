---
runbook: compact-a-seat
symptom: "a seat's context is saturated and a full reset would lose durable context"
writes: true
precondition: "none"
last_verified: 2026-10-30
verified_by: devtools (the compaction path) + delegate (the no-op mechanism, read from shipped source 2026-10-30)
evidence: "#1904 (demo/compact-spool.test.mjs — broker applies op:compact live) + #873 (demo/compact.test.mjs) + pi-durable dist/harness/compaction.js:69-71,194-201,211-234 and generation.js:236-245, read 2026-10-30; env-name corrected to DURIG_DB (#5911, 2026-11-10, tree f192f543 - the CLI reads DURIG_DB: cli.mjs:155; only scripts/clockin.mjs:379 takes DURIAN_PI_DB)"
check_rule: null
---

# Compact a seat (summarize the old context without losing it)

## When to use
A seat's model context is saturated — turns are slow and every turn re-reads a bloated history — and a
full `reset` would throw away context the seat still needs. `compact` summarizes the OLDER turns into a
summary entry and keeps the rest.

## Impact
If you do nothing: the seat keeps re-reading a bloated context (slower, costlier turns) or you reach for
`reset` and lose durable context. Blast radius: one seat's model CONTEXT — the durable transcript is
never deleted (a compaction writes a summary entry; it is not a deletion).

## Preconditions
None with respect to the broker: with a broker alive, `compact` ROUTES through the command spool
(#1904 / ROADMAP 71) — the broker applies it with its OWN harness (single writer + scheduler), so the
rig keeps running and an in-flight generation on the target seat is not killed. With NO broker, the
same command opens its own harness (the direct path) and refuses a seat holding a live generation lease
(the external-writer guard).

**Mid-flight is REFUSED, not silently applied.** pi-durable's compaction runs alongside a live
conversation, but its summary lands only at the seat's NEXT TURN BOUNDARY — so a mid-flight compaction's
outcome cannot be awaited reliably (auditor #2061 boundary / #2073). The broker therefore REFUSES a
`compact` while the target seat has a running generation, with a legible reason. **QUIESCE FIRST, then
compact.**

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
A very long history with no recent `pi.compaction` entry, and a seat that is still progressing (so a
reset would lose work), is the case this runbook is for.

## Do
1. With a broker running, just run the verb — it is routed through the spool and applied LIVE by the
   broker; the report carries `viaSpool: true`, the `requestId`, and the `summaryEntryId`. The optional
   trailing text is folded into the summarization prompt; omit it for a plain compaction.
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs compact <seat> "fold the early turns into a summary; keep the latest work"
   ```
   The producer form is equivalent (and needs no CLI):
   ```bash
   DURIG_DB=./selfdev.sqlite node intent.mjs <seat> --op compact --instructions "fold the early turns"
   ```
2. With NO broker running, the same command opens its own harness (the direct path) and refuses a seat
   holding a live generation lease — wait for the run to settle, or `stop <seat>` first.
3. If the seat is MID-GENERATION the op is REFUSED (the reason names it). Quiesce first, then retry —
   this is the pause+compact choreography's required order: **QUIESCE → COMPACT → upgrade.**
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs pause --wait        # drain to quiescence (ROADMAP 131)
   DURIG_DB=./selfdev.sqlite node cli.mjs compact <seat> "fold the early turns"
   DURIG_DB=./selfdev.sqlite node cli.mjs unpause
   ```
   (`--wait` returns only once every seat has settled. Or simply let the run finish, or `stop <seat>`.)

## Verify
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6
```
Expect a `"kind": "pi.compaction"` entry among the newest entries, matching the `summaryEntryId` the
`compact` report returned. The verb fails loud when no summary entry was written, so an `ok:true` report
always means a real summary landed.

## If it fails
- `compact via the spool (broker pid …): <reason>` → the broker DEAD-LETTERED the request with that
  reason (`unknown seat`; `seat <s> is mid-generation … quiesce first`; or `the seat was quiescent but
  no pi.compaction entry was written`). Read the reason, fix it, retry — a routed compaction is never a
  silent no-op, and a MID-GENERATION refusal means "pause --wait, then compact".
- `no pi.compaction entry was written` → **read the section below first: on this rig that is usually a legitimate
  NO-OP being reported as a failure**, not a broken compaction.
- No broker, and it refuses "holds a live generation lease" → wait for the run to settle, or
  `stop <seat>`, then retry.
- The seat still overflows: a second `compact` folds the newer turns into the existing summary; if the
  context can be dropped entirely, use `reset` (docs/runbooks/seat-reset.md).
- The summarization model errored: the task retries per the retry policy, then fails terminal; the
  transcript is intact — just retry the verb.

## Why `no pi.compaction entry was written` is usually NOT a failure (measured 2026-10-30)

The verb's wording implies a failure. pi-durable's shipped source says otherwise. The mechanism, at the lines:

1. The compaction task's `select` phase computes `const cut = selectCut(view, policy.keepRecentTokens)` and
   **`if (cut === undefined) return complete(...)`** — the task **completes and places no entry**
   (`vendor/pi-main/packages/durable/dist/harness/compaction.js:69-71`).
2. `selectCut` returns `undefined` when walking back from the newest message never accumulates `keepRecentTokens`
   tokens, or when nothing before the chosen cut has content (`compaction.js:211-234`). In plain terms: **the
   context is smaller than the “keep recent” budget, so there is nothing old enough to summarize.**
3. durian-pi **never sets a compaction policy.** The only harness setting passed is `settings: streamSettings(CFG)`
   (`cli.mjs:414-423`), and `streamSettings` returns `stream.timeoutMs` alone (`src/config.mjs:246-259`). So every
   seat runs `DEFAULT_COMPACTION_POLICY` — `enabled: true, reserveTokens: 16384, keepRecentTokens: 20000,
   backgroundTokens: 32768` (`harness/agent.js:10-15`).
4. Against a **24,576-token** window those defaults contradict each other. Automatic compaction is gated by the same
   selection: `thresholdCompaction` fires above `contextWindow - reserveTokens` (blocking) or
   `blocking - backgroundTokens` (background) **and only when `selectCut` finds a cut** (`generation.js:236-245`).
   Here blocking = 8,192; background = **−24,576, impossible**; and selection refuses until >20,000 tokens are kept —
   within ~4,500 tokens of the ceiling, i.e. past the point where a turn can still run. **On the verifier's window
   auto-compaction is not dead — it is a trap: it can fire only in the last ~4,500 tokens of the window, and firing
   there kills the turn.** A manual `compact` below that band is a no-op that reads like a defect.
   MEASURED, 2026-10-30 (`qa`, verifier window 24,576): a turn went out at `input=17,445`; the next request crossed
   the selection budget, so a real `pi.compaction` entry landed (entry **275457**), and the turn after it came back
   **`input=20,109, output=1, stopReason=length` with an empty reply** (entry **275459**). The seat had read a
   26,532-char file whole. That is the failure mode this policy produces: not a silent no-op, but a summary written
   at the moment there is no room left to answer, followed by an empty assistant turn that then counts against the
   turn-shape rule (`verifier-serving-headroom.md` Step 1).
5. It is **not** the window size alone — the same verb failed identically at 16,384. Do not “fix” it by raising
   context; that is the trap `verifier-serving-headroom.md` documents.

**What to conclude instead:** the seat's context is *below* the budget its policy was written for. If the seat is
overflowing anyway, the policy and the served window disagree — fix the policy, not the transcript. And check the
turn's **shape** first (`verifier-serving-headroom.md` Step 1): a compaction's summarization step is itself a model
call, so a seat whose conversation a strict template refuses can fail at compaction too.

## What auto-compaction is configured to, and what to set it to

**RECOMMENDED — the operator has not ruled, and this is a seat's change, not a delegate's.** Carrier row: **#4887
(`impl`)**. Do not hand-edit `vendor/` — it is the pinned dependency and gitignored.

pi-durable already has the seam: `compactionPolicy(settings, model)` layers a per-model `modelOverrides` entry over
the harness-wide policy, field by field (`compaction.js:194-201`). So the fix is to feed that seam from rig config:

1. A pure function beside `streamSettings` in `src/config.mjs`, with keys registered in `CONFIG_KEYS`:
   `DURIG_COMPACTION_ENABLED`, `DURIG_COMPACTION_RESERVE_TOKENS`, `DURIG_COMPACTION_KEEP_RECENT_TOKENS`,
   `DURIG_COMPACTION_BACKGROUND_TOKENS`, optionally `DURIG_COMPACTION_MODEL_OVERRIDES` (`provider/model` → fields).
   Fail loudly on a non-positive number exactly as `streamSettings` does — a value that is set and silently ignored
   is worse than one never set.
2. One call site: `settings: { ...streamSettings(CFG), ...compactionSettings(CFG) }` at the single `Harness.open`
   (`cli.mjs:414-423`), and correct the comment there that says only `stream` is configurable.
3. Values that stop contradicting each other for the **verifier class** (window 24,576;
   `DURIG_VERIFIER_MAX_TOKENS 3000`): `reserveTokens: 4096` → blocking at 20,480, and the summary request
   `min(0.8·reserveTokens, model.maxTokens)` = 3,000 instead of the default **13,107**, which is larger than the
   window the compaction exists to protect; `keepRecentTokens: 8192` → a cut exists once >8,192 tokens are kept;
   `backgroundTokens: 8192` → background fires at 12,288, while the seat can still run. **Local class (window
   200,000): leave the defaults** — blocking 183,616 / background 150,848 / cut at 20,000 is coherent there.
4. Fix the **reporting** too, because that is what misled four sessions: `cmdCompact` fails with
   `compact: no compaction entry was written` (`cli.mjs:1344`) and the spool path repeats it (`src/broker.mjs:689`),
   while pi-durable distinguishes the outcomes — the live doc carries `compactionFailure` only for a real failure
   (`harness/live.d.ts:104-110`). Report three states with distinct exit codes: `NO-OP (context below
   keepRecentTokens — nothing to cut)`, `FAILED (<compactionFailure reason>)`, `COMPACTED (<summaryEntryId>)`, and
   print the seat's token count against the policy so a no-op explains itself. `contextConsumption`
   (`src/context.mjs:104`) already computes per-seat consumption against the declared windows, so “will there be
   anything to cut?” is answerable **before** spending the verb.

## Escalate to
The operator — a compaction that keeps failing points at the model/provider, not at the rig.

## Evidence
Delegate 2026-10-30 (D174): `compact qa` returned `no compaction entry was written … (task 275369)` at a 16,384
window, and the same mechanism was re-read from the shipped source at the cited lines; the threshold arithmetic is
shown above. **Not RED→GREEN: the recommendation is unbuilt** (row #4887), and no config knob exists yet — that is
the point of the row.
#1904 (2026-10-18): `demo/compact-spool.test.mjs` (exit 0) proves the BROKER applies `op:compact` with
its own harness through the spool — a REAL `pi.compaction` summary entry lands and is reported as
`summaryEntryId`, a duplicate `requestId` applies once, and the seat is not aborted.
#2073 (2026-10-18): the same demo now STAGES a REAL in-flight generation and proves a MID-FLIGHT compact
is REFUSED legibly (`seat <s> is mid-generation … quiesce first`), commits nothing, and does not abort the
run (auditor #2061 boundary).
#873 (2026-10-17): `demo/compact.test.mjs` (exit 0) proves the live-lease refusal, that a REAL summary
entry is placed and reported as `summaryEntryId` (not just a task id), and that the earliest turn stays
in the durable transcript.
