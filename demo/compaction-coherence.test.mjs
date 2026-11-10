// demo/compaction-coherence.test.mjs — ROADMAP 331: ONE harness-wide compaction policy, gated for
// coherence against every declared family AT CONFIG LOAD.
//
// The measured defect (verify #5310, relay #6069): pi-durable resolves the compaction policy ONCE, at
// Harness.open, from DEFAULT_COMPACTION_POLICY + settings.compaction. There is no per-conversation
// hook and `modelOverrides` has no reader in the pinned 1.3.0, so the per-family schedule in
// DURIG_COMPACTION_MODEL_OVERRIDES is inert. On the verifier class (window 24,576, output budget 6,000)
// the defaults leave a post-cut floor of 26,000 tokens - 105.8% of the window - which is why a qa turn
// came back `stopReason=length` with an empty reply (tasks 275457/275459).
//
// Run: node demo/compaction-coherence.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
	assertCoherentCompactionPolicy,
	compactionFamilies,
	compactionGate,
	describeConfig,
	effectiveCompactionPolicy,
	loadConfig,
	PIN_COMPACTION_DEFAULTS,
} from "../src/config.mjs";

// A verifier-class family, declared exactly as a rig declares one: a base URL, a model, a window and an
// output budget. Without the URL the family is not registered, so it is not gated - nothing invented.
const VERIFIER = {
	DURIG_VERIFIER_BASE_URL: "http://127.0.0.1:8080/v1",
	DURIG_VERIFIER_MODEL: "recursivesi-flint",
	DURIG_VERIFIER_CONTEXT: "24576",
	DURIG_VERIFIER_MAX_TOKENS: "6000",
};
const LOCAL = {
	DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8081/v1",
	DURIG_LOCAL_MODEL: "iq3_s",
	DURIG_LOCAL_CONTEXT: "204800",
	DURIG_LOCAL_MAX_TOKENS: "16384",
};

// --- 1. THE ONE POLICY, and the fact that a per-family entry does not reach it ----------------------
assert.deepEqual(
	effectiveCompactionPolicy({}),
	PIN_COMPACTION_DEFAULTS,
	"nothing set in config -> pi-durable's DEFAULT_COMPACTION_POLICY is what every family runs",
);
assert.equal(
	effectiveCompactionPolicy({ DURIG_COMPACTION_MODEL_OVERRIDES: { "verifier/*": { reserveTokens: 4096 } } }).reserveTokens,
	PIN_COMPACTION_DEFAULTS.reserveTokens,
	"a per-family override does NOT change the policy the harness resolves - it is inert on the pin (331)",
);
assert.equal(
	effectiveCompactionPolicy({ DURIG_COMPACTION_RESERVE_TOKENS: "4096" }).reserveTokens,
	4096,
	"the harness-wide key IS read: it is the one layer resolveSettings merges",
);

// The mirror constants must be the PIN's, not folklore. When the vendored pin is present, read it.
const pinDir = "node_modules/@earendil-works/pi-durable/dist/harness";
if (existsSync(join(pinDir, "agent.js"))) {
	const agent = readFileSync(join(pinDir, "agent.js"), "utf8");
	const compaction = readFileSync(join(pinDir, "compaction.js"), "utf8");
	const generation = readFileSync(join(pinDir, "generation.js"), "utf8");
	assert.match(
		agent,
		/DEFAULT_COMPACTION_POLICY = \{[\s\S]*?reserveTokens: 16384,[\s\S]*?keepRecentTokens: 20000,[\s\S]*?backgroundTokens: 32768,/,
		"the mirrored defaults are literally the pin's",
	);
	assert.match(
		agent,
		/compaction: \{ \.\.\.DEFAULT_COMPACTION_POLICY, \.\.\.settings\?\.compaction \}/,
		"resolveSettings merges ONLY settings.compaction - there is no per-family layer for it to read",
	);
	assert.equal(agent.includes("modelOverrides") || compaction.includes("modelOverrides") || generation.includes("modelOverrides"), false, "the pin has no reader for modelOverrides (331)");
	assert.match(compaction, /maxTokens: Math\.min\(Math\.floor\(0\.8 \* policy\.reserveTokens\), model\.maxTokens/, "the summary budget the gate uses is the pin's arithmetic (compaction.js)");
	assert.match(generation, /const blocking = contextWindow - policy\.reserveTokens;/, "blocking threshold: window - reserve (generation.js)");
	assert.match(generation, /const background = blocking - policy\.backgroundTokens;/, "background threshold: blocking - backgroundTokens (generation.js)");
	console.log("PIN ARITHMETIC MATCHES THE MIRROR (agent.js/compaction.js/generation.js read in this tree)");
} else {
	console.log("PIN NOT PRESENT in this tree: the mirror constants are asserted against src/config.mjs's own numbers, not re-read from node_modules");
}

// --- 2. RED-FIRST: the shipped shape is refused, with the arithmetic in the message -----------------
const shippedShape = { ...VERIFIER, DURIG_COMPACTION_MODEL_OVERRIDES: { "verifier/*": { reserveTokens: 4096, keepRecentTokens: 8192, backgroundTokens: 8192 } } };
let threw = null;
try {
	assertCoherentCompactionPolicy(shippedShape);
} catch (err) {
	threw = err;
}
assert.ok(threw, "a policy whose post-cut floor exceeds the family's window must REFUSE the config, not run");
assert.match(threw.message, /verifier\/recursivesi-flint/, "the message names the offending family");
assert.match(threw.message, /26,000 tokens/, "and the floor it computes: 20,000 kept + min(13,107, 6,000) = 26,000");
assert.match(threw.message, /24,576 \(105\.8%\)/, "and the window it does not fit in, as a percentage");
assert.match(threw.message, /modelOverrides has no reader in the pin/, "and says why the per-family entry cannot fix it");
assert.match(threw.message, /DURIG_COMPACTION_RESERVE_TOKENS=/, "and names the keys that can");

// The gate must refuse at LOAD, not merely when a helper is called.
const readFake = async (path) => {
	if (path === "durig.config.json") return JSON.stringify(shippedShape);
	const err = new Error(`ENOENT: ${path}`);
	err.code = "ENOENT";
	throw err;
};
let loadErr = null;
try {
	await loadConfig({ env: {}, readFile: readFake });
} catch (err) {
	loadErr = err;
}
assert.ok(loadErr, "loadConfig itself refuses the incoherent config (every verb goes through it)");
assert.match(loadErr.message, /incoherent compaction policy/, "the refusal is the gate's message, not a JSON parse error");

// --- 3. THE WORKED EXAMPLE THE GATE MUST ACCEPT --------------------------------------------------------
const coherent = {
	...VERIFIER,
	...LOCAL,
	DURIG_COMPACTION_RESERVE_TOKENS: "4096",
	DURIG_COMPACTION_KEEP_RECENT_TOKENS: "8192",
	DURIG_COMPACTION_BACKGROUND_TOKENS: "8192",
};
const gate = compactionGate(coherent);
assert.equal(gate.ok, true, "4096/8192/8192 is coherent for BOTH families: one policy, no per-family engine");
const byKey = Object.fromEntries(gate.verdicts.map((v) => [v.key, v]));
assert.equal(byKey["verifier/recursivesi-flint"].blocking, 20480, "verifier blocking = 24,576 - 4,096");
assert.equal(byKey["verifier/recursivesi-flint"].background, 12288, "verifier background = 20,480 - 8,192");
assert.equal(byKey["verifier/recursivesi-flint"].floor, 11468, "verifier floor = 8,192 + min(3,276, 6,000)");
assert.equal(byKey["local/iq3_s"].floor, 11468, "the same policy on the local family leaves the same 11,468-token floor");
assert.equal(byKey["local/iq3_s"].blocking, 200704, "local blocking = 204,800 - 4,096");
assert.equal(byKey["local/iq3_s"].background, 192512, "local background = 200,704 - 8,192");

// Same config, loadable through the real load path.
const loaded = await loadConfig({ env: coherent, readFile: async () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } });
assert.equal(loaded.config.DURIG_COMPACTION_RESERVE_TOKENS, "4096", "the coherent config loads");

// --- 4. THE THREE CHECKS, each tripped alone -----------------------------------------------------------
// (a) reserve >= window: blocking <= 0, so threshold compaction fires on every turn.
const tightReserve = { DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8081/v1", DURIG_LOCAL_MODEL: "iq3_s", DURIG_LOCAL_CONTEXT: "16000", DURIG_LOCAL_MAX_TOKENS: "1000", DURIG_COMPACTION_RESERVE_TOKENS: "16384", DURIG_COMPACTION_KEEP_RECENT_TOKENS: "1000", DURIG_COMPACTION_BACKGROUND_TOKENS: "100" };
let a = null;
try { assertCoherentCompactionPolicy(tightReserve); } catch (e) { a = e; }
assert.ok(a, "reserveTokens >= window is refused");
assert.match(a.message, /blocking = 0 <= 0|blocking = -384 <= 0/, "the message shows the blocking arithmetic");

// (b) floor > window, with blocking fine: window 30,000, reserve 4,096, keep 20,000 -> floor 23,276 <= 30,000 is OK;
// make keep 27,000 and it trips.
const bigKeep = { ...VERIFIER, DURIG_COMPACTION_RESERVE_TOKENS: "4096", DURIG_COMPACTION_KEEP_RECENT_TOKENS: "27000", DURIG_COMPACTION_BACKGROUND_TOKENS: "1024" };
let b = null;
try { assertCoherentCompactionPolicy(bigKeep); } catch (e) { b = e; }
assert.ok(b, "a keep budget that leaves more than the window is refused");
assert.match(b.message, /the smallest context a compaction can leave is 30,276 tokens/, "floor = 27,000 + 3,276 = 30,276 > 24,576");

// (c) background eats the whole headroom: blocking - background <= 0.
const hugeBackground = { ...VERIFIER, DURIG_COMPACTION_RESERVE_TOKENS: "4096", DURIG_COMPACTION_KEEP_RECENT_TOKENS: "4096", DURIG_COMPACTION_BACKGROUND_TOKENS: "20480" };
let c = null;
try { assertCoherentCompactionPolicy(hugeBackground); } catch (e) { c = e; }
assert.ok(c, "a background threshold at or below zero fires on every turn, so it is refused");
assert.match(c.message, /background = blocking 20,480 - backgroundTokens 20,480 = 0/, "and the message shows the subtraction");

// --- 5. NOTHING declared -> nothing gated; compaction OFF -> no arithmetic ---------------------------
assert.equal(compactionFamilies({}).length, 0, "no family is declared, so there is nothing to gate (and nothing invented)");
assert.equal(compactionGate({}).ok, true, "an undeclared rig is not refused");
const off = compactionGate({ ...VERIFIER, DURIG_COMPACTION_ENABLED: "0" });
assert.equal(off.ok, true, "compaction disabled means no thresholds run, so the floor arithmetic does not apply");
assert.match(off.skipped, /disabled/, "and the gate says why it checked nothing");

// A window declared for the DEFAULT (remote) provider is gated too: the same policy reaches it.
const remoteDeclared = { DURIG_CONTEXT_WINDOW: "20000" };
let d = null;
try { assertCoherentCompactionPolicy(remoteDeclared); } catch (e) { d = e; }
assert.ok(d, "DURIG_CONTEXT_WINDOW declares a family the harness-wide policy must fit");
assert.match(d.message, /33,107 tokens/, "floor = 20,000 kept + floor(0.8*16,384) = 33,107 (output budget not declared, so the cap is the 0.8*reserve term)");

// --- 6. describeConfig reports the policy that RUNS, not the keys that were typed -------------------
const described = describeConfig({ config: shippedShape, source: "durig.config.json" });
assert.equal(described.DURIG_COMPACTION_EFFECTIVE_POLICY.reserveTokens, 16384, "the report names the one policy pi-durable resolves");
assert.equal(described.DURIG_COMPACTION_GATE.ok, false, "and the verdict of the gate against the declared families");
assert.ok(described.DURIG_COMPACTION_GATE.verdicts.length >= 1, "every declared family's fit is printed, not just the offender");

// --- 7. END TO END: the CLI refuses at load, and accepts when coherent ------------------------------
const scratch = join(process.cwd(), "scratch");
if (!existsSync(scratch)) mkdirSync(scratch, { recursive: true });
const dir = mkdtempSync(join(scratch, "gate-"));
try {
	writeFileSync(join(dir, "bad.json"), JSON.stringify(shippedShape));
	writeFileSync(join(dir, "good.json"), JSON.stringify(coherent));
	const bad = spawnSync("node", ["cli.mjs", "config"], { env: { ...process.env, DURIG_CONFIG: join(dir, "bad.json"), DURIG_DB: join(dir, "bad.sqlite") }, encoding: "utf8" });
	assert.equal(bad.status, 1, "the CLI exits 1 on an incoherent policy: refused, not ignored");
	assert.match(bad.stderr, /incoherent compaction policy/, "the refusal names the class of failure");
	assert.match(bad.stderr, /verifier\/recursivesi-flint/, "and the family that cannot fit");
	const good = spawnSync("node", ["cli.mjs", "config"], { env: { ...process.env, DURIG_CONFIG: join(dir, "good.json"), DURIG_DB: join(dir, "good.sqlite") }, encoding: "utf8" });
	assert.equal(good.status, 0, `the same rig with a coherent policy loads: ${good.stderr}`);
	const reported = JSON.parse(good.stdout);
	assert.equal(reported.DURIG_COMPACTION_GATE.ok, true, "and `config` prints the verdict so an operator can see it without a seat");
	assert.equal(reported.DURIG_COMPACTION_EFFECTIVE_POLICY.reserveTokens, 4096, "the printed policy is the one that will run");
	console.log("CLI REFUSAL AND ACCEPTANCE OK (exit 1 with the arithmetic; exit 0 with the verdict printed)");
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("COMPACTION COHERENCE OK (one harness-wide policy, gated against every declared family at load: the shipped inert-override shape is refused with its arithmetic, the 4096/8192/8192 policy is accepted for both families, and each of the three checks is exercised separately)");
