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
// AND THE SECOND FAILURE, which only a real run could show: `serve --stop` answering "no broker is
// running" is NOT proof the store is free — a previous window restarts the broker DETACHED, and for a
// moment there is no state file while that process is opening the store. The child then died with
// `database is locked`. So the stop step REPEATS and confirms with a real WRITER OPEN (probeWritable),
// and the poller pauses for the window (src/tui/driver.mjs pause/resume) so no read is in flight while
// a writer takes the file. Proven in .spike/opwin-e2e2.mjs (the restart race).
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
 * confirmation.
 *
 * 30 s, not 5: `serve --stop` gives the broker a 5 s grace PER CALL, and a broker with a seat
 * generation in flight needs several (a pass is a model call, not a tick). The attempts repeat, so
 * this budget is what decides whether a BUSY rig gets stopped or the operator gets an honest refusal
 * naming the seats that are still running. */
export const STOP_SETTLE_MS = 30_000;

/** The settle budget, overridable for an operator who would rather WAIT than retry:
 * `DURIG_WINDOW_SETTLE_MS=180000 npm run ui`. A bad value falls back to the default rather than
 * removing the bound. */
export function settleBudgetMs() {
	const n = Number(process.env.DURIG_WINDOW_SETTLE_MS);
	return Number.isFinite(n) && n > 0 ? n : STOP_SETTLE_MS;
}

/**
 * STOP the broker and confirm the store is free (#4004). This is the step whose absence handed the
 * operator the ownership guard's refusal instead of a session: `runOperatorWindow` spawned `tui.mjs`
 * while the broker still drove the store, and `tui.mjs` correctly refused to be a second writer.
 *
 * `serve --stop` is the ruled way out (a pause is NOT a release). The confirmation is the SAME probe
 * the child will pass through — `assessStoreOwnership` — so "stopped" here means what failure-closed
 * there means, not a different opinion.
 */
export function stopBrokerForStore({ repo, dbPath, timeoutMs = settleBudgetMs() }) {
	return new Promise((resolve) => {
		const deadline = Date.now() + timeoutMs;
		// ONE ATTEMPT = ask the broker to stop, then confirm with a WRITER OPEN.
		//
		// The attempt REPEATS because a previous window restarts the broker DETACHED: for a moment
		// after that restart there is no state file, so `serve --stop` answers "no broker is running"
		// while the new process is already opening the store. A single stop + ownership check reads
		// that moment as free and the child then dies with `database is locked`. Asking again is what
		// closes the window, and the writer probe is what makes the answer mean "a session can open".
		const attempt = () => {
			const child = spawn(process.execPath, [join(repo, "cli.mjs"), "serve", "--stop"], {
				cwd: repo,
				stdio: "ignore",
				env: { ...process.env, DURIG_DB: dbPath },
			});
			child.on("error", (err) => resolve({ ok: false, reason: `could not run serve --stop: ${String(err?.message ?? err)}` }));
			child.on("exit", () => {
				void confirm();
			});
		};
		const confirm = async () => {
			const ownership = assessStoreOwnership(dbPath);
			const probe = ownership.owned
				? { ok: false, reason: `a broker owns it: ${ownership.reasons.join("; ")}` }
				: await probeWritable(dbPath);
			if (probe.ok) return resolve({ ok: true, reason: null });
			if (Date.now() > deadline) {
				return resolve({ ok: false, reason: `the store is still held by a writer: ${probe.reason}` });
			}
			setTimeout(attempt, 150);
		};
		attempt();
	});
}

/**
 * Can a WRITER open this store right now? Open + close the same durable storage the child opens,
 * with a short busy timeout so a transient lock is retried rather than misread. Read-only: it creates
 * nothing a healthy store does not already have (the WAL/pragma path runs on every open).
 */
async function probeWritable(dbPath, { busyTimeoutMs = 1_000 } = {}) {
	try {
		const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
		const storage = await openNodeSqliteStorage(dbPath, { busyTimeoutMs });
		await storage.close();
		return { ok: true, reason: null };
	} catch (err) {
		return { ok: false, reason: String(err?.message ?? err) };
	}
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
