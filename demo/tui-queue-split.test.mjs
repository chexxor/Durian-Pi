// demo/tui-queue-split.test.mjs — #4812 (the F3 rider): the landing screen's per-seat queue
// SIZE and the roster row's own queue column must come from ONE split rule, and this demo
// proves it by MUTATING the rule rather than by printing equal numbers on a quiet fixture.
//
// WHY A MUTATION AND NOT AN EQUALITY. "Shares a derivation" is a claim about a DATA PATH, and
// a claim checked only on the consumers you looked at is a sample, not a construction: CR-A on
// this campaign found `role`, `stream` and `says` sanitized while `focus` was raw IN THE SAME
// FILE. A renderer that re-adds its own poles prints the same number as the shared rule on any
// fixture where the rule is untouched — so equal numbers on a quiet fixture prove nothing. The
// only observable difference is what happens when the rule MOVES: every surface that reads it
// moves together, and a surface that bypasses it does not.
//
// THREE SURFACES, ONE RULE:
//   (A) the landing screen's SIZE  — `queue.total` from `projectLanding` (src/readapi.mjs);
//   (B) the ROW as painted         — the `Nq · Mp` column in the roster line, parsed out of a
//                                   real rendered frame, not out of the data structure;
//   (C) the STATUS BAR             — rig-wide `queue: N · parked M`, also parsed out of the frame.
// The bar is asserted against the SUM of the painted rows, so the rig-wide number is checked
// against what the screen actually shows rather than against a second call to the same function.
//
// NEGATIVE CONTROL (the part that makes the demo able to fail): after the rule is moved, what a
// consumer that hand-rolled `queued + claimed` would print is compared against the number the
// row actually paints, and the demo asserts they DISAGREE. On the untouched fixture they agree —
// that is exactly why the mutation is load-bearing.
//
// Run: node demo/tui-queue-split.test.mjs  (exit 0 = pass)

import { ACTIVE_QUEUE_STATUSES, PARKED_QUEUE_STATUSES, projectLanding, queueSplit } from "../src/readapi.mjs";
import { frameToLines, renderTui } from "../src/tui/client.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// impl: 2 active (queued, claimed) + 1 parked (deferred) + 1 terminal (done)
// qa  : 1 active (queued)    + 1 parked (held)    + 1 terminal (cancelled)
const SEATS = [
	{ name: "impl", role: "implementation engineer" },
	{ name: "qa", role: "verifier" },
];
const QUEUE = [
	{ id: 1, from: "pm", to: "impl", subject: "split rule", status: "queued" },
	{ id: 2, from: "pm", to: "impl", subject: "landing size", status: "claimed" },
	{ id: 3, from: "pm", to: "impl", subject: "question parked on pm", status: "deferred", deferredTo: "pm" },
	{ id: 4, from: "pm", to: "qa", subject: "gate held", status: "held" },
	{ id: 5, from: "pm", to: "qa", subject: "verify the rider", status: "queued" },
	{ id: 6, from: "pm", to: "impl", subject: "already finished", status: "done" },
	{ id: 7, from: "pm", to: "qa", subject: "never started", status: "cancelled" },
];
const HEALTH = { seats: SEATS, queueItems: QUEUE, uptime: 3600, attention: [] };

/** Read the three surfaces at the current state of the rule. B and C come out of a PAINTED frame. */
function surfaces() {
	const landing = projectLanding(HEALTH).seats;
	const lines = frameToLines(
		renderTui({ seats: SEATS, health: HEALTH, queueItems: QUEUE, selectedSeat: "impl", view: "seats", width: 100, height: 24 }),
	);
	const painted = {};
	for (const seat of SEATS) {
		const line = lines.find((l) => l.includes(seat.name) && /\d+q/.test(l));
		const m = line ? /(\d+)q(?: · (\d+)p)?/.exec(line) : null;
		painted[seat.name] = m ? { active: Number(m[1]), parked: m[2] === undefined ? 0 : Number(m[2]) } : null;
	}
	const barLine = lines.find((l) => l.includes("seats:")) ?? "";
	const bm = /queue: (\d+)(?: · parked (\d+))?/.exec(barLine);
	const bar = bm ? { active: Number(bm[1]), parked: bm[2] === undefined ? 0 : Number(bm[2]) } : null;
	return { landing, painted, bar, barLine };
}

/** The agreement the rider demands: SIZE == what the row shows, and the bar == the sum of the rows. */
function agree(label, { landing, painted, bar, barLine }) {
	let all = true;
	for (const row of landing) {
		const shown = painted[row.name];
		if (!shown) {
			check(`${label}: the row for ${row.name} is painted at all`, false, barLine);
			all = false;
			continue;
		}
		const ok =
			row.queue.total === shown.active + shown.parked &&
			row.queue.active === shown.active &&
			row.queue.parked === shown.parked;
		check(
			`${label}: ${row.name} size ${row.queue.total} equals the painted ${shown.active}q${shown.parked ? ` · ${shown.parked}p` : ""}`,
			ok,
			JSON.stringify(row.queue),
		);
		all = all && ok;
	}
	const sumActive = landing.reduce((n, row) => n + row.queue.active, 0);
	const sumParked = landing.reduce((n, row) => n + row.queue.parked, 0);
	check(
		`${label}: the status bar (${barLine.trim()}) equals the sum of the painted rows`,
		bar !== null && bar.active === sumActive && bar.parked === sumParked,
		`rows sum to ${sumActive} active / ${sumParked} parked`,
	);
	return all && bar !== null && bar.active === sumActive && bar.parked === sumParked;
}

/** Snapshot the rule, run fn, put the rule back exactly as it was. */
function withRule(mutate, fn) {
	const activeWas = ACTIVE_QUEUE_STATUSES.slice();
	const parkedWas = PARKED_QUEUE_STATUSES.slice();
	try {
		mutate();
		return fn();
	} finally {
		ACTIVE_QUEUE_STATUSES.length = 0;
		ACTIVE_QUEUE_STATUSES.push(...activeWas);
		PARKED_QUEUE_STATUSES.length = 0;
		PARKED_QUEUE_STATUSES.push(...parkedWas);
	}
}

try {
	console.log("\n=== the rule as written ===");
	check("the rule's poles are the two named sets", ACTIVE_QUEUE_STATUSES.join(",") === "queued,claimed" && PARKED_QUEUE_STATUSES.join(",") === "deferred,held");
	check("terminal statuses are outside the rule", !ACTIVE_QUEUE_STATUSES.includes("done") && !PARKED_QUEUE_STATUSES.includes("cancelled"));

	console.log("\n=== baseline: the three surfaces agree (the quiet fixture) ===");
	const base = surfaces();
	agree("baseline", base);
	check("baseline impl paints 2q · 1p", base.painted.impl.active === 2 && base.painted.impl.parked === 1, JSON.stringify(base.painted.impl));
	check("baseline qa paints 1q · 1p", base.painted.qa.active === 1 && base.painted.qa.parked === 1, JSON.stringify(base.painted.qa));
	check("baseline bar reads queue: 3 · parked 2 (the two terminal items are NOT counted)", base.bar.active === 3 && base.bar.parked === 2, base.barLine.trim());

	console.log("\n=== MUTATION 1: move `deferred` from the parked pole to the active pole ===");
	const moved = withRule(
		() => {
			PARKED_QUEUE_STATUSES.splice(PARKED_QUEUE_STATUSES.indexOf("deferred"), 1);
			ACTIVE_QUEUE_STATUSES.push("deferred");
		},
		surfaces,
	);
	// Both surfaces must move by the SAME amount, in the SAME direction.
	check("impl's painted queue moves 2q -> 3q and its parked pole empties", moved.painted.impl.active === 3 && moved.painted.impl.parked === 0, JSON.stringify(moved.painted.impl));
	check("the bar moves with it: queue 3 -> 4, parked 2 -> 1", moved.bar.active === 4 && moved.bar.parked === 1, moved.barLine.trim());
	check("and the two still agree", agree("after the pole swap", moved));
	check("total did not silently change on the row it moved within", moved.landing.find((r) => r.name === "impl").queue.total === 3, JSON.stringify(moved.landing.find((r) => r.name === "impl").queue));

	// NEGATIVE CONTROL: the equality is not vacuous. A consumer that bypasses the rule and adds
	// its own poles prints the OLD number on this fixture while the row paints the NEW one.
	const bypassing = QUEUE.filter((it) => it.to === "impl").reduce((n, it) => n + (it.status === "queued" || it.status === "claimed" ? 1 : 0), 0);
	check("a hand-rolled `queued + claimed` DISAGREES with what the row paints (2 vs 3) — the demo can tell a bypass from a shared rule", bypassing === 2 && bypassing !== moved.painted.impl.active, `${bypassing} vs ${moved.painted.impl.active}`);

	console.log("\n=== MUTATION 2: take `held` out of the rule entirely ===");
	const uncounted = withRule(
		() => PARKED_QUEUE_STATUSES.splice(PARKED_QUEUE_STATUSES.indexOf("held"), 1),
		surfaces,
	);
	const qaWas = base.landing.find((r) => r.name === "qa").queue.total;
	const qaNow = uncounted.landing.find((r) => r.name === "qa").queue.total;
	check("the landing SIZE drops by the row the rule stopped counting", qaNow === qaWas - 1, `${qaWas} -> ${qaNow}`);
	check("the painted row drops with it", uncounted.painted.qa.active + uncounted.painted.qa.parked === qaNow, JSON.stringify(uncounted.painted.qa));
	check("the bar drops by the same one", base.bar.active + base.bar.parked - (uncounted.bar.active + uncounted.bar.parked) === 1, `${base.barLine.trim()} -> ${uncounted.barLine.trim()}`);
	check("and the three surfaces still agree", agree("after dropping a status", uncounted));

	console.log("\n=== the rule is restored ===");
	const after = surfaces();
	check("ACTIVE_QUEUE_STATUSES is exactly as it was found", ACTIVE_QUEUE_STATUSES.join(",") === "queued,claimed", ACTIVE_QUEUE_STATUSES.join(","));
	check("PARKED_QUEUE_STATUSES is exactly as it was found", PARKED_QUEUE_STATUSES.join(",") === "deferred,held", PARKED_QUEUE_STATUSES.join(","));
	check("the numbers are back to the baseline", after.bar.active === 3 && after.bar.parked === 2 && agree("restored", after));
	check("queueSplit() itself follows the rule", queueSplit(QUEUE).active === 3 && queueSplit(QUEUE).parked === 2, JSON.stringify(queueSplit(QUEUE)));

	console.log(
		failures === 0
			? "\nQUEUE SPLIT PASS (one rule, three surfaces, and the mutation that proves the sharing)"
			: `\nQUEUE SPLIT FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
