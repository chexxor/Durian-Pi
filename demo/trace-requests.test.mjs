// demo/trace-requests.test.mjs — the request TRACE shows the ACTUAL request body (#920 / #2545).
//
// WHY: durig could show the PROGRAMMED compat flags and the RESPONSE-side usage, but never the wire
// request — so "does a DeepSeek seat send thinking:{type:'enabled'} + reasoning_effort, and in which
// wire type" was unanswerable (ROADMAP 43c, operator intent 2026-10-16).
//
// WHAT THIS PROVES (failing-first): with `DURIG_TRACE_REQUESTS=1` the provider wrapper captures the
// payload pi-ai hands to the provider — through pi-ai's REAL `openai-completions` serializer, not a
// stub — and prints one redacted JSON line to stderr. Before the change, `src/providers/trace.mjs`
// does not exist and the import fails (exit 1).
//
// Run: node demo/trace-requests.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as ocApi from "@earendil-works/pi-ai/api/openai-completions";

import { DEEPINFRA_COMPAT, THINKING_LEVEL_MAP } from "../src/providers/deepinfra-models.ts";
import {
	redactPayload,
	summarizePayload,
	traceEnabled,
	TRACE_ENV,
	wrapProviderWithTrace,
} from "../src/providers/trace.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/* ─── fixtures: a DeepInfra DeepSeek model, as src/providers/deepinfra-models.ts builds it ─── */
const MODEL = {
	id: "deepseek-ai/DeepSeek-V4.1-Flash",
	name: "DeepSeek V4.1 Flash",
	api: "openai-completions",
	provider: "deepinfra",
	baseUrl: "https://api.deepinfra.com/v1/openai",
	input: ["text"],
	reasoning: true,
	thinkingLevelMap: THINKING_LEVEL_MAP,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
	compat: { ...DEEPINFRA_COMPAT, thinkingFormat: "deepseek" },
};
const CONTEXT = {
	messages: [
		// A real transcript message carries a `timestamp`: pi-ai's `collapseSystemMessages` drops a
		// system message with no timestamp and no tools, so a timestamp-less fixture would silently
		// exercise a transcript with no system prompt at all.
		{ role: "system", content: [{ type: "text", text: "You are a seat." }], timestamp: 1 },
		{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 2 },
	],
};

// A wire capture: the REAL serializer calls this, so the payload the trace prints is the one that
// would go out. The response is a minimal OpenAI streaming completion.
const SSE = [
	`data: ${JSON.stringify({
		id: "chatcmpl-trace",
		object: "chat.completion.chunk",
		created: 0,
		model: MODEL.id,
		choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
	})}`,
	"",
	`data: ${JSON.stringify({
		id: "chatcmpl-trace",
		object: "chat.completion.chunk",
		created: 0,
		model: MODEL.id,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
	})}`,
	"",
	"data: [DONE]",
	"",
].join("\n");

function captureFetch(wire) {
	return async (url, init) => {
		wire.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(SSE));
				controller.close();
			},
		});
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	};
}

/** A provider whose `stream`/`streamSimple` are pi-ai's REAL openai-completions implementation —
 * the same module `cli.mjs` passes as `api:` to `createProvider`, so the payload traced here is
 * serialized by the production code path, not a stub. */
const realProvider = {
	stream: (model, context, opts) => ocApi.stream(model, context, opts),
	streamSimple: (model, context, opts) => ocApi.streamSimple(model, context, opts),
};

/** Drive one call and return { traceLines, wire, result }. */
async function run({ opts = {}, env = { [TRACE_ENV]: "1" }, seat = "impl" } = {}) {
	const lines = [];
	const wire = [];
	const provider = wrapProviderWithTrace(realProvider, {
		env,
		getSeat: () => seat,
		write: (text) => lines.push(text),
	});
	const inner = provider.stream(MODEL, CONTEXT, {
		apiKey: "test-key",
		...opts,
		fetch: captureFetch(wire),
	});
	let result = null;
	for await (const _ev of inner) {
		/* drain the stream */
	}
	if (typeof inner.result === "function") result = await inner.result();
	return { lines, wire, result };
}

console.log("\n=== the trace is OFF unless DURIG_TRACE_REQUESTS=1 ===");
check("unset env means off", traceEnabled({}) === false);
check("'0' means off", traceEnabled({ [TRACE_ENV]: "0" }) === false);
check("'1' means on", traceEnabled({ [TRACE_ENV]: "1" }) === true);
{
	const off = wrapProviderWithTrace(realProvider, { env: {} });
	check("when off the provider is returned UNCHANGED (no wrapper)", off === realProvider);
}

console.log("\n=== a thinking seat: thinking enabled + reasoning_effort (acceptance 2) ===");
{
	const { lines, wire } = await run({ opts: { reasoningEffort: "high", maxTokens: 512 } });
	check(
		"exactly one trace line was written",
		lines.length === 1,
		`${lines.length}: ${lines.join("")}`,
	);
	const line = JSON.parse(lines[0]);
	check("the trace names the seat", line.seat === "impl", JSON.stringify(line.seat));
	check("the trace names the model", line.model === MODEL.id, JSON.stringify(line.model));
	check(
		"thinking is {type:'enabled'} for a thinking seat",
		line.thinking?.type === "enabled",
		JSON.stringify(line.thinking),
	);
	check(
		"reasoning_effort is present",
		line.reasoningEffort === "high",
		JSON.stringify(line.reasoningEffort),
	);
	check(
		"the reasoning_effort wire type is a STRING level name (acceptance 3)",
		typeof line.reasoningEffort === "string",
		`typeof=${typeof line.reasoningEffort}`,
	);
	check(
		"DeepInfra uses max_tokens, not max_completion_tokens",
		line.maxTokensField === "max_tokens" && line.maxTokens === 512,
		`${line.maxTokensField}=${line.maxTokens}`,
	);
	check(
		"store is NOT sent (DeepInfra compat)",
		line.store === "absent",
		JSON.stringify(line.store),
	);
	check("the system prompt keeps the system role", line.systemRole === "system", line.systemRole);
	check(
		"the FULL payload is on the line (not just the summary)",
		line.payload?.model === MODEL.id && Array.isArray(line.payload?.messages),
		JSON.stringify(line.payload)?.slice(0, 120),
	);
	check(
		"the printed payload IS what the wire carried",
		JSON.stringify(line.payload) === JSON.stringify(wire[0]?.body),
		"trace payload differs from the captured request body",
	);
}

console.log("\n=== a non-thinking seat: thinking disabled, NO reasoning_effort ===");
{
	const { lines } = await run({ opts: { maxTokens: 512 } });
	const line = JSON.parse(lines[0]);
	check(
		"thinking is {type:'disabled'} without a reasoning level",
		line.thinking?.type === "disabled",
		JSON.stringify(line.thinking),
	);
	check(
		"reasoning_effort is ABSENT (not sent)",
		line.reasoningEffort === "absent",
		JSON.stringify(line.reasoningEffort),
	);
}

console.log("\n=== the seat's thinkingLevel drives it (streamSimple, the harness path) ===");
{
	const lines = [];
	const wire = [];
	const provider = wrapProviderWithTrace(realProvider, {
		env: { [TRACE_ENV]: "1" },
		getSeat: () => "impl",
		write: (t) => lines.push(t),
	});
	const inner = provider.streamSimple(MODEL, CONTEXT, {
		reasoning: "high",
		apiKey: "test-key",
		fetch: captureFetch(wire),
	});
	for await (const _ev of inner) {
		/* drain */
	}
	const line = JSON.parse(lines[0]);
	check(
		"thinkingLevel 'high' becomes thinking:{type:'enabled'} + reasoning_effort",
		line.thinking?.type === "enabled" && line.reasoningEffort === "high",
		JSON.stringify({ thinking: line.thinking, effort: line.reasoningEffort }),
	);
}

console.log("\n=== secrets never reach the trace ===");
{
	const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
	const redacted = redactPayload({
		authorization: "Bearer whatever",
		api_key: secret,
		messages: [{ role: "user", content: `key is ${secret} ok` }],
	});
	const text = JSON.stringify(redacted);
	check(
		"an auth-named field is redacted by NAME",
		redacted.authorization === "[redacted:credential-field]",
	);
	check("api_key is redacted", redacted.api_key === "[redacted:credential-field]");
	check(
		"a secret embedded in prose is redacted",
		!text.includes(secret) && text.includes("[redacted:secret-shaped]"),
		text,
	);
}

console.log("\n=== the CLI applies the trace at the ONE provider seam (every run path) ===");
{
	// Structural, but the only honest check available: `buildModels` is the single place every run
	// path (send/up/run/serve) builds the provider stack, and pi-ai's faux provider never calls
	// onPayload, so a behavioural CLI-level check is impossible without a live provider.
	const cli = readFileSync(new URL("../cli.mjs", import.meta.url), "utf8");
	const build = cli.slice(
		cli.indexOf("function buildModels("),
		cli.indexOf("async function openHarness("),
	);
	check("buildModels calls wrapProviderWithTrace", /wrapProviderWithTrace\(/.test(build));
	check(
		"EVERY provider setProvider in buildModels is traced (faux, deepinfra, local)",
		(build.match(/models\.setProvider\(/g) ?? []).length ===
			(build.match(/wrapProviderWithTrace\(/g) ?? []).length &&
			(build.match(/wrapProviderWithTrace\(/g) ?? []).length === 3,
		`setProvider=${(build.match(/models\.setProvider\(/g) ?? []).length} trace=${(build.match(/wrapProviderWithTrace\(/g) ?? []).length}`,
	);
	check("cli.mjs imports the trace module", /from "\.\/src\/providers\/trace\.mjs"/.test(cli));
}

console.log("\n=== the summary alone answers the operator's question ===");
{
	const summary = summarizePayload(
		{ model: MODEL.id, max_tokens: 512, thinking: { type: "enabled" }, reasoning_effort: "high" },
		MODEL,
	);
	check(
		"summarizePayload reports the thinking pair",
		summary.thinking?.type === "enabled" && summary.reasoningEffort === "high",
	);
	check("summarizePayload reports store as absent when unset", summary.store === "absent");
}

assert.ok(true);
console.log(
	failures === 0
		? "\nPASS — the trace prints the real request payload (thinking/reasoning_effort/max_tokens/store/role) to stderr"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
