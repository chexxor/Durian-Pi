// src/tui/durable/attach.mjs — the Phase 2 SEAM LAYER: the operator window, in ONE place.
//
// WHY THIS FILE EXISTS, and why it is a BRIDGE. Seam (a), the operator window, is a near-term
// bridge to be RETIRED once seam (b) — the broker-owned spool client — lands. Under (b) ownership
// NEVER transfers: the broker stays the writer and the TUI addresses a conversation BY ID through
// the spool. So the ownership-transfer machinery lives HERE and nowhere else, so (b) can delete it
// wholesale instead of unpicking pause/resume assumptions from rendering and store access.
//
// THE ONE RULE THIS FILE ENFORCES: a second writer must be IMPOSSIBLE, not merely unlikely. The
// durable TUI is a WRITER, so it may open a store ONLY when `assessStoreOwnership` says nobody owns
// it (src/storeownership.mjs — the guard is the TEST, not the obstacle; a design that needs the
// guard weakened has already failed).
//
// ── THE FINDING THIS FILE WAS BUILT AGAINST (read this before changing it) ────────────────────
// The ruled model is "operator pauses → broker RELEASES → TUI acquires → TUI releases → broker
// resumes". In this tree PAUSE AND RELEASE ARE DIFFERENT OPERATIONS AND ONLY ONE EXISTS:
//   * `applyPauseOp` (src/broker.mjs:510) sets the RIG-LEVEL `paused` flag in the store. The broker
//     PROCESS stays alive, keeps its `.broker.json` heartbeat fresh, and `assessStoreOwnership`
//     therefore still reports `owned:true`. A paused broker has NOT released the store.
//   * RELEASE today means the broker PROCESS is gone (`serve --stop` / a dead pid). The state file
//     may survive, but `brokerAlive` returns false for a dead pid, so the guard correctly reports
//     the store free — which is what makes fail-closed acquisition possible WITHOUT weakening it.
// So `beginOperatorWindow` (the contract) + a genuinely stopped broker + `acquireSeatStore` is
// buildable and is what this module implements. The PAUSE-while-ALIVE variant is NOT buildable
// against the current guard: it would need either a relinquish state the guard understands or a
// second-writer window.
//
// ── RULED 2026-10-20 (#4004): STOP-AND-RESTART. NO RELINQUISH STATE. DO NOT RE-PROPOSE IT. ─────
// The operator window is: record the contract -> STOP the broker -> acquire THROUGH the guard ->
// session -> release on exit -> RESTART the broker. A relinquish state was considered and REFUSED,
// for three reasons, in the order they bind:
//   1. THE GUARD'S STRENGTH IS THAT IT DERIVES OWNERSHIP FROM LIVENESS, WHICH IS A FACT, NOT FROM A
//      DECLARATION, WHICH IS A CLAIM. A relinquish flag makes "the store is free" something the
//      broker SAYS rather than something the system can SEE — and a claim that can be stale,
//      mis-set or forged is exactly what a boundary must not rest on. Do not authenticate a release
//      you can instead observe.
//   2. THIS SEAM IS A BRIDGE TO BE RETIRED, and seam (b) — the destination — never transfers
//      ownership at all. A relinquish state would be new protocol infrastructure built to serve the
//      seam we intend to delete.
//   3. PRACTICALLY, the operator-initiated condition already requires the operator to be present:
//      someone who is there to stop the broker is there to start it again.
// WHAT THE RULING PRESERVES: acquisition still goes through `assessStoreOwnership` and still cannot
// succeed while the broker is alive, so the fail-closed condition holds BY CONSTRUCTION rather than
// by care. Nothing in the guard changes. And the RESTART is now a real requirement, not an implied
// one: a session that ends with no broker is worse than the pause problem it replaced — that
// obligation lives in the launch glue, not here.
//
// SCOPE: the seam only. NOT the launch glue (#3956), NOT the escape-sequence sanitizer (#3962),
// NOT seam (b), NOT Phase 3.
//
// Read-only except for the two contract files this module owns (`<db>.attach.json`).

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BROKER_HEARTBEAT_TIMEOUT_MS, assessStoreOwnership, pidAlive } from "../../storeownership.mjs";

/** The only surface allowed the unscreened path (lead's P-4 ruling). */
export const OPERATOR_SURFACE = "operator";

/** The attach contract's path: one file per store, beside the broker state. */
export function attachContractPath(dbPath) {
	return `${dbPath}.attach.json`;
}

/**
 * CONDITION 1 + P-4, in one predicate: is this surface allowed to pause the broker / take the
 * unscreened path? Only the operator's own terminal is. A SEAT MUST NOT BE ABLE TO PAUSE THE
 * BROKER IN ORDER TO ATTACH TO ITSELF, and the refusal names why.
 *
 * @returns {{allowed:boolean, reason:string|null}}
 */
export function operatorSurfaceVerdict(surface) {
	const s = typeof surface === "string" ? surface.trim().toLowerCase() : "";
	if (s === OPERATOR_SURFACE) return { allowed: true, reason: null };
	return {
		allowed: false,
		reason:
			`refused: this surface is ${s === "" ? "unspecified" : `'${s}'`}, not '${OPERATOR_SURFACE}'. ` +
			`Pausing the broker and taking its store are OPERATOR-ONLY (D113): a seat that could pause the ` +
			`broker in order to attach to its own store would be creating the second writer this guard ` +
			`exists to prevent, and the unscreened render path is the operator's terminal only.`,
	};
}

/**
 * T-1: RECORD THE RECOVERY CONTRACT BEFORE THE RELEASE.
 *
 * Called by the OPERATOR surface before it stops the broker. It records who is taking the window,
 * what is pending, and which pid is expected to appear — because a reaper without a recovery
 * contract GUESSES, and a reaper that guesses reaps the wrong thing.
 *
 * @returns {{ok:boolean, contract?:object, reason?:string}}
 */
export function beginOperatorWindow({ dbPath, surface, pausedBy = OPERATOR_SURFACE, tuiPid = null, now = Date.now() }) {
	const verdict = operatorSurfaceVerdict(surface);
	if (!verdict.allowed) return { ok: false, reason: verdict.reason };
	if (!dbPath) return { ok: false, reason: "refused: no store path was named" };
	const contract = {
		dbPath: resolve(dbPath),
		pausedBy: String(pausedBy),
		attachPending: true,
		tuiPid: typeof tuiPid === "number" ? tuiPid : null,
		at: new Date(now).toISOString(),
		atMs: now,
	};
	writeFileSync(attachContractPath(dbPath), `${JSON.stringify(contract, null, 2)}\n`);
	return { ok: true, contract };
}

/** Read the attach contract, or null when there is none / it is unreadable. */
export function readAttachContract(dbPath) {
	try {
		return JSON.parse(readFileSync(attachContractPath(dbPath), "utf8"));
	} catch {
		return null;
	}
}

/**
 * CONDITION 2: FAIL-CLOSED ACQUISITION. The TUI acquires the seat's store ONLY after the broker has
 * genuinely released it, and it does so by PASSING the storeownership probe like any second writer.
 *
 * If acquisition fails, THE ATTACH FAILS AND THE BROKER KEEPS WRITING — never the reverse. There is
 * no `--own` here on purpose: the old `--own` flag warned and then opened the store anyway, which is
 * two writers with a log line.
 *
 * @returns {{ok:boolean, reason?:string, contract?:object}}
 */
export function acquireSeatStore({ dbPath, surface, pid = process.pid, now = Date.now() }) {
	const verdict = operatorSurfaceVerdict(surface);
	if (!verdict.allowed) return { ok: false, reason: verdict.reason };
	if (!dbPath) return { ok: false, reason: "refused: no store path was named" };
	const ownership = assessStoreOwnership(dbPath, { now });
	if (ownership.owned) {
		return {
			ok: false,
			reason:
				`refused: ${dbPath} is still owned — ${ownership.reasons.join("; ")}. The broker keeps writing; ` +
				`the attach does not proceed. Stop the broker (serve --stop) and retry — a paused broker is still ` +
				`the owner, so a pause alone is not a release.`,
		};
	}
	const contract = readAttachContract(dbPath);
	if (!contract || contract.attachPending !== true) {
		return {
			ok: false,
			reason:
				`refused: no attach contract at ${attachContractPath(dbPath)}. The window must be RECORDED before ` +
				`the release (pausedBy / attachPending / expected pid), so a crash can be recovered from the ` +
				`record instead of guessed at.`,
		};
	}
	// Claim the contract: from here the contract names THIS pid, so a reaper can tell a live attach
	// from a crashed one.
	writeFileSync(
		attachContractPath(dbPath),
		`${JSON.stringify({ ...contract, attachPending: false, tuiPid: pid, attachedAt: new Date(now).toISOString() }, null, 2)}\n`,
	);
	return { ok: true, contract: readAttachContract(dbPath) };
}

/**
 * T-2: STALE-OWNERSHIP RECOVERY, bounded by the IMPLEMENTED heartbeat — a NUMBER, not a policy.
 *
 * A contract whose attach never completed and whose pid is gone (or whose recorded time is older
 * than BROKER_HEARTBEAT_TIMEOUT_MS) is STALE: the window is abandoned, and the legal move is to
 * re-acquire (or to let the broker resume). Anything else is a guess.
 *
 * @returns {{stale:boolean, reason:string|null, contract:object|null}}
 */
export function assessAttachContract(dbPath, { now = Date.now() } = {}) {
	const contract = readAttachContract(dbPath);
	if (!contract) return { stale: false, reason: null, contract: null };
	const age = typeof contract.atMs === "number" ? now - contract.atMs : Number.POSITIVE_INFINITY;
	if (contract.attachPending === true && age > BROKER_HEARTBEAT_TIMEOUT_MS) {
		return {
			stale: true,
			reason: `the attach never completed and the contract is ${Math.round(age / 1000)}s old (> ${BROKER_HEARTBEAT_TIMEOUT_MS / 1000}s heartbeat window)`,
			contract,
		};
	}
	if (typeof contract.tuiPid === "number" && !pidAlive(contract.tuiPid)) {
		return {
			stale: true,
			reason: `the attaching TUI (pid ${contract.tuiPid}) is gone and the contract still says ${contract.attachPending ? "pending" : "attached"}`,
			contract,
		};
	}
	return { stale: false, reason: null, contract };
}

/**
 * T-3: DEMOTE ON EXIT. The `--own` holder must ASSERT it owns and DEMOTE when it exits, and the
 * unpause that follows re-acquires THROUGH the guard rather than around it.
 *
 * Demotion only removes a contract that names THIS pid, so a stale reaper cannot clear a newer
 * attach's contract (the same discipline as `clearBrokerState(dbPath, pid)`).
 */
export function releaseSeatStore({ dbPath, pid = process.pid }) {
	const contract = readAttachContract(dbPath);
	if (!contract) return { released: false, reason: "no attach contract" };
	if (typeof contract.tuiPid === "number" && contract.tuiPid !== pid) {
		return { released: false, reason: `the contract names pid ${contract.tuiPid}, not ${pid}` };
	}
	try {
		unlinkSync(attachContractPath(dbPath));
		return { released: true, reason: null };
	} catch (err) {
		if (err?.code === "ENOENT") return { released: false, reason: "no attach contract" };
		throw err;
	}
}

/**
 * THE MISSING PIECE: resolve (seat, conversation) → the SEAT'S store + conversation id.
 *
 * `npm run tui` defaults to `session.sqlite` beside the entrypoint, which opens a FRESH store
 * rather than the seat's — that would look like a working attach and be a silent second store. The
 * resolution is part of the seam, not launch glue, so it lives here and REFUSES rather than
 * defaulting.
 *
 * @param {{rig:object, seat:string, conversationId:number|string|null, dbPath?:string}} input
 */
export function resolveSeatStore({ rig, seat, conversationId = null, dbPath = null } = {}) {
	const seats = rig?.seats ?? {};
	const entry = seats[seat];
	if (!entry) {
		return {
			ok: false,
			reason: `refused: no seat '${seat}' in the rig (known: ${Object.keys(seats).join(", ") || "none"})`,
		};
	}
	const wanted = conversationId ?? entry.conversationId ?? null;
	if (wanted === null || wanted === undefined) {
		return { ok: false, reason: `refused: seat '${seat}' has no recorded conversation, and none was named` };
	}
	const rigDb = dbPath ?? rig?.db ?? rig?.dbPath ?? null;
	if (!rigDb) {
		return {
			ok: false,
			reason:
				"refused: the rig names no store, and there is deliberately no default — the entrypoint's " +
				"`session.sqlite` default would open a FRESH store that looks like a working attach.",
		};
	}
	return { ok: true, dbPath: resolve(rigDb), conversationId: wanted };
}

/**
 * P-4, THE TESTABLE HALF: the unscreened render path is the OPERATOR'S TERMINAL ONLY.
 *
 * Assistant-output screening (#1803) does not gate this work — the exposure pre-exists the attach —
 * but "unscreened at the operator's own terminal; non-operator surfaces stay redacted" is a claim
 * with two halves, and this is the second one as a property rather than a sentence.
 */
export function unscreenedPathVerdict({ surface, redact = null } = {}) {
	const verdict = operatorSurfaceVerdict(surface);
	if (verdict.allowed) return { unscreened: true, redact: false, reason: null };
	return {
		unscreened: false,
		redact: true,
		reason:
			`refused the unscreened path: ${verdict.reason} A non-operator surface stays REDACTED ` +
			`(redact=${redact === null ? "true" : String(redact)}).`,
	};
}

/** Does a store currently look free to take? Convenience for the CLI and the demos. */
export function storeIsFree(dbPath, { now = Date.now() } = {}) {
	if (!dbPath || !existsSync(dirname(resolve(dbPath)))) return false;
	return !assessStoreOwnership(dbPath, { now }).owned;
}

/** Join helper for callers that build the contract path from a rig dir. */
export function contractBeside(dir, dbName = "selfdev.sqlite") {
	return attachContractPath(join(dir, dbName));
}
