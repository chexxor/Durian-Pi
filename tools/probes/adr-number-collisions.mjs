#!/usr/bin/env node
/*
 * adr-number-collisions.mjs — the decision log has duplicate ADR numbers, so "see D115" is
 * ambiguous and a landing pass that mints the "next" number can mint one that already exists.
 *
   Measured on docs/DECISIONS.md: D111-D119 each appear twice with DIFFERENT titles, and D258 and
   D259 each appear twice (11364/11546 and 11417/11591).
   Exit 1 while any number is used by more than one entry. Run: node tools/probes/adr-number-collisions.mjs
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";

const text = readFileSync(join(import.meta.dirname, "../../docs/DECISIONS.md"), "utf8");
const entries = [];
text.split("\n").forEach((line, i) => {
	const m = /^## (D\d+)\b(.*)$/.exec(line);
	if (m) entries.push({ num: m[1], title: m[2].trim().slice(0, 80), line: i + 1 });
});

const byNum = new Map();
for (const e of entries) byNum.set(e.num, (byNum.get(e.num) ?? []).concat(e));

const collisions = [...byNum.entries()].filter(([, list]) => list.length > 1);
console.log(`${entries.length} ADR entries; ${collisions.length} number(s) used more than once.`);
for (const [num, list] of collisions) {
	console.log(`  ${num}: ${list.length} entries`);
	for (const e of list) console.log(`    line ${e.line}: ${e.title}`);
}
if (collisions.length) {
	console.log("consequence: a citation like 'see D115' names two different decisions, and a landing pass");
	console.log("minting 'the next free number' can mint one that already exists (ROADMAP minting rule).");
}
process.exit(collisions.length ? 1 : 0);
