// The config-file inventory is enforced, not declared. #5125: `CONFIG_KEYS` used to be a list only DEMOS read
// (measured at 1dff8590: `git grep CONFIG_KEYS -- src cli.mjs` returned the declaration and nothing else, and the
// file's own comment admitted "there is NO unknown-key rule at load time"). A key typed into `durig.config.json`
// that no code reads was therefore silently accepted - the same accepted-and-ignored class as `--json` (#5071).
// This demo pins the refusal, and pins that the refusal starts GREEN on the shipped artifact.
// Run: node demo/config-unknown-key.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CONFIG_KEYS, assertNoUnknownFileKeys, loadConfig, loadShippedDefaults } from "../src/config.mjs";

// --- the inventory now carries the price + ledger keys the arming path reads -------------------------------
// `declaredPrice` (src/providers/local.mjs:94-128) reads these from the MERGED config layer, so a key that is not
// in the inventory cannot be declared in a file - and an arm declared nowhere is the half-armed roster ROADMAP 272
// names. Names are taken from the CODE, not from prose: the cache-read key is `..._PRICE_USD_CACHE_READ`.
for (const key of [
	"DURIG_VERIFIER_PRICE_USD_IN",
	"DURIG_VERIFIER_PRICE_USD_OUT",
	"DURIG_VERIFIER_PRICE_USD_CACHE_READ",
	"DURIG_VERIFIER_PRICE_AS_OF",
	"DURIG_VERIFIER_PRICE_JSON",
	"DURIG_PRICE_JSON",
	"DURIG_SPEND_LEDGER",
]) {
	assert.ok(CONFIG_KEYS.includes(key), `${key} must be a config-file key (#5125)`);
}
// The three caps are SET BY the tracked `durig.config.default.json`, so they are by definition config-file keys.
// They were missing from the inventory; an unknown-key rule that refused the shipped defaults would be a gate that
// starts red (the #3539 lesson), so the inventory was widened to match the artifact rather than the reverse.
const defaults = JSON.parse(readFileSync("durig.config.default.json", "utf8"));
for (const key of Object.keys(defaults)) {
	assert.ok(CONFIG_KEYS.includes(key), `${key} is set by durig.config.default.json so it must be in CONFIG_KEYS`);
}
assert.ok(!CONFIG_KEYS.includes("DURIG_PROBE_CEILING_USD"), "the probe ceiling is a per-process env value, not a file key (#5024: one budget, one name, mapped at the seam)");

// --- the refusal itself ----------------------------------------------------------------------------------
assert.throws(
	() => assertNoUnknownFileKeys({ DURIG_DB: "x.sqlite", DURIG_NOT_A_SETTING: "1" }, "durig.config.json"),
	(err) =>
		err.message.includes("DURIG_NOT_A_SETTING") &&
		err.message.includes("durig.config.json") &&
		/DURIG_DB/.test(err.message),
	"an unknown config-file key must be REFUSED by name, naming the file and naming known keys",
);
// Never the VALUE: a typo'd key is often a mistyped credential.
assert.throws(
	() => assertNoUnknownFileKeys({ DURIG_WEIRD: "sk-supersecret-looking-token-abcdefgh" }, "elsewhere.json"),
	(err) => !err.message.includes("supersecret"),
	"the refusal names the KEY, never the value",
);
// A file that sets only known keys passes - including the shipped defaults and a bare operator file.
assertNoUnknownFileKeys(defaults, "durig.config.default.json");
assertNoUnknownFileKeys({}, "empty");

// --- it fires on the real read paths, not just the helper --------------------------------------------------
{
	const files = {
		"durig.config.json": JSON.stringify({ DURIG_TYPO_OF_DB: "./rig.sqlite" }),
	};
	const readFile = (p) =>
		files[p] ? Promise.resolve(files[p]) : Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
	await assert.rejects(() => loadConfig({ env: {}, readFile }), (err) => err.message.includes("DURIG_TYPO_OF_DB"));
}
{
	const dir = "demo/fixtures/unknown-defaults";
	const files = { [`${dir}/durig.config.default.json`]: JSON.stringify({ DURIG_MADE_UP: "1" }) };
	const readFile = (p) =>
		files[p] ? Promise.resolve(files[p]) : Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
	await assert.rejects(
		() => loadShippedDefaults({ readFile, anchors: [`${dir}/durig.config.default.json`] }),
		(err) => err.message.includes("DURIG_MADE_UP"),
	);
}

console.log("config-unknown-key: OK");
