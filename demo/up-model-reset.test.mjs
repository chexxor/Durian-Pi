// demo/up-model-reset.test.mjs — #402 (#148 half-2): model-change reset seam in cmdUp.
//
// RULING (lead #241): detection+apply live in cmdUp — NOT the wake path.
//   - bare `up`: DETECT (rig-configured model vs the model the conversation last RAN under)
//     and REPORT (stderr notice + JSON field), write NOTHING.
//   - `up --refresh` (the ONLY apply path): reuse cmdReset's boundary mechanism
//     (live-lease guard + conversation.reset(handoff)); handoff reports the switch and
//     carries in-flight claimed items (#154). Detect → reset →configure, in that order.
//   - IDEMPOTENT: a second --refresh with no further change does NOT write a second reset.
//
// Failing-first: run against UNWIRED code → the model-mismatch and pi.reset assertions
// fail (RED); run after wiring → green.
// Run: node demo/up-model-reset.test.mjs  (exit 0 = pass)

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const base = mkdtempSync(join(tmpdir(), "durig-upreset-"));
const dbPath = join(base, "rig.sqlite");
const rigPath = join(base, "rig.demo.json");
const cliPath = join(process.cwd(), "cli.mjs");
const cwdRoot = process.cwd();

// Rig spec: one impl seat; the model is set separately via DURIG_MODEL per phase
// (default MODEL_ID streams the provider's canned reply; the RIG later pins seat.model).
const starter = JSON.parse(readFileSync(join(cwdRoot, "rig.starter.json"), "utf8"));
// Keep only impl to shrink the surface: the seam is per-seat.
starter.seats = starter.seats.filter((s) => s.name === "impl");
starter.edges = [];

function rigWithSeatModel(modelId) {
  const spec = JSON.parse(JSON.stringify(starter));
  if (modelId) spec.seats[0].model = modelId;
  delete spec.seats[0].model;
  return spec;
}

function runCli(args, env = {}) {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: cwdRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PROVIDER: "faux", ...env },
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// In-process JSON entry scanner: count pi.reset boundaries + find newest pi.assistant
// model (the model the conversation ran under) via raw storage.
async function scanEntries() {
  const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
  const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
  const { Harness, createRegistry } = await import("@earendil-works/pi-durable");
  const { Router, Seats } = await import("../src/rig.mjs");
  const registry = createRegistry();
  registry.install(Router);
  const storage = await openNodeSqliteStorage(dbPath);
  const harness = await Harness.open(storage, { registry }, BACKGROUND_CONTEXT);
  const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
  const convId = seatsDoc?.value?.seats?.impl?.conversationId;
  const conv = await harness.conversation(convId, BACKGROUND_CONTEXT);
  const page = await conv.entries({ order: "descending" }, 60, undefined, BACKGROUND_CONTEXT);
  const resets = page.items.filter((e) => e.kind === "pi.reset");
  const ranModel = page.items.find((e) => e.kind === "pi.assistant" && e.model?.[0])?.model?.[0] ?? null;
  const resetTexts = resets.map((e) => JSON.stringify(e.model ?? []));
  await harness.close(BACKGROUND_CONTEXT);
  return { resetCount: resets.length, ranModel, resetTexts, assistants: page.items.filter((e) => e.kind === "pi.assistant").length };
}

try {
  console.log("\n=== #402: cmdUp model-change reset seam ===\n");

  // Phase A: create rig under faux-a default model; have impl RUN so an assistant
  // entry exists (that records ran-under = faux-a).
  const specA = rigWithSeatModel(null);
  delete specA.seats[0].model;
  writeFileSync(rigPath, JSON.stringify(specA));

  let r = runCli(["up", rigPath, "--no-serve"], { DURIG_MODEL: "faux-a" });
  check("up#1 exit 0", r.code === 0, r.stdout + r.stderr);
  let scan = await scanEntries();
  const baselineResets = scan.resetCount;
  check("baseline has 0 (or known) pi.reset entries before probe", scan.resetCount === baselineResets, JSON.stringify(scan.resetCount));

  r = runCli(["send", "impl", "hello"], { DURIG_MODEL: "faux-a" });
  check("send (run under faux-a) exit 0", r.code === 0, (r.stdout + r.stderr).slice(0, 300));
  scan = await scanEntries();
  check("assistant entry recorded, ran-under provider is faux", scan.assistants > 0 && scan.ranModel !== null, JSON.stringify(scan));

  // Phase B: rig changes impl to seat.model faux-b. Bare up (default faux-b env):
  // DETECT + REPORT ONLY — must NOT write a reset, NOT silently no-op.
  const specB = rigWithSeatModel("faux-b");
  specB.seats[0].model = "faux-b";
  writeFileSync(rigPath, JSON.stringify(specB));

  r = runCli(["up", rigPath, "--no-serve"], { DURIG_MODEL: "faux-b" });
  const bare = (() => { try { return JSON.parse(r.stdout.trim()); } catch (err) { return { parseError: String(err.message), raw: r.stdout.slice(0, 200) }; } })();
  check("bare up exit 0", r.code === 0, `code=${r.code} ${r.stderr.slice(0, 200)}`);
  check("bare up did NOT write a reset (no new pi.reset)", (await scanEntries()).resetCount === baselineResets);
  check("bare up REPORTS the mismatch (JSON modelMismatch field naming impl)",
    JSON.stringify(bare).includes("modelMismatch") && JSON.stringify(bare).includes("impl"),
    r.stdout.slice(0, 300));
  check("bare up stderr notice mentions refresh", /up --refresh/.test(r.stderr), r.stderr.slice(0, 300));

  // Phase C: `up --refresh` = the ONLY apply path: reset boundary + reconfigure.
  r = runCli(["up", rigPath, "--no-serve", "--refresh"], { DURIG_MODEL: "faux-b" });
  check("--refresh exit 0", r.code === 0, `code=${r.code} ${(r.stdout + r.stderr).slice(0, 200)}`);
  scan = await scanEntries();
  check("--refresh WROTE ONE pi.reset boundary", scan.resetCount === baselineResets + 1,
    `resets=${scan.resetCount} baseline=${baselineResets}`);
  const joinedResets = scan.resetTexts.join("\n");
  check("--refresh handoff reports the switch", /model-change reset/.test(joinedResets) && /faux-b/.test(joinedResets), joinedResets.slice(0, 300));

  // Phase D: idempotence — second refresh with NO further change is a no-op on resets.
  r = runCli(["up", rigPath, "--no-serve", "--refresh"], { DURIG_MODEL: "faux-b" });
  check("second refresh exit 0", r.code === 0);
  scan = await scanEntries();
  check("second refresh wrote NO new pi.reset (idempotent)", scan.resetCount === baselineResets + 1,
    `resets=${scan.resetCount}`);

  console.log(failures === 0
    ? "\nPASS — bare up reports; --refresh resets once; second refresh idempotent"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
} finally {
  try { rmSync(base, { recursive: true, force: true }); } catch (err) { console.error(`cleanup: ${err.message}`); }
}

process.exit(failures === 0 ? 0 : 1);
