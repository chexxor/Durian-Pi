// Thin-context return contract test (ROADMAP agent-fleet borrow, RANK 1). Source
// of truth: vendor/eval/agent-fleet @ 7c34dde docs/ARCHITECTURE.md (research
// findings "written to disk — hub gets paths, not dumps"); durian-pi shape per
// docs/COMPETITORS.md ("durian-pi seats already write to disk, but our tool results
// still return bodies; the lesson is the return contract"). Lead ruling (item
// #75): additive opt-in path-return at src/rig.mjs toolText() — the LARGEST
// inliner (claim_work's full subject+body) defers to disk over a threshold;
// small results stay byte-identical/inline; deterministic file
// cwd/.durian-pi/<itemId>.md; the coordinator reads the body back via its EXISTING
// read tools (the returned value IS the path).
// This proves:
//   (a) an over-threshold claim_work returns A PATH (not the inlined body), and
//       the file at cwd/.durian-pi/<itemId>.md CONTAINS that body;
//   (b) a small claim_work still returns the body INLINE (regression / byte-identical);
//   (c) idempotent: re-claiming the small item returns NO_QUEUED_WORK (the file is
//       not duplicated); the large body is written once to a deterministic path.
// Run: node demo/thincontext.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster, makeSeatEnv } from "../src/seattools.mjs";

// Match the seam's default inline threshold (src/rig.mjs TOOL_RESULT_INLINE_LIMIT).
// Hardcoded here (not imported) so the failing-first run against HEAD fails at the
// path-return assertion - the actual defect - rather than at the module boundary.
const INLINE_LIMIT = 2000;

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

async function runHarness() {
	const roster = new Map();
	const storage = new MemoryStorage();
	const harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);
	return { harness, roster };
}

const dir = mkdtempSync(join(tmpdir(), "durig-thincontext-"));
const cwd = join(dir, "seat-workspace");
const LARGE = "LARGE_".repeat(INLINE_LIMIT); // comfortably over threshold
const SMALL = "small body";

let harness;
let roster;
try {
	({ harness, roster } = await runHarness());
	let workerId;
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
		await registerSeat(tx, "worker", conv.id, "implementation");
		// A working capability is what keeps the read tool (`seatHasReadTool`), so this seat is the
		// one the thin path is FOR: over threshold it gets the head + path, not the body (#144 B).
		(await tx.doc(Seats)).seats.worker.capabilities = ["implement"];
		workerId = conv.id;
	}, ctx);
	const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	fillRoster(roster, seats);
	const conv = await harness.conversation(workerId, ctx);

	const driveClaim = async () => {
		const before = await conv.submit({ type: "input", content: "go" }, ctx);
		// Prime the protocol: claim_work in this turn, settle with a reply.
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("claim handled")),
		]);
		await before.wait(ctx);
		const pg = await conv.entries({}, 50, undefined, ctx);
		const result = pg.items.find(
			(e) =>
				e.kind === "pi.tool-result" &&
				String(e.model?.[0]?.toolName) === "claim_work",
		);
		return result?.model?.[0]?.content?.[0]?.text ?? "";
	};

	// --- (a) OVER threshold: claim the large item -> the result is a PATH,
	// the body is NOT inline, and the file at cwd/.durian-pi/<id>.md contains it.
	const largeId = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "worker", "Big task", LARGE),
	ctx);
	const largeResult = await driveClaim();
	// The returned path uses the OS separator (\ on Windows, / on POSIX); accept
	// either so the assertion is deterministic across hosts.
	assert.ok(
		/\.durig[\\\/]/.test(largeResult) && largeResult.includes(`item #${largeId}`),
		`over-threshold claim must return a PATH, not the body; got: ${largeResult.slice(0, 120)}`,
	);
	// A coordinator seat (pm) has no read tool, so the over-threshold RETURN must
	// carry a DELIBERATE STRUCTURED HEADER (item id + subject + from + status), not a
	// mid-body byte cut — the body itself stays on disk (#118 half 2, lead #125).
	// Assert the structured head is present AND the result stays bounded (the full
	// body is NOT inlined).
	assert.ok(largeResult.includes("Big task"), "the structured header carries the subject");
	assert.ok(largeResult.includes(`item #${largeId}`), "the structured header carries the item id");
	assert.ok(
		largeResult.length < INLINE_LIMIT + 400,
		`the result must stay BOUNDED (a structured head), not the full body; got ${largeResult.length} chars`,
	);
	const largeFile = join(cwd, ".durig", `${largeId}.md`);
	assert.ok(existsSync(largeFile), "the body file was written to cwd/.durig/<id>.md");
	assert.ok(readFileSync(largeFile, "utf8").includes("LARGE_"), "the file at the path contains the full body");

	// --- (b) UNDER threshold: claim the small item -> the body stays INLINE.
	const smallId = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "worker", "Small task", SMALL),
	ctx);
	const smallResult = await driveClaim();
	assert.ok(
		smallResult.includes(SMALL) && smallResult.includes("Small task"),
		`small claim must stay inline; got: ${smallResult.slice(0, 120)}`,
	);
	const smallFile = join(cwd, ".durig", `${smallId}.md`);
	assert.ok(!existsSync(smallFile), "under-threshold body is not written to disk");

	// --- (c) idempotent legal move: no QUEUED items remain, but the seat still
	// holds CLAIMED work (large + small). claim_work now reveals the seat's OLDEST
	// claimed-by-me item (the stalled-claim legal move, #118) instead of returning
	// NO_QUEUED_WORK — so a seat that still holds un-finished work is never left
	// without a legal move.
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("handled")),
	]);
	const noOp = await driveClaim();
	assert.ok(
		noOp.includes(`STALLED_CLAIM #${largeId}`),
		`re-claim with nothing queued reveals the seat's oldest claimed item (got: ${noOp.slice(0, 120)})`,
	);

	console.log(
		"THINCONTEXT TEST PASS (over-threshold claim_work returns a path to cwd/.durig/<id>.md whose file contains the body; small claims stay inline; idempotent)",
	);
} finally {
	if (harness) await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
