// demo/genlock-release-reclaim.test.mjs — release reclaims a reclaimable genlock
// slot SILENTLY (F24-2 / #258).
//
// The defect this closes: a forced kill leaves a stale `<db>.genlock.<i>` lease
// (dead pid) — or a torn/unreadable record that reads as `pid undefined`. When
// the release path found the slot was not its own it warned
// "held by pid <dead>/undefined, not us; leaving it alone" and LEFT THE SLOT
// BEHIND, so a later driver could stall on a lease that was already reclaimable
// (the acquire path's dead-pid steal would have absorbed it anyway).
//
// Failing-first: before the fix the torn-record and dead-pid cases emit the
// "leaving it alone" warning and leave the file, so those assertions are RED.
//
// Release must distinguish three cases:
//   (1) a torn/absent record (no usable pid) is OURS gone stale -> reclaim silently;
//   (2) a dead-pid holder -> reclaim silently;
//   (3) a DIFFERENT LIVE pid -> a real conflict -> keep the warning and leave it.
//
// Run: node demo/genlock-release-reclaim.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withGenerationSlot } from "../src/genlock.mjs";

const base = mkdtempSync(join(tmpdir(), "durig-genlock-release-"));
let sleeper = null;

/** Run one acquisition, sabotage the slot inside `fn`, and capture our warnings. */
async function releaseWithSabotage(dbPath, sabotage) {
	const slot = `${dbPath}.genlock.0`;
	const warnings = [];
	const original = console.error;
	console.error = (...args) => warnings.push(args.join(" "));
	try {
		await withGenerationSlot({ dbPath, slots: 1 }, async () => {
			sabotage(slot);
		});
	} finally {
		console.error = original;
	}
	// Only consider warnings from the RELEASE path (the "leaving it alone" /
	// "could not reclaim" ones); readHolder's torn-write notice is a different
	// concern and is intentionally still emitted.
	const releaseWarnings = warnings.filter(
		(w) => w.includes("leaving it alone") || w.includes("could not reclaim"),
	);
	return { slot, warnings: releaseWarnings, exists: existsSync(slot) };
}

try {
	// --- (1) a torn record reads as `pid undefined`; reclaim it silently ---
	{
		const db = join(base, "torn.sqlite");
		const r = await releaseWithSabotage(db, (slot) => {
			// Valid acquisition wrote the slot; replace it with a torn record so the
			// release path sees no usable holder.
			writeFileSync(slot, "{ not json");
		});
		assert.deepEqual(r.warnings, [], `torn record: no release warning (got ${JSON.stringify(r.warnings)})`);
		assert.equal(r.exists, false, "torn record: the reclaimable slot is removed");
	}

	// --- (2) a dead-pid holder is reclaimable; reclaim it silently ---
	{
		const db = join(base, "dead.sqlite");
		// 999999999 is not a live pid (well beyond the process table on any platform).
		const r = await releaseWithSabotage(db, (slot) => {
			writeFileSync(slot, JSON.stringify({ pid: 999999999, seat: "ghost", since: new Date().toISOString() }));
		});
		assert.deepEqual(r.warnings, [], `dead pid: no release warning (got ${JSON.stringify(r.warnings)})`);
		assert.equal(r.exists, false, "dead pid: the reclaimable slot is removed");
	}

	// --- (3) a DIFFERENT LIVE pid is a real conflict; warn and leave it ---
	{
		const db = join(base, "live.sqlite");
		sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
		await new Promise((resolve) => sleeper.once("spawn", resolve));
		const livePid = sleeper.pid;
		const r = await releaseWithSabotage(db, (slot) => {
			writeFileSync(slot, JSON.stringify({ pid: livePid, seat: "other", since: new Date().toISOString() }));
		});
		assert.equal(r.warnings.length, 1, `live pid: exactly one warning (got ${JSON.stringify(r.warnings)})`);
		assert.match(r.warnings[0], new RegExp(`held by pid ${livePid}, not us; leaving it alone`),
			`live pid: the warning names the live holder (got ${r.warnings[0]})`);
		assert.equal(r.exists, true, "live pid: the slot is left for its live holder");
	}

	console.log(
		"GENLOCK RELEASE-RECLAIM PASS (a torn/dead slot is reclaimed silently; a live different pid is left with a warning)",
	);
} finally {
	if (sleeper && !sleeper.killed) {
		try { sleeper.kill(); } catch (err) {
			console.error(`cleanup: could not kill sleeper pid ${sleeper.pid}: ${err?.message ?? err}`);
		}
	}
	rmSync(base, { recursive: true, force: true });
}

process.exit(0);
