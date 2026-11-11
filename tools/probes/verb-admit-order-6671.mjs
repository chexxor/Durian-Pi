#!/usr/bin/env node
/*
 * verb-admit-order-6671.mjs — the admitRow contract, measured (#6510, #6511)

 The rule already in DECISIONS.md (the #6185 ruling, point 4): "Terminality is checked before authority
 in every control verb." `release_work` implements it; the review for pm's #6473 decomposition says the
 other verbs still answer "not yours" about a row that is already closed. The amendment text on #6510
 reads "terminal, then status, then authority" — which is NOT the order `release_work` actually uses.
 This probe measures the order for every verb that admits a row, through the real tool, so the contract
 can be pinned before impl writes `admitRow`.

 The contract being tested, in order:
   1. existence      — unknown item #N
   2. terminality    — already done/cancelled: no actor, party or not, can act
   3. authority      — not a party (release's coordinator carve-out aside)
   4. applicability  — the verb's own expected state (held, claimed, queued...)

 Run: node tools/probes/verb-admit-order-6671.mjs   exit 1 while any verb answers 3 before 2.
*/
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { registerSeat, RigQueue, Seats, Router } from "../../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.cwd(), "tmp-6671-"));
const failures = [];
const check = (c, m, d = "") => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}${d ? ` — ${d}` : ""}`); if (!c) failures.push(m); };
const measured = (m) => console.log(`  MEASURED  ${m}`);

// Each verb's own applicability state, so scenario C isolates step 4.
const VERBS = [
  { name: "defer_work", wrongState: "queued", expects: "claimed", extra: { question: "is the prerequisite real?" } },
  { name: "resume_work", wrongState: "queued", expects: "deferred" },
  { name: "hold_work", wrongState: "deferred", expects: "claimed|queued" },
  { name: "revise_work", wrongState: "claimed", expects: "queued" },
  { name: "cancel_work", wrongState: "deferred", expects: "non-terminal", extra: { reason: "superseded by the probe" } },
  { name: "release_work", wrongState: "queued", expects: "held" },
  { name: "claim_work", wrongState: "held", expects: "queued" },
];

let harness = null;
try {
	const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	harness = await Harness.open(await openNodeSqliteStorage(join(dir, "verbs.sqlite")), { models, registry }, ctx);
	harness.resume();

	const convId = await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "impl", c.id, "implementation");
		// A seat with NO capabilities is classified as a coordinator by seatIsCoordinator
		// (src/seattools.mjs:292-294), which grants it the scoped release carve-out. Declare a working
		// capability so the authority test measures authority and not the carve-out.
		(await tx.doc(Seats)).seats.impl.capabilities = ["implement"];
		return c.id;
	}, ctx);
	const conv = await harness.conversation(convId, ctx);

	// Three rows per verb, fixed up front so nothing mutates under another case.
	const seed = [];
	VERBS.forEach((v, i) => {
		const base = 100 + i * 10;
		seed.push({ id: base + 1, from: "pm", to: "other-seat", subject: `terminal, not mine (${v.name})`, body: "x", status: "done", blockedBy: [], transitions: [] });
		seed.push({ id: base + 2, from: "pm", to: "other-seat", subject: `live, not mine (${v.name})`, body: "x", status: "queued", blockedBy: [], transitions: [] });
		seed.push({ id: base + 3, from: "pm", to: "impl", subject: `mine, wrong state (${v.name})`, body: "x", status: v.wrongState, blockedBy: [], transitions: [] });
	});
	await harness.commit(async (tx) => {
		const queue = await tx.doc(RigQueue);
		for (const row of seed) queue.items.push(row);
		queue.nextId = 300;
	}, ctx);

	const call = async (name, args) => {
	 const priorMaxId = (await conv.entries({}, 200, undefined, ctx)).items.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("done")),
		]);
		await (await conv.submit({ type: "input", content: `${name}` }, ctx)).wait(ctx);
		const texts = (await conv.entries({ minEntryId: priorMaxId + 1 }, 200, undefined, ctx)).items
			.flatMap((e) => e.model ?? [])
			.filter((m) => m.role === "toolResult" && m.toolName === name)
			.map((m) => (m.content ?? []).map((c) => c.text ?? "").join(" "));
		return (texts[0] ?? "(no tool result recorded)").replace(/\n/g, " ").slice(0, 180);
	};

	const classify = (text) => {
		if (/unknown item/.test(text)) return "existence";
		if (/terminal|already (done|cancelled)/.test(text)) return "terminality";
		if (/status=|is not (held|deferred|claimed)|is deferred;|only unclaimed/.test(text)) return "applicability";
		if (/addressed to .*not you|not yours to|only the sender|no relation/.test(text)) return "authority";
		if (/NO_QUEUED_WORK/.test(text)) return "authority-or-absence (unclassified)";
		if (/^item #\d+ (held|released|cancelled|resumed|deferred|claimed)/.test(text)) return "accepted";
		return "accepted";
	};

	console.log("Ordering of the admission checks, per verb (row status measured from the tool's own refusal)");
	for (const [i, v] of VERBS.entries()) {
		const base = 100 + i * 10;
		const a = await call(v.name, { itemId: base + 1, ...(v.extra ?? {}) });
		const b = await call(v.name, { itemId: base + 2, ...(v.extra ?? {}) });
		const c = await call(v.name, { itemId: base + 3, ...(v.extra ?? {}) });
		const ca = classify(a), cb = classify(b), cc = classify(c);
		measured(`${v.name}: terminal+stranger -> ${ca} | live+stranger -> ${cb} | mine+wrong state (${v.wrongState}) -> ${cc}`);
		measured(`  text: ${a} || ${b} || ${c}`);
		check(ca === "terminality", `${v.name} answers TERMINALITY before AUTHORITY for a closed row it does not own`, `got ${ca}: ${a}`);
		check(cb === "authority", `${v.name} names the authority boundary for a live row it does not own`, `got ${cb}: ${b}`);
		check(cc === "applicability" || cc === "accepted", `${v.name} names its own applicability state (${v.expects}) when the row is yours`, `got ${cc}: ${c}`);
	}

	console.log("\nThe claim leg is not an admitRow call at all");
	const held = await call("claim_work", { itemId: 100 + 6 * 10 + 3 });
	measured(`claim_work on a held row addressed to me: ${held}`);
	check(!/NO_QUEUED_WORK/.test(held), "claim_work must not answer a held row with the empty-queue string (#6669 measured the same)", `got: ${held}`);

	console.log("\nThe coordinator carve-out is derived from ABSENT capabilities, not from role");
	await harness.commit(async (tx) => {
		const queue = await tx.doc(RigQueue);
		queue.items.push({ id: 200, from: "pm", to: "other-seat", subject: "a held row nobody here owns", body: "x", status: "held", blockedBy: [], transitions: [] });
	}, ctx);
	const asWorker = await call("release_work", { itemId: 200, reason: "re-parking it" });
	measured(`release by a seat advertising 'implement': ${asWorker}`);
	await harness.commit(async (tx) => {
		const seats = await tx.doc(Seats);
		seats.seats.impl.capabilities = [];
	}, ctx);
	const asCoordinator = await call("release_work", { itemId: 200, reason: "re-parking it" });
	measured(`the same verb, the same row, after the seat declares no capabilities: ${asCoordinator}`);
	check(/addressed to other-seat/.test(asWorker) && !/addressed to/.test(asCoordinator), "release authority turns on capability absence: a capability-less seat is a coordinator and may release a stranger's row (reason required) - role is not consulted", `worker: ${asWorker} | coordinator: ${asCoordinator}`);
	console.log("\nWhat this pins for #6510/#6511");
	console.log("  the contract is FOUR steps, not three: existence, terminality, authority, applicability.");
	console.log("  #6510's phrasing (terminal, then status, then authority) is not the order release_work uses");
	console.log("  (src/rig.mjs:1318 terminal -> :1337 authority -> :1339 held). Pin the order as above or the");
	console.log("  helper is written to a description the model verb does not follow.");
	console.log("  claim_work by id is the odd one out: its admission test is inlined in the find and its");
	console.log("  failure is the string NO_QUEUED_WORK, so admitRow cannot be its whole fix - it also needs");
	console.log("  the workable() predicate (#6669).");
} finally {
	try { await harness?.close(ctx); } catch {}
	rmSync(dir, { recursive: true, force: true });
}

console.log(failures.length ? `\nRESULT: RED - ${failures.length} assertion(s) failed` : "\nRESULT: GREEN - every verb admits in the pinned order");
process.exit(failures.length ? 1 : 0);
