// demo/pool-gated-reason.test.mjs — N19 "The Pool": the SKIP line must NAME the pool row and the reason, not
// just count them.
//
// WHY THIS DEMO EXISTS (measured, not imagined). On 2026-11-13 the live broker printed, on five seats, on every
// pass, for hours: `SKIP auditor reason=pool-gated:1`. The pool was one row deep — #7660, `requires: "docs"`, a
// capability NO seat advertises — and nothing in the log said which row or why. `cli.mjs check rig.selfdev.json`
// could say it, but only if someone thought to run it; the log is what a session reads first.
//
// The same line is the ONLY place an oversized pool row can surface without a claim: `selectWakes` pre-filters
// through `workable()`, so a row the seat cannot take is skipped rather than attempted, and `size-refused` is
// written only on a NAMED claim (D275 addendum (c)) — so before this change the 70 % gate could refuse every seat
// on the rig and leave no trace but a number.
//
// FAILING-FIRST: on HEAD the reason is `pool-gated:<n>` with no id and no reason, so every assertion below fails.
//
// Run: node demo/pool-gated-reason.test.mjs   (exit 0 = pass)
// Cost: pure functions, no store, no model, no network — measured 0.05 s.
import { poolGatedSkipLine, selectWakes } from "../src/driver.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

console.log("\n=== the line names the row and its reason ===");
check("no gated pool row -> no segment at all (the queue-gated/unrelated reasons are untouched)", poolGatedSkipLine([]) === "");
check(
	"one gated row prints its id and its reason",
	poolGatedSkipLine([{ id: 7660, reason: "requires:docs" }]) === "pool-gated:1 #7660(requires:docs)",
	poolGatedSkipLine([{ id: 7660, reason: "requires:docs" }]),
);
check(
	"the count stays FIRST, so existing readers that parse `pool-gated:<n>` still work",
	poolGatedSkipLine([{ id: 1, reason: "a" }, { id: 2, reason: "b" }]).startsWith("pool-gated:2 "),
	poolGatedSkipLine([{ id: 1, reason: "a" }, { id: 2, reason: "b" }]),
);
check(
	"two rows are both named",
	poolGatedSkipLine([{ id: 11, reason: "requires:docs" }, { id: 12, reason: "gate-open:#9(queued)" }]) ===
		"pool-gated:2 #11(requires:docs),#12(gate-open:#9(queued))",
	poolGatedSkipLine([{ id: 11, reason: "requires:docs" }, { id: 12, reason: "gate-open:#9(queued)" }]),
);

console.log("\n=== and stays BOUNDED: a fleet-sized pool must not write hundreds of ids in one log line ===");
const many = Array.from({ length: 40 }, (_, i) => ({ id: 1000 + i, reason: "requires:docs" }));
const manyLine = poolGatedSkipLine(many);
check("40 gated rows -> 2 named + `+38 more`", manyLine.startsWith("pool-gated:40 ") && manyLine.endsWith("+38 more"), manyLine);
check("the line is short enough for a log", manyLine.length < 220, `${manyLine.length} chars`);
check("the default bound names at most 2 rows", (manyLine.match(/#\d+\(/g) ?? []).length === 2, manyLine);
const longReason = `too-big:project(${120000} tokens > 70% of the 164320-token usable window)`;
const clipped = poolGatedSkipLine([{ id: 7, reason: longReason }], { reasonChars: 40 });
check("a long reason is clipped with an ellipsis, not dropped", clipped.includes("too-big:project(") && clipped.includes("…") && clipped.length < 80, clipped);
check("`named: 1` narrows the id list", (poolGatedSkipLine(many, { named: 1 }).match(/#\d+\(/g) ?? []).length === 1, poolGatedSkipLine(many, { named: 1 }));

console.log("\n=== selectWakes: the oversized project row is named, per seat, with ITS window ===");
const tierTokens = { trivial: 3400, small: 6100, feature: 6200, project: 120000 };
const seats = {
	impl: { conversationId: 1, capabilities: ["implement", "code"], usableWindow: 164320 },
	auditor: { conversationId: 2, capabilities: ["verify"], usableWindow: 12288 },
};
const items = [
	// Refused for impl by SIZE and for the auditor by CAPABILITY.
	{ id: 5001, to: null, pool: true, status: "queued", tier: "project", requires: ["implement"] },
	// Refused for the auditor by SIZE (its own capability, so nothing else can refuse it).
	{ id: 5002, to: null, pool: true, status: "queued", tier: "project", requires: ["verify"] },
];
const skips = [];
const wakes = selectWakes({ seats, items, tierTokens, onSkip: (s) => skips.push(s) });
const implSkip = skips.find((s) => s.seat === "impl");
const auditorSkip = skips.find((s) => s.seat === "auditor");
check("no seat wakes for a row it cannot claim", wakes.length === 0, JSON.stringify(wakes));
check("impl's line names #5001 with the too-big reason and impl's own window", /#5001\(too-big:project\(120000 tokens > 70% of the 164320-token usable window\)\)/.test(implSkip?.reason ?? ""), implSkip?.reason);
check("the auditor's line names #5002 with the 12288-token window", /#5002\(too-big:project\(120000 tokens > 70% of the 12288-token usable window\)\)/.test(auditorSkip?.reason ?? ""), auditorSkip?.reason);
check("the auditor's #5001 refusal is the CAPABILITY gate, and it is named too", /#5001\(requires:implement\)/.test(auditorSkip?.reason ?? ""), auditorSkip?.reason);
check("the count agrees with the number of named-plus-summed rows", (implSkip?.reason ?? "").includes("pool-gated:2 "), implSkip?.reason);

console.log("\n=== no regression: a claimable pool row still wakes its seat and writes NO pool-gated line ===");
const small = [{ id: 5003, to: null, pool: true, status: "queued", tier: "small", requires: ["implement"] }];
const skips2 = [];
const wakes2 = selectWakes({ seats, items: small, tierTokens, onSkip: (s) => skips2.push(s) });
check("impl wakes for it", wakes2.some((w) => w.name === "impl" && w.reason === "queued"), JSON.stringify(wakes2));
check("...and no skip line claims a pool gate", !skips2.some((s) => (s.reason ?? "").includes("pool-gated:")) || !skips2.some((s) => s.seat === "impl"), JSON.stringify(skips2));

console.log(failures === 0 ? "\nPOOL-GATED REASON PASS (rows and reasons named, bounded, no wake regression)" : `\nPOOL-GATED REASON FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
