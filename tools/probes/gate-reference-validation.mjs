#!/usr/bin/env node
/*
 * gate-reference-validation.mjs — the measured failure surface of a GATE that is never validated.

 Question: `blockedBy` is a structured field (D53), and `workable()` is the ONE predicate both claim
 selection and wake selection read (#2673, #2712). What happens to a gate that references an id which
 does not exist, is terminal, is itself, or is part of a cycle?

 Everything below is run against the real functions in src/rig.mjs — no harness, no store, no model.
 Run: node tools/probes/gate-reference-validation.mjs   (exit 0; the FAIL lines are the finding)
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeBlockedBy, workable, selectOldestWorkable } from "../../../src/rig.mjs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};

const item = (id, status, blockedBy, extra = {}) => ({
	id, status, from: "pm", to: "impl", subject: `item ${id}`,
	blockedBy: normalizeBlockedBy(blockedBy), ...extra,
});

const observe = (msg) => console.log(`  MEASURED  ${msg}`);

console.log("gate reference validation — normalizeBlockedBy checks SHAPE, nothing else");

/* 1. a gate on an id that does not exist */
const dangling = item(10, "queued", [9999]);
observe(`normalized ${JSON.stringify(dangling.blockedBy)} -> workable=${workable(dangling, "impl", { items: [dangling] }).workable}, reason=null. A gate on a NON-EXISTENT id is silently treated as satisfied: a typo un-gates work.`);

/* 2. a gate on a cancelled parent */
const parentCancelled = item(11, "cancelled", null);
const child = item(12, "queued", [11]);
observe(`${JSON.stringify(child.blockedBy)} -> ${workable(child, "impl", { items: [child, parentCancelled] }).reason}; selectOldestWorkable skips it: ${JSON.stringify(selectOldestWorkable([child, parentCancelled], "impl").skipped)}. The parent can never become done, so the child has no exit.`);

/* 3. a self-gate */
const selfGated = item(13, "queued", [13]);
observe(`self-gate -> ${workable(selfGated, "impl", { items: [selfGated] }).reason}, forever`);

/* 4. a two-row cycle */
const a = item(14, "queued", [15]);
const b = item(15, "queued", [14]);
observe(`cycle: ${workable(a, "impl", { items: [a, b] }).reason} / ${workable(b, "impl", { items: [a, b] }).reason}. Nothing reports it AS a cycle - each seat only sees "gate-open" on a row that is itself waiting. Permanent deadlock, no named cause.`);

/* 5. a gate on a HELD (parked) parent */
const heldParent = item(16, "held", null);
const child2 = item(17, "queued", [16]);
observe(`gate on a held parent -> ${workable(child2, "impl", { items: [child2, heldParent] }).reason}. A held row is unclaimable by design, so the child waits on something NO seat can complete; only the operator or a release clears it, and the reason string does not say so.`);

/* 6. what the shape validator does catch */
let caught = 0;
for (const bad of [["1234"], [0], [-3], [1.5], "gated on #1234"]) {
	try { normalizeBlockedBy(bad); } catch { caught++; }
}
check(caught === 5, `normalizeBlockedBy rejects 5/5 malformed shapes (prose, zero, negative, fractional) — it accepts [9999] (nonexistent), [self], and a cycle`);

/* 7. is there a REFERENCE validator anywhere in the write path? */
const rigSrc = readFileSync(join(process.cwd(), "src/rig.mjs"), "utf8");
check(!/validateGate|dangling|self-gate/i.test(rigSrc), "src/rig.mjs contains NO gate reference validator — only shape normalisation, so dangling ids, self-gates and cycles are stored and never detected");
const checkup = readFileSync(join(process.cwd(), "src/checkup.mjs"), "utf8");
const gateLines = checkup.split("\n").filter((l) => /blockedBy/.test(l));
check(gateLines.length === 0, `src/checkup.mjs has ${gateLines.length} rule(s) reading blockedBy — nothing reports a row gated on a terminal or nonexistent id`);

/* 8. the validator that is missing, written out so it is not hypothetical.
      Reference validity is cheap: one pass over the ids in the gate, plus a bounded walk for cycles. */
function validateGate(blockedBy, items, selfId) {
	if (!blockedBy) return { ok: true, problems: [] };
	const byId = new Map(items.map((it) => [it.id, it]));
	const problems = [];
	for (const id of blockedBy) {
		if (id === selfId) problems.push("self-gate");
		const target = byId.get(id);
		if (!target) problems.push(`dangling:#${id}`);
		else if (target.status === "cancelled") problems.push(`gate on a cancelled parent:#${id}`);
	}
	const seen = new Set([selfId]);
	const stack = [...blockedBy];
	let steps = 0;
	while (stack.length && steps <= items.length) {
		const id = stack.pop();
		steps++;
		if (id === selfId) { problems.push("cycle back to this item"); break; }
		if (seen.has(id)) continue;
		seen.add(id);
		const t = byId.get(id);
		if (t?.blockedBy) stack.push(...t.blockedBy);
	}
	return { ok: problems.length === 0, problems };
}

console.log("  the missing validator, run on the cases above:");
const pool = [dangling, parentCancelled, child, selfGated, a, b, heldParent, child2];
for (const it of [dangling, child, selfGated, a, b, child2]) {
	const r = validateGate(it.blockedBy, pool, it.id);
	console.log(`    #${it.id} blockedBy=${JSON.stringify(it.blockedBy)} -> ${r.ok ? "ok" : "REJECT: " + r.problems.join(", ")}`);
}
check(!validateGate(dangling.blockedBy, pool, dangling.id).ok, "a dangling gate is rejectable at enqueue");
check(!validateGate(selfGated.blockedBy, pool, selfGated.id).ok, "a self-gate is rejectable at enqueue");
check(!validateGate(a.blockedBy, pool, a.id).ok, "a cycle is detectable at enqueue before either row can be created");

console.log(`\nRESULT: ${failures.length} measured finding(s)`);
process.exit(0);
