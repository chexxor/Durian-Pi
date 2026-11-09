// Locally-served, OpenAI-compatible providers.
//
// durig builds ONE default provider per process, so a seat can only use a local server if a provider is
// registered ALONGSIDE the default and the seat names it as "<provider>/<id>"; src/seatmodel.mjs reads the
// provider prefix only when that provider is actually registered, so every other seat keeps the default
// provider and no paid API is needed for a local one.
//
// THERE ARE NOW TWO OF THEM, AND THAT IS THE POINT (2026-10-27). All 12 seats moved to one local model to
// get off a 402, which made the cross-family author/verifier invariant (D48/D119) unmeetable - `check`
// reports `single-model-rig`, fix-now: "all 12 seats resolve to local/iq3_s, so a shared blind spot is
// systemic". A second family is now served on the second GPU, so author seats run `local/<id>` and verifier
// seats run `verifier/<id>`.
//
// THE THIRD PREFIX (#5648, 2026-11-08). A second BOX on the LAN (192.168.1.52:8080) sits idle while the first
// box carries every seat, so throughput is gated on registration, not on hardware: `DURIG_LOCAL2_*` was
// written into `~/.config/durig/env` and was inert, because `src/seatmodel.mjs` resolves a seat's provider
// ONLY from a prefix that is registered here. Measured on the box itself, so the values below are not guesses:
// `GET /v1/models` serves `qwen3.8-flash-next-q2_0` with `meta.n_ctx 131072` and
// `architecture.input_modalities ["text"]` (text-only); `GET /props` reports `total_slots 4` and
// `modalities.vision false`. AND A WRONG ID IS INVISIBLE AT THE WIRE: a completion asked for
// `this-model-does-not-exist-abc123` returned 200 with `"model": "qwen3.8-flash-next-q2_0"` and
// `finish_reason: "stop"` - llama.cpp/Strata reroutes an unknown id to whatever is loaded. So the provider
// prefix is the ONLY place a stale model id can fail, and it fails by never resolving, not by erroring.
//
// WHY THIS MODULE OWNS THE ID SET. Two consumers used to compare a seat's provider to the literal string
// "local" (`src/broker.mjs` for the D105 between-items context reset, `src/readapi.mjs` for the declared
// context window). With a second local provider both would have silently EXCLUDED it: the verifier seat
// would never reset its context and would drift into the compaction wall while looking healthy, and its
// window would be absent from any capacity read. "Which providers are locally served" is a question this
// module can answer definitively, because it is the only place those providers are built - so it answers it
// here, and the consumers ask. Being a STATIC set is safe rather than sloppy: `resolveSeatModel` assigns a
// prefix only when the provider is registered, so an unconfigured `verifier/...` seat resolves to the
// default provider and never carries this id at all.
//
// WHAT THIS DOES NOT PROVE. A distinct provider id is not a distinct MODEL FAMILY. `src/checkup.mjs`
// compares resolved model strings, so a second quantization of the same model would clear `single-model-rig`
// while leaving the invariant false - which is a green check lying about a security property. The family
// question is a documentation ruling (docs/DECISIONS.md, ROADMAP 189), not something a test can settle.
//
// Off unless the base URL names a server: no config, no provider, behaviour exactly as before.

import { existsSync, readFileSync } from "node:fs";

export const LOCAL_PROVIDER_ID = "local";
export const VERIFIER_PROVIDER_ID = "verifier";

/** Env/config key prefixes. The provider id is DERIVED from the prefix, so the two can never drift apart. */
export const LOCAL_ENV_PREFIX = "DURIG_LOCAL_";
export const VERIFIER_ENV_PREFIX = "DURIG_VERIFIER_";
/** A third locally-served OpenAI-compatible server, on its own host (#5648). The name says BOX, not family:
 * `local2` is whatever model that box serves, and the id is still derived from the prefix below. */
export const LOCAL2_ENV_PREFIX = "DURIG_LOCAL2_";

/** Registration order: authors first, verifiers second, the spare box last. */
export const LOCAL_ENV_PREFIXES = [LOCAL_ENV_PREFIX, VERIFIER_ENV_PREFIX, LOCAL2_ENV_PREFIX];

/** The ids this module can build - DERIVED from the prefix list, never enumerated. A hand-written id list is
 * how a registered prefix becomes a silently EXCLUDED provider: `broker.mjs` (the D105 between-items context
 * reset) and `readapi.mjs` (the declared window) both ask this set, so an id missing here means a genuinely
 * local seat is treated as remote - it never resets its context and its window reads as unknown. Derivation
 * makes that state unreachable: you cannot register a prefix without its id appearing here.
 * See the note above on why a static set is sound. */
export const LOCAL_PROVIDER_IDS = LOCAL_ENV_PREFIXES.map(providerIdForPrefix);

/** Is this provider locally served (free context, cheap reset, no paid API)? */
export function isLocalProviderId(id) {
	return typeof id === "string" && LOCAL_PROVIDER_IDS.includes(id);
}

/**
 * LOCALITY IS A PROPERTY OF THE ENDPOINT, NOT OF THE PROVIDER ID (D-5015.3).
 *
 * The id `local`/`verifier` says who BUILT the provider, not what it costs. A `verifier/<id>` seat pointed at
 * `https://api.deepinfra.com/v1/openai` is a PAID call wearing a free-class name: it would be registered with
 * `cost {0,0,0}` (so every cost read lies) and authenticated with the loopback placeholder (so it eats a 401
 * that reads as a model failure). `local.mjs` did exactly that. So the question asked here is the only one that
 * can be answered truthfully - what host is this URL - and the answer decides whether money is involved.
 */
export function isLoopbackBaseUrl(baseUrl) {
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
		// An unparseable URL is not proven free, so it is NOT loopback. Fail toward treating it as metered.
		return false;
	}
}

/** The two endpoint classes. Axis: money. `metered` means "a row for this endpoint must carry a price". */
export function endpointClass(baseUrl) {
	return isLoopbackBaseUrl(baseUrl) ? "loopback" : "metered";
}

/** The credential a LOOPBACK server gets when its key variable is unset. It is a placeholder because a keyless
 * llama.cpp / strata server accepts anything and pi-ai rejects an empty string (docs/incidents/
 * 2026-10-18-local-provider-empty-key.md), and it is scoped to loopback on purpose: against a metered host the
 * same trick is a 401 that the rig misreads as a model failure (#5015 P9). */
export const LOOPBACK_PLACEHOLDER_KEY = "no-key-required";

/**
 * The DECLARED price of a metered endpoint, with its source. `0` is a legitimate declared price (a LAN-served
 * free model is free BY DECLARATION); an ABSENT price is not a price - it is the absence the guard exists for.
 * Keys, in order: `<PREFIX>PRICE_USD_IN` / `<PREFIX>PRICE_USD_OUT` / `<PREFIX>PRICE_USD_CACHE_READ`, then a
 * dated catalog snapshot in `<PREFIX>PRICE_JSON` or the shared `DURIG_PRICE_JSON` (DeepInfra catalog shape,
 * `data[].metadata.pricing`, stamped `fetchedAt`). No third vocabulary: the caps keep their own keys and prices
 * keep these.
 */
export function declaredPrice(cfg, spec) {
	const prefix = spec?.prefix ?? LOCAL_ENV_PREFIX;
	const inU = Number(cfg?.[`${prefix}PRICE_USD_IN`]);
	const outU = Number(cfg?.[`${prefix}PRICE_USD_OUT`]);
	if (Number.isFinite(inU) && Number.isFinite(outU) && inU >= 0 && outU >= 0) {
		const cacheU = Number(cfg?.[`${prefix}PRICE_USD_CACHE_READ`]);
		return {
			price: { in: inU, out: outU, cacheRead: Number.isFinite(cacheU) && cacheU >= 0 ? cacheU : inU },
			priceSource: `${prefix}PRICE_USD_IN/OUT`,
			priceAsOf: cfg?.[`${prefix}PRICE_AS_OF`] ?? null,
		};
	}
	for (const key of [`${prefix}PRICE_JSON`, "DURIG_PRICE_JSON"]) {
		const file = cfg?.[key];
		if (!file || !existsSync(file)) continue;
		try {
			const j = JSON.parse(readFileSync(file, "utf8"));
			const hit = (j.data ?? []).find((m) => m.id === spec.modelId);
			const p = hit?.metadata?.pricing;
			if (!p || !Number.isFinite(Number(p.input_tokens)) || !Number.isFinite(Number(p.output_tokens))) continue;
			return {
				price: {
					in: Number(p.input_tokens),
					out: Number(p.output_tokens),
					cacheRead: Number.isFinite(Number(p.cache_read_tokens)) ? Number(p.cache_read_tokens) : Number(p.input_tokens),
				},
				priceSource: `snapshot:${file}`,
				priceAsOf: j.fetchedAt ?? j.at ?? null,
			};
		} catch {
			continue; // an unreadable snapshot is no snapshot; the refusal below names the source that was tried
		}
	}
	return { price: null, priceSource: "none", priceAsOf: null };
}

function providerIdForPrefix(prefix) {
	return prefix.slice("DURIG_".length).replace(/_$/, "").toLowerCase();
}

function labelForPrefix(prefix) {
	const id = providerIdForPrefix(prefix);
	return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Read one local provider's settings from the effective config, or null when it is off.
 * Pure: it decides nothing about pi-ai, so it is unit-testable.
 *
 * @param {Record<string, unknown>} cfg effective config (env > file > defaults)
 * @param {string} [prefix] which provider, e.g. VERIFIER_ENV_PREFIX
 * @returns {{id: string, prefix: string, baseUrl: string, endpoint: "loopback"|"metered",
 *            modelId: string, contextWindow: number, maxTokens: number, apiKeyEnv: string,
 *            price?: {in:number,out:number,cacheRead:number}|null, priceSource?: string, priceAsOf?: string|null} | null}
 */
export function localProviderSpec(cfg, prefix = LOCAL_ENV_PREFIX) {
	const baseUrl = cfg?.[`${prefix}BASE_URL`];
	if (!baseUrl) return null;
	const id = providerIdForPrefix(prefix);
	const contextWindow = Number(cfg[`${prefix}CONTEXT`] ?? 65536);
	// The output budget is per provider, not a constant. Measured on the live verifier endpoint: a thinking
	// model spent 61 of its 94 completion tokens on REASONING for a one-line prompt. A model that reasons
	// before it answers, capped at a budget meant for one that does not, gets truncated MID-THOUGHT and
	// returns a confident half-verdict - the worst possible failure for a seat whose job is to say "no".
	const maxTokens = Number(cfg[`${prefix}MAX_TOKENS`] ?? 8192);
	const endpoint = endpointClass(baseUrl);
	const priced = endpoint === "metered" ? declaredPrice(cfg, { prefix, modelId: String(cfg[`${prefix}MODEL`] ?? id) }) : null;
	return {
		id,
		prefix,
		endpoint,
		baseUrl: String(baseUrl),
		modelId: String(cfg[`${prefix}MODEL`] ?? id),
		// A NaN here would travel as the ADVERTISED capacity and mis-report it, so fall back rather than
		// accept a malformed override. Same rule for the output budget.
		contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 65536,
		maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8192,
		// Each server gets its OWN key variable: two local servers can hold different credentials, and naming
		// the variable in the resolved source is what makes a missing key diagnosable instead of mysterious.
		apiKeyEnv: `${prefix}API_KEY`,
		// A metered endpoint carries its DECLARED price on the spec, so the registered row and every ledger row can
		// name where the number came from (F8: an undated price is an undated claim). A loopback endpoint has NO
		// price field at all: its free-ness is a property of the endpoint, not a claim about a vendor's price list.
		...(priced ? { price: priced.price, priceSource: priced.priceSource, priceAsOf: priced.priceAsOf } : {}),
	};
}

/** Every configured local provider, in registration order. Empty when none is configured. */
export function localProviderSpecs(cfg) {
	return LOCAL_ENV_PREFIXES.map((prefix) => localProviderSpec(cfg, prefix)).filter(Boolean);
}

/**
 * The context window DECLARED for a seat that names a locally-served provider.
 *
 * A local seat's window lives in config, not in `DURIG_CONTEXT_WINDOW`, so the generic
 * `declaredContextWindow` misses it. It is a genuine DECLARATION, so it belongs in the `declared` state
 * (never `advertised`), and only a seat whose model names a local provider gets it - a remote seat must
 * not inherit a local window. Iterating the SPECS is the fix: reading only the first one would leave the
 * second provider's window absent, which a reader sees as "unknown", not as "wrong".
 *
 * @param {Array<{id: string, contextWindow: number}>} specs
 * @param {string} modelKey the seat's model string, e.g. "verifier/recursivesi/flint"
 * @returns {number|null}
 */
export function declaredLocalWindow(specs, modelKey) {
	if (!Array.isArray(specs) || typeof modelKey !== "string") return null;
	for (const spec of specs) {
		if (!spec || typeof spec.id !== "string") continue;
		if (modelKey.startsWith(`${spec.id}/`)) {
			const n = Number(spec.contextWindow);
			return Number.isFinite(n) && n > 0 ? n : null;
		}
	}
	return null;
}

/**
 * Build the pi-ai provider for a local server. `createProvider` and `api` are injected so the shape can be
 * asserted in a demo without loading pi-ai.
 *
 * @param {ReturnType<typeof localProviderSpec>} spec
 * @param {{createProvider: Function, api: object}} deps
 * @returns {object} a pi-ai Provider registered on the Models registry
 */
/**
 * Build the pi-ai provider for a local server. `createProvider` and `api` are injected so the shape can be
 * asserted in a demo without loading pi-ai.
 *
 * MONEY CHECKED AT REGISTRATION, NOT AT THE WIRE (D-5015.2/D-5015.3, probes P2 and P9). A `local/` or `verifier/`
 * provider whose BASE URL is not loopback is a metered endpoint wearing a free-class name. Two lies used to
 * follow from that, both silent: the row was registered with `cost {0,0,0}` (so `config`, the ledger and any
 * cost read reported a free provider that was billing), and an unset key fell back to a placeholder credential
 * (so a metered host returned a 401 the rig filed as `model_error` - see docs/runbooks/local-provider-down.md).
 * Now the endpoint decides:
 *   - loopback  -> free by locality, and the placeholder credential is legitimate (a keyless llama.cpp accepts
 *     anything and pi-ai rejects an empty string, docs/incidents/2026-10-18-local-provider-empty-key.md);
 *   - metered   -> the row must carry a DECLARED price (0 allowed, by declaration) and the key variable must
 *     resolve. Otherwise the provider is registered with NO models, so a seat naming it dies as `no_model`
 *     BEFORE any request, and the refusal is reported on stderr with the cause and the remedy.
 * It is a refusal rather than a thrown error on purpose: one mis-pointed verifier pointer must not take down
 * every verb of the rig, and `no_model` with a named remedy is the diagnosis the review asked for.
 *
 * @param {ReturnType<typeof localProviderSpec>} spec
 * @param {{createProvider: Function, api: object, env?: (name: string) => (string|undefined),
 *          report?: (line: object) => void}} deps
 * @returns {object} a pi-ai Provider registered on the Models registry
 */
export function createLocalProvider(spec, { createProvider, api, env, report } = {}) {
	const metered = endpointClass(spec.baseUrl) === "metered";
	const keyEnv = spec.apiKeyEnv ?? `${spec.prefix ?? LOCAL_ENV_PREFIX}API_KEY`;
	const declaredKey = env?.(keyEnv) ?? process.env[keyEnv];
	const keyPresent = Boolean(declaredKey && String(declaredKey).trim());
	const price = spec.price ?? null;
	const causes = [];
	if (metered && !price)
		causes.push({
			cause: "metered-endpoint-unpriced",
			fix: `declare ${spec.prefix ?? ""}PRICE_USD_IN/${spec.prefix ?? ""}PRICE_USD_OUT (0 is a legitimate declared price) or point ${spec.prefix ?? ""}PRICE_JSON / DURIG_PRICE_JSON at a dated catalog snapshot`,
		});
	if (metered && !keyPresent)
		causes.push({ cause: "metered-endpoint-unkeyed", fix: `set ${keyEnv}; the placeholder credential is for loopback servers only` });
	if (causes.length > 0) {
		const emit =
			report ??
			((line) => process.stderr.write(`${JSON.stringify(line)}\n`));
		emit({
			spend: "registration-refused",
			provider: spec.id,
			model: spec.modelId,
			endpoint: endpointClass(spec.baseUrl),
			host: safeHost(spec.baseUrl),
			causes: causes.map((c) => c.cause),
			remedy: causes.map((c) => c.fix).join("; "),
			effect: `the provider registers NO model row, so a seat naming ${spec.id}/${spec.modelId} fails as no_model BEFORE any request`,
		});
	}
	const models =
		causes.length > 0
			? []
			: [
					{
						id: spec.modelId,
						name: spec.modelId,
						api: "openai-completions",
						provider: spec.id,
						baseUrl: spec.baseUrl,
						input: ["text"],
						// Free BY LOCALITY, or priced BY DECLARATION - never free by silence.
						cost: metered
							? { input: price.in, output: price.out, cacheRead: price.cacheRead, cacheWrite: 0 }
							: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						...(metered
							? {
								endpoint: "metered",
								priceSource: spec.priceSource ?? "none",
								priceAsOf: spec.priceAsOf ?? null,
								// The NAME of the credential variable, carried so the ledger row can say which variable paid for
								// the call. The VALUE never travels on a model row (#5015: a ledger that logs a key is a leak).
								authKeyEnv: spec.apiKeyEnv ?? null,
							}
							: { endpoint: "loopback" }),
						contextWindow: spec.contextWindow,
						maxTokens: spec.maxTokens ?? 8192,
					},
				];
	return createProvider({
		id: spec.id,
		name: labelForPrefix(spec.prefix ?? `DURIG_${spec.id.toUpperCase()}_`),
		baseUrl: spec.baseUrl,
		auth: {
			apiKey: {
				name: metered ? keyEnv : "Local server (any key)",
				// A keyless LOOPBACK server needs no credential, so the key comes from the ENVIRONMENT only - a
				// literal here would put a secret in source. The placeholder exists so restart-proof local seats do
				// not fail on an empty string, and it is scoped to loopback: against a metered host it is a 401 that
				// reads as a model failure (P9), so a metered endpoint with no resolvable key resolves NO credential.
				resolve: async ({ ctx }) => {
					const key = await ctx?.env?.(keyEnv);
					if (key && String(key).trim()) return { auth: { apiKey: key }, source: keyEnv };
					if (metered) return undefined;
					return { auth: { apiKey: LOOPBACK_PLACEHOLDER_KEY }, source: "none" };
				},
			},
		},
		models,
		api,
	});
}

function safeHost(baseUrl) {
	try {
		return new URL(String(baseUrl)).host;
	} catch {
		return String(baseUrl);
	}
}
