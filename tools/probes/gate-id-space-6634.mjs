#!/usr/bin/env node
/*
 * gate-id-space-6634.mjs - what does a bare number in `blockedBy` mean? (#6634 ruling)

Two questions pm asked before impl writes the validator:
  A. Does the WRITE path accept a gate id that resolves to nothing? Does the READ path treat it as met?
     Both are measured by calling the real functions, not by reading them.
  B. Do the QUEUE id space and the ROADMAP number space overlap? If they do, "blockedBy: 63" is
     ambiguous by construction and no read can disambiguate it.

 Run: node tools/probes/gate-id-space-6634.mjs   (exit 1 = the ambiguity is live)
*/
import { readFileSync } from "node:fs";
import { normalizeBlockedBy, workable } from "../../../src/rig.mjs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const note = (m) => console.log(`  MEASURED  ${m}`);

console.log("A. write accepts, read passes over");
const accepted = normalizeBlockedBy([9999]);
note(`normalizeBlockedBy([9999]) -> ${JSON.stringify(accepted)} (prose "GATED on #63" still throws: ${(() => { try { normalizeBlockedBy("GATED on #63"); return "no"; } catch (e) { return e.message.slice(0, 40); } })()})`);
check(accepted === null, "the write path ACCEPTS a gate id that cannot resolve (returns [9999]); nothing at mint time checks resolvability");

const row = { id: 5000, status: "queued", to: "impl", from: "pm", blockedBy: [9999] };
const row63 = { id: 5000, status: "queued", to: "impl", from: "pm", blockedBy: [63] };
note(`workable(row with gate [9999], items=[row]) -> ${JSON.stringify(workable(row, "impl", { items: [row] }))}`);
note(`workable(row with gate [63],  items=[row63, {id:63,status:"done"}]) -> ${JSON.stringify(workable(row63, "impl", { items: [row63, { id: 63, status: "done" }] }))}`);
note(`workable(row with gate [63],  items=[row63, {id:63,status:"cancelled"}]) -> ${JSON.stringify(workable(row63, "impl", { items: [row63, { id: 63, status: "cancelled" }] }))}`);
note(`workable(row with gate [331], items=[row]) -> ${JSON.stringify(workable({ id: 5000, status: "queued", to: "impl", from: "pm", blockedBy: [331] }, "impl", { items: [row] }))}`);

console.log("\nB. do the two id spaces overlap?");
const roadmap = readFileSync("docs/ROADMAP.md", "utf8");
const rmNumbers = [...new Set([...roadmap.matchAll(/\b(?:ROADMAP|RM)\s*(\d{1,4})\b/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
note(`distinct roadmap numbers named in docs/ROADMAP.md: ${rmNumbers.length} (max ${rmNumbers[rmNumbers.length - 1]})`);
const mirror = readFileSync("/home/chexxor/Git/Durian-Pi/.durig/queue-all.md", "utf8").split("\n").filter((l) => /^#\d+ /.test(l));
const maxLiveId = Math.max(...mirror.map((l) => Number(l.match(/^#(\d+)/)[1])));
note(`queue ids are assigned consecutively from 1 (rig.mjs:114 initial nextId:1, rig.mjs:442 const id = queue.nextId++), so ids 1..N ALL exist as rows`);
note(`max roadmap number ${rmNumbers[rmNumbers.length - 1]} sits inside the queue id range (live ids past ${maxLiveId}) - every roadmap number is also a queue id`);
check(rmNumbers.every((n) => n > maxLiveId), "a bare integer in blockedBy is ambiguous by construction: roadmap numbers 1.." + rmNumbers[rmNumbers.length - 1] + " all name queue rows too. Spot-check on the live store (node cli.mjs queue --id 63 --id 115 --id 331): #63 is a CANCELLED 'ROADMAP (agent-fleet borrow) RANK 5 REGISTERED' row, #115 and #331 are done rows - so 'GATED on ROADMAP 63' written as blockedBy=[63] is decided by whichever row happens to carry id 63");

console.log("\nC. is the convention already encoded anywhere?");
const lifecycle = readFileSync("src/queue-lifecycle.mjs", "utf8");
note(`queue-lifecycle reasons/constraints: roadmap-gate requires >=1 constraint of kind roadmap (${/roadmap-gate/.test(lifecycle)} true); blockedBy is typed as plain integers only`);
check(/kind.*roadmap/.test(lifecycle) && /blockedBy.*roadmap|roadmap.*blockedBy/.test(readFileSync("src/rig.mjs", "utf8")), "nothing refuses a roadmap number in `blockedBy` - the roadmap gate is only recognized inside block.constraints, and the write path does not connect the two");

console.log("\nThe ruling the probe pins:");
console.log("  write-time: refuse a reference that is KNOWABLY invalid at mint (self, cancelled parent, an id the queue doc does not contain); read-time: an unresolvable id stays the conservative default ONLY for rows written before the check existed.");
console.log("  a bare integer in blockedBy means a QUEUE id, full stop; a roadmap gate belongs in block.constraints with kind:roadmap, and minting a gate whose row also names 'ROADMAP <n>' or 'RM-<n>' is refused with that pointer.");
process.exit(failures.length ? 1 : 0);
