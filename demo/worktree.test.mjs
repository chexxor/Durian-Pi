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
import { fileURLToPath } from "node:url";
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

	console.log("\nF23 as amended by ASK F #506: a DIRTY source forks the VISIBLE STATE (carry, not refuse)");
	// The original F23 refusal ("commit or stash first") made isolation depend on a
	// pristine shared tree. Under a CONCURRENT team that blocks every worktree claim
	// whenever any seat is mid-edit (#506: "one seat's uncommitted/untracked file
	// blocks all worktree creation"), so seats degraded to the shared tree — the
	// fate #473 exists to prevent. The semantic is now CARRY: the fork gets HEAD
	// plus the enumerated visible content, the carried set is returned, and the
	// broker logs it — anti-stale kept (#240), failure-closed partially removed.
	const dirtyTarget = join(base, "item-dirty");
	const dirtyNote = join(source, "uncommitted-work.mjs");
	await writeFile(dirtyNote, "// the operator's uncommitted direct work\n");
	const plainNote = join(source, "tracked.txt");
	await writeFile(plainNote, "edited, uncommitted\n");
	const carriedRun = await createWorktree({ source, target: dirtyTarget });
	check(
		"a dirty source forks (does NOT refuse): the claim must not fail closed",
		existsSync(dirtyTarget),
		"the fork was blocked — the #506 defect",
		);
	check("the carried set is returned, naming the untracked and edited paths",
		Array.isArray(carriedRun.carried) && carriedRun.carried.some((p) => p.endsWith("uncommitted-work.mjs")) &&
			carriedRun.carried.some((p) => p.endsWith("tracked.txt")),
		JSON.stringify(carriedRun.carried));
	check("the fork CONTENT carries the uncommitted work (anti-stale, #240)",
		(await readFile(join(carriedRun.cwd, "uncommitted-work.mjs"), "utf8")).includes("the operator's uncommitted direct work") &&
			(await readFile(join(carriedRun.cwd, "tracked.txt"), "utf8")) === "edited, uncommitted\n");
	check("the operator's uncommitted work in the SHARED tree is untouched", existsSync(dirtyNote));

	// A DELETION stays a deletion: an uncommitted `rm` must not resurrect from HEAD
	// in the fork, or the fork lies about the visible state.
	await rm(plainNote);
	const delRun = await createWorktree({ source, target: join(base, "item-dirty-del") });
	check("an uncommitted deletion stays deleted in the fork (visible state)",
		!existsSync(join(delRun.cwd, "tracked.txt")), "resurrected from HEAD");
	// Restore a clean source so the remaining checks run exactly as before.
	await run("git", ["-C", source, "add", "-A"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "settle #506 fixture"]);
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

	console.log("\n#1456: a worktree can be forked from an UNLANDED base ref (worktree --ref)");
	{
		// The gap: no entry point could produce a worktree at an unlanded tip, so a fix that must edit
		// a file at that tip (the #1444/entry-11 shape) had no sanctioned path. `createWorktree` already
		// takes `ref`; the CLI verb never passed one.
		const repo2 = join(base, "ref-repo");
		const src2 = join(repo2, "durig");
		await mkdir(src2, { recursive: true });
		await writeFile(join(src2, "artifact.txt"), "on main\n");
		await run("git", ["init", "-q", repo2]);
		await run("git", ["-C", repo2, "add", "durig/artifact.txt"]);
		await run("git", ["-C", repo2, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "main base"]);
		await run("git", ["-C", repo2, "branch", "-M", "main"]);
		// The unlanded tip: a commit on a branch `main` does not contain.
		await run("git", ["-C", repo2, "checkout", "-q", "-b", "unlanded"]);
		await writeFile(join(src2, "artifact.txt"), "on the unlanded tip\n");
		await run("git", ["-C", repo2, "add", "durig/artifact.txt"]);
		await run("git", ["-C", repo2, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "unlanded tip"]);
		const tip = (await run("git", ["-C", repo2, "rev-parse", "HEAD"])).stdout.trim();
		await run("git", ["-C", repo2, "checkout", "-q", "main"]);
		const mainTip = (await run("git", ["-C", repo2, "rev-parse", "HEAD"])).stdout.trim();
		check("the fixture has an unlanded tip distinct from main", tip !== mainTip, `tip ${tip} main ${mainTip}`);

		const cliPath = fileURLToPath(new URL("../cli.mjs", import.meta.url));
		const refTarget = join(base, "wt-ref");
		let cliOk = true;
		let cliErr = "";
		try {
			await run(process.execPath, [cliPath, "worktree", refTarget, "--source", src2, "--ref", "unlanded"]);
		} catch (error) {
			cliOk = false;
			cliErr = String(error?.stderr ?? error?.message ?? error).slice(0, 200);
		}
		check("`worktree --ref` runs", cliOk, cliErr);
		if (cliOk) {
			const head = (await run("git", ["-C", refTarget, "rev-parse", "HEAD"])).stdout.trim();
			check("the worktree sits at the UNLANDED tip, not main", head === tip, `got ${head}, tip ${tip}, main ${mainTip}`);
			check(
				"...so the unlanded content is present",
				(await readFile(join(refTarget, "durig", "artifact.txt"), "utf8")).includes("unlanded"),
			);
		}

		// Control: with no --ref the same verb forks HEAD (main) — so the check above is about `ref`.
		const headTarget = join(base, "wt-head");
		try {
			await run(process.execPath, [cliPath, "worktree", headTarget, "--source", src2]);
		} catch {}
		const headNoRef = (await run("git", ["-C", headTarget, "rev-parse", "HEAD"])).stdout.trim();
		check("without --ref the worktree forks HEAD (main), the old behaviour", headNoRef === mainTip, `got ${headNoRef}`);
	}

	console.log(failures === 0 ? "\nPASS — the worktree isolates" : `\nFAIL — ${failures} assertion(s) failed`);
} finally {
	await rm(base, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
