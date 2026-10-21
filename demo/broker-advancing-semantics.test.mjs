// demo/broker-advancing-semantics.test.mjs — a NEVER-STARTED submission must not suppress its seat (#4170)
//
// THE DEFECT: `pendingConvIds` was built from EVERY submission row with no status filter, and
// `selectWakes` drops any seat whose conversation is in that set as "already advancing". An
// admitted-but-never-started (`queued`) submission is NOT advancing — so one 429, which leaves such a
// row behind, suppressed a seat from EVERY pass for ten hours. The work was in the queue; the seat was
// invisible. And the only thing that would have re-evaluated it was new traffic, which a starved seat
// does not get.
//
// FAILING-FIRST WITHOUT A PROVIDER: both halves are PURE DECISIONS over store state, so neither needs a
// live 429. The 429 is how it HAPPENED, not how it is tested.
//
// Run: node demo/broker-advancing-semantics.test.mjs   (exit 0 = pass)

import { advancingConvIds } from "../src/broker.mjs";
import { selectWakes } from "../src/driver.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// The state the defect leaves behind: seat designer, conversation 42, one admitted-but-never-started row.
const QUEUED_SUB = { id: 181515, conversationId: 42, status: "queued" };
const PLACED_SUB = { id: 181516, conversationId: 42, status: "placed" };
const SEATS = { designer: { conversationId: 42 } };
const ITEMS = [{ id: 3945, to: "designer", status: "queued" }];

try {
	console.log("\n=== (a) THE SUPPRESSION SEMANTICS: 'advancing' is not 'has a submission row' ===");
	{
		const fromQueued = advancingConvIds([QUEUED_SUB]);
		check("a NEVER-STARTED (`queued`) submission is NOT advancing", fromQueued.size === 0, JSON.stringify([...fromQueued]));
		const fromPlaced = advancingConvIds([PLACED_SUB]);
		check("a `placed` submission IS advancing", fromPlaced.has(42), JSON.stringify([...fromPlaced]));
		const mixed = advancingConvIds([QUEUED_SUB, { id: 9, conversationId: 7, status: "placed" }]);
		check("the two classes are distinguished in one batch", !mixed.has(42) && mixed.has(7), JSON.stringify([...mixed]));
		const settled = advancingConvIds([PLACED_SUB], { settled: new Set([181516]) });
		check("an already-settled id does not count", settled.size === 0, JSON.stringify([...settled]));
	}

	console.log("\n=== AND THE SEAT IS WAKEABLE AGAIN (the end of the starvation) ===");
	{
		const pending = advancingConvIds([QUEUED_SUB]);
		const wakes = selectWakes({ seats: SEATS, items: ITEMS, pendingConvIds: pending });
		check("a seat whose only submission never started IS woken", wakes.length === 1, JSON.stringify(wakes));
		check("...and it is the starved seat", wakes[0]?.name === "designer", JSON.stringify(wakes[0]));

		// The control: while the submission really IS advancing, the seat stays suppressed — the fix must
		// not remove suppression for the case it exists for.
		const busy = selectWakes({ seats: SEATS, items: ITEMS, pendingConvIds: advancingConvIds([PLACED_SUB]) });
		check("CONTROL: a genuinely advancing seat is still suppressed", busy.length === 0, JSON.stringify(busy));
	}

	console.log("\n=== THE OTHER TWO SUPPRESSORS ARE UNTOUCHED ===");
	{
		const pending = advancingConvIds([QUEUED_SUB]);
		check("busySeats still suppresses", selectWakes({ seats: SEATS, items: ITEMS, pendingConvIds: pending, busySeats: new Set(["designer"]) }).length === 0);
		// MEASURED, and it corrects an assumption rather than the code: `stoppedConvIds` gates a STALLED
		// CLAIM, not queued work — a stop applies to a run that was stopped, so a seat with only queued
		// items is still woken. That is existing behaviour and this change does not touch it; asserting
		// the queued case would have failed on main too.
		check(
			"stoppedConvIds still suppresses a STALLED CLAIM",
			selectWakes({ seats: SEATS, items: [{ id: 1, to: "designer", status: "claimed" }], pendingConvIds: pending, stoppedConvIds: new Set([42]) }).length === 0,
		);
		check(
			"...and does NOT gate queued work (existing behaviour, unchanged here)",
			selectWakes({ seats: SEATS, items: ITEMS, pendingConvIds: pending, stoppedConvIds: new Set([42]) }).length === 1,
		);
		check("a paused rig still wakes nobody", selectWakes({ seats: SEATS, items: ITEMS, pendingConvIds: pending, paused: true }).length === 0);
	}

	console.log("\n=== WHAT IS STILL OPEN, named rather than implied ===");
	console.log("  The reconciler settles STRANDED (`placed` with no advancing task) rows only — a `queued` row");
	console.log("  is invisible to it, so the stale row itself is NOT settled by this change. Settling it needs");
	console.log("  an ADMISSION DEADLINE (ROADMAP 37(c)): without one, a submission that is legitimately still");
	console.log("  being admitted would be cancelled by the next pass. The suppression half is fixed; the");
	console.log("  settlement half is why `resume`'s message was corrected rather than left promising it.");

	console.log(
		failures === 0
			? "\nPASS — 'advancing' now means a started submission: a never-started row no longer starves its seat, and a genuinely advancing one is still suppressed"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
