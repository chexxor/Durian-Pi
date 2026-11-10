#!/usr/bin/env node
/*
 * fault-signal-states.mjs — measures why clause 4 of `workable()` is a gap, not a signal (#6227).
 *
   `workable(item, seat, { items = [], capabilities = [] })` (`src/rig.mjs:303`) has four clauses in
   its contract; three are implemented. Clause 4 — "not marked blocked by a recorded PROVIDER/SEAT
   FAULT" — has no field, so the predicate has NO CHANNEL for a fault at all. The consequence this
   probe measures: four situations that a reader must be able to tell apart
   (no fault / active fault / expired fault / fault that exists but cannot be read) produce ONE
   verdict, and the verdict is "clean".

   Also measured: the third argument destructures only `items` and `capabilities`, so a caller that
   passes a `fault` today is silently ignored — no error, no effect. That is why the ruling names the
   parameter explicitly rather than leaving it to convention.

   No store, no broker, no model. Pure function, deterministic.
*/
import { workable } from "../../src/rig.mjs";

const item = (extra = {}) => ({ id: 1, to: "qa", from: "pm", status: "queued", subject: "item 1", ...extra });
const opts = (extra = {}) => ({ items: [item()], capabilities: [], ...extra });

const cases = [
	{ name: "no fault recorded",           call: [item(), "qa", opts()],                                          must: "clean" },
	{ name: "fault on the ITEM",           call: [item({ fault: "provider-down" }), "qa", opts()],           must: "distinct from clean" },
	{ name: "fault on the SEAT argument",  call: [item(), "qa", opts({ seatFault: { cause: "spend_cap_exceeded", reviewBy: "2099-01-01" } })], must: "distinct from clean" },
	{ name: "fault ACTIVE, reviewBy future", call: [item(), "qa", opts({ fault: { cause: "spend_cap_exceeded", at: "2026-11-10T00:00:00Z", resolver: "operator", reviewBy: "2099-01-01" } })], must: "NOT workable" },
	{ name: "fault EXPIRED, reviewBy past", call: [item(), "qa", opts({ fault: { cause: "spend_cap_exceeded", at: "2026-01-01T00:00:00Z", resolver: "operator", reviewBy: "2026-01-02T00:00:00Z" } })], must: "workable, flagged expired" },
	{ name: "fault present but UNREADABLE", call: [item(), "qa", opts({ fault: "unreadable" })],             must: "UNKNOWN, never 'no fault'" },
];

console.log("probe: fault-signal read states  tree:", process.cwd());
const verdicts = new Set();
for (const c of cases) {
	const v = workable(...c.call);
	const got = `workable=${v.workable} reason=${v.reason ?? "null"}`;
	verdicts.add(got);
	console.log(`  ${c.name.padEnd(32)} expect: ${c.must.padEnd(24)} got: ${got}`);
}

// Does an undeclared option raise anything? No — it is dropped without a word.
const silent = workable(item(), "qa", { items: [item()], capabilities: [], fault: { cause: "x" }, flaw: "typo" });
console.log(`  undeclared option passed to the predicate  got: workable=${silent.workable}, no error, no effect`);

console.log(`\nDISTINCT VERDICTS: ${verdicts.size} of ${cases.length}`);
console.log(verdicts.size === 1
	? "GAP CONFIRMED: active, expired, unreadable and absent faults all read as 'clean'. Clause 4 cannot be implemented until the field and its read states exist."
	: "the fault states are distinguishable — clause 4 is implemented.");
process.exit(0);
