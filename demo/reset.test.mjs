// reset/clean verb test (ROADMAP 44): after a model emits a degenerate
// repetition loop, every later turn re-conditions on that bad turn in history.
// pi-durable's conversation.reset(handoff) writes a `pi.reset` boundary (head:
// self) so prior turns leave the CONTEXT without deleting the durable
// transcript. This proves the `reset` (alias `clean`) CLI verb:
//   (a) refuses when the seat holds a live generation lease;
//   (b) calls conversation.reset(handoff) and reports the reset entry id it wrote;
//   (c) a SUBSEQUENT turn excludes the prior turns - the reset boundary is the
//       context head and the old turns are not in the model context;
//   (d) the durable transcript is preserved (reset draws a boundary, it does
//       not destroy history).
// Run: node demo/reset.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-reset-"));
const db = join(dir, "rig.sqlite");
const seatName = "stuck";

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const CLI_CWD = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Run `node cli.mjs <args>` against `db` and return {code, stdout, stderr}.
function runCli(args, extraEnv = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: CLI_CWD,
			env: {
				...process.env,
				DURIG_PROVIDER: "faux",
				DURIG_DB: db,
				...extraEnv,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
		let stderr = "";
		child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});
}

// Open a fresh writer harness (resume) on the persisted DB; closes it in finally.
async function writerHarness() {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	harness.resume();
	return { harness, storage };
}

const BAD_TURN = "FIRST_BEACON_123";
const HANDOFF = "fresh start, ignore everything before this boundary";
const NEW_TURN = "SECOND_TURN_999";
const slotPath = `${db}.genlock.0`;

try {
	let convId;
	// Seed the degenerate context: one prior turn that must leave the context.
	{
		const { harness, storage } = await writerHarness();
		try {
			await harness.commit(async (tx) => {
				const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
				await registerSeat(tx, seatName, conv.id, "implementation");
				convId = conv.id;
			}, ctx);
			const conv = await harness.conversation(convId, ctx);
			faux.setResponses([fauxAssistantMessage(fauxText("reply-to-bad-turn"))]);
			const run = await conv.submit({ type: "input", content: BAD_TURN }, ctx);
			await run.wait(ctx);
			// Precondition: before any reset, the bad turn IS in the model context.
			const before = await conv.context(ctx);
			assert.ok(
				JSON.stringify(before.messages).includes(BAD_TURN),
				"the bad turn must be in the context before reset",
			);
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	// (a) REFUSAL: a live generation lease for the seat must block the reset
	// (a running seat must not be reset out from under itself). Write a live
	// genlock slot (this node pid is alive, so readGenerationSlots treats it as
	// generatingSeat) and run the verb with a finite cap so the guard is armed.
	writeFileSync(
		slotPath,
		JSON.stringify({ pid: process.pid, seat: seatName, since: new Date().toISOString() }),
	);
	{
		const { code, stdout, stderr } = await runCli(
			["reset", seatName, HANDOFF],
			{ DURIG_MAX_CONCURRENT_SEATS: "1" },
		);
		assert.notEqual(code, 0, `reset of a live-lease seat must refuse (got exit ${code}; stderr=${stderr.slice(0, 200)})`);
		const report = JSON.parse(stdout.trim());
		assert.equal(report.ok, false, "refusal returns ok:false");
		assert.match(String(report.error), /live generation lease/, "refusal names the reason");
	}
	// Clear the synthetic slot so the real reset below is permitted.
	rmSync(slotPath, { force: true });

	// (b) REAL RESET: `node cli.mjs reset <seat> <handoff>` reports the reset
	// entry it wrote.
	let resetReport;
	{
		const { code, stdout, stderr } = await runCli(
			["reset", seatName, HANDOFF],
			{ DURIG_MAX_CONCURRENT_SEATS: "1" },
		);
		assert.equal(code, 0, `reset exited ${code}; stderr=${stderr.slice(0, 300)}`);
		resetReport = JSON.parse(stdout.trim());
		assert.equal(resetReport.ok, true, "reset ok");
		assert.equal(resetReport.command, "reset");
		assert.equal(resetReport.seat, seatName);
		assert.equal(resetReport.handoff, HANDOFF);
		assert.ok(resetReport.resetEntryId, `resetEntryId must be reported (got ${resetReport.resetEntryId})`);
	}

	// (c) SUBSEQUENT TURN EXCLUDES PRIOR TURNS: after the reset, a fresh writer
	// harness submits a new turn; the reset boundary is the context head and the
	// bad turn is no longer in the model context, while the handoff and the new
	// turn are present.
	{
		const { harness, storage } = await writerHarness();
		try {
			const conv = await harness.conversation(convId, ctx);
			faux.setResponses([fauxAssistantMessage(fauxText("reply-to-new-turn"))]);
			const run = await conv.submit({ type: "input", content: NEW_TURN }, ctx);
			await run.wait(ctx);

			const after = await conv.context(ctx);
			// The reset boundary is the context head.
			assert.equal(after.head?.kind, "pi.reset", "the reset entry is the context head");
			assert.equal(String(after.head?.id), String(resetReport.resetEntryId), "the head is the reset entry this verb wrote");
			const messagesJson = JSON.stringify(after.messages);
			// Prior turns are excluded from the context.
			assert.ok(
				!messagesJson.includes(BAD_TURN),
				`the bad turn must leave the context after reset; messages=${messagesJson.slice(0, 200)}`,
			);
			// The handoff and the fresh turn ARE in the context.
			assert.ok(messagesJson.includes(HANDOFF), "the handoff text is in the new context");
			assert.ok(messagesJson.includes(NEW_TURN), "the subsequent turn is in the new context");
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	// (d) DURABLE TRANSCRIPT PRESERVED: the old turns remain in the store even
	// though they left the context - reset draws a boundary, it does not destroy
	// history.
	{
		const storage = await openNodeSqliteStorage(db);
		try {
			const ePage = await storage.scanEntries(
				{ conversationId: convId, order: "descending" },
				50,
				undefined,
				ctx,
			);
			const allText = JSON.stringify(ePage.items.map((e) => e.model?.[0]?.content).flat());
			assert.ok(allText.includes(BAD_TURN), "the prior turn is preserved in the durable transcript");
			assert.ok(
				ePage.items.some((e) => e.kind === "pi.reset"),
				"the reset boundary entry is in the durable transcript",
			);
		} finally {
			await storage.close(ctx);
		}
	}

	console.log("RESET TEST PASS (reset/clean breaks a seat out of a degenerate context: refuses live lease, reports the reset entry id, subsequent turn excludes prior turns, transcript preserved)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
