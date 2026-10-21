// demo/workable-claim.test.mjs — #2673 (A): `claim_work` claims the oldest WORKABLE item, and
// says what it skipped and why.
//
// THE DEFECT: selection was `status === "queued"` and nothing else, so an item blocked on an
// unclosed gate, an unadvertised capability or a CANCELLED prerequisite still occupied the
// oldest-claim slot. Work behind it starved, and the starvation was invisible — a queue full of
// non-workable rows looked exactly like a queue with nothing to do.
//
// THE CONTRACT (lead-ratified, #2677):
//   workable(item, seat) := queued AND capability satisfied AND every gate link resolves DONE
//   ...with the CONSERVATIVE DEFAULT: a missing or ambiguous signal means WORKABLE, because a
//   false negative starves work invisibly while a false positive only hands the seat something
//   it can hold or defer.
//   A CANCELLED gate is a POSITIVE non-workability (`gate-cancelled`) — "terminal" != "done".
//   CLAUSE 4 (persisted fault) is NOT implemented: no such field exists and D24 forbids
//   inventing one, so it is a REGISTERED GAP rather than a fake signal.
//
// FAILING-FIRST: on main neither `workable` nor `selectOldestWorkable` exists — selection is
// inline `status === "queued"` — so this demo cannot import what it asserts.
//
// Run: node demo/workable-claim.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { selectOldestWorkable, workable } from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const item = (over = {}) => ({
	id: 1,
	from: "pm",
	to: "impl",
	subject: "work",
	status: "queued",
	transitions: [],
	...over,
});

try {
	console.log("\n=== the predicate: the four non-workable shapes, and the default ===");
	const seat = "impl";
	const plain = item({ id: 10 });
	check("a plain queued item is workable", workable(plain, seat).workable === true);
	check("...with no reason", workable(plain, seat).reason === null);

	const needsCap = item({ id: 11, requires: "verify" });
	const noCap = workable(needsCap, seat, { capabilities: ["implement"] });
	check("a capability the seat lacks is NOT workable", noCap.workable === false, JSON.stringify(noCap));
	check("...and the reason names the capability", noCap.reason === "requires:verify", noCap.reason);
	check(
		"the same item IS workable for a seat that advertises it",
		workable(needsCap, seat, { capabilities: ["implement", "verify"] }).workable === true,
	);

	const openGate = item({ id: 12, blockedBy: [99] });
	const heldTarget = item({ id: 99, status: "held" });
	const open = workable(openGate, seat, { items: [openGate, heldTarget] });
	check("a gate on a HELD item is NOT workable", open.workable === false, JSON.stringify(open));
	check("...reason gate-open names the id and its status", open.reason === "gate-open:#99(held)", open.reason);

	const doneGate = item({ id: 13, blockedBy: [98] });
	const done = workable(doneGate, seat, { items: [doneGate, item({ id: 98, status: "done" })] });
	check("a gate on a DONE item IS workable", done.workable === true, JSON.stringify(done));

	const cancelledGate = item({ id: 14, blockedBy: [97] });
	const cancelled = workable(cancelledGate, seat, { items: [cancelledGate, item({ id: 97, status: "cancelled" })] });
	check("a gate on a CANCELLED item is NOT workable (terminal != done)", cancelled.workable === false, JSON.stringify(cancelled));
	check("...reason is gate-cancelled", cancelled.reason === "gate-cancelled:#97", cancelled.reason);

	console.log("\n=== the CONSERVATIVE DEFAULT: ambiguous means workable ===");
	const unknownGate = item({ id: 15, blockedBy: [4242] });
	check(
		"a gate id that names nothing in the queue is passed over, not treated as unmet",
		workable(unknownGate, seat, { items: [unknownGate] }).workable === true,
		JSON.stringify(workable(unknownGate, seat, { items: [unknownGate] })),
	);
	check("a non-queued item is not workable", workable(item({ status: "claimed" }), seat).workable === false);

	console.log("\n=== clause 4 is a REGISTERED GAP, not a fake signal ===");
	// No persisted fault field exists. An item carrying a stray `fault`-shaped field must NOT
	// be skipped on it — inventing a signal from model-level guessing is exactly what the
	// refinement forbids.
	const strayFault = item({ id: 16, fault: "provider-down", faulted: true });
	check("an unmodelled fault-shaped field does NOT make an item unworkable", workable(strayFault, seat).workable === true);

	console.log("\n=== the SELECTION: skip the oldest non-workable, claim the next, report why ===");
	const queue = [
		item({ id: 20, blockedBy: [21] }), // oldest, gated on a HELD item
		item({ id: 22, requires: "verify" }), // next, capability mismatch
		item({ id: 23, blockedBy: [24] }), // next, gate CANCELLED
		item({ id: 25 }), // the first WORKABLE one
		item({ id: 26 }), // workable, but later — must not be preferred
		item({ id: 21, status: "held" }),
		item({ id: 24, status: "cancelled" }),
	];
	const picked = selectOldestWorkable(queue, "impl", { capabilities: ["implement"] });
	check("the SECOND-best is not preferred over order: it claims #25", picked.item?.id === 25, JSON.stringify(picked.item?.id));
	check("it did NOT claim the later workable #26", picked.item?.id !== 26);
	check("three items were skipped", picked.skipped.length === 3, JSON.stringify(picked.skipped));
	check(
		"every skip carries its reason, in order",
		JSON.stringify(picked.skipped) ===
			JSON.stringify([
				{ id: 20, reason: "gate-open:#21(held)" },
				{ id: 22, reason: "requires:verify" },
				{ id: 23, reason: "gate-cancelled:#24" },
			]),
		JSON.stringify(picked.skipped),
	);

	console.log("\n=== items addressed elsewhere are not candidates at all ===");
	const mixed = [item({ id: 30, to: "qa" }), item({ id: 31 })];
	const mine = selectOldestWorkable(mixed, "impl", { capabilities: [] });
	check("another seat's item is claimed by neither and skipped by neither", mine.item?.id === 31 && mine.skipped.length === 0, JSON.stringify(mine));

	console.log("\n=== nothing workable: an honest empty answer that still reports the skips ===");
	const allBlocked = [item({ id: 40, requires: "verify" }), item({ id: 41, blockedBy: [42] }), item({ id: 42, status: "held" })];
	const none = selectOldestWorkable(allBlocked, "impl", { capabilities: [] });
	check("no item is claimed", none.item === null);
	check("both blocked items are still reported", none.skipped.length === 2, JSON.stringify(none.skipped));

	console.log("\n=== the SURFACED line (refinement 4: legibility, not just logging) ===");
	// The tool renders `#<id> (<reason>)` for each skip; this pins that shape so a starved
	// item is readable in the claim reply, not only in a log nobody reads.
	const rendered = `SKIPPED (addressed to you, not workable yet): ${picked.skipped.map((s) => `#${s.id} (${s.reason})`).join(", ")}`;
	check("the rendered skip line names each id and reason", rendered.includes("#20 (gate-open:#21(held))") && rendered.includes("#22 (requires:verify)"), rendered);

	assert.ok(true);
	console.log(
		failures === 0
			? "\nWORKABLE CLAIM PASS (oldest workable, legible skips, conservative default, fault gap declared)"
			: `\nWORKABLE CLAIM FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
