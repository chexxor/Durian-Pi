#!/usr/bin/env node
/*
 * note-location-6643.mjs - does a location a ruling asserts actually exist, and can its probe fail? (#6643)

In play:
  1. docs/DECISIONS.md D108 says topic notes live at `docs/notes/<topic>.md`.
  2. docs/reviews/architecture-note-contract-closeout-2026-11-09.md section 4 probe 1 asserts
     "no code path writes to docs/notes/ from a seat tool".

A check that is true in every possible world is not a check. Measured here:
  A. every `docs/<dir>/` literal asserted in the docs resolves to a real directory
  B. whether probe 1 can fail at all
  C. where the note mirror actually lands, and whether that location is worktree-independent
  D. the ruling's cited line numbers vs this tree

 Run: node tools/probes/note-location-6643.mjs   (exit 1 = an asserted location does not exist, or the probe cannot fail)
*/
import { readFileSync, existsSync, readdirSync } from "node:fs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const note = (m) => console.log(`  MEASURED  ${m}`);

console.log("A. locations asserted in the docs");
const docs = ["docs/DECISIONS.md", "docs/reviews/architecture-note-contract-closeout-2026-11-09.md"];
const dirs = new Map();
for (const f of docs) {
	for (const m of readFileSync(f, "utf8").matchAll(/`docs\/([A-Za-z0-9_.-]+)\//g)) {
		const key = `docs/${m[1]}`;
		dirs.set(key, (dirs.get(key) ?? 0) + 1);
	}
}
for (const [dir, hits] of [...dirs.entries()].sort()) {
	const real = existsSync(dir);
	note(`${dir} - asserted ${hits} time(s), directory exists: ${real}`);
	if (!real) check(false, `${dir} is asserted in the docs but does not exist on disk`);
}

console.log("\nB. can the section-4 two-writers probe fail?");
const code = ["extensions/continuity.mjs", "src/rig.mjs", "src/confine.mjs", "cli.mjs"].map((f) => readFileSync(f, "utf8"));
const writers = code.filter((c) => /docs\/notes/.test(c)).length;
note(`seat-tool code paths mentioning docs/notes: ${writers} (checked: extensions/continuity.mjs, src/rig.mjs, src/confine.mjs, cli.mjs)`);
note(`the directory docs/notes: ${existsSync("docs/notes") ? "exists" : "does not exist"}`);
check(
	writers > 0 || existsSync("docs/notes"),
	`probe 1 asserts "no seat tool writes to docs/notes/". Both the writer and the directory are absent, so the assertion is true in every possible world: it can never fail, so it reports PASS forever. That is a vacuous row, not a check`
);

console.log("\nC. where the mirror actually lands");
const continuity = readFileSync("extensions/continuity.mjs", "utf8");
const lines = continuity.split("\n");
const defLine = lines.findIndex((l) => /notesDirCache = raw/.test(l)) + 1;
note(`extensions/continuity.mjs:${defLine}: ${lines[defLine - 1].trim()}`);
const configSets = readdirSync(".").filter((f) => f.endsWith(".json") && /DURIG_NOTES_DIR/.test(readFileSync(f, "utf8")));
note(`config files setting DURIG_NOTES_DIR: ${configSets.length ? configSets.join(", ") : "none"}`);
const { notesDir } = await import("../../extensions/continuity.mjs");
const fromWorktree = await notesDir();
note(`notesDir() with cwd = this item worktree -> ${fromWorktree}`);
const rootMirror = "/home/chexxor/Git/Durian-Pi/.durig/notes";
note(`mirror files at the shared root today: ${existsSync(rootMirror) ? readdirSync(rootMirror).length : 0}`);
check(
	!/item-\d+/.test(fromWorktree),
	`the default is cwd-relative: a seat process whose cwd is its item worktree mirrors its note INSIDE the worktree, which the harness reaps with the branch. Live it lands at the root only because the broker's cwd is the root - the shared location is an accident of process cwd, not a resolved absolute path`
);

console.log("\nD. citation drift");
const anchors = { mirrorNote: 213, '"read_note"': 255, '"write_note"': 276, beforeCompact: 396, notesDir: 71 };
for (const [sym, cited] of Object.entries(anchors)) {
	const needle = sym.startsWith('"') ? sym : sym;
	const found = lines.findIndex((l) => l.includes(needle)) + 1;
	note(`${needle}: ruling cites :${cited}, this tree has it at :${found || "not found"}`);
}
check(lines.findIndex((l) => l.includes("mirrorNote")) + 1 === 214, "mirrorNote is at extensions/continuity.mjs:214 in this tree, not :213 - impl's drift correction is correct; the ruling's citations must be re-derived after the v1.5.1 symbol migration (d3dd1300)");

console.log(`\nRESULT: ${failures.length} finding(s)`);
process.exit(failures.length ? 1 : 0);
