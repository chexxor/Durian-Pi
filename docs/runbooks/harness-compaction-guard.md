---
runbook: harness-compaction-guard
symptom: "Auto-compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete" in a delegate/interactive pi session
writes: true
precondition: "none (the gate needs no broker, no key, no model); the E2E needs the local model server reachable"
last_verified: 2026-11-09
verified_by: delegate (gate + two E2E runs + a two-extension composition probe, all run on this box 2026-11-09)
evidence: "node tools/compaction-guard-test.mjs (ALL PASS, 28 checks, 0.53 s) + node tools/compaction-guard-e2e.mjs (ALL PASS; 158,764-char span, sentMaxTokens 4000, thinkingOff true, 1,481-char summary, 4.0 s; forced length stop rescued into 7,591 chars) + .spike/probe-compaction-composition.mjs (both extensions loaded, compaction succeeded in 6.9 s with details {guard:true,reason:bounded}) + dist/core/compaction/compaction.js:454,459,495 and dist/core/agent-session.js:2594-2595, dist/core/extensions/runner.js:814-822, read from the shipped 1.3.0 dist 2026-11-09"
check_rule: null
---

# Runbook — the harness compaction guard (auto-compaction must never fail)

**Symptom you are in.** A turn ends with

```
Auto-compaction failed: Summarization failed: generation hit the token cap and the summary is incomplete
Response was truncated before completion
Context overflow recovery failed: Summarization failed: …
```

and the session keeps running with the full context still in it — so the next turn fails the same way, or
overflows. This is what killed the delegate session of 2026-11-09.

**Host for every number here**, measured in the same command as the measurement: **Linux**, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0`.

## 1. What the failure actually is (three facts, each with the line that proves it)

1. **The summarization call gets no output budget.** `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js:495`
   and `:514` — "Unused. Kept for existing callers; summaries use the model's output limit (#9512)". So the request
   is sent with the model's own `maxTokens` (32,768 on this rig's `strata/qwen3.8-flash-next-iq3_s`).
2. **A length stop is a hard failure.** Same file, `getSummarizationFailure()` at `:454`, returning the operator's
   string at `:459`: `"{label} failed: generation hit the token cap and the summary is incomplete"`. The harness
   prints it at `dist/core/agent-session.js:2594-2595` as "Context overflow recovery failed:" / "Auto-compaction failed:".
3. **On this provider the reasoning phase eats the whole response.** Probed directly against the local model server
   (127.0.0.1:8080/v1, api `openai-completions`, reasoning true, contextWindow 204800, maxTokens 32768):
   | request | finish_reason | completion tokens | what came back |
   |---|---|---|---|
   | `max_tokens:32` | **length** | 32 | content `"GU"`, `reasoning_content` 32 tokens |
   | `max_tokens:48`, `chat_template_kwargs {"enable_thinking": false}` | stop | 5 | `"GUARD-OK"`, no reasoning |
   | `max_tokens:48`, `reasoning_effort:"none"` | stop | 5 | works |
   | `max_tokens:48`, `thinking_budget:0` | — | — | **ignored**, the model still reasoned |

   Reasoning and the answer share one `max_tokens` budget. pi's summarization passes the session's thinking level
   (`createSummarizationOptions`) and no explicit cap → a 160k-token span + a thinking phase + a 32k cap is a
   recipe for a length stop. Carry-forward makes it worse: across the 12 compactions of the session that died the
   summary grew 5,204 → 87,744 characters, each round feeding the next request.

## 2. The guard (extension plane, D212 — nothing in the base)

Files: **`tools/compaction-guard-extension.js`** (the wiring, tracked) + **`tools/compaction-guard-core.mjs`**
(pure logic, so the gate runs with no model, no key, no network, no broker — D213). `.pi/` is gitignored by design
(machine-local provider keys, `.gitignore:15`), so the extension is **installed** onto the extension plane rather
than committed there:

```bash
node tools/compaction-guard-install.mjs          # writes .pi/extensions/compaction-guard.js
node tools/compaction-guard-install.mjs --check  # exit 1 if missing or stale
```

Run it once per host/clone. Discovery is measured, not assumed: `.spike/probe-extension-discovery.mjs` lists
`.pi/extensions/compaction-guard.js` as the first loaded extension.

On `session_before_compact` the guard:

1. **Returns undefined** if the default path is already safe — span ≤ `inputChars`, previous summary ≤
   `previousSummaryChars`, and the model's own output limit still fits in the window. pi's own compaction runs
   untouched. This is what makes it compose with `npm:@woksin/pi-context-budget` rather than override it.
2. Otherwise it takes over: **bounds the input** (head 25% + tail 75%, with a printed
   "characters of middle context omitted by the guard" marker), **sets an explicit `maxTokens`** clamped to what
   is left of the window (`outputBudget`, floor 256), **turns the thinking phase off for that call only**
   (`chat_template_kwargs.enable_thinking=false`, sent only when `model.api === "openai-completions"`), and
   **caps the stored summary** (`summaryChars`) so the next compaction's input cannot run away.
3. Three shrinking attempts (60k/4000 → 20k/2000 → 8k/1000 chars/tokens).
4. **A length stop is rescued, not lost**: the partial text plus a deterministic, model-free checkpoint.
5. **A provider error, an empty body, or a thrown call all end in a deterministic summary.** The handler never
   returns a failure.
6. The handler is wrapped in its own try/catch: if the guard itself faults, it returns a deterministic checkpoint
   (`details.reason: "guard-fault-fallback"`). A guard that throws would be caught by the runner
   (`dist/core/extensions/runner.js:826`) and compaction would fall back to pi's failing path — so the safety net
   is part of the fix, not decoration.

Caps are env-tunable per run: `COMPACT_GUARD_INPUT_CHARS`, `COMPACT_GUARD_PREVIOUS_SUMMARY_CHARS`,
`COMPACT_GUARD_OUTPUT_TOKENS`, `COMPACT_GUARD_SUMMARY_CHARS`. Every takeover is logged to
`.spike/compaction-guard.log.jsonl`. `/compaction-guard` prints caps and what the guard has done this session.

## 3. Verify it (fast loop first)

```bash
node tools/compaction-guard-install.mjs --check     # the extension is present and current
node tools/compaction-guard-test.mjs                # ALL PASS, 28 checks, 0.54 s — no model, no key, no broker
node tools/compaction-guard-e2e.mjs                 # real harness + installed extension + real model call
```

The E2E seeds **160 turns** by default, and that number is not arbitrary: `prepareCompaction()` cuts the history
where it has accumulated `keepRecentTokens` (default **20000**, `dist/core/settings-defaults.js:11`) scanning
backwards. A branch under that has nothing to summarise and `compact()` throws `Nothing to compact (session too
small)` (`dist/core/agent-session.js:2221`) — the guard is never reached, and the run reads as a failure. Do not
lower `COMPACT_GUARD_E2E_TURNS`; make the run cheaper with `COMPACT_GUARD_INPUT_CHARS` / `COMPACT_GUARD_OUTPUT_TOKENS`.

Measured on this box (2026-11-09):

| run | config | result |
|---|---|---|
| gate | default caps | **ALL PASS, 28 checks, 0.54 s** |
| E2E A | default caps, 160 seeded turns | ALL PASS; span 158,764 chars, `sentMaxTokens 4000`, `thinkingOff true`, `stopReason "stop"`, output 385 tokens, summary 1,481 chars, `compact()` 4.45 s |
| E2E B | `OUTPUT_TOKENS=256 INPUT_CHARS=30000` | ALL PASS; `stopReason "length"` → **rescued**, summary 7,591 chars, `details.reason: "length-rescued"`, 5.15 s |
| composition probe | both project extensions loaded | compaction succeeded in 6.9 s with `details:{"guard":true,"reason":"bounded","spanChars":155353}` |

The composition probe matters: `dist/core/extensions/runner.js:814-822` keeps the **last non-null** result for
`session_before_*` events, so two extensions that both answer `session_before_compact` cannot both win. Registration
order on this project is `compaction-guard.js` then `@woksin/pi-context-budget` (measured with
`.spike/probe-extension-discovery.mjs`), and the guard's result is the one that landed.

## 4. Scope — which plane this protects

The guard is a **pi-coding-agent extension**: it protects the interactive harness (delegate sessions, `pi` run in
this project). **Seats are a different plane.** pi-durable caps its own summarization output —
`node_modules/@earendil-works/pi-durable/dist/harness/compaction.js` sets
`maxTokens = min(floor(0.8 * policy.reserveTokens), model.maxTokens)` and reports a length stop as "Summarization
hit the token limit; the summary is incomplete". Seat compaction is tuned with `DURIG_COMPACTION_*`
(ROADMAP 331, D250), and a pi-durable `beforeCompact` extension could apply the same bound there — that is an
unclaimed idea, not built here. A pi-durable extension and a pi-coding-agent extension cannot load into each other
(`src/extensions.mjs` header).

## 5. Cost

The gate: 0.54 s, $0, no network. A takeover: one model call; on this box a 60k-char bounded prompt with a 4,000-token
output cap took **3.8–4.5 s** (local server ~83 tok/s prompt, ~156 tok/s generation). No broker, no seat wake.

## 6. Traps learned in this pass

- **The safety net can itself be the bug.** A `srecord(` typo (one missing character) made the deterministic-fallback
  line throw `ReferenceError` — every path through the fallback died, and `node --check` passed because it is a
  runtime reference, not a syntax error. The gate caught it only once the fallback was exercised (checks 4–6). Any
  guard whose happy path never runs is untested.
- **"Compaction succeeded" is not the same as "the guard ran."** Check `details.guard` in the compaction entry; a
  guard that returns undefined is behaving correctly, not silently failing.
- **Do not read `thinking_budget` as "thinking off"** on this server: it is ignored. `chat_template_kwargs.enable_thinking`
  or `reasoning_effort:"none"` are the two that work.
- A `--dry-run` style preview proves nothing here: the guard only reports what it did after a real compaction.
