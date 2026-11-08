#!/usr/bin/env node
// MILESTONE GATE — "does a seat's task fit inside its context window?" (D226 / ROADMAP 331)
// One command, no model spend, broker-down safe. Exit 0 = the milestone is met; exit 1 = it is not, with the reason.
// usage: node docs/evidence/2026-11-08-context-window/milestone-check.mjs [--db ./selfdev.sqlite]
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  const split = db.prepare("select conversation_id, sum(record like ?) cap, sum(record like ?) trunc from tasks where kind=? group by 1 order by (cap+trunc) desc limit 6").all("%spend_cap_exceeded%", "%hit the token limit%", '"pi.compaction"');
  console.log("  by conversation (cap refusals | truncations):");
  for (const s of split) console.log(`    conv ${s.conversation_id}: ${s.cap} | ${s.trunc}`);
  const localTrunc = split.filter((s) => s.trunc > 0 && s.cap === 0).reduce((a, s) => a + s.trunc, 0);
  if (localTrunc > 0) failures.push(`${localTrunc} truncations on seats with no cap refusals — their summary ceiling (0.8 x reserveTokens) is the binding constraint, not the budget.`);
  console.log(`  truncations: ${truncAll.n} lifetime, first ${new Date(truncAll.mn).toISOString()}, last ${new Date(truncAll.mx).toISOString()}; ${trunc24} in the last 24 h`);
  console.log(`  cap refusals: ${capAll.n} lifetime, first ${new Date(capAll.mn).toISOString()}, last ${new Date(capAll.mx).toISOString()}; ${cap24} in the last 24 h`);
  if (trunc24 > 0) failures.push(`${trunc24} truncated summaries in the last 24 h — the window/policy mismatch is still live, not historical.`);
  db.close();
} else {
  console.log(`  no store at ${DB} — skipped (pass --db)`);
}

/* ---- and the other blocker: a seat whose turn SHAPE is refused before any window is reached ---- */
console.log("== run-cap headroom for the summariser (the budget that starves compaction) ==");
try {
  const defaults = JSON.parse(readFileSync(join(ROOT, "durig.config.default.json"), "utf8"));
  const capRun = Number(cfg.resolveConfig?.()?.DURIG_SPEND_CAP_RUN_USD ?? defaults.DURIG_SPEND_CAP_RUN_USD);
  const logPath = `${DB}.broker.log`;
  const lines = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n") : [];
  const start = lines.filter((l) => l.includes(" START pid=")).pop();
  const ledgerPath = join(ROOT, "selfdev.sqlite.spend.jsonl");
  if (start && existsSync(ledgerPath)) {
    const at = start.slice(0, 24);
    const rows = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const spent = rows.filter((r) => r.at >= at).reduce((a, r) => a + (r.usd || 0), 0);
    const costs = rows.filter((r) => r.model === "openai/gpt-oss-120b").slice(-50).map((r) => r.usd || 0).filter((v) => v > 0);
    const mean = costs.length ? costs.reduce((a, v) => a + v, 0) / costs.length : 0.001384;
    const headroom = Math.max(0, Math.floor((capRun - spent) / mean));
    console.log(`  broker process since ${start.trim()}: spent $${spent.toFixed(6)} of the $${capRun} run cap; mean verifier call $${mean.toFixed(6)}`);
    console.log(`  summariser calls this process can still afford before EVERY compaction is refused: ~${headroom} (optimistic, at mean call cost)`);
    // conservative: use the actual projected summariser cost recorded in the refusal messages
    let proj = [];
    if (existsSync(DB)) {
      const s = new DatabaseSync(DB, { readOnly: true });
      proj = s.prepare("select record from tasks where kind=? and record like ? order by id desc limit 20").all('"pi.compaction"', "%spend_cap_exceeded%").map((r) => Number(/projects \$([0-9.]+)/.exec(r.record)?.[1] ?? 0)).filter((v) => v > 0);
      s.close();
    }
    if (proj.length) {
      const worst = Math.max(...proj);
      console.log(`  conservative: refusals projected summariser calls at $${Math.min(...proj).toFixed(6)}–$${worst.toFixed(6)}; at $${worst.toFixed(6)} this process has ~${Math.max(0, Math.floor((capRun - spent) / worst))} compactions left before every one is refused`);
    }
    if (capRun - spent < mean * 5) failures.push("the resident broker is within 5 summariser calls of its run cap: compaction will be refused before any seat finishes its task.");
  } else {
    console.log("  no spend ledger or START line — headroom unmeasurable");
  }
} catch (e) { console.log(`  headroom probe failed: ${e.message}`); }

console.log("== turn shape (tools/seat-turn-shape.mjs, read-only) ==");
try {
  const out = execFileSync(process.execPath, ["tools/seat-turn-shape.mjs", "--db", DB], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] });
  const seats = out.split("\n").filter((l) => l.startsWith("seat "));
  const risk = [];
  // pair each seat line with the "next send:" line that follows it
  const lines = out.split("\n");
  let current = null;
  for (const l of lines) {
    if (l.startsWith("seat ")) current = l.trim();
    if (l.includes("next send:") && current) {
      const v = l.split("next send:")[1].trim();
      if (v.startsWith("AT RISK")) risk.push(current.split("  ")[0]);
      current = null;
    }
  }
  console.log(`  ${risk.length} of ${seats.length} seats cannot be spoken to right now: ${risk.join(", ") || "none"}`);
  if (risk.length > 0) failures.push(`${risk.length} seats are AT RISK on turn shape — a strict alternating template refuses a user turn before any window limit, so no window sizing can make them complete work.`);
} catch (e) {
  console.log(`  shape probe failed: ${e.message}`);
  failures.push("the shape instrument could not run, so the fleet's ability to be woken is unverified.");
}

console.log("");
if (failures.length === 0) {
  console.log("PASS — the override reaches the harness and every declared window can hold its policy.");
  process.exit(0);
}
console.log(`FAIL (${failures.length}) —`);
for (const f of failures) console.log("  · " + f);
process.exit(1);
