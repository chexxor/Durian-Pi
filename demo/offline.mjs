// durian-pi offline demo: full delegation loop on the durable queue.
//
// Scenario: a "pm" seat sends work to a "worker" seat via send_work; the
// worker claims it, completes it; the DONE notice lands back in pm's queue.
// Models are faux (offline): pm's model calls send_work then finishes; the
// worker's model calls claim_work then complete_work. No network, no keys.
//
// THE SECOND HALF (D240) is the same loop run with the worker crossing a fresh-context boundary in the middle of
// the item: it writes a continuation note, hands off with continue_from_note, and finishes the item in the new
// context from the note alone. That is the proof the seat does not need compaction to survive a long item.
//
// Response scripting note (learned in spike R2): scripted responses drain in
// GLOBAL call order across conversations. Call order here:
//   1) pm turn 1  -> send_work tool call
//   2) pm turn 2  -> final answer (worker has not run yet; work sits queued)
//   3) worker turn 1 -> claim_work tool call
//   4) worker turn 2 -> write_note tool call
//   5) worker turn 3 -> continue_from_note tool call (draws the reset boundary; the run ends)
//   6) worker turn 4 (FRESH context) -> read_note tool call
//   7) worker turn 5 -> complete_work tool call
//   8) worker turn 6 -> final answer
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	configure,
	createRegistry,
	Harness,
	MemoryStorage,
} from "@earendil-works/pi-durable";
import { RigQueue, Router, registerSeat } from "../src/rig.mjs";
import { loadExtensions, parseExtensionList } from "../src/extensions.mjs";
import { ContinuityNotes } from "../extensions/continuity.mjs";

const ctx = BACKGROUND_CONTEXT;

// The mirror directory is a real directory for the duration of the demo only, so the demo never writes into
// the rig's own .durig/ and can assert on the file the seat wrote.
const NOTES_DIR = mkdtempSync(join(tmpdir(), "durig-offline-notes-"));
process.env.DURIG_NOTES_DIR = NOTES_DIR;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const registry = createRegistry();
registry.install(Router);

// THE EXTENSION PLANE (D212): nothing is discovered. The rig installs only what the DURIG_EXTENSIONS list names.
const extensions = await loadExtensions(parseExtensionList(process.env.DURIG_EXTENSIONS || "extensions/continuity.mjs"), { cwd: process.cwd() });
for (const { name, path } of extensions) console.log(`extension loaded from the explicit list: ${name} <- ${path}`);
for (const { extension } of extensions) registry.install(extension);

const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

// Register both seats up-front (driver-side bootstrap; a real rig would do
// this through a CLI command).
await harness.commit(async (tx) => {
	const pm = await tx.createConversation({ ownership: { kind: "ownerless" } });
	const worker = await tx.createConversation({ ownership: { kind: "ownerless" } });
	await configure(tx, pm.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await configure(tx, worker.id, { model: { provider: "faux", modelId: "faux-seat" } });
	await registerSeat(tx, "pm", pm.id, "program manager");
	await registerSeat(tx, "worker", worker.id, "implementation");
}, ctx);

const seatsDoc = await harness.documentState((await import("../src/rig.mjs")).Seats, undefined, ctx);
console.log("seats registered:", JSON.stringify(seatsDoc?.value?.seats ?? seatsDoc));

// Scripted responses in global call order (see header).
faux.setResponses([
	// 1) pm turn 1: delegate to worker
	fauxAssistantMessage([
		fauxText("Routing this to the worker."),
		fauxToolCall("send_work", {
			to: "worker",
			subject: "Implement login fix",
			body: "Fix the flaky login test on staging.",
		}),
	], { stopReason: "toolUse" }),
	// 2) pm turn 2: done for now (work sits queued until worker runs)
	fauxAssistantMessage(fauxText("Work queued for worker.")),
	// 3) worker turn 1: claim it
	fauxAssistantMessage(
		[fauxToolCall("claim_work", {})],
		{ stopReason: "toolUse" },
	),
	// 4) worker turn 2: write the continuation note BEFORE the boundary, so the handoff has something to carry.
	fauxAssistantMessage(
		[
			fauxToolCall("write_note", {
				itemId: 1,
				goal: "Implement login fix",
				verified: [{ claim: "the flaky test is on staging", evidence: "QUEUE #1 body" }],
				hypotheses: ["the flake is a timing race"],
				next: { action: "stabilize the login test and report the result" },
			}),
		],
		{ stopReason: "toolUse" },
	),
	// 5) worker turn 3: hand off to a FRESH context seeded with the note. This is the reset boundary; the run ends.
	fauxAssistantMessage(
		[fauxToolCall("continue_from_note", {})],
		{ stopReason: "toolUse" },
	),
	// 6) worker turn 4 (fresh context): re-read the note - the transcript is gone, the note is not.
	fauxAssistantMessage(
		[fauxToolCall("read_note", {})],
		{ stopReason: "toolUse" },
	),
	// 7) worker turn 5: complete the item, using only what the note carried.
	fauxAssistantMessage(
		[fauxToolCall("complete_work", { itemId: 1, resultSummary: "Login test stabilized." })],
		{ stopReason: "toolUse" },
	),
	// 8) worker turn 6: idle
	fauxAssistantMessage(fauxText("Queue clear.")),
]);

const { Seats } = await import("../src/rig.mjs");
const seatsVal = await harness.documentState(Seats, undefined, ctx);
const roster = seatsVal?.value?.seats ?? {};
const pmConv = await harness.conversation(roster.pm.conversationId, ctx);
const workerConv = await harness.conversation(roster.worker.conversationId, ctx);

// PM runs first (calls 1-2), then worker runs (calls 3-5), hands off, and runs again (calls 6-8).
const pmRun = await pmConv.submit({ type: "input", content: "Ship the login fix." }, ctx);
await pmRun.wait(ctx);
console.log("-- pm run settled");

const workerRun = await workerConv.submit({ type: "input", content: "Check your queue." }, ctx);
await workerRun.wait(ctx);
console.log("-- worker run settled (claimed, noted, handed off)");

// The boundary already happened: `continue_from_note` returned `control.handoff`, which generation.js turns into
// a ResetEntry whose head is the note (dist/harness/generation.js:547-557). A new run therefore starts with the
// note as its first user message and none of the earlier turns.
const freshContext = (await workerConv.context(ctx)).messages;
const freshText = JSON.stringify(freshContext);
const noteText = JSON.stringify((await harness.documentState(ContinuityNotes, roster.worker.conversationId, ctx))?.value ?? {});

const resumed = await workerConv.submit({ type: "input", content: "Continue the item in a fresh context." }, ctx);
await resumed.wait(ctx);
console.log("-- worker resumed run settled");

// Dump final queue state as evidence.
const qDoc = await harness.documentState(RigQueue, undefined, ctx);
const q = qDoc?.value ?? {};
for (const it of q.items ?? []) {
	console.log(`QUEUE #${it.id} [${it.status}] ${it.from}->${it.to} :: ${it.subject}${it.resultSummary ? ` :: result=${it.resultSummary}` : ""}`);
}

// Assertions - the demo FAILS loudly if the loop did not close.
const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL:", msg); process.exit(1); } };
const items = q.items ?? [];
assert(items.length === 2, `expected 2 items (work + DONE notice), got ${items.length}`);
assert(items[0].status === "done", `item #1 should be done, got ${items[0].status}`);
assert(items[0].resultSummary === "Login test stabilized.", `unexpected result summary`);
assert(items[1].to === "pm" && items[1].subject.startsWith("DONE #1"), `DONE notice should be addressed back to pm`);

// The continuity half: the item survived a fresh context, and the note - not the transcript - is what carried it.
assert(noteText.includes("Implement login fix"), "the note did not survive the boundary in the durable store");
assert(freshText.includes("CONTINUITY NOTE"), "the fresh context did not carry the note");
assert(!freshText.includes("Ship the login fix."), "the pre-boundary turn was still in the fresh context");
assert(freshContext.length <= 4, `the fresh context should be short, got ${freshContext.length} messages`);

// The boundary is a real store event, not a prompt trick. `control.handoff` and `conversation.reset(handoff)`
// both append a `pi.reset` entry with `head: "self"` (dist/harness/generation.js:557-558 and
// dist/harness/harness.js:45-49); everything before it stays in the durable transcript for recall (ROADMAP 176).
const workerEntries = (await workerConv.entries({}, 200, undefined, ctx)).items;
const boundaries = workerEntries.filter((entry) => entry.kind === "pi.reset");
assert(boundaries.length === 1, `expected exactly one pi.reset boundary, got ${boundaries.length}`);
assert(JSON.stringify(boundaries[0].model ?? "").includes("CONTINUITY NOTE"), "the reset entry did not carry the note as its head message");
assert(workerEntries.some((entry) => JSON.stringify(entry).includes("Check your queue.")), "the durable transcript lost the pre-boundary turns");
assert(existsSync(join(NOTES_DIR, "item-1.md")), "the note was not mirrored to DURIG_NOTES_DIR");

const resumedText = JSON.stringify((await workerConv.context(ctx)).messages);
assert(resumedText.includes("CONTINUITY NOTE") && !resumedText.includes("Check your queue."),
	"the resumed run still carried pre-boundary turns in its context");
console.log(`BOUNDARY: ${boundaries.length} pi.reset entry; pre-boundary turns still in the store (${workerEntries.length} entries)`);
console.log(`FRESH CONTEXT: ${freshContext.length} message(s), carrying the note; the pre-boundary turns are gone`);
console.log(`NOTE MIRROR: ${join(NOTES_DIR, "item-1.md")}`);

console.log("DEMO PASS");
await harness.close(ctx);
rmSync(NOTES_DIR, { recursive: true, force: true });
