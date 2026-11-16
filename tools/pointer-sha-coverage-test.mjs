// tools/pointer-sha-coverage-test.mjs — the pointer's sha table names every shipped commit.
//
// WHY THIS FILE EXISTS. Three independent audits in a row found a defect in the same table: a sha
// that shipped inside the milestone range but had no row (`5b8e3644`, then `0de543ae`), and rows out
// of commit order (`36f57a36` before `517dc58d`). A table checked by eye over 29 shas will miss one.
//
// This test drives the tool against a THROWAWAY git repo (init + 3 commits) and proves it in both
// directions: a table missing a row exits 1 and names the sha; a table carrying every row exits 0,
// including the one legitimate exemption (the commit that carries the pointer cannot be its own row);
// and a table whose rows are out of commit order exits 1. A fifth case covers the ARCHIVE: when the
// pointer is cut its older rows move verbatim to docs/NEXT-ARCHIVE.md, so a row that lives there still
// names the commit (exit 0), and `--no-archive` reproduces the hole (exit 1).
//
// FAILING-FIRST: before `tools/pointer-sha-coverage.mjs` existed the spawn exited non-zero with
// "Cannot find module", so every assertion here failed.
//
// RED FIRST, leg 2 (2026-11-16 — SELFDEV pitfall 428's LAST TWO hand readers): the tool grew its own four-line
// argv reader instead of importing tools/argv-contract.mjs, so its option set was unmeasured. Stage the PRE-change
// tools/ and run THIS test against it —
//   mkdir -p .spike/pc-red5 && git archive HEAD tools scripts src cli.mjs | tar -x -C .spike/pc-red5
//   node tools/pointer-sha-coverage-test.mjs --tool "$(pwd)/.spike/pc-red5/tools/pointer-sha-coverage.mjs"
//   -> **exit 1, 17 ok / 6 FAIL** (`.spike/ptr-red3.out`, 0.7 s, host Linux / Fedora Linux 45 (Forty Five) / kernel
//      7.2.15-300.fc45.x86_64 / node v24.22.1, read in the SAME command): case (8) witnesses the `=` form refusing
//      at 2 while the space form exited 1 (two commands, two verdicts), `--zzz=1` exiting 1 as a MEASUREMENT, and a
//      valueless `--base` falling back to `HEAD~1` and auditing 1 commit while exiting 0. GREEN at this tree: **23 ok
//      / 0 FAIL / exit 0 in 0.7 s**. The legs below pin the two spellings against EACH OTHER (same exit, same range,
//      same holes) rather than against a fixed exit, because case (6) has already added a merge and a carrier to the
//      fixture repo by then — a fixed premise would be a leg of the wrong shape, and one leg of this file's own check
//      signature (`check(label, condition, detail)`, the OPPOSITE order from tools/registration-ledger-gap-test.mjs's
//      `check(condition, label, detail)`) was the trap that made three of them print `ok true` and pass forever.
//
// Run: node tools/pointer-sha-coverage-test.mjs  (exit 0 = pass)
//      node tools/pointer-sha-coverage-test.mjs --tool <path>  (drives a STAGE of the tool — the red-first leg)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// The `--tool` seam is what makes the RED-FIRST evidence above repeatable: a STAGE of the tool (a pre-change
// tools/ unpacked into .spike/) is drivable against the same fixtures, so the legs below fail on the defect rather
// than being asserted. Copy of the idiom shipped by tools/pointer-prose-cut-test.mjs.
const targv = process.argv.slice(2);
const TOOL = (() => {
	const given = targv.includes("--tool") ? targv[targv.indexOf("--tool") + 1] : "tools/pointer-sha-coverage.mjs";
	return given.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(given) ? given : join(process.cwd(), given);
})();
const base = mkdtempSync(join(tmpdir(), "durig-pointer-coverage-"));
const repo = join(base, "repo");
const pointer = join(repo, "docs", "NEXT.md");
const tool = TOOL;

const git = (...args) =>
	spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });

try {
	console.log("\n=== pointer-sha-coverage ===\n");
	spawnSync("mkdir", ["-p", join(repo, "docs")], { encoding: "utf8" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "test@example.invalid");
	git("config", "user.name", "test");
	git("config", "commit.gpgsign", "false");

	// An ANCHOR commit (the milestone base, named by no row) plus three that stand in for shipped
	// objects; the third is the carrier.
	const shas = [];
	for (const n of [0, 1, 2, 3]) {
		writeFileSync(join(repo, `file-${n}.txt`), `object ${n}\n`);
		git("add", `file-${n}.txt`);
		git("commit", "-q", "-m", `object ${n}`);
		shas.push(git("rev-parse", "--short", "HEAD").stdout.trim());
	}
	const [c0, c1, c2, c3] = shas;
	writeFileSync(join(repo, "docs", "NEXT.md"), "# pointer\n");

	const run = (...args) =>
		spawnSync(process.execPath, [tool, "--base", c0, "--file", pointer, ...args], {
			encoding: "utf8",
			cwd: repo,
		});

	// (1) A table with a HOLE: c2 is absent, c3 is the carrier and is exempt. Exit 1, and it names c2.
	writeFileSync(
		pointer,
		["# pointer", "", "| sha | shipped |", "|---|---|", `| \`${c1}\` | the base |`, ""].join("\n"),
	);
	const hole = run();
	check("a table missing a shas exits 1", hole.status === 1, `status=${hole.status}`);
	check("it names the hole", hole.stdout.includes(c2), hole.stdout);
	check(
		"the carrier is exempt, not a hole",
		!hole.stdout.split("\n").some((l) => l.includes("MISSING") && l.includes(c3)),
		hole.stdout,
	);

	// (2) A COMPLETE table: c1 and c2 rows, carrier exempt. Exit 0.
	writeFileSync(
		pointer,
		[
			"# pointer",
			"",
			"| sha | shipped |",
			"|---|---|",
			`| \`${c1}\` | the base |`,
			`| \`${c2}\` | the middle |`,
			"",
		].join("\n"),
	);
	const complete = run();
	check("a complete table exits 0", complete.status === 0, `status=${complete.status}\n${complete.stdout}`);
	check("it reports the carrier by name", complete.stdout.includes(c3), complete.stdout);

	// (3) OUT OF ORDER: c2's row before c1's. Exit 1 with an ordering defect.
	writeFileSync(
		pointer,
		[
			"# pointer",
			"",
			"| sha | shipped |",
			"|---|---|",
			`| \`${c2}\` | the middle |`,
			`| \`${c1}\` | the base |`,
			"",
		].join("\n"),
	);
	const disorder = run();
	check("rows out of commit order exit 1", disorder.status === 1, `status=${disorder.status}`);
	check("it says OUT-OF-ORDER", disorder.stdout.includes("OUT-OF-ORDER"), disorder.stdout);

	// (4) The JSON shape a check rule would read.
	writeFileSync(
		pointer,
		["# pointer", "", "| sha | shipped |", "|---|---|", `| \`${c1}\` | the base |`, ""].join("\n"),
	);
	const json = run("--json");
	let parsed = null;
	try {
		parsed = JSON.parse(json.stdout);
	} catch (e) {
		parsed = null;
	}
	check("--json emits parseable JSON", parsed !== null, json.stdout.slice(0, 200));
	check(
		"--json reports ok:false and the missing sha",
		parsed && parsed.ok === false && parsed.missing.some((m) => m.sha === c2),
		JSON.stringify(parsed && { ok: parsed.ok, missing: parsed.missing }),
	);
	check("--json reports the carrier", parsed && parsed.carrier === c3, JSON.stringify(parsed && parsed.carrier));

	// (5) ARCHIVED ROWS COUNT. The pointer is cut: older blocks move VERBATIM to docs/NEXT-ARCHIVE.md.
	// A range that reaches past the cut cannot close if the tool reads only the live file.
	writeFileSync(
		join(repo, "docs", "NEXT-ARCHIVE.md"),
		["# archive", "", "| sha | shipped |", "|---|---|", `| \`${c2}\` | an older block |`, ""].join("\n"),
	);
	writeFileSync(
		pointer,
		["# pointer", "", "| sha | shipped |", "|---|---|", `| \`${c1}\` | the base |`, ""].join("\n"),
	);
	const withArchive = spawnSync(
		process.execPath,
		[tool, "--base", c0, "--file", pointer, "--archive", "docs/NEXT-ARCHIVE.md"],
		{ encoding: "utf8", cwd: repo },
	);
	check(
		"a row that moved to the archive still names the commit (exit 0)",
		withArchive.status === 0,
		`status=${withArchive.status}\n${withArchive.stdout}`,
	);
	check(
		"it says where the row lives",
		withArchive.stdout.includes("1 in docs/NEXT-ARCHIVE.md"),
		withArchive.stdout,
	);
	const withoutArchive = spawnSync(
		process.execPath,
		[tool, "--base", c0, "--file", pointer, "--no-archive"],
		{ encoding: "utf8", cwd: repo },
	);
	check(
		"--no-archive reproduces the hole (exit 1)",
		withoutArchive.status === 1 && withoutArchive.stdout.includes("MISSING") && withoutArchive.stdout.includes(c2),
		`status=${withoutArchive.status}\n${withoutArchive.stdout}`,
	);

	// (6) WIDTH INDEPENDENCE (the 2026-11-15 addendum). A landing-MERGE row must cover its branch
	// whatever width git's `%h` happens to be. The shipped tool used to bridge its Set of FULL shas with
	// a hardcoded `slice(0, 8)`, which stopped matching the moment git widened `%h` past 8 (measured at
	// `16f70cf8`: 80 FALSE holes, exit 1, over a pointer that was complete). Here `%h` is 7 chars, so the
	// old bridge would miss and this case is falsifiable rather than vacuous.
	git("checkout", "-q", "-b", "side");
	writeFileSync(join(repo, "side.txt"), "side work\n");
	git("add", "side.txt");
	git("commit", "-q", "-m", "the side work");
	git("checkout", "-q", "main"); // no staged-but-uncommitted file here: a dirty index refuses the merge
	git("merge", "-q", "--no-ff", "-m", "merge: land side onto main", "side");
	const merge = git("rev-parse", "--short", "HEAD").stdout.trim();
	writeFileSync(join(repo, "carrier2.txt"), "carrier\n");
	git("add", "carrier2.txt");
	git("commit", "-q", "-m", "the carrier that holds the pointer");
	writeFileSync(pointer, ["# pointer", "", "| sha | shipped |", "|---|---|", `| \`${merge}\` | merge: land side onto main |`, ""].join("\n"));
	const wide = spawnSync(process.execPath, [tool, "--base", c3, "--file", pointer], { encoding: "utf8", cwd: repo });
	check("a merge row covers its branch at a 7-char %h (exit 0)", wide.status === 0, `status=${wide.status}\n${wide.stdout}`);
	check("it says the side commit is COVERED, not a hole", wide.stdout.includes("covered: 1 commit(s)"), wide.stdout);
	check("the side commit is not reported MISSING", !wide.stdout.includes("MISSING"), wide.stdout);

	// (7) The cost claim in the header: under a second on a small repo.
	const t0 = Date.now();
	run();
	check("runs in under 2 s", Date.now() - t0 < 2000, `${Date.now() - t0} ms`);

	// (8) ONE option reader (tools/argv-contract.mjs). SELFDEV pitfall 426's class on THIS tool: a reader that
	// takes only one spelling makes the other a SILENT DEFAULT (or, here, a refusal the next session cannot
	// work around), and an option nobody knows is DROPPED while the verdict still prints green. The legs below
	// pin the three things the migration must hold: the two spellings are ONE option, an unknown option REFUSES
	// by name at exit 2, and an option given no value REFUSES rather than falling back to a narrower range.
	{
		const completeTable = [
			"# pointer", "", "| sha | shipped |", "|---|---|",
			`| \`${c1}\` | the base |`, `| \`${c2}\` | the middle |`, "",
		];
		writeFileSync(pointer, completeTable.join("\n"));
		// The two spellings run against the SAME repo state and the SAME table, so the pin is "one option, one
		// verdict" rather than a fixed exit: case (6) above has already added a merge and a carrier to this repo,
		// so the range here is not the range case (2) audited, and asserting 0 would be a premise of the wrong shape.
		const eqForm = spawnSync(
			process.execPath,
			[tool, `--base=${c0}`, `--file=${pointer}`, "--json"],
			{ encoding: "utf8", cwd: repo },
		);
		const spForm = spawnSync(
			process.execPath,
			[tool, "--base", c0, "--file", pointer, "--json"],
			{ encoding: "utf8", cwd: repo },
		);
		const parse = (s) => {
			try { return JSON.parse(s); } catch { return null; }
		};
		const eqJson = parse(eqForm.stdout);
		const spJson = parse(spForm.stdout);
		check(
			"the `=` form is ONE option with the space form (same exit)",
			eqForm.status === spForm.status,
			`eq=${eqForm.status} space=${spForm.status} stderr=${String(eqForm.stderr).slice(0, 200)}`,
		);
		check(
			"and the SAME range audited — a `=` form that narrowed the range is the false green of pitfall 398",
			eqJson && spJson && eqJson.rangeCommits === spJson.rangeCommits && eqJson.tableRows === spJson.tableRows,
			`eq range=${eqJson?.rangeCommits} rows=${eqJson?.tableRows} | space range=${spJson?.rangeCommits} rows=${spJson?.tableRows}`,
		);
		check(
			"and the same holes reported",
			eqJson && spJson && JSON.stringify(eqJson.missing) === JSON.stringify(spJson.missing),
			`${String(eqForm.stdout).slice(0, 200)} vs ${String(spForm.stdout).slice(0, 200)}`,
		);
		const unknown = spawnSync(
			process.execPath,
			[tool, "--zzz=1", "--base", c0, "--file", pointer],
			{ encoding: "utf8", cwd: repo },
		);
		check(
			"an option this tool does not take REFUSES by name (exit 2)",
			unknown.status === 2,
			`status=${unknown.status} — a silent drop makes the verdict a measurement of something else`,
		);
		check(
			"the refusal names its cause in the grep-able shape",
			String(unknown.stderr).includes("REFUSED cause:"),
			`${String(unknown.stderr).slice(0, 300)}`,
		);
		const valueless = spawnSync(process.execPath, [tool, "--base"], { encoding: "utf8", cwd: repo });
		check(
			"an option given no value REFUSES (exit 2), not a fallback range",
			valueless.status === 2,
			`status=${valueless.status} stdout=${String(valueless.stdout).slice(0, 160)}`,
		);
	}
} finally {
	rmSync(base, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "POINTER-SHA-COVERAGE TEST PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
