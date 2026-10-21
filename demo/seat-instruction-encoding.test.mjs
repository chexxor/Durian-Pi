// demo/seat-instruction-encoding.test.mjs — #3241: the text a seat is WOKEN WITH must be
// clean UTF-8, and a mojibaked sequence in it must turn this demo red rather than pass
// silently. A corrupted instruction is worse than a failing suite: every seat then reasons
// from a damaged rule and nothing reports it.
//
// WHAT ACTUALLY HAPPENED (2026-10-20). Two docs in this repo really were double-encoded
// (`docs/runbooks/README.md`, `docs/reviews/docs-gap-audit-2026-10-17.md`) and were repaired
// by `scripts/fix-mojibake.mjs`. The seat instruction SOURCES were NOT corrupted: every
// `instructions` string in the four rig specs, constitution.txt, AGENTS.md and the skill
// files carries a real U+2014 on disk. The mojibake seats SAW was a PowerShell 5.1 read
// artefact (`Get-Content` decodes CP1252), and the corruption that did land came from a
// read-then-write round trip in a seat's shell — reproduced here as:
//
//   Get-Content src.txt | Set-Content -Encoding UTF8 out.txt     # stores U+00E2 U+20AC U+201D
//
// So this guard checks the STORED bytes (the thing a fix can make true) and, separately,
// that the detector actually fires — a guard that matches nothing proves nothing.
//
// Run: node demo/seat-instruction-encoding.test.mjs  (exit 0 = pass)
// Bite proof: DURIG_ENCODING_EXTRA=<a mojibaked file> makes this demo exit 1.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { decodeMojibake, describeHit, findMojibake, isUtf8 } from "../src/text-integrity.mjs";

const root = process.cwd();

// The seat-facing surface: what a seat is woken with, plus the procedure docs it is told to
// read. Kept explicit rather than "every .md in the repo" so that a doc which QUOTES the
// corruption on purpose (docs/NEXT.md line 50 does) does not have to be allow-listed.
const RIG_SPECS = ["rig.json", "rig.v2.json", "rig.starter.json", "rig.selfdev.json"];
const SINGLE_FILES = ["constitution.txt", "AGENTS.md"];
const DIRS = [".agents", "skills", "docs/runbooks"];

function walk(dir, out = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walk(p, out);
		else if (/\.(md|json|txt|mjs)$/.test(entry.name)) out.push(p);
	}
	return out;
}

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

try {
	console.log("\n=== #3241: seat-facing text is clean UTF-8 (no CP1252 mojibake) ===\n");

	// 1. Files: valid UTF-8 on disk, no mojibake sequence, and no BOM (a BOM is what the
	//    same PowerShell round trip leaves behind, and it breaks the byte-compared mirrors).
	const files = [
		...RIG_SPECS.map((f) => join(root, f)),
		...SINGLE_FILES.map((f) => join(root, f)),
		...DIRS.flatMap((d) => walk(join(root, d))),
	];
	// Bite-proof hook: a verifier can point this at a deliberately damaged file and watch
	// the guard go red, without editing a tracked file.
	const extra = (process.env.DURIG_ENCODING_EXTRA ?? "")
		.split(/[;,]/)
		.map((s) => s.trim())
		.filter(Boolean);
	for (const p of extra) files.push(p);

	let scanned = 0;
	for (const file of files) {
		let bytes;
		try {
			bytes = readFileSync(file);
		} catch (err) {
			check(`${relative(root, file)}: readable`, false, err.message);
			continue;
		}
		scanned += 1;
		const name = relative(root, file);
		check(`${name}: valid UTF-8`, isUtf8(bytes));
		const text = bytes.toString("utf8");
		const hits = findMojibake(text);
		check(
			`${name}: no mojibake`,
			hits.length === 0,
			hits.length ? `${hits.length} hit(s): ${hits.slice(0, 3).map(describeHit).join("; ")}` : "",
		);
		check(`${name}: no BOM`, !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
	}
	check("scanned the whole seat-facing surface", scanned >= 8, `scanned ${scanned}`);

	// 2. Parsed instruction strings. A JSON escape (`\u00e2\u20ac\u201d`) survives the byte
	//    check above and only becomes mojibake once the spec is parsed — which is exactly
	//    when a seat reads it. So check the parsed values too, on every string in the spec.
	const strings = (v, path = "", out = []) => {
		if (typeof v === "string") out.push([path, v]);
		else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
		else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
		return out;
	};
	for (const spec of RIG_SPECS) {
		const parsed = JSON.parse(readFileSync(join(root, spec), "utf8"));
		const all = strings(parsed);
		const bad = all.filter(([, s]) => findMojibake(s).length > 0);
		check(`${spec}: every string value clean after parse`, bad.length === 0, bad.map(([p]) => p).slice(0, 3).join(", "));

		const seats = Array.isArray(parsed.seats) ? parsed.seats : [];
		const empty = seats.filter((s) => typeof s.instructions !== "string" || s.instructions.trim() === "");
		check(`${spec}: every seat carries instructions`, seats.length > 0 && empty.length === 0, empty.map((s) => s.name).join(", "));
	}

	// 3. Positive control against the "delete the punctuation" non-fix: the live selfdev
	//    instructions must still contain REAL em dashes. Stripping them to ASCII would make
	//    every check above pass while quietly changing what the seats are told.
	const selfdev = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
	const seatText = selfdev.seats.map((s) => s.instructions ?? "").join("\n");
	check("rig.selfdev.json: instructions still carry U+2014", seatText.includes("\u2014"), `${(seatText.match(/\u2014/g) ?? []).length} em dash(es)`);
	check(
		"rig.selfdev.json: the commit-discipline sentence keeps its em dash",
		seatText.includes("one commit per concern \u2014 the commit message"),
		"the em dash between 'concern' and 'the commit message' is missing",
	);

	// 4. The detector and the repair must actually work, on the exact byte pattern the
	//    Windows round trip produces. Without this the guard above could be vacuous.
	const CORRUPT = "alpha \u00e2\u20ac\u201d beta \u00c2\u00a7 gamma \u00e2\u20ac\u201c delta \u00e2\u02c6\u02c6";
	const CLEAN = "alpha \u2014 beta \u00a7 gamma \u2013 delta \u2208";
	const hits = findMojibake(CORRUPT);
	check("detector: flags the PS 5.1 em-dash pattern", hits.length >= 4, `${hits.length} hit(s)`);
	check("detector: decodes back to the original text", decodeMojibake(CORRUPT) === CLEAN, JSON.stringify(decodeMojibake(CORRUPT)));
	check("detector: clean text is untouched", findMojibake(CLEAN).length === 0 && decodeMojibake(CLEAN) === CLEAN);
	check("detector: repair is idempotent", decodeMojibake(decodeMojibake(CORRUPT)) === CLEAN);
	check("detector: lone non-ASCII letters are not mangled", decodeMojibake("caf\u00e9 na\u00efve") === "caf\u00e9 na\u00efve");
	assert.equal(decodeMojibake(CORRUPT), CLEAN);

	console.log(
		failures === 0
			? `\nPASS — ${scanned} seat-facing file(s) clean UTF-8, no mojibake, detector proven to fire`
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
