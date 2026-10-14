// Item 43(a) contract: every pi thinking level must map to an integer reasoning_effort in
// DeepInfra's documented 1..100 range (docs/ROADMAP.md item 43). Before this mapping existed
// the map carried only { off: "none" }, so a configured `thinkingLevel` was serialized as the
// raw pi level name ("medium") — a string with no place in an integer field (this is exactly
// what the pre-fix probe captured as `reasoning_effort: "medium"`).
// Run: node demo/reasoningeffort.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	DEEPINFRA_REASONING_EFFORT_BY_LEVEL,
	DEEPINFRA_THINKING_LEVELS,
	mapCatalogModel,
	THINKING_LEVEL_MAP,
} from "../src/providers/deepinfra-models.ts";

const model = mapCatalogModel({
	id: "deepseek-ai/DeepSeek-V4.1-Flash",
	metadata: { tags: ["chat", "reasoning"], context_length: 1_048_576, max_tokens: 1_048_576 },
});

// pi's own support gate must see every rung: a level pi thinks it cannot use
// never reaches the model (it clamps to a supported one), so `xhigh`/`max`
// absent from `THINKING_LEVEL_MAP` would silently drop them out of the rig.
const levels = getSupportedThinkingLevels(model);
for (const level of DEEPINFRA_THINKING_LEVELS) {
	assert.ok(levels.includes(level), `level "${level}" must be supported (got ${levels.join(",")})`);
}
assert.equal(THINKING_LEVEL_MAP.off, "none", "off must stay DeepInfra's documented spelling");

const values = DEEPINFRA_THINKING_LEVELS.map((level) => {
	const sent = model.thinkingLevelMap?.[level];
	assert.equal(typeof sent, "string", `level "${level}" must map to a string value`);
	// "off" is deliberately a word (DeepInfra's documented spelling for "no reasoning"),
	// not an integer in the 1-100 band — the band only applies to the levels that turn
	// thinking ON. Assert that split explicitly rather than letting "none" pass the
	// numeric check above.
	if (level === "off") {
		assert.equal(sent, "none", `off must map to DeepInfra's documented "none", got ${JSON.stringify(sent)}`);
		return null;
	}
	const n = Number(sent);
	assert.ok(
		Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 100,
		`level "${level}" maps to "${sent}", which is not an integer in [1,100]`,
	);
	return n;
});

// Strictly monotone: pi orders levels min -> max, so the effort it sends must
// never go down as the level goes up (a level that maps to a lower budget than
// its predecessor would invert the operator's intent and poison the A/B).
const off = values[0];
assert.equal(off, null, "off has no integer band to be monotone across");
const efforts = values.slice(1).map((n, i) => {
	assert.notEqual(n, null, `on-level ${DEEPINFRA_THINKING_LEVELS[i + 1]} must have a numeric effort`);
	return n;
});
for (let i = 1; i < efforts.length; i++) {
	assert.ok(
		efforts[i] > efforts[i - 1],
		`effort must strictly increase with level (got ${efforts[i]} after ${efforts[i - 1]})`,
	);
}
assert.ok(Math.min(...efforts) >= 1 && Math.max(...efforts) <= 100, "every on-level effort must sit within [1,100]");

// The wire value for an operator's configured level: what openai-completions.ts:971 would
// actually emit today, verbatim. `?? clamped` keeps this faithful to the serializer's own
// fallback (map miss -> raw level name), so a future regression shows up as a non-integer
// here rather than being papered over by the assertion itself.
const requested = "medium";
const clamped = clampThinkingLevel(model, requested);
assert.equal(clamped, requested, "medium is supported, so it must not clamp away");
const sentEffort = model.thinkingLevelMap?.[clamped] ?? clamped;
assert.equal(Number(sentEffort), 50, `medium must serialize to 50, got ${JSON.stringify(sentEffort)}`);

// And an off seat still gets DeepInfra's documented "none" rather than undefined (which would
// leave the field absent instead of explicitly off).
const offSent = model.thinkingLevelMap?.["off"] ?? "missing";
assert.equal(offSent, "none", "off must serialize to none");

console.log(
	`REASONING EFFORT TEST PASS (medium -> ${sentEffort}, on-efforts=[${efforts.join(",")}], off=${offSent})`,
);