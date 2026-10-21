// scripts/fix-mojibake.mjs — repair Windows double-encoded text, or report it (#3241).
//
//   node scripts/fix-mojibake.mjs <file...>            # report only; exit 1 if any mojibake
//   node scripts/fix-mojibake.mjs --write <file...>    # rewrite the files as UTF-8
//
// "Mojibake" here means the CP1252 mis-decode described in src/text-integrity.mjs: a UTF-8
// em dash (U+2014) stored as U+00E2 U+20AC U+201D. The repair is a decode, not a search and
// replace: each damaged run is mapped back to bytes through CP1252 and re-decoded as UTF-8,
// so en dashes, section signs, ellipses and arrows are recovered without a table per symbol.
//
// Reading and writing are both explicit utf8, so the repair itself cannot re-damage the file
// (the write is the same operation that caused the damage when it was implicit). Idempotent:
// a second run reports 0 hits. Always pair this with the guard — demo/seat-instruction-encoding.test.mjs
// covers the seat-facing surface, this script covers a file you name.
import { readFileSync, writeFileSync } from "node:fs";

import { decodeMojibake, findMojibake } from "../src/text-integrity.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
	console.error("usage: node scripts/fix-mojibake.mjs [--write] <file...>");
	process.exit(2);
}

let total = 0;
let changed = 0;
for (const file of files) {
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		console.error(`${file}: cannot read -- ${err.message}`);
		process.exitCode = 2;
		continue;
	}
	const hits = findMojibake(text);
	total += hits.length;
	if (hits.length === 0) {
		console.log(`${file}: clean`);
		continue;
	}
	console.log(`${file}: ${hits.length} mojibake sequence(s)`);
	for (const hit of hits.slice(0, 5)) {
		console.log(`  ${hit.index}: ${JSON.stringify(hit.found)} -> ${JSON.stringify(hit.decoded)}`);
	}
	if (hits.length > 5) console.log(`  ... ${hits.length - 5} more`);
	if (write) {
		writeFileSync(file, decodeMojibake(text), "utf8");
		changed += 1;
		console.log(`  rewritten as UTF-8`);
	}
}

if (write) {
	console.log(`\n${changed} file(s) rewritten, ${total} sequence(s) decoded`);
} else {
	console.log(`\n${total} mojibake sequence(s) in ${files.length} file(s)${total ? " -- re-run with --write to repair" : ""}`);
	// A report run is a CHECK: a nonzero exit is what makes it usable in a pipeline.
	if (total > 0) process.exitCode = 1;
}
