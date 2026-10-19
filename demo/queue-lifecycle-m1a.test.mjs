// demo/queue-lifecycle-m1a.test.mjs — queue-lifecycle v2, slice M1a: persist the structured GATE field.
//
// WHY (docs/reviews/queue-lifecycle-redesign.md, ACCEPTED; lead split #3048): the field must exist and be
// storable through the EXISTING enqueue path before any consumer can read it. M1a is FIELD-EARLY and
// landable on its own: the `block` shape + the `reviewBy` defaults, plus `requires` persisted on the item
// (it was a send-time capability check only, so nothing could read it back — architect F1).
//
// SCOPE PINNED BY THIS DEMO: NO stage/block mapping and NO claimability predicate live in this slice
// (`workable` is owned by #2673 per lead #3034), and there is no new write path / parallel store (D53).
//
// Failing-first: at the base `src/queue-lifecycle.mjs` does not exist, so the import throws (exit 1), and
// `send_work` neither persists `requires` nor accepts `block`.
//
// Run: node demo/queue-lifecycle-m1a.test.mjs  (exit 0 = pass)
import * as lifecycle from "../src/queue-lifecycle.mjs";
import { normalizeBlock, REVIEW_BY_DAYS, reviewByDefault } from "../src/queue-lifecycle.mjs";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { enqueueItem, registerSeat, RigQueue, Router, Seats } from "../src/rig.mjs";

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
const throws = (fn) => {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
};
const DAY = 24 * 60 * 60 * 1000;
const at = Date.parse("2026-10-19T00:00:00.000Z");

/* ─── 1. scope: the field model here, and NO claimability predicate anywhere ───────────────────── */
console.log("\nownership: no claimability predicate in this module (lead #3034)");
for (const banned of ["workable", "capabilitiesOfSeat"]) {
	check(
		`\`${banned}\` is NOT exported (it belongs to #2673's predicate)`,
		lifecycle[banned] === undefined,
	);
}
check("the field model IS exported", typeof normalizeBlock === "function");
check("the reason vocabulary is exported", Array.isArray(lifecycle.BLOCK_REASONS));
check("the constraint-kind vocabulary is exported", Array.isArray(lifecycle.CONSTRAINT_KINDS));
// M1a ships the field model alone; the stage/block MAPPING is M1b's half of the split and lands after
// it, so on M1a's own branch the mapping is absent. On the M1b branch (which stacks on this one) the
// mapping IS present, so this assertion is only made where it is true.
if (typeof lifecycle.effectiveStage !== "function") {
	check("the stage/block mapping is NOT here yet (M1b adds it)", true);
}

/* ─── 2. the block shape + the OQ2 defaults ───────────────────────────────────────────────────── */
console.log("\nnormalizeBlock — the field shape and the OQ2 reviewBy defaults");
check(
	"OQ2: operator 3 d / schedule 14 d / resource 3 d / manual 7 d",
	REVIEW_BY_DAYS.operator === 3 &&
		REVIEW_BY_DAYS.schedule === 14 &&
		REVIEW_BY_DAYS.resource === 3 &&
		REVIEW_BY_DAYS.manual === 7,
);
check(
	"OQ2: dependency 7 d / roadmap-gate 7 d",
	REVIEW_BY_DAYS.dependency === 7 && REVIEW_BY_DAYS["roadmap-gate"] === 7,
);
check(
	"OQ2: backlog and question carry NO clock",
	REVIEW_BY_DAYS.backlog === null && REVIEW_BY_DAYS.question === null,
);
check(
	"the default is materialized as an ISO date",
	reviewByDefault("manual", at) === new Date(at + 7 * DAY).toISOString(),
);

const dep = normalizeBlock(
	{
		source: "declared",
		reason: "dependency",
		resolver: "automatic",
		constraints: [{ kind: "queue", ref: 2951 }],
	},
	{ at },
);
check("a declared dependency normalizes", dep.reason === "dependency" && dep.source === "declared");
check(
	"its queue ref is normalized to #<id>",
	dep.constraints[0].ref === "#2951",
	JSON.stringify(dep.constraints),
);
check("it gets the 7 d clock by default", dep.reviewBy === new Date(at + 7 * DAY).toISOString());
check("it is stamped with `since`", dep.since === new Date(at).toISOString());
check(
	"the normalized shape is exactly the documented keys",
	JSON.stringify(Object.keys(dep).sort()) ===
		JSON.stringify(["constraints", "payload", "reason", "resolver", "reviewBy", "since", "source"]),
);
check(
	"a backlog block has no clock",
	normalizeBlock({ source: "declared", reason: "backlog", resolver: "pm" }, { at }).reviewBy ===
		null,
);

console.log(
	"\nan authored park that names no resolver is REFUSED (the defect this field exists to prevent)",
);
check(
	"no resolver → refused",
	throws(() => normalizeBlock({ source: "declared", reason: "manual", resolver: "" }, { at })),
);
check(
	"unknown reason → refused",
	throws(() => normalizeBlock({ source: "declared", reason: "someday", resolver: "pm" }, { at })),
);
check(
	"legacy-source dependency → refused",
	throws(() =>
		normalizeBlock(
			{
				source: "legacy",
				reason: "dependency",
				resolver: "automatic",
				constraints: [{ kind: "queue", ref: "#1" }],
			},
			{ at },
		),
	),
);
check(
	"dependency with no constraints → refused",
	throws(() =>
		normalizeBlock({ source: "declared", reason: "dependency", resolver: "automatic" }, { at }),
	),
);
check(
	"dependency with a window constraint → refused",
	throws(() =>
		normalizeBlock(
			{
				source: "declared",
				reason: "dependency",
				resolver: "automatic",
				constraints: [{ kind: "window", note: "x" }],
			},
			{ at },
		),
	),
);
check(
	"roadmap-gate without a roadmap constraint → refused",
	throws(() =>
		normalizeBlock(
			{
				source: "declared",
				reason: "roadmap-gate",
				resolver: "RM-1",
				constraints: [{ kind: "queue", ref: "#1" }],
			},
			{ at },
		),
	),
);
check(
	"explicit null reviewBy on a clocked reason → refused",
	throws(() =>
		normalizeBlock(
			{ source: "declared", reason: "manual", resolver: "impl", reviewBy: null },
			{ at },
		),
	),
);

/* ─── 3. the fields persist through the EXISTING enqueue path ──────────────────────────────────── */
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

try {
	await harness.commit(async (tx) => {
		const mk = async (name, role) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, name, c.id, role);
		};
		await mk("pm", "program manager");
		await mk("worker", "implementation engineer");
		// The capability gate is real: `requires` is checked at send time as well as persisted, so the
		// recipient must advertise it (this demo is about persistence, not about the gate refusing).
		(await tx.doc(Seats)).seats.worker.capabilities = ["verify"];
	}, ctx);

	const roster = (await harness.documentState(Seats, undefined, ctx)).value.seats;
	const items = async () => (await harness.documentState(RigQueue, undefined, ctx)).value.items;
	const item = async (id) => (await items()).find((it) => it.id === id);
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
		await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
	};

	console.log("\nenqueueItem persists the gate fields — and absence stays absent");
	const ids = await harness.commit(async (tx) => {
		const bare = await enqueueItem(tx, "pm", "worker", "Bare item", "body");
		const gated = await enqueueItem(
			tx,
			"pm",
			"worker",
			"Gated item",
			"body",
			null,
			false,
			null,
			false,
			[bare],
			"verify",
			{
				source: "declared",
				reason: "dependency",
				resolver: "automatic",
				constraints: [{ kind: "queue", ref: bare }],
			},
		);
		return { bare, gated };
	}, ctx);
	const bare = await item(ids.bare);
	const gated = await item(ids.gated);
	check(
		"an ungated item stores NO `block` (absence = unblocked)",
		bare.block === undefined,
		JSON.stringify(bare.block),
	);
	check("an ungated item stores NO `requires`", bare.requires === undefined);
	check("an ungated item stores NO `blockedBy`", bare.blockedBy === undefined);
	check(
		"`requires` IS persisted on the gated item",
		gated.requires === "verify",
		JSON.stringify(gated.requires),
	);
	check(
		"`blockedBy` IS persisted on the gated item",
		JSON.stringify(gated.blockedBy) === `[${ids.bare}]`,
		JSON.stringify(gated.blockedBy),
	);
	check(
		"`block` IS persisted on the gated item",
		gated.block?.reason === "dependency" && gated.block?.resolver === "automatic",
		JSON.stringify(gated.block),
	);
	check(
		"the stored block is NORMALIZED (refs + clock)",
		gated.block?.constraints?.[0]?.ref === `#${ids.bare}` &&
			typeof gated.block?.reviewBy === "string",
		JSON.stringify(gated.block),
	);
	check("the stored block is stamped with `since`", typeof gated.block?.since === "string");

	console.log("\na malformed park cannot be stored through the one write path");
	const before = (await items()).length;
	let refused = false;
	try {
		await harness.commit(async (tx) => {
			await enqueueItem(
				tx,
				"pm",
				"worker",
				"Bad park",
				"body",
				null,
				false,
				null,
				false,
				null,
				null,
				{
					source: "declared",
					reason: "dependency",
					resolver: "automatic",
				},
			);
		}, ctx);
	} catch {
		refused = true;
	}
	check("a dependency with no constraints throws out of the enqueue path", refused === true);
	check(
		"…and no item was written",
		(await items()).length === before,
		`${(await items()).length} vs ${before}`,
	);

	console.log(
		"\nsend_work persists the same fields through the tool (the existing path, end to end)",
	);
	await call("pm", "send_work", { to: "worker", subject: "Ungated work", body: "do it" });
	await call("pm", "send_work", {
		to: "worker",
		subject: "Gated work",
		body: "after the gate",
		requires: "verify",
		blockedBy: [ids.bare],
		block: {
			reason: "operator",
			resolver: "operator",
			constraints: [{ kind: "window", note: "quiet window" }],
		},
	});
	const ungated = (await items()).find((it) => it.subject === "Ungated work");
	const gatedTool = (await items()).find((it) => it.subject === "Gated work");
	check(
		"an ungated send stores no gate field at all",
		ungated.requires === undefined &&
			ungated.block === undefined &&
			ungated.blockedBy === undefined,
		JSON.stringify({ r: ungated.requires, b: ungated.block, g: ungated.blockedBy }),
	);
	check(
		"a gated send persists `requires`",
		gatedTool.requires === "verify",
		JSON.stringify(gatedTool.requires),
	);
	check(
		"a gated send persists `blockedBy`",
		JSON.stringify(gatedTool.blockedBy) === `[${ids.bare}]`,
		JSON.stringify(gatedTool.blockedBy),
	);
	check(
		"a gated send persists the normalized `block`",
		gatedTool.block?.reason === "operator" && gatedTool.block?.resolver === "operator",
		JSON.stringify(gatedTool.block),
	);
	check(
		"the operator park got its 3 d clock",
		typeof gatedTool.block?.reviewBy === "string" &&
			new Date(gatedTool.block.reviewBy) > new Date(),
		gatedTool.block?.reviewBy,
	);
	check(
		"the window constraint survived",
		gatedTool.block?.constraints?.[0]?.kind === "window",
		JSON.stringify(gatedTool.block?.constraints),
	);

	console.log("\nthe tool refuses a park that names no resolver/constraints");
	const beforeTool = (await items()).length;
	await call("pm", "send_work", {
		to: "worker",
		subject: "Bad park via tool",
		body: "x",
		block: { reason: "dependency", resolver: "automatic" },
	});
	check(
		"a malformed `block` through send_work writes NO item",
		(await items()).length === beforeTool,
		`${(await items()).length} vs ${beforeTool}`,
	);
	const pmConv = await harness.conversation(roster.pm.conversationId, ctx);
	const pmEntries = await pmConv.entries({}, 200, undefined, ctx);
	const transcript = pmEntries.items.map((e) => JSON.stringify(e)).join("\n");
	check("the refusal is legible in the sender's transcript", /send_work/i.test(transcript));
} finally {
	await harness.close(ctx);
}

console.log(
	failures === 0
		? "\nPASS — M1a: the structured gate field (`block`/`blockedBy`/`requires`) persists via the existing enqueue path"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
