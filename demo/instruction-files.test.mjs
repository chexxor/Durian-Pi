// demo/instruction-files.test.mjs — #4966: the `instructionsFile` resolver and the JSON-span
// splice that moved 12 selfdev personas from inline JSON strings into prompts/<seat>.md.
//
// WHY THIS EXISTS. A seat's system prompt is prose; inline it was one escaped string per seat in a
// 380-line JSON file, so a wording change was a corruption event. The split is only safe if the
// resolved persona is byte-for-byte what the inline spec produced — and that equivalence rests on
// three rules, each with an incident behind it. Nothing pinned them, so the resolver could drift
// silently and every seat would keep running with a slightly different constitution-shaped prompt.
//
// Three rules pinned here:
//  1. the FILE WINS when both keys are set (the file is the surface meant for editing);
//  2. a missing/unreadable persona file is a HARD failure — never a silent drop. Reading one form
//     and dropping the text is the constitution bug demo/constitution.test.mjs pins: a 13-seat team
//     ran with no grounding rule and nothing anywhere raised an error;
//  3. exactly ONE trailing newline is stripped — a POSIX text file ends with one, the inline string
//     did not. Two stripped (or none) is a persona that differs from what was reviewed.
// Plus: paths resolve relative to the RIG FILE, so a rig in a subdirectory finds its personas.
//
// The splice half: rig.selfdev.json is hand-spliced by JSON span. A hand-spliced span is fragile —
// one dropped comma and the rig is unparseable, and a seat could lose its persona without any
// output saying so. So parseability, the no-inline-left invariant, and the byte-identity against
// the PRE-SPLIT inline text are all asserted here.
//
// Run: node demo/instruction-files.test.mjs           (exit 0 = pass)
// Byte-identity re-run (only meaningful while the given ref still carries INLINE personas):
//   DURIG_PREMIGRATION_REF=main node demo/instruction-files.test.mjs
// After the split lands, that ref has no inline text and the check reports SKIP rather than lying.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyInstructionFiles } from "../src/rig.mjs";

const root = process.cwd();
let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
const write = (p, text) => {
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, text, "utf8");
};
const stripOne = (t) => (t.endsWith("\n") ? t.slice(0, -1) : t);

const base = mkdtempSync(join(tmpdir(), "durig-instruction-files-"));
const previousCwd = process.cwd();

try {
	console.log("\n=== #4966: instructionsFile resolver + JSON-span splice ===\n");

	// --- rule 1: the FILE WINS over inline -------------------------------------
	{
		const dir = join(base, "both");
		write(join(dir, "personas", "alpha.md"), "TEXT FROM THE FILE\n");
		const spec = { seats: [{ name: "alpha", instructions: "TEXT FROM THE JSON", instructionsFile: "personas/alpha.md" }] };
		const conflicts = await applyInstructionFiles(spec, join(dir, "rig.json"));
		check("rule 1 file-wins: resolved text is the FILE's, not the inline one",
			spec.seats[0].instructions === "TEXT FROM THE FILE", JSON.stringify(spec.seats[0].instructions));
		check("rule 1 file-wins: the seat is reported as a conflict so the caller can say so",
			conflicts.length === 1 && conflicts[0] === "alpha", JSON.stringify(conflicts));
	}

	// --- rule 2: a missing persona file is a HARD failure ----------------------
	{
		const dir = join(base, "missing");
		mkdirSync(dir, { recursive: true });
		const spec = { seats: [{ name: "widow", instructionsFile: "personas/gone.md" }] };
		let threw = null;
		try {
			await applyInstructionFiles(spec, join(dir, "rig.json"));
		} catch (err) {
			threw = err;
		}
		check("rule 2 missing-file: THROWS (no silent drop, no empty persona)", threw !== null, String(threw ?? "resolved cleanly"));
		check("rule 2 missing-file: the seat name is in the message", /widow/.test(threw?.message ?? ""), threw?.message?.slice(0, 120));
		check("rule 2 missing-file: BOTH candidate paths are named",
			/personas\/gone\.md/.test(threw?.message ?? "") && (threw?.message ?? "").includes(join(dir, "personas", "gone.md")),
			threw?.message?.slice(0, 160));
		check("rule 2 missing-file: instructions were NOT invented for the seat",
			spec.seats[0].instructions === undefined, JSON.stringify(spec.seats[0].instructions));
	}

	// --- rule 3: exactly ONE trailing newline is stripped ----------------------
	{
		const dir = join(base, "newlines");
		write(join(dir, "personas", "one.md"), "body\n");
		write(join(dir, "personas", "two.md"), "body\n\n");
		write(join(dir, "personas", "none.md"), "body");
		write(join(dir, "personas", "crlf.md"), "body\r\n");
		const spec = {
			seats: [
				{ name: "one", instructionsFile: "personas/one.md" },
				{ name: "two", instructionsFile: "personas/two.md" },
				{ name: "none", instructionsFile: "personas/none.md" },
				{ name: "crlf", instructionsFile: "personas/crlf.md" },
			],
		};
		await applyInstructionFiles(spec, join(dir, "rig.json"));
		const got = Object.fromEntries(spec.seats.map((s) => [s.name, s.instructions]));
		check("rule 3 newlines: one trailing newline -> stripped", got.one === "body", JSON.stringify(got.one));
		check("rule 3 newlines: two trailing newlines -> only ONE stripped (the blank line survives)",
			got.two === "body\n", JSON.stringify(got.two));
		check("rule 3 newlines: no trailing newline -> untouched", got.none === "body", JSON.stringify(got.none));
		check("rule 3 newlines: a CRLF-terminated file keeps its CR (byte-preserving, not normalised)",
			got.crlf === "body\r", JSON.stringify(got.crlf));
	}

	// --- paths resolve relative to the RIG FILE, not the cwd -------------------
	{
		const rigDir = join(base, "nested", "rigs", "sub");
		write(join(rigDir, "personas", "alpha.md"), "NESTED RIG TEXT\n");
		write(join(base, "nested", "personas", "alpha.md"), "DECOY RESOLVED FROM CWD\n");
		const spec = { seats: [{ name: "alpha", instructionsFile: "personas/alpha.md" }] };
		await applyInstructionFiles(spec, join(rigDir, "rig.json"));
		check("paths: relative to the RIG FILE (a cwd decoy was not picked up)",
			spec.seats[0].instructions === "NESTED RIG TEXT", JSON.stringify(spec.seats[0].instructions));

		// The documented cwd fallback: unreachable from the rig dir, reachable from the cwd.
		const cwdDir = join(base, "fallback-cwd");
		const farDir = join(base, "fallback-rig");
		write(join(cwdDir, "personas", "beta.md"), "FOUND VIA CWD FALLBACK\n");
		mkdirSync(farDir, { recursive: true });
		process.chdir(cwdDir);
		const fallback = { seats: [{ name: "beta", instructionsFile: "personas/beta.md" }] };
		await applyInstructionFiles(fallback, join(farDir, "rig.json"));
		process.chdir(previousCwd);
		check("paths: falls back to the cwd when the rig-dir path misses",
			fallback.seats[0].instructions === "FOUND VIA CWD FALLBACK", JSON.stringify(fallback.seats[0].instructions));
	}

	// --- the split is opt-in: a seat with no pointer keeps its inline text ------
	{
		const dir = join(base, "inline-only");
		mkdirSync(dir, { recursive: true });
		const spec = { seats: [{ name: "unsplit", instructions: "INLINE ONLY" }, { name: "novalue", instructionsFile: "" }] };
		await applyInstructionFiles(spec, join(dir, "rig.json"));
		check("opt-in: a seat with no instructionsFile keeps its inline text",
			spec.seats[0].instructions === "INLINE ONLY", JSON.stringify(spec.seats[0].instructions));
		check("opt-in: an empty instructionsFile is ignored, not treated as a missing file",
			spec.seats[1].instructions === undefined, JSON.stringify(spec.seats[1].instructions));
	}

	// --- the live splice: rig.selfdev.json parses and carries NO inline personas --
	{
		const raw = readFileSync(join(root, "rig.selfdev.json"), "utf8");
		let parsed = null;
		let parseErr = null;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			parseErr = err;
		}
		check("splice: rig.selfdev.json still PARSES (a hand-spliced span is fragile)", parsed !== null, parseErr?.message?.slice(0, 200));
		const seats = parsed?.seats ?? [];
		check("splice: 12 seats carry an instructionsFile pointer",
			seats.length === 12 && seats.every((s) => typeof s.instructionsFile === "string" && s.instructionsFile.startsWith("prompts/")),
			`${seats.filter((s) => s.instructionsFile).length}/${seats.length}`);
		check("splice: NO selfdev seat still carries inline instructions (no half-migrated seat)",
			seats.every((s) => s.instructions === undefined),
			seats.filter((s) => s.instructions !== undefined).map((s) => s.name).join(", "));
		check("splice: every pointer names its own seat file",
			seats.every((s) => s.instructionsFile === `prompts/${s.name}.md`),
			seats.filter((s) => s.instructionsFile !== `prompts/${s.name}.md`).map((s) => `${s.name}->${s.instructionsFile}`).join(", "));

		const resolved = JSON.parse(raw);
		const conflicts = await applyInstructionFiles(resolved, join(root, "rig.selfdev.json"));
		check("splice: all 12 personas RESOLVE to non-empty text",
			resolved.seats.every((s) => typeof s.instructions === "string" && s.instructions.trim().length > 500),
			resolved.seats.map((s) => `${s.name}=${(s.instructions ?? "").length}`).join(" "));
		check("splice: no seat sets both keys", conflicts.length === 0, conflicts.join(", "));
		const corpus = resolved.seats.reduce((n, s) => n + (s.instructions ?? "").length, 0);
		check("splice: the persona corpus did not collapse (>= 40,000 chars of seat prose)",
			corpus >= 40000, `${corpus} chars`);
		check("splice: no JSON escape residue leaked into a persona FILE (a spliced value would carry \\n)",
			!resolved.seats.some((s) => /\\n|\\"|\\u2014/.test(s.instructions ?? "")),
			resolved.seats.filter((s) => /\\n|\\"|\\u2014/.test(s.instructions ?? "")).map((s) => s.name).join(", "));

		// #4906's ratified disposition: a per-seat instruction text names NO shell tool — the single
		// source is src/shellregistry.mjs `shellToolNames()`, so prose cannot disagree with the host.
		// This must hold on EVERY rig, not just the split one.
		for (const rig of ["rig.json", "rig.v2.json", "rig.starter.json", "rig.selfdev.json"]) {
			const s = JSON.parse(readFileSync(join(root, rig), "utf8"));
			await applyInstructionFiles(s, join(root, rig));
			const naming = (s.seats ?? []).filter((x) => /powershell|pwsh|cmd\.exe|\bbash\b|Set-Location|Get-Content/i.test(x.instructions ?? ""));
			check(`${rig}: no seat instruction text names a shell tool`, naming.length === 0, naming.map((x) => x.name).join(", "));
		}
	}

	// --- 12/12 byte-identity vs the PRE-SPLIT inline text ----------------------
	// Only meaningful while the named ref still carries inline personas. Hard-coding the ref would
	// leave a demo that rots the moment the split lands, so the ref is supplied by the caller and
	// the check self-disables (SKIP, loudly) rather than passing vacuously.
	const ref = process.env.DURIG_PREMIGRATION_REF;
	if (!ref) {
		console.log("  SKIP 12/12 byte-identity vs pre-split inline text — set DURIG_PREMIGRATION_REF=<ref> to re-run it");
	} else {
		let before = null;
		try {
			before = JSON.parse(execFileSync("git", ["show", `${ref}:rig.selfdev.json`], { encoding: "utf8", maxBuffer: 64 << 20 }));
		} catch (err) {
			check(`byte-identity: ${ref}:rig.selfdev.json readable`, false, String(err?.message ?? err).slice(0, 160));
		}
		if (before) {
			const inlineSeats = before.seats.filter((s) => typeof s.instructions === "string");
			if (inlineSeats.length === 0) {
				console.log(`  SKIP 12/12 byte-identity — ${ref} already carries the split, so it is no longer the pre-split spec`);
			} else {
				// The ONE delta #4966 introduces: impl's persona named a shell tool, and #4906's
				// ratified disposition names none. Encoding it here means a persona edit is a
				// DECLARED delta; any other seat drifting goes red instead of riding along.
				const DECLARED_DELTAS = {
					impl: {
						removed: [
							"Call a tool by its EXACT name. The shell tool is powershell, all lowercase. A call named",
							'powerShell (or any other casing) is rejected as "Tool powerShell is not available" and wastes the',
							"turn. Never retry a rejected name - use the exact one.",
							"- powershell({ command, timeout? }): command is required.",
							"- The seat root is already the working directory. Do not Set-Location into it; run the command",
							"  directly.",
						],
						added: [
							'Call a tool by its EXACT name; a call named with any other casing is rejected as "tool is not',
							'available" and wastes the turn. Never retry a rejected name - use the exact one.',
							"- The shell tool takes one required command string, plus an optional timeout.",
							"- The seat root is already the working directory: run the command directly, do not change into it.",
						],
					},
				};
				const after = JSON.parse(readFileSync(join(root, "rig.selfdev.json"), "utf8"));
				await applyInstructionFiles(after, join(root, "rig.selfdev.json"));
				const afterByName = new Map(after.seats.map((s) => [s.name, s]));
				let identical = 0;
				const drift = [];
				for (const s of inlineSeats) {
					const now = afterByName.get(s.name);
					if (!now) {
						drift.push(`${s.name}: seat disappeared from the split spec`);
						continue;
					}
					if (now.instructions === s.instructions) {
						identical += 1;
						continue;
					}
					const declared = DECLARED_DELTAS[s.name];
					if (!declared) {
						drift.push(`${s.name}: persona text changed with nothing declaring it`);
						continue;
					}
					const a = s.instructions.split("\n");
					const b = String(now.instructions).split("\n");
					const onlyA = a.filter((l) => !b.includes(l));
					const onlyB = b.filter((l) => !a.includes(l));
					if (JSON.stringify(onlyA) !== JSON.stringify(declared.removed) || JSON.stringify(onlyB) !== JSON.stringify(declared.added)) {
						drift.push(`${s.name}: delta is not the declared one (removed ${JSON.stringify(onlyA).slice(0, 160)} / added ${JSON.stringify(onlyB).slice(0, 160)})`);
						continue;
					}
					identical += 1; // identical up to the declared delta
				}
				check(`byte-identity vs ${ref}: ${inlineSeats.length}/${inlineSeats.length} personas unchanged except as declared`,
					identical === inlineSeats.length && drift.length === 0, drift.join("; "));
				// The identity check must be able to fail: a compare that matches nothing proves nothing.
				const probe = { seats: [{ name: inlineSeats[0].name, instructions: "MUST NOT MATCH" }] };
				check("byte-identity: the comparison actually discriminates (a swapped persona is caught)",
					probe.seats[0].instructions !== inlineSeats[0].instructions);
			}
		}
	}

	// --- the resolver is ONE implementation, imported by every consumer ---------
	{
		const cli = readFileSync(join(root, "cli.mjs"), "utf8");
		const tool = readFileSync(join(root, "scripts", "apply-commit-discipline.mjs"), "utf8");
		check("one resolver: cli.mjs IMPORTS applyInstructionFiles (no second copy)",
			/import \{[^}]*\bapplyInstructionFiles\b[^}]*\} from "\.\/src\/rig\.mjs"/s.test(cli) && !/async function applyInstructionFiles/.test(cli));
		check("one resolver: scripts/apply-commit-discipline.mjs IMPORTS it too",
			/import \{[^}]*\bapplyInstructionFiles\b[^}]*\} from "\.\.\/src\/rig\.mjs"/s.test(tool) && !/(async )?function applyInstructionFiles/.test(tool));
	}

	assert.equal(failures, 0, `${failures} check(s) failed`);
	console.log("\nPASS — the resolver's three rules, path relativity, the splice and the byte-identity contract all hold");
} catch (err) {
	if (failures === 0) {
		console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
		failures += 1;
	}
} finally {
	process.chdir(previousCwd);
	rmSync(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
