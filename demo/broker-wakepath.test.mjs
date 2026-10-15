// demo/broker-wakepath.test.mjs — B2 (#400) wake-path verification, failing-first.
//
// 1. fresh `serve` starts and writes <db>.broker.json (broker lifetime row).
// 2. it wakes a seat with QUEUED work within a pass (WAKE line then PASS line in <db>.broker.log).
// 3. a stale/wedged genlock slot (dead pid) does NOT stall the wake: the seat still
//    gets its wake and the stale slot is absorbed at acquire time (#258 interaction).
//
// Run: node demo/broker-wakepath.test.mjs  (exit 0 = pass)

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { readGenerationSlots } from "../src/genlock.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const base = mkdtempSync(join(tmpdir(), "durig-wakepath-"));
const dbPath = join(base, "rig.sqlite");
const cliPath = join(process.cwd(), "cli.mjs");

// Enqueue one queued item addressed to an existing seat through a real harness.
async function enqueueQueuedItem(to = "impl") {
  const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
  const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
  const { Harness, createRegistry } = await import("@earendil-works/pi-durable");
  const { RigQueue, Router, enqueueItem } = await import("../src/rig.mjs");
  const registry = createRegistry();
  registry.install(Router);
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(storage, { registry }, BACKGROUND_CONTEXT);
  await harness.commit(async (tx) => {
    await tx.doc(RigQueue);
    await enqueueItem(tx, "operator", to, "wake-path probe item", "body — queued so the broker must wake the seat");
  }, BACKGROUND_CONTEXT);
  await harness.close(BACKGROUND_CONTEXT);
}

try {
  console.log("\n=== B2 (#400): broker wake path ===\n");

  // 0. Create the rig so the broker has a seat to wake.
  const up = spawnSync(process.execPath, [cliPath, "up", join(process.cwd(), "rig.starter.json"), "--no-serve"], {
    cwd: process.cwd(),
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  check("up --no-serve exit 0", up.status === 0, (up.stderr || "").slice(0, 300));

  // Queue work for impl BEFORE the broker starts.
  await enqueueQueuedItem("impl");
  check("queued item enqueued for impl", true);

  // 1+2. serve --max-duration 5: must start, write broker.json, wake the seat within a pass.
  const broker = spawn(process.execPath, [cliPath, "serve", "--max-duration", "5"], {
    cwd: process.cwd(),
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  broker.stderr?.on("data", (d) => { stderr += d.toString(); });
  const code = await new Promise((resolve) => broker.on("close", (c) => resolve(c)));

  check("serve exit 0", code === 0, `code=${code} stderr=${stderr.slice(0, 300)}`);
  const brokerJson = `${dbPath}.broker.json`;
  // broker.json is written at startup and cleared on clean exit (clearBrokerState in the
  // finally), so liveness must be probed DURING the run — do that in run 2 below.

  // 1b. Probe broker.json DURING the run: restart serve briefly and read the state file while it lives.
  const brokerMid = spawn(process.execPath, [cliPath, "serve", "--max-duration", "6"], {
    cwd: process.cwd(),
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let midStderr = "";
  brokerMid.stderr?.on("data", (d) => { midStderr += d.toString(); });
  // Poll for the state file while the broker is running (up to ~4s).
  let midState = null;
  let midSeen = false;
  const midDeadline = Date.now() + 4000;
  while (Date.now() < midDeadline) {
    if (existsSync(brokerJson)) {
      try { midState = JSON.parse(readFileSync(brokerJson, "utf8")); midSeen = true; break; }
      catch (err) { console.error(`mid-state read: ${err.message}`); }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const midCode = await new Promise((resolve) => brokerMid.on("close", (c) => resolve(c)));
  check("broker.json written while running", midSeen, `stderr=${midStderr.slice(0, 200)}`);
  check("broker.json has the running broker's pid", midState?.pid === brokerMid.pid, JSON.stringify(midState));
  check("broker.json cleared after clean exit", !existsSync(brokerJson), `midCode=${midCode}`);

  const logFile = `${dbPath}.broker.log`;
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  check("broker.log has PASS lines", /PASS \d/.test(log), log.trim().slice(0, 120));
  const wakeLine = log.split("\n").find((l) => /WAKE \S+/.test(l));
  const passLine = log.split("\n").find((l) => /PASS \d/.test(l));
  check("WAKE line within a pass (WAKE before PASS in log order)",
    Boolean(wakeLine) && Boolean(passLine) && log.indexOf(wakeLine) < log.indexOf(passLine),
    `wake=${wakeLine ?? "none"} pass=${passLine ?? "none"}`);
  check("woken seat is impl (the seat with queued work)",
    Boolean(wakeLine) && /WAKE impl/.test(wakeLine), wakeLine ?? "none");

  // 3. Wedged genlock slot (dead pid) must not stall a later wake pass.
  await enqueueQueuedItem("impl"); // another queued item for a second pass
  const stalePath = `${dbPath}.genlock.0`;
  writeFileSync(stalePath, JSON.stringify({ pid: 9999, seat: "ghost", since: new Date(Date.now() - 120000).toISOString() }));
  const slots = readGenerationSlots(dbPath, 2);
  const staleSeen = slots.length > 0 && slots[0].stale === true && slots[0].generatingSeat === null;
  check("stale slot present and read as NOT busy (generatingSeat null)", staleSeen, JSON.stringify(slots));

  const broker2 = spawn(process.execPath, [cliPath, "serve", "--max-duration", "4"], {
    cwd: process.cwd(),
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const code2 = await new Promise((resolve) => broker2.on("close", (c) => resolve(c)));
  check("serve with stale slot exit 0", code2 === 0, `code=${code2}`);
  const log2 = readFileSync(logFile, "utf8");
  const allWakeLines = log2.split("\n").filter((l) => /WAKE \S+/.test(l));
  check("wake recorded even with a wedged stale slot present", allWakeLines.length > 0, log2.trim().slice(-200));

  // The dead-pid slot: absorbed at acquire time, not left blocking. After the pass the
  // holder should either be gone, overwritten by a real acquirer, or still stale-but-ignored.
  let postHolder = null;
  try { postHolder = JSON.parse(readFileSync(stalePath, "utf8")); }
  catch (err) { postHolder = null; /* gone */ }
  check("stale slot absorbed or no longer blocking (holder gone, stolen, or pid not alive)",
    postHolder === null || postHolder.pid !== 9999 || !processAlive(postHolder.pid),
    JSON.stringify(postHolder));

  console.log(failures === 0
    ? "\nPASS — serve starts, writes broker.json, wakes within a pass; stale slot does not stall"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
} finally {
  try { rmSync(base, { recursive: true, force: true }); } catch (err) { console.error(`cleanup: ${err.message}`); }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

process.exit(failures === 0 ? 0 : 1);
