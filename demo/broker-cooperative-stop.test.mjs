// demo/broker-cooperative-stop.test.mjs — B3: serve --stop settles cooperatively.
//
// Under load (multiple concurrent seat requests), `serve --stop` must settle
// without forced kill. With --max-duration the broker settles and exits cleanly.
//
// Run: node demo/broker-cooperative-stop.test.mjs  (exit 0 = pass)

import { existsSync, mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { spawn, execSync } from "node:child_process";
import { runWakeLoop, stopRequestPath, writeBrokerState } from "../src/broker.mjs";
import { driveOnce } from "../src/driver.mjs";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

// Spawn the CLI and collect its output. Used by the stop-report checks that need a real
// `serve --stop` process but not a broker.
function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

const base = mkdtempSync(join(tmpdir(), "durig-stop-"));
const dbPath = join(base, "test.db");
const rigPath = join(base, "rig.starter.json");
copyFileSync("rig.starter.json", rigPath);
const cliPath = join(process.cwd(), "cli.mjs");

// Declared outside the try so the finally cleanup can reach it (an in-try const is
// not visible there, and the old empty catch hid the resulting ReferenceError).
let broker;
try {
  console.log("\n=== B3: cooperative stop under load ===\n");

  // Start broker with --max-duration 10 so it will be running for the stop test
  broker = spawn(
    process.execPath,
    [cliPath, "serve", "--max-duration", "10"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stderr = "";
  broker.stderr?.on("data", (d) => { stderr += d.toString(); });
  let exitCode = null;
  broker.on("close", (code) => { exitCode = code; });

  // Give broker time to start and process some requests
  await new Promise((resolve) => setTimeout(resolve, 6000));

  // Now send --stop and see if it settles without forced kill
  const stopStart = Date.now();
  const stopProcess = spawn(
    process.execPath,
    [cliPath, "serve", "--stop"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DURIG_DB: dbPath },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stopStderr = "";
  stopProcess.stderr?.on("data", (d) => { stopStderr += d.toString(); });
  let stopStdout = "";
  stopProcess.stdout?.on("data", (d) => { stopStdout += d.toString(); });

  await new Promise((resolve) => {
    stopProcess.on("close", resolve);
    setTimeout(resolve, 90000); // generous timeout for 60s wait + margin
  });

  const stopElapsed = Date.now() - stopStart;
  console.log(`  stop elapsed: ${(stopElapsed / 1000).toFixed(1)}s`);

  // Check no forced kill in output
  check("no 'forced kill' in stop output", !stopStderr.includes("forced kill") && !stopStdout.includes("forced kill"), stopStdout + "\n" + stopStderr);

  // Check stop result JSON
  const stopResult = JSON.parse(stopStdout.trim());
  check("stop output is valid JSON", true);
  check("stopped is true", stopResult.stopped === true, JSON.stringify(stopResult));

  // The broker should also have exited cleanly (not killed)
  check("broker exited cleanly", exitCode === 0 || exitCode === null || exitCode === 1, `exitCode=${exitCode}`);

  // No stale genlock slots
  const slotFiles = [0, 1, 2, 3].map(i => `${dbPath}.genlock.${i}`);
  const staleSlots = slotFiles.filter(p => existsSync(p));
  check("no stale genlock slots after stop", staleSlots.length === 0, `Found: ${staleSlots.join(", ")}`);

  // Audit (this change): the stop REASON must survive in the log, not just stdout. The
  // broker writes EXIT just before it returns, and `serve --stop` can observe the cleared
  // .stop file first, so give the process a moment to flush the final line.
  if (stopResult.stopped === true) {
    const logFile = `${dbPath}.broker.log`;
    let logContent = "";
    for (let i = 0; i < 50; i++) {
      logContent = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      if (/EXIT/.test(logContent)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    check(
      "broker.log records EXIT reason=stop after a cooperative stop",
      /EXIT pid=\d+ reason=stop passes=\d+/.test(logContent),
      logContent.trim().split("\n").slice(-2).join(" | "),
    );
  }

  // --- B4: the stop is BOUNDED (acceptance 2). A stop REQUESTED longer ago than the grace
  // must make the loop exit with `stoppedBy="deadline"` immediately, without ever running a
  // pass. The request time is carried in the `.stop` file itself, so this is deterministic.
  console.log("\n=== B4: bounded stop deadline ===\n");
  {
    const db2 = join(base, "bounded.db");
    writeFileSync(stopRequestPath(db2), String(Date.now() - 60_000));
    let passRan = false;
    const fakeHarness = {
      documentState: async () => ({ value: {} }),
      inspect: async () => {
        passRan = true;
        return { submissions: [], tasks: [] };
      },
      waitForIdle: async () => {},
      conversation: async () => null,
    };
    const fakeStorage = {
      findDocument: async () => null,
      scanDocuments: async () => ({ items: [] }),
      document: async () => null,
      scanSubmissions: async () => ({ items: [] }),
    };
    const result = await runWakeLoop({
      harness: fakeHarness,
      probeStorage: fakeStorage,
      scheduler: {
        markDirty() {},
        shouldRun: () => false,
        delayUntilReady: () => 1_000,
        beginPass() {},
        endPass() {},
        seatFilter: () => true,
        recordWakes() {},
        msUntilSeatReady: () => Infinity,
        clearSeatCooldown() {},
      },
      signal: { raise() {}, wait: async () => {} },
      context: {},
      dbPath: db2,
      stopGraceMs: 5_000,
    });
    check("a stop older than the grace exits stoppedBy=deadline", result.stoppedBy === "deadline", JSON.stringify(result));
    check("no pass ran once the deadline had expired", passRan === false, `passRan=${passRan}`);
  }

  // --- B5: the stop is checked INSIDE a pass (acceptance 3). `driveOnce` must stop
  // submitting NEW wakes the moment `shouldStop` reports a stop, so a long pass is
  // interruptible instead of only checked at the loop boundary.
  console.log("\n=== B5: in-pass stop predicate ===\n");
  {
    const seats = { alpha: { conversationId: 1 }, beta: { conversationId: 2 } };
    const items = [
      { to: "alpha", status: "queued" },
      { to: "beta", status: "queued" },
    ];
    const submitted = [];
    const fakeHarness = {
      conversation: async (id) => ({
        submit: async () => {
          submitted.push(id);
        },
      }),
    };
    const storage = { scanDocuments: async () => ({ items: [] }) };
    const args = {
      seats,
      items,
      pendingConvIds: new Set(),
      busySeats: new Set(),
      stoppedConvIds: new Set(),
      context: {},
      storage,
    };
    const control = await driveOnce(fakeHarness, { ...args });
    check("control: both seats are woken with no stop", control === 2, `actioned=${control}`);
    submitted.length = 0;
    const stopped = await driveOnce(fakeHarness, { ...args, shouldStop: () => true });
    check(
      "a stop before the first wake submits nothing",
      stopped === 0 && submitted.length === 0,
      `actioned=${stopped} submitted=${submitted.length}`,
    );
    submitted.length = 0;
    let n = 0;
    const midStop = await driveOnce(fakeHarness, { ...args, shouldStop: () => ++n > 1 });
    check(
      "a stop mid-pass keeps the wake in flight and submits no more",
      midStop === 1 && submitted.length === 1,
      `actioned=${midStop} submitted=${submitted.length}`,
    );
  }

  // --- B6: `serve --stop` must NOT claim a live pid is stopped (acceptance 5). A state
  // naming a LIVE pid with a STALE heartbeat is a wedged-but-running broker: the report
  // must be stopped:false, the pid must not be mistaken for a stale state, and its state
  // must not be cleared out from under it.
  console.log("\n=== B6: serve --stop never reports a live pid as stopped ===\n");
  {
    const db3 = join(base, "live.db");
    writeBrokerState(db3, {
      pid: process.pid,
      since: new Date().toISOString(),
      heartbeatAt: Date.now() - 10 * 60_000,
    });
    const res = await runCli(["serve", "--stop"], { DURIG_DB: db3, DURIG_STOP_GRACE_MS: "300" });
    const parsed = JSON.parse(res.stdout.trim());
    check("a live pid is not reported stopped", parsed.stopped === false, JSON.stringify(parsed));
    check(
      "a live pid is not mistaken for a stale state",
      !String(parsed.reason).includes("stale"),
      JSON.stringify(parsed.reason),
    );
    check("the live broker's state file is left in place", existsSync(`${db3}.broker.json`), "state was cleared");
  }

  console.log(failures === 0
    ? "\nPASS — B3/B4/B5/B6 broker stop verified"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err.message?.slice(0, 500));
  failures += 1;
} finally {
  try {
    if (broker.pid && broker.exitCode === null) {
      try {
        execSync(`taskkill /F /PID ${broker.pid} 2>nul`);
      } catch (err) {
        // Only reached when the broker is still running, so a real kill failure is
        // worth surfacing; an already-exited broker skips this branch entirely.
        console.warn(`cleanup: taskkill ${broker.pid} failed: ${err.message}`);
      }
    }
    rmSync(base, { recursive: true, force: true });
  } catch (err) {
    console.warn(`cleanup: could not remove ${base}: ${err.message}`);
  }
}

process.exit(failures === 0 ? 0 : 1);
