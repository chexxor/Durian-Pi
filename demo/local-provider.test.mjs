// Local-provider test: durig registers ONE provider per process, so a seat can
// only use a local server if a second provider ("local") is registered and the
// seat names it as "local/<id>". Covers the pure spec, the provider shape, the
// config whitelist, and the resolveSeatModel prefix path that makes it work.
// Run: node demo/local-provider.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { CONFIG_KEYS } from "../src/config.mjs";
import { createLocalProvider, localProviderSpec, LOCAL_PROVIDER_ID, VERIFIER_ENV_PREFIX, LOOPBACK_PLACEHOLDER_KEY } from "../src/providers/local.mjs";
import { resolveSeatModel } from "../src/seatmodel.mjs";

// 1. Off by default: no base URL, no provider, no change to behaviour.
assert.equal(localProviderSpec({}), null, "unset DURIG_LOCAL_BASE_URL must disable the provider");
assert.equal(localProviderSpec(undefined), null, "a missing config must not throw");

// 2. The spec reads its keys; the model id defaults to the provider id. THE SHAPE GREW (2026-10-27) when a
//    second local provider arrived: `prefix` (which provider this is), `maxTokens` (a per-provider output
//    budget - a thinking model needs one, see demo/second-local-provider.test.mjs) and `apiKeyEnv` (each
//    server gets its own credential variable). Asserted in FULL, not with a subset match, so a future field
//    has to be added on purpose rather than slipping through a permissive comparison.
const spec = localProviderSpec({
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8080/v1",
	DURIG_LOCAL_MODEL: "qwen36",
	DURIG_LOCAL_CONTEXT: "65536",
});
assert.deepEqual(spec, {
	id: "local",
	prefix: "DURIG_LOCAL_",
	baseUrl: "http://127.0.0.1:8080/v1",
	// #5047 (D-5015.3): locality is read off the ENDPOINT, so the spec now carries it. This pin is FULL on
	// purpose (see the note above), so the field was added here rather than slipping through a loose match.
	endpoint: "loopback",
	modelId: "qwen36",
	contextWindow: 65536,
	maxTokens: 8192,
	apiKeyEnv: "DURIG_LOCAL_API_KEY",
});

// 3. A malformed context must fall back, not travel as NaN and mis-report capacity.
const bad = localProviderSpec({ DURIG_LOCAL_BASE_URL: "http://x/v1", DURIG_LOCAL_CONTEXT: "not-a-number" });
assert.equal(bad.contextWindow, 65536, "non-numeric context must fall back");

// 4. The provider is built with the id/base URL and exactly the model the seat
// will name, so models.getModel(provider, modelId) finds it.
let seen = null;
const fakeProvider = createLocalProvider(spec, {
	createProvider: (input) => {
		seen = input;
		return { id: input.id };
	},
	api: { name: "fake-api" },
});
assert.equal(fakeProvider.id, "local");
assert.equal(seen.id, "local");
assert.equal(seen.baseUrl, "http://127.0.0.1:8080/v1");
assert.equal(seen.models.length, 1);
assert.equal(seen.models[0].id, "qwen36");
assert.equal(seen.models[0].provider, "local");
assert.equal(seen.models[0].contextWindow, 65536);

// 5. The prefix resolves ONLY because the provider is registered; without it the
// whole string stays a model id under the default provider (the existing rule).
const withLocal = { getProvider: (id) => (id === LOCAL_PROVIDER_ID ? { id } : undefined) };
assert.deepEqual(
	resolveSeatModel(withLocal, "local/qwen36", "deepinfra", "zai-org/GLM-5.3-Flash"),
	{ provider: "local", modelId: "qwen36" },
	"a registered local provider must claim the prefix",
);
const withoutLocal = { getProvider: () => undefined };
assert.deepEqual(
	resolveSeatModel(withoutLocal, "local/qwen36", "deepinfra", "zai-org/GLM-5.3-Flash"),
	{ provider: "deepinfra", modelId: "local/qwen36" },
	"without the provider, the string is ONE model id under the default",
);

// 6. The config keys must be accepted from durig.config.json, not just the env.
for (const key of ["DURIG_LOCAL_BASE_URL", "DURIG_LOCAL_MODEL", "DURIG_LOCAL_CONTEXT"]) {
	assert.ok(CONFIG_KEYS.includes(key), `${key} must be a config-file key`);
}

// 7. Auth key resolution: when DURIG_LOCAL_API_KEY is unset, a non-secret
// placeholder is returned (restart-proof local seats). When set, the real key
// is used and source is "DURIG_LOCAL_API_KEY".
// The real pi-ai caller passes { ctx: authContext, credential, signal } to
// resolve, so the stub must wrap env inside a ctx object.
let authInput = null;
const authProvider = createLocalProvider(spec, {
	createProvider: (input) => {
		authInput = input;
		return { id: input.id };
	},
	api: { name: "fake-api" },
});
assert.ok(authInput, "createProvider must receive the auth config");
assert.ok(authInput.auth.apiKey.resolve, "auth must expose a resolve function");
// Unset env → placeholder
const unsetCtx = { ctx: { env: async (k) => { if (k === "DURIG_LOCAL_API_KEY") return undefined; return undefined; } } };
const unsetResult = await authInput.auth.apiKey.resolve(unsetCtx);
assert.equal(unsetResult.auth.apiKey, LOOPBACK_PLACEHOLDER_KEY, "unset env on a LOOPBACK endpoint must yield the loopback placeholder (#5015 P9 scopes it to loopback)");
assert.equal(unsetResult.source, "none", "unset env source must be 'none'");
// Set env → real key
const setCtx = { ctx: { env: async (k) => { if (k === "DURIG_LOCAL_API_KEY") return "my-secret"; return undefined; } } };
const setResult = await authInput.auth.apiKey.resolve(setCtx);
assert.equal(setResult.auth.apiKey, "my-secret", "set env must yield real key");
assert.equal(setResult.source, "DURIG_LOCAL_API_KEY", "set env source must name the var");

// 8. MONEY AND CREDENTIALS ARE CHECKED AT REGISTRATION, NOT AT THE WIRE (#5047, acceptance P2 + P9).
//    A `verifier/` provider pointed at a NON-loopback host is a paid call wearing a free-class name. Before
//    #5047 it was registered with cost {0,0,0} and authenticated with the loopback placeholder; both failures
//    read as something else (`config` showed a free provider that was billing; a 401 filed as `model_error`).
{
	const meteredSpec = localProviderSpec(
		{
			DURIG_VERIFIER_BASE_URL: "https://api.deepinfra.com/v1/openai",
			DURIG_VERIFIER_MODEL: "openai/gpt-oss-20b",
		},
		VERIFIER_ENV_PREFIX,
	);
	assert.equal(meteredSpec.endpoint, "metered", "locality is read off the ENDPOINT, not the provider id (D-5015.3)");
	assert.equal(meteredSpec.price, null, "no declared price means price=null, NOT price 0 — an absent price is not a price");

	const reports = [];
	let unpriced = null;
	createLocalProvider(meteredSpec, {
		createProvider: (input) => ((unpriced = input), input),
		api: { name: "fake-api" },
		env: () => undefined,
		report: (line) => reports.push(line),
	});
	assert.deepEqual(unpriced.models, [], "an unpriced, unkeyed metered endpoint registers NO model row: a seat naming it dies no_model BEFORE any request");
	assert.equal(reports.length, 1, "the refusal is REPORTED, not silent and not a thrown trace");
	assert.deepEqual(reports[0].causes, ["metered-endpoint-unpriced", "metered-endpoint-unkeyed"]);
	assert.ok(/PRICE_USD_IN/.test(reports[0].remedy) && /DURIG_VERIFIER_API_KEY/.test(reports[0].remedy), "the remedy names the keys to set");

	// Priced + keyed: registered, priced, and the row names where the price came from (F8).
	let priced = null;
	const pricedSpec = localProviderSpec(
		{
			DURIG_VERIFIER_BASE_URL: "https://api.deepinfra.com/v1/openai",
			DURIG_VERIFIER_MODEL: "openai/gpt-oss-20b",
			DURIG_VERIFIER_PRICE_USD_IN: "0.03",
			DURIG_VERIFIER_PRICE_USD_OUT: "0.14",
			DURIG_VERIFIER_PRICE_AS_OF: "2026-11-03",
		},
		VERIFIER_ENV_PREFIX,
	);
	createLocalProvider(pricedSpec, {
		createProvider: (input) => ((priced = input), input),
		api: { name: "fake-api" },
		env: (name) => (name === "DURIG_VERIFIER_API_KEY" ? "k" : undefined),
		report: () => {},
	});
	assert.equal(priced.models.length, 1, "a priced, keyed metered endpoint registers");
	assert.deepEqual(priced.models[0].cost, { input: 0.03, output: 0.14, cacheRead: 0.03, cacheWrite: 0 }, "the DECLARED price reaches the row");
	assert.equal(priced.models[0].priceSource, "DURIG_VERIFIER_PRICE_USD_IN/OUT");
	assert.equal(priced.models[0].priceAsOf, "2026-11-03", "a dated price is a dated claim");
	// The credential itself: a metered host with no resolvable key gets NO credential, never a placeholder.
	const noKey = await priced.auth.apiKey.resolve({ ctx: { env: async () => undefined } });
	assert.equal(noKey, undefined, "P9: no placeholder credential is ever offered to a metered host");

	// Free BY DECLARATION: `0` is a legitimate declared price (a LAN-served free model is free on purpose).
	let declaredFree = null;
	const freeSpec = localProviderSpec(
		{
			DURIG_VERIFIER_BASE_URL: "http://192.168.1.20:8080/v1",
			DURIG_VERIFIER_MODEL: "iq3_s",
			DURIG_VERIFIER_PRICE_USD_IN: "0",
			DURIG_VERIFIER_PRICE_USD_OUT: "0",
		},
		VERIFIER_ENV_PREFIX,
	);
	createLocalProvider(freeSpec, {
		createProvider: (input) => ((declaredFree = input), input),
		api: { name: "fake-api" },
		env: () => "k",
		report: () => {},
	});
	assert.equal(declaredFree.models.length, 1, "a non-loopback endpoint declared at $0 registers");
	assert.equal(declaredFree.models[0].cost.input, 0, "declared zero stays zero");
	assert.equal(declaredFree.models[0].endpoint, "metered", "and it stays declared as metered, so the cap still counts its calls");
}

console.log(
	`LOCAL-PROVIDER TEST PASS (loopback placeholder scoped to loopback; a metered endpoint refuses registration unpriced/unkeyed with the cause and remedy reported; a declared price reaches the row with priceSource+priceAsOf; 0 = free BY DECLARATION)`,
);
process.exit(0);
