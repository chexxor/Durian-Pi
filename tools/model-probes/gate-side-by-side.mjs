// Side-by-side read-out of gate transcripts, so an ARM comparison (fragment vs whole-module, ROADMAP 195) and
// a MODEL comparison are computed the same way, on the SAME items, and can be re-run by any clone.
//
//   node tools/model-probes/gate-side-by-side.mjs <run.json> <run.json> [...]
//
// The first four transcripts are the four cells of the 2026-10-28 experiment
// (control/candidate x fragment/whole-module); extra transcripts are printed as additional columns.
// Everything is paired on items BOTH runs actually showed: a whole-module arm has a smaller denominator BY
// DESIGN (items whose module does not fit the context are skipped loudly), so an unintersected comparison
// would be comparing different item sets and calling the difference a model difference.
import { readFileSync } from "node:fs";

const FILES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (FILES.length < 2) {
  console.error("usage: node gate-side-by-side.mjs <run.json> <run.json> [...]");
  process.exit(2);
}
const runs = FILES.map((f) => {
  const d = JSON.parse(readFileSync(f, "utf8"));
  const items = new Map();
  for (const r of d.run) if (r.score) items.set(r.id, { ...(items.get(r.id) || {}), [r.cond]: r.score.verdict });
  for (const s of d.skipped || []) items.set(s.id, { skipped: s.why });
  return { f, label: d.label, mode: d.mode || "fragment", material: d.material || "answer+reasoning (unrecorded)", skipped: d.skipped || [], items, raw: d.run };
});

const ids = [...new Set(runs.flatMap((r) => [...r.items.keys()]))];
const pad = (s, n) => String(s).padEnd(n);
const verdict = (r, id, cond) => (r.items.has(id) ? (r.items.get(id)[cond] ?? (r.items.get(id).skipped ? "SKIP" : "-")) : "not-run");

for (const cond of ["defect", "clean", "clean-neutral"]) {
  console.log(`\n${cond.toUpperCase()} — per item`);
  console.log(`  ${pad("item", 34)} ${runs.map((r) => pad(`${r.label}/${r.mode}`, 26)).join(" ")}`);
  for (const id of ids) console.log(`  ${pad(id, 34)} ${runs.map((r) => pad(verdict(r, id, cond), 26)).join(" ")}`);
}

function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const binom = (k) => {
    const C = Array.from({ length: n + 1 }, (_, i) => {
      let x = 1;
      for (let j = 1; j <= i; j++) x = (x * (n - j + 1)) / j;
      return x;
    });
    return C.reduce((s, x, i) => s + (i <= k ? x : 0), 0) / 2 ** n;
  };
  return Math.min(1, 2 * binom(Math.min(b, c)));
}
const isHit = (x) => (x ?? "").startsWith("HIT");
const isFa = (x) => x === "FALSE-ALARM";

function paired(A, B, cond, pred) {
  const shared = ids.filter((id) => A.items.has(id) && B.items.has(id) && !A.items.get(id).skipped && !B.items.get(id).skipped);
  let b = 0;
  let c = 0;
  const flips = [];
  for (const id of shared) {
    const x = pred(A.items.get(id)[cond]);
    const y = pred(B.items.get(id)[cond]);
    if (x && !y) b++;
    if (!x && y) c++;
    if (x !== y) flips.push(`${id}: ${A.items.get(id)[cond]} -> ${B.items.get(id)[cond]}`);
  }
  return {
    n: shared.length,
    a: shared.filter((id) => pred(A.items.get(id)[cond])).length,
    bb: shared.filter((id) => pred(B.items.get(id)[cond])).length,
    b,
    c,
    p: mcnemarExact(b, c),
    flips,
  };
}

const idx = new Map(runs.map((r, i) => [`${r.label}/${r.mode}`, i]));
// Explicit pairs beat the default all-vs-all, so an ARM comparison (same model, two feedings) can be named:
//   PAIRS='[["control: fragment vs whole",0,1]]' node tools/model-probes/gate-side-by-side.mjs ... --pairs
const pairs = process.argv.includes("--pairs")
  ? JSON.parse(process.env.PAIRS || "[]")
  : runs.flatMap((A, i) => runs.slice(i + 1).map((B, j) => [`${A.label} vs ${B.label}`, i, i + j + 1]));
console.log(`\nPAIRED — exact McNemar on items BOTH runs showed. Positive b = the FIRST run wins the cell.`);
for (const [name, ia, ib] of pairs) {
  if (runs[ia] === undefined || runs[ib] === undefined) {
    console.log(`  bad pair index: ${name} (${ia},${ib}) — available: ${[...idx.keys()].join(", ")}`);
    continue;
  }
  for (const [condLabel, cond, pred] of [
    ["defect hits", "defect", isHit],
    ["false alarms (leading)", "clean", isFa],
    ["false alarms (neutral)", "clean-neutral", isFa],
  ]) {
    const r = paired(runs[ia], runs[ib], cond, pred);
    console.log(`  ${pad(`${name} :: ${condLabel}`, 62)} n=${String(r.n).padStart(2)}  ${r.a} vs ${r.bb}  discordant ${r.b}/${r.c}  p=${r.p.toFixed(3)}`);
    if (r.flips.length) console.log(`      ${r.flips.join("; ")}`);
  }
}

console.log(`\nMEASURED PROMPT TOKENS per transcript (max per item) — the real cost of the material shown`);
for (const r of runs) {
  const byId = new Map();
  for (const x of r.raw) if (x.prompt) byId.set(x.id, Math.max(byId.get(x.id) || 0, x.prompt));
  console.log(`  ${r.label}/${r.mode}: ${[...byId].map(([k, t]) => `${k.split("-")[0]}=${t}`).join(" ")}`);
}
for (const r of runs) if (r.skipped.length) console.log(`  ${r.label}/${r.mode} SKIPPED: ${r.skipped.map((s) => `${s.id} (${s.why})`).join("; ")}`);
