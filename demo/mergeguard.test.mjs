// demo/mergeguard.test.mjs — landing safety (lead #1164 Q2): a WRITE verb must not run
// against a working tree that is mid-merge, and a conflicted src/checkup.mjs must not stop
// the CLI from LOADING at all.
//
// The incident (2026-10-17): a landing pass merged into the SHARED working tree while the
// rig was live. One branch conflicted, so the tree sat with `.git/MERGE_HEAD` and
// `<<<<<<<` markers in src/checkup.mjs. Because cli.mjs — and src/metrics.mjs and
// src/seattools.mjs — imported checkup at startup, EVERY verb died with a SyntaxError:
// status, queue, run, serve. The rig could not even be diagnosed. The harm was not the
// conflict; it was running anything at all against a half-merged tree.
//
// FAILING-FIRST: src/mergeguard.mjs does not exist (RED); cli.mjs statically imports
// checkup.mjs, so a broken checkup kills the load (RED); no MERGE_HEAD refusal exists (RED).
//
// Run: node demo/mergeguard.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findGitRoot, mergeInProgress, mergeRefusal } from "../src/mergeguard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CLI = join(ROOT, "cli.mjs");
const MERGE_SHA = "0123456789abcdef0123456789abcdef01234567";
const CLI_TIMEOUT_MS = 30000;

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** Run the REAL cli.mjs with `cwd` as the working tree and a throwaway store. */
function runCli(cwd, args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
    env: { ...process.env, DURIG_DB: join(cwd, "test.sqlite"), DURIG_NO_SERVE: "1", ...extraEnv },
  });
}

const tmp = mkdtempSync(join(tmpdir(), "durig-mergeguard-"));
const repo = join(tmp, "repo");

try {
  console.log("\n=== landing safety: merge guard + load resilience ===\n");

  // ── a throwaway repo to hold the merge states ─────────────────────────────────────
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(join(repo, "a.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);

  console.log("1. the guard reads the git state: clean, mid-merge, subdir, linked worktree");
  check("a clean tree is not mid-merge", mergeInProgress(repo) === null);
  check(
    "the git root is found",
    findGitRoot(repo)?.gitDir === join(repo, ".git"),
    JSON.stringify(findGitRoot(repo)),
  );

  const mergeHead = join(repo, ".git", "MERGE_HEAD");
  writeFileSync(mergeHead, `${MERGE_SHA}\n`);
  const mid = mergeInProgress(repo);
  check("MERGE_HEAD is detected", mid !== null && mid.mergeHead === mergeHead, JSON.stringify(mid));
  check("the merge commit is reported", mid?.sha === MERGE_SHA, JSON.stringify(mid?.sha));
  check(
    "a SUBDIRECTORY resolves to the same repo",
    mergeInProgress(join(repo, "sub", "deep"))?.root === repo,
  );
  const refusal = mergeRefusal("reset", mid);
  check(
    "the refusal names the state, the file and the verb",
    /MERGE IS IN PROGRESS/.test(refusal) && refusal.includes("MERGE_HEAD") && refusal.includes("reset"),
    refusal,
  );

  // A LINKED worktree — `.git` is a FILE ("gitdir: ..."), which is how every durian-pi item
  // is checked out. If the guard did not follow that file it would be blind in exactly the
  // checkouts a seat works in.
  const linked = join(tmp, "linked");
  git(repo, ["worktree", "add", "--detach", linked, "HEAD"]);
  check(
    "a linked worktree's .git is a FILE",
    existsSync(join(linked, ".git")) &&
      readFileSync(join(linked, ".git"), "utf8").startsWith("gitdir:") &&
      !existsSync(join(linked, ".git", "MERGE_HEAD")),
  );
  check("the linked worktree starts clean", mergeInProgress(linked) === null);
  // git keeps MERGE_HEAD per worktree: <main>/.git/worktrees/<name>/MERGE_HEAD
  const linkedGitDir = findGitRoot(linked).gitDir;
  writeFileSync(join(linkedGitDir, "MERGE_HEAD"), `${MERGE_SHA}\n`);
  const linkedMid = mergeInProgress(linked);
  check(
    "a mid-merge LINKED worktree is detected THROUGH the .git file",
    linkedMid !== null && linkedMid.root === linked,
    JSON.stringify(linkedMid),
  );
  check("the main repo keeps its own merge state", mergeInProgress(repo) !== null);
  rmSync(join(linkedGitDir, "MERGE_HEAD"));

  console.log("\n2. the CLI: a WRITE verb refuses legibly; READ verbs still work");
  const refused = runCli(repo, ["reset", "impl"]);
  const refusedText = `${refused.stdout}${refused.stderr}`;
  check("a write verb exits non-zero", refused.status !== 0, `status=${refused.status}`);
  check("...and names the merge state", /MERGE IS IN PROGRESS/.test(refusedText), refusedText.slice(0, 240));
  check("...and names MERGE_HEAD", refusedText.includes("MERGE_HEAD"));
  check("...and names the remedy", /Finish the merge|abort it/.test(refusedText));
  check(
    "...and does NOT fall through to its own arg/store error",
    !/unknown seat|no seats in|needs <seat>/.test(refusedText),
    refusedText.slice(0, 240),
  );

  const configRead = runCli(repo, ["config"]);
  check(
    "a READ verb is allowed (config exits 0)",
    configRead.status === 0,
    `status=${configRead.status}: ${(configRead.stdout + configRead.stderr).slice(0, 160)}`,
  );
  const statusRead = runCli(repo, ["status"]);
  check(
    "a READ verb is not refused (status)",
    !/MERGE IS IN PROGRESS/.test(`${statusRead.stdout}${statusRead.stderr}`),
  );
  // Only MUTATIONS are refused: a control action and a dry run are not mutations.
  const stopServe = runCli(repo, ["serve", "--stop"]);
  check(
    "`serve --stop` is NOT refused (the broker must be stoppable mid-incident)",
    !/MERGE IS IN PROGRESS/.test(`${stopServe.stdout}${stopServe.stderr}`),
  );
  const dry = runCli(repo, ["reset", "impl", "--dry-run"]);
  check("a --dry-run is NOT refused (it writes nothing)", !/MERGE IS IN PROGRESS/.test(`${dry.stdout}${dry.stderr}`));

  console.log("\n3. once the merge is over, the write verb is not refused");
  rmSync(mergeHead);
  const after = runCli(repo, ["reset", "impl"]);
  check(
    "no merge refusal after MERGE_HEAD is gone",
    !/MERGE IS IN PROGRESS/.test(`${after.stdout}${after.stderr}`),
    `${after.stdout}${after.stderr}`.slice(0, 200),
  );

  console.log("\n4. a conflicted src/checkup.mjs must not stop the CLI from LOADING");
  const hookDir = join(tmp, "hook");
  mkdirSync(hookDir);
  writeFileSync(
    join(hookDir, "hook.mjs"),
    `export async function load(url, context, next) {\n` +
      `  if (url.endsWith("/src/checkup.mjs")) {\n` +
      `    return { format: "module", shortCircuit: true, source: 'throw new SyntaxError("simulated conflicted src/checkup.mjs");' };\n` +
      `  }\n  return next(url, context);\n}\n`,
  );
  writeFileSync(
    join(hookDir, "preload.mjs"),
    `import { register } from "node:module";\nregister(new URL("./hook.mjs", import.meta.url));\n`,
  );
  const preload = pathToFileURL(join(hookDir, "preload.mjs")).href;
  const checkupUrl = pathToFileURL(join(ROOT, "src", "checkup.mjs")).href;

  // CONTROL: the simulated fault really does break checkup.mjs — otherwise the test below
  // would pass for the wrong reason (a hook that never fires).
  const control = spawnSync(
    process.execPath,
    ["--import", preload, "--input-type=module", "-e", `await import(${JSON.stringify(checkupUrl)})`],
    { cwd: ROOT, encoding: "utf8", timeout: CLI_TIMEOUT_MS },
  );
  check("control: the simulated fault DOES break checkup.mjs", control.status !== 0, `status=${control.status}`);

  const helped = spawnSync(process.execPath, ["--import", preload, CLI, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
  });
  check(
    "cli.mjs still LOADS with a broken checkup.mjs (--help exits 0)",
    helped.status === 0,
    `status=${helped.status}: ${helped.stderr.slice(0, 240)}`,
  );
  check("...and printed its usage", /usages:/.test(helped.stderr));

  // And the verb that genuinely NEEDS checkup fails loudly rather than pretending — a
  // degraded `check` is the designed behaviour, a silent all-clear would not be.
  const checked = spawnSync(process.execPath, ["--import", preload, CLI, "check", "rig.selfdev.json"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
    env: { ...process.env, DURIG_DB: join(tmp, "check.sqlite") },
  });
  check(
    "`check` (which needs checkup) fails rather than pretending",
    checked.status !== 0 && /checkup/.test(`${checked.stdout}${checked.stderr}`),
    `status=${checked.status}: ${(checked.stdout + checked.stderr).slice(0, 200)}`,
  );

  console.log(
    failures === 0
      ? "\nPASS - the merge guard refuses mutations mid-merge (reads still work); a broken checkup no longer kills the CLI"
      : `\nFAIL - ${failures} check(s) failed`,
  );
} catch (err) {
  console.error("ERROR:", err?.stack ?? err);
  failures += 1;
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
}

process.exit(failures === 0 ? 0 : 1);
