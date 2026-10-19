// demo/blockedby-field.test.mjs — the `blockedBy` gate field on work items (#2951).
//
// WHY: a gate today is PROSE — "GATED on #1234" appears in 325 queue items and only 69 name a
// resolvable id (docs/WORK-ITEM-SCHEMA.md §1, §4/R5). Nothing can query it, so "what is this item
// waiting on?" is a text search. The operator ruled (2026-10-19, #2919; D53 supersedes D24) exactly
// ONE structured gate field, `blockedBy`, persisted through the EXISTING enqueue path — D24 forbids
// a new WRITE PATH / parallel store, not an optional field.
//
// The field shape must be usable by the `workable` predicate (#2673 claim selection, #2712 broker
// wake selection): a plain array of queue-item ids on the stored item, ABSENT when ungated (absence
// = unblocked, never "unknown, so hold" — §7).
//
// Failing-first: before the field exists, `send_work({blockedBy:[1]})` persists nothing, so the
// "gate is on the stored item" checks fail. After, the gate round-trips through the store, an item
// with no gate reads as unblocked, and prose cannot smuggle a gate in.
//
// Run: node demo/blockedby-field.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import {
	enqueueItem,
	normalizeBlockedBy,
	registerSeat,
	RigQueue,
	Router,
	Seats,
} from "../src/rig.mjs";

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
const throws = (fn) => {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
};

/* ─── 1. pure: the field is a structured id list, and prose is REJECTED ──── */
console.log("\nnormalizeBlockedBy — structured ids only");
check(
	"a list of ids is kept (order preserved)",
	JSON.stringify(normalizeBlockedBy([2, 1])) === "[2,1]",
	JSON.stringify(normalizeBlockedBy([2, 1])),
);
check(
	"duplicate gates are collapsed",
	JSON.stringify(normalizeBlockedBy([1, 1, 2])) === "[1,2]",
	JSON.stringify(normalizeBlockedBy([1, 1, 2])),
);
check(
	"an empty gate means UNGATED (null, not [])",
	normalizeBlockedBy([]) === null,
	String(normalizeBlockedBy([])),
);
check(
	"an absent gate means UNGATED (null)",
	normalizeBlockedBy(undefined) === null,
	String(normalizeBlockedBy(undefined)),
);
check(
	"prose is rejected: '#1'",
	throws(() => normalizeBlockedBy("#1")),
);
check(
	"prose is rejected: 'GATED on #1'",
	throws(() => normalizeBlockedBy("GATED on #1")),
);
check(
	"a bare number is rejected (must be a list)",
	throws(() => normalizeBlockedBy(1)),
);
check(
	"a non-positive id is rejected: [0]",
	throws(() => normalizeBlockedBy([0])),
);
check(
	"a non-integer id is rejected: [1.5]",
	throws(() => normalizeBlockedBy([1.5])),
);
check(
	"a non-numeric entry is rejected: ['1']",
	throws(() => normalizeBlockedBy(["1"])),
);

/* ─── 2. the field round-trips through the real enqueue path ─────────────── */
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
		const mk = async (name, role) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
		};
		await mk("pm", "program manager");
		await mk("worker", "implementation engineer");
	}, ctx);

	const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	const queueItems = async () =>
		(await harness.documentState(RigQueue, undefined, ctx)).value.items;
	const item = async (id) => (await queueItems()).find((it) => it.id === id);
	let first = true;
	const call = async (name, toolName, toolArgs) => {
		const batch = [
			fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("ok")),
		];
		if (first) {
			faux.setResponses(batch);
			first = false;
		} else faux.appendResponses(batch);
		const c = await harness.conversation(roster[name].conversationId, ctx);
		await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};
	const transcript = async (name) => {
		const c = await harness.conversation(roster[name].conversationId, ctx);
		const pg = await c.entries({}, 200, undefined, ctx);
		return pg.items.map((e) => JSON.stringify(e)).join("\n");
	};

	// pm sends an UNGATED item, then one GATED on it, through send_work.
	await call("pm", "send_work", { to: "worker", subject: "Base work", body: "do it" });
	await call("pm", "send_work", {
		to: "worker",
		subject: "Gated work",
		body: "after base",
		blockedBy: [1],
	});
	await call("pm", "send_work", {
		to: "worker",
		subject: "Empty gate",
		body: "no gate",
		blockedBy: [],
	});

	check(
		"an item with no gate stores NO blockedBy field (absence = unblocked)",
		(await item(1)).blockedBy === undefined,
		JSON.stringify(await item(1)),
	);
	check(
		"the gate is PERSISTED on the stored item",
		JSON.stringify((await item(2)).blockedBy) === "[1]",
		JSON.stringify(await item(2)),
	);
	check(
		"an empty gate stores NO field (empty = unblocked)",
		(await item(3)).blockedBy === undefined,
		JSON.stringify(await item(3)),
	);

	// ─── 2b. the gate is legible where a seat reads its own queue ────────────
	await call("worker", "peek_queue", {});
	const peeked = await transcript("worker");
	check(
		"peek_queue shows the gate on the blocked item",
		/Gated work blockedBy=1\b/.test(peeked),
		peeked.slice(-400),
	);
	check(
		"peek_queue omits the gate on an ungated item",
		!/Base work blockedBy=/.test(peeked),
		peeked.slice(-400),
	);

	// ─── 3. the shape feeds a `workable` predicate (#2673 / #2712) ───────────
	// Exactly the predicate those items need: an item is workable when every gate it names is
	// terminal `done`. Absence of the field means no gates, so unblocked.
	const workable = (items, it) => {
		const byId = new Map(items.map((x) => [x.id, x]));
		return (it.blockedBy ?? []).every((id) => byId.get(id)?.status === "done");
	};
	check(
		"gated item is NOT workable while its gate is open",
		workable(await queueItems(), await item(2)) === false,
	);
	check("ungated item IS workable", workable(await queueItems(), await item(1)) === true);

	await harness.commit(async (tx) => {
		const q = await tx.doc(RigQueue);
		q.items.find((it) => it.id === 1).status = "done";
	}, ctx);
	check(
		"gated item BECOMES workable when its gate is done",
		workable(await queueItems(), await item(2)) === true,
	);

	// ─── 4. prose cannot smuggle a gate in (the field is structured) ─────────
	const before = (await queueItems()).length;
	await call("pm", "send_work", {
		to: "worker",
		subject: "Prose gate",
		body: "GATED on #1",
		blockedBy: "#1",
	});
	check(
		"a prose gate value persists NO item",
		(await queueItems()).length === before,
		`${(await queueItems()).length} vs ${before}`,
	);
	check(
		"the refusal is legible in the sender's transcript",
		/send_work/i.test(await transcript("pm")),
		"",
	);

	await call("pm", "send_work", {
		to: "worker",
		subject: "Prose gate 2",
		body: "GATED on #1",
		blockedBy: ["x"],
	});
	check(
		"a non-numeric gate entry persists NO item",
		(await queueItems()).length === before,
		`${(await queueItems()).length} vs ${before}`,
	);

	// ─── 5. the raw enqueue path carries it too (one write path, not two) ────
	await harness.commit(async (tx) => {
		await enqueueItem(tx, "pm", "worker", "Raw gated", "body", null, false, null, false, [2]);
	}, ctx);
	const raw = (await queueItems()).find((it) => it.subject === "Raw gated");
	check(
		"enqueueItem persists the gate on the item",
		JSON.stringify(raw?.blockedBy) === "[2]",
		JSON.stringify(raw),
	);
} finally {
	await harness.close(ctx);
}

console.log(
	failures === 0
		? "\nPASS — `blockedBy` is a structured gate persisted through the existing enqueue path"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
