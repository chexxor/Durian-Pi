// Blocked-seat surfacing test (MVP burn-down #4): a seat that is idle with
// queued work, and a seat whose last run failed, must produce visible
// attention notices; a healthy seat must produce none. Exercises the same
// storage-level computation `durig status` and `durig watch` carry.
// Run: node demo/blocked.test.mjs  (exit 0 = pass)
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
const dir = mkdtempSync(join(tmpdir(), "durig-blocked-"));
const db = join(dir, "rig.sqlite");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

let postAbortStorage;

async function writerHarness() {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	harness.resume();
	return harness;
}

try {
	// Three seats: busy-idle (queued work, nothing in flight), failed (run
	// went unanswered), healthy (ran fine, no queue).
	const convIds = {};
	{
		const harness = await writerHarness();
		try {
			await harness.commit(async (tx) => {
				for (const name of ["idle", "failed", "healthy"]) {
					const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
					await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
					await registerSeat(tx, name, conv.id, "implementation");
					convIds[name] = conv.id;
				}
				const { enqueueItem } = await import("../src/rig.mjs");
				await enqueueItem(tx, "boss", "idle", "Build it", "For the idle seat.");
			}, ctx);
		} finally {
			await harness.close(ctx);
		}
	}

	// healthy runs once to completion; failed gets aborted mid-run.
	faux.setResponses([fauxAssistantMessage(fauxText("all done"))]);
	{
		const harness = await writerHarness();
		try {
			const healthy = await harness.conversation(convIds.healthy, ctx);
			const run = await healthy.submit({ type: "input", content: "go" }, ctx);
			await run.wait(ctx);

			const failed = await harness.conversation(convIds.failed, ctx);
			const doomed = await failed.submit({ type: "input", content: "doomed" }, ctx);
			// The verdict depends on race timing (already_placed when the run
			// has not picked the submission up yet); what matters for attention
			// is the terminal settlement, polled below.
			await harness.abortSubmission(doomed.id, ctx, convIds.failed);
			const deadline = Date.now() + 10_000;
			let latestFailed;
			do {
				await new Promise((r) => setTimeout(r, 200));
				postAbortStorage = postAbortStorage ?? (await openNodeSqliteStorage(db));
				const page = await postAbortStorage.scanSubmissions(
					{ conversationId: convIds.failed, order: "descending" },
					1,
					undefined,
					ctx,
				);
				latestFailed = page.items[0];
			} while ((!latestFailed || latestFailed.status !== "unanswered") && Date.now() < deadline);
			await postAbortStorage.close(ctx);
			assert.ok(latestFailed?.status === "unanswered",
				`failed seat's submission never settled unanswered (got ${latestFailed?.status})`);
		} finally {
			await harness.close(ctx);
		}
	}

	// Surface via the CLI one-shot (`status`) — the operator's actual path.
	const child = spawn(process.execPath, ["cli.mjs", "status"], {
		cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
	const stderrOut = [];
	child.stderr.on("data", (c) => stderrOut.push(c.toString("utf8")));
	await new Promise((r) => child.once("exit", r));
	assert.equal(child.exitCode, 0, `status exited ${child.exitCode}; stderr=${stderrOut.join("").slice(0, 300)}`);
	const report = JSON.parse(stdout.trim());

	assert.equal(report.ok, true, `status not ok: ${JSON.stringify(report).slice(0, 200)}`);
	const bySeat = Object.fromEntries((report.attention ?? []).map((n) => [n.seat + "/" + n.kind, n]));

	assert.ok(bySeat["idle/idle_with_queued_work"], `missing idle notice; attention=${JSON.stringify(report.attention)}`);
	assert.match(bySeat["idle/idle_with_queued_work"].detail, /1 queued item/);

	assert.ok(bySeat["failed/last_run_failed"], `missing failed notice; attention=${JSON.stringify(report.attention)}`);
	assert.ok(String(bySeat["failed/last_run_failed"].detail).length > 0, "failure reason must travel with the notice");

	assert.ok(!Object.keys(bySeat).some((k) => k.startsWith("healthy/")), `healthy seat must be silent; attention=${JSON.stringify(report.attention)}`);

	console.log(`BLOCKED OK: notices=${JSON.stringify(report.attention.map((n) => `${n.seat}/${n.kind}`))}`);
	console.log("BLOCKED TEST PASS");
	process.exit(0);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
