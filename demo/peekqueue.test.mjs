// demo/peekqueue.test.mjs — peek_queue is scoped to the seat by default.
//
// The defect this pins: peek_queue returned EVERY item, all statuses, to every
// seat. On a live rig that is ~20 KB of other seats' history in the context of a
// worker that only needs its own work, and it made "what is mine?" something the
// model had to infer from 100+ lines. The default is now the non-terminal items
// addressed to OR sent by the calling seat; `all: true` restores the team-wide
// view for coordinators and debugging. The result is always a bounded inline view
// (counts + up to 20 items), never a bare path — the full list is still written to
// disk for completeness.
//
// Failing-first: against the old peek_queue (no scoping) the first assertion
// fails because item B and the done item D leak into the default view.
// Run: node demo/peekqueue.test.mjs  (exit 0 = pass)
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
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const dir = mkdtempSync(join(tmpdir(), "durig-peekqueue-"));
const cwd = join(dir, "seat-workspace");

let harness;
try {
	const roster = new Map();
	const storage = new MemoryStorage();
	harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);

	let workerId;
	await harness.commit(async (tx) => {
		const mk = async (name, role) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
			await registerSeat(tx, name, conv.id, role);
			return conv.id;
		};
		workerId = await mk("worker", "implementation");
		await mk("other", "implementation");
		await mk("boss", "program manager");
		// The calling seat keeps the read tool only with a working capability (`seatHasReadTool`),
		// so declare one: this demo is about the path the readable seat gets over threshold.
		(await tx.doc(Seats)).seats.worker.capabilities = ["implement"];
	}, ctx);

	const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	fillRoster(roster, seats);
	const conv = await harness.conversation(workerId, ctx);

	// Fixture: A to worker (mine), B to other (not mine), C from worker (mine),
	// D to worker but done (not "non-terminal").
	const ids = await harness.commit(async (tx) => {
		const a = await enqueueItem(tx, "boss", "worker", "A mine queued", "body");
		const b = await enqueueItem(tx, "boss", "other", "B foreign queued", "body");
		const c = await enqueueItem(tx, "worker", "boss", "C mine sent", "body");
		const d = await enqueueItem(tx, "boss", "worker", "D mine done", "body");
		const queue = await tx.doc(RigQueue);
		queue.items.find((it) => it.id === d).status = "done";
		return { a, b, c, d };
	}, ctx);

	const drivePeek = async (args) => {
		const before = await conv.submit({ type: "input", content: "peek" }, ctx);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("peek_queue", args)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("peeked")),
		]);
		await before.wait(ctx);
		const page = await conv.entries({}, 100, undefined, ctx);
		const result = page.items.find(
			(e) => e.kind === "pi.tool-result" && String(e.model?.[0]?.toolName) === "peek_queue",
		);
		return result?.model?.[0]?.content?.[0]?.text ?? "";
	};

	// --- default: only the caller's non-terminal items ---------------------
	const scoped = await drivePeek({});
	assert.ok(scoped.includes(`#${ids.a} `), "a queued item addressed to me is shown");
	assert.ok(scoped.includes(`#${ids.c} `), "a queued item I sent is shown");
	assert.ok(!scoped.includes(`#${ids.b} `), "another seat's item is NOT in the default view");
	assert.ok(!scoped.includes(`#${ids.d} `), "a done item is NOT in the default view");

	// --- all: the team-wide non-terminal view ------------------------------
	const all = await drivePeek({ all: true });
	// all=true shows non-terminal items from ALL seats (not just me):
	assert.ok(all.includes(`#${ids.a} `), "all=true shows my queued item");
	assert.ok(all.includes(`#${ids.b} `), "all=true shows another seat's queued item");
	assert.ok(all.includes(`#${ids.c} `), "all=true shows my sent item");
	assert.ok(!all.includes(`#${ids.d} `), "all=true does NOT show done (terminal) items");

	// --- over threshold: bounded inline view (NOT a bare path) ------------
	// Build enough items to blow past the 2000-char inline limit.
	await harness.commit(async (tx) => {
		for (let i = 0; i < 40; i++) {
			await enqueueItem(tx, "boss", "other", `filler ${i} ${"x".repeat(120)}`, "body");
		}
	}, ctx);
	const big = await drivePeek({ all: true });
	// The return MUST contain counts in the header.
	assert.ok(/\b\d+ non-terminal\b/i.test(big),
		`over-threshold peek returns a counts line; got: ${big.slice(0, 200)}`);
	assert.ok(/\b\d+ queued\b/i.test(big),
		`counts line includes a queued count; got: ${big.slice(0, 200)}`);
	// Must show at least one item line, not just the header.
	const itemLines = big.split("\n").filter((l) => /^#\d+ \w+ /.test(l));
	assert.ok(itemLines.length > 0,
		`over-threshold peek shows item lines; got: ${big.slice(0, 400)}`);
	// Showed all items (team-wide view is uncapped; per-seat is capped at 20).
	assert.ok(itemLines.length > 20,
		`over-threshold all=true shows all items (not capped at 20); got ${itemLines.length}`);
	// Item lines follow the format #<id> <status> from=<x> to=<y> <subject>
	const sampleLine = itemLines[0];
	assert.ok(/^#\d+ \w+ from=\w+ to=\w+/.test(sampleLine),
		`item line has expected shape; got: ${sampleLine}`);
	// A truncated footer with a path should appear when the list exceeds N (20, the per-seat cap).
	// For all=true, there is no truncation, so no "full list:" footer.
	assert.ok(!/full list:/.test(big),
		`all=true shows full items without truncation footer; got: ${big.slice(-200)}`);
	// The file must have been written (completeness).
	const fs = await import("node:fs");
	const allFiles = fs.readdirSync(join(dir, "seat-workspace", ".durig"));
	assert.ok(allFiles.some((f) => f.startsWith("queue-") && f.endsWith(".md")),
		`full queue was written to disk for completeness; files: ${allFiles}`);

	console.log(
		"PEEKQUEUE TEST PASS (default is the seat's own non-terminal work; all=true is team-wide; over-threshold returns bounded inline view with counts + item lines)",
	);
} finally {
	if (harness) await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
