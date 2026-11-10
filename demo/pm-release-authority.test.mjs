// demo/pm-release-authority.test.mjs — the coordinating seat may RELEASE a parked row it did not
// mint, and nothing else (ruling #6097, implemented as #6112).
//
// WHY: a parked row can only be un-parked by its sender or its recipient. On the live rig the seats
// that see the whole queue are the coordinating ones, and they are the seats that notice a parked row
// nobody can release — 234 held rows in impl's queue on 2026-11-10, several of them parked by a seat
// that has since stopped working on them. Release is reversible (the sender can hold it again), so it
// is delegable; cancel is terminal and revise rewrites the request under someone's feet, so those
// stay with the parties.
//
// FAILING-FIRST: on HEAD, `release_work` answers a coordinator with "item #N is addressed to X (from
// Y); only the sender or recipient may release it", so the coordinator-release checks below fail. The
// reason record, the cancelled-gate refusal and the re-tier refusal have no code at all before this.
//
// Run: node demo/pm-release-authority.test.mjs  (exit 0 = pass)
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { deadGateId, registerSeat, RigQueue, Router, Seats, workable } from "../src/rig.mjs";
import { seatHasReadTool, seatIsCoordinator } from "../src/seattools.mjs";

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

/* ─── 1. pure: who is a coordinator, and what makes a gate dead ──────────── */
console.log("\npure — the predicate is derived from capabilities, not from the seat's name");
check("a seat with only routing capabilities is a coordinator", seatIsCoordinator({ name: "pm", role: "program manager", capabilities: ["route", "plan"] }));
check("a seat that implements is not", !seatIsCoordinator({ name: "impl", role: "implementation engineer", capabilities: ["implement", "code"] }));
check("a verifier is not", !seatIsCoordinator({ name: "qa", role: "independent verifier", capabilities: ["verify"] }));
check("a seat declaring no capability is a coordinator (the F9 rule: it gets no working tools)", seatIsCoordinator({ name: "whoever", capabilities: [] }) && !seatHasReadTool({ name: "whoever", capabilities: [] }));
check("the seat that loses its working tools is exactly the seat this predicate calls a coordinator", seatIsCoordinator({ name: "x", capabilities: [] }) === !seatHasReadTool({ name: "x", capabilities: [] }));

console.log("\npure — a gate naming a CANCELLED row is dead, and the claim predicate agrees");
check("cancelled prerequisite -> deadGateId names it", deadGateId({ blockedBy: [1] }, [{ id: 1, status: "cancelled" }]) === 1);
check("done prerequisite -> not dead", deadGateId({ blockedBy: [1] }, [{ id: 1, status: "done" }]) === null);
check("a missing gate id is ambiguous, not dead (the conservative default)", deadGateId({ blockedBy: [2] }, []) === null);
check(
	"workable reports the same thing the release refusal reports",
	workable({ status: "queued", blockedBy: [1] }, "impl", { items: [{ id: 1, status: "cancelled" }] }).reason === "gate-cancelled:#1",
);

/* ─── 2. on a real harness: the scoped authority ────────────────────────── */
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
	 const mk = async (name, role, capabilities) => {
   const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
   await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
   await registerSeat(tx, name, c.id, role);
   const seatDoc = await tx.doc(Seats);
   seatDoc.seats[name].capabilities = capabilities;
  };
		await mk("pm", "program manager", ["route", "plan"]);
		await mk("impl", "implementation engineer", ["implement", "code"]);
		await mk("qa", "independent verifier", ["verify"]);
	}, ctx);

	const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
	const queueState = async () => await harness.snapshot(RigQueue, undefined, ctx);
	const item = async (id) => (await queueState()).items.find((it) => it.id === id);
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
		return (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};
	const toolReply = async (name, toolName) => {
		const c = await harness.conversation(roster[name].conversationId, ctx);
		const pg = await c.entries({}, 200, undefined, ctx);
	 const hits = pg.items.filter((x) => {
   const m = Array.isArray(x.model) ? x.model : [];
   return m.some((b) => b && b.role === "toolResult" && b.toolName === toolName);
  });
		if (hits.length === 0) return "";
		const m = Array.isArray(hits[0].model) ? hits[0].model : [];
		const block = m.find((b) => b && b.role === "toolResult" && b.toolName === toolName);
		const parts = Array.isArray(block?.content) ? block.content : [];
		return parts.map((t) => (typeof t === "string" ? t : t?.text ?? "")).join("");
	};

	/* A. a row impl parked for qa: pm is neither party, so it is the test of the grant. */
	await call("impl", "send_work", { to: "qa", subject: "Parked for qa", body: "do not start yet", held: true });
	const parked = await item(1);
	check("the row starts held", parked.status === "held", JSON.stringify(parked));

	await call("pm", "release_work", { itemId: 1 });
	const refusedNoReason = await toolReply("pm", "release_work");
	check("a coordinator release WITHOUT a reason is refused", /must carry a reason/.test(refusedNoReason), refusedNoReason.slice(0, 160));
	check("...and the row is still held", (await item(1)).status === "held", JSON.stringify(await item(1)));

	await call("pm", "release_work", { itemId: 1, reason: "the base landed, qa can start" });
	const released = await item(1);
	check("a coordinator release WITH a reason makes it queued", released.status === "queued", JSON.stringify(released));
	check("the release is recorded as structure: by, reason, authority", released.release?.by === "pm" && released.release?.reason === "the base landed, qa can start" && released.release?.authority === "coordinator", JSON.stringify(released.release));
	check("the transition carries the reason too", released.transitions.at(-1)?.event === "released" && released.transitions.at(-1)?.reason === "the base landed, qa can start", JSON.stringify(released.transitions.at(-1)));
	check("the park record is gone (#6150)", released.park === null, JSON.stringify(released.park));
	check("the reply names the coordinator release", /coordinator release: the base landed, qa can start/.test(await toolReply("pm", "release_work")));

	await call("qa", "peek_queue", {});
	const seen = await toolReply("qa", "peek_queue");
	check("the queue VIEW shows who un-parked the row and why", /releasedBy=pm reason=the base landed, qa can start/.test(seen), seen.slice(0, 300));

	/* B. a seat that is neither a party nor a coordinator is refused. */
	await call("impl", "send_work", { to: "impl", subject: "Self-parked row", body: "hold", held: true });
	await call("qa", "release_work", { itemId: 2, reason: "just trying" });
	const outsider = await toolReply("qa", "release_work");
	check("a verifier that is not a party cannot release it", /only the sender, the recipient, or a coordinating seat/.test(outsider), outsider.slice(0, 160));
	check("...and the row stays held", (await item(2)).status === "held", JSON.stringify(await item(2)));

	/* C. the grant stops at release: pm may NOT cancel, revise or re-tier a row it did not mint. */
	await call("pm", "cancel_work", { itemId: 1, reason: "pm trying to close it" });
	const cancelSay = await toolReply("pm", "cancel_work");
	check("pm cannot cancel a row it did not send", /not yours to cancel/.test(cancelSay), cancelSay.slice(0, 160));
	check("...and the row is not terminal", (await item(1)).status === "queued", JSON.stringify(await item(1)));

	await call("pm", "revise_work", { itemId: 1, body: "pm rewriting the request" });
	const reviseSay = await toolReply("pm", "revise_work");
	check("pm cannot revise a row it did not send", /not yours to revise/.test(reviseSay), reviseSay.slice(0, 160));

	await call("impl", "send_work", { to: "impl", subject: "Ship the widget", body: "small task", tier: "small" });
	const mintedId = (await queueState()).items.length;
	check("the minting party tiered it at intake", (await item(mintedId)).tier === "small", JSON.stringify((await item(mintedId)).tier));
	await call("pm", "send_work", { to: "impl", subject: "Ship the widget", body: "follow-up", tier: "feature", reason: "bigger than it looked" });
	const tierSay = await toolReply("pm", "send_work");
	check("pm cannot RAISE the tier of a chain it did not mint", /only a party of a task may re-tier it/.test(tierSay), tierSay.slice(0, 200));
	check("...and no item was created by the refused raise", (await queueState()).items.length === mintedId, JSON.stringify((await queueState()).items.map((it) => it.id)));
	await call("impl", "send_work", { to: "impl", subject: "Ship the widget", body: "follow-up", tier: "feature", reason: "bigger than it looked" });
	const raisedId = (await queueState()).items.length;
	check("the party still may raise it, with a reason (control)", /queued item #\d+ for impl/.test(await toolReply("impl", "send_work")), (await toolReply("impl", "send_work")).slice(0, 200));
	check("a party's raise carries the higher tier", (await item(raisedId)).tier === "feature", JSON.stringify((await item(raisedId)).tier));


	/* D. release is refused when the gate names a CANCELLED row. */
	await call("pm", "send_work", { to: "impl", subject: "Prerequisite that gets dropped", body: "gate" });
	const gateId = (await queueState()).items.length;
	await call("pm", "cancel_work", { itemId: gateId, reason: "superseded" });
	check("the gate row is cancelled", (await item(gateId)).status === "cancelled", JSON.stringify(await item(gateId)));
	await call("impl", "send_work", { to: "impl", subject: "Work gated on the dropped row", body: "held", held: true, blockedBy: [gateId] });
	const gatedId = (await queueState()).items.length;
	check("the gated row is held", (await item(gatedId)).status === "held", JSON.stringify(await item(gatedId)));
	await call("pm", "release_work", { itemId: gatedId, reason: "coordinator unparks it" });
	const gateSay = await toolReply("pm", "release_work");
	check("the coordinator release is refused: the gate is dead", /not released: its gate names #\d+, which is cancelled/.test(gateSay), gateSay.slice(0, 200));
	check("...and the row stays held", (await item(gatedId)).status === "held", JSON.stringify(await item(gatedId)));

	// Control: an ambiguous gate id (no such row) is NOT dead — the conservative default in `workable`.
	await call("impl", "send_work", { to: "impl", subject: "Gate id that names nothing", body: "held", held: true, blockedBy: [9999] });
	const ambiguousId = (await queueState()).items.length;
	await call("pm", "release_work", { itemId: ambiguousId, reason: "gate id names nothing, so it is not blocked" });
	check("an ambiguous gate does not block the release", (await item(ambiguousId)).status === "queued", JSON.stringify(await item(ambiguousId)));

	/* E. terminal still beats authority — a coordinator must not read a closed row as parked. */
	await call("impl", "send_work", { to: "impl", subject: "A row impl closes", body: "close it" });
	const closedId = (await queueState()).items.length;
	await call("impl", "claim_work", { itemId: closedId });
	check("impl holds the row it minted", (await item(closedId)).status === "claimed", JSON.stringify(await item(closedId)));
	await call("impl", "complete_work", { itemId: closedId, resultSummary: "done by impl" });
	check("the row is done", (await item(closedId)).status === "done", JSON.stringify(await item(closedId)));
	await call("pm", "release_work", { itemId: closedId, reason: "coordinator trying" });
	const terminalSay = await toolReply("pm", "release_work");
	check("terminal-first: the answer is 'nothing to release', not an authority refusal", /terminal\); there is nothing to release/.test(terminalSay), terminalSay.slice(0, 160));

	// The claim path agrees with the release refusal: if the row HAD been released, it would still not
// be workable. The release refusal is the earlier line, not the only one.
	const items = (await queueState()).items;
	const gatedRow = items.find((it) => it.id === gatedId);
	check(
		"the claim predicate would still refuse the dead-gated row (the two paths agree)",
		workable({ ...gatedRow, status: "queued" }, "impl", { items, capabilities: ["implement"] }).reason === `gate-cancelled:#${gateId}`,
	);
} finally {
	await harness.close(ctx);
}

console.log(failures === 0 ? "\nPASS — scoped release authority: coordinator may release with a recorded reason; cancel/revise/re-tier stay with the parties; a dead gate is refused" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
