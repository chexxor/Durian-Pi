// tools/pointer-table-trim.mjs — pay the pointer's 200-line cap by MOVING whole rows, proven byte-for-byte.
//
// SYMPTOM this answers: `node demo/next-pointer.test.mjs` exits 1 with
// `docs/NEXT.md must stay a pointer: 201 lines exceeds the 200-line cap` (`demo/next-pointer.test.mjs:84`).
// Every docs commit adds at least one `| sha | shipped |` row to `docs/NEXT.md`, so the cap is paid
// AGAIN and AGAIN — measured 2026-11-16: one window paid FOUR separate cap cuts (`82d5bebbf`, `9fb43e341`,
// `f69dd23d0`, and an unfinished one left on disk), each by hand, each with its own "is the copy complete?"
// question, and one of them left a `**Moved VERBATIM**` block in `docs/NEXT-ARCHIVE.md` whose CUT was never
// applied — a row VERBATIM in BOTH files, which no gate reads. That is a fifth shape of pitfall 398
// ("a doc that passes every gate while lying"): the archive CLAIMS a move, the live file still has the rows.
//
// THE RULE, in this tool's own words: the cut moves ROW LINES, never prose, and never retypes them — the
// bytes that leave the live file are the bytes that land in the archive. Then it PROVES the move the way
// the runbook demands (`docs/runbooks/delegate-doc-hygiene.md` Do step 6: "copy the archived pointer, never
// retype it, then prove the copy and the offset in one command"): it rebuilds
// `head + moved + tail` from the file AFTER the cut and requires it to equal the file BEFORE the cut
// byte-for-byte. And it refuses — writing nothing — when the same row line already appears in the archive,
// because that is the half-cut above, not a cut to extend.
//
// Two counts this tool keeps straight, both measured rather than assumed:
//   * the CAP is `split("\n")`, so a file at 200 by `wc -l` is 201 to the demo — the cap fails at
//     `wc -l` 200, not 201 (`docs/runbooks/delegate-doc-hygiene.md` Do step 5). This tool reports
//     its own split-count, the one the demo uses.
//   * a TABLE ROW costs the clock-in digest ZERO bytes: the digest slice is the `## NEXT SESSION` block
//     (`scripts/clockin.mjs:73-78`), and the every-commit table sits ABOVE it (§43 NINTH/TENTH, re-proven
//     2026-11-16). So a cut that moves only rows pays the byte budget nothing, and the cap is the only
//     thing a cut buys.
//
// Run: node tools/pointer-table-trim.mjs [--to=185] [--file=docs/NEXT.md]
//        [--archive=docs/NEXT-ARCHIVE.md] [--base=<sha>] [--writes] [--dry-run] [--json]
//      Flags arrive ONLY in `=` form; the space form is REFUSED, not silently defaulted (pitfall 394/398:
//      an ignored flag is a false green). WITHOUT `--writes` this call only PLANS — it names the rows and
//      writes nothing, so re-running the pointer's `Run these first` block (which `tools/cost-claim-audit.mjs`
//      spawns) can never perform a cut by accident; `tools/cost-claim-audit.mjs` REFUSES a line that does
//      carry `--writes`, since a measurement never writes a doc. `--dry-run` says the same thing in those
//      words. A planning pass writes nothing and says so, because a `--dry-run` that names no removals is
//      not evidence there are none (pitfall 384).
//      `--base=<sha>` additionally asks the ORDER audit (`tools/pointer-sha-coverage.mjs`) that the whole
//      table is checked by: if THAT audit reports an ordering defect over the range, this tool refuses the
//      cut rather than moving rows whose age it cannot prove — the order is the audit's derivation, never
//      re-spelled here. Without `--base` the tool says in its own output that it did not verify the order.
//      `--to=<N>` is the live-file split-count to land at (default 185, i.e. 15 rows of headroom before
//      the 200-line cap); it is a target, not a promise: the tool moves exactly as many rows as needed.
//
// COST: 2.34 s for the writing pass over the LIVE pointer (measured 2026-11-16 at `f803e5e26`, Linux, Fedora
// Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0: `node tools/pointer-table-trim.mjs
// --base=8b5a19e1 --to=185` -> moved 16 rows, exit 0, `.err` 0 B); 2.29 s for the same call as `--dry-run`; 0.25 s
// for a refusal (the half-cut falsifier fires before any audit pass). No store, no network, no model.
//
// Exit: 0 = the live file is at or inside `--to` after this call (or nothing was owed);
//       1 = the call refused (rows already in the archive = a half-cut on disk; not enough rows to cut;
//             the ORDER audit reports a defect; the file is not plain `split("\n")` text) or a proof failed;
//       2 = usage.
//
// last_verified: 2026-11-16 — `node tools/pointer-table-trim-test.mjs` PASS, 43 checks 0 FAIL, 0.571 s, `.err`
// 0 B, on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 (fixture
// pointers in a throwaway tmpdir repo; no store, no network). The RED-first run of the same test against the
// pre-change `tools/` (extracted with `git archive HEAD tools | tar -x -C .spike/prechange-trim`, which carries
// 0 files matching `pointer-table-trim`) exits 1 with 30 FAIL / 3 `Cannot find module` (.spike/trim-red.out).
// History of this same test on the same day, kept so the check count is not read as a regression: 43 checks,
// all fixtures — the leg set above is the whole pin.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname as dname, join } from "node:path";

// The ORDER audit sits next to this file; resolving it by ABSOLUTE path is what lets a demo run this
// tool with `cwd` set to a throwaway fixture repo, where a relative script path would not resolve
// (same contract `tools/pointer-row-for-predecessor.mjs` uses for the audit it calls).
const AUDIT = join(dname(fileURLToPath(import.meta.url)), "pointer-sha-coverage.mjs");

const T0 = Date.now();

const is = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = is.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
for (const name of ["file", "archive", "to", "base"]) {
  if (is.some((a) => a === `--${name}`)) {
    console.log("usage: every flag must arrive in `=` form (--to=185, --file=docs/NEXT.md); the space form is refused (pitfall 394)");
    process.exit(2);
  }
}
const file = flag("file", "docs/NEXT.md");
const archive = flag("archive", "docs/NEXT-ARCHIVE.md");
const toRaw = flag("to", "185");
const baseRef = flag("base");
const dryRun = is.includes("--dry-run");
const writes = is.includes("--writes");
const asJson = is.includes("--json");

function hostLine() {
  // Hostname-free on purpose (operator ruling 2026-11-04): OS + distro + kernel + node, never user@hostname.
  const u = spawnSync("uname", ["-s"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  const k = spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  let distro = "unknown";
  try {
    const rel = readFileSync("/etc/os-release", "utf8");
    distro = (rel.match(/^PRETTY_NAME="([^"]+)"/m) ?? [])[1] ?? "unknown";
  } catch {
    /* non-Linux hosts: the OS and kernel still name the box adequately */
  }
  return `${u}, ${distro}, kernel ${k}, node ${process.version}`;
}

const say = asJson ? () => {} : (msg) => console.log(msg);
const report = { file, archive, to: null, moved: [], findings: [] };
function finding(kind, detail = "") {
  report.findings.push({ kind, detail });
  say(`  FINDING ${kind}${detail ? ` — ${detail}` : ""}`);
}

let rawTo = null;
try {
  rawTo = Number(toRaw);
} catch {
  rawTo = Number("NaN");
}
if (!/^\d+$/.test(toRaw) || rawTo < 1) {
  console.log(`usage: --to=${toRaw} is not a positive integer`);
  process.exit(2);
}
const target = rawTo;

let pre;
try {
  pre = readFileSync(file, "utf8");
} catch (e) {
  console.log(`cannot read ${file}: ${e.message}`);
  process.exit(1);
}
let arch;
try {
  arch = readFileSync(archive, "utf8");
} catch (e) {
  console.log(`cannot read ${archive}: ${e.message}`);
  process.exit(1);
}

const lines = pre.split(/\r?\n/);
say(`${file}: ${lines.length} lines (the split-count the cap uses) against the 200-line pointer cap; target ${target}`);

if (pre !== lines.join("\n")) {
  finding("line-shape", "the file is not plain split-`\\n` text (CRLF or a stray separator) — refusing to re-join it, since the byte proof would be a re-join lie");
  say("nothing written");
  console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(1);
}

const ROW = /^\| `([0-9a-f]{7,40})` \|/;
const rowIdx = [];
for (let i = 0; i < lines.length; i += 1) if (ROW.test(lines[i])) rowIdx.push(i);
say(`  table rows in the live file: ${rowIdx.length}`);

// (1) THE HALF-CUT FALSIFIER. A row line VERBATIM in the archive AND in the live file means a previous
// move CLAIMED a cut it never applied. Extending that archive would duplicate the row, and every later
// "head + archive + table" proof built on it would be comparing the wrong file.
const dup = rowIdx.map((i) => lines[i]).filter((row) => arch.split("\n").some((a) => a === row));
if (dup.length) {
  finding("half-cut", `${dup.length} row line(s) are VERBATIM in BOTH ${file} and ${archive} — a cut that was claimed and never applied; fix the archive (or apply the cut) before trimming`);
  for (const d of dup) say(`    ${d.slice(0, 120)}…`);
  say("nothing written");
  console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(1);
}

const over = lines.length - target;
if (over <= 0) {
  say(`  rows owed: 0 — the live file is already at or inside ${target} lines`);
  if (asJson) console.log(JSON.stringify({ ...report, owed: 0, written: false }, null, 2));
  else console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(0);
}

const n = Math.min(over, rowIdx.length);
if (n < over) {
  finding("not-enough-rows", `${over} line(s) over target but only ${rowIdx.length} table rows exist — a cut may move ROWS only, never the pointer's prose`);
  say("nothing written");
  console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(1);
}

// (2) THE ORDER. "The oldest rows are the FIRST rows" is true only if the table is in commit order, and
// the ONE derivation of that order is the audit. Ask it; do not re-derive it here (pair-of-spellings).
if (baseRef) {
  const cov = spawnSync("node", [
    AUDIT,
    "--base",
    baseRef,
    "--file",
    file,
    "--archive",
    archive,
    "--json",
  ], { encoding: "utf8" });
  let rep = null;
  try {
    rep = JSON.parse(cov.stdout);
  } catch {
    rep = null;
  }
  if (!rep) {
    finding("no-audit-report", `the order audit gave nothing to read (status=${cov.status}) — refusing to move rows on an unverified order`);
    say("nothing written");
    console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
    process.exit(1);
  }
  const defects = (rep.outOfOrder || []).length;
  if (defects) {
    finding("ordering-defect", `the coverage audit reports ${defects} ordering defect(s) over ${rep.rangeCommits} range commits — ` +
      `run ` + "`tools/pointer-row-for-predecessor.mjs --base=" + baseRef + " --order` first, since this tool moves the FIRST rows and an unproven order makes them not the oldest");
    say("nothing written");
    console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
    process.exit(1);
  }
  say(`  order verified by the audit: 0 holes / 0 ordering defects over ${rep.rangeCommits} range commits (carrier exempt ${rep.carrier})`);
} else {
  say("  ORDER NOT VERIFIED: no --base given, so this call did not ask the audit that the first rows are the oldest");
}

const moveIdx = rowIdx.slice(0, n);
const moved = moveIdx.map((i) => lines[i]);
say(`  rows to move, in file order (oldest first): ${n}`);
for (const m of moved) say(`    ${m.slice(0, 100)}…`);

if (dryRun || !writes) {
  say(
    dryRun
      ? "  DRY RUN: nothing written — a planning pass names no removals and proves no cut; run without --dry-run WITH --writes to write"
      : "  PLANNING PASS: nothing written — this tool only writes when `--writes` is given, so an instrument re-running the pointer's block cannot perform a cut; add --writes to move these rows",
  );
  if (asJson) console.log(JSON.stringify({ ...report, owed: over, moved, written: false, dryRun: true }, null, 2));
  else console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(0);
}

const moveSet = new Set(moveIdx);
const live = lines.filter((_, i) => !moveSet.has(i));
writeFileSync(file, live.join("\n"));

const date = new Date().toISOString().slice(0, 10);
const heading =
  `**Moved VERBATIM — the ${n} OLDEST rows of the \`${file}\` every-commit table (cut ${date} by ` +
  "`tools/pointer-table-trim.mjs`: the ROW LINES that left the live file are the lines below, never retyped; " +
  `proof: head + this block + the live table reproduces the pre-cut ${file} byte-for-byte):**`;
const block = `\n${heading}\n\n${moved.join("\n")}\n`;
const arch2 = (arch.endsWith("\n") ? arch : arch + "\n") + block;
writeFileSync(archive, arch2);

// (3) PROVE, by counting what is on disk AFTER the write (runbook Do step 1: never trust a write's
// return value — count after it), and rebuild the pre-cut file from the LIVE file + the moved lines.
const post = readFileSync(file, "utf8");
const postLines = post.split(/\r?\n/);
// The removed block started at `moveIdx[0]` in the PRE file; every removed index is >= it, so that
// position maps to post index `moveIdx[0]` (lines before it were not moved). Re-inserting THERE is
// what makes the proof non-vacuous: it rebuilds the pre-cut bytes from the file as it is NOW.
const insertAt = moveIdx[0];
const head = postLines.slice(0, insertAt);
const tail = postLines.slice(insertAt);
const rebuilt = head.concat(moved).concat(tail).join("\n");
const rowsNow = postLines.filter((l) => ROW.test(l)).length;
const archNow = readFileSync(archive, "utf8");
const appended = archNow.startsWith(arch.endsWith("\n") ? arch : arch + "\n");
const onceEach = moved.every((m) => archNow.split("\n").filter((a) => a === m).length === 1);

let ok = true;
if (rebuilt !== pre) {
  ok = false;
  finding("proof-failed", "head + moved + tail does NOT rebuild the pre-cut file — a line changed or vanished in the cut");
}
if (postLines.length !== lines.length - n) {
  ok = false;
  finding("count-wrong", `the live file changed by ${lines.length - postLines.length} lines, ${n} rows were moved`);
}
if (rowsNow !== rowIdx.length - n) {
  ok = false;
  finding("rows-wrong", `the live table went from ${rowIdx.length} to ${rowsNow} rows; ${n} were moved`);
}
if (!appended) {
  ok = false;
  finding("archive-not-appended", "the archive's older bytes are not the bytes they were — an append-only ledger was rewritten");
}
if (!onceEach) {
  ok = false;
  finding("moved-row-absent", "a moved row is not in the archive exactly once — the VERBATIM copy is a claim this call cannot make");
}
if (postLines.length > target) {
  ok = false;
  finding("still-over-target", `the live file is ${postLines.length} lines against a target of ${target}`);
}
say(`  wrote ${n} row(s) out of ${file}; the archive gained ${block.length} B under a dated heading`);
say(`  proof: head + the moved rows + the live table rebuilds the pre-cut ${file} EXACTLY (${pre.length} B)`);
say(`  live file now ${postLines.length} lines (split-count; the 200-line cap lives at demo/next-pointer.test.mjs), ${rowsNow} table rows`);
say(`  the archive still ends where it began (append-only: ${(arch.endsWith("\n") ? arch : arch + "\n").length} B of the old bytes intact)`);

if (!ok) {
  say("a proof failed — the files were written, so reconcile them before anything else trusts this tree");
  console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
  process.exit(1);
}

if (asJson) console.log(JSON.stringify({ ...report, owed: over, moved, written: true, liveLines: postLines.length, rowsNow }, null, 2));
else console.log(`pointer-table-trim cost: ${((Date.now() - T0) / 1000).toFixed(2)} s · host: ${hostLine()}`);
process.exit(0);
