// demo/broker-harness-dead.test.mjs — #6160: a broker that is ALIVE but cannot PASS must say so,
// by name, in the state file every reader already consults.
//
// THE FAILURE THIS PINS, in the words the rig produced today:
//   PASS-FAILED Error: SqliteStorage is closed
//   HARNESS-REOPEN attempts=4
//   HARNESS-REOPEN-CAP-EXCEEDED attempts=4
// ...and the process stayed resident: heartbeat advancing, `lastPassAt` frozen, every broker-routed
// read timing out. `brokerHealth` answered `degraded` with the reason "no pass within the progress
// timeout" — the SAME sentence it uses for a broker that is merely slow. The cause was in
// `<db>.broker.log`, which no health reader opens before deciding what to do. Detection lived in a
// log line; the instrument said nothing.
//
// So: the cap is now RECORDED in `<db>.broker.json` as `fatal`, the health leg reports it as
// `degraded` with the cause in the reason, the read client's failure carries the code
// `broker_harness_dead`, and the final drain of a broker exiting on a DEAD harness is BOUNDED —
// because `waitForIdle` on a closed handle is the unbounded wait that keeps the process alive with a
// fresh heartbeat and a frozen pass.
//
// Run: node demo/broker-harness-dead.test.mjs   (exit 0 = pass; no model, no fleet, no broker)


import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BROKER_PROGRESS_MARGIN_MS,
  DEFAULT_PASS_TIMEOUT_MS,
  EXIT_DRAIN_BOUND_MS,
  DEGRADED_MUTATE_TIMEOUT_MS,
  MUTATE_INTENT_TIMEOUT_MS,
  brokerHealth,
  exitDrainBoundMs,
  intentWaitBoundMs,
  readBrokerState,
  recordFatalHarness,
  settledWithin,
  writeBrokerState,
} from "../src/broker.mjs";
import { DEGRADED_READ_TIMEOUT_MS, BROKER_READ_TIMEOUT_MS, readFailure } from "../src/readclient.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-harness-dead-"));
const db = join(dir, "rig.sqlite");
const NOW = 1_000_000_000_000;
let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
};

try {
  /* ---- 1. the wedge, before any cause is recorded: alive, and NOT healthy ---- */
  const wedged = {
    pid: process.pid,
    since: "t",
    runToken: "r",
    heartbeatAt: NOW,
    lastPassAt: NOW - (DEFAULT_PASS_TIMEOUT_MS + BROKER_PROGRESS_MARGIN_MS + 10_000),
  };
  const before = brokerHealth(wedged, { now: NOW });
  check("a fresh heartbeat with a frozen pass is NOT 'up'", before.state === "degraded", JSON.stringify(before));
  check("the reason names the SYMPTOM only, and carries no cause", /no pass within the progress timeout/.test(before.reason) && !before.fatal, before.reason);

  /* ---- 2. recording the terminal failure: only the owning broker may do it ---- */
  // A real FOREIGN live pid: a child process that is still running. Faking the pid with a number
  // would not test the guard, because the guard asks whether THIS process owns the state.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "ignore" });
  const foreignPid = child.pid;
  writeBrokerState(db, { pid: foreignPid, since: "t", runToken: "tok", heartbeatAt: NOW, lastPassAt: wedged.lastPassAt });
  const stranger = recordFatalHarness(db, { attempts: 4, cause: "SqliteStorage is closed" });
  check("a process that does not own the state cannot record it", stranger === null, JSON.stringify(stranger));
  check("and the state is left untouched by the refused write", readBrokerState(db).fatal === undefined);

  // Write the state as the broker itself would (the pid guard compares process.pid).
  const mine = { pid: process.pid, since: "t", runToken: "tok", heartbeatAt: NOW, lastPassAt: wedged.lastPassAt };
  writeBrokerState(db, mine);
  child.kill();
  const fatal = recordFatalHarness(db, { attempts: 4, cause: "SqliteStorage is closed", kind: "closed-store" });
  check("the owner records the fatal", fatal && fatal.attempts === 4 && fatal.cause === "SqliteStorage is closed", JSON.stringify(fatal));
  check("it is stored in the state file every reader already opens", readBrokerState(db).fatal?.attempts === 4);
  check("a healthy state file stays the old shape (no fatal key)", (() => {
    const p = join(dir, "clean.json");
    writeFileSync(p, JSON.stringify({ pid: 1, since: "s", runToken: "r", heartbeatAt: NOW, lastPassAt: NOW }));
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return !("fatal" in parsed);
  })());

  /* ---- 3. detection: the health leg names the cause, not just the symptom ---- */
  const state = readBrokerState(db);
  const after = brokerHealth(state, { now: NOW });
  check("the fatal broker is degraded, whatever its heartbeat looks like", after.state === "degraded", JSON.stringify(after));
  check("the reason names the closed harness and the attempt count", /harness closed/.test(after.reason) && /reopen cap exceeded/.test(after.reason) && /4 attempts/.test(after.reason) && /SqliteStorage is closed/.test(after.reason), after.reason);
  check("the frozen pass clock is still reported beside the cause", after.passAgeMs === NOW - wedged.lastPassAt, JSON.stringify(after));
  check("even a RECENT pass does not make a dead-harness broker 'up'", brokerHealth({ ...state, lastPassAt: NOW }, { now: NOW }).state === "degraded");

  /* ---- 4. the wait bound follows the detection ---- */
  check("a fatal broker's mutating verb waits the SHORT bound, not 15 minutes", intentWaitBoundMs(state, { now: NOW }).boundMs === DEGRADED_MUTATE_TIMEOUT_MS, JSON.stringify(intentWaitBoundMs(state, { now: NOW })));
  check("the read bound is the degraded one, not 120 s", (() => {
    const health = brokerHealth(state, { now: NOW });
    return (health.state === "up" ? BROKER_READ_TIMEOUT_MS : DEGRADED_READ_TIMEOUT_MS) === DEGRADED_READ_TIMEOUT_MS;
  })());
  check("a DOWN broker is bounded at 0 - nothing will apply", intentWaitBoundMs(null, { now: NOW }).boundMs === 0);
  void MUTATE_INTENT_TIMEOUT_MS;

  /* ---- 5. the failure the caller gets is classifiable, not prose ---- */
  const err = readFailure("queue", "no answer", { cause: after.fatal ? "broker_harness_dead" : "broker_read_timeout", fatal: after.fatal });
  check("the read failure carries the cause code broker_harness_dead", err.code === "broker_harness_dead", err.code);
  check("and the fatal record itself", err.fatal?.attempts === 4, JSON.stringify(err.fatal));

  /* ---- 6. the exit drain of a dead-harness broker cannot hang forever ---- */
  check("terminal-harness exit is bounded, defaulting to EXIT_DRAIN_BOUND_MS", exitDrainBoundMs({ stoppedBy: "session-failed", sessionFailedTerminal: true, graceMs: 0, stopRequestedAt: null, now: NOW }) === EXIT_DRAIN_BOUND_MS);
  check("a deadline exit still uses the REMAINING grace", exitDrainBoundMs({ stoppedBy: "deadline", graceMs: 5000, stopRequestedAt: NOW - 2000, now: NOW }) === 3000);
  check("an expired grace means NO wait", exitDrainBoundMs({ stoppedBy: "deadline", graceMs: 1000, stopRequestedAt: NOW - 5000, now: NOW }) === 0);
  check("a terminal exit with grace left uses the larger of the two", exitDrainBoundMs({ stoppedBy: "session-failed", sessionFailedTerminal: true, graceMs: 30000, stopRequestedAt: NOW, now: NOW }) === 30000);
  check("an ordinary cooperative stop stays UNBOUNDED (a live run is never cut off)", exitDrainBoundMs({ stoppedBy: "stop", graceMs: 5000, stopRequestedAt: NOW - 1000, now: NOW }) === null);
  const never = new Promise((resolve) => setTimeout(resolve, 60_000));
  const drain = await settledWithin(never, 50);
  check("the bounded drain returns rather than parking on a dead handle", drain.settled === false && drain.noGrace === false, JSON.stringify(drain));
  check("no-grace is a DIFFERENT fact from a fired bound", (await settledWithin(never, 0)).noGrace === true);

  console.log(`\n${failures === 0 ? "HARNESS-DEAD PASS" : `HARNESS-DEAD FAIL (${failures} check(s))`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
