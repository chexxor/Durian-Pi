// demo/worktree-prune-branch.test.mjs — `worktree prune-branch <name>` (#3491): the ONE sanctioned
// route for a SEAT to remove a PATCH-EQUIVALENT ref.
//
// The class this closes: `git branch -d` correctly refuses a ref whose tip is not an ancestor of
// main (its content is on main by PATCH, not by ancestry), and the seat guard refuses `git branch
// -D` (src/confine.mjs `branchForceDelete`, #1211). So before this verb a branch that was entirely
// landed by rebase could not be cleaned up by any seat — it escalated to the operator on every
// cleanup pass (docs/runbooks/branch-cleanup.md step 3, run by hand on `designer-item-2103`).
//
// The fixtures are REAL, not mocked: a rebase-duplicate is built by cherry-picking a branch's own
// commit onto main, which is exactly how a `-rebased` copy lands. Nothing here is a stub.
//
// Failing-first: before `prunePatchEquivalentBranch` exists the import throws, and the premise
// assertion (`git branch -d` refuses the duplicate) is the gap the verb fills.
// Run: node demo/worktree-prune-branch.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { prunePatchEquivalentBranch } from "../src/worktree.mjs";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));

const run = promisify(execFile);
// IDENTITY IS PART OF THE FIXTURE, NOT OF THE DEVELOPER'S MACHINE (2026-10-26). `commit` below set
// `-c user.email` per call, but `cherry-pick` did not — so on a host with no GLOBAL git identity the
// fixture died with "Committer identity unknown" and the test read as a product failure. A test that
// depends on ambient git config is not hermetic; inject the identity on every command instead.
const IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];
const git = (cwd, ...args) => run("git", ["-C", cwd, ...IDENTITY, ...args]);
const commit = (cwd, msg) =>
	run("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg]);
// A commit with a FIXED date, for any commit that will later be CHERRY-PICKED.
// WHY THIS EXISTS (2026-10-26): a cherry-pick of a commit whose parent, tree, author, committer and
// message are all identical reproduces the IDENTICAL object — same sha — so the "duplicate" branch
// became an ancestor of main and `git rev-list --count main..dup` was 0, not 1. That only fails when
// the original commit and the pick land in the same second, so the fixture was racing a clock tick
// and read as a product failure. Pinning the original's dates to the past makes the pick's "now"
// differ deterministically, which is the condition the fixture actually means to create.
const commitAt = (cwd, msg, iso) =>
	run("git", ["-C", cwd, ...IDENTITY, "commit", "-q", "-m", msg], {
		env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
	});
// A git command expected to FAIL; returns its stderr so the refusal can be inspected.
const gitFails = async (cwd, ...args) => {
	try {
		await run("git", ["-C", cwd, ...args]);
	} catch (error) {
		return String(error.stderr ?? error.message ?? error);
	}
	return null;
};
const refExists = async (repo, name) => {
	try {
		await run("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
		return true;
	} catch {
		return false;
	}
};

const base = mkdtempSync(join(tmpdir(), "durig-prune-branch-"));
const repo = join(base, "repo");
const at = (name) => join(repo, name);

try {
	// ---- fixture: a repo whose default branch is main -------------------------------------------
	await run("git", ["init", "-q", "-b", "main", repo]);
	writeFileSync(join(repo, "shared.txt"), "base\n");
	await git(repo, "add", "shared.txt");
	await commit(repo, "init");

	// ---- fixture: `dup` — a REAL rebase-duplicate ------------------------------------------------
	// Its commit is cherry-picked onto main, so `git cherry main dup` prints `-` (patch-equivalent)
	// while `dup` is NOT an ancestor of main. This is precisely what a `-rebased` landing produces.
	await git(repo, "branch", "dup");
	await git(repo, "checkout", "-q", "dup");
	writeFileSync(join(repo, "dup.txt"), "landed by rebase\n");
	await git(repo, "add", "dup.txt");
	await commitAt(repo, "dup work", "2020-01-01T00:00:00Z");
	const dupTip = (await git(repo, "rev-parse", "dup")).stdout.trim();
	await git(repo, "checkout", "-q", "main");
	await git(repo, "cherry-pick", (await git(repo, "rev-parse", "dup")).stdout.trim());

	// ---- fixture: `held` — patch-equivalent AND checked out in a worktree ------------------------
	await git(repo, "branch", "held");
	await git(repo, "checkout", "-q", "held");
	writeFileSync(join(repo, "held.txt"), "held work\n");
	await git(repo, "add", "held.txt");
	await commitAt(repo, "held work", "2020-01-02T00:00:00Z");
	await git(repo, "checkout", "-q", "main");
	await git(repo, "cherry-pick", (await git(repo, "rev-parse", "held")).stdout.trim());
	await git(repo, "worktree", "add", "-q", at("wt-held"), "held");

	// ---- fixture: `unique` — UNLANDED (a `+` line; never prunable) -------------------------------
	await git(repo, "branch", "unique");
	await git(repo, "checkout", "-q", "unique");
	writeFileSync(join(repo, "unique.txt"), "not on main\n");
	await git(repo, "add", "unique.txt");
	await commit(repo, "unique work");
	await git(repo, "checkout", "-q", "main");

	// ---- fixture: `anc` — already an ANCESTOR of main (git cherry prints NOTHING) ----------------
	await git(repo, "branch", "anc", "main~1");

	// ===== PREMISE: the duplicate really is unreachable by every seat-sanctioned route ===========
	const cherry = (await git(repo, "cherry", "main", "dup")).stdout
		.trim()
		.split("\n")
		.filter(Boolean);
	assert.equal(cherry.length, 1, "fixture: the duplicate has exactly one commit not in main");
	assert.ok(
		cherry.every((l) => l.startsWith("-")),
		"fixture: every such commit is patch-equivalent (`-`)",
	);
	const dRefusal = await gitFails(repo, "branch", "-d", "dup");
	assert.ok(
		dRefusal !== null,
		"PREMISE: `git branch -d` REFUSES the patch-equivalent ref (not an ancestor)",
	);
	assert.ok(
		await refExists(repo, "dup"),
		"PREMISE: the duplicate survives `-d`, so the gap is real",
	);

	// ===== 1. the sanctioned route SUCCEEDS on a patch-equivalent, unheld ref ====================
	const pruned = await prunePatchEquivalentBranch({ repoPath: repo, branch: "dup" });
	assert.equal(pruned.branch, "dup", "the result names the pruned branch");
	assert.equal(pruned.sha, dupTip, "the result records the tip sha that was removed");
	assert.equal(await refExists(repo, "dup"), false, "the patch-equivalent ref IS removed");
	assert.equal(
		pruned.recovery,
		`git branch dup ${dupTip}`,
		"the result prints the RECOVERY command, verbatim and copy-pasteable",
	);

	// ===== 2. the printed recovery command actually restores the ref =============================
	await git(repo, "branch", "dup", pruned.sha);
	assert.ok(await refExists(repo, "dup"), "the printed recovery command restores the ref");
	// The restored ref is the same patch-equivalent shape, so the verb removes it again — the route
	// is repeatable, not a one-shot that depends on the ref never having existed.
	const again = await prunePatchEquivalentBranch({ repoPath: repo, branch: "dup" });
	assert.equal(again.sha, dupTip, "a restored ref is pruned again with the same sha recorded");
	assert.equal(
		await refExists(repo, "dup"),
		false,
		"the restored ref is removed by the verb itself",
	);

	// ===== 3. REFUSES a ref held by a worktree (condition 2) =====================================
	const heldRefusal = await prunePatchEquivalentBranch({ repoPath: repo, branch: "held" }).then(
		() => null,
		(error) => String(error?.message ?? error),
	);
	assert.ok(heldRefusal !== null, "a ref held by a worktree is REFUSED");
	assert.match(heldRefusal, /worktree/i, "the refusal names the worktree as the reason");
	assert.ok(await refExists(repo, "held"), "the held ref is NOT removed");

	// ===== 4. REFUSES an UNLANDED ref (condition 1: a `+` line) =================================
	const uniqueRefusal = await prunePatchEquivalentBranch({ repoPath: repo, branch: "unique" }).then(
		() => null,
		(error) => String(error?.message ?? error),
	);
	assert.ok(uniqueRefusal !== null, "an unlanded ref is REFUSED");
	assert.match(
		uniqueRefusal,
		/not patch-equivalent|unlanded/i,
		"the refusal names the unlanded commit(s)",
	);
	assert.ok(await refExists(repo, "unique"), "the unlanded ref is NOT removed");

	// ===== 5. REFUSES an ANCESTOR ref — `git cherry` prints NOTHING, and empty must NOT read as
	//          "all `-`" (vacuous truth would hand this verb the whole ref namespace) ==============
	const ancCherry = (await git(repo, "cherry", "main", "anc")).stdout.trim();
	assert.equal(ancCherry, "", "fixture: `git cherry` prints NOTHING for an ancestor ref");
	const ancRefusal = await prunePatchEquivalentBranch({ repoPath: repo, branch: "anc" }).then(
		() => null,
		(error) => String(error?.message ?? error),
	);
	assert.ok(ancRefusal !== null, "an ANCESTOR ref is REFUSED (empty `git cherry` is not `all -`)");
	assert.match(ancRefusal, /git branch -d/, "the refusal points at the safe route that DOES work");
	assert.ok(await refExists(repo, "anc"), "the ancestor ref is NOT removed");

	// ===== 6. REFUSES main, a missing ref, and a non-branch ref =================================
	const mainRefusal = await prunePatchEquivalentBranch({ repoPath: repo, branch: "main" }).then(
		() => null,
		(error) => String(error?.message ?? error),
	);
	assert.ok(mainRefusal !== null, "main itself is REFUSED");
	assert.ok(await refExists(repo, "main"), "main is NOT removed");

	const missingRefusal = await prunePatchEquivalentBranch({
		repoPath: repo,
		branch: "no-such-ref",
	}).then(
		() => null,
		(error) => String(error?.message ?? error),
	);
	assert.ok(missingRefusal !== null, "a missing ref is REFUSED");
	assert.match(
		missingRefusal,
		/not a local branch|does not exist|no such/i,
		"the refusal says the ref is absent",
	);

	const emptyRefusal = await prunePatchEquivalentBranch({ repoPath: repo, branch: "" }).then(
		() => null,
		(error) => String(error?.message ?? error),
	);
	assert.ok(emptyRefusal !== null, "an empty branch name is REFUSED");

	// ===== 7. the CLI VERB is wired end to end — `node cli.mjs worktree prune-branch <name>` ======
	// A module-level test alone would not catch a verb that is implemented but not dispatched.
	await git(repo, "branch", "dup2");
	await git(repo, "checkout", "-q", "dup2");
	writeFileSync(join(repo, "dup2.txt"), "landed by rebase too\n");
	await git(repo, "add", "dup2.txt");
	await commitAt(repo, "dup2 work", "2020-01-03T00:00:00Z");
	const dup2Tip = (await git(repo, "rev-parse", "dup2")).stdout.trim();
	await git(repo, "checkout", "-q", "main");
	await git(repo, "cherry-pick", dup2Tip);

	const cliEnv = { ...process.env, DURIG_DB: "./rig.sqlite" };
	const ok = spawnSync(process.execPath, [CLI, "worktree", "prune-branch", "dup2"], {
		cwd: repo,
		env: cliEnv,
		encoding: "utf8",
	});
	assert.equal(
		ok.status,
		0,
		`the CLI verb exits 0 on a patch-equivalent ref; stdout=${ok.stdout} stderr=${ok.stderr}`,
	);
	let doc;
	try {
		doc = JSON.parse(ok.stdout.trim());
	} catch {
		assert.fail(`the CLI verb must print one JSON document; got: ${ok.stdout}`);
	}
	assert.equal(doc.ok, true, "the CLI reports ok:true");
	assert.equal(doc.subcommand, "prune-branch", "the CLI names the subcommand");
	assert.equal(doc.branch, "dup2", "the CLI names the branch it removed");
	assert.equal(doc.sha, dup2Tip, "the CLI reports the removed tip sha");
	assert.equal(doc.recovery, `git branch dup2 ${dup2Tip}`, "the CLI prints the recovery command");
	assert.equal(await refExists(repo, "dup2"), false, "the CLI verb removed the ref");

	const refused = spawnSync(process.execPath, [CLI, "worktree", "prune-branch", "unique"], {
		cwd: repo,
		env: cliEnv,
		encoding: "utf8",
	});
	assert.equal(
		refused.status,
		1,
		"a refusal through the CLI exits NON-ZERO (a report, not a retry signal)",
	);
	const refusalDoc = JSON.parse(refused.stdout.trim());
	assert.equal(refusalDoc.ok, false, "a refusal through the CLI reports ok:false");
	assert.match(
		refusalDoc.error,
		/NOT patch-equivalent/i,
		"the CLI refusal carries the reason, not just a code",
	);
	assert.ok(await refExists(repo, "unique"), "the CLI refusal removed nothing");

	// ===== 8. the survivors of the whole demo are exactly the ones that must survive =============
	const remaining = (await git(repo, "branch", "--format=%(refname:short)")).stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.sort();
	assert.deepEqual(
		remaining,
		["anc", "held", "main", "unique"],
		"only the patch-equivalent, unheld refs were removed; every other ref survives",
	);

	console.log(
		"WORKTREE PRUNE-BRANCH PASS (a patch-equivalent unheld ref is removed with its recovery command printed; a held ref, an unlanded ref, an ancestor ref, main and a missing ref are all REFUSED and survive; the CLI verb is wired, exits 1 on refusal, and reports ok:false)",
	);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
