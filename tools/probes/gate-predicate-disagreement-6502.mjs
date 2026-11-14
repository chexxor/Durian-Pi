#!/usr/bin/env node
/*
 * gate-predicate-disagreement-6502.mjs - does the rig have ONE gate predicate, or four? (#6502 review)

 pm's decomposition of #6469 (#6497 shared validator, #6498 gate state in the queue line,
 #6499 cancel propagation) asks for ONE validator. This probe measures what exists today:

   1. How many places decide "is this gate closed?" - and do they agree on a CANCELLED parent?
      Executed, not read: workable() and classifyHeldRow() are both run on the same row.
   2. Can any verb change or remove a gate after it is minted? (an exit path for a stranded row)
   3. Does the spec's call-site name exist? `enqueueWork` / `reviseWork` are not in src/rig.mjs;
      the revise tool has no `blockedBy` parameter at all, so "refused by BOTH paths" is unbuildable.
   4. Is the cycle leg reachable? ids are assigned monotonically, so a gate can only name a
      SMALLER id - measured on the live mirror.
   5. How many live rows are stranded on a gate the seat cannot resolve (the number #6498 is
      trying to fix)?

 Run: node tools/probes/gate-predicate-disagreement-6502.mjs   (exit 1 = findings, exit 0 = clean)
*/
import { readFileSync } from "node:fs";
import { workable, deadGateId } from "../../../src/rig.mjs";
import { classifyHeldRow, structuralClass, TERMINAL_STATUSES } from "../../../src/heldgate.mjs";
import { gateView } from "../../../src/queue-lifecycle.mjs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const note = (msg) => console.log(`  MEASURED  ${msg}`);

const rig = readFileSync("src/rig.mjs", "utf8");
const checkup = readFileSync("src/checkup.mjs", "utf8");

console.log("1. ONE predicate? Four independent implementations of gate closure");
note(`validateGate exported from src/rig.mjs: ${typeof (await import("../../../src/rig.mjs")).validateGate === "function" ? "yes" : "NO - it does not exist yet"}`);
note("readers of gate closure: workable() rig.mjs:320 | deadGateId() rig.mjs:312 | release refusal rig.mjs:~1345 | heldgate TERMINAL_STATUSES heldgate.mjs:19 | queue-lifecycle closed mapping :310");

const parent = { id: 100, from: "pm", to: "impl", status: "cancelled", subject: "the parent that was cancelled", body: "parent" };
const child = {
	id: 101,
	from: "pm",
	to: "impl",
	status: "held",
	subject: "the row waiting on it",
	body: "release this row once its prerequisite finishes",
	blockedBy: [100],
};
const items = [parent, child];
const verdict = workable({ ...child, status: "queued" }, "impl", { items });
note(`workable() on the child AFTER it is released (status queued): ${JSON.stringify(verdict)}`);
const classified = classifyHeldRow(child, {
	statusOf: (id) => items.find((it) => it.id === id)?.status ?? "absent",
	landedOnMain: () => null,
	artifactSatisfied: () => false,
});
const structural = structuralClass(gateView(child), child, {
	statusOf: (id) => items.find((it) => it.id === id)?.status ?? "absent",
	landedOnMain: () => null,
});
note(`workable() on the held child: ${JSON.stringify(workable(child, "impl", { items }))}`);
note(`classifyHeldRow() on the SAME child: class=${classified.class} condition="${classified.condition}"`);
note(`structuralClass() on the SAME child: ${structural}`);
note(`deadGateId() on the SAME child: ${deadGateId(child, items)}`);
check(
	!(classified.class === "release-candidate" && verdict.workable === false),
	`the classifier proposes RELEASE for a row the claim path refuses: class="${classified.class}" vs workable=${verdict.workable} (${verdict.reason}). release_work refuses it (rig.mjs release guard: "its gate names #${deadGateId(child, items)}, which is cancelled") - the instrument advises an action the broker refuses`
);
check(
	!TERMINAL_STATUSES.has("cancelled"),
	`heldgate counts a CANCELLED gate as CLOSED (heldgate.mjs:19) while workable() counts it as NOT SATISFIED (rig.mjs:329). Same word, opposite verdict: pick one vocabulary and have both call it`
);

console.log("\n2. Is there an exit path for a stranded gate?");
const gateWrites = rig.split("\n").filter((l) => /normalizeBlockedBy\(/.test(l));
const gateEdits = rig.split("\n").filter((l) => /\.blockedBy\s*=|delete .*\.blockedBy/.test(l));
note(`lines calling normalizeBlockedBy: ${gateWrites.length} (${gateWrites.map((l) => l.trim().slice(0, 40)).join(" | ")})`);
note(`lines that re-write or clear a stored row's gate: ${gateEdits.length}`);
check(
	gateEdits.length > 0,
	`no verb can add, change or clear a gate on an existing row (${gateEdits.length} sites). A row whose parent was cancelled is unclaimable FOREVER: the only legal transitions left are cancel_work (which discards the intent) or nothing. #6499 reports the strand; it does not clear it`
);

console.log("\n3. Does the build spec address a tool that can carry a gate?");
const reviseBlock = rig.slice(rig.indexOf('name: "revise_work"'), rig.indexOf('name: "cancel_work"'));
note(`revise_work parameter names: ${[...reviseBlock.matchAll(/^\s*(\w+): opt\(/gm)].map((m) => m[1]).join(", ")}`);
check(
	/blockedBy/.test(reviseBlock),
	`#6497 requires validateGate to be "called from BOTH enqueueWork and reviseWork", and its demo asserts the same [9999] gate is refused by BOTH paths. revise_work's schema takes itemId, subject and body only - there is no gate to validate on that path, so the acceptance cannot be written as specified. Either give revise_work a blockedBy parameter (a scope decision, lead) or scope the assertion to the one path that can write a gate`
);
check(
	/enqueueWork|reviseWork/.test(rig),
	`the spec names enqueueWork and reviseWork; src/rig.mjs defines enqueueItem (:427) and applyRevise (queue-lifecycle). An impl seat importing the spec's names gets undefined - name the real symbols in the row body`
);
check(
	/check/.test(checkup) && /blockedBy/.test(checkup),
	`#6499 says "the check rule must REPORT rows gated on terminal ids". src/checkup.mjs contains ${checkup.match(/blockedBy/g)?.length ?? 0} references to blockedBy: there is no rule to amend, only a rule to mint - name the rule id and its file`
);

console.log("\n4. Is the cycle leg reachable?");
const monotonic = rig.match(/const id = queue\.nextId\+\+;/);
note(`id assignment in enqueueItem: ${monotonic ? "monotonic (`const id = queue.nextId++;`)" : "not found"}`);
const mirrorPath = "/home/chexxor/Git/Durian-Pi/.durig/queue-all.md";
let rows = [];
try {
	rows = readFileSync(mirrorPath, "utf8").split("\n").filter((l) => /^#\d+ /.test(l));
} catch (err) {
	note(`mirror unreadable (${err.message}); the live census is skipped`);
}
if (rows.length) {
	const idsInMirror = new Set(rows.map((l) => Number(l.match(/^#(\d+)/)[1])));
	const gated = rows.filter((l) => /blockedBy=\d/.test(l));
	const unresolvable = gated.filter((l) => {
		const ids = (l.match(/blockedBy=(\d+(?:,\d+)*)/)[1] || "").split(",").map(Number);
		return ids.some((id) => !idsInMirror.has(id));
	});
	const backwards = gated.filter((l) => {
	 const id = Number(l.match(/^#(\d+)/)[1]);
	 return (l.match(/blockedBy=(\d+(?:,\d+)*)/)[1] || "").split(",").map(Number).some((g) => g >= id);
	});
	note(`live mirror: ${rows.length} non-terminal rows, ${gated.length} carry a structured gate, ${unresolvable.length} of those reference an id the mirror does not list`);
	note(`gates naming an id >= their own row id (the only way a cycle could exist): ${backwards.length}`);
	check(
		backwards.length === 0,
		`the cycle detector has nothing to find on this store: ids are assigned in increasing order, so every gate names a smaller id (${backwards.length} exceptions). Keep the bounded walk as future-proofing for a gate-EDIT verb; do not make it the acceptance test`
	);
}

console.log("\nRule that closes the class:");
console.log("  export ONE predicate - gateState(item, items) -> [{id, state: done|open|cancelled|unknown}] - and make workable(), the release guard, heldgate's classifier, the queue line and the check rule all call it. A cancelled gate is then one named state, not four different words.");
process.exit(failures.length ? 1 : 0);
