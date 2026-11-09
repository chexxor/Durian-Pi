// demo/broker-progress-is-a-completed-pass.test.mjs — item #5698 (re-issue of #4819)
//
// The ruling under test: `up` must be sustained by a COMPLETED pass, not by the ATTEMPT to run
// one. `brokerHealth()` already separates the two legs correctly — LIVENESS (heartbeat) vs PROGRESS
// (`lastPassAt`) — and it says "no pass has completed yet" when `lastPassAt` is null. The defect is
// in the wake loop's SEED: when the broker takes over a state file whose `lastPassAt` is not a
// number, it stamped `lastPassAt = now()` at startup. A broker that throws on every pass therefore
// carries a startup timestamp as progress and reads `up` for the whole progress bound (default
// 300 s + 60 s margin) while doing nothing.
//
// FAILING-FIRST: on the pre-fix tree section 1 fails — the state file holds the startup stamp, and
// `brokerHealth` says `up` for a broker whose only pass threw. Sections 2-4 are the controls that
// must keep passing.
//
// Hermetic: a temp directory, a stub harness, no model spend, no real store.
// Run: node demo/broker-progress-is-a-completed-pass.test.mjs  (exit 0 = pass)

import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";


import { brokerHealth, runWakeLoop, readBrokerState, writeBrokerState, DEFAULT_PASS_TIMEOUT_MS } from "../src/broker.mjs";
import { WakeScheduler } from "../src/scheduler.mjs";

// One full REAL heartbeat interval plus slack, for the fallback path on a tree whose loop cannot
// be given a short interval. That fallback is the failing-first path: on the pre-fix code it spends
// 21 s and then reports the fabricated stamp.
const FALLBACK_HEARTBEAT_MS = 21_000;

let failures = 0;
const check = (label, ok, detail = "") => {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures++;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
};

/* ─── 1. a loop whose ONLY pass threw must not claim progress ─────────────── */
console.log("\n=== 1. a broker whose pass THREW has not progressed ===");
const tmp = mkdtempSync("durig-pass-progress-");
const dbPath = join(tmp, "rig.sqlite");

// The record a broker writes when it takes ownership: identity, no completed pass yet.
writeBrokerState(dbPath, { pid: process.pid, since: Date.now() });
const seeded = readBrokerState(dbPath);
check("the ownership record starts with no completed pass", seeded.lastPassAt === null, JSON.stringify(seeded));

let attempts = 0;
const drive = (opts) =>
	runWakeLoop({
		harness: {
			// drivePass's first act is `harness.documentState(...)`; throwing there is a WHOLE-PASS
			// throw — the exact shape the ruling is about (not a per-seat wake-failure).
			documentState: async () => {
				throw new Error("stub: SqliteStorage is closed");
			},
			// The exit path drains the harness before clearing state (#2574/F1); a stub drains instantly.
			waitForIdle: async () => {},
			close: async () => {},
		},
		probeStorage: {},
		readStorage: {},
		scheduler: new WakeScheduler({ minIntervalMs: 0 }),
		signal: { wait: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 20))) },
		context: {},
		readBusySeats: () => new Set(),
		isStopping: () => false,
		wakeRetryMs: 20,
		onDiagnostic: (d) => {
			if (d.kind === "pass-failed") attempts++;
		},
		dbPath,
		...opts,
	});

// 300 ms of THROWING passes with a 20 ms heartbeat = ~15 progress writes, enough to see what the
// loop stamps as progress.
await drive({ maxDurationMs: 300, heartbeatMs: 20 });
let after = readBrokerState(dbPath);
if (after.heartbeatAt === seeded.since) {
	// No heartbeat fired in 300 ms: this tree's loop ignores `heartbeatMs`, so the progress leg can
	// only be observed over one real 20 s interval. This is the path that was RED before #5698.
	console.log("  note  this tree's wake loop does not accept an injected heartbeatMs; running one real interval");
	await drive({ maxDurationMs: FALLBACK_HEARTBEAT_MS });
	after = readBrokerState(dbPath);
}

const logPath = `${dbPath}.broker.log`;
const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
check("the loop attempted more than one pass and every one FAILED (PASS-FAILED in the log)", log.includes("PASS-FAILED") && attempts > 1, `attempts=${attempts} | ${log.trim().split("\n").slice(-2).join(" | ")}`);

console.log(`  state after the throwing passes: ${JSON.stringify(after)}`);
const health = brokerHealth(after, { now: Date.now(), streamTimeoutMs: 30_000 });
check("lastPassAt is NOT a startup stamp after a throwing pass", after.lastPassAt === null, `lastPassAt = ${after.lastPassAt}`);
check("brokerHealth says degraded, not up", health.state === "degraded", JSON.stringify(health));
check("the reason names the missing pass, not a stale one", health.reason === "no pass has completed yet", JSON.stringify(health));

/* ─── 2. control: a COMPLETED pass is progress ────────────────────────────── */
console.log("\n=== 2. control: a completed pass still reads as progress ===");
writeBrokerState(dbPath, { pid: process.pid, since: Date.now(), lastPassAt: Date.now() }); // the write the pass-completion leg makes
const completed = brokerHealth(readBrokerState(dbPath), { now: Date.now(), streamTimeoutMs: 30_000 });
check("a broker with a completed pass within the bound reads up", completed.state === "up", JSON.stringify(completed));

/* ─── 3. control: a pass that completed long ago goes stale within the bound ─ */
console.log("\n=== 3. control: the bound still bites ===");
const stale = brokerHealth(
	{ pid: process.pid, heartbeatAt: Date.now(), since: Date.now(), lastPassAt: Date.now() - DEFAULT_PASS_TIMEOUT_MS - 70_000 },
	{ now: Date.now() },
);
check("past the progress bound it is degraded", stale.state === "degraded", JSON.stringify(stale));

/* ─── 4. control: liveness alone is never enough ──────────────────────────── */
console.log("\n=== 4. control: a fresh heartbeat with no pass is not `up` ===");
check(
	"fresh heartbeat + no completed pass = degraded",
	brokerHealth({ pid: process.pid, heartbeatAt: Date.now(), since: Date.now() }, { now: Date.now() }).state === "degraded",
);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — broker progress leg, ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
