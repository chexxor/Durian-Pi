// demo/secrets.test.mjs — prove the #700 no-secrets-in-config guard.
//
// The disclosed finding: a live DEEPINFRA_API_KEY value sat in PLAIN TEXT in
// durig.config.json in a SHARED tree. A config file is shared, diffed and
// committed, so a secret in it leaks by design; the environment is the
// sanctioned channel. The guard must therefore:
//   - REFUSE a config FILE whose VALUES look like credentials, naming the KEY
//     (never echoing the value);
//   - NOT refuse the same value coming from the ENVIRONMENT (that is the
//     intended use);
//   - NOT false-positive on ordinary values (paths, model ids, numbers, "off").
//
// Failing-first: before the guard exists, a secret in the file is accepted
// silently and this test fails at the first assert.rejects.
//
// Run: node demo/secrets.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { assertNoSecretsInFile, describeConfig, loadConfig, loadShippedDefaults, looksLikeSecret } from "../src/config.mjs";

// A value shaped like an OpenAI key (not a real one).
const FAKE_KEY = "sk-" + "a".repeat(32);

// --- unit: the shape classifier ---------------------------------------------
assert.equal(looksLikeSecret(FAKE_KEY), true, "sk-… is secret-shaped");
assert.equal(looksLikeSecret("hf_" + "a".repeat(20)), true, "hf_… is secret-shaped");
assert.equal(looksLikeSecret("ghp_" + "A".repeat(24)), true, "ghp_… is secret-shaped");
assert.equal(looksLikeSecret("A".repeat(39) + "1"), true, "a 40-char letters+digits run is secret-shaped");
assert.equal(looksLikeSecret("sk-short"), false, "too short to be a key");
assert.equal(looksLikeSecret(12345), false, "a number is never a secret");
assert.equal(looksLikeSecret(""), false, "empty is not a secret");
assert.equal(looksLikeSecret("./rig.sqlite"), false, "an ordinary path is not a secret");
assert.equal(looksLikeSecret("C:\\Users\\Alex\\dsh-Projects\\pi-opendurig\\rig.sqlite"), false, "a Windows path is not a secret");
assert.equal(
	looksLikeSecret("/home/user2/projects/durig/workspace/data/rig.sqlite"),
	false,
	"a long POSIX path (with separators) is not a secret",
);
assert.equal(looksLikeSecret("zai-org/GLM-5.3-Flash"), false, "a model id is not a secret");
assert.equal(looksLikeSecret("off"), false, "'off' is not a secret");
console.log("SHAPE CLASSIFIER OK");

// --- unit: the file-level refusal -------------------------------------------
assert.throws(
	() => assertNoSecretsInFile({ DEEPINFRA_API_KEY: FAKE_KEY }, "durig.config.json"),
	(err) => {
		assert.match(err.message, /secret-looking value/);
		assert.match(err.message, /DEEPINFRA_API_KEY/, "names the offending KEY");
		assert.match(err.message, /durig\.config\.json/, "names the file");
		assert.ok(!err.message.includes(FAKE_KEY), "NEVER echoes the value");
		assert.match(err.message, /ENVIRONMENT/, "points at the env-var channel");
		return true;
	},
	"a secret-looking file value is refused, loudly and without the value",
);
assert.doesNotThrow(
	() => assertNoSecretsInFile({ DURIG_DB: "./rig.sqlite", DURIG_MODEL: "zai-org/GLM-5.3-Flash" }, "durig.config.json"),
	"ordinary file values pass",
);
// A secret under an UNEXPECTED key is still a secret: the guard is value-shaped,
// not key-named (key-name matching would miss a key pasted into DURIG_DB).
assert.throws(
	() => assertNoSecretsInFile({ DURIG_DB: FAKE_KEY }, "durig.config.json"),
	/secret-looking value/,
	"a secret under a non-key name is still refused",
);
console.log("FILE REFUSAL OK");

// --- integration: loadConfig refuses a SECRET FILE, accepts the same in ENV --
const fileWithSecret = { "durig.config.json": JSON.stringify({ DEEPINFRA_API_KEY: FAKE_KEY }) };
const readSecretFile = async (p) => {
	if (fileWithSecret[p] !== undefined) return fileWithSecret[p];
	const err = new Error(`ENOENT: ${p}`);
	err.code = "ENOENT";
	throw err;
};

await assert.rejects(
	() => loadConfig({ env: {}, readFile: readSecretFile }),
	/secret-looking value/,
	"loadConfig refuses a config FILE carrying a secret",
);

// The SAME value from the ENVIRONMENT is accepted: env is the sanctioned channel.
const envOnly = await loadConfig({
	env: { DEEPINFRA_API_KEY: FAKE_KEY },
	readFile: async (p) => {
		const err = new Error(`ENOENT: ${p}`);
		err.code = "ENOENT";
		throw err;
	},
});
assert.equal(envOnly.config.DEEPINFRA_API_KEY, FAKE_KEY, "an env secret is accepted (that is how an operator sets it)");
assert.equal(envOnly.source, null, "no file was read");

// A file with an ordinary value is fine.
const readOrdinaryFile = async (p) => {
	if (p === "durig.config.json") return JSON.stringify({ DURIG_DB: "./rig.sqlite" });
	const err = new Error(`ENOENT: ${p}`);
	err.code = "ENOENT";
	throw err;
};
const ordinary = await loadConfig({ env: {}, readFile: readOrdinaryFile });
assert.equal(ordinary.config.DURIG_DB, "./rig.sqlite", "an ordinary file loads normally");
console.log("LOADCONFIG OK (secret file refused, env accepted, ordinary loads)");

// --- integration: the shipped defaults loader refuses too --------------------
await assert.rejects(
	() => loadShippedDefaults({ readFile: async () => JSON.stringify({ DEEPINFRA_API_KEY: FAKE_KEY }) }),
	/secret-looking value/,
	"loadShippedDefaults refuses a secret-bearing defaults file",
);

// --- describeConfig still never leaks a value --------------------------------
const described = describeConfig({ config: { DEEPINFRA_API_KEY: FAKE_KEY, DURIG_DB: "a.sqlite" }, source: "x" });
assert.equal(described.DEEPINFRA_API_KEY, "set", "describeConfig reduces the key to a boolean");
assert.ok(!JSON.stringify(described).includes(FAKE_KEY), "describeConfig never emits the value");

console.log("\nPASS — #700 no-secrets-in-config guard holds");
process.exit(0);
