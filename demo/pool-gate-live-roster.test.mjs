// demo/pool-gate-live-roster.test.mjs — N19 "The Pool": the 70 % size gate, driven against THIS rig's REAL
// roster rather than a synthetic one, and the falsification probe (a non-conventional owner takes the row).
//
// WHY THIS DEMO EXISTS. The gate shipped, was armed on 2026-11-13 (`up --refresh` recorded a usableWindow for
// all 12 seats), and then could NOT be observed firing live: `sizeRefused: 0`, `tooBig: []`. Two structural
// reasons, both of which this demo removes:
//   1. only the `project` tier (120000) exceeds 70 % of ANY window on this rig — Math.floor(0.7*164320) = 115023
//      for the eleven 164320-token seats, 8601 for the 12288-token auditor — so no ordinary row can ever be refused;
//   2. the wake selector pre-filters candidates through `workable()`, so an oversized pool row is SKIPPED rather
//      than attempted, and the `size-refused` transition is written only on a NAMED claim (D275 addendum (c)).
// So the only live path to the refusal is "a seat names a project-tier pool row". The live fleet never did (it
// was asked four times and was busy landing), which is an operator-visible fact, not a defect in the gate.
//
// WHAT IS REAL HERE: the roster — every seat name, capability set, declared window, compaction reserve and the
// tier table in force are the values read from `./selfdev.sqlite` at 2026-11-13T20:0xZ (read via the broker seam,
// recorded in `.spike/live-roster-now.json`, host Linux / Fedora Linux 45 / kernel 7.2.15-300.fc45.x86_64 /
// node v24.22.1). What is NOT real: the store is a temp fixture and the model is the mocked fauxProvider, so this
// runs in 0.4 s with no network.
//
// Run: node demo/pool-gate-live-roster.test.mjs   (exit 0 = pass)
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { poolCensus } from "../src/readapi.mjs";
import { RigQueue, Seats, Router, registerSeat, splitInstruction } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "pool-gate-live-"));

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

/** The roster in force, read from the live store on 2026-11-13 and recorded here. Every seat declares a window
 *  (that is what `up --refresh` fixed this session); the auditor is the verifier-class seat whose 12288 usable
 *  tokens are the tightest budget on the rig. */
const RECORDED_TIER_TOKENS = { trivial: 3400, small: 6100, feature: 6200, project: 120000 };
const RECORDED_SEATS = {
	pm: { role: "program manager", capabilities: ["route", "plan"], usableWindow: 164320 },
	impl: { role: "implementation engineer", capabilities: ["implement", "code"], usableWindow: 164320 },
	qa: { role: "verifier", capabilities: ["verify", "review"], usableWindow: 164320 },
	lead: { role: "lead", capabilities: ["decide", "adjudicate"], usableWindow: 164320 },
	advocate: { role: "workflow reviewer", capabilities: ["review", "advocate"], usableWindow: 164320 },
	scribe: { role: "documentation", capabilities: ["implement"], usableWindow: 164320 },
	devtools: { role: "tooling", capabilities: ["implement"], usableWindow: 164320 },
	auditor: { role: "second verifier", capabilities: ["verify"], usableWindow: 12288 },
	designer: { role: "cli/ux", capabilities: ["review"], usableWindow: 164320 },
	security: { role: "security", capabilities: ["security", "review"], usableWindow: 164320 },
	qa2: { role: "second verifier", capabilities: ["verify", "review"], usableWindow: 164320 },
	architect: { role: "architecture", capabilities: ["design", "review"], usableWindow: 164320 },
};

// THE ROSTER IS READ LIVE WHEN THE LIVE STORE IS THERE, and the recorded copy is only the hermetic fallback.
// The first version hardcoded the twelve seats, which is a TRANSCRIPTION of the rig rather than the rig: a roster
// change (`up --refresh` after a model swap) would leave the demo asserting yesterday's windows and still green.
// The read goes through the broker seam when one is resident (src/readclient.mjs), so it never becomes a second
// store writer. In a checkout with no `./selfdev.sqlite` the recorded values are used and the source is printed.
async function rosterSource() {
	const live = join(process.cwd(), "selfdev.sqlite");
	if (!existsSync(live)) return { seats: RECORDED_SEATS, tierTokens: RECORDED_TIER_TOKENS, source: "recorded (no ./selfdev.sqlite in cwd)" };
	try {
		const { readData } = await import("../src/readclient.mjs");
		const { readSeatsDocument } = await import("../src/readapi.mjs");
		const { Seats: SeatsDoc } = await import("../src/rig.mjs");
		const doc = await readData(live, "document", { kind: SeatsDoc.definition.kind, scope: { kind: "session" } }, (st) => readSeatsDocument(st));
		const value = doc?.found ? doc.value : doc;
		const seats = Object.fromEntries(
			Object.entries(value?.seats ?? {}).map(([name, s]) => [
				name,
				{ role: s.role ?? "", capabilities: s.capabilities ?? [], usableWindow: s.usableWindow ?? null },
			]),
		);
		if (Object.keys(seats).length === 0 || Object.values(seats).some((s) => !Number.isFinite(s.usableWindow))) {
			return { seats: RECORDED_SEATS, tierTokens: RECORDED_TIER_TOKENS, source: "recorded (the live store has seats without a window)" };
		}
		return { seats, tierTokens: value?.tierTokens ?? RECORDED_TIER_TOKENS, source: `LIVE (${Object.keys(seats).length} seats read from ./selfdev.sqlite via the broker seam)` };
	} catch (err) {
		return { seats: RECORDED_SEATS, tierTokens: RECORDED_TIER_TOKENS, source: `recorded (live read failed: ${err?.message ?? err})` };
	}
}
const live = await rosterSource();
const LIVE_SEATS = live.seats;
const LIVE_TIER_TOKENS = live.tierTokens;

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

await harness.commit(async (tx) => {
	for (const [name, s] of Object.entries(LIVE_SEATS)) {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: `You are the ${name} seat.` });
		await registerSeat(tx, name, c.id, s.role);
		const entry = (await tx.doc(Seats)).seats[name];
		entry.capabilities = [...s.capabilities];
		entry.usableWindow = s.usableWindow;
	}
	(await tx.doc(Seats)).tierTokens = { ...LIVE_TIER_TOKENS };
}, ctx);

const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queue = async () => (await harness.snapshot(RigQueue, undefined, ctx))?.items ?? [];
const itemBySubject = async (needle) => (await queue()).find((it) => String(it.subject).includes(needle));
async function transcript(name) {
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const pg = await c.entries({}, 300, undefined, ctx);
	return pg.items.map((e) => JSON.stringify(e)).join("\n");
}
async function call(name, toolName, toolArgs) {
	faux.appendResponses([
		fauxAssistantMessage([fauxToolCall(toolName, toolArgs)], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("done")),
	]);
	const c = await harness.conversation(roster[name].conversationId, ctx);
	const sub = await c.submit({ type: "input", content: "go" }, ctx);
	await sub.wait(ctx);
	return sub;
}

console.log("\n=== the fixture IS this rig's roster: 12 seats, every window declared, the live tier table ===");
console.log(`  roster source: ${live.source}`);
check("every seat registered with its live capability set", Object.keys(roster).length === Object.keys(LIVE_SEATS).length && JSON.stringify(roster.impl.capabilities) === JSON.stringify(["implement", "code"]), JSON.stringify(Object.keys(roster)));
check("every seat declares a usable window (the state `up --refresh` produced)", Object.values(roster).every((s) => Number.isFinite(s.usableWindow) && s.usableWindow > 0));
check("the tier table in force is the one `up` wrote", JSON.stringify((await harness.snapshot(Seats, undefined, ctx)).tierTokens) === JSON.stringify(LIVE_TIER_TOKENS));
const censusEmpty = poolCensus(await queue(), Object.entries(roster).map(([name, s]) => ({ name, usableWindow: s.usableWindow })), LIVE_TIER_TOKENS);
check("no seat is window-less, so the gate is ARMED before anything is minted", censusEmpty.seatsWithoutWindow.length === 0, JSON.stringify(censusEmpty.seatsWithoutWindow));

console.log("\n=== the live backlog cannot reach the gate: only `project` is above 70 % of every window ===");
const limit11 = Math.floor(0.7 * 164320);
const limitAuditor = Math.floor(0.7 * 12288);
// 0.7 * 164320 floors to 115023, not 115024: `0.7` is not exactly representable, so the product is
// 115023.99999999999. The rig uses Math.floor(fraction * usableWindow) for exactly this reason.
check("70 % of a 164320-token seat floors to 115023; every non-project tier fits under it", limit11 === 115023 && LIVE_TIER_TOKENS.feature < limit11 && LIVE_TIER_TOKENS.project > limit11, `${limit11}`);
check("70 % of the auditor's 12288 is 8601; `feature` (6200) still fits, `project` (120000) does not", limitAuditor === 8601 && LIVE_TIER_TOKENS.feature < limitAuditor && LIVE_TIER_TOKENS.project > limitAuditor, `${limitAuditor}`);

console.log("\n=== pm mints a PROJECT-tier pool row (the only row shape this gate can refuse) ===");
await call("pm", "send_work", {
	pool: true,
	requires: ["implement"],
	tier: "project",
	subject: "POOL PROBE (project tier): the size gate must refuse this",
	body: "Deliberately oversized; minted only to prove the 70 % gate refuses a real claim.",
});
const probe = await itemBySubject("POOL PROBE (project tier)");
check("the row is OPEN in the pool: no recipient, `pool: true`", probe?.to === null && probe?.pool === true, JSON.stringify({ to: probe?.to, pool: probe?.pool }));
// ONE capability is stored as the STRING it always was (D275 / `storeRequires`), so the live rig reads
// `requires: "implement"` and not `["implement"]` — the assertion has to accept the shipped storage shape.
check("it carries the live capability set and the project tier", ["implement"].includes(probe?.requires) && probe?.tier === "project", JSON.stringify({ requires: probe?.requires, tier: probe?.tier }));

console.log("\n=== impl (a 164320-token seat that DOES advertise `implement`) names it: the gate refuses ===");
await call("impl", "claim_work", { itemId: probe.id });
const implSaid = await transcript("impl");
const implReason = `too-big:project(${LIVE_TIER_TOKENS.project} tokens > 70% of the 164320-token usable window)`;
// PRINT THE REFUSAL, do not only assert it: the objective's criterion is "the refusal string is quoted", and a
// quotation has to come from a run someone else can repeat. This is that artifact.
{
	const at = implSaid.indexOf("CLAIM_REFUSED");
	if (at >= 0) {
		let quoted = implSaid.slice(at, at + 620).replace(/\\n/g, "\n    ").replace(/\\"/g, '"');
		const endOfText = quoted.indexOf("not a queue problem.");
		if (endOfText > 0) quoted = quoted.slice(0, endOfText + "not a queue problem.".length);
		console.log(`  REFUSAL (impl, live roster, row #${probe.id}):\n    ${quoted.split("\n")[0]}`);
	}
}
check("the refusal is the shipped reason string, verbatim", implSaid.includes(implReason), implReason);
check("it is a CLAIM_REFUSED naming the row, not a silent null", implSaid.includes(`CLAIM_REFUSED: #${probe.id} is in the POOL but you cannot claim it`), implSaid.slice(-400));
check("the refusal carries the split instruction, naming THIS row", implSaid.includes(`complete_work(itemId: ${probe.id}, closedAs: \\"split\\", children: [...])`) || implSaid.includes(splitInstruction({ id: probe.id }).slice(0, 60)));
const afterImpl = (await queue()).find((it) => it.id === probe.id);
check("the row is still queued and still OPEN (a refusal is not a claim)", afterImpl?.status === "queued" && afterImpl?.to === null, JSON.stringify({ status: afterImpl?.status, to: afterImpl?.to }));
check("a `size-refused` transition is recorded, by impl, with the same reason", afterImpl?.transitions?.some((t) => t.event === "size-refused" && t.by === "impl" && t.reason === implReason), JSON.stringify(afterImpl?.transitions));

console.log("\n=== the auditor (12288 usable) is refused on its OWN window, not the fleet's ===");
// A SECOND project row, because the auditor does not advertise `implement`: on the probe we just minted its
// refusal would be the CAPABILITY gate (`requires:implement`), which is correct and proves nothing about size.
// `verify` is the auditor's own capability, so the only thing left to refuse it is the window.
await call("pm", "send_work", {
	pool: true,
	requires: ["verify"],
	tier: "project",
	subject: "POOL PROBE (project tier, verifier set): the auditor's window is the tight one",
	body: "Deliberately oversized; the auditor's 12288 usable tokens make 120000 eight times the limit.",
});
const probeVerify = await itemBySubject("POOL PROBE (project tier, verifier set)");
await call("auditor", "claim_work", { itemId: probeVerify.id });
const auditorReason = `too-big:project(${LIVE_TIER_TOKENS.project} tokens > 70% of the 12288-token usable window)`;
check("the reason quotes the auditor's window", (await transcript("auditor")).includes(auditorReason), auditorReason);
const afterAuditor = (await queue()).find((it) => it.id === probeVerify.id);
check("the auditor's row carries its own `size-refused` transition, with its window in the reason", afterAuditor?.transitions?.some((t) => t.event === "size-refused" && t.by === "auditor" && t.reason === auditorReason), JSON.stringify(afterAuditor?.transitions));
check("each seat's refusal is on the row IT tried, one transition each", (await queue()).filter((it) => it.transitions?.some((t) => t.event === "size-refused")).length === 2, JSON.stringify((await queue()).filter((it) => it.transitions?.some((t) => t.event === "size-refused")).map((it) => `${it.id}:${it.transitions.filter((t) => t.event === "size-refused").length}`)));

console.log("\n=== the census reports the row as TOO BIG per seat, without a claim having to happen ===");
const census = poolCensus(await queue(), Object.entries(roster).map(([name, s]) => ({ name, usableWindow: s.usableWindow })), LIVE_TIER_TOKENS);
const tooBig = census.tooBig.find((t) => t.id === probe.id);
check("the open project row is in `tooBig`", tooBig !== undefined, JSON.stringify(census.tooBig));
check("...naming every seat whose window it exceeds — all 12 on this roster, and `unclaimableByAnyone`", tooBig?.tooBigFor?.length === 12 && tooBig?.unclaimableByAnyone === true, JSON.stringify(tooBig));
check("...and the census counts no refusal as a claim", census.claimed === 0 && census.open === 2, JSON.stringify({ claimed: census.claimed, open: census.open }));

console.log("\n=== the gate does not starve ordinary work: a SMALL pool row is taken by a non-conventional owner ===");
await call("pm", "send_work", { pool: true, requires: ["implement"], tier: "small", subject: "POOL PROBE (shared capability): a seat that is not the usual owner should take this", body: "Pool provenance row: no addressee at mint." });
const small = await itemBySubject("POOL PROBE (shared capability)");
await call("devtools", "claim_work", { itemId: small.id });
const claimedSmall = (await queue()).find((it) => it.id === small.id);
check("devtools (not impl) is the owner of record", claimedSmall?.to === "devtools" && claimedSmall?.status === "claimed", JSON.stringify({ to: claimedSmall?.to, status: claimedSmall?.status }));
check("the claim is recorded as `pool-claimed` by devtools", claimedSmall?.transitions?.some((t) => t.event === "pool-claimed" && t.by === "devtools"), JSON.stringify(claimedSmall?.transitions));
check("`pool` stays true as provenance after the claim", claimedSmall?.pool === true);
const censusAfter = poolCensus(await queue(), Object.entries(roster).map(([name, s]) => ({ name, usableWindow: s.usableWindow })), LIVE_TIER_TOKENS);
check("the census moves: 3 pooled, 2 open, 1 claimed — a refused row stays OPEN work", censusAfter.rows === 3 && censusAfter.open === 2 && censusAfter.claimed === 1, JSON.stringify(censusAfter));

console.log(failures === 0 ? "\nPOOL GATE / LIVE ROSTER PASS (project refused for two real seats with the split instruction; small row claimed by a non-conventional owner)" : `\nPOOL GATE / LIVE ROSTER FAIL — ${failures} check(s)`);
rmSync(dir, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
