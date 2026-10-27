// The 189 gate runner. Scores a model against corpus.mjs and reports a PAIRED verdict.
//
//   node tools/model-probes/gate.mjs <baseUrl> <modelId> [label] [--compare <run.json>] [--out <file>]
//
// THREE CONDITIONS per item, which is the whole point of the rewrite:
//   defect        the code carries the defect            -> a HIT is naming the mechanism
//   clean         the same code WITHOUT the defect       -> a claimed defect is a FALSE ALARM
//   clean-neutral the same clean code, prompt does not presuppose a bug -> measures INDUCED confabulation
// The old harness had only the first. D137's headline finding (a defect that cannot occur, asserted twice)
// is a false alarm, and an instrument with no clean condition cannot measure the thing it was cited for.
//
// Conditions are counterbalanced per item (odd items answer clean first) so order cannot carry the verdict.
// The prompt is byte-identical to calibrate-verifier.mjs's, so scores stay comparable with the D137 record.
//
// Scoring is DETERMINISTIC: rubric groups (need N of them) for a hit, pre-registered phantom patterns for a
// wrong mechanism, and for clean items a two-part test — did it DECLINE, or did it ASSERT a defect? The
// transcript is written out for a human to audit the scorer, because an automatic verdict nobody can audit is
// exactly the "green check lying about a property" failure this rig keeps hitting.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCorpus } from "./corpus.mjs";

const SYSTEM =
  "You are a code reviewer. Find the defect that makes this code fail at RUNTIME on Linux. Be specific about the mechanism. If you see several, list them ranked by severity.";
const LEADING =
  "What is wrong here? After thinking, give a concise answer: the single most severe runtime defect, its mechanism, and how it manifests. Under 150 words.";
// The neutral framing exists because the LEADING prompt PRESUPPOSES a defect. A model told there is one
// will find one; that is induced confabulation, not judgement, and only the neutral framing separates them.
const NEUTRAL =
  "Is there a defect here that would make this code fail at RUNTIME on Linux? It may be correct as written. If it is, say so plainly. Otherwise give the mechanism and how it manifests. Under 150 words.";

const DECLINE = [
  "no defect",
  "nothing wrong",
  "no bug",
  "looks correct",
  "is correct",
  "seems correct",
  "appears correct",
  "no runtime defect",
  "nothing that would",
  "no issue",
  "as written it is correct",
  "no actual defect",
];
// Asserting a defect at all — the raw material of a false alarm on a clean control.
const ASSERT = [
  "bug",
  "defect",
  "will throw",
  "would throw",
  "throws",
  "crash",
  "race",
  "fails",
  "breaks",
  "incorrect",
  "wrong",
  "never",
  "off by one",
  "off-by-one",
];

async function ask(baseUrl, model, code, file, userPrompt) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `File: ${file}\n\n\`\`\`js\n${code}\n\`\`\`\n\n${userPrompt}` },
    ],
    temperature: 0.2,
    // Not cosmetic: at 900 the primary spent every token on reasoning and returned an EMPTY answer with
    // finish_reason=length (D134). A thinking model with a small budget does not fail loudly, it says nothing.
    max_tokens: Number(process.env.CAL_MAX_TOKENS || 3000),
  };
  const t0 = Date.now();
  const r = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const msg = d.choices?.[0]?.message ?? {};
  return {
    text: (msg.content || "").trim(),
    reasoning: (msg.reasoning_content || msg.reasoning || "").trim(),
    finish: d.choices?.[0]?.finish_reason,
    dt: (Date.now() - t0) / 1000,
    completion: d.usage?.completion_tokens ?? null,
    prompt: d.usage?.prompt_tokens ?? null,
  };
}

// A model that reports a parse error in the excerpt is reporting MY extraction, not a defect in the code
// under test. Such a result is a corpus bug: excluded from the ranking and reported loudly (rule G1).
const ARTIFACT = [
  "unexpected end of input",
  "syntaxerror",
  "syntax error",
  "does not parse",
  "won't parse",
  "will not parse",
  "never closed",
  "is not closed",
  "incomplete function",
  "truncated",
  "cut off mid",
  "fragment of a",
];

// A review window is a fragment: it strips the module's import block and its sibling definitions. When a model
// reports a "missing import" or a `ReferenceError` it is reporting the FRAGMENT, not the file — so on a clean
// control that claim is excused rather than counted as a judgement failure, and counted separately so the
// reader sees how often my own design induced it. Registered as ROADMAP 195.
const EXCERPT_ARTIFACT = [
  "not imported",
  "never imported",
  "without importing",
  "no such import",
  "must be imported",
  "missing import",
  "as if they were globals",
  "is not defined",
  "undeclared identifier",
  "not defined in this",
  "not in scope",
  "referenceerror",
  // the synthetic header windowing adds so a mid-file fragment parses; a claim ABOUT it is my scaffolding
  "__durig_probe__",
];

function scoreDefect(item, res) {
  const hay = `${res.reasoning}\n${res.text}`.toLowerCase();
  const ans = (res.text || "").toLowerCase();
  if (!res.text && res.finish === "length") return { verdict: "TRUNCATED-EMPTY", groups: "0/0", need: item.need, phantoms: [] };
  // Rubric phrases are LITERAL substrings, never regexes: a mechanism phrase like `+ 1` crashed the first
  // version of this scorer when it was compiled as a pattern.
  const groupsHit = item.groups.filter((g) => g.some((alt) => hay.includes(alt.toLowerCase())));
  const phantoms = (item.phantoms || []).filter((p) => hay.includes(String(p).toLowerCase()));
  // An excerpt artifact ("this is truncated / this import is missing") is a CORPUS bug, not a model failure —
  // but it only excuses a turn when the model made no code-level claim at all. Measured on 2026-10-28: the
  // control model answered the M1 mutant with "`sliceToWidth` has an off-by-one (`cells + 1`)" — the exact
  // injected defect, named — and an unconditional artifact rule threw that HIT away because the same answer
  // also used the word "truncated". Dropping a correct answer is not conservatism, it is lost signal.
  const artifact = ARTIFACT.filter((a) => ans.includes(a));
  if (artifact.length && groupsHit.length === 0) {
    return { verdict: "ARTIFACT", groups: "-", need: item.need, phantoms: [], artifact };
  }
  const hit = groupsHit.length >= item.need;
  return {
    verdict: hit ? (phantoms.length ? "HIT+PHANTOM" : "HIT") : phantoms.length ? "MISS+PHANTOM" : "MISS",
    groups: `${groupsHit.length}/${item.groups.length}`,
    need: item.need,
    phantoms,
    ...(artifact.length ? { artifactMention: artifact } : {}),
  };
}

function scoreClean(item, res) {
  const hay = `${res.reasoning}\n${res.text}`.toLowerCase();
  const ans = (res.text || "").toLowerCase();
  if (!res.text && res.finish === "length") return { verdict: "TRUNCATED-EMPTY", declined: false, namedMechanism: 0, asserted: false };
  // A named mechanism group is the strongest signal: it is describing the very defect that is NOT there.
  const named = item.groups.filter((g) => g.some((alt) => hay.includes(alt.toLowerCase()))).length;
  const falseAlarm = (item.falseAlarm || []).filter((f) => ans.includes(f.toLowerCase()));
  const asserted = ASSERT.some((a) => ans.includes(a));
  const artifact = ARTIFACT.filter((a) => ans.includes(a));
  const excerpt = EXCERPT_ARTIFACT.filter((a) => ans.includes(a));
  // Same conditional as scoreDefect: excusing a control turn is only right when the model made no claim about
  // the code. "The excerpt is truncated, so nothing is wrong" is a corpus artifact; "the excerpt is truncated,
  // AND the npm argument order is wrong" on a control where the npm bug is FIXED is a false alarm.
  if ((artifact.length || excerpt.length) && !named && !falseAlarm.length && !asserted) {
    return { verdict: artifact.length ? "ARTIFACT" : "ARTIFACT-EXCERPT", declined: false, namedMechanism: 0, asserted: false };
  }
  const declined = DECLINE.some((d) => ans.includes(d));
  const verdict = declined && !asserted && !falseAlarm.length && named < 2
    ? "CLEAN-PASSED"
    : asserted || falseAlarm.length || named >= 2
      ? "FALSE-ALARM"
      : "AMBIGUOUS";
  return {
    verdict,
    declined,
    namedMechanism: named,
    asserted,
    falseAlarmPhrases: falseAlarm,
    ...(artifact.length || excerpt.length ? { artifactMention: [...artifact, ...excerpt] } : {}),
  };
}

// McNemar exact: the only test that respects the PAIRING (same items, two models).
function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const binom = (k) => {
    const c = Array.from({ length: n + 1 }, (_, i) => {
      let v = 1;
      for (let j = 1; j <= i; j++) v = (v * (n - j + 1)) / j;
      return v;
    });
    return c.reduce((s, v, i) => s + (i <= k ? v : 0), 0) / 2 ** n;
  };
  const small = Math.min(b, c);
  return Math.min(1, 2 * binom(small));
}

const [,, baseUrl, model, labelArg, ...flags] = process.argv;
if (!baseUrl || !model) {
  console.error("usage: node gate.mjs <baseUrl> <modelId> [label] [--compare run.json] [--out file]");
  process.exit(2);
}
const label = labelArg || model;
const flag = (name) => {
  const i = flags.indexOf(`--${name}`);
  return i >= 0 ? flags[i + 1] : null;
};

const { items, notes } = await buildCorpus();
console.log(`\nCORPUS: ${items.length} items (${items.filter((i) => i.kind === "mut").length} mutants with execution proofs, ${items.filter((i) => i.kind === "hist").length} from git fix history)`);
for (const n of notes) console.log(`  NOTE ${n}`);
for (const i of items) if (i.proof) console.log(`  PROOF ${i.id}: clean ${i.proof.cleanOut} != mutant ${i.proof.mutantOut}`);

const run = [];
const rescore = flag("rescore");
if (rescore) {
  // Re-score a saved transcript with the CURRENT rubric and scorer, without spending another prompt. The
  // scorer WILL change as corpus items teach it things (the `+ 1` regex crash, the excerpt-artifact rule);
  // a gate that can only be read forward cannot be audited backward.
  const prev = JSON.parse(readFileSync(rescore, "utf8"));
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const r of prev.run || []) {
    const it = byId.get(r.id);
    if (!it || r.error) {
      run.push(r);
      continue;
    }
    const ans = { text: r.answer || "", reasoning: r.reasoning || "", finish: r.finish, completion: r.completion, dt: r.dt };
    run.push({ ...r, score: r.cond === "defect" ? scoreDefect(it, ans) : scoreClean(it, ans) });
  }
  console.log(`\nRESCORE ${rescore} (label ${prev.label}, asked ${prev.at}) with the current scorer — no new prompts.`);
  for (const r of run) if (r.score) console.log(`  ${r.cond.padEnd(13)} ${r.id}: ${r.score.verdict}`);
} else {
console.log(`\n${"=".repeat(78)}\nGATE RUN: ${label} (${model}) @ ${baseUrl}\n${"=".repeat(78)}`);
for (let n = 0; n < items.length; n++) {
  const it = items[n];
  // Counterbalance: half the items answer clean first, half defect first.
  const order = n % 2 === 0 ? ["defect", "clean", "clean-neutral"] : ["clean", "defect", "clean-neutral"];
  console.log(`\n--- ${it.id} (${it.kind}, ${it.file}) ---`);
  for (const cond of order) {
    const code = cond === "defect" ? it.defectText : it.cleanText;
    const prompt = cond === "clean-neutral" ? NEUTRAL : LEADING;
    let res;
    try {
      res = await ask(baseUrl, model, code, it.file, prompt);
    } catch (e) {
      console.log(`  ${cond}: REQUEST FAILED ${e.message}`);
      run.push({ id: it.id, kind: it.kind, cond, error: e.message });
      continue;
    }
    const s = cond === "defect" ? scoreDefect(it, res) : scoreClean(it, res);
    run.push({ id: it.id, kind: it.kind, cond, score: s, finish: res.finish, dt: +res.dt.toFixed(1), completion: res.completion, prompt: res.prompt, answer: res.text, reasoning: res.reasoning });
    const tag = cond === "defect" ? `${s.verdict} groups=${s.groups} need=${s.need}${s.phantoms.length ? ` PHANTOM[${s.phantoms.join("|")}]` : ""}` : s.verdict;
    console.log(`  ${cond.padEnd(13)} ${tag}  ${res.dt.toFixed(1)}s finish=${res.finish} completion=${res.completion}`);
    console.log(`      ${res.text.replace(/\n/g, "\n      ").slice(0, 700)}`);
  }
}
}

const defects = run.filter((r) => r.cond === "defect" && r.score);
const DROP = new Set(["ARTIFACT", "TRUNCATED-EMPTY"]);
const scored = defects.filter((r) => !DROP.has(r.score.verdict));
const corpusBugs = defects.filter((r) => r.score.verdict === "ARTIFACT" || r.score.verdict === "TRUNCATED-EMPTY");
const cleanAll = run.filter((r) => r.cond === "clean" && r.score);
const clean = cleanAll.filter((r) => !DROP.has(r.score.verdict) && r.score.verdict !== "ARTIFACT-EXCERPT");
const excused = run.filter((r) => r.score?.verdict === "ARTIFACT-EXCERPT").length;
const neutralAll = run.filter((r) => r.cond === "clean-neutral" && r.score);
const neutral = neutralAll.filter((r) => !DROP.has(r.score.verdict) && r.score.verdict !== "ARTIFACT-EXCERPT");
const hits = scored.filter((r) => r.score.verdict.startsWith("HIT"));
const phantoms = defects.filter((r) => r.score.phantoms?.length);
const fa = clean.filter((r) => r.score.verdict === "FALSE-ALARM");
const passed = clean.filter((r) => r.score.verdict === "CLEAN-PASSED");
const faN = neutral.filter((r) => r.score.verdict === "FALSE-ALARM");

console.log(`\n${"=".repeat(78)}\nSUMMARY ${label}`);
console.log(`  defect items named:  ${hits.length}/${scored.length} scored (${defects.length} attempted)${phantoms.length ? `   (pre-registered PHANTOM present in ${phantoms.length})` : ""}`);
if (corpusBugs.length) console.log(`  CORPUS BUGS (rule G1 — EXCLUDED from the ranking): ${corpusBugs.map((r) => `${r.id}:${r.score.verdict}`).join(", ")}`);
if (cleanAll.length !== clean.length || neutralAll.length !== neutral.length) console.log(`  control conditions dropped as corpus bugs: ${cleanAll.length - clean.length + neutralAll.length - neutral.length}`);
console.log(`  clean, leading prompt:   FALSE-ALARM ${fa.length}/${clean.length}, CLEAN-PASSED ${passed.length}, AMBIGUOUS ${clean.length - fa.length - passed.length}`);
console.log(`  clean, neutral prompt:   FALSE-ALARM ${faN.length}/${neutral.length}`);
console.log(`  control claims EXCUSED as excerpt artifacts (ROADMAP 195, not counted as judgement failures): ${excused}`);
console.log(`  truncated (finish=length): ${run.filter((r) => r.finish === "length").length} of ${run.length} prompts`);

const cmp = flag("compare");
if (cmp) {
  const other = JSON.parse(readFileSync(cmp, "utf8"));
  const mine = new Map(scored.map((r) => [r.id, r.score.verdict.startsWith("HIT")]));
  const theirs = new Map((other.run || other).filter((r) => r.cond === "defect" && r.score && r.score.verdict !== "ARTIFACT" && r.score.verdict !== "TRUNCATED-EMPTY").map((r) => [r.id, r.score.verdict.startsWith("HIT")]));
  let b = 0;
  let c = 0;
  for (const [id, me] of mine) {
    if (!theirs.has(id)) continue;
    if (me && !theirs.get(id)) b++;
    if (!me && theirs.get(id)) c++;
  }
  const p = mcnemarExact(b, c);
  const otherFa = (other.run || other).filter((r) => r.cond === "clean" && r.score && r.score.verdict !== "ARTIFACT" && r.score.verdict !== "TRUNCATED-EMPTY").filter((r) => r.score.verdict === "FALSE-ALARM").length;
  const otherClean = (other.run || other).filter((r) => r.cond === "clean" && r.score && r.score.verdict !== "ARTIFACT" && r.score.verdict !== "TRUNCATED-EMPTY").length;
  console.log(`\n  PAIRED vs ${other.label}: i-hit-they-missed ${b}, they-hit-i-missed ${c}  ->  McNemar exact p = ${p.toFixed(3)}`);
  console.log(`  false alarms: this ${fa.length}/${clean.length} vs other ${otherFa}/${otherClean}`);
  console.log(`  NOTE a paired exact test needs >=6 one-sided discordant pairs to reach p<=0.05 at n=8. A 1-vs-0 gap is NOT evidence of a difference; it is a request for more items.`);
}

mkdirSync(resolve(".spike/gate"), { recursive: true });
const out = flag("out") || resolve(`.spike/gate/run-${label.replace(/[^\w.-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
writeFileSync(rescore ? `${out}.rescored.json` : out, JSON.stringify({ label, model, baseUrl, at: new Date().toISOString(), run }, null, 2));
console.log(`\ntranscript: ${rescore ? `${out}.rescored.json` : out}`);
