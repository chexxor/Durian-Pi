#!/usr/bin/env node
// MILESTONE GATE — "does a seat's task fit inside its context window?" (D226 / ROADMAP 331)
// One command, no model spend, broker-down safe. Exit 0 = the milestone is met; exit 1 = it is not, with the reason.
// usage: node docs/evidence/2026-11-08-context-window/milestone-check.mjs [--db ./selfdev.sqlite]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let ROOT = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(ROOT, "src", "config.mjs")) && ROOT !== "/") ROOT = dirname(ROOT);
const cfg = await import(pathToFileURL(join(ROOT, "src", "config.mjs")).href);
const dur = await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "agent.js")).href);
const comp = await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "compaction.js")).href);

const { DatabaseSync } = await import("node:sqlite");
const DB = process.argv.find((a) => a.startsWith("--db"))?.split("=")[1] || process.env.DURIG_DB || join(ROOT, "selfdev.sqlite");

const readFile = (p, e) => readFileSync(p, e);
const shipped = await cfg.loadShippedDefaults({ readFile, anchors: [join(ROOT, "durig.config.default.json")] });
const { config, source } = await cfg.loadConfig({ env: process.env, readFile, defaults: shipped.values, defaultsSource: shipped.source });
const settings = cfg.compactionSettings(config);

const failures = [];
const seen = new Set();
console.log("== ROADMAP 331: does the configured override reach the harness? ==");
console.log(`  config source: ${source}`);
console.log(`  compactionSettings() -> ${JSON.stringify(settings)}`);
if (settings.compaction === undefined) {
  failures.push("DURIG_COMPACTION_MODEL_OVERRIDES is emitted as `modelOverrides`, a sibling of the `compaction` key the harness reads; settings.compaction is undefined, so pi-durable's defaults apply.");
}
const stored = { compaction: { ...dur.DEFAULT_COMPACTION_POLICY, ...settings.compaction } };
const rigPath = join(ROOT, "rig.selfdev.json");
const rig = JSON.parse(readFileSync(rigPath, "utf8"));
const windows = {};
for (const seat of rig.seats ?? []) {
  const [provider, modelId] = String(seat.model ?? "").split("/");
  const key = `${provider}/${modelId}`;
  windows[key] = cfg.declaredContextWindow(config, key) ?? windows[key];
  const p = comp.compactionPolicy(stored, { provider, modelId });
  console.log(`  ${key}: reserve=${p.reserveTokens} keepRecent=${p.keepRecentTokens} enabled=${p.enabled}`);
  if (key === "local/qwen3.8-flash-next-q2_0" && p.reserveTokens !== 20480 && !seen.has(key)) {
    seen.add(key);
    failures.push(`local family resolves reserve=${p.reserveTokens}, the config asks for 20480 — the override is being dropped.`);
  }
}

console.log("== per-window feasibility ==");
for (const [key, w] of Object.entries(windows)) {
  const family = key.startsWith("verifier/") ? "VERIFIER" : "LOCAL";
  const declared = w ?? Number(config[`DURIG_${family}_CONTEXT`] ?? 0);
  if (!declared) { console.log(`  ${key}: window not declared — cannot check`); continue; }
  const p = comp.compactionPolicy(stored, { provider: key.split("/")[0], modelId: key.split("/").slice(1).join("/") });
  const headroom = declared - p.reserveTokens;
  const pct = (100 * p.keepRecentTokens / headroom).toFixed(0);
  console.log(`  ${key}: window=${declared} headroom=${headroom} keepRecent=${p.keepRecentTokens} = ${pct}% of headroom`);
  if (p.keepRecentTokens > headroom) failures.push(`${key}: keepRecentTokens (${p.keepRecentTokens}) exceeds the headroom of a ${declared}-token window (${headroom}); any compaction attempt on this seat is guaranteed to truncate.`);
}

console.log("== observed failures in the store ==");
if (existsSync(DB)) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const total = db.prepare("select count(*) n from tasks where kind=?").get('"pi.compaction"').n;
  const failed = db.prepare("select count(*) n from tasks where kind=? and json_extract(record,'$.state.outcome.status')='failed'").get('"pi.compaction"').n;
  const trunc = db.prepare("select count(*) n from tasks where kind=? and record like ?").get('"pi.compaction"', "%hit the token limit%").n;
  const cap = db.prepare("select count(*) n from tasks where kind=? and record like ?").get('"pi.compaction"', "%spend_cap_exceeded%").n;
  console.log(`  pi.compaction rows: ${total}; failed ${failed}; truncated summaries ${trunc}; refused by the run cap ${cap}`);
  if (trunc > 0) failures.push(`${trunc} compaction attempts produced an incomplete summary — the window is too small for the policy.`);
  if (cap > 0) failures.push(`${cap} compaction attempts were refused by DURIG_SPEND_CAP_RUN_USD before any request was sent — the summariser is starved by the rig's own budget.`);
  const since = Date.now() - 60 * 60000;
  const now = db.prepare("select count(*) n from tasks where kind=? and json_extract(record,'$.startedAt')>=?").get('"pi.compaction"', since).n;
  const nowFail = db.prepare("select count(*) n from tasks where kind=? and json_extract(record,'$.startedAt')>=? and record like ?").get('"pi.compaction"', since, "%hit the token limit%").n;
  console.log(`  last 60 min: ${now} compactions, ${nowFail} truncated`);
  const day = Date.now() - 24 * 3600000;
  const age = (pat) => db.prepare("select count(*) n, min(json_extract(record,'$.startedAt')) mn, max(json_extract(record,'$.startedAt')) mx from tasks where kind=? and record like ?").get('"pi.compaction"', pat);
  const truncAll = age("%hit the token limit%");
  const capAll = age("%spend_cap_exceeded%");
  const trunc24 = db.prepare("select count(*) n from tasks where kind=? and record like ? and json_extract(record,'$.startedAt')>=?").get('"pi.compaction"', "%hit the token limit%", day).n;
  const cap24 = db.prepare("select count(*) n from tasks where kind=? and record like ? and json_extract(record,'$.startedAt')>=?").get('"pi.compaction"', "%spend_cap_exceeded%", day).n;
  console.log(`  truncations: ${truncAll.n} lifetime, first ${new Date(truncAll.mn).toISOString()}, last ${new Date(truncAll.mx).toISOString()}; ${trunc24} in the last 24 h`);
  console.log(`  cap refusals: ${capAll.n} lifetime, first ${new Date(capAll.mn).toISOString()}, last ${new Date(capAll.mx).toISOString()}; ${cap24} in the last 24 h`);
  if (trunc24 > 0) failures.push(`${trunc24} truncated summaries in the last 24 h — the window/policy mismatch is still live, not historical.`);
  db.close();
} else {
  console.log(`  no store at ${DB} — skipped (pass --db)`);
}

console.log("");
if (failures.length === 0) {
  console.log("PASS — the override reaches the harness and every declared window can hold its policy.");
  process.exit(0);
}
console.log(`FAIL (${failures.length}) —`);
for (const f of failures) console.log("  · " + f);
process.exit(1);
