// demo/broker-pass-survival.test.mjs — #1587 part 2: a storage error inside a pass must not
// kill the resident broker, and the diagnostic must name the NESTED cause.
//
// RED BEFORE: the wake loop's try had only a `finally`, so a throw from the pass escaped and
// killed the broker (the 17:29Z death); and `wake-failed` spread the raw Error, whose nested
// cause is the only place a storage error names its real reason.
// GREEN AFTER: the loop catches, emits `pass-failed` WITH the cause chain, and keeps driving.
//
// Run: node demo/broker-pass-survival.test.mjs  (exit 0 = pass)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { runWakeLoop } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-pass-survival-"));
const logPath = join(dir, "rig.sqlite");

let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
};

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "solo", c.id, "worker");
		await enqueueItem(tx, "operator", "solo", "an item", "body");
	}, ctx);

	// A probe storage whose every read THROWS with a NESTED cause — the
	// SessionFailed-wraps-the-real-reason shape that left the death unexplained.
	const boom = () => {
		const inner = new Error("database is locked");
		inner.name = "SqliteError";
		const outer = new Error("session failed while reading a document");
		outer.name = "SessionFailed";
		outer.cause = inner;
		throw outer;
	};
	const probeStorage = { scanDocuments: boom, document: boom, scanSubmissions: boom };

	const scheduler = new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 });
	const signal = createWakeSignal();
	const diagnostics = [];

	let loopError = null;
	let result = null;
	try {
		result = await runWakeLoop({
			harness,
			probeStorage,
			scheduler,
			signal,
			context: ctx,
			dbPath: logPath,
			onDiagnostic: (d) => diagnostics.push(d),
			maxDurationMs: 400,
			isStopping: () => false,
		});
	} catch (error) {
		loopError = error;
	}

	check("the loop survives a throwing pass (no escape)", loopError === null, String(loopError));
	check("the loop returns a result", result !== null && typeof result === "object", String(result));
	const passFailed = diagnostics.filter((d) => d.kind === "pass-failed");
	check("a pass-failed diagnostic is emitted", passFailed.length >= 1, JSON.stringify(diagnostics.slice(0, 3)));
	check("the diagnostic names the OUTER error", /SessionFailed/.test(passFailed[0]?.error ?? ""), JSON.stringify(passFailed[0]));
	check(
		"the diagnostic names the NESTED cause",
		/SqliteError: database is locked/.test(passFailed[0]?.cause ?? ""),
		JSON.stringify(passFailed[0]),
	);
	check("no wake-failed diagnostic leaks a raw Error object", diagnostics.every((d) => !(d.error instanceof Error)));
} finally {
	await harness.close(ctx);
	rmSync(dir, { recursive: true, force: true });
}

console.log(
	failures === 0
		? "\nPASS — the broker survives a storage error and names its nested cause"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
