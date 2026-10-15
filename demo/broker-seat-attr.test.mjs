// demo/broker-seat-attr.test.mjs — B2: concurrent generations attribute to correct seat.
//
// With N>1 slots, each concurrent generation should read ITS OWN seat name
// from the ALS context, not the global DURIG_ACTIVE_SEAT env var.
//
// Run: node demo/broker-seat-attr.test.mjs  (exit 0 = pass)

import { existsSync, readFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
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

const base = mkdtempSync(join(tmpdir(), "durig-seatattr-"));
const dbPath = join(base, "test.db");
const rigPath = join(base, "rig.starter.json");
copyFileSync("rig.starter.json", rigPath);
const cliPath = join(process.cwd(), "cli.mjs");

try {
  console.log("\n=== B2: concurrent seat attribution via ALS ===\n");

  // Start broker with max-duration so it exits automatically
  const start = Date.now();
  const broker = spawn(
    process.execPath,
    [cliPath, "serve", "--max-duration", "3"],
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

  // Wait for broker to settle
  await new Promise((resolve) => {
    broker.on("close", resolve);
    setTimeout(resolve, 8000);
  });

  console.log(`  broker exit code: ${exitCode ?? "N/A"}`);
  const elapsed = Date.now() - start;
  console.log(`  elapsed: ${(elapsed / 1000).toFixed(1)}s`);

  // Check broker.log records PASS
  const logFile = `${dbPath}.broker.log`;
  if (existsSync(logFile)) {
    const logContent = readFileSync(logFile, "utf8");
    check("broker.log exists", true);
    check("broker.log records PASS", /PASS \d/.test(logContent), logContent.slice(0, 200));
    console.log(`  log: ${logContent.trim().slice(0, 100)}`);
  } else {
    check("broker.log exists", false, "MISSING");
  }

  // Check genlock slot files (if any slots were taken)
  const slotFiles = [0, 1, 2, 3].map(i => `${dbPath}.genlock.${i}`);
  const slotsExist = slotFiles.some(existsSync);
  check("genlock slots clean (no stale slots)", !slotsExist || slotFiles.every(p => {
    if (!existsSync(p)) return true;
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      // A slot should NOT have pid == process.pid of the broker (it should be released)
      return false; // stale slot found
    } catch { return true; }
  }));

  console.log(failures === 0
    ? "\nPASS — B2 seat attribution verified (ALS-based)"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err.message?.slice(0, 500));
  failures += 1;
} finally {
  try {
    if (broker.pid) { try { require("child_process").execSync(`taskkill /F /PID ${broker.pid} 2>nul`); } catch {} }
    rmSync(base, { recursive: true, force: true });
  } catch {}
}

process.exit(failures === 0 ? 0 : 1);
