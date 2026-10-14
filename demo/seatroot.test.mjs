// DOGFOOD F12 seat-root guard test: a seat's working directory is resolved ONCE
// at `up` time (seat.cwd ?? spec.cwd ?? DURIG_SEAT_ROOT) and persisted onto the
// conversation, so a later launch with a different DURIG_SEAT_ROOT would silently
// run against the persisted (stale/wrong) tree while looking like success. The
// guard fixes that: when DURIG_SEAT_ROOT is set and differs from a seat's persisted
// cwd, the write-side command (`send`/`run`) fails CLOSED naming both paths and the
// fix; the equal/unset case stays quiet and succeeds. View-only commands are not
// affected.
// This proves:
//   (a) the mismatch case: a write-side command exits NON-ZERO with BOTH paths in
//       the message (persisted cwd and DURIG_SEAT_ROOT);
//   (b) the equal case (DURIG_SEAT_ROOT == persisted cwd) exits 0;
//   (c) the unset case (no DURIG_SEAT_ROOT) exits 0;
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

// The persisted cwd is stored with forward slashes ("C:/..."); a node:path join on
// Windows produces backslashes ("C:\\..."). Compare normalised: separators unified
// and case-folded, exactly how the F12 guard treats two spellings of one tree.
const normRoot = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();

try {
	writeFileSync(rigFile, JSON.stringify(rig, null, 2));

	// Create the seats: `up` persists the seat cwd = spec.cwd (persistedDir).
	const up = await runCli(["up", rigFile]);
	assert.equal(up.code, 0, `up exited ${up.code}; stderr=${up.stderr.slice(0, 300)}`);

	// (a) MISMATCH: DURIG_SEAT_ROOT differs from the persisted cwd -> fail closed,
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

	// (b) EQUAL: DURIG_SEAT_ROOT == persisted cwd -> quiet, exit 0.
	const equal = await runCli(["run"], { DURIG_SEAT_ROOT: persistedDir });
	assert.equal(equal.code, 0, `run with matching DURIG_SEAT_ROOT must succeed (got exit ${equal.code}; stderr=${equal.stderr.slice(0, 200)})`);

	// (c) UNSET: no DURIG_SEAT_ROOT at all -> quiet, exit 0.
	const unset = await runCli(["run"]);
	assert.equal(unset.code, 0, `run with DURIG_SEAT_ROOT unset must succeed (got exit ${unset.code}; stderr=${unset.stderr.slice(0, 200)})`);

	// (d) VIEW-ONLY: `status` must NOT fire the guard even on a mismatch.
	const status = await runCli(["status"], { DURIG_SEAT_ROOT: runRoot });
	assert.equal(status.code, 0, `status (view-only) must not fire the guard (got exit ${status.code})`);

	// (e) SURFACE THE ROOT + MODEL (F27/#203): a user must be able to SEE which
	// worktree a seat is pointed at and which model it will use. Both are already
	// persisted on the conversation (the F12 guard above reads the cwd), but `ps`
	// and `status` never printed them. Assert both views report the persisted
	// worktree `root` and the configured `model` for every seat.
	const ps = await runCli(["ps"]);
	assert.equal(ps.code, 0, `ps exited ${ps.code}; stderr=${ps.stderr.slice(0, 300)}`);
	const psJson = JSON.parse(ps.stdout);
	const psSeat = psJson.seats.find((s) => s.name === "worker");
	assert.ok(psSeat, "ps lists the worker seat");
	assert.equal(normRoot(psSeat.root), normRoot(persistedDir), `ps reports the persisted worktree root; got ${JSON.stringify(psSeat.root)}`);
	assert.ok(psSeat.model, `ps reports the seat's configured model; got ${JSON.stringify(psSeat.model)}`);
	assert.equal(psSeat.model.provider, "faux", `ps model names the provider; got ${JSON.stringify(psSeat.model)}`);
	assert.ok(
		typeof psSeat.model.modelId === "string" && psSeat.model.modelId.length > 0,
		`ps model names the model id; got ${JSON.stringify(psSeat.model)}`,
	);

	const st = await runCli(["status"]);
	assert.equal(st.code, 0, `status exited ${st.code}; stderr=${st.stderr.slice(0, 300)}`);
	const stJson = JSON.parse(st.stdout);
	const stSeat = stJson.seats.find((s) => s.name === "worker");
	assert.ok(stSeat, "status lists the worker seat");
	assert.equal(normRoot(stSeat.root), normRoot(persistedDir), `status reports the persisted worktree root; got ${JSON.stringify(stSeat.root)}`);
	assert.ok(stSeat.model, `status reports the seat's configured model; got ${JSON.stringify(stSeat.model)}`);
	assert.equal(stSeat.model.provider, "faux", `status model names the provider; got ${JSON.stringify(stSeat.model)}`);

	console.log("SEATROOT TEST PASS (DURIG_SEAT_ROOT/persisted-cwd mismatch fails closed on send/run with both paths named; equal and unset succeed; view-only status is unaffected; ps/status surface each seat's worktree root and configured model)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
