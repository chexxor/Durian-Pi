// Cross-process generation slot leases.
//
// durig drives seats from per-invocation CLI processes, so "at most N
// seats generating at once" must be enforced ACROSS processes - an
// in-process semaphore would only police one process against itself.
// Enforcement point: the provider's generation entry points
// (`stream`/`streamSimple`); whoever drives runs inherits the limit.
//
// Mechanism: slot files `<db>.genlock.<i>` beside the rig database. A slot
// file existing means taken; content identifies the holder
// ({pid, seat, since}). A stale holder - dead pid or older than STALE_MS -
// may be stolen: a killed process can never release and must not wedge
// the rig forever.
//
// The lease doubles as operator visibility (#4 pairing): `durig status`
// and `durig watch` read these files to report "GPU busy with seat X"
// versus "holder looks dead" - waiting-for-the-GPU is distinguishable
// from stuck without any cross-process channel (pi-durable has none,
// see DECISIONS D11).
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { reservationBlocks } from "./genlockreserve.mjs";

// A legitimate generation can run to the provider stream timeout (600 s by default
// for the openai-compatible providers). A 60 s age fallback steals such a live
// holder and lets the concurrency cap be exceeded mid-response, so the age fallback
// is longer than that timeout, and a live holder renews its lease every
// LEASE_RENEW_MS — only a truly hung or dead holder ever ages out.
const STALE_MS = 660_000;
const LEASE_RENEW_MS = 20_000;
const ACQUIRE_POLL_MS = 100;

// In-process seat context (B2: per-concurrent-call seat attribution).
// AsyncLocalStorage lets each concurrent generation carry its own seat name
// through the provider call chain, independent of the global env var.
const seatLocalStorage = new AsyncLocalStorage();

/** Read the seat of the current async call, or null if not inside a slot. */
export function getSeatFromContext() {
	return seatLocalStorage.getStore() ?? null;
}

function slotPaths(dbPath, slots) {
	return Array.from({ length: slots }, (_, i) => `${dbPath}.genlock.${i}`);
}

export function holderAlive(holder) {
	if (!holder || typeof holder.pid !== "number") return false;
	try {
		process.kill(holder.pid, 0); // signal 0 = liveness probe only
		return true;
	} catch (err) {
		// EPERM means the process exists but we may not signal it (another integrity
		// level on Windows); only ESRCH means it is gone. Anything else is treated as
		// alive, because wrongly stealing a live holder breaks the concurrency cap.
		return err?.code !== "ESRCH";
	}
}

/**
 * Whether a slot may be stolen: its holder is dead, or it has aged past STALE_MS.
 * STALE_MS is longer than the provider stream timeout, and a live holder renews its
 * `since`, so a legitimate long generation is never age-stolen.
 */
export function slotIsStale(holder, now = Date.now()) {
	if (!holderAlive(holder)) return true;
	const age = holder?.since ? now - Date.parse(holder.since) : Infinity;
	return age > STALE_MS;
}

/**
 * Refresh a held slot's `since` so it never ages out while its generation is alive.
 * Written to a temp file and renamed, because a concurrent reader that parses a
 * half-written holder reads it as null and would steal a live lease.
 */
function renewSlot(path, me) {
	const tmp = `${path}.${process.pid}.renew`;
	try {
		writeFileSync(tmp, JSON.stringify({ ...me, since: new Date().toISOString() }));
		renameSync(tmp, path);
	} catch (err) {
		if (err?.code !== "ENOENT") {
			console.error(`GENLOCK WARNING: could not renew ${path}: ${err?.message ?? err}`);
		}
	}
}

function readHolder(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		if (err?.code !== "ENOENT") {
			// Torn write from a crashing holder; treated as free below but
			// reported so systematically unreadable slots stay visible.
			console.error(`GENLOCK WARNING: unreadable slot ${path}: ${err?.message ?? err}`);
		}
		return null;
	}
}

function claimSlot(path, me) {
	// 'wx' fails if another process created it between our existsSync and
	// here - that race IS the mutual exclusion.
	const fd = openSync(path, "wx");
	try {
		writeFileSync(fd, JSON.stringify(me));
	} finally {
		closeSync(fd);
	}
}

/**
 * Acquire one of `slots` generation slots around `dbPath`, then run `fn`.
 * Resolves with fn's result; always releases in finally.
 * @param {{dbPath: string, slots: number, seat?: string}} options
 * @param {() => Promise<any>} fn
 */
export async function withGenerationSlot(options, fn) {
	const { dbPath, slots } = options;
	mkdirSync(dirname(dbPath), { recursive: true });
	const paths = slotPaths(dbPath, slots);
	// B2: read seat from ALS context of the CURRENT async call (set by wrapProviderWithSlots
	// seatLocalStorage.run wrapper). Falls back to options.seat (explicit) or env var (legacy).
	const seat = seatLocalStorage.getStore() ?? options.seat ?? process.env.DURIG_ACTIVE_SEAT ?? null;
	const me = { pid: process.pid, seat, since: new Date().toISOString() };
	let path;
	for (;;) {
		// The LANDING lock has PRIORITY (#1497/#1498, lead #2054 precondition (c)): while a live
		// lander is waiting for the slots, a NEW generation yields rather than racing it for the
		// slot that just came free. Without this the lander lost every race — the holder re-claims
		// within seconds, so "the FF waits for a live holder" never terminated (#1509).
		// Fail-open on a dead/stale reservation: a crashed lander must never wedge generation.
		if (reservationBlocks(dbPath, me)) {
			await new Promise((r) => setTimeout(r, ACQUIRE_POLL_MS));
			continue;
		}
		path = null;
		for (const candidate of paths) {
			if (!existsSync(candidate)) {
				try {
					claimSlot(candidate, me);
					path = candidate;
					break;
				} catch {
					// lost the create race for this slot; try the next one
				}
			} else {
				const holder = readHolder(candidate);
				if (slotIsStale(holder)) {
					try {
						unlinkSync(candidate); // steal from a dead or wedged holder
					} catch (err) {
						if (err?.code !== "ENOENT") {
							console.error(`GENLOCK WARNING: could not steal ${candidate}: ${err?.message ?? err}`);
						}
						// ENOENT: another process stole or released first; fine.
					}
				}
			}
		}
		if (path) break;
		await new Promise((r) => setTimeout(r, ACQUIRE_POLL_MS));
	}
	// Renew the lease while fn runs: a response longer than STALE_MS must not look
	// abandoned. unref() keeps the timer from holding the process open.
	const renew = setInterval(() => renewSlot(path, me), LEASE_RENEW_MS);
	if (typeof renew.unref === "function") renew.unref();
	try {
		return await seatLocalStorage.run(me.seat, fn);
	} finally {
		clearInterval(renew);
		try {
			const holder = readHolder(path);
			if (holder?.pid === process.pid) {
				unlinkSync(path);
			} else {
				console.error(`GENLOCK WARNING: slot ${path} held by pid ${holder?.pid}, not us; leaving it alone`);
			}
		} catch (err) {
			console.error(`GENLOCK WARNING: release check failed for ${path}: ${err?.message ?? err}`);
		}
	}
}

/**
 * Read every existing slot's holder for operator surfacing.
 * @returns {Array<{slotIndex: number, seat: string|null, pid: number|null,
 *   since: string|null, stale: boolean}>}
 */
export function readGenerationSlots(dbPath, slots) {
	const out = [];
	for (const [slotIndex, path] of slotPaths(dbPath ?? "", Math.max(0, slots ?? 0)).entries()) {
		if (!existsSync(path)) continue;
		const holder = readHolder(path);
		out.push({
			slotIndex,
			pid: typeof holder?.pid === "number" ? holder.pid : null,
			since: typeof holder?.since === "string" ? holder.since : null,
			stale: slotIsStale(holder),
			generatingSeat:
				holder && holderAlive(holder)
					? (typeof holder.seat === "string" ? holder.seat : `pid-${holder.pid}`)
					: null,
			detail:
				holder && !holderAlive(holder)
					? `held by pid ${holder.pid}${holder.seat ? ` (${holder.seat})` : ""}, which is gone`
					: "",
			name: slotIsStale(holder) ? "generation_stale" : "generation_in_flight",
		});
	}
	return out;
}

/**
 * Remove slot files whose holder process is provably gone. Called once at broker
 * start, where the previous broker's slots are dead by definition. Only a pid the
 * OS reports as non-existent (ESRCH) is removed; an EPERM means a LIVE process we
 * may not signal (another integrity level), and removing that slot would delete a
 * live lease, so it is left alone (the `holderAlive` EPERM bug is tracked by item
 * 65 and must not be reintroduced here).
 * @returns {Array<{slot: string, pid: number}>} the slots removed
 */
export function reconcileGenerationSlots(dbPath, { onDiagnostic } = {}) {
	if (!dbPath) return [];
	const dir = dirname(dbPath);
	const prefix = `${basename(dbPath)}.genlock.`;
	let names;
	try {
		names = readdirSync(dir);
	} catch (err) {
		if (err?.code !== "ENOENT") {
			onDiagnostic?.({ kind: "genlock-reconcile-scan-failed", error: String(err?.message ?? err) });
		}
		return [];
	}
	const removed = [];
	for (const name of names) {
		if (!name.startsWith(prefix)) continue;
		const path = join(dir, name);
		const holder = readHolder(path);
		const pid = typeof holder?.pid === "number" ? holder.pid : null;
		// No pid to check (a torn/absent record): leave it; the acquire path ages it out.
		if (pid === null) continue;
		let gone = false;
		try {
			process.kill(pid, 0);
		} catch (err) {
			if (err?.code === "ESRCH") gone = true;
			// EPERM / unknown: assume a live holder and keep the slot.
		}
		if (!gone) continue;
		try {
			unlinkSync(path);
			removed.push({ slot: name, pid });
		} catch (err) {
			if (err?.code !== "ENOENT") {
				onDiagnostic?.({ kind: "genlock-reconcile-failed", path, error: String(err?.message ?? err) });
			}
		}
	}
	return removed;
}

/**
 * Wrap a provider so every generation holds a cross-process slot for the
// WHOLE response: our mirror stream returns immediately, the underlying
// call starts only once a slot is free, and its events are forwarded.
 * Consumers (pi-durable runs) see an ordinary AssistantMessageEventStream.
 * @param {import("@earendil-works/pi-ai").Provider} provider
 * @param {{dbPath: string, slots: number, getSeat?: () => string|null}} options
 */
export function wrapProviderWithSlots(provider, options) {
	const gated = (call) => (model, context, opts) => {
		const out = new AssistantMessageEventStream();
		// B2: each call sets its own ALS context so concurrent generations
		// carry their own seat name through the provider call chain.
		const seatName = process.env.DURIG_ACTIVE_SEAT ?? null;
		seatLocalStorage.run(seatName, async () => {
			try {
				await withGenerationSlot({ dbPath: options.dbPath, slots: options.slots }, async () => {
					const inner = call(model, context, opts);
					for await (const ev of inner) {
						out.push(ev);
					}
					if (typeof inner.result === "function") {
						try {
							const res = await inner.result();
							if (res) out.end(res);
						} catch (err) {
							console.error(`GENLOCK WARNING: inner result unavailable: ${err?.message ?? err}`);
						}
					}
				});
			} catch (err) {
				console.error(`GENLOCK ERROR: generation failed while gated: ${err?.stack ?? err}`);
				out.push({
					type: "error",
					reason: "error",
					error: { role: "assistant", content: [], stopReason: "error" },
				});
			}
		});
		return out;
	};
	return {
		...provider,
		stream: gated(provider.stream.bind(provider)),
		streamSimple: gated(provider.streamSimple.bind(provider)),
	};
}
