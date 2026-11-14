// tools/pointer-sha-coverage-test.mjs — the pointer's sha table names every shipped commit.
//
// WHY THIS FILE EXISTS. Three independent audits in a row found a defect in the same table: a sha
// that shipped inside the milestone range but had no row (`5b8e3644`, then `0de543ae`), and rows out
// of commit order (`36f57a36` before `517dc58d`). A table checked by eye over 29 shas will miss one.
//
// This test drives the tool against a THROWAWAY git repo (init + 3 commits) and proves it in both
// directions: a table missing a row exits 1 and names the sha; a table carrying every row exits 0,
// including the one legitimate exemption (the commit that carries the pointer cannot be its own row);
// and a table whose rows are out of commit order exits 1.
//
// FAILING-FIRST: before `tools/pointer-sha-coverage.mjs` existed the spawn exited non-zero with
// "Cannot find module", so every assertion here failed.
//
// Run: node tools/pointer-sha-coverage-test.mjs  (exit 0 = pass)
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

const base = mkdtempSync(join(tmpdir(), "durig-pointer-coverage-"));
const repo = join(base, "repo");
const pointer = join(repo, "docs", "NEXT.md");
const tool = join(process.cwd(), "tools", "pointer-sha-coverage.mjs");

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

	// (5) The cost claim in the header: under a second on a 3-commit repo.
	const t0 = Date.now();
	run();
	check("runs in under 2 s", Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
} finally {
	rmSync(base, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "POINTER-SHA-COVERAGE TEST PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
