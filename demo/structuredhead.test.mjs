// ROADMAP 42 / item #118 HALF 2 — truncation-usability.
// The truncation defect: TOOL_RESULT_INLINE_LIMIT=2000 (src/rig.mjs). An
// over-threshold tool result body went to cwd/.durig/<itemId>.md and the RETURN
// was a MID-BODY BYTE TRUNCATION (text.slice(0,2000)) + the path — so a
// read-tool-less coordinator seat (pm, lead) had to rule on a byte cut that
// severed the head from the tail (it truncated lead's #106/#116). Lead #125:
// the over-threshold RETURN must be a DELIBERATE STRUCTURED HEADER — item id +
// path + the decision-relevant fields (from/to/subject/status) — NOT a byte cut.
// This proves:
//   (a) an over-threshold claim_work returns an INLINE STRUCTURED HEADER
//       (id + path + from/subject/status) a no-read-tool seat can ACT on, and
//       does NOT inline the raw mid-body bytes;
//   (b) the full body is still written to cwd/.durig/<itemId>.md (RANK-1/#59:
//       body on disk), so a read-tool seat retrieves it;
//   (c) regression: a small claim stays FULLY inline (byte-identical), no path.
// Run: node demo/structuredhead.test.mjs  (exit 0 = pass)
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

const INLINE_LIMIT = 2000;
const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const dir = mkdtempSync(join(tmpdir(), "durig-structuredhead-"));
const cwd = join(dir, "seat-workspace");

let harness;
let roster;
try {
	({ harness, roster } = await (async () => {
		const roster = new Map();
		const storage = new MemoryStorage();
		const harness = await Harness.open(storage, { models, registry, env: makeSeatEnv(roster) }, ctx);
		return { harness, roster };
	})());

	let workerId;
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
		await registerSeat(tx, "worker", conv.id, "implementation");
		workerId = conv.id;
	}, ctx);
	const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	fillRoster(roster, seats);
	const conv = await harness.conversation(workerId, ctx);

	const driveClaim = async () => {
		const before = await conv.submit({ type: "input", content: "go" }, ctx);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("claim_work", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("claim handled")),
		]);
		await before.wait(ctx);
		const pg = await conv.entries({}, 50, undefined, ctx);
		const result = pg.items.find(
			(e) => e.kind === "pi.tool-result" && String(e.model?.[0]?.toolName) === "claim_work",
		);
		return result?.model?.[0]?.content?.[0]?.text ?? "";
	};

	// (a)+(b): an OVER-threshold item -> the RETURN must be a STRUCTURED HEADER
	// (id + path + from/subject/status), not a mid-body byte cut; the body stays
	// on disk at cwd/.durig/<id>.md.
	const LARGE_BODY = "LARGE_".repeat(INLINE_LIMIT); // over the threshold
	const largeId = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "worker", "Big task", LARGE_BODY), ctx);
	const result = await driveClaim();

	// It must carry the structured header fields (id, from, subject, status):
	assert.ok(result.includes(`item #${largeId}`), `result must carry the item id+path (got: ${result.slice(0, 120)})`);
	assert.ok(result.includes("from=boss"), "structured header carries `from`");
	assert.ok(result.includes("subject=Big task"), "structured header carries the subject (`subject=...`)");
	assert.ok(result.includes("status=claimed"), "structured header carries the status (`status=...`)");
	// And it must NOT inline the raw mid-body bytes (no `LARGE_` repeated dump).
	assert.ok(!result.includes("LARGE_"), "the result must NOT inline the mid-body bytes (a byte cut)");
	// It stays bounded (thin-context's goal): well under the full body.
	assert.ok(result.length < INLINE_LIMIT + 400, `result stays bounded; got ${result.length} chars`);

	// (b) the full body is still on disk at the deterministic path.
	const largeFile = join(cwd, ".durig", `${largeId}.md`);
	assert.ok(existsSync(largeFile), "the body file was still written to cwd/.durig/<id>.md");
	assert.ok(readFileSync(largeFile, "utf8").includes("LARGE_"), "the file at the path holds the full body");

	// (c) a SMALL item stays fully INLINE (byte-identical), no path, no deferral.
	const smallId = await harness.commit(async (tx) =>
		enqueueItem(tx, "boss", "worker", "Small task", "small inline body"), ctx);
	const small = await driveClaim();
	assert.ok(small.includes("small inline body"), `small claim must stay fully inline; got: ${small.slice(0, 120)}`);
	const smallFile = join(cwd, ".durig", `${smallId}.md`);
	assert.ok(!existsSync(smallFile), "under-threshold body is not written to disk");

	console.log("STRUCTUREDHEAD TEST PASS (over-threshold claim_work returns an inline structured header with id + path + from/subject/status a no-read-tool seat can act on, not a mid-body byte cut; full body stays on disk; small claims stay inline)");
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
