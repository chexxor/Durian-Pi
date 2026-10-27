// A SECOND locally-served provider, so author seats and verifier seats can differ in FAMILY.
//
// WHY THIS EXISTS (2026-10-27). The rig moved all 12 seats onto one local model to get off a 402, and
// `check` has reported `single-model-rig` (fix-now) ever since: "all 12 seats resolve to local/iq3_s, so
// a shared blind spot is systemic". The operator then served a second, DIFFERENT-family model (Flint -
// `FlintForCausalLM`, trained from scratch, own 150,144-token vocab, not a Qwen derivative) on the now-empty
// A4000 through LM Studio. Registering it is NOT just a second `setProvider` call, and the two places that
// would have been missed are asserted below (8 and 9): `src/broker.mjs` decided "is this seat local" by
// comparing the provider to the literal string "local" - so a second local provider would silently be
// EXCLUDED from the D105 between-items context reset and accumulate context forever; and `src/readapi.mjs`
// read only the single local spec, so the seat's declared context window would be missing. Both failures are
// invisible: the rig would look healthy and drift toward the context wall.
//
// A SAME-FAMILY QUANT WOULD BE A LIE. The check that goes green here compares resolved model STRINGS
// (src/checkup.mjs), so a second quant of the same model would clear it while leaving the invariant false.
// That is why the family question is answered in the docs (D133/189) rather than by this test: a test can
// prove two ids differ, not that two families do.
// Run: node demo/second-local-provider.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { CONFIG_KEYS } from "../src/config.mjs";
import {
	LOCAL_PROVIDER_ID,
	VERIFIER_PROVIDER_ID,
	VERIFIER_ENV_PREFIX,
	createLocalProvider,
	localProviderSpec,
	localProviderSpecs,
	isLocalProviderId,
	declaredLocalWindow,
} from "../src/providers/local.mjs";
import { resolveSeatModel } from "../src/seatmodel.mjs";
import { planLocalContextBoundaries } from "../src/broker.mjs";

// 1. Off by default, exactly like the first one: no base URL, no provider, no behaviour change.
assert.equal(localProviderSpec({}, VERIFIER_ENV_PREFIX) === null, true, "unset DURIG_VERIFIER_BASE_URL must disable the provider");

// 2. The second provider is read from its OWN keys and gets its OWN id, so a seat can name it
//    "verifier/<id>" and never collide with the author seats' "local/<id>".
const v = localProviderSpec(
	{
		DURIG_VERIFIER_BASE_URL: "http://127.0.0.1:1234/v1",
		DURIG_VERIFIER_MODEL: "recursivesi/flint",
		DURIG_VERIFIER_CONTEXT: "65536",
		DURIG_VERIFIER_MAX_TOKENS: "32768",
	},
	VERIFIER_ENV_PREFIX,
);
assert.equal(v.id, "verifier", "the verifier provider id is derived from its prefix");
assert.equal(VERIFIER_PROVIDER_ID, "verifier");
assert.notEqual(VERIFIER_PROVIDER_ID, LOCAL_PROVIDER_ID, "two providers must not share an id");
assert.equal(v.baseUrl, "http://127.0.0.1:1234/v1");
assert.equal(v.modelId, "recursivesi/flint");
assert.equal(v.contextWindow, 65536);

// 3. THE OUTPUT BUDGET IS NOT AN OPTIONAL DETAIL. Measured on the live endpoint: Flint returned
//    94 completion tokens for a one-line weather prompt and 61 of them were REASONING tokens. A thinking
//    model capped at 8192 gets truncated mid-reasoning and hands back a confident half-thought, so the
//    budget has to be declarable per provider rather than hardcoded.
assert.equal(v.maxTokens, 32768, "the output budget must be declarable per provider");
const d = localProviderSpec({ DURIG_LOCAL_BASE_URL: "http://x/v1" });
assert.equal(d.maxTokens, 8192, "the first provider keeps its existing 8192 default - no silent change");
assert.equal(
	localProviderSpec({ DURIG_VERIFIER_BASE_URL: "http://x/v1", DURIG_VERIFIER_MAX_TOKENS: "nan-ish" }, VERIFIER_ENV_PREFIX).maxTokens,
	8192,
	"a malformed budget must fall back, not travel as NaN",
);

// 4. Back-compat: the first provider is untouched by this change.
assert.equal(d.id, "local", "the default prefix still yields the original id");
assert.equal(localProviderSpec({ DURIG_LOCAL_BASE_URL: "http://y/v1", DURIG_LOCAL_MODEL: "iq3_s" }).modelId, "iq3_s");

// 5. Both at once: one call, and the two specs stay distinct in id, URL and model.
const both = localProviderSpecs({
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:47831/v1",
	DURIG_LOCAL_MODEL: "iq3_s",
	DURIG_VERIFIER_BASE_URL: "http://127.0.0.1:1234/v1",
	DURIG_VERIFIER_MODEL: "recursivesi/flint",
});
assert.equal(both.length, 2, "both providers register together");
assert.deepEqual(both.map((s) => s.id), ["local", "verifier"]);
assert.notEqual(both[0].baseUrl, both[1].baseUrl);
assert.deepEqual(localProviderSpecs({}), [], "no config must yield no providers, not one broken one");

// 6. The provider object itself: distinct id, name and API-key variable, so the two servers can hold
//    different credentials and a trace can tell them apart.
let built = null;
const provider = createLocalProvider(v, {
	createProvider: (input) => {
		built = input;
		return { id: input.id };
	},
	api: { name: "fake-api" },
});
assert.equal(provider.id, "verifier");
assert.equal(built.baseUrl, "http://127.0.0.1:1234/v1");
assert.equal(built.models[0].id, "recursivesi/flint");
assert.equal(built.models[0].provider, "verifier");
assert.equal(built.models[0].contextWindow, 65536);
assert.equal(built.models[0].maxTokens, 32768, "the declared budget must reach the model spec");
assert.equal(built.models[0].api, "openai-completions", "LM Studio serves /v1/chat/completions, so the api stays");

const unset = await built.auth.apiKey.resolve({ ctx: { env: async () => undefined } });
assert.equal(unset.auth.apiKey, "local-placeholder", "a keyless local server still gets a placeholder");
assert.equal(unset.source, "none");
const set = await built.auth.apiKey.resolve({ ctx: { env: async (k) => (k === "DURIG_VERIFIER_API_KEY" ? "vk" : undefined) } });
assert.equal(set.auth.apiKey, "vk", "the verifier reads its OWN key variable");
assert.equal(set.source, "DURIG_VERIFIER_API_KEY", "and names it, so a missing key is diagnosable");

// 7. The predicate that replaces the `=== "local"` comparisons.
assert.equal(isLocalProviderId(LOCAL_PROVIDER_ID), true);
assert.equal(isLocalProviderId(VERIFIER_PROVIDER_ID), true);
assert.equal(isLocalProviderId("deepinfra"), false, "a paid provider is NOT local-served");
assert.equal(isLocalProviderId(undefined), false, "a seat with no provider must not be swept up");

// 8. THE FIRST COUPLING (D105). `planLocalContextBoundaries` decides which seats get a between-items
//    context reset, and it compared the provider to the literal "local". A second local provider would be
//    EXCLUDED: no reset, context grows every item, and the seat drifts into the compaction wall while
//    looking healthy. This is the regression this test exists to prevent.
const items = [{ id: 10, to: "qa", status: "queued" }];
assert.equal(
	planLocalContextBoundaries({ seats: { qa: { conversationId: 5, provider: "verifier" } }, items }).length,
	1,
	"a verifier-provider seat must get the between-items reset like any other local seat",
);
assert.equal(
	planLocalContextBoundaries({ seats: { qa: { conversationId: 5, provider: "deepinfra" } }, items }).length,
	0,
	"and a paid seat must still be left alone (D105: paid seats keep their durable context)",
);

// 9. THE SECOND COUPLING. The declared context window came from the single local spec, so a second
//    provider's window would be absent (not wrong - ABSENT), and a capacity reader would understate it.
const specs = localProviderSpecs({
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:47831/v1",
	DURIG_LOCAL_CONTEXT: "200000",
	DURIG_VERIFIER_BASE_URL: "http://127.0.0.1:1234/v1",
	DURIG_VERIFIER_CONTEXT: "65536",
});
assert.equal(declaredLocalWindow(specs, "verifier/recursivesi/flint"), 65536, "the verifier window is declared");
assert.equal(declaredLocalWindow(specs, "local/iq3_s"), 200000, "and the author window is still declared");
assert.equal(declaredLocalWindow(specs, "deepinfra/zai-org/GLM-5.3-Flash"), null, "a remote seat must not inherit either");

// 10. The keys must be readable from durig.config.json, not only the environment.
for (const key of ["DURIG_VERIFIER_BASE_URL", "DURIG_VERIFIER_MODEL", "DURIG_VERIFIER_CONTEXT", "DURIG_VERIFIER_MAX_TOKENS"]) {
	assert.ok(CONFIG_KEYS.includes(key), `${key} must be a config-file key`);
}

// 11. Resolution still depends on REGISTRATION: an unregistered "verifier" prefix stays part of the
//     model id, which is what makes the static id set in (7) safe.
const registered = { getProvider: (id) => (id === VERIFIER_PROVIDER_ID ? { id } : undefined) };
assert.deepEqual(
	resolveSeatModel(registered, "verifier/recursivesi/flint", "deepinfra", "iq3_s"),
	{ provider: "verifier", modelId: "recursivesi/flint" },
	"a registered verifier provider claims the prefix",
);
assert.deepEqual(
	resolveSeatModel({ getProvider: () => undefined }, "verifier/recursivesi/flint", "deepinfra", "iq3_s"),
	{ provider: "deepinfra", modelId: "verifier/recursivesi/flint" },
	"unregistered: the whole string is one model id, so it can never be mistaken for a local seat",
);

console.log("SECOND-LOCAL-PROVIDER TEST PASS");
process.exit(0);
