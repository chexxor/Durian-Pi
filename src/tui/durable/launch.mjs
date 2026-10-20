// src/tui/durable/launch.mjs — the LAUNCH AND RETURN GLUE for the operator window (#4006).
//
// Seam (a) is a BRIDGE: Enter on a seat STOPS the broker, the durable TUI takes that seat's store
// and conversation, the Pi session renders IN THE SAME TERMINAL, and on exit the terminal is
// restored, ownership released, the broker restarted, and the landing screen returns ON THAT SEAT
// and LIVE. This module is the glue's DECISION layer — every rule that can be decided without a
// terminal lives here so it can be tested headlessly; the actual spawn/exec is the entrypoint's.
//
// THE SEQUENCE IS STOP-AND-RESTART, RULED (#4004), and the ORDER is the safety property:
//   record the contract -> STOP the broker -> acquire THROUGH the guard -> session
//   -> RELEASE ownership -> RESTART the broker
// A paused broker has NOT released the store (`applyPauseOp` sets a rig flag; the process lives and
// its heartbeat stays fresh), so pause is not release. And release MUST precede restart: restarting
// while the TUI still holds the contract puts two writers on one store, which is the one thing the
// guard exists to make impossible. `planOperatorWindow` returns that order as DATA so a demo can
// assert it rather than trusting a comment.
//
// THE EXIT KEY IS READ FROM THE TERMINAL INPUT PATH, NEVER INFERRED FROM SESSION CONTENT: a return
// triggered by something the session PRINTED would make model output a control channel. Ctrl-C and
// Esc are REJECTED by construction — quit muscle memory, and a bound key that sometimes exits is
// worse than one that never does.
//
// SCOPE: launch and return glue only. NOT the seam module (#3954), NOT seam (b) (#3975), NOT the
// sanitizer (#3962), NOT Phase 3.

import { OPERATOR_SURFACE, assessAttachContract, releaseSeatStore } from "./attach.mjs";

/** The exit-key preference order (lead's ruling). Ctrl-C and Esc are not candidates, ever. */
export const EXIT_KEY_CANDIDATES = ["ctrl+]", "ctrl+^", "ctrl+\\"];

/** Keys that must NEVER be chosen, with the reason attached so a future reader does not "improve" it. */
export const EXIT_KEY_REJECTED = {
	"ctrl+c": "quit muscle memory: the operator reaches for it reflexively, including mid-prompt",
	esc: "a bound key that sometimes exits (dialog dismiss) is worse than one that never does",
};

/**
 * Choose the exit affordance, SUBJECT TO A COLLISION CHECK against the session's own bindings.
 *
 * `bindings` is the result of `sessionBindingsFrom` (#4048), or a plain array for a caller that
 * already knows the set. THE DIFFERENCE BETWEEN "NO BINDINGS" AND "BINDINGS UNKNOWN" IS EXPLICIT
 * HERE AND MUST STAY SO: an array — including an empty one — is a KNOWN set; anything else (missing
 * argument, `null`, a `{known:false}` result) is UNKNOWN and lands on the two-key fallback, because
 * an unknown set must never read as an empty one.
 *
 * @param {string[]|{known:boolean, keys:string[], reason:string|null}|undefined|null} bindings
 * @returns {{key:string|null, tried:string[], rejected:boolean, unknown?:boolean, reason:string}}
 */
export function resolveExitKey(bindings) {
	const isArray = Array.isArray(bindings);
	const known = isArray ? true : bindings?.known === true;
	const list = isArray ? bindings : (bindings?.keys ?? []);
	if (!known) {
		const why = isArray ? null : (bindings?.reason ?? "no bindings were supplied");
		return {
			key: null,
			tried: [],
			rejected: true,
			unknown: true,
			reason:
				`refused: the session's bindings are UNKNOWN (${why}), so NO candidate can be confirmed free. ` +
				`An unknown binding set must not be read as an empty one — that would make ${EXIT_KEY_CANDIDATES[0]} look ` +
				`free, and it is already bound (tui.editor.jumpForward). Use the documented TWO-KEY sequence.`,
		};
	}
	const taken = new Set(list.map((b) => String(b).toLowerCase()));
	const tried = [];
	for (const candidate of EXIT_KEY_CANDIDATES) {
		tried.push(candidate);
		if (Object.prototype.hasOwnProperty.call(EXIT_KEY_REJECTED, candidate)) continue;
		if (!taken.has(candidate)) {
			return { key: candidate, tried, rejected: false, unknown: false, reason: null };
		}
	}
	return {
		key: null,
		tried,
		rejected: true,
		unknown: false,
		reason:
			`refused: every candidate exit key is already bound in this session (${tried.join(", ")}). ` +
			`Do NOT fall back to Ctrl-C or Esc — ${EXIT_KEY_REJECTED["ctrl+c"]}; ${EXIT_KEY_REJECTED.esc}. ` +
			`Document a two-key sequence instead of "quit and relaunch".`,
	};
}

/**
 * THE SESSION'S ACTUAL BINDINGS, read from the library that owns them (#4021), and the state of
 * NOT KNOWING them is its own value (#4048).
 *
 * `resolveExitKey` can only do the collision check from what it is TOLD, and a hardcoded list is the
 * one thing the ruling forbids: a key the session already uses is a key that does not work. pi-tui
 * exports `getKeybindings()`, whose `getResolvedBindings()` maps each action to the key(s) bound to
 * it, so the real set is available without guessing.
 *
 * MEASURED against pi-tui's defaults: `ctrl+]` is ALREADY BOUND (to `tui.editor.jumpForward`), so the
 * ruling's first choice collides on a real session and the ladder correctly falls to `ctrl+^`.
 * `ctrl+^` and `ctrl+\` are free today.
 *
 * THE DEGRADE IS `UNKNOWN`, NOT EMPTY — and that is the whole correction in #4048. An empty list
 * makes EVERY key look free, so the ladder picks the first candidate, which is the one key we know is
 * taken; a broken manager would then produce exactly the outcome the collision check exists to
 * prevent, with no crash to explain it. So a source that is missing, throws, or answers nothing
 * returns `{known: false, reason}`, and the ladder turns that into the two-key fallback, which cannot
 * collide by construction. The no-throw property is kept: availability is not the thing to trade
 * away — only what the ABSENCE means.
 *
 * Takes the manager as an argument so a demo can inject a fake one.
 *
 * @returns {{known:boolean, keys:string[], reason:string|null}}
 */
export function sessionBindingsFrom(getKeybindings) {
	const unknown = (reason) => ({ known: false, keys: [], reason });
	if (typeof getKeybindings !== "function") return unknown("no keybinding source was supplied");
	let resolved;
	try {
		resolved = getKeybindings()?.getResolvedBindings?.();
	} catch (err) {
		return unknown(`the keybinding source threw: ${err?.message ?? err}`);
	}
	if (!resolved || typeof resolved !== "object") {
		return unknown("the keybinding source returned no resolved bindings");
	}
	const keys = new Set();
	for (const value of Object.values(resolved)) {
		if (Array.isArray(value)) for (const key of value) keys.add(String(key).toLowerCase());
		else if (typeof value === "string" && value !== "") keys.add(value.toLowerCase());
	}
	return { known: true, keys: [...keys], reason: null };
}

/** The footer line the landing screen shows BEFORE entering (the key is documented on the way in). */
export function enterHintFor(seat, key) {
	const k = key ?? "(no free exit key — see the two-key sequence)";
	return `  Enter on ${seat} opens its session in this terminal · ${k} returns`;
}

/** The chrome line the SESSION shows WHILE inside (documented in both places, per the ruling). */
export function sessionChromeFor(seat, key) {
	const k = key ?? "(no free exit key — see the two-key sequence)";
	return `─ ${seat} · this terminal · ${k} returns to the landing screen ─`;
}

/**
 * THE ORDER IS THE SAFETY PROPERTY. Returns the window's steps as data: a demo asserts the order,
 * and the entrypoint walks the same array rather than re-deriving it.
 */
export function planOperatorWindow({ seat, conversationId, dbPath, tuiPid = null }) {
	return [
		{ step: "record-contract", seat, dbPath, why: "T-1: a reaper without a recorded contract guesses" },
		{ step: "stop-broker", why: "a paused broker has NOT released the store; only a dead process has" },
		{ step: "acquire", seat, dbPath, conversationId, tuiPid, why: "THROUGH assessStoreOwnership — the guard is the test" },
		{ step: "session", seat, conversationId, why: "the Pi session renders in the same terminal" },
		{ step: "release", dbPath, tuiPid, why: "release BEFORE restart: two writers must be impossible" },
		{ step: "restart-broker", why: "the restart is a requirement, not an implied step" },
	];
}

/**
 * THE HANDOFF IS WHERE THIS BREAKS IF IT BREAKS (lead): an exec that loses the seat returns the
 * operator to seat #1 — and only sometimes. So the selection travels EXPLICITLY and is asserted on
 * both sides of the boundary.
 */
export function buildHandoff({ seat, conversationId, dbPath, exitKey }) {
	if (!seat) return { ok: false, reason: "refused: a handoff with no seat would return the operator to seat #1" };
	if (!dbPath) return { ok: false, reason: "refused: a handoff with no store would open a fresh one" };
	return {
		ok: true,
		handoff: { seat, conversationId: conversationId ?? null, dbPath, exitKey: exitKey ?? null, argv: ["--select", seat, "--db", dbPath] },
	};
}

/** The other half of the handoff: the seat that came back must be the seat that went in. */
export function assertHandoffPreservesSeat(before, after) {
	if (!after || !after.seat) {
		return { ok: false, reason: `refused: the return lost the selection entirely (went in on ${before?.seat})` };
	}
	if (after.seat !== before?.seat) {
		return { ok: false, reason: `refused: went in on ${before?.seat} and came back on ${after.seat}` };
	}
	return { ok: true, reason: null };
}

/**
 * THE RETURN STATE. A screen that is not live must SAY SO — never a stale snapshot painted as
 * current. `pollerAlive` and `brokerAlive` are facts the caller measures; this decides the label.
 */
export function assessReturn({ seat, brokerAlive, pollerAlive, releasedOwnership }) {
	if (!releasedOwnership) {
		return {
			state: "not-live",
			seat,
			label: "NOT LIVE · ownership was not released — the broker cannot restart until it is",
			reason: "release-before-restart violated",
		};
	}
	if (!brokerAlive) {
		return {
			state: "not-live",
			seat,
			label: "NOT LIVE · the broker did not come back — this screen is NOT updating",
			reason: "broker absent after the window",
		};
	}
	if (!pollerAlive) {
		return {
			state: "not-live",
			seat,
			label: "NOT LIVE · the broker is up but the poller is not running — this screen is NOT updating",
			reason: "poller absent",
		};
	}
	return { state: "live", seat, label: `live · ${seat}`, reason: null };
}

/**
 * THE REAPER IS TWO-SIDED: release a dead owner's hold AND restore the screen state (the seat that
 * must come back selected). T-1's contract is what makes a KILLED session recoverable.
 */
export function reapAbandonedWindow({ dbPath, now = Date.now(), pid = null }) {
	const assessed = assessAttachContract(dbPath, { now });
	if (!assessed.contract) return { reaped: false, seat: null, reason: "no contract — nothing to recover" };
	if (!assessed.stale) return { reaped: false, seat: null, reason: "the window is still live; leave it alone" };
	const released = releaseSeatStore({ dbPath, pid: pid ?? assessed.contract.tuiPid ?? process.pid });
	return {
		reaped: true,
		seat: assessed.contract.seat ?? null,
		released: released.released === true,
		// The screen half: the operator must land back ON the seat the window was opened for.
		restore: { selectSeat: assessed.contract.seat ?? null, state: "not-live-until-restart" },
		reason: assessed.reason,
	};
}

/**
 * THE `--own` REPLACEMENT. tui.mjs used to WARN and then open a store the broker still owned — the
 * F24/D42 two-writer collision with a log line. This decides, and the entrypoint EXITS on refusal.
 * There is no override: the guard is the test, not the obstacle.
 */
export function decideOpen({ dbPath, surface = OPERATOR_SURFACE, pid = process.pid, acquire }) {
	if (typeof acquire !== "function") return { open: false, reason: "refused: no acquisition function was supplied" };
	const result = acquire({ dbPath, surface, pid });
	if (!result?.ok) return { open: false, reason: result?.reason ?? "refused: acquisition failed" };
	return { open: true, reason: null, contract: result.contract ?? null };
}
