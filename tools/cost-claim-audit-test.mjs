// tools/cost-claim-audit-test.mjs — a doc's cost claims are MEASURED, not trusted (and not silently skipped).
//
// WHY THIS FILE EXISTS (docs/failing-first-recipe.md METHOD 1 — the test was written BEFORE the tool):
// a pointer's `Run these first` block is the entry point every session runs, and its costs had already drifted
// SIX of thirteen ways on `docs/NEXT.md` at 2026-11-16 while every doc gate stayed exit 0 (§43's THIRD/EIGHTH
// addenda measured ONE instrument at 1.1 -> 1.5 -> 2.3 s over three trees). Nothing re-ran the block, so the
// drift read as truth. The RED run is one bounded call: point the test at the PRE-change tree's `tools/`, which
// carries no cost-claim auditor at all —
//   mkdir -p .spike/prechange-costaudit && git archive HEAD tools | tar -x -C .spike/prechange-costaudit
//   node tools/cost-claim-audit-test.mjs --tool .spike/prechange-costaudit/tools/cost-claim-audit.mjs
// which exits 1 with `Cannot find module` on every spawn (the numbers are in the shipped commit and in
// .spike/costaudit-red.out).
//
// CLOSED SET OF OUTCOMES pinned below, each on a FIXTURE doc so the audit costs ~2 s and never reads
// ./selfdev.sqlite (the mocked plane the rest of the tranche runs on):
//   (a) a claim that holds -> no finding, exit 0;      (b) under-stated (reality > tol x claim) -> finding;
//   (c) over-stated (reality < claim / tol) -> the mirror finding, the loop flattered itself;
//   (d) a RANGE claim `0.04-0.2 s` -> one claim, two bounds, checked against both;
//   (e) an allowed command with no cost in its note -> UNPRICED (runbook §37 says a cost names its flags);
//   (f) a command NOT on the read-only allow-list -> REFUSED naming the token, never counted as a pass;
//   (g) a command that exits non-zero inside a fifth of a second -> NOT MEASURED (SELFDEV pitfall 396's
//       `timeout 60 VAR=x cmd` exits 127 in 0.001 s — a cost measured that way is not the command's cost);
//   (h) a claim that cannot fit the remaining budget -> NOT MEASURED (budget): the audit stays one bounded call;
//   (i) `--tolerance` moves the verdict on the SAME rows, and the override prints on every line;
//   (j) a doc with no priced command -> 0 claims: exit 0, and exit 1 under `--strict` (nothing checked is not
//       proof), and the report never claims a measurement it did not take.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const TOOL = argv.includes("--tool") ? argv[argv.indexOf("--tool") + 1] : "tools/cost-claim-audit.mjs";
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const dir = mkdtempSync(`${tmpdir()}/costaudit-`);
const doc = `${dir}/pointer.md`;

// A fixture pointer: one fenced block, one command per claim shape. `node -e` sleep loops keep the whole
// audit inside ~2 s and off the store.
writeFileSync(doc, [
  "# fixture pointer",
  "",
  "```bash",
  "node -e 'const t=Date.now();while(Date.now()-t<50){}'    # 0.05 s, exit 0 — the shape that holds",
  "node -e 'const t=Date.now();while(Date.now()-t<400){}'   # 0.05 s, exit 0 — under-stated: reality is 8x the claim",
  "node -e 'const t=Date.now();while(Date.now()-t<20){}'    # 5 s, exit 0 — over-stated: the claim flattered the loop",
  "node -e 'const t=Date.now();while(Date.now()-t<60){}'    # 0.04-0.2 s, exit 0 — a range claim",
  "node -e '0'                                             # a note that never states a cost",
  "node cli.mjs serve --max-duration 5                     # 1 s, exit 0 — a lease, not a measurement",
  "node -e 'process.exit(3)'                               # 0.05 s — fails fast: was the command run at all?",
  "node -e 'const t=Date.now();while(Date.now()-t<900){}'   # 600 s, exit 0 — a full suite the audit will not pay",
  "cd /tmp                                                 # navigation",
  "```",
  "",
  "Prose outside the block is not a command.",
].join("\n"));

function run(extra, overDoc) {
  const docs = overDoc ? ["--doc", overDoc] : ["--doc", doc];
  const r = spawnSync(process.execPath, [TOOL, ...docs, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  let j = null;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    /* the tool did not print a document — the checks below name it */
  }
  return { status: r.status, out: r.stdout, err: r.stderr, j, lines: r.stdout };
}

const hasVerdict = (r, re) => (r.unmeasured ?? []).some((x) => re.test(String(x.verdict || ""))) || (r.off ?? []).some((x) => re.test(String(x.verdict || "")));

console.log("=== 1. the default tolerance reads the four verdicts on ONE doc ===");
const base = run(["--json"]);
check("the audit ran (the tool exists)", base.status !== 127 && /Cannot find module/.test(base.err || "") === false && !!base.j, `status=${base.status} err=${(base.err || "").slice(0, 200)}`);
if (base.j) {
  const j = base.j;
  check(`the fixture's commands were read (rows ${j.claims}, priced ${j.priced}, measured ${j.measured})`, j.claims === 9 && j.priced === 7 && j.measured >= 4, `claims=${j.claims} priced=${j.priced} measured=${j.measured}`);
  const offCmd = (j.off ?? []).map((r) => r.cmd);
  check("(b) the UNDER-STATED claim is a finding", offCmd.some((c) => c.includes("<400)")), offCmd.join(" | "));
  check("(c) the OVER-STATED claim is a finding", offCmd.some((c) => c.includes("<20)")), offCmd.join(" | "));
  check("(d) the RANGE claim is not a finding", (j.off ?? []).every((r) => !r.cmd.includes("<60)")), offCmd.join(" | "));
  check("(f) the LEASE command is REFUSED, not measured", hasVerdict(j, /refused/i), JSON.stringify(j.unmeasured).slice(0, 900));
  check("  and the refusal names why (not a read verb on the allow-list)", hasVerdict(j, /read verb|lease/i), JSON.stringify(j.unmeasured).slice(0, 900));
  check("(g) the fail-fast command is NOT MEASURED (no number reads as truth)", hasVerdict(j, /may not have run/), JSON.stringify(j.unmeasured).slice(0, 900));
  check("(e) the note without a cost is UNPRICED", hasVerdict(j, /UNPRICED/), JSON.stringify(j.unmeasured).slice(0, 900));
  check("(h) the budget stops the last claim, in words", hasVerdict(j, /budget/), JSON.stringify(j.unmeasured).slice(0, 1400));
  check("the report names its own cost in ms (costMs)", typeof j.costMs === "number" && j.costMs > 100, `costMs=${j.costMs}`);
  check("the report names its host as OS + distro + kernel + node", /kernel .+node v/.test(j.host ?? ""), j.host);
  check("the host line carries no hostname marker (never user@host)", !/@/.test(j.host ?? ""), j.host);
  check("the audit exits 1 on an OFF claim (a lie fails)", base.status === 1, `status=${base.status}`);
  check("an OFF row names the line, the claim and the measurement", (j.off ?? []).every((r) => r.line && r.claim && typeof r.ratio === "number"), JSON.stringify(j.off).slice(0, 500));
}

console.log("=== 2. the tolerance knob moves the verdict on the SAME rows ===");
const loose = run(["--tolerance", "12", "--json"]);
check("a 12x tolerance keeps ONLY the over-stated row", loose.j && loose.j.off.length === 1 && /<20\)/.test(loose.j.off[0].cmd), loose.j ? `off=${loose.j.off.length}: ${loose.j.off.map((r) => r.cmd).join(" | ")}` : `stdout: ${loose.out.slice(0, 400)}`);
const gone = run(["--tolerance", "300", "--json"]);
check("and a 300x tolerance clears both, so the exit is 0 (the knob moves the verdict)", gone.status === 0 && gone.j && gone.j.off.length === 0, gone.j ? `off=${gone.j.off.length} status=${gone.status}` : `stdout: ${gone.out.slice(0, 400)}`);
check("and the tolerance the run used is IN the report (no silent widening)", loose.j && loose.j.tol === 12, loose.j ? `tol=${loose.j.tol}` : `stdout: ${loose.out.slice(0, 400)}`);
const looseHuman = run(["--tolerance", "12"], doc);
check("and the human report prints it on every measured line", looseHuman.out.includes("tol 12"), looseHuman.out.slice(0, 600));
const tight = run(["--tolerance", "1.05", "--json"]);
check("a 1.05x tolerance finds the range row too", tight.j && tight.j.off.length >= 3, tight.j ? `off=${tight.j.off.length}` : `stdout: ${tight.out.slice(0, 400)}`);

console.log("=== 3. a doc with nothing priced is NOT a pass under --strict ===");
const bare = `${dir}/bare.md`;
writeFileSync(bare, "# no block here\n\nJust prose.\n");
const strict = run(["--strict", "--json"], bare);
check("0 claims + --strict = exit 1", strict.status === 1, `status=${strict.status} out=${strict.out.slice(0, 400)}`);
check("  and the report says nothing was measured", strict.j && strict.j.measured === 0, strict.j ? `measured=${strict.j.measured}` : `stdout: ${strict.out.slice(0, 300)}`);
const looseBare = run([], bare);
check("0 claims without --strict = exit 0, said so in words", looseBare.status === 0 && looseBare.out.includes("0 command(s)"), `status=${looseBare.status} out=${looseBare.out.slice(0, 200)}`);

console.log("=== 4. the refusal list is a WORD match, so a script named like a verb still runs ===");
const named = `${dir}/named.md`;
writeFileSync(named, [
  "```bash",
  "node tools/broker-serve.mjs --status      # 1 s, exit 0 — a READ whose file is named like a lease",
  "node -e '0' --max-duration 5 --apply    # 1 s — carries a transition flag",
  "```",
].join("\n"));
const namedRun = run(["--json"], named);
check("the read named like a lease is not REFUSED (a file name is not a verb)", namedRun.j && !(namedRun.j.unmeasured ?? []).concat(namedRun.j.off ?? []).some((r) => /broker-serve/.test(r.cmd) && /REFUSED/.test(String(r.verdict || ""))), JSON.stringify(namedRun.j).slice(0, 900));
check("the command carrying a transition flag is REFUSED", namedRun.j && (namedRun.j.unmeasured ?? []).some((r) => /transition/.test(String(r.verdict || ""))), JSON.stringify(namedRun.j).slice(0, 900));

console.log("=== 5. the audit wrote nothing beside its report ===");
const names = readdirSync(dir);
check("the fixture dir holds ONLY the docs the test wrote", names.length === 3 && names.every((n) => n.endsWith(".md")), names.join(" "));
check("the report went to stdout, not into the fixture", !readFileSync(doc, "utf8").includes("audit cost:"), readFileSync(doc, "utf8").slice(0, 200));

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\nCOST CLAIM AUDIT TEST FAIL (${failures})` : `\nCOST CLAIM AUDIT TEST PASS (0 failures)`);
process.exit(failures ? 1 : 0);
