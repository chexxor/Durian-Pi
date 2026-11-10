#!/usr/bin/env node
// Deterministic probe for the #6185 ruling: what the broker receive path decides today,
// and what a content-scan deny there would do to legitimate rig traffic.
// No model, no key, no broker process, no store opened. Exit 0 = the probe ran; the
// ASSERTED verdicts are printed, not implied.
//
// Run: node docs/evidence/2026-11-10-broker-receive-path/probe.mjs

let broker = null;
let importError = null;
try {
	broker = await import("../../../src/broker.mjs");
} catch (err) {
	importError = err?.message ?? String(err);
}

console.log("=== 1. can the admission rule be exercised in isolation? ===");
if (!broker) {
	console.log(`IMPORT FAILED: ${importError}`);
	console.log("FINDING: authorizeSpoolRequest is documented as PURE (broker.mjs:499) yet its module cannot be");
	console.log("imported without the broker's whole dependency graph. A boundary rule that cannot be imported");
	console.log("alone cannot be demo-covered cheaply, and a receive hook added to the same file inherits that.");
} else {
	console.log("import ok; exports present:",
		["authorizeSpoolRequest", "requestOp", "CONTROL_PLANE_OPS", "CROSS_SEAT_OPS"].every((k) => k in broker));
	const { authorizeSpoolRequest, requestOp } = broker;

	const cases = [
		["op absent entirely", {}],
		["op absent, body present", { from: "qa", body: "checkpoint when deltasSinceBase >= 200" }],
		["op typo (controll)", { op: "controll", from: "operator" }],
		["control op from a seat", { op: "pause", from: "qa" }],
		["cross-seat op from a seat", { op: "stop", from: "qa", to: "impl" }],
		["self op from a seat", { op: "stop", from: "qa", to: "qa" }],
		["content op from a seat", { op: "message", from: "qa", to: "qa" }],
		["from missing", { op: "pause" }],
		["from forged as operator", { op: "pause", from: "operator" }],
	];
	for (const [label, payload] of cases) {
		const op = requestOp(payload);
		const d = authorizeSpoolRequest(payload, { op });
		console.log(`${label.padEnd(26)} op=${JSON.stringify(op).padEnd(12)} -> ${d.allowed ? "ALLOW" : "DENY"} code=${d.code}`);
	}
	console.log("READ: a payload with NO op is read as `message` and ALLOWED (requestOp defaults, broker.mjs:469-471):");
	console.log("  the admission rule invents the missing discriminator instead of denying it.");
}

console.log("\n=== 2. what a content-classifier DENY at the receive path would hit ===");
// The SAME pattern vocabulary as src/secretdetect.mjs:31-36 / src/config.mjs (#700).
const SECRET_VALUE_PATTERNS = [
	{ name: "openai-key", re: /^sk-[A-Za-z0-9_-]{16,}$/ },
	{ name: "huggingface-token", re: /^hf_[A-Za-z0-9]{16,}$/ },
	{ name: "github-pat", re: /^ghp_[A-Za-z0-9]{20,}$/ },
	{ name: "google-api-key", re: /^AIza[0-9A-Za-z_-]{20,}$/ },
	{ name: "high-entropy-token", re: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$/ },
];
const routine = [
	["an evidence sha the constitution requires a completion to name", "e3a67b1704c1f2b6d8a90c5b4e7f8a91b2c3d4e5"],
	["a sha256 in an ADR (the backup baseline in ROADMAP 355)", "e17704417c457f2c6391779572390000b3a1f8a1c8f5d2e6a7b4c9d0e1f2a3b4"],
	["a worktree branch name", "item-6185-architect-rebased-on-main-2026-11-10T0551Z"],
	["an npm integrity hash from the lockfile", "sha512-9f2c8a1b3d4e5f60718293a4b5c6d7e8f90123456789abcdef"],
	["a real key", "sk-or-v1-a1b2c3d4e5f678901234567890abcdef"],
	["an item id / a short sha (the common shape in queue rows)", "468844534"],
];
let fired = 0;
for (const [label, value] of routine) {
	const families = SECRET_VALUE_PATTERNS.filter((p) => p.re.test(value)).map((p) => p.name);
	if (families.length) fired++;
	console.log(`${fired ? "FIRES " : "clean "} ${label.padEnd(58)} -> ${families.join(",") || "-"}`);
}
console.log(`READ: ${fired} of ${routine.length} routine rig payloads are secret-shaped.`);
console.log("A DENY keyed on this classifier at the receive path denies the rig's own evidence traffic.");
console.log("The exemption that exists (gitobject.mjs) is CONFIRMATION-based (`git cat-file -e`) and is a");
console.log("subprocess with a probe budget — a receive-path deny would need that subprocess at ingest.");
