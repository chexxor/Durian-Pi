// demo/stoprequest.test.mjs — F35: cooperative stop request via .stop file.
//
// The gap: on Windows `process.kill` does not deliver a real SIGTERM, so `serve --stop`
// has no cooperative way to tell the broker to settle and exit. This proves the fix:
// the broker reads a .stop file between passes and exits cleanly (stoppedBy: "stop").
//
// Run: node demo/stoprequest.test.mjs  (exit 0 = pass)

import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { drivePass, runWakeLoop, writeStopRequest, readStopRequest, clearStopRequest, stopRequestPath } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;

function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

async function makeHarness() {
	const storage = new MemoryStorage();
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(RigQueue);

	const harness = await Harness.open(storage, { models, registry }, ctx);
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, {
			model: { provider: "faux", modelId: "faux-seat" },
			instructions: "work",
		});
		await registerSeat(tx, "pm", "worker", c.id, "worker");
	}, ctx);

	return { harness, storage };
}

/* ================================================================ */
/*  Setup: a temp dir for the .stop file (separate from the harness) */
/* ================================================================ */

const tmpDir = await mkdtemp(join(tmpdir(), "durig-stopreq-"));
const dbPath = join(tmpDir, "test");

try {
	/* ---- Test 1: stop request present before the loop starts ---- */
	const { harness: h1, storage: s1 } = await makeHarness();

	writeStopRequest(dbPath);
	check("writeStopRequest creates the file", (await readFile(stopRequestPath(dbPath), "utf8")).length > 0);
	check("readStopRequest returns the value", readStopRequest(dbPath) !== null);

	const sched1 = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
	const sig1 = createWakeSignal();

	console.log("\nF35: stop request present before first pass");

	const r1 = await runWakeLoop({
		harness: h1,
		probeStorage: s1,
		scheduler: sched1,
		signal: sig1,
		context: ctx,
		maxPasses: 5,
		dbPath,
	});

	check("stoppedBy === 'stop'", r1.stoppedBy === "stop", `got '${r1.stoppedBy}'`);
	check("at least one pass ran", r1.passes >= 1, `passes=${r1.passes}`);
	check("broker cleared the stop file", readStopRequest(dbPath) === null, `read='${readStopRequest(dbPath)}'`);

	await h1.close(ctx);

	/* ---- Test 2: stop request written during the loop ---- */
	const { harness: h2, storage: s2 } = await makeHarness();
	const dbPath2 = join(tmpDir, "test2");

	const sched2 = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
	sched2.markDirty();
	const sig2 = createWakeSignal();

	// Write the stop file after a short delay so the loop starts first
	const stopWrite = new Promise((resolve) => setTimeout(() => {
		writeStopRequest(dbPath2);
		resolve();
	}, 50));

	const loopPromise = runWakeLoop({
		harness: h2,
		probeStorage: s2,
		scheduler: sched2,
		signal: sig2,
		context: ctx,
		maxPasses: 3,
		dbPath: dbPath2,
	});

	await stopWrite;
	sig2.raise(); // interrupt any signal.wait so it re-checks
	const r2 = await loopPromise;

	check("broker honoured a stop request written during the loop",
		r2.stoppedBy === "stop", `got '${r2.stoppedBy}'`);

	await h2.close(ctx);

	/* ---- Test 3: no stop file returns null ---- */
	check("readStopRequest returns null when no file exists",
		readStopRequest(join(tmpDir, "nonexistent")) === null);

	/* ---- Test 4: clearStopRequest idempotent ---- */
	check("clearStopRequest on missing file returns true",
		clearStopRequest(join(tmpDir, "nope")) === true);

	/* ---- Test 5: stop request triggers after pass, not before ---- */
	// Create a harness with a stop file. The first pass MUST complete before
	// the stop is honoured (cooperative = after settle).
	const { harness: h3, storage: s3 } = await makeHarness();
	const dbPath3 = join(tmpDir, "test3");
	writeStopRequest(dbPath3);

	const sched3 = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 0 });
	const sig3 = createWakeSignal();

	// drive one pass manually first, then run the loop with stop file present
	await drivePass(h3, s3, { context: ctx });
	const r3 = await runWakeLoop({
		harness: h3,
		probeStorage: s3,
		scheduler: sched3,
		signal: sig3,
		context: ctx,
		maxPasses: 10,
		dbPath: dbPath3,
	});

	check("stop request honoured without additional passes", r3.passes === 1, `passes=${r3.passes}`);
	check("stoppedBy === 'stop'", r3.stoppedBy === "stop", `got '${r3.stoppedBy}'`);

	await h3.close(ctx);

	console.log(failures === 0 ? "\nPASS — F35 cooperative stop-request verified" : `\nFAIL — ${failures} check(s) failed`);
} finally {
	await rm(tmpDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
