// worktree.test.mjs — the isolation that makes "the operator reviews a diff" true.
//
// Built on a throwaway git repository rather than this one, for the same reason
// provenance.test.mjs is: a test that manipulates the real tree is a test that can damage it.

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createWorktree, removeWorktree, repoRoot, uncommittedInSource } from "../src/worktree.mjs";

const run = promisify(execFile);

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const base = await mkdtemp(join(tmpdir(), "durig-worktree-"));
const repo = join(base, "repo");
const source = join(repo, "durig");
const target = join(base, "item-1");

try {
	await mkdir(source, { recursive: true });
	await mkdir(join(source, "node_modules"), { recursive: true });
	await writeFile(join(source, "tracked.txt"), "original\n");
	await writeFile(join(source, "node_modules", "dep.js"), "module.exports = 1;\n");
	// The throwaway repo needs the same ignore rule as the real one, or its node_modules would be
	// tracked and the junction below would be a copy instead of a bridge.
	await writeFile(join(repo, ".gitignore"), "node_modules/\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", ".gitignore", "durig"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	console.log("\nThe repo is found from the nested tree, not assumed to be the cwd");
	check("repoRoot resolves the containing repository", (await repoRoot(source)) === repo, await repoRoot(source));

	console.log("\nA worktree reproduces the source's place in the repository");
	const made = await createWorktree({ source, target });
	check("the worktree was created where asked", made.worktree === target && existsSync(target));
	check("its cwd is the same relative place as the source", made.cwd === join(target, "durig") && existsSync(made.cwd), made.cwd);
	check("tracked content came with it", existsSync(join(made.cwd, "tracked.txt")));

	console.log("\nnode_modules is NO LONGER bridged — the caller must install per-worktree");
	check(
		"no node_modules exists after create (the caller must run `npm ci --prefer-offline`)",
		!existsSync(join(made.cwd, "node_modules")),
		"a junction was created instead of leaving it absent",
	);
	// Re-create the bridge manually so the remaining checks (dirty worktree removal) can
	// still run. This is a test-only convenience — real seats would install via npm ci.
	const modules = join(made.cwd, "node_modules");
	await mkdir(modules, { recursive: true });
	await writeFile(join(modules, "dep.js"), "module.exports = 1;\n");

	console.log("\nF23: a DIRTY source must not silently fork a HEAD-only checkout");
	// The operator's uncommitted direct work lives only in the working tree, not in
	// HEAD. A worktree forked from HEAD would not contain it, so a seat could not
	// see it and could clobber it (#240 collision). The smallest guard: refuse.
	const dirtyTarget = join(base, "item-dirty");
	const dirtyNote = join(source, "uncommitted-work.mjs");
	await writeFile(dirtyNote, "// the operator's uncommitted direct work\n");
	let dirtyRefused = null;
	try {
		await createWorktree({ source, target: dirtyTarget });
	} catch (error) {
		dirtyRefused = error;
	}
	check(
		"an untracked change in the source refuses the fork",
		dirtyRefused !== null,
		"it silently forked a HEAD-only checkout instead of refusing",
	);
	check(
		"the refusal names the cause and the fix",
		dirtyRefused !== null && /uncommitted changes/.test(dirtyRefused.message) && /commit or stash/.test(dirtyRefused.message),
		String(dirtyRefused?.message),
	);
	check(
		"no HEAD-only worktree was produced (the silent divergence)",
		!existsSync(dirtyTarget),
		"a worktree was created even though it lacks the uncommitted work",
	);
	check("the operator's uncommitted work is untouched", existsSync(dirtyNote));

	// A tracked modification must trip it too, not only untracked files.
	await run("git", ["-C", source, "add", "-A"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "pick up the work"]);
	await writeFile(join(source, "tracked.txt"), "edited, uncommitted\n");
	let modRefused = null;
	try {
		await createWorktree({ source, target: dirtyTarget });
	} catch (error) {
		modRefused = error;
	}
	check(
		"a tracked, uncommitted modification also refuses",
		modRefused !== null && /uncommitted changes/.test(modRefused.message),
		String(modRefused?.message),
	);
	// Restore a clean source so the remaining checks run exactly as before.
	await run("git", ["-C", source, "checkout", "--", "tracked.txt"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "rm", "-q", join("durig", "uncommitted-work.mjs")]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "drop the F23 seed"]);
	check("the source is clean before the next check", (await run("git", ["-C", source, "status", "--porcelain", "--", "."])).stdout.trim() === "");

	console.log("\nAn existing path is refused rather than adopted or overwritten");
	let refused = null;
	try {
		await createWorktree({ source, target });
	} catch (error) {
		refused = error;
	}
	check("a second create at the same path is refused", refused !== null && /refusing to reuse/.test(refused.message), String(refused));

	console.log("\nRemoval discards, so it must be asked for explicitly");
	// Make the worktree dirty in git's own terms. Untracked-but-ignored content does NOT make a
	// worktree dirty, which is what the first version of this test got wrong: it assumed the
	// junction alone would stop a removal, and the removal then succeeded.
	await writeFile(join(made.cwd, "tracked.txt"), "edited by a seat\n");
	let unforced = null;
	try {
		await removeWorktree({ source, worktree: target });
	} catch (error) {
		unforced = error;
	}
	check("an unforced removal refuses a worktree holding changes", unforced !== null, "it removed it");
	check("and the work is still there", existsSync(join(made.cwd, "tracked.txt")));

	await removeWorktree({ source, worktree: target, force: true });
	check("a forced removal succeeds when the caller said so", !existsSync(target));

	// The canary F8 demands: the point of unlinking the bridge first is that the TARGET survives.
	// Asserting only that the worktree is gone is what the earlier version did, and it passed while
	// the recursion was deleting the real node_modules.
	check(
		"the junction's TARGET survived removal (the failure that emptied a real node_modules)",
		existsSync(join(source, "node_modules", "dep.js")),
		"removal followed the bridge into its target",
	);

	// And the bridge really was dropped first, rather than the removal merely happening to work.
	check("the worktree's own node_modules bridge is gone with the worktree", !existsSync(join(target, "durig", "node_modules")));

	console.log("\ncli.mjs reaches the helper and points seats at a declared cwd");
	const cli = await readFile(new URL("../cli.mjs", import.meta.url), "utf8");
	check("the command is dispatched", cli.includes('cmd === "worktree"') && cli.includes("async function cmdWorktree"));
	check(
		"`up` records a declared cwd on the seat",
		cli.includes("const seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT;") && cli.includes("{ cwd: seatCwd }"),
	);
	// The env fallback is what lets a committed rig stay portable: without it, pointing seats at a
	// worktree would mean writing a host path into the rig file, which item 34 warns against.
	check(
		"the seat root can come from the environment, so a rig file need not name a host path",
		cli.includes("?? CFG.DURIG_SEAT_ROOT") && (await readFile(new URL("../src/config.mjs", import.meta.url), "utf8")).includes('"DURIG_SEAT_ROOT"'),
	);
	check(
		"a seat without a declared cwd keeps the harness default rather than guessing one",
		cli.includes("seatCwd === undefined ? {} : { cwd: seatCwd }"),
	);

	console.log(failures === 0 ? "\nPASS — the worktree isolates" : `\nFAIL — ${failures} assertion(s) failed`);
} finally {
	await rm(base, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
