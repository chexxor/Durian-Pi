// .pi/extensions/compaction-guard.js — makes auto-compaction on the delegate harness fail-safe.
//
// THE FAILURE IT CLOSES (measured, not assumed).
// 1. pi-coding-agent's auto-compaction asks the *conversation model* to summarize the span it is about
//    to drop and gives that request no output budget other than the model's own maxTokens —
//    node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js,
//    generateSummaryWithUsage (comment: "summaries use the model's output limit (#9512)").
// 2. A length stop on that call is a HARD failure: getSummarizationFailure() in the same file returns
//    "Summarization failed: generation hit the token cap and the summary is incomplete", and
//    agent-session.js prints "Auto-compaction failed: ..." / "Context overflow recovery failed: ...".
//    The session ends with no usable state — what the operator saw on 2026-11-09.
// 3. Why the call hits the cap on this rig, probed directly against the local model server
//    (Linux Fedora 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, model
//    strata/qwen3.8-flash-next-iq3_s, contextWindow 204800, maxTokens 32768, reasoning true):
//      max_tokens 32, enable_thinking false            -> finish_reason "length", completion 32,
//                                                       content "GU", reasoning_content 32 tokens
//      max_tokens 48, chat_template_kwargs enable_thinking=false -> finish_reason "stop",
//                                                       completion 5, content "GUARD-OK", no reasoning
//      max_tokens 48, reasoning_effort "none"         -> finish "stop", completion 5
//      max_tokens 48, thinking_budget 0               -> ignored, the model still reasoned
//    Reasoning and the answer share one max_tokens budget, so an uncapped thinking phase can consume
//    the entire response. pi's default summarization sets no maxTokens and passes the session's
//    thinking level, so a 160k-token span + 32k output limit + a thinking phase is a recipe for a
//    length stop. Carry-forward summaries make it worse: across 12 compactions in the session that
//    died, the summary grew 5,204 -> 87,744 characters, each round feeding the next request.
//
// ONE SENTENCE: bound what the summariser reads, bound what it may write, turn the thinking phase off
// for that call, and if the model still cannot produce a summary, write one deterministically — so
// compaction never fails.
//
// PLANE (D212): this is an extension, not a change to the base harness. It composes with
// npm:@woksin/pi-context-budget (already in .pi/settings.json): when the default path is already
// within budget this handler returns undefined and pi's own compaction runs untouched.
// Pure logic lives in tools/compaction-guard-core.mjs so the gate runs with no model, no key,
// no network and no broker (D213).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";
// THE FILE IS TRACKED IN tools/ AND INSTALLED INTO .pi/ (which is gitignored because it holds
// machine-local provider keys). Resolve the core from wherever the loader actually ran us, so the
// same bytes work from tools/ and from .pi/extensions/.
const core = await import(new URL("./compaction-guard-core.mjs", import.meta.url).href).catch(() => import("../../tools/compaction-guard-core.mjs"));
const {
	DEFAULT_CAPS,
	estimateTokens,
	buildPrompt,
	capSummary,
	deterministicSummary,
	outputBudget,
	thinkingOffParams,
} = core;

export default function (pi) {
	// Caps are tunable per run (used by the gate and by operators tuning a session):
	//   COMPACT_GUARD_INPUT_CHARS / COMPACT_GUARD_PREVIOUS_SUMMARY_CHARS /
	//   COMPACT_GUARD_OUTPUT_TOKENS / COMPACT_GUARD_SUMMARY_CHARS
	const envInt = (name, fallback) => {
		const value = Number(process.env[name]);
		return Number.isFinite(value) && value > 0 ? value : fallback;
	};
	const caps = {
		inputChars: envInt("COMPACT_GUARD_INPUT_CHARS", DEFAULT_CAPS.inputChars),
		previousSummaryChars: envInt("COMPACT_GUARD_PREVIOUS_SUMMARY_CHARS", DEFAULT_CAPS.previousSummaryChars),
		outputTokens: envInt("COMPACT_GUARD_OUTPUT_TOKENS", DEFAULT_CAPS.outputTokens),
		summaryChars: envInt("COMPACT_GUARD_SUMMARY_CHARS", DEFAULT_CAPS.summaryChars),
	};
	const state = {
		fired: 0,
		takenOver: 0,
		modelSummary: 0,
		fallback: 0,
		failuresSeen: 0,
		lastReason: "not yet exercised",
		lastSpanChars: 0,
		lastSummaryChars: 0,
		lastOutputTokens: 0,
		lastElapsedMs: 0,
		log: [],
	};

	const logPath = process.env.COMPACT_GUARD_LOG ?? ".spike/compaction-guard.log.jsonl";
	const writeLog = (entry) => {
		try {
			mkdirSync(dirname(logPath), { recursive: true });
			appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
		} catch {
			/* logging must never break compaction */
		}
	};

	const notify = (ctx, text, level = "info") => {
		try {
			ctx.ui?.notify?.(text, level);
		} catch {
		/* headless mode: no UI, keep going */
		}
	};

	const record = (entry) => {
		state.lastReason = entry.reason;
		state.lastSpanChars = entry.spanChars ?? 0;
		state.lastSummaryChars = entry.summaryChars ?? 0;
		state.lastOutputTokens = entry.outputTokens ?? 0;
		state.lastElapsedMs = entry.elapsedMs ?? 0;
		state.log.push({ ...entry, at: new Date().toISOString() });
		if (state.log.length > 20) state.log.shift();
	};

		const guardFailure = (preparation, reason) => {
		const fallback = deterministicSummary({
			conversationText: "",
			previousSummary: typeof preparation?.previousSummary === "string" ? preparation.previousSummary : "",
			caps,
			reason,
		});
		return {
			compaction: {
				summary: fallback.summary,
				firstKeptEntryId: preparation?.firstKeptEntryId,
				tokensBefore: preparation?.tokensBefore,
				details: { guard: true, reason: "guard-fault-fallback" },
			},
		};
	};

	const summarizationContext = (prompt) => ({
		systemPrompt:
			"You are a context-compaction summarizer. Produce a checkpoint summary for another model that must continue the work. Do not call tools. Do not continue the conversation.",
		messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
	});

	const tryModelSummary = async ({ model, registry, conversationText, previousSummary, attempt, signal }) => {
		const started = Date.now();
		const { prompt } = buildPrompt({ conversationText, previousSummary, caps: { ...caps, inputChars: attempt.inputChars } });
		const maxTokens = outputBudget({
			contextWindow: model.contextWindow ?? 0,
			promptChars: prompt.length,
			cap: attempt.outputTokens,
		});
		const options = {
		maxTokens,
		signal,
		cacheRetention: "none",
		sessionId: uuidv7(),
		};
		const thinking = thinkingOffParams(model);
		if (thinking) options.samplingParams = thinking;
		let sentPayload = null;
		options.onPayload = (payload) => { sentPayload = payload; };

		const response = await registry.complete(model, summarizationContext(prompt), options);
		const text = (response.content ?? [])
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("");
		const sentMaxTokens = sentPayload?.max_tokens ?? sentPayload?.max_completion_tokens ?? null;
		return {
			text,
			usage: response.usage,
			stopReason: response.stopReason,
			error: response.stopReason === "error" ? response.errorMessage || "provider error" : undefined,
			maxTokens,
			sentMaxTokens,
			thinkingOff: sentPayload?.chat_template_kwargs?.enable_thinking === false,
			elapsedMs: Date.now() - started,
		};
	};

	pi.on("session_before_compact", async (event, ctx) => {
		// The guard's own fault must never become the thing that breaks compaction. Everything below is
		// wrapped: if the guard throws, it returns a deterministic checkpoint instead of propagating.
		try {
			return await guardCompaction(event, ctx);
		} catch (error) {
			state.fallback++;
			record({ reason: `guard fault: ${error?.message ?? error}` });
			writeLog({ event: "guard-fault", error: error?.message ?? String(error) });
			notify(ctx, `compaction guard: the guard itself faulted (${error?.message ?? error}); wrote a deterministic checkpoint`, "warning");
			return guardFailure(event.preparation, `guard fault: ${error?.message ?? error}`);
		}
	});

	async function guardCompaction(event, ctx) {
		const preparation = event.preparation;
		if (!preparation) return; // let pi's own path decide
		state.fired++;

		let conversationText = "";
		try {
			const messages = [...(preparation.messagesToSummarize ?? []), ...(preparation.turnPrefixMessages ?? [])];
			conversationText = serializeConversation(convertToLlm(messages));
		} catch (error) {
			// Serialization itself failed; a deterministic summary built from nothing is still better
			// than a failed compaction.
			const fallback = deterministicSummary({ conversationText: "", previousSummary: preparation.previousSummary ?? "", caps, reason: `conversation serialization failed: ${error?.message ?? error}` });
			return {
				compaction: { summary: fallback.summary, firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore, details: { guard: true, reason: "serialization-failed" } },
			};
		}

		const previousSummary = preparation.previousSummary ?? "";
		const model = ctx.model;
		if (!model || !ctx.modelRegistry) return; // nothing to bound; let pi's own path run

		// Case 1: the default path is already safe — bounded input, bounded carry-forward, and the
		// model's own output limit still fits in the window. Do not interfere.
		const defaultRoom = (model.contextWindow ?? 0) - estimateTokens(conversationText.length + previousSummary.length) - (model.maxTokens ?? 0);
		if (conversationText.length <= caps.inputChars && previousSummary.length <= caps.previousSummaryChars && defaultRoom > 0) {
			return;
		}

		state.takenOver++;
		const attempts = [
			{ inputChars: caps.inputChars, outputTokens: caps.outputTokens },
			{ inputChars: Math.min(caps.inputChars, 20000), outputTokens: Math.min(caps.outputTokens, 2000) },
			{ inputChars: 8000, outputTokens: 1000 },
		];

		for (const attempt of attempts) {
			if (event.signal?.aborted) break;
			try {
				const result = await tryModelSummary({ model, registry: ctx.modelRegistry, conversationText, previousSummary, attempt, signal: event.signal });
				if (result.error) {
					record({ reason: `model error: ${result.error}`, spanChars: conversationText.length, attempt, outputTokens: attempt.outputTokens, elapsedMs: result.elapsedMs });
					continue;
				}
				if (result.text.trim()) {
					const capped = capSummary(result.text, caps);
					const summary = result.stopReason === "length"
						? capped.summary + "\n\n" + deterministicSummary({ conversationText, previousSummary, caps, reason: "the summarization call hit its output cap; the tail below is recovered mechanically" }).summary
						: capped.summary;
					state.modelSummary++;
					record({ reason: result.stopReason === "length" ? "length stop, rescued" : "bounded model summary", spanChars: conversationText.length, summaryChars: summary.length, outputTokens: result.maxTokens, usage: result.usage, elapsedMs: result.elapsedMs, attempt });
					writeLog({ event: "summary", compactionReason: event.reason, spanChars: conversationText.length, summaryChars: summary.length, requestedMaxTokens: result.maxTokens, sentMaxTokens: result.sentMaxTokens, thinkingOff: result.thinkingOff, stopReason: result.stopReason, elapsedMs: result.elapsedMs, usage: result.usage });
					return {
						compaction: {
							summary,
							firstKeptEntryId: preparation.firstKeptEntryId,
							tokensBefore: preparation.tokensBefore,
							usage: result.usage,
							details: { guard: true, reason: result.stopReason === "length" ? "length-rescued" : "bounded", spanChars: conversationText.length },
						},
					};
				}
				record({ reason: "empty summary", spanChars: conversationText.length, attempt, outputTokens: attempt.outputTokens, elapsedMs: result.elapsedMs });
			} catch (error) {
				record({ reason: `model call threw: ${error?.message ?? error}`, spanChars: conversationText.length, attempt });
				writeLog({ event: "model-call-error", spanChars: conversationText.length, error: error?.message ?? String(error), attempt });
			}
		}

		// Case 3: no usable model summary. Compaction must still succeed.
		state.fallback++;
		const fallback = deterministicSummary({ conversationText, previousSummary, caps, reason: state.lastReason ?? "model unavailable" });
		record({ reason: `deterministic fallback (${state.lastReason ?? "model unavailable"})`, spanChars: conversationText.length, summaryChars: fallback.summary.length });
		notify(ctx, `compaction guard: the model could not summarize (${state.lastReason ?? "unknown"}); wrote a deterministic checkpoint instead`, "warning");
		return {
			compaction: {
				summary: fallback.summary,
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				details: { guard: true, reason: "deterministic-fallback", spanChars: conversationText.length },
			},
		};
	}

	pi.on("session_compact_failed", async (event, ctx) => {
		state.failuresSeen++;
		record({ reason: `compaction failed: ${event.errorMessage ?? "unknown"} (reason=${event.reason}, fromExtension=${event.fromExtension})` });
		notify(ctx, `compaction guard: compaction failed (${event.reason}) — ${event.errorMessage ?? "unknown"}`, "warning");
	});

	pi.registerCommand("compaction-guard", {
		description: "Report the compaction guard's caps and what it has done this session.",
		handler: async (_args, ctx) => {
			const usage = ctx.getContextUsage?.();
			const lines = [
				"compaction guard (project-local extension, .pi/extensions/compaction-guard.js)",
				`  caps: inputChars=${caps.inputChars} previousSummaryChars=${caps.previousSummaryChars} outputTokens=${caps.outputTokens} summaryChars=${caps.summaryChars}`,
				`  fired=${state.fired} takenOver=${state.takenOver} modelSummaries=${state.modelSummary} deterministicFallbacks=${state.fallback} failuresSeen=${state.failuresSeen}`,
				`  last: ${state.lastReason} | span ${state.lastSpanChars.toLocaleString()} chars -> ${state.lastSummaryChars.toLocaleString()} char summary | output cap ${state.lastOutputTokens} tokens | ${state.lastElapsedMs} ms`,
				`  context now: ${usage?.tokens ?? "?"} / ${usage?.contextWindow ?? "?"} tokens`,
		 ];
			if (state.log.length) lines.push("  recent: " + state.log.slice(-5).map((l) => l.at + " " + l.reason).join(" | "));
			return lines.join("\n");
		},
	});
}

