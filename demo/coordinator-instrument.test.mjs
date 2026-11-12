// demo/coordinator-instrument.test.mjs — `run_readonly`: a coordinator's instrument, not a shell.
//
// WHY THIS EXISTS (operator decision 2026-11-12T18:5xZ). `COORDINATOR_REMOVALS` used to strip `read` along
// with `write`/`edit`/`shell`, on a real prior failure: "pm investigated the repository instead of routing
// the request". But that also removed MEASUREMENT, and the cost is on the record — pm's continuity note
// says "every measurement quoted here is relayed by another seat or the delegate", the same 10-bin landing
// plan was sent twice as prose, and rows #7136 ("priority leases are inert") and #7237 ("main is red")
// survived for hours because nobody who could route could check them.
//
// The fix is an allowlist of NAMED, read-only entrypoints. This demo pins the five claims that make it
// safe to hand to the deciding seat:
//   1. the table is the only source of commands; an unknown name is refused and lists the known ones;
//   2. every argument token is validated, so shell syntax cannot reach a shell at all;
//   3. `git` is read-only by subcommand NAME, and landing (`scripts/land.mjs`) is refused even if a token
//      spells it;
//   4. a timeout returns BLOCKED — a bounded non-answer the router can act on — and never throws;
//   5. the coordinator still IS a coordinator: `read` comes back, and `seatIsCoordinator` (which gates the
//      coordinator-only `release` authority, #6097/#6112) is unchanged.
//
// Run: node demo/coordinator-instrument.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import {
  GIT_READONLY_SUBCOMMANDS,
  READONLY_COMMANDS,
  READONLY_TIMEOUT_S,
  SAFE_TOKEN,
  buildReadonlyCommand,
  runReadonlyCommand,
  unknownCommandText,
} from "../src/readonlytool.mjs";
import { COORDINATOR_REMOVALS, seatIsCoordinator, seatHasReadTool, seatTools, toolRemovalsFor } from "../src/seattools.mjs";

const PM = { name: "pm", role: "program manager", capabilities: ["route", "plan"] };
const IMPL = { name: "impl", role: "implementation engineer", capabilities: ["implement", "code"] };

console.log("=== 1. THE TABLE IS THE ONLY SOURCE, AND AN UNKNOWN NAME TEACHES THE BOUNDARY ===");
{
  const names = Object.keys(READONLY_COMMANDS);
  assert.ok(names.length >= 7, `the table names the measurements a router needs (${names.join(", ")})`);
  for (const required of ["landing-plan", "drain-audit", "branch-census", "queue", "status", "test", "git"]) {
    assert.ok(names.includes(required), `"${required}" is allowlisted — a router's questions must be answerable`);
  }
  const refused = buildReadonlyCommand("landing", []);
  assert.equal(refused.ok, false, "a name that is not in the table is refused");
  assert.match(refused.refusal, /not an allowlisted measurement/, "and it says so");
  assert.match(unknownCommandText("x"), /landing-plan/, "the refusal lists what IS allowed, so the next call is informed");
  console.log(`  ok   ${names.length} named measurements; an unknown name is refused with the list`);
}

console.log("\n=== 2. NO SHELL SYNTAX CAN REACH A SHELL ===");
{
  assert.equal(buildReadonlyCommand("branch-census", ["--json"]).ok, true, "a plain flag is fine");
  assert.deepEqual(buildReadonlyCommand("queue", ["--status", "queued", "--json", "--no-body"]).argv, [
    "node", "cli.mjs", "queue", "--status", "queued", "--json", "--no-body",
  ], "the argv is the table prefix plus validated tokens — assembled once, never shell-parsed from prose");
  for (const evil of ["--json;rm -rf /", "$(id)", "`id`", "a|b", "a&&b", "a>b", "'x'", '"x"', "a b", "a\nb"]) {
    const r = buildReadonlyCommand("queue", [evil]);
    assert.equal(r.ok, false, `refused: ${JSON.stringify(evil)}`);
    assert.match(r.refusal, /outside \[A-Za-z0-9_\.:@\/=\+\-\]/, "the refusal names the character class");
  }
  assert.equal(SAFE_TOKEN.test("--no-body"), true);
  assert.equal(SAFE_TOKEN.test("item-7144"), true, "a ref name is a valid token");
  assert.equal(SAFE_TOKEN.test("a;b"), false);
  console.log("  ok   every shell metacharacter is refused at the token level, before any exec");
}

console.log("\n=== 3. GIT IS READ-ONLY BY NAME, AND LANDING IS NEVER A MEASUREMENT ===");
{
  assert.equal(buildReadonlyCommand("git", ["log", "--oneline", "-5"]).ok, true, "git log is a measurement");
  assert.equal(buildReadonlyCommand("git", ["status", "--short"]).ok, true);
  for (const write of ["commit", "merge", "rebase", "push", "checkout", "reset", "clean", "fetch", "tag"]) {
    const r = buildReadonlyCommand("git", [write]);
    assert.equal(r.ok, false, `git ${write} is refused`);
    assert.match(r.refusal, /not read-only here/, `the refusal for git ${write} names the rule`);
  }
  assert.ok(GIT_READONLY_SUBCOMMANDS.includes("merge-base"), "merge-base stays: proving an ancestor is how a landing is PROVEN");
  for (const token of ["land.mjs", "scripts/land.mjs", "node_modules/.bin/land.mjs"]) {
    const r = buildReadonlyCommand("queue", [token]);
    assert.equal(r.ok, false, `landing is never reachable through this tool (${token})`);
    assert.match(r.refusal, /not a measurement|outside/, "and the refusal says it is not a measurement");
  }
  const suite = buildReadonlyCommand("test", ["--all"]);
  assert.equal(suite.ok, false, "the whole suite (120 s of a turn) is refused");
  assert.match(suite.refusal, /ONE AREA/, "the refusal points at the fast loop instead");
  assert.equal(buildReadonlyCommand("test", ["--area", "docs"]).ok, true, "one area is allowed");
  console.log("  ok   git writes refused by name; land.mjs unreachable; --all refused, --area allowed");
}

console.log("\n=== 4. THE RUNNER NEVER THROWS: OK, ERROR AND BLOCKED ARE ALL TEXT ===");
{
  const okEnv = {
    cwd: "/repo",
    exec: async (cmd, opts) => {
      assert.ok(opts.timeout === READONLY_TIMEOUT_S, `a call is bounded at ${READONLY_TIMEOUT_S}s — a coordinator's read must not eat the turn (#5640)`);
      return { ok: true, value: { exitCode: 0 } };
    },
  };
  // `onOutput` is how the environment streams; the runner must collect it.
  const api = { env: { ...okEnv, exec: async (cmd, opts, ctx) => { opts.onOutput?.("refs 151\nworktrees 141\n"); return okEnv.exec(cmd, opts, ctx); } } };
  const text = await runReadonlyCommand(api, {}, "branch-census", ["--json"]);
  assert.match(text, /^RUN_READONLY branch-census exit=0/, "the result names the measurement and its exit code");
  assert.match(text, /refs 151/, "and carries the output");

  const timedOut = await runReadonlyCommand({ env: { cwd: "/repo", exec: async () => ({ ok: false, error: { code: "timeout" } }) } }, {}, "status", []);
  assert.match(timedOut, /BLOCKED/, "a timeout is BLOCKED, not a throw and not a number");
  assert.match(timedOut, /did not answer within 25 s/, "and it says what did not answer, and how long");

  const errored = await runReadonlyCommand({ env: { cwd: "/repo", exec: async () => ({ ok: false, error: { code: "spawn_error", message: "ENOENT" } }) } }, {}, "fleet", []);
  assert.match(errored, /RUN_READONLY ERROR \(spawn_error\)/, "a missing executable is a readable error");

  const noEnv = await runReadonlyCommand({}, {}, "status", []);
  assert.match(noEnv, /BLOCKED: this seat has no execution environment/, "a seat without an env is told to report, never to guess");

  const throwing = await runReadonlyCommand({ env: { cwd: "/repo", exec: async () => { throw new Error("boom"); } } }, {}, "status", []);
  assert.match(throwing, /RUN_READONLY ERROR: Error: boom/, "a thrown error becomes text too");
  console.log("  ok   ok/error/timeout/no-env/throw all return text; the 25 s bound is passed to exec");
}

console.log("\n=== 5. A COORDINATOR GAINS MEASUREMENT AND KEEPS ITS AUTHORITY ===");
{
  const removals = toolRemovalsFor(PM);
  assert.equal(removals.includes(seatTools.read), false, "a coordinator KEEPS read — it was removed with the write tools, and that is what made every number hearsay");
  for (const still of [seatTools.write, seatTools.edit, seatTools.shell, seatTools.prepareWorkspace]) {
    assert.ok(removals.includes(still), "a coordinator still loses the tools that CHANGE the repo");
  }
  assert.deepEqual(COORDINATOR_REMOVALS, [seatTools.write, seatTools.edit, seatTools.shell, seatTools.prepareWorkspace], "the removal list is exactly the write class");
  assert.equal(seatIsCoordinator(PM), true, "pm IS still a coordinator");
  assert.equal(seatIsCoordinator(IMPL), false, "a working seat is not");
  assert.equal(seatHasReadTool(PM), true, "so an over-threshold tool result can be dereferenced instead of demanded inline (#144 B)");
  assert.ok(seatTools.runReadonly, "and the instrument is registered as a seat tool");
  assert.equal(seatTools.runReadonly.name, "run_readonly");
  assert.equal(toolRemovalsFor(IMPL).length, 0, "a worker keeps everything: this change removes nothing from impl");
  console.log("  ok   read restored, write/edit/shell still removed, seatIsCoordinator (⇒ release authority) unchanged");
}

console.log("\nCOORDINATOR-INSTRUMENT PASS — named read-only measurements, no shell, a BLOCKED bound, and the coordinator's authority intact");
