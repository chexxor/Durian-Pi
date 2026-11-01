// demo/commit-discipline-personas.test.mjs — #4966: scripts/apply-commit-discipline.mjs must not
// undo the persona split, and a re-run of it must be a NO-OP against the file-based layout.
//
// THE HAZARD. That tool exists to put the commit-discipline block on every surface a seat reads.
// Before #4966 it read `seat.instructions` and wrote `"instructions"` lines. Once personas live in
// prompts/<seat>.md, `seat.instructions` is undefined for every split seat, so the next run of the
// tool either (a) re-inlines persona prose into rig.selfdev.json — silently merging a decision
// nobody re-made — or (b) never reaches the file-backed persona at all, so the block goes stale in
// the prose seats are actually woken with. Measured before the fix: the tool exited 1 against the
// selfdev rig, so "run it again" was never clean and could not be idempotent.
//
// Also pinned: `updateJsonLines` fills `"instructions"` lines in FILE ORDER from a seat-ORDERED
// array. That is only safe while every seat is inline. On a mixed rig the two orders differ and a
// seat's persona lands in ANOTHER seat's line, so the fix must be seat-keyed and this demo must
// catch the misalignment.
//
// Run: node demo/commit-discipline-personas.test.mjs   (exit 0 = pass)

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const SURFACES = ["scripts", "src", "prompts", "constitution.txt", "rig.starter.json", "rig.selfdev.json"];
const base = mkdtempSync(join(tmpdir(), "durig-discipline-personas-"));

function seed() {
	for (const p of SURFACES) {
		if (!existsSync(join(root, p))) {
			// The file-based layout is the thing under test; its absence is a finding, not a crash.
			check(`surface present: ${p}`, false, "the tree carries no file-based persona layout yet");
			continue;
		}
		cpSync(join(root, p), join(base, p), { recursive: true });
	}
	// src/rig.mjs pulls the pi-durable graph; the sandbox needs the tree's modules to run the tool.
	symlinkSync(join(root, "node_modules"), join(base, "node_modules"), "dir");
}

function snapshot() {
	const out = new Map();
	const walk = (rel) => {
		for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) walk(r);
			else out.set(r, readFileSync(join(base, r), "utf8"));
		}
	};
	for (const p of SURFACES) {
		try {
			walk(p); // a directory surface
		} catch {
			out.set(p, readFileSync(join(base, p), "utf8")); // a single-file surface
		}
	}
	return out;
}

function runTool(label) {
	try {
		const stdout = execFileSync("node", ["scripts/apply-commit-discipline.mjs"], { cwd: base, encoding: "utf8" });
		return { code: 0, stdout };
	} catch (err) {
		return { code: err.status ?? 1, stdout: `${err.stdout ?? ""}${err.stderr ?? ""}`, label };
	}
}

try {
	console.log("\n=== #4966: apply-commit-discipline against a file-based rig ===\n");
	seed();
	if (failures > 0) throw new Error("seed incomplete");

	const before = snapshot();
	const run1 = runTool("run1");
	check("run 1 exits 0 (a run that is never clean cannot be idempotent)", run1.code === 0, `exit ${run1.code}: ${run1.stdout.split("\n").filter((l) => l.startsWith("ERR")).join(" | ").slice(0, 300)}`);

	const afterRun1 = snapshot();
	const selfdevRaw = afterRun1.get("rig.selfdev.json");
	const selfdev = JSON.parse(selfdevRaw);
	check("no RE-INLINE: no selfdev seat gained an inline instructions value",
		selfdev.seats.every((s) => s.instructions === undefined),
		selfdev.seats.filter((s) => s.instructions !== undefined).map((s) => s.name).join(", "));
	check("no RE-INLINE: the string \"Commit discipline:\" is not inside rig.selfdev.json",
		!selfdevRaw.includes("Commit discipline"), `${selfdevRaw.length} bytes`);
	check("still 12 file-backed personas",
		selfdev.seats.length === 12 && selfdev.seats.every((s) => typeof s.instructionsFile === "string"),
		`${selfdev.seats.length} seats`);

	// The block must have REACHED the prose seats are woken with — otherwise it went stale in a file
	// the tool never opened.
	const resolved = JSON.parse(selfdevRaw);
	await applyInstructionFiles(resolved, join(base, "rig.selfdev.json"));
	check("the discipline block IS in the resolved text of every seat (via the file, not the JSON)",
		resolved.seats.every((s) => (s.instructions ?? "").includes("Commit discipline:") && (s.instructions ?? "").includes("one commit per concern")),
		resolved.seats.filter((s) => !(s.instructions ?? "").includes("Commit discipline:")).map((s) => s.name).join(", "));
	check("blocks do not stack: exactly one 'Commit discipline:' per persona",
		resolved.seats.every((s) => (s.instructions ?? "").split("Commit discipline:").length === 2),
		resolved.seats.map((s) => `${s.name}=${(s.instructions ?? "").split("Commit discipline:").length - 1}`).join(" "));

	// Idempotency: the SECOND run must change nothing at all.
	const run2 = runTool("run2");
	const afterRun2 = snapshot();
	const changed = [...new Set([...afterRun1.keys(), ...afterRun2.keys()])].filter((k) => afterRun1.get(k) !== afterRun2.get(k));
	check("run 2 exits 0", run2.code === 0, `exit ${run2.code}: ${String(run2.stdout).split("\n").filter((l) => l.startsWith("ERR")).join(" | ").slice(0, 300)}`);
	check("run 2 changed NOTHING (idempotent against the file-based layout)", changed.length === 0, changed.join(", "));
	check("run 2 reported every rig 'already amended'",
		/selfdev\.json: already amended/.test(String(run2.stdout)) && /starter\.json: already amended/.test(String(run2.stdout)),
		String(run2.stdout).split("\n").filter((l) => l.includes("rig") || l.includes("amended")).join(" | ").slice(0, 240));
	// The first run must have had SOMETHING to do or the idempotency check is vacuous.
	const changedByRun1 = [...new Set([...before.keys(), ...afterRun1.keys()])].filter((k) => before.get(k) !== afterRun1.get(k));
	check("run 1 actually acted (otherwise 'run 2 changed nothing' proves nothing)",
		changedByRun1.length > 0, "run 1 was already a no-op on the seeded tree");

	// Mixed rig: seat-ORDERED values must not be written into FILE-ORDERED lines.
	{
		const mix = join(base, "mix");
		mkdirSync(join(mix, "scripts"), { recursive: true });
		cpSync(join(root, "scripts", "apply-commit-discipline.mjs"), join(mix, "scripts", "apply-commit-discipline.mjs"));
		cpSync(join(root, "src"), join(mix, "src"), { recursive: true });
		symlinkSync(join(root, "node_modules"), join(mix, "node_modules"), "dir");
		cpSync(join(root, "constitution.txt"), join(mix, "constitution.txt"));
		mkdirSync(join(mix, "prompts"), { recursive: true });
		const ALPHA = "ALPHA persona only.\n\nCommit discipline: stale block that must be replaced.";
		const BETA = "BETA persona only.\n\nCommit discipline: stale block that must be replaced.";
		writeFileSync(join(mix, "prompts", "alpha.md"), `${ALPHA}\n`);
		writeFileSync(join(mix, "rig.starter.json"), `${JSON.stringify({ constitutionInline: "placeholder", seats: [{ name: "alpha", instructions: ALPHA }] }, null, 2)}\n`);
		// seat 1 is file-backed, seat 2 is inline: ONE inline line exists, and it belongs to BETA.
		writeFileSync(join(mix, "rig.selfdev.json"), `${JSON.stringify({ constitution: "constitution.txt", seats: [{ name: "alpha", instructionsFile: "prompts/alpha.md" }, { name: "beta", instructions: BETA }] }, null, 2)}\n`);
		let mixOut = "";
		let mixCode = 0;
		try {
			mixOut = execFileSync("node", ["scripts/apply-commit-discipline.mjs"], { cwd: mix, encoding: "utf8" });
		} catch (err) {
			mixCode = err.status ?? 1;
			mixOut = `${err.stdout ?? ""}${err.stderr ?? ""}`;
		}
		const mixSpec = JSON.parse(readFileSync(join(mix, "rig.selfdev.json"), "utf8"));
		const byName = new Map(mixSpec.seats.map((s) => [s.name, s]));
		check(`mixed rig: the tool does not corrupt it (exit ${mixCode})`, mixCode === 0, mixOut.split("\n").filter((l) => l.startsWith("ERR")).join(" | ").slice(0, 240));
		check("mixed rig: the inline line still carries ITS OWN seat's prose (BETA), not the first seat's",
			String(byName.get("beta")?.instructions ?? "").includes("BETA persona only") && !String(byName.get("beta")?.instructions ?? "").includes("ALPHA persona"),
			JSON.stringify(String(byName.get("beta")?.instructions ?? "").slice(0, 120)));
		check("mixed rig: the file-backed seat's prose stayed in ITS FILE and is not inline",
			byName.get("alpha")?.instructions === undefined && readFileSync(join(mix, "prompts", "alpha.md"), "utf8").includes("ALPHA persona only"),
			JSON.stringify({ inline: byName.get("alpha")?.instructions, file: readFileSync(join(mix, "prompts", "alpha.md"), "utf8").slice(0, 60) }));
		check("mixed rig: an inline seat still gets its block refreshed (the old job still works)",
			String(byName.get("beta")?.instructions ?? "").includes("one commit per concern"),
			JSON.stringify(String(byName.get("beta")?.instructions ?? "").slice(-120)));
	}

	if (failures === 0) console.log("\nPASS — the tool cannot re-inline a split persona, is idempotent, and is seat-keyed");
	else console.log(`\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	if (err?.message !== "seed incomplete") {
		console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
		failures += 1;
	}
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch {
		/* scratch teardown is not a verdict */
	}
}

process.exit(failures === 0 ? 0 : 1);
