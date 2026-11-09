## Verification note

Everything below was read from `earendil-works/pi` at `main` on 2026-11-09. Line numbers are real file lines for `define.ts`, `compaction.ts`, `context.ts`, and `test/examples/26-plan-mode.ts`. **Four things I could not verify** and have marked as such: `dist/harness/generation.ts` (the build output was not fetched — all hook-ordering facts come from the source package's README, not from call sites), `view.ts` (so I could not locate `resolveHeadEntryId` or `replayView`), a `compacteval` package (no trace in the files I read), and `tool.ts`'s output caps.

Also: the user-supplied signature in item 4 is **out of date**. `compactionPolicy` now takes three arguments, and there *is* a second per-model place to put a policy. Detail in §4.

---

## 1. `defineExtension` — actual signatures

The whole surface is in [`packages/durable/src/harness/define.ts`](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/define.ts), 61 lines total. Every one of these is a **pure identity function** — no side effects, no registry contact. Registration happens only at `registry.install(...)`.

| Export | Signature | File:line |
|---|---|---|
| `defineExtension` | `<Tool extends ToolRegistration = ToolRegistration>(extension: Extension<Tool>): Extension<Tool>` | `src/harness/define.ts:15-19` [^2] |
| `defineTool` | `<TParameters extends object, TDetails extends JsonValue = JsonValue>(tool: ToolRegistration<TParameters, TDetails>)` | `src/harness/define.ts:22-26` [^2] |
| `section` | `(key: string, render: PromptSection<Tool>["render"], options?: { readonly tag?: boolean }): PromptSection<Tool>` | `src/harness/define.ts:29-35` [^2] |
| `hook` | `<K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration` | `src/harness/define.ts:38-40` [^2] |
| `runEndTask` | `<I, S, R, H>(task: Task<I,S,R,H>, input: I): RunEndTask` | `src/harness/define.ts:43-48` [^2] |
| `wrapTool` | `(tool: Tool, wrapper: (tool: Tool) => Tool): Wrap<Tool>` | `src/harness/define.ts:51-53` [^2] |
| `wrapSection` | `(key: string, wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>)` | `src/harness/define.ts:56-60` [^2] |

Two structural facts worth carrying into durian-pi:

- `hook()` binds by **task definition name**, not by task object identity (`.definition.name`, line 39) — so a hook on `"pi.generation"` survives a redefinition.
- `wrapTool`/`wrapSection` bind **by name**, and a wrapper wraps "whichever tool won" after later-extension override [^3].

### Hook timing vs. context assembly

**The seam you're looking for is `sections`, not a hook.** A prompt section renders before *each* request, sees the resolved agent, the environment built for that request, and committed documents [^3]. Sections are written to the transcript as positional `pi.system` entries, and only what changed is re-sent, which preserves provider prompt cache [^3]. A conversation's `instructions` render **last**, as the section named `instructions` [^3].

So there is no special "start of turn" preamble hook and none is needed:

| Need | Mechanism | Ordering guarantee |
|---|---|---|
| Per-conversation preamble | `configure({ instructions })`, or a section from a conversation-selected extension | Rendered per request; `instructions` last; stored as `pi.system` [^3] |
| Rewrite one request's messages | `GenerationTask` `beforeRequest` | Replaces messages of one request only [^3] |
| Rewrite provider body | `beforeProviderRequest` | After message assembly, before dispatch [^3] |
| Post-answer work | `afterTools`, `onYield`, `afterRun` | `afterRun` runs after the answer is committed and inputs settle `done`, never on failure/abort [^3] |

Hooks read committed docs via `api.snapshot()` and raw history via `api.entry()` / `api.entries()`, and **compaction never changes what those return** [^3] — that is the property that makes a durable scratchpad readable across a reset.

The one hook I can show at a real call site is compaction's:

```ts
await runtime.hooks.each("beforeCompact", async (hook) => {
    if (decision === undefined) decision = await hook(compaction, runtime, context);
});
if (decision !== undefined && "decline" in decision) return complete(runtime, context);
if (decision !== undefined) return place(runtime, firstKept, decision.summary, context);
```

— `src/harness/compaction.ts:143-147` [^4]. It runs **after** the cut is selected and the summarized message range is built (lines 131-141), **before** the summarization request is constructed (148-160).

---

## 2. Existing scratchpad / working-memory prior art

The closest prior art is **plan mode**, a first-party example, not a library export: [`packages/durable/test/examples/26-plan-mode.ts`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/26-plan-mode.ts).

| Element | File:line |
|---|---|
| `PlanDoc` — `defineDoc<{ steps: string[] }>`, `kind: "app.plan"`, `scope: "conversation"`, `history: "rewindable"`, `fork: "asOf"` | `test/examples/26-plan-mode.ts:30-38` [^5] |
| `submit_plan` tool — validates `steps`, commits into `PlanDoc`, returns `control: { terminate: true }` | `:40-50` [^5] |
| Section that puts the mode in the prompt | `:52-58` (section at 55-57) [^5] |
| Enable/disable by `configure()` — extension + tool selection only | `:62-64`, `:95`, `:100` [^5] |
| Re-read via `harness.snapshot(PlanDoc, root.id, context)` | `:98` [^5] |

The pattern, which is exactly the one durian-pi wants:

1. **Names** it as a conversation-scoped doc kind `app.plan` (namespaced, non-`pi.` prefix — `pi.` is reserved).
2. **Stores** it in the same commit as everything else (`api.commit(tx => …)`), so it is durable before the tool returns.
3. **Re-reads** it through `snapshot()` / `tx.doc()` — never by re-parsing the transcript.
4. `history: "rewindable"` + `fork: "asOf"` means the note is versioned and a fork inherits the note *as of the fork entry* [^5] — that is precisely "durable working state that survives a context reset", with correct fork semantics for free.

Caveat for reuse: **the doc is not automatically injected into context.** Plan mode injects a *static* section; the stored `steps` are surfaced only by a tool/model action or by a section whose render reads the doc. In Durable, sections and tools read their own docs through `api` or `input.read`, and a section must treat an absent doc as its default [^3].

`test/examples/10-extension-state.ts` is the other referenced prior art for extension-owned state [^3] — I did not read it, so I make no claim about its internals.

---

## 3. Reset / resume / seeding

| Claim | Evidence |
|---|---|
| The model sees entries from the **newest reset onward** | `context.ts:340-342` — `selectActive()` returns `[head, ...range.filter(e => e.head === undefined)]` [^6] |
| A reset is a head marker at itself; heads only move forward | `context.ts:192-193` — *"Heads only move forward: compaction keeps a later entry, a reset starts at itself, an older head is stale"* [^6] |
| A compaction is a head marker `head: firstKept` whose payload is one synthetic user message | `compaction.ts:469-474` [^4] |
| A summary is wrapped, unavoidably, in `<summary>` fences | `compaction.ts:70-72` (`SUMMARY_PREFIX`/`SUMMARY_SUFFIX`), applied at `:468` [^4] |
| A hook may supply the summary body instead of the model | `compaction.ts:143-147`, placed by `place()` `:444-450` [^4] |
| `reset(note)` seeds a new context with a handoff note | README §Reset and Handoff [^3] |
| A tool can force the same via `control: { handoff: "..." }` and the run continues | README §Reset and Handoff [^3] |

**Answer to "can a conversation be seeded with a structured note instead of a summary?" — yes, but only through reset, not through compaction.**

- `reset("We were fixing the flaky login test…")` writes the text as the new context's starting content, with **no summary wrapper** [^3]. This is the only un-wrapped injection point.
- `beforeCompact` returning `{ summary }` gives you authorial control over *content*, but line 468 still wraps it in `The conversation history before this point was compacted…<summary>…</summary>` [^4] — so a hook cannot make compaction emit a structured block (JSON, a task list, a tool-call-shaped message). It emits prose inside a fence.
- `submit({ type: "write", entry: { kind, data } })` appends an entry, but **a write of only `kind` + `data` changes nothing the model sees** [^3]; it needs `model`, `head`, or `edits` to be model-visible, and such a write waits for the next boundary.

Consequence for durian-pi: to survive a reset with a structured note, you must either (a) call `reset(renderedNote)` yourself and own the rendering, or (b) keep the note in a doc and have a section render it fresh on every request — (b) is strictly more robust because it also survives compaction, which (a) does not.

**Not verified:** `resolveHeadEntryId` and `replayView` (named in the question as living in `dist/harness/compaction.js` and `compacteval`). Neither symbol appears in the `compaction.ts` or `context.ts` sources I read; the head-resolution logic I could actually see is `captureContextBounds` → `latestHeadMarker` (`context.ts:25-45`) and `advanceRange` (`context.ts:184-196`) [^6]. I could not fetch `view.ts` or any `compacteval` package, so I cannot confirm or deny their existence or signatures. Treat those two names as unconfirmed.

---

## 4. Compaction policy — the premise is wrong

`compactionPolicy` has **three** parameters now, and the third one *is* the second per-model place:

```ts
export function compactionPolicy(
	settings: Settings,
	model: ModelRef,
	conversation: CompactionSettings | undefined,
): CompactionPolicy {
	const key = `${model.provider}/${model.modelId}`;
	const { modelOverrides, ...harness } = settings.compaction;
	const conversationModel = conversation?.modelOverrides?.[key];
	const layers: readonly (Partial<CompactionPolicy> | undefined)[] = [
		conversationModel,
		modelOverrides?.[key],
		conversation,
	];
	const field = <K extends keyof CompactionPolicy>(name: K): CompactionPolicy[K] =>
		layers.find((layer) => layer?.[name] !== undefined)?.[name] ?? harness[name];
	return {
		enabled: conversationModel?.enabled ?? (conversation?.enabled === false ? false : field("enabled")),
		…
	};
}
```

— `src/harness/compaction.ts:274-295` [^4]

| Layer | Source | Precedence |
|---|---|---|
| 1 | `conversation.modelOverrides["provider/modelId"]` | highest |
| 2 | `settings.compaction.modelOverrides["provider/modelId"]` | |
| 3 | `conversation` (its own flat fields) | |
| 4 | `settings.compaction` (harness-wide, `modelOverrides` stripped) | lowest |

Per-field resolution via `layers.find(...) ?? harness[name]` (line 287-288), with one deliberate exception: a conversation's `enabled: false` beats *everything*, including the harness's model override (line 290) — rationale in the doc comment at 268-273 [^4]. The caller passes `agent.compaction` as the third argument at `:129` [^4], so the conversation layer is live in the `select` phase.

This arrived in commit `922c3ff` on 2026-11-06 ("per-conversation compaction settings"), three days before this query — which is why the two-arg signature is the one in circulation [^1].

**So: there are two per-model places, not one.** Do not key durian-pi's policy config off `settings.compaction.modelOverrides` alone; you will silently lose to a conversation-level override. Note also `DEFAULT_COMPACTION_POLICY` did not appear in `compaction.ts` — resolution is a `??` cascade onto `harness[name]` with no exported default constant in this file. Unverified whether it exists elsewhere.

---

## 5. Upstream payload-bounding mechanisms durian-pi should reuse

| Mechanism | File:line | What it guarantees | Extension seam? |
|---|---|---|---|
| Entry scan paging, `SCAN_PAGE_SIZE = 256` | `src/harness/context.ts:9`, loop at `:323-337` | Whole-context reads never materialize unboundedly; paged by cursor | No — internal, but you get the same primitive |
| `EntryQuery` cursor paging (`scanEntries(query, limit, cursor)`) | `context.ts:332` [^6] | Bounded page + `next` cursor for any transcript read | **Yes** — `api.entries(range, limit, …, ctx)` [^3] |
| Summarizer tool-result cap, `TOOL_RESULT_MAX_CHARS = 2000` | `compaction.ts:68`, applied `:425`, `truncate()` `:438-441` | A single tool result can never dominate a summary prompt; truncation is annotated with the dropped char count | No — hard-coded const, not policy |
| Context size accounting, `estimateContext()` | `compaction.ts:355-370` | Token estimate = newest measured assistant usage + estimates after it + `extra` — reuses provider-reported numbers instead of re-counting | No — internal |
| Cut selection, `selectCut()` | `compaction.ts:303-321` | Never cuts between an assistant's calls and its results (`isCandidate` `:323-343`); refuses a cut that would summarize nothing (`:319-320`) | No — internal |
| View window (newest 50, cap 100, `{ min, max }`) | README §Watching a Conversation [^3] | First value and reconnects never cost the whole transcript | Yes — `watch(context, { min, max })` |
| `ConversationTranscript.loadEarlier()` / `fillGap()` | README §Watching a Conversation | Client-side paging over the window with explicit gap markers | Yes |
| `openBinaryReader()` byte ranges, `openDirReader()` paging, `listFiles({ maxEntries, truncated })` | README §Environment [^3] | Bounded file/dir reads with an explicit `truncated` flag | Yes — custom `ExecutionEnv` |
| Tool output retention: `bash` returns `{ output, truncated, fullOutputPath?, exitCode }`; `api.retainedOutput()` | README §Tools [^3] | Model sees a bounded tail; full text addressable by path | Yes — `afterTool` can reshape |

The strongest reuse candidate for durian-pi is **`EntryQuery` paging + the view window**, because both are already the public contract: a scratchpad reader that pages `api.entries(range, limit, cursor)` gets bounded payloads and a resumable cursor without inventing a scheme, and it reads the **raw** history that compaction never rewrites [^3]. The one genuinely missing primitive is a *per-tool-call output cap with projection* — `TOOL_RESULT_MAX_CHARS` is a private const inside the summarizer, not exposed as policy, so if durian-pi needs "read at most N bytes / project these fields," that is the gap to fill.

---

## Consolidated answer table

| # | Mechanism | file:line | Guarantees | Load an extension into it? |
|---|---|---|---|---|
| 1 | `defineExtension` | `src/harness/define.ts:15-19` | Types an extension; pure identity, zero behavior | n/a — it *is* the entry point |
| 2 | `section(key, render, {tag})` | `define.ts:29-35` | Per-request preamble, re-rendered, cache-preserving | **Yes** — primary preamble seam |
| 3 | `configure({ instructions })` | README §Per-Conversation Agent | Per-conversation preamble, rendered last | Yes |
| 4 | `beforeRequest` / `beforeProviderRequest` | README §Hooks | Replace one request's messages / provider body | Yes |
| 5 | `beforeCompact` | `compaction.ts:143-147` | Decline, or supply summary **body** (still fenced at `:468`) | Yes |
| 6 | `reset(note)` | README §Reset and Handoff | Un-wrapped seed note; only un-fenced injection point | Yes |
| 7 | head-marker selection | `context.ts:340-342`; `:192-193` | Model sees from newest reset forward; heads move forward only | No |
| 8 | `compactionPolicy(settings, model, conversation)` | `compaction.ts:274-295` | 4-layer per-field resolution, 2 model-override layers | **Yes** — conversation layer is configurable |
| 9 | `selectCut` / `isCandidate` | `compaction.ts:303-343` | No cut between calls and results; no empty summary | No |
| 10 | `TOOL_RESULT_MAX_CHARS = 2000` | `compaction.ts:68`, `:438-441` | Bounded tool text in summary source | No — private const |
| 11 | Entry scan paging (256/cursor) | `context.ts:9`, `:323-337` | Bounded transcript reads | Via `api.entries(range, limit, cursor)` |
| 12 | `PlanDoc` + `submit_plan` | `test/examples/26-plan-mode.ts:30-50` | Durable, rewindable, fork-aware per-conversation note | **Yes** — copy this shape |
| 13 | Doc re-read (`snapshot` / `tx.doc` / `input.read`) | `26-plan-mode.ts:98`; README §Your Own State | State read from store, never re-parsed from transcript | Yes |
| 14 | `resolveHeadEntryId`, `replayView`, `compacteval` | **not found** | — | Unverified; absent from the sources read |

**References**

[^1]: [pi/packages/durable/src/harness at main · earendil-works/pi · GitHub](https://github.com/earendil-works/pi/tree/main/packages/durable/src/harness) (51%)
[^2]: [raw.githubusercontent.com](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/harness/define.ts) (10%)
[^3]: [pi/packages/durable/README.md at main · earendil-works/pi · GitHub](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) (10%)
[^4]: [raw.githubusercontent.com](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/harness/compaction.ts) (10%)
[^5]: [raw.githubusercontent.com](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/test/examples/26-plan-mode.ts) (10%)
[^6]: [raw.githubusercontent.com](https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/harness/context.ts) (10%)
