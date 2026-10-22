// src/tui/durable/enter.mjs — THE CALLER: Enter on the landing screen runs the operator window (#4158).
//
// The seam (attach.mjs), the decision layer (launch.mjs) and the return path (return.mjs) are on main
// and were imported by DEMOS ONLY. `runOperatorWindow` already runs the window as a sequence —
// spawn -> child-exit -> RELEASE -> RESTART -> restore — with every effect INJECTED. This module
// supplies the REAL effects and the handler `ui.mjs` calls, which is the whole job: wiring, not design.
//
// WHY THE EFFECTS ARE STILL PARAMETERS: a demo must be able to assert the sequence without a broker, a
// store or a TTY. The DEFAULTS are the real ones, so `makeEnterHandler()` with no arguments is the
// production wiring and `makeEnterHandler({spawn, release, restartBroker})` is the test one. That is
// the difference between a stub that proves nothing and a seam that proves the wiring.
//
// THE STOP STEP (#4004) IS WIRED HERE, and its absence was the bug: `runOperatorWindow` spawned the
// WRITER while the broker still drove the store, so `tui.mjs` met the ownership guard and refused —
// the operator pressed Enter and got `refusing to open … a broker is driving it` instead of a session.
// `stopBrokerForStore` runs `serve --stop` and then CONFIRMS with the same probe the child uses, so
// "stopped" here means what fail-closed there means. Proven end to end against a real broker in
// .spike/opwin-e2e.mjs (kept out of the suite: it spawns processes).
//
// WHAT THIS CANNOT CLAIM, and it is named rather than implied: (c) LIVE NOT FROZEN needs a real broker
// AND a poller, and nothing here proves a poller polls. The DECISION is launch.mjs's `assessReturn`;
// the live assertion needs the operator's terminal.

import { spawn } from "node:child_process";
import { join } from "node:path";
import { OPERATOR_SURFACE, beginOperatorWindow, releaseSeatStore, resolveSeatStore } from "./attach.mjs";
import { assessStoreOwnership } from "../../storeownership.mjs";
import { runOperatorWindow } from "./return.mjs";

/** How long the window waits for a stopped broker to actually release the store. Bounded on purpose:
 * the ruling requires "stop and CONFIRM it exited", and a wait that never ends is a hang, not a
 * confirmation. */
export const STOP_SETTLE_MS = 5_000;

/**
 * STOP the broker and confirm the store is free (#4004). This is the step whose absence handed the
 * operator the ownership guard's refusal instead of a session: `runOperatorWindow` spawned `tui.mjs`
 * while the broker still drove the store, and `tui.mjs` correctly refused to be a second writer.
 *
 * `serve --stop` is the ruled way out (a pause is NOT a release). The confirmation is the SAME probe
 * the child will pass through — `assessStoreOwnership` — so "stopped" here means what failure-closed
 * there means, not a different opinion.
 */
export function stopBrokerForStore({ repo, dbPath, timeoutMs = STOP_SETTLE_MS }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [join(repo, "cli.mjs"), "serve", "--stop"], {
			cwd: repo,
			stdio: "ignore",
			env: { ...process.env, DURIG_DB: dbPath },
		});
		child.on("error", (err) => resolve({ ok: false, reason: `could not run serve --stop: ${String(err?.message ?? err)}` }));
		child.on("exit", () => {
			const deadline = Date.now() + timeoutMs;
			const settle = () => {
				const ownership = assessStoreOwnership(dbPath);
				if (!ownership.owned) return resolve({ ok: true, reason: null });
				if (Date.now() > deadline) {
					return resolve({
						ok: false,
						reason: `the broker still owns ${dbPath} after serve --stop: ${ownership.reasons.join("; ")}`,
					});
				}
				setTimeout(settle, 100);
			};
			settle();
		});
	});
}

/** The real session runner: the durable Pi TUI in THIS terminal, on the seat's store. */
export function spawnDurableSession({ repo, dbPath, seat, stdio = "inherit" }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [join(repo, "tui.mjs"), "--db", dbPath, "--select", seat], {
			cwd: repo,
			stdio,
			env: { ...process.env, DURIAN_PI_TUI_DB: dbPath },
		});
		child.on("exit", (code, signal) => resolve({ code: code ?? null, signal: signal ?? null }));
		child.on("error", (err) => resolve({ code: null, signal: null, error: String(err?.message ?? err) }));
	});
}

/** The real broker restart. The ruling moved this obligation here: a session that ends with no broker
 * is worse than the pause problem it replaced. Detached so the caller's terminal is free. */
export function restartBrokerDetached({ repo, dbPath }) {
	return new Promise((resolve) => {
		try {
			const child = spawn(process.execPath, [join(repo, "cli.mjs"), "serve", "--db", dbPath], {
				cwd: repo,
				detached: true,
				stdio: "ignore",
				env: { ...process.env, DURIG_DB: dbPath },
			});
			child.unref();
			resolve();
		} catch {
			resolve();
		}
	});
}

/**
 * The handler `ui.mjs` binds to Enter.
 *
 * @param {object} [options]
 * @param {(argv:object)=>Promise<{code:number|null, signal:string|null}>} [options.spawnSession]
 * @param {()=>void} [options.release]
 * @param {()=>void} [options.restartBroker]
 * @param {()=>void} [options.repaint] — the landing screen's own repaint/refresh
 * @param {object} [options.rig] — {db, seats} for (seat, conversation) -> store resolution
 * @param {string} [options.repo] — the repo root the entrypoints live in
 */
export function makeEnterHandler(options = {}) {
	const {
		rig = null,
		repo = process.cwd(),
		repaint = () => {},
		spawnSession = (argv) => spawnDurableSession({ repo, dbPath: argv.dbPath, seat: argv.seat }),
		stop = ({ dbPath }) => stopBrokerForStore({ repo, dbPath }),
		begin = ({ dbPath }) => beginOperatorWindow({ dbPath, surface: OPERATOR_SURFACE }),
		release = ({ dbPath }) => releaseSeatStore({ dbPath }),
		restartBroker = ({ dbPath }) => restartBrokerDetached({ repo, dbPath }),
	} = options;

	return async function onEnter({ seat, mode = "seats" } = {}) {
		// Enter is only meaningful on the landing screen; inside the conversation view it is a no-op
		// (Esc is the way back), which is the existing behaviour and stays.
		if (mode !== "seats") return { ran: false, reason: "not on the landing screen" };
		if (!seat) return { ran: false, reason: "no seat selected" };
		// THE MISSING PIECE from the seam item: (seat, conversation) -> THE SEAT'S store, refusing
		// rather than defaulting to a fresh session.sqlite.
		const resolved = resolveSeatStore({ rig, seat });
		if (!resolved.ok) return { ran: false, reason: resolved.reason };
		// RECORD BEFORE STOP (#4004): the contract is how a later reader learns the window was
		// deliberate, and it is released on every exit path below — including a refused stop.
		const began = begin({ dbPath: resolved.dbPath });
		if (began?.ok === false) return { ran: false, reason: began.reason };
		const result = await runOperatorWindow({
			seat,
			argv: { seat, dbPath: resolved.dbPath, conversationId: resolved.conversationId },
			stopBroker: () => stop({ dbPath: resolved.dbPath }),
			spawn: spawnSession,
			release: () => release({ dbPath: resolved.dbPath }),
			restartBroker: () => restartBroker({ dbPath: resolved.dbPath }),
		});
		// A refused window never opened the store, so the contract must not be left behind claiming a
		// pending attach that will never come. Releasing is the same call the exit path uses.
		if (result.ok === false) {
			release({ dbPath: resolved.dbPath });
			return { ran: false, reason: result.reason, refused: result.refused ?? null, steps: result.steps };
		}
		// (a) NO SHELL DROP: what comes back is the landing screen, and this repaint is what makes it
		// the screen rather than whatever the child left behind.
		repaint({ seat: result.screen?.selectedSeat ?? seat, live: false });
		return { ran: true, ...result, surface: OPERATOR_SURFACE };
	};
}
