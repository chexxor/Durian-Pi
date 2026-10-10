// `up` idempotency and `up --refresh` tests: re-running up reports existing
// seats instead of duplicating them, and --refresh re-applies the stored
// prompt (primer included) to seats created by an earlier durig version.
// Run: node demo/refresh.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	configure,
	createRegistry,
	Harness,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Seats } from "../src/rig.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-refresh-"));
const db = join(dir, "rig.sqlite");
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const rigFile = join(durigDir, "rigs", "tutor-pi.rig.json");

const up = (args) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", "up", rigFile, ...args], {
			cwd: durigDir,
			env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

/** Open the rig, hand `fn(harness)` the live durable API, always close. */
async function withHarness(fn) {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(
		storage,
		{ models: createModels(), registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	try {
		return await fn(harness);
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
}

/** Current stored prompt for every seat, read through the durable API so
 * patch revisions on top of a base revision are applied correctly. */
function readPrompts() {
	return withHarness(async (harness) => {
		const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
		const out = new Map();
		for (const [name, seat] of Object.entries(seatsDoc.value.seats)) {
			const agent = await harness.documentState(
				AgentDoc,
				seat.conversationId,
				BACKGROUND_CONTEXT,
			);
			out.set(name, agent?.value?.instructions ?? "");
		}
		return out;
	});
}

try {
	const first = await up([]);
	assert.equal(first.code, 0, `first up failed: ${first.stderr.slice(0, 200)}`);
	const a = JSON.parse(first.stdout);
	assert.equal(a.created.length, 13, "first run creates all seats");
	assert.equal(a.existing.length, 0);

	const second = await up([]);
	const b = JSON.parse(second.stdout);
	assert.equal(b.created.length, 0, "plain rerun creates nothing");
	assert.equal(b.existing.length, 13, "plain rerun reports existing");
	assert.equal(b.refreshed.length, 0, "plain rerun refreshes nothing");

	for (const [name, instructions] of await readPrompts()) {
		assert.match(instructions, /durig work protocol/, `${name}: primer present on create`);
	}

	// Simulate a seat stored by an earlier durig version: strip its primer.
	await withHarness(async (harness) => {
		const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
		await harness.commit(async (tx) => {
			await configure(tx, seatsDoc.value.seats.pm.conversationId, {
				model: { provider: "faux", modelId: "faux-seat" },
				instructions: "STALE PERSONA WITH NO PRIMER",
			});
		}, BACKGROUND_CONTEXT);
	});
	const stale = await readPrompts();
	assert.equal(stale.get("pm"), "STALE PERSONA WITH NO PRIMER", "stale prompt is stored");

	const refreshed = await up(["--refresh"]);
	assert.equal(refreshed.code, 0, `refresh failed: ${refreshed.stderr.slice(0, 200)}`);
	const c = JSON.parse(refreshed.stdout);
	assert.equal(c.created.length, 0, "refresh creates nothing");
	assert.equal(c.existing.length, 0, "refresh moves every seat to the refreshed bucket");
	assert.equal(c.refreshed.length, 13, "refresh re-applies all 13 seats");

	const after = await readPrompts();
	for (const [name, instructions] of after) {
		assert.match(instructions, /durig work protocol/, `${name}: primer restored by refresh`);
	}
	assert.ok(
		![...after.values()].some((i) => i.includes("STALE PERSONA")),
		"stale prompt fully replaced",
	);

	console.log("REFRESH TEST PASS (create, idempotent rerun, --refresh repairs stale prompts)");
	process.exit(0);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
