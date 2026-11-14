#!/usr/bin/env node
/*
 * parked-gate-signature-6665.mjs - the wake layer's parked signature does not contain the gate (#6665)

src/driver.mjs:69-75 builds the parked signature from `${id}:${status}` only. src/scheduler.mjs:146-152
wakes a seat for parked rows ONLY when that signature changes. So a change to a parked row's GATE -
the parent is cancelled, superseded, or done - leaves the signature byte-identical: no wake, and no
line in the log. The seat is silent, and silence reads as "nothing here".

Pure, no harness. Run: node tools/probes/parked-gate-signature-6665.mjs   exit 1 while the gate is invisible
*/
import { parkedSignature, selectWakes } from "../../../src/driver.mjs";
import { WakeScheduler } from "../../../src/scheduler.mjs";

const failures = [];
const check = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures.push(m); };
const note = (m) => console.log(`  MEASURED  ${m}`);

const seats = { impl: { conversationId: "conv-impl" } };
const before = [
	{ id: 101, to: "impl", status: "held", blockedBy: [100] },
	{ id: 100, to: "qa", status: "queued", blockedBy: [] },
];
const afterCancel = [
	{ id: 101, to: "impl", status: "held", blockedBy: [100] },
	{ id: 100, to: "qa", status: "cancelled", blockedBy: [] },
];
const afterDone = [
	{ id: 101, to: "impl", status: "held", blockedBy: [100] },
	{ id: 100, to: "qa", status: "done", blockedBy: [] },
];

const sigBefore = parkedSignature(before, "impl");
const sigCancel = parkedSignature(afterCancel, "impl");
const sigDone = parkedSignature(afterDone, "impl");
note(`signature before the parent closed: ${sigBefore}`);
note(`signature after the parent was CANCELLED: ${sigCancel}`);
note(`signature after the parent was DONE: ${sigDone}`);

const sched = new WakeScheduler({ minIntervalMs: 0 });
const wokeBefore = selectWakes({ seats, items: before, parkedChanged: (s, sig) => sched.parkedChanged(s, sig) }).map((w) => `${w.name}:${w.reason}`);
const wokeAfter = selectWakes({ seats, items: afterCancel, parkedChanged: (s, sig) => sched.parkedChanged(s, sig) }).map((w) => `${w.name}:${w.reason}`);
note(`first pass wakes: ${wokeBefore.join(", ") || "none"}`);
note(`second pass wakes (parent now cancelled): ${wokeAfter.join(", ") || "none"}`);
note(`scheduler last-seen parked signature for impl: ${sched.parkedSignatureOf("impl")}`);

check(sigBefore !== sigCancel, "the parked signature reflects the gate state - it does not today, so this fails");
check(wokeAfter.length > 0, "a parked row whose gate became unresolvable produces a wake - it does not today, so this fails");
console.log("\nFix: put the gate's derived state in the signature - `${id}:${status}:${gateState}` where gateState is open|resolved|stranded (see src/rig.mjs deadGateId/resolveGate). A stranded gate then changes the signature, the seat is woken with the reason, and the pass logs it.");
process.exit(failures.length ? 1 : 0);
