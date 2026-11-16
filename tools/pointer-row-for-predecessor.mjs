// tools/pointer-row-for-predecessor.mjs — close pitfall 384's cadence hole in ONE call.
//
// SYMPTOM this answers: `tools/pointer-sha-coverage.mjs --base <ref>` exits 1 and prints
// `MISSING   <sha>  <subject>` lines. The pointer's `| sha | shipped |` table must name every
// commit in its range except the one that carries it (a file cannot name the commit inside it),
// so the commit after any pointer move owes a row per pointer commit — and a session that pays
// them one commit at a time pays a commit PER commit (measured 2026-11-15: one window paid EIGHT
// rows-only commits to close one chain, ~13 s of doc gates each).
//
// THE RULE, in this tool's own words: ask the AUDIT what is missing — never re-derive the missing
// set here, that is the pair-of-spellings defect (AGENTS.md / docs/DECISIONS.md) — then append one
// row per missing commit, in commit order, at the BOTTOM of the live table, with text taken from
// git's OWN subject line (`git log -1 --format=%s`), never retyped from memory. Then re-run the
// audit and report its exit code, so the close is proven by the same reader the gate uses.
//
// Run: node tools/pointer-row-for-predecessor.mjs --base=<base-sha> [--file=docs/NEXT.md]
//        [--archive=docs/NEXT-ARCHIVE.md] [--no-archive] [--dry-run] [--for=<rev>] [--order]
//      `--order` additionally PERMUTES the table's existing rows into the commit order the audit
//      reports (`ordered`), so one call closes BOTH shapes the audit can report — a hole AND an
//      ordering defect. Without it, an ordering defect is reported and left alone (appending rows
//      cannot fix one); with it the move is mechanical and no row text is retyped.
//      `--for=HEAD` also pays the row the NEXT commit will owe for the commit that is HEAD now, so
//      running this tool BEFORE a commit gets the WHOLE cadence in one call (pitfall 384: HEAD can
//      never name itself in the commit that carries it). The already-paid leg reads the TABLE's ROWS,
//      not the file: a live pointer names commits in PROSE too, and prose is not a row (pitfall 425).
//      because the audit it calls, `tools/pointer-sha-coverage.mjs`, takes only the space form and
//      silently ignores `--base=` (pitfall 398: that false green audited 37 of 197 commits and still
//      exited 0). This tool hands the value to the audit in the form the audit actually reads.
//      `--dry-run` prints the rows and changes nothing: this tool writes into a live doc, so a
//      planning pass is available and its refusal-to-write is stated, not implied.
//
// COST: 1.6 s for a 0-hole pass over a 227-commit range (measured 2026-11-15 on Linux, Fedora Linux
// 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 at `4ea4101b7`:
// `time node tools/pointer-row-for-predecessor.mjs --base=8b5a19e1 --dry-run` -> 1.607 s). Re-measured
// 2026-11-15 at `edd22c534` with `--order` on the LIVE pointer: `node tools/pointer-row-for-predecessor.mjs
// --base=8b5a19e1 --for=HEAD --order` -> **3.4 s**, exit 0 (one row written, one row already present,
// three audit passes over a 233-commit range; no store, no network, no model). Re-measure rather than trust.
//
// Exit: 0 = the audit exits 0 after this call (rows added, rows reordered, or none were owed);
//       1 = the audit still does not exit 0 (holes fixed but an ordering defect left and `--order`
//             not given, or a write failed);
//       2 = usage.
//
// last_verified: 2026-11-15 — `node tools/pointer-row-for-predecessor-test.mjs` PASS, 38 checks
// 0 FAIL, 1.215 s, on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0 (the throwaway repo is init + a milestone anchor + five commits, and the
// audit is pointed at its `docs/NEXT.md` with `--file`; the new legs pin `--order` and the audit's
// `ordered` list — an out-of-order fixture closes to 0 holes / 0 ordering defects in ONE call, and
// the row texts are the ones that came in). History of this same test on the same day, kept so the
// check count is not read as a regression: 24 checks at `4ea4101b7`, 31 checks at `27d27d2ef`, 38 now
// — the test grew with the `--order` legs; nothing that was pinned before was dropped.
//
// ADDENDUM 2026-11-16 (Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
// git 2.56.0 — probe `uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`,
// measured in the same command as the numbers below): the `--for` already-paid leg moved from a FILE-WIDE
// `includes` to the TABLE's ROWS — a live pointer names commits in prose, and prose is not a row (SELFDEV
// pitfall 425, and the pair-of-spellings shape of pitfall 398 with the roles reversed). The pinned test grew
// leg 6b for exactly that fixture: RED first **exit 1, 3 FAIL / 39 ok, 1.10 s** (`.spike/prow-test-80.out`,
// `.err` 0 B), then after the leg moved **PASS, 42 checks, 0 FAIL, 1.111 s** (`.spike/prow-test-81.out`, `.err`
// 0 B) — so the check count is 24 → 31 → 38 → 42, each step named by the legs it added, nothing dropped. The
// `tools/` path owes the areas at the tree it lands on, and they are named there rather than duplicated here:
// the `toolchain` area and the FULL suite at the tree this fix landed on are in `docs/NEXT.md`'s Tallies block.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname as dname, join } from "node:path";

// The audit this tool calls lives next to it; resolving it by ABSOLUTE path is what lets a demo run
// this tool with `cwd` set to a throwaway repo, where a relative script path would not resolve.
const AUDIT = join(dname(fileURLToPath(import.meta.url)), "pointer-sha-coverage.mjs");

const is = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = is.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
if (is.some((a) => a === `--base` || a === `--file` || a === `--archive`)) {
  console.log("usage: --base must arrive in `=` form (--base=8b5a19e1); the space form is refused (pitfall 394)");
  process.exit(2);
}
const file = flag("file", "docs/NEXT.md");
const archive = flag("archive", "docs/NEXT-ARCHIVE.md");
const noArchive = is.includes("--no-archive");
const dryRun = is.includes("--dry-run");
const fixOrder = is.includes("--order");
const base = flag("base");

// ONE derivation of "what is missing": the audit itself, asked for its report.
// The audit reads SPACE-form flags; passing `--base=` to it would silently narrow the range.
const covArgs = [
  AUDIT,
  ...(base ? ["--base", base] : []),
  "--file", file,
  ...(noArchive ? ["--no-archive"] : ["--archive", archive]),
  "--json",
];
const cov = spawnSync("node", covArgs, { encoding: "utf8" });
if (cov.status !== 0 && cov.status !== 1) {
  console.log(`coverage refused: ${(cov.stdout + cov.stderr).trim().split("\n")[0]}`);
  process.exit(2);
}
let report = null;
try {
  report = JSON.parse(cov.stdout);
} catch {
  console.log(`coverage gave no report to read: status=${cov.status} ${(cov.stderr || cov.stdout).trim().slice(0, 200)}`);
  process.exit(2);
}
const missing = report.missing || [];
console.log(
  `pointer-row-for-predecessor — ${file}: the audit reports ${missing.length} hole(s) over ${report.rangeCommits} range commits (carrier exempt ${report.carrier})`,
);

// `--for=<rev>` pays the row the NEXT commit will owe for the commit that is HEAD now: HEAD can
// never name itself in the commit that carries it (pitfall 384), so a session running this tool
// BEFORE it commits gets the whole cadence in one call — the holes plus the row for HEAD.
const forRef = flag("for");
const forRow = (() => {
  if (!forRef) return null;
  const one = spawnSync("git", ["log", "-1", "--format=%h%x09%s", forRef], { encoding: "utf8" });
  if (one.status !== 0) {
    console.log(`--for=${forRef} names no commit: ${(one.stderr || one.stdout).trim().slice(0, 120)}`);
    process.exit(2);
  }
  const [sha, ...rest] = one.stdout.trim().split("\t");
  const subj = rest.join("\t");
  return { sha, subject: subj, text: `| \`${sha}\` | ${subj.replace(/\|/g, "\\|")} — cadence row of pitfall 384: the commit that carries the pointer cannot name itself, so the NEXT commit owes this row; text from git's own subject line (\`git log -1 --format=%s ${sha}\`) |` };
})();

// `isRow`, `shaOfRow` and `applyOrder` sit ABOVE the early exit because `--order` runs on the path
// where NO row is owed but the table is out of order; a `const` declared below it is in the temporal
// dead zone there (ReferenceError, not a clean refusal).
const isRow = (l) => /^\| `[0-9a-f]{7,}` \|/.test(l);
const shaOfRow = (l) => (l.match(/^\| `([0-9a-f]{7,40})` \|/) ?? [, ""])[1];
// `--order`: the mechanical permutation. The ORDER comes from the AUDIT's `ordered` list — this
// tool never re-derives it from `git log` here, which would be a second spelling of one rule. A row
// is MOVED, never rewritten: the text that leaves the file is the text that came in, so a reorder
// cannot be a place to invent a row label (pitfall 398's shape two). Rows naming something outside
// the audited range keep their position; they are anchors, not holes.
const applyOrder = (path, rep) => {
  const lines = readFileSync(path, "utf8").split("\n");
  const ordered = rep.ordered || [];
  const rankOf = (rowSha) => {
    for (let i = 0; i < ordered.length; i += 1) {
      const s = ordered[i];
      if (rowSha.startsWith(s) || s.startsWith(rowSha)) return i;
    }
    return null;
  };
  const slots = [];
  for (let k = 0; k < lines.length; k += 1) if (isRow(lines[k]) && rankOf(shaOfRow(lines[k])) !== null) slots.push(k);
  const texts = slots.map((k) => lines[k]);
  texts.sort((a, b) => rankOf(shaOfRow(a)) - rankOf(shaOfRow(b)));
  let moved = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (lines[slots[i]] !== texts[i]) moved += 1;
    lines[slots[i]] = texts[i];
  }
  if (moved) writeFileSync(path, lines.join("\n"));
  return moved;
};

const holesText = (report.outOfOrder || []).length
  ? `; ${(report.outOfOrder || []).length} ordering defect(s) are NOT fixable by appending rows`
  : "";
if (!missing.length && !forRow) {
  if (fixOrder && (report.outOfOrder || []).length) {
    const moved = applyOrder(file, report);
    const again = spawnSync("node", covArgs, { encoding: "utf8" });
    let rep2 = null;
    try { rep2 = JSON.parse(again.stdout); } catch { rep2 = null; }
    console.log(`  --order: ${moved} row(s) MOVED into commit order (a permutation — no row text retyped); re-audit: ${(again.stdout || again.stderr).trim().split("\n")[0]}`);
    if (rep2) console.log(`  re-audit verdict: ${rep2.missing.length} hole(s), ${(rep2.outOfOrder || []).length} ordering defect(s)`);
    process.exit(again.status === 0 ? 0 : 1);
  }
  console.log(`  rows owed: 0 — every range commit is already named${holesText}`);
  process.exit((report.outOfOrder || []).length ? 1 : 0);
}

const rowText = (sha, subject) =>
  `| \`${sha}\` | ${(subject || "").replace(/\|/g, "\\|")} — cadence row named from git's own subject line (\`git log -1 --format=%s ${sha}\`), pitfall 384 |`;
const rows = missing.map((m) => rowText(m.sha, m.subject));
if (forRow) {
  // The dedup leg reads the TABLE's ROWS, never the whole file: a LIVE pointer NAMES commits in prose
  // (a `Run these first` intro re-pointed at the state an audit ran on, a tally line, a decision title),
  // so a file-wide `includes` read that prose as "the row is already there", paid nothing, and the NEXT
  // commit's audit reported a hole the closer had claimed was paid. Measured 2026-11-16 at `1690d835f`:
  // line 137 of docs/NEXT.md names `1690d835f` in prose and NO row does, so `--for=HEAD` suppressed the
  // row (SELFDEV pitfall 425; pinned by tools/pointer-row-for-predecessor-test.mjs leg 6b).
  const rowShas = readFileSync(file, "utf8").split("\n").filter(isRow).map(shaOfRow);
  if (rowShas.some((s) => s.startsWith(forRow.sha) || forRow.sha.startsWith(s))) {
    console.log(`  --for=${forRef} already has a row in the table (${forRow.sha}) — not added twice`);
  } else {
    rows.push(forRow.text);
  }
}
console.log(`  rows to add, in commit order (oldest first, the table's order): ${rows.length}`);
for (const r of rows) console.log(`    ${r.slice(0, 120)}${r.length > 120 ? "…" : ""}`);

const L = readFileSync(file, "utf8").split("\n");
let lastRow = -1;
for (let k = 0; k < L.length; k += 1) if (isRow(L[k])) lastRow = k;
if (lastRow < 0) {
  console.log("  no `| sha | shipped |` table rows in the file — refusing to invent a table");
  process.exit(1);
}

if (dryRun) {
  console.log("  DRY RUN: nothing written (a planning pass names no removals and proves nothing — pitfall 384); run without --dry-run to write");
  process.exit(0);
}

for (let k = 0; k < rows.length; k += 1) L.splice(lastRow + 1 + k, 0, rows[k]);
writeFileSync(file, L.join("\n"));
console.log(`  wrote ${rows.length} row(s) at line ${lastRow + 1} of ${file}`);

// Prove the close with the SAME reader the gate uses, not with this tool's own arithmetic.
const after = spawnSync("node", covArgs, { encoding: "utf8" });
let rep = null;
try {
  rep = JSON.parse(after.stdout);
} catch {
  rep = null;
}
console.log(`  re-audit: ${(after.stdout || after.stderr).trim().split("\n")[0]}`);
if (rep) console.log(`  re-audit verdict: ${rep.missing.length} hole(s), ${(rep.outOfOrder || []).length} ordering defect(s)`);
if (fixOrder && rep && (rep.outOfOrder || []).length) {
  // Appending a row for an OLD hole at the bottom is exactly what makes an otherwise-clean table
  // report an ordering defect; `--order` closes that in the same call instead of paying another commit.
  const moved = applyOrder(file, rep);
  const again = spawnSync("node", covArgs, { encoding: "utf8" });
  let rep2 = null;
  try { rep2 = JSON.parse(again.stdout); } catch { rep2 = null; }
  console.log(`  --order: ${moved} row(s) MOVED into commit order (a permutation — no row text retyped); re-audit: ${(again.stdout || again.stderr).trim().split("\n")[0]}`);
  if (rep2) console.log(`  re-audit verdict: ${rep2.missing.length} hole(s), ${(rep2.outOfOrder || []).length} ordering defect(s)`);
  process.exit(again.status === 0 ? 0 : 1);
}
process.exit(after.status === 0 ? 0 : 1);
