// .verify-331-probe.mjs — item #5310: what policy actually resolves per family on the MERGED tree.
// Reads the shipped defaults merged under durig.config.json, builds what Harness.open receives,
// then asks pi-durable's own resolver what wins. No model spend, no broker.
import { readFileSync } from "node:fs";
import { compactionSettings, declaredContextWindow, overrideKeysForFamily, loadConfig, loadShippedDefaults } from "./src/config.mjs";
import { pathToFileURL } from "node:url";
const agentMod = await import(pathToFileURL("node_modules/@earendil-works/pi-durable/dist/harness/agent.js").href);
const { DEFAULT_COMPACTION_POLICY, resolveSettings } = agentMod;

const defaults = JSON.parse(readFileSync("durig.config.default.json","utf8"));
const rigFile = JSON.parse(readFileSync(process.argv[2] ?? "durig.config.json","utf8"));
const merged = { ...defaults, ...rigFile };
const settings = compactionSettings(merged);
console.log("A. what durian-pi SENDS to Harness.open:", JSON.stringify(settings));
const resolved = resolveSettings({ ...settings }).compaction;
console.log("B. what pi-durable 1.3.0 RESOLVES (single harness-wide object):", JSON.stringify(resolved));
console.log("C. DEFAULT_COMPACTION_POLICY =", JSON.stringify(DEFAULT_COMPACTION_POLICY));
const compactionMod = await import(pathToFileURL("node_modules/@earendil-works/pi-durable/dist/harness/compaction.js").href);
console.log("D. compactionPolicy exported by the pin?", typeof compactionMod.compactionPolicy === "function");

const families = [
  { label: "verifier", key: `verifier/${merged.DURIG_VERIFIER_MODEL}`, window: Number(merged.DURIG_VERIFIER_CONTEXT), maxTokens: Number(merged.DURIG_VERIFIER_MAX_TOKENS) },
  { label: "local", key: `local/${merged.DURIG_LOCAL_MODEL}`, window: Number(merged.DURIG_LOCAL_CONTEXT), maxTokens: Number(merged.DURIG_LOCAL_MAX_TOKENS ?? 16384) },
];
console.log("\nE. per-family arithmetic (blocking = window - reserve; background = blocking - background; floor = keep + min(floor(0.8*reserve), maxTokens))");
for (const f of families) {
  const cfg = settings.compaction?.modelOverrides?.[f.key] ?? {};
  // ACTUAL: pi-durable 1.3.0 resolves ONE flat policy from settings.compaction; generation.js:226-228
  // reads policy.reserveTokens/keepRecentTokens/backgroundTokens. modelOverrides is never consulted.
  const actual = { reserveTokens: resolved.reserveTokens, keepRecentTokens: resolved.keepRecentTokens, backgroundTokens: resolved.backgroundTokens };
  // INTENDED: what the config would mean IF the nested map were read (it is not, on this pin).
  const intended = { reserveTokens: cfg.reserveTokens ?? resolved.reserveTokens, keepRecentTokens: cfg.keepRecentTokens ?? resolved.keepRecentTokens, backgroundTokens: cfg.backgroundTokens ?? resolved.backgroundTokens };
  const band = (p) => {
    const blocking = f.window - p.reserveTokens;
    const background = blocking - p.backgroundTokens;
    const floor = p.keepRecentTokens + Math.min(Math.floor(0.8 * p.reserveTokens), f.maxTokens);
    return { blocking, background, floor };
  };
  const A = band(actual), I = band(intended);
  console.log(`\n  ${f.label} ${f.key} window=${f.window} maxTokens=${f.maxTokens}`);
  console.log(`    configured-by-operator : ${JSON.stringify(cfg)}`);
  console.log(`    ACTUALLY resolved      : ${JSON.stringify(actual)}  blocking=${A.blocking} background=${A.background} floor=${A.floor}`);
  console.log(`    if the map were read   : ${JSON.stringify(intended)}  blocking=${I.blocking} background=${I.background} floor=${I.floor}`);
  const line = (label, x) => console.log(`    ${label}  ACTUAL: ${x(A)}   |  INTENDED: ${x(I)}`);
  console.log(`    a. reserve >= declared maxTokens?  ACTUAL: ${actual.reserveTokens >= f.maxTokens} (${actual.reserveTokens} vs ${f.maxTokens})  |  INTENDED: ${intended.reserveTokens >= f.maxTokens} (${intended.reserveTokens} vs ${f.maxTokens})`);
  console.log(`    b. post-cut floor <= window?       ACTUAL: ${A.floor <= f.window} (${A.floor} = ${((A.floor / f.window) * 100).toFixed(1)}%)  |  INTENDED: ${I.floor <= f.window} (${I.floor} = ${((I.floor / f.window) * 100).toFixed(1)}%)`);
  console.log(`    c. background threshold > 0?       ACTUAL: ${A.background > 0} (${A.background})  |  INTENDED: ${I.background > 0} (${I.background})`);
  console.log(`    d. blocking <= 0 (never fires)?    ACTUAL: ${A.blocking <= 0} (${A.blocking})  |  INTENDED: ${I.blocking <= 0} (${I.blocking})`);
  console.log(`    declaredContextWindow("${f.key}") -> ${declaredContextWindow(merged, f.key)} (harness window is ${f.window})`);
  console.log(`    overrideKeysForFamily("${f.label}/*") -> ${JSON.stringify(overrideKeysForFamily(`${f.label}/*`, merged))}`);
}
