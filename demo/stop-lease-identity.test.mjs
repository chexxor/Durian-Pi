// demo/stop-lease-identity.test.mjs — A3 (#2586): `stop` verifies a lease's IDENTITY before killing.
//
// `cmdStop` SIGKILLed the lease holder's pid with NO identity check, so a RECYCLED pid killed an
// unrelated process. The fix verifies the lease still names the same live, renewing holder
// (pid + seat + freshness) and PREFERS SETTLING over killing otherwise.
//
// FAILING-FIRST (before the fix): `leaseKillTarget` does not exist and `cmdStop` kills blindly, so
// the stale-lease case kills the innocent process and the assertions fail.
//
// Run: node demo/stop-lease-identity.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leaseKillTarget } from "../src/genlock.mjs";

const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-stop-lease-"));

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

const pidAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code !== "ESRCH";
	}
};

let victim = null;
try {
	/* 1. the pure guard: pid + seat + freshness must all verify before a kill. */
	const held = { pid: 1234, seat: "pm", slotIndex: 0 };
	const freshSame = { pid: 1234, generatingSeat: "pm", stale: false };
	assert.deepEqual(leaseKillTarget(held, freshSame, "pm"), { kill: 1234, skip: null }, "a verified live lease is killable");
	assert.equal(leaseKillTarget(held, { ...freshSame, stale: true }, "pm").kill, null, "a stale lease is NOT killed (its pid may be recycled)");
	assert.equal(leaseKillTarget(held, { ...freshSame, pid: 9999 }, "pm").kill, null, "a changed pid is NOT killed");
	assert.equal(leaseKillTarget(held, { ...freshSame, generatingSeat: "impl" }, "pm").kill, null, "a changed seat is NOT killed");
	assert.equal(leaseKillTarget(held, undefined, "pm").kill, null, "a vanished slot is NOT killed");
	console.log("  ok   leaseKillTarget verifies pid + seat + freshness before allowing a kill");

	/* 2. the CLI: a stop against a STALE lease whose pid is an INNOCENT live process must NOT kill it. */
	const db = join(dir, "rig.sqlite");
	const rig = join(dir, "rig.json");
	copyFileSync(join(durigDir, "rig.starter.json"), rig);
	const env = { DURIG_DB: db, DURIG_MAX_CONCURRENT_SEATS: "2" };
	const up = await cli(["up", rig, "--no-serve"], env);
	assert.equal(up.code, 0, `up failed: ${up.stderr.slice(0, 200)}`);

	victim = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
	assert.ok(pidAlive(victim.pid), "the innocent process is running");
	// A STALE lease (an old `since`, no monotonic stamp) whose pid now names the victim.
	writeFileSync(
		`${db}.genlock.0`,
		JSON.stringify({ pid: victim.pid, seat: "pm", since: new Date(Date.now() - 700_000).toISOString() }),
	);

	const stopped = await cli(["stop", "pm"], env);
	assert.equal(stopped.code, 0, `stop failed: ${stopped.stderr.slice(0, 300)}`);
	const report = JSON.parse(stopped.stdout.trim());
	assert.equal(report.killed, null, "a stale lease is not killed");
	assert.ok(report.killSkipped, "and the skip is reported, not silent");
	await new Promise((r) => setTimeout(r, 250));
	assert.ok(pidAlive(victim.pid), "the innocent process SURVIVES the stop (no recycled-pid kill)");
	console.log("  ok   a stop against a stale lease does NOT kill an innocent (recycled) pid");

	console.log("\nSTOP-LEASE-IDENTITY TEST PASS (identity verified before kill; settle preferred)");
} finally {
	try {
		if (victim?.pid && victim.exitCode === null) process.kill(victim.pid, "SIGKILL");
	} catch {
		/* already gone */
	}
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(0);
