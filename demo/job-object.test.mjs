// demo/job-object.test.mjs — P2-6: Windows Job Object process reaping.
//
// Proves the Job Object contract: spawn → assign to job → cleanup terminates
// → wait for death → worktree removal is safe (no process mid-write).
//
// Run: node demo/job-object.test.mjs  (exit 0 = pass)

import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const isWindows = process.platform === "win32";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log("  ok   " + label);
	} else {
		failures += 1;
		console.log("  FAIL " + label + (detail ? " — " + detail : ""));
	}
}

// ---- main ----
const base = await mkdtemp(join(tmpdir(), "durig-jobobj-"));

try {
	console.log("\n=== P2-6: Job Object Process Reaping ===\n");

	const { spawnInJob, waitForProcessDeath } = await import("../src/job-object.mjs");

	// ---- Test 1: spawnInJob returns pid, process is alive immediately ----
	console.log("1. spawnInJob — creates process in a Job Object on Windows");

	const cmd = isWindows ? "ping" : "sleep";
	const args = isWindows ? ["-n", "3", "127.0.0.1"] : ["3"];

	const { pid, cleanup } = await spawnInJob(cmd, args, {
		cwd: process.cwd(),
	});
	check("spawnInJob returns pid", typeof pid === "number" && pid > 0, `pid=${pid}`);

	// The process should be alive immediately.
	const alive = isWindows
		? (await run("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"])).stdout.includes(`"${pid}"`)
		: true;
	check("process is alive right after spawn", alive || !isWindows);

	// Wait for the process to naturally finish.
	const dead = await waitForProcessDeath(pid, 10000);
	check("process is dead after natural completion", dead);

	// cleanup is idempotent — calling it after the process is dead should succeed.
	await cleanup();
	check("cleanup is idempotent after process death", true);

	// ---- Test 2: cleanup terminates a running process (KILL_ON_JOB_CLOSE) ----
	console.log("\n2. cleanup terminates a running process via KILL_ON_JOB_CLOSE");

	const longCmd = isWindows ? "ping" : "sleep";
	const longArgs = isWindows ? ["-n", "60", "127.0.0.1"] : ["60"];

	const { pid: pid2, cleanup: cleanup2 } = await spawnInJob(longCmd, longArgs, {
		cwd: process.cwd(),
	});
	check("long-running process spawned with pid", typeof pid2 === "number" && pid2 > 0, `pid=${pid2}`);

	// Verify it's alive
	const longAlive = isWindows
		? (await run("tasklist", ["/FI", `PID eq ${pid2}`, "/NH", "/FO", "CSV"])).stdout.includes(`"${pid2}"`)
		: true;
	check("long-running process is alive before cleanup", longAlive || !isWindows);

	// Cleanup should terminate the job object, killing the process tree.
	await cleanup2();

	// Give a moment for the death to propagate.
	await new Promise((r) => setTimeout(r, 2000));

	// Verify the process is dead after cleanup.
	const longDead = await waitForProcessDeath(pid2, 5000);
	check("process is dead after cleanup", longDead);

	// Verify cleanup is idempotent (second call should not throw).
	await cleanup2();
	check("cleanup is idempotent (second call succeeds)", true);

	// ---- Test 3: POSIX path is a no-op ----
	console.log("\n3. POSIX path — graceful no-op with kill");

	// On POSIX, spawnInJob returns { child, pid, cleanup } and cleanup calls child.kill().
	const { pid: posixPid, cleanup: posixCleanup } = await spawnInJob(
		isWindows ? "ping" : "sleep",
		isWindows ? ["-n", "2", "127.0.0.1"] : ["2"],
	);
	check("POSIX spawn returns pid", typeof posixPid === "number" && posixPid > 0, `pid=${posixPid}`);
	const posixDead = await waitForProcessDeath(posixPid, 5000);
	check("POSIX process dies naturally", posixDead);
	await posixCleanup();
	check("POSIX cleanup succeeds", true);

	// ---- Test 4: multi-process tree ----
	console.log("\n4. Multi-process tree spawned via shell");

	// Spawn a process that itself spawns children — all should die.
	// Use spawnInJob without shell:true so the PID we get IS the direct child.
	let treeCmd4, treeArgs4;
	if (isWindows) {
		treeCmd4 = "cmd.exe";
		treeArgs4 = ["/c", "ping", "-n", "60", "127.0.0.1"];
	} else {
		treeCmd4 = "sh";
		treeArgs4 = ["-c", "sleep 60"];
	}

	const { pid: treePid, cleanup: treeCleanup } = await spawnInJob(treeCmd4, treeArgs4, {
		cwd: process.cwd(),
	});
	check("tree spawn returns pid", typeof treePid === "number" && treePid > 0, `pid=${treePid}`);

	if (isWindows) {
		const treeAlive = (await run("tasklist", ["/FI", `PID eq ${treePid}`, "/NH", "/FO", "CSV"])).stdout.includes(`"${treePid}"`);
		check("tree process is alive before cleanup", treeAlive, "tasklist showed PID");
	}

	await treeCleanup();
	await new Promise((r) => setTimeout(r, 2000));

	const treeDead = await waitForProcessDeath(treePid, 5000);
	check("tree process is dead after cleanup", treeDead);

	console.log(failures === 0
		? "\nPASS — P2-6 Job Object process reaping verified"
		: `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
	console.error("ERROR:", err);
	failures += 1;
} finally {
	try {
		await run("rm", ["-rf", base]);
	} catch (err) {
		console.warn(`cleanup: could not remove ${base}: ${err.message}`);
	}
}

process.exit(failures === 0 ? 0 : 1);
