#!/usr/bin/env node
/*
 * gate-write-surface.mjs — the write surface of a gate, measured (#6361 review).

 Three questions a `gate_work` verb has to answer before it is designed, answerable from the source
 and the live queue mirror without opening the store:
   1. WHO can write a constraint today, and where?
   2. Is the state-before-authority ordering (#5778) actually held by every constraint verb?
   3. How much gate intent lives in prose instead of the field, on the live rig right now?
   4. Is there any path that REMOVES a gate? (additive-only authority needs an exit)

 Run: node tools/probes/gate-write-surface.mjs   (exit 0; FAIL lines are the findings)
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const note = (msg) => console.log(`  MEASURED  ${msg}`);

const rig = readFileSync(join(process.cwd(), "src/rig.mjs"), "utf8");

/* 1. the write surface: which verbs touch the constraint fields? */
const verbs = [...rig.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]).filter((n) => n.endsWith("_work") || n === "peek_queue");
note(`seat verbs in src/rig.mjs: ${verbs.join(", ")}`);
const gateWrites = rig.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /normalizeBlockedBy\(/.test(l));
note(`lines calling normalizeBlockedBy: ${gateWrites.map(([n, l]) => `:${n} ${l.trim().slice(0, 60)}`).join(" | ")}`);
const removed = rig.split("\n").filter((l) => /\.(blockedBy) = (null|\[\])|delete .*\.blockedBy/.test(l));
check(removed.length === 0, `no verb re-writes or clears a row's gate field: the gate is written at mint and never un-written (${removed.length} removal sites found; the only .blockedBy assignment outside the mint path is ${removed[0] ?? "none"})`);

/* 2. ordering: terminality before authority, as #5778 ruled for release_work */
console.log("\nauthority-vs-state ordering per verb (index of the first check that appears in the execute body):");
for (const verb of ["release_work", "revise_work", "cancel_work", "hold_work"]) {
	const at = rig.indexOf(`name: "${verb}"`);
	const block = rig.slice(at, at + 3000);
	const term = block.indexOf("isTerminalItem");
	const status = block.search(/item\.status !== "queued"|item\.status !== "held"|isTerminalItem/);
	const auth = block.search(/item\.to !== me|item\.from !== me/);
	const ordering = status >= 0 && auth >= 0 ? (status < auth ? "state first" : "AUTHORITY first") : "n/a";
	note(`${verb.padEnd(13)} terminal/status check at ${status}, authority check at ${auth} -> ${ordering}`);
}

/* 3. prose gates on the live rig */
const mirrorPath = process.env.MIRROR || "/home/chexxor/Git/Durian-Pi/.durig/queue-all.md";
let lines = [];
try {
	lines = readFileSync(mirrorPath, "utf8").split("\n").filter((l) => /^#\d+ /.test(l));
} catch (err) {
	note(`mirror not readable (${err.message}); the prose count is skipped`);
}
if (lines.length) {
	const prose = /gated|GATED|gate|awaits|before the|sequen|blocked|prerequisite|STACKED/i;
	const withGate = lines.filter((l) => /blockedBy=\d/.test(l));
	const proseOnly = lines.filter((l) => !/blockedBy=\d/.test(l) && prose.test(l.slice(24)));
	note(`live mirror: ${lines.length} non-terminal rows, ${withGate.length} carry a structured gate, ${proseOnly.length} carry gate WORDS in the subject and no field`);
	const workableBody = rig.slice(rig.indexOf("export function workable"), rig.indexOf("export function selectOldestWorkable"));
	check(!/subject|body/.test(workableBody), "workable() reads only status, requires and blockedBy - it never looks at subject or body, so every prose gate above is structurally invisible to claim and wake selection");
}

console.log(`\nRESULT: ${failures.length} finding(s)`);
process.exit(0);
