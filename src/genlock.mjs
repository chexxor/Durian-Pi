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
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

const STALE_MS = 60_000;
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

function holderAlive(holder) {
	if (!holder || typeof holder.pid !== "number") return false;
	try {
		process.kill(holder.pid, 0); // signal 0 = liveness probe only
		return true;
	} catch {
		return false;
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
				const age = holder?.since ? Date.now() - Date.parse(holder.since) : Infinity;
				if (!holderAlive(holder) || age > STALE_MS) {
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
	try {
		return await seatLocalStorage.run(me.seat, fn);
	} finally {
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
			stale: !holderAlive(holder),
			generatingSeat:
				holder && holderAlive(holder)
					? (typeof holder.seat === "string" ? holder.seat : `pid-${holder.pid}`)
					: null,
			detail:
				holder && !holderAlive(holder)
					? `held by pid ${holder.pid}${holder.seat ? ` (${holder.seat})` : ""}, which is gone`
					: "",
			name:
				holder && !holderAlive(holder)
					? "generation_stale"
					: "generation_in_flight",
		});
	}
	return out;
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
