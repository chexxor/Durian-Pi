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

/**
 * The TUI entrypoint's decision: `open` | `attach` | `refuse`. ONE rule, no override (#4006).
 *
 * WHY THIS IS A DECISION AND NOT A FLAG. `tui.mjs` used to be only a WRITER: owned -> refuse. That
 * left the operator with no way to be IN the session the broker already drives, so the operator
 * stopped the broker to look at it — and a stop is a writer hand-over, not a view. The library has
 * the shape for the view: pi-durable `docs/spec.md:838-847` says a process that only shows a session
 * another one drives opens it with `HarnessOptions.readOnly: true` — "Every commit with writes rejects
 * with `ReadOnlySession` before it reaches Storage, so the Session stays healthy" — and README:127
 * says SQLite locks keep that open safe beside the writer. So the refusal becomes a BRANCH:
 * a live broker means ATTACH (read-only viewer), nothing owning it still means OPEN (writer).
 *
 * THE ONE-HANDLE RULE THIS ENFORCES (spec.md:4371 "`Harness` instances must never own the same
 * Session concurrently"). Measured on this rig (`.spike/probe-attach2.out`): a second NON-readOnly
 * open on a separate `openNodeSqliteStorage` handle is ALLOWED by the library and DOES write (store
 * 4,096 -> 122,880 B), so the library does not stop a second writer — ONLY THIS VERDICT DOES. A
 * live generation holder is not a session to attach to: a generation is a transient in-flight run,
 * not the resident driver, so `--attach` REFUSES there rather than waiting for one.
 *
 * Read-only: nothing here writes, and nothing here opens a store "to check".
 *
 * @param {string} dbPath
 * @param {{attach?:boolean, now?:number, ownership?:Object}} `attach` is what the user asked for;
 *   `ownership` may be passed in to avoid re-reading the state files.
 * @returns {{action:"attach"|"open"|"refuse", broker:Object|null, ownership:Object, reasons:string[]}}
 */
export function tuiOpenVerdict(dbPath, { attach = false, now = Date.now(), ownership = assessStoreOwnership(dbPath, { now }) } = {}) {
	if (!attach) {
		if (!ownership.owned) return { action: "open", broker: null, ownership, reasons: [] };
		return {
			action: "refuse",
			broker: ownership.broker,
			ownership,
			reasons: [...ownership.reasons, "this entrypoint opened a SECOND writer; pass --attach to view that session read-only instead"],
		};
	}
	if (!ownership.broker) {
		return {
			action: "refuse",
			broker: null,
			ownership,
			reasons: ownership.genlocks.length > 0
				? [...ownership.reasons, "a generation is not the resident driver: there is no session to attach to, and opening here would be a second writer"]
				: ["nothing owns this store, so there is no session to attach to — --attach names the store a BROKER drives (serve --db <path>)"],
		};
	}
	return {
		action: "attach",
		broker: ownership.broker,
		ownership,
		reasons: [`the broker (pid ${ownership.broker.pid}) drives it — attaching as a read-only viewer (readOnly Harness), never a second writer`],
	};
}
