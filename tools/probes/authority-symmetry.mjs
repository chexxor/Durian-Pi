#!/usr/bin/env node
/*
 * authority-symmetry.mjs — who may change a row's state, measured (#6365 / #6364).

 The rig has two different authorities and they are easy to confuse:
   HOLDER authority  - the seat executing the work: claim, complete, defer, resume.
   PARTY authority   - either side of the row: revise, release, cancel, and (by this rule) hold.
 A verb that changes a row's STATUS without anyone acting on the work is a party action. `hold_work`
 is the one status-changing verb that is recipient-only, so the seat that minted a row can release it
 and can cancel it but cannot park it - the destructive lever is available and the reversible one is
 not.

 This probe classifies every queue verb by the predicate it actually uses and exits 1 while the
 classification contradicts the rule. Run: node tools/probes/authority-symmetry.mjs
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/rig.mjs"), "utf8");
const starts = [...src.matchAll(/name: "([a-z_]+_work)"/g)];
const bodies = {};
for (let i = 0; i < starts.length; i++) {
	const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
	bodies[starts[i][1]] = src.slice(starts[i].index, end);
}

const EXPECT = {
	claim_work: "holder", // admits rows addressed to you
	complete_work: "holder",
	defer_work: "holder",
	resume_work: "holder",
	hold_work: "party", // parks a row: a status change, not an act of work
	release_work: "party",
	revise_work: "party",
	cancel_work: "party",
};

const problems = [];
console.log("authority predicate each verb actually uses:");
for (const [verb, expected] of Object.entries(EXPECT)) {
	const body = bodies[verb] ?? "";
	const partyWide = /\b(it|item)\.to !== me && \b(it|item)\.from !== me/.test(body);
	const holderScoped = /\b(it|item)\.to !== me|\b(it|item)\.to === me/.test(body);
	const observed = partyWide ? "party" : holderScoped ? "holder-scoped" : "none found";
	const ok = observed === (expected === "holder" ? "holder-scoped" : "party");
	console.log(`  ${ok ? "PASS" : "FAIL"}  ${verb.padEnd(13)} expects ${expected.padEnd(7)} uses ${observed}`);
	if (!ok) problems.push(`${verb}: expected ${expected}, uses ${observed}`);
}

// The status rule that must accompany a widened hold: a sender may park an UNCLAIMED row only.
const holdBody = bodies.hold_work ?? "";
const admitsClaimed = /item\.status !== "claimed" && item\.status !== "queued"/.test(holdBody);
console.log(`\nhold_work admits a CLAIMED row: ${admitsClaimed ? "yes (the holder's own park)" : "no"}`);
console.log("  the widened rule must be: the holder may park claimed or queued; the sender may park queued only.");

if (problems.length) {
	console.log(`\nRESULT: RED - ${problems.length} verb(s) contradict the authority model`);
	process.exit(1);
}
console.log("\nRESULT: GREEN - status-changing verbs are party-wide, work-advancing verbs are holder-scoped");
process.exit(0);
