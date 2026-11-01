// scripts/apply-commit-discipline.mjs — apply the #474 + #475 amendments.
//
// ONE concern: the worktree-scoped commit discipline and its MODEL (per-concern
// commits, item id in the message, local only) on the surfaces seats read.
//  1. constitution.txt — P2 Authority line set to P2_AMENDED (a LINE replacement:
//     idempotent because rewrite-until-equal).
//  2. rig.starter.json + rig.selfdev.json — constitutionInline set BYTE-IDENTICAL to
//     constitution.txt (demo/starter.test.mjs asserts starter inline === txt).
//  3. rig.selfdev.json — EVERY seat's instructions carry the SEAT block: any previous
//     trailing discipline block (from "Commit discipline:" to end) is REPLACED by the
//     current one, so text versions don't stack.
// Run: node scripts/apply-commit-discipline.mjs  (exits nonzero on any mismatch)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// #4966: a seat persona may live in `prompts/<seat>.md` behind `instructionsFile`. The tool must
// go through the product's ONE resolver, or every split seat reads as `instructions: undefined`
// and the discipline block is either dropped from the persona or re-inlined into the JSON.
import { applyInstructionFiles } from "../src/rig.mjs";

const root = process.cwd();
const P2_AMENDED =
	"P2 Authority: work in your item's worktree and commit your item's files there BEFORE completing, " +
	"with explicit file paths only (never `git add -A` or `.`); ONE commit per concern \u2014 the commit " +
	"message names the item id(s) it implements (#N); keep the history legible; never push or publish \u2014 " +
	"the operator holds push capability (grantable via DURIG_ALLOW_PUSH=1 to the delegate). " +
	"If your item has no worktree, do not commit from the shared tree: say so in the completion instead.";

const SEAT_BLOCK =
	"Commit discipline: work in your item's worktree; commit your item's files before completing the item, " +
	"with explicit file paths only (never `git add -A`; list each path); one commit per concern \u2014 the commit " +
	"message names the item id(s) it implements (#N); never push or publish. " +
	"If your item has no worktree, do not commit from the shared tree \u2014 say so in your completion instead.";

const BLOCK_HEAD = "Commit discipline:";
let problems = 0;
function note(ok, label, detail = "") {
	console.log(`${ok ? "ok  " : "ERR "} ${label}${detail ? " -- " + detail : ""}`);
	if (!ok) problems += 1;
}

// --- 1. constitution.txt — replace P2 Authority until it IS the amended line ---
const constitutionPath = join(root, "constitution.txt");
const constitutionOld = readFileSync(constitutionPath, "utf8");
if (!constitutionOld.split("\n").some((l) => l.startsWith("P2 Authority:"))) {
	note(false, "P2 Authority line not found in constitution.txt");
}
const amendedConstitution = constitutionOld
	.replace(/^P2 Authority: .*$/m, P2_AMENDED);
if (amendedConstitution === constitutionOld) {
	note(true, "constitution.txt already carries the amended P2 Authority");
} else {
	writeFileSync(constitutionPath, amendedConstitution, "utf8");
	note(true, "constitution.txt P2 Authority amended");
}
const constitutionNew = readFileSync(constitutionPath, "utf8");
note(
	constitutionNew.split("\n").some((l) => l === P2_AMENDED),
	"constitution.txt: P2 Authority line matches P2_AMENDED byte-for-byte",
);

// --- 2+3 rigs: constitutionInline mirror + per-seat discipline block -----------
/** Surgical per-line update: replaces matching `key` lines' VALUES, preserving indent,
 *  the `"key":  ` spacing, and any trailing comma. */
function updateJsonLines(raw, key, values) {
	const lines = raw.split("\n");
	const keyRe = new RegExp(`^(\\s*)"${key}":\\s*"(?:[^"\\\\]|\\\\.)*"(\\s*,?)\\s*$`);
	let occurrence = 0;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(keyRe);
		if (!m) continue;
		const value = values[occurrence];
		if (value === undefined) break;
		lines[i] = `${m[1]}"${key}":  ${JSON.stringify(value)}${m[2] ?? ""}`;
		occurrence++;
	}
	if (occurrence !== values.length) {
		return { ok: false, updated: occurrence, expected: values.length };
	}
	return { ok: true, raw: lines.join("\n") };
}

/** Replace any trailing discipline block (from BLOCK_HEAD to end) with SEAT_BLOCK. */
function withDisciplineBlock(text) {
	const at = text.indexOf(BLOCK_HEAD);
	const base = at >= 0 ? text.slice(0, at).trimEnd() : text.trimEnd();
	return `${base}\n\n${SEAT_BLOCK}`;
}

/**
 * Seat-KEYED inline replacement (#4966). `updateJsonLines` fills `"instructions"` lines in FILE
 * ORDER from a seat-ORDERED array — safe only while EVERY seat is inline. Once some seats are
 * file-backed the two orders differ, and a seat-ordered array written into file-ordered lines puts
 * one seat's persona into another seat's line. So each seat's own span is located by its exact
 * encoded value and replaced in place, and the tool refuses rather than guesses.
 */
function replaceSeatSpan(raw, seat, value) {
	const span = `"instructions": ${JSON.stringify(seat.instructions)}`;
	const first = raw.indexOf(span);
	if (first === -1 || first !== raw.lastIndexOf(span)) return { ok: false, reason: "inline span not uniquely located" };
	return { ok: true, raw: raw.slice(0, first) + `"instructions": ${JSON.stringify(value)}` + raw.slice(first + span.length) };
}

for (const rigFile of ["rig.starter.json", "rig.selfdev.json"]) {
	const path = join(root, rigFile);
	const spec = JSON.parse(readFileSync(path, "utf8")); // parse first: refuse invalid JSON
	const seats = spec.seats ?? [];
	// Which personas live in files, and where — relative to the rig FILE, the same rule the
	// product's resolver uses.
	const rigDir = dirname(resolve(path));
	const backing = seats.map((s) =>
		typeof s.instructionsFile === "string" && s.instructionsFile !== "" ? join(rigDir, s.instructionsFile) : null,
	);
	// Resolve so `s.instructions` is the text a seat is ACTUALLY given (the file wins over inline).
	await applyInstructionFiles(spec, path);
	const seatTexts = seats.map((s, i) =>
		withDisciplineBlock(backing[i] === null ? String(s.instructions ?? "") : String(readFileSync(backing[i], "utf8")).replace(/\n$/, "")),
	);

	// #4966: a rig may REFERENCE the constitution (`"constitution": "constitution.txt"`) instead of
	// carrying an inline mirror. There is then no `constitutionInline` line to write, and demanding
	// one made this tool exit 1 against the selfdev rig — a run that is never clean cannot be
	// idempotent, so check the reference instead of writing a mirror.
	const mirrorsInline = Object.prototype.hasOwnProperty.call(spec, "constitutionInline");
	const needsInline = mirrorsInline && spec.constitutionInline !== constitutionNew;
	const needsInlineFile = backing.some((p, i) => p !== null && readFileSync(p, "utf8").replace(/\n$/, "") !== seatTexts[i]);
	const needsSeatsInline = seats.some((s, i) => backing[i] === null && s.instructions !== seatTexts[i]);
	if (!needsInline && !needsInlineFile && !needsSeatsInline) {
		note(true, `${rigFile}: already amended`);
		continue;
	}

	let raw = readFileSync(path, "utf8");
	if (needsInline) {
		const res = updateJsonLines(raw, "constitutionInline", [constitutionNew]);
		if (!res.ok) {
			note(false, `${rigFile}: constitutionInline lines updated ${res.updated}/${res.expected} — refusing to write a partial`);
			raw = null;
		} else raw = res.raw;
	}
	// A file-backed seat's block goes back INTO THE FILE. It is never re-inlined.
	if (raw !== null && needsInlineFile) {
		for (const [i, p] of backing.entries()) {
			if (p !== null) writeFileSync(p, `${seatTexts[i]}\n`, "utf8");
		}
		note(true, `${rigFile}: discipline block rewritten in ${backing.filter(Boolean).length} persona FILE(S), not inline`);
	}
	if (raw !== null && needsSeatsInline) {
		for (const [i, seat] of seats.entries()) {
			if (backing[i] !== null || seat.instructions === seatTexts[i]) continue;
			const res = replaceSeatSpan(raw, seat, seatTexts[i]);
			if (!res.ok) {
				note(false, `${rigFile}: seat ${seat.name}: ${res.reason} — refusing to guess which line to write`);
				raw = null;
				break;
			}
			raw = res.raw;
		}
	}
	if (raw === null) continue;
	const reparse = JSON.parse(raw);
	if (mirrorsInline && reparse.constitutionInline !== constitutionNew) {
		note(false, `${rigFile}: constitutionInline does not equal new constitution after edit`);
		continue;
	}
	writeFileSync(path, raw, "utf8");
	note(true, `${rigFile}: parse-verified (${seats.length} seats; ${backing.filter(Boolean).length} file-backed, ${backing.filter((p) => p === null).length} inline)`);
}

// --- final self-check ----------------------------------------------------------
const c = readFileSync(constitutionPath, "utf8");
for (const rigFile of ["rig.starter.json", "rig.selfdev.json"]) {
	const spec = JSON.parse(readFileSync(join(root, rigFile), "utf8"));
	if (Object.prototype.hasOwnProperty.call(spec, "constitutionInline")) {
		note(spec.constitutionInline === c, `${rigFile}.constitutionInline === constitution.txt (final byte check)`);
	} else {
		note(spec.constitution === "constitution.txt", `${rigFile}: constitution SOURCES constitution.txt (no inline mirror to byte-check)`);
	}
}
// #4966: the discipline + model must be present in the RESOLVED text — for split seats that text
// lives in prompts/<seat>.md, so resolve first or this check reads `undefined` and passes vacuously.
const selfdevFinal = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
await applyInstructionFiles(selfdevFinal, join(root, "rig.selfdev.json"));
note(
	selfdevFinal.seats.length > 0
		&& selfdevFinal.seats.every((s) => s.instructions?.includes("Commit discipline:")
			&& s.instructions?.includes("one commit per concern")),
	`every selfdev seat carries the discipline + model (${selfdevFinal.seats.length} seats)`,
);

if (problems > 0) {
	console.error(`${problems} problem(s) — NOT clean`);
	process.exit(1);
}
console.log("AMENDMENT APPLIED");
