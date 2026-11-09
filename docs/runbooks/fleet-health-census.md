---
runbook: fleet-health-census
symptom: "you need to know whether failures are actually happening, and whether a fix made them STOP: 'is the fleet healthy?', 'did compaction stop failing?', 'which seat is producing the failures?'"
writes: false
precondition: "read-only"
last_verified: 2026-11-08
verified_by: devtools
evidence: "#5789; `node demo/fleet-health-counts.test.mjs` exits 0 (23 checks); live store read 2026-11-08: generations 73,075 (56,139 completed / 16,600 failed / 333 aborted / 3 in-flight), compaction 2,337 (1,905 completed / 432 failed), token-limit family 219, spend-cap family 209"
check_rule: null
---

# Counting fleet failures, and proving a count went DOWN

## When to use
A claim like "the compaction fix worked" or "that seat is fine" needs a NUMBER and a TREND. `cli.mjs status` shows
the current notice per seat; it does not count outcomes over time. This is the count.

## Impact
Without a counter, "fixed" is a feeling. ROADMAP 331's acceptance is explicitly a trend — the compaction failure
count must stop growing — and a trend needs an instrument that runs in a window.

## Diagnose (read-only)
```bash
node tools/fleet-health.mjs --db ./selfdev.sqlite --since-min 360          # per-conversation outcomes + failure families
node tools/fleet-health.mjs --db ./selfdev.sqlite --all-time --json        # the whole store, machine-readable
node tools/context-window-health.mjs --db ./selfdev.sqlite --since-min 720  # the window-pressure lens
```
Both read `tasks` with `node:sqlite` in `readOnly: true` mode: no harness, no store ownership, no model spend, so
they answer **while the broker is wedged** — the state in which `cli.mjs status` times out waiting for the broker.

To compare before/after a fix, take the same window twice:
```bash
node tools/fleet-health.mjs --db ./selfdev.sqlite --since-min 60 --json | grep -A2 '"failed"'
```
The `compaction.failed` number for a fixed window is the trend; `failureClasses[]` tells you WHICH cause moved and
which conversations produced it.

## What the numbers mean, and where they can mislead
* **In-flight is not a failure.** `outcome.status` is null while a run is still going; it is counted as
  `inFlight`, never as `failed`.
* **Families are normalised on purpose.** Measured on the live store, the same cause appears as many raw
  messages that differ only in a dollar figure (the spend-cap refusals: `$0.001165`, `$0.001197`, … counts 23, 16,
  15, 12, …). A counter keyed on the raw message would report "421 kinds of failure, one of each" — useless for a
  trend. `classifyFamily()` collapses by cause first.
* **Seat names are not in the task rows.** Attribution is by conversation id unless you pass
  `--seat-map seats.json` (`[{"name":"impl","conversationId":42}]`). The tool SAYS which it is doing.

## Verify
```bash
node demo/fleet-health-counts.test.mjs   # exit 0: 23 checks on stores whose correct answer is known in advance
```
The demo is non-vacuous three ways: a completed row must not count as a failure; two messages differing only in a
dollar figure must collapse to one family with count 2; a row 30 hours old must be absent from a 60-minute
window. `--strict` exits 1 on the failing fixture and 0 on the clean one, so the gate's exit code is earned.

## See also
`spend-cap-tripped.md` (what a spend-cap refusal means), `context-over-window.md`, `compaction-eval.md`,
`broker-down-or-stalled.md`.
