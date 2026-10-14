// demo/autostart.test.mjs — auto-starting the resident broker from `up` (D45).
//
// `up` on an interactive terminal should leave the queue self-driving, but spawning a
// daemon is a decision with real consequences: a second driver double-wakes, and a
// silently-spawned orphan outlives the test that made it. This proves the contract:
//   - `--no-serve` and a piped `up` never spawn a broker;
//   - `--serve` starts one that STAYS resident (the unbounded `signal.wait` holds a
//     live handle — without it Node drains the event loop and the broker exits);
//   - `run` and a second `serve` fail closed while it drives;
//   - `up --serve` is idempotent, and `serve --stop` reaps it and clears the state.
//
// Failing-first: before the auto-start wiring this dies (no `broker` field / no state
// file). Run: node demo/autostart.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-autostart-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = join(dir, "rig.sqlite");
const rigFile = join(dir, "rig.json");
writeFileSync(
	rigFile,
	JSON.stringify({
		version: 2,
		seats: [{ name: "alpha", role: "alpha", instructions: "a" }],
		edges: [{ from: "alpha", maySendTo: ["alpha"] }],
	}),
);

const env = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db };
const cli = (args) =>
	spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: durigDir, env, encoding: "utf8" });
const json = (r) => JSON.parse(r.stdout);
const statePath = `${db}.broker.json`;
const logPath = `${db}.broker.log`;

/** The live broker pid from the state file, or null when absent/dead. */
function liveBrokerPid() {
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		process.kill(state.pid, 0);
		return state.pid;
	} catch {
		return null;
	}
}

/** Best-effort teardown so a failing assertion cannot leak an orphan broker. */
function reap() {
	try {
		spawnSync(process.execPath, ["cli.mjs", "serve", "--stop"], { cwd: durigDir, env, encoding: "utf8" });
	} catch {
		// teardown is best-effort; the pid kill below is the backstop
	}
	const pid = liveBrokerPid();
	if (pid !== null) {
		try {
			process.kill(pid);
		} catch {
			// already gone
		}
	}
}

try {
	// 1. An explicit --no-serve never starts a broker.
	const off = json(cli(["up", rigFile, "--no-serve"]));
	assert.equal(off.broker.started, false, "--no-serve disables auto-start");
	assert.ok(!existsSync(statePath), "no broker state is written when disabled");

	// 2. A piped `up` (stdout is not a TTY here) does not silently spawn a daemon.
	const piped = json(cli(["up", rigFile]));
	assert.equal(piped.broker.started, false, "a non-interactive up does not auto-start");
	assert.ok(!existsSync(statePath), "and leaves no state file");

	// 3. `--serve` starts a broker that STAYS resident.
	const on = json(cli(["up", rigFile, "--serve"]));
	assert.equal(on.broker.started, true, "--serve forces auto-start");
	assert.equal(liveBrokerPid(), on.broker.pid, "the state file names a live broker");
	await new Promise((r) => setTimeout(r, 1000));
	assert.ok(liveBrokerPid() !== null, "the broker is still resident a second later (unbounded wait holds a handle)");

	// 4. A second driver must refuse: `run` while the broker drives.
	const run = cli(["run", "--max-duration", "1"]);
	assert.notEqual(run.code, 0, "run exits non-zero while a broker drives");
	assert.match(run.stdout, /resident broker is already driving/, "and says why");

	// 5. A second broker must refuse.
	const dup = cli(["serve", "--max-duration", "1"]);
	assert.notEqual(dup.code, 0, "a second serve exits non-zero");
	assert.match(dup.stdout, /already running/, "naming the live broker");

	// 6. Auto-start is idempotent.
	const again = json(cli(["up", rigFile, "--serve"]));
	assert.equal(again.broker.started, false, "up --serve reuses a live broker");
	assert.equal(again.broker.reason, "already running");

	// 7. `serve --stop` reaps it and clears the state.
	const stopped = json(cli(["serve", "--stop"]));
	assert.equal(stopped.stopped, true, "stop reports the broker stopped");
	assert.ok(!existsSync(statePath), "stop clears the state file");
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(liveBrokerPid(), null, "the broker process is gone");

	// The resident loop must not have exited on an unsettled await along the way.
	if (existsSync(logPath)) {
		assert.doesNotMatch(readFileSync(logPath, "utf8"), /unsettled top-level await/, "the broker never drained its event loop");
	}
} finally {
	reap();
}

console.log("AUTOSTART TEST PASS (up auto-starts a resident broker; --no-serve opts out; stop reaps it)");
process.exit(0);
