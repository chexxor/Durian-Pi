// demo/worktree-list-failure.test.mjs — `listWorktrees` must not answer "none" when the truth is
// "unknown" (#3605).
//
// THE DEFECT: `src/worktree.mjs` swallowed a git failure and returned `[]`. For a plain listing that is
// a cosmetic wart. For a SAFETY CHECK it is INVERTED, because "no worktree holds this ref" is the
// PERMISSIVE answer — a git failure produced the answer that AUTHORISES the action the check exists to
// prevent. The live example is `prepareSeatWorkspace`'s #3174 branch-holder guard: it reads the list to
// decide whether to REFUSE, so `[]` means "no other worktree holds this branch, go ahead".
//
// THE FIX: `[]` no longer means two things. A caller that DECIDES passes `{ strict: true }` and gets a
// THROW on failure; a caller that REPORTS keeps the lenient `[]` it documented (a path that is not a
// git repo is a normal input for the audit/sweep surface), but an UNEXPECTED failure is written to
// stderr instead of vanishing. The flag is per call site on purpose: fail-closing every caller would
// take down a reporting surface over an expected input.
//
// FAILING-FIRST, by construction: on the parent commit `listWorktrees(repoPath)` takes one argument
// and has no throw path at all, so check 2 below cannot pass there. Re-check without reverting
// anything:
//   git show <this-commit>^:src/worktree.mjs | Select-String "strict"        -> no match
//   git show <this-commit>^:src/worktree.mjs | Select-String "catch \{" -Context 0,2  -> `catch { return []; }`
//
// Run: node demo/worktree-list-failure.test.mjs   (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { listWorktrees } from "../src/worktree.mjs";

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

/** Run `fn` with `console.error` captured, returning { value, stderr }. */
async function captureStderr(fn) {
	const written = [];
	const real = console.error;
	console.error = (...args) => written.push(args.join(" "));
	try {
		const value = await fn();
		return { value, stderr: written.join("\n") };
	} finally {
		console.error = real;
	}
}

const base = await mkdtemp(join(tmpdir(), "durig-listfail-"));
const repo = join(base, "repo");
const notARepo = join(base, "plain-dir");
const missing = join(base, "does-not-exist");
try {
	await mkdir(repo, { recursive: true });
	await mkdir(notARepo, { recursive: true });
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"]);
	await run("git", ["-C", repo, "worktree", "add", "-b", "wtb", join(base, "wt-one")]);

	console.log("\n1. The success path is UNCHANGED — lenient and strict return the same real list");
	{
		const lenient = await listWorktrees(repo);
		const strict = await listWorktrees(repo, { strict: true });
		check("the worktree is listed", lenient.some((w) => /wt-one$/.test(w.worktree.replace(/\\/g, "/"))), JSON.stringify(lenient));
		check("strict returns the same list on success", JSON.stringify(strict) === JSON.stringify(lenient));
	}

	console.log("\n2. A DECIDING caller gets a THROW, never a permissive [] — the whole point");
	{
		let threw = null;
		try {
			await listWorktrees(notARepo, { strict: true });
		} catch (err) {
			threw = err;
		}
		check("strict THROWS on a failed listing", threw !== null, "it returned instead of throwing");
		check(
			"the message names the path and says it will not answer none-for-unknown",
			!!threw && threw.message.includes(notARepo) && /refusing to answer "none"/.test(threw.message),
			threw?.message?.slice(0, 160),
		);
	}

	console.log("\n3. A REPORTING caller keeps the lenient [] it documented");
	{
		const { value, stderr } = await captureStderr(() => listWorktrees(notARepo));
		check("a non-git path yields [] rather than throwing", Array.isArray(value) && value.length === 0, JSON.stringify(value));
		check("and it stays QUIET: a non-repo path is an expected input for the audit/sweep", stderr === "", stderr);
	}

	console.log("\n4. An UNEXPECTED failure is loud instead of silent");
	{
		const { value, stderr } = await captureStderr(() => listWorktrees(missing));
		check("it still yields [] for a reporting caller", Array.isArray(value) && value.length === 0, JSON.stringify(value));
		check("but it WARNS on stderr, naming the path", stderr.includes(missing) && /could not list worktrees/.test(stderr), stderr);
	}

	console.log("\n5. The safety call site STATES its choice: prepareSeatWorkspace's holder guard is strict");
	{
		const src = readFileSync(new URL("../src/worktree.mjs", import.meta.url), "utf8");
		check(
			"the #3174 branch-holder guard passes { strict: true }",
			/listWorktrees\(repo, \{ strict: true \}\)/.test(src),
			"the guard would read a failed listing as 'nothing holds this ref'",
		);
		// A coarse guard, deliberately: it fails if the strict flag disappears from the call site
		// entirely. (The doc comment also spells `strict: true`, so count CALL SITES only.)
		check(
			"exactly one production call site is strict",
			(readFileSync(new URL("../src/worktree.mjs", import.meta.url), "utf8").match(/listWorktrees\([^)]*strict: true/g) ?? []).length === 1,
		);
	}

	console.log(
		failures === 0
			? "\nPASS — listWorktrees cannot be mistaken for an empty success by a caller that decides"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	// Remove the registered worktree FIRST: deleting the repo out from under it leaves git holding
	// the directory (EBUSY on Windows) and would make this demo a leak source itself.
	try {
		await run("git", ["-C", repo, "worktree", "remove", "--force", join(base, "wt-one")]);
	} catch {
		// Already gone, or the repo never initialised; the rm below still cleans up what it can.
	}
	await rm(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

process.exit(failures === 0 ? 0 : 1);
