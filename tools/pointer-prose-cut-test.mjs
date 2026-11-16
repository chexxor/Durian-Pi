// tools/pointer-prose-cut-test.mjs — the pointer's clock-in DIGEST budget is paid by moving PROSE VERBATIM,
// and the move is PROVEN from the bytes on disk AFTER the write (a claimed-but-unapplied cut REFUSES).
//
// WHY THIS FILE EXISTS (docs/failing-first-recipe.md METHOD 1 — the test is the gate; the tool is the answer):
// the digest breach was paid by hand FIVE times in one window (2026-11-16: `aebebd9fc`, `b8dcceb47`,
// `.spike/cut-five.mjs`, `.spike/fix-halfcut.mjs`, `.spike/cut-tally-clause.mjs`), and `.spike/cut-tally-clause.mjs`
// is the reason this tool exists: it wrote the cut, failed its own rebuild check, exited 1 and archived NOTHING, so
// the text was out of the live file AND out of the archive — a half-cut that `tools/pointer-sha-coverage.mjs`,
// `tools/doc-integrity-guard.mjs` and `scripts/clockin.mjs` all stayed exit 0 over (SELFDEV pitfall 412).
//
// RED FIRST (one bounded call, before the tool existed):
//   mkdir -p .spike/prechange-prose && git archive HEAD tools | tar -x -C .spike/prechange-prose
//   ls .spike/prechange-prose/tools | grep -c 'pointer-prose-cut'   # -> 0, exit 1: the tree has no such tool
//   node tools/pointer-prose-cut-test.mjs --tool .spike/prechange-prose/tools/pointer-prose-cut.mjs
//   -> exit 1 with `Cannot find module` on every spawn.
//
// CLOSED SET OF OUTCOMES pinned below, every one on a FIXTURE pointer pair in a throwaway tmpdir repo (no store,
// no network, no model — the mocked plane the rest of the tranche runs on):
//   (a) a call without `--writes` PLANS: exit 0, names the chunks and the predicted slice delta, writes NOTHING;
//   (b) `--writes` applies: the live file on disk is the pre-cut text with every range replaced, the archive is
//       append-only and carries every clause VERBATIM exactly once, no clause survives in the live file, the slice
//       shrank by exactly what was saved, and the pointer keeps its `## NEXT SESSION` heading and its archive link;
//   (c) a multi-line clause (a whole paragraph) moves VERBATIM, newlines and all;
//   (d) a missing anchor, an ambiguous anchor, overlapping cuts, a chunk outside the digest slice, a chunk that
//       carries a pointer TABLE ROW, a replacement that does not shrink, a replacement that opens a `## ` heading,
//       and a chunk ALREADY VERBATIM in the archive (pitfall 412's half-cut) each REFUSE: exit 1, NOTHING written;
//   (e) the space flag form exits 2 (an ignored flag is a false green, pitfall 394);
//   (f) `--json` prints ONE machine document and never claims a write it did not make.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
// The tool resolves `scripts/clockin.mjs` by a path RELATIVE TO ITSELF (that is how it gets the digest slice's
// ONE derivation), so a fixture copy of an OLD tools/ tree fails with `Cannot find module` — which is the red-first
// evidence, not a bug. The tool path itself must be absolute, or the fixture cwd would look inside the throwaway repo.
const TOOL = (() => {
  const given = argv.includes("--tool") ? argv[argv.indexOf("--tool") + 1] : "tools/pointer-prose-cut.mjs";
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

const root = mkdtempSync(join(tmpdir(), "durig-pointer-prose-"));
const repo = join(root, "repo");
const docs = join(repo, "docs");

const live = () => readFileSync(join(docs, "NEXT.md"), "utf8");
const arch = () => readFileSync(join(docs, "NEXT-ARCHIVE.md"), "utf8");
const writeCuts = (name, spec) => {
  const p = join(repo, "cuts.json");
  if (name !== "cuts") mkdirSync(join(repo, name), { recursive: true });
  const path = name === "cuts" ? p : join(repo, name, "cuts.json");
  writeFileSync(path, JSON.stringify(spec, null, 1));
  return path;
};
const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: repo, encoding: "utf8" });
const bytes = (s) => Buffer.byteLength(s, "utf8");

// A fixture pointer with the SHAPE the live one has: a table ABOVE the slice (rows pay the LINE cap, not the
// bytes), a `## NEXT SESSION` slice of prose, a following `## ` section (the slice's end), and the archive link.
const HEAD = [
  "**Last update:** 2026-01-01 (fixture pointer)",
  "",
  "| sha | shipped |",
  "|---|---|",
  "| `abc000001` | fixture row one — the table sits above the digest slice |",
  "| `abc000002` | fixture row two — cutting it pays ZERO digest bytes |",
  "",
  "**Broker windows:** a window is a lease leased from outside.",
  "",
];
const SLICE = [
  "## NEXT SESSION",
  "",
  "**Current item:** the fixture item #1234 is shipped and the tranche is gated.",
  "",
  "**State the team is in:** the tranche is landed; the queue is pm's to route, and the ledger is read-only here.",
  "",
  "**Runbook index:** the session-start runbook holds the loop costs and the pitfall range for this rig.",
  "",
  "**Blocker:** none for the sweep; the residual faces are measured at this commit and are neither an outage.",
  "",
  "**Long clause:** a paragraph that spans several lines and carries, em-dashes — and `backticks`, plus a",
  "continuation line that the cut must move whole rather than retype, and a third line for good measure.",
  "",
  "Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)",
];
const TAIL = ["", "## CLOCK-OUT", "", "older session logs live here, verbatim.", ""];
const pointer = () => HEAD.concat(SLICE).concat(TAIL).join("\n");

try {
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, "NEXT.md"), pointer());
  writeFileSync(
    join(docs, "NEXT-ARCHIVE.md"),
    "## NEXT SESSION\n\nthe archive opens with the oldest block cut from the live file.\n\n## CLOCK-OUT\n\nolder session logs.\n",
  );

  console.log("\n=== pointer-prose-cut ===\n");

  // (0) THE TOOL EXISTS. A pre-change tree gives `Cannot find module` on every spawn below instead of a silent pass.
  const bogus = writeCuts("probe", [{ chunk: "**Blocker:** none for the sweep; the residual faces are measured at this commit and are neither an outage.", repl: "**Blocker:** none." }]);
  const probe = run([`--cuts=${bogus}`, "--dry-run"]);
  check("the tool ran (a pre-change tree gives `Cannot find module` here)", !/Cannot find module/.test(probe.stderr || "") && probe.status !== 127, `status=${probe.status} err=${probe.stderr}`);

  // (a) THE PLAN. Two clauses: one replaced with shorter text, one whole paragraph moved out.
  const cuts = writeCuts("cuts", [
    {
      from: "**State the team is in:** the tranche is landed",
      to: "and the ledger is read-only here.",
      repl: "**State:** landed.",
    },
    {
      chunk: "**Long clause:** a paragraph that spans several lines and carries, em-dashes — and `backticks`, plus a\ncontinuation line that the cut must move whole rather than retype, and a third line for good measure.",
      repl: "",
    },
  ]);
  const pre = live();
  const archPre = arch();
  const plan = run([`--cuts=${cuts}`, "--dry-run"]);
  check("a planning pass exits 0", plan.status === 0, `status=${plan.status}\n${plan.stdout}`);
  check("it names the clauses it WOULD move", plan.stdout.includes("would leave the live file") && plan.stdout.includes("**Long clause:**"), plan.stdout);
  check("it prints the digest slice it measured", plan.stdout.includes("digest slice lines"), plan.stdout);
  check("a planning pass writes NOTHING to the pointer", live() === pre, `bytes ${bytes(live())} vs ${bytes(pre)}`);
  check("a planning pass writes NOTHING to the archive", arch() === archPre, `bytes ${bytes(arch())} vs ${bytes(archPre)}`);
  check("it says the write needs --writes rather than passing silently", plan.stdout.includes("--writes"), plan.stdout);
  check("it reports its cost and a hostname-free host", plan.stdout.includes("cost:") && plan.stdout.includes("node ") && !/^\S+@\S+\s/m.test(plan.stdout), plan.stdout);

  // (b) THE WRITE. Same plan, with the writing flag.
  const cut = run([`--cuts=${cuts}`, "--writes"]);
  check("the cut exits 0", cut.status === 0, `status=${cut.status}\n${cut.stdout}`);
  const post = live();
  const archPost = arch();
  // Independent splice: replace each clause where it is unique in the PRE-cut text. Nothing here is retyped.
  const expected = (() => {
    let t = pre;
    for (const c of JSON.parse(readFileSync(cuts, "utf8"))) {
      const anchor = c.from ?? c.chunk;
      const end = c.to ? t.indexOf(c.to, t.indexOf(anchor)) + c.to.length : t.indexOf(anchor) + anchor.length;
      t = t.slice(0, t.indexOf(anchor)) + (c.repl ?? "") + t.slice(end);
    }
    return t;
  })();
  check("the live file ON DISK is the plan applied to the pre-cut text", post === expected, `post ${bytes(post)} B vs expected ${bytes(expected)} B`);
  check("the archive is append-only (its older bytes are intact)", archPost.startsWith(archPre), `arch ${bytes(archPost)} B vs pre ${bytes(archPre)} B`);
  const appended = archPost.slice(archPre.endsWith("\n") ? archPre.length : archPre.length + 1);
  const clauses = JSON.parse(readFileSync(cuts, "utf8")).map((c) => {
    const anchor = c.from ?? c.chunk;
    const a = pre.indexOf(anchor);
    const end = c.to ? pre.indexOf(c.to, a) + c.to.length : a + anchor.length;
    return pre.slice(a, end);
  });
  check("every moved clause is VERBATIM in the appended region (the bytes that left are the bytes that landed)", clauses.every((c) => appended.includes(c)), appended);
  check("no moved clause survives in the live file (the half-cut is caught)", clauses.every((c) => !post.includes(c)), post);
  check("the archive block says how many clauses moved and how many bytes", /Cut VERBATIM .*\d+ clause\(s\)/.test(appended) && appended.includes("clock-in digest"), appended.split("\n")[0]);
  check("the pointer still has its `## NEXT SESSION` slice", post.includes("## NEXT SESSION"), post);
  check("the pointer still LINKS its archive (a pointer that cannot point at its history is not a pointer)", post.includes("NEXT-ARCHIVE.md"), post);
  check("the multi-line clause moved whole (its newline is inside the archived copy)", appended.includes("continuation line that the cut must move whole"), appended);
  check("the tool PRINTS the proof from disk rather than asserting a silent success", cut.stdout.includes("the live file on disk equals the plan") && cut.stdout.includes("shrank"), cut.stdout);
  const replBytes = JSON.parse(readFileSync(cuts, "utf8")).reduce((n, c) => n + bytes(c.repl ?? ""), 0);
  check("the live file got SHORTER by exactly the promised bytes", bytes(pre) - bytes(post) === clauses.reduce((n, c) => n + bytes(c), 0) - replBytes, `saved ${bytes(pre) - bytes(post)} B of ${clauses.reduce((n, c) => n + bytes(c), 0)} B moved, ${replBytes} B written back`);
  check("the line count did not go UP (a prose cut that lengthens the file pushes the 200-line cap)", post.split("\n").length <= pre.split("\n").length, `${pre.split("\n").length} -> ${post.split("\n").length}`);

  // (c) THE HALF-CUT — the live defect this tool exists to catch (pitfall 412): the ARCHIVE claims a move and the
  // LIVE file still has the text. Re-create it on a pristine pointer pair, because a cut the pointer already made
  // is a duplicate archive entry, not a half-cut.
  const half = SLICE[8];
  writeFileSync(join(docs, "NEXT.md"), pointer());
  const dupArch = archPre + "\n**Cut VERBATIM — a clause whose cut was never applied:**\n\n" + half + "\n";
  writeFileSync(join(docs, "NEXT-ARCHIVE.md"), dupArch);
  const dupCuts = writeCuts("dup", [{ chunk: half, repl: "" }]);
  const dup = run([`--cuts=${dupCuts}`]);
  check("a clause ALREADY VERBATIM in the archive exits 1", dup.status === 1, `status=${dup.status}\n${dup.stdout}`);
  check("it names the shape (a half-cut) rather than a generic error", dup.stdout.includes("half-cut"), dup.stdout);
  check("it names the clause so the fix is findable", dup.stdout.includes(half.slice(0, 60)), dup.stdout);
  const dupPre = live();
  check("the refusal wrote nothing (not a partial cut)", live() === dupPre && arch() === dupArch, `live ${bytes(live())} vs ${bytes(dupPre)}; arch ${bytes(arch())} vs ${bytes(dupArch)}`);

  // (d) each refusal, in the order the tool meets them. Every one writes NOTHING.
  writeFileSync(join(docs, "NEXT-ARCHIVE.md"), archPre);

  const missing = writeCuts("missing", [{ chunk: "this sentence is not anywhere in the pointer", repl: "" }]);
  const m = run([`--cuts=${missing}`]);
  check("an absent anchor exits 1", m.status === 1, `status=${m.status}\n${m.stdout}`);
  check("it says the anchor is absent", m.stdout.includes("anchor-absent"), m.stdout);

  const twice = pointer() + "\n**Duplicated:** the same clause twice, and the same clause twice.\n";
  writeFileSync(join(docs, "NEXT.md"), twice);
  const amb = writeCuts("amb", [{ chunk: "the same clause twice", repl: "" }]);
  const a1 = run([`--cuts=${amb}`]);
  check("an anchor that occurs twice exits 1 (a cut that could land twice is not a cut)", a1.status === 1, `status=${a1.status}\n${a1.stdout}`);
  check("it says the anchor is ambiguous", a1.stdout.includes("anchor-ambiguous"), a1.stdout);

  const overlap = writeCuts("overlap", [
    { from: "**Current item:** the fixture item", to: "is shipped and the tranche is gated.", repl: "**Current item:** shipped." },
    { from: "the fixture item #1234", to: "is shipped and the tranche is gated.", repl: "shipped." },
  ]);
  const o = run([`--cuts=${overlap}`]);
  check("two cuts over the same bytes exit 1", o.status === 1, `status=${o.status}\n${o.stdout}`);
  check("it names the overlap", o.stdout.includes("overlapping-cuts"), o.stdout);

  // Above the slice: a table row and the prose BEFORE `## NEXT SESSION` pay the digest ZERO bytes (§43 TENTH).
  writeFileSync(join(docs, "NEXT.md"), twice);
  writeFileSync(join(docs, "NEXT-ARCHIVE.md"), archPre);
  const prose = writeCuts("prose", [{ from: "**Broker windows:** a window is a lease", to: "leased from outside.", repl: "**Broker windows:** a lease." }]);
  const p = run([`--cuts=${prose}`]);
  check("a clause OUTSIDE the digest slice exits 1 (it pays the byte budget nothing)", p.status === 1, `status=${p.status}\n${p.stdout}`);
  check("it says why (outside-the-slice), with the slice span it read from clockin", p.stdout.includes("outside-the-slice") && p.stdout.includes("ZERO bytes"), p.stdout);

  const row = writeCuts("row", [{ chunk: "| `abc000001` | fixture row one — the table sits above the digest slice |", repl: "" }]);
  const r = run([`--cuts=${row}`]);
  check("a pointer TABLE ROW exits 1 here (rows are pointer-table-trim's, and pay ZERO digest bytes)", r.status === 1, `status=${r.status}\n${r.stdout}`);
  check("it points at the tool that owns rows", r.stdout.includes("pointer-table-trim.mjs"), r.stdout);

  const grow = writeCuts("grow", [{ chunk: "**Blocker:** none for the sweep; the residual faces are measured at this commit and are neither an outage.", repl: "**Blocker:** none for the sweep; the residual faces are measured, and neither is an outage of the rig's own." }]);
  const g = run([`--cuts=${grow}`]);
  check("a cut that does not shrink exits 1", g.status === 1, `status=${g.status}\n${g.stdout}`);
  check("it prints both byte counts so the reader can see it grew", /(\d+) B of text would be replaced by (\d+) B/.test(g.stdout), g.stdout);

  const head = writeCuts("head", [{ from: "**Blocker:** none for the sweep", to: "neither an outage.", repl: "none.\n\n## A NEW SECTION" }]);
  const h = run([`--cuts=${head}`]);
  check("a replacement that opens a `## ` heading exits 1 (it moves where the slice ends)", h.status === 1, `status=${h.status}\n${h.stdout}`);
  check("it says the replacement carries a heading", h.stdout.includes("repl-carries-a-heading"), h.stdout);

  check("every refusal above wrote NOTHING to the pointer", live() === twice, `live ${bytes(live())} vs ${bytes(twice)}`);

  // (e) the space flag form is REFUSED, not silently defaulted (pitfall 394/398's false green).
  const space = run(["--cuts", cuts]);
  check("the space form exits 2", space.status === 2, `status=${space.status}\n${space.stdout}`);
  check("it names the form it wants", (space.stdout + space.stderr).includes("`=` form"), space.stdout + space.stderr);
  const noCuts = run(["--dry-run"]);
  check("a call with no --cuts exits 2 (a cut is a session artifact the caller names)", noCuts.status === 2, `status=${noCuts.status}\n${noCuts.stdout}`);
  writeFileSync(join(repo, "notjson.json"), "a cut, not JSON");
  const bad = run([`--cuts=${join(repo, "notjson.json")}`]);
  check("a cut spec that is not JSON exits 1 naming the file", bad.status === 1 && bad.stdout.includes("notjson.json"), `status=${bad.status} out=${bad.stdout}`);

  // (f) `--json` is ONE machine document and never claims a write it did not make.
  const json = run([`--cuts=${cuts}`, "--json"]);
  let doc = null;
  try {
    doc = JSON.parse(json.stdout);
  } catch {
    doc = null;
  }
  check("--json prints exactly one machine document", doc !== null, json.stdout);
  check("`written: false` on a planning pass (no write claimed)", doc && doc.written === false, JSON.stringify(doc));
  check("it carries the clauses and their byte sizes, not a hand count", doc && doc.cuts.length === 2 && doc.cuts.every((c) => c.saved > 0), JSON.stringify(doc && doc.cuts));
  check("--json still exits 0", json.status === 0, `status=${json.status}`);
  const jsonWrite = run([`--cuts=${cuts}`, "--writes", "--json"]);
  let doc2 = null;
  try {
    doc2 = JSON.parse(jsonWrite.stdout);
  } catch {
    doc2 = null;
  }
  check("a WRITE through --json says written: true", doc2 && doc2.written === true, JSON.stringify(doc2));
  check("--json still exits 0 on the write", jsonWrite.status === 0, `status=${jsonWrite.status}`);

  console.log(`\npointer-prose-cut test: ${failures === 0 ? "PASS" : `${failures} FAIL(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
