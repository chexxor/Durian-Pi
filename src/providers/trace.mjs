// src/providers/trace.mjs — the request TRACE: show the ACTUAL request body durig sends.
//
// WHY (ROADMAP 43c, operator intent 2026-10-16, items #920/#2545). A user can see the PROGRAMMED
// compat flags (`src/providers/deepinfra-models.ts`) and the RESPONSE-side usage in the transcript
// (`usage.reasoning`, `rawStopReason`, `responseId`), but NOT the wire request. So the operator's
// question — does a DeepSeek seat actually send `thinking:{type:"enabled"}` plus `reasoning_effort`,
// and in which wire type — was unanswerable from inside durig.
//
// WHAT. A provider wrapper that captures the payload pi-ai HANDS TO THE PROVIDER, post-serialization,
// through pi-ai's own `ProviderRequestOptions.onPayload(payload, model)` hook (called in
// `api/openai-completions.js` AFTER `buildParams`, BEFORE the HTTP call). One redacted JSON line per
// model call goes to STDERR — stdout stays the one-JSON-document contract every durig verb keeps.
//
// Off unless `DURIG_TRACE_REQUESTS=1`, so a normal run pays nothing but the wrapper indirection.
//
// Read-only observation: no store write, no new schema, no second writer (D11 / D24). The CLI applies
// this at the ONE provider seam (`cli.mjs` `buildModels`), so every run path — `send`, `up`, `run`,
// `serve`, the optimizer — is covered by the same line and cannot drift.

import { secretSpans } from "../secretredact.mjs";

/** The env seam. Exactly "1" enables tracing; anything else (unset, "0", "true") is OFF. */
export const TRACE_ENV = "DURIG_TRACE_REQUESTS";

/** One trace line is bounded: the point is a readable diagnostic, never a megabyte on stderr. */
export const TRACE_LINE_CAP = 64 * 1024;

/** Field names that carry a credential whatever their value: redacted by NAME, not by shape. */
const AUTH_KEY_RE =
	/^(authorization|api[-_]?key|x-api-key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer|secret|password|client[-_]?secret)$/i;

/** The marker that replaces a secret-shaped value: names the CLASS, never the value — a redaction
 * that echoed the secret would BE the leak it exists to remove. */
const SECRET_MARKER = "[redacted:secret-shaped]";

/** Is tracing on? Read the env at call time so a test (and a shell) can set it per process. */
export function traceEnabled(env = process.env) {
	return String(env?.[TRACE_ENV] ?? "") === "1";
}

/** Replace every secret-shaped token in one string, using the shared span classifier so a secret
 * embedded in prose (a message body, a command line) is caught too, not only a whole-value token. */
function redactString(text) {
	const spans = secretSpans(text);
	if (spans.length === 0) return text;
	let out = "";
	let at = 0;
	for (const span of spans) {
		out += text.slice(at, span.start) + SECRET_MARKER;
		at = span.end;
	}
	return out + text.slice(at);
}

/**
 * Deep-redact a payload before it is printed. Two rules, both conservative:
 * - a key that NAMES a credential (`authorization`, `api_key`, …) is redacted whatever it holds;
 * - any secret-shaped token inside a string is replaced by the marker.
 * Depth-bounded so a cyclic/hostile payload cannot hang the caller.
 */
export function redactPayload(value, depth = 0) {
	if (depth > 12) return "[depth-limit]";
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.map((v) => redactPayload(v, depth + 1));
	if (value && typeof value === "object") {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = AUTH_KEY_RE.test(k) ? "[redacted:credential-field]" : redactPayload(v, depth + 1);
		}
		return out;
	}
	return value;
}

/**
 * The few fields the operator actually asked about, lifted out of the payload so they are readable
 * without hunting through the message array: which max-tokens field was used, whether `store` was
 * sent at all, the role chosen for the system prompt (system vs developer), and the thinking /
 * reasoning_effort pair.
 *
 * "absent" is a real answer here and is reported as such — the whole point of the trace is to
 * distinguish "not sent" from "sent with a default".
 */
export function summarizePayload(payload, model) {
	const p = payload ?? {};
	const maxTokensField =
		"max_tokens" in p
			? "max_tokens"
			: "max_completion_tokens" in p
				? "max_completion_tokens"
				: "absent";
	const systemMessage = Array.isArray(p.messages)
		? p.messages.find((m) => m?.role === "system" || m?.role === "developer")
		: undefined;
	return {
		model: p.model ?? model?.id ?? null,
		api: model?.api ?? null,
		provider: model?.provider ?? null,
		stream: "stream" in p ? p.stream : "absent",
		maxTokensField,
		maxTokens: maxTokensField === "absent" ? "absent" : p[maxTokensField],
		store: "store" in p ? p.store : "absent",
		thinking: "thinking" in p ? p.thinking : "absent",
		reasoningEffort: "reasoning_effort" in p ? p.reasoning_effort : "absent",
		systemRole: systemMessage?.role ?? "absent",
		messageCount: Array.isArray(p.messages) ? p.messages.length : "absent",
		toolCount: Array.isArray(p.tools) ? p.tools.length : "absent",
	};
}

/**
 * Build and write ONE trace line for one model call. Returns the line (so a caller or a test can
 * assert on it without parsing stderr).
 *
 * The payload is included in full when it fits TRACE_LINE_CAP; otherwise the summary is emitted with
 * `truncated: true` and the byte count, because a silently clipped payload would be a lie about what
 * was sent.
 */
export function tracePayload(payload, model, options = {}) {
	const write = options.write ?? ((text) => process.stderr.write(text));
	const seat = options.seat ?? null;
	const redacted = redactPayload(payload);
	const payloadJson = JSON.stringify(redacted);
	const head = {
		trace: "request",
		at: new Date().toISOString(),
		seat,
		...summarizePayload(payload, model),
	};
	const line =
		payloadJson.length <= TRACE_LINE_CAP
			? { ...head, payload: redacted }
			: { ...head, truncated: true, payloadBytes: payloadJson.length };
	const text = `${JSON.stringify(line)}\n`;
	write(text);
	return text;
}

/**
 * Wrap a provider so every model call traces the payload it sends. Returns the provider UNCHANGED
 * when tracing is off, so the off path is a plain identity — no wrapper, no per-call overhead.
 *
 * `onPayload` is chained, not replaced: if the caller (or a future wrapper) already set one, ours
 * runs first and its return value is forwarded, so the trace can never change what is sent.
 *
 * @param {import("@earendil-works/pi-ai").Provider} provider
 * @param {{enabled?: boolean, env?: Record<string,string|undefined>, seat?: string|null, getSeat?: () => (string|null), write?: (text: string) => void}} [options]
 */
export function wrapProviderWithTrace(provider, options = {}) {
	const enabled = options.enabled ?? traceEnabled(options.env);
	if (!enabled) return provider;
	const write = options.write ?? ((text) => process.stderr.write(text));
	const getSeat = options.getSeat ?? (() => options.seat ?? null);
	const traced = (call) => (model, context, opts) => {
		const seat = getSeat();
		const previous = opts?.onPayload;
		const nextOpts = {
			...opts,
			onPayload: async (payload, calledModel) => {
				try {
					tracePayload(payload, calledModel ?? model, { seat, write });
				} catch (err) {
					// A trace failure must never break a generation: report it and continue.
					write(
						`${JSON.stringify({ trace: "request-error", error: String(err?.message ?? err) })}\n`,
					);
				}
				return typeof previous === "function" ? await previous(payload, calledModel) : undefined;
			},
		};
		return call(model, context, nextOpts);
	};
	return {
		...provider,
		stream: traced(provider.stream.bind(provider)),
		streamSimple: traced(provider.streamSimple.bind(provider)),
	};
}
