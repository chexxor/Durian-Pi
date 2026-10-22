// demo/prepare-workspace-create-base.test.mjs — an EXPLICIT base is honoured on the CREATE path, or
// the request is REFUSED; it is never silently ignored while the response claims a fork (#3807)
//
// THE DEFECT (reproduced on main before this change, and pinned here): `createWorktree` attached an
// EXISTING item branch with `git worktree add <target> <branch>` — a form that IGNORES `ref`. So
// `prepare_workspace` with `base=<some tip>` on an item whose branch already existed (an earlier
// attempt's branch, its worktree since removed) produced a tree at the branch's OWN tip, reported
// `created: true`, and printed "Forked from base ref <base> (not HEAD)". Captured on main:
//   created: true | branch impl-item-5 | branchAction: created
//   HEAD: <the leftover tip>   (requested base: a different commit)
//   "WORKSPACE READY (created): ...\nForked from base ref <base> (not HEAD)."
// A false success about the tree state, which is the one thing every verify in this repo stands on.
// (The REUSE path has the same reporting defect; that half is impl-item-3558's, not this file's.)
//
// THE RULE THIS PINS: on the create path, a caller that ASKS for a base gets that base, or a refusal
// that names both commits — never a different tree with a fork claim attached. Re-attaching an
// existing item branch without a base is still allowed and is now REPORTED (`branchAction:
// "attached-existing"`) instead of being called "created".
//
// Run: node demo/prepare-workspace-create-base.test.mjs   (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prepareSeatWorkspace, removeSeatWorkspace } from "../src/worktree.mjs";

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

const base = await mkdtemp(join(tmpdir(), "durig-pw-create-"));
const repo = join(base, "repo");
const short = (sha) => (typeof sha === "string" && sha !== "" ? sha.slice(0, 9) : "unknown");
const headOf = async (worktree) => (await run("git", ["-C", worktree, "rev-parse", "HEAD"])).stdout.trim();
const worktreePaths = async () =>
	(await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length).replace(/\\/g, "/"));

try {
	// No package.json: `isProvisioned` says true, so no npm install runs (offline, fast).
	await mkdir(repo, { recursive: true });
	await writeFile(join(repo, "f.txt"), "one\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "."]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "c1"]);
	const c1 = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
	await writeFile(join(repo, "f.txt"), "two\n");
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "c2"]);
	const c2 = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
	check("fixture has two distinct commits", c1 !== c2 && c1.length === 40, `${short(c1)} vs ${short(c2)}`);
	// LEFTOVER item branches: an earlier attempt's branch, its worktree since removed.
	for (const b of ["impl-item-5", "impl-item-6", "impl-item-8"]) {
		await run("git", ["-C", repo, "branch", b, c1]);
	}

	console.log("\n1. An explicit base the leftover branch is NOT at: REFUSED, and nothing is created");
	let refusal = null;
	try {
		await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 5, seatName: "impl", ref: c2 });
	} catch (err) {
		refusal = err;
	}
	check("the request is refused instead of returning a tree at the wrong base", refusal !== null);
	const message = refusal?.message ?? "";
	// N1: the leftover legacy ref is ADOPTED (renamed to item-<id>) before the base check, so the
	// refusal names the canonical branch. The rename is lossless — same commits, canonical name.
	check("the refusal names the branch it would have attached", /branch item-5:/.test(message), message.slice(0, 160));
	check("it names the base that was asked for", message.includes(short(c2)), message.slice(0, 240));
	check("it names the commit the branch is actually at", message.includes(short(c1)), message.slice(0, 240));
	check("it says nothing was created", /Nothing was created/.test(message), message.slice(0, 240));
	check(
		"it offers a way forward rather than only refusing",
		/Drop the base|prepare a `?different item|land\/delete/.test(message),
		message.slice(-200),
	);
	check("no bare 40-hex token in the refusal (the redactor would eat it, #3128)", !/\b[0-9a-f]{40}\b/i.test(message), message.slice(0, 240));
	check("the refused call left NO directory behind", !existsSync(join(repo, "item-5")), join(repo, "item-5"));
	check(
		"and registered no worktree",
		!(await worktreePaths()).some((p) => p.endsWith("/item-5")),
		JSON.stringify(await worktreePaths()),
	);

	console.log("\n2. No base asked for: the leftover branch is RE-ATTACHED (unchanged behaviour), and it is reported honestly");
	const attached = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 5, seatName: "impl" });
	check("created", attached.created === true, String(attached.created));
	check("the branch is attached, not claimed as created", attached.branchAction === "attached-existing", String(attached.branchAction));
	check(`the tree is at the leftover branch's tip (${short(c1)})`, (await headOf(attached.worktree)) === c1, short(await headOf(attached.worktree)));

	console.log("\n3. An explicit base the leftover branch IS at: attached, and the fork claim is TRUE");
	const atBase = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 6, seatName: "impl", ref: c1 });
	check("the worktree is created", atBase.created === true, String(atBase.created));
	check("reported as an attach", atBase.branchAction === "attached-existing", String(atBase.branchAction));
	const atBaseHead = await headOf(atBase.worktree);
	check("the tree really is at the base that was asked for", atBaseHead === c1, `${short(atBaseHead)} vs ${short(c1)}`);

	console.log("\n4. A FRESH item branch with an explicit base: created FROM that base (#1456's guarantee survives)");
	const forked = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 7, seatName: "impl", ref: c2 });
	check("created", forked.created === true, String(forked.created));
	check("branchAction is created (the branch did not exist)", forked.branchAction === "created", String(forked.branchAction));
	check(`the tree sits at the requested base (${short(c2)})`, (await headOf(forked.worktree)) === c2, short(await headOf(forked.worktree)));

	console.log("\n5. An explicit base that does not resolve: REFUSED, not silently attached");
	let unresolved = null;
	try {
		await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 8, seatName: "impl", ref: "no-such-ref-here" });
	} catch (err) {
		unresolved = err;
	}
	check("refused", unresolved !== null);
	check(
		"the refusal says the base does not resolve",
		/does not resolve to a commit/.test(unresolved?.message ?? ""),
		(unresolved?.message ?? "").slice(0, 200),
	);
	check("nothing was created for it either", !existsSync(join(repo, "item-8")), join(repo, "item-8"));

	// Teardown is BEST-EFFORT and never decides the verdict (#3464): a Windows temp dir can refuse the
	// delete, and a cleanup failure must not turn a behavioural pass into a red suite.
	for (const id of [5, 6, 7]) {
		try {
			await removeSeatWorkspace({ worktreeRoot: repo, itemId: id, releaseIfRefused: true });
		} catch (err) {
			console.error(`cleanup: item-${id} not removed (the temp repo is deleted anyway): ${err.message}`);
		}
	}

	console.log(
		failures === 0
			? "\nPASS — an explicit base is honoured on the create path or refused; a fork is never claimed for a tree the seat is not on"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
