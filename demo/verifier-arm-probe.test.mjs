// Pins the arming-cost instrument (#5125) and, with it, ROADMAP 272: the vendored `src/providers/deepinfra-prices.json`
// is `{fetchedAt, source, unit, note, rows:{...}}` while `declaredPrice` reads `data[].metadata.pricing` — a
// DIFFERENT shape. Pointed at our own price file, a metered endpoint prices to NOTHING, and the provider then
// registers no model row: a half-armed roster that looks configured. This demo makes that state a NON-ZERO exit,
// and asserts the priced path's arithmetic, and that no credential value can come out of the tool.
// Run: node demo/verifier-arm-probe.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const TOOL = "tools/verifier-arm-probe.mjs";
const BASE = "https://api.deepinfra.com/v1/openai";
const MODEL = "openai/gpt-oss-120b";

// The rig is now PRICED: durig.config.json carries DURIG_VERIFIER_PRICE_USD_IN/OUT (asOf 2026-11-06), so a test
// that runs the probe in the shared tree gets a price from the operator's config and can never observe the
// unpriced shape it exists to pin (ROADMAP 272). Isolate the config file: an empty one EXISTS, so the probe is
// not refused with exit 2, but nothing in it can supply a price.
const EMPTY_CONFIG = join(mkdtempSync(join(tmpdir(), "arm-probe-")), "empty-config.json");
writeFileSync(EMPTY_CONFIG, "{}");

function run(env = {}, args = []) {
  if (!args.some((a) => a.startsWith("--config="))) args = [`--config=${EMPTY_CONFIG}`, ...args];
	// A controlled env: the family keys come from the caller, and NO credential of the operator's shell is copied
	// in, so the demo cannot spend anything and cannot leak anything.
	const scrubbed = { ...process.env };
	for (const k of Object.keys(scrubbed)) if (/API_KEY|SECRET|TOKEN$/.test(k) && !/MAX_TOKENS/.test(k)) delete scrubbed[k];
	const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", env: { ...scrubbed, ...env } });
	// A refusal prints to stderr and prints NO json, so parse only when there is a json object to parse.
	const json = r.stdout.includes("{") ? JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) : null;
	return { ...r, json };
}

// --- 1. the 272 trap: our own price file prices nothing, and that must NOT exit green ----------------------
{
	const { status, json } = run({ DURIG_VERIFIER_PRICE_JSON: "src/providers/deepinfra-prices.json" }, [
		`--base=${BASE}`,
		`--model=${MODEL}`,
	]);
	assert.equal(status, 1, "an unpriced metered endpoint must exit non-zero (the spike copy exited 0 — the false-green shape #5090 removed)");
	assert.equal(json.price, null);
	assert.equal(json.priceSource, "none");
	assert.equal(json.verdict, "NOT-ARMABLE");
	assert.equal(json.cause, "metered-endpoint-unpriced");
	assert.match(json.why, /rows:\{\.\.\.\}/, "the message must name the shape mismatch, not just the absence");
}

// --- 2. the priced path: named source, dated, arithmetic checked against the caps -------------------------
{
	const { status, json } = run(
		{
			DURIG_VERIFIER_PRICE_USD_IN: "0.037",
			DURIG_VERIFIER_PRICE_USD_OUT: "0.17",
			DURIG_VERIFIER_PRICE_AS_OF: "2026-11-05",
		},
		[`--base=${BASE}`, `--model=${MODEL}`, "--ceiling=0.15"],
	);
	assert.equal(status, 0, JSON.stringify(json));
	assert.deepEqual(json.price, { in: 0.037, out: 0.17, cacheRead: 0.037 });
	assert.equal(json.priceSource, "DURIG_VERIFIER_PRICE_USD_IN/OUT", "the bill must name where the price came from");
	assert.equal(json.priceAsOf, "2026-11-05", "a dated price is at least a checkable price");

	// The exposure numbers are recomputed here from the SAME spec the tool printed, so the demo checks the
	// arithmetic rather than freezing a constant that a spec change would silently invalidate.
	const turn = (json.spec.contextWindow * json.price.in + json.spec.maxTokens * json.price.out) / 1e6;
	assert.ok(json.spec.contextWindow > 0 && json.spec.maxTokens > 0, "the spec must resolve from the config layers");
	assert.equal(json.exposure.maxCallExposureUsd, +turn.toFixed(6));
	assert.equal(json.exposure.turnsUnderCallCap, turn <= json.caps.call);
	assert.equal(json.exposure.maximalTurnsUnderStoreCap, Math.floor(json.caps.store / turn));
	assert.equal(json.exposure.maximalCallsUnderProbeCeiling, Math.floor(0.15 / turn));
	assert.equal(json.verdict, "ARMABLE");
	assert.ok(json.caps.call > 0 && json.caps.run > 0 && json.caps.store > 0, "the caps come from the tracked defaults file (#5047)");
}

// --- 3. presence, never a value ---------------------------------------------------------------------------
{
	const sentinel = ["sk-", "probe", "sentinel", "Qz7K", "9mLt"].join(""); // built by concatenation: never scannable in-source
	const { json, stdout } = run(
		{
			DURIG_VERIFIER_API_KEY: sentinel,
			DURIG_VERIFIER_PRICE_USD_IN: "0.037",
			DURIG_VERIFIER_PRICE_USD_OUT: "0.17",
		},
		[`--base=${BASE}`, `--model=${MODEL}`],
	);
	assert.equal(json.spec.keyPresentInEnv, true, "the tool must report PRESENCE of the variable it will use");
	assert.equal(json.spec.apiKeyEnv, "DURIG_VERIFIER_API_KEY");
	assert.ok(!stdout.includes(sentinel), "the tool must never print the credential value");
}

// --- 4. runnable where the work happens: no operator config file, and no model/base is a refusal -----------
{
	const { status, json } = run({}, ["--config=.spike/definitely-not-a-config.json", `--base=${BASE}`, `--model=${MODEL}`]);
	assert.notEqual(status, 2, "a tree with only the tracked defaults (an item worktree) must still run the instrument");
	assert.equal(json.operatorConfig, null, "and it must say which file it did NOT read");
	const bad = run({}, ["--model="]);
	assert.equal(bad.status, 2, "an incomplete spec is a refusal, not a silent default");
	assert.equal(bad.json, null, "a refusal prints no json — an exit code with no parsable output is the point");
	assert.match(bad.stderr, /cause:spec_incomplete/);
}

console.log("verifier-arm-probe: OK");
