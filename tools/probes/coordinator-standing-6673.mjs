#!/usr/bin/env node
/*
 * coordinator-standing-6673.mjs — is authority derived from data, or from a string nobody recognises?
 * (#6673; the ruling is recorded as #6672, gated on #6530)

 lead's two rulings:
   1. Standing comes from the PARTY FIELDS only (`from`, `to`, `block.resolver`). Capability strings have
      exactly one job: matching a row's `requires`. `seatIsCoordinator({capabilities: ["design"]}) === true`
      is the proof of the drift - an unrecognised string became an implicit grant of authority.
   2. Gate references are bounded at ONE level; depth 2 must be ASSERTED refused, not assumed.

 The probe measures the surface that exists today and turns GREEN when the validator lands: it looks for
 `gateStanding` in src/rig.mjs, so the same file verifies the fix later instead of being rewritten.

 Run: node tools/probes/coordinator-standing-6673.mjs   exit 1 while a gap is open.
*/
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { registerSeat, RigQueue, Seats, Router } from "../../../src/rig.mjs";
import { seatIsCoordinator, toolRemovalsFor } from "../../../src/seattools.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.cwd(), "tmp-6673-"));
const gaps = [];
const gap = (cond, msg) => { console.log(`  ${cond ? "GAP   " : "CLOSED"}  ${msg}`); if (cond) gaps.push(msg); };
const measured = (m) => console.log(`  MEASURED  ${m}`);

/* ---------- A. the classification, as the code computes it ---------- */
console.log("A. What an unrecognised capability string does (src/seattools.mjs:262, 292)");
const as = (caps) => ({ name: "probe", role: "probe", capabilities: caps });
measured(`["design"]            -> coordinator ${seatIsCoordinator(as(["design"]))}, tools removed ${toolRemovalsFor(as(["design"])).length}`);
measured(`["review"]            -> coordinator ${seatIsCoordinator(as(["review"]))}, tools removed ${toolRemovalsFor(as(["review"])).length}`);
measured(`["route","plan"]      -> coordinator ${seatIsCoordinator(as(["route","plan"]))}, tools removed ${toolRemovalsFor(as(["route","plan"])).length}`);
measured(`[]                    -> coordinator ${seatIsCoordinator(as([]))}, tools removed ${toolRemovalsFor(as([])).length}`);
gap(seatIsCoordinator(as(["design"])) === true, "a capability string the predicate does not recognise classifies the seat as a coordinator: it loses its working tools AND gains the release carve-out (#6112). Authority by spelling is a parsing accident.");

/* ---------- B. the census, counted not asserted ---------- */
console.log("\nB. Declaration census (rig.selfdev.json as shipped)");
const cfg = JSON.parse(readFileSync(join(process.cwd(), "rig.selfdev.json"), "utf8"));
const seats = cfg.seats ?? [];
const findings = [];
for (const s of seats) {
	const caps = (s.capabilities ?? []).map((c) => String(c).toLowerCase());
	if (!caps.length) { findings.push(`${s.name}: declares nothing -> coordinator by default`); continue; }
	if (seatIsCoordinator(s)) { findings.push(`${s.name}: ${caps.join(",")} - nothing recognised as working -> coordinator (by design or by accident, the predicate cannot tell which)`); continue; }
	const dead = caps.filter((c) => seatIsCoordinator(as([c])));
	if (dead.length) findings.push(`${s.name}: ${dead.join(",")} carries no standing; its classification hangs on the other string`);
}
measured(`${seats.length} seats declared; ${findings.length} in the finding list; snapshot taken now`);
for (const f of findings) console.log(`    ${f}`);

/* ---------- C. the authority the classification actually grants, through the real verb ---------- */
let harness = null;
try {
	const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	harness = await Harness.open(await openNodeSqliteStorage(join(dir, "standing.sqlite")), { models, registry }, ctx);
	harness.resume();

	const declared = { designer: ["design"], impl: ["implement"], pm: ["route", "plan"] };
	const convs = await harness.commit(async (tx) => {
		const ids = {};
		const seatsDoc = await tx.doc(Seats);
		const queue = await tx.doc(RigQueue);
		for (const [name, caps] of Object.entries(declared)) {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, name);
			seatsDoc.seats[name].capabilities = caps;
			ids[name] = c.id;
		}
		queue.items.push({ id: 1, from: "pm", to: "impl", subject: "a row designer has no part in", body: "x", status: "held", blockedBy: [], transitions: [] });
		queue.items.push({ id: 2, from: "pm", to: "impl", subject: "gated on row 1", body: "x", status: "queued", blockedBy: [1], transitions: [] });
		queue.items.push({ id: 3, from: "designer", to: "impl", subject: "designer minted this", body: "x", status: "queued", blockedBy: [2], transitions: [] });
		queue.items.push({ id: 4, from: "pm", to: "other-seat", subject: "another parked row, nobody here owns it", body: "x", status: "held", blockedBy: [], transitions: [] });
		queue.nextId = 20;
		return ids;
	}, ctx);

	const run = async (seat, name, args) => {
		const conv = await harness.conversation(convs[seat], ctx);
		const watermark = (await conv.entries({}, 200, undefined, ctx)).items.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("done")),
		]);
		await (await conv.submit({ type: "input", content: name }, ctx)).wait(ctx);
		const texts = (await conv.entries({ minEntryId: watermark + 1 }, 200, undefined, ctx)).items
			.flatMap((e) => e.model ?? [])
			.filter((m) => m.role === "toolResult" && m.toolName === name)
			.map((m) => (m.content ?? []).map((c) => c.text ?? "").join(" "));
		return (texts[0] ?? "(no tool result)").replace(/\n/g, " ").slice(0, 220);
	};

	console.log("\nC. Release authority: the carve-out keys on capability absence, not on standing");
	const designerRelease = await run("designer", "release_work", { itemId: 1, reason: "un-parking it" });
	const implRelease = await run("impl", "release_work", { itemId: 4, reason: "un-parking it" });
	measured(`designer (["design"], not a party): ${designerRelease}`);
	measured(`impl      (["implement"], not a party, row 4): ${implRelease}`);
	gap(/released/.test(designerRelease), "a seat whose capabilities are unrecognised gains release authority over a row it has no part in. Same seat, same row, one string difference: the grant arrives by parsing, not by a recorded lever.");

	console.log("\nD. Gate reference standing: the depth bound, asserted at the only write surface that exists");
	let gateStanding = null;
	try { gateStanding = (await import("../../../src/rig.mjs")).gateStanding ?? null; } catch {}
	const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
	measured(`gateStanding exported by src/rig.mjs: ${gateStanding ? "yes" : "no - no depth bound is computed anywhere today"}`);
	if (gateStanding) {
		gap(gateStanding("designer", 3, items) !== true, "assertion 1 FAILED: designer minted row 3, so it has standing on its own row");
		gap(gateStanding("designer", 1, items) === true, "assertion 2 FAILED: designer is not a party of row 1 and is not its resolver");
		gap(gateStanding("pm", 3, items) !== true, "assertion 3 FAILED: pm is a party of row 3's gate chain within one hop and should be allowed");
		gap(gateStanding("impl", 3, items) === true, "assertion 4 FAILED: impl is not a party of row 3 and nothing within one hop is minted by impl - depth 2 must be refused");
	} else {
		gap(true, "assertion 1 (party allowed): untestable, the predicate does not exist yet");
		gap(true, "assertion 2 (non-party, non-resolver refused): nothing refuses it");
		gap(true, "assertion 3 (one level allowed): nothing computes hops");
		gap(true, "assertion 4 (depth 2 refused): nothing computes hops");
	}

	const minted = await run("designer", "send_work", { to: "impl", subject: "gated on a row I have no part in", body: "x", blockedBy: [1] });
	measured(`mint path (the only gate-write surface today), designer gating on row 1: ${minted}`);
	gap(/item #\d+/.test(minted) && !/refus|refuse|not allowed|standing/i.test(minted), "the mint path accepts a gate reference the sender has no standing on. #6512's validator must refuse it inside the commit, over the combined graph, before the write.");

	console.log("\nE. The predicate the probe will assert once it exists");
	console.log("  standing(seat,item) = item.from === seat || item.to === seat || item.block?.resolver === seat");
	console.log("  referenceOk(seat,target,items) = standing(target) || some row within ONE hop of target is minted by seat; else refuse.");
	console.log("  Refusal names: target id, the seat's standing or its absence, and the legal alternative - mint the row carrying the gate (D258 point 3) or ask a party.");
} finally {
	try { await harness?.close(ctx); } catch {}
	rmSync(dir, { recursive: true, force: true });
}

console.log(gaps.length ? `\nRESULT: RED - ${gaps.length} open gap(s)` : "\nRESULT: GREEN - standing is data and depth is bounded and asserted");
process.exit(gaps.length ? 1 : 0);
