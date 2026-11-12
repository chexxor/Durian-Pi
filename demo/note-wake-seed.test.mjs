// demo/note-wake-seed.test.mjs — #6161 milestone 1: the wake seed is DURABLE, not merely rendered.
//
// The problem this closes, in one sentence: before #6161 the "seed from the claimed item" existed only as a
// string built inside the compaction summary. Nothing was written to the conversation's note doc, so at a
// reset or a `continue_from_note` handoff there was no note to carry - `read_note` answered "NO CONTINUITY
// NOTE YET", the mirror file never existed, and a seat woken cold had no goal in its store at all. A seed
// that only appears in a summary is not durability; it is a display.
//
// What this demo proves, in the order a seat meets it:
//   1. at the WAKE (the first request while the seat holds a claimed or queued item), the rig WRITES the
//      seed into the seat's own `durig.notes` doc: goal, itemId, seat, origin "wake-seed", updatedAt;
//   2. the mirror file for that item exists at DURIG_NOTES_DIR, so a gate or a human can read the goal
//      without opening the store;
//   3. `read_note` returns it - the durability claim, tested through the tool the seat actually uses;
//   4. `continue_from_note` hands off the seeded goal instead of saying "NO CONTINUITY NOTE: nothing to hand
//      off" - the boundary that used to lose the seed now carries it;
//   5. a rig seed is refreshed when the seat moves to a different item, and never overwrites a note the
//      seat wrote itself;
//   6. a seat holding nothing gets no phantom note and no phantom mirror.
//
// RED-BEFORE: run this file against main (35001c3a) in a scratch worktree and checks 1-4 fail - the doc
// stays empty, the mirror file is absent, `read_note` says "NO CONTINUITY NOTE YET", and the handoff
// refuses for lack of a note. (Command and exit code are recorded in the item's completion.)
//
// No real model, no network, no broker. Run: node demo/note-wake-seed.test.mjs (exit 0 = pass)
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { loadExtensions } from "../src/extensions.mjs";
import { registerSeat, RigQueue, Router } from "../src/rig.mjs";
import { ContinuityNotes, renderNote, noteFileName } from "../extensions/continuity.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ctx = BACKGROUND_CONTEXT;
// `DURIG_CONTINUITY_KEEP_DIR=<path>` keeps the stores instead of deleting them, so a gate (or a human) can
// open the same store the test wrote to.
const KEEP_DIR = process.env.DURIG_CONTINUITY_KEEP_DIR;
if (KEEP_DIR) mkdirSync(KEEP_DIR, { recursive: true });
const dir = KEEP_DIR ?? mkdtempSync(join(tmpdir(), "durig-wake-seed-"));
// Set BEFORE the first tool call: the extension memoises the mirror directory, exactly as a process does.
const NOTES_DIR = join(dir, "notes");
process.env.DURIG_NOTES_DIR = NOTES_DIR;

// A policy small enough that the harness compacts on its own; only the wake path is exercised here.
const SETTINGS = { compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 6000, backgroundTokens: 9000 } };

let failures = 0;
const json = (value) => JSON.stringify(value ?? null);
function check(label, condition, detail = "") {
	if (!condition) failures++;
	console.log(`  ${condition ? "OK" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

let continuityExtension;

/** A rig on its own store, with the continuity extension installed. */
async function openRig(seatName, storeName) {
	const storePath = join(dir, `${storeName}.sqlite`);
	if (existsSync(storePath)) rmSync(storePath);
	const storage = await openNodeSqliteStorage(storePath);
	const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	registry.install(continuityExtension);
	const harness = await Harness.open(storage, { models, registry, settings: SETTINGS }, ctx);
	harness.resume();
	const conversationId = await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, seatName, conv.id, "implementation");
		return conv.id;
	}, ctx);
	return { harness, faux, conversationId, seatName };
}

/** Put an item in the queue for this rig's seat. */
async function holdItem(rig, { id, subject, status }) {
	await rig.harness.commit(async (tx) => {
		const queue = await tx.doc(RigQueue);
		queue.items.push({ id, from: "pm", to: rig.seatName, subject, body: "the body", status });
		if (queue.nextId <= id) queue.nextId = id + 1;
	}, ctx);
}

const noteOf = async (rig) => rig.harness.snapshot(ContinuityNotes, rig.conversationId, ctx);

async function transcriptOf(rig, limit = 50) {
	const conv = await rig.harness.conversation(rig.conversationId, ctx);
	return JSON.stringify(await conv.entries({ order: "descending" }, limit, undefined, ctx));
}

async function submit(rig, text) {
	const conv = await rig.harness.conversation(rig.conversationId, ctx);
	return (await conv.submit({ type: "input", content: text }, ctx)).wait(ctx);
}

try {
	continuityExtension = (await loadExtensions(["extensions/continuity.mjs"], { cwd: ROOT }))[0]?.extension;
	check("the extension loads", !!continuityExtension, String(continuityExtension?.name));

	/* ---------- 1. the wake WRITES the seed into the note doc ---------- */
	console.log("\n=== 1. at the wake, the seed is WRITTEN, not just rendered ===");
	const waker = await openRig("waker", "waker");
	try {
		await holdItem(waker, { id: 77, subject: "Make the wake seed durable", status: "claimed" });
		const before = await noteOf(waker);
		check("before the run the note doc is the untouched initial state (this is what HEAD leaves behind)",
			renderNote(before) === "", json(before).slice(0, 120));

		waker.faux.setResponses([fauxAssistantMessage(fauxText("starting"))]);
		const run = await submit(waker, "wake: work on item 77");
		check("the wake run settled", run.status === "done", String(run.status));

		const note = await noteOf(waker);
		check("the seed is in the durable note doc: the goal is the claimed item's subject",
			note?.goal === "Make the wake seed durable", json({ goal: note?.goal, itemId: note?.itemId }));
		check("the seed names the item the seat is holding", note?.itemId === 77, String(note?.itemId));
		check("the seed says the RIG wrote it, so the census can tell it from a seat's own note",
			note?.origin === "wake-seed", String(note?.origin));
		check("the seed is timestamped", typeof note?.updatedAt === "string" && note.updatedAt.length > 0, String(note?.updatedAt));

		const mirrorPath = join(NOTES_DIR, noteFileName(note, waker.conversationId));
		check("the mirror file exists at the wake", existsSync(mirrorPath), mirrorPath);
		check("the mirror carries the goal",
			existsSync(mirrorPath) && readFileSync(mirrorPath, "utf8").includes("Make the wake seed durable"),
			mirrorPath.split("/").pop());

		/* ---------- 2. the seat can read what the rig wrote ---------- */
		waker.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read_note", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("read it")),
		]);
		await submit(waker, "what am I working on?");
		const readBack = await transcriptOf(waker);
		check("read_note returns the seeded goal instead of 'NO CONTINUITY NOTE YET'",
			!readBack.includes("NO CONTINUITY NOTE YET") && readBack.includes("Goal: Make the wake seed durable"),
			readBack.includes("NO CONTINUITY NOTE YET") ? "read_note still reports an empty note" : readBack.slice(0, 160));

		/* ---------- 3. the handoff boundary carries the seed ---------- */
		waker.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("continue_from_note", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("continued")),
		]);
		await submit(waker, "continue in a fresh context");
		const handoff = await transcriptOf(waker);
		check("continue_from_note hands off the seeded goal rather than refusing",
			handoff.includes("Handing off to a fresh context seeded with this note") && handoff.includes("Goal: Make the wake seed durable"),
			handoff.includes("NO CONTINUITY NOTE") ? "the handoff found no note: the seed was never written" : handoff.slice(0, 160));

		/* ---------- 4. the injection guard: the seed is only rewritten at a genuine wake ---------- */
		await holdItem(waker, { id: 78, subject: "Next item for the same seat", status: "claimed" });
		waker.faux.setResponses([fauxAssistantMessage(fauxText("on the next item"))]);
		await submit(waker, "the first item is done, start the next");
		const settledNote = await noteOf(waker);
		check("once the seat has its context back the rig stops touching the note (the guard held)",
			settledNote?.itemId === 77 && settledNote?.goal === "Make the wake seed durable",
			json({ itemId: settledNote?.itemId, goal: settledNote?.goal }));
	} finally {
		await waker.harness.close(ctx);
	}

	/* ---------- 5. at a real wake (fresh context) the seed follows the current claim ---------- */
	console.log("\n=== 2. a rig seed follows the seat's current claim at the wake ===");
	const mover = await openRig("mover", "mover");
	try {
		await holdItem(mover, { id: 78, subject: "Next item for the same seat", status: "claimed" });
		mover.faux.setResponses([fauxAssistantMessage(fauxText("moved on"))]);
		await submit(mover, "wake on the newer claim");
		const seeded = await noteOf(mover);
		check("the fresh wake seeds the CURRENT claim (78), stamped wake-seed",
			seeded?.itemId === 78 && seeded?.goal === "Next item for the same seat" && seeded?.origin === "wake-seed",
			json({ itemId: seeded?.itemId, goal: seeded?.goal, origin: seeded?.origin }));
	} finally {
		await mover.harness.close(ctx);
	}

	/* ---------- 5. the rig never overwrites a seat's own note ---------- */
	console.log("\n=== 3. a note the seat wrote is never overwritten by the rig ===");
	const author = await openRig("author", "author");
	try {
		await holdItem(author, { id: 90, subject: "Item the seat is actually doing", status: "claimed" });
		author.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write_note", { itemId: 90, goal: "Authored by the seat itself", next: "keep going" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("noted")),
		]);
		await submit(author, "write my own note");
		const authored = await noteOf(author);
		check("the seat's note is in the store", authored?.goal === "Authored by the seat itself", json({ goal: authored?.goal }));
		check("writing it marks the note as the seat's own", authored?.origin === "seat", String(authored?.origin));

		await holdItem(author, { id: 91, subject: "A newer item for the same seat", status: "claimed" });
		author.faux.setResponses([fauxAssistantMessage(fauxText("woken on the newer item"))]);
		await submit(author, "wake again");
		const still = await noteOf(author);
		check("the wake seed does not overwrite a seat-authored note",
			still?.goal === "Authored by the seat itself" && still?.origin === "seat",
			json({ goal: still?.goal, origin: still?.origin }));
	} finally {
		await author.harness.close(ctx);
	}

	/* ---------- 6. a seat holding nothing gets no phantom note ---------- */
	console.log("\n=== 4. a seat with nothing to do is left empty (no phantom seed) ===");
	const quiet = await openRig("quiet", "quiet");
	try {
		quiet.faux.setResponses([fauxAssistantMessage(fauxText("nothing to do here"))]);
		await submit(quiet, "wake with an empty queue");
		const note = await noteOf(quiet);
		check("no note was invented for a seat holding no item", renderNote(note) === "", json(note).slice(0, 140));
		check("no mirror file was written for it", !existsSync(join(NOTES_DIR, noteFileName(note, quiet.conversationId))), NOTES_DIR);
	} finally {
		await quiet.harness.close(ctx);
	}

	console.log(`\n${failures === 0 ? "WAKE-SEED PASS" : "WAKE-SEED FAIL"}: ${failures} failed check(s) — demo/note-wake-seed.test.mjs`);
} catch (error) {
	console.error("the demo itself crashed:", error);
	failures++;
} finally {
	if (!KEEP_DIR) rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
