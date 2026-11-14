// demo/noop-wake-census.test.mjs — #6959: severity for the no-op-wake class must come from a count,
// not from a remembered number.
//
// WHY THIS FILE EXISTS. `tools/noop-wake-census.mjs` reads `<db>.broker.log` and answers "how many
// wake decisions woke nothing, and why". Two things can make that number lie: a reason string that
// classifies into the wrong class, and a wake counted twice (once from the PASS line's `woke=` list,
// once from the `WAKE <seat>` line the broker writes when a turn actually starts). If those two
// disagree, any severity claim built on them is unsound - so the fixture asserts they agree.
//
// NON-VACUITY. The fixture deliberately contains every class the census can see - cooldown, pending,
// busy, deduped, gated (open and cancelled gate), no-work - plus a malformed SKIP line with no reason
// and a PARKED-WAKE line, neither of which is a wake decision. If a class collapses into another, or
// if a malformed line is counted, an assertion below fails.
//
// Run: node demo/noop-wake-census.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { census, classify, parseSessions } from "../tools/noop-wake-census.mjs";

const FIXTURE = `
2026-11-12T10:00:00.000Z START pid=100
2026-11-12T10:00:01.000Z PASS 1 ms=12 woke=qa,impl
2026-11-12T10:00:02.000Z WAKE qa
2026-11-12T10:00:02.100Z WAKE impl
2026-11-12T10:00:03.000Z SKIP pm reason=cooldown remaining=30s
2026-11-12T10:00:04.000Z SKIP advocate reason=queued-gated:gate-open:#6508(queued)
2026-11-12T10:00:05.000Z SKIP designer reason=no-work
2026-11-12T10:00:06.000Z SKIP auditor reason=parked-deduped
2026-11-12T10:00:07.000Z SKIP devtools reason=pending conv=c1 age=4s
2026-11-12T10:00:08.000Z SKIP scribe reason=busy
2026-11-12T10:00:09.000Z PARKED-WAKE seat=qa reason=set-changed
2026-11-12T10:00:10.000Z PARKED-WAKE seat=qa reason=deduped
2026-11-12T10:00:11.000Z SKIP qa
2026-11-12T10:00:12.000Z EXIT pid=100 reason=max-duration passes=1
2026-11-12T11:00:00.000Z START pid=200
2026-11-12T11:00:01.000Z PASS 1 ms=9 woke=-
2026-11-12T11:00:02.000Z SKIP qa reason=queued-gated:gate-cancelled:#6655
2026-11-12T11:00:03.000Z SKIP qa2 reason=busy
2026-11-12T11:00:04.000Z EXIT pid=200 reason=stop-requested passes=1
2026-11-12T12:00:00.000Z START pid=300
2026-11-12T12:00:01.000Z PASS 1 ms=8 woke=-
2026-11-12T12:00:02.000Z SKIP qa reason=queued-gated:gate-open:#6508(queued)
`;

const dir = mkdtempSync(join(process.cwd(), ".noop-wake-test-"));
const logPath = join(dir, "rig.broker.log");
const jsonPath = join(dir, "census.json");
writeFileSync(logPath, FIXTURE.trim() + "\n", "utf8");

// 1. classify: each reason lands in its class, and an unknown reason is not silently folded in.
assert.equal(classify("queued-gated:gate-open:#6508(queued)"), "gated");
assert.equal(classify("queued-gated:gate-cancelled:#6655"), "gated");
assert.equal(classify("parked-deduped"), "deduped");
assert.equal(classify("no-work"), "no-work");
assert.equal(classify("cooldown"), "cooldown");
assert.equal(classify("something-new"), "other");

// 2. parseSessions: session boundaries come from START/EXIT, not from a guess.
const sessions = parseSessions(FIXTURE.trim().split("\n"));
assert.equal(sessions.length, 3, "three START lines must produce three sessions");
assert.equal(sessions[0].pid, 100);
assert.equal(sessions[0].end, "2026-11-12T10:00:12.000Z", "an EXIT line closes the session");
assert.equal(sessions[1].end, "2026-11-12T11:00:04.000Z", "an EXIT line closes the second session too");
assert.equal(sessions[2].end, null, "a session with no EXIT line is still open");

// 3. The wake sources must agree: the PASS `woke=` list and the WAKE lines count the same wakes.
assert.equal(sessions[0].wakeEvents, 2, "PASS woke=qa,impl is two wakes");
assert.equal(sessions[0].wakeLines, 2, "two WAKE lines for the same session");
assert.equal(sessions[1].wakeEvents, 0, "woke=- is no wake");
assert.equal(sessions[1].wakeLines, 0, "no WAKE line means no wake");

// 4. Skips: five in session 1 (the malformed `SKIP qa` with no reason is NOT a decision), and the
//    classes are exactly one each. PARKED-WAKE lines are decisions about a parked set, not wakes.
assert.equal(sessions[0].skips, 6, "six reasoned SKIP lines; the reason-less one is not counted");
assert.deepEqual(sessions[0].classes, { cooldown: 1, gated: 1, "no-work": 1, deduped: 1, pending: 1, busy: 1 });
assert.equal(sessions[0].skips, Object.values(sessions[0].classes).reduce((a, b) => a + b, 0), "every skip lands in exactly one class");
assert.equal(sessions[0].parked["set-changed"], 1);
assert.equal(sessions[1].skips, 2);
assert.deepEqual(sessions[1].classes, { gated: 1, busy: 1 });

// 5. The CLI is the instrument an operator runs: exit 0 on a readable log, exit 1 on a missing one.
const run = spawnSync(process.execPath, ["tools/noop-wake-census.mjs", "--log", logPath, "--sessions", "2", "--json", jsonPath], { encoding: "utf8" });
assert.equal(run.status, 0, `the census must exit 0: ${run.stderr}`);
assert.ok(run.stdout.includes("NO-OP WAKE CENSUS"), "it must name itself and its window");
const out = JSON.parse(readFileSync(jsonPath, "utf8"));
assert.equal(out.sessions.length, 2, "--sessions 2 must bound the window to the last two sessions");
assert.equal(out.windowTotals.wakeLines, 0, "--sessions 2 keeps the last two sessions, and neither woke anyone");
assert.equal(out.windowTotals.skips, 3, "two in session two plus one in the open session");
assert.equal(out.windowTotals.classes.gated, 2, "the window holds two gated decisions and nothing else");
assert.equal(out.totals.wakeLines, 2, "the whole fixture woke two seats, all of them in session one");
assert.equal(out.totals.skips, 9, "six reasoned skips, plus two, plus one");
assert.equal(out.totals.classes.gated, 3, "open gates and a cancelled gate are all the gated class");
assert.equal(sessions.length, 3, "the whole log holds three sessions");
rmSync(dir, { recursive: true, force: true });

const missing = spawnSync(process.execPath, ["tools/noop-wake-census.mjs", "--log", join(dir, "does-not-exist.log")], { encoding: "utf8" });
assert.equal(missing.status, 1, "a missing log must fail loudly, not report a zero census");
assert.ok(missing.stderr.includes("cannot read log"), "it must name the path it could not read");

console.log("NO-OP WAKE CENSUS PASS - classes classified, wake sources reconciled, malformed SKIP not counted, missing log refused");
