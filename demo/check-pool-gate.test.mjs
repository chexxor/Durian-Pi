// demo/check-pool-gate.test.mjs — N19 "The Pool" row 7, docs/POOL-QUEUE-SPEC.md §6.4.
//
// WHAT WAS MISSING BEFORE: the pool makes eligibility a capability SET checked at CLAIM, and a row whose
// `requires` names a capability NO seat advertises is not slow work — it is INVISIBLE work. `status` counts
// it as queued, every seat's `claim_work` skips it, no wake fires for it, and nothing anywhere reported it.
// The dead-gate rule (#6215) reports the analogous shape for `blockedBy`; the pool had no reader.
//
// Two rules are proved here:
//   pool-dead-gate                 an OPEN pool row requires a capability nobody advertises (ERROR, so
//                                   `check` exits 1 — the operator has to decide, not a seat);
//   pool-claim-without-capability  a pool row whose owner-of-record does not advertise its `requires`.
//
// The audit is a pure function, so the first half runs with no store, no provider, no model. The second half
// proves the WIRING: a real store holding a real pool row makes `node cli.mjs check` exit 1, and advertising
// the capability in the rig file clears it.
//
// Run: node demo/check-pool-gate.test.mjs   (exit 0 = pass)
// Cost: measured ~6 s — the pure half is instant; the wiring half runs `up` + `check` twice with the mocked
// fauxProvider (no network, no key).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { auditRig, formatCheck, RULES } from "../src/checkup.mjs";
import { enqueueItem, RigQueue, Router } from "../src/rig.mjs";

const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-pool-gate-"));

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label} -- ${detail}`);
}

const ids = (result) => result.findings.map((f) => f.id);

// A rig clean on every OTHER rule (the hardened shape from demo/check.test.mjs), so a finding here can only
// come from the pool rules.
const baseSpec = (capabilitiesBySeat) => ({
	version: 2,
	seats: [
		{ name: "pm", role: "Coordinator", capabilities: ["route"], model: "faux/model-a" },
		{ name: "impl", role: "Implementer (author)", capabilities: capabilitiesBySeat.impl, model: "faux/model-a" },
		{ name: "verifier", role: "Independent verifier", capabilities: capabilitiesBySeat.verifier, model: "faux/model-b" },
	],
	edges: [
		{ from: "pm", maySendTo: ["impl", "verifier"] },
		{ from: "impl", maySendTo: ["pm", "verifier"] },
		{ from: "verifier", maySendTo: ["pm", "impl"] },
	],
	constitutionInline: "# Team culture\n\nGround every claim in a retrieved passage.\n",
	ownership: { "src-tools-harness": ["impl"], verification: ["verifier"] },
});

const audit = (spec, queueItems) =>
	auditRig({
		rig: "pool.rig.json",
		spec,
		specConstitution: spec.constitutionInline,
		stored: { reason: "read", text: spec.constitutionInline },
		storedSeats: spec.seats.map((s) => s.name),
		modelsBySeat: Object.fromEntries(spec.seats.map((s) => [s.name, s.model])),
		queueItems,
		featureDocs: [],
		commitMessages: [],
		textIntegrity: [],
		citations: [],
		sharedTreeBranch: "main",
		contextBySeat: {},
		docCounts: [],
	});

console.log("=== the RULES themselves are declared, not inferred ===");
const poolRuleIds = ["pool-dead-gate", "pool-claim-without-capability"];
for (const id of poolRuleIds) {
	const rule = RULES.find((r) => r.id === id);
	check(`${id} is a declared rule`, Boolean(rule), `RULES has ${RULES.length} entries, none named ${id}`);
	check(`...and it is an ERROR, so \`check\` exits nonzero on it`, rule?.severity === "error", `severity ${rule?.severity}`);
}

console.log("\n=== an OPEN pool row nobody can claim is reported ===");
const dead = audit(baseSpec({ impl: ["implement"], verifier: ["verify"] }), [
	{ id: 101, from: "pm", to: null, pool: true, subject: "Needs a DB migration", body: "", status: "queued", requires: ["implement", "db"], blockedBy: [], transitions: [] },
]);
check("the row is reported by id", ids(dead).includes("pool-dead-gate"), ids(dead).join(", "));
const deadDetail = dead.findings.find((f) => f.id === "pool-dead-gate")?.detail ?? "";
check("...and the detail names the capability nobody has", deadDetail.includes("db"), deadDetail);
check("...and names what every seat DOES advertise, so the operator can see the gap", deadDetail.includes("impl:[implement]") && deadDetail.includes("verifier:[verify]"), deadDetail);
check("...and the fix names a command that exists", /node cli\.mjs up/.test(dead.findings.find((f) => f.id === "pool-dead-gate")?.fix ?? ""), "no runnable fix");
check("one error finding is enough to fail the run", dead.exitCode === 1 && dead.summary.error === 1, JSON.stringify(dead.summary));

console.log("\n=== a row SOME seat advertises is NOT reported ===");
const covered = audit(baseSpec({ impl: ["implement", "db"], verifier: ["verify"] }), [
	{ id: 102, from: "pm", to: null, pool: true, subject: "Needs a DB migration", status: "queued", requires: ["implement", "db"], blockedBy: [] },
]);
check("no pool finding for a capability at least one seat has", !ids(covered).includes("pool-dead-gate"), ids(covered).join(", "));
check("...and the rig is clean on every rule", covered.findings.length === 0 && covered.exitCode === 0, JSON.stringify(covered.findings));

console.log("\n=== the shapes that must NOT trip it ===");
const shapes = audit(baseSpec({ impl: ["implement"], verifier: ["verify"] }), [
	// Addressed, not pooled: the author already made the promise to that seat (row 3 keeps `to` mandatory).
	{ id: 103, from: "pm", to: "impl", subject: "Addressed row", status: "queued", requires: ["db"] },
	// A pool row with no `requires`: any eligible seat may take it.
	{ id: 104, from: "pm", to: null, pool: true, subject: "No requirement", status: "queued" },
	// A ONE-capability `requires` stored as the string it has always been (row 1 compat).
	{ id: 105, from: "pm", to: null, pool: true, subject: "String requires", status: "queued", requires: "landing" },
	// A pool row that already has an owner-of-record is no longer open, and that owner advertises it.
	{ id: 106, from: "pm", to: "impl", pool: true, subject: "Claimed pool row", status: "claimed", requires: "implement" },
	// A cancelled pool row is terminal; the pool rules do not chase it.
	{ id: 107, from: "pm", to: null, pool: true, subject: "Cancelled pool row", status: "cancelled", requires: "db" },
]);
const subjects = shapes.findings.map((f) => f.subject);
check("an addressed row (no `pool` field) is not a pool row", !subjects.includes("#103"), subjects.join(", "));
check("a pool row with no `requires` is claimable by anyone", !subjects.includes("#104"), subjects.join(", "));
check("a ONE-capability `requires` written as the legacy string is still read as a SET", subjects.includes("#105"), subjects.join(", "));
check("a claimed pool row is no longer OPEN, so the dead-gate rule does not fire on it", !shapes.findings.some((f) => f.subject === "#106" && f.id === "pool-dead-gate"), JSON.stringify(shapes.findings.filter((f) => f.subject === "#106")));
check("...and a claim by an ELIGIBLE owner produces no finding at all", !subjects.includes("#106"), subjects.join(", "));
check("a CANCELLED pool row is history, not a live gate", !subjects.includes("#107"), subjects.join(", "));

console.log("\n=== the invariant: the owner of a pool row must be able to do it ===");
const orphan = audit(baseSpec({ impl: ["implement"], verifier: ["verify"] }), [
	{ id: 108, from: "pm", to: "impl", pool: true, subject: "Taken by the wrong seat", status: "claimed", requires: ["verify"], transitions: [{ at: "2026-11-12T00:00:00Z", event: "pool-claimed", by: "impl" }] },
]);
check("the claim is reported as an error", ids(orphan).includes("pool-claim-without-capability"), ids(orphan).join(", "));
check("...and the detail names the seat and the capability it lacks", (orphan.findings.find((f) => f.id === "pool-claim-without-capability")?.detail ?? "").includes("impl) requires verify which impl does not advertise"), orphan.findings.find((f) => f.id === "pool-claim-without-capability")?.detail);
check("a claim by a seat that DOES advertise the set passes", !ids(audit(baseSpec({ impl: ["implement", "verify"], verifier: ["verify"] }), [
	{ id: 109, from: "pm", to: "impl", pool: true, subject: "Claimed correctly", status: "claimed", requires: ["implement", "verify"] },
	{ id: 110, from: "pm", to: null, pool: true, subject: "Still open", status: "queued", requires: ["verify"] },
])).includes("pool-claim-without-capability"), "false positive on an eligible claimant");
check("a row whose owner is not in the rig file is left to the seat rules, not duplicated here", !ids(audit(baseSpec({ impl: ["implement"], verifier: ["verify"] }), [
	{ id: 111, from: "pm", to: "ghost", pool: true, subject: "Owner the roster does not declare", status: "claimed", requires: ["verify"] },
])).includes("pool-claim-without-capability"), "the rule invented a roster it does not have");

console.log("\n=== the report renders it, and the skipped case says why it could not run ===");
const rendered = formatCheck(dead, { rigDisplay: "pool.rig.json", seats: 3, storeReason: "read" });
check("the human report names the rule and the row", rendered.includes("pool-dead-gate") && rendered.includes("#101"), rendered.slice(0, 200));
check("a rig whose queue could not be read SKIPS the rule with a reason, never passes it", auditRig({ rig: "x", spec: baseSpec({ impl: [], verifier: [] }), specConstitution: "c", stored: { reason: "absent" } }).checks.some((c) => c.id === "pool-dead-gate" && c.status === "skipped"), "no skip record");

console.log("\n=== WIRING: a real store holding a real pool row makes `cli.mjs check` exit 1 ===");
const cli = (args, env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: durigDir,
			env: { ...process.env, DURIG_PROVIDER: "faux", ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
	 let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

const rigPath = join(dir, "pool.rig.json");
const db = join(dir, "pool.sqlite");
writeFileSync(rigPath, JSON.stringify(baseSpec({ impl: ["implement"], verifier: ["verify"] })));
const up = await cli(["up", rigPath], { DURIG_DB: db, DURIG_CONTEXT_WINDOW: JSON.stringify({ "faux/model-a": 65536, "faux/model-b": 40960 }) });
check("`up` built the rig", up.code === 0, up.stderr.slice(0, 300));

// Write the pool row the way a seat would: the SAME enqueueItem the send_work verb calls.
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
harness.resume();
const poolId = await harness.commit(async (tx) =>
	enqueueItem(tx, "pm", null, "Pool row nobody can take", "requires a capability the roster lacks", null, false, "small", false, null, ["db"], null, true),
	BACKGROUND_CONTEXT,
);
// The census needs all three numbers from ONE read, so the store also holds a row a seat CLAIMED from the
// pool and a row the SIZE gate REFUSED. The mutations are the exact ones claim_work writes (src/rig.mjs rows
// 4 + 5: `to` = the claimant, `pool` kept, one transition per cause); the claim PATH itself is proved in
// demo/pool-address.test.mjs and demo/pool-size-gate.test.mjs.
const now = new Date().toISOString();
const claimedId = await harness.commit(async (tx) => {
	const id = await enqueueItem(tx, "pm", null, "Pool row impl took", "claimed by an eligible seat", null, false, "trivial", false, null, ["implement"], null, true);
	const queue = await tx.doc(RigQueue);
	const row = queue.items.find((it) => it.id === id);
	if (!row) throw new Error("the claimed row is not in the queue");
	row.to = "impl";
	row.status = "claimed";
	row.transitions = [...(row.transitions ?? []), { at: now, event: "pool-claimed", by: "impl" }];
	return id;
}, BACKGROUND_CONTEXT);
const refusedId = await harness.commit(async (tx) => {
	const id = await enqueueItem(tx, "pm", null, "Pool row too big to claim", "the size gate refused it at claim time", null, false, "project", false, null, ["implement"], null, true);
	const queue = await tx.doc(RigQueue);
	const row = queue.items.find((it) => it.id === id);
	if (!row) throw new Error("the refused row is not the one written");
	row.transitions = [...(row.transitions ?? []), { at: now, event: "size-refused", by: "impl", reason: "too-big:project(120000 tokens > 70% of the 12288-token usable window)" }];
	return id;
}, BACKGROUND_CONTEXT);
await storage.close(BACKGROUND_CONTEXT);

const checkDead = await cli(["check", rigPath], { DURIG_DB: db });
const payload = JSON.parse(checkDead.stdout || "{}");
check("`check` exits 1 on the dead-gate row", checkDead.code === 1, `${checkDead.code}: ${checkDead.stderr.slice(0, 200)}`);
check("...and the finding is named in the JSON contract", ids(payload).includes("pool-dead-gate"), ids(payload).join(", "));
check("...and the row id it found is the one we wrote", payload.findings?.some((f) => f.subject === `#${poolId}`), JSON.stringify(payload.findings?.map((f) => f.subject)));

// Close the gap the way the fix text says: advertise the capability in the rig file, no code change.
writeFileSync(rigPath, JSON.stringify(baseSpec({ impl: ["implement", "db"], verifier: ["verify"] })));
const checkFixed = await cli(["check", rigPath], { DURIG_DB: db });
check("advertising the capability clears it, and `check` exits 0", checkFixed.code === 0, `${checkFixed.code}: ${checkFixed.stdout.slice(0, 400)}`);

const human = await cli(["check", rigPath, "--human"], { DURIG_DB: db });
check("the human check report is legible for a clean rig", human.stdout.includes("no findings") || human.stdout.includes("PASS"), human.stdout.slice(0, 300));

// Row 7's census surface: the pool is reported APART from the status counts, because a pooled row is `queued`
// and counting it there makes a rig look busy while every seat is idle.
const queueRead = await cli(["queue", "--human"], { DURIG_DB: db });
check("`queue --human` prints the pool census (open / claimed / size-refused)", /pool: 2 open, 1 claimed, 1 size-refused/.test(queueRead.stdout), queueRead.stdout.match(/pool:.*$/m)?.[0] ?? "no pool line");
const statusJson = await cli(["status", "--json"], { DURIG_DB: db });
const statusPayload = JSON.parse(statusJson.stdout || "{}");
check("`status --json` carries the pool counts separately from the status counts", statusPayload.pool?.pooled === 3 && statusPayload.pool?.open === 2 && statusPayload.pool?.ownerOfRecord === 1 && statusPayload.pool?.sizeRefused === 1, JSON.stringify(statusPayload.pool));
check("...and the gate fraction it used is stated, not implied", statusPayload.pool?.fraction === 0.7, JSON.stringify(statusPayload.pool));
check("...and seats with NO declared window are named rather than guessed at", statusPayload.pool?.seatsWithoutWindow?.length === 0, JSON.stringify(statusPayload.pool?.seatsWithoutWindow));
check("...and the refused project row is too big for EVERY windowed seat, so nobody can take it", (statusPayload.pool?.tooBig ?? []).some((t) => t.id === refusedId && t.unclaimableByAnyone && t.tooBigFor.length === 3), JSON.stringify(statusPayload.pool?.tooBig));

console.log(`\n${failures === 0 ? "POOL CHECK GATE PASS" : `POOL CHECK GATE FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
