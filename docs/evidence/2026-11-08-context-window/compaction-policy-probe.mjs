#!/usr/bin/env node
// delegate probe (ROADMAP 331): what compaction policy does a SEAT actually get?
// Uses the SAME resolution path as cli.mjs (shipped defaults + durig.config.json + env), then asks
// pi-durable's OWN resolver (dist/harness/compaction.js compactionPolicy) what it resolves per model.
// Never re-derives the policy. Broker-down safe; no model spend.
// usage: node .spike/delegate/compaction-policy-probe.mjs [--rig rig.selfdev.json]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Locate the repo root from wherever this file lives, so the probe runs from .spike/, docs/evidence/ or the root.
let ROOT = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(ROOT, "src", "config.mjs")) && ROOT !== "/") ROOT = dirname(ROOT);
const { loadConfig, loadShippedDefaults, compactionSettings, declaredContextWindow } = await import(pathToFileURL(join(ROOT, "src", "config.mjs")).href);
const { DEFAULT_COMPACTION_POLICY } = await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "agent.js")).href);
const { compactionPolicy } = await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "compaction.js")).href);

const CLI_PATH = join(ROOT, "cli.mjs");
const readFile = (p, enc) => readFileSync(p, enc); // sync is fine for a probe

const shipped = await loadShippedDefaults({ readFile, anchors: [join(dirname(CLI_PATH), "durig.config.default.json")] });
const { config: CFG, source } = await loadConfig({ env: process.env, readFile, defaults: shipped.values, defaultsSource: shipped.source });

const settings = { ...compactionSettings(CFG) };
// What Harness.open stores (agent.js:47): compaction = {...DEFAULTS, ...settings?.compaction}
const stored = { compaction: { ...DEFAULT_COMPACTION_POLICY, ...settings.compaction } };

console.log(`config source: ${source}  defaults: ${shipped.source ?? "none"}`);
console.log(`DURIG_COMPACTION_MODEL_OVERRIDES = ${CFG.DURIG_COMPACTION_MODEL_OVERRIDES}`);
console.log(`compactionSettings() returns: ${JSON.stringify(settings)}`);
console.log(`settings.compaction (the ONLY key the harness reads): ${settings.compaction === undefined ? "UNDEFINED -> pi-durable defaults apply; the modelOverrides map is dropped" : JSON.stringify(settings.compaction)}`);
console.log("");

const rigPath = process.argv.find((a) => a.startsWith("--rig="))?.split("=")[1] || join(ROOT, "rig.selfdev.json");
const rig = JSON.parse(readFileSync(rigPath, "utf8"));
const seen = new Map();
for (const seat of rig.seats ?? []) {
  const model = String(seat.model ?? "");
  const [provider, modelId] = model.split("/");
  const key = `${provider}/${modelId}`;
  if (seen.has(key)) { seen.get(key).seats.push(seat.name); continue; }
  const window = declaredContextWindow(CFG, key);
  seen.set(key, { key, seats: [seat.name], window, policy: compactionPolicy(stored, { provider, modelId }) });
}
for (const { key, seats, window, policy } of seen.values()) {
  console.log(`${key}  seats: ${seats.join(",")}  declaredWindow=${window}`);
  console.log(`  resolved: enabled=${policy.enabled} reserve=${policy.reserveTokens} keepRecent=${policy.keepRecentTokens} background=${policy.backgroundTokens}`);
  if (window) {
    const threshold = window - policy.reserveTokens;
    console.log(`  compact-above=${threshold} tokens; keepRecent=${policy.keepRecentTokens} = ${(100 * policy.keepRecentTokens / threshold).toFixed(1)}% of that threshold`);
  }
}
