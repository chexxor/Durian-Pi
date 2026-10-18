// Local-provider test: durig registers ONE provider per process, so a seat can
// only use a local server if a second provider ("local") is registered and the
// seat names it as "local/<id>". Covers the pure spec, the provider shape, the
// config whitelist, and the resolveSeatModel prefix path that makes it work.
// Run: node demo/local-provider.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { CONFIG_KEYS } from "../src/config.mjs";
import { createLocalProvider, localProviderSpec, LOCAL_PROVIDER_ID } from "../src/providers/local.mjs";
import { resolveSeatModel } from "../src/seatmodel.mjs";

// 1. Off by default: no base URL, no provider, no change to behaviour.
assert.equal(localProviderSpec({}), null, "unset DURIG_LOCAL_BASE_URL must disable the provider");
assert.equal(localProviderSpec(undefined), null, "a missing config must not throw");

// 2. The spec reads the three keys; the model id defaults to the provider id.
const spec = localProviderSpec({
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8080/v1",
	DURIG_LOCAL_MODEL: "qwen36",
	DURIG_LOCAL_CONTEXT: "65536",
});
assert.deepEqual(spec, {
	id: "local",
	baseUrl: "http://127.0.0.1:8080/v1",
	modelId: "qwen36",
	contextWindow: 65536,
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

console.log("LOCAL-PROVIDER TEST PASS");
process.exit(0);
