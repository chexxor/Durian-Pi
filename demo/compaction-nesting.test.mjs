// demo/compaction-nesting.test.mjs — ROADMAP 331 / item #5306: a seat's per-model compaction override
// must ride INSIDE the `compaction` object the harness reads, not as a SIBLING of it.
//
// The measured defect (ROADMAP 331): `compactionSettings()` emitted `{modelOverrides}` at the top level
// and no `compaction` key at all when only per-model keys were set. `cli.mjs` spreads that object into
// `Harness.open`'s `settings`, pi-durable's `agent.js:41` merges `settings?.compaction` over
// `DEFAULT_COMPACTION_POLICY`, and a top-level `modelOverrides` is therefore read by nobody. Two
// consumers were affected: the harness (defaults stand, so a 24,576-window verifier runs the 200,000-window
// defaults) and `cli.mjs compact`'s report, which printed `{}` for a seat that had configured overrides.
//
// Failing-first rule: every check below was RED before the nesting fix, except the two baselines marked
// "shape baseline" (they pin what already worked, so a fix that breaks them is caught too).
//
// The pi-durable gate (section 3) is the one that CANNOT pass falsely: it asks the installed pi-durable
// resolver what policy a family actually resolves. On the pin this rig carries (1.3.0, lockfile-resolved)
// that resolver does not exist yet, so the demo reports the pin fact rather than pretending the override
// landed. When the pin gains `compactionPolicy`, this section becomes the real assertion automatically.
//
// Run: node demo/compaction-nesting.test.mjs  (exit 0 = pass)

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { compactionSettings } = await import(pathToFileURL(join(ROOT, "src", "config.mjs")).href);

let failures = 0;
const check = (label, cond, detail) => {
	if (!cond) failures++;
	console.log(`  ${cond ? "OK" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/* ─── 1. shape baselines: what already worked must keep working ──────────── */
console.log("\n=== 1. baselines (harness-wide keys, unchanged shape) ===");
const wide = compactionSettings({ DURIG_COMPACTION_RESERVE_TOKENS: 4096 });
check("harness-wide key lands in `compaction`", wide.compaction?.reserveTokens === 4096, JSON.stringify(wide));
check("nothing set means no override at all", Object.keys(compactionSettings({})).length === 0);

/* ─── 2. the defect: a per-model map was emitted as a SIBLING ────────────── */
console.log("\n=== 2. per-model overrides must be nested inside `compaction` ===");
const perModel = compactionSettings({
	DURIG_COMPACTION_MODEL_OVERRIDES: { "local/iq3_s": { reserveTokens: 20480 } },
});
console.log(`  compactionSettings() returned: ${JSON.stringify(perModel)}`);
check("`compaction` is present when only per-model keys are set", perModel.compaction !== undefined);
check("the model map is INSIDE `compaction`", perModel.compaction?.modelOverrides?.["local/iq3_s"]?.reserveTokens === 20480);
check("the map is no longer ALSO a top-level sibling", perModel.modelOverrides === undefined,
	"a sibling is read by nobody and reads as two shapes of the same setting");

console.log("\n=== 3. harness-wide policy AND per-model map ride together ===");
const both = compactionSettings({
	DURIG_COMPACTION_RESERVE_TOKENS: 4096,
	DURIG_COMPACTION_MODEL_OVERRIDES: { "verifier/openai/gpt-oss-120b": { keepRecentTokens: 8192 } },
});
check("the harness-wide fields survive the nesting", both.compaction?.reserveTokens === 4096, JSON.stringify(both));
check("the per-model fields are nested beside them", both.compaction?.modelOverrides?.["verifier/openai/gpt-oss-120b"]?.keepRecentTokens === 8192);

/* ─── 4. the second consumer: `cli.mjs compact`'s report of the policy in force ── */
console.log("\n=== 4. the `compact` report consumer (`compactionSettings(CFG).compaction ?? {}`) ===");
const report = compactionSettings({ DURIG_COMPACTION_MODEL_OVERRIDES: { "local/iq3_s": { reserveTokens: 20480 } } }).compaction ?? {};
check("the report is not silently empty for a seat that configured overrides", Object.keys(report).length > 0, `report = ${JSON.stringify(report)}`);

/* ─── 5. the pi-durable gate that cannot pass falsely ─────────────────────── */
console.log("\n=== 5. ask the installed pi-durable resolver what a family resolves ===");
const durableCompaction = join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "compaction.js");
const durableAgent = join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "agent.js");
if (existsSync(durableCompaction) && existsSync(durableAgent)) {
	const agent = await import(pathToFileURL(durableAgent).href);
	const compaction = await import(pathToFileURL(durableCompaction).href);
	const settings = { ...compactionSettings({ DURIG_COMPACTION_MODEL_OVERRIDES: { "local/iq3_s": { reserveTokens: 20480 } } }) };
	const stored = { compaction: { ...agent.DEFAULT_COMPACTION_POLICY, ...settings.compaction } };
	if (typeof compaction.compactionPolicy === "function") {
		const resolved = compaction.compactionPolicy(stored, { provider: "local", modelId: "iq3_s" });
		check("the configured reserve comes back for the family it was configured for",
			resolved?.reserveTokens === 20480, `resolved reserveTokens = ${resolved?.reserveTokens}`);
	} else {
		console.log("  NOTE  the installed pi-durable exports no compactionPolicy - per-model overrides are inert");
		console.log("        on this pin, whatever durig emits. Measured: DEFAULT_COMPACTION_POLICY present =",
			agent.DEFAULT_COMPACTION_POLICY !== undefined, "; compactionPolicy present = false");
		console.log("  The nesting fix is necessary but NOT sufficient: the harness must read the nested map.");
		console.log("  This branch becomes the real assertion when the pin carries the resolver.");
	}
} else {
	console.log("  SKIP  pi-durable dist not resolvable in this tree; the resolver gate could not be run.");
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — compaction nesting, ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
