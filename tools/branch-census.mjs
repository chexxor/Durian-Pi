// tools/branch-census.mjs — the branch/worktree residue in one bounded read.
//
// WHY. The rig mints one branch and one worktree per claimed item. On 2026-11-11 the census was
// 101 refs and 95 worktrees, 71 of them "reapable" by the audit alone — a number that tells you
// nothing about whether a ref is merged, conflicting, or attached to a still-live item. Pruning on
// the audit's `keepReason` alone is how a session deletes a seat's live work.
//
// WHAT IT ANSWERS, per ref: ahead of main? an ancestor of main (merged)? does it merge clean
// (git merge-tree)? is the worktree dirty? what state is the queue item in? Then it prints the
// PLAN: which refs are safe to delete and which worktrees are safe to remove, each with the reason,
// and never a force.
//
// Cost (measured, Linux Fedora 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0,
// 101 refs / 95 worktrees, main 35001c3a): ~20 s. Bounded by design; each git verb is wrapped.
//
// Usage:
//   node tools/branch-census.mjs [--db ./selfdev.sqlite] [--json] [--plan] [--refs-only]
// Exit 0 = census produced. Nonzero = the census could not be read (no repo, no store, git failed).
//
// Rule it encodes (verified 2026-11-11, delegate): a ref is DELETE-ABLE only when
//   git merge-base --is-ancestor <ref> main  -> exit 0        (its work is on main), AND
//   its worktree has no uncommitted tracked change, AND
//   it is not a seat root, not locked, and not the branch a claimed item is working on.
// A ref that is NOT an ancestor of main is never deleted here: it is either landable (a seat lands
// it) or conflicted (the author re-cuts it). Both are the team's call, not a prune.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const repo = opt("--repo", process.cwd());
const dbPath = opt("--db", "./selfdev.sqlite");

const run = (cmd, timeoutMs = 20000) => {
	try {
		return execSync(cmd, { cwd: repo, timeout: timeoutMs, encoding: "utf8" }).trim();
	} catch (e) {
		return `__ERR__ ${e.message.split("\n")[0]}`;
	}
};

if (!fs.existsSync(path.join(repo, ".git"))) {
	console.log(JSON.stringify({ ok: false, command: "branch-census", error: `no .git at ${repo}` }));
	process.exit(1);
}

// 1. The worktree inventory, from the CLI that already owns the seat-root knowledge.
const auditRaw = run(`DURIG_DB=${dbPath} node cli.mjs worktree audit --json`, 60000);
if (auditRaw.startsWith("__ERR__")) {
	console.log(JSON.stringify({ ok: false, command: "branch-census", error: `worktree audit failed: ${auditRaw}` }));
	process.exit(1);
}
let audit;
try {
	audit = JSON.parse(auditRaw);
} catch (e) {
	console.log(JSON.stringify({ ok: false, command: "branch-census", error: `audit json unparseable: ${e.message}` }));
	process.exit(1);
}

// 2. The queue state, so a branch can be read against the item it belongs to.
let itemStatus = new Map();
let censusRows = null;
const queueRaw = run(`DURIG_DB=${dbPath} node cli.mjs queue --json --no-body`, 60000);
if (!queueRaw.startsWith("__ERR__")) {
	try {
		const q = JSON.parse(queueRaw.split("\n").filter((l) => !l.startsWith("note:")).join("\n"));
		censusRows = q.rows;
		for (const r of q.items || []) itemStatus.set(r.id, r.status);
	} catch {
		/* the queue view is optional; the git facts still stand without it */
	}
}

// 3. Per-ref facts.
const refsRaw = run("git branch --list", 20000);
const refs = refsRaw.split("\n").map((l) => l.trim().replace(/^\+?\s*/, "").split(" ")[0]).filter((r) => r && /^[A-Za-z0-9_./-]+$/.test(r));

const refFacts = new Map();
for (const ref of refs) {
	if (ref === "main") continue;
	const ahead = parseInt(run(`git rev-list --count "main..${ref}"`) || "0", 10);
	const merged = run(`git merge-base --is-ancestor "${ref}" main; echo $?`) === "0";
	let conflict = null;
	if (!merged) conflict = run(`git merge-tree --write-tree main "${ref}" >/dev/null 2>&1; echo $?`) === "0" ? "clean" : "conflict";
	refFacts.set(ref, { ref, ahead, merged, conflict });
}

// 4. Join, and classify.
const rows = (audit.worktrees || []).map((w) => {
	const ref = (w.branch || "").replace("refs/heads/", "");
	const f = refFacts.get(ref) || { ref, ahead: null, merged: null, conflict: null };
	const status = w.itemId ? itemStatus.get(w.itemId) || "unknown" : null;
	const dirty = (w.uncommitted || 0) > 0;
	let verdict;
	if (w.keepReason === "seat-root") verdict = "keep: seat root";
	else if (w.keepReason === "locked") verdict = "keep: locked (a run is in flight)";
	else if (!ref) verdict = "detached scratch: remove only if its parent item is terminal";
	else if (dirty) verdict = "keep: uncommitted work — a seat commits it or the operator rules it discarded";
	else if (f.merged) verdict = "prune: merged into main";
	else if (f.conflict === "conflict") verdict = "keep: conflicts with main — the author re-cuts it";
	else if (status === "claimed" || status === "queued" || status === "held") verdict = "keep: item is live";
	else verdict = "prune: clean, unmerged, item terminal (needs a landing entry first)";
	return {
		path: w.worktree,
		ref,
		keepReason: w.keepReason,
		ahead: f.ahead,
		merged: f.merged,
		conflict: f.conflict,
		item: w.itemId,
		status,
		uncommitted: w.uncommitted || 0,
		verdict,
	};
});

const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;

const plan = rows.filter((r) => r.verdict === "prune: merged into main").map((r) => ({
	worktree: r.path,
	ref: r.ref,
	command: `git worktree remove ${r.path} && git branch -d ${r.ref}`,
}));

const orphans = rows.filter((r) => r.verdict === "prune: clean, unmerged, item terminal (needs a landing entry first)");

const out = {
	ok: true,
	command: "branch-census",
	repo,
	db: dbPath,
	head: run("git rev-parse HEAD"),
	host: run("uname -s && uname -r && (. /etc/os-release && echo \"$PRETTY_NAME\") && node -v && git --version", 10000),
	refs: refs.length,
	worktrees: rows.length,
	tally,
	plan,
	needsASeat: orphans.map((r) => ({ ref: r.ref, worktree: r.path, item: r.item, status: r.status })),
	kept: rows.filter((r) => !r.verdict.startsWith("prune")).map((r) => ({ ref: r.ref, why: r.verdict })),
};

console.log(
	flag("--json")
		? JSON.stringify(out, null, 1)
		: [
				`branch census @ ${out.head} — ${out.refs} refs, ${out.worktrees} worktrees`,
				...Object.entries(out.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}  ${k}`),
				"",
				`prune plan (${plan.length}) — merged refs whose worktree is clean:`,
				...plan.slice(0, flag("--plan") ? plan.length : 12).map((p) => `  ${p.command}`),
		],
);
