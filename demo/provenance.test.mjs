// demo/provenance.test.mjs — `metrics` says what was live.
//
// Item 19: a measure moving is only attributable if the reading names the
// configuration that produced it. `security.sec` asked for exactly two things
// here — report the committed active set, and flag a dirty tree — and refused a
// store write path, because git is already the append-only change log while a
// write path would add a mutable, untrusted attribution surface.
//
// So the load-bearing assertions are the refusals: "no repository" must read as
// unknown rather than clean, and a dirty tree must be flagged rather than
// printing a hash that quietly implies more than it can support.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_EXTENSION, activeSet, formatProvenance, gitProvenance } from "../src/provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const durigDir = join(here, "..");

/** A throwaway git repo, so the dirty flag is proven to move rather than read. */
function initRepo(dir) {
	mkdirSync(dir, { recursive: true }); // git init fails confusingly if cwd is absent
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	git("init", "-q");
	writeFileSync(join(dir, "committed.txt"), "first\n");
	git("add", "committed.txt");
	git("-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", "init");
}

const dir = mkdtempSync(join(tmpdir(), "durig-provenance-"));

/** The CLI, with a scratch DB, parsed as JSON.
 * The DB is created up front by this fixture: `metrics` is a READ verb, and since #4955 a read
 * refuses a store that is not there instead of manufacturing one — and what this demo measures is
 * provenance over a real (empty) rig, not the absent-store refusal. */
const metricsDb = join(dir, "metrics.sqlite");
{
	const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
	const made = await openNodeSqliteStorage(metricsDb);
	await made.close();
}
// ISOLATE THE CONFIG FILE, not just the environment. `cli.mjs` discovers a rig config from
// $DURIG_CONFIG, then ./durig.config.json, then ./.durig/config.json (src/config.mjs:1-8), and
// `cliMetrics` inherits `process.env` AND the cwd's file. Measured 2026-11-10 (item #6057): in the
// shared checkout this demo's "nothing declared" assertion read the OPERATOR's
// `durig.config.json` line 28 (`"DURIG_EXTENSIONS": "extensions/continuity.mjs"`) and failed with
// `['durig.router','extensions/continuity.mjs']` while passing in a fresh item worktree. The demo
// was measuring the machine, not the fixture. An EMPTY config file still EXISTS, so discovery stops
// there and the active set is whatever THIS demo declares.
const emptyConfig = join(dir, "empty-config.json");
const declaredConfig = join(dir, "declared-config.json");
writeFileSync(emptyConfig, "{}\n", "utf8");
writeFileSync(declaredConfig, JSON.stringify({ DURIG_EXTENSIONS: "./extensions/isolated-router.mjs" }) + "\n", "utf8");
function cliMetrics(env = {}) {
	const r = spawnSync(process.execPath, ["cli.mjs", "metrics"], {
		cwd: durigDir,
		env: {
			...process.env,
			DURIG_PROVIDER: "faux",
			DURIG_DB: metricsDb,
			DURIG_CONFIG: emptyConfig,
			...env,
		},
		encoding: "utf8",
	});
	let json = null;
	try {
		json = JSON.parse(r.stdout);
	} catch {
		// Reported through the assertion below rather than thrown here.
	}
	return { status: r.status, json, text: `${r.stdout}${r.stderr}` };
}

try {
	/* -------------------------------------------------- reading a repository */

	// This file lives in a repository, so the honest answer is a real revision
	// and a real dirty flag — not a stub.
	const real = gitProvenance(durigDir);
	assert.match(real.revision, /^[0-9a-f]{4,}$/, `expected a revision, got ${JSON.stringify(real)}`);
	assert.equal(typeof real.dirty, "boolean", "dirty must be a judgement, not undefined");
	assert.equal(real.reason, null, "a readable repository has no reason to report");

	/* -------------------------------------- the dirty flag must be able to move */

	const repo = join(dir, "repo");
	initRepo(repo);
	const clean = gitProvenance(repo);
	assert.match(clean.revision, /^[0-9a-f]{4,}$/);
	assert.equal(clean.dirty, false, `a freshly committed tree is clean, got ${JSON.stringify(clean)}`);

	// MODIFIED tracked file.
	writeFileSync(join(repo, "committed.txt"), "first\nsecond\n");
	assert.equal(gitProvenance(repo).dirty, true, "an edited tracked file must flag the tree dirty");

	// UNTRACKED file. This one matters: a new extension module is part of the
	// active set and is absent from the revision, so it cannot read as clean.
	// Restored by rewriting the bytes, not `git checkout --`, which is on this
	// project's banned-destructive list.
	writeFileSync(join(repo, "committed.txt"), "first\n");
	assert.equal(gitProvenance(repo).dirty, false, "restoring the file must return to clean");
	writeFileSync(join(repo, "untracked-extension.mjs"), "export default {}\n");
	assert.equal(gitProvenance(repo).dirty, true, "an untracked file must flag the tree dirty");

	// Gitignored files must NOT flag it, or every rig database would.
	writeFileSync(join(repo, ".gitignore"), "*.sqlite\n");
	writeFileSync(join(repo, "rig.sqlite"), "not really a database\n");
	execFileSync("git", ["add", ".gitignore"], { cwd: repo, stdio: "ignore" });
	execFileSync("git", ["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", "ignore"], {
		cwd: repo,
		stdio: "ignore",
	});
	assert.equal(
		gitProvenance(repo).dirty,
		true,
		"still dirty from the untracked module, and the ignored db is not the reason",
	);
	rmSync(join(repo, "untracked-extension.mjs"));
	assert.equal(gitProvenance(repo).dirty, false, "an ignored sqlite file must not count as dirty");

	/* ---------------------------------- absence of evidence is not cleanliness */

	// Inside `dir` so the finally removes it. It must not be a repository, and the
	// OS temp dir is not, so nesting it here keeps the property under test.
	const notARepo = join(dir, "not-a-repo");
	mkdirSync(notARepo, { recursive: true });
	const unknown = gitProvenance(notARepo);
	assert.equal(unknown.revision, null, "no repository means no revision");
	assert.equal(unknown.dirty, null, "no repository must be UNKNOWN, never false");
	assert.match(unknown.reason, /git/i, "and it must say why");
	assert.match(
		formatProvenance(unknown, activeSet()),
		/rev unknown/,
		"a person must see unknown, not a clean-looking line",
	);

	/* ------------------------------------------------------------- the wording */

	assert.match(formatProvenance({ revision: "abc1234", dirty: false, reason: null }, activeSet()), /rev abc1234 clean/);

	const dirtyLine = formatProvenance({ revision: "abc1234", dirty: true, reason: null }, activeSet(["x.mjs"]));
	assert.match(dirtyLine, /DIRTY/);
	assert.match(
		dirtyLine,
		/does not describe what ran/,
		"the dirty warning must say why it matters, not just that it is dirty",
	);

	// The builtin is always present, so "active" is never an empty claim.
	assert.deepEqual(activeSet([]), [BUILTIN_EXTENSION]);
	assert.deepEqual(activeSet(["a.mjs", "b.mjs"]), [BUILTIN_EXTENSION, "a.mjs", "b.mjs"]);

	/* ----------------------------------------------------------- through the CLI */

	const plain = cliMetrics();
	assert.equal(plain.status, 0, `metrics failed: ${plain.text.slice(0, 400)}`);
	assert.ok(plain.json.provenance, "the JSON contract must carry the provenance");
	assert.deepEqual(
		plain.json.provenance.active,
		[BUILTIN_EXTENSION],
		"nothing declared means the active set is just durig's own router",
	);
	assert.match(plain.json.provenance.revision, /^[0-9a-f]{4,}$/);

	// A declared extension must appear, because that is the whole point: the
	// reading has to name what a change to the config enabled.
	const declared = cliMetrics({ DURIG_EXTENSIONS: "./extensions/timing.ts" });
	assert.equal(declared.status, 0, `metrics with extensions failed: ${declared.text.slice(0, 400)}`);
	assert.deepEqual(
		declared.json.provenance.active,
		[BUILTIN_EXTENSION, "./extensions/timing.ts"],
		"the declared extension must be reported in the active set",
	);

	// Both directions, so the "nothing declared" row above cannot be vacuous in either
	// direction (#6057): a config FILE this demo wrote is read, and an env value beats it.
	// Without these, "active == [durig.router]" could be satisfied by an inherited operator
	// config that happens to declare nothing - which is exactly how this demo went quiet.
	const fromFile = cliMetrics({ DURIG_CONFIG: declaredConfig });
	assert.equal(fromFile.status, 0, `metrics with a config file failed: ${fromFile.text.slice(0, 400)}`);
	assert.deepEqual(
		fromFile.json.provenance.active,
		[BUILTIN_EXTENSION, "./extensions/isolated-router.mjs"],
		"an extension declared in the CONFIG FILE must appear - the file layer is being read, not skipped",
	);
	const envWins = cliMetrics({ DURIG_CONFIG: declaredConfig, DURIG_EXTENSIONS: "./extensions/env-wins.mjs" });
	assert.equal(envWins.status, 0, `metrics with env over file failed: ${envWins.text.slice(0, 400)}`);
	assert.deepEqual(
		envWins.json.provenance.active,
		[BUILTIN_EXTENSION, "./extensions/env-wins.mjs"],
		"environment beats the config file (src/config.mjs header), so the isolation is provable",
	);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}

// After the finally: an exit inside the try would skip cleanup entirely.
console.log("PROVENANCE TEST PASS (reads a repo, the dirty flag moves, absence is unknown, the CLI reports the active set)");
process.exit(0);
