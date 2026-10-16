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
import { join } from "node:path";

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

for (const rigFile of ["rig.starter.json", "rig.selfdev.json"]) {
	const path = join(root, rigFile);
	const spec = JSON.parse(readFileSync(path, "utf8")); // parse first: refuse invalid JSON
	const seats = spec.seats ?? [];
	const seatTexts = seats.map((s) => withDisciplineBlock(typeof s.instructions === "string" ? s.instructions : ""));
	const needsInline = spec.constitutionInline !== constitutionNew;
	const needsSeats = seats.some((s, i) => s.instructions !== seatTexts[i]);
	if (!needsInline && !needsSeats) {
		note(true, `${rigFile}: already amended`);
		continue;
	}
	const updates = {};
	if (needsInline) updates.constitutionInline = [constitutionNew];
	if (needsSeats) updates.instructions = seatTexts;
	let raw = readFileSync(path, "utf8");
	for (const [key, values] of Object.entries(updates)) {
		const res = updateJsonLines(raw, key, values);
		if (!res.ok) {
			note(false, `${rigFile}: ${key} lines updated ${res.updated}/${res.expected} — refusing to write a partial`);
			raw = null;
			break;
		}
		raw = res.raw;
	}
	if (raw === null) continue;
	const reparse = JSON.parse(raw);
	if (reparse.constitutionInline !== constitutionNew) {
		note(false, `${rigFile}: constitutionInline does not equal new constitution after edit`);
		continue;
	}
	if (reparse.seats.some((s, i) => s.instructions !== seatTexts[i])) {
		note(false, `${rigFile}: seat instructions mismatch after edit`);
		continue;
	}
	writeFileSync(path, raw, "utf8");
	note(true, `${rigFile}: constitutionInline mirrored + ${seats.length} seats' discipline set to the current block (parse-verified)`);
}

// --- final self-check ----------------------------------------------------------
const c = readFileSync(constitutionPath, "utf8");
for (const rigFile of ["rig.starter.json", "rig.selfdev.json"]) {
	const spec = JSON.parse(readFileSync(join(root, rigFile), "utf8"));
	note(spec.constitutionInline === c, `${rigFile}.constitutionInline === constitution.txt (final byte check)`);
}
const selfdevFinal = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
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
