// demo/pause.test.mjs — `pause` / `unpause` drain-to-quiescence (ROADMAP 130/131, #1388/#1841).
//
// Failing-first: before the pause flag + spool ops + verb exist this dies (the RigControl
// document is absent and `applyPauseOp`/`selectWakes({paused})` do not exist). After, it proves
// the ROADMAP 131 acceptance criteria:
//   AC1 a persisted, broker-visible RIG-LEVEL `paused` state that selectWakes honours;
//   AC2 in-flight work SETTLES — pause never kills a run;
//   AC3 legible + reversible: `pause`/`unpause`, `status` reports it, a refused wake is LEGIBLE;
//   AC4 not a second store writer: the producer only SPOOLS a request (ROADMAP 71); the broker
//       applies the flag with its OWN harness;
//   AC5 `pause --wait` returns only at TRUE QUIESCENCE.
//
// Run: node demo/pause.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { applyPauseOp, drainIntentInbox, drivePass, SPOOL_OPS, writeIntent } from "../src/broker.mjs";
import { selectWakes } from "../src/driver.mjs";
import { readRigControl, readRigHealth } from "../src/readapi.mjs";
import { enqueueItem, registerSeat, RigQueue, Router, Seats } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const dir = mkdtempSync(join(tmpdir(), "durig-pause-"));
const dbPath = join(dir, "rig.sqlite");

/* ─── 1. AC1 (pure): selectWakes refuses NEW work while paused ────────────── */
console.log("\nAC1 — selectWakes: paused refuses NEW work, keeps finishing work");
const seats = { impl: { conversationId: 2 } };
const items = [{ to: "impl", status: "queued" }];
check("unpaused: a queued item wakes its seat", selectWakes({ seats, items }).length === 1);
check("paused: a queued item does NOT wake its seat", selectWakes({ seats, items, paused: true }).length === 0);
check(
	"paused: a STALLED CLAIM still wakes (finish current work)",
	selectWakes({ seats, items: [{ to: "impl", status: "claimed" }], paused: true }).length === 1,
);
check("SPOOL_OPS carries pause/unpause (ROADMAP 71 extension)", SPOOL_OPS.includes("pause") && SPOOL_OPS.includes("unpause"));

const faux = fauxProvider({
	models: [{ id: "faux-seat", contextWindow: 100_000 }],
	tokensPerSecond: 50,
	tokenSize: { min: 1, max: 2 },
});
const models = createModels();
models.setProvider(faux.provider);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry: createRegistry() }, ctx);

try {
	let convId = null;
	let itemId = null;
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		convId = c.id;
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "impl", c.id, "implementation");
		itemId = await enqueueItem(tx, "pm", "impl", "PAUSE_SUBJECT", "PAUSE_BODY");
	}, ctx);

	/* ─── 2. AC4: the producer only SPOOLS; the broker applies with its own writer ─── */
	console.log("\nAC4 — the producer spools a file; the broker applies the flag");
	check("the rig starts unpaused", (await readRigControl(storage)).paused === false);
	const requestId = "pause-1";
	const spooled = writeIntent(dbPath, { op: "pause", to: null, from: "operator", reason: "upgrade", requestId, createdAt: new Date().toISOString() });
	check("pause writes one spool file, opening no store", typeof spooled === "string");
	check("the flag is NOT set until the broker drains", (await readRigControl(storage)).paused === false);
	const drained = await drainIntentInbox(harness, storage, { dbPath, context: ctx });
	check("the broker drains the spooled request", drained.delivered === 1, JSON.stringify(drained));
	const control = await readRigControl(storage);
	check("AC1: the paused state is persisted and broker-visible", control.paused === true, JSON.stringify(control));
	check("the pause names its provenance", control.pausedBy === "operator" && control.reason === "upgrade", JSON.stringify(control));

	/* ─── 3. AC3: a refused wake is LEGIBLE, never silent ─────────────────────── */
	console.log("\nAC3 — a refused wake is legible; unpause re-enables");
	const diagnostics = [];
	const pass1 = await drivePass(harness, storage, { context: ctx, dbPath, waitForWakes: false, onDiagnostic: (d) => diagnostics.push(d) });
	check("while paused, NO wake is submitted for the queued item", pass1.actioned === 0, JSON.stringify(pass1));
	check(
		"the refused wake is LEGIBLE (a wake-refused-paused diagnostic names the seat)",
		diagnostics.some((d) => d.kind === "wake-refused-paused" && d.seat === "impl"),
		JSON.stringify(diagnostics),
	);

	/* ─── 4. AC2 + AC5: pause never kills; --wait returns at TRUE QUIESCENCE ───── */
	console.log("\nAC2/AC5 — in-flight work SETTLES; pause --wait returns at quiescence");
	const FULL = "word ".repeat(200);
	faux.setResponses([fauxAssistantMessage(fauxText(FULL))]);
	const conv = await harness.conversation(convId, ctx);
	const sub = await conv.submit({ type: "input", content: "produce a long reply" }, ctx);
	// Let the run actually start generating, then pause with --wait.
	await new Promise((r) => setTimeout(r, 800));
	const before = await harness.inspect(ctx);
	check("a run is in flight when pause --wait is called", (before.tasks ?? []).some((t) => t.record?.state?.status === "running"), JSON.stringify(before.tasks));
	const t0 = Date.now();
	const waited = await applyPauseOp(harness, { paused: true, by: "operator", wait: true }, ctx);
	const waitedMs = Date.now() - t0;
	const settled = await sub.wait(ctx);
	check("pause --wait reports quiesced", waited.quiesced === true, JSON.stringify(waited));
	check("it actually waited for the run (not instant)", waitedMs >= 500, `waitedMs=${waitedMs}`);
	check("AC2: the in-flight run SETTLED as done (pause did NOT kill it)", settled.status === "done", JSON.stringify(settled));
	const page = await conv.entries({}, 50, undefined, ctx);
	const text = page.items
		.filter((e) => e.kind === "pi.assistant")
		.map((e) => (Array.isArray(e.model) ? (e.model[0].content ?? []).map((p) => p.text ?? "").join("") : ""))
		.join("");
	check("AC2: the full turn was committed, not truncated", text.length === FULL.length, `len=${text.length} full=${FULL.length}`);

	/* ─── 5. AC3 + AC5: status reports paused; unpause clears it ──────────────── */
	console.log("\nAC3/AC5 — status reports the state; unpause reverses it");
	const health = await readRigHealth(storage, dbPath, 1);
	check("AC3: status reports the rig as paused", health.paused === true, JSON.stringify(health.control));
	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		const it = q.items.find((i) => i.id === itemId);
		it.status = "queued";
	}, ctx);
	await applyPauseOp(harness, { paused: false }, ctx);
	check("unpause clears the flag", (await readRigControl(storage)).paused === false);
	const diagnostics2 = [];
	const pass2 = await drivePass(harness, storage, { context: ctx, dbPath, waitForWakes: false, onDiagnostic: (d) => diagnostics2.push(d) });
	check("after unpause, the queued item IS woken again", pass2.actioned >= 1, JSON.stringify(pass2));
	check("status now reports NOT paused", (await readRigHealth(storage, dbPath, 1)).paused === false);
} finally {
	await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		/* temp dir cleanup is best-effort */
	}
}

/* ─── 6. AC1 (claim_work): refuses NEW work while paused, reveals held work ─── */
console.log("\nAC1 — claim_work refuses a NEW claim while paused, still reveals held work");
const faux2 = fauxProvider({ models: [{ id: "faux-seat" }] });
const models2 = createModels();
models2.setProvider(faux2.provider);
const registry2 = createRegistry();
registry2.install(Router);
const harness2 = await Harness.open(new MemoryStorage(), { models: models2, registry: registry2 }, ctx);
try {
	await harness2.commit(async (tx) => {
		const mk = async (name, role) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
		};
		await mk("worker", "implementation engineer");
		await mk("fresh", "unstarted seat");
		await enqueueItem(tx, "pm", "worker", "Held", "body");
		await enqueueItem(tx, "pm", "fresh", "Unclaimed", "body");
	}, ctx);
	const roster = (await harness2.documentState(Seats, undefined, ctx)).value.seats;
	const queueState = async () => (await harness2.documentState(RigQueue, undefined, ctx)).value;
	let first = true;
	const call = async (name, toolName, toolArgs) => {
		const batch = [
			fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("ok")),
		];
		if (first) {
			faux2.setResponses(batch);
			first = false;
		} else faux2.appendResponses(batch);
		const c = await harness2.conversation(roster[name].conversationId, ctx);
		await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};
	const transcript = async (name) => {
		const c = await harness2.conversation(roster[name].conversationId, ctx);
		const pg = await c.entries({}, 200, undefined, ctx);
		return pg.items.map((e) => JSON.stringify(e)).join("\n");
	};

	await call("worker", "claim_work", {});
	check("unpaused: claim_work claims the queued item", (await queueState()).items.find((i) => i.subject === "Held").status === "claimed");
	await applyPauseOp(harness2, { paused: true, by: "operator" }, ctx);
	await call("fresh", "claim_work", {});
	check("paused: claim_work refuses the NEW queued item (it stays queued)", (await queueState()).items.find((i) => i.subject === "Unclaimed").status === "queued");
	check("the refusal is LEGIBLE (PAUSED)", /PAUSED/.test(await transcript("fresh")));
	await call("fresh", "claim_work", { itemId: 2 });
	check("paused: claim_work by id is also refused", (await queueState()).items.find((i) => i.subject === "Unclaimed").status === "queued");
	await call("worker", "claim_work", {});
	check("paused: a HELD (claimed) item is still revealed, so current work can finish", /STALLED_CLAIM #1/.test(await transcript("worker")));
} finally {
	await harness2.close(ctx);
}

console.log(failures === 0 ? "\nPASS — pause gates new work, never kills in-flight work, and reports quiescence" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
