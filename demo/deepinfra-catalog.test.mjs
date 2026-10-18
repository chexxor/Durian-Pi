// demo/deepinfra-catalog.test.mjs — the curated DeepInfra fallback catalog carries the
// models the rigs name (#1936).
//
// `buildModels` (cli.mjs) builds the provider's catalog from `fallbackModels()` plus a
// synthesized entry for the rig-default MODEL_ID. The live catalog fetch
// (`fetchDeepInfraModels`) is imported NOWHERE and is NOT wired into `buildModels`, so a
// model id ABSENT from this list resolves to `no_model` before any request is made — the
// exact blocker for a seat naming `google/gemma-4-31B-it` (the prepared qa2 seat).
//
// This proves the entry is present with the live-catalogue values, so the seat RESOLVES.
// Run: node demo/deepinfra-catalog.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { fallbackModels } from "../src/providers/deepinfra-models.ts";

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

console.log(
	`DEEPINFRA CATALOG PASS (google/gemma-4-31B-it present: ${gemma4.contextWindow} ctx, $${gemma4.cost.input}/$${gemma4.cost.output}, reasoning=${gemma4.reasoning}, vision; ${list.length} entries)`,
);
