// src/tui/durable/return.mjs — THE LANDING SCREEN'S RETURN PATH (#4089).
//
// The session half of the round trip is proven (#4071): a real `InteractiveMode` takes an injected
// `CapturingTerminal`, renders into it, accepts ctrl+^ on the input path, and stops the terminal on
// exit. What was missing is the thing that RUNS the session and comes back — the return path — which
// is what the operator's four remaining negatives are about:
//   (a) NO SHELL DROP — what comes back is the landing screen, not a prompt;
//   (b) RETURNS ON SEAT X — the selected seat survives the handoff;
//   (c) LIVE NOT FROZEN — needs a broker AND a poller (NOT asserted here, see below);
//   (e) SURVIVES A KILL — a killed child still restores the screen and releases ownership.
//
// EVERY EFFECT IS INJECTED. `spawn` (the child), `restartBroker` and `release` are parameters, so the
// return path can be driven headlessly with a fake child — no process, no TTY, no broker, no store.
// That is the only way (e) can be asserted at all: you cannot kill a child you did not spawn, and a
// test that spawns a real one is testing the OS rather than this code.
//
// THE ORDERING PROPERTY IS THE SEQUENCE, and this is the first place it is OBSERVED rather than
// asserted: RELEASE OWNERSHIP BEFORE RESTARTING THE BROKER. Restarting first would put two writers on
// one store for the width of the restart, which is the one thing the ownership guard exists to make
// impossible.
//
// SCOPE: the return path only. NOT the session harness (#4071), NOT the seam (#3954), NOT the decision
// layer (#4006), NOT the sanitizer coverage (#4009).

/**
 * Run one operator window: record → spawn the session as a CHILD in this terminal → wait → release →
 * restart → restore the landing screen ON THE SAME SEAT.
 *
 * @param {object} input
 * @param {string} input.seat — the seat the operator entered on; it MUST come back.
 * @param {(argv:string[]) => Promise<{code:number|null, signal:string|null, killed?:boolean}>} input.spawn
 *   Injected child runner. Resolves when the child exits — by exit code, by signal (a KILL), or not
 *   at all if the caller times it out.
 * @param {() => Promise<void>|void} input.release — release ownership (the seam's `releaseSeatStore`).
 * @param {() => Promise<void>|void} input.restartBroker — restart the broker AFTER the release.
 * @param {(event:object) => void} [input.onStep] — observer, so a demo can assert the ORDER.
 */
export async function runOperatorWindow({ seat, argv = [], spawn, release, restartBroker, onStep = () => {} }) {
	const steps = [];
	const step = (name, extra = {}) => {
		steps.push(name);
		onStep({ step: name, ...extra });
	};
	if (!seat) return { ok: false, reason: "refused: a window with no seat would return the operator to seat #1", steps };
	if (typeof spawn !== "function") return { ok: false, reason: "refused: no child runner was supplied", steps };
	if (typeof release !== "function" || typeof restartBroker !== "function") {
		return { ok: false, reason: "refused: the release and restart must both be supplied, in that order", steps };
	}

	step("spawn", { seat });
	const outcome = await spawn(argv);
	const killed = outcome?.signal != null || outcome?.killed === true;
	step("child-exit", { code: outcome?.code ?? null, signal: outcome?.signal ?? null, killed });

	// RELEASE BEFORE RESTART — the ordering property, observed here for the first time.
	step("release");
	await release();
	step("restart");
	await restartBroker();
	step("restore", { seat });

	return {
		ok: true,
		steps,
		killed,
		// (a) WHAT CAME BACK IS A SCREEN, not a prompt: the caller renders this, it does not fall
		// through to a shell. (b) the seat is carried back explicitly rather than defaulted.
		screen: { kind: "landing", seat, selectedSeat: seat, restored: true },
	};
}

/**
 * (e) THE KILL PATH, and why it is separate: a clean exit runs the sequence above, but a child that is
 * KILLED may never run its own cleanup — so the PARENT owes the release, the restart and the screen.
 * This is the half that leaves an operator stranded when it is missing.
 */
export async function recoverFromKilledChild({ seat, spawn, release, restartBroker, onStep = () => {} }) {
	const result = await runOperatorWindow({ seat, argv: [], spawn, release, restartBroker, onStep });
	if (!result.ok) return result;
	return {
		...result,
		// A kill is recovered the same way a clean exit is, which is the point: the operator does not
		// have to know which happened. The flag is reported so a caller CAN tell.
		recovered: result.killed === true,
	};
}

/**
 * (c) LIVENESS, decided but NOT driven here. A screen is live only when the broker is back AND the
 * poller is polling; the decision lives in launch.mjs (`assessReturn`), and what this module can say is
 * that the restore step has no way to FAKE it — a caller that cannot observe the poller must paint
 * NOT-LIVE rather than a stale frame.
 */
export function liveVerdictFor({ seat, brokerAlive, pollerAlive, releasedOwnership }) {
	if (!releasedOwnership) return { state: "not-live", seat, reason: "ownership was not released, so the broker cannot restart" };
	if (!brokerAlive) return { state: "not-live", seat, reason: "the broker did not come back" };
	if (!pollerAlive) return { state: "not-live", seat, reason: "the broker is up but the poller is not polling" };
	return { state: "live", seat, reason: null };
}
