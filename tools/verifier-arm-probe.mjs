// Arming-cost instrument for a metered (paid) provider class. Offline: it NEVER sends a request and NEVER prints a
// credential VALUE - it names the variable and reports whether it is present. Promoted from
// `.spike/delegate-20261105/verifier-arm-probe.mjs` by #5125, because `.spike/` is gitignored and a cited
// instrument that is not in `tools/` is gone next session (#5120).
//
// Two fixes over the spike copy, both learned from this run:
//   1. the spike read `durig.config.json` unconditionally and THREW in a fresh item worktree (measured: ENOENT) -
//      an instrument that cannot run in the tree where work happens is not an instrument;
//   2. the spike exited 0 while printing `price: null`. ROADMAP 272 says an unpriced metered endpoint makes
//      `createLocalProvider` refuse with `metered-endpoint-unpriced` and register NO model row, i.e. a half-armed
//      roster that looks configured. A pre-flight that reports the defect and exits green is the same false-green
//      class as the `gate2.mjs` probe #5090 replaced. So exit codes here are: 0 priced and arming-shaped,
//      1 the arm is NOT armable (unpriced / spec missing), 2 the instrument could not run.
//
// Usage:
//   node tools/verifier-arm-probe.mjs [--family=VERIFIER|LOCAL] [--model=ID] [--base=URL] [--config=PATH]
//                                     [--ceiling=USD]
//   Prices resolve through `declaredPrice` (src/providers/local.mjs): <FAMILY>PRICE_USD_IN / _USD_OUT /
//   _USD_CACHE_READ / _AS_OF, then <FAMILY>PRICE_JSON or the shared DURIG_PRICE_JSON (DeepInfra catalog shape).
//   Run: node tools/verifier-arm-probe.mjs --family=VERIFIER --base=https://api.deepinfra.com/v1/openai \
//          --model=openai/gpt-oss-120b --ceiling=0.15
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_KEYS, looksLikeSecret } from "../src/config.mjs";
import { endpointClass, localProviderSpec } from "../src/providers/local.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function flag(argv, name, fallback = undefined) {
	const hit = argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
}

const argv = process.argv.slice(2);
const family = (flag(argv, "family", process.env.DURIG_PROBE_FAMILY ?? "VERIFIER").toUpperCase()).replace(/_$/, "");
const prefix = `DURIG_${family}_`;

const defaultsPath = join(ROOT, "durig.config.default.json");
const configPath = resolve(ROOT, flag(argv, "config", "durig.config.json"));

// The operator runtime file is OPTIONAL: an item worktree has defaults only. Report which was read.
let operatorValues = {};
let operatorConfig = null;
try {
	operatorValues = JSON.parse(readFileSync(configPath, "utf8"));
	operatorConfig = configPath;
} catch (err) {
	if (err?.code !== "ENOENT") {
		console.error(`REFUSED cause:config_unreadable path:${configPath}: ${err.message}`);
		process.exit(2);
	}
}
let defaults;
try {
	defaults = JSON.parse(readFileSync(defaultsPath, "utf8"));
} catch (err) {
	console.error(`REFUSED cause:defaults_unreadable path:${defaultsPath}: ${err.message}`);
	process.exit(2);
}

// defaults < operator file < environment, the same precedence as loadConfig; env is whitelisted to this family so a
// stray variable cannot impersonate a setting (and so the printed spec is reproducible from the command line).
const envFamily = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith(prefix)));
const cfg = { ...defaults, ...operatorValues, ...envFamily };
const model = flag(argv, "model", process.env[`${prefix}MODEL`] ?? cfg[`${prefix}MODEL`] ?? null);
const base = flag(argv, "base", process.env[`${prefix}BASE_URL`] ?? cfg[`${prefix}BASE_URL`] ?? null);
if (!model || !base) {
	console.error(`REFUSED cause:spec_incomplete model:${model ?? "unset"} base:${base ?? "unset"} — pass --model= and --base= (or set ${prefix}MODEL/${prefix}BASE_URL)`);
	process.exit(2);
}

const spec = localProviderSpec({ ...cfg, [`${prefix}BASE_URL`]: base, [`${prefix}MODEL`]: model }, prefix);

const caps = {
	call: Number(defaults.DURIG_SPEND_CAP_CALL_USD),
	run: Number(defaults.DURIG_SPEND_CAP_RUN_USD),
	store: Number(defaults.DURIG_SPEND_CAP_STORE_USD),
};
const ceiling = Number(flag(argv, "ceiling", process.env.DURIG_PROBE_CEILING_USD ?? "NaN"));

const out = {
	family,
	model,
	endpoint: endpointClass(base),
	operatorConfig, // null = the tree carries only the tracked defaults (an item worktree); still runnable
	defaultsConfig: defaultsPath,
	spec: {
		contextWindow: spec.contextWindow,
		maxTokens: spec.maxTokens,
		apiKeyEnv: spec.apiKeyEnv,
		keyPresentInEnv: Boolean(process.env[spec.apiKeyEnv]), // PRESENCE only; the value is never read out
	},
	price: spec.price ?? null,
	priceSource: spec.priceSource ?? "none",
	priceAsOf: spec.priceAsOf ?? null,
	caps,
};

if (!spec.price) {
	out.verdict = "NOT-ARMABLE";
	out.cause = "metered-endpoint-unpriced"; // the same cause src/providers/spend.mjs refuses with
	out.why =
		`a metered endpoint with no declared price makes createLocalProvider refuse and register NO model row ` +
		`(ROADMAP 272): the roster would look armed and be dark. Set ${prefix}PRICE_USD_IN/${prefix}PRICE_USD_OUT ` +
		`(with ${prefix}PRICE_AS_OF) or point ${prefix}PRICE_JSON / DURIG_PRICE_JSON at a catalog snapshot with ` +
		`data[].metadata.pricing - the vendored src/providers/deepinfra-prices.json is a DIFFERENT shape ` +
		`({rows:{...}}), so pointing at it prices nothing.`;
	console.log(JSON.stringify(out, null, 1));
	process.exit(1);
}

const turn = (spec.contextWindow * spec.price.in + spec.maxTokens * spec.price.out) / 1e6;
out.exposure = {
	maxCallExposureUsd: +turn.toFixed(6), // the WORST single call: a full window in, maxTokens out
	turnsUnderCallCap: turn <= caps.call,
	maximalTurnsUnderStoreCap: Number.isFinite(caps.store) ? Math.floor(caps.store / turn) : null,
	maximalCallsUnderProbeCeiling: Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling / turn) : null,
	probeCeilingUsd: Number.isFinite(ceiling) ? ceiling : null,
};
out.verdict = turn <= caps.call ? "ARMABLE" : "OVER-CALL-CAP";
console.log(JSON.stringify(out, null, 1));

// A self-check the instrument owes the operator: no credential VALUE may appear in its own output. It checks the
// actual values of every credential variable the provider path can read, so a future field that prints `apiKey`
// fails HERE rather than in a pasted report.
if (CONFIG_KEYS.includes(`${prefix}API_KEY`)) {
	console.error(`NOTE policy-gap: ${prefix}API_KEY is in CONFIG_KEYS (src/config.mjs) — a credential name should not be a file key`);
}
const printed = JSON.stringify(out);
const credentialNames = [`${prefix}API_KEY`, "DEEPINFRA_API_KEY", "DURIG_VERIFIER_API_KEY", "DURIG_LOCAL_API_KEY"];
const leaked = credentialNames.filter((n) => {
	const v = process.env[n];
	return typeof v === "string" && v.length >= 8 && printed.includes(v);
});
if (leaked.length) {
	console.error(`REFUSED cause:self_check_output_shape — the probe would print the VALUE of: ${leaked.join(", ")}`);
	process.exit(2);
}
if (Object.values(out).some((v) => typeof v === "string" && looksLikeSecret(v))) {
	console.error("REFUSED cause:self_check_output_shape — a secret-shaped value appeared in the probe's own output");
	process.exit(2);
}
process.exit(0);
