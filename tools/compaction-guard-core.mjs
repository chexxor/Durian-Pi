// tools/compaction-guard-core.mjs — the pure logic of the harness compaction guard.
//
// WHY THIS EXISTS (measured, not assumed):
// pi-coding-agent's auto-compaction asks the *conversation model* to summarize the span it is about to
// drop, and it gives that request no output budget other than the model's own `maxTokens`. When the span
// is large, the input alone eats the window, the completion is cut at the cap, and pi treats a length
// stop as a hard failure (`getSummarizationFailure` in
// dist/core/compaction/compaction.js:452-461 — "generation hit the token cap and the summary is
// incomplete"). The session then ends with "Auto-compaction failed" / "Context overflow recovery failed"
// and no usable state. On this box the operator saw exactly that on 2026-11-09.
//
// This file holds the parts that need no model and no harness: the caps, the bounded prompt, and the
// deterministic summary used when the model cannot produce one. It is deliberately dependency-free so
// the gate (tools/compaction-guard-test.mjs) runs in well under a second with no provider, no key and
// no broker (D213 fast loop).
//
// The wiring (the `session_before_compact` handler and the model call) lives in
// .pi/extensions/compaction-guard.js.

export const DEFAULT_CAPS = {
	// Characters of serialized conversation handed to the summariser. Chosen so the request stays far
	// inside a 204,800-token window and leaves room for the completion.
	inputChars: 60000,
	// Characters of the previous summary carried into the update prompt. Unbounded carry-forward is what
	// makes summaries grow compaction-over-compaction (observed: 5,204 -> 87,744 chars across 12
	// compactions in one session).
	previousSummaryChars: 6000,
	// Output budget for the summarization call. A summary longer than this is pruned, not lost.
	outputTokens: 4000,
	// Hard ceiling on the summary we store, in characters. Bounds the next compaction's input.
	summaryChars: 12000,
};

/**
 * Root cause, measured on this rig (2026-11-09, Linux Fedora 45, node v24.22.1) against the local
 * model server the delegate uses (`http://127.0.0.1:8080/v1`, api openai-completions, reasoning true):
 *   max_tokens 32, enable_thinking false -> finish_reason "length", completion_tokens 32,
 *   content "GU", reasoning_content 32 tokens.
 *   max_tokens 48, chat_template_kwargs {"enable_thinking": false} -> finish_reason "stop",
 *   completion_tokens 5, content "GUARD-OK", no reasoning_content.
 *   max_tokens 48, reasoning_effort "none" -> finish_reason "stop", completion_tokens 5.
 *   max_tokens 48, thinking_budget 0 -> ignored; the model still reasoned.
 * Reasoning and the answer share one max_tokens budget, so an uncapped thinking phase can consume the
 * entire response. That is exactly how a summarization request "hits the token cap".
 */
export const THINKING_OFF = {
	// qwen chat-template flag, verified above to disable the reasoning phase on this server.
	chat_template_kwargs: { enable_thinking: false },
};

/** Only send thinking-off params to adapters that merge them into the request body. */
export function thinkingOffParams(model) {
	if (!model || !model.reasoning) return undefined;
	if (model.api !== "openai-completions") return undefined;
	return THINKING_OFF;
}

/** Conservative char->token estimate; pi's own estimator is ~4 chars/token. */
export function estimateTokens(chars) {
	return Math.ceil(Math.max(0, Number(chars ?? 0)) / 4);
}

/**
 * The output budget a summarization call can safely use: the model's cap, trimmed to what is left of
 * the context window after the prompt, with a floor so the call never asks for zero tokens.
 */
export function outputBudget({ contextWindow, promptChars, cap, safetyTokens = 2000 }) {
	const MIN = 256;
	const window = Number(contextWindow ?? 0);
	if (window <= 0) return Math.max(MIN, Math.min(cap, 4000));
	const room = window - estimateTokens(promptChars) - safetyTokens;
	return Math.max(MIN, Math.min(cap, room));
}

/** Keep the head and the tail of a long text; the middle is what the summariser can least afford. */
export function boundText(text, maxChars) {
	const s = String(text ?? "");
	if (s.length <= maxChars) return { text: s, truncated: false, droppedChars: 0 };
	const head = s.slice(0, Math.floor(maxChars * 0.25));
	const tail = s.slice(s.length - Math.floor(maxChars * 0.75));
	return {
		text: `${head}\n[... ${s.length - head.length - tail.length} characters of middle context omitted by the guard ...]\n${tail}`,
		truncated: true,
		droppedChars: s.length - head.length - tail.length,
	};
}

/** File paths touched inside the summarized span, recovered without a model call. */
export function extractFileOps(text) {
	const read = new Set();
	const modified = new Set();
	for (const line of String(text ?? "").match(/\[Assistant tool calls\]:.*$/gm) ?? []) {
		for (const m of line.matchAll(/\b(read|edit|write)\(\s*path="([^"]+)"/g)) {
			if (m[1] === "read") read.add(m[2]);
			else modified.add(m[2]);
		}
	}
	return { readFiles: [...read].slice(-40), modifiedFiles: [...modified].slice(-40) };
}

/** Newest utterances in the span — the least lossy thing a no-model summary can carry. */
export function recentUtterances(text, count = 24) {
	return (String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => /^\[(User|Assistant)\]:/.test(l)).slice(-count).map((l) => l.slice(0, 300)));
}

/** Build the summarization prompt with a bounded conversation and a bounded previous summary. */
export function buildPrompt({ conversationText, previousSummary, caps = DEFAULT_CAPS }) {
	const bounded = boundText(conversationText, caps.inputChars);
	const prev = previousSummary ? boundText(previousSummary, caps.previousSummaryChars).text : null;
	const prompt = `${prev ? `<previous-summary>\n${prev}\n</previous-summary>\n\n` : ""}<conversation>\n${bounded.text}\n</conversation>\n\nSummarize the conversation above as a context checkpoint for another model that must continue the work. Use exactly these sections:\n## Goal\n## Constraints & Preferences\n## Progress (Done / In Progress / Blocked)\n## Key Decisions\n## Next Steps\n## Critical Context\nPreserve exact file paths, commands, ids, numbers and error text. Be specific, not narrative. Do not invent anything not present above. Do not call tools.`;
	return { prompt, bounded };
}

/**
 * The summary a compaction gets when the model cannot produce one (length stop, provider error, empty
 * body). Deterministic: no model, no network. It is a checkpoint, not a narrative.
 */
export function deterministicSummary({ conversationText, previousSummary, caps = DEFAULT_CAPS, reason = "model-unavailable" }) {
	// Spend the ceiling in shares so one section cannot swallow the rest: half to the carried-forward
	// summary, the remainder to the utterances and the file list.
	const prevBudget = Math.max(500, Math.floor(caps.summaryChars * 0.5));
	const boundedPrev = previousSummary ? boundText(previousSummary, prevBudget).text : "";
	const files = extractFileOps(conversationText);
	const utterances = recentUtterances(conversationText, 20);
	const sections = [];
	sections.push("## Guard summary (deterministic fallback)");
	sections.push(`Generated without a model call because the summarization request failed (${reason}). It carries the previous summary, the last utterances of the summarized span, and the files it touched — it does not replace a real summary.`);
	if (boundedPrev) {
		sections.push("## Carried-forward summary");
		sections.push(boundedPrev);
	}
	if (utterances.length) {
		sections.push("## Last utterances in the summarized span");
		sections.push(utterances.map((u) => `- ${u}`).join("\n"));
	}
	if (files.readFiles.length || files.modifiedFiles.length) {
		sections.push("## Files in the summarized span");
		if (files.modifiedFiles.length) sections.push(`modified: ${files.modifiedFiles.join(", ")}`);
		if (files.readFiles.length) sections.push(`read: ${files.readFiles.join(", ")}`);
	}
	const summary = sections.join("\n\n");
	if (summary.length <= caps.summaryChars) return { summary, files };
	const marker = "\n[summary pruned by the guard]";
	return { summary: summary.slice(0, Math.max(0, caps.summaryChars - marker.length)) + marker, files };
}

/** Trim a model's summary to the ceiling so the next compaction's input cannot run away. */
export function capSummary(text, caps = DEFAULT_CAPS) {
	const s = String(text ?? "").trim();
	if (s.length <= caps.summaryChars) return { summary: s, pruned: false, chars: s.length };
	return {
		summary: s.slice(0, caps.summaryChars) + "\n[summary capped by the guard: " + (s.length - caps.summaryChars) + " chars dropped]",
		pruned: true,
		chars: s.length,
	};
}
