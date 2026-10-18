// demo/genlock-priority.test.mjs — the WAIT-WITH-PRIORITY landing lock (#1497/#1498, lead #2054
// precondition (c)).
//
// THE DEFECT THIS PROVES FIXED: the lander could only WAIT for the generation slots, and waiting
// never terminated — the holder re-claims a slot for its next generation within seconds, so the
// lander always lost the race for the slot that had just come free. Reproduced as seven refusals
// in three minutes against a coordinator that generates continuously (#1509). The fix is a QUEUE:
// a lander PUBLISHES a priority reservation, and new generations YIELD while a live reservation
// exists, so the current holder finishes and the lander takes the slots ahead of any new
// generation.
//
// RED BEFORE: src/genlockreserve.mjs does not exist, so the imports fail (this is the same
// failing-first shape demo/degeneration-text.test.mjs documents for a missing registry).
// GREEN AFTER: the reservation blocks a new generation, the wait terminates once it is released,
// a DEAD reservation is ignored (fail-open — a crashed lander must never wedge the rig), and the
// lander's own claim path steals a stale slot instead of waiting on it forever.
//
// Run: node demo/genlock-priority.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const {
	acquireAllSlotsSync,
	readReservation,
	recordIsStale,
	releaseReservation,
	releaseSlotsSync,
	reserveSlots,
	reservationBlocks,
	reservationPath,
	renewReservation,
	slotIsStale,
} = await import("../src/genlockreserve.mjs");
const { withGenerationSlot } = await import("../src/genlock.mjs");

let failures = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpRoot = mkdtempSync(join(tmpdir(), "durig-genlock-priority-"));
const dbPath = join(tmpRoot, "rig.sqlite");
const me = () => ({ pid: process.pid, seat: "impl-land", since: new Date().toISOString() });

/** A REAL live process with a DIFFERENT pid, so "held by someone else" is genuinely exercised. */
function spawnHolder() {
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
	return child;
}

console.log("\n=== landing lock: wait-with-priority (#1498) ===\n");

await check("a live reservation held by another process BLOCKS a new generation (the priority)", async () => {
	const child = spawnHolder();
	try {
		const res = reserveSlots(dbPath, { pid: child.pid, seat: "impl-land", since: new Date().toISOString() });
		assert.equal(res.claimed, true, "the holder process publishes the reservation");
		assert.equal(
			reservationBlocks(dbPath, { pid: process.pid }, Date.now()),
			true,
			"a live reservation held by another process blocks",
		);
		// The broker's gate must YIELD rather than claim: with the reservation live, this must
		// NOT resolve. The acquire polls every 100 ms, so a 400 ms window is a wide margin.
		let acquired = false;
		const pending = withGenerationSlot({ dbPath, slots: 1 }, async () => {
			acquired = true;
		});
		await sleep(400);
		assert.equal(acquired, false, "the generation yielded instead of claiming a free slot");
		// ...and once the priority claim is released, the same wait TERMINATES (this is the half
		// the old behaviour could never reach: waiting used to lose every race).
		releaseReservation(dbPath, { pid: child.pid });
		await pending;
		assert.equal(acquired, true, "the generation proceeds once the priority claim is released");
	} finally {
		child.kill();
		releaseReservation(dbPath, { pid: child.pid });
	}
});

await check("a DEAD reservation does NOT block (fail-open: a crashed lander cannot wedge the rig)", async () => {
	const child = spawnHolder();
	const pid = child.pid;
	child.kill();
	await sleep(150); // let the OS reap it
	writeFileSync(reservationPath(dbPath), JSON.stringify({ pid, seat: "impl-land", since: new Date().toISOString() }));
	assert.equal(recordIsStale(readReservation(dbPath)), true, "a dead holder's reservation is stale");
	assert.equal(
		reservationBlocks(dbPath, { pid: process.pid }, Date.now()),
		false,
		"a stale reservation never blocks a generation",
	);
	let ran = false;
	await withGenerationSlot({ dbPath, slots: 1 }, async () => {
		ran = true;
	});
	assert.equal(ran, true, "the generation ran despite the stale reservation");
});

await check("an AGED reservation does not block either (the age fallback, not just the pid probe)", () => {
	const old = { pid: process.pid, seat: "impl-land", since: new Date(Date.now() - 700_000).toISOString() };
	writeFileSync(reservationPath(dbPath), JSON.stringify(old));
	assert.equal(recordIsStale(old), true, "older than the stale window");
	assert.equal(reservationBlocks(dbPath, { pid: 999_999 }, Date.now()), false, "an aged reservation is ignored");
});

await check("our OWN reservation never blocks us (the lander is not its own obstacle)", () => {
	releaseReservation(dbPath, me());
	const res = reserveSlots(dbPath, me());
	assert.equal(res.claimed, true);
	assert.equal(reservationBlocks(dbPath, me(), Date.now()), false, "the reserver is not blocked by itself");
});

await check("reserveSlots: a second LIVE claim queues (reported, not refused) and a stale one is reclaimed", () => {
	releaseReservation(dbPath, me());
	assert.equal(reserveSlots(dbPath, me()).claimed, true, "first claim wins");
	const other = reserveSlots(dbPath, { pid: 999_999, seat: "other", since: new Date().toISOString() });
	assert.equal(other.claimed, false, "a live holder's claim is not overwritten");
	assert.equal(other.holder.seat, "impl-land", "the queued caller is told who holds it");
	// A stale record IS reclaimable — otherwise one crashed lander would wedge every later one.
	writeFileSync(reservationPath(dbPath), JSON.stringify({ pid: 999_998, seat: "dead", since: new Date(Date.now() - 700_000).toISOString() }));
	assert.equal(reserveSlots(dbPath, me()).claimed, true, "a stale reservation is reclaimed");
});

await check("renewReservation keeps the claim fresh, and only for its owner", () => {
	releaseReservation(dbPath, me());
	reserveSlots(dbPath, me());
	const before = readReservation(dbPath).since;
	assert.equal(renewReservation(dbPath, { pid: 999_999 }), false, "another process cannot renew our claim");
	const after = readReservation(dbPath).since;
	assert.equal(after, before, "the claim was not touched by the foreign renew");
	assert.equal(renewReservation(dbPath, me()), true, "the owner renews");
	assert.notEqual(readReservation(dbPath).since, undefined);
});

await check("releaseReservation removes ours and leaves another's alone", () => {
	releaseReservation(dbPath, me());
	assert.equal(existsSync(reservationPath(dbPath)), false, "ours is gone");
	writeFileSync(reservationPath(dbPath), JSON.stringify({ pid: 999_999, seat: "other", since: new Date().toISOString() }));
	assert.equal(releaseReservation(dbPath, me()), false, "we do not release someone else's claim");
	assert.equal(existsSync(reservationPath(dbPath)), true, "and it is still there");
	rmSync(reservationPath(dbPath), { force: true });
});

await check("acquireAllSlotsSync STEALS a stale slot instead of waiting on it forever", () => {
	const dead = { pid: 999_997, seat: "gone", since: new Date().toISOString() };
	writeFileSync(`${dbPath}.genlock.0`, JSON.stringify(dead));
	assert.equal(slotIsStale(dead), true, "a dead holder's slot is stale");
	const held = acquireAllSlotsSync(dbPath, 1, me(), { waitMs: 500, pollMs: 20 });
	assert.equal(held.length, 1, "the lander claimed the slot");
	assert.equal(JSON.parse(readFileSync(held[0], "utf8")).pid, process.pid, "and it is OURS now");
	releaseSlotsSync(held, me());
});

await check("acquireAllSlotsSync WAITS behind a live holder and reports a bounded timeout", () => {
	const child = spawnHolder();
	try {
		writeFileSync(`${dbPath}.genlock.0`, JSON.stringify({ pid: child.pid, seat: "busy", since: new Date().toISOString() }));
		assert.throws(
			() => acquireAllSlotsSync(dbPath, 1, me(), { waitMs: 300, pollMs: 20 }),
			/timed out/,
			"a live holder is waited for, and the wait is BOUNDED (never an infinite block)",
		);
	} finally {
		child.kill();
		rmSync(`${dbPath}.genlock.0`, { force: true });
	}
});

await check("the lander no longer REFUSES on a live holder — it publishes the priority claim", () => {
	// The behavioural half is covered above; this pins the STRUCTURAL change the #1509 failure
	// was: the pre-flight start-check that refused on a live holder is gone, and the lander
	// publishes a reservation before it waits. A source check is the honest instrument here —
	// running land.mjs end-to-end needs a whole repo and a fast-forward.
	const src = readFileSync(join(root, "scripts", "land.mjs"), "utf8");
	assert.equal(
		/refusing to land:.*genlock slot\(s\) are held by a live holder/s.test(src),
		false,
		"the refusing start-check must be gone",
	);
	assert.match(src, /reserveSlots\(dbPath, me\)/, "the lander publishes the priority reservation");
	assert.match(src, /acquireAllSlotsSync\(dbPath, lockSlots, me\)/, "and claims the slots through the shared wait");
	assert.match(src, /releaseReservation\(dbPath, me\)/, "and releases the claim on its exit paths");
});

rmSync(tmpRoot, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS — wait-with-priority landing lock verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
