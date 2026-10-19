// demo/broker-stop-liveness.test.mjs — F1/F9 (#2574): `serve --stop` must gate
// `stopped:true` on the broker PROCESS being GONE, not on its heartbeat.
//
// The defect (architect #2520 §F1/§F9): `brokerAlive` treats a heartbeat older than
// BROKER_HEARTBEAT_TIMEOUT_MS (60s) as dead. A broker DRAINING a long pass stops refreshing
// its heartbeat (runWakeLoop cleared the interval before the unbounded `waitForIdle`), so a
// LIVE broker read as gone: `serve --stop` reported stopped:true and cleared the state with
// NO pid, admitting a second writer mid-drain (the 2026-10-16 double-writer corruption class).
//
// The fix: keep the heartbeat fresh through the drain, and make `serve --stop` decide on
// signal-0 liveness (`brokerProcessAlive`) — `stopped:true` only after the pid is GONE, and
// the state cleared only for the pid we observed (a newer broker's file survives).
//
// FAILING-FIRST (before the fix):
//   case 1 — the fake broker goes heartbeat-stale but STAYS ALIVE; the old code reports
//            stopped:true while it is still running (assertion below fails).
//   case 2 — the old code clears the state with no pid, so a newer broker's state file is
//            destroyed (assertion below fails).
//
// Run: node demo/broker-stop-liveness.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-stop-live-"));
const cliPath = join(process.cwd(), "cli.mjs");

// A stand-in broker: it writes its OWN `<db>.broker.json` (naming its real pid) and keeps
// running, so we can drive `serve --stop` against a process that is genuinely alive.
//   mode "stale-stay" — starts with a FRESH heartbeat, then lets it go stale (a drain that
//                       stopped refreshing) and never exits: the live-but-heartbeat-stale case.
//   mode "handover"   — starts heartbeat-stale; on seeing `.stop` it writes a NEWER broker's
//                       state and exits: proves a newer broker's file survives the stop path.
const FAKE = `
import { existsSync, writeFileSync } from "node:fs";
const [db, mode] = process.argv.slice(2);
const statePath = db + ".broker.json";
const stopPath = db + ".broker.stop";
const write = (heartbeatAt, pid = process.pid) =>
  writeFileSync(statePath, JSON.stringify({ pid, since: new Date().toISOString(), runToken: "fake-" + pid, heartbeatAt }));
write(Date.now());
if (mode === "stale-stay") setTimeout(() => write(Date.now() - 120_000), 900);
if (mode === "handover") write(Date.now() - 120_000);
setInterval(() => {
  if (!existsSync(stopPath)) return;
  if (mode !== "handover") return; // stale-stay IGNORES the stop request: a long drain, still alive
  write(Date.now(), process.pid + 1); // a newer broker takes over
  process.exit(0); // cooperative exit
}, 50);
`;

const fakePath = join(dir, "fake-broker.mjs");
writeFileSync(fakePath, FAKE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pidAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code !== "ESRCH";
	}
};

/** Spawn the stand-in broker and wait until its state file exists. */
async function startFake(db, mode) {
	const child = spawn(process.execPath, [fakePath, db, mode], { stdio: ["ignore", "ignore", "inherit"] });
	for (let i = 0; i < 100 && !existsSync(`${db}.broker.json`); i++) await sleep(20);
	return child;
}

/** Run `serve --stop` and return its parsed JSON output. */
function stop(db, env = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [cliPath, "serve", "--stop"], {
			cwd: process.cwd(),
			env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux", ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.once("close", (code) => {
			let json = null;
			try {
				json = JSON.parse(stdout.trim());
			} catch {
				/* reported below */
			}
			resolve({ code, json, stdout, stderr });
		});
	});
}

const killFake = (child) => {
	try {
		if (child?.pid && child.exitCode === null) process.kill(child.pid, "SIGKILL");
	} catch {
		/* already gone */
	}
};

let fake1 = null;
let fake2 = null;
try {
	/* case 1: heartbeat-stale but ALIVE -> stopped:true must NOT be reported. */
	const db1 = join(dir, "case1.db");
	fake1 = await startFake(db1, "stale-stay");
	const fake1Pid = fake1.pid;
	assert.ok(pidAlive(fake1Pid), "the stand-in broker is running");

	const r1 = await stop(db1, { DURIG_STOP_WAIT_MS: "2500" });
	assert.ok(r1.json, `serve --stop returned JSON; stdout=${r1.stdout.slice(0, 200)} stderr=${r1.stderr.slice(0, 200)}`);
	assert.equal(
		r1.json.stopped,
		false,
		`a heartbeat-stale but ALIVE broker must NOT read as stopped (got ${JSON.stringify(r1.json)})`,
	);
	assert.equal(r1.json.pid, fake1Pid, "the live pid is reported, so the operator can investigate");
	assert.ok(pidAlive(fake1Pid), "and the broker really is still running");
	assert.ok(
		r1.json.stopped !== true || !pidAlive(fake1Pid),
		"INVARIANT: stopped:true only once the pid is gone",
	);
	// The live writer's state must SURVIVE: clearing it admits a second writer mid-drain. This
	// holds whichever way the old code went (stopped:true on the fresh path, or a "stale; cleared"
	// that deleted a live broker's file).
	assert.ok(existsSync(`${db1}.broker.json`), "a LIVE broker's state file is not cleared");
	assert.equal(
		JSON.parse(readFileSync(`${db1}.broker.json`, "utf8")).pid,
		fake1Pid,
		"the surviving state still names the live broker",
	);
	console.log("  ok   a heartbeat-stale but LIVE broker is NOT reported stopped:true, and its state survives");

	/* case 2: a NEWER broker's state file survives the stop path. */
	const db2 = join(dir, "case2.db");
	fake2 = await startFake(db2, "handover");
	const fake2Pid = fake2.pid;
	const newerPid = fake2Pid + 1;

	const r2 = await stop(db2, { DURIG_STOP_WAIT_MS: "4000" });
	assert.ok(r2.json, `serve --stop returned JSON; stdout=${r2.stdout.slice(0, 200)} stderr=${r2.stderr.slice(0, 200)}`);
	assert.equal(r2.json.stopped, true, "the stand-in broker exited, so stopped:true is correct");
	assert.ok(!pidAlive(fake2Pid), "the pid it reported is actually gone");
	assert.ok(existsSync(`${db2}.broker.json`), "a NEWER broker's state file survives the stop path");
	assert.equal(
		JSON.parse(readFileSync(`${db2}.broker.json`, "utf8")).pid,
		newerPid,
		"the surviving state still names the newer broker, not the one that stopped",
	);
	console.log("  ok   a newer broker's state file survives the stop path (pid-guarded clear)");

	console.log("\nBROKER-STOP-LIVENESS TEST PASS (stopped:true requires the pid gone; a newer state survives)");
} finally {
	killFake(fake1);
	killFake(fake2);
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
