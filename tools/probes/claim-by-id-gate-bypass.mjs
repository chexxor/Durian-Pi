#!/usr/bin/env node
/*
 * claim-by-id-gate-bypass.mjs — the two claim paths do not use the same predicate.

 `claim_work` has two paths (src/rig.mjs, claim_work execute):
   by-id:      queue.items.find(it => it.id === args.itemId && it.to === me && it.status === "queued")
   by-oldest:  selectOldestWorkable(items, seat, { capabilities }) -> workable() which checks
               status, `requires` against the seat's capabilities, and every `blockedBy` gate.

 The comment above the by-id path claims "The status whitelist is IDENTICAL to the oldest path".
 It is not: the by-id path checks status and address only. So a row the predicate says is NOT
 workable is claimed anyway when the seat names its id.

 Run: node tools/probes/claim-by-id-gate-bypass.mjs   (exit 1 while the paths diverge)
*/
import { readFileSync } from "node:fs";
import { workable, normalizeBlockedBy } from "../../../src/rig.mjs";

const src = readFileSync(new URL("../../../src/rig.mjs", import.meta.url), "utf8");
const verb = src.slice(src.indexOf('name: "claim_work"'), src.indexOf('name: "complete_work"'));
const byId = verb.slice(verb.indexOf("if (args.itemId !== undefined)"), verb.indexOf("// Normal claim"));

const fails = [];
const gap = (cond, msg) => { console.log(`  ${cond ? "GAP" : "CLOSED"}  ${msg}`); if (cond) fails.push(msg); };

console.log("1. does the by-id path apply the workable predicate at all?");
console.log(`  MEASURED  by-id path length ${byId.length} chars; contains "workable"? ${/workable/.test(byId)}; contains "blockedBy"? ${/blockedBy/.test(byId)}; contains "requires"? ${/requires/.test(byId)}`);
console.log(`  MEASURED  by-id admission filter: ${byId.match(/queue\.items\.find\([\s\S]{0,140}/)?.[0].replace(/\s+/g, " ")}`);
gap(!/workable/.test(byId), "the by-id path filters on `to === me && status === \"queued\"` only - the gate and the capability check are not applied");
gap(/IDENTICAL to the oldest path/.test(verb) && !/workable/.test(byId), "the comment above the by-id path asserts its whitelist is IDENTICAL to the oldest path, which the code contradicts (no workable(), no blockedBy, no requires in the by-id branch)");

console.log("\n2. the same row, both verdicts");
const parent = { id: 5001, status: "queued", from: "pm", to: "impl", subject: "parent" };
const gated = { id: 5002, status: "queued", from: "pm", to: "impl", subject: "gated child", blockedBy: normalizeBlockedBy([5001]) };
const verdict = workable(gated, "impl", { items: [gated, parent] });
const byIdAdmits = gated.to === "impl" && gated.status === "queued";
console.log(`  MEASURED  workable(5002) = ${JSON.stringify(verdict)}; by-id filter admits 5002 = ${byIdAdmits}`);
gap(byIdAdmits && !verdict.workable, "a seat that names the id can claim a row the predicate refuses - an open gate is defeated by naming the row");

console.log("\n3. capability (`requires`) divergence");
const needsSkill = { id: 5003, status: "queued", from: "pm", to: "impl", subject: "needs design", requires: "design" };
console.log(`  MEASURED  workable(5003) with capabilities [] = ${JSON.stringify(workable(needsSkill, "impl", { items: [needsSkill], capabilities: [] }))}`);
gap(needsSkill.status === "queued" && !workable(needsSkill, "impl", { items: [needsSkill], capabilities: [] }).workable, "a by-id claim of a row the seat is not capable of is admitted by the status filter");

console.log("\nRESULT: " + (fails.length ? `RED - ${fails.length} divergence(s) between the two claim paths` : "GREEN - both paths use one predicate"));
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length ? 1 : 0);
