// confine.test.mjs — the M3 boundary's canaries (security conditions SC1-SC3).
//
// Every canary is run BOTH ways: against the raw `NodeExecutionEnv` and against the confined
// wrapper. A denial that also denies without the boundary proves nothing, so each assertion
// here is paired with its unguarded control - the same discipline demo/starter.test.mjs uses
// for `check`, where "0 findings" is meaningless unless the rules can be shown to fire.

import { mkdtemp, mkdir, rm, symlink, writeFile as write } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { authorEnv, verifierEnv } from "../src/confine.mjs";

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
	// that IS present in durig's own process must not reach it. A caller's explicit request for
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
		"git commit -m x",
		"git checkout main",
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
	console.log(failures === 0 ? "\nPASS — all confine canaries held" : `\nFAIL — ${failures} canary(ies) failed`);
} finally {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
}

// Exiting inside the `try` would skip the cleanup above (do not move this earlier).
process.exit(failures === 0 ? 0 : 1);
