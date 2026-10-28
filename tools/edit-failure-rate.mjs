#!/usr/bin/env node
// Delegate instrument — the edit-tool failure rate this rig actually produces.
//
// Why this exists: `docs/reviews/edit-machinery-2026-10-28.md` had to decide whether another project's
// editing machinery would reduce our edit errors. That is a measurement question, and the raw material is
// the rig's own history: every seat tool result is persisted in the store. Adopting machinery on the
// strength of a competitor's advertised rate is the anti-pattern; this prints OURS, with the patterns it
// counted (a count without its pattern is not evidence — D142).
//
// Read-only. It never opens the store for writing and never quotes message bodies.
//
//   node tools/edit-failure-rate.mjs ./selfdev.sqlite
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2] || "./selfdev.sqlite";
if (!process.argv[2]) console.log("(using ./" + "selfdev.sqlite — pass the store path explicitly in a report)");

const db = new DatabaseSync(path, { readOnly: true });
const count = (sql, ...params) => db.prepare(sql).get(...params).c;

// The strings below are pi's own harness strings, not guesses: vendor/pi-main/packages/coding-agent/src/
// core/tools/edit-diff.ts:256 ("Could not find … exact text"), :260 ("Could not find edits[i]"),
// :267 ("must be unique"). `%[error] %` matches the harness envelope (`<harness>\n[error] …`) that pi puts
// on a failed toolResult, which is why prompt-schema text containing the same words is not counted.
const patterns = {
	errorEnvelope: "%[error] %",
	anchorMiss: "%Could not find%",
	duplicate: "%occurrences of%",
	missingFile: "%ENOENT%",
};

console.log(`store: ${path}  entries: ${count("select count(*) c from entries")}`);
console.log(`patterns counted: ${JSON.stringify(patterns)}\n`);

const TOOLS = ["edit", "write", "read", "bash"];
const rows = [];
for (const tool of TOOLS) {
	const t = `%"toolName":"${tool}"%`;
	const total = count("select count(*) c from entries where record like ?", t);
	const errors = count("select count(*) c from entries where record like ? and record like ?", t, patterns.errorEnvelope);
	rows.push({ tool, total, errors, rate: total ? (errors / total) * 100 : 0 });
}
for (const r of rows)
	console.log(
		`${r.tool.padEnd(6)} toolResults=${String(r.total).padStart(6)}  errors=${String(r.errors).padStart(5)}  rate=${r.rate.toFixed(1)}%`
	);

console.log("\nedit error classes (each is a different remedy):");
	const e = `%"toolName":"edit"%`;
const classes = {
	"anchor miss — oldText not present": count("select count(*) c from entries where record like ? and record like ?", e, patterns.anchorMiss),
	"not unique — Found N occurrences": count("select count(*) c from entries where record like ? and record like ?", e, patterns.duplicate),
	"file missing — ENOENT": count("select count(*) c from entries where record like ? and record like ?", e, patterns.missingFile),
};
for (const [label, n] of Object.entries(classes)) console.log(`  ${label.padEnd(34)} ${n}`);

// Concentration matters: 215 errors spread evenly means "the protocol is wrong"; 215 errors in two
// conversations means "two seats (or one bad turn) produced them" and the remedy is different.
const byConv = db
	.prepare(
		"select conversation_id cid, count(*) c from entries where record like ? and record like ? group by conversation_id order by c desc limit 12"
	)
	.all(e, patterns.errorEnvelope);
console.log("\nedit errors by conversation (desc):");
for (const b of byConv) console.log(`  conv ${b.cid}  ${b.c}`);
console.log(
	"\nNOTE: conversations includes sub-agent conversations, not only seats; names are not resolved here. The delegate's own sessions are NOT in a team store, so this measures the team, not the delegate."
);
