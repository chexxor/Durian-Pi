// resume/doctor verb test (ROADMAP 37b, dogfood F11 fix): a submission ADMITTED
// durably but never STARTED - the `send` was killed mid-flight - rests invisibly
// while the rig reads idle-healthy. This proves the `resume` (alias `doctor`) CLI
// verb finds the stranded submission, withdraws it to a terminal state, and reports
// exactly what it did, so an empty surface is no longer indistinguishable from a
// healthy one.
// Run: node demo/resume.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
const dir = mkdtempSync(join(tmpdir(), "durig-resume-"));
const db = join(dir, "rig.sqlite");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// Open a harness WITHOUT resume(): scheduling stays off, so a submitted input is
// ADMITTED durably but never started - exactly the stranded state (F11/37b).
async function admitWithoutScheduling() {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	let convId;
	try {
		await harness.commit(async (tx) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, "stuck", conv.id, "implementation");
			convId = conv.id;
		}, ctx);
		const conv = await harness.conversation(convId, ctx);
		await conv.submit({ type: "input", content: "never started" }, ctx);
		return convId;
	} finally {
		await harness.close(ctx);
		await storage.close(ctx);
	}
}

let convId;
try {
	convId = await admitWithoutScheduling();

	// Precondition: the stranded submission exists and is still queued (admitted,
	// never started) - re-open storage viewer-style to confirm the persisted fact.
	{
		const storage = await openNodeSqliteStorage(db);
		try {
			const subPage = await storage.scanSubmissions(
				{ conversationId: convId, order: "descending" },
				1,
				undefined,
				ctx,
			);
			const latest = subPage.items[0];
			assert.ok(latest, "a submission was admitted");
			// The input is PLACED into the transcript even without scheduling; the
			// generation never runs. Either is stranded (admitted-but-not-starting) -
			// the same union the 37a notice accepts.
			assert.ok(
				latest.status === "queued" || latest.status === "placed",
				`admitted-but-unscheduled submission must be queued/placed (got ${latest.status})`,
			);
		} finally {
			await storage.close(ctx);
		}
	}

	// The verb: `resume` opens the harness (re-arming scheduling) and withdraws the
	// stranded queued submission to a terminal state, reporting what it did.
	const child = spawn(process.execPath, ["cli.mjs", "resume"], {
		cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
	const stderrOut = [];
	child.stderr.on("data", (c) => stderrOut.push(c.toString("utf8")));
	await new Promise((r) => child.once("exit", r));
	assert.equal(child.exitCode, 0, `resume exited ${child.exitCode}; stderr=${stderrOut.join("").slice(0, 300)}`);
	const report = JSON.parse(stdout.trim());
	assert.ok(report.ok, `resume not ok: ${JSON.stringify(report).slice(0, 200)}`);
	assert.equal(report.command, "resume", "reports its command");
	assert.equal(report.found, 1, `found exactly the stranded submission (got ${report.found})`);
	assert.equal(report.actions.length, 1, "one action reported");
	const action = report.actions[0];
	assert.equal(action.seat, "stuck");
	// The two stranded states reconcile differently: a `queued` one is withdrawn by
	// abortSubmission(); a `placed` one meets already_placed and the run is cancelled
	// via conversation.abort(). Either must clear the stranded state to terminal.
	assert.ok(
		(action.status === "queued" && action.action === "withdrawn") ||
		(action.status === "placed" && action.action === "run-cancelled"),
		`unexpected action ${JSON.stringify(action)}`,
	);

	// Postcondition: the stranded state is cleared - the submission is now terminal
	// (done or unanswered), not queued/placed, so a second resume finds nothing.
	const child2 = spawn(process.execPath, ["cli.mjs", "resume"], {
		cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout2 = "";
	child2.stdout.on("data", (c) => (stdout2 += c.toString("utf8")));
	await new Promise((r) => child2.once("exit", r));
	assert.equal(child2.exitCode, 0, `second resume exited ${child2.exitCode}`);
	const report2 = JSON.parse(stdout2.trim());
	assert.equal(report2.found, 0, `second resume must find nothing left (got ${report2.found})`);
	assert.deepEqual(report2.actions, [], "no actions on the second pass");

	// The status path must now read clean too: no admitted-but-not-started notice.
	const child3 = spawn(process.execPath, ["cli.mjs", "status"], {
		cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
		env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db, DURIG_STRANDED_MS: "50" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout3 = "";
	child3.stdout.on("data", (c) => (stdout3 += c.toString("utf8")));
	await new Promise((r) => child3.once("exit", r));
	assert.equal(child3.exitCode, 0, `status exited ${child3.exitCode}`);
	const report3 = JSON.parse(stdout3.trim());
	assert.ok(
		!(report3.attention ?? []).some((n) => n.kind === "admitted_not_started"),
		`status must no longer report admitted_not_started; attention=${JSON.stringify(report3.attention)}`,
	);

	console.log("RESUME TEST PASS (resume/doctor finds and withdraws the admitted-but-not-started submission)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
