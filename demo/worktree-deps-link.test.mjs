// demo/worktree-deps-link.test.mjs — a worktree provisioned with a FAILED `sync-pi --link` must SAY SO
// where the seat sees it, not downgrade the failure to a `console.warn` (#3821)
//
// THE DEFECT (reproduced here): `installWorktreeDeps` runs `node scripts/sync-pi.mjs --link` before and
// after `npm ci`. In a FRESH worktree that step cannot work — `vendor/pi-main` is gitignored and absent,
// so the real script exits 1 with `{"ok":false,"error":"nothing built yet; run --sync before --link"}` —
// and the caller caught it and only `console.warn`ed, then continued. Every fresh worktree was therefore
// provisioned with the LOCKED pi packages while the intent (link to the built pin) silently did not
// happen. The seat was told "WORKSPACE READY" and nothing else.
//
// WHAT THIS PINS:
//   1. the link outcome is DATA the caller can assert (`linkWorktreeDeps`), not a warning;
//   2. `installWorktreeDeps` RECORDS it (`dependency.state` = linked | unlinked | no-sync-script) and
//      emits no warning for it;
//   3. a provisioned worktree carries the sentence that tells the SEAT, in the tool result
//      (`prepareSeatWorkspace().dependencyNote`), naming what is stale and what to run;
//   4. a LINKED tree says nothing (no noise), and a tree with no sync-pi script is not a failure.
//
// FAILING-FIRST: on the pre-fix tree `linkWorktreeDeps` / `dependencyNoteFor` do not exist (import
// fails), `installWorktreeDeps` returns no `dependency` field, and the link failure is a console.warn.
// Run: node demo/worktree-deps-link.test.mjs   (exit 0 = pass)

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	dependencyNoteFor,
	installWorktreeDeps,
	linkWorktreeDeps,
	prepareSeatWorkspace,
	removeSeatWorkspace,
	resolveNpmInvocation,
} from "../src/worktree.mjs";

const run = promisify(execFile);
// A bare `execFile("npm", …)` is `spawn npm ENOENT` on Windows (#822); use the same resolution the
// provisioning path uses.
const { file: npmFile, prefixArgs: npmPrefix } = resolveNpmInvocation();
let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

/**
 * The real script's decisive behaviour, reduced to what this defect turns on: `--link` needs a BUILT
 * vendor tree, and says exactly this when there is none.
 */
const SYNC_PI_STUB = `import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DURIG = dirname(dirname(fileURLToPath(import.meta.url)));
if (!existsSync(join(DURIG, "vendor", "pi-main", "packages", "durable", "dist", "index.js"))) {
	console.log(JSON.stringify({ ok: false, command: "sync-pi", error: "nothing built yet; run --sync before --link" }, null, 2));
	process.exit(1);
}
console.log(JSON.stringify({ ok: true, command: "sync-pi", action: "link" }, null, 2));
`;

const base = await mkdtemp(join(tmpdir(), "durig-deps-link-"));
const repo = join(base, "repo");
try {
	// A ZERO-DEPENDENCY package: `npm ci --prefer-offline` then works offline, so the demo exercises the
	// real install path without a registry.
	await mkdir(join(repo, "scripts"), { recursive: true });
	await writeFile(join(repo, "package.json"), '{ "name": "durig-deps-fixture", "version": "1.0.0", "private": true }\n');
	await writeFile(join(repo, "scripts", "sync-pi.mjs"), SYNC_PI_STUB);
	await writeFile(join(repo, "artifact.txt"), "x\n");
	await run(npmFile, [...npmPrefix, "install", "--package-lock-only", "--offline"], { cwd: repo });

	console.log("\n1. The link step's failure is DATA, not a warning");
	const failed = await linkWorktreeDeps(repo);
	check("the step was attempted", failed.attempted === true, JSON.stringify(failed));
	check("it reports failure", failed.ok === false, String(failed.ok));
	check(
		"the reason names the missing prerequisite (vendor/pi-main not built)",
		/vendor\/pi-main is not built/.test(failed.reason ?? ""),
		String(failed.reason),
	);
	check("the reason points at the remedy the step itself names", /--sync/.test(failed.reason ?? ""), String(failed.reason));

	console.log("\n2. A BUILT vendor tree links, and says so");
	await mkdir(join(repo, "vendor", "pi-main", "packages", "durable", "dist"), { recursive: true });
	await writeFile(join(repo, "vendor", "pi-main", "packages", "durable", "dist", "index.js"), "export {};\n");
	const linked = await linkWorktreeDeps(repo);
	check("it reports success", linked.ok === true, JSON.stringify(linked));
	check("no reason is attached to a success", linked.reason === null, String(linked.reason));

	console.log("\n3. No sync-pi script at all is NOT a failure (nothing to link)");	const bare = join(base, "bare");
	await mkdir(bare, { recursive: true });
	const nothing = await linkWorktreeDeps(bare);
	check("not attempted", nothing.attempted === false, JSON.stringify(nothing));
	check("and not reported as failed (ok is null, not false)", nothing.ok === null, String(nothing.ok));

	// A FRESH worktree has no vendor tree. Step 2 built one to prove the success path, so put the
	// fixture back into the fresh state that the rest of this demo is about.
	await rm(join(repo, "vendor"), { recursive: true, force: true });

	console.log("\n4. installWorktreeDeps RECORDS the outcome and stops warning about it");
	const warnings = [];
	const realWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args.join(" "));
	};
	let unlinkedRecord;
	try {
		unlinkedRecord = await installWorktreeDeps(repo);
	} finally {
		console.warn = realWarn;
	}
	check("a dependency record is returned", unlinkedRecord.dependency !== null && typeof unlinkedRecord.dependency === "object", JSON.stringify(unlinkedRecord.dependency));
	check("the state is unlinked", unlinkedRecord.dependency?.state === "unlinked", String(unlinkedRecord.dependency?.state));
	check("the reason travels with it", /vendor\/pi-main is not built/.test(unlinkedRecord.dependency?.reason ?? ""), String(unlinkedRecord.dependency?.reason));
	check(
		"the link failure is NOT downgraded to a console.warn any more",
		!warnings.some((w) => /sync-pi|--link/.test(w)),
		JSON.stringify(warnings),
	);
	check("the record names the package whose version is in question", unlinkedRecord.dependency?.packageName === "@earendil-works/pi-durable", String(unlinkedRecord.dependency?.packageName));

	console.log("\n5. A worktree with no package.json needs no install and reports no dependency");
	const throwaway = join(base, "throwaway");
	await mkdir(throwaway, { recursive: true });
	const skipped = await installWorktreeDeps(throwaway);
	check("skipped", skipped.skipped === true, JSON.stringify(skipped));
	check("no dependency record is invented for a tree that needs none", skipped.dependency === null, JSON.stringify(skipped.dependency));

	console.log("\n6. The seat-facing sentence says what is stale and what to run");
	const note = dependencyNoteFor({
		state: "unlinked",
		reason: "vendor/pi-main is not built in this worktree, so there is nothing to link to (the step says: run --sync first)",
		worktreeVersion: "1.1.0",
		sourceVersion: "1.3.0",
	});
	check("it announces the state", /DEPENDENCY NOT LINKED/.test(note), note.slice(0, 120));
	check("it names the version this tree resolved", /1\.1\.0/.test(note), note.slice(0, 220));
	check("it names what the seat root resolves", /1\.3\.0/.test(note), note.slice(0, 220));
	check("it states the consequence for a verdict", /NOT comparable/.test(note), note.slice(0, 260));
	check("it names the remedy", /node scripts\/sync-pi\.mjs --sync/.test(note), note.slice(-200));
	check("an unknown resolved version is still phrased honestly", /whatever the lockfile pins/.test(dependencyNoteFor({ state: "unlinked", reason: "x", worktreeVersion: null, sourceVersion: null })), "");
	check("a LINKED tree says nothing (no noise)", dependencyNoteFor({ state: "linked", reason: null }) === "", "");
	check("no sync-pi script says nothing", dependencyNoteFor({ state: "no-sync-script", reason: null }) === "", "");
	check("an unknown (null) record says nothing rather than guessing", dependencyNoteFor(null) === "", "");

	console.log("\n7. END TO END: prepareSeatWorkspace puts the sentence in the caller's hands");
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "add", "package.json", "package-lock.json", "scripts/sync-pi.mjs", "artifact.txt"]);
	await run("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
	// The fresh worktree has no vendor/pi-main (it is gitignored in durig, and never committed here), so
	// the link CANNOT succeed — exactly the fresh-worktree case.
	const workspace = await prepareSeatWorkspace({ source: repo, worktreeRoot: repo, itemId: 3, seatName: "impl" });
	check("the worktree was created", workspace.created === true, String(workspace.created));
	check("the dependency state is on the result", workspace.dependency?.state === "unlinked", JSON.stringify(workspace.dependency));
	check("and the caller gets a sentence to read", /DEPENDENCY NOT LINKED/.test(workspace.dependencyNote ?? ""), String(workspace.dependencyNote).slice(0, 160));
	check("the sentence travels in the tool result, not a warn", /NOT comparable/.test(workspace.dependencyNote ?? ""), String(workspace.dependencyNote).slice(0, 200));
	check("the worktree still exists (provisioning did NOT abort)", existsSync(workspace.worktree), workspace.worktree);
	// Teardown is best-effort and never decides the verdict (#3464).
	try {
		await removeSeatWorkspace({ worktreeRoot: repo, itemId: 3, releaseIfRefused: true });
	} catch (err) {
		console.error(`cleanup: item-3 not removed (the temp repo is deleted anyway): ${err.message}`);
	}

	console.log(
		failures === 0
			? "\nPASS — a failed link is reported as an UNLINKED state the caller can assert, never a silent warn"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
