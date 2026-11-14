#!/usr/bin/env node
/*
 * gate-detector-coverage.mjs — does the standing gate for "state before authority" (#6518) actually
 * see the authority checks it is supposed to police?

 The gate is a regex over verb bodies: /\b(it|item)\.to !== me|\b(it|item)\.from !== me/. This probe
 feeds it the real src/rig.mjs and asks two questions:
   1. Does it find the authority check in the verb it names as the MODEL (release_work)?
   2. Does it still find an authority check if the check is moved into a shared helper - the fix the
      build rows adopt?

 Run: node tools/probes/gate-detector-coverage.mjs   (exit 1 while the detector is blind)
*/
const src = (await import("node:fs")).readFileSync(new URL("../../../src/rig.mjs", import.meta.url), "utf8");

const verbBodies = {};
const starts = [...src.matchAll(/name: "([a-z_]+_work)"/g)];
for (let i = 0; i < starts.length; i++) {
	const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
	verbBodies[starts[i][1]] = src.slice(starts[i].index, end);
}

const narrow = (l) => /\b(it|item)\.to !== me|\b(it|item)\.from !== me/.test(l);
const broad = (l) => narrow(l) || /\bconst isParty\b|if \(!isParty|coordinating/.test(l);

const fails = [];
const gap = (cond, msg) => {
	console.log(`  ${cond ? "GAP" : "CLOSED"}  ${msg}`);
	if (cond) fails.push(msg);
};

console.log("1. release_work - the verb the gate cites as the reference implementation");
const rel = verbBodies.release_work ?? "";
console.log(`  MEASURED  narrow detector finds ${rel.split("\n").filter(narrow).length} authority lines; broad detector finds ${rel.split("\n").filter(broad).length}`);
gap(rel.split("\n").filter(narrow).length === 0 && rel.split("\n").filter(broad).length > 0,
	"the gate reports release_work as 'no authority refusal' while the verb contains three party/coordinator checks (src/rig.mjs: `const isParty = ...`, `if (!isParty && !coordinating)`)");

console.log("\n2. helper extraction - the shape the fix takes");
const simulated = rel.replace("if (!isParty && !coordinating)", "if (admitRow(item, me, \"release_work\") !== null)");
const helper = "function admitRow(item, me, verb) { if (isTerminalItem(item)) return \"terminal\"; if (item.to !== me && item.from !== me) return \"not-yours\"; return null; }";
const inVerb = simulated.split("\n").filter(narrow).length;
const inHelper = helper.split("\n").filter(narrow).length;
console.log(`  MEASURED  authority lines visible in the verb body after extraction: ${inVerb}; in the helper the gate never scans: ${inHelper}`);
gap(inVerb === 0 && inHelper > 0, "once the authority check lives in admitRow(), every verb reports PASS 'no authority refusal' - the gate goes green on the fix and is blind to any later re-inline");

console.log("\n3. the gate reads the file from process.cwd()");
gap(/join\(process\.cwd\(\), "src\/rig\.mjs"\)/.test(src === "" ? "" : (await import("node:fs")).readFileSync(new URL("../../../tools/probes/verb-ordering.mjs", import.meta.url), "utf8")),
	"tools/probes/verb-ordering.mjs reads src/rig.mjs relative to process.cwd(), so a verify pass run in a scratch worktree can read a different tree than the one it is certifying");

console.log("\nRESULT: " + (fails.length ? `RED - ${fails.length} blind spot(s) in the standing gate` : "GREEN - the detector sees every authority shape and the helper"));
process.exit(fails.length ? 1 : 0);
