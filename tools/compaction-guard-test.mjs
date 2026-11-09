// tools/compaction-guard-test.mjs — the gate for the harness compaction guard.
//
// Runs with no model, no key, no network and no broker (D213): the model call is replaced by a fake
// registry that returns the shapes the real provider returns, including the two shapes that kill a
// session in the harness — a length stop and a provider error.
//
//   node tools/compaction-guard-test.mjs        # ~0.2 s, exit 0 when the guard is sound
//
// What it proves:
//   1. the guard does not touch compaction when the default path is already within budget;
//   2. when it takes over, the prompt handed to the summariser is bounded and says what it dropped;
//   3. the summarization call gets an explicit maxTokens, clamped to what is left of the window;
//   4. the thinking phase is turned off for that call only on adapters that merge samplingParams;
//   5. a length-stopped summary is rescued, not lost;
//   6. a provider error, an empty body, or a throwing provider all end in a deterministic summary —
//      the handler never returns a failure and never throws;
//   7. the stored summary is capped, so carry-forward cannot grow compaction over compaction;
//   8. a fault inside the guard itself is caught and still yields a checkpoint (the guard cannot
//      become the thing that breaks compaction).
import guard from "./compaction-guard-extension.js"; // the tracked source; installed to .pi/extensions/ by tools/compaction-guard-install.mjs
import { DEFAULT_CAPS, buildPrompt, capSummary, deterministicSummary, outputBudget, thinkingOffParams } from "./compaction-guard-core.mjs";

let failures = 0;
function check(name, condition, detail = "") {
	if (condition) console.log(`PASS  ${name}${detail ? "  — " + detail : ""}`);
	else { failures++; console.log(`FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}

const MODEL = { id: "qwen3.8-flash-next-iq3_s", api: "openai-completions", reasoning: true, contextWindow: 204800, maxTokens: 32768 };

function textMessage(role, text) {
	return { role, content: [{ type: "text", text }], timestamp: Date.now() };
}

function makeConversation(turns, fillerLength = 900) {
	const messages = [];
	for (let i = 0; i < turns; i++) {
		messages.push(textMessage("user", `turn ${i}: do the thing`));
		messages.push({
		 role: "assistant",
		 content: [
			{ type: "toolCall", name: "read", arguments: { path: `src/file-${i}.mjs` } },
			{ type: "text", text: "x".repeat(fillerLength) },
			],
		 timestamp: Date.now(),
		});
		messages.push({ role: "assistant", content: [{ type: "toolCall", name: "edit", arguments: { path: `src/file-${i}.mjs` } }, { type: "text", text: "done" }], timestamp: Date.now() });
	}
	return messages;
}

// A fake pi runtime: registers handlers and lets us invoke them directly.
function loadGuard() {
	const handlers = {};
	const api = {
		on: (event, handler) => { handlers[event] = handler; },
		registerCommand: (name, def) => { handlers["command:" + name] = def; },
	};
	guard(api);
	return handlers;
}

const handlers = loadGuard();
const beforeCompact = handlers["session_before_compact"];
const compactFailed = handlers["session_compact_failed"];

check("guard registers session_before_compact", typeof beforeCompact === "function");
check("guard registers session_compact_failed", typeof compactFailed === "function");
check("guard registers /compaction-guard", typeof handlers["command:compaction-guard"]?.handler === "function", Object.keys(handlers).join(", "));

// --- pure logic -------------------------------------------------------------
const big = "y".repeat(200000);
const { prompt, bounded } = buildPrompt({ conversationText: big, previousSummary: "z".repeat(9000), caps: DEFAULT_CAPS });

check("prompt is bounded to inputChars", bounded.text.length <= DEFAULT_CAPS.inputChars + 100 && prompt.length <= DEFAULT_CAPS.inputChars + DEFAULT_CAPS.previousSummaryChars + 1500, `prompt ${prompt.length} chars from ${big.length} chars of conversation`);
check("prompt states what was dropped", prompt.includes("characters of middle context omitted by the guard"), `dropped ${bounded.droppedChars} chars`);

const capped = capSummary("w".repeat(40000), DEFAULT_CAPS);
check("capSummary prunes to summaryChars", capped.summary.length <= DEFAULT_CAPS.summaryChars + 60 && capped.pruned, `${capped.chars} chars -> ${capped.summary.length}`);

const det = deterministicSummary({ conversationText: "[User]: fix the guard\n[Assistant]: [Assistant tool calls]: edit(path=\"src/a.mjs\")\n" + "q".repeat(50000), previousSummary: "p".repeat(30000), caps: DEFAULT_CAPS, reason: "test" });
check("deterministic summary is under the cap", det.summary.length <= DEFAULT_CAPS.summaryChars, `${det.summary.length} chars`);
check("deterministic summary carries sections", det.summary.includes("Guard summary (deterministic fallback)") && det.summary.includes("Last utterances") && det.summary.includes("Files in the summarized span"), det.summary.slice(0, 200).replace(/\n/g, " | "));
check("deterministic summary recovers file paths", det.files.modifiedFiles.includes("src/a.mjs"), det.files.modifiedFiles.join(", "));

check("outputBudget clamps to the window", outputBudget({ contextWindow: 204800, promptChars: 240000, cap: 4000 }) === 4000, "240k chars prompt -> 4000 tokens");
check("outputBudget shrinks when the window is tight", outputBudget({ contextWindow: 8000, promptChars: 24000, cap: 4000 }) === 256, "8k window, 24k chars -> floor 256");
check("thinkingOffParams only for openai-completions reasoning models", thinkingOffParams(MODEL)?.chat_template_kwargs?.enable_thinking === false && thinkingOffParams({ id: "claude", api: "anthropic-messages", reasoning: true }) === undefined);

// --- handler behaviour ------------------------------------------------------
const ctx = { model: MODEL, modelRegistry: null, ui: null };
const preparation = (messages, tokensBefore, previousSummary) => ({
	firstKeptEntryId: "keep-1",
	messagesToSummarize: messages,
	turnPrefixMessages: [],
	isSplitTurn: false,
	tokensBefore,
	previousSummary,
	fileOps: {},
	settings: { enabled: true, reserveTokens: 40960, keepRecentTokens: 24000 },
});

// 1. small span -> hands it back to pi untouched
const small = await beforeCompact({ preparation: preparation(makeConversation(2), 12000, ""), signal: new AbortController().signal, reason: "threshold", willRetry: false, branchEntries: [] }, ctx);
check("small span is left to pi's default path", small === undefined, "guard returned " + String(small));

// 2. big span + healthy model -> bounded, capped summary
const goodRegistry = { complete: async (model, context, options) => ({ role: "assistant", content: [{ type: "text", text: "## Goal\n" + "s".repeat(2000) }], stopReason: "stop", usage: { input: 1000, output: 500, totalTokens: 1500 } }) };
const r2 = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, "p".repeat(9000)), signal: new AbortController().signal, reason: "threshold", willRetry: false, branchEntries: [] }, { ...ctx, modelRegistry: goodRegistry });
check("large span is taken over", r2?.compaction?.details?.guard === true, `span ${r2?.compaction?.details?.spanChars} chars`);
check("summary is under the cap", r2?.compaction?.summary.length <= DEFAULT_CAPS.summaryChars + 60, `${r2?.compaction?.summary.length} chars`);
check("firstKeptEntryId and tokensBefore are carried through", r2?.compaction?.firstKeptEntryId === "keep-1" && r2?.compaction?.tokensBefore === 164105);

// 3. the real failure mode: the provider length-stops the summary
let lastOptions = null;
const lengthRegistry = { complete: async (model, context, options) => { lastOptions = options; return { role: "assistant", content: [{ type: "thinking", thinking: "t".repeat(30000) }, { type: "text", text: "## Goal\npartial summary" }], stopReason: "length", usage: { input: 40000, output: 4000, totalTokens: 44000 } }; } };
const r3 = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, ""), signal: new AbortController().signal, reason: "threshold", willRetry: false, branchEntries: [] }, { ...ctx, modelRegistry: lengthRegistry });
check("length stop does not fail compaction", !!r3?.compaction?.summary, "returned a compaction, not an error");
check("length stop is rescued with the deterministic tail", r3?.compaction?.summary.includes("Guard summary (deterministic fallback)") && r3?.compaction?.summary.includes("partial summary"));
check("the call asked for a bounded output", lastOptions?.maxTokens <= DEFAULT_CAPS.outputTokens, `maxTokens=${lastOptions?.maxTokens}`);
check("the call turned thinking off", lastOptions?.samplingParams?.chat_template_kwargs?.enable_thinking === false);

// 4. provider error -> deterministic fallback, no throw
const errorRegistry = { complete: async () => ({ role: "assistant", content: [], stopReason: "error", errorMessage: "401 missing or wrong API key" }) };
const r4 = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, ""), signal: new AbortController().signal, reason: "overflow", willRetry: true, branchEntries: [] }, { ...ctx, modelRegistry: errorRegistry });
check("provider error still yields a summary", typeof r4?.compaction?.summary === "string" && r4.compaction.summary.length > 0, r4?.compaction?.details?.reason);

// 5. provider throws -> deterministic fallback
const throwRegistry = { complete: async () => { throw new Error("socket terminated"); } };
const r5 = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, ""), signal: new AbortController().signal, reason: "overflow", willRetry: true, branchEntries: [] }, { ...ctx, modelRegistry: throwRegistry });
check("a throwing provider still yields a summary", typeof r5?.compaction?.summary === "string" && r5.compaction.summary.length > 0, r5?.compaction?.details?.reason);

// 6. empty body -> deterministic fallback
const emptyRegistry = { complete: async () => ({ role: "assistant", content: [], stopReason: "stop", usage: { output: 0 } }) };
const r6 = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, ""), signal: new AbortController().signal, reason: "overflow", willRetry: true, branchEntries: [] }, { ...ctx, modelRegistry: emptyRegistry });
check("an empty summary body still yields a checkpoint", typeof r6?.compaction?.summary === "string" && r6.compaction.summary.length > 0);

// 7. the command reports state without throwing
const command = handlers["command:compaction-guard"];
const report = await command.handler("", { getContextUsage: () => ({ tokens: 164105, contextWindow: 204800 }) });
check("/compaction-guard reports caps and history", report.includes("inputChars=") && report.includes("deterministicFallbacks=") && report.includes("fired="), report.split("\n")[2]?.trim());

// 8. the guard's OWN fault cannot break compaction. A model whose registry faults on
//    property access throws inside the handler; the outer try/catch must still hand back a checkpoint.
const faultModel = { ...MODEL, get contextWindow() { throw new Error("registry fault"); } };
let faultResult;
let faultThrew = false;
try {
	faultResult = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, "a".repeat(9000)), signal: new AbortController().signal, reason: "threshold", willRetry: false, branchEntries: [] }, { ...ctx, model: faultModel, modelRegistry: goodRegistry });
} catch (error) {
	faultThrew = true;
	faultResult = null;
}
check("a fault inside the guard does not propagate", !faultThrew, faultThrew ? "handler threw" : "returned a result");
check("the fault path still returns a checkpoint", typeof faultResult?.compaction?.summary === "string" && faultResult.compaction.summary.length > 0, faultResult?.compaction?.details?.reason);

// 9. compaction failure is observed, not swallowed
compactFailed({ reason: "overflow", errorMessage: "Summarization failed: generation hit the token cap and the summary is incomplete", aborted: false, willRetry: true, fromExtension: false }, ctx);

// 10. carry-forward growth is stopped: feed each produced summary back as the next previousSummary, at
// the size observed in the compactions that killed the last session (87,744 chars).
const echoRegistry = { complete: async (model, context, options) => { promptCharsSeen = Math.max(promptCharsSeen, context.messages[0].content[0].text.length); return { role: "assistant", content: [{ type: "text", text: "## Goal\n" + "g".repeat(9000) }], stopReason: "stop", usage: { output: 1200 } }; } };
let carried = "p".repeat(87744);
let promptCharsSeen = 0;
let lastSummary = "";
for (let round = 0; round < 3; round++) {
	const r = await beforeCompact({ preparation: preparation(makeConversation(250), 164105, carried), signal: new AbortController().signal, reason: "threshold", willRetry: false, branchEntries: [] }, { ...ctx, modelRegistry: echoRegistry });
	lastSummary = r?.compaction?.summary ?? "";
	carried = lastSummary;
}
check("summary handed to the summariser stays bounded across rounds", promptCharsSeen <= DEFAULT_CAPS.inputChars + DEFAULT_CAPS.previousSummaryChars + 1500, `largest summarization prompt over 3 rounds: ${promptCharsSeen} chars`);
check("carry-forward does not grow the summary", lastSummary.length <= DEFAULT_CAPS.summaryChars + 60, `after 3 rounds: ${lastSummary.length} chars`);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"} (no model, no network, no broker)`);
process.exit(failures === 0 ? 0 : 1);
