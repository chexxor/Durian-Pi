#!/usr/bin/env node
/*
 * detector-blindspots-6679.mjs — can the standing gate certify a class it never saw? (#6679 / #6518)

 pm's amendment to #6518 claims three blind spots in the gate that is supposed to close the
 authority-before-state class:
   1. the detector pattern `/\b(it|item)\.to !== me|\b(it|item)\.from !== me/` does not match
      `release_work`'s authority test, which is written as `isParty` - so the gate reports PASS on
      the verb it cites as the model;
   2. bodies are sliced at `name: "<verb>_work"`, so once the check moves into a shared helper every
      verb reads PASS and the helper is never scanned;
   3. the gate reads `src/rig.mjs` through `process.cwd()`, so a verify pass run from a scratch tree
      certifies whichever file that cwd happens to resolve to.

 This probe does not argue about it. It builds synthetic trees from the real src/rig.mjs, runs the
 REAL gate (tools/probes/verb-ordering.mjs and tools/probes/authority-symmetry.mjs) against each tree
 as a child process, and reports what the gate actually says.

 Run: node tools/probes/detector-blindspots-6679.mjs   exit 1 while a blind spot is open.
*/
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // the tree the probe lives in
const dir = join(ROOT, "tmp-6679-blindspot");
const gaps = [];
const say = (cond, msg) => { console.log(`  ${cond ? "GAP   " : "CLOSED"}  ${msg}`); if (cond) gaps.push(msg); };

const realSrc = readFileSync(join(ROOT, "src/rig.mjs"), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

function runGate(treeSrc, gate) {
	mkdirSync(join(dir, gate, "src"), { recursive: true });
	writeFileSync(join(dir, gate, "src", "rig.mjs"), treeSrc);
	const r = spawnSync("node", [join(ROOT, "tools", "probes", gate + ".mjs")], {
		cwd: join(dir, gate),
		encoding: "utf8",
	});
	const out = (r.stdout ?? "").toString();
	const verbLines = out.split("\n").filter((l) => /^\s+(PASS|FAIL)\s/.test(l));
	return { exit: r.status, out, verbLines, passed: verbLines.filter((l) => l.includes("PASS")).length, failed: verbLines.filter((l) => l.includes("FAIL")).length };
}

console.log("Trees (all derived from the real src/rig.mjs, sha printed so the verdict names its tree):");
const authorityRemoved = realSrc
	.replace(/const isParty = item\.to === me \|\| item\.from === me;/g, "const isParty = true; // authority check removed")
	.replace(/item\.to !== me/g, "false /* authority removed */")
	.replace(/item\.from !== me/g, "false /* authority removed */");
const movedToHelper =
	"function admitRow(item, me, verb) {\n  if (!item) return `unknown item`;\n  if (isTerminalItem(item)) return `already ${item.status}`;\n  if (item.to !== me && item.from !== me) return `not a party to #${item.id}`;\n  return null;\n}\n" +
	realSrc
		.replace(/const isParty = item\.to === me \|\| item\.from === me;/g, 'const isParty = admitRow(item, me, "release") === null;')
		.replace(/item\.to !== me/g, 'admitRow(item, me, "verb") !== null')
		.replace(/item\.from !== me/g, 'admitRow(item, me, "verb") !== null');

console.log(`  real        sha ${sha(realSrc)}  authority lines: ${(realSrc.match(/\b(it|item)\.to !== me|\b(it|item)\.from !== me/g) || []).length}`);
console.log(`  no-authority sha ${sha(authorityRemoved)}  authority lines: ${(authorityRemoved.match(/\b(it|item)\.to !== me|\b(it|item)\.from !== me/g) || []).length}`);
console.log(`  helper-moved sha ${sha(movedToHelper)}  authority lines inside helper: ${(movedToHelper.match(/\b(it|item)\.to !== me|\b(it|item)\.from !== me/g) || []).length}`);

/* ---- 1. the model verb ---- */
console.log("\n1. Does the gate see release_work's authority test? (pattern vs isParty)");
const real = runGate(realSrc, "verb-ordering");
const releaseLine = real.verbLines.find((l) => l.includes("release_work")) ?? "(verb not found)";
console.log(`  MEASURED  verb-ordering.mjs on the real tree: ${releaseLine.trim()}`);
console.log(`  MEASURED  release_work contains ${((realSrc.match(/isParty/g) || []).length)} isParty references and 0 matches for the detector pattern`);
say(/no authority refusal/.test(releaseLine), "the gate calls the model verb's authority check invisible. A detector that only matches `x.to !== me` cannot see `!isParty`, so PASS here means 'I did not find the check', not 'the check is in the right order'.");

/* ---- 2. the helper ---- */
console.log("\n2. What happens to the gate when the check moves into the shared helper?");
for (const gate of ["verb-ordering", "authority-symmetry"]) {
	const r = runGate(movedToHelper, gate);
	console.log(`  MEASURED  ${gate}.mjs on the helper-moved tree: exit ${r.exit}, ${r.passed} PASS / ${r.failed} FAIL (${r.verbLines.filter((l) => /no authority refusal|none found/.test(l)).length} verbs reported as having no authority check at all)`);
	say(r.verbLines.some((l) => /no authority refusal|none found/.test(l)), `${gate}.mjs reads a verb with no visible authority check as PASS: once admitRow carries the rule, slicing bodies at \`name: "<verb>_work"\` makes every verb look clean and the helper is never scanned.`);
}

/* ---- 3. authority deleted entirely ---- */
console.log("\n3. Can the gate's per-verb verdicts be green in a tree with NO authority checks?");
for (const gate of ["verb-ordering", "authority-symmetry"]) {
	const r = runGate(authorityRemoved, gate);
	console.log(`  MEASURED  ${gate}.mjs on the no-authority tree: exit ${r.exit}, ${r.passed} verb verdicts PASS / ${r.failed} FAIL`);
	say(r.verbLines.length > 0 && r.verbLines.every((l) => l.includes("PASS")), `${gate}.mjs marks every verb PASS in a tree where every ownership check has been deleted - absence of a pattern is read as satisfaction of a rule. (Its overall exit is still 1, but only because of an unrelated assertion, so the authority class itself reports clean.)`);
}

/* ---- 4. which file did the gate actually read ---- */
console.log("\n4. Which file did the gate actually read?");
const gateSrc = readFileSync(join(ROOT, "tools", "probes", "verb-ordering.mjs"), "utf8");
const cwdRead = /readFileSync\(join\(process\.cwd\(\)/.test(gateSrc);
const namesTree = /rev-parse|sha256|import\.meta\.url/.test(gateSrc);
console.log(`  MEASURED  probe tree sha ${sha(realSrc)}; the same gate, run with cwd=${join(dir, "verb-ordering")}, read sha ${sha(authorityRemoved)}`);
console.log(`  MEASURED  gate resolves its input via process.cwd(): ${cwdRead}; it prints the identity of the tree it read: ${namesTree}`);
say(cwdRead && !namesTree, "a gate whose input is resolved from the caller's directory, and which prints no tree identity, can certify a file it was never pointed at. Run it from a scratch worktree and it reads that scratch, not the branch under review, and prints PASS without saying which bytes it looked at.");

console.log("\n5. The gate's own remediation text carries a line number");
const fixLine = (real.out.match(/as release_work already does at src\/rig\.mjs:\d+/) || ["(none)"])[0];
const actualRelease = realSrc.slice(0, realSrc.indexOf('name: "release_work"')).split("\n").length;
console.log(`  MEASURED  gate says: ${fixLine}; release_work actually starts at line ${actualRelease}`);
say(!fixLine.includes(String(actualRelease)), "the gate's fix instruction names a line number that is wrong at this HEAD. Seats follow pointers; a stale pointer sends them to the wrong verb. Cite the verb name, not the line.");

console.log("\n6. Which verbs does the gate actually cover? Measured from what it prints, not from its list");
const verbsInSource = [...realSrc.matchAll(/name: "([a-z_]+_work)"/g)].map((m) => m[1]);
for (const gate of ["verb-ordering", "authority-symmetry"]) {
	const r = runGate(realSrc, gate);
	const covered = new Set(r.verbLines.map((l) => (l.match(/\b([a-z_]+_work)\b/) || [])[1]).filter(Boolean));
	const missed = verbsInSource.filter((v) => !covered.has(v));
	console.log(`  MEASURED  ${gate}.mjs printed verdicts for ${covered.size} verbs; src/rig.mjs declares ${verbsInSource.length}; never examined: ${missed.join(", ") || "none"}`);
	say(missed.length > 0, `${gate}.mjs never examines ${missed.join(", ")} - including send_work, the mint path where a gate reference is created and where #6673's standing rule must fire. A verb list is a list: a verb added later is invisible to the gate meant to cover the class. Derive the verb set from the source being scanned.`);
}

rmSync(dir, { recursive: true, force: true });
console.log(gaps.length ? `\nRESULT: RED - ${gaps.length} blind spot(s) in the standing gate` : "\nRESULT: GREEN - the gate sees the helper, sees isParty, names its tree, and cannot pass a tree with no authority checks");
process.exit(gaps.length ? 1 : 0);
