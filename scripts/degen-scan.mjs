// scripts/degen-scan.mjs — validate the prose-degeneration registry against a REAL store.
//
// Why this exists: D78's prose heuristic was enabled WITHOUT a scan of the seats' real pages and
// false-positived on five healthy seats the moment it went live (docs/DECISIONS.md D78 REVERTED).
// The lesson is that a context-resetting heuristic must be validated against every seat's actual
// transcript with ZERO false positives BEFORE it is enabled. This script IS that validation: it
// runs the SHIPPED detector (src/attention.mjs) over every assistant turn in a store and prints
// each turn the registry matches, so a human can confirm each match is a genuine loop and the
// false-positive count is zero.
//
// Read-only: opens the store read-only and writes nothing. Run against a COPY of a live store so a
// running broker is never disturbed.
//
// Usage: node scripts/degen-scan.mjs [path-to.sqlite]      (default: ./selfdev.sqlite)

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { assistantText, matchTextPatterns } from "../src/attention.mjs";

const storePath = process.argv[2] ?? "./selfdev.sqlite";
if (!existsSync(storePath)) {
	console.error(`no store at ${storePath}`);
	process.exit(2);
}

const db = new DatabaseSync(storePath, { readOnly: true });
const rows = db.prepare("SELECT id, conversation_id, record FROM entries WHERE record LIKE '%pi.assistant%'").all();

let scanned = 0;
const matches = [];
for (const row of rows) {
	let rec;
	try {
		rec = JSON.parse(row.record);
	} catch {
		continue;
	}
	if (rec.kind !== "pi.assistant") continue;
	const text = assistantText(rec);
	if (!text) continue;
	scanned += 1;
	const patterns = matchTextPatterns(text);
	if (patterns.length > 0) matches.push({ id: row.id, conversationId: row.conversation_id, patterns, text });
}

console.log(`store: ${storePath}`);
console.log(`assistant turns scanned: ${scanned}`);
console.log(`turns matched by the registry: ${matches.length}`);
for (const m of matches) {
	const tail = m.text.replace(/\s+/g, " ").slice(-140);
	console.log(`  entry ${m.id} conv=${m.conversationId} patterns=${m.patterns.join(",")} tail="…${tail}"`);
}
console.log(
	"\nINSPECT every match above: each must be a genuine degenerate loop. A match that reads as a\n" +
		"healthy document is a FALSE POSITIVE and the pattern must be tightened before it is enabled.",
);
db.close();
