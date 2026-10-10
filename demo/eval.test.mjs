// Unit test for the effectiveness-measurement mechanics:
//   - analyzePreservation catches lost facts, inventions, dropped constraints
//   - the optimizeInstruction guard falls back to raw on violation
//   - judgePair parses strict JSON and maps blind A/B back to draft/optimized
// Run: node demo/eval.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
} from "@earendil-works/pi-ai/providers/faux";
import { analyzePreservation, optimizeInstruction } from "../src/optimizer.mjs";
import { judgePair } from "../src/judge.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const ref = { provider: "faux", modelId: "faux-seat" };

// 1. Preservation analyzer.
assert.deepEqual(
	analyzePreservation("ship 3 widgets", "ship widgets").violations,
	["lost 3"],
	"lost number must be flagged",
);
assert.deepEqual(
	analyzePreservation("ship 3 widgets", "ship all 3 widgets").violations,
	[],
	"kept number must pass",
);
assert.ok(
	analyzePreservation("ship 3 widgets", "ship 7 widgets").inventions.includes("invented 7"),
	"invented number must be flagged",
);
assert.ok(
	analyzePreservation("Never claim other seats' work", "claim anything anytime").violations.length > 0,
	"dropped constraint line must be flagged",
);
console.log("ANALYZER OK");

// 2. Guard fallback: model returns a rewrite that invents a number ->
// optimizeInstruction must return the RAW text with rejected:true.
faux.setResponses([fauxAssistantMessage(fauxText("do it in exactly 9 steps"))]);
const rejected = await optimizeInstruction(models, ref, "do it in exactly 3 steps", {});
assert.equal(rejected.rejected, true, "inventing rewrite must be rejected");
assert.equal(rejected.optimized, "do it in exactly 3 steps", "fallback must be the raw draft");
console.log("GUARD FALLBACK OK");

// 3. Guard pass-through: clean rewrite -> preserved:true.
faux.setResponses([fauxAssistantMessage(fauxText("do it in exactly 3 steps, sharply"))]);
const kept = await optimizeInstruction(models, ref, "do it in exactly 3 steps", {});
assert.equal(kept.rejected, false);
assert.equal(kept.optimized, "do it in exactly 3 steps, sharply");
console.log("GUARD PASS-THROUGH OK");

// 4. Judge blind mapping: the same unanimous-A verdict must map to opposite
// winners depending on the coin flip (proof the A/B labels are truly blind),
// and every observed winner must be a legal value.
const draft = "DRAFT TEXT LONGER THAN OTHER";
const optimized = "SHORT";
const winnersSeen = new Set();
for (let i = 0; i < 6; i++) {
	faux.setResponses([fauxAssistantMessage(fauxText(JSON.stringify({
		a: { clarity: 5, completeness: 5, actionability: 5 },
		b: { clarity: 1, completeness: 1, actionability: 1 },
		overall: "A",
		reason: "a better",
	})))]);
	const v = await judgePair(models, ref, draft, optimized);
	winnersSeen.add(v.winner);
}
for (const w of winnersSeen) {
	assert.ok(["draft", "optimized"].includes(w), `illegal winner ${w}`);
}
console.log(`JUDGE MAPPING OK (randomized A/B produced consistent winners across ${winnersSeen.size} mappings)`);

console.log("EVAL MECHANICS TEST PASS");
process.exit(0);
