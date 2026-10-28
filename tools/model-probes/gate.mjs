// The 189 gate runner. Scores a model against corpus.mjs and reports a PAIRED verdict.
//
//   node tools/model-probes/gate.mjs <baseUrl> <modelId> [label] [--compare <run.json>] [--out <file>]
//        [--whole-module] [--budget <estTokens>] [--probe] [--material answer|answer+reasoning]
//        [--pair-comments strip-both|keep-both|strip-clean-only] [--replicate k] [--plan]
//
// ROADMAP 198 — a verdict from ONE pass is a sample, not a measurement. Measured on 2026-10-28: the same model,
// the same 8 items, the same scorer and the same declared material reproduced its AGGREGATE exactly (3/8 twice)
// while flipping **4 of 8 per-item verdicts** (exact McNemar 2/2 discordant, p = 1.000) — and the gap the earlier
// routing decision (D137) was asked to rank on, 4/8 vs 3/8, is the same size as that movement. So `--replicate k`
// runs the whole matrix k times (rotating which condition is answered first, so a rep cannot carry an order
// effect), reports each cell's verdicts across reps, prints the **per-cell replication rate**, and scores the
// **majority-of-k cell** — a cell is only scored if a strict majority of its reps agree, otherwise it is
// UNSTABLE and named. Aggregates are printed per rep AND on the majority cells, and the G2 floor is reported
// under the majority run AND under the worst replicate, because "the control found 4 of 8" is only usable for
// calibration if it survives being run again.
//
// TWO FEEDINGS, and the difference between them is a measured question, not a style choice (ROADMAP 195):
// the default shows a WINDOW around the defect; `--whole-module` shows the ENTIRE module and loudly SKIPS any
// item whose whole module does not fit the endpoint's context. A window strips the import block and the
// sibling declarations, so a model that reports "`resolve` is not imported" is telling the truth about MY
// excerpt — and any false-alarm rate measured on windows is inflated by construction.
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

async function ask(baseUrl, model, code, file, userPrompt, maxTokens = Number(process.env.CAL_MAX_TOKENS || 3000)) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `File: ${file}\n\n\`\`\`js\n${code}\n\`\`\`\n\n${userPrompt}` },
    ],
    temperature: 0.2,
    // Not cosmetic: at 900 the primary spent every token on reasoning and returned an EMPTY answer with
    // finish_reason=length (D134). A thinking model with a small budget does not fail loudly, it says nothing.
    max_tokens: maxTokens,
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

/**
 * What a turn is SCORED ON is a declared setting, not whatever the endpoint happened to return (ROADMAP 197).
 * The primary's endpoint returns `reasoning_content`; LM Studio returns none for `ministral-3-14b-reasoning`
 * (D137), so "score whatever came back" scored the control on twice the material the candidate had — and two
 * of the control's five historical HITs named the mechanism only in its trace (H2 3/3 -> 0/3, H5 3/3 -> 1/3).
 */
function materialOf(res, material) {
  const ans = (res.text || "").toLowerCase();
  return { ans, hay: material === "answer" ? ans : `${res.reasoning}\n${res.text}`.toLowerCase() };
}

function scoreDefect(item, res, { material = "answer+reasoning", whole = false } = {}) {
  const { ans, hay } = materialOf(res, material);
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

function scoreClean(item, res, { material = "answer+reasoning", whole = false } = {}) {
  const { ans, hay } = materialOf(res, material);
  if (!res.text && res.finish === "length") return { verdict: "TRUNCATED-EMPTY", declined: false, namedMechanism: 0, asserted: false };
  // A named mechanism group is the strongest signal: it is describing the very defect that is NOT there.
  const named = item.groups.filter((g) => g.some((alt) => hay.includes(alt.toLowerCase()))).length;
  const falseAlarm = (item.falseAlarm || []).filter((f) => ans.includes(f.toLowerCase()));
  const asserted = ASSERT.some((a) => ans.includes(a));
  const artifact = ARTIFACT.filter((a) => ans.includes(a));
  const excerpt = EXCERPT_ARTIFACT.filter((a) => ans.includes(a));
  // THE 195 POINT: an absent-binding claim is only excusable when there IS an excerpt to blame. Show the whole
  // module and the import block is on the page, so "`resolve` is not imported" is either a real defect in a
  // file that has one, or a hallucination — never my scaffolding. It is then counted, not excused.
  const excusable = whole ? [] : excerpt;
  // Same conditional as scoreDefect: excusing a control turn is only right when the model made no claim about
  // the code. "The excerpt is truncated, so nothing is wrong" is a corpus artifact; "the excerpt is truncated,
  // AND the npm argument order is wrong" on a control where the npm bug is FIXED is a false alarm.
  if ((artifact.length || excusable.length) && !named && !falseAlarm.length && !asserted) {
    return {
      verdict: artifact.length ? "ARTIFACT" : "ARTIFACT-EXCERPT",
      declined: false,
      namedMechanism: 0,
      asserted: false,
      absentBindingClaims: excerpt,
      artifactMention: artifact,
    };
  }
  const declined = DECLINE.some((d) => ans.includes(d));
  // In whole-module mode an absent-binding claim IS an assertion about the code shown, so it moves the verdict
  // instead of excusing the turn — including against a turn that also said "no defect", because a verifier
  // that declares clean code clean while hallucinating a missing binding is not a verifier to trust.
  const assertedNow = asserted || (whole && excerpt.length > 0);
  const verdict = declined && !assertedNow && !falseAlarm.length && named < 2
    ? "CLEAN-PASSED"
    : assertedNow || falseAlarm.length || named >= 2
      ? "FALSE-ALARM"
      : "AMBIGUOUS";
  return {
    verdict,
    declined,
    namedMechanism: named,
    asserted,
    falseAlarmPhrases: falseAlarm,
    ...(excerpt.length ? { absentBindingClaims: excerpt } : {}),
    ...(artifact.length ? { artifactMention: artifact } : {}),
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
  console.error("usage: node gate.mjs <baseUrl> <modelId> [label] [--compare run.json] [--out file] [--whole-module] [--budget N] [--probe] [--material answer|answer+reasoning] [--plan]");
  process.exit(2);
}
const label = labelArg || model;
const flag = (name) => {
  const i = flags.indexOf(`--${name}`);
  return i >= 0 ? flags[i + 1] : null;
};
// HOW THE MODEL IS FED and what it is scored on are now PART OF THE RUN RECORD, because both moved the answer
// on 2026-10-28: fragment vs whole controls, and reasoning-trace vs answer-only, each changed the verdict.
const MODE = flags.includes("--whole-module") ? "whole" : "fragment";
const BUDGET = Number(flag("budget") || process.env.CAL_TOKEN_BUDGET || 10000);
const MATERIAL = flag("material") || process.env.CAL_MATERIAL || "answer+reasoning";
const PROBE = flags.includes("--probe");
// ROADMAP 199: whether COMMENTS stay in a pair, and on which side. corpus.mjs reads this at import time, so the
// flag is applied to the environment before the module is imported (a static import would freeze the default).
if (flag("pair-comments")) process.env.CAL_PAIR_COMMENTS = flag("pair-comments");
const PAIR_POLICY = process.env.CAL_PAIR_COMMENTS || "strip-both";
// ROADMAP 198: replicates. k = 1 is allowed (it is what every published table so far is) but it is labelled a
// sample in the run record, because that labelling is the thing that was missing.
const REPS = Number(flag("replicate") || process.env.CAL_REPLICATES || 1);
const OPTS = { material: MATERIAL, whole: MODE === "whole" };
if (!["answer", "answer+reasoning"].includes(MATERIAL)) {
  console.error(`--material must be 'answer' or 'answer+reasoning', got '${MATERIAL}'`);
  process.exit(2);
}
if (!Number.isFinite(BUDGET) || BUDGET <= 0) {
  console.error(`--budget must be a positive token estimate, got '${BUDGET}'`);
  process.exit(2);
}
if (!Number.isInteger(REPS) || REPS < 1) {
  console.error(`--replicate must be a positive integer, got '${REPS}'`);
  process.exit(2);
}

const { buildCorpus } = await import("./corpus.mjs");

const { items, notes } = await buildCorpus();
console.log(`\nCORPUS: ${items.length} items (${items.filter((i) => i.kind === "mut").length} mutants with execution proofs, ${items.filter((i) => i.kind === "hist").length} from git fix history)`);
for (const n of notes) console.log(`  NOTE ${n}`);
for (const i of items) if (i.proof) console.log(`  PROOF ${i.id}: clean ${i.proof.cleanOut} != mutant ${i.proof.mutantOut}`);

// The fit table, printed BEFORE any prompt is spent, so "which items are whole-module" is a checkable
// decision rather than something the run quietly did.
function planTable() {
  console.log(`\nFEEDING: ${MODE === "whole" ? `WHOLE MODULE (budget ${BUDGET} est. tokens)` : "FRAGMENT window"}   scoring material: ${MATERIAL}`);
  console.log(`  ${"item".padEnd(34)} ${"file".padEnd(22)} ${"frag~tok".padStart(8)} ${"whole~tok".padStart(9)}  decision`);
  for (const it of items) {
    const frag = it.fragment?.defectTokens ?? "-";
    if (!it.whole) {
      console.log(`  ${it.id.padEnd(34)} ${it.file.padEnd(22)} ${String(frag).padStart(8)} ${"n/a".padStart(9)}  NO whole-module text (see NOTE)`);
      continue;
    }
    const fits = it.whole.estTokens <= BUDGET;
    console.log(
      `  ${it.id.padEnd(34)} ${it.file.padEnd(22)} ${String(frag).padStart(8)} ${String(it.whole.estTokens).padStart(9)}  ${fits ? "whole module" : `SKIP: whole module ~${it.whole.estTokens} tok > budget ${BUDGET}`}`,
    );
  }
}
planTable();

// ROADMAP 199 — the accounting that was missing. A "matched pair" is matched only if BOTH sides were treated
// the same way about comments; the 2026-10-28 runs stripped the clean side and kept the defect side, which shed
// 17.7-68.8% of the clean side's bytes. Printed per view, per item, with the comment share each side carries
// and the leak `keep-both` would put into a control, so the policy is a measured choice.
function pairTable() {
  console.log(`\nMATCHED-PAIR ACCOUNTING (199) — policy: ${PAIR_POLICY}${PAIR_POLICY === "strip-both" ? "  (symmetric: the pair differs by the defect and nothing else)" : PAIR_POLICY === "keep-both" ? "  (symmetric: both sides authentic — see the leak lines below)" : "  (ASYMMETRIC — the 2026-10-28 configuration, kept reproducible)"}`);
  console.log(`  ${"item".padEnd(34)} ${"view".padEnd(9)} ${"defect ch".padStart(9)} ${"clean ch".padStart(9)} ${"delta".padStart(8)} ${"d%".padStart(7)} ${"shown def".padStart(10)} ${"shown cln".padStart(10)} ${"cmt% def".padStart(9)} ${"cmt% cln".padStart(9)}`);
  for (const it of items) {
    for (const [view, a] of [["fragment", it.fragment?.pair], ["whole", it.whole?.pair]]) {
      if (!a) continue;
      console.log(
        `  ${it.id.padEnd(34)} ${view.padEnd(9)} ${String(a.defectChars).padStart(9)} ${String(a.cleanChars).padStart(9)} ${String(a.delta).padStart(8)} ${`${a.deltaPct}%`.padStart(7)} ${String(a.shownDefectChars).padStart(10)} ${String(a.shownCleanChars).padStart(10)} ${`${a.defectCommentShare}%`.padStart(9)} ${`${a.cleanCommentShare}%`.padStart(9)}`,
      );
    }
    const leak = it.whole?.leak || [];
    console.log(
      `  ${"".padEnd(34)} the whole-module CLEAN side carries ${leak.length} comment line(s) containing this item's own rubric vocabulary${leak.length ? ` — keep-both would LEAK the answer into a control, e.g.: ${leak.slice(0, 2).map((l) => l.slice(0, 80)).join(" | ")}` : " — keep-both is leak-free for this item"}`,
    );
  }
}
pairTable();
if (flags.includes("--plan")) {
  console.log("\n--plan: no prompts sent.");
  process.exit(0);
}

const run = [];
const skipped = [];
const cellTable = []; // per-cell verdicts across replicates (198) — declared early so the transcript can carry it
let majorityRows = []; // the SCORED cells of a k-replicate run, persisted so a later comparison cannot silently take a stray replicate instead
const CONDS = ["defect", "clean", "clean-neutral"]; // the three conditions per item; --replicate rotates their order
const rescore = flag("rescore");
mkdirSync(resolve(".spike/gate"), { recursive: true });
const out = flag("out") || resolve(`.spike/gate/run-${label.replace(/[^\w.-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
// Written after EVERY item, not only at the end: a k-replicate whole-module arm costs tens of minutes of the
// operator's GPU, and an interrupted session should keep everything it already paid for.
function writeTranscript(final = false) {
  writeFileSync(
    rescore ? `${out}.rescored.json` : out,
    JSON.stringify({ label, model, baseUrl, at: new Date().toISOString(), mode: MODE, budget: BUDGET, material: MATERIAL, pairPolicy: PAIR_POLICY, reps: REPS, skipped, cells: cellTable, majority: majorityRows, complete: final, run }, null, 2),
  );
}
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
    run.push({ ...r, score: r.cond === "defect" ? scoreDefect(it, ans, OPTS) : scoreClean(it, ans, OPTS) });
  }
  console.log(`\nRESCORE ${rescore} (label ${prev.label}, asked ${prev.at}) with the current scorer — no new prompts.`);
  for (const r of run) if (r.score) console.log(`  ${r.cond.padEnd(13)} ${r.id}: ${r.score.verdict}`);
} else {
console.log(`\n${"=".repeat(78)}\nGATE RUN: ${label} (${model}) @ ${baseUrl}\n  feeding=${MODE} budget=${BUDGET} estTokens  material=${MATERIAL}  pair-comments=${PAIR_POLICY}  replicates=${REPS}${PROBE ? "  probe=on" : ""}\n${"=".repeat(78)}`);
if (REPS === 1) {
  // ROADMAP 198: this line is the whole item. Nothing printed by a single pass is a measurement; it is one draw,
  // and on 2026-10-28 the same model flipped 4 of 8 defect cells between two draws of the same instrument.
  console.log(`  NOTE 198: k = 1 — every verdict below is a SAMPLE. Use --replicate 3 (or more) before any number here informs a routing decision.`);
}
const probed = new Set();
for (let rep = 0; rep < REPS; rep++) {
  if (REPS > 1) console.log(`\n${"#".repeat(78)}\nREPLICATE ${rep + 1} of ${REPS}\n${"#".repeat(78)}`);
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    // A whole-module arm that quietly fell back to a fragment would measure nothing, so an item that does not fit
    // is DROPPED LOUDLY and named in the summary — the reader sees the denominator shrink, and why.
    // The fit decision is deterministic, so it is recorded once (rep 0) rather than k times.
    if (MODE === "whole") {
      if (!it.whole) {
        if (rep === 0) {
          console.log(`\n--- ${it.id} ---\n  SKIP ${it.id}: NO whole-module text for ${it.file} — NOT shown as a fragment.`);
          skipped.push({ id: it.id, why: "no whole-module text" });
        }
        continue;
      }
      if (it.whole.estTokens > BUDGET) {
        if (rep === 0) {
          console.log(`\n--- ${it.id} ---\n  SKIP ${it.id}: whole module ~${it.whole.estTokens} tok (${it.whole.chars} chars) > budget ${BUDGET} — stays a FRAGMENT (ROADMAP 195).`);
          skipped.push({ id: it.id, why: `whole ~${it.whole.estTokens} tok > budget ${BUDGET}` });
        }
        continue;
      }
    }
    // Counterbalance within a rep (half the items answer clean first) AND rotate across reps, so a replicate
    // cannot carry an order effect into the majority cell (198).
    const rot = CONDS.slice(rep % CONDS.length).concat(CONDS.slice(0, rep % CONDS.length));
    const order = n % 2 === 0 ? rot : [rot[1], rot[0], rot[2]];
    console.log(`\n--- ${it.id} (${it.kind}, ${it.file}) — ${MODE === "whole" ? `whole module, ~${it.whole.estTokens} est. tok` : "fragment window"} ---`);
    if (MODE === "whole" && PROBE && !probed.has(it.id)) {
      // 400-or-not, empirically (195: "probe it, do not assume"). The estimate is calibrated to be CONSERVATIVE,
      // so an item it calls too big was never close; an item it calls small can still be refused by the server.
      try {
        await ask(baseUrl, model, it.whole.defectText, it.file, "", 1);
      } catch (e) {
        console.log(`  SKIP ${it.id}: endpoint REFUSED the whole module (probe): ${e.message}`);
        skipped.push({ id: it.id, why: `probe refused at ~${it.whole.estTokens} est. tok: ${e.message.slice(0, 120)}` });
        continue;
      }
      console.log(`  PROBE ${it.id}: whole module ACCEPTED by the endpoint.`);
      probed.add(it.id);
    }
    for (const cond of order) {
      const code = cond === "defect" ? (MODE === "whole" ? it.whole.defectText : it.defectText) : (MODE === "whole" ? it.whole.cleanText : it.cleanText);
      const prompt = cond === "clean-neutral" ? NEUTRAL : LEADING;
      let res;
      try {
        res = await ask(baseUrl, model, code, it.file, prompt);
      } catch (e) {
        console.log(`  ${cond}: REQUEST FAILED ${e.message}`);
        run.push({ id: it.id, kind: it.kind, cond, rep, error: e.message });
        continue;
      }
      const s = cond === "defect" ? scoreDefect(it, res, OPTS) : scoreClean(it, res, OPTS);
      run.push({ id: it.id, kind: it.kind, cond, rep, feed: MODE, score: s, finish: res.finish, dt: +res.dt.toFixed(1), completion: res.completion, prompt: res.prompt, answer: res.text, reasoning: res.reasoning });
      const tag = cond === "defect" ? `${s.verdict} groups=${s.groups} need=${s.need}${s.phantoms.length ? ` PHANTOM[${s.phantoms.join("|")}]` : ""}` : s.verdict;
      console.log(`  ${cond.padEnd(13)} ${tag}  ${res.dt.toFixed(1)}s finish=${res.finish} completion=${res.completion}`);
      console.log(`      ${res.text.replace(/\n/g, "\n      ").slice(0, 700)}`);
    }
    // Write the transcript as the run goes, not only at the end: a k-replicate whole-module arm costs tens of
    // minutes of the operator's GPU, and losing it to an interrupted session would waste all of it.
    writeTranscript();
  }
}
}

const DROP = new Set(["ARTIFACT", "TRUNCATED-EMPTY"]);
// The same arithmetic the summary has always used, now callable over ANY row set — one replicate, or the
// majority-of-k cells — so a run can report both and the reader can see the spread instead of one draw.
function tally(rows, name) {
  const defects = rows.filter((r) => r.cond === "defect" && r.score);
  const scored = defects.filter((r) => !DROP.has(r.score.verdict));
  const corpusBugs = defects.filter((r) => DROP.has(r.score.verdict));
  const cleanAll = rows.filter((r) => r.cond === "clean" && r.score);
  const clean = cleanAll.filter((r) => !DROP.has(r.score.verdict) && r.score.verdict !== "ARTIFACT-EXCERPT");
  const excused = rows.filter((r) => r.score?.verdict === "ARTIFACT-EXCERPT").length;
  const neutralAll = rows.filter((r) => r.cond === "clean-neutral" && r.score);
  const neutral = neutralAll.filter((r) => !DROP.has(r.score.verdict) && r.score.verdict !== "ARTIFACT-EXCERPT");
  const hits = scored.filter((r) => r.score.verdict.startsWith("HIT"));
  const phantoms = defects.filter((r) => r.score.phantoms?.length);
  const fa = clean.filter((r) => r.score.verdict === "FALSE-ALARM");
  const passed = clean.filter((r) => r.score.verdict === "CLEAN-PASSED");
  const faN = neutral.filter((r) => r.score.verdict === "FALSE-ALARM");
  const unstable = rows.filter((r) => r.score?.verdict === "UNSTABLE");
  console.log(`\n${"=".repeat(78)}\nSUMMARY ${name}`);
  console.log(`  feeding: ${MODE === "whole" ? `WHOLE MODULE (shown when ~est. tokens <= ${BUDGET})` : "FRAGMENT window around the changed hunk"}   scoring material: ${MATERIAL}   pair-comments: ${PAIR_POLICY}`);
  if (skipped.length) {
    console.log(`  ITEMS SKIPPED BY THE WHOLE-MODULE ARM (195 — they stay fragments; every rate below is over the SHRUNKEN denominator):`);
    for (const s of skipped) console.log(`    SKIP ${s.id}: ${s.why}`);
  }
  const absent = rows.filter((r) => r.cond !== "defect" && r.score?.absentBindingClaims?.length);
  console.log(`  control turns claiming an absent binding (import/undefined/ReferenceError): ${absent.length} — ${MODE === "whole" ? "COUNTED as false alarms, the import block was on the page" : "excused where no code-level claim was made (ROADMAP 195)"}`);
  console.log(`  defect items named:  ${hits.length}/${scored.length} scored (${defects.length} attempted)${phantoms.length ? `   (pre-registered PHANTOM present in ${phantoms.length})` : ""}`);
  if (corpusBugs.length) console.log(`  CORPUS BUGS (rule G1 — EXCLUDED from the ranking): ${corpusBugs.map((r) => `${r.id}:${r.score.verdict}`).join(", ")}`);
  if (cleanAll.length !== clean.length || neutralAll.length !== neutral.length) console.log(`  control conditions dropped as corpus bugs: ${cleanAll.length - clean.length + neutralAll.length - neutral.length}`);
  console.log(`  clean, leading prompt:   FALSE-ALARM ${fa.length}/${clean.length}, CLEAN-PASSED ${passed.length}, AMBIGUOUS ${clean.length - fa.length - passed.length}`);
  console.log(`  clean, neutral prompt:   FALSE-ALARM ${faN.length}/${neutral.length}`);
  console.log(`  control claims EXCUSED as excerpt artifacts (ROADMAP 195, not counted as judgement failures): ${excused}`);
  if (unstable.length) console.log(`  UNSTABLE cells (no strict majority across replicates, 198): ${unstable.map((r) => `${r.id}/${r.cond}[${(r.reps || []).join("|")}]`).join(" ")}`);
  console.log(`  truncated (finish=length): ${rows.filter((r) => r.finish === "length").length} of ${rows.length} prompts`);
  return { hits: hits.length, scored: scored.length, attempted: defects.length, fa: fa.length, clean: clean.length, faN: faN.length, neutral: neutral.length };
}

// A cell's class is what has to REPLICATE, not the exact verdict string: MISS and MISS+PHANTOM are the same
// judgement about the model's capability, and treating them as different classes would report spurious
// instability (and hide real instability in the other direction).
const cellClass = (r) =>
  r.cond === "defect"
    ? DROP.has(r.score.verdict)
      ? r.score.verdict
      : r.score.verdict.startsWith("HIT")
        ? "HIT"
        : "MISS"
    : r.score.verdict;

let SCORED_ROWS = run;
if (REPS > 1) {
  const perRep = [];
  for (let rep = 0; rep < REPS; rep++) perRep.push(tally(run.filter((r) => r.rep === rep), `${label} — replicate ${rep + 1} of ${REPS} (a SAMPLE; 198)`));
  const byCell = new Map();
  for (const r of run) {
    if (!r.score) continue;
    const k = `${r.id}|${r.cond}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(r);
  }
  const mrows = [];
  console.log(`\n${"=".repeat(78)}\nREPLICATION (ROADMAP 198) — ${REPS} passes of the same items, scorer and material`);
  const unanimity = { defect: [0, 0], clean: [0, 0], "clean-neutral": [0, 0] };
  if (!cellTable.length && !byCell.size) {
    console.log(`\n${"=".repeat(78)}\nREPLICATION (ROADMAP 198): NO cells — every item was skipped or failed, so there is nothing to replicate.`);
  }
  for (const [key, rs] of byCell) {
    const [id, cond] = key.split("|");
    const counts = new Map();
    for (const r of rs) counts.set(cellClass(r), (counts.get(cellClass(r)) || 0) + 1);
    const [topClass, topN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const agrees = topN * 2 > rs.length; // strict majority of passes must agree before the cell is scored at all
    unanimity[cond][0] += topN === rs.length ? 1 : 0;
    unanimity[cond][1] += 1;
    cellTable.push({ id, cond, k: rs.length, verdicts: rs.map((r) => r.score.verdict), agreement: `${topN}/${rs.length}`, cell: agrees ? topClass : "UNSTABLE" });
    console.log(`  ${id.padEnd(34)} ${cond.padEnd(13)} ${rs.map((r) => r.score.verdict).join(" | ").padEnd(42)} cell=${(agrees ? topClass : "UNSTABLE").padEnd(12)} agreement ${topN}/${rs.length}`);
    const winner = agrees ? rs.find((r) => cellClass(r) === topClass) : null;
    mrows.push(
      winner
        ? { ...winner, rep: "majority", reps: rs.map((r) => r.score.verdict) }
        : { id, kind: rs[0].kind, cond, feed: MODE, rep: "majority", score: { verdict: "UNSTABLE", phantoms: [] }, reps: rs.map((r) => r.score.verdict) },
    );
  }
  console.log(`  unanimous cells per axis: ${Object.entries(unanimity).map(([c, [u, t]]) => `${c} ${u}/${t}`).join("   ")}`);
  const rng = (pick) => { const v = perRep.map(pick); return v.length ? `${Math.min(...v)}-${Math.max(...v)}` : "n/a"; };
  console.log(`  spread across replicates: defect named ${perRep.map((t) => `${t.hits}/${t.scored}`).join(", ")}; false alarms (leading) ${rng((t) => t.fa)}/${perRep[0].clean}; false alarms (neutral) ${rng((t) => t.faN)}/${perRep[0].neutral}`);
  SCORED_ROWS = mrows;
  majorityRows = mrows; // persisted in the transcript (which is rewritten after every item, so an interrupted k-run keeps the cells it already paid for)
  const maj = tally(mrows, `${label} — MAJORITY-of-${REPS} cells (198: THIS is the score that may inform a routing decision)`);
  // G2 (pre-registered 2026-10-27): the control family must name >= 4 of 8 defects, else no floor exists to
  // calibrate a candidate against. The arm's denominator is printed with it, because a whole-module arm has
  // fewer items than a fragment arm BY DESIGN and its floor must be stated, not inherited.
  if (maj.scored) {
    const floor = Math.min(4, maj.scored);
    const worst = Math.min(...perRep.map((t) => t.hits));
    console.log(`  G2 FLOOR in this arm (the bar is defined for the CONTROL family; this run is ${label}): control must name >= ${floor} of ${maj.scored} (the pre-registered bar is 4 of 8; this arm shows ${maj.scored}). majority run: ${maj.hits}/${maj.scored} ${maj.hits >= floor ? "MET" : "NOT MET"}; worst replicate: ${worst}/${maj.scored} ${worst >= floor ? "MET" : "NOT MET"}.`);
  }
} else {
  tally(run, label);
}

const cmp = flag("compare");
if (cmp) {
  const other = JSON.parse(readFileSync(cmp, "utf8"));
  // If the compared transcript is itself a k-replicate run, pair against its SCORED cells, not its last replicate.
  const otherRun = other.majority?.length ? other.majority : other.run || other;
  const byId = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.score) continue;
      if (!m.has(r.id)) m.set(r.id, {});
      m.get(r.id)[r.cond] = r;
    }
    return m;
  };
  const mine = byId(SCORED_ROWS);
  const theirs = byId(otherRun);
  // Pair on the items BOTH arms actually showed. A whole-module arm has a smaller denominator than a
  // fragment arm by design (195 skips what does not fit), so an unintersected rate comparison would be
  // comparing different sets of items and calling it a model difference.
  const shared = [...mine.keys()].filter((id) => theirs.has(id));
  const modeOf = (o) => o.mode || "fragment (transcript predates the mode field)";
  console.log(`\n  SIDE BY SIDE — this run fed: ${modeOf({ mode: MODE })}   other (${other.label ?? cmp}) fed: ${modeOf(other)}`);
  console.log(`  scoring material: this ${MATERIAL}, other ${other.material ?? "answer+reasoning (unrecorded)"}`);
  console.log(`  shared items: ${shared.length} (this run ${mine.size}, other ${theirs.size})`);
  for (const id of shared) {
    const a = mine.get(id);
    const b = theirs.get(id);
    const v = (x, c) => (x[c]?.score?.verdict ?? "-");
    console.log(`    ${id.padEnd(34)} defect: ${v(a, "defect").padEnd(12)} vs ${v(b, "defect").padEnd(12)} | clean: ${v(a, "clean").padEnd(12)} vs ${v(b, "clean").padEnd(12)} | neutral: ${v(a, "clean-neutral").padEnd(12)} vs ${v(b, "clean-neutral")}`);
  }
  const rowsOf = (m, ids, cond) => ids.map((id) => m.get(id)?.[cond]).filter((r) => r && r.score && !DROP.has(r.score.verdict) && r.score.verdict !== "ARTIFACT-EXCERPT");
  const hitRows = rowsOf(mine, shared, "defect");
  const theirHitRows = rowsOf(theirs, shared, "defect");
  const theirHits = new Map(theirHitRows.map((r) => [r.id, r.score.verdict.startsWith("HIT")]));
  let b = 0;
  let c = 0;
  for (const r of hitRows) {
    if (!theirHits.has(r.id)) continue;
    if (r.score.verdict.startsWith("HIT") && !theirHits.get(r.id)) b++;
    if (!r.score.verdict.startsWith("HIT") && theirHits.get(r.id)) c++;
  }
  const p = mcnemarExact(b, c);
  const myHits = hitRows.filter((r) => r.score.verdict.startsWith("HIT")).length;
  const theirHits2 = theirHitRows.filter((r) => r.score.verdict.startsWith("HIT")).length;
  const cleanMine = rowsOf(mine, shared, "clean");
  const cleanTheirs = rowsOf(theirs, shared, "clean");
  const neuMine = rowsOf(mine, shared, "clean-neutral");
  const neuTheirs = rowsOf(theirs, shared, "clean-neutral");
  const faOf = (rows) => rows.filter((r) => r.score.verdict === "FALSE-ALARM").length;
  console.log(`\n  PAIRED on ${shared.length} shared items: defect hits this ${myHits}/${hitRows.length} vs other ${theirHits2}/${theirHitRows.length}; i-hit-they-missed ${b}, they-hit-i-missed ${c}  ->  McNemar exact p = ${p.toFixed(3)}`);
  console.log(`  false alarms, leading prompt: this ${faOf(cleanMine)}/${cleanMine.length} vs other ${faOf(cleanTheirs)}/${cleanTheirs.length}`);
  console.log(`  false alarms, neutral prompt: this ${faOf(neuMine)}/${neuMine.length} vs other ${faOf(neuTheirs)}/${neuTheirs.length}`);
  console.log(`  NOTE a paired exact test needs >=6 one-sided discordant pairs to reach p<=0.05 at n=8, and >=${shared.length} at n=${shared.length} (one-sided exact). Compare ARMS only on shared items.`);
}

writeTranscript(true);
console.log(`\ntranscript: ${rescore ? `${out}.rescored.json` : out}`);
