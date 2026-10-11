# durig MVP definition and burn-down

Updated: 2026-10-08 (after repeat-call fix landed)

## MVP bar

"Functional for basic use-cases without major issues" means an operator
(human, or an LLM acting for them) can:

1. **Bootstrap a rig** from config — seats registered with personas and a
   constitution.
2. **Delegate work** between seats through the durable queue, with org-edge
   gating enforced.
3. **Trust durability** — kill/restart the daemon mid-flow; queue state and
   seat conversations survive and resume.
4. **See what is happening** — observe seat progress and spot a blocked or
   stuck seat without digging through logs.
5. **Survive messy operation** — concurrent claims never double-assign;
   errors return friendly structured states an LLM can react to.

## Burn-down order (risk-first)

| # | Item | Status | Proving test |
|---|------|--------|--------------|
| 0 | Repeat-call tolerant tools (`claim_work` overlay-proxy bug) | **DONE 2026-10-08** | `demo/repeat-call.test.mjs` |
| 1 | Persistence across daemon restart (JSONL storage, reopen same dir) | **DONE 2026-10-08** — first-run PASS; no code changes needed, pi-durable held up |
|   | Review recipe: `node demo/persistence.test.mjs` — expect `SURVIVED RESTART: item #1 [queued] "Ship the module"`, then `POST-RESTART WORKFLOW OK: item #1 -> done`, then `PERSISTENCE TEST PASS`, exit 0. The temp JSONL dir is created and removed by the test itself. Honest caveat: this simulates a clean close (`storage.close`), not a hard kill mid-write — a crash-during-write drill is a possible follow-up if we want belt-and-braces. |
| 2 | Concurrent-claim race safety | **DONE 2026-10-08** — first-run PASS; no code changes needed |
|   | Review recipe: `node demo/race.test.mjs` — expect `RACE OK: winner="ITEM #1 ..." loser=NO_QUEUED_WORK(isError:false) claimed-events=1` then `RACE TEST PASS`, exit 0. Two concurrent runs of the same seat contend for one item; exactly one wins, the loser gets a friendly non-error state, and the queue records exactly one claimed transition. |
| 3 | `durig watch` — streaming queue/transitions for the operator | **DONE 2026-10-09** — poll-based NDJSON stream (D11); found + dodged a real trap: pi-durable watches are in-process-only |
|   | Review recipe: `node demo/watch.test.mjs` — expect `WATCH OK: snapshot(seq1)=["First item"] live-update(seq2)=["First item","Second item"]` then `WATCH TEST PASS`, exit 0. Manual feel: `DURIG_DB=<db> node cli.mjs watch` in one terminal, `node cli.mjs queue` / a send in another; each change appears as a new JSON line within ~750 ms. `watch --once` prints one snapshot line and exits. |
| 4 | Blocked-seat surfacing — attention notice when a seat errors or idles with queued work | **DONE 2026-10-09** — `src/attention.mjs` (pure) + `durig status` cmd + attention carried in every `watch` line |
|   | Review recipe: `node demo/blocked.test.mjs` — expect `BLOCKED OK: notices=["idle/idle_with_queued_work","failed/last_run_failed"]` then `BLOCKED TEST PASS`, exit 0. Manual feel: `DURIG_DB=<db> node cli.mjs status` prints per-seat health; enqueue work for a seat that never runs and its notice appears in the next `watch` line within ~750 ms. Two notice kinds only: idle_with_queued_work (work waiting, nothing in flight) and last_run_failed (terminal unanswered run, reason attached). A seat actively running or settled-and-empty stays silent. |
| 5 | Quickstart doc — "boot a 2-seat rig in 5 minutes" | next | newcomer walkthrough followed verbatim |
| 5 | Quickstart doc — "boot a 2-seat rig in 5 minutes" | **DONE 2026-10-09** — `docs/QUICKSTART.md`; steps verified mechanically in faux mode (up idempotent, ps/status/send/queue/watch all behaved as written); live-mode branches marked explicitly where faux differs |
|   | Review recipe: open a fresh PowerShell, follow `docs/QUICKSTART.md` verbatim from Step 0 in faux mode; report any step that trips. Expected checkpoints: Step 2 prints created [pm, worker] then existing on rerun; Step 4 faux branch explains the empty queue and points at `demo/offline-v2.mjs`; Step 5 watch emits a health line immediately and on change. |
| 6 | Single-seat-at-a-time mode (`DURIG_MAX_CONCURRENT_SEATS=1`) — serve all seats from one local model (e.g. Qwen on a 24 GB GPU) | **DONE 2026-10-09** — `src/genlock.mjs` cross-process slot leases at the provider seam (D12); waiting-vs-stuck surfaced via lease files in status/watch |
|   | Review recipe: `node demo/singleflight.test.mjs` — expect `CAP OK: two concurrent seats finished with max 1 generation in flight`, then `SINGLEFLIGHT TEST PASS`, exit 0. Manual feel: `$env:DURIG_MAX_CONCURRENT_SEATS="1"; node cli.mjs send pm "..."` runs normally; while a LIVE generation holds the slot, another terminal's `status` shows attention `generation_in_flight`; simulate a wedged holder by writing a dead-pid JSON into `<db>.genlock.0` and status flips to `generation_stale`. Unset the env var and no lease machinery engages at all. |
| 6 | Single-seat-at-a-time mode (`maxConcurrentSeats: 1`) — lets the operator serve all seats from one local model (e.g. Qwen on a 24 GB GPU) instead of paying per-token at a hosted provider | after #4 | new test: two seats with pending work under the limit; assert at most one generation in flight at any instant (faux provider counts concurrent starts), both seats still finish, and a waiting seat is distinguishable from a stuck one (pairs with #4) |

#6 notes (scoped honestly):
- The limit must be enforced where generations are kicked off, not just in a
demo driver — otherwise it is theatre. Natural seam: the provider/runner
adapter durig already single-sources (`vendor/pi-deepinfra/models.ts` pattern);
a local Qwen endpoint is then just another provider entry.
- "Waiting for the GPU" must be surfaced as a distinct, healthy state, not
indistinguishable from "stuck" — design together with #4.
- MVP bar impact: this extends bar item 2 (delegate work) with a cost axis;
it does not change durability or race guarantees.

Rationale for the order: #1 and #2 are cheap tests that could each expose
real defects in the core promise; if either breaks, everything downstream is
built on sand. #3–#4 are the operator's eyes (without them real use is blind
flying). #5 ships only once the product underneath is trustworthy.

## Review recipes

Every change ships with a way for the operator to verify it personally:
a command to run, the expected output, and where the interesting evidence
appears (see repeat-call recipe in the session log / README examples).

## Explicitly out of MVP scope

Deferred from Core_Ideas.txt as before: constitutional-evolution search,
Big-Five injection, FIPA-ACL performatives, Contract Net auctions, dynamic
personas, blackboard architecture.

## Review recipe — real-model routing fix (D16, 2026-10-09)

Proves: seats actually route work through the queue with a real model.

```powershell
cd durig
$env:DURIG_PROVIDER="deepinfra"; $env:DURIG_DB="$PWD\scratch-review.sqlite"
node cli.mjs up rigs/tutor-pi.rig.json
node cli.mjs send pm "Delegate ONE small task to seat impl using send_work: implement a hello-world endpoint. Then reply ROUTED."
node cli.mjs queue                 # expect: #1 [queued] pm->impl ...
node cli.mjs send impl "Check your queue and handle any queued work."
node cli.mjs queue                 # expect: #1 done + #2 DONE notice impl->pm
Remove-Item scratch-review.sqlite*
```

Regression guard: `node demo/seatmodel.test.mjs` covers per-seat model strings;
the nine-demo suite covers everything else.

## Review recipe — config file + seat refresh (2026-10-10)

Why: an operator with no `DURIG_DB` ran `send pm` and the CLI acted on the
default `./rig.sqlite` instead of `tutor-pi.sqlite`; the rig "looked broken"
while being pointed at the wrong database.

```powershell
cd durig
Copy-Item durig.config.example.json durig.config.json   # edit paths as needed
node cli.mjs config            # proves source + resolved DURIG_DB
node cli.mjs up rigs/tutor-pi.rig.json --refresh   # re-apply prompts/edges
```

Regression guards: `node demo/config.test.mjs` (precedence, discovery, error
contract, secret redaction) and `node demo/refresh.test.mjs` (idempotent up,
--refresh repairs a stale prompt).

## Review recipe — pi main pin (D17, 2026-10-10)

```powershell
cd durig
node scripts/sync-pi.mjs                 # pin vs upstream tip (drift report)
node scripts/sync-pi.mjs --sync --link   # build pinned main + link it (~40s)
node demo/syncpi.test.mjs                # pin/args/drift/link-spec logic
node scripts/sync-pi.mjs --link          # re-link after any later --sync
node scripts/sync-pi.mjs --unlink        # restore released packages
```

Regression guard: the full demo suite must pass on released packages AND after
`--link`; that pair is what proves `toolText()`'s dual `content`/`output`.

## Review recipe — CLI contract + live view (2026-10-10)

`demo/cli.test.mjs` drives the real CLI in faux mode and locks the operator
contract: `up` (idempotent), `ps`, `queue`, `status`, `watch --once`, `send`,
`log`, `config`, every error path (exit 1 for bad arguments, exit 2 for an
unknown verb), and the non-`done` settle notice on stderr.

`demo/streamcli.test.mjs` covers the live view wiring across `--stream`,
`--no-stream`, and the non-tty default, asserting stdout stays one JSON
document in all three.

```powershell
cd durig
node demo/cli.test.mjs
node demo/streamcli.test.mjs
```

## Review recipe — human watch view (2026-10-10)

`node cli.mjs watch` renders a per-seat dashboard (who, role, current work,
last thing said) when stdout is a terminal, and keeps NDJSON when it is not.

```powershell
cd durig
$env:DURIG_DB = "<your rig>.sqlite"
node cli.mjs watch --once --human   # one snapshot, readable
node cli.mjs watch --once --json    # the same snapshot, machine contract
node demo/watchview.test.mjs        # formatters + CLI wiring, offline
```

Live proof used to validate the view: start `watch --human`, then `send pm` a
routing task and `send worker` to act on it — the panel moves through
`generation_in_flight` → `sent #1` → `has #1 queued` → `working on #1` → DONE
notice, and the `↳` line follows what each seat says.

Conventions and the survey behind them: `docs/RESEARCH.md`.

## Review recipe — read and follow a seat's conversation (2026-10-10)

`node cli.mjs log <seat> [limit] [--follow]` renders one seat's conversation
oldest-first, grouped into turns (operator message / agent message / tool call
plus its output) with a timestamp and an elapse delta on each turn. Tool output
is collapsed to one line with a signposted count; `--full` expands it and
`--tool-bg` adds pi's tinted tool background. `--follow` keeps it open and
prints each new turn as it commits; reads go straight to storage, so a viewer
never resumes scheduling.

```powershell
cd durig
$env:DURIG_DB = "<your rig>.sqlite"
node cli.mjs log pm --human          # history, readable
node cli.mjs log pm --follow         # history, then live
node cli.mjs log pm --json           # entries with text + raw provider message
node demo/chatlog.test.mjs           # rendering, contract, follow (offline)
```

Cross-process follow is polled at the same 750 ms interval as `watch`; SQLite
has no cross-process notification, so polling is the mechanism (see
docs/RESEARCH.md, "Live delivery of seat activity").

## Review recipe — audit a rig before you run it (2026-10-11)

`node cli.mjs check <rig.json>` reads the rig file **and** the store in one pass
each, and reports what is structurally wrong with the exact fix. It reads both
because a rig that looks right in the file can be running something else: the
tutor-pi spec declared its constitution inline while the store held a different
one, so 13 seats ran without the team culture and no command said so.

Severity says **who can fix it**. `error` means the rig cannot do its job until
the file changes, and `check` exits nonzero so a script can gate on it.
`fix-now` is a gap the operator can close and never fails a run. A rule `check`
cannot judge is reported **skipped with its reason**, never as a pass.

```powershell
cd durig
node cli.mjs check rigs/tutor-pi.rig.json --human   # readable report
node cli.mjs check rigs/tutor-pi.rig.json           # JSON contract; exit 1 on errors
node demo/check.test.mjs                            # every rule + the CLI, offline
```

Live proof: against the live tutor-pi store it reports `single-model-rig` for all
14 seats, which is ROADMAP item 3's motivating finding. It used to report
`unreachable-seat` for `ux`, `sec` and `dev` as well - the converter never read
OpenRig's rig-level `edges:` list, so three seats could not initiate a send (D26)
- and that finding going clean is what confirmed the converter fix.
The `constitution-not-applied` rule is the regression it was built from: that same
mismatch is now a finding with the exact command instead of a silent no-op.

## Review recipe — measure drift instead of listing concerns (D24, 2026-10-11)

`node cli.mjs metrics <rig.json>` answers "is this rig getting worse?" from data
the store already holds — every message, every tool call with its arguments, and
every queue transition — so it is a read-only query, not a new instrumentation
surface. No telemetry, no egress, no table, no write path.

Four measures ship, chosen so all three of D24's evidence classes are exercised by
the first cut:

| measure | class | reads |
|---|---|---|
| `step-repetition` | direct | a tool call repeating one the seat made within its last 3 calls |
| `unverified-completions` | proxy | `complete_work` with no retrieval call in the same turn |
| `queue-ageing` | direct | minutes since the oldest queued item last changed state |
| `shared-reviewer-model` | config-derived | a verifier seat sharing an author's model |

```powershell
cd durig
node cli.mjs metrics rigs/tutor-pi.rig.json --human        # the deliberate table
node cli.mjs metrics rigs/tutor-pi.rig.json                # JSON contract
node cli.mjs metrics rigs/tutor-pi.rig.json --window all   # widen past the scan bound
node cli.mjs status                                        # the ambient pointer, if anything moved
node demo/metrics.test.mjs                                 # every measure + honesty state, offline
```

**What the reading refuses to claim** is the part worth reviewing, because it is
the part that would otherwise become a false all-clear:

- no tool calls is `null`, not "0% repetition"; no completions is `null`, not
  "0% unverified" (`no data` is a state, not a pass);
- a page that starts mid-turn drops its leading partial turn, so a completion
  near the scan edge is not called unverified because its retrieval fell off it;
- no baseline reads `unknown`, never `ok`;
- a zero baseline cannot silence a climb off zero (`k × 0` is 0, so the relative
  rule would never fire — movement off zero is itself the signal);
- a config-derived value draws **no trend arrow**, because a property of the spec
  is not a rate over time;
- a bounded window says it was bounded, and a rig with no new data says so —
  absence of activity is not improvement.

Ambient placement follows the doc's admission test. `watch`'s footer and
`status` carry a metric notice **only when a measure has moved**, and
`shared-reviewer-model` never goes ambient because it is already visible as a
`check` rule. `status` prints the pointer to `metrics` only when something is out
of band — a pointer that prints every time stops being read.

Live proof: against the live store it reports `queue-ageing` 1508 min (one queued
item has sat for 25 hours), `shared-reviewer-model` 3/3 (every verifier shares the
authors' model — item 3's finding, now measurable), `step-repetition` `unknown`
(no baseline yet) and `unverified-completions` `silent` (no completions), plus the
honesty line `! no new data for 25h - rates below are still, not necessarily
good`. `status` then adds `note: 1 measure(s) out of band` on stderr.

Cost: metrics and the watch highlights are derived from ONE per-seat page scan,
measured at 0.9–1.4 ms for 14 seats × 24 entries against `watch`'s 750 ms poll.

Deferred, with reasons rather than half-built: cross-render hysteresis needs
either state or a store-derived series, and the small change-log that
config-derived trends would need is a new write path — owed a `security.sec`
position before it ships (D24, D27). Pair attribution for a shared reviewer model
stays `check`'s finding to raise.

## Review recipe — the hardened starter rig (item 1, 2026-10-11)

`check` could already tell you what you did wrong. `rig.starter.json` is the
configuration it describes, so a new rig can start from one that passes.

```powershell
cd durig
$env:DURIG_DB = "$PWD\scratch-starter.sqlite"
node cli.mjs up rig.starter.json          # created: pm, impl, qa, lead
node cli.mjs check rig.starter.json --human
```

Expected: `PASS  0 error · 0 fix-now · 8 passed`, exit 0 — and specifically not
"0 findings with every rule skipped". All eight rules genuinely run (the store is
read), which is exactly the failure mode the test exists to exclude.

Four generic seats, so no corpus is baked in. The constitution is inline, because
`constitution` resolves against the CWD and the starter is meant to be copied
elsewhere. `qa` is on a second model family, because one model for every seat
makes a shared blind spot systemic and a verifier is where that costs most. Every
seat has an outgoing edge: work down, reports back, escalation to `lead`.

```powershell
node demo/starter.test.mjs
```

It does not stop at asserting a clean report. "0 findings" is also what `check`
prints when every rule is skipped, so the test breaks a copy of the starter five
ways — the second model removed, a seat left stranded, an edge to a nonexistent
seat, the verifier renamed, and a store created but never `up`-ed — and requires
each rule to fire. Observed failure when the second model is removed:

```
AssertionError: starter has fix-now findings: [{"id":"single-model-rig", ...
```

It also asserts the inline constitution still matches `constitution.txt`, so the
two copies cannot drift apart.

Worth knowing before you rely on it: `check` against a rig whose store does not
exist yet **passes**. Absence is not a defect until there is a store to compare
against, and it reports `constitution-not-applied` as *skipped*, not as a pass. A
store that exists and was never `up`-ed is the error. The test asserts both cases
separately so they cannot be collapsed into one.

## Review recipe — load extensions from config (item 23, 2026-10-11)

An extension is a plain module, because pi-durable's registry already *is* the
extension system — durig installs its own Router through it.

```jsonc
// durig.config.json
{ "DURIG_EXTENSIONS": "./extensions/timing.ts" }
```

```js
// extensions/timing.ts
import { defineExtension, section } from "@earendil-works/pi-durable";
export default defineExtension({
  name: "timing",
  sections: [section("timing-note", () => "Report elapsed ms for slow tools.")],
});
```

```powershell
cd durig
node cli.mjs config                 # shows the effective extension list
node cli.mjs up rig.v2.json         # reports the names it installed
node demo/extensions.test.mjs
```

The proof that matters is that a configured extension's section reaches a seat's
model — read back from the `pi.system` entry's `sections` map — with a **control**
asserting the same key is absent when it is not installed, so the assertion cannot
pass for an unrelated reason. The test also drives the real `cli.mjs`, because a
loader that works is not the same as durig using it.

Every wrong way to declare one fails the command and names the path: absent file,
no usable export, non-object export, no `name`, nothing declared, and a throw on
import. Two extensions sharing a name is refused as well, because pi-durable
resolves that by silently replacing the first with the second — that is the
live-reload behaviour, and in a single config list it is a copy-paste error.

This loads pi-**durable** extensions. pi *coding-agent* plugins — slash commands, a
TUI, project-trust prompts — cannot load here: durig does not depend on
`pi-coding-agent` and has no such surface (D21). And a declared path is trusted
code, running in-process with the harness API, whose tools inherit this process's
OS permissions; there is no auto-discovery, deliberately.

## Review recipe — say what was live when a reading was made (item 19, 2026-10-11)

`metrics` can see that a measure moved; provenance is what lets you say *why*.
The reading now carries the revision it ran at, whether the tree was dirty, and
the active extension set.

```powershell
cd durig
node cli.mjs metrics rigs/tutor-pi.rig.json --human    # first line is provenance
node cli.mjs metrics rigs/tutor-pi.rig.json            # provenance in the JSON contract
node demo/provenance.test.mjs
```

Expected first line, clean tree:

```
config  rev fb0007e clean · active: durig.router
```

and with an extension declared:

```
config  rev fb0007e clean · active: durig.router, ./extensions/timing.ts
```

Live proof that it is not vacuous: run it with uncommitted changes and the same
line reads
`config  rev fb0007e DIRTY (uncommitted changes: this revision does not describe what ran) · active: durig.router`.
That is the condition `security.sec` asked for — a dirty tree is a flag, because
the revision then does not describe what ran.

Two design details worth knowing before you read a value:

- **No repository reads as `unknown`, never `clean`.** A published or vendored copy
  of durig is absence of evidence; reporting it as clean would be a claim nothing
  supports.
- **The status is scoped to durig's own subtree** (`git status -- .`). durig usually
  lives inside a larger repository: unscoped, this repository reported 92 changed
  paths while durig's own subtree had 0. Untracked files count as dirty (a new
  extension module is part of the active set and absent from the revision);
  gitignored ones do not, so rig databases never make a reading dirty.

Nothing is stored and nothing is written — git is already the append-only change
log, which is why the security position chose this over a store write path.

## Review recipe — the rig file and the store must agree on who exists (item 10a, 2026-10-11)

`check` already read both sides in one pass, so seat drift is a fit rather than a
new mechanism. Both directions ship, because the live rig has both at once.

```powershell
cd durig
node cli.mjs check rigs/tutor-pi.rig.json --human
```

Live proof against `tutor-pi.sqlite` (verified 2026-10-11):

```
      scribe: the rig file declares a seat this store does not hold, so a send to it fails at runtime with "unknown seat"
      fix: create it in this store: DURIG_DB=<this store> node cli.mjs up rigs/tutor-pi.rig.json
      worker: this store holds a seat the rig file does not declare, so it keeps a conversation, a stored persona and an address nothing in the file accounts for
      fix: declare it in rigs/tutor-pi.rig.json, or start from a fresh store: up adds and refreshes seats but never removes one
FAIL  1 error · 2 fix-now · 5 passed
```

(The third finding is `single-model-rig`, which is ROADMAP item 3.)

Two rules rather than one, because the two directions are different failures:

- `store-missing-seat` is an **error**: a seat the file declares and the store lacks
  cannot receive work at all — a send fails with `unknown seat` — and the fix is
  `up`, exactly like an unapplied constitution.
- `stray-seat` is **fix-now**: a seat the store holds and the file does not declare
  keeps a conversation, a stored persona and a working address, and `up` never
  removes one, so clearing it is a store rebuild rather than a spec edit. There is
  no removal command yet, and the finding says so instead of implying one.

Both are reported as **skipped, with the reason**, when the store cannot be read —
never as a pass.

A useful side effect: this makes `check` a wrong-database detector. Run
`node cli.mjs check rig.v2.json` against a store holding a different rig and every
seat reports as missing, which is the D18 trap made visible rather than silent.

```powershell
node demo/check.test.mjs    # both directions, matching seats, skipped-when-unread
```

Falsified before it was trusted: with stray-seat detection disabled by hand, the
test fails with `a seat the store holds and the file does not declare is reported`.

## Review recipe — the suite must not leak (item 10c, 2026-10-11)

Twelve demos called `process.exit(0)` from inside the `try` whose `finally` removes
their temp dir. An exit inside a try skips the finally, so the cleanup never ran and
every test run left a directory and a SQLite file in `$TMPDIR`.

The proof is a measurement, not an exit code — and that distinction is the point,
because a leaking test still prints `PASS`:

```powershell
cd durig
$t = [System.IO.Path]::GetTempPath()
"before: " + (Get-ChildItem $t -Filter 'durig-*' -Directory).Count
foreach ($f in Get-ChildItem demo -Filter '*.test.mjs') { node $f.FullName | Out-Null }
"after:  " + (Get-ChildItem $t -Filter 'durig-*' -Directory).Count
```

Expected: the two numbers are equal. Before the fix the count grew by one per test.

The failure mode to know about: the `finally` reports a failed cleanup as
`CLEANUP WARNING` on **stderr** while the test still prints `PASS` on stdout, so
grepping output for `PASS` calls a leak a success. Count directories instead.

Fixing the exit bug uncovered a second, real defect. Once the `finally` ran for the
first time, `constitution`'s cleanup failed with `EPERM`: its `readConstitution()`
helper opened SQLite storage and never closed it, and on Windows an open handle
keeps the `-wal`/`-shm` files locked so the directory cannot be removed. The exit
bug had been hiding it for as long as both existed. So "make the cleanup run" and
"make the cleanup succeed" are two different checks, and only running it reveals the
second.

Known residue, deliberately not touched: `$TMPDIR` holds ~550 `durig-*` directories
from before this fix. They are in the OS temp directory, which is designed for this
and cleaned by the OS, and removing them would mean a recursive delete on an
absolute temp path — which this project bans. Delete them by hand if they bother
you.

## Review recipe — learning from the pi-durable example projects (2026-10-11)

The Pi Durable post points at two examples (`experimental/durable` and
`experimental/vacation` in the pi repo). Their **sources had never been read**; the
full review is `docs/REVIEW-pi-durable-demos.md`.

```powershell
cd durig
node demo/primer.test.mjs      # the defect this review found, and its guard
```

The headline: **the review found a shipped defect in durig's own source.** `defer_work`
and `resume_work` shipped in item 5 while the `PROTOCOL` primer in `cli.mjs` kept
describing four tools, so no seat in the real CLI was ever told it could defer — the
feature was unreachable outside the test that drove it directly. A green suite over a
dead feature. The demo's `prompt.ts` is why it was visible: it builds the system prompt
from the active tool set, so a tool cannot exist undocumented.

Fixed, and held by a test in both directions:

```
$ node demo/primer.test.mjs
PRIMER TEST PASS (all 6 registered tools are documented, and the primer documents nothing else)
```

Falsified before being trusted: delete the `resume_work` line and it fails with
`tool "resume_work" is registered but not in the protocol primer, so no seat would ever
be told it exists`.

To re-read the demos at durig's **own pin** — so the comparison is against what durig is
validated against, not today's `main` — take the sha from `pi-main.pin.json` and fetch:

```
<pin>/packages/coding-agent/src/experimental/durable/runtime.ts
<pin>/packages/coding-agent/src/experimental/vacation/vacation.ts
```

Most of the value is in those two files: the `DurableView`/`DurableController` boundary,
and durable task phases with checkpoints. `main.ts` and `tui.ts` are **byte-identical
blob shas between the two demos**, so this is one project, not two — budget accordingly.

Where the findings went: ROADMAP items 24a–24g and 25, with items 4, 6, 7, 12 and 18
annotated rather than duplicated. What was declined on purpose — the TUI, a session
picker, the in-process view subscription — is in D33 with its reasons, so a considered
no is not later mistaken for an oversight.

## Review recipe — the stream timeout, and a correction (item 24a, 2026-10-11)

This item turned out to be mostly a **correction**. Two gap claims in
`docs/REVIEW-pi-durable-demos.md` were wrong, because the demo's source was read
carefully while durig's own side was described from memory. The one real gap was a knob.

```powershell
cd durig
node cli.mjs config                        # DURIG_STREAM_TIMEOUT_MS: null = platform default
$env:DURIG_STREAM_TIMEOUT_MS = "1800000"   # 30 min, for a slow local model
node cli.mjs ps                            # opens fine
$env:DURIG_STREAM_TIMEOUT_MS = "soon"
node cli.mjs ps                            # fails loudly, naming the setting
node demo/config.test.mjs
```

What is actually true, checked against the platform rather than assumed:

- `resolveSettings` (`vendor/pi-main/packages/durable/dist/harness/agent.js`) merges
  retry (3 attempts, 2 s base, 60 s agent delay), compaction (reserve 16 384 /
  keep-recent 20 000), progress intervals, `toolExecution`, both queue modes and
  `contextRetentionMs` (10 minutes) over built-in defaults. durig already had all of it.
- the provider path is the `openai` SDK: `maxRetries: 2` and `DEFAULT_TIMEOUT = 600000`,
  so durig could not hang forever either.
- `stream` is the only field with **no** default, so `streamOptions` was `{}` and
  `openai-completions` sets `timeout` only when it is given one.
- durig **already called** `harness.resume()` (`cli.mjs`'s `openHarness`, viewers
  excluded on purpose). `resume()` enables task scheduling and durig has no durable
  tasks, so it is correct and currently a no-op until item 24e.

So the fix is `DURIG_STREAM_TIMEOUT_MS`, and it **defaults to unset** — the platform
number stands rather than one durig invented. It is the only harness setting durig
exposes, because it is the only one with no default and a real reason to move in either
direction: `DURIG_MAX_CONCURRENT_SEATS=1` exists so a single slow local model can serve
the whole rig and ten minutes may not be enough, while the reverse operator would rather
fail fast than wait out ten minutes on a stalled endpoint three durable attempts running.

A bad value **fails the command**, which is asserted against the real open path rather
than as a unit test of the parser: a timeout that was set and silently ignored is worse
than one never set, and it would only surface under load.

The corrections are marked in place in the review doc rather than edited away. The
reusable lesson: reading one side of a comparison carefully and the other from memory
produces confident, wrong gap claims, and a wrong gap is worse than no gap.

## Review recipe — a retry must not generate twice (item 24d, 2026-10-11)

The demo's `requestId` is the one finding the platform check did not refute, and it is
about the crash/retry story: an operator that dies mid-send and retries must not start a
second generation.

```powershell
cd durig
$env:DURIG_PROVIDER = "faux"; $env:DURIG_DB = "$PWD\scratch-rid.sqlite"
node cli.mjs up rig.v2.json
node cli.mjs send pm "hello there" --request-id r-1   # reused: false, reply present
node cli.mjs send pm "hello there" --request-id r-1   # reused: true, SAME reply
node cli.mjs log pm 50                                # exactly ONE user entry
```

The third line is the whole feature: the retry reports `"reused": true` and returns the
original reply, and `log` shows one user entry rather than two. Bounds worth checking
while you are there:

- a **different** id is a different request (`reused: false`) — this is why an id is
  never derived from the text, since two deliberate identical sends are two requests
- **no** id changes nothing at all: no `requestId`/`reused` fields, and it generates
- `--request-id` with no value exits 1 with `send --request-id needs a value`
- the id never reaches the prompt

```powershell
node demo/cli.test.mjs
```

The trap uncovered on the way, which is the interesting part: the reply is normally
resolved by scanning for the newest assistant entry *past* a pre-run watermark — that is
the F7 fix, and it is what stops a run that produced nothing from echoing an earlier
send's reply. A **reused** submission inverts that assumption, because its answer was
committed *before* this invocation's watermark: the scan finds nothing and would report
`reply: null` for a request that plainly has a reply. With an id, the submission's own
answer pointer is authoritative; without one, the watermark scan is unchanged. Both
mechanisms are needed because they answer different questions.

That is the third defect in this family (F7, this, and the 24a corrections), which is
recorded in D34 as a pattern: the settle/report path is where durig's subtle bugs live.

Falsified by dropping `requestId` from the submission and watching the test fail with
`the retry must report that it reused the submission`.

## Review recipe — a seat can stop and ask (item 5, 2026-10-11)

Before this, a seat that could not proceed had two options: invent an answer or go
quiet. Both are invisible. MAST puts "no reason to defer to humans" at 6.8%, and the
mechanism durig already assumed — pair review, the Compromise Ledger — was doing it
in prose.

The feature is two halves and both are asserted: the item is **parked** (durable
state, so it cannot be forgotten) and the wait is **visible** (an attention notice,
because prose appears nowhere an operator looks).

```powershell
cd durig
node demo/defer.test.mjs     # drives the real tools on a harness, no database
node demo/watchview.test.mjs # parked rendering + the footer count
```

Nothing to run by hand here: the test uses `MemoryStorage` and scripted faux
responses, so it needs no database, no key and no temp directory.

What the two destinations mean, because they are genuinely different paths:

- **Omit `to` — defer to the human operator.** Nothing is enqueued. The operator's
  channel is `status`/`watch` attention, and `DEFERRED_TO_HUMAN` is a distinct value
  from a seat name so the notice can say *a person* is the blocker. A machine must
  not launder a human decision into seat-to-seat traffic, where it would look
  answered.
- **Pass `to` — ask a seat.** The question is enqueued as real work, so it goes
  through the same org-edge and capability gate as `send_work`. A deferral is a
  send; the shortcut would hand every seat an unlogged channel to any other seat.

`resume_work(itemId)` takes the item back, and `complete_work` still refuses a
deferred item, so a seat cannot finish work it said it could not do. Deferring is a
cycle (`claimed ↔ deferred`), never a one-way exit — an item parked with no way back
would be a silent death, which is worse than the prose it replaces.

Watch it in the dashboard: a seat holding a parked item shows `◌` and
`parked on #1 waiting on human`, and the footer counts it:

```
queue 0 queued · 0 claimed · 0 done · 1 deferred  |  attention: worker deferred_awaiting_answer
```

That footer line is a fix found while building this. It counted only
queued/claimed/done, so a parked item appeared in none of its totals and the footer
read "0 queued, 0 claimed, 0 done" while work sat parked — an idle-looking rig
holding unfinished business. Shown only when non-zero, so rigs that never defer see
the footer they always saw.

Known scope, stated rather than implied: `queue-ageing` measures **queued** items
only, so deferring an item clears its ageing signal. The parked item stays visible
through attention instead. Widening that measure to include parked items is a
separate decision and is not made here.
