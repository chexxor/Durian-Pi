#!/usr/bin/env node
/*
 * adr-canonical-order-6731.mjs — can a citation be resolved to ONE decision? (#6731)

 The rename pass needs a rule, not a wish list. This probe measures what the file actually is:
   1. how many heading numbers are shared, and whether the sharing is a duplicate or two decisions;
   2. whether a bare citation like "see D115" can resolve;
   3. whether provisional numbers minted on branches are marked so a landing pass can re-mint them.

 Run: node tools/probes/adr-canonical-order-6731.mjs    exit 1 while any of the three fail.
*/
import { readFileSync } from "node:fs";

const text = readFileSync(process.argv[2] || "docs/DECISIONS.md", "utf8");
const lines = text.split("\n");

const headings = [];
for (let i = 0; i < lines.length; i++) {
	const m = lines[i].match(/^## (D\d+)([a-z]?) — (.*)$/);
	if (m) headings.push({ num: m[1], suffix: m[2], line: i + 1, title: m[3] });
}

const byNum = new Map();
for (const h of headings) byNum.set(h.num, (byNum.get(h.num) ?? []).concat(h));

const collisions = [...byNum.entries()].filter(([, list]) => list.length > 1);
const identical = [];
const distinct = [];
for (const [num, list] of collisions) {
	const seen = new Set();
	for (const h of list) {
		const key = h.title.split(" (")[0].trim().toLowerCase();
		if (seen.has(key)) identical.push(`${num}: line ${h.line} restates the entry at line ${list.find((x) => x.title.split(" (")[0].trim().toLowerCase() === key).line}`);
		else seen.add(key);
	}
	const uniq = new Set(list.map((h) => h.title.split(" (")[0].trim().toLowerCase()));
	if (uniq.size > 1) distinct.push(`${num}: ${uniq.size} different decisions share one number (lines ${list.map((h) => h.line).join(", ")})`);
}

console.log(`MEASURED  ${headings.length} ADR headings; ${collisions.length} numbers shared by more than one entry`);
console.log(`  verbatim restatements to dedupe: ${identical.length}`);
for (const s of identical.slice(0, 12)) console.log(`    ${s}`);
console.log(`  genuinely different decisions sharing a number (need suffixes): ${distinct.length}`);
for (const s of distinct) console.log(`    ${s}`);

const suffixed = headings.filter((h) => h.suffix);
console.log(`MEASURED  headings carrying a suffix letter: ${suffixed.length}`);

const bareRefs = new Map();
for (const [num, list] of byNum) {
	if (list.length < 2) continue;
	const mentions = (text.match(new RegExp(`\\bD${num}\\b`, "g")) || []).length - list.length;
	if (mentions > 0) bareRefs.set(num, mentions);
}
console.log(`MEASURED  bare citations to a shared number elsewhere in the file: ${bareRefs.size} numbers, ${[...bareRefs.values()].reduce((a, b) => a + b, 0)} mentions`);
for (const [num, n] of [...bareRefs].slice(0, 10)) console.log(`    "D${num}" used ${n} time(s) with ${byNum.get(num).length} entries behind it`);

const provisional = headings.filter((h) => /provisional|minted at land/i.test(h.title));
console.log(`MEASURED  provisional headings (minted on a branch, awaiting re-mint): ${provisional.length}`);
for (const h of provisional) console.log(`    ${h.num} line ${h.line}: ${(h.title.match(/item #\d+/i) ? "names its item" : "NO item id - the re-mint cannot be traced")}`);

const failures = [];
if (collisions.length) failures.push(`${collisions.length} shared numbers: a citation like "see D${collisions[0][0]}" names more than one decision`);
if (identical.length) failures.push(`${identical.length} verbatim restatements; keep the first and turn the rest into a pointer, never delete the heading`);
if (distinct.length) failures.push(`${distinct.length} numbers carry two or more distinct decisions and must be suffixed in file order`);
if (bareRefs.size) failures.push(`${bareRefs.size} bare citations point at a shared number; a checker must refuse them`);
if (provisional.some((h) => !/item #\d+/i.test(h.title))) failures.push("a provisional heading without its item id cannot be re-minted at land - the provenance is lost");

console.log(failures.length ? `\nRESULT: RED - ${failures.length} rule(s) not yet enforced` : "\nRESULT: GREEN");
process.exit(failures.length ? 1 : 0);
