// demo/landing-gate.test.mjs — a landing cannot advance main without saying WHICH check ran (#6090).
//
// WHY THIS DEMO EXISTS. `scripts/land.mjs` treated the regression gate as opt-in: with neither
// `--suite` nor `--changed-suite` it merged, advanced main and reported `ok: true`. That is not a
// hypothetical — the landing at 1f6f26c5 advanced main with no gate, and the only reason anyone knew
// was that the report happened to say "not run". An optional gate is a signal; the landing is the
// decision (#3575). The rule now: one of the two flags must be passed, or the lander refuses BEFORE it
// touches git. The one lighter path — documentation only — is not a flag you can wave: it is
// attested and checked against the diff.
//
// FOUR assertions, each on a fixture whose correct answer is known in advance, run against the REAL
// lander (not a model of it):
//  1. a code branch, no gate flag  -> exit 1, the message NAMES the missing flags, main unchanged;
//  2. a gate flag with a value (`--suite=false`, `--changed-suite=`, `--docs-only=off`) -> exit 1,
//     named as unrecognized: a bogus value is not a weaker gate, it is no gate;
//  3. a documentation-only branch with `--changed-suite --docs-only` -> lands, and the report says
//     which AREAS ran and which did NOT (it is not the full gate and says so);
//  4. `--docs-only` asserted on a branch that changes CODE -> refused, naming the offending path.
// Plus the pure decision function, pinned directly: the flag alone is not a gate, an empty diff is not
// an attestation, and prose is prose.
//
// Run: node demo/landing-gate.test.mjs

import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isDocumentationPath, parseGateFlags, requireGate, docsOnlyAttestation } from "../src/landinggate.mjs";

const HERE = process.cwd();
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
	if (cond) { pass++; console.log(`  ok ${name}`); }
	else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function git(cwd, ...args) {
	try { return { code: 0, out: execFileSync("git", args, { cwd, encoding: "utf8" }).toString().trim() }; }
	catch (err) { return { code: err.exitCode ?? 1, out: ((err.stdout ?? "") + (err.stderr ?? "")).trim() }; }
}

/**
 * A fixture repo with an area manifest and a DERIVER, so the lander's real paths are exercised.
 * The deriver is deliberately narrow: it maps `scripts/*` and `demo/*` changes to tests, and DOC
 * changes to nothing — which is exactly the real-world shape that used to sail through ungated.
 */
function makeRepo(dir) {
	mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "fixture@example.com");
	git(dir, "config", "user.name", "fixture");
	writeFileSync(join(dir, ".gitignore"), "node_modules/\nrig.sqlite*\n");
	writeFileSync(join(dir, "README.md"), "# fixture\n");
	mkdirSync(join(dir, "docs"), { recursive: true });
	writeFileSync(join(dir, "docs", "NOTES.md"), "# notes\n");
	mkdirSync(join(dir, "scripts"), { recursive: true });
	writeFileSync(join(dir, "scripts", "widget.mjs"), "export const widget = 1;\n");
	mkdirSync(join(dir, "demo"), { recursive: true });
	writeFileSync(join(dir, "demo", "docs-marker.test.mjs"), "console.log(\"docs area ran\");\nprocess.exit(0);\n");
	writeFileSync(join(dir, "demo", "rig-marker.test.mjs"), "console.log(\"rig area ran\");\nprocess.exit(0);\n");
	writeFileSync(
	join(dir, "demo", "test-areas.json"),
	JSON.stringify({ areas: { docs: ["demo/docs-marker.test.mjs"], rig: ["demo/rig-marker.test.mjs"] } }, null, 2) + "\n",
	);
	mkdirSync(join(dir, "tools"), { recursive: true });
	writeFileSync(
		join(dir, "tools", "what-to-test.mjs"),
		`// fixture deriver: maps changed CODE paths to tests; doc paths to nothing — the real-world gap.\n` +
		`import { execFileSync } from "node:child_process";\n` +
		`const base = (process.argv.find((a) => a.startsWith("--base=")) ?? "").split("=")[1] || "main";\n` +
		`let paths = [];\n` +
		`try { paths = execFileSync("git", ["diff", "--name-only", base + "...HEAD"], { encoding: "utf8" }).split("\\n").filter(Boolean); } catch {}\n` +
		`const selected = paths.filter((p) => p.startsWith("scripts/") || p.startsWith("demo/")).map((p) => p.startsWith("demo/") ? p : "demo/rig-marker.test.mjs");\n` +
		`// what-to-test's real shape: each selection is an OBJECT with a .test field.\n` +
		`console.log(JSON.stringify({ selected: [...new Set(selected)].map((test) => ({ test })) }));\n`,
	);
	git(dir, "add", ".gitignore", "README.md", "docs", "scripts", "demo", "tools");
	git(dir, "commit", "-q", "-m", "base");
}

/** Make a branch off main with the given file changes. */
function makeBranch(dir, branch, changes) {
	git(dir, "checkout", "-q", "-b", branch);
	for (const [path, text] of Object.entries(changes)) {
		if (path.includes("/")) mkdirSync(join(dir, path).replace(/\/[^/]*$/, ""), { recursive: true });
		writeFileSync(join(dir, path), text);
		git(dir, "add", path);
	}
	git(dir, "commit", "-q", "-m", branch);
	git(dir, "checkout", "-q", "main");
}

function runLand(dir, branch, flags) {
	const r = spawnSync(
		process.execPath,
		[join(HERE, "scripts", "land.mjs"), branch, "--repo", dir, "--db", join(dir, "rig.sqlite"), ...flags],
		{ cwd: HERE, encoding: "utf8", timeout: 120000 },
	);
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const landed = (dir) => git(dir, "log", "-1", "--format=%s", "main").out === "merge: land feature onto main" || /merge: land/.test(git(dir, "log", "-1", "--format=%s", "main").out);

const root = mkdtempSync(join(tmpdir(), "landing-gate-"));
try {
	/* ── 1. no gate flag on a code branch: refused, and the message names the flags ── */
	const a = join(root, "no-gate");
	makeRepo(a);
	makeBranch(a, "feature", { "scripts/widget.mjs": "export const widget = 2;\n" });
	const r1 = runLand(a, "feature", []);
	const j1 = parse(r1.stdout);
	check("landing with no gate flag exits nonzero", r1.code !== 0, `exit ${r1.code}: ${r1.out.slice(0, 300)}`);
	check("the refusal names BOTH missing flags", /--suite/.test(r1.out) && /--changed-suite/.test(r1.out), r1.out.slice(0, 400));
	check("main did not advance", !landed(a), git(a, "log", "--oneline", "main").out);
	check("the refusal says nothing was advanced", /Nothing was advanced/.test(r1.out), r1.out.slice(0, 300));

	/* ── 2. a bogus/empty value on a gate flag is not a bypass ── */
	for (const bogus of ["--suite=false", "--changed-suite=", "--docs-only=off"]) {
		const b = join(root, "bogus-" + bogus.replace(/[^a-z]/g, ""));
		makeRepo(b);
		makeBranch(b, "feature", { "scripts/widget.mjs": "export const widget = 3;\n" });
		const r = runLand(b, "feature", [bogus]);
		check(`${bogus} is refused as unrecognized, not silently ignored`, r.code !== 0 && /unrecognized gate flag/i.test(r.out), `exit ${r.code}: ${r.out.slice(0, 250)}`);
		check(`main did not advance under ${bogus}`, !landed(b), git(b, "log", "--oneline", "main").out);
	}

	/* ── 3. documentation-only, attested: the lighter path runs the docs area and says what it skipped ── */
	const c = join(root, "docs-only");
	makeRepo(c);
	makeBranch(c, "feature", { "docs/NOTES.md": "# notes\n\nprose only, no code.\n" });
	const rDocNoFlag = runLand(c, "feature", ["--changed-suite"]);
	check("docs-only WITHOUT --docs-only is still refused (the lighter path is not automatic)", rDocNoFlag.code !== 0 && /NO coverage/.test(rDocNoFlag.out), `exit ${rDocNoFlag.code}: ${rDocNoFlag.out.slice(0, 300)}`);
	check("the refusal explains the remedy and why it does not apply", /--docs-only/.test(rDocNoFlag.out) && /Why the lighter path does not apply/.test(rDocNoFlag.out), rDocNoFlag.out.slice(0, 400));
	const rDoc = runLand(c, "feature", ["--changed-suite", "--docs-only"]);
	const jDoc = parse(rDoc.stdout);
	check("an attested docs-only landing exits 0", rDoc.code === 0, `exit ${rDoc.code}: ${rDoc.out.slice(0, 300)}`);
	check("main advanced", landed(c), git(c, "log", "--oneline", "main").out);
	check("the report says which gate ran", /docs-area/.test(jDoc?.gate?.kind ?? ""), JSON.stringify(jDoc?.gate));
	check("the docs area ran and the rig area did NOT", (jDoc?.suiteScope?.areasRan ?? []).includes("docs") && (jDoc?.suiteScope?.areasNotRun ?? []).includes("rig"), JSON.stringify({ ran: jDoc?.suiteScope?.areasRan, not: jDoc?.suiteScope?.areasNotRun }));
	check("the docs demos actually ran in the scratch", /docs area ran/.test(rDoc.out), rDoc.out.slice(0, 300));
	check("the report states the areas it did not cover", /areas NOT RUN/.test(rDoc.stderr) || /areas NOT covered/.test(rDoc.stdout), rDoc.stderr.slice(0, 300));

	/* ── 4. --docs-only asserted on a CODE branch: the attestation fails and names the path ── */
	const d = join(root, "docs-only-liar");
	makeRepo(d);
	makeBranch(d, "feature", { "docs/NOTES.md": "# notes\nprose\n", "scripts/widget.mjs": "export const widget = 4;\n" });
	const rLie = runLand(d, "feature", ["--changed-suite", "--docs-only"]);
	check("a code change cannot be waved through as docs-only", rLie.code !== 0, `exit ${rLie.code}: ${rLie.out.slice(0, 300)}`);
	check("the refusal names the offending path", /scripts\/widget\.mjs/.test(rLie.out), rLie.out.slice(0, 400));
	check("main did not advance on the false attestation", !landed(d), git(d, "log", "--oneline", "main").out);

	/* ── the derived path still works (the gate flag is honoured, not just the refusal) ── */
	const e = join(root, "derived");
	makeRepo(e);
	makeBranch(e, "feature", { "scripts/widget.mjs": "export const widget = 5;\n" });
	const rDer = runLand(e, "feature", ["--changed-suite"]);
	const jDer = parse(rDer.stdout);
	check("a code branch with derived coverage lands under --changed-suite", rDer.code === 0 && landed(e), `exit ${rDer.code}: ${rDer.out.slice(0, 300)}`);
	check("its report calls the gate derived and names the area it did not run", jDer?.gate?.kind === "derived" && /rig/.test(jDer?.suiteScope?.areasRan?.join(",") ?? ""), JSON.stringify(jDer?.gate));

	/* ── the pure rule, pinned directly ── */
	check("--docs-only alone is not a gate", requireGate(parseGateFlags(["--docs-only"])).ok === false);
	check("no flag at all is refused", requireGate(parseGateFlags([])).ok === false);
	check("--suite is the full gate", requireGate(parseGateFlags(["--suite"])).gate === "full");
	check("--changed-suite is the derived gate", requireGate(parseGateFlags(["--changed-suite"])).gate === "derived");
	check("an empty diff cannot be attested as docs-only", docsOnlyAttestation({ flags: { docsOnly: true }, changedPaths: [] }).ok === false);
	check("prose is documentation", isDocumentationPath("docs/runbooks/x.md") && isDocumentationPath("README.md") && isDocumentationPath("docs/a.txt"));
	check("code is not documentation", !isDocumentationPath("scripts/land.mjs") && !isDocumentationPath("docs/policy.mjs") && !isDocumentationPath(""));
	// Non-vacuity: the rule would be worthless if a .mjs path passed the documentation test.
	check("the docs test is not vacuously true for a source file in docs/", !isDocumentationPath("docs/x.mjs"), "docs/x.mjs classified as documentation");
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(`\nLANDING GATE TEST ${fail === 0 ? "PASS" : "FAIL"}: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
