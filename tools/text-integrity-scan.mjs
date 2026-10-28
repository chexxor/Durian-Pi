// tools/text-integrity-scan.mjs — the byte defects a review cannot see, across the WHOLE tracked
// tree. Why it exists: `check`'s `text-integrity` rule inspects only the tracked files that DIFFER
// from HEAD (src/textintegrity.mjs:trackedChangedPaths), so a latent defect in a file nobody has
// touched is invisible — and then lands as an ERROR on the first person who edits that file. Hit live
// on 2026-10-28: amending constitution.txt required re-mirroring rig.starter.json, and
// `node demo/starter.test.mjs` went RED with
// `[no-trailing-newline] rig.starter.json — restore from HEAD (git show HEAD:rig.starter.json)`.
// That file has no final newline in the blob (`git show HEAD:rig.starter.json | tail -c 12` ->
// `"\n}`), a defect that predates the amendment by months and had nothing to do with it.
//
// It uses the PRODUCT detector (src/textintegrity.mjs), not a re-implementation, and reads the
// committed blobs (`rev: "HEAD"`), so it reports what is IN history, not what is dirty. Read-only:
// it runs `git show` and writes nothing.
//
// Usage:
//   node tools/text-integrity-scan.mjs            # report; exit 0
//   node tools/text-integrity-scan.mjs --gate     # exit 1 if any fault of any kind is present
//   node tools/text-integrity-scan.mjs --kinds    # per-fault-kind counts only
//   node tools/text-integrity-scan.mjs -- path ... # restrict to explicit paths (never a tree search)
import { execFileSync } from "node:child_process";
import { readTextIntegrity } from "../src/textintegrity.mjs";

const gate = process.argv.includes("--gate");
const kindsOnly = process.argv.includes("--kinds");
const explicit = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const tracked = explicit.length
	? explicit
	: execFileSync("git", ["ls-files"], { encoding: "utf8" })
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);

// rev/headRev are both HEAD on purpose: the collapse rule needs a BEFORE and there isn't one, so it
// cannot fire, and what is left is exactly the absolute class — BOM, NUL, invalid UTF-8, and a
// missing final newline. That is the latent set.
const found = readTextIntegrity({ paths: tracked, rev: "HEAD", headRev: "HEAD" });

const byKind = new Map();
for (const f of found) for (const fault of f.faults) byKind.set(fault.kind, (byKind.get(fault.kind) ?? 0) + 1);

console.log(`tracked files read at HEAD: ${tracked.length}  ·  files with faults: ${found.length}`);
for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${kind}: ${n}`);
if (kindsOnly) process.exit(gate && found.length ? 1 : 0);

for (const f of found) {
	console.log(`\n${f.path}`);
	for (const fault of f.faults) console.log(`  - ${fault.kind}: ${fault.detail}`);
}
console.log(
	"\nNOTE: these are committed-blob faults. `check` reports text-integrity only for files that differ " +
		"from HEAD, so touching one of these files makes its latent defect YOUR error. Fix the whole class " +
		"as one hygiene change, or expect to trip on it again.",
);
process.exit(gate && found.length ? 1 : 0);
