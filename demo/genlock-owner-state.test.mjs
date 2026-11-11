// demo/genlock-owner-state.test.mjs — #6182: an owner the lease cannot name is NOT a dead owner.
//
// THE DEFECT, red before this change (run this file in a scratch worktree at main `35001c3a` and it
// exits 1): src/genlockreserve.mjs's `recordAlive` was two-state — `if (!record || typeof record.pid
// !== "number") return false;` — so a reservation whose owner could not be resolved read as DEAD,
// `recordIsStale` returned true immediately, `reservationBlocks` said "nobody is holding it", and a
// SECOND writer claimed the slots while the first lease was still on disk. The single-writer
// invariant is the store's core control; the 2026-10-16 second-writer crash recorded in
// docs/runbooks/resume-while-broker-runs.md is this rig's live precedent for what that costs.
//
// THE RULE NOW: three states, and only ESRCH releases a lease — the shape the landed liveness
// finding #3743 already established (UNKNOWN returns ALIVE). The age window stays, because a
// crashed lander must never wedge the rig; when an UNRESOLVABLE owner ages out, that release is
// reported, not silent, because "cannot identify the owner" and "the owner is gone" are different
// claims and only the second justifies admitting a writer.
//
// THE PAIRINGS that stop this from being a tightening that wedges the rig:
//   - no file at all            -> not a lease, claims succeed;
//   - confirmed-dead holder     -> releases, claims succeed;
//   - unresolvable owner, fresh -> REFUSED (the fix);
//   - unresolvable owner, aged  -> released WITH a warning (the anti-wedge fallback).
//
// Run: node demo/genlock-owner-state.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
	RESERVATION_STALE_MS,
	ownerState,
	recordAlive,
	recordIsStale,
	reservationBlocks,
	reserveSlots,
	slotIsStale,
	reservationPath,
} from "../src/genlockreserve.mjs";
import { holderAlive, slotIsStale as genlockSlotIsStale } from "../src/genlock.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const dir = await mkdtemp(join(tmpdir(), "durig-genlock-owner-"));
const db = join(dir, "store.sqlite");
const plant = (record) => writeFile(reservationPath(db), JSON.stringify(record));

console.log("\n#6182 — the three states, decided by the OS, not by the absence of a pid\n");
check(`our own pid is alive: ${process.pid}`, ownerState({ pid: process.pid, since: new Date().toISOString() }) === "alive");

// A child that exits gives a pid the OS can prove is gone.
const child = spawn(process.execPath, ["-e", "0"]);
const childPid = child.pid;
await new Promise((resolve) => child.once("exit", resolve));
check(`the exited child's pid ${childPid} is CONFIRMED dead (ESRCH)`, ownerState({ pid: childPid, since: new Date().toISOString() }) === "dead");

for (const [label, rec] of [
	["pid missing", {}],
	["pid null", { pid: null }],
	["pid a string", { pid: "1234" }],
	["pid NaN", { pid: NaN }],
	["pid zero", { pid: 0 }],
	["pid negative", { pid: -3 }],
]) {
	check(`${label} is UNKNOWN, not dead`, ownerState({ ...rec, since: new Date().toISOString() }) === "unknown");
}
check("no record at all is ABSENT (absence is not a lease)", ownerState(null) === "absent");
check("UNKNOWN counts as alive in recordAlive", recordAlive({ pid: null, since: new Date().toISOString() }) === true);

console.log("\n#6182 — a second writer is REFUSED against an unresolvable lease (red before)\n");
await plant({ pid: null, since: new Date().toISOString(), priority: true });
check("reservationBlocks: a lease with no nameable owner still blocks", reservationBlocks(db, { pid: process.pid }) === true);
const second = reserveSlots(db, { pid: process.pid, seat: "lander" });
check("reserveSlots refuses a second claim", second.claimed === false, JSON.stringify(second));
check("the refusal names the holder it is queueing behind", second.holder && second.holder.pid === null, JSON.stringify(second));

console.log("\n#6182 — the pairings that keep this from wedging the rig\n");
await rm(reservationPath(db), { force: true });
check("no reservation file: nothing blocks, and a claim succeeds", reservationBlocks(db, { pid: process.pid }) === false && reserveSlots(db, { pid: process.pid }).claimed === true);
await rm(reservationPath(db), { force: true });
await plant({ pid: childPid, since: new Date().toISOString(), priority: true });
check("a CONFIRMED-dead holder releases the lease and the claim succeeds", reserveSlots(db, { pid: process.pid }).claimed === true);

// The age fallback: an unresolvable owner that has aged out is released, LOUDLY.
await rm(reservationPath(db), { force: true });
const aged = { pid: null, since: new Date(Date.now() - (RESERVATION_STALE_MS + 10_000)).toISOString(), priority: true };
const originalError = console.error;
const captured = [];
console.error = (msg) => captured.push(String(msg));
const agedStale = recordIsStale(aged, Date.now(), reservationPath(db));
console.error = originalError;
check("an aged unresolvable lease is released (anti-wedge)", agedStale === true);
check("and the release is reported, naming that it is the age fallback not a liveness finding",
	captured.some((m) => /UNRESOLVABLE owner/.test(m) && /admits a second writer/.test(m)),
	captured.join(" | "));
await plant(aged);
check("so a claim against it succeeds rather than stalling forever", reserveSlots(db, { pid: process.pid }).claimed === true);

// The shape with NO evidence at all: no owner and no timestamp. It cannot be aged against anything,
// so it self-clears (a malformed lease must not wedge the rig) - and it says so out loud.
await rm(reservationPath(db), { force: true });
await plant({ priority: true });
const evidenceless = [];
console.error = (msg) => evidenceless.push(String(msg));
const evidencelessStale = recordIsStale({ priority: true }, Date.now(), reservationPath(db));
console.error = originalError;
check("a lease with neither an owner nor a timestamp self-clears rather than wedging the store", evidencelessStale === true);
check("and that too is reported, not silent", evidenceless.some((m) => /UNRESOLVABLE owner/.test(m)), evidenceless.join(" | "));

console.log("\n#6182 — the same rule at the slot layer\n");
check("slot fresh + alive: not stale", slotIsStale({ pid: process.pid, since: new Date().toISOString() }) === false);
check("slot with an unresolvable owner, fresh: NOT stale (red before: it was)", slotIsStale({ since: new Date().toISOString() }) === false);
check("slot confirmed dead: stale", slotIsStale({ pid: childPid, since: new Date().toISOString() }) === true);
check("slot torn/unreadable record: stale, because there is no lease there at all", slotIsStale(null) === true);

console.log("\n#6182 — the generation-slot layer (src/genlock.mjs) shares the rule, it does not re-derive it\n");
check("holderAlive: an unnamed owner is not dead", holderAlive({ pid: null, since: new Date().toISOString() }) === true);
check("holderAlive: our own pid is alive", holderAlive({ pid: process.pid }) === true);
check("holderAlive: the exited child is dead", holderAlive({ pid: childPid }) === false);
check("holderAlive: no record at all is not a holder", holderAlive(null) === false);
check("a fresh slot with an unnamed owner is NOT stealable", genlockSlotIsStale({ pid: null, since: new Date().toISOString() }) === false);
check("a slot with a confirmed-dead holder IS stealable (a killed process can never release)", genlockSlotIsStale({ pid: childPid, since: new Date().toISOString() }) === true);

await rm(dir, { recursive: true, force: true });

console.log(failures === 0
	? "\nPASS — only ESRCH releases a lease; an unnamed owner is a live lease until it ages, and then it is reported"
	: `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
