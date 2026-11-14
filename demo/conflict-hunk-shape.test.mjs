// demo/conflict-hunk-shape.test.mjs — pin the hunk taxonomy of tools/conflict-hunk-shape.mjs.
// (Operator directive 2026-11-14: "figure out how to get everything merged". The rig refuses a
// conflict it cannot prove lossless; this tool decides WHICH conflicts a rule can merge and WHICH
// are an author's re-cut. If the classifier calls a paraphrase "mechanical", a delegate silently
// drops a seat's wording — so the classes are a contract, pinned here.)
//
// WHAT IS ASSERTED
//   A an empty main side is a pure insertion; B an empty ref side means main already removed it;
//   C/D one side already contains the other; U both sides only append at the same anchor of an
//   append-only file (the ledger collision tools/chain-resolve.mjs unions);
//   F the two sides are the same sentence with a different measured number;
//   G the same claim in different words -> wording, a human must choose;
//   E genuinely different decisions at the same place -> a re-cut;
//   I both sides changed ONE import line for the SAME module -> the union of names is the only
//      lossless merge (tools/chain-resolve.mjs rule 8 then proves the merged tree exports them);
//   P both sides are runbook frontmatter keys -> bookkeeping, unionable (rule 9);
//   the verdict bar: a ref with an E is `semantic`, one with only G is `wording-only`, a ref with
//   nothing but A/B/C/D/U is `mechanical`; and the argument/exit-code contract.
//
// Cost: ~2 s (its own run). No network, no model, no store: it builds its own git repo under a
// temp dir and removes it. Nothing in the rig's tree is touched.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyHunk, isProvenance } from "../tools/conflict-hunk-shape.mjs";

const TOOL = join(process.cwd(), "tools", "conflict-hunk-shape.mjs");
let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else { failures += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

// 1) the pure rules, no git involved
check("A: an empty main side is an insertion", classifyHunk([], ["- new row"]).cls === "A");
check("B: an empty ref side means main already removed it", classifyHunk(["old line that no longer exists anywhere"], []).cls === "B");
check("C: a ref side containing every main line is a superset", classifyHunk(["alpha beta", "gamma delta"], ["alpha beta", "gamma delta", "epsilon zeta"]).cls === "C");
check("D: a ref whose lines are all already on main is landed", classifyHunk(["alpha beta", "gamma delta", "epsilon zeta"], ["alpha beta", "gamma delta"]).cls === "D");
check("U: two appends at the same anchor of a ledger is a union, not a fight",
	classifyHunk(["- row B written by main", "- row A at the fork"], ["- row C written by the ref", "- row A at the fork"], ["- row A at the fork"]).cls === "U");
check("F: only the measured number differs -> a stale value, not a decision",
	classifyHunk(["check reports 27 rules declared in src/checkup.mjs, verified 2026-11-13"],
		["check reports 23 rules declared in src/checkup.mjs, verified 2026-11-11"]).cls === "F");
check("G: the same claim in different words is wording, not mechanics",
	classifyHunk(["the verifier records which rules ran and which did not before an allow is issued"],
		["the verifier records which rules ran and which rules did not run before any allow is issued"]).cls === "G");
check("E: different decisions at the same place",
	classifyHunk(["return item status queued only when nobody has claimed it"],
		["return held rows too because a held row is still unclaimed work"]).cls === "E");
check("I: two name lists for the same import are a provable union, not a fight",
	classifyHunk(["import { foo, baz } from \"./src/mod.mjs\";"], ["import { foo, qux } from \"./src/mod.mjs\";"]).cls === "I");
check("I is not triggered when the modules differ", classifyHunk(["import { foo } from \"./src/a.mjs\";"], ["import { foo } from \"./src/b.mjs\";"]).cls !== "I");
check("P: runbook frontmatter on both sides is bookkeeping, not a decision",
	classifyHunk(["last_verified: 2026-11-14", "verified_by: delegate"], ["last_verified: 2026-11-10", "verified_by: qa (#6177)"]).cls === "P");
check("...but a wrapped evidence line is not frontmatter, so it stays a decision",
	!isProvenance(["verified_by: qa", "the second line of the value continues here"]));
check("identical sides are C, not a conflict", classifyHunk(["same text here"], ["same text here"]).cls === "C");

// 2) the pipeline against a real git merge
const repo = mkdtempSync(join(tmpdir(), "hunk-shape-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@x", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@x" };
const g = (a) => {
	const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
	return r.stdout.trim();
};
try {
	g(["init", "-q", "-b", "main"]);
	writeFileSync(join(repo, "runbook.md"), "# runbook\n\nthe procedure has one line\n- row A at the fork\n");
	writeFileSync(join(repo, "code.mjs"), "const rules = 1;\nexport default rules;\n");
	g(["add", "-A"]); g(["commit", "-q", "-m", "base"]);
	const base = g(["rev-parse", "HEAD"]);

	writeFileSync(join(repo, "runbook.md"), "# runbook\n\nthe procedure has one line\n- row A at the fork\n- row B added by main\n");
	writeFileSync(join(repo, "code.mjs"), "const rules = 27;\nexport default rules;\n");
	g(["add", "-A"]); g(["commit", "-q", "-m", "main moves ahead"]);

	// ref-append: appends at the same anchor and re-measures the same constant -> provable.
	g(["checkout", "-q", "-b", "ref-append", base]);
	writeFileSync(join(repo, "runbook.md"), "# runbook\n\nthe procedure has one line\n- row A at the fork\n- row C added by the ref\n");
	writeFileSync(join(repo, "code.mjs"), "const rules = 23;\nexport default rules;\n");
	g(["add", "-A"]); g(["commit", "-q", "-m", "ref appends and re-measures"]);

	// ref-decide: rewrites the same predicate main rewrote, with different meaning.
	g(["checkout", "-q", "-b", "ref-decide", base]);
	writeFileSync(join(repo, "runbook.md"), "# runbook\n\nthe procedure splits into two procedures here\n- row A at the fork\n");
	writeFileSync(join(repo, "code.mjs"), "const rules = 1;\nif (rules > 2) throw new Error(\"the ref's own rule\");\nexport default rules;\n");
	g(["add", "-A"]); g(["commit", "-q", "-m", "ref decides differently"]);

	const out = spawnSync(process.execPath, [TOOL, "--repo", repo, "--refs", "ref-append,ref-decide", "--brief"], { encoding: "utf8", env });
	check("the census exits 0", out.status === 0, `exit ${out.status} ${out.stderr}`);
	const lines = out.stdout.split("\n").filter(Boolean);
	const app = lines.find((l) => l.startsWith("ref-append"));
	const dec = lines.find((l) => l.startsWith("ref-decide"));
	check("the appending ref is verdict mechanical", /mechanical/.test(app || ""), app);
	check("...and its hunks are U (append at a shared anchor) and F (a stale number)", /F=1 U=1/.test(app || ""), app);
	check("the re-deciding ref is verdict semantic", /semantic/.test(dec || ""), dec);
	check("no ref is misreported as clean", !lines.some((l) => l.includes("clean")), lines.join(" | "));

	const bad = spawnSync(process.execPath, [TOOL], { encoding: "utf8", env });
	check("no --refs and no --brief is an argument error, not a silent census", bad.status === 2, `exit ${bad.status}`);

	const json = spawnSync(process.execPath, [TOOL, "--repo", repo, "--refs", "ref-decide", "--json", join(repo, "shape.json")], { encoding: "utf8", env });
	const parsed = JSON.parse(json.stdout || "{}");
	check("the JSON carries head, elapsed and the per-ref rows", parsed.head && parsed.elapsed_s && Array.isArray(parsed.rows) && parsed.rows.length === 1, json.stdout.slice(0, 200));

	console.log(failures
		? `FAIL: ${failures} check(s) — demo/conflict-hunk-shape.test.mjs`
		: "CONFLICT-HUNK-SHAPE PASS (A/B/C/D/U provable, I import union, P provenance union, F stale number, G paraphrase, E semantic; verdict bar and exit codes pinned)");
	process.exit(failures ? 1 : 0);
} finally {
	rmSync(repo, { recursive: true, force: true });
}
