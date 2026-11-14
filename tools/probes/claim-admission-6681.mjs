#!/usr/bin/env node
/*
 * claim-admission-6681.mjs — does the by-id claim path obey the same admission rule as the oldest path?
 * (#6681, amending #6526; the ordering rule is D275, the gate predicate is D274)

 The seam: `claim_work` with no itemId calls `workable()` (src/rig.mjs:320) and reports every row it
 passed over and why. `claim_work` with an itemId (src/rig.mjs:851) filters on
 `it.to === me && it.status === "queued"` and admits the row - gate, capability and all - while its
 own comment claims the whitelist is "IDENTICAL to the oldest path".

 This probe runs the REAL verb through a REAL harness and compares, for the same row, what the
 selection path says and what the by-id path does. Exit 1 while the two disagree.

 Run: node tools/probes/claim-admission-6681.mjs
*/
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { registerSeat, RigQueue, Seats, Router, workable } from "../../../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.cwd(), "tmp-6681-"));
const gaps = [];
const gap = (cond, msg) => { console.log(`  ${cond ? "GAP   " : "CLOSED"}  ${msg}`); if (cond) gaps.push(msg); };

const rows = [
	{ id: 1, from: "pm", to: "impl", subject: "plain queued row", body: "x", status: "queued", blockedBy: [], transitions: [] },
	{ id: 2, from: "pm", to: "impl", subject: "gated row, gate still open", body: "x", status: "queued", blockedBy: [3], transitions: [] },
	{ id: 3, from: "pm", to: "qa", subject: "the gate", body: "x", status: "queued", blockedBy: [], transitions: [] },
	{ id: 4, from: "pm", to: "impl", subject: "row impl cannot claim by capability", body: "x", status: "queued", requires: "design", blockedBy: [], transitions: [] },
	{ id: 5, from: "pm", to: "impl", subject: "held row", body: "x", status: "held", blockedBy: [], transitions: [] },
	{ id: 6, from: "pm", to: "impl", subject: "deferred row", body: "x", status: "deferred", blockedBy: [], transitions: [] },
	{ id: 7, from: "pm", to: "impl", subject: "done row", body: "x", status: "done", blockedBy: [], transitions: [] },
	{ id: 8, from: "pm", to: "qa", subject: "someone else's queued row", body: "x", status: "queued", blockedBy: [], transitions: [] },
	{ id: 9, from: "pm", to: "impl", subject: "row gated on a CANCELLED row", body: "x", status: "queued", blockedBy: [10], transitions: [] },
	{ id: 10, from: "pm", to: "qa", subject: "the cancelled gate", body: "x", status: "cancelled", blockedBy: [], transitions: [] },
	{ id: 11, from: "pm", to: "impl", subject: "row whose gate id does not exist (ambiguous)", body: "x", status: "queued", blockedBy: [12], transitions: [] },
	{ id: 20, from: "pm", to: "drift", subject: "drift's parked row", body: "x", status: "held", blockedBy: [], transitions: [] },
	{ id: 21, from: "pm", to: "drift", subject: "drift's queued row with an open gate", body: "x", status: "queued", blockedBy: [22], transitions: [] },
	{ id: 22, from: "pm", to: "qa", subject: "the open gate", body: "x", status: "queued", blockedBy: [], transitions: [] },
];

let harness = null;
try {
	const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 128000 }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	harness = await Harness.open(await openNodeSqliteStorage(join(dir, "claim.sqlite")), { models, registry }, ctx);
	harness.resume();

	const convs = await harness.commit(async (tx) => {
		const ids = {};
		const seatsDoc = await tx.doc(Seats);
		const queue = await tx.doc(RigQueue);
		for (const [name, caps] of [["impl", ["implement"]], ["drift", ["implement"]]]) {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, name);
			seatsDoc.seats[name].capabilities = caps;
			ids[name] = c.id;
		}
		for (const r of rows) queue.items.push(r);
		queue.nextId = 50;
		return ids;
	}, ctx);

	const claimFor = async (convId, itemId) => {
		const conv = await harness.conversation(convId, ctx);
		const watermark = (await conv.entries({}, 300, undefined, ctx)).items.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("claim_work", itemId === undefined ? {} : { itemId })], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("done")),
		]);
		await (await conv.submit({ type: "input", content: "claim_work" }, ctx)).wait(ctx);
		return ((await conv.entries({ minEntryId: watermark + 1 }, 300, undefined, ctx)).items
			.flatMap((e) => e.model ?? [])
			.filter((m) => m.role === "toolResult" && m.toolName === "claim_work")
			.map((m) => (m.content ?? []).map((c) => c.text ?? "").join(" "))[0] ?? "(no tool result)");
	};
	const claim = (itemId) => claimFor(convs.impl, itemId);

	console.log("The skip report: a seat passed over by its own predicate must be told WHY");
	console.log(`  MEASURED  registered seats: ${Object.keys((await harness.snapshot(Seats, undefined, ctx)).seats ?? {}).join(", ")}`);
	console.log(`  MEASURED  rows addressed to drift: ${(await harness.snapshot(RigQueue, undefined, ctx)).items.filter((i) => i.to === "drift").map((i) => `#${i.id} ${i.status}`).join(", ") || "none"}`);
	const driftOut = (await claimFor(convs.drift, undefined)).replace(/\n/g, " ").slice(0, 220);
	console.log(`  MEASURED  claim_work with no id, seat drift (#20 held, #21 queued with gate #22 open) -> ${driftOut}`);
	gap(!/gate-open|#22/.test(driftOut), "the report names the parked row and counts the rest, so a queued-but-gated row reads as available work: the seat tries it, is refused, and escalates. The skip report must name each passed-over row and its reason");

	const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
	console.log("\nClaim by id, row by row (predicate verdict vs what the verb does):")
	for (const it of items.filter((i) => i.to === "impl")) {
		const verdict = workable(it, "impl", { items, capabilities: ["implement"] });
		const out = (await claim(it.id)).replace(/\n/g, " ").slice(0, 120);
		const claimed = /ITEM #|subject:/.test(out);
		console.log(`  row #${it.id} (${it.status}${it.blockedBy?.length ? ` gate=${it.blockedBy.join(",")}` : ""}${it.requires ? ` requires=${it.requires}` : ""})  predicate: ${verdict.workable ? "workable" : `refuses (${verdict.reason})`}  verb: ${claimed ? "CLAIMED" : out}`);
		if (!verdict.workable && claimed) gap(true, `the by-id path claimed row #${it.id} that workable() refuses for ${verdict.reason} - the gate and the capability check are bypassed, so a seat can take work the rig has not admitted`);
		if (verdict.workable && !claimed) gap(true, `the by-id path refused a row the predicate says is workable (#${it.id})`);
	}

	console.log("\nLegibility of the refusals (a refusal a seat cannot act on is a dead end):");
	for (const [id, expect] of [[5, "held"], [6, "deferred"], [7, "done"], [8, "not addressed"], [999, "unknown id"]]) {
		const out = (await claim(id)).replace(/\n/g, " ").slice(0, 160);
		console.log(`  MEASURED  claim_work({itemId: ${id}}) -> ${out}`);
		gap(!String(out).includes(String(id)), `the refusal for #${id} does not name the id the seat asked for, so it reads as "you have no work" rather than "that row is not claimable"`);
		gap(!/(release_work|resume_work|hold_work|nothing)/.test(String(out)), `the refusal for #${id} names no remedy verb - the seat escalates instead of acting`);
	}

	const noId = await claim(undefined);
	console.log(`  MEASURED  claim_work with no id, seat impl after the by-id claims -> ${noId.replace(/\n/g, " ").slice(0, 200)}`);
	console.log("\nWhat the probe asserts when the seam is closed");
	console.log("  one predicate on both paths: claim by id calls admitRow then workable(), and the refusal");
	console.log("  text is built FROM the verdict reason, not from a hand-written list;");
	console.log("  a named-row miss is a different token from NO_QUEUED_WORK (which is load-bearing:");
	console.log("  demo/race.test.mjs:84 and demo/rearmclaim.test.mjs:132 assert exact equality, and");
	console.log("  src/driver.mjs:36 documents NO_QUEUED_WORK as the wake-path signal).");
	console.log("\nStatic check of the seam: does the by-id branch use the predicate at all?");
	const src = readFileSync(new URL("../../../src/rig.mjs", import.meta.url), "utf8");
	const claimStart = src.indexOf('name: "claim_work"');
	const claimBody = src.slice(claimStart, src.indexOf('name: "complete_work"'));
	const byIdStart = claimBody.indexOf("if (args.itemId !== undefined)");
	const byIdEnd = claimBody.indexOf("// Normal claim");
	const byIdBranch = claimBody.slice(byIdStart, byIdEnd);
	console.log(`  MEASURED  by-id branch calls workable()/admitRow: ${/workable\(|admitRow\(/.test(byIdBranch)}; its filter is: ${(byIdBranch.match(/it\.to === me && it\.status === "queued"/g) || []).length} hand-written condition(s)`);
	console.log(`  MEASURED  the comment above it claims the whitelist is "IDENTICAL to the oldest path"; the oldest path calls selectOldestWorkable -> workable()`);
	gap(!/workable\(|admitRow\(/.test(byIdBranch), "the by-id path admits rows on a hand-written status filter while the wake layer (src/driver.mjs:135) and the oldest path both call workable(). Three rules for one seam: two agree, one is the bypass");
} finally {
	try { await harness?.close(ctx); } catch {}
	rmSync(dir, { recursive: true, force: true });
}

console.log(gaps.length ? `\nRESULT: RED - ${gaps.length} admission bypass(es) or unreadable refusals` : "\nRESULT: GREEN - both claim paths use one admission rule and every refusal names the row and the remedy");
process.exit(gaps.length ? 1 : 0);
