// tools/branch-census.mjs — the branch/worktree residue in one bounded read.
//
// WHY. The rig mints one branch and one worktree per claimed item. On 2026-11-11 the census was
// 101 refs and 95 worktrees, 71 of them "reapable" by the audit alone — a number that tells you
// nothing about whether a ref is merged, conflicting, or attached to a still-live item. Pruning on
// the audit's `keepReason` alone is how a session deletes a seat's live work.
//
// WHAT IT ANSWERS, per ref: ahead of main? an ancestor of main (merged)? does it merge clean
// (git merge-tree)? is its content already in main (merge-tree output tree == main's tree, i.e. the
// branch adds nothing net)? is the worktree dirty? does the ref even HAVE a worktree? what state is
// the queue item in? Then it prints the PLAN: which refs are safe to delete and which worktrees are
// safe to remove, each with the reason, and never a force.
//
// Cost (measured, Linux Fedora 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0,
// 78 refs / 68 worktrees): ~25-35 s. Bounded by design; each git verb is wrapped.
//
// Usage:
//   node tools/branch-census.mjs [--db ./selfdev.sqlite] [--json] [--plan] [--md] [--refs-only]
// Exit 0 = census produced. Nonzero = the census could not be read (no repo, no store, git failed).
//
// Rule it encodes (verified 2026-11-11, delegate): a ref is DELETE-ABLE only when
//   git merge-base --is-ancestor <ref> main  -> exit 0        (its work is on main), AND
//   its worktree has no uncommitted tracked change, AND
//   it is not a seat root, not locked, and not the branch a claimed item is working on.
// A ref that is NOT an ancestor of main is never deleted here: it is either landable (a seat lands
// it) or conflicted (the author re-cuts it). Both are the team's call, not a prune. Such refs are
// written to docs/DISPOSITIONS.md instead — a disposition, with a reason, is the record that keeps
// "unmerged" from becoming "deleted".

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
const dbPath = opt("--db", process.env.DURIG_DB || "./selfdev.sqlite");

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
const queueRaw = run(`DURIG_DB=${dbPath} node cli.mjs queue --json --no-body`, 60000);
if (!queueRaw.startsWith("__ERR__")) {
	try {
		const q = JSON.parse(queueRaw.split("\n").filter((l) => !l.startsWith("note:")).join("\n"));
		for (const r of q.items || []) itemStatus.set(r.id, r.status);
	} catch {
		/* the queue view is optional; the git facts still stand without it */
	}
}

// 2b. The disposition ledger. A ref with a KEEP row in docs/DISPOSITIONS.md is ruled, and a
// prune pass that deletes it is a ruling the delegate does not own. Measured 2026-11-11: a delegate
// pass `-d`'d `item-6063/6064/6066`, whose ledger row says "do not prune them" — `git branch -d`
// succeeds on a reverted merge because the merge commit is in history even though the content is not
// live. Ancestor status gates the ref; the ledger gates the act.
let ledger = "";
try {
	ledger = fs.readFileSync(path.join(repo, "docs/DISPOSITIONS.md"), "utf8");
} catch {
	/* no ledger -> no rulings to honour */
}
const ledgerRuling = (ref) => {
	if (!ledger) return null;
	for (const line of ledger.split("\n")) {
		if (!line.startsWith("|") || !line.includes(ref)) continue;
		if (/KEEP|REVERTED|do not prune/i.test(line)) {
			const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
			return cols[3] || cols[2] || "ruled KEEP";
		}
	}
	return null;
};

// 3. Per-ref facts. `for-each-ref` not `branch --list`: the latter prefixes the current branch with
// `*`, which a naive split reads as a ref literally named `*` (measured 2026-11-11: 78 refs listed,
// 76 parsed, one of them `*`).
const refs = run("git for-each-ref --format='%(refname:short)' refs/heads")
	.split("\n")
	.map((l) => l.trim())
	.filter((r) => r && r !== "main");
const mainTree = run("git rev-parse main^{tree}");

const refFacts = new Map();
for (const ref of refs) {
	const ahead = parseInt(run(`git rev-list --count "main..${ref}"`) || "0", 10);
	const merged = run(`git merge-base --is-ancestor "${ref}" main; echo $?`) === "0";
	let conflict = null;
	let redundant = false;
	if (!merged) {
		const mt = run(`git merge-tree --write-tree main "${ref}" 2>/dev/null | head -1`);
		conflict = mt.startsWith("__ERR__") ? "conflict" : (run(`git merge-tree --write-tree main "${ref}" >/dev/null 2>&1; echo $?`) === "0" ? "clean" : "conflict");
		redundant = !mt.startsWith("__ERR__") && mt === mainTree;
	}
	const last = run(`git log -1 --format="%h %ad %s" --date=short "refs/heads/${ref}"`);
	refFacts.set(ref, { ref, ahead, merged, conflict, redundant, last });
}

// 4. Join: every ref, with or without a worktree.
const worktreeByRef = new Map();
for (const w of audit.worktrees || []) {
	const ref = (w.branch || "").replace("refs/heads/", "");
	if (ref) worktreeByRef.set(ref, w);
}

const rows = refs.map((ref) => {
	const f = refFacts.get(ref);
	const w = worktreeByRef.get(ref) || null;
	const dirty = (w?.uncommitted || 0) > 0;
	const refItem = w?.itemId ?? (/^(?:item|ins|spike)-(\d+)$/.exec(ref)?.[1] ?? null);
	const status =
		w?.status ||
		(refItem != null ? itemStatus.get(String(refItem)) || itemStatus.get(refItem) || null : null);
	const ruling = ledgerRuling(ref);
	let verdict;
	if (w?.keepReason === "seat-root") verdict = "keep: seat root";
	else if (w?.keepReason === "locked") verdict = "keep: locked (a run is in flight)";
	else if (dirty) verdict = "keep: uncommitted work — a seat commits it or the operator rules it discarded";
	else if (ruling) verdict = `keep: ruled in docs/DISPOSITIONS.md (${ruling})`;
	else if (status === "claimed" || status === "queued" || status === "held") verdict = "keep: item is live";
	else if (f.merged) verdict = "prune: merged into main";
	else if (f.redundant) verdict = "prune: content already in main, no net change";
	else if (f.conflict === "conflict") verdict = "keep: conflicts with main — the author re-cuts it";
	else if (status === "done" || status === "cancelled" || status === "deferred") verdict = "prune: clean, unmerged, item terminal (needs a landing entry first)";
	else verdict = "keep: no queue row proves the item is terminal — needs a disposition";
	return {
		ref,
		path: w?.worktree || null,
		keepReason: w?.keepReason || null,
		ahead: f.ahead,
		merged: f.merged,
		conflict: f.conflict,
		redundant: f.redundant,
		item: refItem,
		status,
		ledgerRuling: ruling,
		uncommitted: w?.uncommitted || 0,
		last: f.last,
		verdict,
	};
});

const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;

const plan = rows
	.filter((r) => r.verdict.startsWith("prune:") && !r.verdict.includes("needs a landing entry"))
	.map((r) => ({
		worktree: r.path,
		ref: r.ref,
		command: r.path ? `git worktree remove ${r.path} && git branch -d ${r.ref}` : `git branch -d ${r.ref}`,
	}));

const needsLanding = rows.filter((r) => r.verdict.includes("needs a landing entry"));
const kept = rows.filter((r) => !r.verdict.startsWith("prune"));

const out = {
	ok: true,
	command: "branch-census",
	repo,
	db: dbPath,
	head: run("git rev-parse HEAD"),
	host: run("uname -s && uname -r && (. /etc/os-release && echo \"$PRETTY_NAME\") && node -v && git --version", 10000),
	refs: refs.length,
	worktrees: (audit.worktrees || []).length,
	tally,
	plan,
	needsLanding,
	kept,
};

if (flag("--md")) {
	const bt = (s) => "`" + s + "`";
	const groups = {};
	for (const r of rows) (groups[r.verdict] ||= []).push(r);
	const lines = [
		`Census at \`${out.head.slice(0, 8)}\` — ${out.refs} refs (excluding \`main\`), ${out.worktrees} registered worktrees.`,
		"",
		`Measured on ${out.host.replace(/\n/g, ", ")}.`,
		"",
		"Rule: a ref is deletable only when it is an ancestor of `main` (`git merge-base --is-ancestor <ref> main` exit 0), its worktree has no uncommitted tracked change, and it is not a seat root, not locked, and not attached to a claimed/queued/held item. Everything else is dispositioned here with a reason — never deleted.",
		"",
		"| verdict | refs | what it means | the action |",
		"|---|---:|---|---|",
	];
	const meaning = {
		"prune: merged into main": ["the branch's commits are already on main", "remove the worktree, then `git branch -d`"],
		"prune: content already in main, no net change": ["merge-tree(main, ref) == main's tree", "remove the worktree, then `git branch -d`"],
		"prune: clean, unmerged, item terminal (needs a landing entry first)": ["the item closed but its branch was never landed or discarded", "the owning seat lands it or the operator rules it discarded — this pass does not delete it"],
		"keep: conflicts with main — the author re-cuts it": ["merge-tree(main, ref) reports a conflict", "the seat re-cuts from current main; do not force a merge"],
		"keep: uncommitted work — a seat commits it or the operator rules it discarded": ["tracked changes are uncommitted in the worktree", "the seat commits, or the operator discards"],
		"keep: item is live": ["the attached item is claimed, queued or held", "leave it — the seat is still working"],
		"keep: ruled in docs/DISPOSITIONS.md": ["the ledger already holds a KEEP / REVERTED ruling for this ref", "leave it — the ruling is the reason it exists"],
		"keep: seat root": ["the worktree is a seat's own checkout", "leave it"],
		"keep: locked (a run is in flight)": ["the rig holds a run lock on the worktree", "leave it until the run ends"],
		"keep: no queue row proves the item is terminal — needs a disposition": ["the branch names an item with no queue row", "name the owner, then decide"],
	};
	for (const [v, list] of Object.entries(groups)) {
		const [m, a] = meaning[v] || meaning[v.split(" (")[0]] || ["-", "-"];
		lines.push(`| ${v} | ${list.length} | ${m} | ${a} |`);
	}
	lines.push("", "## Every ref, with its facts", "", "| ref | worktree | ahead | merged | merge-check | item | item status | verdict | last commit |", "|---|---|---:|---|---|---|---|---|---|");
	for (const r of rows.sort((a, b) => a.ref.localeCompare(b.ref))) {
		lines.push(
			`| ${bt(r.ref)} | ${r.path ? bt(path.relative(repo, r.path)) : "none"} | ${r.ahead} | ${r.merged ? "yes" : "no"} | ${r.conflict || "-"} | ${r.item ?? "-"} | ${r.status ?? "-"} | ${r.verdict} | ${r.last} |`,
		);
	}
	console.log(lines.join("\n"));
	process.exit(0);
}

console.log(
	flag("--json")
		? JSON.stringify(out, null, 1)
		: [
				`branch census @ ${out.head} — ${out.refs} refs, ${out.worktrees} worktrees`,
				...Object.entries(out.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}  ${k}`),
				"",
				`prune plan (${plan.length}) — refs whose work is provably on main:`,
				...plan.slice(0, flag("--plan") ? plan.length : 12).map((p) => `  ${p.command}`),
				"",
				`needs a landing decision (${needsLanding.length}) — unmerged, clean, item terminal:`,
				...(flag("--plan") ? needsLanding : needsLanding.slice(0, 15)).map((r) => `  ${r.ref}  ahead=${r.ahead}  item=${r.item ?? "-"}  status=${r.status ?? "no row"}`),
			],
);
