// demo/revise-requires.test.mjs — N19 "The Pool" row 3: `requires` can be put on a row that ALREADY
// exists, by the seat that made the row or by a coordinating seat, and NOTHING ELSE changes.
//
// WHY THIS EXISTS (a measurement, not a wish). `send_work` was the only writer of `requires`, so the
// backlog could never be annotated: on the live store 7,655 rows exist, 7 carry `requires` and 0 carry
// `pool` (measured 2026-11-13, Linux Fedora 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1). A pool
// with no rows is a mechanism that cannot be exercised, and the only way to give it rows was to re-send
// every item — which loses the id, the chain and the tier.
//
// THE CONTRACT NOW, one shape per case:
//   the shape    one capability -> the STRING it always was; several -> the ARRAY; [] -> field ABSENT.
//                Identical to what `enqueueItem` writes, so an annotated backlog row is indistinguishable
//                from a freshly sent one to the claim predicate, the census and the check rules.
//   authority    subject/body stays with the PARTIES (the #6112 boundary is untouched); `requires` is
//                ROUTING, so its author or a coordinating seat (route/plan/decide/adjudicate) may set it.
//   the guard    a set NO seat on the roster advertises is REFUSED at the moment of writing — the pool's
//                version of a gate naming a cancelled row, which `check` reports as `pool-dead-gate`.
//   the limits   a claimed row is refused; the row is NOT pooled by this call; no seat's capability set
//                is touched by this path; a seat that lacks the capability still cannot claim the row it
//                just annotated.
//
// FAILING-FIRST: on HEAD `revise_work` has no `requires` parameter and `applyRevise` takes only
// subject/body, so every assertion below that reads a `requires` field fails.
//
// Run: node demo/revise-requires.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { applyRevise, registerSeat, requiredCapabilities, reviseMessage, RigQueue, Router, Seats, storeRequires, workable } from "../src/rig.mjs";
import { seatIsCoordinator } from "../src/seattools.mjs";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

/* ─── 1. pure: the ONE shape `requires` is stored in ─────────────────────── */
console.log("\npure — storeRequires: one is a string, many are an array, none is absent");
check("one capability stays a STRING (byte-identical to every pre-Pool row)", storeRequires("landing") === "landing", JSON.stringify(storeRequires("landing")));
check("one capability in an array also collapses to a string", storeRequires(["landing"]) === "landing", JSON.stringify(storeRequires(["landing"])));
check("two capabilities are an ARRAY, deduped and trimmed", JSON.stringify(storeRequires([" verify ", "verify", "review"])) === JSON.stringify(["verify", "review"]), JSON.stringify(storeRequires(["verify", "review"])));
check("[] is no requirement at all", storeRequires([]) === null, JSON.stringify(storeRequires([])));
check("an empty string is no requirement", storeRequires("") === null, JSON.stringify(storeRequires("")));
check("absent is no requirement", storeRequires(undefined) === null && storeRequires(null) === null);
check("an unmodellable value is absence, not a hidden requirement (the #2673 conservative default)", storeRequires(42) === null, JSON.stringify(storeRequires(42)));

console.log("\npure — applyRevise writes it, reports it, and clears it");
const pureItem = { id: 5001, from: "pm", to: "impl", subject: "tighten the pool gate", body: "old body", status: "queued", transitions: [] };
const setOne = applyRevise(pureItem, { requires: "code" });
check("status revised", setOne.status === "revised", JSON.stringify(setOne));
check("the field that landed is named", JSON.stringify(setOne.fields) === JSON.stringify(["requires"]), JSON.stringify(setOne.fields));
check("it is stored as the STRING, not a one-element array", pureItem.requires === "code", JSON.stringify(pureItem.requires));
check("the diff reports before and after", JSON.stringify(setOne.requiresDiff) === JSON.stringify({ from: null, to: "code" }), JSON.stringify(setOne.requiresDiff));
const setMany = applyRevise(pureItem, { requires: ["code", "verify"] });
check("several are stored as an ARRAY", JSON.stringify(pureItem.requires) === JSON.stringify(["code", "verify"]), JSON.stringify(pureItem.requires));
check("the diff names the value it came from", JSON.stringify(setMany.requiresDiff) === JSON.stringify({ from: "code", to: ["code", "verify"] }), JSON.stringify(setMany.requiresDiff));
const again = applyRevise(pureItem, { requires: ["code", "verify"] });
check("re-annotating the same set is a NO-CHANGE, not a success", again.status === "no-change", JSON.stringify(again));
check("and no field is claimed as landed", again.fields.length === 0, JSON.stringify(again.fields));
const cleared = applyRevise(pureItem, { requires: [] });
check("[] clears the field entirely", cleared.status === "revised" && !("requires" in pureItem), JSON.stringify(pureItem));
check("the cleared diff records the value it came from", JSON.stringify(cleared.requiresDiff) === JSON.stringify({ from: ["code", "verify"], to: null }), JSON.stringify(cleared.requiresDiff));
const pureMsg = reviseMessage(pureItem, cleared);
check("the message names the requirement change", /requires none \(was code,verify\)/.test(pureMsg), pureMsg.slice(0, 240));
check("the message says the row is NOT pooled by this call", /not a pool entry/.test(pureMsg), pureMsg.slice(0, 240));
check("the body digest is still carried, so a subject/body revise stays checkable", pureMsg.includes(`sha256=${cleared.digest}`), pureMsg.slice(0, 280));
// A requires write that silently does not land must be an ERROR, exactly like a body write (#3435).
const stuckItem = { id: 5002, from: "pm", to: "impl", subject: "x", body: "y", status: "queued", transitions: [] };
Object.defineProperty(stuckItem, "requires", { get: () => undefined, set: () => {}, configurable: true, delete: () => {} });
const stuckOut = applyRevise(stuckItem, { requires: "code" });
check("a requires write that does not stick is reported as mismatch", stuckOut.status === "mismatch", JSON.stringify(stuckOut));
check("and it names the field that failed", JSON.stringify(stuckOut.fields) === JSON.stringify(["requires"]), JSON.stringify(stuckOut.fields));

console.log("\npure — the claim predicate reads an annotated row with the SAME reason strings");
check("one missing capability -> requires:landing (byte-identical to pre-Pool)", workable({ status: "queued", to: "qa", requires: "landing" }, "qa", { items: [], capabilities: ["verify"] }).reason === "requires:landing");
check("two missing -> requires:a,b in the order written", workable({ status: "queued", to: "qa", requires: ["a", "b"] }, "qa", { items: [], capabilities: [] }).reason === "requires:a,b");
check("a seat advertising ALL of them is workable", workable({ status: "queued", to: "impl", requires: ["implement", "code"] }, "impl", { items: [], capabilities: ["implement", "code"] }).workable === true);

/* ─── 2. on a real harness: authority, the guard, and what the call cannot do ─── */
const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(
	async (tx) => {
		const mk = async (name, role, capabilities) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
			const seatDoc = await tx.doc(Seats);
			seatDoc.seats[name].capabilities = capabilities;
		};
		await mk("pm", "program manager", ["route", "plan"]);
		await mk("impl", "implementation engineer", ["implement", "code"]);
		await mk("qa", "independent verifier", ["verify", "review"]);
	},
	ctx,
);

const rosterOf = async () => (await harness.snapshot(Seats, undefined, ctx))?.seats ?? {};
const queueOf = async () => (await harness.snapshot(RigQueue, undefined, ctx))?.items ?? [];
const itemOf = async (id) => (await queueOf()).find((it) => it.id === id);
const capsOf = async () => JSON.stringify(Object.fromEntries(Object.entries(await rosterOf()).map(([n, s]) => [n, s.capabilities ?? []])));
let first = true;
const call = async (name, toolName, toolArgs) => {
	const batch = [fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("ok"))];
	if (first) {
		faux.setResponses(batch);
		first = false;
	} else faux.appendResponses(batch);
	const c = await harness.conversation((await rosterOf())[name].conversationId, ctx);
	return (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
};
const toolReply = async (name, toolName) => {
	const c = await harness.conversation((await rosterOf())[name].conversationId, ctx);
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

try {
	/* A. the author annotates its own queued row. */
	await call("impl", "send_work", { to: "impl", subject: "Add the pool census", body: "the numbers a seat needs", tier: "small" });
	const row = await itemOf(1);
	check("the row starts with no capability requirement", !("requires" in row), JSON.stringify(row));
	const rosterBefore = await capsOf();

	await call("impl", "revise_work", { itemId: 1, requires: ["implement", "code"] });
	const say = await toolReply("impl", "revise_work");
	const after = await itemOf(1);
	check("the author can annotate its own queued row", /revised \(requires\)/.test(say), say.slice(0, 260));
	check("two capabilities land as an ARRAY", JSON.stringify(after.requires) === JSON.stringify(["implement", "code"]), JSON.stringify(after.requires));
	check("the reply names the change and who can claim it", /requires implement,code \(was none\)/.test(say) && /can be claimed by: impl/.test(say), say.slice(0, 320));
	check("the reply says the row is NOT pooled by this call", /not a pool entry/.test(say) && /addressed to impl/.test(say), say.slice(0, 320));
	check(
		"the transition records actor, fields, before and after",
		after.transitions.at(-1)?.by === "impl" &&
			after.transitions.at(-1)?.event === "revised" &&
			JSON.stringify(after.transitions.at(-1)?.fields) === JSON.stringify(["requires"]) &&
			after.transitions.at(-1)?.requiresFrom === null &&
			JSON.stringify(after.transitions.at(-1)?.requiresTo) === JSON.stringify(["implement", "code"]),
		JSON.stringify(after.transitions.at(-1)),
	);
	check("subject/body untouched", after.subject === "Add the pool census" && after.body === "the numbers a seat needs");
	check("THE ROSTER IS BYTE-IDENTICAL before and after the annotation — this path cannot grant a capability", (await capsOf()) === rosterBefore, await capsOf());

	/* B. a working seat that is neither author nor recipient is refused; a coordinator is not. */
	await call("impl", "send_work", { to: "qa", subject: "Verify the census", body: "run the check", tier: "trivial" });
	const qaRow = (await queueOf()).length;
	await call("qa", "revise_work", { itemId: qaRow, requires: "verify" });
	const outsider = await toolReply("qa", "revise_work");
	check("qa may not annotate a row it did not author", /only its author .* or a coordinating seat/.test(outsider), outsider.slice(0, 220));
	check("...and the row is unchanged", !("requires" in await itemOf(qaRow)), JSON.stringify(await itemOf(qaRow)));

	await call("pm", "revise_work", { itemId: qaRow, requires: "verify" });
	const coordinatorSay = await toolReply("pm", "revise_work");
	check("pm, the coordinating seat, MAY annotate a row it did not mint", /revised \(requires\)/.test(coordinatorSay), coordinatorSay.slice(0, 240));
	await call("pm", "revise_work", { itemId: qaRow, body: "pm rewriting the request" });
	const pmBodySay = await toolReply("pm", "revise_work");
	check("pm's subject/body revise is refused: not yours to revise", /not yours to revise/.test(pmBodySay), pmBodySay.slice(0, 220));
	check("...and the body did not change", (await itemOf(qaRow)).body === "run the check", JSON.stringify(await itemOf(qaRow)));

	/* C. the dead-gate guard: a capability nobody has is refused, and nothing is written. */
	await call("pm", "revise_work", { itemId: qaRow, requires: "landing" });
	const dead = await toolReply("pm", "revise_work");
	check("a requirement no seat advertises is refused at the moment of writing", /unclaimable forever/.test(dead), dead.slice(0, 300));
	check("the refusal NAMES the roster so the fix is actionable", /impl=\[implement,code\]/.test(dead) && /qa=\[verify,review\]/.test(dead), dead.slice(0, 340));
	check("...and the previous requirement is still the stored one", JSON.stringify((await itemOf(qaRow)).requires) === JSON.stringify("verify"), JSON.stringify(await itemOf(qaRow)));

	/* D. the annotated requirement decides who can claim, including the annotator itself. */
	await call("qa", "claim_work", { itemId: qaRow });
	const claimed = await itemOf(qaRow);
	check("qa advertises `verify`, so it claims the row it was addressed to", claimed.status === "claimed", JSON.stringify({ status: claimed.status }));

	/* D. an annotation the ADDRESSEE cannot satisfy is refused: a requirement on an addressed row is a
	   promise to that seat, and this verb cannot re-route it. */
	await call("impl", "send_work", { to: "impl", subject: "Ship the widget", body: "small", tier: "trivial" });
	const selfRow = (await queueOf()).length;
	await call("impl", "revise_work", { itemId: selfRow, requires: "verify" });
	const selfSay = await toolReply("impl", "revise_work");
	check("a seat cannot annotate its own row with a capability it does not have", /does not advertise \[verify\]/.test(selfSay), selfSay.slice(0, 320));
	check("the refusal says how to route it instead", /Capability sets route work in the POOL/.test(selfSay), selfSay.slice(0, 360));
	check("...and nothing was written", !("requires" in await itemOf(selfRow)), JSON.stringify(await itemOf(selfRow)));
	check("impl's own capabilities are STILL [implement, code]", JSON.stringify((await rosterOf()).impl.capabilities) === JSON.stringify(["implement", "code"]), JSON.stringify((await rosterOf()).impl.capabilities));

	/* E. the round trip that matters: pm pools a row, annotates the capability SET, and the seat that
	   advertises it claims it while the seat that does not is refused with the reason. */
	await call("pm", "send_work", { pool: true, subject: "Audit the census output", body: "check the numbers the pool prints", tier: "trivial", requires: "verify" });
	const poolRow = (await queueOf()).length;
	const poolBefore = await itemOf(poolRow);
	check("the row is open in the pool", poolBefore.pool === true && (poolBefore.to === null || poolBefore.to === undefined), JSON.stringify(poolBefore));
	check("send_work already gated it: pm is a coordinator so the set is checked against the pool, not one seat", poolBefore.requires === "verify", JSON.stringify(poolBefore.requires));
	await call("pm", "revise_work", { itemId: poolRow, requires: ["verify", "review"] });
	const poolSay = await toolReply("pm", "revise_work");
	check("a coordinator can widen a POOL row's requirement", /revised \(requires\)/.test(poolSay), poolSay.slice(0, 320));
	check("the reply names the seats that can now claim it", /verify, review can be claimed by: qa/.test(poolSay), poolSay.slice(0, 360));
	check("and stores the ARRAY", JSON.stringify((await itemOf(poolRow)).requires) === JSON.stringify(["verify", "review"]), JSON.stringify((await itemOf(poolRow)).requires));
	await call("impl", "claim_work", { itemId: poolRow });
	const implSay = await toolReply("impl", "claim_work");
	check("impl, which does not advertise the set, is REFUSED at the claim path with the reason", /CLAIM_REFUSED.*requires:verify,review/.test(implSay), implSay.slice(0, 300));
	check("...and the pool row is still open", (await itemOf(poolRow)).status === "queued" && (await itemOf(poolRow)).to === null, JSON.stringify(await itemOf(poolRow)));
	await call("qa", "claim_work", { itemId: poolRow });
	const qaClaim = await itemOf(poolRow);
	check("qa, which advertises BOTH capabilities, claims it", qaClaim.status === "claimed" && qaClaim.to === "qa", JSON.stringify({ status: qaClaim.status, to: qaClaim.to }));
	check("the claim is recorded as a pool claim with pm still the author", qaClaim.pool === true && qaClaim.from === "pm" && qaClaim.transitions.some((t) => t.event === "pool-claimed" && t.by === "qa"), JSON.stringify(qaClaim.transitions));
	check("THE ROSTER STILL MATCHES THE START OF THE RUN after every annotation", (await capsOf()) === rosterBefore, await capsOf());

	/* F. a claimed row is not annotated. */
	await call("impl", "revise_work", { itemId: qaRow, requires: [] });
	const claimedSay = await toolReply("impl", "revise_work");
	check("a claimed row refuses the annotation with the existing reason", /not queued \(status=claimed\)/.test(claimedSay), claimedSay.slice(0, 220));
	check("...and its requirement survived the refused call", JSON.stringify((await itemOf(qaRow)).requires) === JSON.stringify("verify"), JSON.stringify(await itemOf(qaRow)));

	/* G. the authority is capability-derived, not name-derived. */
	check("the guard's authority test is capability-derived, not role-derived", seatIsCoordinator({ name: "pm", role: "program manager", capabilities: ["route", "plan"] }) && !seatIsCoordinator({ name: "impl", role: "implementation engineer", capabilities: ["implement", "code"] }));

	assert.ok(true);
	console.log(
		failures === 0
			? "\nREVISE-REQUIRES PASS (requires can be annotated on an existing row, in the pool shape, by the author or a coordinator, guarded against a dead set, and it changes nothing else)"
			: `\nREVISE-REQUIRES FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
