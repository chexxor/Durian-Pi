// demo/cooldown-skip-line.test.mjs — every NO-WAKE decision names its seat and its reason (#6101)
//
// THE GAP, measured by qa on main 09a94b4c: a seat dropped by the per-seat cooldown produced
// NO line at all. `onSuppressed` only collected a set for the revisit schedule; only `onSkipped`
// wrote to `<db>.broker.log`. So in a run where a pass woke nothing, the log could not answer
// "why did this seat not wake?" — suppressed looked identical to never-considered. The parked
// path had already closed the same shape for deduped wakes (`SKIP parkseat reason=parked-deduped`),
// so this copies that shape instead of inventing a new one.
//
// THREE LEGS, because a test that only checks the new string is vacuous:
//   1. the line BUILDER: one shape for every no-wake path, and a line with no reason is refused;
//      the `remaining` field is the scheduler's own measurement, not a plausible number;
//   2. the LIVE PASS: a real `runWakeLoop` over a stub harness wakes, then suppresses, then
//      re-wakes - and the suppression shows up in the log file as a line naming the seat and
//      the reason, with the cooldown time still to run;
//   3. the NEGATIVE CONTROL: with the cooldown off, the seat wakes every pass and NO cooldown
//      line appears - so the line is caused by the suppression, not printed unconditionally.
//
// The scheduler's DECISIONS are untouched by this change; only its output is asserted.
//
// Run: node demo/cooldown-skip-line.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as broker from "../src/broker.mjs";
import { WakeScheduler } from "../src/scheduler.mjs";
import { RigControl, RigQueue, Seats } from "../src/rig.mjs";
const { runWakeLoop, wakeSkipLine } = broker;

const base = mkdtempSync(join(tmpdir(), "durig-cooldown-line-"));

/* 1. THE BUILDER: one shape, and the number is the scheduler's own. */
console.log("=== THE SKIP LINE: ONE SHAPE FOR EVERY NO-WAKE PATH ===");
assert.ok(typeof wakeSkipLine === "function", "there is ONE builder for no-wake lines (before the change each path formatted its own, and the cooldown path had none)");
assert.equal(
	wakeSkipLine({ seat: "impl", reason: "cooldown", remainingMs: 30_000 }),
	"SKIP impl reason=cooldown remaining=30s",
	"the cooldown line names seat, reason and the time still to run",
);
assert.equal(
	wakeSkipLine({ seat: "designer", reason: "pending", conversationId: 42, ageMs: 36_000_000 }),
	"SKIP designer reason=pending conv=42 age=36000s",
	"the parked/pending shape is unchanged: seat, reason, conversation, measured age",
);
assert.equal(wakeSkipLine({ seat: "idle", reason: "no-work" }), "SKIP idle reason=no-work", "a seat with nothing is still named");
assert.equal(
	wakeSkipLine({ seat: "parkseat", reason: "parked-deduped" }),
	"SKIP parkseat reason=parked-deduped",
	"the deduped case keeps the shape the parked path already used",
);
assert.throws(() => wakeSkipLine({ seat: "impl" }), /must name its seat and its reason/, "a no-wake line WITHOUT a reason is refused, not logged");
assert.throws(() => wakeSkipLine({ reason: "cooldown" }), /must name its seat and its reason/, "a no-wake line WITHOUT a seat is refused");

// REMAINING IS MEASURED, NOT INVENTED: the value printed is exactly what the scheduler says.
const measured = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs: 30_000, now: () => 1_000_000 });
measured.recordWakes(["impl"], 1_000_000);
assert.equal(measured.msUntilSeatReady("impl", 1_001_000), 29_000, "the scheduler's own cooldown arithmetic");
assert.equal(
	wakeSkipLine({ seat: "impl", reason: "cooldown", remainingMs: measured.msUntilSeatReady("impl", 1_001_000) }),
	"SKIP impl reason=cooldown remaining=29s",
	"the line carries the scheduler's number, not a rounded guess",
);
console.log("  ok   builder shapes, reason required, remaining = the scheduler's measurement");

/* 2. THE LIVE PASS: wake, suppress, re-wake - and the suppression is in the log. */
function stubHarness({ seats, items }) {
	const submitted = [];
	return {
		submitted,
		snapshot: async (model) => {
			if (model === Seats) return { seats };
			if (model === RigQueue) return { items };
			if (model === RigControl) return { paused: false };
			return {};
		},
		inspect: async () => ({ submissions: [], tasks: [] }),
		conversation: async (conversationId) => ({
			conversationId,
			submit: async () => {
				submitted.push(conversationId);
			},
		}),
		waitForIdle: async () => {},
	};
}

const probeStorage = {
	findDocument: async () => null,
	scanDocuments: async () => ({ items: [] }),
	document: async () => null,
	scanSubmissions: async () => ({ items: [] }),
};

async function run({ seatCooldownMs, passes, label }) {
	const dbPath = join(base, `${label}.db`);
	const seats = { impl: { conversationId: 1 }, idle: { conversationId: 2 } };
	const items = [{ id: 1, to: "impl", status: "queued" }];
	const harness = stubHarness({ seats, items });
	// A VIRTUAL CLOCK, not a real sleep. With wall-clock waits the re-wake pass lands exactly on
	// the cooldown boundary (wake at t, pass at t+2000 ms), and `now - last >= cooldown` is decided
	// by sub-millisecond jitter: measured on main, this demo reddened 4 runs in 12 while a
	// neighbouring change that only added a 1 s timer shifted the phase. Anything whose verdict
	// depends on the phase of the scheduler's own timers is a broken test, so the scheduler and the
	// loop are both driven by `clock` and `wait(ms)` advances it instead of sleeping (deterministic
	// AND under a second — D213).
	let virtual = 0;
	const clock = () => virtual;
	const scheduler = new WakeScheduler({ minIntervalMs: 0, seatCooldownMs, now: clock });
	const diagnostics = [];
	await runWakeLoop({
		harness,
		probeStorage,
		scheduler,
		context: {},
		dbPath,
		now: clock,
		maxPasses: passes,
		maxDurationMs: 15_000,
		// The loop rests on a condition variable; normally a store commit sets the scheduler's
		// dirty bit. A stub store has no commits, so each wait stands for one arriving event.
		signal: {
			raise: () => {},
			wait: async (ms) => {
				virtual += Math.max(0, ms);
				scheduler.markDirty();
			},
		},
		onDiagnostic: (d) => diagnostics.push(d),
	});
	return {
		log: readFileSync(`${dbPath}.broker.log`, "utf8"),
		submitted: harness.submitted,
		diagnostics,
	};
}

console.log("\n=== A COOLDOWN-DROPPED WAKE LEAVES A REASON LINE IN THE LOG ===");
const cooled = await run({ seatCooldownMs: 2_000, passes: 3, label: "cooldown" });
// `<db>.broker.log` stamps every line with an ISO timestamp; strip it so the assertions read the
// line the broker wrote rather than its stamp.
const stripStamp = (l) => l.replace(/^\S+Z /, "");
const lines = cooled.log.split("\n").filter(Boolean).map(stripStamp);
const wakes = lines.filter((l) => l.startsWith("WAKE "));
const skips = lines.filter((l) => l.startsWith("SKIP "));
const cooldownSkips = skips.filter((l) => l.includes("reason=cooldown"));

console.log("\n--- the log this run produced ---");
for (const line of lines) console.log(`  ${line}`);

assert.ok(wakes.length >= 2, `the seat is woken, then re-woken once the cooldown elapsed (got ${wakes.length} WAKE lines)`);
assert.equal(cooldownSkips.length, 1, "exactly one cooldown suppression is reported (the one pass that dropped the seat)");
assert.match(cooldownSkips[0], /^SKIP impl reason=cooldown remaining=\d+s$/, "the cooldown line names the seat, the reason and the time left");
// The remaining time must be the cooldown, not a number pulled out of thin air: it has to sit
// inside the window the scheduler was configured with, and be strictly decreasing from it.
const remaining = Number(cooldownSkips[0].match(/remaining=(\d+)s/)[1]);
assert.ok(remaining > 0 && remaining <= 2, `remaining=${remaining}s must lie inside the 2s cooldown the scheduler was given`);
assert.ok(skips.some((l) => l.startsWith("SKIP idle reason=no-work")), "the seat with nothing to do is still reported as no-work, not silent");

// THE CONTRACT, stated as a property of the log: a pass that woke nothing must say why for every
// candidate it considered. Group the log by pass and check every woke=- pass names each seat.
const passSegments = [];
let current = [];
for (const line of lines) {
	if (line.startsWith("PASS ")) {
		passSegments.push({ pass: line, body: current });
		current = [];
	} else {
		current.push(line);
	}
}
const silentPasses = passSegments.filter((seg) => seg.pass.includes("woke=-"));
assert.ok(silentPasses.length >= 1, "at least one pass woke nothing - otherwise this test proves nothing");
for (const seg of silentPasses) {
	const named = seg.body.filter((l) => l.startsWith("SKIP "));
	assert.ok(
		named.length > 0,
		`a pass that woke nothing (${seg.pass}) left no reason in the log: the seats are unaccounted for`,
	);
	assert.ok(
		named.some((l) => l.includes("impl reason=")),
		`the silent pass ${seg.pass} does not say why 'impl' did not wake`,
	);
}
// The dropped candidate is not lost: the loop re-runs a pass when the cooldown elapses.
assert.ok(wakes.length >= 2, `the suppressed wake is re-run later (${wakes.length} WAKE lines)`);
assert.equal(cooled.submitted.length, wakes.length, "the number of submitted wakes equals the number of WAKE lines - the decisions are unchanged by the logging");
console.log(`  ok   ${wakes.length} wakes, ${cooldownSkips.length} cooldown suppression, all named: ${cooldownSkips[0]}`);

/* 3. NEGATIVE CONTROL: no cooldown, no cooldown line. */
console.log("\n=== NEGATIVE CONTROL: WITH THE COOLDOWN OFF, NOTHING IS SUPPRESSED AND NOTHING IS CLAIMED ===");
const noCooldown = await run({ seatCooldownMs: 0, passes: 2, label: "no-cooldown" });
const noCooldownLines = noCooldown.log.split("\n").filter(Boolean).map(stripStamp);
assert.ok(
	!noCooldownLines.some((l) => l.includes("reason=cooldown")),
	"a run with no cooldown emits no cooldown line - the line is caused by the suppression, not printed unconditionally",
);
assert.equal(noCooldown.submitted.length, 2, "with no cooldown the seat is woken on both passes (the decisions are untouched)");
console.log(`  ok   ${noCooldown.submitted.length} wakes, zero cooldown lines`);

rmSync(base, { recursive: true, force: true });
console.log("\nCOOLDOWN-SKIP-LINE PASS — a cooldown-suppressed wake is a line in the log, not a silence");
