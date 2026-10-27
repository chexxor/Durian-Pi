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

export const LOCAL_PROVIDER_ID = "local";
export const VERIFIER_PROVIDER_ID = "verifier";

/** Env/config key prefixes. The provider id is DERIVED from the prefix, so the two can never drift apart. */
export const LOCAL_ENV_PREFIX = "DURIG_LOCAL_";
export const VERIFIER_ENV_PREFIX = "DURIG_VERIFIER_";

/** Registration order: authors first, verifiers second. */
export const LOCAL_ENV_PREFIXES = [LOCAL_ENV_PREFIX, VERIFIER_ENV_PREFIX];

/** The ids this module can build. See the note above on why a static set is sound. */
export const LOCAL_PROVIDER_IDS = [LOCAL_PROVIDER_ID, VERIFIER_PROVIDER_ID];

/** Is this provider locally served (free context, cheap reset, no paid API)? */
export function isLocalProviderId(id) {
	return typeof id === "string" && LOCAL_PROVIDER_IDS.includes(id);
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
 * @returns {{id: string, prefix: string, baseUrl: string, modelId: string, contextWindow: number,
 *            maxTokens: number, apiKeyEnv: string} | null}
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
	return {
		id,
		prefix,
		baseUrl: String(baseUrl),
		modelId: String(cfg[`${prefix}MODEL`] ?? id),
		// A NaN here would travel as the ADVERTISED capacity and mis-report it, so fall back rather than
		// accept a malformed override. Same rule for the output budget.
		contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 65536,
		maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8192,
		// Each server gets its OWN key variable: two local servers can hold different credentials, and naming
		// the variable in the resolved source is what makes a missing key diagnosable instead of mysterious.
		apiKeyEnv: `${prefix}API_KEY`,
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
export function createLocalProvider(spec, { createProvider, api }) {
	return createProvider({
		id: spec.id,
		name: labelForPrefix(spec.prefix ?? `DURIG_${spec.id.toUpperCase()}_`),
		baseUrl: spec.baseUrl,
		// Local servers accept any key, so resolve a constant. A literal here is not a secret: it is the
		// placeholder the server documents, and keeping it out of config means no real credential ever lands
		// in the repository.
		auth: {
			apiKey: {
				name: "Local server (any key)",
				// A keyless local server needs no credential, so the key comes from the ENVIRONMENT only - a
				// literal here would put a secret in source. A non-secret placeholder is used when the env var
				// is unset so that restart-proof local seats do not fail on an empty string.
				resolve: async ({ ctx }) => {
					const envName = spec.apiKeyEnv ?? `${spec.prefix ?? LOCAL_ENV_PREFIX}API_KEY`;
					const key = (await ctx?.env?.(envName)) ?? "local-placeholder";
					return { auth: { apiKey: key }, source: key === "local-placeholder" ? "none" : envName };
				},
			},
		},
		models: [
			{
				id: spec.modelId,
				name: spec.modelId,
				api: "openai-completions",
				provider: spec.id,
				baseUrl: spec.baseUrl,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: spec.contextWindow,
				maxTokens: spec.maxTokens ?? 8192,
			},
		],
		api,
	});
}
