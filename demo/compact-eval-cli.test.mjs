// demo/compact-eval-cli.test.mjs — the `item` DRY-RUN must not demand a model id (#1604).
//
// qa #1573 (cosmetic): `node scripts/compact-eval.mjs item --seat <s> --store <db> --dry`
// used to build the LIVE DeepInfra provider — and throw "no model id" — before the dry-run
// return, so an ESTIMATE-only run failed unless DURIG_MODEL was set. The estimate needs no
// model; a model id is required only to FIRE (or to price the estimate in USD).
//
// RED/GREEN: against the pre-fix script the child exits nonzero with "no model id"; after
// the fix it prints the token estimate and the DRY RUN line and exits 0.
//
// Run: node demo/compact-eval-cli.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Router, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "compact-eval-cli-"));
const db = join(dir, "rig.sqlite");
const cwd = join(dir, "seat-workspace");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

try {
	// A real sqlite store with ONE seat — the minimum `item` recon needs.
	{
		const storage = await openNodeSqliteStorage(db);
		const harness = await Harness.open(storage, { models, registry }, ctx);
		await harness.commit(async (tx) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
			await registerSeat(tx, "solo", conv.id, "implementation");
		}, ctx);
		await storage.close();
	}

	// DURIG_MODEL explicitly EMPTY: the pre-fix script hard-failed here.
	const run = spawnSync(
		process.execPath,
		["scripts/compact-eval.mjs", "item", "--seat", "solo", "--store", db, "--dry"],
		{ encoding: "utf8", env: { ...process.env, DURIG_MODEL: "" } },
	);
	const out = `${run.stdout}${run.stderr}`;

	assert.equal(run.status, 0, `item --dry must succeed without a model id (exit ${run.status})\n${out}`);
	assert.ok(!/no model id/.test(out), `item --dry must not demand a model id\n${out}`);
	assert.ok(/DRY RUN/.test(out), `item --dry should report the dry run\n${out}`);
	assert.ok(/est tokens/.test(out), `item --dry should print the token estimate\n${out}`);
	assert.ok(/set DURIG_MODEL for a USD estimate/.test(out), `the unpriced estimate should name the seam\n${out}`);

	console.log("ok — compact-eval item --dry needs no model id (#1604)");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
