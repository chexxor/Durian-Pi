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
  // provider/modelId the way src/seatmodel.mjs:17-19 resolves it: the FIRST slash separates the
  // provider, the REST is the model id. `split("/")[1]` would read "verifier/openai/gpt-oss-120b"
  // as model "openai" and look up an override key that can never match.
  const slash = model.indexOf("/");
  const provider = slash > 0 ? model.slice(0, slash) : model;
  const modelId = slash > 0 ? model.slice(slash + 1) : model;
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

/* ---- the pin drift, named the way ROADMAP 209 names it: a capability the rig declares but never reaches ---- */
// ROADMAP 209's shape is "the launcher that exists is the wrong one for this box, so the work sits in the inbox
// unread". The compaction equivalent: `durig.config.json` carries a per-model override keyed on a model id, and
// pi-durable matches it by an EXACT `provider/modelId` string. If the key names a model the rig no longer runs,
// the schedule is declared and inert - accepted and ignored, exactly the #5071 class the config's unknown-key
// guard was written for.
console.log("== pin drift: is the override key one the harness can actually match? ==");
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const installed = JSON.parse(readFileSync(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "package.json"), "utf8"));
const lock = existsSync(join(ROOT, "package-lock.json"))
  ? JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")).packages?.["node_modules/@earendil-works/pi-durable"]?.version
  : null;
const vendor = existsSync(join(ROOT, "vendor", "pi-main", "packages", "durable", "package.json"))
  ? JSON.parse(readFileSync(join(ROOT, "vendor", "pi-main", "packages", "durable", "package.json"), "utf8")).version
  : null;
console.log(`  manifest range: ${manifest.dependencies?.["@earendil-works/pi-durable"]}  installed: ${installed.version}  lockfile: ${lock ?? "(none)"}`);
console.log(`  vendor mirror (vendor/pi-main/packages/durable): ${vendor ?? "(absent)"} - the built tree the review reads`);
console.log(`  compactionPolicy arity in the installed dist: ${compactionPolicy.length} args (settings, model) - overrides are matched by the exact "provider/modelId" key`);
const declaredKeys = Object.keys(settings.compaction?.modelOverrides ?? {});
const rigKeys = new Set();
for (const seat of rig.seats ?? []) {
  const m = String(seat.model ?? "");
  const s = m.indexOf("/");
  rigKeys.add(s > 0 ? `${m.slice(0, s)}/${m.slice(s + 1)}` : m);
}
const inert = declaredKeys.filter((k) => !rigKeys.has(k));
console.log(`  override keys declared: ${declaredKeys.join(", ")}`);
console.log(`  keys any seat can match: ${[...rigKeys].join(", ")}`);
if (inert.length) console.log(`  INERT KEYS: ${inert.join(", ")} - declared, matched by nothing. Fix: use a family key ("verifier/*"), which expands to the model the family declares (overrideKeysForFamily, src/config.mjs).`);
else console.log("  no inert keys: every declared override is matchable by at least one seat.");
// Version lag, measured 2026-11-09 on this box: `npm view @earendil-works/pi-durable version` -> 1.5.0 while the
// lockfile pins 1.3.0. The tarball of 1.5.0 was fetched and read: its `compactionPolicy(settings, model)` is
// still 2-arg and still matches `modelOverrides` by the exact "provider/modelId" key (dist/harness/compaction.js:201-203).
// So the drift is a VERSION lag, not an API change - the seam this rig uses is unchanged upstream. Re-measure with:
//   npm view @earendil-works/pi-durable version
//   npm pack @earendil-works/pi-durable@1.5.0 && grep -n "export function compactionPolicy" package/dist/harness/compaction.js
console.log("  version lag: registry 1.5.0 vs installed 1.3.0 (measured 2026-11-09); 1.5.0's compactionPolicy is still (settings, model) and still exact-key matched - the seam is unchanged, so no re-implementation is needed to upgrade.");
