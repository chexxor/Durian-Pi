// Falsifier for #6926 Q3: "is the promote verb structurally the ONLY writer of main?"
// A seat works in a LINKED worktree on its own branch. Linked worktrees share one ref namespace.
// Question: can a command issued from inside that worktree move a ref it does not own (here,
// the stand-in for main), without ever touching that branch's files?
// Run: node tools/probes/main-ref-writer-falsifier-6926.mjs
//   exit 0 = the ref did not move (protection is structural)
//   exit 1 = the ref moved (protection is a convention, not a structure)
import { spawnSync } from "node:child_process";
import { mkdtempSync as mk, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mk(join(process.cwd(), ".probe-6926"));
const git = (argv, cwd) => {
	const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
	return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

try {
	const repo = join(dir, "repo");
	git(["init", "-q", repo], dir);

	writeFileSync(join(repo, "base.txt"), "base\n");
	git(["add", "base.txt"], repo);
	git(["commit", "-q", "-m", "base"], repo);
	const baseSha = git(["rev-parse", "HEAD"], repo).out;

	// "main" stand-in: a ref nobody in this test is allowed to move.
	git(["branch", "probe-main", baseSha], repo);

	// The seat's branch and worktree.
	writeFileSync(join(repo, "seed.txt"), "seed\n");
	git(["add", "seed.txt"], repo);
	git(["commit", "-q", "-m", "seed on the seat branch"], repo);
	git(["branch", "probe-work", git(["rev-parse", "HEAD"], repo).out], repo);
	const wt = join(dir, "wt");
	git(["worktree", "add", "-q", wt, "probe-work"], repo);

	writeFileSync(join(wt, "work.txt"), "seat work\n");
	git(["add", "work.txt"], wt);
	git(["commit", "-q", "-m", "seat commit #6926"], wt);
	const seatSha = git(["rev-parse", "HEAD"], wt).out;

	const before = git(["rev-parse", "refs/heads/probe-main"], repo).out;
	const move = git(["update-ref", "refs/heads/probe-main", seatSha], wt);
	const after = git(["rev-parse", "refs/heads/probe-main"], repo).out;

	console.log("stand-in repo inside this item's worktree; probe-main stands in for refs/heads/main");
	console.log(`probe-main before                : ${before.slice(0, 12)}`);
	console.log(`command run FROM the seat worktree: git update-ref refs/heads/probe-main ${seatSha.slice(0, 12)}`);
	console.log(`exit code                        : ${move.code}  stderr: ${move.err || "(none)"}`);
	console.log(`probe-main after                 : ${after.slice(0, 12)}`);
	if (after === before) {
		console.log("RESULT: PROTECTED - the ref did not move");
		process.exit(0);
	}
	console.log("RESULT: NOT PROTECTED - a command issued inside a linked worktree moved a ref it does not own.");
	console.log("Corroborating: src/confine.mjs:498 lists `update-ref` in GIT_WRITING_CLAIMED, commented");
	console.log("\"runbook-prescribed; can move any ref, including refs/heads/main - named as open\";");
	console.log("refusalFor returned null for it (tools/probes/main-writer-surface-6926.mjs, exit 0).");
	process.exit(1);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
