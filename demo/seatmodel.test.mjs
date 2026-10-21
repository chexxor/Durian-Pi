// Per-seat model string test: seats accept "{provider}/{modelId}" or a bare
// "{modelId}" (follows the rig's default provider). Slash-containing model
// ids without a provider prefix must NOT be mistaken for provider+model.
// Run: node demo/seatmodel.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveSeatModel } from "../src/seatmodel.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-seatmodel-"));
const db = join(dir, "rig.sqlite");
const rigFile = join(dir, "rig.json");

writeFileSync(rigFile, JSON.stringify({
	version: 2,
	seats: [
		{ name: "bare", role: "r", instructions: "x" },
		{ name: "prefixed", role: "r", instructions: "x", model: "faux/faux-seat" },
		{ name: "slashed-id", role: "r", instructions: "x", model: "zai-org/GLM-5.3-Flash" },
	],
}));

try {
	// 1. Unit: the resolver itself (the actual feature).
	const fakeModels = { getProvider: (id) => (id === "faux" ? { id } : undefined) };
	assert.deepEqual(
		resolveSeatModel(fakeModels, undefined, "faux", "faux-seat"),
		{ provider: "faux", modelId: "faux-seat" },
		"absent -> default",
	);
	assert.deepEqual(
		resolveSeatModel(fakeModels, "faux/faux-seat", "faux", "faux-seat"),
		{ provider: "faux", modelId: "faux-seat" },
		"explicit provider prefix",
	);
	assert.deepEqual(
		resolveSeatModel(fakeModels, "zai-org/GLM-5.3-Flash", "faux", "faux-seat"),
		{ provider: "faux", modelId: "zai-org/GLM-5.3-Flash" },
		"slash id without provider prefix stays ONE model id",
	);
	console.log("RESOLVER OK");

	// 2. Integration: boot a 3-seat rig through the real CLI and check what
	// was stored per seat (pi.agent base revisions, matched in JS because
	// owner ids are stored as text).
	const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
	const child = spawn(process.execPath, ["cli.mjs", "up", rigFile], {
		cwd: durigDir,
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
	child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
	await new Promise((r) => child.once("exit", r));
	assert.equal(child.exitCode, 0, `up failed: ${stderr.slice(0, 300)}`);

	const sq = new DatabaseSync(db, { readOnly: true });
	const seatsBase = sq
		.prepare(`SELECT content FROM document_revisions WHERE document_id = (SELECT id FROM documents WHERE kind = '"durig.seats"') AND kind = 'base'`)
		.get();
	const seats = JSON.parse(seatsBase.content).seats;
	// bare follows the rig default, which since the GLM switch is
	// zai-org/GLM-5.3-Flash (cli.mjs MODEL_ID under DURIAN_PI_PROVIDER=faux).
	const expectations = {
		bare: { provider: "faux", modelId: "zai-org/GLM-5.3-Flash" },
		prefixed: { provider: "faux", modelId: "faux-seat" },
		"slashed-id": { provider: "faux", modelId: "zai-org/GLM-5.3-Flash" },
	};
	for (const [name, expect] of Object.entries(expectations)) {
		const cid = seats[name].conversationId;
		const row = sq
			.prepare(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id = r.document_id WHERE d.kind = '"pi.agent"' AND CAST(d.owner_id AS TEXT) = ? AND r.kind = 'base'`)
			.get(String(cid));
		assert.ok(row, `${name}: agent doc not found`);
		const model = JSON.parse(row.content).model;
		assert.deepEqual(model, expect, `${name}: stored ${JSON.stringify(model)}, want ${JSON.stringify(expect)}`);
	}
	sq.close();
	console.log("STORED MODELS OK for all 3 seats");
	console.log("SEATMODEL TEST PASS");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
