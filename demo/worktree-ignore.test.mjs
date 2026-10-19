// demo/worktree-ignore.test.mjs — WORKTREE-ROT (1/3) IGNORE BEFORE CREATE (#2328).
//
// The vendored `using-git-worktrees` skill (vendor/eval/superpowers/skills/using-git-worktrees/
// SKILL.md, "Safety Verification") runs `git check-ignore -q <dir>` and adds the ignore rule
// FIRST, "because an unignored worktree directory commits/leaks the whole tree". durig's shared
// root violates it: `git status` carries `?? item-*/`, `?? wt-*/`, `?? verify-*/`,
// `?? selfdev.sqlite.broker.inbox.out/` and `?? .durig-test-wt-*/`.
//
// Proves the invariant for the GENERIC creation path (`createWorktree`): a target INSIDE the
// repository is git-ignored before it is created, so the shared tree's `git status --short` is
// UNCHANGED by the create. A target OUTSIDE the repository cannot leak and is left alone.
//
// Failing-first: before the guard, the create leaves `?? item-1/` in the source's status.
// Run: node demo/worktree-ignore.test.mjs  (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createWorktree, repoRoot } from "../src/worktree.mjs";

const run = promisify(execFile);

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

/** `git status --short` in `dir`, as a string (the leak surface the operator sees). */
async function statusShort(dir) {
	return (await run("git", ["-C", dir, "status", "--short"])).stdout;
}

/** The exit code of `git check-ignore -q -- <path>` (0 = ignored, 1 = not). */
async function checkIgnoreCode(dir, path) {
	try {
		await run("git", ["-C", dir, "check-ignore", "-q", "--no-index", "--", path]);
		return 0;
	} catch (error) {
		return error.code ?? 1;
	}
}

const base = await mkdtemp(join(tmpdir(), "durig-ignore-"));
const repo = join(base, "repo");
const source = join(repo, "durig");
try {
	await mkdir(source, { recursive: true });
	await writeFile(join(source, "tracked.txt"), "original\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "."]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	console.log("\nThe fixture repo starts clean, so any new `??` line is the create's leak");
	const before = await statusShort(repo);
	check("the fixture repo starts clean", before.trim() === "", JSON.stringify(before));

	console.log("\ncreateWorktree at an IN-REPO path (the item-worktree shape)");
	const target = join(repo, "item-1");
	await createWorktree({ source, target });
	check("the worktree was created", existsSync(target));

	const after = await statusShort(repo);
	check(
		"the create leaves the shared tree's `git status --short` UNCHANGED",
		after === before,
		`status gained: ${JSON.stringify(after)}`,
	);
	check(
		"the created path is git-ignored (check-ignore)",
		(await checkIgnoreCode(repo, "item-1/")) === 0,
		`check-ignore exit ${await checkIgnoreCode(repo, "item-1/")}`,
	);
	check(
		"the ignore did NOT come from a tracked .gitignore edit (the tree is still clean)",
		(await statusShort(repo)).trim() === "",
		JSON.stringify(await statusShort(repo)),
	);

	console.log("\nA second in-repo create (the verify-scratch / wt-* shape) is ignored too");
	const scratch = join(repo, "wt-2");
	await createWorktree({ source, target: scratch });
	check("the second worktree was created", existsSync(scratch));
	check(
		"a second create also leaves status unchanged",
		(await statusShort(repo)) === before,
		`status: ${JSON.stringify(await statusShort(repo))}`,
	);

	console.log("\nA target OUTSIDE the repo cannot leak and is left alone");
	const outside = join(base, "item-outside");
	await createWorktree({ source, target: outside });
	check("an out-of-repo target is still created", existsSync(outside));
	check("repoRoot still resolves the source's repo", (await repoRoot(source)) === repo);

	console.log("\nThe repo's committed .gitignore covers the generated scratch SHAPES");
	// These paths are created by raw `git worktree add` / the broker / the lifecycle test, not
	// through createWorktree, so the committed ignore file is what keeps them out of status.
	// The patterns are DIRECTORY-anchored (`/name/`) so a real probe script of a similar name is
	// NOT swept up (docs/runbooks/leaked-worktrees.md: "a probe script disqualifies it").
	const here = await repoRoot(process.cwd());
	for (const name of [
		"selfdev.sqlite.broker.inbox.out",
		".durig-test-wt-1792344128583",
		".verify-111",
		"verify222",
		"wt-333",
		".land-scratch-1234",
	]) {
		const code = await checkIgnoreCode(here, `${name}/`);
		check(`.gitignore covers the directory shape ${name}/`, code === 0, `check-ignore exit ${code}`);
	}
	// A FILE with a verify- prefix is a real artifact (a qa probe), not scratch — it must stay
	// visible so it is never mistaken for disposable scratch. (Synthetic name, so the check does
	// not depend on which probe files happen to be tracked.)
	check(
		"a verify-* FILE (a real probe artifact) is NOT ignored",
		(await checkIgnoreCode(here, "verify-9999-probe.mjs")) === 1,
		"a probe script was swept up by the scratch pattern",
	);

	console.log(failures === 0 ? "\nPASS — worktree/scratch paths are ignored before creation" : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
