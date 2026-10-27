// confine.test.mjs — the M3 boundary's canaries (security conditions SC1-SC3).
//
// Every canary is run BOTH ways: against the raw `NodeExecutionEnv` and against the confined
// wrapper. A denial that also denies without the boundary proves nothing, so each assertion
// here is paired with its unguarded control - the same discipline demo/starter.test.mjs uses
// for `check`, where "0 findings" is meaningless unless the rules can be shown to fire.

import { existsSync, rmdirSync, unlinkSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile as write } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { authorEnv, refusalFor, verifierEnv } from "../src/confine.mjs";
import { makeSeatEnv } from "../src/seattools.mjs";

let failures = 0;
const context = {};

function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/** A refused call must be a legible permission error, not a crash or a silent success. */
function denied(result, label) {
	const ok = result.ok === false && result.error?.code === "permission_denied";
	check(label, ok, result.ok ? "call succeeded" : `code=${result.error?.code}`);
	return result;
}

const root = await mkdtemp(join(tmpdir(), "durig-confine-"));
const outside = await mkdtemp(join(tmpdir(), "durig-outside-"));
const base = new NodeExecutionEnv({ cwd: root });

try {
	await mkdir(join(root, "src"), { recursive: true });
	await write(join(root, "src", "inside.txt"), "inside\n");
	await write(join(outside, "secret.txt"), "OUTSIDE-SECRET\n");

	const author = authorEnv(base, root);
	const verifier = verifierEnv(base, root);

	console.log("\nSC1 — path confinement (F2: absolute paths escape a worktree with no boundary)");
	const readInside = await author.readTextFile(join(root, "src", "inside.txt"), context);
	check("an in-root read succeeds", readInside.ok === true);

	// The unguarded control: this is what the boundary is preventing.
	const rawEscape = await base.readTextFile(join(outside, "secret.txt"), context);
	check("CONTROL: the raw env reads outside the root (so the canary can fail)", rawEscape.ok === true);

	const escape = await author.readTextFile(join(outside, "secret.txt"), context);
	denied(escape, "an absolute path outside the root is refused");

	const home = await author.readTextFile(join(homedir(), ".ssh", "id_rsa"), context);
	denied(home, "a home-directory path is refused (the position's own example)");

	const viaPrimitive = await author.absolutePath(join(outside, "secret.txt"), context);
	denied(viaPrimitive, "absolutePath itself refuses, so no tool can route around it");

	const dotdot = await author.readTextFile("../" + join(outside, "secret.txt"), context);
	denied(dotdot, "a .. path is refused");

	let symlinks = true;
	try {
		await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
	} catch {
		// Creating a symlink can need a privilege Windows does not always grant; saying so is
		// better than silently dropping a canary that exists to catch symlink escapes.
		symlinks = false;
	}
	if (symlinks) {
		const link = await author.readTextFile(join(root, "link.txt"), context);
		denied(link, "a symlink pointing outside the root is refused");
	} else {
		console.log("  skip symlink canary — this host refused to create one");
	}

	console.log("\nSC3 — environment, and commands that leave the boundary");

	// The canary the security position asked for: a command prints its environment, and a key
	// that IS present in durian-pi's own process must not reach it. A caller's explicit request for
	// the key is included deliberately, because "the seat asked" is not a reason to hand it over.
	if (typeof process.env.DEEPINFRA_API_KEY !== "string") {
		console.log("  note — DEEPINFRA_API_KEY is unset here; the canary still asserts nothing key-shaped crosses");
	}
	const seen = [];
	const probe = await author.exec(
		[
			process.execPath,
			"-e",
			"process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET/i.test(k))))",
		],
		{
			onOutput: (text) => seen.push(text),
			inheritEnv: true, // deliberately requested: the boundary must override it
			env: { DEEPINFRA_API_KEY: "canary-should-not-propagate" },
		},
		context,
	);
	check(
		"the environment probe executed",
		probe.ok === true && seen.length > 0,
		probe.ok ? "no output" : probe.error?.message,
	);
	check(
		"no credential-shaped variable reaches a seat's command",
		seen.join("") === "[]",
		`the command saw ${seen.join("")}`,
	);

	const wsl = await author.exec("wsl ls", {}, context);
	check(
		"wsl is refused before it is spawned",
		wsl.ok === false && /refused by durig/.test(wsl.error?.message ?? ""),
		JSON.stringify(wsl.ok ? wsl.value : wsl.error?.message),
	);
	const docker = await author.exec(["docker", "ps"], {}, context);
	check("docker is refused", docker.ok === false && /unsupported/.test(docker.error?.message ?? ""));
	const destructive = await author.exec("git reset --hard HEAD~1", {}, context);
	check(
		"destructive git is refused",
		destructive.ok === false && /discard/.test(destructive.error?.message ?? ""),
	);
	// Every state-mutating git form is refused at the guard layer (ROADMAP 42 / #146), so a seat
	// cannot diverge its worktree from the reviewed source; read-only git still runs.
	for (const command of [
		"git checkout main",
		"git switch main",
		"git switch -c feature",
		"git restore src/rig.mjs",
		"git revert HEAD",
		"git clean -fd",
		"git stash",
		"git branch -D foo",
	]) {
		const refused = await author.exec(command, {}, context);
		check(
			`${command} is refused`,
			refused.ok === false && /refused by durig/.test(refused.error?.message ?? ""),
			JSON.stringify(refused.ok ? refused.value : refused.error?.message),
		);
	}
	const readOnlyGit = await author.exec("git status --short", {}, context);
	check(
		"read-only git is not refused",
		!/refused by durig/.test(readOnlyGit.error?.message ?? ""),
		JSON.stringify(readOnlyGit.ok ? "ran" : readOnlyGit.error?.message),
	);

	// #4374: `checkout-index` is NOT a branch switch — it re-materialises files from the INDEX into the
	// working tree and cannot move HEAD. It was swept into the class by a `\b` boundary (`\b` sits
	// between the final "t" of "checkout" and the hyphen of "checkout-index") with a reason that was
	// FACTUALLY WRONG about the verb, and NO CANARY pinned it either way. The decision is now
	// PATH-AWARE, like the write guard: the verb takes no path, so its TARGET is the CWD's worktree.
	// Restoring YOUR OWN dirt is what the runbooks prescribe (tracked-files-missing-on-disk.md);
	// re-materialising the SHARED tree is the 04:21Z hazard. The verb is identical; the acts are opposite.
	const COI = `git ${["checkout", "index"].join("-")}`; // split so this file is not itself refused
	const coiInSeat = await author.exec(`${COI} -f -a`, {}, context);
	check(
		"checkout-index in the SEAT's own worktree is ALLOWED (the runbook's restore)",
		!/refused by durig/.test(coiInSeat.error?.message ?? ""),
		JSON.stringify(coiInSeat.ok ? "ran" : coiInSeat.error?.message),
	);
	const sharedRefusal = refusalFor(`${COI} -f -a`, { root, cwd: join(homedir(), "elsewhere") });
	check("checkout-index against the SHARED root is REFUSED", sharedRefusal !== null, String(sharedRefusal));
	check(
		"...with an ACCURATE reason, not 'same as git checkout'",
		/checkout-index/.test(sharedRefusal ?? "") && !/same as .git checkout./.test(sharedRefusal ?? ""),
		String(sharedRefusal),
	);
	check("...and it names the remedy (your item worktree)", /item worktree/.test(sharedRefusal ?? ""), String(sharedRefusal));
	check(
		"...and NO context (fail-closed) is REFUSED",
		refusalFor(`${COI} -f -a`, {}) !== null,
		"a path-aware entry with no root must not fail open",
	);

	// #3635: EVERY REFUSAL MUST NAME ITS OWN VERB. The loop above proves a command is REFUSED; it does
	// not prove the message says WHICH rule fired. Without that pin the wording can regress to
	// something generic, and a generic refusal is what made a seat condemn a whole verb CLASS: a
	// compound command (`git checkout -b …; git rebase main`) is refused on its checkout segment, so
	// "would change the seat's working tree or HEAD" read as a verdict on BOTH verbs, `git rebase`
	// was never re-run alone, and the false claim reached an operating note (#3379). The guard stops
	// at the first matching rule, so one refusal says nothing about the other verbs in the command —
	// the message has to say which one it was.
	const NAMES_ITS_VERB = {
		"git reset --hard HEAD~1": /`reset`/,
		"git checkout main": /`checkout`/,
		"git checkout -b some-branch": /`checkout`/,
		"git switch main": /`switch`/,
		"git switch -c feature": /`switch`/,
		"git restore src/rig.mjs": /`restore`/,
		"git revert HEAD": /`revert`/,
		"git clean -fd": /`clean`/,
		"git stash": /`stash`/,
		"git branch -D foo": /`-D`|force-delete a branch/,
		"git add -A": /git add -A/,
	};
	for (const [command, namesVerb] of Object.entries(NAMES_ITS_VERB)) {
		const refused = await author.exec(command, {}, context);
		const message = refused.error?.message ?? "";
		check(
			`${command}: the refusal NAMES its verb`,
			refused.ok === false && namesVerb.test(message),
			JSON.stringify(refused.ok ? "it was not refused at all" : message),
		);
	}
	// `git push` is deliberately NOT in the map above: its refusal is conditional on the operator
	// grant (DURIG_ALLOW_PUSH), so asserting it here would make this demo depend on how the rig was
	// launched. Its message names `push` for the same reason as the rest.

	// Failing-first canaries — these commands bypassed the old guard (\s|$) because the
	// match ended in whitespace or end-of-string, so trailing punctuation and separators
	// defeated it. The fixed guard uses \b (word boundary) and -C <path> forms. These
	// assert the guard CATCHES what used to slip through (RD #257). `git commit` and its
	// `-C` forms are now allowed; separator canaries below verify they remain allowed
	// when wrapped in punctuation.
	for (const command of [
		"git stash;",
		"git reset;",
		"git checkout;",
		"git switch;",
		"git restore;",
		"git clean;",
		"git revert;",
		"git branch -D foo;",
		"git -C . stash",
		"git -C . switch main",
		"git -C /a/path reset --hard HEAD~1",
		"git add -A;",
		"git add .;",
	]) {
		const refused = await author.exec(command, {}, context);
		check(
			`${command} is refused (old bypass class)`,
			refused.ok === false && /refused by durig/.test(refused.error?.message ?? ""),
			JSON.stringify(refused.ok ? refused.value : refused.error?.message),
		);
	}

	// Unscoped staging is refused — it would sweep up files outside the item.
	for (const command of ["git add -A", "git add ."]) {
		const refused = await author.exec(command, {}, context);
		check(
			`${command} is refused (unscoped staging)`,
			refused.ok === false && /unscoped staging/.test(refused.error?.message ?? ""),
			JSON.stringify(refused.ok ? refused.value : refused.error?.message),
		);
	}

	// Scoped staging with explicit paths is allowed.
	for (const command of ["git add src/confine.mjs", "git add demo/confine.test.mjs"]) {
		const allowed = await author.exec(command, {}, context);
		check(
			`${command} is allowed (scoped, explicit paths)`,
			!/refused by durig/.test(allowed.error?.message ?? ""),
			JSON.stringify(allowed.ok ? "ran" : allowed.error?.message),
		);
	}

	// The read-only controls must still pass through after the fix.
	for (const command of ["git status", "git log --oneline -3", "git diff HEAD", "git show HEAD", "git rev-parse HEAD"]) {
		const allowed = await author.exec(command, {}, context);
		check(
			`${command} is not refused (read-only)`,
			!/refused by durig/.test(allowed.error?.message ?? ""),
			JSON.stringify(allowed.ok ? "ran" : allowed.error?.message),
		);
	}

	// git commit is now allowed for both forms (separator canaries prove the \b boundary is tight).
	for (const command of ["git commit -m x", "git commit;", "git -C . commit -m x", "git -C . commit;"]) {
		const allowed = await author.exec(command, {}, context);
		check(
			`${command} is allowed (commit is no longer refused)`,
			!/refused by durig/.test(allowed.error?.message ?? ""),
			JSON.stringify(allowed.ok ? "ran" : allowed.error?.message),
		);
	}

	// #1211 part 1: branch REF ops are exempt. Create (how a commit gets anchored), rename and
	// SAFE delete do not touch the working tree, and `-d` is safe by git's own semantics (git
	// refuses to delete an unmerged branch). Only the FORCE delete stays blocked.
	for (const command of [
		"git branch impl-item-1217 main",
		"git branch -m old-name new-name",
		"git branch -d merged-topic",
		"git branch --delete merged-topic",
		"git -C . branch -d merged-topic",
	]) {
		const allowed = await author.exec(command, {}, context);
		check(
			`${command} is allowed (branch ref-op)`,
			!/refused by durig/.test(allowed.error?.message ?? ""),
			JSON.stringify(allowed.ok ? "ran" : allowed.error?.message),
		);
	}
	for (const command of [
		"git branch -D unmerged-topic",
		"git branch --delete --force unmerged-topic",
		"git -C . branch -D unmerged-topic",
	]) {
		const refused = await author.exec(command, {}, context);
		check(
			`${command} is refused (force delete)`,
			refused.ok === false && /refused by durig/.test(refused.error?.message ?? ""),
			JSON.stringify(refused.ok ? refused.value : refused.error?.message),
		);
	}

	// #1211 part 2: the guard matches the ACTUAL invocation, not text inside a quoted argument.
	// A commit message that merely documents the refused form must not itself be refused.
	for (const command of [
		'git commit -m "docs: explain that git branch -d is safe"',
		'git commit -m "the guard blocks git branch -D"',
	]) {
		const allowed = await author.exec(command, {}, context);
		check(
			`${command} is allowed (quoted text is not an invocation)`,
			!/refused by durig/.test(allowed.error?.message ?? ""),
			JSON.stringify(allowed.ok ? "ran" : allowed.error?.message),
		);
	}

	console.log("\nSC2 — the verifier cannot mutate what it verifies");
	const authorWrite = await author.writeFile(join(root, "author.txt"), "ok", context);
	check("an author can write inside the worktree", authorWrite.ok === true);

	const verifierWrite = await verifier.writeFile(join(root, "verifier.txt"), "no", context);
	denied(verifierWrite, "the verifier's write is refused");

	const verifierRemove = await verifier.remove(join(root, "src", "inside.txt"), {}, context);
	denied(verifierRemove, "the verifier cannot remove a file");

	const verifierRead = await verifier.readTextFile(join(root, "src", "inside.txt"), context);
	check("the verifier can still read, so it can still check", verifierRead.ok === true);

	const verifierExec = await verifier.exec([process.execPath, "--version"], {}, context);
	check(
		"the verifier can still run a command (its copy is disposable)",
		verifierExec.ok === true,
		verifierExec.ok ? "" : verifierExec.error?.message,
	);

	console.log("\nTemp files live inside the boundary, not in the OS temp directory");
	const tempDir = await author.createTempDir("probe", context);
	check(
		"a seat's temp dir is created under the root",
		tempDir.ok === true && tempDir.value.startsWith(root),
		tempDir.ok ? tempDir.value : tempDir.error?.message,
	);
	console.log("\n#1465: a READ-ONLY root outside the worktree (the shared .durig) — readable, never writable");
	{
		// `claim_work` writes an over-threshold item body to <shared>/.durian-pi/<id>.md, but
		// `prepare_workspace` narrows the seat's root to its worktree, so the body it was just handed
		// became unreadable. The fix is an explicit READ-ONLY root: reads cross, writes never do.
		const shared = join(outside, ".durig");
		await mkdir(shared, { recursive: true });
		await write(join(shared, "42.md"), "ITEM #42 body\n");
		const roEnv = authorEnv(base, root, { readOnlyRoots: [shared] });

		const read = await roEnv.readTextFile(join(shared, "42.md"), context);
		check("the seat can READ the shared queue dir from a narrowed root", read.ok === true && read.value.includes("ITEM #42"), JSON.stringify(read));
		denied(await roEnv.writeFile(join(shared, "43.md"), "x", context), "a WRITE to the shared queue dir is REFUSED");
		denied(await roEnv.remove(join(shared, "42.md"), context), "a DELETE there is REFUSED");
		// The exemption is exactly this directory — the rest of `outside` stays closed.
		denied(await roEnv.readTextFile(join(outside, "secret.txt"), context), "a read outside the worktree AND the read-only root is still REFUSED");
		// And the default wiring: `makeSeatEnv` derives <fallbackRoot>/.durian-pi, so a seat gets it free.
		const seatEnv = makeSeatEnv(
			new Map([[1, { name: "impl", role: "implementation engineer", verifier: false }]]),
			{ fallbackRoot: outside },
		)({ conversationId: 1, cwd: root });
		const viaSeat = await seatEnv.readTextFile(join(shared, "42.md"), context);
		check("makeSeatEnv wires the shared .durig read-only by default", viaSeat.ok === true && viaSeat.value.includes("ITEM #42"), JSON.stringify(viaSeat));
		denied(await seatEnv.writeFile(join(shared, "44.md"), "x", context), "...and that default is still read-only");

		// qa #1489 (HIGH): a JUNCTION inside the worktree must not let a CREATE write THROUGH it.
		// The plain-path check passes (the link path IS inside the root) and `canonicalPath` FAILS for a
		// not-yet-existing destination, so the deny has to fall back to the deepest EXISTING ancestor.
		const linkPath = join(root, "durig-link");
		let junctionMade = false;
		try {
			await symlink(shared, linkPath, "junction");
			junctionMade = true;
		} catch (err) {
			check("junction probe: the junction could not be created on this host", false, String(err?.message ?? err));
		}
		if (junctionMade) {
			denied(await roEnv.writeFile(join(linkPath, "BOOM.txt"), "x", context), "a CREATE through a junction into the read-only root is REFUSED");
			check("...and nothing landed in the read-only root", !existsSync(join(shared, "BOOM.txt")));
			denied(await roEnv.writeFile(join(linkPath, "sub", "BOOM.txt"), "x", context), "a CREATE through a junction into a NON-EXISTENT subdir is REFUSED");
			// Remove the junction BEFORE the generic cleanup, so rmSync cannot walk the link.
			// A DIRECTORY SYMLINK IS NOT A DIRECTORY (D131): `rmdirSync` succeeds on a Windows
			// junction but fails ENOTDIR on a POSIX symlink, which left the link behind and made
			// this canary red on Linux while both security assertions above passed. `unlink`
			// removes the link itself on POSIX; the rmdir fallback keeps Windows working.
			try {
				unlinkSync(linkPath);
			} catch {
				try {
					rmdirSync(linkPath);
				} catch {}
			}
			check("the junction was removed", !existsSync(linkPath));
		}
	}

	console.log(failures === 0 ? "\nPASS — all confine canaries held" : `\nFAIL — ${failures} canary(ies) failed`);
} finally {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
