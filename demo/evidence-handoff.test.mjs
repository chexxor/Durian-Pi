// demo/evidence-handoff.test.mjs — ROADMAP 48 / W2: a completion's evidence travels
// with the handoff, so the next party can RE-EXECUTE it instead of trusting a claim.
//
// Lead's ruling (#1553, applying ROADMAP 48 / #851): verification MUST re-execute the
// evidence — "a completion's evidence should be the command+exitCode+artifact, and a
// verifier item should be able to re-run it". The evidence FIELD on a completion was
// delivered by #715; what was missing was the handoff: the DONE notice carried only the
// free-text `resultSummary`, so whoever routes or performs the verification saw a
// summary and no command to re-run. This test asserts the notice now carries the
// evidence verbatim — as a structured field AND a readable line — and that a completion
// with no evidence is unchanged (the field stays optional; qa #854 ruled it additive).
//
// FAILING-FIRST: before this change the DONE notice carried no `evidence` field and no
// evidence line, so the assertions below fail.
//
// Run: node demo/evidence-handoff.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Edges, RigQueue, Router, Seats, compilePersona, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	const mk = async (name, role) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
		await registerSeat(tx, name, c.id, role);
	};
	await mk("pm", "program manager");
	await mk("worker", "implementation engineer");
	const ed = await tx.doc(Edges);
	ed.edges = [
		{ from: "pm", maySendTo: ["worker"] },
		{ from: "worker", maySendTo: ["pm"] },
	];
}, ctx);

const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
const items = async () => (await harness.documentState(RigQueue, undefined, ctx)).value.items;

/** Drive one tool call on a seat's conversation; return the tool-result text. */
async function driveTool(seatName, toolName, toolArgs) {
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("ok")),
	]);
	const c = await harness.conversation(roster[seatName].conversationId, ctx);
	await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	const pg = await c.entries({}, 200, undefined, ctx);
	// entries() yields the transcript newest-first.
	const results = pg.items.filter(
		(x) => x.kind === "pi.tool-result" && String(x.model?.[0]?.toolName) === toolName,
	);
	return results[0]?.model?.[0]?.content?.[0]?.text ?? "";
}

try {
	const noticeFor = async (n) => (await items()).find((it) => it.notice === true && it.subject.startsWith(`DONE #${n}:`));

	/* ---------- a completion WITH evidence carries it onto the DONE notice ---------- */

	const sent1 = await driveTool("pm", "send_work", { to: "worker", subject: "Fix the widget", body: "do it" });
	assert.match(sent1, /queued item #1/, `the work item is queued; got: ${sent1.slice(0, 120)}`);
	const EVIDENCE = { command: "node demo/seatguard.test.mjs", exitCode: 0, artifact: "ae2798c" };
	await driveTool("worker", "claim_work", { itemId: 1 });
	const done1 = await driveTool("worker", "complete_work", {
		itemId: 1,
		resultSummary: "re-ran the suite",
		evidence: EVIDENCE,
	});
	// #4030: the result BEGINS WITH `ok` and MAY carry a trailing NOTE (the seat's cwd was reset to
	// the shared checkout after the reap). A caller must NOT assume it is exactly `ok` — the note is
	// the signal, and the whole point of it is that the seat MUST see it.
	assert.match(done1, /^ok(\n|$)/, `completing with evidence succeeds; got: ${done1.slice(0, 120)}`);

	const notice1 = await noticeFor(1);
	assert.ok(notice1, "a DONE notice was enqueued");
	assert.deepEqual(
		notice1.evidence,
		EVIDENCE,
		"the DONE notice carries the evidence VERBATIM as a structured field, so it is mechanically readable",
	);
	assert.match(notice1.body, /node demo\/seatguard\.test\.mjs/, "the notice body names the command to re-run");
	assert.match(notice1.body, /exit 0/, "the notice body records the exit code");
	assert.match(notice1.body, /ae2798c/, "the notice body records the artifact rev");
	assert.match(notice1.body, /re-ran the suite/, "the narrative summary is preserved (evidence is additive)");

	/* ---------- a completion WITHOUT evidence is unchanged (the field stays optional) ---------- */

	const sent2 = await driveTool("pm", "send_work", { to: "worker", subject: "Second task", body: "do that" });
	const id2 = Number(String(sent2).match(/#(\d+)/)?.[1]);
	assert.ok(Number.isInteger(id2), `the second work item is queued; got: ${sent2.slice(0, 120)}`);
	await driveTool("worker", "claim_work", { itemId: id2 });
	const done2 = await driveTool("worker", "complete_work", { itemId: id2, resultSummary: "no evidence given" });
	assert.match(done2, /^ok(\n|$)/, `completing without evidence is still legal; got: ${done2.slice(0, 120)}`);

	const notice2 = await noticeFor(id2);
	assert.ok(notice2, "a DONE notice was enqueued for the second item");
	assert.equal(notice2.evidence, undefined, "with no evidence, the notice carries no evidence field");
	assert.doesNotMatch(notice2.body, /evidence:/, "and no evidence line is appended");
	assert.match(notice2.body, /no evidence given/, "the narrative summary is the body, unchanged");

	console.log(
		"EVIDENCE-HANDOFF TEST PASS (a DONE notice carries the completion's command+exitCode+artifact verbatim; no evidence, no field)",
	);
} finally {
	await harness.close(ctx);
}
process.exit(0);
