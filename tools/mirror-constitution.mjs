// tools/../mirror-constitution.mjs — regenerate a rig file's `constitutionInline` from
// constitution.txt BYTE-PRECISELY, per docs/runbooks/constitution-amendment.md Do step 2 ("there is
// no script for this yet; edit the JSON field directly, then let the demos prove the match").
//
// Why a script instead of an editor, and why it refuses rather than rewrites:
//  - `JSON.stringify` whole-file rewrites reformat the entire starter (a 1-line change becomes a
//    300-line diff, and the diff is what a reviewer reads).
//  - the starter's inline literal is NOT in plain JSON.stringify form: it escapes apostrophes as
//    \u0027. A naive substring swap silently corrupts it. So this instrument locates the value span,
//    proves the span round-trips to the parsed value, and re-escapes the new text in the SAME style
//    it found, then re-parses and reports the result.
//
// Usage: node tools/mirror-constitution.mjs [--check] [--dry-run] [rigFile ...]
//   --check    report whether each inline copy equals constitution.txt (exit 1 if it drifts)
//   default    rigFile = rig.starter.json
import { readFileSync, writeFileSync } from "node:fs";

const lf = (s) => s.replace(/\r\n/g, "\n");
const args = process.argv.slice(2);
const check = args.includes("--check");
const dry = args.includes("--dry-run");
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) targets.push("rig.starter.json");

let drift = 0;
for (const target of targets) {
	const raw = readFileSync(target, "utf8");
	const constitution = readFileSync("constitution.txt", "utf8");
	const parsed = JSON.parse(raw);
	if (typeof parsed.constitutionInline !== "string") {
		console.log(`${target}: no constitutionInline string (a rig that SOURCES constitution.txt needs no mirror)`);
		continue;
	}
	if (lf(parsed.constitutionInline) === lf(constitution)) {
		console.log(`${target}: inline copy matches constitution.txt (${parsed.constitutionInline.length} chars) — nothing to do`);
		continue;
	}
	drift++;

	// Locate the raw JSON string literal for the value and prove it round-trips before touching it.
	const keyAt = raw.indexOf('"constitutionInline"');
	const valueAt = raw.indexOf('"', raw.indexOf(":", keyAt) + 1);
	let end = valueAt + 1;
	for (;;) {
		if (raw[end] === "\\") {
			end += 2;
			continue;
		}
		if (raw[end] === '"') break;
		end++;
		if (end >= raw.length) throw new Error(`${target}: unterminated constitutionInline literal`);
	}
	const span = raw.slice(valueAt, end + 1);
	if (JSON.parse(span) !== parsed.constitutionInline) {
		throw new Error(`${target}: the located literal does not round-trip to the parsed value; refuse to rewrite`);
	}

	// Re-escape in the style the file already uses (the starter escapes apostrophes as \u0027;
	// JSON.stringify leaves them literal, so a plain stringify would change bytes it had no reason to
	// change and would make the diff unreviewable).
	let literal = JSON.stringify(constitution);
	if (/\\u0027/.test(span) && !/\\u0027/.test(literal)) literal = literal.replace(/'/g, "\\u0027");

	const next = raw.slice(0, valueAt) + literal + raw.slice(end + 1);
	const roundTrip = JSON.parse(next);
	if (lf(roundTrip.constitutionInline) !== lf(constitution)) {
		throw new Error(`${target}: post-write parse does not equal constitution.txt; refusing to write`);
	}
	const prefix = raw.slice(0, valueAt);
	const suffix = raw.slice(end + 1);
	const spanOnly = next.startsWith(prefix) && next.endsWith(suffix);
	console.log(
		`${target}: inline ${parsed.constitutionInline.length} -> ${constitution.length} chars ` +
			`(file ${raw.length} -> ${next.length} bytes); only the value span changed: ${spanOnly}`,
	);
	if (check) {
		console.log(`${target}: DRIFT (run without --check/--dry-run to regenerate the mirror)`);
		continue;
	}
	if (dry) {
		console.log(`${target}: dry run, nothing written`);
		continue;
	}
	writeFileSync(target, next);
	console.log(`${target}: wrote the mirror`);
}
if (check && drift) process.exit(1);
