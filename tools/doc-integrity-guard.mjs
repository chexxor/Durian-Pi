// Delegate-landed instrument (2026-10-29, ROADMAP 233 hygiene family; the product home is docs/ROADMAP.md **262**).
//
// WHY. Four of this session's surprise difficulties were **false greens**: a write reported
// `Successfully replaced 1 block(s)` and never wrote, so `docs/ROADMAP.md` **260**/**261** did not exist while
// `docs/NEXT.md` cited them; a runbook I added had no front matter and NOTHING noticed — `cli.mjs check` answers
// "no runbook data was supplied, so no runbook can be judged" for all three runbook rules, and
// `scripts/clockin.mjs:123` does `if (!fm) continue;`, i.e. a header-less runbook is invisible to the only consumer
// that reads real runbooks; the pointer cap rejected a file at 200 lines while `wc -l` said 200 (the test counts
// `split("\n")`, so the passing maximum is 199); and index rows were added while their target files were not.
// Advice about those traps is prose, and prose already failed — docs/runbooks/README.md's own anti-pattern table calls
// it "Precondition as prose only — the exact 2026-10-16 failure — enforced in code instead". This is the code version,
// scoped to what a delegate can see from the tree.
//
// Read-only: it never writes, never opens the store, never contacts a model server.
//
// Checks, all deterministic: the docs/NEXT.md pointer cap; a ROADMAP item referenced in no live doc; a runbook
// header that does not match the README index; and env-name fidelity (#6335) - a command in a live doc that still
// sets the superseded store selector.
//
// Usage:  node tools/doc-integrity-guard.mjs [--soft] [--quiet]
// Exit:   0 = no hard findings; 1 = hard findings (fix them before you report or commit).

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { RUNBOOK_FRONT_MATTER_KEYS } from "../src/checkup.mjs"; // one source of truth for the mandatory keys

const root = process.cwd();
const showSoft = process.argv.includes("--soft");
const quiet = process.argv.includes("--quiet");
const hard = [];
const soft = [];

const read = (p) => {
  try {
    return readFileSync(resolve(root, p), "utf8");
  } catch {
    return null;
  }
};

/* 1. The pointer cap. The test counts split("\n") of the file contents, which for a file ending in a newline is
 *    wc -l + 1 — so the cap of 200 counted-lines is wc -l <= 199. Getting this backwards cost three red runs. */
const nextText = read("docs/NEXT.md");
if (nextText === null) hard.push("HARD POINTER  docs/NEXT.md is missing — the next session has only this file");
else {
  const counted = nextText.split("\n").length;
  if (counted > 200)
    hard.push(`HARD POINTER  docs/NEXT.md counts ${counted} lines (split("\\n")); the cap is 200, i.e. wc -l <= 199. Move the oldest session VERBATIM to docs/NEXT-ARCHIVE.md and prove it: diff <(git show <pre-cut sha>:docs/NEXT.md) <(sed -n "s,e p" docs/NEXT-ARCHIVE.md)`);
}

/* 2. Roadmap references that resolve to nothing. The failure class: NEXT.md cited item 260 and 261 for an hour while
 *    ROADMAP.md contained neither, because the edit that "registered" them never wrote. */
const roadmap = read("docs/ROADMAP.md") || "";
const items = new Set();
for (const m of roadmap.matchAll(/^\*\*(\d{1,4})\.\s/gm)) items.add(Number(m[1]));
for (const m of roadmap.matchAll(/^(\d{1,4})\.\s/gm)) items.add(Number(m[1]));
for (const m of roadmap.matchAll(/^\|\s*(\d{1,4})\s*\|/gm)) items.add(Number(m[1]));
// Two registration forms exist in the file and both must count: `**254. title` (87 of them, the recent style) and a
// plain `231. title` numbered list (186). Missing one of them made the guard cry wolf on ~30 pre-existing reviews.
// Numbers under 400 that are not roadmap ids. Every entry is here because it is a measurement, not an item.
const NOT_ITEMS = new Set([10, 20, 25, 30, 50, 60, 75, 90, 100, 200, 300, 400, 500, 1000, 1024, 2048, 4096]);
const HARD_CITE = ["docs/NEXT.md", "docs/runbooks"];
const SOFT_CITE = ["docs/DECISIONS.md", "docs/reviews"];
const expand = (sites) => {
  const out = [];
  for (const s of sites) {
    const abs = resolve(root, s);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isFile()) out.push(s);
    else out.push(...readdirSync(abs).filter((f) => f.endsWith(".md")).map((f) => `${s}/${f}`));
  }
  return out;
};
// A bold number is a roadmap reference UNLESS the words right after it make it a quantity. Without this, a runbook line
// reading "(1:1, including one with **269** entries)" is reported as a missing item — a false positive that would train
// everyone to ignore the guard.
const QUANTITY = /^(?:entries|entry|rows?|lines?|items?|prompts?|cells?|seats?|files?|tokens?|chars?|bytes?|messages?|turns?|samples?|runs?|arms?|%|MiB|GiB|MB|GB|ms|s\b|min|h\b)/;
const unmatched = (rel, out) => {
  const text = read(rel);
  if (!text) return;
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/\*\*(\d{1,4})(?:[–-]\*\*)?(\d{1,4})?\*\*/g)) {
      const after = line.slice(m.index + m[0].length).replace(/^\s+/, "");
      if (QUANTITY.test(after)) continue;
      for (const n of [Number(m[1]), Number(m[2])]) {
        if (!n || n > 400 || NOT_ITEMS.has(n) || items.has(n)) continue;
        out.push(`${rel} cites **${m[1]}** but docs/ROADMAP.md registers no item ${n} (registration never landed, or it is a measurement — add to NOT_ITEMS with a comment)`);
      }
    }
  }
};
// The pointer is what a future session reads, and the runbooks are what it follows when the pointer says to — those two
// must resolve or the next session hunts for rules that do not exist (my items 260/261 sat cited-but-missing for an hour).
// DECISIONS.md and the review notes are checked too, but as a count: they carry pre-existing references the team owns
// (docs/ROADMAP.md 262 asks to fold this into `check` and settle the whole corpus at once).
const hardRefs = [];
const softRefs = [];
for (const rel of expand(HARD_CITE)) unmatched(rel, hardRefs);
for (const rel of expand(SOFT_CITE)) unmatched(rel, softRefs);
for (const f of hardRefs) hard.push("HARD ROADMAP  " + f);
if (softRefs.length)
  soft.push(`SOFT ROADMAP  ${softRefs.length} unresolved item reference(s) in docs/DECISIONS.md + docs/reviews (pre-existing corpus; 262 folds it into check). Sample: ${softRefs.slice(0, 3).join("  |  ")}`);

/* 3. Runbook files that the index cannot reach, and index rows that reach nothing. A runbook nobody can find is a
 *    runbook that does not exist when the symptom fires. */
const runbookDir = resolve(root, "docs/runbooks");
const files = existsSync(runbookDir)
  ? readdirSync(runbookDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "_template.md")
      .sort()
  : [];
const readme = read("docs/runbooks/README.md") || "";
for (const f of files) {
  if (!readme.includes(`(${f})`) && !readme.includes(`runbooks/${f}`))
    soft.push(`SOFT INDEX    docs/runbooks/${f} is not in the docs/runbooks/README.md symptom table — nobody will find it`);
}
for (const m of readme.matchAll(/\]\(([a-z0-9-]+\.md)\)/g)) {
  if (!existsSync(resolve(runbookDir, m[1]))) hard.push(`HARD INDEX    docs/runbooks/README.md links ${m[1]} which does not exist`);
}

/* 4. Front matter. Mandatory per docs/runbooks/README.md ("Front-matter (mandatory)") with keys from
 *    src/checkup.mjs RUNBOOK_FRONT_MATTER_KEYS. Today a file with NO header is invisible: cli.mjs check skips all three
 *    runbook rules ("no runbook data was supplied"), and scripts/clockin.mjs:123 `if (!fm) continue;`. My own new
 *    runbook was in that state when the guard first ran. */
for (const f of files) {
  const text = read(`docs/runbooks/${f}`) || "";
  const block = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!block) {
    hard.push(`HARD HEADER   docs/runbooks/${f} has no front-matter block — both consumers skip it silently (clockin.mjs:123), so the convention cannot fail`);
    continue;
  }
  const missing = RUNBOOK_FRONT_MATTER_KEYS.filter((k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(block[1]));
  if (missing.length) hard.push(`HARD HEADER   docs/runbooks/${f} front matter missing key(s): ${missing.join(", ")}`);
  const lv = (block[1].match(/^\s*last_verified\s*:\s*(\S+)/m) || [])[1];
  if (lv && lv !== "unverified" && !/^\d{4}-\d{2}-\d{2}$/.test(lv)) soft.push(`SOFT HEADER   docs/runbooks/${f} last_verified "${lv}" is neither a date nor unverified`);
  if ((block[1].match(/^\s*runbook\s*:\s*(\S+)/m) || [])[1] !== f.replace(/\.md$/, ""))
    soft.push(`SOFT HEADER   docs/runbooks/${f} front-matter runbook: key does not mirror the file stem`);
}

/* 5. Env-name fidelity (#6335). The #5911 sweep corrected the superseded store selector by hand, and a hand
 *    sweep rots: nothing checked it, so a runbook written a week later could carry the dead name again and every
 *    consumer - cli.mjs resolve(CFG.DURIG_DB ?? "./rig.sqlite"), src/config.mjs CONFIG_KEYS - silently falls back to
 *    ./rig.sqlite. Measured in this tree (2026-11-11, worktree item-6335 off 35001c3a):
 *      git grep -n DURIAN_PI_DB -- scripts/ src/ cli.mjs  -> ONE hit: scripts/clockin.mjs
 *      `DURIAN_PI_DB=./nope.sqlite node cli.mjs status`   -> "db": "./rig.sqlite", exit 1, cause no_store
 *    So the name is not merely deprecated: a command carrying it runs, opens the WRONG store, and reports success.
 *    The exception is real and is named, not waved at: scripts/clockin.mjs resolves
 *    `process.env.DURIAN_PI_DB || process.env.DURIG_DB || "./selfdev.sqlite"`, so a clockin command using the old
 *    name is correct, and a guard that flagged it would be wrong (docs/DELEGATE-CLOCKIN.md "The store is selected by
 *    --db, DURIAN_PI_DB or DURIG_DB").
 *    Cited by key and symbol, never by line number - line numbers drift (see #6320). */
const LIVE_STORE_ENV = "DURIG_DB";
const DEAD_STORE_ENV = "DURIAN_PI_DB";
/** The ONE entry point that genuinely honours the dead name. A line naming it is documentation, not a defect. */
const HONOURS_DEAD_NAME = /clockin/i;
/** Lines that REPORT what the dead name does (an outcome on the same line) are evidence about the name, not an
 *  instruction to use it. Without this, the runbooks' own proof lines would flag and train people to ignore the guard. */
const OUTCOME_MARKER = /→|\bno_store\b|\binert\b|\bignored\b|\bsilently\b|\bfallback\b/;
/** Command-shaped = the assignment is the command the reader is meant to run. Written as regex literals: building
 *  these with new RegExp() from a template string silently eats `\s` and turns `\b` into a backspace, which is how
 *  this rule first went quietly green instead of red. */
const COMMAND_SHAPE = [
  /\bDURIAN_PI_DB\s*=\s*[^\s|;)]+\s+(?:node|bash|sh|pwsh|powershell)\b/,
  /\$env:DURIAN_PI_DB\s*=/,
  /\bexport\s+DURIAN_PI_DB=/,
  /Remove-Item\s+Env:DURIAN_PI_DB/,
  /\benv\s+DURIAN_PI_DB=/,
];
/** Live instruction surfaces. docs/NEXT-ARCHIVE.md is excluded on purpose (verbatim history, the same exemption the
 *    citation rule uses), and docs/ROADMAP.md too: its `Applied 2026-10-11:` lines are dated records of what was run,
 *    not commands to run. */
const ENV_SITES = [
	"README.md",
	"AGENTS.md",
	"docs/QUICKSTART.md",
	"docs/STATUS.md",
	"docs/FEATURES.md",
	"docs/TUI-TESTING.md",
	"docs/DELEGATE-CLOCKIN.md",
	"docs/SELFDEV.md",
	"docs/runbooks",
];
let deadNameHits = 0;
for (const rel of expand(ENV_SITES)) {
  const text = read(rel);
  if (!text) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!COMMAND_SHAPE.some((re) => re.test(line))) return;
    if (HONOURS_DEAD_NAME.test(line)) return; // scripts/clockin.mjs really does read it: the named exception
    if (OUTCOME_MARKER.test(line)) return; // the line reports what the dead name does: evidence, not an instruction
    deadNameHits++;
    hard.push(
      `HARD ENV NAME  ${rel}:${i + 1} runs a command with the superseded store selector ${DEAD_STORE_ENV}. ` +
        `The CLI resolves ${LIVE_STORE_ENV} only - cli.mjs does ` + `resolve(CFG.DURIG_DB ?? "./rig.sqlite")` + `, and ` +
        `src/config.mjs CONFIG_KEYS carries no ${DEAD_STORE_ENV} key - so the command opens ./rig.sqlite while ` +
        `claiming the store it names. The only entry point that honours ${DEAD_STORE_ENV} is scripts/clockin.mjs, ` +
        `which resolves ` + `process.env.DURIAN_PI_DB || process.env.DURIG_DB || "./selfdev.sqlite"` + `. If the line means clockin, say clockin.`,
    );
  });
}
if (!quiet) {
  console.log(`DOC INTEGRITY GUARD  (docs/ROADMAP.md registers ${items.size} items; ${files.length} runbooks; env-name rule scanned ${expand(ENV_SITES).length} files, found ${deadNameHits} dead-name command(s))`);
  for (const h of hard) console.log("  " + h);
  if (showSoft) for (const s of soft) console.log("  " + s);
  else if (soft.length) console.log(`  (${soft.length} soft finding(s) hidden — re-run with --soft)`);
  console.log(`VERDICT: ${hard.length} hard, ${soft.length} soft  →  exit ${hard.length ? 1 : 0}`);
}
process.exit(hard.length ? 1 : 0);
