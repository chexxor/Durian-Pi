// The credential asymmetry, pinned as behaviour rather than left as a comment (#5125). `src/config.mjs:120-124`
// says the API-KEY variables are deliberately NOT config keys, and this demo is what makes that claim checkable:
// a config key is auditable because it is IN a file; a credential is auditable because it is NOT in a file.
// `durig.config.json` is gitignored but still inside the tree - gitignored is not outside.
// Run: node demo/config-credential-surface.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import {
	CONFIG_KEYS,
	assertNoSecretsInFile,
	describeConfig,
	looksLikeSecret,
	loadConfig,
	loadShippedDefaults,
} from "../src/config.mjs";

// The sentinel is built by concatenation so this file can never trip a repo-wide secret scan, and so an assertion
// that the value is ABSENT from a message cannot be satisfied by the source text.
const SENTINEL = ["sk-", "durig", "demo", "credential", "9Fb3Q7xZ"].join("") + "20261105"; // 40+ mixed chars: secret-shaped on purpose
assert.ok(looksLikeSecret(SENTINEL), "the sentinel must actually be secret-shaped or the demo proves nothing");

// --- (a) a config FILE carrying a credential is refused, naming the KEY and never the value ----------------
for (const key of ["DEEPINFRA_API_KEY", "DURIG_VERIFIER_API_KEY", "DURIG_LOCAL_API_KEY", "DURIG_ANY_KEY"]) {
	assert.throws(
		() => assertNoSecretsInFile({ [key]: SENTINEL }, "durig.config.json"),
		(err) => err.message.includes(key) && !err.message.includes("durigdemocredential") && !err.message.includes("9Fb3Q7xZ"),
		`${key} in a config file must be refused by name, with no echo of the value`,
	);
}
// It is the VALUE that is refused, not the key name: a non-secret placeholder is allowed (presence, not a secret).
assertNoSecretsInFile({ DEEPINFRA_API_KEY: "placeholder-not-a-secret" }, "durig.config.json");
// A non-string is never a secret (a number, an array, an object).
assertNoSecretsInFile({ DURIG_EXTENSIONS: ["a", "b"], DURIG_MAX_CONCURRENT_SEATS: 4 }, "durig.config.json");

// And it fires on both real read paths, on the RAW file values before merge, so an env override cannot mask it.
{
	const files = { "durig.config.json": JSON.stringify({ DEEPINFRA_API_KEY: SENTINEL }) };
	const readFile = (p) =>
		files[p] ? Promise.resolve(files[p]) : Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
	await assert.rejects(
		() => loadConfig({ env: { DEEPINFRA_API_KEY: "from-env" }, readFile }),
		(err) => err.message.includes("DEEPINFRA_API_KEY") && !err.message.includes("9Fb3Q7xZ"),
		"loadConfig must refuse the file secret even when the environment supplies its own value",
	);
	const readFile2 = (p) =>
		p.endsWith("durig.config.default.json")
			? Promise.resolve(JSON.stringify({ DEEPINFRA_API_KEY: SENTINEL }))
			: Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
	await assert.rejects(() => loadShippedDefaults({ readFile: readFile2, anchors: ["x/durig.config.default.json"] }));
}

// --- (b) the credential NAMES the provider path reads first are env-only ------------------------------------
// `src/providers/local.mjs` builds `apiKeyEnv` from the family prefix and `tools/model-probes/metered.mjs`
// (KEY_ENV_ORDER) tries DURIG_VERIFIER_API_KEY, DURIG_LOCAL_API_KEY, then DEEPINFRA_API_KEY. The first two are not
// file keys, and registering them is what this row's ruling replaced (#5118's wrong half).
for (const key of ["DURIG_VERIFIER_API_KEY", "DURIG_LOCAL_API_KEY", "DURIG_LOCAL_BASE_URL_KEY"]) {
	assert.ok(!CONFIG_KEYS.includes(key), `${key} must stay OUT of CONFIG_KEYS: a credential belongs in the environment`);
}
// DEEPINFRA_API_KEY is the one credential NAME in the inventory, and its only purpose there is to be REPORTED as
// present. So the rule the demo pins: every credential-named entry in the inventory must be reported presence-only.
const credentialNamed = CONFIG_KEYS.filter((k) => /_API_KEY$|^API_KEY$/.test(k));
assert.ok(credentialNamed.includes("DEEPINFRA_API_KEY"), "the shipped surface reports this one by presence");
for (const key of credentialNamed) {
	const report = describeConfig({ config: { [key]: SENTINEL }, source: "durig.config.json" });
	const text = JSON.stringify(report);
	assert.match(text, /"set"/, `${key} must be reported as set/unset`);
	assert.ok(!text.includes("9Fb3Q7xZ") && !text.includes("durigdemocredential"), `${key}: the report must never carry the value`);
	assert.ok(!text.includes(SENTINEL), `${key}: the report must never carry the value`);
	const unset = describeConfig({ config: {}, source: null });
	assert.equal(unset[key], "unset");
}

// --- (c) no CONFIG_KEYS entry may HOLD a credential, whatever its name --------------------------------------
// The refusal is by VALUE shape, so registering a price/ledger key cannot smuggle a credential in beside it: the
// keys #5125 adds are numbers and paths, and a secret-shaped value under any of them is still refused.
for (const key of ["DURIG_VERIFIER_PRICE_USD_IN", "DURIG_VERIFIER_PRICE_JSON", "DURIG_SPEND_LEDGER"]) {
	assert.ok(CONFIG_KEYS.includes(key), `${key} is a registered config key (#5125)`);
	assert.throws(
		() => assertNoSecretsInFile({ [key]: SENTINEL }, "durig.config.json"),
		(err) => err.message.includes(key) && !err.message.includes(SENTINEL),
		`${key} cannot hold a credential-shaped value`,
	);
}

console.log("config-credential-surface: OK");
