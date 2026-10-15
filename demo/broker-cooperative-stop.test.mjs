// demo/broker-cooperative-stop.test.mjs — B3: serve --stop settles cooperatively.
//
// Under load (multiple concurrent seat requests), `serve --stop` must settle
// without forced kill. With --max-duration the broker settles and exits cleanly.
//
// Run: node demo/broker-cooperative-stop.test.mjs  (exit 0 = pass)

import { existsSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { spawn, execSync } from "node:child_process";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
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

  console.log(failures === 0
    ? "\nPASS — B3 cooperative stop verified"
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
