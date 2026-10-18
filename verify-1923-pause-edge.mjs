// verify-1923-pause-edge.mjs — second-verifier boundary probe for impl-item-1841 @22ae784 (#1923).
// Pins the artifact via the throwaway detached worktree ./verify-22ae784 (commit 22ae784).
// It DOCUMENTS boundary behavior; it is not the artifact's own suite (that is demo/pause.test.mjs).
// Run: node verify-1923-pause-edge.mjs  (exit 0 = probes behaved as documented)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { applyPauseOp, drainIntentInbox, readIntentFiles, writeIntent } from "./verify-22ae784/src/broker.mjs";
import { readRigControl } from "./verify-22ae784/src/readapi.mjs";
import { enqueueItem, registerSeat } from "./verify-22ae784/src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const dir = mkdtempSync(join(tmpdir(), "durig-verify-1923-"));
const dbPath = join(dir, "rig.sqlite");

const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 100_000 }], tokensPerSecond: 50, tokenSize: { min: 1, max: 2 } });
const models = createModels();
models.setProvider(faux.provider);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry: createRegistry() }, ctx);

try {
	let implConvId = null;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		implConvId = c.id;
		await configure(tx, implConvId, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "impl", implConvId, "implementation");
		await enqueueItem(tx, "pm", "impl", "EDGE_SUBJECT", "EDGE_BODY");
	}, ctx);

	// PROBE A — applyRequest's pause branch ignores `to` and does not authorize `from`:
	// a pause targeting a seat, spooled BY a seat, is applied rig-wide with provenance recorded.
	writeIntent(dbPath, { op: "pause", to: "impl", from: "impl", requestId: "a1", createdAt: new Date().toISOString() });
	const d1 = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
	const c1 = await readRigControl(storage);
	check("A: pause spooled with to=impl from=impl is applied rig-wide (to ignored)", d1.delivered === 1 && c1.paused === true, JSON.stringify({ d1, c1 }));
	check("A: provenance recorded verbatim (pausedBy=impl) — no authorization gate on the spool path", c1.pausedBy === "impl", JSON.stringify(c1));

	// PROBE B — pause/unpause idempotence.
	await applyPauseOp(harness, { paused: true, by: "operator" }, ctx);
	const controlAfterDouble = await readRigControl(storage);
	check("B: pause while paused is a clean no-op (stays paused, provenance updated)", controlAfterDouble.paused === true && controlAfterDouble.pausedBy === "operator", JSON.stringify(controlAfterDouble));
	const u1 = await applyPauseOp(harness, { paused: false }, ctx);
	const u2 = await applyPauseOp(harness, { paused: false }, ctx);
	check("B: unpause twice is idempotent, no throw", u1.paused === false && u2.paused === false && (await readRigControl(storage)).paused === false, JSON.stringify({ u1, u2 }));

	// PROBE C — quiescence blind spot. Re-pause, then show:
	// (C1) pause --wait returns quiesced at once while an intent file sits undrained;
	// (C2) draining that message intent WHILE PAUSED starts NEW work (submission appears).
	await applyPauseOp(harness, { paused: true, by: "operator" }, ctx);
	const t0 = Date.now();
	const qw = await applyPauseOp(harness, { paused: true, wait: true, by: "operator" }, ctx);
	const waitedMs = Date.now() - t0;
	// Not yet written: spool the message AFTER the quiesced return to prove the point deterministically.
	writeIntent(dbPath, { op: "message", to: "impl", content: "operator message mid-pause", from: "operator", requestId: "c1", createdAt: new Date().toISOString() });
	faux.appendResponses([fauxAssistantMessage(fauxText("ack"))]);
	const inboxAfterSpool = readIntentFiles(dbPath).length;
	// Fresh pause --wait with an undrained intent in the inbox:
	const t1 = Date.now();
	const qw2 = await applyPauseOp(harness, { paused: true, wait: true, by: "operator" }, ctx);
	const waitedMs2 = Date.now() - t1;
	check("C1: pause --wait returns quiesced ~= instantly while an UNDRAINED message intent sits in the inbox", qw2.quiesced === true && waitedMs2 < 250 && inboxAfterSpool === 1, `waitedMs2=${waitedMs2} inbox=${inboxAfterSpool} qw=${JSON.stringify(qw)}`);
	const d2 = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
	const pausedNow = (await readRigControl(storage)).paused === true;
	const after = await harness.inspect(ctx);
	const implSubs = (after.submissions ?? []).filter((s) => s.conversationId === implConvId).map((s) => s.status);
	check("C2: draining the message WHILE PAUSED applies it (delivered=1)", d2.delivered === 1 && pausedNow, JSON.stringify({ d2, paused: pausedNow }));
	check("C2: NEW submission in flight for impl on a PAUSED rig (new work can start under pause)", implSubs.length > 0 && pausedNow, JSON.stringify(implSubs));
	// settle the run so the harness can close (never close with a live run)
	const conv = await harness.conversation(implConvId, ctx);
	await conv.waitForIdle(ctx);
} finally {
	await harness.close(ctx);
	try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

console.log(failures === 0 ? "\nBOUNDARY CONFIRMED — probes behaved as documented (see labels)" : `\nPROBE MISMATCH — ${failures} probe(s)`);
process.exit(failures === 0 ? 0 : 1);
