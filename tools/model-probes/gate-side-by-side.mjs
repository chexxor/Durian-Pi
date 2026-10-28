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
  // A --replicate transcript holds k rows per cell PLUS a `rep: "majority"` row, and the majority row is the one
  // that SCORES (ROADMAP 198). Taking "the last row" instead would compare replicate 3 of one run against the
  // majority cell of another and call the difference a model or arm difference.
  const cellRows = new Map();
  for (const r of d.run) {
    if (!r.score || r.rep === "majority") continue;
    const key = `${r.id}|${r.cond}`;
    if (!cellRows.has(key)) cellRows.set(key, []);
    cellRows.get(key).push(r);
  }
  // Which row SCORES a cell, in order of preference, and the choice is PRINTED because a comparison that
  // silently takes "the last replicate" of a k-run is the 198 defect wearing a new hat.
  const majorityBy = new Map((d.majority || []).map((r) => [`${r.id}|${r.cond}`, r]));
  const classBy = new Map((d.cells || []).map((c) => [`${c.id}|${c.cond}`, c]));
  const items = new Map();
  let source = "single-pass";
  for (const key of new Set([...cellRows.keys(), ...majorityBy.keys(), ...classBy.keys()])) {
    const [id, cond] = key.split("|");
    const rows = cellRows.get(key) || [];
    const maj = majorityBy.get(key);
    const cls = classBy.get(key);
    let cell;
    if (maj) {
      cell = { verdict: maj.score.verdict, reps: maj.reps || rows.map((r) => r.score.verdict) };
      source = "majority row (persisted)";
    } else if (cls) {
      cell = { verdict: cls.cell, reps: cls.verdicts };
      source = `majority class from the transcript's cell table (agreement ${cls.agreement})`;
    } else {
      cell = { verdict: rows[rows.length - 1].score.verdict, reps: rows.map((r) => r.score.verdict) };
    }
    if (!items.has(id)) items.set(id, {});
    items.get(id)[cond] = cell;
  }
  for (const s of d.skipped || []) items.set(s.id, { skipped: s.why });
  return {
    f,
    label: d.label,
    mode: d.mode || "fragment",
    material: d.material || "answer+reasoning (unrecorded)",
    pairPolicy: d.pairPolicy || "strip-clean-only (transcript predates the pair-policy field)",
    reps: d.reps || 1,
    cellSource: source,
    complete: d.complete !== false,
    skipped: d.skipped || [],
    cells: d.cells || [],
    items,
    raw: d.run,
  };
});

const ids = [...new Set(runs.flatMap((r) => [...r.items.keys()]))];
const pad = (s, n) => String(s).padEnd(n);
const verdict = (r, id, cond) => {
  if (!r.items.has(id)) return "not-run";
  const cell = r.items.get(id);
  if (cell.skipped) return "SKIP";
  return cell[cond]?.verdict ?? "-";
};

console.log(`\nTRANSCRIPTS`);
for (const r of runs) console.log(`  ${pad(r.label, 26)} ${pad(r.mode, 9)} material=${pad(r.material, 22)} pair-comments=${pad(r.pairPolicy, 14)} replicates=${r.reps}${r.cells.length ? `   cells=${r.cells.length}` : ""}  scored from: ${r.cellSource}${r.complete ? "" : "   IN-COMPLETE (written mid-run)"}`);

// ROADMAP 198: an arm comparison is only honest if the reader knows how much of each side REPLICATED.
for (const r of runs) {
  if (!r.cells.length) continue;
  const byCond = new Map();
  for (const c of r.cells) {
    if (!byCond.has(c.cond)) byCond.set(c.cond, { unanimous: 0, total: 0, unstable: 0 });
    const s = byCond.get(c.cond);
    s.total++;
    if (c.agreement === `${c.k}/${c.k}`) s.unanimous++;
    if (c.cell === "UNSTABLE") s.unstable++;
  }
  console.log(`  REPLICATION ${r.label}/${r.mode} (k=${r.reps}): ${[...byCond].map(([c, s]) => `${c} unanimous ${s.unanimous}/${s.total}${s.unstable ? ` UNSTABLE ${s.unstable}` : ""}`).join("   ")}`);
}

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
const isHit = (x) => ((x?.verdict ?? x) ?? "").startsWith("HIT");
const isFa = (x) => (x?.verdict ?? x) === "FALSE-ALARM";

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
    if (x !== y) flips.push(`${id}: ${A.items.get(id)[cond]?.verdict ?? A.items.get(id)[cond]} -> ${B.items.get(id)[cond]?.verdict ?? B.items.get(id)[cond]}`);
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
