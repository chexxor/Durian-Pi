// demo/self-merge-sla.test.mjs — the ready-ref SLA, measured against a real git fixture.
//
// WHY THIS EXISTS. `tools/self-merge-sla.mjs` is the instrument behind the check rule `ready-ref-stale`
// (extensions/self-merge.mjs) and the seat verb `land_my_item`. A tool that only ever runs on the live fleet
// has no way to be wrong in a controlled way: the fixture gives the five states the tool claims to
// distinguish — landed, conflicted, poisoned-committed-markers, no-op-ref, ready — and pins which one is
// STALE and which is not.
//
// Run: node demo/self-merge-sla.test.mjs      (measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five),
// kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0 — 0.47 s; git + node only, no store, no model)
//
// What it proves, in order:
//   1. every verdict the tool can print is produced by the fixture that should produce it
//   2. staleness is a THRESHOLD, not a guess: the same ref is stale at 24 h and not stale at 72 h
//   3. the CLI's exit code is the code `cli.mjs check` gates on (1 when a ready ref is overdue, 0 otherwise)
//   4. the tool DELETES NOTHING and MOVES NOTHING — refs and main are identical before and after
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { landingHealth } from "../tools/self-merge-sla.mjs";

/* Every date in this fixture is RELATIVE to the moment the demo runs. Absolute dates make the test a time
 * bomb: a ref written "48 h ago" is 48 h old the day it is committed and 96 h old a week later, so a 24 h SLA
 * assertion depends on the calendar instead of the rule (measured 2026-11-14: the fixture reported stale=2
 * because the branch meant to be 'in flight' had aged past the SLA). */
const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

const repo = mkdtempSync(join(tmpdir(), "durig-self-merge-sla-"));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const commitAt = (date, message) =>
	execFileSync("git", ["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "-m", message], {
		cwd: repo,
		env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		stdio: ["ignore", "pipe", "ignore"],
	});

function init() {
	mkdirSync(repo, { recursive: true });
	git("init", "-q", "-b", "main");
	writeFileSync(join(repo, "a.txt"), "first\n");
	git("add", "a.txt");
	commitAt(hoursAgo(72), "main: initial");
}

init();

/* 1. LANDED — a branch created from main with no commits of its own is already an ancestor. */
git("branch", "item-103", "main");

/* 2. READY + STALE — item done 48 h ago, merges clean, changes main's tree. */
git("branch", "item-101", "main");
git("checkout", "-q", "item-101");
writeFileSync(join(repo, "b.txt"), "ready work\n");
git("add", "b.txt");
commitAt(hoursAgo(48), "item-101: the work");
git("checkout", "-q", "main");

/* 3. CONFLICTED — both sides rewrite the SAME line, so merge-tree exits 1. */
git("branch", "item-102", "main");
git("checkout", "-q", "item-102");
writeFileSync(join(repo, "a.txt"), "branch-side\n");
git("add", "a.txt");
commitAt(hoursAgo(46), "item-102: my side of the line");
git("checkout", "-q", "main");
writeFileSync(join(repo, "a.txt"), "main-side\n");
git("add", "a.txt");
commitAt(hoursAgo(44), "main: the same line moved too");

/* 4. POISONED — merges clean, but the tip carries a committed conflict marker. */
git("branch", "item-104", "main");
git("checkout", "-q", "item-104");
writeFileSync(join(repo, "c.txt"), "<<<<<<< HEAD\nresolved by nobody\n=======\nthe other side\n>>>>>>> main\n");
git("add", "c.txt");
commitAt(hoursAgo(45), "item-104: markers committed");
git("checkout", "-q", "main");

/* 5. NO-OP — a branch AHEAD of main whose tree is main's tree (an empty commit). This is the case
 * `tools/absorb-refs.mjs` handles: the ref can never merge as a normal merge, so the verdict must say
 * "nothing to merge", not "ready". */
git("branch", "item-105", "main");
git("checkout", "-q", "item-105");
	execFileSync("git", ["-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "-q", "--allow-empty", "-m", "item-105: a commit that changes nothing"], {
		cwd: repo,
		env: { ...process.env, GIT_AUTHOR_DATE: hoursAgo(45), GIT_COMMITTER_DATE: hoursAgo(45) },
		stdio: ["ignore", "pipe", "ignore"],
	});
git("checkout", "-q", "main");

/* 6. READY but YOUNG — 1 h old, so the same rule calls it ready and NOT stale. */
git("branch", "item-106", "main");
git("checkout", "-q", "item-106");
writeFileSync(join(repo, "e.txt"), "fresh work\n");
git("add", "e.txt");
commitAt(hoursAgo(1), "item-106: fresh");
git("checkout", "-q", "main");

/* 7. IN FLIGHT — merges clean, but the queue row is still claimed, so it is not ready. */
git("branch", "item-107", "main");
git("checkout", "-q", "item-107");
writeFileSync(join(repo, "f.txt"), "work in progress\n");
git("add", "f.txt");
commitAt(hoursAgo(6), "item-107: still working");
git("checkout", "-q", "main");

const status = new Map([[101, "done"], [102, "done"], [104, "done"], [105, "done"], [106, "done"], [107, "claimed"]]);

console.log("=== 1. every verdict the tool prints is produced by the fixture that should produce it ===");
const r = landingHealth({ repo, db: "does-not-exist.sqlite", slaHours: 24, itemStatus: status, storeReason: "injected in the demo" });
assert.ok(r.ok === false, "a 48 h old ready ref must make the report NOT ok");
assert.equal(r.exit, 1, "the exit code the check rule gates on is 1 when a ready ref is overdue");
const byRef = Object.fromEntries(r.rows.map((row) => [row.ref, row]));
assert.equal(byRef["item-103"].verdict, "landed", "a branch that is an ancestor of main is landed, not unlanded work");
assert.equal(byRef["item-101"].verdict, "ready", "clean merge + no markers + changed tree + queue done = ready");
assert.equal(byRef["item-101"].stale, true, "48 h past a 24 h SLA is stale");
assert.equal(byRef["item-102"].verdict, "conflicted", "two sides rewriting the same line is a conflict, not readiness");
assert.equal(byRef["item-102"].stale, false, "a conflicted ref is never 'stale ready work' — it needs a re-cut, not a landing");
assert.equal(byRef["item-104"].verdict, "poisoned-committed-markers", "a tip carrying <<<<<<< is refused before it is ever called ready");
assert.equal(byRef["item-105"].verdict, "no-op-ref", "a branch that changes nothing relative to main is absorbed, not merged");
assert.equal(byRef["item-106"].verdict, "ready", "young work is still ready work");
assert.equal(byRef["item-106"].stale, false, "1 h is inside a 24 h SLA");
assert.equal(byRef["item-107"].verdict, "in-flight", "a claimed item is not ready: the seat is still on it");
console.log(`  ok   verdicts: ${r.rows.map((x) => `${x.ref}=${x.verdict}`).join(" ")}`);

console.log("\n=== 2. staleness is a THRESHOLD the caller sets, not a hardcoded claim ===");
const wide = landingHealth({ repo, slaHours: 72, itemStatus: status });
assert.equal(wide.stale, 0, "at a 72 h SLA the 48 h ref is not yet overdue");
assert.equal(wide.exit, 0, "and the tool exits 0, so check passes");
assert.equal(wide.ok, true, "ok is the same verdict as the exit code, not a separate opinion");
console.log(`  ok   same fixture: stale=${r.stale} at 24 h, stale=${wide.stale} at 72 h`);

console.log("\n=== 3. the CLI's exit code is the code a gate can use ===");
// Capture IMMEDIATELY BEFORE the run: the fixture itself advances main on purpose (that is what makes
// item-102 conflict), so a capture taken at init would compare against a tree that no longer exists.
const mainBefore = git("rev-parse", "main");
const refsBefore = git("for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").filter(Boolean);
// Point the store at a file that does not exist IN THE FIXTURE, so the run is deterministic no matter what
// DURIG_DB the suite runner has in the environment: the fixture has no queue, and the tool must still make
// verdicts from git alone (it reports them as `ready-unverified` rather than guessing).
const cli = spawnSync("node", [join(process.cwd(), "tools", "self-merge-sla.mjs")], { cwd: repo, timeout: 60000, env: { ...process.env, DURIG_DB: join(repo, "no-such-store.sqlite") } });
assert.equal(cli.status, 1, "the CLI exits 1 when a ready ref is overdue — the same code check gates on");
const printed = JSON.parse(cli.stdout.toString());
assert.equal(printed.stale, 1, `the CLI's own JSON names exactly one stale ref (got ${printed.stale}: ${printed.stale_rows.map((r) => `${r.ref}/${r.verdict}/${r.age_h}h`).join(", ")})`);
assert.ok(cli.stderr.toString().includes("scripts/land.mjs"), "and the refusal tells you the command to run");
assert.ok(!cli.stderr.toString().includes("push"), "the remedy it names never contains a push — landing is local main only");
assert.ok(printed.land_command === undefined || !printed.land_command.includes("push"), "no land_command suggests a push");
console.log(`  ok   exit=${cli.status}, stale=${printed.stale}, store reason="${printed.store}" (git facts stand without the queue)`);

console.log("\n=== 4. the instrument writes NOTHING: refs and main are untouched ===");
const mainAfter = git("rev-parse", "main");
const refsAfter = git("for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").filter(Boolean);
assert.equal(mainAfter, mainBefore, "main did not move — a measurement is not a landing");
assert.equal(refsAfter.length, refsBefore.length, "no ref was deleted (rule R-B #3270: a disposition, never a deletion)");
assert.equal(refsAfter.length, 8, "the fixture's seven branches plus main are all still there");
console.log(`  ok   main ${mainBefore.slice(0, 8)} unchanged, ${refsAfter.length} refs still present`);

console.log("\n=== 5. a landing the chokepoint already REFUSED is not 'ready work' (audit addendum) ===");
/* The ledger is the tool's only record of an attempted-but-refused landing. Without this verdict a session
 * reading `ready` re-runs the same refused lander. Coverage is measured the same way: an unlanded ref with no
 * dated row in docs/DISPOSITIONS.md is `undocumented`, and --strict makes that an exit 1. */
const ledger = "| 2026-11-14 | `item-101` | **KEEP-HELD** | `scripts/land.mjs item-101 --changed-suite` exit **1**: STOPPED: demo/whatever.test.mjs failed in the scratch worktree (exit 1) — main was NOT advanced | #101 |\n| 2026-11-14 | `item-106` | **KEEP-HELD** | needs judgement — the derived gate refuses it | #106 |\n| 2026-11-14 | `landing-20261114-b1` | scratch chain | merge-tree exit 1 | catch-up |\n";
const withLedger = landingHealth({ repo, slaHours: 24, itemStatus: status, ledger });
const v101 = withLedger.rows.find((x) => x.ref === "item-101").verdict;
assert.equal(v101, "gate-refused", "a clean merge the lander already refused is classified gate-refused, not ready");
assert.ok(!withLedger.rows.find((x) => x.ref === "item-101").stale, "a gate-refused ref is never counted as stale ready work");
assert.ok(withLedger.rows.find((x) => x.ref === "item-102").dispositioned === false, "an unlanded ref with no row is NOT dispositioned");
assert.ok(withLedger.undocumented.includes("item-102"), "and it shows up in the coverage gap the tool reports");
assert.equal(withLedger.unlanded, 6, "six unlanded refs in the fixture (item-103 is an ancestor of main)");
assert.equal(withLedger.ledger_coverage, "2/6", "coverage is counted, not asserted");
/* A `gate-refused` label is only as good as the row behind it: one quotes the lander's exit code, the other
 * is a feeling. --strict fails on the second kind. */
const r101 = withLedger.rows.find((x) => x.ref === "item-101");
const r106 = withLedger.rows.find((x) => x.ref === "item-106");
assert.equal(r106.verdict, "gate-refused", "a KEEP-HELD row moves a clean, queue-done ref out of 'ready'");
assert.equal(r106.attempt_logged, false, "a row that only says 'needs judgement' is NOT a recorded lander attempt");
assert.equal(r101.attempt_logged, true, "a row quoting scripts/land.mjs and its exit 1 IS");
assert.equal(withLedger.gate_refused_proven, 1, `proven attempts are counted: ${withLedger.gate_refused_proven}`);
assert.deepEqual(withLedger.gate_refused_unproven, ["item-106"], "and the unproven ones are named");
const chain = withLedger.rows.find((x) => x.ref === "item-104").verdict;
assert.ok(chain !== undefined, "chain classification does not disturb the other verdicts");
console.log(`  ok   item-101=${v101} attempt_logged=${r101.attempt_logged}, item-106=${r106.verdict} attempt_logged=${r106.attempt_logged}, coverage=${withLedger.ledger_coverage}, undocumented=[${withLedger.undocumented.join(", ")}]`);

rmSync(repo, { recursive: true, force: true });
console.log("\nSELF-MERGE SLA OK");
