// demo/queue-lifecycle-deferred-stage.test.mjs — #4789: `deferred` must be its OWN STAGE, and the
// acceptance is CLAIMABILITY/WAKEABILITY, not rendering.
//
// WHY. At the base this demo was written against, `src/queue-lifecycle.mjs` had
//   STAGES = ["open","active","closed"]                                // no `deferred` in the vocabulary
//   effectiveStage: status "deferred" -> wasEverClaimed ? "active" : "open"
//   legacyStatus:   stage "active"    -> block === null ? "claimed" : "deferred"
// i.e. "parked on an unanswered question" was represented as `active` + a block. Lead's ruling item 3
// forbids exactly that, in its own words: it "makes a deferred item look claimable, so a seat could claim
// work whose blocking question is unanswered". The stage is the axis the redesign derives
// `waiting`/`workable` from (#2951), so the axes said "a live owner is on this" about a row that nobody
// may claim and that an answer must wake. That is a correctness defect, not a taxonomy preference.
//
// WHAT ACTUALLY BREAKS, measured rather than asserted (and this is the part that is NOT a rendering
// complaint). Take a supervisor escalation of a NEVER-CLAIMED row — `src/supervisor.mjs` writes
// status:"deferred" onto a `queued` row, so this population is real. Under the base mapping it lands in
// stage `open` with a question block, and `legacyStatus` therefore renders it **`held`**. The redesign's
// own §2 table gives those two views opposite wake semantics: `held` => "Claimable? no / Wakes? no",
// `deferred` => "Claimable? no / Wakes? answer wakes the target via the QUESTION enqueue (§4.1)". So the
// base mapping put an answered-should-wake row into the one view that never wakes — the orphaned-work
// incident class this redesign exists to close. It is now `deferred`, and it is still not claimable.
//
// OWNERSHIP, unchanged and deliberately so: this demo asserts claimability by COMPOSING #2673's ONE
// predicate (`workable` / `selectOldestWorkable`, src/rig.mjs) with the stage axis. It defines NO new
// predicate and restates none of the predicate's body (lead #3034: one predicate, one owner).
//
// RED-FIRST, with the tree named so the claim is re-checkable:
//   base   = c26bc412 (main at the time of writing), file untouched  -> this demo exits 1 on the four
//            rulings' assertions: STAGES has no "deferred"; the holder-deferred row reads stage `active`
//            (the SAME stage as a running item); the escalated row reads stage `open` and view `held`;
//            and (W) happily admits a writer authoring `active` + `block`.
//   after  = the same demo with the fix applied -> exits 0.
// The CONTROL cases pass on BOTH sides, and say so out loud: at the STORE layer the claim verb already
// refuses a row whose status is not `queued`, so no seat could claim these rows before the fix either.
// The fix does not change what a seat may claim today; it makes the axis the next slice derives from
// tell the truth, and it makes the conflation unauthorable.
//
// Run: node demo/queue-lifecycle-deferred-stage.test.mjs   (exit 0 = pass)

import {
	STAGES,
	effectiveStage,
	effectiveBlock,
	legacyStatus,
} from "../src/queue-lifecycle.mjs";
// The ONE claimability predicate (#2673's), imported to be COMPOSED with, never copied.
import { workable, selectOldestWorkable } from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const at = (day) => `2026-11-0${day}T00:00:00.000Z`;

// A row its HOLDER parked: claimed, then deferred on a human question that is still unanswered.
const holderParked = {
	id: 1,
	to: "impl",
	status: "deferred",
	question: "land by merge or by re-cut?",
	deferredTo: "human",
	transitions: [
		{ at: at(1), event: "queued", by: "pm" },
		{ at: at(2), event: "claimed", by: "impl" },
		{ at: at(3), event: "deferred", by: "impl", to: "human" },
	],
};

// A row the SUPERVISOR escalated while nobody had claimed it (`src/supervisor.mjs` writes
// status:"deferred" onto a `queued` row). Same defect class, different parking agent.
const escalatedUnclaimed = {
	id: 2,
	to: "impl",
	status: "deferred",
	question: "which dependency owns this gate?",
	deferredTo: "human",
	transitions: [
		{ at: at(1), event: "queued", by: "pm" },
		{ at: at(3), event: "deferred", by: "supervisor", to: "human" },
	],
};

// A row that IS running — the stage the parked rows must NOT share.
const running = {
	id: 3,
	to: "impl",
	status: "claimed",
	transitions: [
		{ at: at(1), event: "queued", by: "pm" },
		{ at: at(2), event: "claimed", by: "impl" },
	],
};

// An ordinary claimable row, for the CONTROL cases in section 6.
const claimable = {
	id: 6,
	to: "impl",
	status: "queued",
	transitions: [{ at: at(1), event: "queued", by: "pm" }],
};

console.log("1. the vocabulary has a `deferred` STAGE (lead ruling item 3)");
check(
	"`deferred` is in STAGES",
	STAGES.includes("deferred"),
	`STAGES = [${STAGES.map((s) => `"${s}"`).join(", ")}]`,
);
check(
	"and the other three stages survive — this is an addition, not a re-partition",
	["open", "active", "closed"].every((s) => STAGES.includes(s)),
	`STAGES = [${STAGES.join(", ")}]`,
);

console.log("\n2. a parked row is `deferred` WHOEVER parked it, and `wasEverClaimed` is off that path");
check(
	"a holder-parked row is stage `deferred`",
	effectiveStage(holderParked) === "deferred",
	`got ${effectiveStage(holderParked)}`,
);
check(
	"a supervisor escalation of a never-claimed row is stage `deferred` too",
	effectiveStage(escalatedUnclaimed) === "deferred",
	`got ${effectiveStage(escalatedUnclaimed)}`,
);
check(
	"the two parkings are NOT conflated with a running row — the stage discriminates them",
	effectiveStage(holderParked) !== effectiveStage(running) &&
		effectiveStage(escalatedUnclaimed) !== effectiveStage(running),
	`parked=${effectiveStage(holderParked)} escalated=${effectiveStage(escalatedUnclaimed)} running=${effectiveStage(running)}`,
);
check(
	"WHO parked it rides the block, not the stage (the transition log is no longer the stage input)",
	effectiveBlock(holderParked)?.payload?.deferredTo === "human" &&
		effectiveBlock(escalatedUnclaimed)?.reason === "question" &&
		effectiveBlock(holderParked)?.payload?.question === "land by merge or by re-cut?",
);

console.log("\n3. WAKEABILITY — the §2 table gives `held` and `deferred` OPPOSITE wake semantics");
check(
	"the escalated row renders `deferred`, not `held`",
	legacyStatus(escalatedUnclaimed) === "deferred",
	`got legacyStatus = ${legacyStatus(escalatedUnclaimed)} (the base mapping rendered it \`held\`, which §2 says never wakes)`,
);
check(
	"the holder-parked row renders `deferred` (the view is unchanged for it)",
	legacyStatus(holderParked) === "deferred",
	`got ${legacyStatus(holderParked)}`,
);
check(
	"the round trip goes both ways: stored `deferred` -> stage `deferred` -> view `deferred`, with no stop at `active`",
	effectiveStage(holderParked) === "deferred" && legacyStatus(holderParked) === "deferred",
);

console.log("\n4. CLAIMABILITY, through #2673's ONE predicate — composed, never restated");
for (const row of [holderParked, escalatedUnclaimed]) {
	const view = { ...row, status: legacyStatus(row) };
	const verdict = workable(view, "impl", { items: [view], capabilities: ["implement"] });
	check(
		`#${row.id} parked on an unanswered question is NOT workable for its own holder`,
		verdict.workable === false,
		`got workable=${verdict.workable}`,
	);
	check(
		`#${row.id} the skip reason NAMES the park (\`${verdict.reason}\`)`,
		verdict.reason === `not-queued:${legacyStatus(row)}`,
		`got reason ${JSON.stringify(verdict.reason)}`,
	);
}
// The oldest-workable selection is the path `claim_work` with no itemId actually takes, so the refusal
// is asserted where the driver decides, not in a helper. Note what the measurement shows and keep it
// legible: a parked row is filtered out by STATUS before the predicate ever runs, so it is NOT reported
// in `skipped`. That is right, not a gap — `skipped` exists so a STARVED item is not mistaken for an
// empty queue, and a parked row is not starved, it waits on an answer.
const selection = selectOldestWorkable(
	[holderParked, escalatedUnclaimed].map((r) => ({ ...r, status: legacyStatus(r) })),
	"impl",
	{ capabilities: ["implement"] },
);
check(
	"the claim selection returns NOTHING claimable from two parked rows",
	selection.item === null,
	`got item #${selection.item?.id}`,
);
// A parked row must not jam the oldest-first scan: the parks sit AHEAD of a claimable row here.
const mixed = selectOldestWorkable(
	[
		{ ...holderParked, status: legacyStatus(holderParked) },
		{ ...escalatedUnclaimed, status: legacyStatus(escalatedUnclaimed) },
		claimable,
	],
	"impl",
	{ capabilities: ["implement"] },
);
check(
	"two parks ahead of a claimable row do NOT starve it — the scan still returns #6",
	mixed.item?.id === 6,
	`got ${mixed.item?.id ?? "null"}`,
);

console.log("\n5. (W) ADMISSION — a writer cannot author the conflation any more");
const illFormed = {
	id: 4,
	status: "claimed",
	stage: "active",
	block: { reason: "question", resolver: "human" },
};
let refusal = "";
try {
	effectiveStage(illFormed);
} catch (e) {
	refusal = e.message;
}
check(
	"`active` + a block is REFUSED on authored state, with the fix named in the message",
	refusal.includes('stage "active" admits block === null'),
	refusal || "no throw — the pair is still authorable",
);
check(
	"the same park authored as stage `deferred` IS representable",
	effectiveStage({ ...illFormed, stage: "deferred" }) === "deferred" &&
		legacyStatus({ ...illFormed, stage: "deferred" }) === "deferred",
);
check(
	"`active` with no block stays representable — the tightening is not a ban on the stage",
	effectiveStage({ id: 5, stage: "active", block: null }) === "active" &&
		legacyStatus({ id: 5, stage: "active", block: null }) === "claimed",
);

console.log("\n6. CONTROL — the fix must not starve a workable row (the conservative default, refinement 3)");
check(
	"an ordinary `queued` row is still workable, and the selection still returns it",
	workable(claimable, "impl", { items: [claimable], capabilities: ["implement"] }).workable === true &&
		selectOldestWorkable([claimable], "impl", { capabilities: ["implement"] }).item?.id === 6,
);
check(
	"an ordinary `claimed` row still renders `claimed` (no surface changes shape)",
	legacyStatus(running) === "claimed",
	`got ${legacyStatus(running)}`,
);
// The legacy read-mapping must stay TOTAL (advocate CR-1): a stored row with no authored `stage` must
// never reach the (W) throw, or ~160 unmigrated rows would turn `check` red.
let threw = 0;
for (const row of [{ id: 7, status: "deferred" }, { id: 8, status: "deferred", transitions: "nope" }, {}]) {
	try {
		effectiveStage(row);
		effectiveBlock(row);
		legacyStatus(row);
	} catch {
		threw += 1;
	}
}
check(
	"the legacy half is still TOTAL — no stored row can make the mapping throw",
	threw === 0,
	`${threw} threw`,
);

console.log(
	failures === 0
		? "\nPASS — `deferred` is a stage, the stage discriminates a park from a run, and both parks are unclaimable while their question is unanswered"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
