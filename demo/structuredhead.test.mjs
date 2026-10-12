// ROADMAP 42 / #118 half 2 + #144 B — a tool result a seat can actually act on.
//
// Two adjacent rulings, reconciled by capability (not by seat name):
//   - a seat that CAN read the deferred file gets the STRUCTURED HEADER (id + path +
//     from/to/subject/status) and the body stays on disk (thin-context, RANK-1/#59);
//   - a seat that CANNOT read (a coordinator: `COORDINATOR_REMOVALS` strips read) gets
//     the FULL BODY INLINE, because a path it cannot open is an item it cannot act on
//     (lead #144 B). Before this, coordinators were handed a mid-body byte cut.
//
// Proves:
//   (a) a READ-TOOL seat over threshold: structured header + path, bounded, body NOT inline,
//       and the full body on disk;
//   (b) a NO-READ-TOOL seat over threshold: the FULL BODY inline (no truncation);
//   (c) a small claim stays fully inline for a read-tool seat, no file written.
// Run: node demo/structuredhead.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster, makeSeatEnv } from "../src/seattools.mjs";

const INLINE_LIMIT = 2000;
const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const dir = mkdtempSync(join(tmpdir(), "durig-structuredhead-"));
const cwd = join(dir, "seat-workspace");

let harness;
try {
	const roster = new Map();
	const storage = new MemoryStorage();
	harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);

	const ids = {};
	await harness.commit(async (tx) => {
		const mk = async (name, role, capabilities) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
			await registerSeat(tx, name, conv.id, role);
			if (capabilities) (await tx.doc(Seats)).seats[name].capabilities = capabilities;
			return conv.id;
		};
		ids.worker = await mk("worker", "implementation", ["implement"]);
		ids.coordinator = await mk("coordinator", "program manager", []);
	}, ctx);

	const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	fillRoster(roster, seats);

	const driveClaim = async (conversationId) => {
		const conv = await harness.conversation(conversationId, ctx);
		const before = await conv.submit({ type: "input", content: "go" }, ctx);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("claim handled")),
		]);
		await before.wait(ctx);
		const page = await conv.entries({}, 50, undefined, ctx);
		const result = page.items.find(
			(e) => e.kind === "pi.tool-result" && String(e.model?.[0]?.toolName) === "claim_work",
		);
		return result?.model?.[0]?.content?.[0]?.text ?? "";
	};

	const LARGE_BODY = "LARGE_".repeat(INLINE_LIMIT); // comfortably over the threshold

	// (a) READ-TOOL seat: structured header + path, body on disk, NOT inline.
	const workerItem = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "worker", "Big task for worker", LARGE_BODY), ctx);
	const workerResult = await driveClaim(ids.worker);
	assert.ok(workerResult.includes(`item #${workerItem}`), `worker result carries the id+path (got: ${workerResult.slice(0, 120)})`);
	assert.ok(workerResult.includes("subject=Big task for worker"), "worker header carries the subject");
	assert.ok(workerResult.includes("status=claimed"), "worker header carries the status");
	assert.ok(!workerResult.includes("LARGE_"), "a read-tool seat does NOT get the body inline (it has the path)");
	assert.ok(workerResult.length < INLINE_LIMIT + 400, `worker result stays bounded; got ${workerResult.length}`);
	const workerFile = join(cwd, ".durig", `${workerItem}.md`);
	assert.ok(existsSync(workerFile), "the full body is written to cwd/.durig/<id>.md for the read-tool seat");
	assert.ok(readFileSync(workerFile, "utf8").includes("LARGE_"), "the file holds the full body");

	// (b) NO-READ-TOOL seat: the full body arrives inline, because a path is unreadable to it.
	const coordItem = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "coordinator", "Big task for coordinator", LARGE_BODY), ctx);
	const coordResult = await driveClaim(ids.coordinator);
	assert.ok(coordResult.includes(`#${coordItem}`), "coordinator result identifies the item");
	assert.ok(coordResult.includes("LARGE_"), "a no-read-tool seat gets the BODY inline (no blind path)");
	assert.ok(
		coordResult.includes(LARGE_BODY),
		"and the body is not truncated — the whole thing arrives (#144 B)",
	);

	// (c) a SMALL item stays fully inline for a read-tool seat, no file written.
	const smallId = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "worker", "Small task", "small inline body"), ctx);
	const small = await driveClaim(ids.worker);
	assert.ok(small.includes("small inline body"), `small claim stays fully inline; got: ${small.slice(0, 120)}`);
	assert.ok(!existsSync(join(cwd, ".durig", `${smallId}.md`)), "under-threshold body is not written to disk");

	console.log(
		"STRUCTUREDHEAD TEST PASS (read-tool seat gets the structured head + path with the body on disk; no-read-tool seat gets the full body inline, not a byte cut; small claims stay inline)",
	);
} finally {
	if (harness) await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
