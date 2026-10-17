// demo/degeneration-text.test.mjs — the NAMED-PATTERN prose-degeneration registry, proved against
// REAL seat turns pulled from the live store (not synthetic fixtures).
//
// RED BEFORE: src/attention.mjs has no TEXT_PATTERNS registry and src/degeneration.mjs does not
// count prose patterns -> the imports fail.
// GREEN AFTER: assessRun() flags each POSITIVE turn (impl's "Emit. OK. Go. Now." loop) with a
// reason that NAMES the pattern (`degenerate-text=short-sentence-wall=...`), and does NOT flag any
// NEGATIVE turn (real healthy turns: a long lead/advocate ruling, scribe doc checks, an auditor
// probe). This is the D78 lesson applied: the heuristic is validated against the seats' own pages,
// not just against fixtures we wrote to pass.
//
// Fixtures and their provenance live in demo/fixtures/degenerate-text/README.md.
//
// Run: node demo/degeneration-text.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TEXT_PATTERNS, matchTextPatterns, countTextPatternTurns } from "../src/attention.mjs";
import { assessRun, DEGEN_DEFAULTS } from "../src/degeneration.mjs";
import { applyResets } from "../src/supervisor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures", "degenerate-text");
const readTurn = (group, file) => readFileSync(join(FIX, group, file), "utf8");
const positiveFiles = readdirSync(join(FIX, "positive")).filter((f) => f.endsWith(".txt"));
const negativeFiles = readdirSync(join(FIX, "negative")).filter((f) => f.endsWith(".txt"));

let failures = 0;
function check(label, fn) {
	try {
		fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}
async function checkAsync(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

// The RAW storage shape (D78 grounding trap): entry.model is an ARRAY of messages.
const assistant = (text) => ({
	kind: "pi.assistant",
	model: [{ role: "assistant", content: [{ type: "text", text }] }],
});
const user = (text = "You have queued work.") => ({
	kind: "pi.user",
	model: [{ role: "user", content: [{ type: "text", text }] }],
});

console.log("\n=== degeneration guard: named-pattern prose registry ===\n");

check("the registry exists and each pattern is a named, pure predicate", () => {
	assert.ok(Array.isArray(TEXT_PATTERNS) && TEXT_PATTERNS.length >= 1, "at least one pattern");
	for (const p of TEXT_PATTERNS) {
		assert.equal(typeof p.name, "string", "each pattern names itself");
		assert.equal(typeof p.detect, "function", "each pattern is a pure predicate");
		// Pure over ONE turn's text: same input -> same output, no entry/state needed.
		const sample = "Emit. OK. Go. Now.";
		assert.equal(p.detect(sample), p.detect(sample), `${p.name} is deterministic`);
	}
});

check("a default bound for the prose cause exists", () => {
	assert.ok(Number.isFinite(DEGEN_DEFAULTS.maxDegenerateText));
});

check(`positive fixtures are present (${positiveFiles.length})`, () => {
	assert.ok(positiveFiles.length >= 2, `expected the real impl loop turns, got ${positiveFiles.length}`);
});

for (const file of positiveFiles) {
	check(`POSITIVE ${file}: flagged, and the reason NAMES the pattern`, () => {
		const a = assessRun([assistant(readTurn("positive", file)), user()]);
		assert.equal(a.degenerate, true, `expected ${file} to be degenerate; reasons=${a.reasons.join(",")}`);
		const reason = a.reasons.find((r) => r.startsWith("degenerate-text="));
		assert.ok(reason, `expected a degenerate-text reason, got ${a.reasons.join(",")}`);
		assert.match(reason, /^degenerate-text=short-sentence-wall=\d+>=\d+$/, `reason must name the pattern: ${reason}`);
		assert.ok(a.degenerateText["short-sentence-wall"] >= 1, "the pattern's count is reported");
	});
}

check(`negative fixtures are present (${negativeFiles.length})`, () => {
	assert.ok(negativeFiles.length >= 4, `expected several real healthy turns, got ${negativeFiles.length}`);
});

for (const file of negativeFiles) {
	check(`NEGATIVE ${file}: NOT flagged (zero false positives)`, () => {
		const a = assessRun([assistant(readTurn("negative", file)), user()]);
		assert.equal(a.degenerate, false, `${file} must NOT be degenerate; reasons=${a.reasons.join(",")}`);
		assert.deepEqual(a.degenerateText, {}, "no prose pattern fires on a healthy turn");
	});
}

check("the pattern does not fire on a long list of DIFFERENT short lines (a healthy shape)", () => {
	const list = Array.from({ length: 90 }, (_, i) => `Row ${i} is a distinct value`).join("\n");
	assert.equal(matchTextPatterns(list).length, 0, "90 distinct short lines must not look like a loop");
});

check("the pattern DOES fire on a long unbroken run of one short line (the loop shape)", () => {
	const wall = Array.from({ length: 90 }, () => "Completing:").join("\n");
	assert.deepEqual(matchTextPatterns(wall), ["short-sentence-wall"]);
});

check("fenced code is ignored (code repeats legitimately)", () => {
	const fenced = "```\n" + Array.from({ length: 120 }, () => "Completing:").join("\n") + "\n```";
	assert.equal(matchTextPatterns(fenced).length, 0);
});

check("countTextPatternTurns counts per pattern over a page", () => {
	const wall = Array.from({ length: 90 }, () => "Emit.").join("\n");
	const counts = countTextPatternTurns([assistant(wall), assistant("Just a normal sentence."), user()]);
	assert.equal(counts["short-sentence-wall"], 1);
});

await checkAsync("applyResets names the prose pattern in the handoff", async () => {
	const handoffs = [];
	const harness = { conversation: async () => ({ reset: async (handoff) => handoffs.push(handoff) }) };
	await applyResets(
		harness,
		[{ seat: "impl", conversationId: 9, reason: "degeneration", detail: "degenerate-text=short-sentence-wall=1>=1" }],
		{},
	);
	assert.match(handoffs[0], /degenerate text/);
	assert.match(handoffs[0], /short-sentence-wall/);
});

console.log(failures === 0 ? "\nPASS — named-pattern prose registry verified against real turns" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
