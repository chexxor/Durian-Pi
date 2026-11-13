// demo/pool-size-gate.test.mjs — N19 "The Pool" row 5 per docs/POOL-QUEUE-SPEC.md §6.2-§6.3.
//
// WHAT WAS MISSING BEFORE: a seat could claim a `project` row with a 24,576-token window and die halfway
// through it. The claim path knew the seat's CAPABILITIES but not its BUDGET, so "too big for this seat" was
// invisible until the run ran out of context.
//
// THIS DEMO IS A PURE-FUNCTION PROBE — no harness, no store, no model, no network. It pins the four things the
// gate must never get wrong:
//   1. a `project` row IS refused for a verifier-class seat, and the refusal carries the split instruction;
//   2. a `trivial` row is NOT refused, so the gate does not starve ordinary work;
//   3. when the compaction settings leave usable <= 0 (pi-durable's defaults exceed a 24,576 window), the
//      gate REPORTS "no usable budget declared" and never divides by it;
//   4. an undeclared window and an untiered row are NOT measurements — they do not refuse anything.
//
// Run: node demo/pool-size-gate.test.mjs   (exit 0 = pass)
// Cost: measured 0.1 s, no store, no network.
import assert from "node:assert/strict";

import { DEFAULT_TIER_TOKENS, tierTokenTable, usableContextBudget } from "../src/config.mjs";
import {
	POOL_SIZE_GATE_FRACTION,
	RATCHET_TIERS,
	seatSizeBudget,
	sizeVerdict,
	splitInstruction,
	workable,
} from "../src/rig.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
}

console.log("\n=== the tier table's names are the rig's tiers, not a second vocabulary ===");
check(
	"DEFAULT_TIER_TOKENS keys == RATCHET_TIERS (a table keyed by a tier no row can have is inert)",
	JSON.stringify(Object.keys(DEFAULT_TIER_TOKENS)) === JSON.stringify(RATCHET_TIERS),
	`${JSON.stringify(Object.keys(DEFAULT_TIER_TOKENS))} vs ${JSON.stringify(RATCHET_TIERS)}`,
);
check("the fraction the spec fixes is 0.7", POOL_SIZE_GATE_FRACTION === 0.7, String(POOL_SIZE_GATE_FRACTION));

console.log("\n=== a verifier-class seat: window 24,576, compaction 4,096 + 8,192 -> usable 12,288 ===");
const verifierCfg = {
	DURIG_CONTEXT_WINDOW: { "verifier/faux-verify": 24576 },
	DURIG_COMPACTION_MODEL_OVERRIDES: { "verifier/faux-verify": { reserveTokens: 4096, keepRecentTokens: 8192 } },
};
const budget = usableContextBudget(verifierCfg, "verifier/faux-verify");
check("the declared window is read", budget.window === 24576, JSON.stringify(budget.window));
check("usable is window - reserve - keepRecent", budget.usable === 12288, JSON.stringify(budget));

const row = (tier, extra = {}) => ({ id: 501, status: "queued", tier, ...extra });
const limit = Math.floor(POOL_SIZE_GATE_FRACTION * budget.usable);
check("the 70% limit is 8,601 tokens", limit === 8601, String(limit));

for (const tier of RATCHET_TIERS) {
	const v = sizeVerdict(row(tier), { tierTokens: DEFAULT_TIER_TOKENS, usableWindow: budget.usable });
	const expected = DEFAULT_TIER_TOKENS[tier] > limit;
	check(
		`tier ${tier} (${DEFAULT_TIER_TOKENS[tier]} tokens) ${expected ? "is refused" : "is allowed"} for this seat`,
		v.gated === expected,
		JSON.stringify(v),
	);
}

const project = sizeVerdict(row("project"), { tierTokens: DEFAULT_TIER_TOKENS, usableWindow: budget.usable });
check(
	"the refusal names the tier, the estimate and the window it exceeded",
	project.reason === "too-big:project(120000 tokens > 70% of the 12288-token usable window)",
	project.reason,
);
check(
	"the refusal comes with the split instruction the seat can act on (row 6 closes the loop)",
	splitInstruction({ id: 501 }).includes('complete_work(itemId: 501, closedAs: "split", children: [...])'),
	splitInstruction({ id: 501 }),
);

console.log("\n=== the same predicate the claim path uses ===");
const viaWorkable = workable(row("project", { requires: "implement" }), "qa", {
	items: [],
	capabilities: ["implement"],
	tierTokens: DEFAULT_TIER_TOKENS,
	usableWindow: budget.usable,
});
check("workable() refuses the too-big row", viaWorkable.workable === false, JSON.stringify(viaWorkable));
check("...and reports the size reason, not a capability reason", viaWorkable.reason === project.reason, viaWorkable.reason);
check("...and hands back the measurement so the caller can print the split text", viaWorkable.size?.gated === true, JSON.stringify(viaWorkable.size));
const capabilityFirst = workable(row("project", { requires: "landing" }), "qa", {
	items: [],
	capabilities: [],
	tierTokens: DEFAULT_TIER_TOKENS,
	usableWindow: budget.usable,
});
check("a missing capability is still reported first (the seat cannot fix a window)", capabilityFirst.reason === "requires:landing", capabilityFirst.reason);

console.log("\n=== the trap the gate must survive: usable <= 0 ===");
// pi-durable's own defaults (reserve 16,384 + keepRecent 20,000) exceed a 24,576 window.
const starved = usableContextBudget({ DURIG_CONTEXT_WINDOW: 24576 }, "verifier/faux-verify");
check("usable is NEGATIVE here", starved.usable === -11808, JSON.stringify(starved));
const starvedVerdict = sizeVerdict(row("project"), { tierTokens: DEFAULT_TIER_TOKENS, usableWindow: starved.usable });
check("nothing is refused", starvedVerdict.gated === false, JSON.stringify(starvedVerdict));
check(
	"the verdict says there is no usable budget, in words, rather than a threshold computed from a negative",
	starvedVerdict.warning === "no usable budget declared (usable -11808 tokens; the compaction settings leave nothing to work in)",
	starvedVerdict.warning,
);
check("no limit is computed at all (nothing divides by a negative)", starvedVerdict.limit === null, JSON.stringify(starvedVerdict.limit));

console.log("\n=== absence is not a measurement ===");
const noWindow = sizeVerdict(row("project"), { tierTokens: DEFAULT_TIER_TOKENS, usableWindow: null });
check("a seat with NO declared window is not refused", noWindow.gated === false, JSON.stringify(noWindow));
check("...and the verdict says so", noWindow.warning === "no usable window declared for this seat", noWindow.warning);
const noTier = sizeVerdict(row(undefined), { tierTokens: DEFAULT_TIER_TOKENS, usableWindow: 12288 });
check("an UNTIERED row is not size-gated (§4: absence is not unknown)", noTier.gated === false && noTier.warning === null, JSON.stringify(noTier));
const unknownTier = sizeVerdict(row("huge"), { tierTokens: DEFAULT_TIER_TOKENS, usableWindow: 12288 });
check("a tier with no number warns instead of refusing", unknownTier.gated === false && unknownTier.warning.includes("no token estimate"), JSON.stringify(unknownTier));

console.log("\n=== DURIG_TIER_TOKENS overrides, and fails loudly when malformed ===");
const overridden = tierTokenTable({ DURIG_TIER_TOKENS: { trivial: 500 } });
check("an override replaces one tier and leaves the rest", overridden.trivial === 500 && overridden.project === DEFAULT_TIER_TOKENS.project, JSON.stringify(overridden));
check("the override changes the verdict for a seat with a 600-token window (limit 420 < 500)", sizeVerdict(row("trivial"), { tierTokens: overridden, usableWindow: 600 }).gated === true, JSON.stringify(sizeVerdict(row("trivial"), { tierTokens: overridden, usableWindow: 600 })));
let threw = 0;
for (const bad of [{ project: "abc" }, { project: 0 }, { nope: 100 }, "not json"]) {
	try {
		tierTokenTable({ DURIG_TIER_TOKENS: bad });
	} catch (err) {
		threw += 1;
		if (String(err.message).length === 0) check(`malformed ${JSON.stringify(bad)} throws with a message`, false);
	}
}
check("all four malformed values throw (a key the operator wrote meant to change something)", threw === 4, `threw ${threw}`);

console.log("\n=== the roster is the only place the claim path can read (seatSizeBudget) ===");
const fallback = seatSizeBudget({}, {});
check("a seat created before N19 falls back to the shipped table", fallback.tierTokens === DEFAULT_TIER_TOKENS, JSON.stringify(fallback));
check("...and to 'no window declared', which gates nothing", fallback.usableWindow === null, JSON.stringify(fallback.usableWindow));
const written = seatSizeBudget({ tierTokens: { trivial: 1 } }, { usableWindow: 10000 });
check("the values `up` wrote are the values the gate reads", written.tierTokens.trivial === 1 && written.usableWindow === 10000, JSON.stringify(written));

assert.ok(true);
console.log(failures === 0 ? "\nPOOL SIZE GATE PASS" : `\nPOOL SIZE GATE FAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
