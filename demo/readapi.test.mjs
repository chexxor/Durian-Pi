// demo/readapi.test.mjs — prove the read-only store API (src/readapi.mjs).
//
// Failing-first: before this test exists, `node demo/readapi.test.mjs` cannot run.
// After: it builds a fixture rig (2 seats, queued items), exercises every readapi
// export, and asserts the shapes a TUI or viewer would consume.
//
// Run: node demo/readapi.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster } from "../src/seattools.mjs";
import {
	readSeatList,
	readQueueItems,
	readLiveState,
	readRigHealth,
} from "../src/readapi.mjs";

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

// ─── Fixture rig ───────────────────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), "durig-readapi-"));
const cwd = join(dir, "seat-workspace");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

await harness.commit(async (tx) => {
	const mk = async (name, role, model = { provider: "faux", modelId: "faux-seat" }) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, {
			model,
			cwd,
		});
		await registerSeat(tx, name, conv.id, role);
		return conv.id;
	};
	await mk("alpha", "alpha role");
	await mk("beta", "beta role");
	// #2231: a seat on the LOCAL provider — its window is declared by DURIG_LOCAL_CONTEXT,
	// not DURIG_CONTEXT_WINDOW, so the read surface must know its model to see it.
	await mk("gamma", "gamma role", { provider: "local", modelId: "qwen36" });
}, ctx);

await harness.commit(async (tx) => {
	await enqueueItem(tx, "pm", "alpha", "task for alpha", "details A");
	await enqueueItem(tx, "pm", "beta", "task for beta", "details B");
	await enqueueItem(tx, "alpha", "pm", "work report", "details C");
}, ctx);

const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
fillRoster(new Map(Object.entries(seats)), seats);

try {
	/* ---- readSeatList ---- */
	console.log("\nreadSeatList — seats shape");
	const seatList = await readSeatList(storage, ctx);
	check("returns an array", Array.isArray(seatList), `type=${typeof seatList}`);
	check("has 3 seats", seatList.length === 3, `length=${seatList.length}`);
	for (const s of seatList) {
		check(
			`${s.name} has name/conversationId/role`,
			typeof s.name === "string" && typeof s.conversationId === "number" && typeof s.role === "string",
		);
	}

	/* ---- readQueueItems ---- */
	console.log("\nreadQueueItems — queue shape");
	const queueItems = await readQueueItems(storage, ctx);
	check("returns an array", Array.isArray(queueItems), `type=${typeof queueItems}`);
	check("has 3 items", queueItems.length === 3, `length=${queueItems.length}`);
	for (const item of queueItems) {
		check(
			`item ${item.id} has required fields`,
			typeof item.id === "number" && typeof item.to === "string" && typeof item.subject === "string",
			JSON.stringify(item),
		);
	}

	/* ---- readLiveState (absent — never ran) ---- */
	console.log("\nreadLiveState — absent conversation returns {}");
	const liveAbsent = await readLiveState(storage, seats.alpha.conversationId, ctx);
	check("returns {} when no pi.live exists", typeof liveAbsent === "object" && !liveAbsent.hasContent);

	/* ---- readRigHealth — full snapshot ---- */
	console.log("\nreadRigHealth — full health shape");
	const health = await readRigHealth(storage, dir, 4, {
		entryLimit: 10,
	});
	check("seats is array", Array.isArray(health.seats), `type=${typeof health.seats}`);
	check("seats has 3 entries", health.seats.length === 3);
	check("queueItems is array", Array.isArray(health.queueItems), `type=${typeof health.queueItems}`);
	check("queueItems has 3 entries", health.queueItems.length === 3);
	check("peerGraph is present", typeof health.peerGraph === "object");
	check("latestByConv is present", typeof health.latestByConv === "object");
	check("metrics is present", typeof health.metrics === "object");
	check("streaming is present", typeof health.streaming === "object");
	check("attention is array", Array.isArray(health.attention));
	check("attention items have scope/seat/kind",
		health.attention.every((a) => a.scope && a.seat && a.kind),
	);
	// _pages is internal, used by watch for highlights
	check("_pages is present", typeof health._pages === "object");
	// streaming should be empty — no seat has generated yet
	check("streaming is empty (no in-flight generation)", Object.keys(health.streaming).length === 0);

	/* ---- readRigHealth — lastActivity after real activity (ASK B #502) ---- */
	// A REAL seat submission through the durable pipeline (as the scheduling loop
	// would run it): submit input for alpha's conversation and let the faux
	// provider settle it. That proves the surfaced field comes from the SAME
	// admittedAt recovery the watch/highlight path uses — not a hand-built shape.
	faux.setResponses([fauxAssistantMessage(fauxText("#502 probe reply"))]);
	const alphaConv = await harness.conversation(seats.alpha.conversationId, ctx);
	const alphaRun = await alphaConv.submit({ type: "input", content: "#502 probe run" }, ctx);
	await alphaRun.wait(ctx);
	const health2 = await readRigHealth(storage, dir, 4, { entryLimit: 10 });
	const alpha = health2.seats.find((s) => s.name === "alpha");
	const beta = health2.seats.find((s) => s.name === "beta");
	check("alpha row has lastActivity after an admitted submission",
		typeof alpha?.lastActivity === "string",
		JSON.stringify(alpha));
	check("lastActivity parses and is epoch-instant-looking",
		Number.isFinite(Date.parse(alpha?.lastActivity ?? "x")),
		String(alpha?.lastActivity));
	check("lastActivity matches the queue record's admittedAt input-entry timestamp",
		alpha?.lastActivity === new Date(health2.latestByConv?.[String(alpha?.conversationId) ?? -1]?.admittedAt).toISOString(),
		JSON.stringify({ row: alpha?.lastActivity, latest: health2.latestByConv }));

	/* ---- readRigHealth — a LOCAL seat's declared window (#2231) ---- */
	// The reported defect: `status` showed context.<seat>.window.denominator = null for a local
	// seat, so no context fraction was computable. The window EXISTS (the local provider declares
	// it from DURIG_LOCAL_CONTEXT) but the read surface could not resolve it, because it had no
	// model key for the seat. gamma's model is persisted in its pi.agent doc; the read must use it.
	console.log("\nreadRigHealth — a LOCAL seat's declared window (#2231)");
	const cfgLocal = { DURIG_LOCAL_BASE_URL: "http://127.0.0.1:8080", DURIG_LOCAL_CONTEXT: "32768" };
	const healthLocal = await readRigHealth(storage, dir, 4, { entryLimit: 10, cfg: cfgLocal });
	const gammaWindow = healthLocal.context.gamma?.window;
	check("a local seat's denominator is NON-NULL and declared",
		gammaWindow?.denominator === "declared", JSON.stringify(gammaWindow));
	check("...and its value is the local provider's DURIG_LOCAL_CONTEXT (32768)",
		gammaWindow?.value === 32768, JSON.stringify(gammaWindow));
	check("...so a context fraction is computable once usage exists",
		healthLocal.context.gamma?.fraction === null || Number.isFinite(healthLocal.context.gamma?.fraction),
		JSON.stringify(healthLocal.context.gamma));
	check("a REMOTE seat does NOT inherit the local window",
		healthLocal.context.alpha?.window?.denominator === null, JSON.stringify(healthLocal.context.alpha?.window));
	const healthOverride = await readRigHealth(storage, dir, 4, {
		entryLimit: 10,
		cfg: { ...cfgLocal, DURIG_CONTEXT_WINDOW: "64000" },
	});
	check("an explicit DURIG_CONTEXT_WINDOW still WINS over the local window",
		healthOverride.context.gamma?.window?.value === 64000, JSON.stringify(healthOverride.context.gamma?.window));
	const healthNoCfg = await readRigHealth(storage, dir, 4, { entryLimit: 10 });
	check("with no local config the local seat's denominator stays null (no invented window)",
		healthNoCfg.context.gamma?.window?.denominator === null, JSON.stringify(healthNoCfg.context.gamma?.window));

	console.log(failures === 0 ? "\nPASS — readapi exports verified" : `\nFAIL — ${failures} check(s) failed`);
} finally {
	await harness.close(ctx);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING: ${err?.message ?? err}`);
	}
}

process.exit(failures === 0 ? 0 : 1);
