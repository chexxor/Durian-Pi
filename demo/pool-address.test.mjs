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
	openPoolRow,
	queueItemLine,
	registerSeat,
	RigQueue,
	Router,
	Seats,
	selectNextWork,
} from "../src/rig.mjs";
import { selectWakes } from "../src/driver.mjs";

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

console.log("\n=== CLAIM: eligibility decides, and the claimant becomes owner-of-record (row 4, P1 + P5) ===");
const poolId = pool.id;

// An INELIGIBLE seat naming the row by id is REFUSED with a reason, not silently handed the row.
await call("qa", "claim_work", { itemId: poolId });
const qaRefusal = await transcript("qa");
check(
	"a seat missing BOTH capabilities is refused by name",
	qaRefusal.includes("CLAIM_REFUSED"),
	qaRefusal.match(/CLAIM_REFUSED[^"\\]{0,160}/)?.[0] ?? qaRefusal.slice(-300),
);
check(
	"...and the refusal names every capability it lacks (P2 AND semantics)",
	qaRefusal.includes("requires:implement,code"),
	qaRefusal.match(/requires:[a-z,]+/)?.[0] ?? "(no reason printed)",
);
const stillOpen = await itemById(poolId);
check("a refused claim does NOT take ownership", stillOpen?.to === null && stillOpen?.status === "queued", JSON.stringify({ to: stillOpen?.to, status: stillOpen?.status }));

// An ELIGIBLE seat takes it: `to` becomes the claimant, `pool` stays true, the pair is in the row's history.
await call("impl", "claim_work", { itemId: poolId });
const claimed = await itemById(poolId);
check("the claimant is recorded as owner-of-record (`to` = impl)", claimed?.to === "impl", JSON.stringify(claimed?.to));
check("`pool: true` SURVIVES the claim — provenance the census needs (P5)", claimed?.pool === true, JSON.stringify(claimed?.pool));
check("the author is unchanged, so the DONE notice still returns to pm (P5)", claimed?.from === "pm", JSON.stringify(claimed?.from));
check("the row is claimed", claimed?.status === "claimed", JSON.stringify(claimed?.status));
check(
	"a `pool-claimed` transition records the (seat, row) pair in the row's own history (P7: no side document)",
	(claimed?.transitions ?? []).some((t) => t.event === "pool-claimed" && t.by === "impl"),
	JSON.stringify(claimed?.transitions),
);
check("...and the ordinary `claimed` transition is still there too", (claimed?.transitions ?? []).some((t) => t.event === "claimed"));
check("a claimed pool row is no longer OPEN for anyone else", openPoolRow(claimed) === false, JSON.stringify({ to: claimed?.to, pool: claimed?.pool }));

// A second seat naming the same id now gets a plain refusal, not the row.
await call("qa", "claim_work", { itemId: poolId });
check("another seat cannot claim a row that already has an owner", !(await transcript("qa")).includes("ITEM #" + poolId));

console.log("\n=== the queue line a seat reads after a pool claim says WHO took it ===");
const linesAfterClaim = await harness.commit(async (tx) => {
	const q = await tx.doc(RigQueue);
	return q.items.map((row) => queueItemLine(row, q.items));
}, ctx);
check(
	"a claimed pool row renders `to=<owner> poolOwner=true`",
	linesAfterClaim.find((l) => l.includes("Fix the pool claim path"))?.includes("to=impl poolOwner=true"),
	linesAfterClaim.find((l) => l.includes("Fix the pool claim path")),
);

console.log("\n=== claim_work with NO itemId picks the first POOL row the seat is eligible for ===");
const verifyPoolId = await harness.commit(async (tx) =>
	enqueueItem(tx, "pm", null, "Pool row needing verify", "qa should take this", null, false, "trivial", false, null, ["verify"], null, true),
	ctx);
await call("qa", "claim_work", {});
const qaTook = await itemById(verifyPoolId);
check("qa took the open pool row it advertises for", qaTook?.to === "qa" && qaTook?.status === "claimed", JSON.stringify({ to: qaTook?.to, status: qaTook?.status }));

// A pool row the seat CANNOT take is skipped, and the skip is LABELED as a pool skip rather than silently
// dropped — otherwise "why is this row never claimed" is unanswerable from the seat's own reply.
const landingPoolId = await harness.commit(async (tx) =>
	enqueueItem(tx, "pm", null, "Pool row needing landing", "older than impl's own row", null, false, "trivial", false, null, "landing", null, true),
	ctx);
await call("pm", "send_work", { to: "impl", subject: "Impl's own addressed row", body: "claimable", requires: "implement" });
// impl's OLDEST workable row is the addressed one from the earlier section, so this claim renders exactly as
// it always did - no pool line, byte-identical for every seat that has no pool work in its scan.
await call("impl", "claim_work", {});
const firstClaim = await transcript("impl");
check("an addressed-only claim still renders the old header with no pool line", /ITEM #\d+ \| from=pm \| subject=Ordinary addressed row \| status=claimed(?![^\n]*POOL)/.test(firstClaim), firstClaim.match(/ITEM #[^"\\]{0,120}/)?.[0] ?? "(no claim header)");
// NOW the scan reaches the pool row impl cannot take, and the skip is LABELED as a pool skip rather than
// silently dropped - otherwise "why is this row never claimed" is unanswerable from the seat's own reply.
await call("impl", "claim_work", {});
const implReply = await transcript("impl");
check(
	"the ineligible pool row is reported as a POOL skip, with its reason",
	implReply.includes("POOL ROWS NOT WORKABLE FOR YOU") && implReply.includes(`#${landingPoolId} (requires:landing)`),
	implReply.match(/POOL ROWS NOT WORKABLE FOR YOU[^"\\]{0,120}/)?.[0] ?? "(no pool skip line)",
);
check("...and the row is NOT taken", (await itemById(landingPoolId))?.status === "queued");
check("...and impl's addressed row is the one it claimed", implReply.includes("Impl's own addressed row"));

console.log("\n=== the DONE notice from a pool claim returns to the AUTHOR, not to the pool ===");
await call("impl", "complete_work", { itemId: poolId, resultSummary: "pool claim path implemented" });
const doneNotice = (await queue()).items.find((it) => it.subject === `DONE #${poolId}: Fix the pool claim path`);
check("a DONE notice exists", doneNotice !== undefined, "no notice row");
check("...and it is addressed to pm (the author), not left in the pool", doneNotice?.to === "pm" && doneNotice?.pool === undefined, JSON.stringify({ to: doneNotice?.to, pool: doneNotice?.pool }));
check("...and it was sent BY the claimant", doneNotice?.from === "impl", JSON.stringify(doneNotice?.from));

console.log("\n=== the WAKE selector uses the SAME predicate (no wake for work a seat cannot claim) ===");
const wakeItems = [
	{ id: 9001, to: null, pool: true, status: "queued", requires: ["implement"] },
];
const wakeSkips = [];
const wakes = selectWakes({
	seats: {
		impl: { conversationId: 1, capabilities: ["implement"] },
		qa: { conversationId: 2, capabilities: ["verify"] },
	},
	items: wakeItems,
	onSkip: (s) => wakeSkips.push(s),
});
check("an eligible seat wakes for an open pool row", wakes.some((w) => w.name === "impl" && w.reason === "queued"), JSON.stringify(wakes));
check("an ineligible seat does NOT wake for it", !wakes.some((w) => w.name === "qa"), JSON.stringify(wakes));
check("...and the suppression is LOGGED as a pool gate, not as 'no work'", wakeSkips.some((s) => s.seat === "qa" && s.reason.includes("pool-gated:")), JSON.stringify(wakeSkips));

console.log("\n=== selectNextWork: an open pool row is a candidate; a claimed one is not ===");
const pickedForImpl = selectNextWork([{ id: 1, to: null, pool: true, status: "queued", requires: ["implement"] }], "impl", { capabilities: ["implement"] });
check("eligible seat sees the pool row", pickedForImpl.item?.id === 1, JSON.stringify(pickedForImpl.item));
const pickedForImpl2 = selectNextWork([{ id: 1, to: "impl", pool: true, status: "queued", requires: ["landing"] }], "qa", { capabilities: ["verify"] });
check("a claimed/ addressed pool row is not a candidate for another seat", pickedForImpl2.item === null, JSON.stringify(pickedForImpl2.item));

console.log("\n=== a row nobody can finish is CLOSED by splitting, not left as permanent almost-work (row 6) ===");
const splitParentId = await harness.commit(async (tx) =>
	enqueueItem(tx, "pm", null, "Over-sized pool row", "a project row no verifier seat can hold", null, false, "project", false, null, ["implement"], null, true),
	ctx);
await call("impl", "claim_work", { itemId: splitParentId });
const parentBefore = await itemById(splitParentId);
check("the parent was claimed by impl before the split", parentBefore?.status === "claimed", JSON.stringify(parentBefore?.status));
await call("impl", "complete_work", {
	itemId: splitParentId,
	resultSummary: "too big for one window; split into two",
	split: [
		{ subject: "Piece 1: the gate itself", body: "sizeVerdict + workable", tier: "small", requires: ["implement", "verify"] },
		{ subject: "Piece 2: the demos", body: "two demos registered", tier: "trivial" },
	],
});
const parent = await itemById(splitParentId);
const children = (await queue()).items.filter((it) => it.from === "impl" && String(it.subject).startsWith("Piece "));
check("the parent is cancelled (no new status literal, §4)", parent?.status === "cancelled", JSON.stringify(parent?.status));
check("...and says HOW it closed", parent?.closedAs === "split", JSON.stringify(parent?.closedAs));
check("...and names the children in the reason", String(parent?.cancelReason ?? "").startsWith("split into #"), parent?.cancelReason);
check(
	"a split transition records the child ids in the parent's own history (P7: no side document)",
	(parent?.transitions ?? []).some((t) => t.event === "split" && t.by === "impl" && Array.isArray(t.children) && t.children.length === 2),
	JSON.stringify(parent?.transitions),
);
check("...and the cancellation is recorded too (P8: a row leaves the pool for a NAMED cause)", (parent?.transitions ?? []).some((t) => t.event === "cancelled"));
check("the parent's tier is UNCHANGED by the split (P9: the ratchet history stays readable)", parent?.tier === "project", JSON.stringify(parent?.tier));
check("two children exist", children.length === 2, JSON.stringify(children.map((c) => c.subject)));
check("children are pooled (any eligible seat can take them)", children.every((c) => c.pool === true && c.to === null), JSON.stringify(children.map((c) => ({ to: c.to, pool: c.pool }))));
check("children come FROM the splitter", children.every((c) => c.from === "impl"), JSON.stringify(children.map((c) => c.from)));
check("a child inherits the parent's capability SET when it names none", children[1]?.requires === "implement", JSON.stringify(children[1]?.requires));
check("a child that names its OWN multi-capability set keeps it as an array", JSON.stringify(children[0]?.requires) === JSON.stringify(["implement", "verify"]), JSON.stringify(children[0]?.requires));
check("a child carries its OWN tier", children[1]?.tier === "trivial", JSON.stringify(children[1]?.tier));
const cancelledNotice = (await queue()).items.find((it) => it.subject === `CANCELLED #${splitParentId}: Over-sized pool row`);
check("the author is told the row was split (cancelItem is the one owner of close-and-notify)", cancelledNotice?.to === "pm", JSON.stringify(cancelledNotice?.to));

console.log("\n=== the two split shapes that would lose work are REFUSED ===");
await call("impl", "send_work", { pool: true, subject: "Split guard row", body: "for the two refusals", tier: "feature", requires: "implement" });
const guardId = (await queue()).items.find((it) => it.subject === "Split guard row").id;
const rowsBefore = (await queue()).items.length;
await call("impl", "claim_work", { itemId: guardId });
await call("impl", "complete_work", { itemId: guardId, resultSummary: "splitting into nothing", split: [] });
check("a split with zero children is refused", (await transcript("impl")).includes("needs at least one child item"), "no refusal text");
check("...and the row is NOT closed by it", (await itemById(guardId))?.status === "claimed", JSON.stringify((await itemById(guardId))?.status));
await call("impl", "complete_work", { itemId: guardId, resultSummary: "gate on itself", split: [{ subject: "Child gated on its parent", blockedBy: [guardId] }] });
check("a child gated on the row being split is refused (the gate would be dead on arrival)", (await transcript("impl")).includes("cannot be gated on the row being split"), "no refusal text");
check("...and no child row was created", (await queue()).items.length === rowsBefore, `rows ${rowsBefore} -> ${(await queue()).items.length}`);

await call("impl", "complete_work", { itemId: guardId, resultSummary: "split for real", split: [{ subject: "Guard piece", tier: "small", requires: "landing" }] });
const guardChildren = (await queue()).items.filter((it) => String(it.subject).startsWith("Guard piece"));
check("a valid split DOES close the row and enqueue the child", guardChildren.length === 1 && (await itemById(guardId))?.status === "cancelled", JSON.stringify({ children: guardChildren.length, status: (await itemById(guardId))?.status }));
check("a child naming ONE capability of its own is stored as the string, not an array", guardChildren[0]?.requires === "landing", JSON.stringify(guardChildren[0]?.requires));

console.log("\n=== enqueueItem's 13th argument (the write path a coordinator uses) ===");
const directId = await harness.commit(async (tx) =>
	enqueueItem(tx, "qa", null, "Direct pool row", "via enqueueItem", null, false, "trivial", false, null, ["verify"], null, true),
	ctx);
const direct = await itemById(directId);
check("enqueueItem(pool=true) stores to:null, pool:true", direct?.to === null && direct?.pool === true, JSON.stringify({ to: direct?.to, pool: direct?.pool }));

assert.ok(true);
console.log(failures === 0 ? "\nPOOL ADDRESS PASS" : `\nPOOL ADDRESS FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
