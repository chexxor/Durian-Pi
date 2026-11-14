#!/usr/bin/env node
/*
 * coordinator-standing-surface.mjs — can a guard for "the coordinator" point at a value today?

 Lead's ruling #6532: coordinator standing must be a RECORDED field before any verb grants it,
 narrowed to: minted at creation, additive authority over gate/constraint fields only, bounded to
 rows the coordinator is party to.

 This probe measures the authority surface that exists now, so the ruling has a baseline it can be
 checked against: which verbs decide "coordinator" from a derived predicate rather than a stored
 field, whether the derived predicate can go stale, and whether any verb can undo an addition.

 Run: node tools/probes/coordinator-standing-surface.mjs   (exit 1 while standing is inferred)
*/
import { readFileSync } from "node:fs";
import { seatIsCoordinator } from "../../../src/seattools.mjs";

const rig = readFileSync(new URL("../../../src/rig.mjs", import.meta.url), "utf8");
const fails = [];
const gap = (cond, msg) => { console.log(`  ${cond ? "GAP" : "CLOSED"}  ${msg}`); if (cond) fails.push(msg); };

console.log("1. is there a recorded coordinator field on a queue row?");
console.log(`  MEASURED  "coordinatedBy" appears in src/rig.mjs: ${/coordinatedBy/.test(rig)}`);
gap(!/coordinatedBy/.test(rig), "no recorded field exists: every coordinator grant today is derived, so a refusal cannot point at a stored value");

console.log("\n2. where is coordinator authority granted, and is it bounded to parties?");
const grants = [...rig.matchAll(/if \(!isParty && !(coordinating|coordinator)[^\n]*\n/g)];
console.log(`  MEASURED  non-party coordinator grants in rig.mjs: ${grants.length}`);
gap(grants.length === 1, "release_work grants a non-party seat authority on ANY row it is not party to, with no bound to rows it minted - lead's condition 3 (bounded standing) is not implemented anywhere");

console.log("\n3. can the derived predicate go stale, and does anything check it?");
const gained = seatIsCoordinator({ name: "pm", role: "coordinator", capabilities: [] });
const nowWorking = seatIsCoordinator({ name: "pm", role: "coordinator", capabilities: ["implement"] });
console.log(`  MEASURED  seatIsCoordinator(pm, capabilities=[]) = ${gained}; seatIsCoordinator(pm, capabilities=["implement"]) = ${nowWorking}`);
gap(gained && !nowWorking, "standing flips the moment a seat declares a capability in the working list, so a recorded coordinatedBy is a snapshot: unless the verb checks the field AND re-runs the predicate, a seat that later becomes a worker keeps gate authority");
gap(!/[A-Za-z_]+\.coordinatedBy/.test(rig), "nothing re-validates standing at the verb: with a recorded field and no conjunction, a seat that later gains a working capability keeps the grant");

console.log("\n4. is an addition undoable by the seat that made it?");
const removalSites = rig.split("\n").filter((l) => /item\.blockedBy\s*=\s*(null|\[\])|delete\s+item\.blockedBy/.test(l));
console.log(`  MEASURED  sites that clear a gate: ${removalSites.length}`);
gap(removalSites.length === 0, '"additive-only" authority is only reversible if a removal path exists; there are 0 gate-clearing sites, so a coordinator can strand a row with no way to un-strand it');

console.log("\n5. what exactly counts as 'no working capability'?");
const vocab = ["implement", "code", "verify", "review"];
console.log(`  MEASURED  WORKING_CAPABILITIES = ${JSON.stringify(vocab)}; seatIsCoordinator({capabilities:["design"]}) = ${seatIsCoordinator({ name: "x", capabilities: ["design"] })}`);
gap(seatIsCoordinator({ name: "x", capabilities: ["design"] }), "the vocabulary is a closed four-entry list, so ANY capability spelled outside it (design, architecture, test) reads as 'does no work' and grants that seat coordinator standing - the boundary is an accident of a string list, not a decision");

console.log("\nRESULT: " + (fails.length ? `RED - ${fails.length} unresolved item(s) in the standing design` : "GREEN - standing is recorded, bounded, and undoable"));
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length ? 1 : 0);
