// demo/deepinfra-catalog.test.mjs — the curated DeepInfra fallback catalog carries the
// models the rigs name (#1936, the -1017 model move) and refuses the rows it cannot price (#5047).
//
// `buildModels` (cli.mjs) builds the provider's catalog from `fallbackModels()` — and since #5047 from NOTHING
// ELSE: the synthesized $0 row for an unlisted MODEL_ID is gone, because an unpriced row on a metered endpoint is
// a lie about money (acceptance P2). So a model id ABSENT from this list resolves to `no_model` before any request
// is made, with the price remedy on stderr — the same property that made a seat naming `google/gemma-4-31B-it`
// (the prepared qa2 seat) a BLOCKER: presence here IS resolution.
//
// The live catalog fetch (`fetchDeepInfraModels`) is still NOT wired into `buildModels`; when it is, it goes
// through the same exposure/pricing policy.
//
// Run: node demo/deepinfra-catalog.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { fallbackModels, catalogRefusals } from "../src/providers/deepinfra-models.ts";
import { isLocalProviderId } from "../src/providers/local.mjs";

const list = fallbackModels();
const byId = new Map(list.map((m) => [m.id, m]));

// 1. The qa2 model is present — presence here IS resolution (buildModels reads THIS list).
const gemma4 = byId.get("google/gemma-4-31B-it");
assert.ok(
	gemma4,
	"google/gemma-4-31B-it must be in the fallback catalog (buildModels reads this list; without it the seat is `no_model`)",
);
assert.equal(gemma4.provider, "deepinfra");
assert.equal(gemma4.api, "openai-completions");
assert.equal(gemma4.baseUrl, "https://api.deepinfra.com/v1/openai");

// 2. The live-catalogue values (2026-10-18): 256K ctx, $0.20/$0.40, vision+chat, NO reasoning.
assert.equal(gemma4.contextWindow, 262_144, "256K context");
assert.equal(gemma4.maxTokens, 262_144);
assert.equal(gemma4.cost.input, 0.2);
assert.equal(gemma4.cost.output, 0.4);
assert.ok(gemma4.input.includes("image"), "vision input");
assert.equal(
	gemma4.reasoning,
	false,
	"reasoning MUST be false: the vendor forbids replaying previous-turn thoughts, so no thinking blocks are produced or replayed",
);
assert.equal(gemma4.thinkingLevelMap, undefined, "no reasoning means no thinking-level map");

// 3. Negative control: the lookup can fail, so the assertion above is meaningful.
assert.equal(byId.has("google/gemma-9-does-not-exist"), false, "an id not in the list is absent");

// 4. No regression: the pre-existing gemma entry stays.
assert.ok(byId.has("google/gemma-3-27b-it"), "the older gemma entry is untouched");

// 5. The operator-designated DeepSeek-V4.1-Flash-1017 build is present. It is a
// DISTINCT DeepInfra model id (not an alias of V4.1-Flash), and `buildModels`
// synthesizes only the rig-default MODEL_ID — so without this entry every seat
// moved to -1017 is `no_model` before a request is made.
const v41_1017 = byId.get("deepseek-ai/DeepSeek-V4.1-Flash-1017");
assert.ok(
	v41_1017,
	"deepseek-ai/DeepSeek-V4.1-Flash-1017 must be in the fallback catalog (buildModels reads this list)",
);
assert.equal(v41_1017.provider, "deepinfra");
assert.equal(v41_1017.api, "openai-completions");
assert.equal(v41_1017.baseUrl, "https://api.deepinfra.com/v1/openai");
// Live-catalogue values (2026-10-20): 1M ctx, $0.20/$0.60, reasoning, vision.
assert.equal(v41_1017.contextWindow, 1_048_576, "1M context");
assert.equal(v41_1017.maxTokens, 1_048_576);
assert.equal(v41_1017.cost.input, 0.2);
assert.equal(v41_1017.cost.output, 0.6);
assert.equal(v41_1017.reasoning, true, "-1017 is a reasoning model");
assert.ok(v41_1017.thinkingLevelMap, "a reasoning model carries the thinking-level map");
assert.ok(v41_1017.input.includes("image"), "vision input");

// 6. Every seat model the selfdev rig names resolves. This is the regression guard
// for the 2026-10-19 outage: the rig was pointed at -1017 while the catalog was
// not, and four seats silently produced zero assistant turns (`no_model`).
//
// A seat model names a PROVIDER, and this catalog is only one of them. `local/` and `verifier/` are
// separately registered providers (src/providers/local.mjs — D166's cross-family author/verifier split), so
// their ids are not this catalog's business. #5013: this guard exempted the `local/` LITERAL and not
// `verifier/`, so from the moment any seat named a `verifier/...` model the guard was red for ANY value — a
// guard that cannot be satisfied protects nothing, and it has been dead since D166 landed.
//
// So the exemption is READ FROM THE MODULE THAT BUILDS THOSE PROVIDERS (`isLocalProviderId` /
// LOCAL_PROVIDER_IDS), not from a prefix list inside a test: a third local provider is exempt the moment it
// is registered, and a prefix nobody registers still fails the guard. The guard asserts that a seat's model
// is resolvable by SOMETHING the rig can register — it does not, and cannot, assert that the endpoint is up:
// that lives in gitignored `durig.config.json` (#4996's mechanism), and a test must not depend on it.
const rig = JSON.parse(
	readFileSync(
		process.env.DURIG_RIG
			? new URL(process.env.DURIG_RIG, new URL("..", import.meta.url))
			: new URL("../rig.selfdev.json", import.meta.url),
		"utf8",
	),
);
// #6322: the exemption is ONE predicate over the ids src/providers/local.mjs registers (local, verifier,
// local2), so "both exemptions" cannot mean "two prefixes showed up". The check now NAMES what it exercised:
// which provider id, pointed at which served model. Two prefixes serving the SAME model id are one blind spot
// wearing two names, and a roster like that must go red.
const exemption = (seatModel) => {
	const slash = seatModel.indexOf("/");
	if (slash > 0 && isLocalProviderId(seatModel.slice(0, slash)))
		return { kind: "provider", provider: seatModel.slice(0, slash), servedModel: seatModel.slice(slash + 1) }; // a locally served provider, built by src/providers/local.mjs
	const id = seatModel.startsWith("deepinfra/") ? seatModel.slice("deepinfra/".length) : seatModel;
	return byId.has(id) || id === process.env.DURIG_MODEL ? { kind: "catalog", provider: "deepinfra", servedModel: id } : null;
};
const resolvable = (seatModel) => exemption(seatModel) !== null;

// What a roster ACTUALLY exercises, as a named report rather than a tally: every (provider -> served model)
// pair with the seats that put it there, plus the two orthogonal questions the guard must answer - is more
// than one REGISTERED provider exercised, and do the exercised providers serve more than one model?
const exerciseReport = (seats) => {
	const exercised = new Map(); // "provider -> servedModel" -> [seat names]
	const checked = [];
	for (const seat of seats) {
		if (!seat.model) continue;
		checked.push(seat.name);
		const ex = exemption(seat.model);
		if (ex?.kind !== "provider") continue;
		const key = `${ex.provider} -> ${ex.servedModel}`;
		exercised.set(key, (exercised.get(key) ?? []).concat(seat.name));
	}
	const pairs = [...exercised.keys()];
	const servedIds = [...new Set(pairs.map((p) => p.split(" -> ")[1]))];
	const providerIds = [...new Set(pairs.map((p) => p.split(" -> ")[0]))];
	return { checked, exercised, pairs, servedIds, providerIds };
};
const checkedSeats = [];
for (const seat of rig.seats) {
	if (!seat.model) continue;
	checkedSeats.push(seat.name);
	assert.ok(
		resolvable(seat.model),
		`seat "${seat.name}" names ${seat.model}, which neither a registered provider nor the fallback catalog resolves — it would be no_model`,
	);
}
const report = exerciseReport(rig.seats);
const named = () => report.pairs.map((p) => `${p} (${report.exercised.get(p).length} seat(s): ${report.exercised.get(p).join(", ")})`).join("; ");

// NON-VACUITY PAIR (#5013): the guard must still be able to BITE. Both real locally-served providers resolve,
// while a prefix no rig registers and a catalog-absent model id both fail. A green that cannot go red is not
// a guard — this is the half that was missing when the guard died silently on a provider rename.
assert.equal(
	resolvable("verifier/mistralai/ministral-3-14b-reasoning"),
	true,
	"the D166 shape resolves: a verifier provider is a provider, not a missing catalog entry",
);
assert.equal(
	resolvable("local/iq3_s"),
	true,
	"the author provider still resolves (the half that was never broken)",
);
assert.equal(
	resolvable("nosuchprovider/some-model"),
	false,
	"a prefix NOBODY registers still fails the guard — the exemption comes from the registry, not from a lenient prefix rule",
);
assert.equal(
	resolvable("deepinfra/definitely-not-in-this-catalog-9x7"),
	false,
	"a model absent from the catalog still fails it — the 2026-10-19 outage shape, which no current seat exercises",
);
assert.ok(
	checkedSeats.length >= 5,
	`the loop actually checked ${checkedSeats.length} seat models — a guard over an empty selection is vacuous`,
);
// TWO ORTHOGONAL CONDITIONS, both named (#6322). (1) more than one registered local-family provider is
// exercised — the D166 shape: the verifier provider is really used, not merely registrable. (2) those
// providers serve more than one model id. The old assertion counted provider PREFIXES, so a roster whose
// `verifier/` seat pointed at the same served model as every `local/` seat satisfied it while testing exactly
// one blind spot: exit 0 read as a verdict that was never earned.
assert.ok(
	report.providerIds.length >= 2,
	`the roster exercises ${report.providerIds.length} registered provider id(s) (${report.providerIds.join(", ")}) — the exemption is satisfied by ONE provider, so the second family is not exercised at all: ${named()}`,
);
assert.ok(
	report.servedIds.length >= 2,
	`the exempt providers all resolve to the SAME served model (${report.servedIds.join(", ")}) — two prefixes, one family, one blind spot: green but exercising nothing. What was exercised: ${named()}`,
);
// NON-VACUITY for the family condition (#6322): the SAME predicate on rosters that are not this rig, so the
// green above is provably conditional rather than a tautology.
assert.equal(
	exerciseReport([{ name: "a", model: "local/iq3_s" }, { name: "b", model: "verifier/iq3_s" }]).servedIds.length,
	1,
	"a roster where local/ and verifier/ name the SAME model is ONE family — the assertion must be able to go red on it",
);
assert.equal(
	exerciseReport([{ name: "a", model: "local/qwen3.8-flash-next-q2_0" }, { name: "b", model: "verifier/openai/gpt-oss-120b" }]).servedIds.length,
	2,
	"the shape the real rig has: two registered providers serving two different models",
);
assert.equal(
	exerciseReport([{ name: "a", model: "local/a" }, { name: "b", model: "local/b" }]).providerIds.length,
	1,
	"two models through ONE provider id exercise one provider, not two — the provider condition bites too",
);
assert.equal(
	exerciseReport([{ name: "a", model: "local/a" }]).pairs.length,
	1,
	"a single-seat roster reports exactly one exercised pair — the report measures the roster, it does not assume it",
);
// Honest limit, stated so a later reader does not over-read this: distinct served model IDS are the strongest
// thing a rig FILE can prove. Whether two ids are distinct blind-spot FAMILIES is the documentation ruling
// (src/providers/local.mjs, "WHAT THIS DOES NOT PROVE"); this demo does not claim it.

// The class, pinned: this fix rotting back into a hardcoded provider name is exactly how it died once. The
// check is scoped to the guard function's own body — a whole-file check matched its own assertion text on the
// first run, which is a trap worth naming for whoever writes the next self-lock.
const demoSrc = readFileSync(new URL(import.meta.url), "utf8");
const guardAt = demoSrc.indexOf("const exemption =");
const guardBody = demoSrc.slice(guardAt, demoSrc.indexOf("};", guardAt));
assert.ok(
	guardBody.length > 200,
	`the guard's own body is inspectable, not a one-liner (${guardBody.length} B)`,
);
assert.ok(
	!guardBody.includes('"local/'),
	'the exemption names NO provider prefix literal ("local/…") — it is read from src/providers/local.mjs',
);
assert.ok(
	guardBody.includes("isLocalProviderId"),
	"the guard asks the module that builds the providers",
);

// 7. THE VALIDATION LAYER (#5047, acceptance P6b). The curated list lives in a VENDORED file (its own header
//    says do not edit there), so the fix is not a quiet price edit: durig's seam re-prices the vendored rows from
//    a DATED source and REFUSES a row it cannot price or whose own declared geometry could spend more than the
//    operator's store cap in ONE call. The measured case: google/gemini-3.1-pro, 1,000,000 ctx at $2/$12 =
//    $14.00 per maximal call = 3.50x the whole $4 grant (D193). No run-level or store-level cap can stop the
//    FIRST call; only refusing to register the row does.
{
	const refused = catalogRefusals();
	const gemini = refused.find((r) => r.model === "google/gemini-3.1-pro");
	assert.ok(gemini, "google/gemini-3.1-pro is REFUSED registration: one maximal call costs 3.50x the store cap");
	assert.equal(gemini.cause, "over-exposed");
	assert.equal(gemini.maxCallExposureUsd, 14, "axis: USD per maximal call, computed from the row's OWN declared maxima");
	assert.equal(byId.has("google/gemini-3.1-pro"), false, "and it is not in the list a seat resolves against");
	assert.ok(
		list.every((r) => r.maxCallExposureUsd <= 4),
		`no registered row may be able to spend more than the $4 store cap in one call (worst here: ${Math.max(...list.map((r) => r.maxCallExposureUsd))})`,
	);
	const priced = list.find((r) => r.id === "deepseek-ai/DeepSeek-V4-Flash-0731");
	assert.equal(priced.cost.input, 0.06, "the DATED source re-prices the curated row (the vendored row declared $0.09 in, 1.5x the catalog) — drift is corrected, not commented");
	assert.equal(priced.priceSource, "deepinfra-catalog@2026-11-03", "every row names where its price came from (F8)");
	assert.equal(priced.priceAsOf, "2026-11-03", "and when it was true");
	const noCache = list.find((r) => r.id === "openai/gpt-oss-20b") ?? list.find((r) => r.id === "mistralai/Mistral-Small-3.2-24B-Instruct-2506");
	assert.equal(noCache.cost.cacheRead, noCache.cost.input, "no published cache price = NO discount claimed (P6)");
	const absent = list.filter((r) => r.catalogAbsent).map((r) => r.id);
	assert.ok(absent.length >= 4, `rows the live catalog does not carry stay registered but are MARKED (${absent.length}) — a seat naming one cannot be served`);
}

// 8. THE UNPRICED-MODEL PATH IS BEHAVIOUR AT THE SEAM, NOT A COMMENT (#5047, acceptance P2). `buildModels` used
//    to synthesize `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }` for any DURIG_MODEL the curated
//    list lacks. Spawn the real CLI with such an id: the row must NOT exist, the process must not pretend the
//    model resolved, and the line on stderr must say what to price.
{
	const repo = fileURLToPath(new URL("..", import.meta.url));
	const r = spawnSync(process.execPath, ["cli.mjs", "optimize", "hello world"], {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			DURIG_PROVIDER: "deepinfra",
			DURIG_MODEL: "some/vendor-not-listed",
			DURIG_DB: mkdtempSync(`${tmpdir()}/durig-5047-`),
		},
	});
	assert.match(r.stderr, /"spend":"model-unpriced"/, "the refusal is reported at the seam, not silent");
	assert.match(r.stderr, /deepinfra-prices\.json/, "the remedy names the dated price source to add the id to");
	assert.match(r.stdout, /optimizer model not found/, "and the model genuinely does not resolve — no $0 row was handed to the caller");
	assert.notEqual(r.status, 0, "a run on an unpriceable metered model exits nonzero instead of billing under a $0 label");
}

console.log(
	`DEEPINFRA CATALOG PASS (google/gemma-4-31B-it present: ${gemma4.contextWindow} ctx, $${gemma4.cost.input}/$${gemma4.cost.output}, reasoning=${gemma4.reasoning}, vision; deepseek-ai/DeepSeek-V4.1-Flash-1017 present: ${v41_1017.contextWindow} ctx; ${checkedSeats.length} rig seat models resolve; exemption exercised as ${named()} = ${report.providerIds.length} provider id(s) over ${report.servedIds.length} served model(s); ${list.length} entries; ${catalogRefusals().length} row(s) refused by the validation layer)`,
);
