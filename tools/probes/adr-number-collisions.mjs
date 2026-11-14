#!/usr/bin/env node
/*
 * adr-number-collisions.mjs — the decision log has duplicate ADR numbers, so "see D115" is
 * ambiguous and a landing pass that mints "the next free number" can mint one that already exists.
 *
 * It answers the three questions the rename pass needs, mechanically, so the fix is not a judgement
 * call per entry:
 *   1. Is a colliding pair a DUPLICATE (byte-identical body) or two DISTINCT decisions?
 *   2. Which entry is canonical, by the rule "the first mint in file order keeps the bare number"?
 *   3. How many citations point at the bare number, and where - so the pass can be a checklist.
 *
 * Exit 1 while any number is used by more than one entry.
 * Run: node tools/probes/adr-number-collisions.mjs
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const DECISIONS = join(import.meta.dirname, "../../docs/DECISIONS.md");
const text = readFileSync(DECISIONS, "utf8");
const lines = text.split("\n");

const headings = [];
lines.forEach((line, i) => {
	const m = /^## (D\d+)\b(.*)$/.exec(line);
	if (m) headings.push({ num: m[1], title: m[2].trim().slice(0, 80), line: i + 1 });
});

const bodyOf = (idx) => {
	const end = idx + 1 < headings.length ? headings[idx + 1].line - 1 : lines.length;
	return lines.slice(headings[idx].line - 1, end).join("\n");
};

const byNum = new Map();
headings.forEach((h, i) => byNum.set(h.num, (byNum.get(h.num) ?? []).concat({ ...h, index: i })));

const collisions = [...byNum.entries()].filter(([, list]) => list.length > 1);
console.log(`${headings.length} ADR entries; ${collisions.length} number(s) used more than once.\n`);

let duplicateEntries = 0;
let distinctEntries = 0;
for (const [num, list] of collisions) {
	console.log(`  ${num}: ${list.length} entries`);
	for (const e of list) console.log(`    line ${e.line}: ${e.title}`);
	if (list.length === 2) {
		const a = bodyOf(list[0].index);
		const b = bodyOf(list[1].index);
		const identical = a === b;
		console.log(`    DISPOSITION: ${identical ? "DUPLICATE - bodies byte-identical" : "DISTINCT - different decisions sharing a number"}`);
		console.log(`    CANONICAL: ${num} = line ${list[0].line} (first mint in file order); ${identical ? "the second copy is DELETED" : `the second becomes ${num}b at line ${list[1].line}`}`);
		if (identical) duplicateEntries += 1; else distinctEntries += 1;
	} else {
		console.log(`    DISPOSITION: ${list.length} entries - dedupe any byte-identical pair, then suffix the rest b, c, ... in file order`);
		for (let i = 1; i < list.length; i++) {
			const isDup = bodyOf(list[i].index) === bodyOf(list[0].index);
			console.log(`      line ${list[i].line}: ${isDup ? "DUPLICATE of the first (delete)" : `DISTINCT -> ${num}${String.fromCharCode(97 + i)}`}`);
			if (isDup) duplicateEntries += 1; else distinctEntries += 1;
		}
	}
	// citation census: every D<num> mention outside a heading in docs/
	const cites = [];
	for (const file of globSync(join(import.meta.dirname, "../../docs/**/*.{md,json}"))) {
		if (file === DECISIONS) continue;
		readFileSync(file, "utf8").split("\n").forEach((l, i) => {
			if (new RegExp(`\\b${num}\\b`).test(l)) cites.push(`${file}:${i + 1}`);
		});
	}
	console.log(`    CITATIONS outside DECISIONS.md referencing the bare ${num}: ${cites.length}`);
	for (const c of cites.slice(0, 6)) console.log(`      ${c}`);
	if (cites.length > 6) console.log(`      ... ${cites.length - 6} more`);
	console.log("");
}

console.log(`Rule that prevents recurrence: a heading number must be unique; a land pass mints max(existing)+1 ON THE MERGED TREE, and a colliding later land is suffixed, never silently renumbered.`);
console.log(`Fix size: ${duplicateEntries} entries to delete, ${distinctEntries} entries to suffix, ${collisions.length} numbers to disambiguate.`);
if (collisions.length) {
	console.log("consequence: a citation like 'see D115' names two different decisions until the pass runs.");
}
process.exit(collisions.length ? 1 : 0);
