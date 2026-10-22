// demo/tui-return-path.test.mjs — the landing screen's RETURN PATH (#4089): the four negatives that
// need the thing that RUNS the session and comes back.
//
// EVERY EFFECT IS INJECTED — a fake child, a fake release, a fake restart — so the return path is
// driven with no process, no TTY, no broker and no store. That is not a shortcut: (e) SURVIVES A KILL
// cannot be asserted any other way, because a test that spawns a real child is testing the OS rather
// than this code, and one that cannot kill the child cannot test the recovery.
//
// WHAT IS ASSERTED HERE, and each is one of the operator's named failures:
//   (a) NO SHELL DROP        — what comes back is a LANDING SCREEN object, not a prompt;
//   (b) RETURNS ON SEAT X    — the seat goes in and comes back, asserted on the returned screen;
//   (e) SURVIVES A KILL      — a child that exits BY SIGNAL still releases, restarts and restores;
//   ORDERING                 — RELEASE BEFORE RESTART, observed as a sequence rather than asserted.
//
// WHAT IS NOT, named in the output rather than omitted:
//   (c) LIVE NOT FROZEN      — needs a real broker AND a poller. The DECISION is tested (a stale
//                              frame must read NOT-LIVE), but nothing here proves a poller polls.
//
// Run: node demo/tui-return-path.test.mjs   (exit 0 = pass)

import { liveVerdictFor, recoverFromKilledChild, runOperatorWindow } from "../src/tui/durable/return.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

// A fake child runner: records the argv it was given and resolves with a chosen exit shape.
const fakeChild = (shape = { code: 0, signal: null }) => {
	const calls = [];
	const spawn = async (argv) => {
		calls.push(argv);
		return shape;
	};
	return { spawn, calls };
};

try {
	console.log("\n=== (a) NO SHELL DROP + (b) RETURNS ON SEAT X: a clean exit ===");
	{
		const child = fakeChild({ code: 0, signal: null });
		const order = [];
		const result = await runOperatorWindow({
			seat: "qa",
			argv: ["--select", "qa"],
			stopBroker: async () => ({ ok: true }),
			spawn: child.spawn,
			release: async () => order.push("release"),
			restartBroker: async () => order.push("restart"),
			onStep: (e) => order.push(e.step),
		});
		check("the window completed", result.ok === true, JSON.stringify(result.reason));
		check("(a) what came back is a LANDING SCREEN, not a prompt", result.screen?.kind === "landing", JSON.stringify(result.screen));
		check("(a) and it is marked restored", result.screen?.restored === true);
		check("(b) it came back ON SEAT X", result.screen?.selectedSeat === "qa", String(result.screen?.selectedSeat));
		check("(b) the seat was passed to the child explicitly", child.calls[0]?.join(" ").includes("--select qa"), JSON.stringify(child.calls[0]));
		check("not a kill", result.killed === false);

		console.log("\n    ORDERING: release BEFORE restart, observed as a sequence");
		check(
			"the observed order is stop -> spawn -> child-exit -> release -> restart -> restore",
			order.join(" > ") === "stop > spawn > child-exit > release > release > restart > restart > restore",
			order.join(" > "),
		);
		check("STOP comes BEFORE the child (the window owns the store before the session opens)", order.indexOf("stop") < order.indexOf("spawn"), order.join(" > "));
		check(
			"RELEASE comes BEFORE RESTART (two writers must be impossible at the last step)",
			order.indexOf("release") < order.indexOf("restart"),
			order.join(" > "),
		);
	}

	console.log("\n=== (e) SURVIVES A KILL: the child exits BY SIGNAL, the parent still recovers ===");
	{
		const child = fakeChild({ code: null, signal: "SIGKILL" });
		const order = [];
		const result = await recoverFromKilledChild({
			seat: "impl",
			stopBroker: async () => ({ ok: true }),
			spawn: child.spawn,
			release: async () => order.push("release"),
			restartBroker: async () => order.push("restart"),
			onStep: (e) => order.push(e.step),
		});
		check("the killed window is still recovered", result.ok === true, JSON.stringify(result.reason));
		check("the kill is DETECTED (signal, not exit code)", result.killed === true, JSON.stringify(result.steps));
		check("...and reported as recovered", result.recovered === true);
		check("(b) the killed session still returns ON SEAT X", result.screen?.selectedSeat === "impl", String(result.screen?.selectedSeat));
		check("(a) and still returns a SCREEN, not a shell", result.screen?.kind === "landing");
		check("ownership was still RELEASED after the kill (the parent owes it)", order.includes("release"), order.join(" > "));
		check("and the broker was still RESTARTED", order.includes("restart"), order.join(" > "));
		check("release still precedes restart on the kill path", order.indexOf("release") < order.indexOf("restart"), order.join(" > "));
	}

	console.log("\n=== REFUSALS: a window that would lose the seat or the order is refused, not guessed ===");
	{
		const child = fakeChild();
		const noSeat = await runOperatorWindow({ spawn: child.spawn, release: () => {}, restartBroker: () => {} });
		check("a window with NO SEAT is refused", noSeat.ok === false, JSON.stringify(noSeat.reason));
		check("...and says it would return the operator to seat #1", /seat #1/.test(noSeat.reason ?? ""), noSeat.reason);
		const noOrder = await runOperatorWindow({ seat: "qa", spawn: child.spawn, release: () => {} });
		check("a window with no RESTART is refused (the ordering needs both)", noOrder.ok === false, JSON.stringify(noOrder.reason));
		const noStop = await runOperatorWindow({ seat: "qa", spawn: child.spawn, release: () => {}, restartBroker: () => {} });
		check("a window with NO STOP is refused (it would hand the operator the guard's refusal)", noStop.ok === false, JSON.stringify(noStop.reason));
		check("...and says why: a session must not open a store the broker owns", /STOP|owns/.test(noStop.reason ?? ""), noStop.reason);
		const stoppedStillOwns = await runOperatorWindow({
			seat: "qa",
			spawn: child.spawn,
			stopBroker: async () => ({ ok: false, reason: "the broker still owns it (pid 9)" }),
			release: () => {},
			restartBroker: () => {},
		});
		check("a STOP that did not settle REFUSES the window", stoppedStillOwns.ok === false, JSON.stringify(stoppedStillOwns.reason));
		check("...and it did not spawn", child.calls.length === 0, JSON.stringify(child.calls));
		check("no child was spawned by a refused window", child.calls.length === 0, JSON.stringify(child.calls));
	}

	console.log("\n=== (c) LIVENESS: the DECISION is asserted; a poller polling is NOT ===");
	{
		check("broker + poller + released -> live", liveVerdictFor({ seat: "qa", brokerAlive: true, pollerAlive: true, releasedOwnership: true }).state === "live");
		check("no broker -> NOT-LIVE", liveVerdictFor({ seat: "qa", brokerAlive: false, pollerAlive: true, releasedOwnership: true }).state === "not-live");
		check("no poller -> NOT-LIVE (a frozen frame is not live)", liveVerdictFor({ seat: "qa", brokerAlive: true, pollerAlive: false, releasedOwnership: true }).state === "not-live");
		check("ownership not released -> NOT-LIVE regardless", liveVerdictFor({ seat: "qa", brokerAlive: true, pollerAlive: true, releasedOwnership: false }).state === "not-live");
	}

	console.log("\n=== UNASSERTED, named rather than omitted ===");
	console.log("  (c) LIVE NOT FROZEN — needs a REAL broker and a poller to observe; nothing here proves a poller polls.");
	console.log("      The decision is tested above, and that is the most a fake child can honestly reach.");

	console.log(
		failures === 0
			? "\nPASS — the return path restores a landing screen on seat X, survives a kill, and releases before restarting"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
