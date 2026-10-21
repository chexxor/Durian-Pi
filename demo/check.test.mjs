// `check` audits a rig file against the research gaps, and its whole reason to
// exist is the defect that shipped silently: a rig spec declared a
// constitution inline and the store held a different one, so its seats ran
// without the team culture while the rig file looked correct. A rule that only
// reads the rig file would have called that rig healthy.
//
// The audit itself is a pure function, so every rule is driven here without a
// database or a provider; the CLI half proves the wiring and the exit code.
// Run: node demo/check.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditRig, formatCheck, VERIFIER_TERMS } from "../src/checkup.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-check-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const CONSTITUTION = "# Team culture\n\nGround every claim in a retrieved passage.\n";
// The generic text the live store held while the rig file declared the
// team culture above: the exact defect this rule exists to catch.
const STALE_TEXT = "# Rig constitution - priority-ordered;\n";

const naiveSpec = () => ({
  version: 2,
  seats: [
    { name: "alpha", role: "Implementer (author)", capabilities: ["testing"] },
    { name: "beta", role: "Peer implementer", capabilities: ["testing"] },
  ],
});

const hardenedSpec = () => ({
  version: 2,
  seats: [
    { name: "alpha", role: "Implementer (author)", capabilities: ["testing"], model: "faux/model-a" },
    { name: "verifier", role: "Independent verifier", capabilities: ["testing"], model: "faux/model-b" },
  ],
  edges: [
    { from: "alpha", maySendTo: ["verifier"] },
    { from: "verifier", maySendTo: ["alpha"] },
  ],
  constitutionInline: CONSTITUTION,
  // A valid ownership block (ROADMAP 46) so the ownership-seat-missing rule RUNS
  // and passes on the hardened rig, rather than being skipped.
  ownership: { "src-tools-harness": ["alpha"], verification: ["verifier"] },
});

const ids = (result) => result.findings.map((f) => f.id);

// Run the CLI and collect stdout/stderr/exit code.
const cli = (args, env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["cli.mjs", ...args], {
      cwd: durigDir,
      env: { ...process.env, DURIG_PROVIDER: "faux", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });

try {
  // 1. The naive rig fails on exactly the things it is missing, and the errors
  //    are the ones that stop the rig working.
  const naive = auditRig({
    rig: "naive.rig.json",
    spec: naiveSpec(),
    specConstitution: undefined,
    stored: { reason: "read", text: "" },
    storedSeats: ["alpha", "beta"],
    modelsBySeat: { alpha: "deepinfra/one", beta: "deepinfra/one" },
  });
  for (const id of ["constitution-missing", "no-verifier-seat", "single-model-rig"]) {
    assert.ok(ids(naive).includes(id), `naive rig reports ${id}; got ${ids(naive).join(", ")}`);
  }
  assert.equal(naive.summary.error, 1, "only the missing constitution is an error");
  assert.equal(naive.exitCode, 1, "an error finding fails the run");
  assert.equal(naive.pass, false);

  // 2. The hardened rig is clean. This is the acceptance: the report narrows.
  const hardened = auditRig({
    rig: "hardened.rig.json",
    spec: hardenedSpec(),
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    storedSeats: ["alpha", "verifier"],
    modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
    // An empty queue so the verification-evidence rule (ROADMAP 48) RUNS and
    // passes, rather than being skipped: this assertion is "every rule ran and
    // passed", and a rule that cannot run is not a pass. Same for the FEATURES-row
    // rule (ROADMAP 46 / D62): an empty feat set is a real "nothing to check".
    queueItems: [],
    featureDocs: [],
    // An empty commit-message set is a real "nothing to check", so the encoding rule (#4349)
    // RUNS and passes here rather than skipping.
    commitMessages: [],
    // An empty text-integrity set is a real "nothing to check", so the rule (#4371) RUNS and passes
    // here rather than skipping.
    textIntegrity: [],
    // The shared tree is on its integration branch, so this rule RUNS and passes rather than
    // being skipped: the assertion below is "every rule ran and passed".
    sharedTreeBranch: "main",
  });
  assert.deepEqual(ids(hardened), [], `hardened rig has no findings; got ${ids(hardened).join(", ")}`);
  assert.equal(hardened.exitCode, 0);
  assert.equal(hardened.pass, true);
  assert.ok(
    hardened.checks.every((c) => c.status === "pass" || (c.status === "skipped" && c.id.startsWith("runbook-"))),
    "every rule ran and passed on the hardened rig (the runbook rules skip: this pure audit is given no runbook data)",
  );

  // 3. THE regression: the spec declares a constitution and the store holds a
  //    different one. Nothing else in durian-pi reports this, and it is invisible
  //    from the rig file alone.
  const drifted = auditRig({
    rig: "example.rig.json",
    spec: { ...hardenedSpec() },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: STALE_TEXT },
    modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
  });
  assert.ok(ids(drifted).includes("constitution-not-applied"), "stale stored text is reported");
  assert.equal(drifted.summary.error, 1, "a drifted constitution is an error");
  const detail = drifted.findings.find((f) => f.id === "constitution-not-applied").detail;
  assert.match(detail, new RegExp(`store holds ${STALE_TEXT.length} bytes`), `detail names the stored size; got: ${detail}`);
  assert.match(detail, new RegExp(`the rig file has ${CONSTITUTION.length}`), "detail names the declared size");

  // 4. The verifier rule must not be fooled by capabilities. Authors' own
  //    implementers advertise `peer-review`, so a capability-based match would
  //    call the authors verifiers and report an all-clear on the exact gap the
  //    rule exists to catch.
  const authorsWithCaps = auditRig({
    rig: "x",
    spec: {
      version: 2,
      seats: [
        { name: "impl", role: "Implementer (author)", capabilities: ["testing", "peer-review"] },
        { name: "impl2", role: "Peer implementer", capabilities: ["testing", "peer-review"] },
      ],
    },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    modelsBySeat: { impl: "a/x", impl2: "b/x" },
  });
  assert.ok(
    ids(authorsWithCaps).includes("no-verifier-seat"),
    "`peer-review` on an author does not count as an independent verifier",
  );
  // And the real verifier names DO satisfy it.
  const withVerifier = auditRig({
    rig: "x",
    spec: {
      version: 2,
      seats: [
        { name: "impl", role: "Seat role: Implementer (author)" },
        { name: "qa", role: "Seat role: QA — citation auditor (independent verifier)" },
        { name: "editor", role: "Seat role: Editor / Historian (edition fidelity)" },
      ],
    },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    modelsBySeat: { impl: "a/x", qa: "b/y", editor: "b/z" },
  });
  assert.ok(!ids(withVerifier).includes("no-verifier-seat"), "qa/editor satisfy the verifier rule");
  assert.ok(VERIFIER_TERMS.length > 0);

  // 5. The D16 bug class: restrictive edges and a seat with no outgoing target.
  const stranded = auditRig({
    rig: "x",
    spec: {
      version: 2,
      seats: [{ name: "pm", role: "Program manager" }, { name: "worker", role: "Implementer" }],
      edges: [
        { from: "pm", maySendTo: ["worker"] },
        { from: "worker", maySendTo: [] },
      ],
    },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    modelsBySeat: { pm: "a/x", worker: "b/y" },
  });
  const unreachable = stranded.findings.find((f) => f.id === "unreachable-seat");
  assert.ok(unreachable, "a seat with no outgoing edge is reported");
  assert.equal(unreachable.subject, "worker", "the stranded seat is named");
  // Open edges (none declared) are "open" semantics, never a finding.
  const openEdges = auditRig({
    rig: "x",
    spec: { version: 2, seats: [{ name: "pm", role: "Program manager" }] },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    modelsBySeat: { pm: "a/x" },
  });
  assert.ok(!ids(openEdges).includes("unreachable-seat"), "no declared edges means no reachability rule");
  // A seat absent from every edge is still reported even when nothing sends to
  // it. That is deliberate: durian-pi's queue delivers DONE notices without an
  // edge, so this rule is not "cannot reply", it is "cannot delegate or
  // escalate" - which is exactly what the coordinator bug was, and the reason
  // the sharpened "is a target" form was rejected.
  const noEdgeAtAll = auditRig({
    rig: "x",
    spec: {
      version: 2,
      seats: [{ name: "pm", role: "Program manager" }, { name: "helper", role: "Helper" }],
      edges: [{ from: "pm", maySendTo: ["pm"] }],
    },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    modelsBySeat: { pm: "a/x", helper: "b/y" },
  });
  assert.ok(ids(noEdgeAtAll).includes("unreachable-seat"), "a seat absent from every edge is still a dead end");
  assert.equal(
    noEdgeAtAll.findings.find((f) => f.id === "unreachable-seat").subject,
    "helper",
    "only the seat without an edge is named",
  );

  // 6. An edge naming a non-existent seat fails only at send time; check says so
  //    up front, on both sides of the edge.
  const dangling = auditRig({
    rig: "x",
    spec: {
      version: 2,
      seats: [{ name: "pm", role: "Program manager", model: "faux/a" }],
      edges: [
        { from: "pm", maySendTo: ["wrker"] },
        { from: "ghost", maySendTo: ["pm"] },
      ],
    },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    modelsBySeat: { pm: "faux/a" },
  });
  const danglingFinding = dangling.findings.find((f) => f.id === "dangling-edge");
  assert.ok(danglingFinding, "a dangling edge is reported");
  assert.match(danglingFinding.subject, /wrker \(as a recipient\)/, "the recipient typo is named");
  assert.match(danglingFinding.subject, /ghost \(as a sender\)/, "the sender typo is named");

  // 7. Seat drift, in BOTH directions, because both were live at once on the real
  //    rig (verified 2026-10-11: the live store held a stray `worker` and was
  //    missing `scribe`). They are not symmetric - a declared-but-absent seat
  //    cannot receive work at all, while a stray seat still has a working address
  //    - so a rule that reported only one direction would have reported half a
  //    real problem while looking complete.
  const seatDrift = auditRig({
    rig: "rig.starter.json",
    spec: {
      version: 2,
      seats: [
        { name: "pm", role: "Program manager" },
        { name: "scribe", role: "Documentation seat" },
      ],
      edges: [
        { from: "pm", maySendTo: ["scribe"] },
        { from: "scribe", maySendTo: ["pm"] },
      ],
    },
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    storedSeats: ["pm", "worker"],
    modelsBySeat: { pm: "a/x", scribe: "b/y" },
  });
  const missingSeat = seatDrift.findings.find((f) => f.id === "store-missing-seat");
  const straySeat = seatDrift.findings.find((f) => f.id === "stray-seat");
  assert.ok(missingSeat, "a seat the rig file declares and the store lacks is reported");
  assert.equal(missingSeat.subject, "scribe", "the absent seat is named");
  assert.equal(missingSeat.severity, "error", "an absent seat cannot receive work at all");
  assert.match(missingSeat.fix, /cli\.mjs up/, "and the fix is the command that creates it");
  assert.ok(straySeat, "a seat the store holds and the file does not declare is reported");
  assert.equal(straySeat.subject, "worker", "the stray seat is named");
  assert.equal(straySeat.severity, "fix-now", "a stray seat still has a working address");
  assert.equal(seatDrift.summary.error, 1, "only the missing seat is an error here");

  // A store whose seats match the file reports neither direction.
  const seatMatch = auditRig({
    rig: "x",
    spec: hardenedSpec(),
    specConstitution: CONSTITUTION,
    stored: { reason: "read", text: CONSTITUTION },
    storedSeats: ["alpha", "verifier"],
    modelsBySeat: { alpha: "a/x", verifier: "b/y" },
  });
  assert.ok(!ids(seatMatch).includes("store-missing-seat"), "matching seats are not drift");
  assert.ok(!ids(seatMatch).includes("stray-seat"), "and neither direction fires");

  // 8. Silence must be legible: an unread store yields "skipped with a reason",
  //    never a pass and never a finding.
  const unread = auditRig({
    rig: "x",
    spec: naiveSpec(),
    specConstitution: undefined,
    stored: { reason: "absent" },
    modelsBySeat: { alpha: "a/x", beta: "b/y" },
  });
  for (const id of ["constitution-missing", "constitution-not-applied", "store-missing-seat", "stray-seat"]) {
    const check = unread.checks.find((c) => c.id === id);
    assert.equal(check.status, "skipped", `${id} is skipped when the store cannot be read`);
    assert.ok(check.why, `${id} says why it was skipped`);
  }
  assert.ok(!ids(unread).includes("constitution-missing"), "an unread store is not reported as missing");
  assert.ok(!ids(unread).includes("constitution-not-applied"));

  // 9. Rendering is plain text unless color is asked for, and always carries the
  //    rule id and the fix an operator needs.
  const plain = formatCheck(naive, { rigDisplay: "naive.rig.json", seats: 2, storeReason: "read" });
  assert.ok(!plain.includes("\x1b["), "no ANSI when color is off");
  assert.match(plain, /constitution-missing/, "the report names the rule");
  assert.match(plain, /fix: /, "the report carries the fix");
  assert.match(plain, /FAIL/, "the verdict is stated");
  const colored = formatCheck(naive, { rigDisplay: "naive.rig.json", color: true, seats: 2, storeReason: "read" });
  assert.ok(colored.includes("\x1b["), "color is opt-in and used when asked");
  const clean = formatCheck(hardened, { rigDisplay: "hardened.rig.json", seats: 2, storeReason: "read" });
  assert.match(clean, /no findings/, "a clean rig says so rather than printing nothing");

  // 10. CLI wiring + the linter contract: the same rig file, audited twice, once
  //    against an empty store (errors -> exit 1) and once after `up` applied the
  //    declared constitution (errors clear -> exit 0).
  const naivePath = join(dir, "naive.rig.json");
  writeFileSync(naivePath, JSON.stringify(naiveSpec()));
  const naiveDb = join(dir, "naive.sqlite");
  const upNaive = await cli(["up", naivePath], { DURIG_DB: naiveDb });
  assert.equal(upNaive.code, 0, `up (naive) failed: ${upNaive.stderr.slice(0, 200)}`);
  const checkNaive = await cli(["check", naivePath], { DURIG_DB: naiveDb });
  assert.equal(checkNaive.code, 1, "a rig with errors exits nonzero");
  const naivePayload = JSON.parse(checkNaive.stdout);
  assert.equal(naivePayload.ok, true, "ok reports that the audit ran, not that the rig passed");
  assert.equal(naivePayload.command, "check");
  assert.equal(naivePayload.pass, false);
  assert.equal(naivePayload.store, "read", "the store is named in the contract");
  assert.deepEqual(ids(naivePayload), ids(naive), "CLI findings match the pure audit");
  assert.equal(checkNaive.stderr, "", "the JSON contract owns stdout; nothing leaks to stderr");

  const hardPath = join(dir, "hardened.rig.json");
  writeFileSync(hardPath, JSON.stringify(hardenedSpec()));
  const hardDb = join(dir, "hardened.sqlite");
  const upHard = await cli(["up", hardPath], { DURIG_DB: hardDb });
  assert.equal(upHard.code, 0, `up (hardened) failed: ${upHard.stderr.slice(0, 300)}`);
  const checkHard = await cli(["check", hardPath], { DURIG_DB: hardDb });
  assert.equal(checkHard.code, 0, `hardened rig passes; got ${checkHard.stdout}${checkHard.stderr}`);
  const hardPayload = JSON.parse(checkHard.stdout);
  assert.equal(hardPayload.summary.error, 0, "every error the naive rig had is cleared");
  assert.ok(
    hardPayload.findings.length < naivePayload.findings.length,
    "the hardened report narrows against the naive one",
  );

  // Every finding's fix must name a command that actually exists. `check`
  // shipped telling the operator to "re-measure with: node cli.mjs metrics",
  // and there is no metrics command, so the advice was unrunnable - the exact
  // class of defect an audit is supposed to catch, in its own output. Read the
  // dispatch chain out of cli.mjs and hold the fixes to it.
  const cliSource = readFileSync(join(durigDir, "cli.mjs"), "utf8");
  const dispatched = new Set(
    [...cliSource.matchAll(/cmd === "([a-z][a-z-]*)"/g)].map((m) => m[1]),
  );
  assert.ok(dispatched.has("check"), "sanity: the dispatch chain is being read");
  for (const payload of [naivePayload, hardPayload]) {
    for (const finding of payload.findings) {
      for (const [, verb] of (finding.fix ?? "").matchAll(
        /node cli\.mjs\s+([a-z][a-z-]*)/g,
      )) {
        assert.ok(
          dispatched.has(verb),
          `${finding.id}: fix names "node cli.mjs ${verb}", which is not a command cli.mjs dispatches`,
        );
      }
    }
  }

  console.log("CHECK TEST PASS (rules, drift regression, verifier heuristic, edges, skipped, render, CLI, fix commands)");
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}

// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
