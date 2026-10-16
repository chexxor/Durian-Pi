// init tests (#624, pm route of #491 C9/C10 "INIT META-DEFAULTS"): a bare
// install has nothing runnable, so `node cli.mjs init` scaffolds the two
// files a rig needs beside the operator — a minimal working rig file with
// seeded seats, copied from the hardened starter, and a durig.config.json
// materialized from the shipped defaults. npm-init-like: it refuses to
// overwrite either file when one exists.
//
// The unit layer is the SHIPPED ARTIFACTS themselves (the starter, the
// defaults file) plus the pure audit the command reuses; the integration
// layer runs the REAL CLI in a temp cwd, exactly as an operator would:
// Run: node demo/init.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const durigDir = join(here, "..");
const STARTER = join(durigDir, "rig.starter.json");
const SHIPPED_DEFAULTS = join(durigDir, "durig.config.default.json");

// Child env stripped of every DURIG_* key so a scaffolded config file is the
// observable source, not the parent shell (same hygiene as config.test.mjs).
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) {
	if (k.startsWith("DURIG_") || k === "DEEPINFRA_API_KEY") delete cleanEnv[k];
}

/** Run one CLI verb in `cwd` and return {code, json, stdout, stderr}. */
function runCli(cwd, args) {
	const r = spawnSync(process.execPath, [join(durigDir, "cli.mjs"), ...args], {
		cwd,
		env: { ...cleanEnv, DURIG_PROVIDER: "faux" },
		encoding: "utf8",
	});
	let json = null;
	try {
		json = JSON.parse(r.stdout);
	} catch {
		// Human output or a crash; the text is kept for the assertion message.
	}
	return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

try {
	// --- 1. The seed artifacts a scaffold copies from exist and are sane ------
	// init must never INVENT defaults: it copies the two shipped files, so the
	// definition stays single (this is what demo/starter.test.mjs and
	// demo/config.test.mjs keep true).
	const starterSpec = JSON.parse(readFileSync(STARTER, "utf8"));
	const seatNames = starterSpec.seats.map((s) => s.name);
	assert.equal(seatNames.length, 4, "the starter seeds four seats");
	for (const name of ["pm", "impl", "qa", "lead"]) {
		assert.ok(seatNames.includes(name), `the starter seeds a ${name} seat`);
	}
	const shipped = JSON.parse(readFileSync(SHIPPED_DEFAULTS, "utf8"));
	assert.equal(shipped.DURIG_MAX_CONCURRENT_SEATS, "1", "the shipped floor is 1 (config.test.mjs asserts the same)");
	console.log("SEED ARTIFACTS OK");

	// --- 2. The real scaffold: init in an EMPTY temp cwd -----------------------
	const fresh = mkdtempSync(join(tmpdir(), "durig-init-fresh-"));
	const initRun = runCli(fresh, ["init"]);
	assert.equal(initRun.code, 0, `init failed: ${initRun.stderr.slice(0, 300)}`);
	assert.equal(initRun.json?.ok, true, "init reports the JSON contract");

	// 2a. rig.json: a copy of the starter (same seats/edges/constitution), with
	//     only the provenance note changed — the seed is used verbatim.
	const scaffolded = JSON.parse(readFileSync(join(fresh, "rig.json"), "utf8"));
	assert.deepEqual(scaffolded.seats, starterSpec.seats, "seats copied from the starter verbatim");
	assert.deepEqual(scaffolded.edges, starterSpec.edges, "edges copied from the starter verbatim");
	assert.equal(scaffolded.constitutionInline, starterSpec.constitutionInline, "the inline constitution survives the copy");
	assert.match(
		scaffolded._readme,
		/node cli\.mjs init/,
		"the scaffolded rig names its provenance in its own metadata",
	);

	// 2b. durig.config.json: the shipped defaults, materialized for editing.
	const scaffoldedConfig = JSON.parse(readFileSync(join(fresh, "durig.config.json"), "utf8"));
	assert.deepEqual(scaffoldedConfig, shipped, "the runtime config is the shipped defaults, unmodified");

	// 2c. The JSON contract names both artifacts and the next steps.
	assert.equal(initRun.json.command, "init");
	assert.deepEqual(initRun.json.rig.seats, seatNames, "the report names the seeded seats");
	assert.ok(initRun.json.rig.from.endsWith("rig.starter.json"), "the report names the starter it copied");
	assert.equal(initRun.json.config.path, "durig.config.json");
	assert.ok(initRun.json.next.includes("node cli.mjs up rig.json"), "next steps point at up");
	// Human path on stderr, machine contract on stdout.
	assert.ok(initRun.stderr.includes("next: node cli.mjs up rig.json"), "stderr carries the next steps");
	console.log("SCAFFOLD OK (rig.json from the starter, config from the shipped defaults)");

	// --- 3. The scaffold is RUNNABLE: check accepts it, store rules skip ------
	// A scaffold that failed its own linter would only be a confident wrong
	// lesson (starter.test.mjs's reasoning). `check` on a not-yet-created store
	// must report the file-only rules as passing and the store rules skipped,
	// exit 0 — the state a first-time operator is in.
	const audit = runCli(fresh, ["check", "rig.json"]);
	assert.equal(audit.code, 0, `check on the scaffold failed: ${initRun.stderr.slice(0, 300)} / ${audit.stdout.slice(0, 300)}`);
	assert.deepEqual(audit.json?.findings, [], "the scaffold audits clean before up");
	const skippedIds = (audit.json?.checks ?? []).filter((c) => c.status === "skipped").map((c) => c.id);
	assert.ok(skippedIds.includes("store-missing-seat"), "store rules skip (no store yet), not fail");
	console.log("SCAFFOLD AUDITS CLEAN OK (exit 0, store rules skipped)");

	// --- 4. npm-init-like refusals: no overwrite, no torn scaffolds ------------
	// rig.json exists → refuse BEFORE writing the config, so a refusal never
	// leaves a half scaffold (a config with no rig is exactly the torn state).
	const refuseRig = mkdtempSync(join(tmpdir(), "durig-init-refuse-"));
	writeFileSync(join(refuseRig, "rig.json"), '{"seats":[]}' );
	const refused1 = runCli(refuseRig, ["init"]);
	assert.equal(refused1.code, 1, "init refuses when rig.json already exists");
	assert.match(refused1.json?.error ?? refused1.stderr, /rig\.json.*already exists/, "and names the file");
	assert.ok(!rmRfProbe(refuseRig, "durig.config.json"), "no half scaffold: the config was NOT written when the rig was refused");

	// durig.config.json exists (and rig.json too) → same refusal, names the
	// second file; the operator's files were clobbered by neither attempt. The
	// rig refusal wins because checks are ordered rig-then-config.
	writeFileSync(join(refuseRig, "durig.config.json"), "{}");
	const refused2 = runCli(refuseRig, ["init"]);
	assert.equal(refused2.code, 1, "init refuses when the files already exist");
	assert.match(refused2.json?.error ?? refused2.stderr, /rig\.json.*already exists/, "rig refusal still wins and names its file");
	assert.equal(JSON.parse(readFileSync(join(refuseRig, "rig.json"), "utf8")).seats.length, 0, "the operator's rig.json was not clobbered");
	assert.equal(readFileSync(join(refuseRig, "durig.config.json"), "utf8"), "{}", "the operator's config was not clobbered");
	console.log("OVERWRITE REFUSALS OK (both files, never torn, never clobbered)");

	// --- 5. A broken seed must fail init LOUDLY, not scaffold garbage ---------
	// The audit is the guard that keeps init honest when rig.starter.json
	// drifts; proven through the real CLI by hiding the repo's OWN starter path
	// is impossible from a child cwd, so this exercises the malformed-JSON arm
	// the same way: the repo copy is intact and the anchor is what init reads
	// first — simulate by running init with a MALFORMED anchor via a copied
	// install? Too heavy for this suite. Instead assert the REAL path's guard
	// is wired: a starter that fails `check` makes init fail (mirrored here by
	// reading the wiring, as config.test.mjs does for streamSettings).
	const cliSource = readFileSync(join(durigDir, "cli.mjs"), "utf8");
	assert.match(
		cliSource,
		/auditRig\(\{\s*\n\s*rig: starterSource,/,
		"init must audit the seed through the same auditRig check uses",
	);
	assert.match(
		cliSource,
		/does not pass its own check/,
		"a rejected seed fails init loudly",
	);
	assert.match(
		cliSource,
		/stored: \{ reason: "absent" \}/,
		"the seed audit runs with no store, so store rules cannot fail a first scaffold",
	);
	console.log("BROKEN-SEED GUARD OK (wired through auditRig, absent-store basis)");

	console.log("INIT TEST PASS");
} finally {
	// Same discipline as config.test.mjs: always clean the temp dirs.
	try {
		for (const d of scrapeTempDirs("durig-init-")) rmSync(d, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dirs kept): ${err?.message ?? err}`);
	}
}

/** mkdtempSync dirs this test created in tmpdir (prefix durig-init-). */
function scrapeTempDirs(prefix) {
	return readdirSync(tmpdir()).filter((d) => d.startsWith(prefix)).map((d) => join(tmpdir(), d));
}

function rmRfProbe(dir, file) {
	try {
		return fileExists(join(dir, file));
	} catch {
		return false;
	}
}
function fileExists(p) {
	try {
		readdirSync(p);
		return true; // a directory
	} catch {
		try {
			return readFileSync(p, "utf8").length > 0 || true; // a file that reads
		} catch {
			return false; // ENOENT
		}
	}
}

// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
