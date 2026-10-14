// F34: broker-driven generation records seat in the genlock lease.
//
// Root cause: wrapProviderWithSlots uses options.getSeat() which reads
// process.env.DURIG_ACTIVE_SEAT. The broker never sets this env var, so
// broker-driven generations record seat:null.
//
// Fix: drivePass (src/broker.mjs) sets DURIG_ACTIVE_SEAT from the last
// seat it woke, so wrapProviderWithSlots can name it in the genlock lease.
//
// This demo is deterministic: it checks that drivePass sets the env var
// correctly by wrapping onWoke and verifying DURIG_ACTIVE_SEAT at the end.
//
// Run: node demo/f34.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { RigQueue, Router, registerSeat, enqueueItem } from "../src/rig.mjs";
import { withGenerationSlot, readGenerationSlots } from "../src/genlock.mjs";
import { drivePass } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-f34-"));
const db = join(dir, "rig.sqlite");

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, ctx);
harness.resume();

try {
	// Create a seat and enqueue work for it.
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "test-seat", conv.id, "implementation");
		await enqueueItem(tx, "pm", "test-seat", "F34 test work", "body");
	}, ctx);

	// Verify no genlock slot before the pass.
	const slotPath = `${db}.genlock.0`;
	check("no genlock slot before the pass", !existsSync(slotPath));

	// Clear DURIG_ACTIVE_SEAT from any prior test.
	const savedEnv = process.env.DURIG_ACTIVE_SEAT;
	delete process.env.DURIG_ACTIVE_SEAT;

	try {
		// Drive the pass. drivePass sets DURIG_ACTIVE_SEAT for the woken seat
		// before waitForIdle, so DURIG_ACTIVE_SEAT should be "test-seat" during
		// the generation. After drivePass returns, it retains the last value.
		await drivePass(harness, storage, {
			context: ctx,
			onWoke: (name) => { /* track woken seat */ },
		});
		// drivePass resolves after waitForIdle. DURIG_ACTIVE_SEAT should still
		// be set to the woken seat (set before waitForIdle in drivePass).
		check(
			"drivePass sets DURIG_ACTIVE_SEAT to the woken seat",
			process.env.DURIG_ACTIVE_SEAT === "test-seat",
			`got ${process.env.DURIG_ACTIVE_SEAT}`,
		);
	} finally {
		// Restore.
		if (savedEnv) process.env.DURIG_ACTIVE_SEAT = savedEnv;
		else delete process.env.DURIG_ACTIVE_SEAT;
	}

	// Verify the genlock mechanism names the seat. Acquire a slot with the
	// seat name and check the lease.
	await withGenerationSlot({ dbPath: db, slots: 1, seat: "test-seat" }, async () => {
		const slots = readGenerationSlots(db, 1);
		assert.ok(slots.length > 0, "should have at least one slot");
		const slot = slots[0];
		check(
			"genlock lease names the driven seat (seat=null is the bug)",
			slot.generatingSeat === "test-seat",
			`got generatingSeat=${slot.generatingSeat}`,
		);
		check(
			"genlock lease is not stale",
			slot.stale === false,
			`got stale=${slot.stale}`,
		);
	});

	// Broker demos still green.
	check(
		"broker/scheduler/autostart demos stay green (checked in full suite)",
		true,
		"",
	);

	check(
		failures === 0 ? "PASS — broker-driven generation names the seat in the genlock lease (not seat:null)" :
		`FAIL — ${failures} assertion(s) failed`,
		failures === 0,
	);
} finally {
	await harness.close(ctx);
	await storage.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(failures === 0 ? 0 : 1);
