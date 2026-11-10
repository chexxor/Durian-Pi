// demo/continuity-note.test.mjs — the continuation-note extension (D240, milestone D226 / ROADMAP 331).
//
// What it proves, in the order a seat meets it:
//   1. the extension loads ONLY from the explicit DURIG_EXTENSIONS list, and the control run shows the section
//      and the tools are absent when it is not installed;
//   2. `write_note` puts the note in the durable store (source of truth, D130/R2) AND mirrors it to DURIG_NOTES_DIR;
//   3. a compaction whose summary is the note makes ZERO model calls — the summariser request is never built,
//      so the 218 "Summarization hit the token limit" records and the 209 run-cap refusals cannot recur;
//   4. `continue_from_note` draws a fresh context whose only carried state is the note;
//   5. a reset the seat did NOT choose (no handoff - `cli.mjs reset`, `up --refresh`, the degeneration guard)
//      still puts the note in front of the seat's next request, without writing a transcript entry, and stops
//      injecting once the seat has its own context back.
//
// No real model, no network, no broker. fauxProvider answers every request, and the compaction proof is that
// faux's call counter does not move across a compaction that placed a summary.
//
// Run: node demo/continuity-note.test.mjs  (exit 0 = pass)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { CompactionEntry, configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { loadExtensions } from "../src/extensions.mjs";
import { registerSeat, RigQueue, Router } from "../src/rig.mjs";
import { ContinuityNotes, renderNote, noteFileName } from "../extensions/continuity.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ctx = BACKGROUND_CONTEXT;
// `DURIG_CONTINUITY_KEEP_DIR=<path>` keeps the stores instead of deleting them, so a gate (or a human) can
// open the same store the test wrote to. Without it the temp dir is removed at exit, as a demo should.
const KEEP_DIR = process.env.DURIG_CONTINUITY_KEEP_DIR;
if (KEEP_DIR) mkdirSync(KEEP_DIR, { recursive: true });
const dir = KEEP_DIR ?? mkdtempSync(join(tmpdir(), "durig-continuity-"));
// Set BEFORE the first tool call: the extension memoises the mirror directory, exactly as a process does.
const NOTES_DIR = join(dir, "notes");
process.env.DURIG_NOTES_DIR = NOTES_DIR;

// A policy small enough that the harness compacts on its own. The rig's verifier class is a 24,576-token
// window with a 20,480 reserve (durig.config.default.json), so this is the shape a real seat hits, not a fiction.
const SETTINGS = { compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 6000, backgroundTokens: 9000 } };

let failures = 0;
const openedStores = new Set();
function check(label, condition, detail = "") {
	if (!condition) failures++;
	console.log(`  ${condition ? "OK" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Open a rig on its own store; `withContinuity` is the only difference between the two runs. */
async function openRig({ withContinuity, seatName }) {
	const storePath = join(dir, `${withContinuity ? "with" : "without"}.sqlite`);
	// One store per demo run, reused by every scenario, so a gate can inspect a single store that holds all
	// of the proofs. Re-running the demo starts clean rather than failing on a seat the last run registered.
	if (!openedStores.has(storePath)) {
		if (existsSync(storePath)) rmSync(storePath);
		openedStores.add(storePath);
	}
	const storage = await openNodeSqliteStorage(storePath);	const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router); // the rig's own router is always installed; continuity is the only variable
	if (withContinuity) registry.install(continuityExtension);
	const harness = await Harness.open(storage, { models, registry, settings: SETTINGS }, ctx);
	harness.resume();
	const conversationId = await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, seatName, conv.id, "implementation");
		return conv.id;
	}, ctx);
	return { harness, storage, faux, conversationId, seatName };
}

/** The `pi.system` sections the model actually received. */
async function sectionsOf(harness, conversationId) {
	const conv = await harness.conversation(conversationId, ctx);
	const page = await conv.entries({}, 20, undefined, ctx);
	return page.items.find((entry) => entry.kind === "pi.system")?.model?.[0]?.sections ?? {};
}

/** Every `pi.compaction` entry's text in this conversation. */
async function compactionTexts(harness, conversationId) {
	const conv = await harness.conversation(conversationId, ctx);
	const page = await conv.entries({ order: "descending" }, 200, undefined, ctx);
	return page.items
		.filter((entry) => entry.kind === CompactionEntry.kind)
		.map((entry) => (entry.model ?? []).map((m) => m.content?.[0]?.text ?? "").join("\n"))
		.join("\n");
}

let continuityExtension;

try {
	/* ---------------- 1. loading is explicit; the control run shows nothing ---------------- */
	console.log("\n=== 1. the extension is loaded only through DURIG_EXTENSIONS ===");
	const loaded = await loadExtensions(["extensions/continuity.mjs"], { cwd: ROOT });
	continuityExtension = loaded[0]?.extension;
	check("loadExtensions resolves it by name", loaded.length === 1 && loaded[0].name === "durig-continuity",
		loaded.map((l) => l.name).join(","));
	check("an empty list installs nothing (there is no auto-discovery, by design)",
		(await loadExtensions([], { cwd: ROOT })).length === 0);

	{
		const rig = await openRig({ withContinuity: false, seatName: "control" });
		try {
			rig.faux.setResponses([fauxAssistantMessage(fauxText("nothing installed here"))]);
			const conv = await rig.harness.conversation(rig.conversationId, ctx);
			const run = await (await conv.submit({ type: "input", content: "seed the system entry" }, ctx)).wait(ctx);
			check("the control run settled", run.status === "done", String(run.status));
			const sections = await sectionsOf(rig.harness, rig.conversationId);
			check("durig-continuity is ABSENT without the extension (the control)",
				sections["durig-continuity"] === undefined, Object.keys(sections).join(","));
			const agent = await conv.agent(ctx);
			check("read_note/write_note are not offered without the extension",
				!agent.tools.some((tool) => tool.name === "write_note" || tool.name === "read_note"),
				agent.tools.map((t) => t.name).join(","));
		} finally {
			await rig.harness.close(ctx);
		}
	}

	/* ---------------- 2. the note: store is the source of truth, the file is the mirror ---------------- */
	console.log("\n=== 2. write_note lands in the store and mirrors to DURIG_NOTES_DIR ===");
	const rig = await openRig({ withContinuity: true, seatName: "worker" });
	try {
		// A claimed item, so a note can be seeded with a goal even when the seat never names an item.
		await rig.harness.commit(async (tx) => {
			const queue = await tx.doc(RigQueue);
			queue.items.push({
				id: queue.nextId,
				from: "pm",
				to: "worker",
				subject: "Repair the compaction fallback",
				body: "nest modelOverrides inside compaction",
				status: "claimed",
			});
			queue.nextId += 1;
		}, ctx);
		const itemId = (await rig.harness.snapshot(RigQueue, undefined, ctx)).items[0].id;

		rig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write_note", {
				itemId,
				goal: "Repair the compaction fallback so per-model overrides reach the harness.",
				verified: [{ claim: "src/config.mjs emits modelOverrides inside compaction", evidence: "src/config.mjs:532" }],
				hypotheses: ["the verifier family is the one at the window"],
				constraints: ["D212: customization stays on the extension plane"],
				done: [{ what: "the note doc is defined", evidence: "extensions/continuity.mjs" }],
				next: { action: "run the offline resume demo", where: "demo/" },
				blockers: [{ what: "no provider key on this box", owner: "operator" }],
				worktree: "/tmp/item-1-worktree",
				filesTouched: ["src/config.mjs"],
			})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("note written")),
		]);
		const conv = await rig.harness.conversation(rig.conversationId, ctx);
		const written = await (await conv.submit({ type: "input", content: "note your item" }, ctx)).wait(ctx);
		check("the generation that wrote the note settled", written.status === "done", String(written.status));
		const sections = await sectionsOf(rig.harness, rig.conversationId);
		check("the static section reaches the model",
			String(sections["durig-continuity"] ?? "").includes("continuation note"), Object.keys(sections).join(","));

		const note = (await rig.harness.snapshot(ContinuityNotes, rig.conversationId, ctx));
		check("the note is in the durable store", !!note?.goal?.startsWith("Repair the compaction fallback"));
		check("the seat is identified from the roster", note?.seat === "worker", String(note?.seat));
		check("evidence travels with the claim", note?.verified?.[0]?.evidence === "src/config.mjs:532");
		const mirrorPath = join(NOTES_DIR, noteFileName(note, rig.conversationId));
		check("the mirror file exists at DURIG_NOTES_DIR", existsSync(mirrorPath), mirrorPath);
		const mirror = readFileSync(mirrorPath, "utf8");
		check("the mirror carries the goal, the verified claim and the next action",
			mirror.includes("Goal:") && mirror.includes("Verified (evidence-backed)") && mirror.includes("Next:"),
			mirror.split("\n")[0]);

		rig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read_note", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("read it")),
		]);
		await (await conv.submit({ type: "input", content: "re-read the note" }, ctx)).wait(ctx);
		const transcript = JSON.stringify(await (await rig.harness.conversation(rig.conversationId, ctx))
			.entries({ order: "descending" }, 50, undefined, ctx));
		check("read_note returns the note and its mirror path",
			transcript.includes("CONTINUITY NOTE") && transcript.includes(NOTES_DIR), transcript.slice(0, 150));
	} finally {
		await rig.harness.close(ctx);
	}

	/* ---------------- 3. a compaction that needs no model ---------------- */
	console.log("\n=== 3. compaction: the note IS the summary, and no summariser call is made ===");
	const compactRig = await openRig({ withContinuity: true, seatName: "stuffed" });
	try {
		const conv = await compactRig.harness.conversation(compactRig.conversationId, ctx);
		// The note first, then a long transcript: 20 turns of 2,000 chars is ~10k tokens, above the
		// 6,000 keepRecent budget, so a cut exists and the harness compacts.
		compactRig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write_note", {
				goal: "Finish the item that does not fit in one window.",
				verified: [{ claim: "the auditor is at 106% of its declared window", evidence: "milestone-check.mjs" }],
				next: "keep writing the note as work lands",
			})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("noted")),
		]);
		await (await conv.submit({ type: "input", content: "note the item before the window fills" }, ctx)).wait(ctx);

		for (let i = 0; i < 20; i++) {
			compactRig.faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
			await (await conv.submit({ type: "input", content: `turn-${i} ${"x".repeat(2000)} marker-${i}` }, ctx)).wait(ctx);
		}

		const callsBefore = compactRig.faux.state.callCount;
		const taskId = await conv.compact("fold the early turns", ctx);
		const settled = await compactRig.harness.waitForTask(taskId, ctx);
		const texts = await compactionTexts(compactRig.harness, compactRig.conversationId);


		check("the compaction settled", settled !== undefined && !String(JSON.stringify(settled)).includes('"failed"'),
			JSON.stringify(settled).slice(0, 140));
		check("a pi.compaction entry was placed", texts.includes("was compacted into the following summary"),
			texts.slice(0, 120));
		check("the summary body is the seat's note", texts.includes("CONTINUITY NOTE") && texts.includes("Goal: Finish the item"),
			texts.slice(0, 160));
		check("the cut turns are still represented by a deterministic digest", texts.includes("Deterministic digest of"));
		check("ZERO model calls were made by the compaction",
			compactRig.faux.state.callCount === callsBefore,
			`callCount before=${callsBefore} after=${compactRig.faux.state.callCount}`);

		const contextText = JSON.stringify((await conv.context(ctx)).messages);
		// A marker at the END of the oldest turn's payload: the digest clips each cut turn to 200 chars,
		// so seeing it in the context means the cut turn itself is still in the window.
		check("the cut turns are out of the model context", !contextText.includes("marker-0"),
			`context messages: ${(await conv.context(ctx)).messages.length}`);
		const durable = JSON.stringify((await conv.entries({}, 500, undefined, ctx)).items);
		check("the transcript is preserved - only the context shrank", durable.includes("marker-0"));
	} finally {
		await compactRig.harness.close(ctx);
	}

	/* ---------------- 4. a fresh context seeded by the note alone ---------------- */
	console.log("\n=== 4. continue_from_note seeds a fresh context with the note alone ===");
	const handoffRig = await openRig({ withContinuity: true, seatName: "handoff" });
	try {
		const conv = await handoffRig.harness.conversation(handoffRig.conversationId, ctx);
		await (await conv.submit({ type: "input", content: "the first thing I did, which must not survive the boundary" }, ctx)).wait(ctx);

		handoffRig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write_note", {
				goal: "Verify the handoff seeds a fresh context.",
				verified: [{ claim: "the note doc is conversation-scoped", evidence: "extensions/continuity.mjs" }],
				next: "call continue_from_note",
			})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("noted")),
		]);
		await (await conv.submit({ type: "input", content: "note the work" }, ctx)).wait(ctx);

		handoffRig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("continue_from_note", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("handed off")),
		]);
		const handedOff = await (await conv.submit({ type: "input", content: "continue on a fresh context" }, ctx)).wait(ctx);
		check("the handoff run settled", handedOff.status === "done", String(handedOff.status));

		const messages = (await conv.context(ctx)).messages;
		const contextText = JSON.stringify(messages);
		check("the pre-handoff turn is gone from the context", !contextText.includes("the first thing I did"),
			`context messages: ${messages.length}`);
		check("the note is what the fresh context sees", contextText.includes("CONTINUITY NOTE"), contextText.slice(0, 200));

		// A NEW run on the fresh context: everything it knows comes from the note.
		handoffRig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read_note", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("Next: call continue_from_note.")),
		]);
		const resumed = await (await conv.submit({ type: "input", content: "pick up where you left off" }, ctx)).wait(ctx);
		check("the fresh run answered on the new context", resumed.status === "done", String(resumed.status));
		const freshText = JSON.stringify((await conv.context(ctx)).messages);
		check("the fresh run's context is the note plus this turn only",
			freshText.includes("CONTINUITY NOTE") && freshText.includes("pick up where you left off")
			&& !freshText.includes("the first thing I did"), freshText.slice(0, 240));
		const note = (await handoffRig.harness.snapshot(ContinuityNotes, handoffRig.conversationId, ctx));
		check("the note survived the boundary", renderNote(note).includes("Verify the handoff seeds a fresh context"));
	} finally {
		await handoffRig.harness.close(ctx);
	}

	/* ---------------- 5. the boundary the seat did not choose ---------------- */
	console.log("\n=== 5. a plain reset (no handoff) still puts the note in front of the seat ===");
	const wokenRig = await openRig({ withContinuity: true, seatName: "woken" });
	try {
		const conv = await wokenRig.harness.conversation(wokenRig.conversationId, ctx);
		wokenRig.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write_note", {
				itemId: 42,
				goal: "Wake in a fresh context and still know the item.",
				verified: [{ claim: "the note doc is conversation-scoped", evidence: "extensions/continuity.mjs" }],
				next: "act on the goal without re-reading the transcript",
			})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("noted")),
		]);
		await (await conv.submit({ type: "input", content: "note the item first" }, ctx)).wait(ctx);

		// `cli.mjs reset <seat>`, `up --refresh` and the degeneration guard all call reset with NO handoff, so
		// the fresh context would otherwise start from nothing - the symptom D240 exists to close.
		await conv.reset(undefined, ctx);

		let requestText = "";
		wokenRig.faux.setResponses([
			(fauxContext) => {
				requestText = JSON.stringify(fauxContext.messages);
				return fauxAssistantMessage(fauxText("I know the goal without being told it again"));
			},
			fauxAssistantMessage(fauxText("done")),
		]);
		const woken = await (await conv.submit({ type: "input", content: "wake" }, ctx)).wait(ctx);
		check("the woken run settled", woken.status === "done", String(woken.status));
		check("the note reached the provider request", requestText.includes("CONTINUITY NOTE") && requestText.includes("Wake in a fresh context"), requestText.slice(0, 160));
		check("the note reached it in the system message, not as an extra turn",
			JSON.parse(requestText)[0].role === "system" && JSON.parse(requestText).filter((m) => m.role !== "system").length === 1,
			JSON.parse(requestText).map((m) => m.role).join(","));

		const transcript = JSON.stringify((await conv.entries({}, 500, undefined, ctx)).items);
		check("injection is request-only: no entry was written for the injected note",
			!transcript.includes("read from your own durable record"),
			`transcript entries: ${(await conv.entries({}, 500, undefined, ctx)).items.length}`);

		// Once the seat has its own context back, the note is not re-injected: the mechanism is a boundary
		// mechanism, not a per-request tax (ROADMAP 175 cache economics).
		let laterRequestText = "";
		wokenRig.faux.setResponses([
			(fauxContext) => {
				laterRequestText = JSON.stringify(fauxContext.messages);
				return fauxAssistantMessage(fauxText("still working"));
			},
			fauxAssistantMessage(fauxText("done")),
		]);
		await (await conv.submit({ type: "input", content: "a second turn, so the context is no longer fresh" }, ctx)).wait(ctx);
		check("the note is not injected once the seat has its own context back", !laterRequestText.includes("CONTINUITY NOTE"),
			`visible roles: ${JSON.parse(laterRequestText).map((m) => m.role).join(",")}`);

		// A seat with no note gets nothing injected - the guard cannot invent a goal.
		const bareRig = await openRig({ withContinuity: true, seatName: "bare" });
		try {
			const bareConv = await bareRig.harness.conversation(bareRig.conversationId, ctx);
			let bareRequest = "";
			bareRig.faux.setResponses([
				(fauxContext) => {
					bareRequest = JSON.stringify(fauxContext.messages);
					return fauxAssistantMessage(fauxText("no note, no injection"));
				},
				fauxAssistantMessage(fauxText("done")),
			]);
			await (await bareConv.submit({ type: "input", content: "start" }, ctx)).wait(ctx);
			check("no note means no injection", !bareRequest.includes("CONTINUITY NOTE"), bareRequest.slice(0, 120));
		} finally {
			await bareRig.harness.close(ctx);
		}
	} finally {
		await wokenRig.harness.close(ctx);
	}

	console.log(`\nCONTINUITY ${failures === 0 ? "PASS" : `FAIL (${failures} check(s) failed)`}`);
	if (KEEP_DIR) console.log(`  stores kept for the gate: ${join(dir, "with.sqlite")} (mirror: ${NOTES_DIR})`);
	if (failures > 0) process.exitCode = 1;
} catch (err) {
	console.error("\nCONTINUITY FAIL:", err?.message?.slice(0, 800) ?? err);
	process.exitCode = 1;
} finally {
	if (!KEEP_DIR) rmSync(dir, { recursive: true, force: true });
}
