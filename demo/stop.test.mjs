// Emergency-stop verb test (ROADMAP 41): a seat that has entered a degenerate
// loop, or is behaving harmfully, must be stoppable WITHOUT depending on the
// agent cooperating and WITHOUT killing the driving `send` process in a way that
// strands an admitted-but-unscheduled submission (dogfood F11). `stop` finds the
// seat's live generation-lease holder (the cross-process driver) and kills it,
// then settles the run's submission to a terminal `aborted: <reason>` state
// (surfaced on the attention channel as `last_run_failed`) and aborts the run's
// task so resume won't resurrect it.
// This proves:
//   (a) the run reaches a terminal `aborted` state carrying the operator's reason;
//   (b) the generation lease is released;
//   (c) the work is still recoverable - a later run on the same conversation works
//       and the durable transcript is preserved;
//   (d) a second stop is a no-op;
//   (e) the terminal `aborted: <reason>` is surfaced on the attention channel.
// Run: node demo/stop.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-stop-"));
const db = join(dir, "rig.sqlite");
const slotPath = `${db}.genlock.0`;
const seatName = "stuck";
const REASON = "operator stop: runaway loop";
const CLI_CWD = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// A fake cross-process driver: writes a genlock slot with ITS OWN pid for the
// seat, then sleeps - a stand-in for an in-flight `send` driver that will not
// cooperate. `stop` must halt it by killing that pid via the lease, without the
// agent doing anything.
const DRIVER = `import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
writeFileSync(process.env.SLOT_PATH, JSON.stringify({
  pid: process.pid, seat: process.env.SEAT_NAME, since: new Date().toISOString(),
}));
await sleep(120000);`;

function runCli(args, extraEnv = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: CLI_CWD,
			env: {
				...process.env,
				DURIG_PROVIDER: "faux",
				DURIG_DB: db,
				DURIG_MAX_CONCURRENT_SEATS: "1",
				...extraEnv,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
		let stderr = "";
		child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
		child.once("exit", (code) => resolve({ code, stdout: stdout.trim(), stderr }));
	});
}

let convId;
try {
	// Seed a placed submission (a run started) on a fresh conversation, admitted
	// WITHOUT scheduling so it stays non-terminal until `stop` settles it.
	{
		const storage = await openNodeSqliteStorage(db);
		const harness = await Harness.open(storage, { models, registry }, ctx);
		try {
			await harness.commit(async (tx) => {
				const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
				await registerSeat(tx, seatName, conv.id, "implementation");
				convId = conv.id;
			}, ctx);
			const conv = await harness.conversation(convId, ctx);
			await conv.submit({ type: "input", content: "run" }, ctx);
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	// Start the fake cross-process driver holding the generation lease.
	const driver = spawn(process.execPath, ["-e", DRIVER], {
		cwd: CLI_CWD,
		env: { ...process.env, SLOT_PATH: slotPath, SEAT_NAME: seatName },
		stdio: "ignore",
		detached: true,
	});
	await new Promise((r) => setTimeout(r, 500));
	assert.ok(existsSync(slotPath), "the cross-process driver wrote its generation lease");

	// FIRST stop: halt the driver, settle the run, release the lease.
	const first = await runCli(["stop", seatName, REASON]);
	assert.equal(first.code, 0, `stop exited ${first.code}; stderr=${first.stderr.slice(0, 300)}`);
	const firstReport = JSON.parse(first.stdout);
	assert.equal(firstReport.ok, true, "stop ok");
	assert.equal(firstReport.command, "stop", "reports its command");
	assert.equal(firstReport.seat, seatName);
	assert.equal(firstReport.reason, REASON, "carries the operator's reason");
	assert.equal(firstReport.aborted, true, "settled a run");
	// (ii) the cross-process driver was halted via the lease (pid killed).
	assert.equal(firstReport.killed, driver.pid, "kill the cross-process driver pid via the lease");

	// The driver process is dead (cross-process halt did not require cooperation).
	let alive = true;
	try {
		process.kill(driver.pid, 0);
	} catch {
		alive = false;
	}
	assert.equal(alive, false, "the non-cooperating driver process was halted");
	await new Promise((r) => setTimeout(r, 200));

	// (b) the generation lease is released (the slot the killed holder held is gone).
	assert.ok(!existsSync(slotPath), "the generation lease is released");

	// (a) the run reached a terminal `aborted` state carrying the reason.
	{
		const storage = await openNodeSqliteStorage(db);
		const p = await storage.scanSubmissions({ conversationId: convId, order: "descending" }, 1, undefined, ctx);
		const latest = p.items[0];
		assert.equal(latest.status, "unanswered", "the halted run is terminal, not stranded");
		assert.equal(latest.reason, `aborted: ${REASON}`, "the terminal state carries the operator's reason");
		await storage.close(ctx);
	}

	// (e) the attention channel surfaces it: status reports last_run_failed with the
	// aborted reason (never a silent strand).
	{
		const { code, stdout, stderr } = await runCli(["status"]);
		assert.equal(code, 0, `status exited ${code}; stderr=${stderr.slice(0, 200)}`);
		const report = JSON.parse(stdout);
		const failed = (report.attention ?? []).find((n) => n.kind === "last_run_failed");
		assert.ok(failed, `status must surface the aborted run; attention=${JSON.stringify(report.attention)}`);
		assert.ok(
			String(failed.detail).includes(`aborted: ${REASON}`),
			`attention detail carries aborted: <reason> (got "${failed.detail}")`,
		);
	}

	// (d) a second stop is a no-op (idempotent, bounded to one halt).
	const second = await runCli(["stop", seatName, "another reason"]);
	assert.equal(second.code, 0, `second stop exited ${second.code}`);
	const secondReport = JSON.parse(second.stdout);
	assert.equal(secondReport.ok, true);
	assert.equal(secondReport.alreadyStopped, true, "stopping an already-stopped seat is a no-op");

	// (c) the work is still recoverable: a later run on the same conversation works,
	// and the durable transcript from before the stop is preserved. The stop's abort
	// must drain first (waitForIdle), then a fresh generation schedules and settles.
	{
		const storage = await openNodeSqliteStorage(db);
		const harness = await Harness.open(storage, { models, registry }, ctx);
		harness.resume();
		try {
			await Promise.race([
				harness.waitForIdle(ctx),
				new Promise((r) => setTimeout(r, 8000)),
			]);
			const conv = await harness.conversation(convId, ctx);
			faux.setResponses([fauxAssistantMessage(fauxText("fresh reply"))]);
			const run = await conv.submit({ type: "input", content: "fresh after stop" }, ctx);
			const settled = await run.wait(ctx);
			assert.equal(settled.status, "done", "a later run on the same conversation works");

			const ePage = await storage.scanEntries({ conversationId: convId, order: "descending" }, 50, undefined, ctx);
			const allText = JSON.stringify(ePage.items.map((e) => e.model?.[0]?.content).flat());
			assert.ok(allText.includes("run"), "the durable transcript before the stop is preserved");
			assert.ok(allText.includes("fresh after stop"), "the later work lands in the transcript");
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	console.log("STOP TEST PASS (emergency-stop halts the cross-process driver, settles the run to aborted:<reason> on the attention channel, releases the lease, stays idempotent, and the work remains recoverable)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
