// A local, OpenAI-compatible provider (PolyStrata / llama.cpp at 127.0.0.1:8080).
//
// durig builds exactly ONE provider per process, so every seat shares it. This
// module lets a single seat use a locally-served model instead: it registers a
// second provider ("local") ALONGSIDE the default, and a seat whose model is
// "local/<id>" is resolved to it by src/seatmodel.mjs, which reads the provider
// prefix only when that provider is registered. Other seats keep the default
// provider, so no paid API is needed for the local one.
//
// Off unless DURIG_LOCAL_BASE_URL names a server: no config, no provider, and
// behaviour is exactly as before.

export const LOCAL_PROVIDER_ID = "local";

/**
 * Read the local-provider settings from the effective config, or null when the
 * feature is off. Pure: it decides nothing about pi-ai, so it is unit-testable.
 *
 * @param {Record<string, unknown>} cfg effective config (env > file > defaults)
 * @returns {{id: string, baseUrl: string, modelId: string, contextWindow: number} | null}
 */
export function localProviderSpec(cfg) {
	const baseUrl = cfg?.DURIG_LOCAL_BASE_URL;
	if (!baseUrl) return null;
	const contextWindow = Number(cfg.DURIG_LOCAL_CONTEXT ?? 65536);
	return {
		id: LOCAL_PROVIDER_ID,
		baseUrl: String(baseUrl),
		modelId: String(cfg.DURIG_LOCAL_MODEL ?? LOCAL_PROVIDER_ID),
		// A NaN here would travel as the advertised context window and mis-report
		// capacity, so fall back rather than accept a malformed override.
		contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 65536,
	};
}

/**
 * Build the pi-ai provider for a local server. `createProvider` and `api` are
 * injected so the shape can be asserted in a demo without loading pi-ai.
 *
 * @param {ReturnType<typeof localProviderSpec>} spec
 * @param {{createProvider: Function, api: object}} deps
 * @returns {object} a pi-ai Provider registered on the Models registry
 */
export function createLocalProvider(spec, { createProvider, api }) {
	return createProvider({
		id: spec.id,
		name: "Local",
		baseUrl: spec.baseUrl,
		// PolyStrata accepts any key, so resolve a constant. A literal here is not
		// a secret: it is the placeholder the server documents, and keeping it out
		// of config means no real credential ever lands in the repository.
		auth: {
			apiKey: {
				name: "Local server (any key)",
				resolve: async () => ({ auth: { apiKey: "local" }, source: "none" }),
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
				maxTokens: 8192,
			},
		],
		api,
	});
}
