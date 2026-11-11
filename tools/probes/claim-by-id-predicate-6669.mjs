#!/usr/bin/env node
/*
 * claim-by-id-predicate-6669.mjs - the two claim paths answer different questions (#6669, #6667)

Lead's ruling (#6669): ONE predicate. `claim_work` by id identifies WHICH row, not WHETHER the seat may
work on it. The code today disagrees:

  src/rig.mjs:854-858  by id: `find(it => it.id === args.itemId && it.to === me && it.status === "queued")`
  src/rig.mjs:878-883  oldest: `selectOldestWorkable(...)` -> `workable()` (src/rig.mjs:320-335): status,
                       `requires`, and every `blockedBy` gate.

The comment at src/rig.mjs:848-851 asserts the whitelist is "IDENTICAL to the oldest path". It is a subset
that drops two of the three checks. This probe runs the REAL tool through a REAL harness with faux model
responses, so the verdict is a measurement, not a paraphrase of the source.

Four assertions, matching what #6667 must pin:
  A. a row gated on an unfinished prerequisite: refused by id, cause named;
  B. a row requiring a capability the seat does not advertise: refused, capability named;
  C. a row gated on a CANCELLED prerequisite: refused, gate named;
  D. an ungated row: still claims (this is not a blanket block).

Run: node tools/probes/claim-by-id-predicate-6669.mjs   exit 1 while the by-id path bypasses the predicate
*/
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { registerSeat, RigQueue, Seats, Router, workable } from "../../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.cwd(), "tmp-6669-"));
const dbPath = join(dir, "claim.sqlite");
const failures = [];
const check = (c, m, d = "") => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}${d ? ` — ${d}` : ""}`); if (!c) failures.push(m); };
const note = (m) => console.log(`  MEASURED  ${m}`);

let harness = null;
try {
	const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	harness = await Harness.open(await openNodeSqliteStorage(dbPath), { models, registry }, ctx);
	harness.resume();

	const convId = await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "impl", c.id, "implementation");
		return c.id;
	}, ctx);
	const conv = await harness.conversation(convId, ctx);

	await harness.commit(async (tx) => {
		const queue = await tx.doc(RigQueue);
		queue.items.push({ id: 1, from: "pm", to: "impl", subject: "the prerequisite", body: "do this first", status: "queued", blockedBy: [], transitions: [] });
		queue.items.push({ id: 2, from: "pm", to: "impl", subject: "gated and capability-bound", body: "needs #1 done and design", status: "queued", blockedBy: [1], requires: "design", transitions: [] });
		queue.items.push({ id: 3, from: "pm", to: "impl", subject: "the ungated control", body: "plain work", status: "queued", blockedBy: [], transitions: [] });
		queue.items.push({ id: 4, from: "pm", to: "impl", subject: "gated only", body: "needs #1 done", status: "queued", blockedBy: [1], transitions: [] });
		queue.items.push({ id: 5, from: "pm", to: "impl", subject: "gated on a cancelled row", body: "its prerequisite was dropped", status: "queued", blockedBy: [6], transitions: [] });
		queue.items.push({ id: 6, from: "pm", to: "qa", subject: "the dropped prerequisite", body: "cancelled", status: "cancelled", blockedBy: [], transitions: [] });
		queue.items.push({ id: 7, from: "pm", to: "impl", subject: "a parked row", body: "registered, do not start", status: "held", blockedBy: [], transitions: [] });
		queue.nextId = 8;
	}, ctx);

	const queue = await harness.snapshot(RigQueue, undefined, ctx);
	const seatCaps = (await harness.snapshot(Seats, undefined, ctx))?.seats?.impl?.capabilities ?? [];
	note(`impl capabilities: ${JSON.stringify(seatCaps)}`);
	for (const id of [2, 4, 5]) note(`predicate on row #${id}: ${JSON.stringify(workable(queue.items.find((i) => i.id === id), "impl", { items: queue.items, capabilities: seatCaps }))}`);

	const claimBy = async (id) => {
		const priorMaxId = (await conv.entries({}, 50, undefined, ctx)).items.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("claim_work", { itemId: id })], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("done")),
		]);
		const run = await (await conv.submit({ type: "input", content: `claim item ${id}` }, ctx)).wait(ctx);
		const row = (await harness.snapshot(RigQueue, undefined, ctx)).items.find((i) => i.id === id);
		const newEntries = (await conv.entries({ minEntryId: priorMaxId + 1 }, 50, undefined, ctx)).items;
		const toolTexts = newEntries.flatMap((e) => e.model ?? [])
			.filter((m) => m.role === "toolResult" && m.toolName === "claim_work");
		const seatRead = (toolTexts.map((m) => (m.content ?? []).map((c) => c.text ?? "").join(" ")).join(" ") || "(no claim_work tool result recorded)").slice(0, 240);
		note(`claim_work returned to the seat: ${seatRead}`);
		return { run: run.status, status: row?.status, seatRead };
	};

	const a = await claimBy(4);
	note(`run settled ${a.run}; row #4 status after a by-id claim attempt: ${a.status}`);
	check(a.status !== "claimed", "A a row gated on an unfinished prerequisite is refused by id (today it is claimed - the bypass)", `status=${a.status}`);

	const b = await claimBy(2);
	note(`row #2 status: ${b.status}`);
	check(b.status !== "claimed", "B a row requiring a capability the seat does not advertise is refused by id", `status=${b.status}`);

	const d = await claimBy(5);
	note(`row #5 status: ${d.status}`);
	check(d.status !== "claimed", "C a gate naming a CANCELLED prerequisite is refused by id", `status=${d.status}`);

	const e = await claimBy(7);
	note(`row #7 (held) status: ${e.status}; text the seat actually received: ${e.seatRead}`);
	check(!e.seatRead.includes("NO_QUEUED_WORK"), "E refusing a parked row by id must say it is HELD, not repeat the empty-queue string", `seatRead=${e.seatRead}`);

	const missing = await claimBy(999);
	note(`claim of an id that does not exist: ${missing.seatRead}`);
	check(!missing.seatRead.includes("NO_QUEUED_WORK"), "F a by-id claim of a non-existent id must say so, not report NO_QUEUED_WORK", `seatRead=${missing.seatRead}`);

	const c = await claimBy(3);
	note(`row #3 status: ${c.status}`);
	check(c.status === "claimed", "D the by-id path still claims work it is allowed to claim (not a blanket block)", `status=${c.status}`);

	console.log("\nWhat #6667 must pin, exactly");
	console.log("  the refusal must carry the reason code the predicate already produces - `gate-open:#1(queued)`,");
	console.log("  `requires:design`, `gate-cancelled:#6` - because a bare 'not claimable' is unusable to the seat (#3663);");
	console.log("  the comment at src/rig.mjs:848-851 must be corrected in the same commit. A comment asserting a property");
	console.log("  the code lacks is how a bypass survives review;");
	console.log("  src/rig.mjs:965 `if (!found) return toolText(\"NO_QUEUED_WORK\")` is the SAME string for 'nothing is");
console.log("  addressed to me' and 'the row you named is not claimable' - the seat cannot tell which happened;");
console.log("  the stalled-claim reveal (src/rig.mjs:915-925) stays a READ, and by-id must never fall back to another row.");

	console.log("\nWhat the ruling does NOT close: the conservative default");
	console.log("  src/rig.mjs:329 passes a gate id that names nothing in the queue as WORKABLE. Queue rows are never");
	console.log("  deleted - the only filtering is the view at src/rig.mjs:1463 - so a missing id is always a bad");
	console.log("  reference, not a pruned row. Measured in the #6664 census: 0 of 211 gated rows name a non-existent id,");
	console.log("  so refusing it costs nothing today. If the mint-time rule (D271, #6664) refuses such a gate at authoring");
	console.log("  while the claim path waves it through, the two disagree about what a gate means.");
} finally {
	try { await harness?.close(ctx); } catch {}
	rmSync(dir, { recursive: true, force: true });
}

process.exit(failures.length ? 1 : 0);
