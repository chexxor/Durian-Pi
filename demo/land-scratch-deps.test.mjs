// demo/land-scratch-deps.test.mjs — the landing gate's scratch carries the dependencies it claims to measure (#5793).
//
// WHY THIS DEMO EXISTS. `scripts/land.mjs --suite` merges in a detached scratch worktree and runs the demos
// THERE. A worktree carries the TRACKED tree only; `node_modules` is gitignored and lives in the working
// checkout. So the gate was measuring a tree with no dependencies: demos that import `@earendil-works/*` died
// with ERR_MODULE_NOT_FOUND, the runner stops at the FIRST red, and a green branch never reached main.
// Measured this session: main at 262/262 green was refused with
// "STOPPED: demo/commit-discipline-personas.test.mjs failed in the scratch worktree (exit 1)".
//
// THREE assertions, each on a fixture whose correct answer is known in advance:
//  1. WITH the checkout's node_modules, the scratch resolves the import and the landing succeeds (main gains
//     the merge commit, the feature sha is an ancestor of main);
//  2. WITHOUT node_modules, the red is labelled as the INSTRUMENT, not the branch, and main does NOT advance;
//  3. a missing node_modules is NOT a blanket refusal — a suite whose demos import nothing external still
//     lands (that is why the gate cannot simply refuse when deps are absent).
//
// Run: node demo/land-scratch-deps.test.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HERE = process.cwd();
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
	if (cond) { pass++; console.log(`  ok ${name}`); }
	else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function git(cwd, ...args) {
	try { return { code: 0, out: execFileSync("git", args, { cwd, encoding: "utf8" }) }; }
	catch (err) { return { code: err.exitCode ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") }; }
}

/** A fixture repo: main + a feature branch. `needsDeps` decides whether the demo imports a package. */
function makeRepo(dir, withDeps, needsDeps) {
	mkdirSync(dir);
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "fixture@example.com");
	git(dir, "config", "user.name", "fixture");

	writeFileSync(join(dir, "README.md"), "# fixture\n");
	// Real repos ignore their dependencies; a fixture that does not is "dirty" and the gate refuses for an
	// unrelated reason before it ever reaches the scratch.
	writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
	mkdirSync(join(dir, "demo"), { recursive: true });
	writeFileSync(
		join(dir, "demo", "dep-marker.test.mjs"),
		needsDeps
			? "import { marker } from \"fixture-marker\";\nconsole.log(marker === \"present\" ? \"resolved\" : \"wrong value\");\nprocess.exit(marker === \"present\" ? 0 : 1);\n"
			: "console.log(\"no external imports here\");\nprocess.exit(0);\n",
	);
	git(dir, "add", "README.md", ".gitignore", "demo/dep-marker.test.mjs");
	git(dir, "commit", "-q", "-m", "base");

	if (withDeps) {
		mkdirSync(join(dir, "node_modules", "fixture-marker"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "fixture-marker", "package.json"), JSON.stringify({ name: "fixture-marker", version: "1.0.0", main: "index.js" }));
		writeFileSync(join(dir, "node_modules", "fixture-marker", "index.js"), "export const marker = \"present\";\n");
	}

	git(dir, "checkout", "-q", "-b", "feature");
	writeFileSync(join(dir, "README.md"), "# fixture\nfeature change\n");
	git(dir, "add", "README.md");
	git(dir, "commit", "-q", "-m", "feature work");
	git(dir, "checkout", "-q", "main");
}

function runLand(dir) {
	// spawnSync, not execFileSync: the gate's environment line is on STDERR and the JSON report is on STDOUT,
	// and a successful run must be checked for BOTH or the environment statement is invisible.
	const r = spawnSync(process.execPath, [join(HERE, "scripts", "land.mjs"), "feature", "--suite", "--repo", dir, "--db", join(dir, "rig.sqlite")], { cwd: HERE, encoding: "utf8", timeout: 120000 });
	const stdout = r.stdout ?? "", stderr = r.stderr ?? "";
	return { code: r.status ?? 1, stdout, stderr, out: stdout + stderr };
}
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const landed = (dir) => git(dir, "log", "-1", "--format=%s", "main").out.trim() === "merge: land feature onto main";

const root = mkdtempSync(join(tmpdir(), "land-scratch-deps-"));
try {
	/* ── 1. dependencies present: the scratch is linked and the landing succeeds ── */
	const a = join(root, "with-deps");
	makeRepo(a, true, true);
	check("the fixture is a git repository with a main branch before landing", git(a, "rev-parse", "--show-toplevel").code === 0, git(a, "rev-parse", "--show-toplevel").out.slice(0, 200));
	const featureSha = git(a, "rev-parse", "feature").out.trim();
	const r1 = runLand(a);
	const j1 = parse(r1.stdout);
	check("landing with a linked scratch exits 0", r1.code === 0, `exit ${r1.code}: ${r1.out.slice(0, 300)}`);
	check("the fixture demo actually ran in the scratch (it resolved the package)", /resolved/.test(r1.out) || (j1?.suite ?? []).some((s) => s.test === "dep-marker.test.mjs" && s.exit === 0), r1.out.slice(0, 300));
	check("the report states what the scratch's environment was", j1?.scratchDeps?.linked === true, JSON.stringify(j1?.scratchDeps));
	check("main advanced: the merge commit exists and the feature sha is an ancestor of main", landed(a) && git(a, "merge-base", "--is-ancestor", featureSha, "main").code === 0, git(a, "log", "--oneline", "main").out);

	/* ── 2. dependencies missing: the red is labelled the INSTRUMENT, and main does not advance ── */
	const b = join(root, "no-deps");
	makeRepo(b, false, true);
	const r2 = runLand(b);
	const j2 = parse(r2.stdout);
	check("the bare-scratch run exits nonzero", r2.code !== 0, `exit ${r2.code}`);
	check("the error names the environment and calls it the INSTRUMENT, not the branch", /node_modules/.test(r2.out) && /ERR_MODULE_NOT_FOUND/.test(r2.out) && /INSTRUMENT, not the branch/.test(r2.out), r2.out.slice(0, 400));
	check("main did NOT advance in that case", !landed(b), git(b, "log", "--oneline", "main").out);
	check("the report carries scratchDeps so the reader sees why", j2?.scratchDeps?.linked === false, JSON.stringify(j2?.scratchDeps));

	/* ── 3. missing deps are NOT a blanket refusal: a suite with no external imports still lands ── */
	const c = join(root, "no-deps-self-contained");
	makeRepo(c, false, false);
	const r3 = runLand(c);
	const j3 = parse(r3.stdout);
	check("a self-contained suite lands even with no node_modules (the gate does not over-refuse)", r3.code === 0 && landed(c), `exit ${r3.code}: ${r3.out.slice(0, 300)}`);
	check("the missing environment is still said out loud", /node_modules MISSING/.test(r3.stderr), r3.stderr.slice(0, 300));

	/* ── the bug was real: a worktree WITHOUT the link genuinely cannot resolve the import ── */
	const bareDir = join(root, "bare-scratch");
	git(b, "worktree", "add", "--detach", bareDir, "main");
	let bare = "";
	try { bare = execFileSync("node", [join(bareDir, "demo", "dep-marker.test.mjs")], { cwd: bareDir, encoding: "utf8", timeout: 30000 }); }
	catch (err) { bare = "ERR:" + (err.stderr ?? err.message); }
	check("a bare worktree of the same fixture really cannot resolve the import", /ERR_MODULE_NOT_FOUND/.test(bare), bare.slice(0, 200));
	git(b, "worktree", "remove", "--force", bareDir);
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
