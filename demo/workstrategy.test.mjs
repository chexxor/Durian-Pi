// demo/workstrategy.test.mjs — priority-first ordering + the configurable work strategy.
//
// THE DEFECT this closes: `claim_work` with no itemId always took the OLDEST workable row. A coordinator
// could name an item by id (`claim_work(itemId: …)`) but could not move work UP a seat's queue, so an
// urgent row sat behind a backlog and the only lever was to hold the newer rows one at a time. Measured
// on this rig: impl's oldest workable was #6193 with a ~194-row MVP tranche ahead of it, at a 66.2
// rows/day drain (14-day mean) — 2 to 7 days of latency for work that had already been decided.
//
// THE CONTRACT:
//   1. `oldest_first` (the default) is EXACTLY the old behaviour: ascending id, first workable wins.
//   2. `priority_first` orders (rank(priority ?? "next"), id) — an unprioritised backlog does NOT reshuffle.
//   3. An unknown strategy name REFUSES and names the valid set. Never a silent fallback (#5071).
//   4. A priority is a LEASE: it needs a reason and an expiry, at most 30 days, and it LAPSES at read
//      time — the `hold` pathology (197 rows parked at a median 564.9 h) must not be re-created here.
//   5. Resolving a strategy reports its SOURCE (seat > team > default) so a reader can answer "why is my
//      queue in this order" without opening a config file.
//
// FAILING-FIRST: on main `src/workstrategy.mjs` does not exist, so the import below cannot resolve.
//
// Run: node demo/workstrategy.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import {
	DEFAULT_STRATEGY,
	MAX_PRIORITY_LEASE_MS,
	PRIORITY_VALUES,
	WORK_STRATEGIES,
	effectivePriority,
	isWorkStrategy,
	orderCandidates,
	resolveStrategy,
	strategyNames,
	validatePriorityRequest,
} from "../src/workstrategy.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

/** A queue row: only the fields ordering reads are interesting; the rest is what a real row carries. */
const row = (id, over = {}) => ({ id, from: "pm", to: "impl", status: "queued", subject: `work ${id}`, transitions: [], ...over });
const NOW = Date.parse("2026-11-12T12:00:00Z");
const lease = (ms) => new Date(NOW + ms).toISOString();

try {
	console.log("\n=== the table: two strategies, a closed vocabulary, a stable default ===");
	check("the default strategy is oldest_first (an unconfigured rig is unchanged)", DEFAULT_STRATEGY === "oldest_first");
	check("the table has exactly the two documented strategies", JSON.stringify(strategyNames()) === JSON.stringify(["oldest_first", "priority_first"]), JSON.stringify(strategyNames()));
	check("each table entry names itself and explains its order", strategyNames().every((n) => WORK_STRATEGIES[n].name === n && WORK_STRATEGIES[n].order.length > 10));
	check("priority vocabulary is now/next/later", JSON.stringify(PRIORITY_VALUES) === JSON.stringify(["now", "next", "later"]), JSON.stringify(PRIORITY_VALUES));
	check("isWorkStrategy accepts a known name", isWorkStrategy("priority_first") === true);
	check("isWorkStrategy rejects an unknown name", isWorkStrategy("urgency_first") === false);
	check("isWorkStrategy rejects a non-string", isWorkStrategy(null) === false && isWorkStrategy(3) === false);

	console.log("\n=== an unknown strategy REFUSES and names the valid set ===");
	let refusal = null;
	try {
		orderCandidates([], { strategy: "urgency_first" });
	} catch (err) {
		refusal = err.message;
	}
	check("orderCandidates throws rather than silently ordering oldest-first", typeof refusal === "string", String(refusal));
	check("...and the message names the offending value", /urgency_first/.test(refusal ?? ""), refusal);
	check("...and lists every valid strategy", (refusal ?? "").includes("oldest_first") && (refusal ?? "").includes("priority_first"), refusal);
	check("...and says why silent fallback is wrong", /silently/.test(refusal ?? ""), refusal);

	console.log("\n=== oldest_first IS the old behaviour: ascending id ===");
	const scrambled = [row(30), row(10), row(20)];
	const oldest = orderCandidates(scrambled, { strategy: "oldest_first" });
	check("the oldest strategy sorts ascending id", JSON.stringify(oldest.map((r) => r.id)) === JSON.stringify([10, 20, 30]), JSON.stringify(oldest.map((r) => r.id)));
	check("...even when the array arrived out of order", JSON.stringify(scrambled.map((r) => r.id)) === JSON.stringify([30, 10, 20]), "input was mutated");

	console.log("\n=== priority_first: now < next < later < id ===");
	const mixed = [
		row(41, { priority: "later", prioritySet: { by: "pm", reason: "after the gate", expiresAt: lease(86400000) } }),
		row(42, { priority: "now", prioritySet: { by: "pm", reason: "operator critical path", expiresAt: lease(86400000) } }),
		row(43), // no priority at all
		row(44, { priority: "next", prioritySet: { by: "pm", reason: "neutral", expiresAt: lease(86400000) } }),
		row(40, { priority: "now", prioritySet: { by: "pm", reason: "another urgent row", expiresAt: lease(86400000) } }),
	];
	const byPriority = orderCandidates(mixed, { strategy: "priority_first", now: NOW });
	check("now rows come first, then the neutral rows, then later", JSON.stringify(byPriority.map((r) => r.id)) === JSON.stringify([40, 42, 43, 44, 41]), JSON.stringify(byPriority.map((r) => r.id)));
	check("an UNPRIORITISED row ties at next (no backlog reshuffle just by opting in)", byPriority[2].id === 43);
	check("the input array is not mutated", JSON.stringify(mixed.map((r) => r.id)) === JSON.stringify([41, 42, 43, 44, 40]), JSON.stringify(mixed.map((r) => r.id)));
	check("the returned array is a NEW array", byPriority !== mixed);

	console.log("\n=== on an unprioritised queue, priority_first === oldest_first ===");
	const plain = [row(50), row(51), row(52)];
	check(
		"no priority anywhere means no reordering",
		JSON.stringify(orderCandidates(plain, { strategy: "priority_first", now: NOW }).map((r) => r.id)) ===
			JSON.stringify(orderCandidates(plain, { strategy: "oldest_first" }).map((r) => r.id)),
	);

	console.log("\n=== the LEASE lapses at read time ===");
	const lapsed = row(60, { priority: "now", prioritySet: { by: "pm", reason: "urgent then", expiresAt: lease(-1000) } });
	const eff = effectivePriority(lapsed, NOW);
	check("a lapsed priority ranks neutral", eff.rank === 1 && eff.priority === "next", JSON.stringify(eff));
	check("...and says it lapsed, with the expiry it lapsed at", eff.lapsed === true && eff.expiresAt === lease(-1000), JSON.stringify(eff));
	check("...while the row's own field is still readable (history, not policy)", eff.raw === "now");
	check(
		"ordering treats a lapsed `now` as neutral, so it does NOT jump the queue",
		orderCandidates([row(61), lapsed], { strategy: "priority_first", now: NOW }).map((r) => r.id).join(",") === "60,61",
		JSON.stringify(orderCandidates([row(61), lapsed], { strategy: "priority_first", now: NOW }).map((r) => r.id)),
	);
	const live = effectivePriority(row(62, { priority: "now", prioritySet: { by: "pm", reason: "live", expiresAt: lease(1000) } }), NOW);
	check("a live lease keeps its rank", live.rank === 0 && live.lapsed === false, JSON.stringify(live));
	const noLease = effectivePriority(row(63, { priority: "now" }), NOW);
	check("a priority with NO lease does not lapse (it predates set_priority, and set_priority always writes one)", noLease.rank === 0 && noLease.lapsed === false);
	const corrupt = effectivePriority(row(64, { priority: "urgent" }), NOW);
	check("an out-of-vocabulary stored value is FLAGGED, not silently promoted", corrupt.invalid === true && corrupt.rank === 1, JSON.stringify(corrupt));

	console.log("\n=== resolveStrategy: seat > team > default, and it names the source ===");
	check("seat wins when all three are set", resolveStrategy({ seatStrategy: "priority_first", teamStrategy: "oldest_first", defaultStrategy: "oldest_first" }).source === "seat");
	check("...and the strategy it returns is the seat's", resolveStrategy({ seatStrategy: "priority_first", teamStrategy: "oldest_first", defaultStrategy: "oldest_first" }).strategy === "priority_first");
	check("team wins when the seat sets nothing", resolveStrategy({ teamStrategy: "priority_first", defaultStrategy: "oldest_first" }).strategy === "priority_first");
	check("...with source=team", resolveStrategy({ teamStrategy: "priority_first", defaultStrategy: "oldest_first" }).source === "team");
	check("the default applies when neither is set", resolveStrategy({}).strategy === DEFAULT_STRATEGY && resolveStrategy({}).source === "default");
	check(
		"an empty/whitespace value counts as ABSENT, not as a strategy named ''",
		resolveStrategy({ seatStrategy: "", teamStrategy: "   " }).source === "default",
		JSON.stringify(resolveStrategy({ seatStrategy: "", teamStrategy: "   " })),
	);
	let resolveRefusal = null;
	try {
		resolveStrategy({ seatStrategy: "fastest_first" });
	} catch (err) {
		resolveRefusal = err.message;
	}
	check("an unknown SEAT strategy refuses (not silently defaulted)", /fastest_first/.test(resolveRefusal ?? ""), String(resolveRefusal));
	check("...and the refusal names where the bad value came from", /seat workStrategy/.test(resolveRefusal ?? ""), resolveRefusal);

	console.log("\n=== validatePriorityRequest: reason AND expiry are REQUIRED ===");
	const good = validatePriorityRequest({ priority: "now", reason: "operator critical path", expiresAt: lease(3600000) }, NOW);
	check("a complete request is accepted", good.ok === true, JSON.stringify(good));
	check("...and normalized to an ISO instant", good.ok && good.value.expiresAt === lease(3600000), JSON.stringify(good));
	check("...with the reason trimmed", good.ok && good.value.reason === "operator critical path");

	const noReason = validatePriorityRequest({ priority: "now", expiresAt: lease(3600000) }, NOW);
	check("no reason is REFUSED", noReason.ok === false && /reason/.test(noReason.error), JSON.stringify(noReason));
	const blankReason = validatePriorityRequest({ priority: "now", reason: "   ", expiresAt: lease(3600000) }, NOW);
	check("a blank reason is REFUSED", blankReason.ok === false, JSON.stringify(blankReason));
	const noExpiry = validatePriorityRequest({ priority: "now", reason: "why" }, NOW);
	check("no expiry is REFUSED (no second unbounded park)", noExpiry.ok === false && /expiresAt/.test(noExpiry.error), JSON.stringify(noExpiry));
	const pastExpiry = validatePriorityRequest({ priority: "now", reason: "why", expiresAt: lease(-1000) }, NOW);
	check("an expiry in the PAST is REFUSED (a no-op dressed as an action)", pastExpiry.ok === false && /past/.test(pastExpiry.error), JSON.stringify(pastExpiry));
	const tooLong = validatePriorityRequest({ priority: "now", reason: "why", expiresAt: lease(MAX_PRIORITY_LEASE_MS + 1000) }, NOW);
	check("an expiry beyond the 30-day cap is REFUSED", tooLong.ok === false && /30 days/.test(tooLong.error), JSON.stringify(tooLong));
	const atCap = validatePriorityRequest({ priority: "now", reason: "why", expiresAt: lease(MAX_PRIORITY_LEASE_MS) }, NOW);
	check("...and exactly 30 days is accepted (the cap is inclusive)", atCap.ok === true, JSON.stringify(atCap));
	const badValue = validatePriorityRequest({ priority: "urgent", reason: "why", expiresAt: lease(3600000) }, NOW);
	check("an out-of-vocabulary priority is REFUSED by name", badValue.ok === false && /urgent/.test(badValue.error) && /now, next, later/.test(badValue.error), JSON.stringify(badValue));

	console.log("\n=== ordering is TOTAL: equal priorities fall back to id, so two reads agree ===");
	const ties = [row(72, { priority: "now" }), row(70, { priority: "now" }), row(71, { priority: "now" })];
	const first = orderCandidates(ties, { strategy: "priority_first", now: NOW }).map((r) => r.id);
	const second = orderCandidates([...ties].reverse(), { strategy: "priority_first", now: NOW }).map((r) => r.id);
	check("three `now` rows order by id regardless of arrival order", first.join(",") === "70,71,72", first.join(","));
	check("...so a reversed input yields the SAME order (no position lottery)", second.join(",") === first.join(","), second.join(","));

	assert.ok(true);
	console.log(
		failures === 0
			? "\nWORK STRATEGY PASS (default unchanged, priority_first total and lease-bounded, unknown names refused, source reported)"
			: `\nWORK STRATEGY FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.stack ?? err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
