// demo/wake-suppression-trace.test.mjs — WHY a seat was skipped, with the AGE (#4171)
//
// THE GAP: nothing recorded why a candidate seat was skipped, so a seat skipped for 2 seconds and a seat
// skipped for 10 HOURS looked identical in the log. Every artefact existed — `.broker.json` gave the
// liveness-versus-progress discriminator, `.broker.log` gave the pass sequence, `cli.mjs status` named
// `admitted_not_started` with the age — and NONE of it joined "the seat was skipped" to "why".
//
// THE AGE IS THE LOAD-BEARING FIELD. That is the assertion below that matters: the same skip reason
// produces two very different lines depending on the age, and only the age tells an operator whether to
// wait or to act.
//
// Run: node demo/wake-suppression-trace.test.mjs   (exit 0 = pass)

import { selectWakes } from "../src/driver.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const SEATS = {
	designer: { conversationId: 42 },
	impl: { conversationId: 7 },
	idle: { conversationId: 99 },
};
const collect = () => {
	const skips = [];
	const wakes = [];
	return { skips, wakes, onSkip: (e) => skips.push(e), sink: (w) => wakes.push(w) };
};

try {
	console.log("\n=== EVERY SKIP NAMES ITS SEAT AND ITS REASON ===");
	{
		const t = collect();
		selectWakes({
			seats: SEATS,
			items: [
				{ id: 1, to: "designer", status: "queued" },
				{ id: 2, to: "impl", status: "queued" },
			],
			pendingConvIds: new Set([42]),
			busySeats: new Set(["impl"]),
			onSkip: t.onSkip,
		});
		const bySeat = Object.fromEntries(t.skips.map((s) => [s.seat, s]));
		check("a pending seat is reported", bySeat.designer?.reason === "pending", JSON.stringify(bySeat.designer));
		check("a busy seat is reported", bySeat.impl?.reason === "busy", JSON.stringify(bySeat.impl));
		check("a seat with no work is reported too", bySeat.idle?.reason === "no-work", JSON.stringify(bySeat.idle));
		check("EVERY candidate is accounted for, not only the interesting ones", t.skips.length === 3, JSON.stringify(t.skips.map((s) => s.seat)));
	}

	console.log("\n=== THE AGE IS THE FIELD THAT DISTINGUISHES A WAIT FROM AN OUTAGE ===");
	{
		// The same reason, two ages: 2 seconds is normal, 10 hours is the outage.
		const fresh = collect();
		selectWakes({
			seats: SEATS,
			items: [{ id: 1, to: "designer", status: "queued" }],
			pendingConvIds: new Set([42]),
			onSkip: fresh.onSkip,
			pendingAgeMs: () => 2_000,
		});
		const stale = collect();
		selectWakes({
			seats: SEATS,
			items: [{ id: 1, to: "designer", status: "queued" }],
			pendingConvIds: new Set([42]),
			onSkip: stale.onSkip,
			pendingAgeMs: () => 36_000_000,
		});
		check("the fresh skip carries its age", fresh.skips[0]?.ageMs === 2_000, JSON.stringify(fresh.skips[0]));
		check("the stale skip carries ITS age", stale.skips[0]?.ageMs === 36_000_000, JSON.stringify(stale.skips[0]));
		check(
			"the two are DISTINGUISHABLE from the trace alone (the whole point)",
			fresh.skips[0]?.ageMs !== stale.skips[0]?.ageMs,
			`${fresh.skips[0]?.ageMs} vs ${stale.skips[0]?.ageMs}`,
		);
		check("the skip names WHICH conversation was pending", fresh.skips[0]?.conversationId === 42, JSON.stringify(fresh.skips[0]));
	}

	console.log("\n=== AND IT DOES NOT CHANGE THE DECISION IT REPORTS ===");
	{
		const withTrace = collect();
		const wakesWith = selectWakes({
			seats: SEATS,
			items: [{ id: 1, to: "impl", status: "queued" }],
			onSkip: withTrace.onSkip,
		});
		const wakesWithout = selectWakes({ seats: SEATS, items: [{ id: 1, to: "impl", status: "queued" }] });
		check("the wakes are identical with and without the trace", JSON.stringify(wakesWith) === JSON.stringify(wakesWithout), JSON.stringify(wakesWith));
		check("the trace is OPTIONAL — omitting onSkip does not throw", wakesWithout.length === 1);
		check("a woken seat is NOT reported as skipped", !withTrace.skips.some((s) => s.seat === "impl"), JSON.stringify(withTrace.skips));
	}

	console.log("\n=== WHAT IS STILL OPEN, named rather than implied ===");
	console.log("  The trace is EMITTED here (selectWakes calls onSkip once per skipped candidate per pass).");
	console.log("  The BROKER does not yet pass an onSkip that writes the line to .broker.log, and the AGE");
	console.log("  needs the submission rows the caller holds — `pendingAgeMs` is the seam for it. Until that");
console.log("  wiring lands the trace is available to any caller and visible to no operator.");

	console.log(
		failures === 0
			? "\nPASS — every skipped candidate reports its seat and reason, the pending reason carries the age that separates a wait from an outage, and the decision is unchanged"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
