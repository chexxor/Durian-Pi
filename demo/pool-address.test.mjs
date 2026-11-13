// demo/pool-address.test.mjs — N19 "The Pool" rows 3 (+4, +6 extended below) per docs/POOL-QUEUE-SPEC.md §6.1.
//
// WHAT WAS MISSING BEFORE: every queue row had a named recipient. "The pool" is one shared queue where an
// unaddressed row waits for whichever seat is eligible. That needs three things pinned here:
//   1. `pool: true` with NO `to` stores `to: null, pool: true` (P5: owner-of-record is set at CLAIM, not at send);
//   2. the illegal arg shapes are REFUSED, not quietly coerced — `pool` with a `to`, and no `to` without `pool`;
//   3. `requires` survives as a SET (P2) without changing how a single-capability row is stored, and the queue
//      line a seat reads says POOL rather than `to=null`.
//
// Run: node demo/pool-address.test.mjs   (exit 0 = pass)
// Cost: measured ~1 s, fauxProvider + MemoryStorage: no network, no model, no store file.
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import {
	enqueueItem,
	queueItemLine,
	registerSeat,
	RigQueue,
	Router,
	Seats,
} from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

await harness.commit(async (tx) => {
	const mk = async (name, role, caps) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId: "faux-seat" },
			instructions: `You are the ${name} seat.`,
		});
		await registerSeat(tx, name, c.id, role);
		(await tx.doc(Seats)).seats[name].capabilities = caps;
	};
	await mk("pm", "program manager", ["route", "plan"]);
	await mk("impl", "implementation engineer", ["implement", "code"]);
	await mk("qa", "verifier", ["verify"]);
}, ctx);

const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queue = async () => (await harness.snapshot(RigQueue, undefined, ctx));
const itemById = async (id) => (await queue()).items.find((it) => it.id === id);

/** Everything a seat said or saw, as one searchable string. */
async function transcript(name) {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	return pg.items.map((e) => JSON.stringify(e)).join("\n");
}

/** One scripted seat turn that makes exactly one tool call. */
async function call(name, toolName, toolArgs) {
	faux.appendResponses([
		fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("done")),
	]);
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const sub = await c.submit({ type: "input", content: "go" }, ctx);
	await sub.wait(ctx);
	return sub;
}

console.log("\n=== a POOL send stores to:null, pool:true ===");
await call("pm", "send_work", {
	pool: true,
	subject: "Fix the pool claim path",
	body: "claim_work must take pool rows",
	requires: ["implement", "code"],
	tier: "small",
});
const pool = (await queue()).items.find((it) => it.subject === "Fix the pool claim path");
check("the row exists", pool !== undefined);
check("a pooled row stores `to: null` (no recipient yet)", pool?.to === null, JSON.stringify(pool?.to));
check("a pooled row stores `pool: true`", pool?.pool === true, JSON.stringify(pool?.pool));
check(
	"a multi-capability `requires` is stored as an ARRAY",
	JSON.stringify(pool?.requires) === JSON.stringify(["implement", "code"]),
	JSON.stringify(pool?.requires),
);
check("the author is recorded, so the DONE notice has somewhere to return (P5)", pool?.from === "pm");

console.log("\n=== an ordinary send is unchanged: to is stored, pool is ABSENT ===");
await call("pm", "send_work", { to: "impl", subject: "Ordinary addressed row", body: "as before", requires: "implement" });
const addressed = (await queue()).items.find((it) => it.subject === "Ordinary addressed row");
check("an addressed row stores its recipient", addressed?.to === "impl");
check("...and NO `pool` field (absence = not pooled, §4)", addressed?.pool === undefined, JSON.stringify(addressed?.pool));
check(
	"a ONE-capability `requires` is still stored as the string it always was (byte-identical to pre-Pool rows)",
	addressed?.requires === "implement",
	JSON.stringify(addressed?.requires),
);

console.log("\n=== the illegal shapes are REFUSED, not coerced ===");
const both = await call("pm", "send_work", { pool: true, to: "impl", subject: "Contradictory", body: "x" });
void both;
const bothText = await transcript("pm");
check("pool: true with a `to` is refused", bothText.includes("SEND_WORK_REFUSED"), bothText.slice(0, 200));
check(
	"...and the refusal names what was sent, so the seat can fix it",
	bothText.includes("pool: true") && bothText.includes("cannot both be set"),
	bothText.match(/SEND_WORK_REFUSED[^"\\]{0,120}/)?.[0] ?? bothText.slice(0, 200),
);
const before = (await queue()).items.length;
await call("pm", "send_work", { subject: "No address at all", body: "x" });
const after = (await queue()).items.length;
check("neither `to` nor `pool` is refused (nothing would be addressed)", after === before, `items ${before} -> ${after}`);
check("...and no row was created", (await queue()).items.find((it) => it.subject === "No address at all") === undefined);

console.log("\n=== the queue LINE a seat reads says POOL ===");
const lines = await harness.commit(async (tx) => {
	const q = await tx.doc(RigQueue);
	return q.items.map((row) => queueItemLine(row, q.items));
}, ctx);
const poolLine = lines.find((l) => l.includes("Fix the pool claim path"));
check("a pooled, unclaimed row renders `to=POOL`, not `to=null`", poolLine?.includes("to=POOL"), poolLine);
const addressedLine = lines.find((l) => l.includes("Ordinary addressed row"));
check(
	"an addressed row still renders `to=<seat>` exactly as before",
	addressedLine?.includes("to=impl") && !addressedLine?.includes("POOL"),
	addressedLine,
);

console.log("\n=== enqueueItem's 13th argument (the write path a coordinator uses) ===");
const directId = await harness.commit(async (tx) =>
	enqueueItem(tx, "qa", null, "Direct pool row", "via enqueueItem", null, false, "trivial", false, null, ["verify"], null, true),
	ctx);
const direct = await itemById(directId);
check("enqueueItem(pool=true) stores to:null, pool:true", direct?.to === null && direct?.pool === true, JSON.stringify({ to: direct?.to, pool: direct?.pool }));

assert.ok(true);
console.log(failures === 0 ? "\nPOOL ADDRESS PASS" : `\nPOOL ADDRESS FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
