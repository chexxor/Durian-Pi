#!/usr/bin/env node
// tools/ref-recut.mjs — replay a ref's OWN work onto current main as a fresh branch, so the
// merge has no conflicts to pick a side in. This is the "re-cut" the disposition rows ask for
// (docs/runbooks/branch-cleanup.md Step 0b/0d), done as a tool instead of a chat.
//
// WHY. tools/chain-resolve.mjs can only union hunks it can PROVE are a union; everything else
// ("anchor/edit not locatable in the current file") is a human re-cut. A re-cut is not
// re-typing prose: it is the ref's diff, taken against its own merge base, replayed on main with
// git's real merge machinery (git apply --3way), which locates hunks far better than anchor
// matching. Whatever still conflicts is left in the worktree with markers, listed, and NOT
// committed as if it were resolved. The original ref is never touched and never deleted
// (rule R-B #3270).
//
// TRIGGER: a ref is reported `semantic` by tools/conflict-hunk-shape.mjs, or chain-resolve
// refuses it with "anchor/edit not locatable".
//
// Exact command:
//   node tools/ref-recut.mjs --refs item-3570,item-6116            # plan + apply, report
//   node tools/ref-recut.mjs --refs item-3570 --commit              # commit a clean replay
//   node tools/ref-recut.mjs --refs item-3570 --json .spike/recut.json
// Then fix the markers it lists in the printed worktree, run
// tools/merge-containment-proof.mjs --branch refs/heads/<ref>-recut --refs <ref>, and land with
// scripts/land.mjs <ref>-recut --db ./selfdev.sqlite --changed-suite.
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0 — 1 ref 0.4 s, 34 refs 14.6 s (one `git apply` + one `node --check` per
// changed .mjs). No suite runs here; scripts/land.mjs is the gate.
//
// What it reports per ref: the new branch, the worktree, how many hunks git applied cleanly,
// which files still carry conflict markers, and which of them fail `node --check` / JSON parse.
// Exit 0 = every ref replayed conflict-free; 1 = at least one needs a human.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const flags = process.argv.slice(2);
const refArg = flags.find((f) => f.startsWith("--refs=")) ?? (flags[0] === "--refs" ? flags[1] : null);
const doCommit = flags.includes("--commit");
const jsonOut = flags.find((f) => f.startsWith("--json="))?.split("=")[1] ?? null;
const mainRef = flags.find((f) => f.startsWith("--main="))?.split("=")[1] ?? "refs/heads/main";
const spikeDir = flags.find((f) => f.startsWith("--spike="))?.split("=")[1] ?? ".spike";

if (!refArg) {
	console.error("ref-recut: need --refs <a,b,c>");
	process.exit(2);
}

const repoRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
function git(cwd, argv) {
	const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
	if (r.status !== 0) return { ok: false, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
	return { ok: true, out: (r.stdout ?? "").trim(), err: "" };
}

const refs = refArg.split(",").map((r) => (r.startsWith("refs/") ? r : `refs/heads/${r}`)).filter(Boolean);
mkdirSync(spikeDir, { recursive: true });
const t0 = Date.now();
const rows = [];

for (const ref of refs) {
	const head = git(repoRoot, ["rev-parse", ref]);
	if (!head.ok) { rows.push({ ref, error: "ref does not exist" }); continue; }
	const base = git(repoRoot, ["merge-base", mainRef, head.out]);
	if (!base.ok) { rows.push({ ref, error: "no merge base with " + mainRef }); continue; }

	const slug = ref.replace(/^refs\/heads\//, "").replace(/[^A-Za-z0-9_-]+/g, "_");
	const branch = `${slug}-recut`;
	const wt = join(repoRoot, spikeDir, `recut-${slug}`);

	if (!existsSync(wt)) {
		const add = git(repoRoot, ["worktree", "add", wt, "-b", branch, mainRef]);
		if (!add.ok) { rows.push({ ref, error: "worktree add failed: " + add.err }); continue; }
	}

	const diff = spawnSync("git", ["diff", base.out, head.out], { cwd: repoRoot, encoding: "utf8" });
	const patchPath = join(repoRoot, spikeDir, `recut-${slug}.patch`);
	writeFileSync(patchPath, diff.stdout ?? "");
	const addedLines = (diff.stdout ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("++")).length;

	const applied = git(wt, ["apply", "--3way", patchPath]);
	const changed = git(wt, ["diff", "--name-only"]).out.split("\n").filter(Boolean);
	const conflicted = [];
	const syntax = [];
	for (const f of [...new Set(changed)]) {
		const p = join(wt, f);
		if (!existsSync(p)) continue;
	 const text = spawnSync("cat", [p], { encoding: "utf8" }).stdout;
		if (/^<<<<<<< /m.test(text)) conflicted.push(f);
		if (/\.(mjs|js)$/.test(f)) {
		 const chk = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
		 if (chk.status !== 0) syntax.push({ file: f, error: (chk.stderr || "").split("\n")[0] });
		}
		if (/\.json$/.test(f)) {
			try { JSON.parse(spawnSync("cat", [p], { encoding: "utf8" }).stdout); }
			catch (e) { syntax.push({ file: f, error: "invalid JSON: " + e.message }); }
		}
	}

	let committed = false;
	if (doCommit && conflicted.length === 0 && syntax.length === 0 && changed.length) {
		const c = git(wt, ["commit", "-q", "-m", `recut: replay ${ref.replace(/^refs\/heads\//, "")} onto ${mainRef.replace("refs/heads/", "")} (base ${base.out.slice(0, 8)}); ${addedLines} added line(s), no conflict markers`]);
		committed = c.ok;
	}

	rows.push({
		ref,
		branch,
		worktree: wt,
		base: base.out.slice(0, 12),
		changed: changed.length,
		addedLines,
		appliedCleanly: applied.ok,
		conflicted,
		syntax,
		committed,
	});
}

const report = { tool: "ref-recut", head: git(repoRoot, ["rev-parse", mainRef]).out, refs: refs.length, elapsed_s: ((Date.now() - t0) / 1000).toFixed(1), rows };
if (jsonOut) writeFileSync(resolve(repoRoot, jsonOut), JSON.stringify(report, null, 1));

for (const r of report.rows) {
	if (r.error) { console.log(`REPLAY-FAILED ${r.ref} :: ${r.error}`); continue; }
	const tag = r.conflicted.length === 0 && r.syntax.length === 0 ? "CLEAN" : "NEEDS-HUMAN";
	console.log(`${tag} ${r.ref} -> ${r.branch}  worktree=${r.worktree}  changed=${r.changed} added=${r.addedLines}${r.conflicted.length ? "  markers: " + r.conflicted.join(", ") : ""}${r.syntax.length ? "  syntax: " + r.syntax.map((s) => s.file).join(", ") : ""}`);
}
const humanNeeded = report.rows.filter((r) => r.error || r.conflicted.length || r.syntax.length).length;
console.log(`ref-recut: ${report.refs} ref(s) in ${report.elapsed_s} s; ${report.refs - humanNeeded} replayed clean, ${humanNeeded} need a re-cut decision (markers are left in the worktree, nothing was committed as resolved).`);
process.exit(humanNeeded === 0 ? 0 : 1);
