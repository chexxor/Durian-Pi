// demo/chain-resolve-rules.test.mjs — the conflict-resolver's rules are a CONTRACT, not a vibe.
// (Operator directive 2026-11-14: "figure out how to get everything merged". A delegate that
// union-resolves a conflict has to PROVE it did not pick a side and silently drop work. This demo
// builds a throwaway repo, forces the shapes of conflict a landing pass actually meets, and asserts
// what tools/chain-resolve.mjs does in each.)
//
// WHAT IS ASSERTED
//   1. two refs appending at the SAME anchor of an append-only doc -> BOTH rows survive (union);
//   2. a ref whose heading collides with a number main already minted -> re-minted, both entries
//      present, no line lost (the land-time mint convention, precedent 53eea388);
//   3. a CODE add/add (two independent versions of a file with no merge base) -> REFUSED, never
//      silently resolved to main's copy. This rule exists because the first version of the resolver
//      dropped 74 lines of a seat's demo that way (item-7103, demo/restart-limit-behaviour.test.mjs);
//   4. a ref that edits a region main already rewrote -> REFUSED, and the chain is left clean: no
//      conflict markers, no half-written file;
//   5. exit 0 when at least one ref merged, 1 when none did.
//
// Cost: ~2-4 s (measured in the run that shipped this file); no network, no model, no store. It
// builds its own git repo under a temp dir and removes it; nothing in the rig's tree is touched.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = join(process.cwd(), "tools", "chain-resolve.mjs");
let failures = 0;
function check(label, cond, detail = "") {
	if (cond) console.log(`  ok   ${label}`);
	else { failures += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const repo = mkdtempSync(join(tmpdir(), "chain-resolve-rules-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@x", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@x" };
const g = (a) => {
	const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${a.join(" ")} failed: ${r.stderr}`);
	return r.stdout.trim();
};

try {
	mkdirSync(join(repo, "docs"), { recursive: true });
	mkdirSync(join(repo, "demo"), { recursive: true });
	g(["init", "-q", "-b", "main"]);

	// BASE: an append-only ledger, one decision entry, one code file.
	writeFileSync(join(repo, "docs/LEDGER.md"), "# ledger\n\n- row A (the only row at the fork point)\n");
	writeFileSync(join(repo, "docs/DECISIONS.md"), "## D1 — the only decision so far\n\nbody of D1\n");
	writeFileSync(join(repo, "docs/NEXT.md"), "pointer v1\n");
	writeFileSync(join(repo, "docs/RUNBOOK.md"), "## the procedure\n\nline one\nline two\nline three\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "base"]);
	const base = g(["rev-parse", "HEAD"]);

	// MAIN moves first: one seat appends a row and mints D2.
	writeFileSync(join(repo, "docs/LEDGER.md"), "# ledger\n\n- row A (the only row at the fork point)\n- row B (main's append)\n");
	writeFileSync(join(repo, "docs/DECISIONS.md"), "## D1 — the only decision so far\n\nbody of D1\n\n## D2 — minted at land by main\n\nmain's body\n");
	writeFileSync(join(repo, "docs/RUNBOOK.md"), "## the procedure\n\nline one\nline two (reworded by main, 2026-11-14)\nline three\n");
	writeFileSync(join(repo, "demo/new-behaviour.test.mjs"), "// main's version of the test\nassert(1);\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "main moves ahead"]);

	// REF 1, from the SAME fork point: appends at the SAME anchor, and adds a heading whose number
	// main already used.
	g(["checkout", "-q", "-b", "ref-ledger", base]);
	writeFileSync(join(repo, "docs/LEDGER.md"), "# ledger\n\n- row A (the only row at the fork point)\n- row C (ref's append)\n");
	writeFileSync(join(repo, "docs/DECISIONS.md"), "## D1 — the only decision so far\n\nbody of D1\n\n## D2 — the ref's own decision\n\nref's body\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "ref 1: same anchor, colliding number"]);

	// REF 2: a CODE file main also created independently — two versions, no merge base at that path.
	g(["checkout", "-q", "-b", "ref-code", base]);
	mkdirSync(join(repo, "demo"), { recursive: true }); // checkout of the base removes main-only files, and with them the empty dir
	writeFileSync(join(repo, "demo/new-behaviour.test.mjs"), "// the ref's OWN version of the same file\nassert(2);\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "ref 2: add/add on code"]);

	// REF 3: rewrites a line main also rewrote — the line it removes is no longer anywhere.
	g(["checkout", "-q", "-b", "ref-diverge", base]);
	writeFileSync(join(repo, "docs/RUNBOOK.md"), "## the procedure\n\nline one\nline two as the diverging ref wrote it\nline three\n- a new row the ref wanted to add\n");
	g(["add", "-A"]);
	g(["commit", "-q", "-m", "ref 3: edits a line main already changed"]);

	const wt = join(repo, ".spike-chain");
	const run = (branch, refs, worktree = wt) => {
		const r = spawnSync(process.execPath, [TOOL, "--repo", repo, "--branch", branch, "--refs", refs, "--worktree", worktree], { encoding: "utf8", env });
		let json = {};
		try { json = JSON.parse(r.stdout || "{}"); } catch { /* reported by the exit-code check below */ }
		return { status: r.status, json, stderr: r.stderr };
	};

	// 1 + 2: union at a shared anchor, and the land-time re-mint.
	const r1 = run("landing-fixture", "ref-ledger");
	check("the provable conflict merges (exit 0)", r1.status === 0, `exit ${r1.status} ${r1.stderr}`);
	check("the ref is reported as merged", (r1.json.merged || []).length === 1, JSON.stringify(r1.json.refused));
	const ledger = readFileSync(join(wt, "docs/LEDGER.md"), "utf8");
	check("BOTH appends survive (union, not a side)", ledger.includes("row B (main's append)") && ledger.includes("row C (ref's append)"), ledger.replace(/\n/g, " | "));
	const decisions = readFileSync(join(wt, "docs/DECISIONS.md"), "utf8");
	const headings = decisions.split("\n").filter(l => /^## D\d+/.test(l));
	check("the colliding heading is re-minted, not duplicated", headings.length === 3 && headings.filter(h => /^## D2 /.test(h)).length === 1, headings.join(" | "));
	check("the ref's wording survived the mint", decisions.includes("the ref's own decision"), decisions.slice(0, 300));
	check("no conflict markers are left", !/^<<<<<<<|^=======$|^>>>>>>>/m.test(ledger + decisions), "markers present");

	// 3: code add/add is refused outright.
	const r2 = run("landing-fixture", "ref-code");
	const refused2 = (r2.json.refused || []);
	check("a CODE add/add is refused, not unioned", refused2.length === 1 && /add\/add/.test(refused2[0].decisions.join(" ")), JSON.stringify(r2.json));
	if (!refused2.length) check("...and the ref's file was NOT written into the chain", false, readFileSync(join(wt, "demo/new-behaviour.test.mjs"), "utf8"));

	// 4: an unlocatable edit is refused and leaves the chain clean.
	const r3 = run("landing-fixture", "ref-diverge");
	const refused3 = (r3.json.refused || []);
	check("an unlocatable edit is refused", refused3.length === 1 && /not locatable/.test(refused3[0].decisions.join(" ")), JSON.stringify(r3.json));
	const ledgerAfter = readFileSync(join(wt, "docs/RUNBOOK.md"), "utf8");
	check("the refused ref left no half-merged file", !ledgerAfter.includes("a new row the ref wanted to add") && !/^<<<<<<</m.test(ledgerAfter), ledgerAfter.replace(/\n/g, " | "));

	// 5: nothing provable merges -> nonzero exit.
	const r4 = run("landing-only-bad", "ref-diverge", join(repo, ".spike-chain2"));
	check("a chain where nothing merges exits nonzero", r4.status === 1, `exit ${r4.status}`);

	console.log(failures
		? `FAIL: ${failures} check(s) — demo/chain-resolve-rules.test.mjs`
		: "CHAIN-RESOLVE RULES PASS (union at a shared anchor, land-time re-mint, code add/add refused, unlocatable edit refused, no markers left, exit code honest)");
	process.exit(failures ? 1 : 0);
} finally {
	rmSync(repo, { recursive: true, force: true });
}
