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
//        [--archive=docs/NEXT-ARCHIVE.md] [--no-archive] [--dry-run] [--for=<rev>]
//      `--for=HEAD` also pays the row the NEXT commit will owe for the commit that is HEAD now, so
//      running this tool BEFORE a commit gets the WHOLE cadence in one call (pitfall 384: HEAD can
//      never name itself in the commit that carries it).
//        [--archive docs/NEXT-ARCHIVE.md] [--no-archive] [--dry-run] [--json]
//      This tool takes ONLY the `=` form (`--base=8b5a19e1`, `--file=…`) and REFUSES the space form,
//      because the audit it calls, `tools/pointer-sha-coverage.mjs`, takes only the space form and
//      silently ignores `--base=` (pitfall 398: that false green audited 37 of 197 commits and still
//      exited 0). This tool hands the value to the audit in the form the audit actually reads.
//      `--dry-run` prints the rows and changes nothing: this tool writes into a live doc, so a
//      planning pass is available and its refusal-to-write is stated, not implied.
//
// COST: 1.6 s for a 0-hole pass over a 227-commit range (measured 2026-11-15 on Linux, Fedora Linux
// 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 at `4ea4101b7`:
// `time node tools/pointer-row-for-predecessor.mjs --base=8b5a19e1 --dry-run` -> 1.607 s). Two
// audit passes plus one file write; no store, no network, no model. Re-measure rather than trust.
//
// last_verified: 2026-11-15 — `node tools/pointer-row-for-predecessor-test.mjs` PASS, 24 checks
// 0 FAIL, 0.594 s, on the same host.
//
// Exit: 0 = the audit exits 0 after this call (rows added, or none were owed);
//       1 = the audit still does not exit 0 (holes fixed, ordering defect not — or a write failed);
//       2 = usage.
//
// last_verified: 2026-11-15 — `node tools/pointer-row-for-predecessor-test.mjs` PASS, 31 checks
// 0 FAIL, 0.92 s, on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0 (the throwaway repo is init + a milestone anchor + five commits, and the
// audit is pointed at its `docs/NEXT.md` with `--file`).

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
const asJson = is.includes("--json");
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

const holesText = (report.outOfOrder || []).length
  ? `; ${(report.outOfOrder || []).length} ordering defect(s) are NOT fixable by appending rows`
  : "";
if (!missing.length && !forRow) {
  console.log(`  rows owed: 0 — every range commit is already named${holesText}`);
  process.exit((report.outOfOrder || []).length ? 1 : 0);
}

const rowText = (sha, subject) =>
  `| \`${sha}\` | ${(subject || "").replace(/\|/g, "\\|")} — cadence row named from git's own subject line (\`git log -1 --format=%s ${sha}\`), pitfall 384 |`;
const rows = missing.map((m) => rowText(m.sha, m.subject));
if (forRow) {
  const text = readFileSync(file, "utf8");
  if (text.includes(`\`${forRow.sha}\``)) {
    console.log(`  --for=${forRef} already has a row (${forRow.sha}) — not added twice`);
  } else {
    rows.push(forRow.text);
  }
}
console.log(`  rows to add, in commit order (oldest first, the table's order): ${rows.length}`);
for (const r of rows) console.log(`    ${r.slice(0, 120)}${r.length > 120 ? "…" : ""}`);

const L = readFileSync(file, "utf8").split("\n");
const isRow = (l) => /^\| `[0-9a-f]{7,}` \|/.test(l);
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
process.exit(after.status === 0 ? 0 : 1);
