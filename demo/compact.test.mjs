// demo/compact.test.mjs — the `compact` verb (ROADMAP 61-67 daemon group, operator TASK 1).
//
// Where `reset` draws a boundary and DROPS the prior turns from the model context, `compact`
// SUMMARIZES them: pi-durable's conversation.compact() creates a conversation-owned
// `pi.compaction` task that selects an old prefix, summarizes it with the seat's own model, and
// places a summary entry whose `head` is the first kept entry. The durable transcript is
// preserved (a summary ENTRY, not a deletion) — only the model CONTEXT shrinks.
//
// This demo proves the verb is TRUTHFUL, not an enqueue-and-exit stub: compact() only COMMITS
// the task, so the CLI must resume and WAIT for it (harness.waitForTask) and a `pi.compaction`
// summary entry must actually land. It also proves the live-lease refusal, like `reset`.
//
// Failing-first: before the verb existed, `node cli.mjs compact <seat>` exited 1 with
// "unknown command"; the RED run is recorded against main in the item report.
// Run: node demo/compact.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { CompactionEntry, configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-compact-"));
const db = join(dir, "rig.sqlite");
const seatName = "stuffed";

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
				// The compaction summarizes with the CONVERSATION's configured model, so the
				// CLI's faux provider must expose that id ("faux-seat").
				DURIG_MODEL: "faux-seat",
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

// One long turn: enough text that the recent-context budget (keepRecentTokens, 20000) is
// exceeded and `selectCut` finds a prefix to summarize.
const TURN_CHARS = 4000;
const TURNS = 30;
const INSTRUCTIONS = "fold the early turns into a summary, keep the latest work";
const slotPath = `${db}.genlock.0`;

/** Ids of the `pi.compaction` entries currently in the transcript. */
async function compactionIds(harness, convId) {
	const conv = await harness.conversation(convId, ctx);
	const page = await conv.entries({ order: "descending" }, 200, undefined, ctx);
	return new Set(page.items.filter((e) => e.kind === CompactionEntry.kind).map((e) => String(e.id)));
}

let convId;
try {
	// Seed a LONG transcript so there is something to compact.
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
			for (let i = 0; i < TURNS; i++) {
				faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
				const run = await conv.submit(
					{ type: "input", content: `turn-${i} ${"x".repeat(TURN_CHARS)}` },
					ctx,
				);
				await run.wait(ctx);
			}
			// Precondition: the context is big enough that a cut exists, and no compaction has
			// happened yet (so the entry below is provably OURS).
			const before = await conv.context(ctx);
			assert.ok(before.messages.length > 0, "the seeded context is non-empty");
			const pre = await compactionIds(harness, convId);
			assert.equal(pre.size, 0, `no compaction entry before the verb (got ${pre.size})`);
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	// (a) REFUSAL: a live generation lease for the seat must block the compaction (a running seat
	// must not have its context rewritten out from under the generation that owns it).
	writeFileSync(
		slotPath,
		JSON.stringify({ pid: process.pid, seat: seatName, since: new Date().toISOString() }),
	);
	{
		const { code, stdout, stderr } = await runCli(
			["compact", seatName, INSTRUCTIONS],
			{ DURIG_MAX_CONCURRENT_SEATS: "1" },
		);
		assert.notEqual(code, 0, `compact of a live-lease seat must refuse (exit ${code}; stderr=${stderr.slice(0, 200)})`);
		const report = JSON.parse(stdout.trim());
		assert.equal(report.ok, false, "refusal returns ok:false");
		assert.match(String(report.error), /live generation lease/, "refusal names the reason");
	}
	rmSync(slotPath, { force: true });

	// (b) REAL COMPACTION: the verb reports the task id AND the summary entry it placed.
	let report;
	{
		const { code, stdout, stderr } = await runCli(
			["compact", seatName, INSTRUCTIONS],
			{ DURIG_MAX_CONCURRENT_SEATS: "1" },
		);
		assert.equal(code, 0, `compact exited ${code}; stderr=${stderr.slice(0, 400)}`);
		report = JSON.parse(stdout.trim());
		assert.equal(report.ok, true, "compact ok");
		assert.equal(report.command, "compact");
		assert.equal(report.seat, seatName);
		assert.equal(report.instructions, INSTRUCTIONS);
		assert.ok(report.taskId !== undefined && report.taskId !== null, "a taskId is reported");
		assert.ok(
			report.summaryEntryId !== undefined && report.summaryEntryId !== null,
			`a summaryEntryId must be reported, not just a task id (got ${report.summaryEntryId})`,
		);
	}

	// (c) PROOF IN THE STORE: a NEW `pi.compaction` entry exists, and it is the one the verb
	// reported. A stub that enqueued and exited would leave none.
	{
		const { harness, storage } = await writerHarness();
		try {
			const after = await compactionIds(harness, convId);
			assert.equal(after.size, 1, `exactly one compaction entry after the verb (got ${after.size})`);
			assert.ok(
				after.has(String(report.summaryEntryId)),
				`the reported summaryEntryId (${report.summaryEntryId}) is the stored compaction entry (${[...after].join(",")})`,
			);
			// The transcript is PRESERVED: the earliest seeded turn is still durable even though
			// it left the model context.
			const conv = await harness.conversation(convId, ctx);
			const all = await conv.entries({}, 500, undefined, ctx);
			const texts = JSON.stringify(all.items);
			assert.ok(texts.includes("turn-0 "), "the earliest turn is still in the durable transcript");
		} finally {
			await harness.close(ctx);
			await storage.close(ctx);
		}
	}

	console.log("\nCOMPACT PASS (live-lease refusal; a real summary entry is placed; transcript preserved)");
} catch (err) {
	console.error("\nCOMPACT FAIL:", err?.message?.slice(0, 600) ?? err);
	process.exitCode = 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
