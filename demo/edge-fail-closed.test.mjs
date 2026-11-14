// demo/edge-fail-closed.test.mjs — ROADMAP 368: a malformed org edge REFUSES, it does not crash.
//
// WHY THIS EXISTS. Observed 2026-11-14 in a two-seat proof rig (`node cli.mjs send pm --body-file ...`,
// store `.spike/fleet-proof/proof.sqlite`): the pm's `send_work(to="impl")` threw
// `TypeError: Cannot read properties of undefined (reading 'includes')` at `src/rig.mjs:126` because the
// `pm` link in the Edges doc carried no `maySendTo` array. A seat cannot self-correct from a TypeError:
// it cannot tell a forbidden route from a broken store from a bad argument, so the routing step of the
// intake turn is simply lost. Fail-closed means the gate answers in the seat's own vocabulary.
//
// What this pins, in order:
//  1. `edgeProblems()` is the ONE predicate — the write side (`cli.mjs up`) and the read side
//     (`assertSendAllowed`) call the same function, so they cannot disagree about "malformed" (D212:
//     one seam, not two copies).
//  2. a link with no `maySendTo` → the gate REFUSES, the thrown object is an Error whose message names
//     the link and the remedy, and it is NOT a TypeError.
//  3. `maySendTo: []` is legal and means "grants nothing" → refused, and the message says `allowed: none`
//     instead of printing an empty list.
//  4. a malformed link anywhere in the doc does not silently open the gate for a seat that has no link.
//  5. `cli.mjs up` refuses to STORE a malformed edge (exit 1, nothing written) and accepts the fixed rig.
//
// Run: node demo/edge-fail-closed.test.mjs     (exit 0 = pass)
// Cost: measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64,
// node v24.22.1, git 2.56.0 — ~1.5 s. MemoryStorage + one bounded `cli.mjs up`; no model, no key,
// no network, no fleet wake.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { assertSendAllowed, edgeProblems, Edges, registerSeat, Router, Seats } from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

/* ───────── 1. the predicate itself ───────── */
console.log("\n=== edgeProblems is the single definition of 'malformed link' ===");
check("no edges at all is not a problem (an empty doc means the gate is open)", edgeProblems([]).length === 0);
check(
	"a link that grants nobody is a real link, not a broken one",
	edgeProblems([{ from: "pm", maySendTo: [] }]).length === 0,
);
const missing = edgeProblems([{ from: "pm" }]);
check(
	"a link with no `maySendTo` is named, with its position and its `from`",
	missing.length === 1 && missing[0].where.includes("edges[0]") && missing[0].where.includes('"pm"'),
	JSON.stringify(missing),
);
check(
	"the reason says what is wrong in words the operator can act on",
	missing[0]?.why.includes("maySendTo") && missing[0]?.why.includes("missing"),
	missing[0]?.why,
);
const nulled = edgeProblems([{ from: "pm", maySendTo: null }]);
check("`maySendTo: null` is caught too, and reports the value it found", nulled.length === 1 && nulled[0].why.includes("null"), nulled[0]?.why);
check(
	"a link with no `from` is caught",
	edgeProblems([{ maySendTo: ["impl"] }]).length === 1,
	JSON.stringify(edgeProblems([{ maySendTo: ["impl"] }])),
);
check(
	"several broken links are all reported, so one `up` fixes them in one pass",
	edgeProblems([{ from: "pm" }, { from: "lead", maySendTo: "impl" }]).length === 2,
);

/* ───────── 2. the gate, on a fixture store ───────── */
const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	await registerSeat(tx, "pm", 201, "program manager");
	await registerSeat(tx, "impl", 202, "implementation engineer");
	await registerSeat(tx, "lead", 203, "lead");
}, ctx);

/** Run the gate inside one commit and return {ok, error, isTypeError} instead of throwing. */
async function gate(from, to) {
	try {
		await harness.commit(async (tx) => assertSendAllowed(tx, from, to, null), ctx);
		return { ok: true, error: null, isTypeError: false };
	} catch (err) {
		return { ok: false, error: err?.message ?? String(err), isTypeError: err instanceof TypeError };
	}
}

async function setEdges(edges) {
	await harness.commit(async (tx) => {
	 const doc = await tx.doc(Edges);
		doc.edges = edges;
	}, ctx);
}

console.log("\n=== a link with no `maySendTo` refuses, in the seat's own words ===");
await setEdges([{ from: "pm" }]);
const broken = await gate("pm", "impl");
check("the send is refused", broken.ok === false, broken.error);
check(
	"the refusal is NOT a TypeError — a seat cannot branch on a crash",
	broken.isTypeError === false,
	broken.error,
);
check(
	"the message NAMES the malformed link and the field that is missing",
	broken.error?.includes("maySendTo") && broken.error?.includes("pm"),
	broken.error,
);
check("the message gives the remedy, not just the fact", broken.error?.includes("cli.mjs up"), broken.error);

console.log("\n=== a malformed doc does not leak a pass to a seat with no link ===");
const other = await gate("lead", "impl");
check(
	"an unrelated seat is refused too: the store is broken, so nothing is granted",
	other.ok === false && other.error?.includes("malformed"),
	other.error,
);

console.log("\n=== `maySendTo: []` is legal, and means grants-nothing ===");
await setEdges([{ from: "pm", maySendTo: [] }]);
const empty = await gate("pm", "impl");
check("the send is refused", empty.ok === false, empty.error);
check(
	"the message reads `allowed: none` rather than an empty list",
	empty.error?.includes("allowed: none"),
	empty.error,
);
check(
	"the empty link is not called malformed (it is a decision, not a defect)",
	!empty.error?.includes("malformed"),
	empty.error,
);

console.log("\n=== the healthy path is untouched ===");
await setEdges([{ from: "pm", maySendTo: ["impl"] }]);
check("pm -> impl still allowed", (await gate("pm", "impl")).ok === true);
check(
	"pm -> lead still refused with the allowed list printed exactly as before",
	(await gate("pm", "lead")).error?.includes("org edge forbids pm -> lead; allowed: impl"),
	(await gate("pm", "lead")).error,
);
await setEdges([{ from: "pm", maySendTo: ["impl"] }]);
check("a seat with no link at all is still refused ('no org edge grants...')", (await gate("lead", "impl")).error?.includes("no org edge grants lead"), (await gate("lead", "impl")).error);
await setEdges([]);
check("an empty edge doc keeps the gate open (the documented rule)", (await gate("pm", "impl")).ok === true);

/* ───────── 3. the write side: `up` refuses to store it ───────── */
const dir = mkdtempSync(join(tmpdir(), "durig-edge-fail-closed-"));
const repoRoot = join(import.meta.dirname, "..");
const db = join(dir, "proof.sqlite");
const rigFile = join(dir, "rig.json");
const env = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db };
const cli = (args) =>
	spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: repoRoot, env, encoding: "utf8", timeout: 60000 });

writeFileSync(
	rigFile,
	JSON.stringify({
		version: 2,
		seats: [
			{ name: "pm", role: "pm", capabilities: ["route"] },
			{ name: "impl", role: "impl", capabilities: ["implement"] },
		],
		edges: [{ from: "pm", maySendTo: ["impl"] }, { from: "impl" }],
	}),
);
const refused = cli(["up", rigFile, "--no-serve"]);
check("`up` exits nonzero on a malformed edge", refused.status === 1, `exit ${refused.status}: ${refused.stdout}`);
check(
	"the refusal names the broken link and the field",
	refused.stdout?.includes("maySendTo") && refused.stdout?.includes("malformed"),
	refused.stdout,
);
check("nothing is reported as created — the store was not touched", !refused.stdout?.includes('"created"'), refused.stdout);

writeFileSync(
	rigFile,
	JSON.stringify({
		version: 2,
		seats: [
			{ name: "pm", role: "pm", capabilities: ["route"] },
			{ name: "impl", role: "impl", capabilities: ["implement"] },
		],
		edges: [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }],
	}),
);
const accepted = cli(["up", rigFile, "--no-serve"]);
check("the same rig with the array written is accepted", accepted.status === 0, `exit ${accepted.status}: ${accepted.stdout}`);
check("both seats are created", accepted.stdout?.includes("pm") && accepted.stdout?.includes("impl"), accepted.stdout);

assert.ok(true);
console.log(failures === 0 ? "\nEDGE FAIL-CLOSED PASS" : `\nEDGE FAIL-CLOSED FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
