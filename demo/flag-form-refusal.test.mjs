// THE DEFECT THIS PINS (measured 2026-11-16, host Linux, Fedora Linux 45 (Forty Five), kernel
// `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host read in the SAME command as the numbers below).
// `tools/queue-pressure.mjs` was fixed for this on its own legs (SELFDEV pitfall 426), and the same four-line
// option reader — `const i = argv.indexOf(`--${name}`)` — still lives in nine other tools/ members. This demo
// turns that census (a grep shape) into BEHAVIOUR, one bounded spawn per leg, measured on this rig:
//
//   node tools/queue-drain-audit.mjs --json=/tmp/x.json    exit 0, 303 ms, stdout 650 B, `.err` 321 B — NO file written
//   node tools/queue-drain-audit.mjs --json /tmp/x.json    exit 0, 301 ms — 649 B written
//   node tools/channel-preflight.mjs --zzz=1               exit 0, 730 ms — a full 9,476 B report, no refusal
//
// So `--json=<path>` asks a space-only reader for nothing: the run prints the SAME report, the SAME exit code and
// comparable `.err` bytes as an honoured run, and writes NOTHING — a plan built from "the JSON I asked for" is
// built from nothing (pitfall 405's read side). An option nobody knows is the same shape: a silent drop of a
// default, and the report looks identical either way.
//
// THE CONTRACT, pinned for the whole tools/ plane from ONE derivation (tools/argv-contract.mjs):
//   1. `--name value` and `--name=value` are ONE option: both spellings write the report the reader asked for,
//      and the exit code is the tool's VERDICT under either spelling (asserted form-EQUAL, not as a fixed
//      number, so a tool's own verdict may be 0, 1 or 2 and the leg still means the same thing);
//   2. an option this tool does not take REFUSES **by name**, with `REFUSED cause:` and the tool's own option list;
//   3. a FLAG given a value (`--json=1` where `--json` is a bool, `--include-notices=true`) REFUSES — the tool
//      does not invent a truthiness;
//   4. an option given NO value, an EMPTY `--name=`, and a non-number where a number was asked for all REFUSE;
//   5. a refusal exits **2**, never 1 — on these instruments exit 1 already means "measured FAIL", and a reader
//      who cannot tell a typo from a measurement cannot tell a green from a red.
//
// WHY THIS IS CHEAP (the mocked plane, per D213): every leg that must read a store points `--db` at a HERMETIC
// fixture store this demo builds (a few seeded rows, `DURIG_EXTENSIONS: ""` so no live extension rule runs, no
// broker, no network, no key), so each full tool run is 0.3-1.1 s rather than the 4.5-9.9 s the live 7,742-row
// store costs (measured pair: channel-preflight 4.51 s live vs 0.79 s fixture, queue-drain-audit 1.26 s live vs
// 0.33 s fixture). Every refusal leg costs ~0.03 s: the parser runs BEFORE the tool does any work, which is
// exactly why a refusal cannot half-measure.
//
// WHAT THIS DEMO DOES NOT CLAIM, said here rather than silently:
//   - `tools/claim-order.mjs` is OUT. Its argv surface is not a plain option list (`--seat impl` and
//     `--seat=impl=priority_first` are one token carrying its own payload) and `demo/claim-order-measure.test.mjs`
//     IMPORTS the module, so that file is not just a CLI. Its `--json` write path IS defective
//     (measured: `--json=<path>` exits 0 in 7.06 s and writes nothing) — an owed leg, not a silent pass.
//   - `tools/pointer-sha-coverage.mjs` and `tools/registration-ledger-gap.mjs` are OUT because neither has a
//     SILENT default to close: both already refuse the form they do not read (measured: coverage `--base=8b5a19e1`
//     → exit 2 naming the option; reg-gap `--json <path>` honours the space form and writes 399 B). What they
//     disagree on is the refusal exit code (2 vs 4), a decision for the operator, not a defect closed here.
//
// Run: node demo/flag-form-refusal.test.mjs          (exit 0 = pass)
// Cost: see the Cost line below, re-measured at the tree that carries the fix.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { enqueueItem, Router } from "../src/rig.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-flag-form-"));

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label} -- ${String(detail).slice(0, 400)}`);
}

const run = (entry, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });


// ---------- the hermetic fixture the tools read (no broker, no network, no key) ----------
const SPEC = {
  version: 2,
  seats: [
    { name: "pm", role: "Coordinator", capabilities: ["route"], model: "faux/model-a" },
    { name: "impl", role: "Implementer (author)", capabilities: ["implement"], model: "faux/model-a" },
  ],
  edges: [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }],
  constitutionInline: "# Team culture\n\nGround every claim in a retrieved passage.\n",
  ownership: { "src-tools-harness": ["impl"], verification: ["impl"] },
};
const rigPath = join(dir, "fixture.rig.json");
writeFileSync(rigPath, JSON.stringify(SPEC));
const fixtureConfig = join(dir, "durig.config.json");
writeFileSync(fixtureConfig, JSON.stringify({ DURIG_EXTENSIONS: "" }));
const db = join(dir, "store.sqlite");

const up = await run("cli.mjs", ["up", rigPath], { DURIG_DB: db, DURIG_CONFIG: fixtureConfig, DURIG_CONTEXT_WINDOW: JSON.stringify({ "faux/model-a": 65536 }) });
check("`up` built the fixture store these tools will read", up.code === 0, `${up.code} ${up.stderr}`);

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = await openNodeSqliteStorage(db);
const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
await harness.commit(async (tx) => {
  for (let i = 0; i < 8; i += 1) await enqueueItem(tx, "pm", "impl", `flag-form row ${i}`, "src/widget.mjs");
}, BACKGROUND_CONTEXT);
await storage.close(BACKGROUND_CONTEXT);

// `tools/harness-usage-census.mjs` reads `.jsonl` transcripts, not the store: give it a one-call fixture.
const sessDir = join(dir, "sessions");
mkdirSync(sessDir, { recursive: true });
writeFileSync(join(sessDir, "2026-11-16T00-00-session-a.jsonl"), JSON.stringify({
  message: { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "node tools/queue-pressure.mjs" } }] },
}) + "\n");

const BASE = {
  "channel-preflight": ["--db", db, "--rig", rigPath],
  "queue-drain-audit": ["--db", db],
  "store-behaviour-gate": [],
  "tier-token-calibration": ["--db", db],
  "latency-budget": ["--db", db],
  "harness-usage-census": [sessDir],
};
const tool = (name, args) => run(`tools/${name}.mjs`, [...BASE[name], ...args], { DURIG_DB: db, DURIG_CONFIG: fixtureConfig });
const refused = (r) => r.code === 2 && /REFUSED cause:/.test(r.stderr);
const namesOpt = (r, opt) => /unknown option --/.test(r.stderr) && new RegExp(`--${opt}(\\b|=)`).test(r.stderr);
const escape_ = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function parseOf(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
const keys = (j) => Object.keys(j ?? {}).sort().join(",");

console.log("\n=== an option nobody takes REFUSES, by name, at exit 2 (never a silent default) ===");
for (const name of Object.keys(BASE)) {
  const eq = await tool(name, ["--zzz=1"]);
  check(`${name}: --zzz=1 REFUSES instead of running the default`, namesOpt(eq, "zzz") && eq.code === 2, `${eq.code} ${eq.stdout.slice(0, 120)} ${eq.stderr.slice(0, 200)}`);
  const bare = await tool(name, ["--zzz"]);
  check(`${name}: a bare --zzz REFUSES too (same unknown name, other spelling)`, namesOpt(bare, "zzz") && bare.code === 2, `${bare.code} ${bare.stderr.slice(0, 200)}`);
}

console.log("\n=== an option given no value, an empty `=`, or a non-number REFUSES ===");
for (const [name, extra] of [["channel-preflight", "--recent"], ["queue-drain-audit", "--floor"], ["store-behaviour-gate", "--target"], ["tier-token-calibration", "--db"], ["latency-budget", "--top"], ["harness-usage-census", "--tools"]]) {
  const r = await tool(name, [extra]);
  check(`${name}: ${extra} with NO value REFUSES instead of taking a default`, refused(r) && new RegExp(`${escape_(extra)}`).test(r.stderr), `${r.code} ${r.stderr.slice(0, 240)}`);
}
for (const [name, num] of [["channel-preflight", "recent"], ["queue-drain-audit", "floor"], ["latency-budget", "top"], ["harness-usage-census", "top"]]) {
  const r = await tool(name, [`--${num}=abc`]);
  check(`${name}: --${num}=abc REFUSES instead of arithmetic on NaN`, r.code === 2 && /abc/.test(r.stderr), `${r.code} ${r.stderr.slice(0, 240)}`);
}

console.log("\n=== a FLAG given a value REFUSES; the bare flag is still accepted ===");
for (const [name, bool] of [["store-behaviour-gate", "allow-existing"], ["tier-token-calibration", "include-notices"], ["latency-budget", "json"], ["harness-usage-census", "sessions"]]) {
  const bad = await tool(name, [`--${bool}=true`]);
  check(`${name}: --${bool}=true REFUSES (a flag has no truthiness)`, bad.code === 2 && new RegExp(`--${bool}(\\b|=)`).test(bad.stderr) && /REFUSED/.test(bad.stderr), `${bad.code} ${bad.stderr.slice(0, 240)}`);
}

console.log("\n=== `--json=` with no path REFUSES instead of printing a report and writing nothing ===");
for (const name of ["channel-preflight", "queue-drain-audit", "store-behaviour-gate", "tier-token-calibration"]) {
  const r = await tool(name, ["--json="]);
  check(`${name}: --json= REFUSES`, r.code === 2 && /REFUSED/.test(r.stderr) && /--json/.test(r.stderr), `${r.code} ${r.stderr.slice(0, 240)}`);
}

console.log("\n=== the two spellings are ONE option: same verdict, and BOTH write the report asked for ===");
const WRITERS = { "channel-preflight": [], "queue-drain-audit": ["--floor", "5"], "store-behaviour-gate": ["--verbs", "status,queue,ps,show"], "tier-token-calibration": [] };
for (const [name, extra] of Object.entries(WRITERS)) {
  const eqPath = join(dir, `${name}-eq.json`);
  const spPath = join(dir, `${name}-sp.json`);
  const eq = await tool(name, [...extra, `--json=${eqPath}`]);
  const sp = await tool(name, [...extra, "--json", spPath]);
  const eqBytes = existsSync(eqPath) ? statSync(eqPath).size : 0;
  const spBytes = existsSync(spPath) ? statSync(spPath).size : 0;
  check(`${name}: \`--json=<path>\` WRITES a file (a space-only reader left it absent)`, eqBytes > 0, `eq ${eqBytes}B sp ${spBytes}B`);
  check(`${name}: ...and the OLD spelling still writes (the fix did not eat it)`, spBytes > 0, `sp ${spBytes}B`);
  const eqJson = parseOf(eqPath);
  const spJson = parseOf(spPath);
  check(`${name}: both files PARSE as the report the reader asked for`, eqJson !== null && spJson !== null, `${eqJson === null}/${spJson === null}`);
  check(`${name}: the exit code is the VERDICT under either spelling (form-invariant)`, eq.code === sp.code, `${eq.code}/${sp.code}`);
  check(`${name}: the two spellings report the SAME top-level keys (one option, one derivation)`, eqJson !== null && spJson !== null && keys(eqJson) === keys(spJson), `${keys(eqJson)} vs ${keys(spJson)}`);
}

console.log("\n=== the old spellings still MEAN the same thing where they are the whole point ===");
const censusEq = await tool("harness-usage-census", ["--top=3"]);
const censusSp = await tool("harness-usage-census", ["--top", "3"]);
check("harness-usage-census: positionals are still taken, and `--top=3`/`--top 3` print the SAME report", censusEq.stdout === censusSp.stdout && censusEq.code === censusSp.code && censusEq.stdout.length > 0, `${censusEq.code}/${censusSp.code} ${censusEq.stdout.length}B/${censusSp.stdout.length}B`);
// The leg is ACCEPTANCE, not a report: `tools/latency-budget.mjs` has its own pre-existing defect, unrelated to
// flags — a store with no `pi.generation` entries leaves its span bounds infinite and it dies `RangeError: Invalid
// time value` at tools/latency-budget.mjs:211 (measured both here and standalone on a seeded-but-entry-less
// fixture, exit 1, `.err` 566 B). Naming it here keeps a crash from reading as a pass OR as a flag failure; the
// crash itself is an owed row, not something this change closes.
const latJson = await tool("latency-budget", ["--json"]);
check("latency-budget: the `--json` BOOL is still ACCEPTED (a bool is not a file option)", latJson.code !== 2 && !/REFUSED cause:/.test(latJson.stderr), `${latJson.code} ${latJson.stderr.slice(0, 200)}`);
const tierBare = await tool("tier-token-calibration", ["--include-notices"]);
const tierPlain = await tool("tier-token-calibration", []);
check("tier-token-calibration: the bare `--include-notices` flag is still accepted (same verdict)", tierBare.code === tierPlain.code && !/REFUSED/.test(tierBare.stderr), `${tierBare.code}/${tierPlain.code} ${tierBare.stderr.slice(0, 200)}`);

console.log(failures === 0 ? `\nFLAG FORM TEST PASS (0 failures)` : `\nFLAG FORM TEST FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
