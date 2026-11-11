#!/usr/bin/env node
/*
 * note-source-attribution-6668.mjs - can a `proven` verdict be attributed to the seat's own note? (#6668)

src/notecensus.mjs counts a compaction as note-carried when its record contains the literal "CONTINUITY NOTE"
(extension/continuity.mjs:93). Both the seat's own note and the queue seed render through the same function
(`renderNote`, extensions/continuity.mjs:118-126), so the marker cannot tell them apart. The only thing that
does today is the header's "— last written <ISO>", which `renderNote` emits only when `updatedAt` is set
(extensions/continuity.mjs:126), and `seededGoal` (extensions/continuity.mjs:197-203) returns a record with
no `updatedAt` at all. That is an inference from the absence of a second writer, not attribution.

This probe measures the split on the live store and asks the falsifiable question: is there a seat the census
calls PROVEN whose note-carried compactions are all seeds?

Run: node tools/probes/note-source-attribution-6668.mjs [dbPath]    exit 1 if any PROVEN seat has no self-attributed boundary
*/
import { DatabaseSync } from "node:sqlite";
import { readNoteCensus, classifySeat } from "../../../src/notecensus.mjs";
import { renderNote } from "../../../extensions/continuity.mjs";

const dbPath = process.argv[2] ?? "/home/chexxor/Git/Durian-Pi/selfdev.sqlite";
const db = new DatabaseSync(dbPath, { readOnly: true });
const failures = [];
const check = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures.push(m); };
const note = (m) => console.log(`  MEASURED  ${m}`);

try {
	// Pin the discriminator itself, so the attribution test is not resting on prose.
	const seedRender = renderNote({ seat: "impl", itemId: 42, goal: "from the queue" }); // seededGoal returns no updatedAt
	const selfRender = renderNote({ seat: "impl", itemId: 42, goal: "from the seat", updatedAt: "2026-11-11T00:00:00.000Z" });
	check(seedRender.includes("CONTINUITY NOTE") && !seedRender.includes("last written"), "the seed render carries the marker but names no write time - so the marker alone cannot attribute the source");
	check(selfRender.includes("last written"), "a seat's own note render names when it was written - the only attribution the census has today");

	const census = readNoteCensus(dbPath);
	const v = census.totals.verdicts;
	note(`fleet verdicts: ${JSON.stringify(v)}; totals: compactions ${census.totals.compactions}, note ${census.totals.note}, digest ${census.totals.digest}, summariser ${census.totals.summariser}`);

	// Split every note-carried compaction by what the summary can prove about its source.
	const rows = db.prepare(
		`select conversation_id, record from entries where json_extract(record,'$.kind') = 'pi.compaction' and record like '%CONTINUITY NOTE%' order by id`
	).all();
	const byConv = new Map();
	for (const r of rows) {
	 const text = r.record;
	 const self = text.includes("last written");
	 const seeded = !self;
	 const rec = byConv.get(r.conversation_id) ?? { total: 0, self: 0, seeded: 0, sample: "" };
	 rec.total++;
	 if (self) rec.self++; else rec.seeded++;
	 if (!rec.sample) rec.sample = text.slice(0, 220);
	 byConv.set(r.conversation_id, rec);
	}
	note(`note-carried compactions: ${rows.length} total; self-attributed (header carries "last written"): ${[...byConv.values()].reduce((a, r) => a + r.self, 0)}; unattributable (no "last written", the seed shape): ${[...byConv.values()].reduce((a, r) => a + r.seeded, 0)}`);

	const proven = census.seats.filter((s) => s.verdict === "proven");
	console.log("\nPer PROVEN seat: did any boundary carry the seat's OWN note?");
	for (const s of proven) {
		const rec = byConv.get(s.conversationId) ?? { total: 0, self: 0, seeded: 0 };
		note(`  ${String(s.seat).padEnd(12)} conv ${String(s.conversationId).padEnd(7)} note-carried ${rec.total} (self ${rec.self}, seed-shape ${rec.seeded})  noteRevisions ${s.noteRevisions}  write_note calls ${s.writeNoteCalls}`);
		if (rec.self === 0) failures.push(`${s.seat}: verdict proven but 0 self-attributed boundaries`);
	}

	// The strongest single test: is the proven/seeded boundary decided by a fact the census can see?
	const provenTotal = proven.length;
	const provenWithoutAttribution = proven.filter((s) => (byConv.get(s.conversationId)?.self ?? 0) === 0).length;
	note(`PROVEN seats: ${provenTotal}; of them, proven on a boundary the census cannot attribute to the seat's own note: ${provenWithoutAttribution}`);
	check(provenWithoutAttribution === 0, "every PROVEN seat has at least one boundary whose summary names the note it came from (`— last written <ISO>`); today the verdict does not require that");

	// What the marker cannot distinguish, shown rather than asserted.
	const seedShape = [...byConv.values()].find((r) => r.seeded > 0)?.sample;
	if (seedShape) console.log("\nA seed-shape summary (first 220 chars):\n  " + seedShape.replace(/\n/g, "\n  "));

	// The pure shape of the defect: two seats with IDENTICAL boundary facts get different verdicts
	// because of a whole-history boolean, not because either boundary carried a note the seat wrote.
	const identicalBoundary = { compactions: 1, compactionVia: { note: 1, digest: 0, summariser: 0 }, noteToolsOffered: 5 };
	const a = classifySeat({ ...identicalBoundary, noteWritten: true });
	const b = classifySeat({ ...identicalBoundary, noteWritten: false });
	note(`same boundary, note written sometime in the history: verdict ${a.verdict} (${a.why})`);
	note(`same boundary, note never written:              verdict ${b.verdict} (${b.why})`);
	check(a.verdict !== "proven" || a.why.includes("source"), "`proven` states the boundary carried a note the seat wrote; the row it is computed from cannot show that - the only difference from `seeded` is a history boolean");

	console.log("\nWhy this matters for the contract");
	console.log("  `proven` is read by milestone rows as 'the mechanism works for this seat'. The census's own");
	console.log("  `claimed-only` entry admits it cannot tell whether compactions predate the first write; the");
	console.log("  same uncertainty applies to `proven` and is not stated there.");
	process.exit(failures.length ? 1 : 0);
} finally {
	db.close();
}
