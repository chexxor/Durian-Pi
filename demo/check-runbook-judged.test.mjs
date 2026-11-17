// demo/check-runbook-judged.test.mjs — the RUNBOOK-HEALTH SEAM: the three runbook rules actually RUN.
//
// WHY THIS EXISTS (measured, not assumed). `src/checkup.mjs` declares `runbook-front-matter`,
// `runbook-unverified` and `runbook-stale` in `RULES`, and `auditRig` judges all three — but a rule only
// runs if a CALLER supplies the data, because `auditRig` stays fs-free (ROADMAP 81a). Measured at `main`
// `2195382fe` on this box (Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node
// v24.22.1, git 2.56.0): `node cli.mjs check rig.selfdev.json --json` printed all three as
// `{"status":"unknown","why":"no runbook data was supplied, so no runbook can be judged"}` — every time,
// forever. A permanently-UNKNOWN rule is a rule that never runs, so the maintenance policy in
// `docs/runbooks/README.md` ("run the Verify step, then set `last_verified`") was enforceable nowhere a
// commit passes through, and the 62 dated / 57 stale runbook set rotted invisibly. `src/runbookhealth.mjs`
// is the READ half (plain values, so the judge stays pure) and `cli.mjs check` is the CALL SITE.
//
// FAILING-FIRST — the RED witness, measured against a tree that has no seam at all (HEAD `2195382fe`, the
// last commit before this change, carries no `src/runbookhealth.mjs`). Reproduce it with:
//
//   git archive HEAD src cli.mjs scripts | tar -x -C .spike/pc-runbook-red
//   cp demo/check-runbook-judged.test.mjs .spike/pc-runbook-red/demo/
//   node .spike/pc-runbook-red/demo/check-runbook-judged.test.mjs
//
// Measured there (same host line): exit 1 in 0.22 s, `ERR_MODULE_NOT_FOUND` for
// `file:///home/chexxor/Git/Durian-Pi/.spike/pc-runbook-red/src/runbookhealth.mjs` — the demo cannot even state
// its assertions, and the missing READ is reported as a FAIL, not as a crash that hides a passing gate; the
// module-not-found IS the red. That the pre-change tree lacks the module is confirmed, not remembered:
// `test -e .spike/pc-runbook-red/src/runbookhealth.mjs` is false in that extraction.
//
// What this pins, in order:
//   1. the LIVE tree is judged, not skipped — `readRunbookHealth` returns rows and the staleness leg ran;
//   2. `auditRig` given those rows leaves NO runbook rule UNKNOWN (the dead state this seam exists to end);
//   3. END-TO-END, a planted runbook FILE in a planted GIT repo produces a `runbook-stale` ERROR and exit 1
//      — so the finding rides on a change the reader saw, not on hand-made data;
//   4. a tree where the staleness leg CANNOT run reports that fact (`gitProbeFailures`, `changedNamedFiles`
//      `null` not `[]`), and the caller converts it to UNKNOWN — "could not look" never reads as clean;
//   5. the read is a CONFIG KEY (`DURIG_RUNBOOKS`), and OFF supplies no rows so the rules print UNKNOWN —
//      proved through the real CLI, because the fixture rigs in `demo/check.test.mjs` and `demo/starter.test.mjs`
//      spawn `cli.mjs` at the repo root and must not inherit the live tree's findings;
//   6. ONE mechanism: the clock-in digest's `staleRunbooks` and this reader's `runbookStalenessReport`
//      return the SAME value, so the two surfaces cannot spell one question differently (D328).
//
// Cost, measured on this box (same host line as above): this demo runs in ~2-8 s — TWO `git log` reads over
// the live set (one spawn each), three `git` calls in a temp repo, and two `cli.mjs check` spawns. Re-measure
// rather than quote it.
//
// Run: node demo/check-runbook-judged.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RULES,
  RUNBOOK_TEMPLATE_SECTIONS,
  auditRig,
  runbookFrontMatterProblems,
} from "../src/checkup.mjs";
import { readRunbookHealth, runbookStalenessReport } from "../src/runbookhealth.mjs";
import { runbookDirSetting, DEFAULT_RUNBOOK_DIR } from "../src/config.mjs";
import { staleRunbooks } from "../scripts/clockin.mjs";

const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// A rig whose OTHER rules all pass, so every finding below is a RUNBOOK finding (same shape as
// demo/runbook-frontmatter.test.mjs — one rig, two questions, no collateral to subtract mentally).
const spec = {
  seats: [
    { name: "alpha", role: "author", capabilities: ["implement"] },
    { name: "verifier", role: "independent verifier", capabilities: ["verify"] },
  ],
  edges: [
    { from: "alpha", maySendTo: ["verifier"] },
    { from: "verifier", maySendTo: ["alpha"] },
  ],
};
const CONSTITUTION = "shared norms";
const base = {
  rig: "rig.json",
  spec,
  specConstitution: CONSTITUTION,
  stored: { reason: "read", text: CONSTITUTION },
  storedSeats: ["alpha", "verifier"],
  modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
};
const RUNBOOK_RULES = ["runbook-stale", "runbook-unverified", "runbook-front-matter"];
const statusOf = (result, id) => result.checks.find((c) => c.id === id)?.status;

const sandbox = mkdtempSync(join(tmpdir(), "durig-runbook-seam-"));

try {
  /* ------------------------- 1. the live tree is JUDGED ------------------------- */

  // The default is ONE definition, in src/config.mjs, not restated here: an unconfigured rig reads the
  // conventional directory, and a rig that wants elsewhere or OFF says so in its config file.
  const dir = runbookDirSetting({});
  assert.equal(dir, DEFAULT_RUNBOOK_DIR, "the unset default is the declared constant, not a second literal");

  const health = readRunbookHealth({ root: durigDir, dir });
  assert.ok(health, "the live tree's runbook set is readable, so the caller has data to hand the judge");
  assert.ok(health.runbooks.length > 0, "the live tree's runbooks are in the rows, not an empty read");
  assert.ok(health.dated > 0, "at least one runbook carries a last_verified, so the staleness question is asked");
  assert.equal(health.gitProbeFailures, 0, "the staleness leg ran here (git and the repo are available)");
  assert.ok(
    health.runbooks.every((r) => r.verifiedOn === null || Array.isArray(r.changedNamedFiles)),
    "a dated runbook carries a JUDGED array (possibly empty), so an empty one means 'looked, nothing stale'",
  );
  assert.ok(
    health.runbooks.every((r) => r.file.startsWith(`${dir}/`)),
    "rows name the directory they were read from, so a finding names a real path",
  );

  // 2. THE seam: with rows supplied, NO runbook rule reports UNKNOWN. Before this change all three did,
  //    forever — that is the whole defect, and this assertion is its end.
  const live = auditRig({ ...base, runbooks: health.runbooks });
  for (const id of RUNBOOK_RULES) {
    const st = statusOf(live, id);
    assert.ok(st === "pass" || st === "fail", `${id} is JUDGED (pass or fail), got ${st}`);
  }
  assert.ok(
    live.findings.every((f) => !RUNBOOK_RULES.includes(f.id) || f.severity === "error" || f.severity === "fix-now"),
    "a runbook finding carries the severity RULES declares",
  );
  const declared = Object.fromEntries(RULES.map((r) => [r.id, r.severity]));
  for (const id of RUNBOOK_RULES) {
    assert.ok(declared[id], `${id} is a declared rule with a declared severity`);
  }

  /* ------- 3. END-TO-END: a planted file + a planted git repo -> a stale ERROR and exit 1 ------- */

  // The staleness finding must ride on a change the READER saw, not on data I wrote. So the fixture plants a
  // whole tree: a conforming runbook that NAMES a source file, that file, and a commit touching it.
  const planted = join(sandbox, "planted");
  mkdirSync(join(planted, "docs", "runbooks"), { recursive: true });
  mkdirSync(join(planted, "src"), { recursive: true });
  const lastVerified = "2026-10-16";
  const commitDay = "2026-11-01"; // strictly LATER than last_verified — pinned, so the day test is not the clock
  const body = `${RUNBOOK_TEMPLATE_SECTIONS.map((h) => `## ${h}\ntext`).join("\n\n")}\n\nSee src/planted.mjs\n`;
  writeFileSync(
    join(planted, "docs", "runbooks", "planted.md"),
    [
      "---",
      "runbook: planted",
      'symptom: "the planted thing is wrong"',
      "writes: false",
      'precondition: "read-only"',
      `last_verified: ${lastVerified}`,
      "verified_by: impl",
      'evidence: "demo/check-runbook-judged.test.mjs"',
      "check_rule: null",
      "---",
      "",
      body,
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(planted, "src", "planted.mjs"), "export const planted = 1;\n", "utf8");

  const git = (...args) => {
    const r = spawnSync(
      "git",
      ["-C", planted, ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "seam",
          GIT_AUTHOR_EMAIL: "seam@example.invalid",
          GIT_COMMITTER_NAME: "seam",
          GIT_COMMITTER_EMAIL: "seam@example.invalid",
          GIT_AUTHOR_DATE: `${commitDay}T12:00:00 +0000`,
          GIT_COMMITTER_DATE: `${commitDay}T12:00:00 +0000`,
        },
      },
    );
    // BOTH planes report an exit code, under different names: this rig reports `status` (measured here:
    // a successful `git --version` has no `exitCode` and `status` 0; a failed `git -C /no/such/tree log`
    // gives `status` 128). Read whichever the plane provides, so the demo is not tied to one spelling.
    const code = r.exitCode ?? r.code ?? r.status;
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r;
  };
  git("init", "--initial-branch=main");
  git("add", "--", ".");
  git("commit", "-m", "planted");

  const plantedHealth = readRunbookHealth({ root: planted, dir: "docs/runbooks" });
  assert.equal(plantedHealth.gitProbeFailures, 0, "the planted repo answers the staleness leg");
  assert.equal(plantedHealth.runbooks.length, 1, "the planted tree holds one runbook");
  const plantedRow = plantedHealth.runbooks[0];
  assert.equal(plantedRow.verifiedOn, lastVerified, "the reader keeps the planted date");
  assert.deepEqual(plantedRow.changedNamedFiles, ["src/planted.mjs"], "the seam sees the NAMED file change after last_verified");

  // The planted runbook is conformant, so the ONLY finding about it is staleness — proof that a stale
  // finding is not an artifact of a malformed header.
  assert.deepEqual(runbookFrontMatterProblems(plantedRow), [], "the planted runbook conforms, so nothing else fires");
  const plantedAudit = auditRig({ ...base, runbooks: plantedHealth.runbooks });
  const stale = plantedAudit.findings.find((f) => f.id === "runbook-stale");
  assert.ok(stale, "a runbook verified before a named file changed IS reported");
  assert.equal(stale.severity, "error", "stale steps are an ERROR — a seat may follow a step the code no longer matches");
  assert.equal(stale.subject, `docs/runbooks/${"planted"}.md`, "the finding names the runbook");
  assert.match(stale.detail, new RegExp(lastVerified), "the detail names the date it was verified on");
  assert.match(stale.detail, /src\/planted\.mjs/, "the detail names the file that changed");
  assert.equal(statusOf(plantedAudit, "runbook-stale"), "fail", "the check list says FAIL, not SKIPPED");
  assert.equal(plantedAudit.exitCode, 1, "a stale runbook fails the run, so a gate stops on it");
  assert.ok(
    plantedAudit.findings.every((f) => f.id === "runbook-stale"),
    "the planted tree's only finding is staleness (the rig half of the audit stays clean)",
  );

  /* -------- 4. a leg that CANNOT run is REPORTED, and never read as clean -------- */

  // The same tree content, no repo: the staleness question cannot be answered. `changedNamedFiles` must be
  // null ("not looked at"), deliberately NOT [] ("looked, nothing stale") — the second would darken a
  // landing gate with a pass nobody measured, and the first leaves the rule UNKNOWN at the call site.
  const noGit = join(sandbox, "no-git");
  mkdirSync(join(noGit, "docs", "runbooks"), { recursive: true });
  writeFileSync(join(noGit, "docs", "runbooks", "planted.md"), readFileSync(join(planted, "docs", "runbooks", "planted.md"), "utf8"), "utf8");
  const noGitHealth = readRunbookHealth({ root: noGit, dir: "docs/runbooks" });
  assert.equal(noGitHealth.gitProbeFailures, 1, "a failed git probe is REPORTED, not swallowed");
  assert.ok(
    noGitHealth.runbooks.every((r) => r.changedNamedFiles === null),
    "the staleness rows are null ('could not look'), not an empty array ('looked, nothing stale')",
  );
  // And the caller's conversion: no rows -> UNKNOWN with a reason. `cli.mjs check` does exactly this when
  // `gitProbeFailures > 0`; a `null` whole-set is the only honest input, and the judge says so.
  const unknown = auditRig({ ...base, runbooks: null });
  for (const id of RUNBOOK_RULES) {
    const c = unknown.checks.find((x) => x.id === id);
    assert.equal(c.status, "unknown", `${id} is UNKNOWN when no rows are supplied, got ${c.status}`);
    assert.ok(c.why, "the UNKNOWN states a reason, so the report is not a bare UNKNOWN");
    assert.match(c.why, /no runbook data/, `${id} names WHY nothing was judged`);
  }
  assert.ok(
    unknown.findings.every((f) => !RUNBOOK_RULES.includes(f.id)),
    "an unmeasured staleness leg invents no finding",
  );

  /* -------- 5. the read is a CONFIG KEY, proved through the real CLI -------- */

  assert.equal(runbookDirSetting({ DURIG_RUNBOOKS: "" }), "", "the empty string is OFF");
  assert.equal(runbookDirSetting({ DURIG_RUNBOOKS: "docs/runbooks " }), "docs/runbooks", "the setting is trimmed");
  assert.equal(runbookDirSetting({ DURIG_RUNBOOKS: null }), DEFAULT_RUNBOOK_DIR, "an explicit null falls back to the default");
  assert.equal(readRunbookHealth({ root: durigDir, dir: "" }), null, "OFF hands the caller NOTHING — the rules stay UNKNOWN");
  assert.equal(readRunbookHealth({ root: durigDir, dir: "no/such/dir" }), null, "an unreadable dir is null, not an empty read");

  // The CLI wiring, both ways, at the REPO ROOT — the cwd the four pre-existing `check` fixtures use, which is
  // why the switch has to be a config key rather than a path convention (a fixture rig inside the tree still
  // inherits nothing once the key is OFF).
  const rigPath = join(sandbox, "fixture.rig.json");
  writeFileSync(rigPath, JSON.stringify({ version: 2, seats: [{ name: "pm", role: "Program manager" }] }), "utf8");
  const offConfig = join(sandbox, "off.config.json");
  writeFileSync(offConfig, JSON.stringify({ DURIG_EXTENSIONS: "", DURIG_RUNBOOKS: "" }), "utf8");
  const onConfig = join(sandbox, "on.config.json");
  writeFileSync(onConfig, JSON.stringify({ DURIG_EXTENSIONS: "" }), "utf8");

  const cli = (args, env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ["cli.mjs", ...args], {
        cwd: durigDir,
        env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: join(sandbox, "fixture.sqlite"), ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      const childStderr = { stdout: "", stderr: "" };
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (childStderr.stderr += c));
      child.once("exit", (code) => resolve({ code, stdout, stderr: childStderr.stderr }));
    });

  const offRun = await cli(["check", rigPath, "--json"], { DURIG_CONFIG: offConfig });
  assert.equal(offRun.stdout.startsWith("{"), true, "the JSON contract still owns stdout");
  const offPayload = JSON.parse(offRun.stdout);
  for (const id of RUNBOOK_RULES) {
    assert.equal(statusOf(offPayload, id), "unknown", `${id} is UNKNOWN with the read OFF, got ${statusOf(offPayload, id)}`);
  }
  assert.ok(
    offPayload.findings.every((f) => !RUNBOOK_RULES.includes(f.id)),
    "with the read OFF the audit carries no runbook finding at all — a fixture cannot inherit the live tree's",
  );
  assert.ok(
    !offRun.stderr.includes("runbook staleness could not be measured"),
    "OFF is a declared state, so it does not print as a probe failure",
  );

  const onRun = await cli(["check", rigPath, "--json"], { DURIG_CONFIG: onConfig });
  const onPayload = JSON.parse(onRun.stdout);
  for (const id of RUNBOOK_RULES) {
    const st = statusOf(onPayload, id);
    assert.ok(st === "pass" || st === "fail", `${id} is JUDGED with the read ON at the repo root, got ${st}`);
  }
  assert.ok(
    onPayload.findings.some((f) => RUNBOOK_RULES.includes(f.id)),
    "with the read ON the live tree's runbook findings are in the report — the rule RUNS",
  );

  /* -------- 6. ONE mechanism, proved by value -------- */

  // The clock-in digest used to own its own probe (one `git log` per NAMED path, ~500 spawns, and it read the
  // ambiguous bare `--since=<date>`); it now derives from this reader. Deep-equal is the proof: two spellings
  // of one question is the D328 class, and here only one spelling is left.
  const viaReader = runbookStalenessReport({ root: durigDir, dir });
  const viaClockin = staleRunbooks({ root: durigDir });
  assert.deepEqual(viaClockin, viaReader, "the digest and `check` return the SAME value for the same tree");
  assert.equal(viaReader.dated, health.dated, "the report's dated count is the reader's, not a second count");
  assert.equal(viaReader.probeFailures, 0, "the staleness leg answered, so the digest's stale list is a judgement");
  assert.ok(
    viaReader.stale.every((r) => r.file && r.last && Array.isArray(r.changed) && r.changed.length > 0),
    "every stale entry names the runbook, the date, and at least one changed file",
  );

  console.log(
    `check-runbook-judged: OK — live ${health.runbooks.length} runbook rows / ${health.dated} dated judged; planted stale -> ERROR + exit 1; unmeasured leg -> UNKNOWN (not clean); DURIG_RUNBOOKS OFF -> no rows at the CLI; clockin === reader by value`,
  );
} finally {
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}

process.exit(0);
