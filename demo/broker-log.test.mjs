// demo/broker-log.test.mjs — B4: broker writes <db>.broker.log (D46).
//
// RED BEFORE: start serve — no broker.log appears (failing-first).
// GREEN AFTER: broker.log exists and records PASS/WAKE lines.
//
// Run: node demo/broker-log.test.mjs  (exit 0 = pass)

import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { spawn } from "node:child_process";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const base = mkdtempSync(join(tmpdir(), "durig-brokerlog-"));
const dbPath = join(base, "test.db");
const rigPath = join(base, "rig.starter.json");
copyFileSync("rig.starter.json", rigPath);

const cliPath = join(process.cwd(), "cli.mjs");

try {
  console.log("\n=== B4: broker writes <db>.broker.log ===\n");

  // Start the broker with --max-duration 5 so it auto-exits
  const broker = spawn(
    process.execPath,
    [cliPath, "serve", "--max-duration", "5"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stderr = "";
  broker.stderr?.on("data", (d) => { stderr += d.toString(); });

  // Wait for the broker to run (it has --max-duration 5)
  await new Promise((resolve) => {
    broker.on("close", (code) => resolve(code));
    setTimeout(resolve, 10000);
  });

  console.log(`  broker exited with code: ${broker.exitCode ?? "N/A"}`);
  if (stderr && !stderr.includes("ENOENT")) {
    console.log(`  stderr (first 400 chars): ${stderr.slice(0, 400)}`);
  }

  // Check that broker.log was written
  const logFile = `${dbPath}.broker.log`;
  check("broker.log exists", existsSync(logFile));

  if (existsSync(logFile)) {
    const logContent = readFileSync(logFile, "utf8");
    check("broker.log has content", logContent.length > 0);
    check("broker.log has ISO timestamps", /\d{4}-\d{2}-\d{2}T/.test(logContent));

    const lines = logContent.trim().split("\n");
    console.log(`  log has ${lines.length} line(s):`);
    lines.slice(0, 10).forEach((l) => console.log(`    ${l}`));

    check("broker.log records PASS lines", /PASS \d/.test(logContent));
    // Audit (this change): the log must say WHEN the broker started and WHY it stopped,
    // so "why did the broker stop?" is answerable after the process is gone. RED here
    // before the START/EXIT lifecycle lines exist.
    check("broker.log records a START line", /START pid=\d+/.test(logContent));
    check("broker.log records an EXIT line with a reason", /EXIT pid=\d+ reason=\S+ passes=\d+/.test(logContent));
    check("EXIT reason names the max-duration bound", /EXIT pid=\d+ reason=max-duration passes=\d+/.test(logContent));
  }

  console.log(failures === 0
    ? "\nPASS — B4 broker.log verified (D46)"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err.message?.slice(0, 500));
  failures += 1;
} finally {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch (err) {
    console.warn(`cleanup: could not remove ${base}: ${err.message}`);
  }
}

process.exit(failures === 0 ? 0 : 1);
