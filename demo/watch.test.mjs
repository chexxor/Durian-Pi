// Streaming watch test (MVP burn-down #3): `durig watch` must emit an
// initial snapshot and then push live updates when another process commits
// queue changes — without itself driving any work (viewer mode).
// Run: node demo/watch.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RigQueue, Router, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-watch-"));
const db = join(dir, "rig.sqlite");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

async function writerHarness() {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	harness.resume();
	return harness;
}

try {
	// Seed: a seat and one queued item, committed by a writer that closes.
	{
		const harness = await writerHarness();
		await harness.commit(async (tx) => {
			const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, "worker", worker.id, "implementation");
			const { enqueueItem } = await import("../src/rig.mjs");
			await enqueueItem(tx, "boss", "worker", "First item", "Seed body.");
		}, ctx);
		await harness.close(ctx);
	}

	// Start the long-running watcher as its own process (viewer mode).
	const child = spawn(process.execPath, ["cli.mjs", "watch"], {
		cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const lines = [];
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		let idx;
		while ((idx = buffer.indexOf("\n")) >= 0) {
			lines.push(buffer.slice(0, idx));
			buffer = buffer.slice(idx + 1);
		}
	});
	const stderrBuf = [];
	child.stderr.on("data", (c) => stderrBuf.push(c.toString("utf8")));

	const waitForLine = async (pred, label) => {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const hit = lines.map((l) => JSON.parse(l)).find(pred);
			if (hit) return hit;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(`timed out waiting for ${label}; got ${lines.length} lines${stderrBuf.join("") ? ` stderr=${stderrBuf.join("").slice(0, 300)}` : ""}`);
	};

	const snap = await waitForLine((d) => d.seq === 1, "initial snapshot");
	assert.deepEqual(snap.queueItems.map((i) => i.subject), ["First item"], "snapshot shows seeded item");
	// The seeded worker has queued work and has never run: that IS a blocked
	// seat, and the stream must say so from the very first snapshot.
	assert.deepEqual(snap.attention,
		[{ scope: "seat", seat: "worker", kind: "idle_with_queued_work", detail: snap.attention[0]?.detail }],
		"seeded idle seat must surface as attention from snapshot one");

	// While the watcher holds its handle, a SECOND process writes to the same
	// DB. If viewers cannot coexist with writers this fails here — that would
	// be a real finding about the deployment shape, not a test bug.
	const writer = await writerHarness();
	try {
		await writer.commit(async (tx) => {
			const { enqueueItem } = await import("../src/rig.mjs");
			await enqueueItem(tx, "boss", "worker", "Second item", "Live-update body.");
		}, ctx);
	} finally {
		await writer.close(ctx);
	}

	const update = await waitForLine(
		(d) => d.seq >= 2 && d.queueItems.some((i) => i.subject === "Second item"),
		"live update for Second item",
	);
	assert.ok(update.queueItems.some((i) => i.subject === "First item"), "earlier items persist in streamed state");
	assert.deepEqual(update.attention, [{ scope: "seat", seat: "worker", kind: "idle_with_queued_work", detail: update.attention[0]?.detail }],
		"a queued item nobody claims must surface as attention in the stream");

	child.kill(); // SIGTERM on win32 maps to terminate; watcher has no cleanup debt
	// Windows keeps the sqlite file locked until the child actually exits;
	// removing the temp dir before that raises EPERM in the cleanup below.
	await new Promise((r) => {
		child.once("exit", r);
		setTimeout(() => {
			child.kill("SIGKILL");
			r();
		}, 3000);
	});

	console.log(`WATCH OK: snapshot(seq1)=["First item"] live-update(seq${update.seq})=["First item","Second item"] attention=${JSON.stringify(update.attention.map((n) => n.kind))}`);
	console.log("WATCH TEST PASS");
} finally {
	// Cleanup must not mask a test failure with its own EPERM: report and move on.
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
