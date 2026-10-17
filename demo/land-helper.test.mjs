// demo/land-helper.test.mjs — landing safety A (lead #1164 Q1+Q3; items #1165/#1171): the
// scratch-worktree landing helper, and the pre-flight guard that is the ENFORCEMENT
// chokepoint.
//
// The 2026-10-17 incident: a landing pass merged verified branches into the SHARED working
// tree while the rig was live; a conflict left the tree mid-merge with `<<<<<<<` markers in
// src/checkup.mjs, and every `node cli.mjs` verb died. The fix must structurally prevent
// that state — the merges belong in a scratch detached worktree, and `main` advances only by
// a CLEAN FAST-FORWARD.
//
// FAILING-FIRST: scripts/land.mjs does not exist (RED), so nothing refuses a dirty tree, a
// held genlock, or a conflicted landing, and a conflicted landing has no scratch to live in.
//
// Run: node demo/land-helper.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LAND = join(ROOT, "scripts", "land.mjs");
const TIMEOUT_MS = 60000;

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function git(cwd, argv) {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${argv.join(" ")} failed: ${r.stderr || r.stdout}`);
  return (r.stdout ?? "").trim();
}

function mainSha(repo) {
  return git(repo, ["rev-parse", "main"]);
}

/** Run the REAL helper. Returns { code, report } — the report is its JSON stdout. */
function land(repo, argv) {
  const r = spawnSync(process.execPath, [LAND, ...argv, "--repo", repo, "--db", join(repo, "rig.sqlite")], {
    cwd: repo,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  let report = null;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    report = null;
  }
  return { code: r.status ?? 1, report, raw: `${r.stdout}${r.stderr}` };
}

const tmp = mkdtempSync(join(tmpdir(), "durig-land-"));
const repo = join(tmp, "repo");

try {
  console.log("\n=== landing safety A: scratch-worktree landing helper ===\n");

  mkdirSync(join(repo, "demo"), { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(join(repo, "a.txt"), "line one\n");
  writeFileSync(join(repo, "demo", "ok.test.mjs"), "console.log('ok');\nprocess.exit(0);\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["branch", "-M", "main"]);

  const feature = (name, file, body) => {
    git(repo, ["switch", "-c", name, "main"]);
    writeFileSync(join(repo, file), body);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", `feat: ${name}`]);
    const sha = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["switch", "main"]);
    return sha;
  };

  console.log("1. a clean landing advances main by FAST-FORWARD (the branch is in the shared tree)");
  const featA = feature("feat-a", "b.txt", "from feat-a\n");
  const before = mainSha(repo);
  const ok = land(repo, ["feat-a"]);
  check("the helper exits 0", ok.code === 0, ok.raw.slice(0, 300));
  check("...and reports ok", ok.report?.ok === true, JSON.stringify(ok.report)?.slice(0, 200));
  check("main ADVANCED", mainSha(repo) !== before, `${before} -> ${mainSha(repo)}`);
  check("...to the reported sha", ok.report?.main?.after === mainSha(repo));
  check("...and the branch's commit is an ancestor of main",
    spawnSync("git", ["merge-base", "--is-ancestor", featA, "main"], { cwd: repo }).status === 0);
  check("the branch's file is in the shared working tree", existsSync(join(repo, "b.txt")));
  check("the shared tree is clean afterwards", git(repo, ["status", "--porcelain"]) === "");
  check("no scratch worktree is left registered",
    !git(repo, ["worktree", "list"]).includes(".land-scratch-"));
  check("the shared tree is NOT mid-merge", !existsSync(join(repo, ".git", "MERGE_HEAD")));

  console.log("\n2. a DIRTY shared tree refuses to land (tracked modification)");
  const featB = feature("feat-b", "c.txt", "from feat-b\n");
  writeFileSync(join(repo, "a.txt"), "line one\nuncommitted edit\n");
  const beforeDirty = mainSha(repo);
  const dirty = land(repo, ["feat-b"]);
  check("the helper refuses (nonzero)", dirty.code !== 0, dirty.raw.slice(0, 200));
  check("...naming the tracked modification", /tracked modification/.test(dirty.report?.error ?? ""), dirty.report?.error);
  check("...and main did NOT advance", mainSha(repo) === beforeDirty);
  git(repo, ["checkout", "--", "a.txt"]);
  check("the tree is clean again", git(repo, ["status", "--porcelain"]) === "");

  console.log("\n3. a HELD genlock refuses to land");
  const slot = join(repo, "rig.sqlite.genlock.0");
  writeFileSync(slot, JSON.stringify({ pid: process.pid, seat: "impl", since: new Date().toISOString() }));
  const beforeLock = mainSha(repo);
  const locked = land(repo, ["feat-b"]);
  check("the helper refuses (nonzero)", locked.code !== 0, locked.raw.slice(0, 200));
  check("...naming the genlock", /genlock/.test(locked.report?.error ?? ""), locked.report?.error);
  check("...and main did NOT advance", mainSha(repo) === beforeLock);
  rmSync(slot);
  // A slot file that is NOT a live holder must not block a landing: the broker reconciles
  // stale slots, and a partial write parses as no holder at all (the code says so).
  writeFileSync(slot, '{"pid": 123, "seat"');
  const staleOk = land(repo, ["feat-b"]);
  check("a partial/unreadable slot (no live holder) does not block", staleOk.code === 0, staleOk.raw.slice(0, 200));
  rmSync(slot);

  console.log("\n4. a CONFLICT stops in the scratch — the shared tree is never mid-merge");
  // feat-c and feat-d branch from the SAME pre-landing main and rewrite the same line, so
  // feat-d genuinely conflicts once feat-c is in main.
  const preC = mainSha(repo);
  git(repo, ["switch", "-c", "feat-c", preC]);
  writeFileSync(join(repo, "a.txt"), "line one\nfrom feat-c\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "feat: feat-c"]);
  git(repo, ["switch", "-c", "feat-d", preC]);
  writeFileSync(join(repo, "a.txt"), "line one\nfrom feat-d\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "feat: feat-d"]);
  git(repo, ["switch", "main"]);
  const landedC = land(repo, ["feat-c"]);
  check("feat-c lands cleanly first", landedC.code === 0, landedC.raw.slice(0, 200));
  const beforeConflict = mainSha(repo);
  const conflicted = land(repo, ["feat-d"]);
  check("the helper stops (nonzero)", conflicted.code !== 0, conflicted.raw.slice(0, 200));
  check("...reports the conflicted path", (conflicted.report?.conflicted ?? []).includes("a.txt"), JSON.stringify(conflicted.report?.conflicted));
  check("...and main did NOT advance", mainSha(repo) === beforeConflict);
  check("THE POINT: the shared tree is NOT mid-merge", !existsSync(join(repo, ".git", "MERGE_HEAD")));
  const markers = spawnSync("git", ["grep", "-l", "<<<<<<<"], { cwd: repo, encoding: "utf8" });
  check("...and the shared tree has NO conflict markers", markers.stdout.trim() === "", markers.stdout);
  check("the scratch is removed by default", !git(repo, ["worktree", "list"]).includes(".land-scratch-"));
  // --keep holds the scratch so a conflict can be resolved in it.
  const kept = land(repo, ["feat-d", "--keep"]);
  check("--keep stops and NAMES the scratch", kept.code !== 0 && typeof kept.report?.scratch === "string", kept.raw.slice(0, 200));
  check("...and the scratch worktree really exists", existsSync(kept.report?.scratch ?? ""));
  if (kept.report?.scratch) {
    git(repo, ["worktree", "remove", "--force", kept.report.scratch]);
    git(repo, ["worktree", "prune"]);
  }
  check("the shared tree stayed clean through both conflict runs", git(repo, ["status", "--porcelain"]) === "");

  console.log("\n5. --suite: a failing demo in the scratch refuses to advance main");
  const featE = feature("feat-e", "e.txt", "from feat-e\n");
  const suiteOk = land(repo, ["feat-e", "--suite"]);
  check("--suite lands when every demo passes", suiteOk.code === 0, suiteOk.raw.slice(0, 300));
  check("...and reports the suite result", (suiteOk.report?.suite ?? []).some((s) => s.test === "ok.test.mjs" && s.exit === 0));
  check("...and the branch is an ancestor of main",
    spawnSync("git", ["merge-base", "--is-ancestor", featE, "main"], { cwd: repo }).status === 0);

  writeFileSync(join(repo, "demo", "bad.test.mjs"), "console.error('boom');\nprocess.exit(1);\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "test: a failing demo"]);
  const featF = feature("feat-f", "f.txt", "from feat-f\n");
  const beforeSuite = mainSha(repo);
  const suiteBad = land(repo, ["feat-f", "--suite"]);
  check("--suite REFUSES to advance main on a failing demo", suiteBad.code !== 0, suiteBad.raw.slice(0, 200));
  check("...and names the failing test", /bad\.test\.mjs/.test(suiteBad.report?.error ?? ""), suiteBad.report?.error);
  check("...and main did NOT advance", mainSha(repo) === beforeSuite);
  rmSync(join(repo, "demo", "bad.test.mjs"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "test: drop the failing demo"]);

  console.log("\n6. the guard refuses when the shared tree is ALREADY mid-merge");
  writeFileSync(join(repo, ".git", "MERGE_HEAD"), `${mainSha(repo)}\n`);
  const midMerge = land(repo, ["feat-e"]);
  check("a mid-merge tree refuses to land", midMerge.code !== 0 && /mid-merge/.test(midMerge.report?.error ?? ""), midMerge.report?.error);
  rmSync(join(repo, ".git", "MERGE_HEAD"));

  console.log(
    failures === 0
      ? "\nPASS - the landing helper merges in a scratch worktree, fast-forwards main only when clean, and refuses a dirty tree / a held genlock / a conflict / a failing suite"
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
