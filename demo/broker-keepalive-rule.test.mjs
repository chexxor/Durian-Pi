// demo/broker-keepalive-rule.test.mjs — the re-arm rule, pinned offline (#7113 family: delegate instruments)
//
// WHY THIS EXISTS. `tools/broker-keepalive.mjs` re-arms a broker that stops driving an unattended
// fleet. Its first version re-armed on "no PASS line for 400 s" alone and stopped a HEALTHY busy
// broker: measured 2026-11-12T08:26Z on this box, the log recorded
// `STOP-REQUESTED source=file pid=3455955` while that broker held four genlock leases (seats
// mid-generation). A pass only runs when the store changes, so an idle-but-healthy broker reads
// exactly like a stranded one. The rule that survived that measurement is:
//   re-arm when the process is dead / the heartbeat is older than 120 s, OR
//   the heartbeat is FRESH, there is NO pass for `stale` seconds, AND intents are actually waiting
//   in the spool — the stranded signature in docs/runbooks/broker-down-or-stalled.md.
// The rule is a decision, so it is tested as a decision, not as a string.
//
// THREE LEGS: (1) the truth table, including the false positive that broke the first version;
// (2) the spool count, on a fixture (only `.json` letters count, a missing dir is 0);
// (3) the tool run end-to-end with `--once --no-restart` against a path with NO store: exit 0, the
// snapshot printed, the ledger line written, and NOTHING broker-shaped created.
//
// Run: node demo/broker-keepalive-rule.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const TOOL = join(dirnameOf(fileURLToPath(import.meta.url)), "..", "tools", "broker-keepalive.mjs");
function dirnameOf(p) {
	return p.split("/").slice(0, -1).join("/");
}

const { rearmVerdict, countIntentFiles, snapshot, brokerBoundSeconds, parseBound, isPreflightRefusal } = await import(TOOL);
const { intentInboxDir, writeBrokerState } = await import("../src/broker.mjs");

console.log("=== 1. THE TRUTH TABLE (every case is a state this rig has actually been in) ===");

// A dead process is a dead process, whatever the state file says.
assert.equal(rearmVerdict({ brokerAlive: false, heartbeatAgeS: 5, lastPassAgeS: 10, pendingIntents: 0 }, 300).shouldRearm, true, "a pid that is not running needs a new broker");

// A live process whose heartbeat stopped moving (> 120 s) is not driving passes either.
assert.equal(rearmVerdict({ brokerAlive: true, heartbeatAgeS: 400, lastPassAgeS: 400, pendingIntents: 0 }, 300).shouldRearm, true, "a stale heartbeat means the loop is not running");

// THE FALSE POSITIVE THAT BROKE THE FIRST VERSION: a healthy idle broker has no PASS line for
// 1412 s because nothing changed in the store. Re-arming here issued STOP-REQUESTED against a
// broker holding four genlock leases. It must NOT fire.
const healthyIdle = rearmVerdict({ brokerAlive: true, heartbeatAgeS: 15, lastPassAgeS: 1412, pendingIntents: 0 }, 300);
assert.equal(healthyIdle.stranded, false, "no pass + no waiting intents is IDLE, not stranded");
assert.equal(healthyIdle.shouldRearm, false, "an idle broker is never stopped by the keepalive");

// THE STRANDED SIGNATURE: fresh heartbeat, no pass, intents in the spool. This is the parked broker
// that strands a mutating intent (docs/incidents/2026-11-11-parked-broker-strands-a-mutating-intent.md).
const stranded = rearmVerdict({ brokerAlive: true, heartbeatAgeS: 12, lastPassAgeS: 400, pendingIntents: 1 }, 300);
assert.equal(stranded.stranded, true, "fresh heartbeat + no pass + intents waiting IS the stranded signature");
assert.equal(stranded.shouldRearm, true, "that is exactly what the keepalive exists for");

// Just under the bound, nothing fires — the threshold is the tool's, and it is honoured.
assert.equal(rearmVerdict({ brokerAlive: true, heartbeatAgeS: 12, lastPassAgeS: 300, pendingIntents: 5 }, 300).shouldRearm, false, "at the bound the broker still gets the benefit of the doubt");

// THE OVER-BOUND SHAPE, measured 2026-11-12T16:2xZ on this box (Linux, Fedora Linux 45, kernel
// 7.2.15-300.fc45.x86_64, node v24.22.1): pid 1273802 launched with `cli.mjs serve --max-duration 3600`
// was alive 1 h 34 m, heartbeat 11 s fresh, last PASS 2,082 s ago, spool EMPTY, no genlock, no seat
// process, and the fleet sat idle with 604 queued rows. The empty spool is why the `stranded` leg
// misses it; the run's own bound is what names it.
const parked = rearmVerdict({ brokerAlive: true, heartbeatAgeS: 11, lastPassAgeS: 2082, pendingIntents: 0, runAgeS: 5700, brokerBoundS: 3600 }, 300);
assert.equal(parked.stranded, false, "an empty spool means the stranded leg alone does NOT catch a parked broker");
assert.equal(parked.overBound, true, "a run 2,100 s past the --max-duration it asked for, with no pass, is parked on the drain");
assert.equal(parked.shouldRearm, true, "the keepalive exists precisely to re-arm that fleet");

// A broker still INSIDE its own bound with an empty spool is the healthy-idle case, not a parked one.
assert.equal(rearmVerdict({ brokerAlive: true, heartbeatAgeS: 15, lastPassAgeS: 1412, pendingIntents: 0, runAgeS: 3000, brokerBoundS: 3600 }, 300).overBound, false, "inside the bound, no pass is idle, not parked");
// Past the bound but STILL passing: the drain leg is not wedged, so leave it alone.
assert.equal(rearmVerdict({ brokerAlive: true, heartbeatAgeS: 5, lastPassAgeS: 30, pendingIntents: 0, runAgeS: 4300, brokerBoundS: 3600 }, 300).overBound, false, "a run past its bound that is still passing is driving, not parked");
// A broker started without --max-duration has no bound, so this leg can never fire on it.
assert.equal(rearmVerdict({ brokerAlive: true, heartbeatAgeS: 12, lastPassAgeS: 2000, pendingIntents: 0, runAgeS: 9000, brokerBoundS: null }, 300).overBound, false, "no bound on the cmdline means the bound leg cannot fire");
console.log("  ok   11 states decided; the idle-broker false positive is refused, the parked run is named");

// A missing heartbeat with a live pid is a fresh broker, not a dead one.
assert.equal(rearmVerdict({ brokerAlive: true, heartbeatAgeS: null, lastPassAgeS: null, pendingIntents: 0 }, 300).shouldRearm, false, "a broker that has not written its state file yet is not re-armed");
console.log("  ok   a state file with no ages yet is a fresh broker, not a dead one");

console.log("\n=== 1b. A PREFLIGHT REFUSAL IS DEFERRED, NOT COUNTED AS A FAILED RE-ARM ===");
{
  // Measured 2026-11-12T18:03Z on this box: `START REFUSED: live-tree-dirty` twice, 60 s apart, because a
  // seat was mid-write in the live tree. Two "failures" made the loop exit and the fleet went down; the
  // tree was clean again seconds later. A refusal describes THIS SECOND, so it must not spend the budget
  // that exists for a re-arm which was ATTEMPTED and failed.
  assert.equal(isPreflightRefusal("START REFUSED: live-tree-dirty\n  BLOCK  live-tree-dirty: 1 tracked file(s)"), true, "a dirty-tree refusal is a refusal");
  assert.equal(isPreflightRefusal("START REFUSED: broker-degraded"), true, "the parked-broker refusal is a refusal too");
  assert.equal(isPreflightRefusal("spawn failed: ENOENT"), false, "a start that never reached the preflight IS a failure");
  assert.equal(isPreflightRefusal(""), false, "an empty reply is not a refusal to defer on");
  console.log("  ok   refusals are deferrable; a failed spawn still spends the two-strike budget");
}

console.log("\n=== 2. THE SPOOL COUNT IS A COUNT OF INTENTS, NOT OF FILES ===");
const base = mkdtempSync(join(tmpdir(), "durig-keepalive-rule-"));
const db = join(base, "no-store.sqlite");
// The tool counts the PRODUCT's own spool, so the fixture uses the product's own directory name.
assert.equal(intentInboxDir(db), `${db}.broker.inbox`, "the keepalive reads the broker's real inbox, not a directory it invented");
const inbox = intentInboxDir(db);
mkdirSync(inbox);
writeFileSync(join(inbox, "a.json"), "{}");
writeFileSync(join(inbox, "b.json"), "{}");
writeFileSync(join(inbox, "notes.txt"), "not an intent");
writeFileSync(join(inbox, "a.json.bak"), "{}");
assert.equal(countIntentFiles(inbox), 2, "only .json intent letters count");
assert.equal(countIntentFiles(join(base, "does-not-exist")), 0, "no spool directory is zero waiting intents, not an error");
// Drained letters do not count as pending: the broker moves them out of the inbox.
assert.equal(countIntentFiles(`${db}.broker.inbox.out`), 0, "dead-letters in .out are not waiting intents");
console.log("  ok   2 intents counted, 2 non-intent files ignored, missing dir = 0");

console.log("\n=== 3. END TO END: --once --no-restart measures and touches nothing ===");
const ledger = join(base, "ledger.jsonl");
const r = spawnSync("node", [TOOL, "--once", "--no-restart", "--db", db, "--ledger", ledger], {
	capture: true,
	timeout: 120000,
	encoding: "utf8",
});
assert.equal(r.status, 0, `--once exits 0 even against a path with no store (got ${r.status}; stderr: ${r.stderr.slice(0, 200)})`);
const out = r.stdout;
assert.match(out, /keepalive \d{4}-\d{2}-\d{2}T/, "the header names the db, interval, stale bound and --until");
assert.match(out, /pid=- hb=nulls lastPass=nulls intents=2 refs=\d+ itemBranches=\d+ worktrees=\d+/, "the snapshot prints real git counts, null broker ages for a store with no broker, and the spool count");
const snap = JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").pop());
assert.equal(snap.brokerPid, null, "no broker on this store");
assert.equal(snap.brokerAlive, false, "and the tool reports it as not alive rather than inventing one");
assert.ok(snap.refs > 0 && snap.worktrees > 0, "the git counts come from the repo, not from the store");
for (const artefact of [`${db}.broker.json`, `${db}.broker.log`, `${db}.broker.stop`]) {
	assert.ok(!readFileSyncOrThrows(artefact), `a measuring run must not create ${artefact}`);
}
console.log("  ok   exit 0, ledger line written, no broker artefact created");

console.log("\n=== 4. A STRANDED BROKER IS NAMED AS STRANDED, AND --no-reSTART NEVER STOPS IT ===");
const sdb = join(base, "stranded.sqlite");
const sbroker = intentInboxDir(sdb);
mkdirSync(sbroker);
for (const f of ["i1.json", "i2.json", "i3.json"]) writeFileSync(join(sbroker, f), "{}");
writeBrokerState(sdb, { pid: process.pid, since: Date.now() - 900_000, heartbeatAt: Date.now(), lastPassAt: Date.now() - 900_000 });
const before = readFileSync(`${sdb}.broker.json`, "utf8");
const s = snapshot(sdb, null, false);
assert.equal(s.brokerPid, process.pid, "the state file's pid is the identity, not pgrep");
assert.equal(s.brokerAlive, true, "the process is still running");
assert.ok(s.lastPassAgeS > 800, `no PASS for ${s.lastPassAgeS}s`);
assert.equal(s.pendingIntents, 3, "three intents are waiting in the spool");
assert.ok(s.runAgeS > 800, `the state file's since stamp gives the run age (${s.runAgeS}s)`);
assert.equal(s.brokerBoundS, null, "this pid has no --max-duration on its cmdline, so it has no bound");
assert.equal(rearmVerdict(s, 300).stranded, true, "fresh heartbeat + no pass + intents waiting = the stranded signature");
assert.equal(rearmVerdict(s, 300).overBound, false, "the over-bound leg does not fire on an unbounded run");
// The bound is read off the broker's own command line, not assumed by the loop. A pure parser, so
// this leg needs no live `serve` process (the first version spawned one and read an empty cmdline:
// `node -e ... --max-duration 120` never puts the flag where `ps` reports it).
assert.equal(parseBound("node /repo/cli.mjs serve --max-duration 120"), 120, "the bound is read off the broker's own cmdline");
assert.equal(parseBound("node cli.mjs serve --max-duration=600 --no-probe"), 600, "the = form parses too");
assert.equal(parseBound("node cli.mjs serve"), null, "no flag means no bound, so the leg cannot fire");
assert.equal(brokerBoundSeconds(null), null, "no pid, no bound");
const r2 = spawnSync("node", [TOOL, "--once", "--no-restart", "--db", sdb, "--ledger", join(base, "ledger2.jsonl")], { capture: true, timeout: 120000, encoding: "utf8" });
assert.equal(r2.status, 0, "the measuring run exits 0");
assert.ok(!r2.stdout.includes("re-arming"), "--no-restart measures a stranded broker without stopping it");
assert.ok(!readFileSyncOrThrows(`${sdb}.broker.stop`), "a measuring run never writes a stop request — that is what killed the working broker on 2026-11-12T08:26Z");
assert.equal(readFileSync(`${sdb}.broker.json`, "utf8"), before, "the measuring run leaves the broker state byte-identical");
rmSync(base, { recursive: true, force: true });
console.log("  ok   the stranded signature is detected, and measuring leaves the broker untouched");

function readFileSyncOrThrows(p) {
	try {
		readFileSync(p);
		return true;
	} catch {
		return false;
	}
}

console.log("\nBROKER-KEEPALIVE-RULE PASS — idle is not stranded, dead is dead, measuring writes nothing");
