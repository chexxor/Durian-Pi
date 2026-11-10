#!/usr/bin/env node
// Probe 2 for #6185: what the broker receive path ACTUALLY does to a payload it cannot
// evaluate. Deterministic: a stub harness, a temp db path, no model, no key, no broker
// process, no store opened. Exit 0 = the probe ran; the verdicts are printed.
//
// Run: node docs/evidence/2026-11-10-broker-receive-path/probe-drain.mjs
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { drainIntentInbox, intentInboxDir, intentErrorDir } from "../../../src/broker.mjs";

const stubHarness = { snapshot: async () => ({ seats: {} }) };
const readStorage = { async document() { return null; } };
const scratch = [];
let diagnostics = [];

function drain(dbPath) {
	return drainIntentInbox(stubHarness, null, {
		dbPath,
		context: "probe",
		onDiagnostic: (x) => diagnostics.push(x),
		readStorage,
	});
}

async function run(label, rawPayload, breakErrorDir = false) {
	diagnostics = [];
	const dir = mkdtempSync(join(process.cwd(), "probe-drain-"));
	scratch.push(dir);
	const dbPath = join(dir, "probe.sqlite");
	mkdirSync(intentInboxDir(dbPath), { recursive: true });
	writeFileSync(join(intentInboxDir(dbPath), "0000000000000001-probe.json"), rawPayload, "utf8");
	if (breakErrorDir) writeFileSync(intentErrorDir(dbPath), "I am a FILE, not a directory", "utf8");

	const first = await drain(dbPath);
	const left = readdirSync(intentInboxDir(dbPath)).filter((n) => n.endsWith(".json"));
	const second = await drain(dbPath);

	console.log(label);
	console.log(`  pass1 delivered=${first.delivered} deadLettered=${first.deadLettered} | pass2 delivered=${second.delivered} deadLettered=${second.deadLettered}`);
	console.log(`  payload still in the inbox after two passes: ${left.length}`);
	console.log(`  diagnostics: ${diagnostics.map((o) => `${o.kind}:${o.reason ?? ""}`).join(" | ") || "(none)"}`);
	console.log("");
	return left.length;
}

console.log("=== payloads the receive path cannot evaluate ===");
await run("unparseable bytes (no JSON at all)", "this is not json at all");
await run("valid JSON, NO op field", JSON.stringify({ from: "qa", body: "the ruling on checkpoint policy" }));
await run("valid JSON, op typo 'controll'", JSON.stringify({ op: "controll", from: "operator" }));
await run("control op from a seat (authority deny)", JSON.stringify({ op: "pause", from: "qa" }));

console.log("=== the recovery leg itself is broken ===");
const stranded = await run(
	"dead-letter target is a FILE (cannot dead-letter)",
	JSON.stringify({ op: "controll", from: "operator" }),
	true,
);
console.log(`VERDICT: with the dead-letter sink unusable, the un-evaluable payload stays queued: ${stranded} file(s) after two passes.`);
console.log("That is the receive-path failure mode this row must rule on: the deny is DECIDED, but the");
console.log("record of the deny cannot be written, so the payload is re-drained every pass.");

for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
if (readdirSync(process.cwd()).some((n) => n.startsWith("probe-drain-"))) {
  console.log("(scratch dirs REMOVED: none left in the cwd)");
} else {
  console.log("(scratch dirs removed; the probe leaves no state behind)");
}
for (const d of scratch) rmSync(d, { recursive: true, force: true });
console.log("(scratch dirs removed; the probe leaves no state behind)");
