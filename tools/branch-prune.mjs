// tools/branch-prune.mjs — execute the branch census's prune plan, safely, in one bounded call.
//
// WHY. `tools/branch-census.mjs` answers "what is safe to remove?" and prints the commands. Retyping those
// commands by hand is where a pass goes wrong: refs are LIVE (a seat can commit between the census and the
// delete), and `git branch -D` is not an option — the seat guard forbids it and a delegate should not use it
// either. This tool does the loop that a session kept re-writing: re-verify ancestry at the moment of
// deletion, release the worktree without `--force`, delete the branch with `-d` (never `-D`), and print a
// recovery line for every ref it removed.
//
// Measured cost (Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0, 99 refs / 94 worktrees after the 2026-11-14 prune): `--dry-run` on the live rig 8.4 s, exit 0.
// The census leg is the whole cost (~7.7 s at 99 refs; 25-35 s on a 100+ ref rig); each delete is one `git`
// spawn at ~2 ms (5 measured `merge-base` calls: 10 ms), so 120 deletes is under a second.
//
// Usage:
//   node tools/branch-prune.mjs [--db ./selfdev.sqlite] [--repo .] [--dry-run] [--plan <census.json>]
//   node tools/branch-prune.mjs --reap-worktrees [--dry-run]   # release the trees the audit calls reapable; refs untouched
// Exit codes:
//   0  every planned ref was removed (or, with --dry-run, every planned ref passed the live gate)
//   1  a planned ref was SKIPPED or a removal FAILED — the plan and the live git state disagree
//   2  the census could not be read, or usage error
//
// The gate, per ref (the same rule the census encodes, re-checked live because refs move):
//   git merge-base --is-ancestor <ref> main  -> exit 0   (its work is on main)
//   AND the ref is not a snapshot/archive name (`snapshot|archive|pre-split|backup|selfdev-<n>`)
// then `git worktree remove <path>` (NO --force) and `git branch -d <ref>` (never -D).
// Anything the census kept — seat roots, locked trees, dirty trees, ledger KEEP rows, conflicted refs —
// never reaches this tool's plan.
//
// Trap this tool is written against (SELFDEV pitfall 364): `spawnSync` returns `.status`, NOT `.code`.
// A check written as `r.code !== 0` is `undefined !== 0` -> true, so every ref "fails" the ancestor test,
// nothing is deleted, and the run still prints counts that look like a pass. The counts here are the
// assertion: a run that planned N and deleted 0 exits 1.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const NEVER_PRUNE = /(snapshot|archive|pre-split|backup|selfdev-\d+)/i;

/** Run one git verb. `.status` is the exit code — `.code` does not exist on spawnSync results. */
function git(args, repo, timeoutMs = 20000) {
	const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: timeoutMs });
	return { status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || r.message || "").trim() };
}

/**
 * Release the worktrees the rig's own audit calls `reapable` (terminal + unlocked + clean), WITHOUT touching
 * any ref. A clean, unlocked tree whose item row is terminal holds nothing that git cannot reproduce from the
 * ref; the ref is left in place (rule R-B #3270), so this is reversible with `git worktree add <path> <ref>`.
 * `cli.mjs worktree audit` exits 1 whenever it has remedies to print — that is a verdict, not a crash (pitfall 360).
 */
export function reapWorktrees({ repo, db, dryRun = false, auditJson = null }) {
	const a = auditJson
		? { status: 0, stdout: auditJson }
		: spawnSync("node", ["cli.mjs", "worktree", "audit", "--json"], { cwd: repo, env: { ...process.env, DURIG_DB: db }, encoding: "utf8", timeout: 120000 });
	let audit;
	try {
		audit = JSON.parse(a.stdout);
	} catch (e) {
		return { ok: false, error: `worktree audit unreadable (exit ${a.status}): ${e.message}` };
	}
	const trees = (audit.worktrees || []).filter((w) => w.keepReason === "reapable" && !w.locked && (w.uncommitted || 0) === 0);
	const res = { ok: true, dryRun, reapable: trees.length, removed: 0, refused: 0, log: [], auditExit: a.status, counts: { seatRoot: audit.counts?.["seat-root"], live: audit.counts?.live, dirty: audit.counts?.dirty, locked: audit.counts?.locked } };
	for (const w of trees) {
		if (dryRun) {
			res.log.push(`DRY ${w.worktree}${w.branch ? `  ref ${w.branch}` : ""}`);
			continue;
		}
		const r = git(["worktree", "remove", w.worktree], repo); // no --force: a refusal is the safety net
		if (r.status === 0) {
			res.removed++;
			res.log.push(`REMOVED ${w.worktree}${w.branch ? `  ref ${w.branch} kept` : ""}`);
		} else {
			res.refused++;
			res.log.push(`REFUSED ${w.worktree}: ${r.stderr.split("\n")[0]} — its owner must clean it`);
		}
	}
	if (!dryRun) git(["worktree", "prune"], repo);
	res.ok = res.refused === 0;
	return res;
}

/**
 * Execute a prune plan. `plan` is the census's `plan` array: [{ref, worktree, command}].
 * Returns the counts; the caller turns them into an exit code.
 */
export function prunePlan({ repo, plan, dryRun = false, logPath = null, mainRef = "refs/heads/main" }) {
	const res = {
		ok: true,
		repo,
		dryRun,
		planned: plan.length,
		worktreesRemoved: 0,
		worktreesFailed: 0,
		branchesDeleted: 0,
		branchesFailed: 0,
		skipped: 0,
		log: [],
	};

	// A tree mid-merge is never a safe place to prune refs (docs/runbooks/branch-cleanup.md, Diagnose).
	const mergeHead = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], repo);
	if (mergeHead.status === 0) {
		return { ...res, ok: false, error: `merge in progress (MERGE_HEAD ${mergeHead.stdout}) — prune refused` };
	}

	for (const p of plan) {
		const ref = p.ref;
		if (!ref) continue;

		if (NEVER_PRUNE.test(ref)) {
			res.skipped++;
			res.log.push(`SKIP ${ref}: snapshot/archive name — this tool never prunes those (branch-cleanup step 4)`);
			continue;
		}

		// Live gate, not a remembered census verdict: refs are created and advanced while a pass runs.
		const anc = git(["merge-base", "--is-ancestor", `refs/heads/${ref}`, mainRef], repo);
		if (anc.status !== 0) {
			res.skipped++;
			res.log.push(`SKIP ${ref}: not an ancestor of main at delete time — keep it, the author re-cuts or lands it`);
			continue;
		}

		const sha = git(["rev-parse", `refs/heads/${ref}`], repo).stdout;
		if (dryRun) {
			res.log.push(`DRY ${ref} @ ${sha.slice(0, 12)}${p.worktree ? `  worktree ${p.worktree}` : ""}`);
			continue;
		}

		if (p.worktree) {
			const w = git(["worktree", "remove", p.worktree], repo); // no --force: a refusal is the safety net
			if (w.status !== 0) {
				res.worktreesFailed++;
				res.log.push(`FAIL worktree remove ${p.worktree}: ${w.stderr.split("\n")[0]} — branch NOT deleted, tree still holds it`);
				continue; // `git branch -d` would refuse a checked-out ref anyway
			}
			res.worktreesRemoved++;
		}

		const b = git(["branch", "-d", ref], repo); // -d, never -D: it cannot delete unmerged work
		if (b.status !== 0) {
			res.branchesFailed++;
			res.log.push(`FAIL branch -d ${ref}: ${b.stderr.split("\n")[0]}`);
		} else {
			res.branchesDeleted++;
			// Recovery line: the ref is recoverable while the reflog holds it.
			res.log.push(`DELETED ${ref} @ ${sha.slice(0, 12)} — recover: git branch ${ref} ${sha}`);
		}
	}

	if (!dryRun) git(["worktree", "prune"], repo);
	res.ok = res.skipped === 0 && res.worktreesFailed === 0 && res.branchesFailed === 0;

	if (logPath && !dryRun) {
		fs.writeFileSync(logPath, res.log.join("\n") + "\n");
		res.logPath = logPath;
	}
	return res;
}

function main() {
	const repo = path.resolve(opt("--repo", process.cwd()));
	const db = opt("--db", process.env.DURIG_DB || "./selfdev.sqlite");
	const logPath = opt("--log", ".spike/prune-log.txt");
	const t0 = Date.now();

	if (flag("--reap-worktrees")) {
		const r = reapWorktrees({ repo, db, dryRun: flag("--dry-run") });
		console.log(
			`worktree reap @ ${git(["rev-parse", "HEAD"], repo).stdout.slice(0, 12)} — audit says ${r.reapable} reapable; ` +
				(flag("--dry-run") ? `would remove ${r.reapable}` : `removed ${r.removed}, refused ${r.refused}`) +
				`; seat roots ${r.counts.seatRoot}, live ${r.counts.live}, dirty ${r.counts.dirty}, locked ${r.counts.locked}; ${((Date.now() - t0) / 1000).toFixed(1)} s`,
			);
			for (const line of r.log) console.log("  " + line);
			if (r.error) console.log("  " + r.error);
			return r.ok && !r.error ? 0 : 1;
		}

	let plan;
	if (flag("--plan")) {
		plan = JSON.parse(fs.readFileSync(opt("--plan", ""), "utf8")).plan || [];
	} else {
		// The census is the plan. Cost: ~30 s on a 100-ref rig (measured, host in the header).
		const c = spawnSync("node", [path.join(path.dirname(new URL(import.meta.url).pathname), "branch-census.mjs"), "--json", "--repo", repo, "--db", db], {
			encoding: "utf8",
			timeout: 240000,
		});
		if (c.status !== 0) {
			console.error(`census failed (exit ${c.status}): ${(c.stderr || "").split("\n")[0]}`);
			return 2;
		}
		plan = JSON.parse(c.stdout).plan || [];
	}

	const r = prunePlan({ repo, plan, dryRun: flag("--dry-run"), logPath: flag("--dry-run") ? null : logPath });
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(
		`prune @ ${git(["rev-parse", "HEAD"], repo).stdout.slice(0, 12)} — planned ${r.planned}; ` +
			`${flag("--dry-run") ? "would delete " + r.planned : `branches deleted ${r.branchesDeleted}, worktrees removed ${r.worktreesRemoved}`}; ` +
			`skipped ${r.skipped}; failed ${r.branchesFailed + r.worktreesFailed}; ${secs} s`,
	);
	for (const line of r.log) console.log("  " + line);
	if (r.error) console.log("  " + r.error);
	if (!flag("--dry-run") && r.logPath) console.log(`  recovery log: ${r.logPath}`);
	return r.ok && !r.error ? 0 : 1;
}

// Run only when invoked directly, so demo/branch-prune.test.mjs can import prunePlan against a fixture.
if (path.resolve(process.argv[1] || "") === path.resolve(new URL(import.meta.url).pathname)) process.exit(main());
