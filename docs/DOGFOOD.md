# Dogfooding durig

We use durig for our own work, so the obvious problems surface through ordinary
use rather than through a test we wrote to look for them. This file is the
running log: what we ran, what broke, and what it implies.

**Why a log and not just issues.** The first session produced a finding that
*corrected a documented fact* (F4 below), which is the kind of thing that gets
lost if it lives only in someone's memory. A finding here is not a bug report to
file elsewhere; it is evidence to act on, and each one names where it lands.

## How to dogfood it today

```powershell
cd durig
$env:DURIG_DB="./dogfood.sqlite"          # keep it off the live tutor-pi store
node cli.mjs up rig.v2.json               # a 2-seat rig: pm + worker
node cli.mjs send pm "<a real task>"      # must be work we actually want
node cli.mjs status                       # attention + measures
node cli.mjs queue                        # did it route?
node cli.mjs log worker 20                # what actually happened
```

Isolate the database. The live `tutor-pi.sqlite` holds the real rig, and dogfood
runs are noisy by nature.

**Prefer a file for the prompt.** `send` takes text inline only, and a backtick in
a shell argument is command substitution — see F1.

## What it cannot do yet

Seats have **six tools and no file access**: `send_work`, `claim_work`,
`complete_work`, `defer_work`, `resume_work`, `peek_queue` (`src/rig.mjs`). So a
seat can *describe* a change, *route* it, *claim* it, and *park* it on a question,
but it cannot read the repo, run a test, or write a file. That is ROADMAP item 4
(M3), and it is why a job like "read seven seats' transcripts and write a position
document" still has to run on OpenRig.

Dogfood what exists — coordination, routing, queue semantics, attention,
measurement, and the human views — and expect grounded content work to be
blocked until M3.

## Findings

### F1 — `send` has no file/stdin input, so prompts are shell-fragile

**Observed:** `node cli.mjs send pm "...`log <seat> --follow`..."` — the backticks
were command-substituted by bash, `seat` was run as a command, and the prompt
arrived with that section silently replaced by nothing. The model still answered,
which is worse than a failure: the run looked fine and was not the run we asked
for.

**Contrast:** OpenRig's `rig queue create` has `--body-file` explicitly to kill
"the backtick-shell-corruption class". durig has no equivalent on `send`.

**Lands:** a `send --body-file <path>` (and `-` for stdin) flag. Small, and it
removes a whole class of silent wrong-input runs rather than documenting it.

### F2 — an empty seat's log is indistinguishable from a hang

**Observed:** `node cli.mjs log sec --follow` on a seat with no entries prints
nothing and then waits. `log sec` prints `"entries": []`.

**Why it matters:** METRICS.md's "silence must be legible" rule applies to the
views, not only to measures — "no entries yet" and "broken" must not look alike,
the same reasoning as the empty-rig guardrail that names `node cli.mjs config`.

**Lands:** one line on stderr for an empty transcript, in both the plain and
`--follow` forms.

### F3 — `last_run_failed` reports the category and hides the cause

**Observed:** attention said `{"kind":"last_run_failed","detail":"model_error"}`.
The actual cause was in the entry and never reached the operator:
`429: {"message":"Model busy, retry later"}`.

**Why it matters:** a transient rate-limit and a genuine fault are the same notice
to a reader, and they call for opposite responses — wait, or investigate. The
detail field exists precisely to carry the reason (`computeAttention` already
passes `latest.reason`), so the cause is being dropped somewhere between the entry
and the notice.

**Lands:** carry a bounded `errorMessage` into the attention detail. Pairs with F5.

### F4 — D24's "entries carry no `usage` field" is false

**Observed:** successful assistant entries carry `usage` with `input`, `output`,
`cacheRead`, `cacheWrite` and a `cost` breakdown. Verified at the **storage**
level, not just in the log view, because a measure reading storage is the thing
that matters:

```
pm:     entries=6 withUsage=3 nonzeroTokens=2 withCost=3
worker: entries=6 withUsage=4 nonzeroTokens=0 withCost=4   (all four were 429s)
```

**Why it matters:** D24 recorded that claim as checked evidence and used it to rule
a cost measure out of the direct evidence class; METRICS.md and ROADMAP item 20
both repeat that we "cannot verify caveman's savings". All three are stale. A
token/cost measure is a **direct** measure, so:
caveman's claimed savings become verifiable with our own numbers, and the drill's
token counter (item 2's forward-note) is unblocked.

**Lands:** correct D24 with a dated correction rather than an edit, update item
2 and item 20, and add the cost measure when the drill lands.

### F5 — a shared model produces `429 "Model busy"` failures, retried then abandoned

**Observed:** the worker's run failed as `unanswered (model_error)`. The entries
show three attempts, roughly 2 s and 4 s apart, each returning
`429: {"message":"Model busy, retry later"}`, then settling.

**Why it matters:** this is an operational property of running many seats against
one hosted model, and it looks identical to a code fault from the outside (F3).
It will recur under load, and it is a reason to keep per-seat model diversity
(item 3) honest — a shared model shares its rate limit too.

**Lands:** note it in the research/ops material; decide later whether a backoff
knob is worth it. Do not paper over it with an unbounded retry.

### F6 — the Router protocol works with a real model (regression marker)

**Observed:** `pm` was given a real backlog item, decomposed it, and `send_work`
created item #1 addressed to `worker` with a body carrying the problem and a
verification step; `worker` then had it visible in the queue. Attention then
reported the worker's failure correctly, and `metrics` computed a live window from
the new entries.

**Why it is recorded:** positive results are how we notice a regression later.
The end-to-end path — decompose, route, queue, attention, measure — works.

### F7 — an unanswered run could report a PREVIOUS send's reply

**Observed:** with two prior successful sends on the same seat, a third send that
could not pick a model (a faux seat with the provider switched to deepinfra)
settled as `unanswered (no_model)` and *still* returned
`reply: [{type:"text",text:"(faux) acknowledged."}]` with `stopReason: "stop"` —
the first send's reply, presented as this run's.

**Cause:** the settle identified "the reply this run produced" by diffing against
the newest **assistant** entry id captured before the run (`e.id !==
priorAssistantId`). A run that produces nothing leaves older assistant entries
that also differ from that id, so the newest-first scan falls through to one of
them. With exactly one prior assistant entry the scan finds nothing and the bug is
invisible — which is why the existing test passed: its seat had one prior reply,
and this session's new `--body-file` send made it two.

**Why it matters:** a failed run reporting a confident reply is the worst shape of
this bug — the operator sees `unanswered` *and* a reply together, and the reply
belongs to a different task. It also silently degrades `reply` for any seat with
history, which is every seat in real use.

**Lands:** diff against a watermark of the newest **entry** id rather than the
newest assistant id — entry ids increase, so "this run created it" is exactly
"id > watermark". Regression test added for the two-prior-replies case, which is
the case the old test could not reach.

### F8 — a worktree junction, deleted recursively, emptied the real `node_modules` and the vendored packages

**Observed:** a worktree was created through the new `node cli.mjs worktree` verb and removed
with `git worktree remove --force`. Removal followed the `node_modules` **junction** into its
target and deleted through it: `durig/node_modules` was left empty (52 of 92 packages' worth) and
`vendor/pi-main/packages/{ai,chord,durable,telemetry}` were emptied entirely - **654 tracked files**.
The very next suite run went from 30/30 to 3/30 as `ERR_MODULE_NOT_FOUND`, in the same command
that committed.

**Why it matters:** this is the classic Windows junction hazard, and the helper I had just
written created the hazard itself. It also landed on the *vendored* tree, because
`node_modules/@earendil-works/*` were themselves junctions pointing into `vendor/pi-main` - so one
delete reached two trees. Nothing tracked in durig was touched (`node_modules` and `vendor/` are
gitignored), which is the only reason recovery was cheap.

**Recovery, for the record:** `git -C vendor/pi-main restore packages/` restored all 654 tracked
files from the vendored clone, then `node scripts/sync-pi.mjs --sync --link` rebuilt and relinked
at the pin. 30/30 afterwards. `npm install` alone was NOT enough: it restores the released
packages, not the linked pin.

**Lands:** `removeWorktree` must **unlink the junction first** (non-recursively, which drops only
the link), then remove the worktree - and the demo must carry a canary proving the junction's
**target survives removal**, since the current test asserted only that the worktree was gone.
Until that lands the verb is unsafe to use on a real repository. This is also why the
junction-vs-symlink question in ROADMAP item 34 is not only about path syntax: a link changes what
a delete does.

### F9 — with real tools, pm investigates instead of routing

**Observed:** the first self-development item was sent to `pm` asking it to decompose and route.
pm read the docs (confirming ROADMAP item 10 from the file), then began running PowerShell on its
own - listing `demo/`, `docs/`, `node_modules` and reading line-numbered output - and the queue was
still **EMPTY** when the send timed out after about fifteen minutes.

**Why it matters:** pm's own constraint says "Never do implementation work yourself; route it", and
until this session that was enforced by *capability*: pm held six router tools and no file access,
so it could not investigate even if it wanted to. Granting every seat the same tools removed that
implicit constraint without replacing it, and a coordinator that can read the repository will read
the repository. The delegation the rig exists to exercise simply does not happen.

**Lands:** either pm keeps no file tools - the narrowest reading of the role, which per-seat tool
scoping already supports - or its instructions must say what to hand to whom *before* it looks. Note
that `check` has no rule for "a coordinator that works instead of routing", so nothing would have
caught this. Same axis as verifier scoping: the tool set is part of the role, not a uniform grant.

**Also worth recording: the timeout was OURS, not the rig's.** `send` waits for the run to settle,
and a real model making tool calls can exceed any patience a shell timeout has. The run is durable
and continues - `node cli.mjs watch` and `node cli.mjs log pm --follow` are how to follow it.

### F10 — a FAILED send still adds a user entry, so retrying duplicates the request

**Observed:** pm's transcript holds the same intake request **three times** (entries 30, 33, 41).
The first two sends failed at the model level (429 engine_overloaded, F5) and produced no reply, but
each still appended a `pi.user` entry. pm's first successful run therefore began with the request
already stated twice before it.

**Why it matters:** `--request-id` exists for exactly this - D34: a retry carrying the same id
reuses the existing submission - and I retried without one, so the rig recorded three requests where
the operator made one. A seat reading its own history sees duplicates it has to reason about. The
id is deliberately NEVER derived from the text, so this cannot be fixed by making the CLI clever;
it has to be the caller's habit.

**Lands:** no code change. Use `--request-id` on any send that may be retried - a caught failure is
precisely when to use it - and say so in the skill, because a failed send is not free.

## Session log

| Date | Rig | What we ran | Findings |
|---|---|---|---|
| 2026-10-11 | `rig.v2.json` in `dogfood.sqlite` | Routed a real backlog item (empty-transcript fix) through `pm` → `worker`; inspected queue, status, metrics, log | F1, F2, F3, F4, F5, F6 |
| 2026-10-11 | same | Fixed F1–F3 and wrote their tests; F7 surfaced while writing the F1 test | F7 |
