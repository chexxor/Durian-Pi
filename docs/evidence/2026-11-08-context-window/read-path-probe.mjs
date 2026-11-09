#!/usr/bin/env node
/*
 * Is the fleet's read path actually answering? (delegate probe, read-only, no model spend)

  node docs/evidence/2026-11-08-context-window/read-path-probe.mjs [--n=6] [--timeout=20]

WHY THIS EXISTS. `src/readclient.mjs:106-111` routes every read to the broker when one is
alive: `if (brokerAliveFor(dbPath)) return await readViaBroker(...)`. When the broker's pass
loop is stalled, the read verb blocks instead of failing — an unbounded wait that looks like an
empty queue. Measured 2026-11-08T22:07Z: 8 concurrent `cli.mjs queue --json` reads each returned
exit 124 with 0 bytes; a single read did the same. A direct read-only sqlite query in the same
minute answered normally. The instrument that hangs is indistinguishable from the state it is
supposed to report, so the rig needs a bounded probe that says "unreadable" rather than nothing.

It reports three things side by side so the cause is visible in one output: broker residency and
last pass, CLI read latency with a cap, and the direct-store read that always works.
*/
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const db = process.env.DURIG_DB ?? "./selfdev.sqlite";
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const N = arg("n", 6);
const cap = arg("timeout", 20) * 1000;

function cliRead(args) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, ["cli.mjs", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    const timer = setTimeout(() => { p.kill(); resolve({ ms: Date.now() - started, bytes: out.length, status: "HUNG (killed at cap)" }); }, cap);
    p.on("close", (code) => { clearTimeout(timer); resolve({ ms: Date.now() - started, bytes: out.length, status: code === 0 ? "ok" : `exit ${code}` }); });
  });
}

console.log("== broker residency ==");
try {
  const st = spawn(process.execPath, ["tools/broker-serve.mjs", "--status"], { stdio: ["ignore", "pipe", "ignore"] });
  let s = "";
  st.stdout.on("data", (c) => (s += c));
  st.on("close", () => {
    const line = s.split("\n").find((l) => l.includes("broker:"));
    const spool = s.split("\n").find((l) => l.includes("spool:"));
    console.log("  " + (line ?? "  no broker line in preflight output"));
    console.log("  " + (spool ?? ""));
  });
} catch (e) { console.log("  preflight failed:", e.message); }

console.log(`== CLI reads through the broker (n=${N}, capped at ${cap / 1000}s) ==`);
for (let i = 0; i < N; i++) {
  const r = await cliRead(["queue", "--status", "queued", "--json", "--no-body"]);
  console.log(`  read ${i + 1}: ${r.ms} ms, ${r.bytes} bytes, ${r.status}`);
}

console.log("== direct read of the store (always available, read-only) ==");
const store = new DatabaseSync(db, { readOnly: true });
const queued = store.prepare("select count(*) n from tasks").get().n;
const log = (await import("node:fs")).readFileSync(`${db}.broker.log`, "utf8").split("\n");
const lastPass = log.filter((l) => l.includes(" PASS ")).pop() ?? "no PASS line";
const passFails = log.filter((l) => l.includes("PASS-FAILED")).length;
console.log(`  last pass: ${lastPass.trim()}`);
console.log(`  PASS-FAILED entries in the log: ${passFails}`);
console.log(`  tasks in store: ${queued}`);
console.log("  verdict:", N > 0 ? "compare the two: a hung CLI read with a working store read means the read path, not the data, is the problem." : "");
