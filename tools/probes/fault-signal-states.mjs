#!/usr/bin/env node
/*
 * fault-signal-states.mjs — the gate on clause 4 of workable(): the seat fault marker (#6227 ruling, #6380 build).

 Three things have to be true for a recorded fault to be a SIGNAL rather than a document, and each is
 checkable without a store, a broker or a model:

   1. The read states are TOTAL and DISTINCT. "no fault", "active fault", "expired fault" and "fault
      exists but cannot be read" must not collapse into one verdict. A reader who cannot tell them
      apart cannot decide, and a rig that cannot decide cannot clear the fault.
   2. The parameter is NAMED. An undeclared key in the third argument is destructured away in silence;
      the caller thinks it passed a fault and the predicate never saw one. That silence is the reason
      this gap survived: the code looked like it consulted the fault.
   3. The WAKE path uses the SAME predicate as the CLAIM path. If `selectWakes` decides from a raw
      status scan while `claim_work` decides from workable(), clause 4 gates one door and not the other:
      a faulted seat is woken (spending the very tokens the fault exists to stop) and then refused.

 Exits 1 while any of these fail. Run: node tools/probes/fault-signal-states.mjs
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workable } from "../../src/rig.mjs";

const problems = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) problems.push(msg);
};

const item = (extra = {}) => ({ id: 1, to: "qa", from: "pm", status: "queued", subject: "item 1", ...extra });
const opts = (extra = {}) => ({ items: [item()], capabilities: [], ...extra });

const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2026-01-02T00:00:00Z";

const cases = [
	{ name: "no fault recorded", call: [item(), "qa", opts()], must: "workable, reason null" },
	{ name: "fault on the ITEM (not the seat)", call: [item({ fault: "provider-down" }), "qa", opts()], must: "not consulted - a seat fault is a seat fact" },
	{ name: "fault ACTIVE, reviewBy future", call: [item(), "qa", opts({ fault: { cause: "spend_cap_exceeded", at: "2026-11-10T00:00:00Z", resolver: "operator", reviewBy: FUTURE } })], must: "NOT workable, reason names the fault" },
	{ name: "fault EXPIRED, reviewBy past", call: [item(), "qa", opts({ fault: { cause: "spend_cap_exceeded", at: "2026-01-01T00:00:00Z", resolver: "operator", reviewBy: PAST } })], must: "workable, reason says expired (the record stays, inert)" },
	{ name: "fault present but UNREADABLE", call: [item(), "qa", opts({ fault: "unreadable" })], must: "UNKNOWN - never 'no fault'" },
	{ name: "fault with NO reviewBy and NO resolver", call: [item(), "qa", opts({ fault: { cause: "spend_cap_exceeded", at: "2026-11-10T00:00:00Z" } })], must: "NOT workable, and the refusal names who must clear it" },
];

console.log("1. read states: distinct verdicts for distinct situations");
const verdicts = new Set();
for (const c of cases) {
	const v = workable(...c.call);
	const got = `workable=${v.workable} reason=${v.reason ?? "null"}`;
	verdicts.add(got);
	console.log(`  ${c.name.padEnd(38)} expect: ${c.must.padEnd(48)} got: ${got}`);
}
check(verdicts.size >= 4, `the four fault states produce at least 4 distinct verdicts (measured: ${verdicts.size})`);

console.log("\n2. the parameter is named, not implied");
const rigSrc = readFileSync(join(process.cwd(), "src/rig.mjs"), "utf8");
const sigLine = rigSrc.split("\n").find((l) => l.startsWith("export function workable"));
check(/fault/.test(sigLine ?? ""), `workable()'s signature names the fault parameter (measured: ${sigLine})`);

console.log("\n3. wake and claim use the same predicate");
const driverSrc = readFileSync(join(process.cwd(), "src/driver.mjs"), "utf8");
const wakeParity = /workable\(|selectOldestWorkable\(/.test(driverSrc);
console.log(`  MEASURED  selectWakes decides hasQueued from: ${(driverSrc.match(/const hasQueued = [^\n]*/) || ["none"])[0]}`);
check(wakeParity, "src/driver.mjs consults the same claimability predicate the claim path uses; today the wake scans raw status and a faulted seat is woken, spending what the fault exists to stop");

console.log("\nRESULT:");
if (problems.length) {
	console.log(`  RED - ${problems.length} gap(s): the fault is recorded, not consulted`);
	process.exit(1);
}
console.log("  GREEN - clause 4 is a signal: total read states, named parameter, one predicate for claim and wake");
process.exit(0);
