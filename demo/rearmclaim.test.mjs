// ROADMAP 42 / item #118 HALF 1 — the stalled-claim LEGAL MOVE.
// The driver re-wakes a seat holding a STALLED CLAIM (a `claimed` item whose run
// died) — but the wake says "call claim_work", and claim_work only took QUEUED
// items, so the seat got NO_QUEUED_WORK and no way to act on the item it already
// holds (impl transcript 6460/6462/6464/6465). A firmer prompt does not fix it:
// there is no legal move.
// This proves the claim path now returns the seat's OLDEST CLAIMED-BY-ME item
// (WITHOUT changing its status — a pure read) when there is no queued work, so
// the seat can advance it via complete_work/defer_work instead of looping.
//   (a) a seat with a claimed item and no queued work: claim_work returns that
//       item's id+subject (actionable), NOT NO_QUEUED_WORK;
//   (c) the revealed stalled claim is NOT re-queued (status stays `claimed`), so
//       it is never resurrected/re-driven as if new — it stays the seat's to
//       finish, and it respects the operator-stop gate upstream (selectWakes
//       never wakes a stopped seat, so this path is never reached for one);
//   (b) regression: in a SEPARATE harness, a seat with NO claimed and NO queued
//       item still gets NO_QUEUED_WORK (the claim path is not inventing work).
// Each scenario runs in its own harness with its own faux provider and store, so
// the two seat flows can never cross-contaminate in the shared mock.
// Run: node demo/rearmclaim.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { RigQueue, Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster, makeSeatEnv } from "../src/seattools.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-rearmclaim-"));
const cwd = join(dir, "seat-workspace");

/** Open a fresh harness with its OWN faux provider + store, driving the Router. */
async function freshHarness() {
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	const roster = new Map();
	const harness = await Harness.open(
		new MemoryStorage(),
		{ models, registry, env: makeSeatEnv(roster) },
		ctx,
	);
	return { harness, faux, roster };
}

/** Register one seat in the harness and return its conversation id. */
async function addSeat(harness, name) {
	let id;
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
		await registerSeat(tx, name, conv.id, "implementation");
		id = conv.id;
	}, ctx);
	return id;
}

/** Read the Seats doc for one harness and fill its roster. */
async function fillSeatRoster(roster, harness) {
	const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	fillRoster(roster, seats);
}

/**
 * Drive one seat conversation to call claim_work and return its tool-result text.
 */
async function claimResult(harness, faux, convId, claimArgs = {}) {
	const conv = await harness.conversation(convId, ctx);
	const before = await conv.submit({ type: "input", content: "go" }, ctx);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("claim_work", claimArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("handled")),
	]);
	await before.wait(ctx);
	const pg = await conv.entries({}, 50, undefined, ctx);
	const result = pg.items.find(
		(e) => e.kind === "pi.tool-result" && String(e.model?.[0]?.toolName) === "claim_work",
	);
	return result?.model?.[0]?.content?.[0]?.text ?? "";
}

let a = null;
let b = null;
let c = null;
try {
	// --- (a)+(c): a seat holds a stalled CLAIM (run died), nothing is queued. ---
	a = await freshHarness();
	const workerId = await addSeat(a.harness, "worker");

	// Enqueue one item and mark it CLAIMED (a stalled claim, no run in flight).
	const stuckId = await a.harness.commit(async (tx) => {
		const id = await enqueueItem(tx, "boss", "worker", "the stuck job", "body");
		const q = await tx.doc(RigQueue);
		const it = q.items.find((i) => i.id === id);
		it.status = "claimed";
		it.transitions.push({ at: new Date().toISOString(), event: "claimed", by: "worker" });
		return id;
	}, ctx);

	await fillSeatRoster(a.roster, a.harness);
	const resultA = await claimResult(a.harness, a.faux, workerId);

	// FAILS before the fix: claim_work returns NO_QUEUED_WORK and the seat has
	// no legal move. After the fix it reveals the stalled claim's id+subject.
	assert.match(
		resultA,
		new RegExp(`STALLED_CLAIM #${stuckId}`),
		`claim_work must reveal the seat's stalled claimed item (got: ${resultA.slice(0, 120)})`,
	);
	assert.match(resultA, /the stuck job/, "the stalled claim's subject is surfaced to act on it");

	// (c) The revealed stalled claim is NOT re-queued: status stays `claimed`.
	const qAfter = (await a.harness.documentState(RigQueue, undefined, ctx)).value.items;
	const stuck = qAfter.find((i) => i.id === stuckId);
	assert.equal(stuck.status, "claimed", "a revealed stalled claim stays claimed (not re-queued)");

	// --- (b) regression: NO claimed, NO queued -> NO_QUEUED_WORK, in a SEPARATE
	// harness so its faux flow cannot collide with scenario A. ---
	b = await freshHarness();
	const idleId = await addSeat(b.harness, "idle");
	await fillSeatRoster(b.roster, b.harness);
	const resultB = await claimResult(b.harness, b.faux, idleId);
	assert.equal(
		resultB,
		"NO_QUEUED_WORK",
		`a seat with no held claim and nothing queued still gets NO_QUEUED_WORK (got: ${resultB.slice(0, 80)})`,
	);

	// --- (d) CLAIM BY ID (#239, lead #214): name a specific item to claim, so
	// operator-priority work can be picked up even with older queued work ahead.
	// Runs in its OWN harness so its faux flow cannot collide with A/B. ---
	c = await freshHarness();
	const pickyId = await addSeat(c.harness, "picky");

	// An OLDER queued item (the oldest-queued path would grab this one)...
	const olderId = await c.harness.commit(
		(tx) => enqueueItem(tx, "boss", "picky", "the OLDER backlog job", "body"),
		ctx,
	);
	// …a NEWER queued item that the operator wants claimed by name…
	const newerId = await c.harness.commit(
		(tx) => enqueueItem(tx, "boss", "picky", "the NEWER priority job", "body"),
		ctx,
	);
	// …and a HELD item, which must NOT be claimable by id (else #90's hold is
	// defeated). It also sits oldest, so a buggy by-id path that ignored the
	// whitelist would surface here.
	const heldId = await c.harness.commit(async (tx) => {
		const id = await enqueueItem(tx, "boss", "picky", "the HELD job", "body");
		const q = await tx.doc(RigQueue);
		const it = q.items.find((i) => i.id === id);
		it.status = "held";
		it.transitions.push({ at: new Date().toISOString(), event: "held", by: "boss" });
		return id;
	}, ctx);

	await fillSeatRoster(c.roster, c.harness);
	const resultD = await claimResult(c.harness, c.faux, pickyId, { itemId: newerId });

	// The NAMED newer item is claimed…
	assert.match(
		resultD,
		new RegExp(`ITEM #${newerId}`),
		`claim_work({itemId}) must claim the NAMED item (got: ${resultD.slice(0, 120)})`,
	);
	const qD = (await c.harness.documentState(RigQueue, undefined, ctx)).value.items;
	const newer = qD.find((i) => i.id === newerId);
	assert.equal(newer.status, "claimed", "the named item became claimed");
	assert.ok(
		newer.transitions.some((t) => t.event === "claimed" && t.by === "picky"),
		"the by-id claim records the same transition (claimed, by: me) as the oldest path",
	);
	// …the OLDER queued item is untouched (by-id does not fall back to oldest)…
	assert.equal(
		qD.find((i) => i.id === olderId).status,
		"queued",
		"claiming by id leaves the older queued item untouched",
	);
	// …and the HELD item is NOT claimable by id (status whitelist == oldest path).
	const heldResult = await claimResult(c.harness, c.faux, pickyId, { itemId: heldId });
	assert.ok(
		!/ITEM #/.test(heldResult),
		`a held item must NOT be claimable by id (got: ${heldResult.slice(0, 120)})`,
	);
	assert.equal(
		qD.find((i) => i.id === heldId).status,
		"held",
		"the held item's status is unchanged by a refused by-id claim",
	);

	console.log("REARMCLAIM TEST PASS (claim_work reveals the oldest claimed-by-me item when nothing is queued, so a stalled claim is actionable; status stays claimed; no held claim -> NO_QUEUED_WORK; claim_work({itemId}) claims the named item without touching older or held items)");
} finally {
	if (a) await a.harness.close(ctx);
	if (b) await b.harness.close(ctx);
	if (c) await c.harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
