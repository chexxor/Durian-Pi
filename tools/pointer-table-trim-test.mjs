// tools/pointer-table-trim-test.mjs — the pointer's line cap is paid by MOVING row lines, and the move is PROVEN.
//
// WHY THIS FILE EXISTS (docs/failing-first-recipe.md METHOD 1 — the test is the gate; the tool is the answer):
// every docs commit adds a row to `docs/NEXT.md`, so the 200-line pointer cap (`demo/next-pointer.test.mjs:84`)
// is paid over and over, and it was paid by hand FOUR times in one window (2026-11-16: `82d5bebbf`, `9fb43e341`,
// `f69dd23d0`, plus one left unfinished ON DISK). The unfinished one is the reason this test exists: `docs/NEXT-ARCHIVE.md`
// gained a `**Moved VERBATIM**` block whose CUT was never applied, so four row lines were VERBATIM in BOTH files
// — `demo/next-pointer.test.mjs`, `tools/pointer-sha-coverage.mjs` and `tools/doc-integrity-guard.mjs` all stayed
// exit 0 over it. A fifth shape of pitfall 398 (a doc that passes every gate while lying), and the falsifier is
// one call: `node tools/pointer-table-trim.mjs --base=<pointer-base> --to=185` exits 1 naming the duplicate rows.
//
// RED FIRST (one bounded call, before the tool existed):
//   mkdir -p .spike/prechange-trim && git archive HEAD tools | tar -x -C .spike/prechange-trim
//   ls .spike/prechange-trim/tools | grep -c 'pointer-table-trim'        # -> 0, exit 1: the tree has no such tool
//   node tools/pointer-table-trim-test.mjs --tool .spike/prechange-trim/tools/pointer-table-trim.mjs
//   -> exit 1 with `Cannot find module` on every spawn (the numbers are in the shipped commit's .spike/ artifacts).
//
// CLOSED SET OF OUTCOMES pinned below, every one on a FIXTURE pointer pair in a throwaway repo (no store, no
// network, no model — the mocked plane the rest of the tranche runs on):
//   (a) inside the target -> owed 0, exit 0, NOTHING written;
//   (b) over target -> the FIRST n row lines move, `head + moved + tail` rebuilds the pre-cut file byte-for-byte,
//       the archive keeps its old bytes and gains each moved row exactly once, and the live file keeps its link
//       to the archive;
//   (c) a row line VERBATIM in BOTH files (the half-cut above) -> FINDING half-cut, exit 1, NOTHING written;
//   (d) more lines owed than table rows -> NOT enough rows, exit 1, prose is never moved;
//   (e) a call WITHOUT `--writes`, and one with `--dry-run`, both PLAN: they name the rows and write nothing,
//       and say a planning pass proves no cut;
//   (f) `--json` prints ONE machine document and never claims a write it did not make;
//   (g) the space flag form is REFUSED (exit 2), not silently defaulted (pitfall 394/398's false green);
//   (h) `--base=` asks the ORDER audit, and an out-of-order table REFUSES the cut (this tool moves the FIRST
//       rows; an unproven order makes "the oldest" unproven) — the anti-vacuity pair is the SAME fixture
//       in order (cut runs) and out of order (refuses).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
// The tool resolves the audit NEXT TO IT by absolute path, so a fixture cwd is fine here — but the
// TOOL itself must arrive absolute, or the fixture's cwd would look for it inside the throwaway repo
// (same contract `tools/pointer-row-for-predecessor-test.mjs` uses).
const TOOL = (() => {
  const given = argv.includes("--tool") ? argv[argv.indexOf("--tool") + 1] : "tools/pointer-table-trim.mjs";
  return given.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(given) ? given : join(process.cwd(), given);
})();

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
  }
}

const root = mkdtempSync(join(tmpdir(), "durig-pointer-trim-"));
const repo = join(root, "repo");

const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: repo, encoding: "utf8" });
const live = () => readFileSync(join(repo, "docs", "NEXT.md"), "utf8");
const arch = () => readFileSync(join(repo, "docs", "NEXT-ARCHIVE.md"), "utf8");
const isRow = (l) => /^\| `[0-9a-f]{7,40}` \|/.test(l);

const HEAD = [
  "**Last update:** 2026-01-01 (fixture pointer)",
  "",
  "| sha | shipped |",
  "|---|---|",
];
const TAIL = [
  "",
  "**Broker windows:** a window is a lease.",
  "",
  "## NEXT SESSION",
  "",
  "**Current item:** the fixture item #1234.",
  "",
  "**Run these first:**",
  "",
  "```bash",
  "node tools/some-instrument.mjs   # 1 s, exit 0 — a fixture read",
  "```",
  "",
  "**Blocker:** none.",
  "",
  "Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)",
];
const rowOf = (n) => `| \`abc000${n}\` | fixture row ${n}: moved a thing — cadence row of pitfall 384 |`;
const ALL_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => rowOf(n));
const pointerOf = (rows) => HEAD.concat(rows).concat(TAIL).join("\n");

try {
  mkdirSync(join(repo, "docs"), { recursive: true });

  console.log("\n=== pointer-table-trim ===\n");

  // (0) THE TOOL EXISTS. A pre-change tree has no such tool, and the spawn says so; every check below
  // would then be a `Cannot find module` failure rather a silent pass.
  writeFileSync(join(repo, "docs", "NEXT.md"), pointerOf(ALL_ROWS));
  writeFileSync(join(repo, "docs", "NEXT-ARCHIVE.md"), "## NEXT SESSION\n\nthe archive opens with the oldest block cut from the live file.\n\n## CLOCK-OUT\n\nolder session logs.\n");
  const exists = run(["--to=999"]);
  check("the tool ran (a pre-change tree gives `Cannot find module` here instead)", exists.status !== 127 && !/Cannot find module/.test(exists.stderr || ""), `status=${exists.status} err=${exists.stderr}`);

  // (a) INSIDE THE TARGET: owed 0, exit 0, nothing written — the idempotence that makes the call cheap to re-run.
  const bytesA = live().length;
  const inside = run(["--to=999"]);
  check("a pointer inside its target exits 0", inside.status === 0, `status=${inside.status}\n${inside.stdout}`);
  check("it says no rows are owed", inside.stdout.includes("rows owed: 0"), inside.stdout);
  check("a no-op pass writes nothing", live().length === bytesA, `bytes ${live().length} vs ${bytesA}`);

  // (b) THE CUT: 16 rows owed at target 14, so the FIRST 16 row lines leave the live file.
  const pre = live();
  const preLines = pre.split("\n");
  const cut = run(["--writes", "--to=24"]);
  check("the cut exits 0", cut.status === 0, `status=${cut.status}\n${cut.stdout}`);
  const post = live();
  const postLines = post.split("\n");
  const moved = preLines.filter((l, i) => isRow(l)).slice(0, preLines.length - 24);
  check("it moved as many rows as the file was over target", postLines.length === preLines.length - moved.length, `post=${postLines.length} pre=${preLines.length} moved=${moved.length}`);
  check("the target asked for 6 of 10 rows, and 6 left the file", moved.length === 6, moved.join("\n"));
  check("it moved ONLY rows (the live file's prose is intact)", post.includes("**Blocker:** none.") && post.includes("**Current item:**"), post);
  check("the moved rows are the FIRST rows (the table is in commit order, so they are the oldest)", preLines.filter(isRow).slice(0, moved.length).join("\n") === moved.join("\n") && ALL_ROWS.slice(0, moved.length).join("\n") === moved.join("\n"), moved.join("\n"));
  check("no moved row is still in the live file", moved.every((m) => !post.split("\n").some((l) => l === m)), post);
  const insertAt = preLines.findIndex(isRow); // the removed block started at the table's first row
  const rebuilt = postLines.slice(0, insertAt).concat(moved).concat(postLines.slice(insertAt)).join("\n");
  check("head + the moved rows + the live table rebuilds the pre-cut file byte-for-byte", rebuilt === pre, `rebuilt ${rebuilt.length} B vs pre-cut ${pre.length} B`);
  check("the tool PRINTS that proof rather than asserting a silent success", cut.stdout.includes("rebuilds the pre-cut") && cut.stdout.includes(`${pre.length} B`), cut.stdout);
  const archPre = arch();
  const archPost = arch();
  check("the archive is append-only (its older bytes are intact)", archPost.startsWith(archPre), `arch ${archPost.length} B vs pre ${archPre.length} B`);
  check("every moved row is in the archive EXACTLY once (VERBATIM, never retyped)", moved.every((m) => archPost.split("\n").filter((a) => a === m).length === 1), archPost);
  check("the archive block names how many rows moved", /the \d+ OLDEST rows/.test(archPost), archPost.split("\n").filter((l) => l.startsWith("**Moved VERBATIM")).join("\n"));
  check("the live file still LINKS its archive (the pointer rule in demo/next-pointer.test.mjs)", post.includes("NEXT-ARCHIVE.md"), post);
  check("the live file lands inside the target it was given", postLines.length === 24, `post=${postLines.length} target=24`);
  check("it reports its own cost and a hostname-free host", cut.stdout.includes("cost:") && cut.stdout.includes("node ") && !/^\s*\S+@\S+\s/m.test(cut.stdout), cut.stdout);

  // (c) THE HALF-CUT FALSIFIER — the live defect this tool exists to catch.
  const dupArch = arch() + "\n**Moved VERBATIM — a cut that was never applied:**\n\n" + ALL_ROWS[9] + "\n";
  writeFileSync(join(repo, "docs", "NEXT-ARCHIVE.md"), dupArch);
  const dup = run(["--writes", "--to=14"]);
  check("a row VERBATIM in BOTH files exits 1", dup.status === 1, `status=${dup.status}\n${dup.stdout}`);
  check("it names the shape (a half-cut), not a generic error", dup.stdout.includes("half-cut"), dup.stdout);
  check("it names the duplicate rows so the fix is findable", dup.stdout.includes(ALL_ROWS[9].slice(0, 60)), dup.stdout);
  check("it wrote NOTHING (the refusal is not a partial cut)", live() === post && arch() === dupArch, `live ${live().length} vs ${post.length}; arch ${arch().length} vs ${dupArch.length}`);

  // (d) A cut may move ROWS only — never the pointer's prose.
  const thin = pointerOf([ALL_ROWS[0]]);
  writeFileSync(join(repo, "docs", "NEXT.md"), thin);
  writeFileSync(join(repo, "docs", "NEXT-ARCHIVE.md"), "## NEXT SESSION\n\na clean archive, so this leg measures the prose rule and nothing else.\n\n## CLOCK-OUT\n\nolder logs.\n");
  const thinPre = thin;
  const tooMany = run(["--writes", "--to=1"]);
  check("owing more lines than there are rows exits 1", tooMany.status === 1, `status=${tooMany.status}\n${tooMany.stdout}`);
  check("it says there are not enough rows", tooMany.stdout.includes("not-enough-rows"), tooMany.stdout);
  check("and the prose stayed put", live() === thinPre, live());

  // (e) A call that does not SAY it writes is a plan: nothing moves, and the tool says why.
  const planPre = live();
  const planned = run(["--to=20"]);
  check("a call without --writes exits 0", planned.status === 0, `status=${planned.status}\n${planned.stdout}`);
  check("it names the rows it WOULD move", planned.stdout.includes("rows to move, in file order"), planned.stdout);
  check("a call without --writes writes nothing (so a re-run of the pointer's block cannot cut)", live() === planPre, live());
  check("it says the write needs --writes, not a silent pass", planned.stdout.includes("--writes"), planned.stdout);
  const plan = run(["--to=20", "--dry-run"]);
  check("--dry-run exits 0", plan.status === 0, `status=${plan.status}\n${plan.stdout}`);
  check("--dry-run names the rows it WOULD move", plan.stdout.includes("rows to move, in file order"), plan.stdout);
  check("--dry-run writes nothing", live() === planPre, live());
  check("--dry-run says a planning pass proves no cut", plan.stdout.includes("DRY RUN") && plan.stdout.includes("proves no cut"), plan.stdout);

  // (f) `--json` is ONE machine document and never claims a write it did not make.
  const jsonRun = run(["--to=20", "--json", "--dry-run"]);
  let doc = null;
  try {
    doc = JSON.parse(jsonRun.stdout);
  } catch {
    doc = null;
  }
  check("--json prints exactly one machine document", doc !== null, jsonRun.stdout);
  check("it reports the rows owed, not a hand count", doc && doc.owed === planPre.split("\n").length - 20, doc && JSON.stringify(doc.owed));
  check("`written: false` on a planning pass (no write claimed)", doc && doc.written === false, JSON.stringify(doc));
  check("--json still exits 0", jsonRun.status === 0, `status=${jsonRun.status}`);

  // (g) the space flag form is REFUSED — an ignored flag is a false green (pitfall 394/398).
  const space = run(["--to", "1"]);
  check("the space form exits 2, not 0", space.status === 2, `status=${space.status}\n${space.stdout}`);
  check("it names the form it wants", (space.stdout + space.stderr).includes("`=` form"), space.stdout + space.stderr);
  check("and it wrote nothing", live() === planPre, live());

  // (h) `--base=` asks the ORDER audit, so "the first rows are the oldest" is DERIVED, not assumed.
  //     A throwaway repo backs the audit: an anchor named by no row + commits whose shas ARE the rows.
  spawnSync("git", ["-C", repo, "init", "-q", "-b", "main"], { encoding: "utf8" });
  spawnSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"], { encoding: "utf8" });
  spawnSync("git", ["-C", repo, "config", "user.name", "test"], { encoding: "utf8" });
  spawnSync("git", ["-C", repo, "config", "commit.gpgsign", "false"], { encoding: "utf8" });
  const shas = [];
  for (const n of [0, 1, 2, 3, 4, 5]) {
    writeFileSync(join(repo, `f-${n}.txt`), `object ${n}\n`);
    spawnSync("git", ["-C", repo, "add", `f-${n}.txt`], { encoding: "utf8" });
    spawnSync("git", ["-C", repo, "commit", "-q", "-m", `fixture commit ${n}`], { encoding: "utf8" });
    shas.push(spawnSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim());
  }
  const [anchor, ...ship] = shas;
  const namedRows = ship.map((s, i) => `| \`${s}\` | fixture commit ${i + 1} — the row names its own commit |`);
  writeFileSync(join(repo, "docs", "NEXT.md"), HEAD.concat(namedRows).concat(TAIL).join("\n"));
  writeFileSync(join(repo, "docs", "NEXT-ARCHIVE.md"), "## NEXT SESSION\n\nempty archive for the order legs.\n\n## CLOCK-OUT\n\nolder logs.\n");

  const inOrder = run([`--base=${anchor}`, "--writes", "--to=20"]);
  check("--base on an ordered table verifies the order and cuts", inOrder.status === 0, `status=${inOrder.status}\n${inOrder.stdout}`);
  check("it prints the audit's verdict, not its own arithmetic", inOrder.stdout.includes("order verified by the audit") && inOrder.stdout.includes("0 holes / 0 ordering defects"), inOrder.stdout);
  check("the rows it moved are the OLDEST commits (c1 first), not the newest", inOrder.stdout.includes(`| \`${ship[0]}\` |`), inOrder.stdout);

  writeFileSync(
    join(repo, "docs", "NEXT.md"),
    HEAD
      .concat([namedRows[2], namedRows[0], namedRows[1], namedRows[4], namedRows[3]])
      .concat(TAIL)
      .join("\n"),
  );
  writeFileSync(
    join(repo, "docs", "NEXT-ARCHIVE.md"),
    "## NEXT SESSION\n\na clean archive again, so this leg measures the ORDER rule and nothing else.\n\n## CLOCK-OUT\n\nolder logs.\n",
  );
  const tangledPre = live();
  const tangled = run([`--base=${anchor}`, "--writes", "--to=20"]);
  check("an OUT-OF-ORDER table REFUSES the cut (moving the first rows would move the wrong age)", tangled.status === 1, `status=${tangled.status}\n${tangled.stdout}`);
  check("it says the order audit found the defect", tangled.stdout.includes("ordering defect"), tangled.stdout);
  check("it points at the tool that fixes the order", tangled.stdout.includes("pointer-row-for-predecessor.mjs"), tangled.stdout);
  check("the refusal wrote nothing", live() === tangledPre, live());

  console.log(`\npointer-table-trim test: ${failures === 0 ? "PASS" : `${failures} FAIL(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
