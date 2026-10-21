// DOGFOOD F12 seat-root guard test: a seat's working directory is resolved ONCE
// at `up` time (seat.cwd ?? spec.cwd ?? DURIAN_PI_SEAT_ROOT) and persisted onto the
// conversation, so a later launch with a different DURIAN_PI_SEAT_ROOT would silently
// run against the persisted (stale/wrong) tree while looking like success. The
// guard fixes that: when DURIAN_PI_SEAT_ROOT is set and differs from a seat's persisted
// cwd, the write-side command (`send`/`run`) fails CLOSED naming both paths and the
// fix; the equal/unset case stays quiet and succeeds. View-only commands are not
// affected.
// This proves:
//   (a) the mismatch case: a write-side command exits NON-ZERO with BOTH paths in
//       the message (persisted cwd and DURIAN_PI_SEAT_ROOT);
//   (b) the equal case (DURIAN_PI_SEAT_ROOT == persisted cwd) exits 0;
//   (c) the unset case (no DURIAN_PI_SEAT_ROOT) exits 0;
//   (d) a view-only command (status) does NOT fire the guard.
// Run: node demo/seatroot.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "durig-seatroot-"));
const db = join(dir, "rig.sqlite");
const persistedDir = join(dir, "persisted-tree");
const runRoot = join(dir, "runroot");
const rigFile = join(dir, "rig.json");
const CLI_CWD = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const rig = {
	version: 2,
	// spec.cwd is the persisted working directory for every seat that sets none.
	cwd: persistedDir,
	seats: [
		{
			name: "worker",
			role: "implementation engineer",
			capabilities: ["implement", "code"],
		},
	],
};

function runCli(args, extraEnv = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: CLI_CWD,
			env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db, ...extraEnv },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
		let stderr = "";
		child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
		child.once("exit", (code) => resolve({ code, stdout: stdout.trim(), stderr }));
	});
}

try {
	writeFileSync(rigFile, JSON.stringify(rig, null, 2));

	// Create the seats: `up` persists the seat cwd = spec.cwd (persistedDir).
	const up = await runCli(["up", rigFile]);
	assert.equal(up.code, 0, `up exited ${up.code}; stderr=${up.stderr.slice(0, 300)}`);

	// (a) MISMATCH: DURIAN_PI_SEAT_ROOT differs from the persisted cwd -> fail closed,
	// exit non-zero, and the message names BOTH paths.
	const mismatch = await runCli(["send", "worker", "do the thing"], {
		DURIG_SEAT_ROOT: runRoot,
	});
	assert.notEqual(mismatch.code, 0, `send must fail closed on a tree mismatch (got exit ${mismatch.code})`);
	const failReport = JSON.parse(mismatch.stdout);
	assert.equal(failReport.ok, false, "fail-closed returns ok:false");
	const err = String(failReport.error);
	assert.ok(err.includes(persistedDir), `message names the persisted cwd; got: ${err}`);
	assert.ok(err.includes(runRoot), `message names the DURIG_SEAT_ROOT value; got: ${err}`);
	assert.ok(/up --refresh|unset DURIG_SEAT_ROOT/.test(err), "message names the fix (up --refresh or unset)");

	// (b) EQUAL: DURIAN_PI_SEAT_ROOT == persisted cwd -> quiet, exit 0.
	const equal = await runCli(["run"], { DURIG_SEAT_ROOT: persistedDir });
	assert.equal(equal.code, 0, `run with matching DURIG_SEAT_ROOT must succeed (got exit ${equal.code}; stderr=${equal.stderr.slice(0, 200)})`);

	// (c) UNSET: no DURIAN_PI_SEAT_ROOT at all -> quiet, exit 0.
	const unset = await runCli(["run"]);
	assert.equal(unset.code, 0, `run with DURIG_SEAT_ROOT unset must succeed (got exit ${unset.code}; stderr=${unset.stderr.slice(0, 200)})`);

	// (d) VIEW-ONLY: `status` must NOT fire the guard even on a mismatch.
	const status = await runCli(["status"], { DURIG_SEAT_ROOT: runRoot });
	assert.equal(status.code, 0, `status (view-only) must not fire the guard (got exit ${status.code})`);

	console.log("SEATROOT TEST PASS (DURIG_SEAT_ROOT/persisted-cwd mismatch fails closed on send/run with both paths named; equal and unset succeed; view-only status is unaffected)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
