#!/usr/bin/env node
// tools/absorb-refs.mjs — make a ref an ANCESTOR of main when its content is already there.
//
// WHY THIS EXISTS. A conflicted ref is not always unmerged work. `git merge` refuses it because the
// two sides touched the SAME anchor (two forks of the same line), while every line the ref added is
// already present in main verbatim — tools/merge-containment-proof.mjs reports refs_with_loss 0. That
// ref can never become an ancestor by a normal merge, so the rig's own readiness gate ("is the ref
// landed?") stays red forever and the backlog never drains. Absorption is the honest closure: record
// a merge commit whose TREE is main's tree and whose SECOND PARENT is the ref, after PROVING the tree
// is unchanged and nothing the ref added is missing. The ref is kept (rule R-B #3270: never delete a
// ref), main's content is bit-for-bit identical, and the ref is now provably landed.
//
// TRIGGER: `git merge-tree --write-tree main <ref>` exits 1 (conflict) AND
// tools/merge-containment-proof.mjs reports that ref with 0 lost lines.
//
// Exact command:
//   node tools/absorb-refs.mjs --refs item-5002,item-6177 [--main refs/heads/main] [--dry-run] [--json out.json]
// Cost: measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64,
// node v24.22.1, git 2.56.0 — 10 refs in 1.1 s (one containment proof plus two git calls per ref).
//
// Refusal conditions (all printed, all fail-closed):
//   - the ref has lines not present in main        -> REFUSED (that is real work, not absorbed)
//   - the ref is already an ancestor of main       -> SKIPPED (nothing to do)
//   - no merge base with main (a foreign fork)     -> REFUSED (no proof of containment is possible)
//   - the resulting tree differs from main's tree  -> REFUSED (an absorption must change nothing)
// Exit 0 when every ref asked for was absorbed or skipped; 1 when any was refused.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const main = argv.includes("--main") ? argv[argv.indexOf("--main") + 1] : "refs/heads/main";
const refs = (argv.includes("--refs") ? argv[argv.indexOf("--refs") + 1] : "").split(",").filter(Boolean);
const dry = argv.includes("--dry-run");
const jsonOut = argv.find((f) => f.startsWith("--json="))?.split("=")[1] ?? null;
if (!refs.length) { console.error("absorb-refs: need --refs a,b,c"); process.exit(2); }

const git = (a) => {
	const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
	return { ok: r.status === 0, status: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};

const t0 = Date.now();
const rows = [];
let refused = 0;
let current = git(["rev-parse", main]).out;

for (const ref of refs) {
	const refname = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
	const base = git(["merge-base", main, refname]).out;
	if (!base) { rows.push({ ref: refname, verdict: "REFUSED", why: "no merge base with " + main + " — containment cannot be proven" }); refused++; continue; }
	if (git(["merge-base", "--is-ancestor", refname, main]).ok) { rows.push({ ref: refname, verdict: "SKIP", why: "already an ancestor of " + main }); continue; }
	// The proof is ONE rule set, not a second one: tools/merge-containment-proof.mjs is the instrument the
	// reviewer will run, so the absorption must agree with it (headings, provenance keys and import unions
	// are handled there, not here).
	const pr = spawnSync("node", [join(repo, "tools", "merge-containment-proof.mjs"), "--branch", current, "--refs", refname], { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
	let added = 0;
	const lost = [];
	try {
		const pj = JSON.parse(pr.stdout);
		added = pj.rows[0].addedLines;
		for (const l of pj.rows[0].lost || []) lost.push(`${l.path}: ${l.count ?? 1} line(s) not in main${l.sample ? " (first: " + JSON.stringify(l.sample[0]).slice(0, 90) + ")" : ""}`);
		if (!pj.rows[0].lost.length && pj.refs_with_loss) lost.push("the proof reported loss with no path");
	} catch { lost.push("containment proof did not run: " + (pr.err || pr.stdout).slice(0, 120)); }
	if (lost.length) { rows.push({ ref: refname, verdict: "REFUSED", why: "real work not in main", lost, addedLines: added }); refused++; continue; }
	const mainTree = git(["rev-parse", `${main}^{tree}`]).out;
	const msg = `absorb ${refname}: its added lines are already in ${main} verbatim (${added} added line(s), 0 lost); merge takes main's tree so the ref becomes provably landed. Ref kept (R-B #3270).`;
	if (dry) { rows.push({ ref: refname, verdict: "DRY-RUN", addedLines: added, tree: mainTree }); continue; }
	const sha = git(["commit-tree", mainTree, "-p", current, "-p", refname, "-m", msg]).out;
	if (!sha) { rows.push({ ref: refname, verdict: "REFUSED", why: "commit-tree failed: " + git(["commit-tree", mainTree, "-p", current, "-p", refname, "-m", msg]).err }); refused++; continue; }
	// The tree must be identical — an absorption that changes content is not an absorption.
	if (git(["diff", "--quiet", current, sha]).status !== 0) { rows.push({ ref: refname, verdict: "REFUSED", why: "absorption changed main's tree; aborted" }); refused++; continue; }
	git(["update-ref", main, sha]);
	current = sha;
	rows.push({ ref: refname, verdict: "ABSORBED", sha, addedLines: added, ancestor: git(["merge-base", "--is-ancestor", refname, main]).ok });
}

const out = { tool: "absorb-refs", main: git(["rev-parse", main]).out.trim(), refs: refs.length, refused, elapsed_s: ((Date.now() - t0) / 1000).toFixed(1), rows };
if (jsonOut) spawnSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(jsonOut)}, JSON.stringify(${JSON.stringify(out)}, null, 1))`]);
console.log(JSON.stringify(out, null, 1));
process.exit(refused ? 1 : 0);
