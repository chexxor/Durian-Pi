// demo/queue-lifecycle-m1.test.mjs — queue-lifecycle v2, slice M1b: the ONE stage/block mapping.
//
// WHY (docs/reviews/queue-lifecycle-redesign.md, ACCEPTED): `held`/`deferred` must stop being statuses
// and become views of a `block` on two orthogonal axes (`stage` + `block`). M1b is the MAPPING half of
// the split M1: the field model and its persistence are M1a (`demo/queue-lifecycle-m1a.test.mjs`); this
// slice adds the ONE mapping legacy status -> axes (architect F6: ~30 status literals across 11 files
// are what drifts) and keeps the four familiar states legible as views.
//
// OWNERSHIP PINNED BY THIS DEMO (lead #3034, correcting #3017): this module defines NO claimability
// predicate. `workable(item, seat)` is OWNED by #2673 — the redesign consumes it and never restates its
// body — so the demo asserts it is not exported here.
//
// Failing-first: at the base the mapping does not exist (`effectiveStage` is not exported), so the import
// is undefined and the first check fails.
//
// Run: node demo/queue-lifecycle-m1.test.mjs  (exit 0 = pass)
import * as lifecycle from "../src/queue-lifecycle.mjs";
import {
	canAutoOpen,
	effectiveBlock,
	effectiveStage,
	legacyStatus,
	normalizeBlock,
} from "../src/queue-lifecycle.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ─── 0. the correction: NO predicate here ─────────────────────────────────────────────────────── */
console.log("\nownership: this slice defines the mapping, never the predicate");
check("`workable` is NOT exported here (owned by #2673)", lifecycle.workable === undefined);
check(
	"`capabilitiesOfSeat` is NOT here either (it only served the predicate)",
	lifecycle.capabilitiesOfSeat === undefined,
);
check(
	"the mapping pair IS exported",
	typeof effectiveStage === "function" && typeof effectiveBlock === "function",
);

/* ─── 1. the ONE legacy read-mapping (design §2, §9.2) ─────────────────────────────────────────── */
console.log("\neffectiveStage / effectiveBlock — one mapping of stored status to the axes");
const legacy = (status, extra = {}) => ({
	id: 1,
	from: "pm",
	to: "impl",
	status,
	transitions: [
		{ at: "2026-10-01T00:00:00.000Z", event: status === "held" ? "held" : "queued", by: "pm" },
	],
	...extra,
});

const queued = legacy("queued");
check(
	"queued → stage open, no block",
	effectiveStage(queued) === "open" && effectiveBlock(queued) === null,
);
check("queued → the familiar view is still `queued`", legacyStatus(queued) === "queued");

const heldReg = legacy("held");
const heldRegBlock = effectiveBlock(heldReg);
check("held (never claimed) → stage open", effectiveStage(heldReg) === "open");
check(
	"held (never claimed) → a legacy registration block",
	heldRegBlock?.source === "legacy" && heldRegBlock?.reason === "backlog",
	JSON.stringify(heldRegBlock),
);
check("held (never claimed) → resolver pm", heldRegBlock?.resolver === "pm");
check(
	"held (never claimed) → NO clock (F10: no firehose over the legacy store)",
	heldRegBlock?.reviewBy === null,
);
check("held → the familiar view is still `held`", legacyStatus(heldReg) === "held");

const heldManual = legacy("held", {
	heldReason: "waiting on a decision",
	transitions: [
		{ at: "2026-10-01T00:00:00.000Z", event: "queued", by: "pm" },
		{ at: "2026-10-02T00:00:00.000Z", event: "claimed", by: "impl" },
		{ at: "2026-10-03T00:00:00.000Z", event: "held", by: "impl" },
	],
});
check(
	"held after a claim → a manual park, not a registration",
	effectiveBlock(heldManual)?.reason === "manual",
	JSON.stringify(effectiveBlock(heldManual)),
);
check(
	"held after a claim → the owner is the resolver",
	effectiveBlock(heldManual)?.resolver === "impl",
);
check(
	"held after a claim → the park note is carried",
	effectiveBlock(heldManual)?.payload?.note === "waiting on a decision",
);

const claimed = legacy("claimed");
check(
	"claimed → stage active, no block",
	effectiveStage(claimed) === "active" && effectiveBlock(claimed) === null,
);
check("claimed → the familiar view is still `claimed`", legacyStatus(claimed) === "claimed");

const deferredByHolder = legacy("deferred", {
	question: "which way?",
	deferredTo: "human",
	transitions: [
		{ at: "2026-10-01T00:00:00.000Z", event: "queued", by: "pm" },
		{ at: "2026-10-02T00:00:00.000Z", event: "claimed", by: "impl" },
		{ at: "2026-10-03T00:00:00.000Z", event: "deferred", by: "impl", to: "human" },
	],
});
check(
	"deferred by its holder → stage stays ACTIVE (F1)",
	effectiveStage(deferredByHolder) === "active",
	effectiveStage(deferredByHolder),
);
check(
	"deferred by its holder → a question block",
	effectiveBlock(deferredByHolder)?.reason === "question",
);
check(
	"deferred by its holder → the resolver is the deferredTo target",
	effectiveBlock(deferredByHolder)?.resolver === "human",
);
check(
	"deferred by its holder → the question is carried",
	effectiveBlock(deferredByHolder)?.payload?.question === "which way?",
);
check(
	"deferred → the familiar view is still `deferred`",
	legacyStatus(deferredByHolder) === "deferred",
);

const escalated = legacy("deferred", {
	question: "supervisor escalation",
	deferredTo: "human",
	transitions: [
		{ at: "2026-10-01T00:00:00.000Z", event: "queued", by: "pm" },
		{ at: "2026-10-03T00:00:00.000Z", event: "deferred", by: "supervisor", to: "human" },
	],
});
check(
	"a supervisor escalation of a never-claimed row → stage stays OPEN (F1)",
	effectiveStage(escalated) === "open",
	effectiveStage(escalated),
);
check("the escalated row is blocked", effectiveBlock(escalated)?.reason === "question");

check(
	"done → stage closed, no block",
	effectiveStage(legacy("done")) === "closed" && effectiveBlock(legacy("done")) === null,
);
check(
	"cancelled → closed, and the view keeps the outcome",
	legacyStatus(legacy("cancelled")) === "cancelled",
);

/* ─── 2. authored state wins; the four states are views ────────────────────────────────────────── */
console.log("\nauthored `stage`/`block` win over the legacy mapping");
const authoredActiveBlocked = {
	id: 3,
	status: "claimed",
	stage: "active",
	block: { reason: "question", resolver: "human" },
};
check(
	"an authored ACTIVE+blocked row is representable (F1)",
	effectiveStage(authoredActiveBlocked) === "active",
);
check(
	"…and it renders as the familiar `deferred`",
	legacyStatus(authoredActiveBlocked) === "deferred",
);
const authoredOpenBlocked = {
	id: 4,
	status: "queued",
	stage: "open",
	block: { reason: "operator", resolver: "operator" },
};
check(
	"an authored OPEN+blocked row renders as the familiar `held`",
	legacyStatus(authoredOpenBlocked) === "held",
);
check(
	"an explicit authored `block: null` is unblocked even for a `held` status",
	effectiveBlock({ id: 5, status: "held", block: null }) === null,
);
check(
	"the four views are the closed set",
	eq(
		[
			...new Set([
				legacyStatus(queued),
				legacyStatus(heldReg),
				legacyStatus(claimed),
				legacyStatus(deferredByHolder),
			]),
		].sort(),
		["claimed", "deferred", "held", "queued"],
	),
);

/* ─── 3. the auto-open fence (the block model's own predicate) ─────────────────────────────────── */
console.log("\ncanAutoOpen — only a DECLARED all-queue dependency may clear itself");
check(
	"a declared dependency over queue gates CAN auto-open",
	canAutoOpen(
		normalizeBlock({
			source: "declared",
			reason: "dependency",
			resolver: "automatic",
			constraints: [{ kind: "queue", ref: 2951 }],
		}),
	) === true,
);
check(
	"a backlog block can NEVER auto-open",
	canAutoOpen(normalizeBlock({ source: "declared", reason: "backlog", resolver: "pm" })) === false,
);
check("a legacy registration block can never auto-open", canAutoOpen(heldRegBlock) === false);
check(
	"a legacy question block can never auto-open",
	canAutoOpen(effectiveBlock(deferredByHolder)) === false,
);
check(
	"a dependency with a non-queue constraint is NOT self-clearing",
	canAutoOpen({
		source: "declared",
		reason: "dependency",
		resolver: "automatic",
		constraints: [
			{ kind: "queue", ref: "#1" },
			{ kind: "window", note: "quiet window" },
		],
	}) === false,
);
check(
	"a roadmap gate is not self-clearing (no close event in the queue)",
	canAutoOpen({
		source: "declared",
		reason: "roadmap-gate",
		resolver: "RM-157",
		constraints: [{ kind: "roadmap", ref: "RM-157" }],
	}) === false,
);

/* ─── 4. the read-mapping is TOTAL (advocate CR-1) ─────────────────────────────────────────────── */
console.log("\nthe legacy read-mapping never throws — it cannot turn `check` red");
const nasty = [
	{},
	{ id: 1 },
	{ id: 1, status: "queued", transitions: null },
	{ id: 1, status: "held", to: undefined, transitions: [{}] },
	{ id: 1, status: "deferred", transitions: "nope" },
	{ id: 1, status: "wat" },
];
let threw = 0;
for (const row of nasty) {
	try {
		effectiveStage(row);
		effectiveBlock(row);
		legacyStatus(row);
	} catch {
		threw += 1;
	}
}
check("no stored row can make the mapping throw", threw === 0, `${threw} of ${nasty.length} threw`);
check(
	"an unknown legacy status reads as open/queued",
	effectiveStage({ id: 1, status: "wat" }) === "open" &&
		legacyStatus({ id: 1, status: "wat" }) === "queued",
);

console.log(
	failures === 0
		? "\nPASS — M1b: one mapping pair, four legible views, no predicate"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
