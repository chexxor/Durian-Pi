// demo/complete-teardown-root.test.mjs — is `process.cwd()` at complete_work teardown WRONG? (#3546)
//
// #3546 asks a QUESTION before it asks for a fix: `complete_work` tears the item workspace down with
// `removeSeatWorkspace({ worktreeRoot: process.cwd(), itemId })` and then re-points the seat with
// `configure(tx, convId, { cwd: process.cwd() })` (src/rig.mjs). Is that a LIVE defect — does it
// remove or configure the WRONG root for a real seat — or only a latent one?
//
// THE ANSWER THIS FILE MEASURES: not live, because the two roots are the SAME EXPRESSION. The seat
// path creates the worktree at `join(worktreeRoot, "item-<id>")` where `worktreeRoot` is
// `prepareWorkspaceOptions().worktreeRoot`, which is the `source` that `prepare_workspace` takes as
// `process.cwd()` (src/seattools.mjs). Teardown then computes the same `join(process.cwd(), "item-<id>")`
// in the same process. They agree by construction, so the removal targets exactly the path creation
// used — and this demo proves it by doing it for real: prepare, then tear down, and the tree is gone.
//
// WHAT IS STILL WORTH PINNING, and why this file exists rather than a paragraph in a completion:
//   (a) THE INVARIANT. Teardown is correct ONLY while prepare's root and complete's root are the same
//       expression. Nothing in the code says so; a future edit to either side silently leaks every
//       completed item's worktree. Checks 1-2 fail if the two ever diverge.
//   (b) THE LATENT SHAPE, measured rather than asserted: point teardown at a root that is NOT the one
//       creation used and it does not throw, does not warn — it returns `{ removed: false, skipped:
//       true }` and the worktree SURVIVES. `complete_work` logs only on a THROW, so that leak is
//       silent. That is the real defect family here, and its owner is the root-RESOLUTION work
//       (#2425/#2426 DURIAN_PI_WORKTREE_ROOT), not a patch to this one line.
//
// NOTE ON THE 85c5d95 "FIX" (the cancelled #1444-fix stack): it changed only the `configure` call to
// `process.env.DURIG_SEAT_ROOT ?? process.cwd()` and left `removeSeatWorkspace` on `process.cwd()`.
// Check 2 pins that main still passes `process.cwd()` to BOTH — if someone lands that half-fix, the
// two call sites disagree and this demo fails loudly instead of leaking quietly.
//
// Run: node demo/complete-teardown-root.test.mjs   (exit 0 = the measurement holds)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prepareWorkspaceOptions } from "../src/seattools.mjs";
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

const base = await mkdtemp(join(tmpdir(), "durig-teardown-root-"));
const repo = join(base, "repo");
try {
	// A repo with NO package.json: `isProvisioned` then says true, so no npm install runs and the
	// demo stays offline and fast (the same shape demo/worktree-carry-teardown.test.mjs uses).
	await mkdir(repo, { recursive: true });
	await writeFile(join(repo, "tracked.txt"), "original\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "."]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	console.log("\n1. prepare_workspace's worktreeRoot IS its source, which is the process cwd");
	{
		// The real options builder, not a re-implementation: this is the value `prepare_workspace`
		// hands `prepareSeatWorkspace`, and `worktreeRoot` must BE `source` or creation and teardown
		// would look in different directories.
		const opts = prepareWorkspaceOptions({ source: process.cwd(), itemId: 1, seatName: "impl" });
		check("worktreeRoot === source (one root, not two)", opts.worktreeRoot === opts.source, JSON.stringify(opts));
		check("source is this process's cwd", opts.source === process.cwd(), opts.source);
	}

	console.log("\n2. complete_work's teardown passes the SAME expression (process.cwd()) to BOTH calls");
	{
		const rig = await readFile(new URL("../src/rig.mjs", import.meta.url), "utf8");
		check(
			"removeSeatWorkspace targets worktreeRoot: process.cwd()",
			/removeSeatWorkspace\(\{\s*worktreeRoot:\s*process\.cwd\(\)/.test(rig),
		);
		check(
			"configure re-points the seat at cwd: process.cwd()",
			/configure\(tx,\s*api\.conversationId,\s*\{\s*cwd:\s*process\.cwd\(\)\s*\}\)/.test(rig),
		);
		// The two must name the SAME expression. If the 85c5d95 half-fix lands on one side only, the
		// seat is re-pointed at a root its worktrees were never created under — this is the check
		// that catches it.
		const teardownRoot = /removeSeatWorkspace\(\{\s*worktreeRoot:\s*([^,]+),/.exec(rig)?.[1]?.trim();
		const configureRoot = /configure\(tx,\s*api\.conversationId,\s*\{\s*cwd:\s*([^}\s]+)/.exec(rig)?.[1]?.trim();
		check(
			`teardown root and configure root agree (${teardownRoot} vs ${configureRoot})`,
			teardownRoot !== undefined && teardownRoot === configureRoot,
		);
	}

	console.log("\n3. The AGREEING root removes the item worktree — so this is NOT a live defect");
	{
		const wt = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 1, seatName: "impl" });
		check("prepare created item-1's worktree", existsSync(wt.worktree), wt.worktree);
		const removed = await removeSeatWorkspace({ worktreeRoot: repo, itemId: 1, releaseIfRefused: true });
		check("teardown REMOVED it", removed.removed === true, JSON.stringify(removed));
		check("the path is gone", !existsSync(wt.worktree), wt.worktree);
	}

	console.log("\n4. The DIVERGED root leaks the worktree SILENTLY — the latent shape, measured");
	{
		const wt = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 2, seatName: "impl" });
		check("prepare created item-2's worktree", existsSync(wt.worktree), wt.worktree);
		// Stand in for any divergence between "the root creation used" and "the root teardown
		// computes": a restarted broker whose cwd differs, or a declared worktree root (#2425).
		const elsewhere = join(base, "elsewhere");
		await mkdir(elsewhere, { recursive: true });
		const result = await removeSeatWorkspace({ worktreeRoot: elsewhere, itemId: 2, releaseIfRefused: true });
		check("teardown reports skipped, not removed", result.skipped === true && result.removed === false, JSON.stringify(result));
		check("the worktree SURVIVED (this is the leak)", existsSync(wt.worktree), wt.worktree);
		check(
			"and it survived QUIETLY: no throw, so complete_work's catch logs nothing",
			result.refused === undefined && result.dirty === undefined,
			JSON.stringify(result),
		);
		// Leave no registration behind: this demo must not be a leak source itself.
		const cleaned = await removeSeatWorkspace({ worktreeRoot: repo, itemId: 2, releaseIfRefused: true });
		check("the demo cleaned up after itself", cleaned.removed === true, JSON.stringify(cleaned));
	}

	console.log(
		failures === 0
			? "\nPASS — teardown is correct while prepare and complete share one root expression; a diverged root leaks silently"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
