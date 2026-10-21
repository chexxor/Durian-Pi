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
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // The helper's FF lock is keyed on the rig's generation-slot cap; give the temp repo one.
    env: { ...process.env, DURIG_MAX_CONCURRENT_SEATS: "2" },
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(25);
  }
  return fn();
};
/**
 * Spawn the REAL helper ASYNCHRONOUSLY so its wait/lock can be observed while it runs.
 * `db === null` omits --db AND DURIG_DB, so the helper must RESOLVE the store itself (#1383).
 */
const landAsync = (argv, extraEnv = {}, db = join(repo, "rig.sqlite")) => {
  const env = { ...process.env, DURIG_MAX_CONCURRENT_SEATS: "2", ...extraEnv };
  if (db === null) delete env.DURIG_DB;
  const args = [...argv, "--repo", repo];
  if (db !== null) args.push("--db", db);
  const child = spawn(process.execPath, [LAND, ...args], { cwd: repo, env });
  child.out = "";
  child.stdoutText = "";
  child.stderrText = "";
  child.stdout.on("data", (d) => {
    child.out += d;
    child.stdoutText += d;
  });
  child.stderr.on("data", (d) => {
    child.out += d;
    child.stderrText += d;
  });
  // 'close' (not 'exit') so stdout is fully flushed before the report is parsed.
  child.done = new Promise((r) => child.on("close", (c) => r(c)));
  return child;
};

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

  console.log("\n2b. a STRAY worktree directory at the repo root refuses to land (#4139)");
  // A write to a REAPED worktree path recreates `item-<id>/` inside the repo. `/item-*/` is IGNORED,
  // so `git status --porcelain` never shows it - the tracked/untracked rule above structurally cannot
  // see this class. A directory named for an item has no business being a repo-root child.
  const stray = join(repo, "item-9999");
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, "probe.mjs"), "// left by a write to a reaped worktree\n");
  const beforeStray = mainSha(repo);
  const strayRun = land(repo, ["feat-b"]);
  check("the helper refuses (nonzero)", strayRun.code !== 0, strayRun.raw.slice(0, 200));
  check("...naming the stray directory", /item-9999/.test(strayRun.report?.error ?? ""), strayRun.report?.error);
  check("...and main did NOT advance", mainSha(repo) === beforeStray);
  rmSync(stray, { recursive: true, force: true });

  console.log("\n2c. a LIVE (registered) worktree is NOT stray - only the unregistered leftover is named");
  // A live worktree is legitimately `item-<id>/` at the root, so the test is REGISTRATION, not the
  // name. With BOTH present, the refusal must name the stray and NOT the registered one.
  const live = join(repo, "item-8888");
  git(repo, ["worktree", "add", "-b", "wt-live", live]);
  const stray2 = join(repo, "item-9999");
  mkdirSync(stray2, { recursive: true });
  const mixed = land(repo, ["feat-b"]);
  check("the refusal names the STRAY one", /item-9999/.test(mixed.report?.error ?? ""), mixed.report?.error);
  check("...and NOT the registered one", !/item-8888/.test(mixed.report?.error ?? ""), mixed.report?.error);
  rmSync(stray2, { recursive: true, force: true });
  git(repo, ["worktree", "remove", "--force", live]);
  check("the tree is clean again", git(repo, ["status", "--porcelain"]) === "");

  console.log("\n2d. a LINKED worktree is not a landing target — refuse unless repo IS the shared root (#4247)");
  // The measured failure: `node scripts/land.mjs <branch>` run from INSIDE an item worktree created a
  // store there, merged there, and returned ok:true, merged:[...] with main untouched. A seat's cwd is
  // its worktree by default, so this is the NATURAL mistake - and the cwd guard cannot see it, because
  // an item worktree is not a DEGRADED cwd, it is the WRONG repository to land INTO.
  const linked = join(repo, "item-7777");
  git(repo, ["worktree", "add", "-b", "wt-land", linked]);
  const beforeLinked = mainSha(repo);
  const wrongRepo = land(linked, ["feat-b"]);
  check("landing INTO a linked worktree is REFUSED", wrongRepo.code !== 0, wrongRepo.raw.slice(0, 200));
  check("...naming the linked path", /item-7777/.test(wrongRepo.report?.error ?? ""), wrongRepo.report?.error);
  const norm = (p) => String(p ?? "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  check(
    "...and it identifies the SHARED ROOT as the landing target",
    typeof wrongRepo.report?.sharedRoot === "string" && norm(wrongRepo.report.sharedRoot) === norm(repo),
    wrongRepo.report?.sharedRoot,
  );
  check("...and names the REMEDY (run it from the shared tree)", /shared tree/.test(wrongRepo.report?.error ?? ""), wrongRepo.report?.error);
  check(
    "...and prints NO merged:[...] against the wrong repository",
    !Array.isArray(wrongRepo.report?.merged) || wrongRepo.report.merged.length === 0,
    JSON.stringify(wrongRepo.report?.merged),
  );
  check("...and main did NOT advance", mainSha(repo) === beforeLinked);
  git(repo, ["worktree", "remove", "--force", linked]);


  console.log("\n3. a HELD genlock makes the lander WAIT with PRIORITY — it does NOT refuse (#1497/#1498)");
  const slot = join(repo, "rig.sqlite.genlock.0");
  // A LIVE holder with a DIFFERENT pid, so "held by someone else" is genuinely exercised.
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  writeFileSync(slot, JSON.stringify({ pid: holder.pid, seat: "impl", since: new Date().toISOString() }));
  const beforeLock = mainSha(repo);
  const lockedRun = landAsync(["feat-b"]);
  const sawPriority = await waitFor(() => existsSync(join(repo, "rig.sqlite.genlock.priority")), 8000);
  check("the lander PUBLISHES a priority reservation and WAITS (it does not refuse)", sawPriority, lockedRun.out.slice(0, 200));
  check("...and it has NOT REPORTED yet (it is waiting on the live holder)", lockedRun.stdoutText.trim() === "", lockedRun.out.slice(0, 200));
  check("...and main did NOT advance", mainSha(repo) === beforeLock);
  rmSync(slot, { force: true }); // the holder's generation finishes and releases the slot
  const lockedCode = await lockedRun.done;
  check("once the holder releases, the landing COMPLETES", lockedCode === 0, lockedRun.out.slice(0, 300));
  check("...and main advanced", mainSha(repo) !== beforeLock);
  check("...and the priority reservation is RELEASED", !existsSync(join(repo, "rig.sqlite.genlock.priority")));
  check("...and no generation slot is left held", [0, 1].every((i) => !existsSync(join(repo, `rig.sqlite.genlock.${i}`))));
  holder.kill();
  // A slot file that is NOT a live holder must not block a landing: the broker reconciles
  // stale slots, and a partial write parses as no holder at all (the code says so).
  writeFileSync(slot, '{"pid": 123, "seat"');
  const staleOk = land(repo, ["feat-b"]);
  check("a partial/unreadable slot (no live holder) does not block", staleOk.code === 0, staleOk.raw.slice(0, 200));
  rmSync(slot, { force: true });

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
  // feat-c and feat-d fork from the SAME pre-landing main and rewrite the same line. feat-c lands
  // first (main advances); feat-d is then a STALE tip — it contains preC, not current main. The
  // pre-flight does NOT refuse it (#3929): ancestry is a fast path and CONTENT proves landability,
  // so feat-d reaches the merge and CONFLICTS there.
  const landedC = land(repo, ["feat-c"]);
  check("feat-c lands cleanly first", landedC.code === 0, landedC.raw.slice(0, 200));
  const beforeConflict = mainSha(repo);
  const conflicted = land(repo, ["feat-d"]);
  check("a STALE branch is NOT refused on ancestry — it reaches the merge", conflicted.code !== 0, conflicted.raw.slice(0, 200));
  check("...and it STOPS on a CONFLICT, not a stale refusal",
    (conflicted.report?.conflicted ?? []).includes("a.txt") && !/stale/.test(conflicted.report?.error ?? ""),
    JSON.stringify(conflicted.report?.conflicted));
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

  console.log("\n4b. the pre-flight REFUSES a branch carrying COMMITTED CONFLICT MARKERS (#3916)");
  // A branch that resolves AND has valid ancestry — it passes rev-parse and the ancestry check —
  // but carries a committed conflict marker. Only the third check catches it, and this is the
  // check that catches devtools-item-2187 (76 files of markers, both other checks pass).
  const markerBranch = "feat-markers";
  git(repo, ["switch", "-c", markerBranch, "main"]);
  writeFileSync(join(repo, "m.txt"), "ok\n<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> other\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "feat: a branch with a committed conflict marker"]);
  git(repo, ["switch", "main"]);
  const beforeMarker = mainSha(repo);
  const markerRefused = land(repo, [markerBranch]);
  check("the helper REFUSES a branch with committed conflict markers", markerRefused.code !== 0, markerRefused.raw.slice(0, 200));
  check("...and names the marker file", (markerRefused.report?.conflictMarkerFiles ?? []).includes("m.txt"), JSON.stringify(markerRefused.report?.conflictMarkerFiles));
  check("...and main did NOT advance", mainSha(repo) === beforeMarker);
  check("...and no scratch worktree is left", !git(repo, ["worktree", "list"]).includes(".land-scratch-"));

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
  // #4436: WITHOUT --suite the landing still succeeds, but the ABSENCE of the gate is NAMED rather
  // than reported as `null`. Three landings today read `"suite": null` and each seat correctly
  // refused to claim a baseline it did not have, with no way to tell WHY.
  const featE2 = feature("feat-e2", "e2.txt", "from feat-e2\n");
  const noSuite = land(repo, ["feat-e2"]);
  check("a landing WITHOUT --suite still succeeds (the gate is opt-in)", noSuite.code === 0, noSuite.raw.slice(0, 200));
  check(
    "...and the ABSENCE of the gate is NAMED, not `null` (#4436)",
    typeof noSuite.report?.suite === "string" && /not run/.test(noSuite.report.suite),
    JSON.stringify(noSuite.report?.suite),
  );
  check("...and the report says the landing was NOT regression-checked", /NOT regression-checked/.test(noSuite.report?.suite ?? ""), noSuite.report?.suite);
  rmSync(join(repo, "demo", "bad.test.mjs"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "test: drop the failing demo"]);

  console.log("\n6. the guard refuses when the shared tree is ALREADY mid-merge");
  writeFileSync(join(repo, ".git", "MERGE_HEAD"), `${mainSha(repo)}\n`);
  const midMerge = land(repo, ["feat-e"]);
  check("a mid-merge tree refuses to land", midMerge.code !== 0 && /mid-merge/.test(midMerge.report?.error ?? ""), midMerge.report?.error);
  rmSync(join(repo, ".git", "MERGE_HEAD"));

  console.log("\n7. the genlock probe resolves the LIVE store, not a silent wrong default (#1383)");
  const featG = feature("feat-g", "g.txt", "from feat-g\n");
  // A live genlock on a store OTHER than the old rig.sqlite default.
  const liveSlot = join(repo, "selfdev.sqlite.genlock.0");
  writeFileSync(liveSlot, JSON.stringify({ pid: process.pid, seat: "impl", since: new Date().toISOString() }));
  const beforeResolve = mainSha(repo);
  // (a) NO --db: the helper must RESOLVE selfdev.sqlite — and WAIT on it, not pass silently.
  const resolvedPriority = join(repo, "selfdev.sqlite.genlock.priority");
  const resolvedRun = landAsync(["feat-g"], {}, null);
  const sawResolve = await waitFor(() => existsSync(resolvedPriority), 8000);
  check("with NO --db the helper RESOLVES the live store (its reservation lands beside selfdev.sqlite)", sawResolve, resolvedRun.out.slice(0, 200));
  // #4432: the wait is now LEGIBLE. Before, the lander produced NO output while blocked, so a seat
  // could not tell a lock wait from a hung demo (#3761) and RETRIED — which adds contention. The
  // assertion is the opposite of the old one: the wait PRINTS, with its holder count. The line lands
  // on stderr as the slot wait begins, so WAIT for it rather than sampling a moment too early.
  const sawWait = await waitFor(() => /landing lock: waiting for slot/.test(resolvedRun.out), 8000);
  check(
    "...and it WAITS on the resolved store, and the WAIT is LEGIBLE with its holder count (#4432)",
    sawWait,
    resolvedRun.out.slice(0, 200),
  );
  check("...and main did NOT advance", mainSha(repo) === beforeResolve);
  // (b) an explicit --db rig.sqlite is NOT a silent pass while ANOTHER store holds the live lock.
  const wrongDb = land(repo, ["feat-g"]);
  check("an explicit --db rig.sqlite is NOT a silent pass while the live store is locked", wrongDb.code !== 0, wrongDb.raw.slice(0, 200));
  check("...and the refusal NAMES the store holding the live lock", /selfdev\.sqlite/.test(wrongDb.report?.error ?? ""), wrongDb.report?.error);
  check("...and main did NOT advance", mainSha(repo) === beforeResolve);
  // (c) release the live lock: the resolved-store lander completes and NAMES the store it used.
  rmSync(liveSlot, { force: true });
  const resolvedCode = await resolvedRun.done;
  const resolvedReport = tryJson(resolvedRun.stdoutText);
  check("with the live slot gone, the same landing succeeds", resolvedCode === 0, resolvedRun.out.slice(0, 300));
  check("...and the report NAMES the resolved store, not the rig.sqlite default", (resolvedReport?.db ?? "").includes("selfdev.sqlite"), resolvedReport?.db);
  check("...and feat-g is an ancestor of main", spawnSync("git", ["merge-base", "--is-ancestor", featG, "main"], { cwd: repo }).status === 0);
  check("...and the priority reservation is released", !existsSync(resolvedPriority));
  console.log("\n8. the FF holds an EXCLUSIVE lock across the advance, and releases it on every path");
  const slotPaths = [0, 1].map((i) => join(repo, `rig.sqlite.genlock.${i}`));
  const readSlot = (p) => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  // (waitFor/landAsync are hoisted to the top of the file — shared by sections 3, 7 and 8.)

  console.log("8a. the lock is HELD across the FF, cannot be interleaved, and is released on success");
  const featG2 = feature("feat-g-lock", "g2.txt", "from feat-g-lock\n");
  const heldRun = landAsync(["feat-g-lock"], { DURIG_LAND_HOLD_FF_MS: "1200" });
  const heldSeen = await waitFor(() => slotPaths.every((p) => readSlot(p)?.pid === heldRun.pid), 8000);
  check("the lander HOLDS all N slots across the FF", heldSeen, slotPaths.map((p) => JSON.stringify(readSlot(p))).join(" "));
  let claimErr = null;
  try {
    const fd = openSync(slotPaths[0], "wx");
    closeSync(fd);
  } catch (err) {
    claimErr = err?.code ?? String(err);
  }
  check("a concurrent generation CANNOT claim a slot while the lock is held", claimErr === "EEXIST", String(claimErr));
  const heldCode = await heldRun.done;
  check("the landing completes (exit 0)", heldCode === 0, heldRun.out.slice(0, 200));
  check("...and RELEASES the lock on the success path", slotPaths.every((p) => !existsSync(p)));
  check("...and main advanced to feat-g",
    spawnSync("git", ["merge-base", "--is-ancestor", featG2, "main"], { cwd: repo }).status === 0);

  console.log("8b. the lock is RELEASED on the failure path (the FF cannot apply)");
  const featH = feature("feat-h", "h.txt", "from feat-h\n");
  const failRun = landAsync(["feat-h"], { DURIG_LAND_HOLD_FF_MS: "1500" });
  const failSeen = await waitFor(() => slotPaths.every((p) => readSlot(p)?.pid === failRun.pid), 8000);
  check("the lock is held again for the second run", failSeen);
  git(repo, ["commit", "--allow-empty", "-m", "concurrent commit while the lander holds the lock"]);
  const failCode = await failRun.done;
  check("the fast-forward FAILS once main has moved (nonzero)", failCode !== 0, failRun.out.slice(0, 200));
  check("...and the lock is RELEASED on the failure path", slotPaths.every((p) => !existsSync(p)));
  check("...and the branch did NOT land",
    spawnSync("git", ["merge-base", "--is-ancestor", featH, "main"], { cwd: repo }).status !== 0);

  console.log("8c. a generation that starts DURING the scratch merges makes the FF WAIT for the lock");
  writeFileSync(
    join(repo, "demo", "hold.test.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      "const dir = process.env.LAND_TEST_SLOT_DIR;",
      "if (dir) {",
      "  const ms = Number(process.env.LAND_TEST_HOLD_MS || 1500);",
      '  const child = spawn(process.execPath, ["-e", `setTimeout(()=>{}, ${ms})`], { detached: true, stdio: "ignore" });',
      "  child.unref();",
      "  writeFileSync(`${dir}/rig.sqlite.genlock.0`, JSON.stringify({ pid: child.pid, seat: \"impl\", since: new Date().toISOString() }));",
      "}",
      "",
    ].join("\n"),
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "test: a fixture that simulates a generation starting mid-landing"]);
  const featI = feature("feat-i", "i.txt", "from feat-i\n");
  const waitStart = Date.now();
  const waited = spawnSync(process.execPath, [LAND, "feat-i", "--suite", "--repo", repo, "--db", join(repo, "rig.sqlite")], {
    cwd: repo,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, DURIG_MAX_CONCURRENT_SEATS: "1", LAND_TEST_SLOT_DIR: repo, LAND_TEST_HOLD_MS: "1500" },
  });
  const waitedMs = Date.now() - waitStart;
  check("the FF WAITS for the in-flight generation (elapsed >= 1s)", waited.status === 0 && waitedMs >= 1000, `exit ${waited.status} in ${waitedMs}ms`);
  check("...and the landing advances main once the lock frees",
    spawnSync("git", ["merge-base", "--is-ancestor", featI, "main"], { cwd: repo }).status === 0);
  check("...and the lock is released (no slots remain)", [0, 1].every((i) => !existsSync(join(repo, `rig.sqlite.genlock.${i}`))));

  console.log("\n9. the slot cap resolves like the BROKER: env > config file > SHIPPED defaults (#2224A)");
  // The FF lock is only as wide as the lander's slot count, so the lander must resolve the SAME
  // N the broker does (cli.mjs maxSeats() over CFG: env > config file > the shipped DEFAULTS
  // file). The old lander read only `durig.config.json` and then fell back to UNCAPPED, while
  // the broker fell back to the shipped default (1) -- on a config-less checkout the lander took
  // NO lock while the broker was capped, and could fast-forward main with a generation in flight.
  // `report.lock` exposes {slots, held}; slots=null is the truthful "uncapped" answer.
  const landClean = (branch) => {
    const env = { ...process.env };
    delete env.DURIG_MAX_CONCURRENT_SEATS;
    const r = spawnSync(process.execPath, [LAND, branch, "--repo", repo, "--db", join(repo, "rig.sqlite")], {
      cwd: repo,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      env,
    });
    return { code: r.status ?? 1, report: tryJson(r.stdout), raw: `${r.stdout}${r.stderr}` };
  };

  console.log("9a. NO env, NO config file: the SHIPPED defaults file supplies the cap");
  const featJ = feature("feat-j", "j.txt", "from feat-j\n");
  const shippedDefault = join(repo, "durig.config.default.json");
  writeFileSync(shippedDefault, JSON.stringify({ DURIG_MAX_CONCURRENT_SEATS: 1 }));
  const fromShipped = landClean("feat-j");
  check("a config-less repo resolves the cap from the SHIPPED defaults (slots=1)", fromShipped.report?.lock?.slots === 1, JSON.stringify(fromShipped.report?.lock));
  check("...and the lander actually HELD that slot", fromShipped.report?.lock?.held === 1, JSON.stringify(fromShipped.report?.lock));
  check("...and the landing succeeded", fromShipped.code === 0, fromShipped.raw.slice(0, 200));
  check("...and feat-j is an ancestor of main",
    spawnSync("git", ["merge-base", "--is-ancestor", featJ, "main"], { cwd: repo }).status === 0);
  rmSync(shippedDefault, { force: true });

  console.log("9b. a `.durig/config.json` — the second discovery path the old lander IGNORED — supplies the cap");
  const featK = feature("feat-k", "k.txt", "from feat-k\n");
  mkdirSync(join(repo, ".durig"), { recursive: true });
  writeFileSync(join(repo, ".durig", "config.json"), JSON.stringify({ DURIG_MAX_CONCURRENT_SEATS: 2 }));
  const fromDotDurig = landClean("feat-k");
  check("a `.durig/config.json` cap is honored (slots=2)", fromDotDurig.report?.lock?.slots === 2, JSON.stringify(fromDotDurig.report?.lock));
  check("...and BOTH slots were held", fromDotDurig.report?.lock?.held === 2, JSON.stringify(fromDotDurig.report?.lock));
  check("...and the landing succeeded", fromDotDurig.code === 0, fromDotDurig.raw.slice(0, 200));
  rmSync(join(repo, ".durig", "config.json"), { force: true });

  console.log("9c. NOTHING declares a cap: the rig is genuinely UNCAPPED and the lander takes no slot");
  const featL = feature("feat-l", "l.txt", "from feat-l\n");
  const uncapped = landClean("feat-l");
  check("with no cap anywhere the rig is UNCAPPED (slots=null)", uncapped.report?.lock?.slots === null, JSON.stringify(uncapped.report?.lock));
  check("...and NO slot is held", uncapped.report?.lock?.held === 0, JSON.stringify(uncapped.report?.lock));
  check("...and the landing still succeeds", uncapped.code === 0, uncapped.raw.slice(0, 200));
  check("...and feat-l is an ancestor of main",
    spawnSync("git", ["merge-base", "--is-ancestor", featL, "main"], { cwd: repo }).status === 0);

  console.log(
    failures === 0
      ? "\nPASS - the landing helper merges in a scratch worktree, fast-forwards main only when clean, holds an EXCLUSIVE lock across the FF (released on success and failure), WAITS WITH PRIORITY for a live genlock holder, and refuses a dirty tree / a conflict / a failing suite"
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
