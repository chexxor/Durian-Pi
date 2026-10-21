> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Review — the two pi-durable example projects (2026-10-11)

The Pi Durable post points at two example projects as the place to learn the API:
a small coding agent (`experimental/durable`) and a vacation planner
(`experimental/vacation`). This is the review of their **source**, which had never
been read.

**Answering the question honestly first:** the *blog post* was read earlier (it is
what settled ROADMAP item 23 — extensions are the registry durig already uses), and
`README.md` cites it. The two **example projects were never reviewed.** A grep across
durig's docs for `experimental/durable`, `experimental/vacation` or `vacation` returned
nothing before this review.

## What was read, and where

Read at **durig's own pin** (`ea448f454af474f3e2fe9733b331e17b0662f5d6`), so this is
the revision durig is validated against rather than whatever `main` says today.

| File | Size | Why it matters |
| --- | --- | --- |
| `durable/README.md` | 3.9 KB | the authors' own account of what the demo shows |
| `durable/harness-setup.ts` | 4.4 KB | harness settings, registry, execution environments, model resolution |
| `durable/runtime.ts` | 14.1 KB | `DurableView` / `DurableController` — the whole architecture |
| `durable/subagent.ts` | 2.6 KB | the foreground-subagent tool |
| `durable/sessions.ts` | 2.0 KB | session directories and the process lock |
| `durable/prompt.ts` | 3.1 KB | pi's system prompt as one extension |
| `durable/main.ts` | 0.6 KB | arguments → open → run → close |
| `vacation/README.md` | 2.8 KB | what differs from the coding agent |
| `vacation/vacation.ts` | 5.9 KB | durable tasks, background subagent, checkpointing, request ids |

Not read: `durable/tui.ts` (25 KB). Its behaviour is described in both READMEs, and
the parts that matter to durig are the view/controller boundary and the command list,
which `runtime.ts` defines. Noted rather than pretended.

## First finding: they are one demo, not two

`durable/main.ts` and `vacation/main.ts` have the **same git blob sha**
(`d3d843d5…`), and so do the two `tui.ts` files (`397b276c…`). The vacation README
says so outright: *"It is a copy of the durable coding agent in `../durable` with the
coding tools and pi's coding prompt replaced by a vacation planner."*

So the genuinely new content is `runtime.ts` (same shape in both) and `vacation.ts`
(the domain: durable tasks with checkpoints). That is a useful thing to know before
budgeting a review: two directory listings, one architecture.

## The architectural claim worth understanding

Both demos rest on one idea, stated in `durable/README.md` as **"One view"**:

> the TUI renders `Conversation.viewState()`, the structural mount of the transcript
> and the built-in documents (`pi.live`, `pi.inbox`, `pi.agent`, `pi.usage`).
> Streaming, tool progress, the queue, retries, compaction status, the model, and
> usage all come from it.

`runtime.ts` enforces it with a stated boundary:

> Everything the TUI renders. Plain values; no Harness objects cross this boundary.

and a closed set of things the UI may ask for:

```ts
export interface DurableController {
  submit(text: string, whenBusy: "steer" | "followUp"): Promise<void>;
  compact(instructions: string | undefined): Promise<void>;
  abort(): Promise<void>;
  cycleThinking(): Promise<void>;
  setModel(model: ModelRef): Promise<void>;
  toggleTasks(): Promise<void>;
  switchConversation(id: ConversationId): Promise<void>;
}
```

That is the whole UI contract. The TUI can read a plain `DurableView` and call those
seven things; it cannot reach into the harness, and it never handles recovery.

## Ideas worth taking

Each idea names where it is visible in the demos, what durig has today, and whether
it transfers. "Partial" is doing real work in this table: the demos are
**single-process by construction** (one process owns the model runtime, the harness,
SQLite and the TUI), while durig is deliberately multi-process — seats in separate
terminals, cross-process polling, file leases (D11, D12, D22). Several of the best
ideas here are the ones that survive that difference.

### 1. `HarnessSettings` — one knob durig could not reach

`harness-setup.ts` builds a settings object with **getters**, read at every use:
stream timeout and retries, compaction, retry policy, steering and follow-up modes.

durig passed no settings before this review. **Correction (2026-10-11): that does NOT
mean it had none**, and the original text here claimed it did. Reading the platform
instead of assuming:

- `resolveSettings` (`dist/harness/agent.js`) merges every field over a built-in
  default — retry (3 attempts, 2 s base delay, 60 s agent delay), compaction (reserve
  16 384 / keep-recent 20 000 tokens), progress intervals, `toolExecution`, both queue
  modes, and `contextRetentionMs` (10 minutes). durig already had all of it.
- the provider path is the **`openai` SDK**, whose own defaults are `maxRetries: 2` and
  `DEFAULT_TIMEOUT = 600000` — a real 10-minute total request timeout. durig could not
  hang forever either, and `openai-completions` sets `timeout` *only* when
  `options?.timeoutMs !== undefined`.
- `stream` is the one field with **no** default: it is spread as `{ ...settings?.stream }`,
  so unset means `{}`.

So the real gap was a **knob, not a hole**: durig could not tune the timeout or the SDK
retries at all. It matters in both directions — `DURIG_MAX_CONCURRENT_SEATS=1` exists so
one slow local model can serve the whole rig, and a generation slower than ten minutes
could not be granted more time; equally an operator may want to fail fast rather than
wait out ten minutes on a stalled endpoint, three durable attempts running.

**Transfers: yes, and it is done** — `DURIG_STREAM_TIMEOUT_MS` now reaches `Harness.open`,
fails loudly on a bad value, and defaults to *nothing* so the platform default stands.

### 2. `harness.resume()` — durig already did this

`runtime.ts` calls `harness.resume()` at startup with the comment *"Recovered work
from an interrupted turn continues now."*

**Correction (2026-10-11): durig already calls it.** `cli.mjs`'s `openHarness` does so,
with the comment *"Persisted storage restarts idle; resume() re-arms task scheduling so
queued work and interrupted runs continue"* and a deliberate exclusion for viewers, so a
passive `watch` cannot kick the very queue it is observing. The original claim that it is
*"never called"* was wrong — wrong because durig's own side was described from memory
while the demo's side was actually read.

What `resume()` does is also narrower than the name suggests: it *"Enable[s] task
scheduling"*, and `TaskScheduler.open()` marks surviving `running` tasks back to
`pending` and **dispatches nothing**. durig has no durable tasks (it never calls
`createTask`/`defineTask`), so it has nothing for the scheduler to resume — calling it is
correct and currently a no-op. It becomes load-bearing with item 24e, which is the honest
place to leave it. The demo's own recovery claim rests on **tasks plus `requestId`s**, not
on `resume()` alone.

**Transfers: already present; no gap.**

### 3. The HTTP dispatcher, which is not optional

`configureHarnessHttp` applies proxy settings, idle timeouts and *"one undici for
fetch"*, with the comment: *"Without it, some provider streams break off."*

durig configures no dispatcher. This is flagged as a **possible live defect, not a
confirmed one** — it needs a spike, and it would present as an occasional truncated
stream that looks like a provider fault. That is exactly the shape of bug that costs
days, so it is worth an hour to rule in or out.

**Transfers: yes — but verify, do not assume.**

### 4. Per-conversation extension selection, with the hazard spelled out

`vacation.ts` gives a subagent only the `search` tool:

```ts
await configure(tx, child.id, { extensions: [Search], instructions: "…" });
```

and `subagent.ts` stops a subagent from delegating further:

```ts
await configure(tx, created.id, { extensions: { remove: [Subagent] } });
// "Starts as a copy of this conversation's agent; without this extension it
// cannot delegate further."
```

This is ROADMAP item 18's mechanism, demonstrated, **including the failure mode**: a
child conversation inherits everything its parent had, so a recursive tool has to be
removed explicitly or subagents recurse.

**Transfers: yes.** It is the idiom item 18 and item 4 both need.

### 5. `requestId` — crash-safe request identity

```ts
const request = { type: "input", content: task.input.task, requestId: `research:${task.id}` };
```

with the comment *"A rerun after a crash gets the same submission back"*, and
separately `requestId: \`research-report:${task.id}\`` so *"Request IDs keep a restart
from sending the request or the report twice."*

durig has no request identity. Its dogfood finding F7 was a settle-logic bug in
exactly this family (a run that produced nothing reported an *older* run's reply), and
a crash-during-send can currently double-deliver. This is the general fix.

**Transfers: yes.**

### 6. Durable tasks with checkpointed phases

`vacation.ts` defines a two-phase task whose state survives a crash:

```ts
defineTask<{ task: string }, ResearchState, null>({
  name: "vacation.research",
  phases: {
    deliver: async (task, runtime, context) => { /* … */ 
      return { status: "running", checkpoint: { phase: "report", report } };
    },
    report: async (task, runtime, context) => { /* … */ },
  },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});
```

The search completes, the checkpoint records the report, and the *second* phase posts
it. Crash between them and the report is not lost. This is the state machine item 12
("workflow task type") and item 6 both need, and it is the pattern our own SITUATION
calls a "durable task" without saying how.

**Transfers: yes, and it is the most substantial idea here.**

### 7. Conversation ownership, background tasks, and cascade abort

The tool creates a task and a conversation owned by it, in one commit:

```ts
const owner = await tx.createTask(Research, { task: args.task },
  { ownership: { kind: "conversation" }, background: true });
const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
```

Because ownership is recorded, aborting the parent aborts what it owns: *"Esc aborts
the shown conversation; aborting the main turn aborts its subagents."*

durig creates seats as `{ ownership: { kind: "ownerless" } }` and has no ownership
model, so aborting a seat does not abort work that seat started. This is the durable
form of the "who is responsible for this runaway" question.

**Transfers: yes.** Note it is a *less* typical need for durig, because durig's
delegation is explicit queue items between seats rather than one agent spawning
children — so this is closer to item 12 than to the core.

### 8. `api.output()` — progress from a long tool

The vacation `search` tool streams as it works:

```ts
api.output(`searching ${args.topic} in ${args.city}: source ${step}/${steps}\n`);
await sleep(2000, undefined, { signal: context.abortSignal });
```

Two things at once: **partial output** so a slow tool does not look hung, and
**honouring `context.abortSignal`** so it is cancellable.

durig's tools return one final string. A seat doing something slow looks stuck, and
`watch` shows nothing until it finishes. Note the coupling: `api.output` is a
streaming affordance that only exists because the demo holds the process open — but
durig already streams generations to stderr via `--stream`, so the transport exists.

**Transfers: partially.** The abortSignal half transfers outright and durig's long
operations (optimizer, model calls) should check it.

### 9. `api.details()` — structured results, not just prose

`subagent.ts` returns `details: { conversationId: child }` alongside the text, so the
view can link to the conversation that produced the answer. durig's tool results are
text only, so no view can point at what did the work — relevant to item 7's peer
navigation graph.

**Transfers: yes, cheaply.**

### 10. Commit subscriptions, with rendering coalesced per burst

`harness.subscribeCommits((publication) => …)` carries typed changes
(`change.type === "conversation" | "entry"`), and the view update coalesces:

```ts
// Commit listeners and Chord frames call this on the Session line; rendering runs
// afterwards, once per burst.
if (notifying) return;
notifying = true;
setImmediate(() => { notifying = false; for (const listener of listeners) listener(); });
```

durig's `watch` polls storage every 750 ms and redraws per poll, because its readers
are **other processes** and commit listeners are in-process only (D11). So the
subscription does not replace the poll — but the **coalescing idea does**: durig
redraws on a timer whether or not anything changed, while this renders once per burst
of real change.

**Transfers: partially** (the coalescing, not the subscription).

### 11. `ExecutionEnvs` — one environment per directory, with an explicit cleanup

`harness-setup.ts` keys `NodeExecutionEnv` by cwd, hands the lookup to the harness as
`env`, and cleans up:

```ts
readonly env = ({ cwd = this.#defaultCwd }: EnvTarget): NodeExecutionEnv => { /* lazy, cached */ };
async cleanup(context: Context) { /* dispose every env */ }
```

This is the M3 wiring (item 4) in ten lines, including the obligation people forget:
something must dispose them. It is the second time this project has discovered that
item 4 is mostly a scope ruling rather than an engineering problem.

**Transfers: yes** — and it is gated on loop #5 (the security ruling) and a
`security.sec` position, because `bash` is arbitrary code execution.

### 12. Prompt sections derived from the *active tool set*

`prompt.ts` builds pi's system prompt from `input.agent.tools`, pulling each tool's
snippet and guidelines, and caches per directory (`Map`) and per request (`WeakMap`).

durig's equivalent is hand-written: `buildSeatPrompt`'s `PROTOCOL` primer. **That is
where the defect this review found lives** — see below. The demo's approach makes the
drift impossible; durig's makes it inevitable.

**Transfers: yes, with a tradeoff** — see ROADMAP item 25.

### 13. Session layout: a timestamped directory, and `--continue` by name sort

`sessions.ts` groups sessions by a **hash of the cwd**, names each session
`<13-digit-ms>-<uuid>`, and `--continue` picks the newest by **sorting directory
names**. No index table, no registry: the filesystem is the index.

durig has one database path per rig and no session concept at all — a rig *is* a
database. So this does not transfer as designed, but the underlying question does:
**durig has no notion of "the same rig, a second conversation"**, and `--continue`
is how a person resumes without remembering a path.

**Transfers: no (by design).** Recorded because it shows a deliberate simplicity we
should not mistake for a gap: not every demo feature is a deficiency in durig.

## Gap analysis

`durig today` is read out of durig's own source, not from memory.

| Idea | durig today | Gap | Action |
| --- | --- | --- | --- |
| `HarnessSettings` | passed no settings before this review; `resolveSettings` and the `openai` SDK supply every default, and `stream` (no default) is now configurable via `DURIG_STREAM_TIMEOUT_MS` | **was:** the timeout and SDK retries could not be tuned at all. **Not** a missing timeout (SDK: 600000 ms) and **not** missing retry/compaction defaults | done |
| `harness.resume()` | **already called** in `cli.mjs`'s `openHarness`, with viewers excluded on purpose | none today: `resume()` enables task scheduling and durig has no tasks | 24e |
| HTTP dispatcher | none configured | *possible* truncated provider streams (unverified) | 24b |
| Per-conversation extensions | every installed extension is active for every seat | no role scoping; recursion hazard | 18, 24c |
| `requestId` | no request identity | a crash or retry during `send` can double-deliver; F7 was this family | 24d |
| Durable tasks with checkpoints | `RigQueue` items with a transition trail only | no phases, no checkpoint, no resume mid-task | 24e, 12 |
| Conversation ownership | seats are `{ kind: "ownerless" }`; `RigQueue` records `from`/`to` | no cascade: aborting a seat does not stop what it started | 24e |
| `api.output()` partials | tools return one final string | a slow tool looks hung | 24f |
| `api.details()` | text-only tool results | no view can point at the conversation that produced a result | 24f, 7 |
| Commit subscription + coalesced render | 750 ms poll, redraw per poll (D11) | redraws with no change; no commit-driven path | 24g |
| `ExecutionEnvs` + `CodingTools` | no tools, no env | M3 entirely | 4, 24c |
| Prompt from the active tool set | hand-written `PROTOCOL` primer | **shipped defect** (2 of 6 tools undocumented) | 25 |

## Patterns worth adopting as rules

1. **A view of plain values, with no harness objects crossing the boundary.** They
   state it in a comment and mean it. `readRigHealth` already returns plain data, so
   durig is close — the value is making it a rule rather than an accident.
2. **A closed controller interface.** The UI may ask for an enumerated set of things
   and nothing else. durig's equivalent is its list of CLI verbs; writing them down as
   *the* interface (rather than however many commands exist) is what makes "the CLI is
   the contract" (D21) checkable.
3. **The view handles no recovery.** *"Nothing in the TUI handles recovery; it only
   renders the conversation view."* One place owns recovery: the runtime. durig
   currently implies this (readers never open a harness) without stating it.
4. **Idempotency by construction, not by care:** `replay: "safe"` **plus** a
   `requestId` **plus** a scan for the already-created child. durig has the first of
   the three.
5. **Settings read through getters at each use,** so a settings change takes effect
   without a restart.
6. **Every exit commits an outcome,** including abort — their `abort` phase writes
   terminal state rather than leaving the task dangling. durig's `deferred` state and
   `last_run_failed` are the same instinct.
7. **Document the invariant next to the fragile line.** *"No Session call may run
   inside a commit"* sits directly above the code that depends on it.
8. **An explicit "Not here:" list.** Both READMEs name what is absent on purpose.
   durig does this too (FEATURES' out-of-scope section) and it is why this review could
   tell a missing feature from a declined one.

## Antipatterns, pitfalls, and hazards

Things to learn from — including things **not** to copy.

1. **Byte-identical files copied between projects.** The two demos share `main.ts`
   and `tui.ts` at the same git blob sha. It is stated honestly ("it is a copy") and
   it is reasonable for a demo, but the copy rots silently as the original moves.
   durig's answer to this is the converter plus pod fragments; the lesson is not to
   solve sharing by copying.
2. **Non-null assertions after a commit that guarantees creation** (`owned!`,
   `child!`). Safe only while an invariant held elsewhere keeps holding, and the
   compiler stops helping at exactly the place that is hardest to test.
3. **Canned data in a demo makes the demo look like a working system.** The vacation
   `search` returns fixed results. This is the hazard durig already fell into and
   documented: faux demos passed while **no seat had any tools**, because the demo
   installed the Router itself and scripted the calls (D16). Worth remembering as a
   recurring shape, not a one-off.
4. **A time-based lock staleness heuristic** (a crashed lock is assumed stale after
   10 s) accepts a lock as broken because time passed. durig's generation slots read a
   **pid** and distinguish `generation_in_flight` from `generation_stale` (D12), which
   is evidence rather than a timeout. This one runs in **durig's favour**, and the
   comparison is worth keeping.
5. **Discovery by sorting directory names.** Cheap and honest, but a clock skew or a
   renamed directory changes which session `--continue` opens, silently.
6. **A mutable closure variable swapped after construction** (`let report = …`
   buffering early events into `pendingReports`). Correct, and subtle enough that the
   ordering is hard to test.
7. **A self-disclosed visibility gap:** *"A turn that ends without an answer shows a
   notice; one recovered after a restart does not, since only submissions made by this
   process are watched."* The demo recovers the work but cannot report the recovery;
   durig reports it but cannot recover. Both halves are real, and the honest lesson is
   that each solves half — which is exactly what ROADMAP item 24a is for.

## Where durig is already ahead

Stated so the gap analysis is not read as a list of failures. These are load-bearing
for durig's actual problem, and the demos do not have them:

- **Cross-process by construction.** The demos assume one process owns the model
  runtime, the harness, storage *and* the UI. durig's seats live in separate terminals,
  read each other's storage, and coordinate through leases (D11, D12, D22). Most UI
  architecture in the demos is therefore not transferable in the first place.
- **Authorization.** Org edges and capability gating mean a seat cannot send where it
  has no edge, and a deferral is gated as a send (D32). The demos have no authorization
  layer: a conversation that has a tool may call it.
- **A constitution the store must actually match.** `check`'s
  `constitution-not-applied` rule exists because durig shipped a rig that declared one
  culture and ran another. The demos have no equivalent check.
- **Measurement, attention and a linter.** `metrics`, the attention vocabulary, and
  `check`'s eight rules have no counterpart here, and the demos' own self-disclosed
  visibility gap is the kind of thing those exist to catch.
- **An audit trail.** Every queue transition is appended, never mutated.
- **Refusals as first-class output.** "Cannot judge" is a value durig reports rather
  than a pass it infers; the demos report what they know and stay quiet otherwise.
- **Dead-pid lease evidence** instead of a 10-second staleness timeout (see hazard 4).

## What this review already fixed

It is not only a gap list. Reading `prompt.ts` made the next question obvious — *does
our own prompt describe our own tools?* — and the answer was no:

> `defer_work` and `resume_work` shipped in item 5, and the `PROTOCOL` primer in
> `cli.mjs` kept describing four tools. **No seat in the real CLI was ever told it
> could defer**, so the feature was unreachable outside the test that drove it
> directly: a green suite over a dead feature.

Fixed, with `demo/primer.test.mjs` holding the prose to the registry **in both
directions** — a registered tool nobody documented fails, and a documented tool
nobody registered fails too. Falsified by deleting one line and watching it fail with
`tool "resume_work" is registered but not in the protocol primer, so no seat would
ever be told it exists`.

That is the review's best argument for existing: the defect was in durig's own source,
six lines from the thing that would have prevented it, and only a comparison against a
project that derives prompts from its registry made it visible.

## Backlog

Recorded as ROADMAP item **24** (with sub-items 24a–24g, each independently takeable
and each naming the file that shows the pattern) and item **25** (prompt from the
registry). Items **4**, **6**, **7**, **12** and **18** are annotated with the demo
evidence rather than duplicated.

What was deliberately **not** turned into work:

- **The TUI.** durig has no `pi-coding-agent` dependency and no interactive screen, by
  decision (D21 non-interactive CLI, D22 seats are not terminals). Reusing pi's
  components would reverse two decisions to make a screen neither needs.
- **A session picker / `--continue`.** A rig *is* a database in durig; a session list
  would be a second identity for the same thing.
- **The view subscription.** In-process only, so it cannot replace the cross-process
  poll (D11). Only its coalescing transfers.
- **`api.output` streaming as a general mechanism.** durig already streams a whole
  generation to stderr; progress from inside one long tool is a smaller, separate
  concern and is scoped as 24f rather than bundled with it.

