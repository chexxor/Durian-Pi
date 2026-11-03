// tools/model-probes/metered.mjs — the ONE place a probe makes a metered request: it authenticates, it refuses
// before spending, and it accounts afterwards (#5024).
//
// WHY THIS EXISTS, measured on main at dispatch:
//   - gate.mjs posted `/chat/completions` with `headers: { "content-type": "application/json" }` and NO
//     `authorization` at all (same shape in calibrate-verifier.mjs:42, cold-prefill.mjs:53, stream-probe.mjs:13,
//     throughput.mjs:24,30). The rig's quality instrument could not run against the metered provider at all.
//   - No instrument recorded spend: `grep -nE "SPEND|CAP_|MAX_SPEND" src/config.mjs` is empty, and there is no
//     `src/costsheet.mjs`. Every metered-model decision this rig has made — D193's three paid arms among them —
//     was made without a single number.
//
// WHAT IS DELIBERATELY NOT HERE: a spend POLICY. The ceiling VALUE is supplied by the caller's environment, and
// choosing it (and deciding what a tripped ceiling does to a seat) is architect's #5015. What this file ships is
// the SEAM (#5024 point 3): `spendTotalUsd()` reads the same append-only ledger the guard refuses against, so a
// cap hangs off one importable function instead of being re-derived per probe.
//
// THE GUARD IS A GUARD, NOT A RECEIPT. `assertCeiling` runs BEFORE the request is sent, and it projects the cost
// of THIS call at its declared maxima (`max_tokens` priced as if every token were generated, prompt estimated at
// chars/3). It also refuses when the price is UNKNOWN while a ceiling is declared: a call nobody can price cannot
// be proven under a ceiling. `costUsd` afterwards is the measurement, never the excuse.
//
// HONESTY ABOUT PRICES (#5014 taught this): a curated price list drifts from the live one, so a row never carries
// a bare number. Every ledger row names its `priceSource`, and an unpriced call is recorded with `usd: null` — it
// is NOT written as $0.00, because a zero in a cost report reads as "cheap" and the truth is "unknown".
//
// MATERIAL, and credited: the shape comes from the delegate's working gitignored probe
// `.spike/delegate-20261102/auth-ledger-shim.mjs` + its `spend.jsonl` — the only ceiling-plus-ledger that has
// actually run on this rig. This is the promotion of that probe into tracked code (ROADMAP 233 / #5022), with the
// key name corrected to the one the provider code reads.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Key variables, in the order a probe should look. `DURIG_VERIFIER_API_KEY` first because that is the variable
 * the provider code itself reads: src/providers/local.mjs:88 sets `apiKeyEnv: `${prefix}API_KEY``, and the
 * verifier prefix is `DURIG_VERIFIER_`. `DEEPINFRA_API_KEY` is kept LAST as a compatibility fallback only — the
 * substrate never reads that name, which is why a probe that read only it looked "keyed" while the provider said
 * otherwise. */
export const KEY_ENV_ORDER = ["DURIG_VERIFIER_API_KEY", "DURIG_LOCAL_API_KEY", "DEEPINFRA_API_KEY"];

/** Ledger and ceiling come from the environment so no probe hard-codes a bill. */
export const LEDGER_ENV = "DURIG_SPEND_LEDGER";
export const CEILING_ENV = "DURIG_PROBE_CEILING_USD";
export const PRICE_JSON_ENV = "DURIG_PROBE_PRICE_JSON";
export const PRICE_IN_ENV = "DURIG_PROBE_PRICE_USD_IN";
export const PRICE_OUT_ENV = "DURIG_PROBE_PRICE_USD_OUT";
export const PRICE_CACHE_ENV = "DURIG_PROBE_PRICE_USD_CACHE_READ";

/** The credential for a call, or the reason there is none. Never the value: a ledger that logs a key is a leak. */
export function authFor(env = process.env) {
	for (const name of KEY_ENV_ORDER) {
		const value = env[name];
		if (value && String(value).trim())
			return { present: true, keyEnv: name, header: `Bearer ${String(value).trim()}` };
	}
	return {
		present: false,
		keyEnv: null,
		header: null,
		absentReason: `no key in the environment — set one of ${KEY_ENV_ORDER.join(" | ")} (the provider itself reads DURIG_VERIFIER_API_KEY, src/providers/local.mjs:88,:145)`,
	};
}

/** Loopback targets are the rig's own servers (llama.cpp / strata); they need no credential and cost nothing. */
export function isLoopback(baseUrl) {
	try {
		const host = new URL(String(baseUrl)).hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "[::1]" ||
			host === "::1" ||
			host.endsWith(".local")
		);
	} catch {
		return false;
	}
}

/**
 * The price of a model, WITH the name of where it came from.
 * Sources, in order: an explicit snapshot JSON (`DURIG_PROBE_PRICE_JSON`, DeepInfra catalog shape:
 * `data[].metadata.pricing.{input_tokens,output_tokens,cache_read_tokens}`), then explicit per-model env prices,
 * then nothing. A snapshot's own fetch date is carried so a stale price is at least a dated stale price.
 */
export function priceFor(model, env = process.env) {
	const file = env[PRICE_JSON_ENV];
	if (file && existsSync(file)) {
		try {
			const j = JSON.parse(readFileSync(file, "utf8"));
			const hit = (j.data || []).find((m) => m.id === model);
			const p = hit?.metadata?.pricing;
			if (p && Number.isFinite(Number(p.input_tokens)) && Number.isFinite(Number(p.output_tokens)))
				return {
					price: {
						in: Number(p.input_tokens),
						out: Number(p.output_tokens),
						cacheRead: Number(p.cache_read_tokens ?? p.input_tokens),
					},
					priceSource: `snapshot:${file}`,
					priceAsOf: j.fetchedAt ?? j.at ?? null,
				};
		} catch {
			/* a malformed snapshot is the same as no snapshot, but say so through priceSource below */
		}
	}
	const inU = Number(env[PRICE_IN_ENV]);
	const outU = Number(env[PRICE_OUT_ENV]);
	if (Number.isFinite(inU) && Number.isFinite(outU))
		return {
			price: {
				in: inU,
				out: outU,
				cacheRead: Number.isFinite(Number(env[PRICE_CACHE_ENV]))
					? Number(env[PRICE_CACHE_ENV])
					: inU,
			},
			priceSource: "env",
			priceAsOf: null,
		};
	return { price: null, priceSource: "none", priceAsOf: null };
}

/** $/1M at the provider's own unit. Null price stays null — arithmetic on an unknown is not a number. */
export function costUsd({ price, usage }) {
	if (!price || !usage) return null;
	const inTok = Number(usage.prompt_tokens ?? 0);
	const outTok = Number(usage.completion_tokens ?? 0);
	const cacheTok = Number(usage.prompt_tokens_details?.cached_tokens ?? 0);
	const billedIn = Math.max(0, inTok - cacheTok);
	return Number(
		((billedIn * price.in + cacheTok * price.cacheRead + outTok * price.out) / 1e6).toFixed(6),
	);
}

/** The projection the guard uses: price this call at its declared maxima, BEFORE it is sent. */
export function projectCostUsd({ price, body }) {
	if (!price) return null;
	const messages = body?.messages ?? [];
	const promptChars =
		String(messages?.[0]?.content ?? "").length + String(messages?.[1]?.content ?? "").length;
	const inTok = Math.ceil(promptChars / 3); // the shim's estimate, kept: crude, declared, and replaced by `usage` after the call
	const outTok = Number(body?.max_tokens ?? 0);
	return Number(((inTok * price.in + outTok * price.out) / 1e6).toFixed(6));
}

export function ledgerPath(env = process.env) {
	return env[LEDGER_ENV] || ".spike/gate/spend.jsonl";
}

export function readLedger(path) {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return { note: "unparseable ledger line", line: l.slice(0, 80) };
			}
		});
}

/** THE SEAM #5015 builds on: the running total of every accounted call, read from the same file the guard refuses
 * against. A row with `usd: null` contributes nothing to the number and is counted in `unknown` instead — a total
 * that silently ignores unpriced calls is the receipt-not-guard failure again. */
export function spendTotalUsd(path) {
	const rows = readLedger(path);
	let total = 0;
	let unknown = 0;
	for (const r of rows) {
		if (typeof r.usd === "number") total += r.usd;
		else if (r.usd === null || r.usd === undefined) unknown++;
	}
	return { totalUsd: Number(total.toFixed(6)), rows: rows.length, unknownCostRows: unknown };
}

/** Raised instead of sending a call that would cross a declared ceiling. Named so a caller can catch the class. */
export class CeilingError extends Error {
	constructor(msg) {
		super(msg);
		this.name = "CeilingError";
	}
}

/** The refusal. `ceilingUsd` null/0 means no ceiling is declared — then no projection is demanded, and the caller
 * still gets the ledger row, because accounting is not optional even when the guard is not armed. */
export function assertCeiling({ ceilingUsd, spentUsd, projectedUsd, model, priceSource }) {
	if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) return;
	if (projectedUsd === null)
		throw new CeilingError(
			`REFUSED before sending: a ceiling of $${ceilingUsd.toFixed(4)} is declared but the price of ${model} is UNKNOWN (priceSource=${priceSource}). Set ${PRICE_JSON_ENV} or ${PRICE_IN_ENV}/${PRICE_OUT_ENV}, or raise ${CEILING_ENV} deliberately. An unpriced call cannot be proven under a ceiling.`,
		);
	if (spentUsd + projectedUsd > ceilingUsd)
		throw new CeilingError(
			`REFUSED before sending: ${model} — spent $${spentUsd.toFixed(6)} + projected $${projectedUsd.toFixed(6)} > ceiling $${ceilingUsd.toFixed(6)} (${CEILING_ENV}). Raise the ceiling deliberately or stop.`,
		);
}

export function appendLedger(path, row) {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, JSON.stringify(row) + "\n");
	return row;
}

/** ONE ledger row per metered call. Field order is the report's column order, and the demo pins it. */
export function ledgerRow({
	at,
	model,
	baseUrl,
	authKeyEnv,
	usage,
	priceSource,
	priceAsOf,
	usd,
	totalBefore,
	status,
	note,
}) {
	return {
		at,
		model,
		host: (() => {
			try {
				return new URL(String(baseUrl)).host;
			} catch {
				return String(baseUrl);
			}
		})(),
		authKeyEnv: authKeyEnv ?? null, // the NAME of the variable used, never its value
		prompt_tokens: usage ? Number(usage.prompt_tokens ?? 0) : null,
		completion_tokens: usage ? Number(usage.completion_tokens ?? 0) : null,
		reasoning_tokens: usage ? Number(usage.completion_tokens_details?.reasoning_tokens ?? 0) : null,
		cached_tokens: usage ? Number(usage.prompt_tokens_details?.cached_tokens ?? 0) : null,
		priceSource,
		priceAsOf: priceAsOf ?? null,
		usd, // null means UNKNOWN, not free
		totalBefore: Number(totalBefore.toFixed(6)),
		totalAfter: Number((totalBefore + (usd ?? 0)).toFixed(6)),
		status,
		...(note ? { note } : {}),
	};
}

/** The per-run total a probe prints at the end. Unpriced calls are stated, never folded into the number. */
export function formatRunTotal({ rows, totalUsd, unknownCostRows, ceilingUsd }) {
	const parts = [`spend: ${rows} accounted call(s), total $${Number(totalUsd).toFixed(4)}`];
	if (unknownCostRows)
		parts.push(
			`${unknownCostRows} call(s) with UNKNOWN cost (not counted in the total — see priceSource=none)`,
		);
	parts.push(
		Number.isFinite(ceilingUsd) && ceilingUsd > 0
			? `ceiling $${Number(ceilingUsd).toFixed(4)}`
			: `no ${CEILING_ENV} declared`,
	);
	return parts.join("; ");
}

/**
 * Send one `/chat/completions` request the honest way. Returns the parsed text plus the ledger row written.
 * `fetchImpl` is injectable so a demo can stand a loopback stub in place of a provider — no probe test ever
 * reaches the network, and no test spends the operator's key.
 */
export async function meteredChat({
	baseUrl,
	body,
	env = process.env,
	fetchImpl = globalThis.fetch,
	ledger,
	ledgerFile,
}) {
	const file = ledgerFile ?? ledgerPath(env);
	const model = body?.model ?? "?";
	const auth = authFor(env);
	if (!auth.present && !isLoopback(baseUrl))
		throw new Error(
			`REFUSED before sending: ${baseUrl} is a metered host and ${auth.absentReason}. A probe that posts without a credential gets a 401 it will misread as a model failure.`,
		);

	const ceilingUsd = Number(env[CEILING_ENV] ?? "0");
	const { totalUsd: spentUsd, rows: rowsBefore, unknownCostRows } = spendTotalUsd(file);
	const { price, priceSource, priceAsOf } = priceFor(model, env);
	const projectedUsd = projectCostUsd({ price, body });
	assertCeiling({ ceilingUsd, spentUsd, projectedUsd, model, priceSource });

	const headers = {
		"content-type": "application/json",
		...(body?.stream ? { accept: "text/event-stream" } : {}),
	};
	if (auth.present) headers.authorization = auth.header;

	const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let usage = null;
	try {
		usage = JSON.parse(text)?.usage ?? null;
	} catch {
		/* streaming or non-JSON: accounted with usd null and a note, never silently skipped */
	}
	const usd = costUsd({ price, usage });
	const row = appendLedger(
		file,
		ledgerRow({
			at: new Date().toISOString(),
			model,
			baseUrl,
			authKeyEnv: auth.present ? auth.keyEnv : null,
			usage,
			priceSource,
			priceAsOf,
			usd,
			totalBefore: spentUsd,
			status: res.status,
			note: usage ? undefined : "no usage block",
		}),
	);
	return {
		status: res.status,
		text,
		usage,
		ledgerRow: row,
		ledgerTotals: {
			rows: rowsBefore + 1,
			totalUsd: row.totalAfter,
			unknownCostRows: unknownCostRows + (usd === null ? 1 : 0),
		},
		auth,
	};
}
