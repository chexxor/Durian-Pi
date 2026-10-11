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
import { createWorktree, removeWorktree, repoRoot } from "../src/worktree.mjs";

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

	console.log("\nnode_modules is bridged, or the worktree could not run the suite at all");
	check(
		"a node_modules link exists in the worktree (gitignored, so absent otherwise)",
		existsSync(join(made.cwd, "node_modules", "dep.js")),
	);

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
