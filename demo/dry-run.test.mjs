// demo/dry-run.test.mjs — prove `--dry-run` for `up --refresh` / `reset` (ROADMAP 84).
//
// ROADMAP 84: print the diff (which constitution doc / seat model would change)
// before writing, so a blind write becomes reviewable. Acceptance: `up --refresh
// --dry-run` names the seats and fields it would change and writes nothing.
//
// Driven through the REAL CLI in a temp cwd, exactly as an operator would, so the
// flag parsing, the read-only diff and the "writes nothing" guarantee are all
// exercised rather than a re-implementation. The strongest assertion is the last
// one: the real `up --refresh` applies exactly the change the dry run named.
//
// Run: node demo/dry-run.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const durigDir = join(here, "..");

// Child env stripped of every DURIG_* key so the temp cwd's own ./rig.sqlite is
// the store, never the operator's.
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) if (k.startsWith("DURIG_")) delete cleanEnv[k];

/** Run one CLI verb in `cwd` and return {code, json, stdout, stderr}. */
function runCli(cwd, args) {
	const r = spawnSync(process.execPath, [join(durigDir, "cli.mjs"), ...args], {
		cwd,
		env: { ...cleanEnv, DURIG_PROVIDER: "faux", DURIG_MODEL: "m1" },
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

const resetCount = (cwd) => {
	const log = runCli(cwd, ["log", "alpha"]);
	return (log.json?.entries ?? []).filter((e) => e.kind === "pi.reset").length;
};
const seatNames = (cwd) => (runCli(cwd, ["ps"]).json?.seats ?? []).map((s) => s.name).sort();

const spec = (alphaModel, withGamma) => ({
	version: 2,
	seats: [
		{ name: "alpha", role: "worker", capabilities: ["implement", "code"], model: alphaModel },
		{ name: "beta", role: "verifier", capabilities: ["verify"], model: "faux/m1" },
		...(withGamma
			? [{ name: "gamma", role: "verifier", capabilities: ["verify"], model: "faux/m1" }]
			: []),
	],
	edges: [{ from: "alpha", maySendTo: ["beta"] }],
	constitutionInline: "# constitution\nbe good\n",
});

try {
	const dir = mkdtempSync(join(tmpdir(), "durig-dryrun-"));
	const rig = join(dir, "rig.json");

	// --- 0. build a real rig, then change the spec ---------------------------
	writeFileSync(rig, JSON.stringify(spec("faux/m1", false), null, 2));
	const up1 = runCli(dir, ["up", "rig.json"]);
	assert.equal(up1.code, 0, `up failed: ${up1.stderr.slice(0, 300)}`);
	assert.deepEqual(seatNames(dir), ["alpha", "beta"], "the rig is created");
	assert.equal(resetCount(dir), 0, "a fresh up writes no reset boundary");

	// The change a dry run must make reviewable: alpha's model, plus a new seat.
	writeFileSync(rig, JSON.stringify(spec("faux/m2", true), null, 2));

	// --- 1. `up --refresh --dry-run` names the seats + fields, writes nothing --
	const dry = runCli(dir, ["up", "rig.json", "--refresh", "--dry-run"]);
	assert.equal(dry.code, 0, `dry run failed: ${dry.stderr.slice(0, 300)}`);
	assert.equal(dry.json?.ok, true);
	assert.equal(dry.json.dryRun, true, "the report is marked a dry run");
	assert.equal(dry.json.writes, 0, "the report says nothing was written");
	assert.equal(dry.json.broker, undefined, "a dry run never starts the broker");

	assert.deepEqual(dry.json.wouldCreate, ["gamma"], "names the seat it would create");
	const alpha = (dry.json.wouldRefresh ?? []).find((r) => r.seat === "alpha");
	assert.deepEqual(
		alpha?.changes,
		{ model: { from: "faux/m1", to: "faux/m2" } },
		"names the seat and the field it would change",
	);
	const beta = (dry.json.wouldRefresh ?? []).find((r) => r.seat === "beta");
	assert.deepEqual(beta?.changes, {}, "an unchanged seat reports no field change");
	assert.deepEqual(
		(dry.json.wouldReset ?? []).map((r) => r.seat),
		["alpha"],
		"names the seat whose context the model change would reset",
	);
	assert.equal(dry.json.constitution.changed, false, "the unchanged constitution is reported as no change");
	assert.equal(dry.json.edges.changed, false, "the unchanged edges are reported as no change");

	// WRITES NOTHING: no seat created, no reset boundary written.
	assert.deepEqual(seatNames(dir), ["alpha", "beta"], "the dry run created no seat");
	assert.equal(resetCount(dir), 0, "the dry run wrote no reset boundary");

	// --- 2. `reset <seat> --dry-run` names the seat, writes nothing -----------
	const rdry = runCli(dir, ["reset", "alpha", "--dry-run"]);
	assert.equal(rdry.code, 0, `reset dry run failed: ${rdry.stderr.slice(0, 300)}`);
	assert.equal(rdry.json?.dryRun, true);
	assert.equal(rdry.json.wouldReset, true, "names the seat it would reset");
	assert.equal(rdry.json.writes, 0);
	assert.equal(rdry.json.handoff, null, "no handoff given, so none is reported");
	assert.equal(resetCount(dir), 0, "the reset dry run wrote no reset boundary");

	// --- 3. the REAL refresh applies exactly what the dry run named ----------
	const apply = runCli(dir, ["up", "rig.json", "--refresh"]);
	assert.equal(apply.code, 0, `apply failed: ${apply.stderr.slice(0, 300)}`);
	assert.deepEqual(seatNames(dir), ["alpha", "beta", "gamma"], "the real refresh created the seat the dry run named");
	assert.equal(resetCount(dir), 1, "the real refresh wrote the reset boundary the dry run named");

	// --- 4. discoverable: the help text advertises the flag -------------------
	const help = runCli(dir, ["help"]);
	assert.match(help.stderr, /--dry-run/, "the usage text advertises --dry-run");

	console.log("DRY-RUN TEST PASS (names seats + fields, writes nothing, and the real refresh matches the preview)");
} finally {
	try {
		for (const d of readdirSync(tmpdir()).filter((d) => d.startsWith("durig-dryrun-"))) {
			rmSync(join(tmpdir(), d), { recursive: true, force: true });
		}
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dirs kept): ${err?.message ?? err}`);
	}
}

process.exit(0);
