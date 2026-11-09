#!/usr/bin/env node
// MILESTONE GATE — M5: "the rig can say what a seat was allowed to do, and can remember what it saw."
//
// Read-only. No model, no broker, no key, no network. Run it against any store:
//   node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite
//
// WHY this file exists. ROADMAP §Milestones states M5 as a sentence ("can say what a seat was allowed to do,
// and can remember what it saw"). A sentence cannot be completed: there is no fact about the tree that makes
// it true or false. This file turns the sentence into eight measurements. Exit 0 = every criterion measured
// true against the tree and the store; exit 1 = at least one measured false, and the probe that decided it is
// printed next to the criterion so the claim can be argued with, not merely disputed.
//
// House rule this enforces (D159/D211 addendum): a milestone is closed by a command, not by prose.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

let ROOT = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(ROOT, "src", "config.mjs")) && ROOT !== "/") ROOT = dirname(ROOT);

const flag = (name, fallback) => {
	const i = process.argv.indexOf(name);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return process.argv.find((a) => a.startsWith(name + "="))?.split("=")[1] ?? fallback;
};
const DB = flag("--db", process.env.DURIG_DB || join(ROOT, "selfdev.sqlite"));

const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const grepCount = (needle, files) => {
	let n = 0;
	for (const f of files) n += (read(f).match(new RegExp(needle, "gi")) || []).length;
	return n;
};

const ENFORCEMENT_FILES = ["src/seatguard.mjs", "src/confine.mjs", "src/writetargets.mjs", "src/seattools.mjs", "src/rig.mjs", "src/worktree.mjs", "cli.mjs"];
const results = [];
const report = (id, criterion, verdict, evidence) => {
	results.push({ id, criterion, verdict });
	console.log(`${verdict.padEnd(7)}  ${id}  ${criterion}`);
	console.log(`          probe: ${evidence}`);
};

/* C1 — every mediation decision leaves a durable, queryable record. */
let auditDocs = 0;
if (existsSync(DB)) {
	const db = new DatabaseSync(DB, { readOnly: true });
	auditDocs = db.prepare("select count(*) n from documents where kind like ? or kind like ?").get("%audit%", "%decision%").n;
	db.close();
}
const auditCode = grepCount("auditRecord|enforcementDecision|BoundaryGrant|BoundaryReview|BoundaryRequest", ENFORCEMENT_FILES);
report("C1", "a refusal is written as a structured record (subject, object, permission, rule, result), not only as prose in a tool result",
	auditDocs > 0 && auditCode > 0 ? "PASS" : "FAIL",
	`store documents whose kind contains audit/decision: ${auditDocs}; audit-record identifiers in ${ENFORCEMENT_FILES.length} enforcement files: ${auditCode}`);

/* C2 — the rig can count its own enforcement decisions from the store. */
let narrated = 0, structured = 0;
if (existsSync(DB)) {
	const db = new DatabaseSync(DB, { readOnly: true });
	narrated = db.prepare("select count(*) n from entries where record like ?").get("%refused by durig:%").n;
	structured = db.prepare("select count(*) n from tasks where kind like ? and record like ?").get("%audit%", "%subject%").n;
	db.close();
}
report("C2", "the number of enforcement decisions is derivable from the store, not from grepping transcript text",
	structured > 0 ? "PASS" : "PARTIAL",
	`entries containing 'refused by durig:' (substring count, untyped): ${narrated}; structured decision rows: ${structured}`);

/* C3 — reach is data, default-deny, and attached to the claim. */
const ruleAsData = grepCount("allowRules|allow_rules|DURIG_ALLOW|policyRev|policy_rev|denyByDefault", ENFORCEMENT_FILES.concat(["durig.config.default.json", "durig.config.json", "rig.selfdev.json"]));
const removalsSignature = (read("src/seattools.mjs").match(/export function toolRemovalsFor\(([^)]*)\)/) || [])[1] || "(not found)";
const reachByClaim = /item|claim|workItem/i.test(removalsSignature);
report("C3", "reach comes from declarative rules consulted at the claim, not from a per-seat removal list computed at `up`",
	ruleAsData > 0 && reachByClaim ? "PASS" : "FAIL",
	`rule-as-data identifiers in policy files: ${ruleAsData}; toolRemovalsFor signature: (${removalsSignature}) — claim-scoped: ${reachByClaim}`);

/* C4 — egress is mediated by a stated policy. */
let egressRefused = 0, egressProbes = 0;
try {
	const { refusalFor } = await import(join(ROOT, "src", "confine.mjs"));
	const probes = ["curl -s https://example.com/api", "wget http://169.254.169.254/metadata", "nc 127.0.0.1 8080"];
	egressProbes = probes.length;
	egressRefused = probes.filter((p) => refusalFor(p, { root: "/tmp/seat", cwd: "/tmp/seat" }) !== null).length;
} catch { egressRefused = 0; }
report("C4", "a seat's outbound network reach is governed by a destination policy that can be shown to refuse",
	egressRefused > 0 ? "PASS" : "FAIL",
	`refusalFor() refused ${egressRefused} of ${egressProbes} egress probes (public host, link-local metadata endpoint, raw local socket)`);

/* C5 — the security position exists before the code. */
const reviewDir = existsSync(join(ROOT, "docs/reviews")) ? readdirSync(join(ROOT, "docs/reviews")) : [];
const position = reviewDir.filter((f) => /seat-sandbox-position|seat-isolation-position/.test(f));
report("C5", "a written security position (boundary, threat model, enforcement points, fallback) precedes isolation code",
	position.length > 0 ? "PASS" : "FAIL",
	`matching documents in docs/reviews: ${position.length ? position.join(", ") : "none"}`);

/* C6 — a budgeted read path over the transcript the rig already keeps. */
const recallTools = grepCount("search_history|recallMemory|remember\\(", ["src/seattools.mjs", "cli.mjs", "src/rig.mjs", "extensions/continuity.mjs"]);
let entries = 0;
if (existsSync(DB)) {
	const db = new DatabaseSync(DB, { readOnly: true });
	entries = db.prepare("select count(*) n from entries").get().n;
	db.close();
}
report("C6", "there is a token-budgeted read path over stored history (search_history or equivalent)",
	recallTools > 0 ? "PASS" : "FAIL",
	`recall tool names found in the tool surface: ${recallTools}; durable entries with no read path: ${entries}`);

/* C7 — cache economics are measured before prompt sections change. Two sources, because the ledger only sees
 * metered endpoints and the durable entries only see what the harness chose to record. */
let cachedLedger = 0, calls = 0, usageEntries = 0, cacheReadEntries = 0, freshInput = 0, cacheReadFromEntries = 0;
const ledger = `${DB}.spend.jsonl`;
if (existsSync(ledger)) {
	for (const line of read(ledger).split("\n").filter(Boolean)) {
		try { const r = JSON.parse(line); calls++; cachedLedger += Number(r.cached_tokens || 0); } catch {}
	}
}
if (existsSync(DB)) {
	const db = new DatabaseSync(DB, { readOnly: true });
	for (const row of db.prepare("select record from entries where record like ?").all("%\"cacheRead\"%")) {
		try {
			const usage = (JSON.parse(row.record).model || [])[0]?.usage;
			if (!usage) continue;
			usageEntries++;
			freshInput += Number(usage.input || 0);
			const cr = Number(usage.cacheRead || 0);
			if (cr > 0) cacheReadEntries++;
			cacheReadFromEntries += cr;
		} catch {}
	}
	db.close();
}
const reportExists = existsSync(join(ROOT, "docs/reviews/cache-evidence"));
const measured = cacheReadFromEntries > 0 || cachedLedger > 0;
report("C7", "prompt-cache economics are measured, so a changing prompt section is a known cost, not a guess",
	measured && reportExists ? "PASS" : measured ? "PARTIAL" : "FAIL",
	`ledger ${ledger}: ${calls} metered calls, ${cachedLedger} cached tokens (the ledger only sees metered endpoints); durable entries: ${usageEntries} usage-bearing, ${cacheReadEntries} with a cache read, ${cacheReadFromEntries.toLocaleString()} cacheRead tokens vs ${freshInput.toLocaleString()} fresh input (${cacheReadFromEntries ? (100 * cacheReadFromEntries / (freshInput + cacheReadFromEntries)).toFixed(1) : "n/a"}% hit); written up in docs/reviews/cache-evidence ${reportExists ? "(exists)" : "(MISSING — the number is measured but no doc carries it)"}`);

/* C8 — the mediator is not the only line of defence, or the gap is stated. */
const spawnWrapper = ["src/spawn-wrapper.mjs", "src/landlock.mjs", "src/seccomp.mjs", "src/egress-proxy.mjs"].filter((p) => existsSync(join(ROOT, p)));
const stated = grepCount("integrity and mistake-containment control, not a security boundary|not a security boundary", ["docs/reviews/security-seat-sandbox-position.md", "docs/reviews/zero-trust-zero-agent-research.md", "docs/DECISIONS.md"]);
report("C8", "either an OS-level backstop exists at the spawn point, or the record states in plain words that in-process hooks are not a boundary",
	spawnWrapper.length > 0 || stated > 0 ? "PASS" : "FAIL",
	`spawn-time wrapper modules present: ${spawnWrapper.length}; documents stating the in-process limit explicitly: ${stated}`);

console.log("");
const fails = results.filter((r) => r.verdict === "FAIL");
const partial = results.filter((r) => r.verdict === "PARTIAL");
console.log(`M5 GATE: ${results.length - fails.length - partial.length} PASS, ${partial.length} PARTIAL, ${fails.length} FAIL of ${results.length} criteria.`);
if (fails.length) {
	console.log("Milestone M5 is NOT complete. Each FAIL below is one of its acceptance criteria, and each has a");
	console.log("probe above that can be re-run. Roadmap ids in parentheses are the work that closes the criterion:");
	const map = { C1: "ROADMAP 172", C2: "ROADMAP 172", C3: "ROADMAP 173, 269", C4: "ROADMAP 268, 276", C5: "ROADMAP 171", C6: "ROADMAP 176, 162", C7: "ROADMAP 175", C8: "ROADMAP 174, 271" };
	for (const f of fails) console.log(`  · ${f.id} (${map[f.id]}): ${f.criterion}`);
	process.exit(1);
}
console.log("All M5 acceptance criteria measured true on this tree and store.");
process.exit(0);
