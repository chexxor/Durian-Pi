// tools/pointer-row-for-predecessor-test.mjs — the cadence-row closer adds EVERY row the audit says
// is missing, in commit order, from git's own subject line, and proves the close with the audit.
//
// WHY THIS FILE EXISTS. Pitfall 384's cadence — a file cannot name the commit that carries it, so
// the commit after a pointer move owes one table row per pointer commit — cost one window EIGHT rows-
// only commits, each paying its own ~13 s of doc gates (measured 2026-11-15). The fix is one call
// that writes them all. Two lies this test exists to keep out: a generator that RETYPES a row
// instead of taking git's own subject line (pitfall 398's shape two), and a generator that CLAIMS a
// close it has not re-audited (pitfall 384's "a `--dry-run` that names no removals is not evidence").
//
// FAILING-FIRST: before `tools/pointer-row-for-predecessor.mjs` existed every spawn here exited
// non-zero with "Cannot find module", so every check below failed.
//
// The throwaway repo is the one `tools/pointer-sha-coverage-test.mjs` builds: init + a milestone
// ANCHOR (named by no row) + shipped commits, and `docs/NEXT.md` pointed at with `--file`.
//
// Run: node tools/pointer-row-for-predecessor-test.mjs  (exit 0 = pass)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "durig-pointer-rows-"));
const repo = join(root, "repo");
const closer = join(process.cwd(), "tools", "pointer-row-for-predecessor.mjs");
const audit = join(process.cwd(), "tools", "pointer-sha-coverage.mjs");

const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
// Both tools take a pointer path RELATIVE to the cwd they are run from — that is the contract a
// session uses from a repo root, and it is what makes the audit inherit the fixture's cwd.
const runAudit = (args) => spawnSync(process.execPath, [audit, ...args], { encoding: "utf8", cwd: repo });
const runCloser = (args) => spawnSync(process.execPath, [closer, ...args], { encoding: "utf8", cwd: repo });
const pointer = join(repo, "docs", "NEXT.md");

try {
  console.log("\n=== pointer-row-for-predecessor ===\n");
  spawnSync("mkdir", ["-p", join(repo, "docs")], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");

  // c0 is the milestone ANCHOR (named by no row); c1..c4 are shipped objects; c4 is the carrier.
  const shas = [];
  const subjects = [];
  for (const n of [0, 1, 2, 3, 4]) {
    const subject = `object ${n}: shipped a thing`;
    writeFileSync(join(repo, `file-${n}.txt`), `object ${n}\n`);
    git("add", `file-${n}.txt`);
    git("commit", "-q", "-m", subject);
    shas.push(git("rev-parse", "--short", "HEAD").stdout.trim());
    subjects.push(subject);
  }
  const [c0, c1, c2, c3, c4] = shas;
  const tableOf = (list) => ["# pointer", "", "| sha | shipped |", "|---|---|", ...list, ""].join("\n");

  // (1) RED FIRST: the table names only c1 — TWO holes (c2, c3), the carrier (c4) exempt.
  writeFileSync(pointer, tableOf([`| \`${c1}\` | the first row |`]));
  const before = runAudit(["--base", c0, "--file", "docs/NEXT.md", "--no-archive", "--json"]);
  check("a table missing rows exits 1", before.status === 1, `status=${before.status}`);
  const beforeReport = JSON.parse(before.stdout);
  const holes = (beforeReport.missing || []).map((m) => m.sha);
  check("the audit reports BOTH holes", holes.join(",") === [c2, c3].join(","), before.stdout);
  check("the carrier is exempt, not a hole", beforeReport.carrier === c4, before.stdout);

  // (2) A planning pass names the rows and writes nothing.
  const bytesBefore = readFileSync(pointer, "utf8").length;
  const dry = runCloser([`--base=${c0}`, "--file=docs/NEXT.md", "--no-archive", "--dry-run"]);
  check("the tool exits 0 on a planning pass", dry.status === 0, `status=${dry.status}\n${dry.stdout}`);
  check(
    "the planning pass names every hole it will fill",
    dry.stdout.includes(`the audit reports ${holes.length} hole(s)`) && dry.stdout.includes("rows to add, in commit order"),
    dry.stdout,
  );
  check("the planning pass writes nothing", readFileSync(pointer, "utf8").length === bytesBefore, "the pointer changed");
  check(
    "the planning pass refuses to be read as a close",
    dry.stdout.includes("DRY RUN") && dry.stdout.includes("run without --dry-run to write"),
    dry.stdout,
  );

  // (3) The writing pass: every row, in commit order, at the BOTTOM, text from git's OWN subject.
  const wrote = runCloser([`--base=${c0}`, "--file=docs/NEXT.md", "--no-archive"]);
  check("the writing pass exits 0", wrote.status === 0, `status=${wrote.status}\n${wrote.stdout}`);
  const lines = readFileSync(pointer, "utf8").split("\n");
  const rowFor = (sha) => lines.find((l) => l.startsWith(`| \`${sha}\` |`));
  const row2 = rowFor(c2);
  const row3 = rowFor(c3);
  check("a row for c2 exists", row2 !== undefined, lines.join("\n"));
  check("a row for c3 exists", row3 !== undefined, lines.join("\n"));
  check(
    "the row text is git's own subject line, not a retelling",
    row2.includes(subjects[2]) && row3.includes(subjects[3]),
    `${row2}\n${row3}`,
  );
  check("the rows are in COMMIT order (c2 before c3)", lines.indexOf(row2) < lines.indexOf(row3), lines.join("\n"));
  check(
    "the new rows sit BELOW the old row (commit order, not inserted on top)",
    lines.indexOf(row2) > lines.indexOf(`| \`${c1}\` | the first row |`),
    lines.join("\n"),
  );
  check(
    "ONE pass closed BOTH holes (the cadence costs one commit, not one per commit)",
    wrote.stdout.includes("re-audit verdict: 0 hole(s), 0 ordering defect(s)"),
    wrote.stdout,
  );

  // (4) Idempotent: a complete table owes no rows and the file is untouched.
  const bytesNow = readFileSync(pointer, "utf8").length;
  const again = runCloser([`--base=${c0}`, "--file=docs/NEXT.md", "--no-archive"]);
  check("a second pass owes no rows", again.stdout.includes("rows owed: 0"), again.stdout);
  check("a second pass exits 0", again.status === 0, `status=${again.status}`);
  check("a second pass writes nothing", readFileSync(pointer, "utf8").length === bytesNow, "the pointer changed");

  // (5) An ORDERING defect is not a hole: appending rows cannot fix it, and the tool must say so.
  writeFileSync(
    pointer,
    tableOf([`| \`${c3}\` | the middle row |`, `| \`${c1}\` | the first row |`, `| \`${c2}\` | the second row |`]),
  );
  const disorder = runCloser([`--base=${c0}`, "--file=docs/NEXT.md", "--no-archive"]);
  check("an out-of-order table exits 1", disorder.status === 1, `status=${disorder.status}\n${disorder.stdout}`);
  check(
    "it says the defect is NOT fixable by appending rows",
    disorder.stdout.includes("ordering defect") && disorder.stdout.includes("NOT fixable"),
    disorder.stdout,
  );
  check(
    "it did not paper the problem over by adding a row",
    readFileSync(pointer, "utf8").split("\n").filter((l) => l.startsWith("| `")).length === 3,
    readFileSync(pointer, "utf8"),
  );

  // (6) `--for=HEAD` pays the row the NEXT commit will owe, so ONE pre-commit call does the whole
  // cadence: HEAD can never name itself in the commit that carries it (pitfall 384).
  writeFileSync(pointer, tableOf([`| \`${c1}\` | the first row |`, `| \`${c2}\` | the second row |`, `| \`${c3}\` | the third row |`]));
  const paid = runCloser([`--base=${c0}`, "--file=docs/NEXT.md", "--no-archive", "--for=HEAD"]);
  check("--for=HEAD on a hole-free table exits 0", paid.status === 0, `status=${paid.status}\n${paid.stdout}`);
  check("it adds exactly one row", paid.stdout.includes("rows to add, in commit order (oldest first, the table's order): 1"), paid.stdout);
  const linesPaid = readFileSync(pointer, "utf8").split("\n");
  const row4 = linesPaid.find((l) => l.startsWith(`| \`${c4}\` |`));
  check("the row is for HEAD, and its text is git's own subject line", row4 !== undefined && row4.includes(subjects[4]), linesPaid.join("\n"));
  check("it says the row is for the commit that cannot name itself", row4 !== undefined && row4.includes("cannot name itself"), row4 === undefined ? "no row" : row4);
  check("the close is still proven by the audit", paid.stdout.includes("re-audit verdict: 0 hole(s), 0 ordering defect(s)"), paid.stdout);
  const paidAgain = runCloser([`--base=${c0}`, "--file=docs/NEXT.md", "--no-archive", "--for=HEAD"]);
  check("a second --for pass does not add the row twice", paidAgain.stdout.includes("already has a row"), paidAgain.stdout);
  check("and it exits 0", paidAgain.status === 0, `status=${paidAgain.status}`);

  // (7) The flag form is REFUSED, not silently defaulted — by the closer, and by the audit it calls.
  const spaceForm = runCloser(["--base", c0, "--file=docs/NEXT.md", "--no-archive"]);
  check("the closer refuses the space form", spaceForm.status === 2, `status=${spaceForm.status}`);
  check("and names the form it wants", (spaceForm.stdout + spaceForm.stderr).includes("`=` form"), spaceForm.stdout + spaceForm.stderr);
  const equalsAudit = runAudit([`--base=${c0}`, "--file", "docs/NEXT.md"]);
  check(
    "the audit refuses the `=` form too (it used to fall back to merge-base and report a FALSE green over a narrowed range)",
    equalsAudit.status === 2,
    `status=${equalsAudit.status}\n${equalsAudit.stdout}${equalsAudit.stderr}`,
  );
  check(
    "the refusal says what the fallback used to do",
    (equalsAudit.stdout + equalsAudit.stderr).includes("space form"),
    equalsAudit.stdout + equalsAudit.stderr,
  );

  console.log(`\npointer-row-for-predecessor test: ${failures === 0 ? "PASS" : `${failures} FAIL(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
