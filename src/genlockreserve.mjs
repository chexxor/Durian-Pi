// The PRIORITY RESERVATION on the generation slots — the missing half of the landing lock.
//
// Why this exists (#1497/#1498, lead #2054 precondition (c)): the landing lock claims ALL N
// generation slots so no generation can start mid-fast-forward. But a lander that arrives while
// a generation is ALREADY in flight could only WAIT, and waiting never succeeded: the holder
// re-claims a slot for its next generation within seconds, so the lander always lost the race
// for the slot that just came free. The empirically reproduced failure (#1509) was seven
// refusals in three minutes against a coordinator that generates continuously — "the FF WAITS
// for a live holder" was unreachable, because the pre-flight START-CHECK refused on exactly the
// condition the wait was meant to handle.
//
// The fix is a QUEUE, not a longer poll: a lander that wants the slots PUBLISHES a reservation
// first, and every new generation yields while a live reservation exists. The current holder
// still finishes its generation (it is already inside it); the lander then takes the slots
// ahead of any new generation, which is what "wait-with-priority" means.
//
// FAIL-OPEN is the safety property that makes this shippable: a reservation whose holder is
// CONFIRMED dead (ESRCH), or one older than RESERVATION_STALE_MS, is IGNORED (and reclaimable), so
// a crashed lander can never wedge the rig — a wedged rig cannot generate at all, which is far
// worse than a stalled landing. Only a LIVE reservation held by another process blocks anything.
// Since #6182 an owner the record cannot name is treated as ALIVE, not dead: "no pid" is not
// evidence that anyone is gone, and reading it as death admitted a second writer the moment the
// file was parsed.
//
// This module is DELIBERATELY dependency-free (node:fs/node:path only). scripts/land.mjs is the
// enforcement chokepoint and must keep loading when the provider stack is broken (#1164 Q3,
// the 2026-10-17 checkup.mjs lesson), and src/genlock.mjs needs the same rule in-process. One
// implementation, two callers, no pi-ai in either path.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** How long a reservation survives without renewal. Matches genlock's STALE_MS: longer than a
 * legitimate provider stream, so a live lander waiting on a long generation is never aged out. */
export const RESERVATION_STALE_MS = 660_000;

/** The reservation file for a store. One per store, beside the numbered slot files. */
export function reservationPath(dbPath) {
	return `${dbPath}.genlock.priority`;
}

/**
 * Liveness of a record's owner as THREE states instead of two (#6182).
 *   "absent"  - there is no record. Absence is not a lease, so it blocks nobody.
 *   "dead"    - the OS confirms the owner is gone (ESRCH on signal 0).
 *   "alive"   - the probe succeeded, or EPERM (the process exists but we may not signal it,
 *               the Windows integrity-level case), or any other error.
 *   "unknown" - the record names no usable owner: missing, null, NaN, zero, negative, a string.
 *               A record that says nothing about its owner is NOT evidence that anyone is gone.
 *
 * ONLY "dead" releases a lease. This mirrors the landed liveness finding #3743 (only ESRCH is
 * dead; UNKNOWN returns ALIVE) and it is the fix for the single-writer hole: the old two-state
 * rule read an unresolvable owner as dead, so a reservation with no pid admitted a second writer
 * immediately - the 2026-10-16 second-writer crash in docs/runbooks/resume-while-broker-runs.md is
 * this rig's live precedent for what that costs.
 */
export function ownerState(record) {
	if (!record) return "absent";
	const pid = record.pid;
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return "unknown";
	try {
		process.kill(pid, 0); // signal 0 = liveness probe only, never delivered
		return "alive";
	} catch (err) {
		return err?.code === "ESRCH" ? "dead" : "unknown";
	}
}

/**
 * ALIVE means "not confirmed dead" — an unresolvable owner counts as alive here. Kept under its
 * old name so the two callers (scripts/land.mjs and src/genlock.mjs's rule) do not have to change.
 */
export function recordAlive(record) {
	const state = ownerState(record);
	return state === "alive" || state === "unknown";
}

/**
 * A record is stale when its owner is CONFIRMED dead, or when it has aged past the stale window.
 *
 * The age window is the deliberate, documented fail-open (a crashed lander must not wedge the rig:
 * a wedged rig cannot generate at all, which is worse than a stalled landing). When the owner is
 * UNKNOWN *and* the record has aged, the release is reported loudly rather than happening silently,
 * because "we could not identify the owner" and "the owner is gone" are different claims and the
 * second one is what justifies admitting a writer.
 */
export function recordIsStale(record, now = Date.now(), where = null) {
	if (!record) return true;
	const state = ownerState(record);
	if (state === "dead") return true;
	const age = typeof record.since === "string" ? now - Date.parse(record.since) : Infinity;
	if (age > RESERVATION_STALE_MS) {
		if (state === "unknown") {
			console.error(
				`GENLOCK WARNING: ${where ?? "a reservation"} has an UNRESOLVABLE owner (pid ${record.pid ?? "missing"}) ` +
				`and has aged past ${RESERVATION_STALE_MS} ms, so the age fallback releases it. That admits a second ` +
				`writer without evidence the holder is gone - it is the documented fail-open, not a liveness finding.`,
			);
		}
		return true;
	}
	return false;
}

/** Parse a record file; null when absent, torn or unreadable (never evidence of a live holder). */
export function readRecord(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/** The current reservation, or null. */
export function readReservation(dbPath) {
	return readRecord(reservationPath(dbPath));
}

/**
 * Whether a LIVE reservation held by someone else blocks a new claim. Our own reservation never
 * blocks us, and a stale/dead one never blocks anyone (fail-open).
 */
export function reservationBlocks(dbPath, me = {}, now = Date.now()) {
	const held = readReservation(dbPath);
	if (!held) return false;
	if (typeof me.pid === "number" && held.pid === me.pid) return false;
	return !recordIsStale(held, now);
}

/**
 * Publish the lander's claim so new generations yield. Idempotent for the SAME pid (a retry
 * renews rather than fails). Returns {claimed, holder}: `claimed` is false when another LIVE
 * reservation is already waiting, which the caller should treat as "queue behind it" rather
 * than "refuse" — the whole point of this item is that a live lander is not an error.
 */
export function reserveSlots(dbPath, me) {
	mkdirSync(dirname(dbPath), { recursive: true });
	const path = reservationPath(dbPath);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const fd = openSync(path, "wx");
			try {
				writeFileSync(fd, JSON.stringify({ ...me, priority: true }));
			} finally {
				closeSync(fd);
			}
			return { claimed: true, holder: { ...me, priority: true } };
		} catch (err) {
			if (err?.code !== "EEXIST") throw err;
			const held = readRecord(path);
			if (held && typeof me.pid === "number" && held.pid === me.pid) {
				renewReservation(dbPath, me); // ours already: keep it fresh
				return { claimed: true, holder: { ...me, priority: true } };
			}
			if (recordIsStale(held, Date.now(), path)) {
				try {
					unlinkSync(path); // a dead or wedged lander must not hold the queue
				} catch (unlinkErr) {
					if (unlinkErr?.code !== "ENOENT") throw unlinkErr;
				}
				continue;
			}
			return { claimed: false, holder: held };
		}
	}
	return { claimed: false, holder: readRecord(path) };
}

/**
 * Refresh our reservation's `since` so a long wait is never aged out and stolen. Written to a
 * temp file and renamed, because a reader that parses a half-written record reads it as null and
 * would treat a live reservation as absent. A reservation we do not own is left alone.
 */
export function renewReservation(dbPath, me) {
	const path = reservationPath(dbPath);
	const held = readRecord(path);
	if (!held || held.pid !== me.pid) return false;
	const tmp = `${path}.${process.pid}.renew`;
	try {
		writeFileSync(tmp, JSON.stringify({ ...held, ...me, priority: true, since: new Date().toISOString() }));
		renameSync(tmp, path);
		return true;
	} catch (err) {
		if (err?.code !== "ENOENT") {
			console.error(`GENLOCK WARNING: could not renew the reservation ${path}: ${err?.message ?? err}`);
		}
		return false;
	}
}

/** Release our reservation; someone else's is left alone. */
export function releaseReservation(dbPath, me) {
	const path = reservationPath(dbPath);
	const held = readRecord(path);
	if (!held || (typeof me.pid === "number" && held.pid !== me.pid)) return false;
	try {
		unlinkSync(path);
		return true;
	} catch (err) {
		return err?.code === "ENOENT";
	}
}

/** A slot file may be stolen when its holder is CONFIRMED dead or has aged out (#6182: an owner
 * the record cannot name is not evidence of death). */
export function slotIsStale(holder, now = Date.now()) {
	return recordIsStale(holder, now, "a genlock slot");
}

/** Synchronous sleep — scripts/land.mjs is a sync script, so its acquire loop must block. */
function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Claim ALL `slots` slots beside `dbPath`, WAITING behind a live holder — the wait-with-priority
 * claim. The caller is expected to have published its reservation first (see `reserveSlots`), so
 * new generations yield and the wait terminates instead of losing every race.
 *
 * Renews the reservation while it waits, so a long generation cannot age our claim out. Steals
 * dead/wedged slot holders. Returns the claimed paths; releases a partial claim and throws on
 * timeout.
 */
export function acquireAllSlotsSync(dbPath, slots, me, { waitMs = RESERVATION_STALE_MS, pollMs = 100, onWait = null } = {}) {
	const claimed = [];
	const deadline = Date.now() + waitMs;
	const startedAt = Date.now();
	let lastRenew = 0;
	let lastReport = 0;
	for (let i = 0; i < slots; i += 1) {
		const path = `${dbPath}.genlock.${i}`;
		for (;;) {
			try {
				const fd = openSync(path, "wx");
				try {
					writeFileSync(fd, JSON.stringify(me));
				} finally {
					closeSync(fd);
				}
				claimed.push(path);
				break;
			} catch (err) {
				if (err?.code !== "EEXIST") {
					releaseSlotsSync(claimed, me);
					throw err;
				}
				if (slotIsStale(readRecord(path))) {
					try {
						unlinkSync(path); // steal from a dead or wedged holder
					} catch {
						// another process stole or released it first; retry the claim
					}
					continue;
				}
				if (Date.now() > deadline) {
					releaseSlotsSync(claimed, me);
					throw new Error(
						`timed out after ${waitMs} ms waiting for genlock slot ${path} ` +
							`(held by pid ${readRecord(path)?.pid ?? "?"})`,
					);
				}
				// #4432 LEGIBILITY: report the wait WHILE it happens, not only in the final JSON. A seat
				// that blocks for minutes with no output concludes its tool HUNG and RETRIES — and a retry
				// during a lock wait adds contention (a retried landing is the two-delegates-one-tree
				// shape). `onWait` is throttled to ~5 s so a long wait reads as WAITING, not as a hang.
				if (onWait && Date.now() - lastReport > 5000) {
					lastReport = Date.now();
					onWait({ slot: i, slots, waitedMs: Date.now() - startedAt, holderPid: readRecord(path)?.pid ?? null });
				}
				// Keep our priority claim alive across a long wait (renew at the lease interval).
				if (Date.now() - lastRenew > 20_000) {
					renewReservation(dbPath, me);
					lastRenew = Date.now();
				}
				sleepSync(pollMs);
			}
		}
	}
	return claimed;
}

/** Release the slots WE hold; a slot another process now owns is left alone. */
export function releaseSlotsSync(paths, me) {
	for (const path of paths) {
		try {
			if (readRecord(path)?.pid === me.pid) unlinkSync(path);
		} catch {
			// already gone
		}
	}
}

/** True when the path is the reservation rather than one of the numbered slots. */
export function isReservationPath(path) {
	return path.endsWith(".genlock.priority");
}

/** True when the file exists (used by callers that only need presence). */
export function reservationExists(dbPath) {
	return existsSync(reservationPath(dbPath));
}
