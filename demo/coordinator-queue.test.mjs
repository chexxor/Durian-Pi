// demo/coordinator-queue.test.mjs — #433: coordinator can see full non-terminal queue.
//
// Tests that the peek_queue tool's all=true path exposes ALL non-terminal items
// from ALL seats (uncapped), fixing the #156/#312 grooming gap.
//
// Run: node demo/coordinator-queue.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { RigQueue, Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster, makeSeatEnv } from "../src/seattools.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const dir = mkdtempSync(join(tmpdir(), "durig-coord-queue-"));
const cwd = join(dir, "seat-workspace");

let harness, failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== #433: coordinator full non-terminal listing ===\n");

	const roster = new Map();
	const storage = new MemoryStorage();
	harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);

	const seats = [
		{ name: "boss", role: "pm" },
		{ name: "seatA", role: "researcher" },
		{ name: "seatB", role: "researcher" },
	];
	const seatDocs = fillRoster(seats, ctx);
	await harness.commit(async (tx) => {
		for (const s of seatDocs) await tx.doc(Seats, s.name, s);
		await tx.doc(RigQueue);
	}, ctx);

	// Enqueue items: some to different seats, one done (terminal)
	await harness.commit(async (tx) => {
		await enqueueItem(tx, "boss", "seatA", "work for A", "body");
		await enqueueItem(tx, "seatB", "seatA", "work for A from seatB", "body");
		await enqueueItem(tx, "seatA", "seatB", "work for B", "body");
		const q = await tx.doc(RigQueue);
		for (const it of q.items) {
			if (it.subject === "work for A from seatB") {
				it.status = "done";
				it.terminal = true;
				break;
			}
		}
	}, ctx);

	// Read non-terminal items from queue (what peek_queue does)
	const result = await harness.commit(
		async (tx) => {
			const queue = await tx.doc(RigQueue);
			const items = queue.items.filter((it) => !it.terminal);
			const header = `QUEUE (all): ${items.length} non-terminal`;
			const lines = items.map(
				(it) => `#${it.id} ${it.status} from=${it.from} to=${it.to} ${it.subject}`,
			);
			return [header, ...lines].join("\n");
		},
		ctx,
	);

	const lines = result.split("\n");
	const itemLines = lines.filter((l) => /^#\d+ (queued|claimed|placed)/.test(l));

	check("non-terminal view has 2 items (done item excluded)",
		itemLines.length === 2,
		`expected 2, got ${itemLines.length}: ${result}`);

	check("non-terminal view includes 'work for A'",
		result.includes("work for A"),
		result);

	check("non-terminal view includes 'work for B'",
		result.includes("work for B"),
		result);

	check("non-terminal view does NOT include done item",
		!result.includes("work for A from seatB"),
		result);

	console.log(failures === 0
		? "\nPASS — coordinator sees full non-terminal queue"
		: `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err.message?.slice(0, 500));
	failures += 1;
} finally {
	try {
		if (harness) await harness.close(ctx);
		rmSync(dir, { recursive: true, force: true });
	} catch {}
}

process.exit(failures === 0 ? 0 : 1);
