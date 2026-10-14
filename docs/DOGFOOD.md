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

### F11 — a send killed mid-run leaves an admitted submission that only a write-side command schedules

**Observed:** after a `send` was killed by a shell timeout, pm's transcript ended with a `pi.user`
entry and NO assistant entry after it. Re-running every viewer command changed nothing: no new
assistant text, and the queue stayed empty. No generation slot was held (`selfdev.sqlite.genlock.*`
was absent), so the run was not waiting on concurrency.

**Cause:** the submission was **admitted durably** before the process died, but nothing scheduled
it. Viewer commands do not open a harness at all - `log`, `status` and `queue` read storage
directly - and `openHarness` deliberately skips `resume()` for viewers, because enabling
scheduling is a write-side act that would let a passive `watch` kick the very queue it is
observing. So an admitted-but-unscheduled submission waits for the next write-side command.

**Why it matters:** the operator's natural reaction to a stalled run is to LOOK at it, and looking
can never advance it. Worse, my first instinct - re-send - would have duplicated the request
(which is F10). The correct move is to re-send with the SAME `--request-id`: it reuses the admitted
submission, schedules it, and waits for the reply. D34's idempotency turns out to be the resume
mechanism as well.

**Lands:** no code change. Worth saying in the skill: to resume a run that was interrupted, repeat
the send with the same request id rather than a new one.

### F12 — a seat's `cwd` is fixed at `up` time, so `DURIG_SEAT_ROOT` alone does not move it

**Observed:** a selfdev run was pointed at a fresh worktree with
`DURIG_SEAT_ROOT=<path>/durig` on `send` and `run`, expecting the seats to write
there. They did not: `impl` wrote item 41's implementation into a *different,
stale* worktree (the one from a previous item). The work was real and its test
passed — but it landed on a base that predated several merged commits, so it had
to be ported by hand.

**Cause:** `up` resolves each seat's `cwd` once and stores it on the
conversation (`cli.mjs` `cmdUp`: `seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT`,
then `configure(tx, convId, { cwd })`). `send`/`run` read the cwd from the
conversation config, not from the environment, so changing `DURIG_SEAT_ROOT`
after `up` changes nothing. The `rig.selfdev.json` readme says to "point the run
at a worktree with `DURIG_SEAT_ROOT`"; it omits that an existing seat must be
re-pointed with `up --refresh`.

**Why it matters:** the isolation the worktree is supposed to provide is silently
absent — a seat writes to a tree the operator did not name, and the mistake looks
like success (the run completes; only the base is wrong).

**Lands:** either (a) document `up --refresh` as the re-pointing step, plus a
`check`/`run` warning when `DURIG_SEAT_ROOT` differs from the persisted seat cwd;
or (b) have `run`/`send` adopt `DURIG_SEAT_ROOT` when set, so the environment is
authoritative. Decide which and record it.

### F13 — `claimed` is not a substitute for a "held" state, and the stalled-claim wake lies

**Observed:** six backlog items are registered; the PM, told to start only rank 1
and hold the rest, marks the held five `queued` — because the queue has no other
state. `impl` then claims them (the queue says "claim the oldest item"), defers
three back to pm, then `resume_work`s them — leaving them `claimed` while idle.
The queue shows four `claimed` items; `impl` reports "no queued work". Both are
literally true: `claim_work` takes only **queued** items, and none are queued.

**Why it matters:** "held / registered, do not start" has no representation, so
the only way to express it is a state the seat will act on. And the driver's
stalled-claim re-wake cannot break the loop: it submits `WAKE_CONTENT` ("You have
queued work. Call `claim_work`…") to a seat whose work is **claimed**, not queued,
so the seat finds nothing and idles again.

**Lands:** (a) a non-claimable **held/registered** state (or a claim guard);
(b) a claim-aware stalled-claim wake message ("continue your claimed item"),
distinct from the queued wake. Registered as selfdev backlog #86/#87; (a) is
being built as #90.

## Session log

| Date | Rig | What we ran | Findings |
|---|---|---|---|
| 2026-10-11 | `rig.v2.json` in `dogfood.sqlite` | Routed a real backlog item (empty-transcript fix) through `pm` → `worker`; inspected queue, status, metrics, log | F1, F2, F3, F4, F5, F6 |
| 2026-10-11 | same | Fixed F1–F3 and wrote their tests; F7 surfaced while writing the F1 test | F7 |
| 2026-10-11 | `rig.selfdev.json` in `selfdev.sqlite` | Drove ROADMAP item 41 through `durig run`; the item-44 merge had clobbered the driver verb, and the seat cwd was pinned to a stale worktree | F12 |

## F14 — a `pi.live` document with an empty base and orphaned appends

The `run --watch` driver exited **1 on its first pass, 6/6 attempts**, with
`{"ok":false,"error":"unresolvable path: [\"generation\",\"message\",\"content\",0]"}`.
With the new `DURIG_DEBUG=1` stack path the call site was pi-chord `PathError` →
`applyOps` → `SqliteStorage.materializeDocument` → `#loadDocument`/`#acquire`. The
same error also killed `send impl`, so the seat was unreachable and the whole queue
stalled while every seat read as merely "held".

Cause: document 10 (`pi.live`, conversation 9) had a **base** revision of `{}`
followed by 21 `["a",["generation","message","content",0,"text"], ...]` deltas —
appends computed against a previous, non-empty state and replayed onto an empty
base. `pi.live` is transient live state (conversation content lives in `entries`),
and the stream was a degenerate repetition loop.

Repaired by dropping the 21 orphaned deltas, leaving the base at `{}`;
`run --watch` then survived its first pass. Two follow-ups: the driver must not die
on one bad document (ROADMAP P5 / #110), and `fail()` discarding the stack is why
this was untraceable for several cycles (fixed — `DURIG_DEBUG=1`).

## F15 — a helper defined outside a `try` cannot see the `const` declared inside it

Building the follower's live partial (ROADMAP 40c), `cmdLog` grew a `pollPartial`
helper next to the existing `renderHuman`/`print`, and it referenced `seat`, which
is a `const` declared **inside** the function's `try {` block. Block scoping means
the outer closure has no such binding, so the follower died at the first poll with
`ReferenceError: seat is not defined`. What made it costly: the CLI's top-level
catch printed it as `{"ok":false,...}` on stdout and the process exited, so the
demo saw a silent *timeout* — "no partial" looked like "feature does not work",
not like a crash. Fixed by passing `conversationId` as a parameter; a future helper
that runs after a block binding is established should take the value explicitly
rather than closing over a block-scoped `const`.

## F16 — `out()` pretty-prints, so a follower test cannot parse line-by-line

`out()` is `console.log(JSON.stringify(p, dropInternals, 2))`, so every CLI
document is **multi-line**. A follow demo that split the follower's stdout on `\n`
and `JSON.parse`d each line therefore parsed nothing and misreported "no partial"
for a feature that worked. Test against the stream by brace-balancing (or by text
`includes`), not by line. `demo/livestream.test.mjs` now extracts balanced objects.

## F17 — fabricating a `pi.live` fixture: `document.change`, and clear it before a real run

To observe streaming deterministically the faux provider is too fast, so the demo
writes an in-flight partial straight into the store. Two traps: `up` already
creates an empty `pi.live` per conversation, so `document.create` fails with
*"Document address already has a current incarnation"* — use `document.change`
with a base value; and a real `send` started against a fabricated
`generation.message` fails, so clear the fabricated generation first and let the
real send append the committed entry. This is also where the design rule lives:
the partial is **not** an entry and must never be emitted in an `entries` array.

## F18 — operator priority is not expressible: `claim_work` is oldest-first and no seat can hold

Driving the PIECE-1 spike (#209, the operator's explicit "START NOW") surfaced
this: #209 sat behind ~20 older queued items for `impl` (#156 next). No seat tool
can reorder, hold, or mark priority — `claim_work` takes `items.find(it => it.to
=== me && it.status === "queued")` in insertion order (`src/rig.mjs`), and
`send_work` only appends. `pm` could only work around it: register the gap
(#214) and send a directive item (#213). **Consequence:** "START NOW" changes
what a seat *does*, not what it can *claim*, so the work runs but its item stays
`queued`. Lands: #214, fold into #90 (the non-claimable `held` state).

## F19 — a `send` killed by the harness tool cap cancels the run and withdraws the message

`node cli.mjs send impl …` was killed at the 420 s tool cap while the seat was
mid-investigation. `node cli.mjs resume` then reported submission #9198 `placed`
→ `run-cancelled`, and the override user entry was withdrawn. The seat's on-disk
work survives and the committed transcript up to the abort persists, but the
instruction must be re-sent and the run restarted. `run` has `--max-duration`
(#147); `send` does **not**, so a heavy send has no bounded, self-settling form.
Lands: #147 (bounded run) / a `send --max-duration`.

## F20 — work done out of claim order cannot be completed

`complete_work` refuses unless the item is `claimed` by the caller (`src/rig.mjs`:
`if (item.to !== me || item.status !== "claimed") return …`). So when `impl` did
#209 via a direct steer without claiming it (F18), there was no legal move to
mark #209 done: the item stayed `queued` after the work was done *and
independently verified* (`qa` #215/#218). The queue's status is therefore not a
reliable "done" record for operator-priority work. Lands: #214 / #90.

## F21 — an isolated seat root carried a malformed pin, so its oracle was 47/48

The `pi-rebase` worktree's `pi-main.pin.json` is missing the comma before
`"packages"` (a hand-edit that appended the `REBASE 2026-10-13` note to
`"note"`), so `scripts/sync-pi.mjs` `readPin` and `demo/syncpi.test.mjs` throw
`SyntaxError` at byte 729 — the whole demo suite is **47/48** in that worktree.
The live tree's pin is valid (`sha 7d75a0e`; `node -e JSON.parse` ok) and its
suite is unaffected. `qa` reported the defect as "in the LIVE tree"; from a seat
whose root *is* the worktree that label is wrong and misleading. Two issues: the
rebase note was applied to the worktree copy while the live copy kept the old
note (the two differ only in `"note"`), and a verifier can mistake its isolated
root for live. Lands: worktree hygiene / devtools.

## F22 — the file tools are confined to the seat root; the shell is not

`impl` observed it: the `read` tool refuses a path outside the seat root while a
shell command can open the same path (the global Pi install under
`C:\Users\Alex\.pi\agent\install\…\pi-coding-agent`). `confine.mjs` wraps the
ExecutionEnv's path methods (`absolutePath`, `readTextFile`, …), but a spawned
PowerShell is a separate OS process under the shared user, and `DENIED_COMMANDS`
blocks only WSL/Docker/state-mutating git. So integration work can *execute* the
global Pi but not *read* its docs through the `read` tool — a seat must fall back
to the shell to dereference anything outside its worktree. Lands:
confine/seatguard parity.

## F23 — an isolated worktree forks from HEAD; uncommitted direct work is invisible and can be silently clobbered

The selfdev seats were re-pointed to the `pi-rebase` worktree — a checkout of
`a43ef44` (= live HEAD) with its own `node_modules`. But the operator's direct
work (ROADMAP 7/8/40c: `src/readapi.mjs`, `src/viewmodel.mjs`, and the
`chatview`/`watchview` edits) is UNCOMMITTED in the live tree, so the worktree
never contained it. `impl`'s PIECE 2 then created a NEW `src/readapi.mjs`
(4.7 KB event feed) **at the same path** as the live shared read API (8.9 KB,
used by `watch`/`log`/`status`/`check`/`metrics`). Integrating the worktree's
file would silently clobber the direct work — two different modules, one path.
An isolated worktree is not a faithful copy of a dirty working tree: it forks
from HEAD. Lands: worktree tooling / the operator's integration step; the feed
should be `src/eventfeed.mjs` (or extend `readapi.mjs`), and the operator's
uncommitted direct work should be committed before seats fork from it.

## F24 — two CLI processes against one store collide on entry IDs

Launching `send pm` and `send impl` **concurrently** against the same store made
one die with `{"ok":false,"error":"ID 10051 already belongs to entry"}` while
the other completed. `status`/`queue`/`resume` stayed healthy and `resume` found
nothing stranded, so the store was not corrupted — but the message was **never
delivered** (no guided refusal, no retry). `genlock` serialises generation
**slots**, not store writes, so nothing stops two CLI invocations from allocating
the same next entry id. Lands: a store write lock, or retry-on-conflict. Worth
fixing because automation naturally drives several seats at once.

## F25 — `--help`, a bare call, and an unknown verb all return `{"ok":false, …}` and exit 2

Asking for help is reported as an error. Verified: `node cli.mjs --help` → exit
**2**, `{"ok":false,"usage":…}`; `node cli.mjs` → exit 2; `node cli.mjs
frobnicate` → exit 2 with the same usage blob (cli.mjs:1703 `out({ ok: false,
usage }); process.exit(2)`). An end-user or a script cannot tell "help" from
"unknown command", and a non-zero help exit breaks `set -e` pipelines. Lands:
`demo/cli.test.mjs`.

## F26 — `queue` dumps the whole store; notices and history bury the work

Verified: `node cli.mjs queue` returned **258 items** — **181 done**, **94
notice-flagged**, 44 queued, 29 deferred, 4 claimed — and `cmdQueue` ignores its
arguments (cli.mjs:522, one `documentState` → every item). The `notice` flag is
in the data but the dump does not separate notices from work. An end-user cannot
find the 44 queued items under 181 done + 94 acks. Lands: `demo/peekqueue.test.mjs`
/ `demo/cli.test.mjs`.

## F27 — `ps`/`status` never show a seat's worktree root (or model)

Verified: each `ps`/`status` seat object carries only name/`conversationId`/role.
The per-conversation worktree root is persisted (the F12 guard reads it) but is
never surfaced, so a user cannot see which tree a seat is pointed at — the exact
confusion behind F21 (a seat calling its worktree "live") and #203 (the seat-root
flipped mid-item). The seat's configured model is likewise absent. Lands:
`demo/seatroot.test.mjs`.

## F28 — attention "deferred_awaiting_answer" names the OLDEST parked item and calls it "waiting on human"

Verified: `src/attention.mjs:144-151` takes `deferred[0]` and prints
`#${held.id} waiting on ${held.deferredTo ?? "an answer"}`. Live status showed
`impl: 24 item(s) parked on a question; #60 waiting on human` where **#60 is a
stale ROADMAP backlog item**, not the current question — so the one id shown is
arbitrary and the message conflates genuinely-pending parks with stale backlog
parks. An operator cannot tell what is actually waiting on them. Lands:
`demo/defer.test.mjs` / `demo/stranded.test.mjs`.

## F29 — a seat can degenerate into a repetition loop and stall a claimed item, with no automatic signal

On #260 (F26), `impl` emitted pseudo tool-calls as plain TEXT in a loop — its
reply was a long run of repeated `<parameter name="command">…</parameter>`
fragments rather than real shell calls — and the run ended with **#260 left
`claimed` and `demo/cli.test.mjs` failing**. Recovery was manual and only partly
helped: `node cli.mjs resume` found nothing (the run had already ended), and only
`node cli.mjs reset impl <handoff>` cleared the degenerate context, after which a
re-drive could finish the item. A run that ends "done" with a looping reply
raises no attention notice — `repeated_failure` (#164) targets *failures*, not a
degenerate-but-settled reply. An operator has to notice the garbage and know to
`reset`. Lands: supervisor / ROADMAP 44.

## Resolution status — 2026-10-13 session

Fixed this session (in the seat worktree, verified, pending integration):
- **F23 → #255** (`worktree` now refuses a dirty source).
- **F24 → #257** (send-path write retry/lock; `up`/`run` not yet covered).
- **F25 → #259**, **F26 → #260**, **F27 → #261**, **F28 → #262** (help exit code; `queue`
  filters; `ps`/`status` root+model; attention human/seat split).
- **F20 → #239** (`claim_work({ itemId })` claim-by-id, status whitelist preserved).
- **#219** worktree pin corrected; the worktree suite is **50/50** again.

Still open (queued/deferred): **F18/#214/#90** (priority + held state), **F19/#252**
(`send --max-duration`), **F21/#253** (root-name guard), **F22/#254** (confine/shell
parity), **F24/#258** (stale genlock slot), **F29/#275** (degenerate-loop notice),
**#156** (B1 pm read gap).

## F30 — `defer_work` is the only parking move, so unstarted backlog becomes phantom human questions

Observed after driving the team: 32 items were `deferred`, **27 of them parked on the human by
`impl`** — and they are not questions. `#252`'s recorded "question" is literally
`"Held/backlog: #252 (F19, bounded send) is 'REGISTERED BACKLOG' … Not starting older/backlog
items per the operator override. Parking unstarted; resume when re-sequenced."` with
`deferredTo:"human"`. The gated broker **#238** (waiting on a D-entry, not a human answer) was
parked the same way. **Cause:** the Router exposes no non-claimable `held` state — `grep` finds
`held` only in a comment (`rig.mjs`) and in `supervisor.mjs`'s local variable — so a seat that must
set backlog aside has exactly one legal move, `defer_work`, which by default asks the **human**.
The result is an operator-facing pile of fake decisions (`impl: 27 item(s) parked on a question;`)
that hides the real ones — the exact gap #90 ("non-claimable `held` queue state") designed but
never reachable. **Fix:** make `held` reachable (`hold_work`/`release_work`), skipped by
`claim_work`/the driver and shown by `peek_queue`.

## F31 — `resume_work` leaves `question`/`deferredTo` on the item, so a done item still reads as deferred

`resume_work` (`src/rig.mjs`) sets `status = "claimed"` and appends a `resumed` transition but does
**not** clear `item.question` or `item.deferredTo`. So `#239`, `#255`, `#257`, `#260`, `#261`, `#262`
are all `done` yet still carry `deferredTo:"human"` from an earlier park. Any reader that keys on
`deferredTo` without re-checking `status` (e.g. `supervisor.mjs` skips a `claimed`/`queued` item
whose stale `deferredTo === "human"`) can be misled. **Fix:** clear `question`/`deferredTo` on
`resume_work` (and defensively on `complete_work`).

## F32 — `edit` fails on a CRLF source file, pushing a seat into shell/Python surgery

While fixing `peek_queue`, `impl`'s `edit` on `src/rig.mjs` returned *"Could not find the
exact text in src/rig.mjs. The old text must match exactly including all whitespace and
newlines."* The file is **CRLF‑only** (`717` CRLF, `0` bare LF), so an `oldText` a model
emits with LF newlines can never match. The seat then fell back to PowerShell
`Get-Content`/`Set-Content` string surgery and wrote a **Python patcher** (`fix_peek.py`, left
behind in the seat root) — slow, error‑prone, and it re‑introduced a syntax error (`node
--check` failed) before it converged. **Prevention:** normalise line endings in the edit
matcher (compare ignoring `\r`, then preserve the file's existing endings on write), or
surface the detected endings to the seat; and rule "when `edit` misses, re‑read the exact
region; do not shell‑edit or script‑patch source." Lands: `demo/` for the matcher + a seat
instruction.

## F33 — `Cannot use a settled overlay`: a doc proxy returned from `api.commit` throws after settlement

`impl`'s new `peek_queue` computed `filtered` inside `api.commit` and **returned it**
(`return [filtered, head]`). Those are `RigQueue` item proxies; once the commit settled the
overlay is released, so mapping/reading them afterwards threw `Cannot use a settled overlay`
— a pi‑durable trap `claim_work` already documents ("snapshot plain values before returning …
a proxy that escapes the callback throws"). **Prevention:** a shared `snapshot` helper used by
every tool that returns doc‑derived data, plus a seat rule (never let a doc proxy escape the
`api.commit` callback). Lands: `src/rig.mjs` helper + `demo/`.

## Server‑side cache and long waits — a fourth option

Mitigating a long mid‑task wait with a large context (the #289 topic) has **four** known
options: (1) keep the fixed wake string so a *short* wait keeps the cache (ROADMAP 33);
(2) **compact** the context; (3) write a durable **handoff** note and settle; and (4) **refresh
the cache** by sending another request that carries the same context — the server documentedly
resets the cache TTL on a hit. Option (4)'s catch is cost: a refresh is not free, and when the
context is large the refresh can cost more than compacting or than writing a one‑line handoff,
so the choice must be **measure‑first** (compare the refreshed‑prefill cost against the
compact/handoff cost for the actual context size) rather than assumed.
