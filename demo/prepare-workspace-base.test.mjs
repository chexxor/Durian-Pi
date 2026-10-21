// demo/prepare-workspace-base.test.mjs — a REUSED workspace must name the base it is ACTUALLY at (#3558)
//
// THE DEFECT (auditor, #3441): `prepare_workspace` was called with `base=<some-ref>` against an item
// whose worktree already existed. It reported "reused" — correctly, reuse is deliberate and re-forking
// would discard the work in that tree — but it ALSO printed "Forked from base ref <ref> (not HEAD)",
// because the base line was emitted whenever the caller ASKED for a base, not when a fork happened.
// So the seat was told a fork had occurred from a base the tree was not at. The auditor worked around
// it rather than trust the tree, which is the correct instinct: a verify that does not know what tree
// it is standing on certifies the wrong one.
//
// THE FIX, and what this file pins:
//   - a CREATED worktree honours the base, and says so;
//   - a REUSED worktree names the commit it is actually at and says plainly it was NOT re-forked;
//   - `prepareSeatWorkspace` reports `base` / `requestedBase` / `baseHonoured` on BOTH paths, so the
//     caller can decide instead of inferring from the word "reused".
//
// FAILING-FIRST: before the change `workspaceReadyText` does not exist (the import fails), the reuse
// return carries no `base`/`baseHonoured`, and the text claims the fork. Run:
//   node demo/prepare-workspace-base.test.mjs   (exit 0 = pass)

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prepareSeatWorkspace, removeSeatWorkspace } from "../src/worktree.mjs";
import { workspaceReadyText } from "../src/seattools.mjs";

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

const base = await mkdtemp(join(tmpdir(), "durig-pw-base-"));
const repo = join(base, "repo");
try {
	// No package.json: `isProvisioned` then says true, so no npm install runs (offline, fast).
	await mkdir(repo, { recursive: true });
	await writeFile(join(repo, "f.txt"), "one\n");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "."]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "c1"]);
	const c1 = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
	await writeFile(join(repo, "f.txt"), "two\n");
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "c2"]);
	const c2 = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
	const short = (sha) => sha.slice(0, 9);
	check("fixture has two distinct commits", c1 !== c2 && c1.length === 40, `${short(c1)} vs ${short(c2)}`);

	console.log("\n1. A CREATED worktree honours the base, and the text says so");
	const created = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 1, seatName: "impl", ref: c1 });
	check("created", created.created === true, JSON.stringify({ created: created.created }));
	check(`base is the requested commit (${short(c1)})`, created.base === c1, short(created.base));
	check("baseHonoured is true", created.baseHonoured === true, String(created.baseHonoured));
	{
		const text = workspaceReadyText(created, c1);
		check("the text reports the fork", text.includes(`Forked from base ref ${short(c1)}`), text.split("\n")[1]);
		check("the fork line carries no bare 40-hex token either", !/\b[0-9a-f]{40}\b/.test(text), text.split("\n")[1]);
	}

	console.log("\n2. A REUSED worktree with a DIFFERENT base: the base is NOT honoured, and it says so");
	const reused = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 1, seatName: "impl", ref: c2 });
	check("reused (not re-forked)", reused.created === false, String(reused.created));
	check(`the tree is still at c1 (${short(c1)}), not the requested c2 (${short(c2)})`, reused.base === c1, short(reused.base));
	check("requestedBase records what was asked for", reused.requestedBase === c2, short(reused.requestedBase));
	check("baseHonoured is false", reused.baseHonoured === false, String(reused.baseHonoured));
	{
		const text = workspaceReadyText(reused, c2);
		check(
			"the text does NOT claim a fork that did not happen",
			!text.includes("Forked from base ref"),
			text.split("\n")[1],
		);
		check("the text says NOT re-forked", text.includes("NOT re-forked"), text.split("\n")[1]);
		check(`the text names the ACTUAL base (${short(c1)})`, text.includes(short(c1)), text.split("\n")[1]);
		check("the text names what was requested", text.includes(short(c2)), text.split("\n")[1]);
		// A full 40-hex token is redacted as secret-shaped by durig's own redactor (#3128), which would
		// swallow the message that has to tell the seat where it is. Short shas only.
		check("the message carries no bare 40-hex token", !/\b[0-9a-f]{40}\b/.test(text), text.split("\n")[1]);
	}

	console.log("\n3. A REUSED worktree already AT the requested base: honoured, and it says so");
	const same = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 1, seatName: "impl", ref: c1 });
	check("still reused", same.created === false, String(same.created));
	check("baseHonoured is true", same.baseHonoured === true, String(same.baseHonoured));
	{
		const text = workspaceReadyText(same, c1);
		check("the text says it is already at the requested base", text.includes("already AT the requested base"), text.split("\n")[1]);
		check("and does not claim a fork", !text.includes("Forked from base ref"), text.split("\n")[1]);
	}

	console.log("\n4. No base requested: no base line at all (unchanged behaviour)");
	{
		const text = workspaceReadyText(same, undefined);
		check("no fork claim", !text.includes("Forked from base ref"), text.split("\n")[1]);
		check("no re-fork note", !text.includes("NOT re-forked"), text.split("\n")[1]);
		check("still reports the workspace", text.startsWith("WORKSPACE READY (reused): "), text.split("\n")[0]);
	}

	console.log("\n5. A base that does not resolve is reported as unresolved, not as honoured");
	{
		const unknown = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 1, seatName: "impl", ref: "no-such-ref-here" });
		check("reused", unknown.created === false, String(unknown.created));
		check("requestedBase is null (it did not resolve)", unknown.requestedBase === null, String(unknown.requestedBase));
		check("baseHonoured is null, not true", unknown.baseHonoured === null, String(unknown.baseHonoured));
		const text = workspaceReadyText(unknown, "no-such-ref-here");
		check("the text says the ref does not resolve", text.includes("does not resolve in this worktree"), text.split("\n")[1]);
	}

	const cleaned = await removeSeatWorkspace({ worktreeRoot: repo, itemId: 1, releaseIfRefused: true });
	check("the demo cleaned up after itself", cleaned.removed === true, JSON.stringify(cleaned));

	console.log(
		failures === 0
			? "\nPASS — a reused workspace names the base it is ACTUALLY at and never claims a fork it did not do"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 500));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
