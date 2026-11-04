// src/providers/spend.mjs — the ONE spend guard at the provider seam (#5047, D-5015.1 option B).
//
// WHY HERE. D-5015.1 ruled the cap is enforced at the PROVIDER seam, not at queue admission, because the seam is
// the only position that cannot drift and the only one that also sees pi-durable's COMPACTION summarization: a
// compaction is a model call at the seat's own model, so it spends money too, and the seat's own `send` path
// knowing its cost is not enough. `buildModels` (`cli.mjs`) builds ONE provider per process for every run path -
// `send`, `up`, `run`, `serve`, the optimizer - and the compaction task resolves its model through the same
// registry, so a wrapper installed beside `wrapProviderWithTrace` covers all of them and cannot be bypassed.
//
// WHAT IT DOES, in order, for one call:
//   1. classify by ENDPOINT (D-5015.3): a loopback server costs nothing, so it is forwarded and NOT ledgered -
//      the ledger is a money record, and a $0 row for a free call is noise that reads as accounting.
//   2. project BEFORE the wire, twice: once from the transcript the harness handed us (so a refusal never even
//      calls the inner provider), and once from the payload pi-ai actually built, through the same `onPayload`
//      hook the trace uses (`src/providers/trace.mjs`) - exact messages, exact `max_tokens`, tool schemas included.
//   3. on a crossing: NOTHING is sent, NO ledger row is written, and the seat gets an assistant message whose
//      `errorMessage` names the cause (`spend_cap_exceeded`), which cap, the cap value, the spent total and the
//      projected line, and the remedy. The message carries the phrase pi-ai's own retry classifier treats as
//      non-retryable, so a money stop does not become three paid attempts (D-5015 F2, probe P7).
//   4. after a metered call that WAS sent: the provider's reported `usage` is costed and appended to the SAME
//      ledger, in the SAME 14-field row format, as the probe path - one ledger, no fork (#5015 §3).
//
// WHY IT IMPORTS `tools/model-probes/metered.mjs`. That file owns the ONE ledger row format, the ONE cheap total
// read (`spendTotalUsd`) and the cap keys (#5024's seam, extended by #5047). Duplicating the row shape here is
// exactly the second-ledger fork the review forbids, so the product path imports the instrument rather than the
// other way round. If the ledger ever moves to `src/`, this import is the line to change.
//
// WHAT IT DOES NOT DO: it never raises a cap, never decides WHICH model to point a seat at (capacity is the
// operator's lever, D201), and does not write to the rig store. The store-side record of a stop is the settled
// submission plus an attention kind, not a ledger row: money to the ledger, stops to store/attention/stderr.

import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import { endpointClass } from "./local.mjs";
import {
	CeilingError,
	appendLedger,
	capsFor,
	costUsd,
	ledgerPath,
	ledgerRow,
	projectRequestUsd,
	spendTotalUsd,
} from "../../tools/model-probes/metered.mjs";

/** The rig's own name for a money stop. Grep-me in src/supervisor.mjs and src/attention.mjs (probe P7). */
export const SPEND_CAUSE = "spend_cap_exceeded";

// The cap values and the ledger path ARE the policy; re-exported from here so the CLI has ONE import for the
// money plane (`capsFor`, `ledgerPath`) instead of reaching into `tools/` from the product entry point. The
// definitions still live in exactly one place: `tools/model-probes/metered.mjs`, the file that owns the row format.
export { capsFor, ledgerPath } from "../../tools/model-probes/metered.mjs";

/** Axis: USD. A projection is a guard input, never a receipt (F9): after the call the provider's `usage` wins. */
export function priceOfModel(model) {
	const cost = model?.cost;
	if (!cost) return null;
	const inU = Number(cost.input);
	const outU = Number(cost.output);
	if (!Number.isFinite(inU) || !Number.isFinite(outU)) return null;
	if (inU === 0 && outU === 0) return null; // no money on this row (loopback, or free by declaration)
	return { in: inU, out: outU, cacheRead: Number.isFinite(Number(cost.cacheRead)) ? Number(cost.cacheRead) : inU };
}

/** Is money possible for this model row? Decided by the ENDPOINT, never by the provider id (D-5015.3). */
export function isMeteredModel(model) {
	return endpointClass(model?.baseUrl) === "metered";
}

/** pi-ai's `Usage` keeps cached tokens OUT of `input`; the ledger's row format is the OpenAI shape, where
 * `prompt_tokens` is the whole prompt and `cached_tokens` a subset. Re-map, do not re-interpret. */
export function usageFromPiUsage(usage) {
	if (!usage) return null;
	const cacheRead = Number(usage.cacheRead ?? 0);
	const input = Number(usage.input ?? 0);
	return {
		prompt_tokens: input + cacheRead,
		completion_tokens: Number(usage.output ?? 0),
		prompt_tokens_details: { cached_tokens: cacheRead },
		completion_tokens_details: { reasoning_tokens: Number(usage.reasoning ?? 0) },
	};
}

/**
 * The refusal decision for one call. `projectedUsd` null means UNPRICED: a call nobody can price cannot be proven
 * under a cap, so with a cap armed it is refused rather than waved through (the #5024 rule, kept).
 *
 * @returns {null | {capKey:string, capUsd:number, spentUsd:number, runSpentUsd:number, projectedUsd:number|null,
 *                    message:string}}
 */
export function refuseCall({ caps, price, projectedUsd, model, spentUsd, runSpentUsd }) {
	if (!caps) return null;
	if (!Number.isFinite(projectedUsd) && !(caps.callUsd || caps.runUsd || caps.storeUsd)) return null;
	if (!Number.isFinite(projectedUsd)) {
		// An unpriced row on a METERED endpoint is the $0 lie again, one layer down: say which price source is
		// missing instead of letting the call run unaccounted.
		const message =
			`${SPEND_CAUSE} (durig's own cap - NOT the provider's): ${model?.provider}/${model?.id} is a metered endpoint with no usable price ` +
			`(priceSource=${model?.priceSource ?? "none"}), a spend cap is armed, and an unpriced call cannot be proven under a cap. ` +
			`Remedy: price the row from a dated source (deepinfra-prices.json / <PREFIX>PRICE_USD_IN|OUT), or declare it free at $0. ` +
			`No request was sent and no ledger row was written.`;
		return { capKey: "price-source", capUsd: null, spentUsd, runSpentUsd, projectedUsd: null, message };
	}
	const parts = [];
	if (caps.callUsd && projectedUsd > caps.callUsd)
		parts.push({ capKey: "DURIG_SPEND_CAP_CALL_USD", capUsd: caps.callUsd, axis: "one call, projected" });
	if (caps.runUsd && runSpentUsd + projectedUsd > caps.runUsd)
		parts.push({ capKey: "DURIG_SPEND_CAP_RUN_USD", capUsd: caps.runUsd, axis: `this process, spent $${runSpentUsd.toFixed(6)}` });
	if (caps.storeUsd && spentUsd + projectedUsd > caps.storeUsd)
		parts.push({ capKey: "DURIG_SPEND_CAP_STORE_USD", capUsd: caps.storeUsd, axis: `this store's ledger, spent $${spentUsd.toFixed(6)}` });
	if (parts.length === 0) return null;
	const named = parts.map((p) => `${p.capKey} $${p.capUsd.toFixed(4)} (${p.axis})`).join("; and ");
	const message =
		`${SPEND_CAUSE} (durig's own cap, out of budget under it - NOT the provider's): ${model?.provider}/${model?.id} projects ` +
		`$${projectedUsd.toFixed(6)} and would cross ${named}. No request was sent and no ledger row was written. ` +
		`Remedy: the OPERATOR raises the named cap deliberately for a named run (a seat may not raise DURIG_SPEND_CAP_STORE_USD - it is the pool), ` +
		`or the seat is pointed at a priced row whose own maximal call exposure is under the cap (a capacity ruling, D201).`;
	return {
		capKey: parts[0].capKey,
		capUsd: parts[0].capUsd,
		spentUsd,
		runSpentUsd,
		projectedUsd,
		message,
	};
}

/**
 * Wrap a provider so every metered call is projected before the wire and ledgered after it.
 *
 * @param {object} provider the pi-ai provider `buildModels` is about to register
 * @param {{caps?: ReturnType<typeof capsFor>, env?: Record<string,string|undefined>, ledger?: string,
 *          getSeat?: () => (string|null), report?: (line: object) => void,
 *          isMetered?: (model: object) => boolean}} [options]
 */
export function wrapProviderWithSpend(provider, options = {}) {
	const env = options.env ?? process.env;
	const caps = options.caps ?? capsFor(env);
	const ledger = options.ledger ?? ledgerPath(env);
	const getSeat = options.getSeat ?? (() => process.env.DURIG_ACTIVE_SEAT ?? null);
	const report = options.report ?? ((line) => process.stderr.write(`${JSON.stringify(line)}\n`));
	// THE TEST SEAM. A demo has to exercise the METERED path, and the alternative to this seam is the oracle suite
	// contacting a metered host - spending money and needing a key. The rig never passes it; the default is the
	// endpoint test, and demo/spend-cap-guard.test.mjs pins `isMeteredModel` directly so the seam cannot be used to
	// hide a locality bug.
	const meteredOf = options.isMetered ?? isMeteredModel;
	// The RUN axis is per process; the STORE axis is the shared ledger. Reading the ledger for the printed total
	// is F6's rule, but a per-process cumulative cannot come from a file every process shares, so it is counted
	// here - and the refusal says so, with the axis named.
	let runSpentUsd = 0;

	const guarded = (call) => (model, context, opts) => {
		const out = new AssistantMessageEventStream();
		const seat = getSeat();
		const metered = meteredOf(model);
		const price = priceOfModel(model);
		let refusal = null;

		const decide = (projected, at) => {
			if (!metered) return null;
			const { totalUsd } = spendTotalUsd(ledger);
			const r = refuseCall({ caps, price, projectedUsd: projected, model, spentUsd: totalUsd, runSpentUsd });
			if (r) report({ spend: "call-refused", at, seat, provider: model?.provider, model: model?.id, cap: r.capKey, capUsd: r.capUsd, spentUsd: r.spentUsd, runSpentUsd: r.runSpentUsd, projectedUsd: r.projectedUsd, priceSource: model?.priceSource ?? (price ? "model-row" : "none"), ledger });
			return r;
		};

		(async () => {
			// (2a) refuse from the transcript BEFORE the inner provider is even called.
			const pre = decide(projectRequestUsd({ price, body: preCallBody(model, context, opts) }), "admission");
			if (pre) return emitRefusal(out, model, pre);

			const previous = opts?.onPayload;
			const nextOpts = {
				...opts,
				onPayload: async (payload, payloadModel) => {
					// (2b) the exact built payload: exact messages, exact max_tokens, tool schemas included.
					const r = decide(projectRequestUsd({ price, body: payload }), "payload");
					if (r) {
						refusal = r;
						// Throwing here is what keeps the bytes off the wire: `onPayload` runs in
						// api/openai-completions.js AFTER buildParams and BEFORE client.chat.completions.create.
						throw new CeilingError(r.message);
					}
					return typeof previous === "function" ? await previous(payload, payloadModel ?? model) : undefined;
				},
			};

			const inner = call(model, context, nextOpts);
			for await (const ev of inner) {
				if (refusal) break; // nothing was sent; a partial event from a call we refused would lie about a run
				out.push(ev);
			}
			if (refusal) return emitRefusal(out, model, refusal);

			const result = typeof inner.result === "function" ? await inner.result() : undefined;
			if (result) {
				ledgerCall({ result, model, price, env, ledger, seat, report, metered, onSettled: (usd) => (runSpentUsd += usd) });
				out.end(result);
			}
			return undefined;
		})().catch((err) => {
			if (refusal) return emitRefusal(out, model, refusal);
			report({ spend: "guard-error", seat, error: String(err?.message ?? err) });
			out.push({ type: "error", reason: "error", error: emptyError(model, `spend guard: ${String(err?.message ?? err)}`) });
			out.end();
		});
		return out;
	};

	return {
		...provider,
		stream: guarded(provider.stream.bind(provider)),
		streamSimple: guarded(provider.streamSimple.bind(provider)),
	};
}

/** A refusal never reaches the wire, so this is the message the seat sees. `stopReason: "error"` with an
 * `errorMessage` pi-ai's retry classifier treats as NON-retryable (pi-ai/utils/retry.js: it matches
 * NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN on "out of budget" and matches no retryable pattern), so the
 * harness settles the run once as `model_error` carrying this detail, instead of spending three times. */
function emitRefusal(out, model, refusal) {
	const message = emptyError(model, refusal.message);
	out.push({ type: "error", reason: "error", error: message });
	out.end(message);
}

function emptyError(model, errorMessage) {
	return {
		role: "assistant",
		content: [],
		api: model?.api ?? "openai-completions",
		provider: model?.provider ?? "unknown",
		model: model?.id ?? "unknown",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

/** The pre-call projection input: the transcript the harness handed us plus the row's own output budget. It is a
 * COARSER input than the built payload (no tool schemas, no serialization), and it exists so a refused call never
 * calls the inner provider at all. */
function preCallBody(model, context, opts) {
	const messages = [...(context?.messages ?? [])];
	// pi-ai puts the system prompt INTO the payload (`resolveTranscript`), so a projection that ignores it
	// under-prices the largest single block of a seat call - the seat's own instructions.
	if (typeof context?.systemPrompt === "string" && context.systemPrompt.length)
		messages.unshift({ role: "system", content: context.systemPrompt });
	return {
		messages,
		// Tool schemas are part of the prompt for a tool-using seat; count them when the caller passed them.
		...(Array.isArray(context?.tools) ? { tools: context.tools } : {}),
		max_tokens: Number(opts?.maxTokens ?? model?.maxTokens ?? 0),
	};
}

/** Money AFTER the call: the provider's reported usage, costed at the row's price, appended as the same 14-field
 * row the probe path writes. A failed call is still accounted (a 4xx that generated tokens still cost money), and
 * an unpriced one is recorded with `usd: null` - never as $0.00. */
function ledgerCall({ result, model, price, env, ledger, seat, report, onSettled, metered }) {
	if (!metered) return; // free by locality: money-less calls stay out of the money record
	const usage = usageFromPiUsage(result?.usage);
	const { totalUsd } = spendTotalUsd(ledger);
	const usd = costUsd({ price, usage });
	const piTotal = Number(result?.usage?.cost?.total);
	const note =
		result?.stopReason === "error"
			? `stopReason=error; ${String(result?.errorMessage ?? "").slice(0, 160)}`
			: usd !== null && Number.isFinite(piTotal) && Math.abs(piTotal - usd) > 0.2 * Math.max(usd, piTotal, 1e-9)
				? `pi-ai computed $${piTotal.toFixed(6)} from the same row; metered.mjs computed $${usd.toFixed(6)}`
				: usage
					? undefined
					: "no usage block";
	try {
		appendLedger(
			ledger,
			ledgerRow({
				at: new Date().toISOString(),
				model: model?.id ?? "unknown",
				baseUrl: model?.baseUrl,
				authKeyEnv: model?.authKeyEnv ?? null, // the NAME of the credential variable, never its value
				usage,
				priceSource: model?.priceSource ?? (price ? "model-row" : "none"),
				priceAsOf: model?.priceAsOf ?? null,
				usd,
				totalBefore: totalUsd,
				status: result?.stopReason === "error" ? "error" : 200,
				note,
			}),
		);
		if (usd) onSettled(usd);
	} catch (err) {
		report({ spend: "ledger-write-failed", seat, ledger, error: String(err?.message ?? err) });
	}
}
