// src/storeownership.mjs — the dependency-free "does something else own this store?" guard.
//
// WHY THIS EXISTS. durig's first rule is ONE writer per store: the broker owns it, and a second
// Harness-opening process is exactly what corrupted the store twice (docs/runbooks/README.md, "the
// one rule that shapes every runbook"). The durable-TUI entrypoint (`tui.mjs`, D101/D102) is a
// WRITER, so it must FAIL CLOSED before opening a store a broker already owns — the D42 / F24
// second-writer collision. The same discipline already guards `land.mjs`'s store resolution (#1383).
//
// WHY A SEPARATE, DEPENDENCY-FREE MODULE. The check has to load when the provider stack is broken
// (the reason `scripts/land.mjs` inlined its copy), and it must not drift between copies. So it
// lives here with node:fs/node:path only, reuses src/genlockreserve.mjs's reservation rule (also
// dependency-free), and mirrors src/broker.mjs's broker-state + heartbeat logic — broker.mjs itself
// imports pi-ai, so it cannot be the shared home.
//
// Read-only: nothing here writes, and nothing here opens a store "to check".

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isReservationPath } from "./genlockreserve.mjs";

/** Liveness by signal 0. ESRCH means the process is gone; EPERM means alive-but-unsignalable. */
export function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err?.code !== "ESRCH";
	}
}

/** The broker's state file path (mirrors src/broker.mjs `brokerStatePath`). */
export function brokerStatePath(dbPath) {
	return `${dbPath}.broker.json`;
}

// The broker refreshes its state file every 20s; a state whose heartbeat is older than this is
// treated as dead. This is the identity proxy Windows needs: pids are reused, so `kill(pid, 0)`
// alone can read a recycled pid as the broker. Mirrors src/broker.mjs.
export const BROKER_HEARTBEAT_TIMEOUT_MS = 60_000;

/** Liveness probe by signal 0, hardened against a recycled pid by the heartbeat window. */
export function brokerAlive(state, { now = Date.now() } = {}) {
	if (!state || typeof state.pid !== "number") return false;
	if (
		typeof state.heartbeatAt === "number" &&
		now - state.heartbeatAt > BROKER_HEARTBEAT_TIMEOUT_MS
	) {
		return false;
	}
	try {
		process.kill(state.pid, 0);
		return true;
	} catch (err) {
		return err?.code === "EPERM";
	}
}

/** Read the broker state; a missing/unreadable file reads as absent (never fatal, never noisy). */
export function readBrokerState(dbPath) {
	try {
		return JSON.parse(readFileSync(brokerStatePath(dbPath), "utf8"));
	} catch {
		return null;
	}
}

/**
 * Slot files `<db>.genlock.<i>` whose holder is ALIVE. A dead holder's slot is stale and the broker
 * reconciles it, so it does not block. The PRIORITY reservation (`<db>.genlock.priority`) shares the
 * prefix but is NOT a generation slot — counting it would report the lander against itself (#1498).
 */
export function heldGenlocks(dbPath) {
	const dir = dirname(resolve(dbPath));
	const prefix = `${basename(resolve(dbPath))}.genlock.`;
	if (!existsSync(dir)) return [];
	const held = [];
	for (const name of readdirSync(dir)) {
		if (!name.startsWith(prefix)) continue;
		const path = join(dir, name);
		if (isReservationPath(path)) continue;
		let holder = null;
		try {
			holder = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			holder = null; // unreadable/partial: not evidence of a live run
		}
		if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
			held.push({ path, pid: holder.pid, seat: holder.seat ?? null, since: holder.since ?? null });
		}
	}
	return held;
}

/**
 * The whole ownership verdict for one store. `owned` is true when a LIVE broker or a LIVE
 * generation holder is present; `reasons` is a legible list for a refusal message. Read-only.
 *
 * @returns {{owned:boolean, broker:Object|null, genlocks:Object[], reasons:string[]}}
 */
export function assessStoreOwnership(dbPath, { now = Date.now() } = {}) {
	const broker = readBrokerState(dbPath);
	const liveBroker = brokerAlive(broker, { now });
	const genlocks = heldGenlocks(dbPath);
	const reasons = [];
	if (liveBroker) reasons.push(`a broker is driving it (pid ${broker.pid})`);
	for (const g of genlocks) {
		reasons.push(`a generation is in flight (pid ${g.pid}${g.seat ? `, seat ${g.seat}` : ""})`);
	}
	return { owned: liveBroker || genlocks.length > 0, broker: liveBroker ? broker : null, genlocks, reasons };
}
