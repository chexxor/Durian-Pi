// The 189 gate, made decision-grade.
//
// WHY THIS FILE EXISTS. `calibrate-verifier.mjs` had TWO items, from ONE commit, taken at hand-picked line
// offsets (slice(140,200)), with a flat keyword list and NO clean-code condition. D137 then made an operator
// decision on a 1/2-vs-0/2 gap that is not statistically distinguishable (McNemar exact p = 1.0 on one
// discordant pair), while its own headline finding — the model invented a defect that cannot occur — is a
// FALSE ALARM, which that instrument has no condition able to measure. This corpus fixes all four defects:
//
//   1. more items, drawn from this repo's own fix history (pre-fix code is a git object; the fix commit and
//      its message are the ground truth, so any reader can check an item without trusting me);
//   2. MUTANTS with an EXECUTION PROOF of non-equivalence, built and re-checked every run — an injected
//      defect whose ground truth is exact by construction, and which is dropped loudly if the mutation turns
//      out to be a no-op (the classic mutation-testing trap: an equivalent mutant scores a model as wrong
//      when the code is fine);
//   3. a MATCHED CLEAN CONTROL for every item — the same region with the defect absent — so a confident
//      phantom becomes a counted false alarm instead of a paragraph in a doc;
//   4. rubric GROUPS (mechanism concepts) instead of a flat keyword bag, plus pre-registered PHANTOM patterns.
//
// Everything is derived at run time from `git show`, never retyped. Run through gate.mjs.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PAD = Number(process.env.CAL_PAD || 34); // lines of real code around the changed hunk
const SPIKE = process.env.CAL_SPIKE || ".spike/gate";

// ROADMAP 199 — HOW THE TWO SIDES OF A PAIR ARE TREATED ABOUT COMMENTS, and it is not free.
// The instrument stripped comment-led lines from the CLEAN side only, and left the defect side authentic.
// Measured, that removes 17.7-68.8% of the bytes of a "matched" pair (14.0 KB -> 4.4 KB at its worst), so the
// pair was not matched and the whole-module arm was comparing a 14 KB file against a 4.4 KB file and calling
// the difference the model's judgement. Two symmetric options, and BOTH have a measured cost:
//   strip-both  comments leave both sides: the pair differs by the defect and nothing else
//               (cost: the authentic pre-fix text is no longer what the author of the fix actually read, and
//               comments carry real semantics — 17.7% of driver.mjs and 28.2% of confine.mjs are comments).
//   keep-both   both sides authentic: the defect side is the real pre-fix file and a model may legitimately
//               use its comments (cost, measured below per item: the CLEAN side's comments then stay on the page,
//               and a post-fix file's comments NAME the fix that was made there — a leak into a control).
//   strip-clean-only  the 2026-10-28 configuration, kept reproducible so D137/D138/D139's tables still run.
// The default is strip-both: a control that carries the sentence describing its own bug spoils the item.
const PAIR_COMMENTS = process.env.CAL_PAIR_COMMENTS || "strip-both";
if (!["strip-both", "keep-both", "strip-clean-only"].includes(PAIR_COMMENTS)) {
  throw new Error(`CAL_PAIR_COMMENTS must be strip-both|keep-both|strip-clean-only, got '${PAIR_COMMENTS}'`);
}

const gitShow = (rev, file) => {
  try {
    return execFileSync("git", ["show", `${rev}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`git show ${rev}:${file} failed: ${e.message.split("\n")[0]}`);
  }
};

/** Hunk ranges for one file in one commit, from a --unified=0 diff (so they are the CHANGE, not my guess). */
function hunkRanges(sha, file) {
  const d = execFileSync("git", ["show", "--unified=0", "--no-color", "--pretty=format:", sha, "--", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = [];
  for (const m of d.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    out.push({ preStart: +m[1], preLen: +(m[2] ?? 1), postStart: +m[3], postLen: +(m[4] ?? 1) });
  }
  if (out.length === 0) throw new Error(`no hunks for ${file} in ${sha}`);
  return out;
}

function region(text, start, len, tailStart, tailLen) {
  const lines = text.split(/\r?\n/);
  const from = Math.max(1, Math.min(start, start) - PAD);
  const to = Math.min(lines.length, Math.max(start + len, tailStart + tailLen) + PAD);
  return lines.slice(from - 1, to).join("\n");
}

/**
 * Crude but honest: strip line comments, string/template literals and regex literals so BRACKET depth can be
 * tracked without a parser. Anything this gets wrong is caught downstream by the `node --check` guard on every
 * extracted region, which drops the item loudly rather than feeding a model a fragment that "fails" because my
 * window cut mid-function — the exact artifact the first run of this harness produced.
 */
function codeOnly(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/\/\*.*?\*\//g, "")
    .replace(/(['"`])(?:\\.|[^\\])*?\1/g, "S")
    .replace(/(^|[\s(=,:!])\/[^\/\n]*\/[a-z]*/g, "$1R");
}

const OPENMAP = { "(": ")", "{": "}", "[": "]" };
const CLOSEMAP = { ")": "(", "}": "{", "]": "[" };

const netDelta = (line) => {
  const c = codeOnly(line);
  let d = 0;
  for (const ch of c) {
    if (OPENMAP[ch]) d++;
    else if (CLOSEMAP[ch]) d--;
  }
  return d;
};

/**
 * Bracket depth BEFORE each line, measured across the WHOLE file (n+1 entries). The file parses, so these
 * depths say where a fragment may be cut: a statement or literal element at level k starts where depth is k
 * and ends where depth returns to k. Every window shown to a model is built on that rule and then VERIFIED
 * with `node --check`, because a window cut mid-statement hands the model a `SyntaxError` to "find" — the
 * artifact the first version of this harness produced and then SCORED AS A HIT for a wrong answer.
 */
function prefixDepths(lines) {
  const pd = [0];
  for (const l of lines) pd.push(pd.at(-1) + netDelta(l));
  return pd;
}

/** The element/statement at level k that contains the anchor: opener line, closer line. */
function stmtSpan(lines, pd, anchor, k) {
  let opener = -1;
  for (let i = anchor; i >= 0; i--) {
    if (pd[i] === k && (netDelta(lines[i]) > 0 || pd[anchor] === k)) {
      opener = i;
      break;
    }
  }
  if (opener < 0) return null;
  for (let j = opener; j < lines.length; j++) if (pd[j + 1] === k) return [opener, j];
  return null;
}

/**
 * Synthetic scaffolding so a fragment at depth > 0 still parses. The fragment's own text is untouched; only
 * the wrapper is invented, and which wrapper was needed is recorded in the item. Trying several is what makes
 * an element of an object/array literal reviewable at all — a function-body wrapper cannot parse a property.
 */
const WRAPPERS = [
  (t) => t,
  (t) => `async function __durig_probe__() {\n${t}\n}`,
  (t) => `const __durig_probe__ = {\n${t}\n};`,
  (t) => `const __durig_probe__ = [\n${t}\n];`,
  (t) => `class __durig_probe__ {\n${t}\n}`,
];

const MIN_LINES = Number(process.env.CAL_MIN_LINES || 24);
const parseCache = new Map();
/** Does the extracted region PARSE? A region that does not is my bug, not the model's subject. */
function parses(code, where = "probe.js") {
  const key = `${where}|${code}`;
  if (parseCache.has(key)) return parseCache.get(key);
  mkdirSync(resolve(SPIKE, "regions"), { recursive: true });
  const f = resolve(SPIKE, "regions", where.replace(/[^\w.-]/g, "_"));
  writeFileSync(f, code, "utf8");
  let ok = true;
  try {
    execFileSync("node", ["--check", f], { stdio: "pipe" });
  } catch {
    ok = false;
  }
  parseCache.set(key, ok);
  return ok;
}

/**
 * The window shown to a model: the LARGEST real sibling-run around the defect that fits the context budget and
 * PARSES, taken from the shallowest enclosing level that yields one. Two earlier schemes — a fixed line slice,
 * and "expand until the window balances by itself" — both failed here: the first cut functions mid-statement,
 * the second excluded almost every item because this repo's files nest deeply inside wide structures.
 */
function windowAround(lines, pd, anchor, cap = Number(process.env.CAL_MAX_LINES || 220)) {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= lines.length) return null;
  const cands = [];
  for (let k = pd[anchor]; k >= 0; k--) {
    const span = stmtSpan(lines, pd, anchor, k);
    if (!span) continue;
    for (const grow of [PAD, 2 * PAD, 0]) {
      let s = span[0];
      let e = span[1];
      if (grow) {
        let cs = Math.max(0, span[0] - grow);
        while (cs < span[0] && pd[cs] !== k) cs++;
        let ce = Math.min(lines.length - 1, span[1] + grow);
        while (ce > span[1] && pd[ce + 1] !== k) ce--;
        if (cs > ce) continue;
        [s, e] = [cs, ce];
      }
      if (e - s + 1 > cap) continue;
      while (e > s && lines[e].trim() === "") e--;
      while (s < e && lines[s].trim() === "") s++;
      if (e - s + 1 > cap) continue;
      if (!cands.some((c) => c.s === s && c.e === e)) cands.push({ s, e, k });
    }
  }
  cands.sort((a, b) => b.e - b.s - (a.e - a.s));
  let fallback = null;
  for (const c of cands) {
    const inner = lines.slice(c.s, c.e + 1).join("\n");
    for (let w = 0; w < WRAPPERS.length; w++) {
      const text = WRAPPERS[w](inner);
      if (!parses(text, `w${w}-${c.k}-${c.s}-${c.e}.js`)) continue;
      const rec = { text, s: c.s, e: c.e, level: c.k, wrapper: w, lines: c.e - c.s + 1 };
      if (!fallback) fallback = rec;
      if (rec.lines >= MIN_LINES) return rec;
      break;
    }
  }
  return fallback;
}

/** Windows for every hunk of a commit (pre- or post-image), merged when adjacent. */
function windowsFor(lines, hunks, usePost) {
  const pd = prefixDepths(lines);
  const ws = [];
  for (const h of hunks) {
    const w = windowAround(lines, pd, (usePost ? h.postStart : h.preStart) - 1);
    if (!w) return null;
    const last = ws.at(-1);
    if (last && w.s <= last.e + 2) {
      last.e = Math.max(last.e, w.e);
      const inner = lines.slice(last.s, last.e + 1).join("\n");
      for (let i = 0; i < WRAPPERS.length; i++) {
        if (parses(WRAPPERS[i](inner), `merge-${i}-${last.s}-${last.e}.js`)) {
          last.text = WRAPPERS[i](inner);
          last.wrapper = i;
          break;
        }
      }
    } else ws.push(w);
  }
  if (ws.some((w) => !w.text)) return null;
  return { windows: ws };
}

function render(ws) {
  return ws.windows.map((w) => w.text).join("\n\n/* … */\n\n");
}


/** Pre-fix and post-fix regions for a historical fix commit, anchored on its own hunks and repaired to parse. */
function histRegions(sha, file) {
  const hs = hunkRanges(sha, file);
  const preLines = gitShow(`${sha}^`, file).split(/\r?\n/);
  const postLines = gitShow(sha, file).split(/\r?\n/);
  const pw = windowsFor(preLines, hs, false);
  const qw = windowsFor(postLines, hs, true);
  if (!pw || !qw) return null;
  return { defect: render(pw), clean: render(qw) };
}

// ---------------------------------------------------------------- whole-module view (ROADMAP 195)
//
// A fragment control manufactures its own false alarms: windowing strips the import block and the
// sibling declarations, so a model that reports "`resolve` is not imported" is telling the truth about MY
// excerpt and gets scored as a judgement failure. The fix is to show the WHOLE MODULE whenever the
// verifier's context can hold it — which requires knowing, before spending a prompt, whether it can.
//
// The estimate is calibrated, not guessed. Read out of the 2026-10-28 transcripts (`.spike/gate/run-*.json`,
// 24 recorded `prompt` token counts per model) against the exact prompt text each turn sent, the ratio is
// **0.2588-0.3244 tokens/char for `ministral-3-14b-reasoning`** and **0.2604-0.3609 for `local/iq3_s`**.
// So 2.7 chars/token (0.370 tok/char) sits ABOVE the worst measured ratio for both families: a fit decision
// made with it is conservative, and a module it calls too big was never close to fitting.
const CHARS_PER_TOKEN = Number(process.env.CAL_CHARS_PER_TOKEN || 2.7);
export const estimateTokens = (text) => Math.ceil(String(text).length / CHARS_PER_TOKEN);

/** The whole module behind an item: pre-/post-fix files for a hist item, main/mutant for a mutant. */
function wholeTexts(it, { mutText, main }) {
  let defectRaw, cleanRaw;
  if (it.kind === "hist") {
    // The authentic pair: the entire file as it was before the fix, and the entire file after it.
    defectRaw = gitShow(`${it.sha}^`, it.file);
    cleanRaw = gitShow(it.sha, it.file);
  } else {
    defectRaw = mutText;
    cleanRaw = main;
  }
  const pair = pairTexts(defectRaw, cleanRaw);
  // A whole file parses by definition — unless MY pair treatment broke it, which is exactly what this
  // guard is for. Loud, not silent: a broken module shown as "the whole truth" is worse than a fragment.
  if (!parses(pair.defect, `${it.id}-whole-defect.mjs`) || !parses(pair.clean, `${it.id}-whole-clean.mjs`)) return null;
  return {
    defectText: pair.defect,
    cleanText: pair.clean,
    chars: pair.defect.length,
    estTokens: estimateTokens(pair.defect),
    pair: pair.account,
    pairDowngrade: pair.downgraded,
    // ROADMAP 199's other half: `keep-both` sounds authentic, so measure what it would leak into the control.
    leak: pairAccount(defectRaw, cleanRaw, it).cleanCommentsLeaking,
  };
}

/** Apply a mutation to a current-main region; exactly one occurrence or the item is invalid. */
function mutate(text, m) {
  const hits = text.split(m.find).length - 1;
  if (hits !== 1) throw new Error(`mutation ${m.id}: found ${hits} occurrences of the anchor, need exactly 1`);
  return text.replace(m.find, m.replace);
}

// ---------------------------------------------------------------------------------------------
// ITEMS. `groups` = mechanism concepts; a HIT needs `need` of them in the answer. `phantoms` are
// answers known to be wrong (observed here, or refuted by running the claim) — pre-registered, so a
// confident wrong mechanism is scored rather than narrated.
// ---------------------------------------------------------------------------------------------
export const ITEMS = [
  {
    id: "H1-npm-invocation",
    kind: "hist",
    sha: "3bff94a",
    file: "src/worktree.mjs",
    truth:
      "npm is spawned with a script PATH as its first positional word, so npm reports 'Unknown command: <path>' and dependency linking never runs on any platform. resolveNpmInvocation returns {cmd, prefixArgs} and prefixArgs must PRECEDE the script path.",
    groups: [
      ["unknown command", "not a command", "treated as a command", "as the command", "first argument", "first positional", "argv"],
      ["npm"],
      ["prefix", "precede", "before", "argument order", "mis-composed", "invocation", "wrong place"],
      ["never", "not run", "never runs", "never linked", "always fail", "fails", "silently", "never executes"],
    ],
    need: 3,
    phantoms: [
      "join(\"\\n\")",
      "join('\\n')",
      "may not be a string",
      "non-string",
      "wrap",
    ],
  },
  {
    id: "H2-process-death-deadline",
    kind: "hist",
    sha: "3bff94a",
    file: "src/job-object.mjs",
    truth:
      "On POSIX it checks liveness ONCE, sleeps, checks again and returns; timeoutMs is never polled, so a process that dies later is reported 'still running' forever and cleanup permanently refuses. The polling loop exists only in the Windows branch.",
    groups: [
      ["once", "single", "one check", "does not loop", "never loop", "no loop", "not poll", "never poll"],
      ["timeout", "deadline"],
      ["still running", "still alive", "reports it as alive", "alive", "false", "never cleans", "stuck", "permanent"],
    ],
    need: 2,
    phantoms: ["taskkill", "uninitialized", "race condition in", "pidpromise"],
  },
  {
    id: "H3-truthy-sentinel-dead-code",
    kind: "hist",
    sha: "72657e6",
    file: "src/rig.mjs",
    truth:
      "The describing-refusal block sits INSIDE `if (!found)`, but `{ kind: \"none\", mine }` is TRUTHY, so `!found` is false and the block is UNREACHABLE; control falls through to a header render over an object with none of those fields, printing `ITEM #undefined`.",
    groups: [
      ["unreachable", "dead code", "never runs", "never reached", "not executed", "does not run"],
      ["truthy", "truthy value", "non-null", "object is true", "!found", "found is"],
      ["undefined", "fall through", "falls through", "header"],
    ],
    need: 2,
    phantoms: [],
  },
  {
    id: "H4-doc-proxy-escape",
    kind: "hist",
    sha: "3355135",
    file: "src/rig.mjs",
    truth:
      "`mine` is a filtered array of DOC PROXIES returned out of the api.commit callback; the proxies do not survive settlement, so reading them after the callback returns throws 'Cannot use a settled overlay'. Filtering is not enough — it must be snapshotted to plain data inside.",
    groups: [
      ["proxy", "proxies", "overlay", "settled", "snapshot", "plain"],
      ["after the callback", "outside the callback", "escape", "escapes", "leak", "returned from", "after settlement", "after the commit", "settled overlay"],
      ["throw", "throws", "error", "cannot use"],
    ],
    need: 2,
    phantoms: [],
  },
  {
    id: "H5-block-local-helper-swallowed",
    kind: "hist",
    sha: "b4c86ea",
    file: "scripts/clockin.mjs",
    truth:
      "The suite-marker reader referenced the `git` helper that is declared INSIDE branchDebt's block, so the call threw ReferenceError; the surrounding `catch` turned that into the misleading string 'no marker written yet'. Separately the reader assumed one JSON shape and printed 'undefined/undefined at undefined'.",
    groups: [
      ["scope", "block-local", "out of scope", "not in scope", "local to", "not defined", "referenceerror", "undefined function", "not visible"],
      ["catch", "swallow", "swallowed", "hides", "hiding", "misleading", "masks", "mascarade", "wrong message", "wrong reason"],
      ["undefined", "shape", "field", "marker"],
    ],
    need: 2,
    phantoms: [],
  },

  // ---------------- MUTANTS: ground truth exact by construction, non-equivalence proved by running ----------------
  {
    id: "M1-cell-budget-off-by-one",
    kind: "mut",
    file: "src/textwidth.mjs",
    anchor: "if (used + width > cells) break;",
    find: "if (used + width > cells) break;",
    replace: "if (used + width > cells + 1) break;",
    truth:
      "The bound test allows one extra cell (`> cells + 1`), so sliceToWidth can return a string one cell WIDER than the caller's budget — which is what bounds a rendered row against the terminal.",
    groups: [
      ["off by one", "one extra", "one more", "+ 1", "plus one", "wider", "exceeds", "over the budget", "off-by-one"],
      ["cell", "width", "budget", "truncat"],
      ["row", "render", "terminal", "wrap", "layout", "cut off", "overflow"],
    ],
    need: 2,
    phantoms: [],
    proof: {
      // Differential run: the clean and mutant copies of the module must DISAGREE on a call.
      probe: async (mod) => {
        const a = mod.sliceToWidth("abcdef", 3);
        const b = mod.sliceToWidth("aaaaaaaaaa", 4);
        return JSON.stringify([a.length, b.length, a, b]);
      },
    },
  },
  {
    id: "M2-regex-word-boundary-overreach",
    kind: "mut",
    file: "src/confine.mjs",
    anchor: "re: /git\\s+checkout(?![\\w-])/i,",
    find: "re: /git\\s+checkout(?![\\w-])/i,",
    replace: "re: /git\\s+checkout\\b/i,",
    truth:
      "`\\b` sits between the `t` of `checkout` and the hyphen of `checkout-index`, so the branch-switch refusal sweeps in `git checkout-index`, which cannot move HEAD and is the prescribed recovery verb in a seat's own worktree. The guard refuses an act it does not mean to refuse.",
    groups: [
      ["checkout-index", "hyphen", "word boundary", "\\b", "matches", "over-match", "too broad", "overreach", "false positive"],
      ["guard", "refuse", "refused", "deny", "denied", "block", "confine"],
      ["legitimate", "allowed", "should be allowed", "own worktree", "recovery", "head", "not a branch"],
    ],
    need: 2,
    phantoms: [],
    proof: {
      probe: async (mod) => {
        const r = mod.refusalFor(["git", "checkout-index", "--target=x", "src/a.mjs"], { root: "/tmp/wt", cwd: "/tmp/wt" });
        return JSON.stringify(r ? r.slice(0, 60) : null);
      },
    },
  },
  {
    id: "M3-pause-still-claims",
    kind: "mut",
    file: "src/driver.mjs",
    anchor: "const hasQueued = !paused && (items ?? []).some((it) => it.to === name && it.status === \"queued\");",
    find: "const hasQueued = !paused && (items ?? []).some((it) => it.to === name && it.status === \"queued\");",
    replace: "const hasQueued = (items ?? []).some((it) => it.to === name && it.status === \"queued\");",
    truth:
      "The `!paused` guard is gone, so a PAUSED rig still wakes seats with the 'call claim_work' prompt and they take new work while paused — pause is supposed to gate TAKING work while letting in-flight work settle.",
    groups: [
      ["paused", "pause"],
      ["wake", "wakes", "woken", "prompt", "claim_work", "claims", "take new work", "still claims"],
      ["invariant", "should not", "violat", "contradict", "while paused", "despite"],
    ],
    need: 2,
    phantoms: [],
    proof: {
      probe: async (mod) => {
        const w = mod.selectWakes({
          seats: { impl: { conversationId: 9 } },
          items: [{ to: "impl", status: "queued" }],
          paused: true,
        });
        return JSON.stringify(w.map((x) => ({ name: x.name, reason: x.reason })));
      },
    },
  },
];

/** Build the corpus: regions for every item, mutant modules written and DIFFERENTIALLY PROVEN. */
export async function buildCorpus({ outDir = SPIKE } = {}) {
  mkdirSync(resolve(outDir), { recursive: true });
  const items = [];
  const notes = [];
  for (const it of ITEMS) {
    if (it.kind === "hist") {
      const r = histRegions(it.sha, it.file);
      if (!r) {
        notes.push(`${it.id}: no parseable window inside CAL_MAX_LINES; item EXCLUDED`);
        continue;
      }
      if (!parses(r.defect, `${it.id}-defect.js`) || !parses(r.clean, `${it.id}-clean.js`)) {
        notes.push(`${it.id}: region does not PARSE (window repair failed); item EXCLUDED`);
        continue;
      }
      const whole = wholeTexts(it, {});
      if (!whole) notes.push(`${it.id}: whole-module view does NOT PARSE (comment strip); no whole-module arm for this item`);
      if (whole?.pairDowngrade) notes.push(`${it.id}: WHOLE-MODULE ${whole.pairDowngrade} — the pair stays symmetric, both sides authentic`);
      const frag = pairTexts(r.defect, r.clean);
      if (frag.downgraded) notes.push(`${it.id}: FRAGMENT ${frag.downgraded} — the pair stays symmetric, both sides authentic`);
      if (!parses(frag.defect, `${it.id}-defect.js`) || !parses(frag.clean, `${it.id}-clean.js`)) {
        notes.push(`${it.id}: region does not PARSE under pair policy ${PAIR_COMMENTS}; item EXCLUDED`);
        continue;
      }
      items.push({
        ...it,
        defectText: frag.defect,
        cleanText: frag.clean,
        fragment: { defectTokens: estimateTokens(frag.defect), cleanTokens: estimateTokens(frag.clean), pair: frag.account },
        whole,
        label: `${it.file} @ ${it.sha}^`,
      });
      continue;
    }
    const main = gitShow("main", it.file);
    if (!main.includes(it.find)) throw new Error(`${it.id}: anchor not on main — the mutant is stale`);
    const mutText = mutate(main, { id: it.id, find: it.find, replace: it.replace });
    const patched = `${resolve(outDir)}/${it.id}.mjs`;
    writeFileSync(patched, mutText, "utf8");
    const anchorLine = it.anchor.split("\n")[0];
    // MATCHED PAIR: same window of the same file, one copy carrying the mutation and one not. In the mutated
    // copy the anchor line no longer exists, so its window is located by the REPLACEMENT text.
    const idxMut = mutText.split("\n").findIndex((l) => l.includes(it.replace.split("\n")[0]));
    const idxClean = main.split("\n").findIndex((l) => l.includes(anchorLine));
    if (idxMut < 0 || idxClean < 0) {
      notes.push(`${it.id}: anchor not found after mutation; item EXCLUDED`);
      continue;
    }
    if (it.proof) {
      const clean = await import(`../../${it.file}`);
      const mut = await import(pathToFileURL(patched).href);
      const a = await it.proof.probe(clean);
      const b = await it.proof.probe(mut);
      if (a === b) {
        notes.push(`${it.id}: EQUIVALENT MUTANT — the patched module behaved identically (${a}); item EXCLUDED`);
        continue;
      }
      const mutLines = mutText.split(/\r?\n/);
      const mainLines = main.split(/\r?\n/);
      const dw = windowAround(mutLines, prefixDepths(mutLines), idxMut);
      const cw = windowAround(mainLines, prefixDepths(mainLines), idxClean);
      if (!dw || !cw) {
        notes.push(`${it.id}: no parseable window inside CAL_MAX_LINES; item EXCLUDED`);
        continue;
      }
      const pair = pairTexts(dw.text, cw.text);
      if (pair.downgraded) notes.push(`${it.id}: FRAGMENT ${pair.downgraded} — the pair stays symmetric, both sides authentic`);
      const dText = pair.defect;
      const cText = pair.clean;
      if (!parses(dText, `${it.id}-defect.js`) || !parses(cText, `${it.id}-clean.js`)) {
        notes.push(`${it.id}: region does not PARSE under pair policy ${PAIR_COMMENTS} (window repair failed); item EXCLUDED`);
        continue;
      }
      const whole = wholeTexts(it, { mutText, main });
      if (!whole) notes.push(`${it.id}: whole-module view does NOT PARSE (comment strip); no whole-module arm for this item`);
      if (whole?.pairDowngrade) notes.push(`${it.id}: WHOLE-MODULE ${whole.pairDowngrade} — the pair stays symmetric, both sides authentic`);
      items.push({
        ...it,
        defectText: dText,
        cleanText: cText,
        fragment: { defectTokens: estimateTokens(dText), cleanTokens: estimateTokens(cText), pair: pair.account },
        whole,
        label: `${it.file} @ main + injected mutation`,
        proof: { ...it.proof, cleanOut: a, mutantOut: b },
      });
    }
  }
  return { items, notes };
}

/** A ~70-line window centred on a line index, so the mutant sits inside readable surrounding code. */
function sliceWindow(text, idx) {
  const lines = text.split(/\r?\n/);
  const from = Math.max(0, idx - 30);
  return lines.slice(from, idx + 40).join("\n");
}

/**
  * Strip comment-led lines. WHICH SIDE it is applied to is now a declared policy (CAL_PAIR_COMMENTS, ROADMAP 199)
 * rather than something this function did to the clean side only. A post-fix region carries the fix's own
 * commentary ("#4374: `git checkout-index` is NOT a branch switch…"), and a mutated file's neighbours carry the
 * invariant the mutation breaks — so a control that NAMES the defect it is supposed to be free of spoils the
 * item and manufactures a false alarm out of a correct restatement. Behaviour is unaffected (comments are not
 * semantics), but BYTES are: stripping one side only shed 17.7-68.8% of a "matched" pair's clean side.
 */
export function stripCommentLines(text) {
  const lines = String(text).split(/\r?\n/);
  const mask = commentLedMask(text);
  return lines.filter((_, i) => !mask[i]).join("\n");
}

/**
 * Which lines of a module are COMMENT-ONLY, computed with a small state machine rather than a line regex.
 * This is not pedantry, it is the thing that broke the first attempt at ROADMAP 199: a regex like
 * `/^\s*(\/\/|\/\*|\*)/` also matches lines INSIDE a multi-line template literal, and in this repo two of them
 * (src/worktree.mjs, src/rig.mjs) carry a line that starts `* remove\` is NOT a substitute…` — i.e. the line that
 * CLOSES the template. Stripping it unbalances the backtick and the whole module stops parsing, which under a
 * symmetric policy drops the item instead of fixing it. `#` is deliberately NOT treated as a comment: in .mjs a
 * leading `#` is a class-private field, not a comment.
 */
export function commentLedMask(text) {
  const lines = String(text).split(/\r?\n/);
  const mask = new Array(lines.length).fill(false);
  const stack = ["code"]; // code | tpl ; templates open and close across lines
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let sawComment = inBlock; // a line that starts inside a block comment is comment continuation
    let sawCode = false;
    let str = null; // ' or " can only span this line
    let j = 0;
    while (j < l.length) {
      const top = stack[stack.length - 1];
      const c = l[j];
      const nx = l[j + 1];
      if (inBlock) {
        if (c === "*" && nx === "/") {
          inBlock = false;
          j += 2;
          continue;
        }
        j++;
        continue;
      }
      if (top === "tpl") {
        if (c === "\\") { j += 2; continue; }
        if (c === "`") { stack.pop(); j++; continue; }
        if (c === "$" && nx === "{") { stack.push("code"); j += 2; continue; }
        sawCode = true; // template CONTENT is code context, even when the line starts with `*` or `//`
        j++;
        continue;
      }
      if (str) {
        if (c === "\\") { j += 2; continue; }
        if (c === str) str = null;
        sawCode = true;
        j++;
        continue;
      }
      if (c === "/" && nx === "/") {
        sawComment = true;
        break; // to end of line
      }
      if (c === "/" && nx === "*") {
        sawComment = true;
        inBlock = true;
        j += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        str = c;
        sawCode = true;
        j++;
        continue;
      }
      if (c === "`") {
        stack.push("tpl");
        sawCode = true;
        j++;
        continue;
      }
      if (/\s/.test(c)) { j++; continue; }
      sawCode = true;
      j++;
    }
    if (str) sawCode = true; // an unterminated string is not a comment line
    mask[i] = sawComment && !sawCode;
  }
  return mask;
}

/** Every rubric phrase and pre-registered phantom of an item — the vocabulary that must NOT sit in a control. */
export function rubricPhrases(it) {
  return [...(it.groups || []).flat(), ...(it.phantoms || []), ...(it.falseAlarm || [])].map(String);
}

/**
 * Apply the PAIR_COMMENTS policy to one pair and report what it cost, in bytes and comment share, per side.
 * ROADMAP 199 exists because this accounting was not printed: a "matched pair" silently shed 17.7-68.8% of the
 * clean side's bytes, and every whole-module rate printed before it was computed on that pair.
 */
export function pairAccount(defectRaw, cleanRaw, it) {
  const d = defectRaw.trimEnd();
  const c = cleanRaw.trimEnd();
  const share = (raw) => {
    const lines = raw.split(/\r?\n/);
    const mask = commentLedMask(raw);
    const cm = lines.filter((_, i) => mask[i]);
    const chars = cm.reduce((s, l) => s + l.length + 1, 0);
    return { lines: lines.length, commentLines: cm.length, commentShare: +((100 * chars) / Math.max(1, raw.length)).toFixed(1) };
  };
  return {
    policy: PAIR_COMMENTS,
    defectChars: d.length,
    cleanChars: c.length,
    delta: c.length - d.length,
    deltaPct: +((100 * (c.length - d.length)) / Math.max(1, d.length)).toFixed(1),
    defectCommentShare: share(d).commentShare,
    cleanCommentShare: share(c).commentShare,
    // `keep-both` is not free: the clean side's comment lines that carry this item's own rubric vocabulary
    // are a leak into a control. Measured per item, so the policy choice is evidence and not a preference.
    cleanCommentsLeaking: it ? (() => { const cl = c.split(/\r?\n/); const mask = commentLedMask(c); return cl.filter((_, i) => mask[i]).map((l) => l.trim()).filter((l) => rubricPhrases(it).some((p) => l.toLowerCase().includes(p.toLowerCase()))); })() : [],
  };
}

/** The two texts a pair is SHOWN, under the policy. Both sides get the SAME treatment unless the caller asks
 *  for the 2026-10-28 configuration, which is kept runnable so its tables stay reproducible. */
export function pairTexts(defectRaw, cleanRaw) {
  const d = defectRaw.trimEnd();
  const c = cleanRaw.trimEnd();
  const strip = PAIR_COMMENTS === "strip-both" || PAIR_COMMENTS === "strip-clean-only";
  let defect = PAIR_COMMENTS === "strip-both" ? stripCommentLines(d) : d;
  let clean = strip ? stripCommentLines(c) : c;
  let downgraded = null;
  // Symmetry outranks the policy: if stripping makes a text stop parsing, BOTH sides go back to authentic, so
  // the pair is still matched and the item is still measured — with the downgrade named, not swallowed.
  if (strip && (!parses(defect, "paircheck-defect.mjs") || !parses(clean, "paircheck-clean.mjs"))) {
    downgraded = `${PAIR_COMMENTS} -> keep-both (a stripped text did not parse)`;
    defect = d;
    clean = c;
  }
  const account = pairAccount(defectRaw, cleanRaw);
  // What was SHOWN, distinct from what was RAW: under strip-both the shown pair is smaller than the file, and a
  // reader comparing arms needs both numbers to see what the policy cost (199).
  account.shownDefectChars = defect.length;
  account.shownCleanChars = clean.length;
  account.policyApplied = downgraded || PAIR_COMMENTS;
  return { defect, clean, account, downgraded };
}
