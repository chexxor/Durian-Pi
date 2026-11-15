// demo/broker-health.test.mjs — F7 (#2581): a broker's PROGRESS leg, so "alive" is not "healthy".
//
// BROKER-SUPERVISION §4 specifies two signals: LIVENESS (a heartbeat; the event loop is turning)
// and PROGRESS (the `PASS` log; passes are ADVANCING). The code implemented only liveness: the
// state file carried {pid, since, runToken, heartbeatAt} and `brokerAlive` was heartbeat+pid. A
// broker stuck in the 60s retry loop (F2/F6) keeps a FRESH heartbeat with a FROZEN PASS, and
// `status` called it up — "status says the broker is up, but no seat has been woken in an hour".
//
// The fix: write `lastPassAt` into `<db>.broker.json` on every completed pass, and have `status`
// report `degraded` when the last pass is older than the pass bound (stream timeout + margin).
//
// FAILING-FIRST (before the fix): `brokerHealth` does not exist and `status` has no `broker`
// health leg, so the assertions below fail.
//
// Run: node demo/broker-health.test.mjs  (exit 0 = pass)
// Cost: 2.22 s standalone, and it is the load member of area `broker` (83/83 in 27.1 s) — measured 2026-11-15
// on Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0. `last_verified: 2026-11-15`.
// ADDENDUM 2026-11-15: the fixture's 100 x 20 ms (2 s) guess for the fake broker's state file was the LAST
// load flake in the suite at `--jobs 4` — under four-way load the node start exceeded 2 s, `status` saw NO
// broker state, and the wedge read `down` instead of `degraded` (362/363 with exactly one FAILED, `.err`
// naming `actual: 'down', expected: 'degraded'`). Green alone in 2.2 s, so the disambiguation cost a 189 s
// suite run. `startFake` now waits on the CONDITION (up to 10 s) and exits at the first poll when idle, so
// the fast path is unchanged and the flake class is gone; a start over 2 s prints its elapsed ms instead of
// silently failing the bound.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BROKER_PROGRESS_MARGIN_MS, DEFAULT_PASS_TIMEOUT_MS, brokerHealth } from "../src/broker.mjs";

const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-broker-health-"));

const NOW = 1_000_000_000_000;
const FRESH = { pid: process.pid, since: "t", runToken: "r", heartbeatAt: NOW, lastPassAt: NOW };

// A stand-in broker: a LIVE pid with a FRESH heartbeat (so reads route to it and liveness holds)
// but a FROZEN `lastPassAt` — the wedge. It ANSWERS reads (a wedged-but-responsive broker), so
// `status` can report instead of timing out.
const FAKE = `
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [db, frozenMs] = process.argv.slice(2);
const statePath = db + ".broker.json";
const inbox = db + ".broker.inbox";
const out = db + ".broker.inbox.out";
const lastPassAt = Date.now() - Number(frozenMs);
const writeState = () => writeFileSync(statePath, JSON.stringify({ pid: process.pid, since: "t", runToken: "fake", heartbeatAt: Date.now(), lastPassAt }));
writeState();
setInterval(writeState, 150); // liveness stays fresh; PROGRESS stays frozen
setInterval(() => {
  if (!existsSync(inbox)) return;
  for (const name of readdirSync(inbox)) {
    if (!name.endsWith(".json")) continue;
    try {
      const req = JSON.parse(readFileSync(join(inbox, name), "utf8"));
      if (!req || !req.requestId) continue;
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, req.requestId + ".json"), JSON.stringify({ ok: true, result: { seats: [], metrics: { measures: [] }, attention: [] } }));
    } catch { /* mid-write; retry next tick */ }
  }
}, 100);
`;

const fakePath = join(dir, "fake-broker.mjs");
writeFileSync(fakePath, FAKE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A pid that is provably GONE: spawn a trivial process and wait for it to exit.
const deadPid = await new Promise((resolve) => {
	const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	child.once("exit", () => resolve(child.pid));
});

const cli = (args, env) =>
	new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: durigDir,
			env: { ...process.env, DURIG_PROVIDER: "faux", ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c));
		child.stderr.on("data", (c) => (stderr += c));
		child.once("exit", (code) => resolve({ code, stdout, stderr }));
	});

async function startFake(db, frozenMs) {
	const child = spawn(process.execPath, [fakePath, db, String(frozenMs)], { stdio: ["ignore", "ignore", "inherit"] });
	/* CONDITION wait, not a guess (pitfall 352/377's `--jobs 4` load-flake class): a 100 x 20 ms bound is
	 * 2 s of REAL wall clock, and a node start under four-way load can exceed it — `status` then reads the
	 * ABSENT state as `down` instead of the wedge's `degraded`, which is a false red that costs a whole
	 * suite re-run to disambiguate. The wait exits at the first poll when the machine is idle (measured
	 * 20-40 ms standalone), so the fast path stays fast; the bound is 10 s, and the elapsed ms is printed
	 * when it crosses the old 2 s so a drift reads as a number instead of a flake. */
	const t0 = Date.now();
	while (Date.now() - t0 < 10_000 && !existsSync(`${db}.broker.json`)) await sleep(20);
	const waited = Date.now() - t0;
	if (!existsSync(`${db}.broker.json`)) throw new Error(`fixture start failed: the fake broker wrote no state within 10000 ms (waited ${waited} ms) — the FIXTURE did not start, this is not a product verdict`);
	if (waited > 2_000) console.log(`  note   the fake broker took ${waited} ms to start (over the 2 s a fixed guess would have allowed) — load, not a defect`);
	return child;
}
const killFake = (child) => {
	try {
		if (child?.pid && child.exitCode === null) process.kill(child.pid, "SIGKILL");
	} catch {
		/* already gone */
	}
};

let fake = null;
try {
	/* 1. the pure health legs (#2581 / §4) ------------------------------------ */
	assert.equal(brokerHealth(null).state, "down", "no state is down");
	assert.equal(brokerHealth({ pid: deadPid, heartbeatAt: NOW, lastPassAt: NOW }, { now: NOW }).state, "down", "a gone pid is down");
	assert.equal(
		brokerHealth({ ...FRESH, heartbeatAt: NOW - 120_000 }, { now: NOW }).state,
		"down",
		"a stale heartbeat (liveness) is down",
	);
	assert.equal(brokerHealth(FRESH, { now: NOW }).state, "up", "a fresh heartbeat + a recent pass is up");

	// THE regression: a FRESH heartbeat (the loop is turning) but a FROZEN pass (nothing is
	// advancing) must read degraded, not up — a liveness-only check would call this healthy.
	const frozen = brokerHealth({ ...FRESH, lastPassAt: NOW - (DEFAULT_PASS_TIMEOUT_MS + BROKER_PROGRESS_MARGIN_MS + 1) }, { now: NOW });
	assert.equal(frozen.state, "degraded", "a fresh heartbeat with a frozen PASS is degraded, not up");
	assert.match(frozen.reason, /progress/, "and the reason names progress");
	assert.equal(brokerHealth({ ...FRESH, lastPassAt: null }, { now: NOW }).state, "degraded", "no pass recorded is degraded");
	assert.equal(
		brokerHealth({ ...FRESH, lastPassAt: NOW - 1_000 }, { now: NOW, streamTimeoutMs: 600_000 }).state,
		"up",
		"a recent pass is up even with a long stream timeout",
	);
	console.log("  ok   brokerHealth: liveness (heartbeat) AND progress (lastPassAt) both decide");

	/* 2. the CLI surface: `status` reports the broker's health ----------------- */
	const db = join(dir, "health.db");
	const rig = join(dir, "rig.json");
	copyFileSync(join(durigDir, "rig.starter.json"), rig);
	const up = await cli(["up", rig, "--no-serve"], { DURIG_DB: db });
	assert.equal(up.code, 0, `up failed: ${up.stderr.slice(0, 200)}`);

	// A live, read-answering broker whose PASS is frozen well past the pass bound.
	fake = await startFake(db, DEFAULT_PASS_TIMEOUT_MS + BROKER_PROGRESS_MARGIN_MS + 60_000);
	const wedged = await cli(["status"], { DURIG_DB: db });
	assert.equal(wedged.code, 0, `status failed: ${wedged.stderr.slice(0, 200)}`);
	const wedgedReport = JSON.parse(wedged.stdout.trim());
	assert.ok(wedgedReport.broker, "status carries a broker health leg");
	assert.equal(wedgedReport.broker.state, "degraded", `a wedged-but-alive broker reads degraded; got ${JSON.stringify(wedgedReport.broker)}`);
	console.log("  ok   status reports the broker DEGRADED when the pass loop is frozen");

	// The SAME live broker, its PASS advancing again -> up. One field, one verdict.
	killFake(fake);
	fake = await startFake(db, 0);
	const healthy = await cli(["status"], { DURIG_DB: db });
	assert.equal(healthy.code, 0, `status failed: ${healthy.stderr.slice(0, 200)}`);
	const healthyReport = JSON.parse(healthy.stdout.trim());
	assert.equal(healthyReport.broker.state, "up", `a broker passing normally reads up; got ${JSON.stringify(healthyReport.broker)}`);
	console.log("  ok   status reports the broker UP when passes are advancing");

	console.log("\nBROKER-HEALTH TEST PASS (liveness + progress; status reads degraded on a frozen pass)");
} finally {
	killFake(fake);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
