/**
 * Spike #209 setup — create a deterministic durig change to watch.
 *
 * Runs `node cli.mjs up rig.starter.json` (registers pm/impl/qa/lead), then
 * enqueues ONE item addressed to the watched seat through the existing public
 * API (`enqueueItem` from src/rig.mjs) WITHOUT driving the seat, so the item
 * stays `status:"queued"` and shows up in `durig watch --once --json`'s
 * `queueItems`. This is the matching event the Pi watcher keys on.
 *
 * No durig product code is changed; this only uses exported API and the CLI.
 *
 * Usage: node .spike/pi-wake/setup-queued-item.mjs <db> <seat> <subject>
 */
import { spawnSync } from "node:child_process";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { enqueueItem, RigQueue, Router } from "../../src/rig.mjs";

const [db, seat, subject] = process.argv.slice(2);
if (!db || !seat || !subject) {
	console.error("usage: node setup-queued-item.mjs <db> <seat> <subject>");
	process.exit(2);
}

// Register seats (creates the db) via the shipped CLI verb.
const up = spawnSync(process.execPath, ["cli.mjs", "up", "rig.starter.json"], {
	env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux" },
	encoding: "utf8",
});
if (up.status !== 0) {
	console.error(`up failed (exit ${up.status}): ${up.stderr?.slice(0, 400)}`);
	process.exit(1);
}

// Enqueue one queued item addressed to `seat`, without running the seat.
const models = createModels();
models.setProvider(fauxProvider({ models: [{ id: "faux-seat" }] }).provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
harness.resume();
try {
	const id = await harness.commit(
		(tx) => enqueueItem(tx, "pm", seat, subject, `Setup for spike #209: ${subject}`),
		BACKGROUND_CONTEXT,
	);
	// Read it back through the read path (documentState), not a second commit: a
	// commit's overlay is settled once the transaction ends, so reading the doc
	// again inside a new commit throws "Cannot use a settled overlay".
	const q = await harness.documentState(RigQueue, undefined, BACKGROUND_CONTEXT);
	const item = (q?.value?.items ?? []).find((i) => i.id === id);
	console.log(JSON.stringify({ ok: true, itemId: id, to: item?.to, status: item?.status }));
} finally {
	await harness.close(BACKGROUND_CONTEXT);
	await storage.close(BACKGROUND_CONTEXT);
}
