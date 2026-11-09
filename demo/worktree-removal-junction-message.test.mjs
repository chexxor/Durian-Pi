// #5134: a refusal you cannot act on is a stall with extra steps. The guard was RIGHT - git on this host deletes
// THROUGH a junction, so a worktree containing one must not be removed. The MESSAGE was broken:
// `refusing to remove worktree .../item-5094: junction/symlink detected at undefined/anthropic-ai-sdk`.
// `Dirent.path` does not exist on this runtime (node v24.22.1: a recursive-readdir Dirent carries only `name` and
// `parentPath`), so the path segment was `undefined` and the seat reading it could not tell WHICH link blocked it.
// Five leaked worktrees survived a repair pass behind that message. This demo asserts the MESSAGE, not just the
// exit code - an exit code alone passes today, which is exactly the defect.
// Run: node demo/worktree-removal-junction-message.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOD = process.env.DURIG_WORKTREE_MODULE ?? "../src/worktree.mjs";
const { removeClaimedWorktree } = await import(MOD);

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

// A REAL scratch repo and a REAL worktree inside it. Not cosmetic: `uncommittedWork` fails CLOSED (a directory git
// cannot read is reported as 1 uncommitted path), so a plain temp dir is refused by the dirty gate and the junction
// guard is never reached. The fixture has to be the thing the guard actually runs on.
const scratch = mkdtempSync(join(tmpdir(), "durig-junction-"));
const repo = join(scratch, "repo");
mkdirSync(repo, { recursive: true });
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "tracked.txt"), "tracked content\n");
git(repo, "-c", "user.email=demo@durig", "-c", "user.name=durig-demo", "add", "tracked.txt");
git(repo, "-c", "user.email=demo@durig", "-c", "user.name=durig-demo", "commit", "-q", "-m", "fixture base");
const wt = join(scratch, "item-fixture");
git(repo, "worktree", "add", "-q", wt, "-b", "fx-linked");
const targetDir = join(scratch, "shared-target");
mkdirSync(targetDir, { recursive: true });
writeFileSync(join(targetDir, "precious.txt"), "content that a deletion THROUGH the junction would destroy\n");
const targetBytes = statSync(join(targetDir, "precious.txt")).size;
const linkPath = join(wt, "node_modules", "anthropic-ai-sdk");
mkdirSync(join(wt, "node_modules"), { recursive: true });
symlinkSync(targetDir, linkPath, "junction");

try {
	const err = await removeClaimedWorktree({ worktree: wt }).then(
		() => null,
		(e) => e,
	);
	assert.ok(err, "the guard must still REFUSE - fixing the message must not weaken the refusal");
	const msg = String(err.message);

	// the defect, asserted directly
	assert.ok(!msg.includes("undefined"), `the message must name a real path, not \`undefined\`:\n  ${msg}`);

	// and the actionable content: full path, the root it belongs to, and what it points at
	assert.ok(msg.includes(linkPath), `the message must contain the FULL detected path ${linkPath}:\n  ${msg}`);
	assert.ok(msg.includes(wt), `the message must name the worktree root it belongs to:\n  ${msg}`);
	assert.ok(msg.includes(targetDir), `the message must name the link TARGET (what a deletion would follow):\n  ${msg}`);
	assert.match(msg, /junction\/symlink detected at /, "keep the greppable phrase the docs already cite");
	assert.match(msg, /junction\/symlink detected at \/[A-Za-z0-9._/-]+/, "the detected path must be an absolute path, not a fragment");

	// nothing was deleted: the refusal must still protect the target through which git would have written
	assert.ok(existsSync(linkPath), "the junction itself must still be there");
	assert.ok(existsSync(join(targetDir, "precious.txt")), "and the target's content must be untouched");
	assert.equal(statSync(join(targetDir, "precious.txt")).size, targetBytes, "the target file must be byte-identical");

	// --- a link-free worktree is NOT refused by this guard (the guard did not become a blanket refusal) ------
	const clean = join(scratch, "item-clean");
	git(repo, "worktree", "add", "-q", clean, "-b", "fx-clean");
	mkdirSync(join(clean, "node_modules"), { recursive: true });
	writeFileSync(join(clean, "node_modules", "plain.txt"), "not a link\n");
	const outcome = await removeClaimedWorktree({ worktree: clean });
	assert.ok(!outcome.refused || outcome.refused !== "junction", `a clean tree must not hit the junction guard: ${JSON.stringify(outcome)}`);
	assert.ok(!existsSync(clean), "and it should have been removed by the normal path");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

console.log("worktree-removal-junction-message: OK");
