// demo/genlock-hardening.test.mjs — genlock lease + broker-identity hardening (ROADMAP 65).
//
// Three verified hazards, each asserted here:
//   (a) A live generation longer than 60s was age-stolen, exceeding the concurrency cap.
//       `slotIsStale` now steals only a dead holder, or one that has aged past a
//       threshold LONGER than the provider stream timeout; a live holder renews its
//       lease, so a legitimate long generation is not stolen.
//   (b) `holderAlive` swallowed EPERM and read a live-but-unsignalable holder as dead.
//       It now treats every error except ESRCH as alive (only ESRCH means gone).
//   (c) `brokerAlive` trusted `process.kill(pid, 0)`, so a reused Windows pid read as
//       the recorded broker. A state with a stale heartbeat is now rejected.
//
// Failing-first: HEAD exported neither `slotIsStale` nor `holderAlive`, and
// `brokerAlive` had no heartbeat check, so the (a)/(c) assertions cannot pass.
// Run: node demo/genlock-hardening.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { holderAlive, slotIsStale } from "../src/genlock.mjs";
import { brokerAlive } from "../src/broker.mjs";

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

// (a) A live holder with an age that the OLD 60 s threshold would have stolen.
{
	assert.equal(
		slotIsStale({ pid: process.pid, since: iso(5 * 60_000) }, now),
		false,
		"a live generation running 5 minutes is NOT stale (the old 60s rule stole it)",
	);
	assert.equal(
		slotIsStale({ pid: process.pid, since: iso(20 * 60_000) }, now),
		true,
		"a live holder past the long threshold is stale (a hung holder still recovers)",
	);
	assert.equal(slotIsStale({ pid: 999999, since: iso(0) }, now), true, "a dead holder is stale");
}

// (b) EPERM reads as alive; ESRCH reads as dead.
{
	const original = process.kill;
	try {
		process.kill = (pid, ...rest) => {
			if (pid === 424242) {
				const err = new Error("operation not permitted");
				err.code = "EPERM";
				throw err;
			}
			if (pid === 424243) {
				const err = new Error("no such process");
				err.code = "ESRCH";
				throw err;
			}
			return original.call(process, pid, ...rest);
		};
		assert.equal(holderAlive({ pid: 424242 }), true, "an EPERM holder is alive");
		assert.equal(holderAlive({ pid: 424243 }), false, "an ESRCH holder is gone");
	} finally {
		process.kill = original;
	}
	assert.equal(holderAlive({ pid: process.pid }), true, "our own pid is alive");
}

// (c) A recycled pid with a stale heartbeat is NOT the recorded broker.
{
	assert.equal(
		brokerAlive({ pid: process.pid, heartbeatAt: now - 10 * 60_000 }, { now }),
		false,
		"a stale heartbeat rejects the pid (it was reused by another process)",
	);
	assert.equal(
		brokerAlive({ pid: process.pid, heartbeatAt: now }, { now }),
		true,
		"a fresh heartbeat with a live pid is the broker",
	);
	assert.equal(
		brokerAlive({ pid: process.pid }, { now }),
		true,
		"a state with no heartbeat falls back to the pid probe",
	);
	assert.equal(
		brokerAlive({ pid: 999999, heartbeatAt: now }, { now }),
		false,
		"a dead pid is not the broker",
	);
}

console.log(
	"GENLOCK HARDENING PASS (a long live generation is not age-stolen; EPERM holders read alive; a recycled pid with a stale heartbeat is not the broker)",
);
process.exit(0);
