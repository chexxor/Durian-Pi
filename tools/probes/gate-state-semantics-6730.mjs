#!/usr/bin/env node
/*
 * gate-state-semantics-6730.mjs — what does a gate MEAN, state by state? (#6730 / #6782)

 Three questions the fleet answers differently in three places:
   1. Is a gate naming a CANCELLED row closed or open? `workable()` (src/rig.mjs:327-330) says not
      workable. The docstring of `deadGateId` (src/rig.mjs:304-309) in the same file says "a CANCELLED
      prerequisite is a DROPPED prerequisite, not an unmet one". Behaviour and its own explanation
      disagree, and both are cited as authority (#6112, #3747).
   2. Is a gate naming an id that does not exist closed or open? The predicate says workable
      (conservative default for legacy rows).
   3. When a gate is dead, is there any verb that can clear it?

 Run: node tools/probes/gate-state-semantics-6730.mjs   exit 1 while the states are ruled inconsistently.
*/
import { readFileSync } from "node:fs";
import { workable, deadGateId } from "../../src/rig.mjs";

const gaps = [];
const gap = (cond, msg) => { console.log(`  ${cond ? "GAP   " : "CLOSED"}  ${msg}`); if (cond) gaps.push(msg); };

const base = (id, extra = {}) => ({ id, from: "pm", to: "impl", subject: `row ${id}`, body: "x", status: "queued", transitions: [], ...extra });

const cases = [
	["gate names a DONE row", base(1, { blockedBy: [2] }), [base(2, { status: "done" })]],
	["gate names a CANCELLED row", base(1, { blockedBy: [2] }), [base(2, { status: "cancelled" })]],
	["gate names a QUEUED row", base(1, { blockedBy: [2] }), [base(2, { status: "queued" })]],
	["gate names a HELD row", base(1, { blockedBy: [2] }), [base(2, { status: "held" })]],
	["gate names an id that does not exist", base(1, { blockedBy: [99] }), []],
	["gate names itself", base(1, { blockedBy: [1] }), []],
	["two rows gate each other (cycle)", base(1, { blockedBy: [2] }), [base(2, { blockedBy: [1] })]],
	["gate names a CLAIMED row", base(1, { blockedBy: [2] }), [base(2, { status: "claimed" })]],
	["no gate at all", base(1), []],
	["gate names a DEFERRED row", base(1, { blockedBy: [2] }), [base(2, { status: "deferred" })]],
];

console.log("One row, ten gate situations, what `workable()` says:");
for (const [name, item, others] of cases) {
	const items = [item, ...others];
	const verdict = workable(item, "impl", { items, capabilities: ["implement"] });
	const dead = deadGateId(item, items);
	console.log(`  MEASURED  ${name.padEnd(34)} -> ${verdict.workable ? "workable" : `refused (${verdict.reason})`}   deadGateId=${dead ?? "null"}`);
}

console.log("\nThe contradiction, stated as a test");
const src = readFileSync(new URL("../../src/rig.mjs", import.meta.url), "utf8");
const docstringSaysDropped = /a CANCELLED\s*\n?\s*\*?prerequisite is a DROPPED prerequisite, not an unmet one/.test(src) || /DROPPED prerequisite, not an unmet one/.test(src);
const predicateBlocks = /target\.status === "cancelled"\) return \{ workable: false/.test(src);
console.log(`  MEASURED  deadGateId docstring claims a cancelled prerequisite is "dropped, not unmet": ${docstringSaysDropped}`);
console.log(`  MEASURED  workable() refuses a row whose gate is cancelled: ${predicateBlocks}`);
gap(docstringSaysDropped && predicateBlocks, "the same file states the semantics two ways. `dropped, not unmet` reads as closed (proceed); the predicate reads as open (block). Two seats can cite the same line and reach opposite plans. One sentence, one verdict: pick blocking and correct the docstring, or pick proceeding and change the predicate - not both");

console.log("\nIs there a repair path for a dead gate?");
const verbNames = [...src.matchAll(/name: "([a-z_]+_work)"/g)].map((m) => m[1]);
const gateWrites = [...src.matchAll(/item\.blockedBy\s*=(?!=)/g)];
console.log(`  MEASURED  verbs in the rig: ${verbNames.join(", ")}`);
console.log(`  MEASURED  assignments to item.blockedBy outside enqueueItem: ${gateWrites.length}`);
console.log(`  MEASURED  a verb named gate_work exists: ${/name: "gate_work"/.test(src)}`);
gap(!/gate_work/.test(src) && gateWrites.length === 0, "no verb can clear a dead gate: `blockedBy` is written only at mint. A row whose prerequisite is cancelled is refused forever, and the seat that could fix it has no lever except cancel - which ends the work to fix the bookkeeping");

console.log("\nWhat the mint path actually rejects");
const norm = src.slice(src.indexOf("export function normalizeBlockedBy"), src.indexOf("export function normalizeBlockedBy") + 1500);
const checksExistence = /items\.find|queue\.items|target/.test(norm);
const checksCycles = /cycle|self/.test(norm);
console.log(`  MEASURED  normalizeBlockedBy validates shape; does it look at the referenced rows? ${checksExistence}; does it reject self-reference or cycles? ${checksCycles}`);
gap(!checksExistence && !checksCycles, "mint accepts a row gated on itself and a row gated on a row gated back on it. Those are not waiting states, they are loops, and nothing distinguishes them from ordinary waiting in the refusal text (measured above: the self-gate and the cycle both read as `gate-open`)");
gap(!/gate_work/.test(src), "there is no verb to clear a gate, so a loop or a dead gate can only be ended by cancelling a row");

console.log("\nThe recovery the ruling requires");
console.log("  gate_work(itemId, add?: [ids], remove?: [ids]) with, inside one commit and over the combined graph:");
console.log("  no self-gate, no cycle, target must exist, and removal of a DEAD gate is a repair any party may");
console.log("  record; removal of a LIVE gate stays with the minting seat or a lead scope ruling (D261 kept).");
console.log("  Each removal recorded as {by, reason, at} and notified to the author, the way cancellation is.");

console.log("\nAssertions this probe makes once the verb exists");
const validateGate = /validateGate|cycle|self-gate/.test(src);
gap(!validateGate, "no validator rejects self-reference or a cycle at mint - this goes GREEN when one exists");
const removalRecord = /removeGate|gateRemoved|removedBy/.test(src);
gap(!removalRecord, "no removal is recorded anywhere, so a cleared gate leaves no trace of who cleared it and why");

console.log(gaps.length ? `\nRESULT: RED - ${gaps.length} unresolved state(s)` : "\nRESULT: GREEN - every gate state has one verdict, one source, and a recovery");
process.exit(gaps.length ? 1 : 0);
