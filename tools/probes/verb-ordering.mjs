#!/usr/bin/env node
/*
 * verb-ordering.mjs — a gate on the ORDER of checks in the queue verbs (#6363 / #6362).

 The defect is a class, not a line. A refusal is a claim about the world: if a verb decides WHO may
 act on a row before it establishes WHAT the row is, then a closed row is refused on the grounds of
 ownership - which reads to a coordinator as open work somebody else owns. #5778 fixed this for
 `release_work` ("terminal before authority"); the fix never reached the siblings.

 The probe reads the source and reports, for every verb that acts on a queue row:
   existence -> state (terminality or status) -> authority
 It exits 1 while any verb reaches an authority-only refusal before it knows the row's state, and 0
 when every verb establishes state first. RED before the fix, GREEN after, and RED again if a future
 verb reintroduces the order. That is the point: a one-off test proves the patch; a standing check
 proves the class is closed.

 Run: node tools/probes/verb-ordering.mjs
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

const VERBS = ["claim_work", "complete_work", "defer_work", "resume_work", "hold_work", "release_work", "revise_work", "cancel_work"];
const problems = [];

console.log("state-before-authority in every verb that acts on a queue row:");
for (const verb of VERBS) {
	const body = bodies[verb];
	if (!body) { problems.push(`${verb}: not found`); continue; }
	const lines = body.split("\n");
	const isAuth = (l) => /\b(it|item)\.to !== me|\b(it|item)\.from !== me/.test(l);
	const isState = (l) => /isTerminalItem\(|\b(it|item)\.status/.test(l);
	let authLine = -1, stateLine = -1;
	for (let i = 0; i < lines.length; i++) {
		if (isAuth(lines[i]) && authLine < 0) authLine = i;
		if (isState(lines[i]) && stateLine < 0) stateLine = i;
	}
	if (authLine < 0) {
		console.log(`  PASS  ${verb.padEnd(13)} no authority refusal - the verb admits rows only by address and status`);
		continue;
	}
	// The authority refusal is safe if it fires after a terminality check, or if the same condition
	// already names the row's status (a conjunction reports the state in the same sentence).
	const safe = (stateLine >= 0 && stateLine < authLine) || isState(lines[authLine]);
	console.log(`  ${safe ? "PASS" : "FAIL"}  ${verb.padEnd(13)} first state check at line ${stateLine}, first authority check at line ${authLine}  ${safe ? "(state established before or in the refusal)" : "(AUTHORITY-ONLY REFUSAL FIRES BEFORE THE ROW'S STATE IS ESTABLISHED)"}`);
	if (!safe) problems.push(`${verb}: an authority refusal can fire before the verb knows the row's state`);
}

/* claim by id: naming a specific row must not come back as "nothing queued" */
const claimBody = bodies.claim_work ?? "";
const at = claimBody.indexOf("if (!found)");
const notFoundClause = at >= 0 ? claimBody.slice(at, at + 90) : "";
const namesWhy = /itemId|status/.test(notFoundClause);
console.log(`\nclaim_work by id: a named row that is not claimable returns ${namesWhy ? "a refusal naming the row and its state" : "the bare string NO_QUEUED_WORK"}`);
if (!namesWhy) problems.push("claim_work: claiming a specific id that is held, deferred, claimed elsewhere or terminal returns NO_QUEUED_WORK - indistinguishable from 'you have no work', so a seat that is pointed at a closed row reports its queue as empty");

if (problems.length) {
	console.log(`\nRESULT: RED - ${problems.length} problem(s): the queue verbs decide who may act before they establish what the row is`);
	console.log("Fix: in each verb, establish the row's state (terminality, then status) before the ownership refusal, as release_work already does at src/rig.mjs:1275; and make claim_work's by-id miss name the id and its status instead of returning NO_QUEUED_WORK.");
	process.exit(1);
}
console.log("\nRESULT: GREEN - every queue verb establishes the row's state before it refuses on authority");
process.exit(0);
