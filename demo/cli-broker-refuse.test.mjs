// demo/cli-broker-refuse.test.mjs — a CLI write verb refuses while a broker drives.
//
// ROADMAP 69 / item 83: `resume`/`doctor`, `reset`, and `send` each open a full
// harness, so each is a second OWNER — two owners crash the broker and corrupt
// run-control docs (2026-10-16, twice: `resume` racing the broker left a mid-stream
// `generation` reset that orphaned later appends). They must REFUSE while a resident
// broker drives the store, naming the spool/`serve --stop`. `ps`/`queue` are READS
// and must keep working while the broker drives: they read via `openStore` (like
// `status`) instead of opening a harness.
//
// A "live broker" here is a broker state file naming a live pid with a FRESH
// heartbeat — `brokerAlive` treats it exactly as the real broker, and the demo's own
// pid is alive and fresh, so no broker process is spawned.
//
// Failing-first: before the fix, `reset`/`resume`/`send` open a harness and proceed
// (exit 0), so the refusal assertions fail.
// Run: node demo/cli-broker-refuse.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, registerSeat } from "../src/rig.mjs";
import { brokerAlive, drainIntentInbox, readBrokerState, writeBrokerState } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-broker-refuse-"));
const db = join(dir, "rig.sqlite");
// #1589: `up` needs a spec to read. The guard runs BEFORE the read, so the refusal
// would fire either way; the file exists so the `--dry-run` non-refusal check below
// exercises a real preview rather than a parse error.
const rigFile = join(dir, "rig.json");
writeFileSync(
		rigFile,
		JSON.stringify({
			version: 2,
			seats: [{ name: "worker", role: "implementation", instructions: "w" }],
		}),
	);
const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

/** Run one CLI verb against the temp store; return { exitCode, json, stderr }. */
function runCli(args) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: repoRoot,
			env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
		child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
		// A RED run of `send` would start a model turn; bound it so the demo cannot hang.
		const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
		child.once("exit", (code) => {
			clearTimeout(timer);
			let json = null;
			try {
				json = JSON.parse(stdout.trim());
			} catch {
				// leave null; the assertion below reports the raw output
			}
			resolve({ exitCode: code, json, stdout, stderr });
		});
	});
}

let failures = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

// The in-process stand-in broker: it holds the store and DRAINS the read requests the
// CLI children spool, so a broker-served read has an answer. Declared outside `try` so
// the cleanup below can reach them.
let brokerStorage;
let brokerHarness;
let brokerDrainer = null;

try {
	// Seed a store with one seat, so `ps`/`queue` have something to read. The harness and
	// storage stay OPEN: with broker-served reads a live broker must answer the spool, and
	// this process is that broker (no separate broker process is spawned).
	{
		brokerStorage = await openNodeSqliteStorage(db);
		brokerHarness = await Harness.open(brokerStorage, { models, registry }, ctx);
		await brokerHarness.commit(async (tx) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, "worker", conv.id, "implementation");
		}, ctx);
	}

	// A LIVE broker: a state file naming a live pid with a fresh heartbeat.
	writeBrokerState(db, { pid: process.pid, since: Date.now() });
	assert.equal(brokerAlive(readBrokerState(db)), true, "the broker state reads as alive (sanity)");

	// The stand-in broker answers reads the CLI spools, on a cadence near the real
	// broker's ~1 s idle re-check; 25 ms keeps the demo quick.
	brokerDrainer = setInterval(() => {
		void drainIntentInbox(brokerHarness, brokerStorage, { dbPath: db, context: ctx }).catch(() => {});
	}, 25);

	console.log("\n=== CLI write verbs refuse while the broker drives ===\n");

	for (const [label, args, extra] of [
		// #1931: `resume`/`doctor` is a DOCUMENTED REFUSAL, not a spool route — the broker already
		// settles stranded submissions at startup and every pass, so the message names WHY and the
		// runbook, and must NOT advise stopping a live broker.
		["resume", ["resume"], { why: /settles stranded submissions ITSELF/, runbook: /resume-while-broker-runs\.md/ }],
		["reset", ["reset", "worker"], null],
		["send", ["send", "worker", "hello"], null],
		// #1589: `up` opened a harness with NO guard, so `up --refresh` was a second owner.
		["up --refresh", ["up", rigFile, "--refresh"], null],
	]) {
		await check(`${label} refuses with a live broker`, async () => {
			const { exitCode, json, stdout } = await runCli(args);
			assert.equal(exitCode, 1, `${label} must exit 1 (got ${exitCode}); stdout=${stdout.slice(0, 200)}`);
			assert.ok(json, `${label} must print one JSON doc; got ${stdout.slice(0, 200)}`);
			assert.equal(json.ok, false, `${label} must report ok:false`);
			assert.match(String(json.error), /refuses to run while a resident broker/, `names the reason: ${json.error}`);
			if (extra) {
				assert.match(String(json.error), extra.why, `names why: ${json.error}`);
				assert.match(String(json.error), extra.runbook, "names the runbook");
				assert.doesNotMatch(String(json.error), /serve --stop/, "must NOT advise stopping a live broker");
			} else {
				assert.match(String(json.error), /serve --stop/, "names the stop verb");
				assert.match(String(json.error), /intent\.mjs/, "names the spool route");
			}
		});
	}

	console.log("\n=== CLI read verbs still work while the broker drives ===\n");

	// #1589 non-regression: `--dry-run` previews and writes NOTHING, so it must keep
	// working while a broker drives (the `reset` precedent). This is the check that
	// fails if the guard is placed unconditionally instead of on the write path.
	await check("up --dry-run still previews with a live broker (no refusal)", async () => {
		const { exitCode, json, stdout } = await runCli(["up", rigFile, "--dry-run"]);
		assert.equal(exitCode, 0, `up --dry-run must succeed (got ${exitCode}); stdout=${stdout.slice(0, 300)}`);
		assert.equal(json.ok, true, "up --dry-run ok:true");
		assert.equal(json.dryRun, true, "it reports itself as a preview");
	});

	await check("ps reads the roster with a live broker (no refusal)", async () => {
		const { exitCode, json, stdout } = await runCli(["ps"]);
		assert.equal(exitCode, 0, `ps must succeed (got ${exitCode}); stdout=${stdout.slice(0, 200)}`);
		assert.equal(json.ok, true, `ps ok:true`);
		assert.equal(json.command, "ps");
		assert.equal(json.seats.length, 1, "the seeded seat is listed");
		assert.equal(json.seats[0].name, "worker");
	});

	await check("queue reads the items with a live broker (no refusal)", async () => {
		const { exitCode, json, stdout } = await runCli(["queue"]);
		assert.equal(exitCode, 0, `queue must succeed (got ${exitCode}); stdout=${stdout.slice(0, 200)}`);
		assert.equal(json.ok, true, `queue ok:true`);
		assert.equal(json.command, "queue");
		assert.ok(Array.isArray(json.items), "items is an array");
	});

	console.log(
		failures === 0
			? "\nCLI BROKER-REFUSE PASS (resume/reset/send/up refuse while a broker drives; up --dry-run and ps/queue read)"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} finally {
	if (brokerDrainer) clearInterval(brokerDrainer);
	try {
		if (brokerHarness) await brokerHarness.close(ctx);
	} catch (err) {
		console.error(`harness close: ${err?.message ?? err}`);
	}
	try {
		if (brokerStorage) await brokerStorage.close(ctx);
	} catch (err) {
		console.error(`storage close: ${err?.message ?? err}`);
	}
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(failures === 0 ? 0 : 1);
