// demo/landing-data.test.mjs — ROADMAP 124: the LANDING screen's DATA path.
//
// The gap this closes: `src/tui/client.mjs` fed `queueItems` only into the status bar's
// TEAM-WIDE count, so nothing could answer "what is this seat working on, and how much is
// waiting behind it" per seat. `projectLanding` answers it from ONE batched read
// (`readRigHealth`'s snapshot) — no per-seat query storm (#3103) and no second source of
// truth for the queue.
//
// FAILING-FIRST: before `projectLanding` existed this file could not even import what it
// asserts, so the three-state fixture below is the acceptance for the data half,
// independent of any layout (the designer owns the surface).
//
// Run: node demo/landing-data.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigQueue, Router, Seats, enqueueItem, registerSeat } from "../src/rig.mjs";
import { fillRoster } from "../src/seattools.mjs";
import { LANDING_QUEUE_STATUSES, projectLanding, readRigHealth } from "../src/readapi.mjs";
import { SEAT_ACTIONS, deriveSeatAction } from "../src/viewmodel.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;

function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// ─── Fixture: three seats, three different states ────────────────────────────
// `working`  — one CLAIMED item (the current work), plus a queued and a held item behind it
// `idle`     — nothing at all in its queue
// `parked`   — parked on an unanswered question (deferred to the operator)
// `waiting`  — no queue work but a seat-scoped notice (the `waiting` vocabulary word)
const dir = mkdtempSync(join(tmpdir(), "durig-landing-"));
const cwd = join(dir, "seat-workspace");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

const IDS = {};

await harness.commit(async (tx) => {
	const mk = async (name, role) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" }, cwd });
		await registerSeat(tx, name, conv.id, role);
	};
	for (const [name, role] of [
		["working", "author"],
		["idle", "author"],
		["parked", "verifier"],
		["waiting", "author"],
	]) {
		await mk(name, role);
	}
}, ctx);

await harness.commit(async (tx) => {
	IDS.claimed = await enqueueItem(tx, "pm", "working", "the item being worked on", "body");
	IDS.queued = await enqueueItem(tx, "pm", "working", "next in line", "body");
	IDS.held = await enqueueItem(tx, "pm", "working", "registered, do not start", "body", null, false, null, true);
	IDS.deferred = await enqueueItem(tx, "pm", "parked", "a question nobody answered", "body");
	// A TERMINAL item, which must NOT inflate the queue size (the count has to be explainable).
	IDS.done = await enqueueItem(tx, "pm", "working", "finished long ago", "body");
	// The state transitions the real tools make: claim, defer-to-operator, complete.
	const queue = await tx.doc(RigQueue);
	const byId = (id) => queue.items.find((it) => it.id === id);
	byId(IDS.claimed).status = "claimed";
	byId(IDS.deferred).status = "deferred";
	byId(IDS.deferred).deferredTo = "operator";
	byId(IDS.done).status = "done";
}, ctx);

const seats = (await harness.documentState(Seats, undefined, ctx)).value.seats;
fillRoster(new Map(Object.entries(seats)), seats);

try {
	// ONE batched read, then a pure projection — the shape the renderer consumes.
	const health = await readRigHealth(storage, null, undefined, {});
	// A seat-scoped notice for `waiting`: the vocabulary word `waiting` is derived from the
	// attention channel, so the fixture supplies one rather than inventing a new state.
	health.attention = [...(health.attention ?? []), { scope: "seat", seat: "waiting", kind: "admitted_not_started" }];

	const landing = projectLanding(health);
	const row = (name) => landing.seats.find((s) => s.name === name);

	console.log("\n=== the projection is one row per seat, and pure ===");
	check("a row per seat", landing.seats.length === 4, `got ${landing.seats.length}`);
	check("projectLanding is synchronous (no store handle, no I/O)", projectLanding.constructor.name === "Function");
	check(
		"every action word comes from the ONE vocabulary (#2826)",
		landing.seats.every((s) => SEAT_ACTIONS.includes(s.action)),
		landing.seats.map((s) => `${s.name}=${s.action}`).join(" "),
	);

	console.log("\n=== working: claimed item + queue composition ===");
	const working = row("working");
	check("action is working", working.action === "working", working.action);
	check("claimed id is the claimed item", working.claimed?.id === IDS.claimed, JSON.stringify(working.claimed));
	check("claimed subject is the claimed item's", working.claimed?.subject === "the item being worked on");
	check(
		"queue counts only LIVE statuses (1 claimed + 1 queued + 1 held, done excluded)",
		working.queue.total === 3 && working.queue.claimed === 1 && working.queue.queued === 1 && working.queue.held === 1,
		JSON.stringify(working.queue),
	);
	check("queue total is the sum of its named parts", working.queue.total === LANDING_QUEUE_STATUSES.reduce((n, s) => n + working.queue[s], 0));
	check("the terminal item did not inflate the count", working.queue.total !== 4, JSON.stringify(working.queue));
	check("focus names the claimed id", working.focus.includes(`#${IDS.claimed}`), working.focus);
	check("no deferred item", working.deferred === null);

	console.log("\n=== idle: an empty queue is an ANSWER, not a blank ===");
	const idle = row("idle");
	check("action is idle", idle.action === "idle", idle.action);
	check("claimed is explicitly null", idle.claimed === null);
	check("deferred is explicitly null", idle.deferred === null);
	check("queue total is 0", idle.queue.total === 0, JSON.stringify(idle.queue));
	check("notices is an empty list, not undefined", Array.isArray(idle.notices) && idle.notices.length === 0);
	check("focus still says something legible", typeof idle.focus === "string" && idle.focus.length > 0, idle.focus);

	console.log("\n=== parked: waiting on the operator ===");
	const parked = row("parked");
	check("action is parked", parked.action === "parked", parked.action);
	check("claimed is null (it is not working)", parked.claimed === null);
	check("deferred names the item", parked.deferred?.id === IDS.deferred, JSON.stringify(parked.deferred));
	check("deferred names WHO it waits on", parked.deferred?.deferredTo === "operator", JSON.stringify(parked.deferred));
	check("queue total counts the deferred item", parked.queue.total === 1 && parked.queue.deferred === 1, JSON.stringify(parked.queue));

	console.log("\n=== waiting: a notice with no queue work ===");
	const waiting = row("waiting");
	check("action is waiting", waiting.action === "waiting", waiting.action);
	check("notices carries the KIND unchanged", waiting.notices.includes("admitted_not_started"), JSON.stringify(waiting.notices));
	check("queue total is 0", waiting.queue.total === 0, JSON.stringify(waiting.queue));

	console.log("\n=== the shared derivation is the same one the watch view uses ===");
	for (const name of ["working", "idle", "parked", "waiting"]) {
		const seat = health.seats.find((s) => s.name === name);
		const derived = deriveSeatAction(seat, health);
		check(`${name}: projectLanding agrees with deriveSeatAction`, row(name).action === derived.state && row(name).focus === derived.focus);
	}

	console.log("\n=== status passthrough is unchanged ===");
	check(
		"lastActivity passes through from the seat row (absent here, so null)",
		landing.seats.every((s) => s.lastActivity === null || typeof s.lastActivity === "string"),
	);
	check(
		"role passes through",
		row("parked").role === "verifier",
		String(row("parked").role),
	);

	console.log(
		failures === 0
			? "\nLANDING DATA PASS (per-seat queue composition, claimed item, action vocabulary, one batched read)"
			: `\nLANDING DATA FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
