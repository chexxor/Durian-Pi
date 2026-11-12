// Work strategy, end to end through the real CLI: what the operator DECLARES in a rig file is what
// the rig PERSISTS, what `ps`/`status` REPORT, and what a typo REFUSES before a single seat exists.
//
// Why a demo and not a unit test: `src/workstrategy.mjs` is pure and pinned by demo/workstrategy.test.mjs.
// The gap that unit test cannot close is the WIRING — `cmdUp` validates and persists the value onto the
// seats document, `claim_work` resolves it from there, and the readout reads it back. A handoff once
// claimed that wiring was verified while only `node --check` had run, which is exactly the
// passed-the-earlier-layers-and-failed-the-last one this file exists to prevent.
//
// Offline and fast: the faux provider plane (no network, no keys), the same harness demo/cli.test.mjs uses.
// Run: node demo/workstrategy-up.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-workstrategy-"));
const db = join(dir, "rig.sqlite");

// The ambient setting must not leak into an assertion about the rig FILE: a host that exports
// DURIG_WORK_STRATEGY would otherwise make "declared" pass for the wrong reason.
const baseEnv = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db };
delete baseEnv.DURIG_WORK_STRATEGY;

const cli = (args, env = baseEnv) => {
	const res = spawnSync(process.execPath, ["cli.mjs", ...args], {
		cwd: durigDir,
		env,
		encoding: "utf8",
	});
	return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};
const jsonOf = (res) => JSON.parse(res.stdout);

const rigWith = (extra) =>
	writeFileSync(
		join(dir, "rig.json"),
		JSON.stringify({
			version: 2,
			seats: [
				{ name: "alpha", role: "alpha role", instructions: "a" },
				{ name: "beta", role: "beta role", instructions: "b" },
			],
			edges: [{ from: "alpha", maySendTo: ["beta"] }],
			...extra,
		}),
	);

try {
	// --- 1. a DECLARED team strategy + one seat override reach the store --------------------------
	rigWith({ workStrategy: "priority_first", seats: [
		{ name: "alpha", role: "alpha role", instructions: "a" },
		{ name: "beta", role: "beta role", instructions: "b", workStrategy: "oldest_first" },
	] });
	const up = cli(["up", join(dir, "rig.json")]);
	assert.equal(up.code, 0, `up exit 0 (stderr: ${up.stderr.slice(0, 400)})`);
	const upJson = jsonOf(up);
	assert.deepEqual(upJson.created, ["alpha", "beta"], "both seats created");
	assert.equal(upJson.workStrategy.team, "priority_first", "up reports the team strategy it applied");
	assert.equal(upJson.workStrategy.source, "rig file", "...and that the RIG FILE, not the environment, supplied it");
	assert.deepEqual(upJson.workStrategy.seat, { beta: "oldest_first" }, "...and the per-seat override");

	// --- 2. `ps` reads it BACK from the store, with provenance per seat --------------------------
	const ps = jsonOf(cli(["ps"]));
	assert.equal(ps.ok, true);
	assert.deepEqual(ps.workStrategy.team, { strategy: "priority_first", source: "team" },
		"ps resolves the TEAM value from the persisted seats doc");
	assert.deepEqual(ps.workStrategy.seats.alpha, { strategy: "priority_first", source: "team" },
		"a seat with no override inherits the team strategy");
	assert.deepEqual(ps.workStrategy.seats.beta, { strategy: "oldest_first", source: "seat" },
		"an overridden seat reports ITS OWN value and says so");
	assert.equal(ps.workStrategy.default, "oldest_first", "the default is named, so a rig with neither value is explainable");
	// The seat rows themselves carry the raw override (not the resolved value): an empty rig is not
	// distinguishable from "inherited" if the row invented a value.
	assert.equal(ps.seats.find((s) => s.name === "beta").workStrategy, "oldest_first");
	assert.equal(ps.seats.find((s) => s.name === "alpha").workStrategy, undefined,
		"an inheriting seat's row carries NO strategy of its own");

	// --- 3. `status` carries the same view (it spreads the health read) -------------------------
	const status = jsonOf(cli(["status", "--no-notes"]));
	assert.equal(status.ok, true);
	assert.deepEqual(status.workStrategy.team, { strategy: "priority_first", source: "team" },
		"status shows the team strategy without a second read path");

	// --- 4. a re-run `up` does not disturb it, and a CHANGED team value is applied ---------------
	const again = jsonOf(cli(["up", join(dir, "rig.json")]));
	assert.deepEqual(again.created, [], "idempotent: no second seat");
	assert.equal(jsonOf(cli(["ps"])).workStrategy.team.strategy, "priority_first", "unchanged after a re-run");
	rigWith({ workStrategy: "oldest_first", seats: [
		{ name: "alpha", role: "alpha role", instructions: "a" },
		{ name: "beta", role: "beta role", instructions: "b", workStrategy: "oldest_first" },
	] });
	assert.equal(cli(["up", join(dir, "rig.json")]).code, 0);
	assert.deepEqual(jsonOf(cli(["ps"])).workStrategy.team, { strategy: "oldest_first", source: "team" },
		"a changed team strategy reaches the store on the next up");

	// --- 5. `--refresh` re-applies a changed SEAT value, and null deletes it --------------------
	rigWith({ workStrategy: "oldest_first", seats: [
		{ name: "alpha", role: "alpha role", instructions: "a", workStrategy: "priority_first" },
		{ name: "beta", role: "beta role", instructions: "b", workStrategy: null },
	] });
	assert.equal(cli(["up", join(dir, "rig.json"), "--refresh"]).code, 0, "refresh exits 0");
	const refreshed = jsonOf(cli(["ps"])).workStrategy.seats;
	assert.deepEqual(refreshed.alpha, { strategy: "priority_first", source: "seat" }, "--refresh applied the new seat value");
	assert.deepEqual(refreshed.beta, { strategy: "oldest_first", source: "team" }, "null DELETED the override, so beta inherits again");

	// --- 6. a TYPO is refused by name, BEFORE any seat is created ------------------------------
	const typoDb = join(dir, "typo.sqlite");
	const typoEnv = { ...baseEnv, DURIG_DB: typoDb };
	rigWith({ workStrategy: "priority" });
	const typo = cli(["up", join(dir, "rig.json")], typoEnv);
	assert.notEqual(typo.code, 0, "an unknown team strategy refuses the up");
	// `fail()` prints the refusal as the JSON error field on stdout (the CLI contract), so read THAT,
	// not stderr, or the assertion passes on an empty string for the wrong reason.
	const typoError = jsonOf(typo).error;
	assert.match(typoError, /priority_first/, "the refusal NAMES the valid set");
	assert.match(typoError, /oldest_first/);
	assert.ok(!existsSync(typoDb), "the refusal happens before a store exists, so no half-bootstrapped rig");

	rigWith({ seats: [{ name: "alpha", role: "alpha role", instructions: "a", workStrategy: "newest_first" }] });
	const seatTypo = cli(["up", join(dir, "rig.json")], typoEnv);
	assert.notEqual(seatTypo.code, 0, "an unknown SEAT strategy refuses the up too");
	const seatTypoError = jsonOf(seatTypo).error;
	assert.match(seatTypoError, /alpha/, "the refusal names the seat");
	assert.match(seatTypoError, /newest_first/, "...and the offending value");

	// --- 7. the config file is the fallback when the rig file is silent ------------------------
	rigWith({});
	const cfgDb = join(dir, "cfg.sqlite");
	const cfgEnv = { ...baseEnv, DURIG_DB: cfgDb, DURIG_WORK_STRATEGY: "priority_first" };
	const cfgUp = cli(["up", join(dir, "rig.json")], cfgEnv);
	assert.equal(cfgUp.code, 0, `up with the env fallback exits 0 (stderr: ${cfgUp.stderr.slice(0, 200)})`);
	assert.equal(jsonOf(cfgUp).workStrategy.source, "environment", "the fallback is reported as the environment");
	assert.deepEqual(jsonOf(cli(["ps"], cfgEnv)).workStrategy.team, { strategy: "priority_first", source: "team" },
		"the environment value is persisted onto the seats doc like a declared one");
	delete process.env.DURIG_WORK_STRATEGY;
	assert.equal(
		jsonOf(cli(["up", join(dir, "rig.json")], { ...baseEnv, DURIG_DB: join(dir, "plain.sqlite") })).workStrategy.team,
		"oldest_first",
		"with nothing declared anywhere the default stands",
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("workstrategy-up: PASS — declared strategy persists, reads back via ps/status, and a typo refuses before bootstrap");
