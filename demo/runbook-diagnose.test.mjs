// demo/runbook-diagnose.test.mjs — ROADMAP 85: the read-only `Diagnose` half of every
// runbook is EXECUTED in CI, so it cannot rot unnoticed.
//
// The gap this closes: `check` (81/82) reads a runbook's front-matter and headings, but
// nothing ever ran the commands under `## Diagnose (read-only)`. A verb renamed, a path
// moved, a pipe left dangling — invisible until a human hit them mid-incident.
//
// How it works, and what it honestly does not claim:
//   1. A THROWAW rig (temp git repo with `main` + one registered worktree, temp store
//      created by the CLI itself, `cli.mjs` symlinked in) lets the runbooks' literal
//      `node cli.mjs ...` lines run verbatim without touching the live store or broker.
//   2. Every command line is classified: RUNNABLE, or a GAP with a reason (a Windows
//      shell, a live broker artifact, a network endpoint, an unfilled `<placeholder>`, a
//      glob, a multi-line construct). A gap is printed, never counted as a pass.
//   3. Runnable lines are syntax-checked (`bash -n`) and EXECUTED. Exit 0 required; where
//      the command says `--json`, the bytes must parse as JSON.
//   4. Failures are split by meaning: a missing binary, a shell syntax error or an
//      unknown `cli.mjs` verb is a DEFECT (CI fails); "the fixture cannot contain this
//      live state" is a GAP (reported).
//   5. `cli.mjs` verbs are validated against the CLI's OWN usage text — derived, not
//      hand-listed — so a renamed verb cannot stay trusted in prose.
//   6. Runbooks from which CI executes NOTHING are pinned by name, so a new runbook
//      cannot quietly join the unexecuted set.
//
// FAILING-FIRST: before this test, `node cli.mjs frobnicate` in a runbook was prose nobody
// ran (the CLI answers with exit 2). The negative controls are exactly that shape.
//
// Run: node demo/runbook-diagnose.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  READ_ONLY_CLI_VERBS,
  READ_ONLY_GIT_SUBCOMMANDS,
  classifyDiagnoseLine,
  classifyDiagnoseBlock,
  classifyProbeFailure,
  isControlFlowLine,
  cliUsageVerbs,
  diagnoseCommandLines,
  diagnoseFences,
  diagnoseResultFindings,
  extractDiagnoseSection,
  fenceCommandLines,
  fillPlaceholders,
  collectItemRefs,
  runbookDiagnoseFindings,
  stdoutIsJson,
  unknownCliVerbProblem,
} from "../src/runbookdiagnose.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNBOOKS = join(ROOT, "docs", "runbooks");

/** Runbooks CI cannot execute a single command from. Pinned by name: CI fails if a
 *  runbook joins this list, or one leaves it without a runnable command. */
const NOTHING_EXECUTED = [
  "block-shape-refused.md",
  "broker-safe-change.md",
  // Added when this runbook landed: its four Diagnose lines name live-state files the
  // throwaway fixture cannot contain (.spike/acceptance-seed/acceptance-snapshot.sqlite) and
  // start with `cd`, which the read-only allowlist refuses. Measured DIAG_DEBUG output, 2026-11-10.
  "compaction-acceptance-measure.md",
  "constitution-amendment.md",
  "docs-encoding-mojibake.md",
  "format-before-commit.md",
  "git-form-refusal.md",
  "local-provider-down.md",
  "merge.md",
  "per-row-marker.md",
  "prepare-workspace-etarget.md",
  "session-start-cost.md",
  "spend-cap-tripped.md",
  // Added when this runbook landed: its probe takes a live network endpoint
  // (--base=https://api.deepinfra.com/v1/openai), which the allowlist refuses, and its second
  // line needs the live store. Measured DIAG_DEBUG output, 2026-11-10.
  "verifier-leg-unfunded.md",
];

// Eight runbooks were in this list until #6369 (2026-11-11): compaction-eval, harness-compaction-guard,
// research-request, store-corruption-recovery, store-probe-identity, verifier-model-server,
// verifier-serving-headroom, workspace-move. They had no `## Diagnose` heading or no fenced command block,
// so CI could not execute a single line from them. Each now carries a Diagnose block whose rig-side lines
// run against the fixture (measured DIAG_DEBUG output: only two gaps remain across the eight - the
// `demo/compacteval.test.mjs` line, which the fixture does not carry, and the arm-probe line, whose
// `<model>`/`<endpoint>` placeholders have no fixture value), and the rest of the diagnosis is stated as
// a named limit in the runbook text.

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30000 });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The hermetic rig: temp git repo + temp store + a symlink to the real cli.mjs. */
function buildFixture(extraRefs) {
  const dir = mkdtempSync(join(tmpdir(), "durig-diagnose-"));
  const db = join(dir, "selfdev.sqlite");
  const git = (args) => run("git", args, dir);
  const cli = (args) => run(process.execPath, [join(ROOT, "cli.mjs"), ...args], dir, { DURIG_DB: db, DURIAN_PI_DB: db });
  try {
    assert.equal(git(["init", "-q", "-b", "main", "."]).exitCode, 0, "fixture git init");
    cpSync(join(ROOT, "docs"), join(dir, "docs"), { recursive: true });
    git(["add", "docs"]);
    assert.equal(
      git(["-c", "user.name=durig", "-c", "user.email=durig@localhost", "commit", "-m", "fixture docs"]).exitCode,
      0,
      "fixture commit",
    );
    assert.equal(git(["worktree", "add", "item-1234", "-b", "item-1234"]).exitCode, 0, "fixture worktree");
    // Runbooks name refs like `item-4967`. The fixture creates them at main's tip so the
    // probe has the state it names; the probe's exit code is then a verdict about that
    // state, not a broken command.
    for (const ref of extraRefs) {
      git(["branch", ref, "main"]);
    }
    // The code the runbooks name is reachable, so `node tools/fleet-health.mjs --db
    // ./selfdev.sqlite` runs against the fixture store rather than the live rig.
    for (const entry of ["cli.mjs", "src", "tools", "scripts", "node_modules", "package.json", "rig.starter.json"]) {
      if (existsSync(join(ROOT, entry))) symlinkSync(join(ROOT, entry), join(dir, entry));
    }
    assert.equal(cli(["init"]).exitCode, 0, "fixture rig init");
    assert.equal(cli(["up", "rig.json", "--no-serve"]).exitCode, 0, "fixture rig up");
    return { dir, db, git, cli };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

const runbooks = readdirSync(RUNBOOKS)
  .filter((name) => name.endsWith(".md") && name !== "_template.md" && name !== "README.md")
  .map((name) => ({ file: name, body: readFileSync(join(RUNBOOKS, name), "utf8") }));
const extraRefs = [...new Set(runbooks.flatMap((rb) => collectItemRefs(extractDiagnoseSection(rb.body))))];

const fixture = buildFixture(extraRefs);
// The fixture is removed on every exit path, including a failing assertion, so a red run
// never leaks a throwaway rig.
process.on("exit", () => { try { rmSync(fixture.dir, { recursive: true, force: true }); } catch {} });
const headSha = fixture.git(["rev-parse", "main"]).stdout.trim();
const placeholderValues = {
  branch: "item-1234",
  sha: headSha,
  seat: "qa",
  pid: "1",
  worktree: join(fixture.dir, "item-1234"),
  repo: fixture.dir,
  path: "docs",
  id: "1",
  port: "8080",
  example: "example",
};
const usageOut = run(process.execPath, [join(ROOT, "cli.mjs"), "--help"], ROOT);
const usageVerbs = cliUsageVerbs(`${usageOut.stdout}${usageOut.stderr}`);

// The allowlists are checked against the tools on the box, so the harness cannot rot into
// trusting a verb that no longer exists.
for (const verb of READ_ONLY_CLI_VERBS) {
  if (!usageVerbs.has(verb)) {
    throw new Error(`allowlist claims \`cli.mjs ${verb}\` but the CLI's own usage does not list it`);
  }
}
for (const sub of READ_ONLY_GIT_SUBCOMMANDS) {
  if (run("git", [sub, "--help"], fixture.dir).exitCode !== 0) {
    throw new Error(`allowlist claims \`git ${sub}\` but this git does not answer it`);
  }
}

const toolCache = new Map();
const hasTool = (name) => {
  if (!toolCache.has(name)) toolCache.set(name, run("bash", ["-c", `command -v ${name}`], fixture.dir).exitCode === 0);
  return toolCache.get(name);
};

const inFixture = {
  exists: (p) => existsSync(p.startsWith("/") ? p : join(fixture.dir, p)),
  refExists: (r) => fixture.git(["rev-parse", "--verify", r]).exitCode === 0,
  hasTool,
};
const probe = (line) => run("bash", ["-c", line], fixture.dir, { DURIG_DB: fixture.db, DURIAN_PI_DB: fixture.db });


const problems = [];
const gaps = [];
const executedByFile = new Map();
let commandLines = 0;

for (const rb of runbooks) {
  for (const f of runbookDiagnoseFindings(rb)) {
    if (f.kind === "defect") problems.push(`${rb.file}: ${f.problem}`);
  }
  const section = extractDiagnoseSection(rb.body);
  if (!section) continue;

  for (const fence of diagnoseFences(section)) {
    const lines = fenceCommandLines(fence.code);
    const unit = lines.some(isControlFlowLine);

    if (unit) {
      // A multi-line construct only parses as a unit; run it as one command if every verb
      // in it is read-only and nothing is left as a placeholder.
      const filled = fence.code.split("\n").map((l) => fillPlaceholders(l, placeholderValues));
      if (filled.some((f) => f.unfilled.length)) {
        gaps.push({ file: rb.file, line: lines[0] ?? "", reason: `<placeholder> the fixture has no value for: ${filled.flatMap((f) => f.unfilled).join(", ")}` });
        continue;
      }
      const cls = classifyDiagnoseBlock(filled.map((f) => f.line).join("\n"), inFixture);
      if (!cls.runnable) {
        gaps.push({ file: rb.file, line: lines[0] ?? "", reason: cls.reason });
        continue;
      }
      commandLines += 1;
      const result = probe(filled.map((f) => f.line).join("\n"));
      const verdict = classifyProbeFailure({ line: fence.code, ...result });
      if (verdict.kind === "defect") problems.push(`${rb.file}: ${verdict.reason}: ${fence.code.split("\n")[0]}…`);
      else executedByFile.set(rb.file, (executedByFile.get(rb.file) ?? 0) + 1);
      continue;
    }

    for (const rawLine of lines) {
      commandLines += 1;
      const filled = fillPlaceholders(rawLine, placeholderValues);
      if (filled.unfilled.length) {
        gaps.push({ file: rb.file, line: rawLine, reason: `<placeholder> the fixture has no value for: ${filled.unfilled.join(", ")}` });
        continue;
      }
      const line = filled.line;
      const unknownVerb = unknownCliVerbProblem(line, usageVerbs);
      if (unknownVerb) {
        problems.push(`${rb.file}: ${unknownVerb}`);
        continue;
      }
      const cls = classifyDiagnoseLine(line, inFixture);
      if (!cls.runnable) {
        gaps.push({ file: rb.file, line, reason: cls.reason });
        continue;
      }
      const result = probe(line);
      const verdict = classifyProbeFailure({ line, ...result });
      if (verdict.kind === "defect") {
        problems.push(`${rb.file}: ${verdict.reason}: ${line}`);
        continue;
      }
      if (line.includes("--json") && !line.includes("|") && verdict.kind === "pass") {
        // An empty document means the fixture has no activity for the probe to read —
        // reported, not passed. A NON-empty one that is not JSON is rot.
        if (!String(result.stdout).trim()) gaps.push({ file: rb.file, line, reason: "--json printed nothing against the fixture store" });
        else if (!stdoutIsJson(result.stdout)) problems.push(`${rb.file}: --json output is not parseable: ${line}`);
      }
      executedByFile.set(rb.file, (executedByFile.get(rb.file) ?? 0) + 1);
    }
  }
}

if (process.env.DIAG_DEBUG) gaps.forEach((g) => console.log(`GAP ${g.file} :: ${g.line.slice(0,90)} :: ${g.reason}`));
const neverExecuted = runbooks
  .filter((rb) => !executedByFile.has(rb.file))
  .map((rb) => rb.file)
  .sort();

// --- negative controls: a broken Diagnose block must be caught, not waved through ---
const controls = [
  { name: "no Diagnose section", body: "# X\n## Do\n1. do it", expect: "no `## Diagnose` section" },
  { name: "empty Diagnose block", body: "## Diagnose (read-only)\n```bash\n```\n## Do", expect: "Diagnose block is empty" },
  { name: "non-shell fence", body: "## Diagnose\n```python\nprint(1)\n```\n## Do", expect: "fenced as `python`" },
  { name: "verb the CLI does not answer", line: "node cli.mjs frobnicate-the-rig", expect: "not a verb the CLI answers" },
  { name: "json output that is not json", line: "node cli.mjs queue --json", exit: 0, stdout: "this is not a json document", expect: "--json output is not parseable" },
  { name: "a probe that returns a non-zero VERDICT is not a defect", verdict: true, line: "test -e /definitely-not-there", exit: 1, expect: "ran, exit 1" },
  { name: "a missing binary", line: "not-a-real-tool --version", exit: 127, expect: "does not exist on this box" },
  { name: "a shell syntax error", line: "git status --porcelain |", exit: 2, stderr: "syntax error near unexpected token `newline'", expect: "not valid shell" },
  { name: "a git verb that is not read-only", line: "git commit -m x", expect: "not a read-only subcommand" },
  { name: "an unfilled placeholder", line: "git -C <repo> status", expect: "unfilled `<placeholder>`" },
  { name: "a verb the harness has never seen", line: "frobnicator --list", expect: "read-only allowlist" },
];
for (const c of controls) {
  if (c.body) {
    const found = runbookDiagnoseFindings({ file: "control.md", body: c.body }).map((f) => f.problem);
    assert.ok(found.some((p) => p.includes(c.expect)), `control "${c.name}": expected "${c.expect}", got ${JSON.stringify(found)}`);
    continue;
  }
  if (c.exit !== undefined) {
    const result = { line: c.line, exitCode: c.exit, stdout: c.stdout ?? "", stderr: c.stderr ?? "" };
    const verdict = classifyProbeFailure(result);
    if (c.verdict) {
      assert.equal(verdict.kind, "verdict", `control "${c.name}": a probe that returns a verdict must not be a defect`);
      assert.ok(verdict.reason.includes(c.expect), `control "${c.name}": expected "${c.expect}", got ${JSON.stringify(verdict)}`);
      continue;
    }
    const found = diagnoseResultFindings(result);
    const isJsonControl = c.expect === "--json output is not parseable";
    assert.ok(
      (isJsonControl || verdict.kind === "defect") && found.some((pr) => pr.includes(c.expect)),
      `control "${c.name}": expected "${c.expect}", got ${JSON.stringify({ verdict, found })}`,
    );
    continue;
  }
  if (unknownCliVerbProblem(c.line, usageVerbs) && c.expect === "not a verb the CLI answers") {
    assert.ok(unknownCliVerbProblem(c.line, usageVerbs).includes(c.expect), `control "${c.name}" failed`);
    continue;
  }
  const cls = classifyDiagnoseLine(c.line, inFixture);
  assert.ok(!cls.runnable && cls.reason.includes(c.expect), `control "${c.name}": expected gap "${c.expect}", got ${JSON.stringify(cls)}`);
}

// The assertions are only as good as the probe behind them: a real command must pass for
// real, and a broken one must genuinely fail.
const goodProbe = probe("node cli.mjs status --json");
assert.equal(goodProbe.exitCode, 0, "the fixture CLI read path must work");
assert.ok(stdoutIsJson(goodProbe.stdout), "status --json must print parseable JSON");
const badProbe = probe("node cli.mjs frobnicate");
assert.notEqual(badProbe.exitCode, 0, "an unknown cli verb must exit non-zero");
assert.equal(classifyProbeFailure({ line: "node cli.mjs frobnicate", ...badProbe }).kind, "defect", "the harness must classify it as a defect");

const executed = [...executedByFile.values()].reduce((a, b) => a + b, 0);
assert.ok(runbooks.length >= 40, `expected the runbook set, found ${runbooks.length}`);
assert.ok(executed >= 25, `the harness executed only ${executed} Diagnose commands — coverage is too thin`);
assert.ok(problems.length === 0, `Diagnose commands that do not work:\n${problems.slice(0, 25).join("\n")}`);
assert.ok(
  neverExecuted.join(",") === NOTHING_EXECUTED.join(","),
  `the "nothing executed" set changed: expected ${NOTHING_EXECUTED.join(", ")}, found ${neverExecuted.join(", ")}`,
);

if (process.env.DIAG_DEBUG) gaps.forEach((g) => console.log(`GAP ${g.file} :: ${g.line.slice(0,80)} :: ${g.reason}`));
console.log(
  `RUNBOOK DIAGNOSE TEST PASS: ${runbooks.length} runbooks, ${commandLines} Diagnose command lines, ` +
  `${executed} executed (exit 0, --json parseable), ${gaps.length} reported gaps, ` +
  `${neverExecuted.length} runbooks CI cannot execute (${neverExecuted.join(", ")}).`,
);
const gapReasons = {};
for (const g of gaps) gapReasons[g.reason] = (gapReasons[g.reason] ?? 0) + 1;
console.log("gap reasons (not executed — reported, never passed):");
for (const [reason, n] of Object.entries(gapReasons)) console.log(`  ${n}x ${reason}`);
