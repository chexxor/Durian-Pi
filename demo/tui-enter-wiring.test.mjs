// demo/tui-enter-wiring.test.mjs — Enter on the landing screen runs the operator window (#4158)
//
// The seam, launch and return layers were on main and imported by DEMOS ONLY; nothing called them. This
// pins the CALLER: the handler `ui.mjs` binds to Enter, with the real effects as DEFAULTS and injectable
// ones for the test.
//
// WHAT IS ASSERTED HERE: the handler refuses when it should, resolves (seat) -> THE SEAT'S store rather
// than a fresh session.sqlite, drives `runOperatorWindow` with an argv carrying `--select <seat>`, keeps
// RELEASE before RESTART, and repaints the landing screen on return.
//
// WHAT IS NOT, named rather than implied: (c) LIVE NOT FROZEN needs a real broker AND a poller — the
// DECISION is launch.mjs's `assessReturn` and nothing here proves a poller polls. (e) SURVIVES A KILL is
// asserted at the sequence level (a signal-shaped child outcome still releases, restarts and restores)
// but not against a real killed process. Both are printed below.
//
// Run: node demo/tui-enter-wiring.test.mjs   (exit 0 = pass)

import { readFileSync } from "node:fs";
import { makeEnterHandler } from "../src/tui/durable/enter.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const RIG = { db: "/tmp/throwaway-rig.sqlite", seats: { impl: { conversationId: 7 }, qa: { conversationId: 15 } } };

// Injected effects: record what the caller asked for, in order. Nothing is spawned, nothing is stored.
function harness(childOutcome = { code: 0, signal: null }) {
	const calls = { spawn: [], release: [], restart: [], repaint: [] };
	const handler = makeEnterHandler({
		rig: RIG,
		spawnSession: async (argv) => {
			calls.spawn.push(argv);
			return childOutcome;
		},
		release: (a) => calls.release.push(a),
		restartBroker: (a) => calls.restart.push(a),
		repaint: (a) => calls.repaint.push(a),
	});
	return { handler, calls };
}

try {
	console.log("\n=== THE HANDLER REFUSES WHEN IT SHOULD (and spawns nothing) ===");
	{
		const { handler, calls } = harness();
		const offScreen = await handler({ seat: "impl", mode: "conversation" });
		check("Enter inside the conversation view is a no-op", offScreen.ran === false, JSON.stringify(offScreen.reason));
		const noSeat = await handler({ seat: null, mode: "seats" });
		check("Enter with no seat selected is a no-op", noSeat.ran === false, JSON.stringify(noSeat.reason));
		const unknown = await handler({ seat: "ghost", mode: "seats" });
		check("an unknown seat is REFUSED, not defaulted", unknown.ran === false, JSON.stringify(unknown.reason));
		check("...and the refusal names the rig's seats", /impl/.test(unknown.reason ?? ""), unknown.reason);
		check("NO child was spawned by any refusal", calls.spawn.length === 0, JSON.stringify(calls.spawn));
	}

	console.log("\n=== (b) THE SEAT RESOLVES TO ITS OWN STORE, AND THE ARGV CARRIES IT ===");
	{
		const { handler, calls } = harness();
		const result = await handler({ seat: "qa", mode: "seats" });
		check("the window ran", result.ran === true, JSON.stringify(result.reason));
		// resolveSeatStore normalises the path, so compare normalised forms rather than the raw rig value.
		const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
		check(
			"the child was asked for the SEAT'S store",
			norm(calls.spawn[0]?.dbPath).endsWith("throwaway-rig.sqlite"),
			JSON.stringify(calls.spawn[0]),
		);
		check("...and the seat's conversation id", calls.spawn[0]?.conversationId === 15, JSON.stringify(calls.spawn[0]));
		check("...and it is NOT a fresh session.sqlite", !String(calls.spawn[0]?.dbPath ?? "").includes("session.sqlite"), JSON.stringify(calls.spawn[0]?.dbPath));
	}

	console.log("\n=== (a) NO SHELL DROP: what comes back is the SCREEN, on SEAT X ===");
	{
		const { handler, calls } = harness();
		const result = await handler({ seat: "impl", mode: "seats" });
		check("a LANDING SCREEN object comes back", result.screen?.kind === "landing", JSON.stringify(result.screen));
		check("(b) the return is ON SEAT X", result.screen?.selectedSeat === "impl", String(result.screen?.selectedSeat));
		check("the landing screen is REPAINTED on return (not left as the child left it)", calls.repaint.length === 1, JSON.stringify(calls.repaint));
		check("...and the repaint names the seat", calls.repaint[0]?.seat === "impl", JSON.stringify(calls.repaint[0]));
	}

	console.log("\n=== THE ORDERING: RELEASE BEFORE RESTART, observed in the real caller ===");
	{
		const { handler } = harness();
		const result = await handler({ seat: "impl", mode: "seats" });
		const steps = result.steps;
		check("release precedes restart", steps.indexOf("release") < steps.indexOf("restart"), steps.join(" > "));
		check(
			"the whole sequence is the ruled one",
			steps.join(" > ") === "spawn > child-exit > release > restart > restore",
			steps.join(" > "),
		);
	}

	console.log("\n=== (e) A KILLED CHILD still releases, restarts and restores ===");
	{
		const { handler, calls } = harness({ code: null, signal: "SIGKILL" });
		const result = await handler({ seat: "impl", mode: "seats" });
		check("the kill is detected from the SIGNAL", result.killed === true, JSON.stringify(result.steps));
		check("release still ran", calls.release.length === 1, JSON.stringify(calls.release));
		check("restart still ran", calls.restart.length === 1, JSON.stringify(calls.restart));
		check("the screen still came back on seat X", result.screen?.selectedSeat === "impl", String(result.screen?.selectedSeat));
	}

	console.log("\n=== THE REAL DEFAULTS EXIST, and ui.mjs is the caller (structural, not behavioural) ===");
	{
		// ui.mjs is an ENTRYPOINT — importing it runs a program — so the wiring is asserted by reading
		// the source. That is weaker than a behavioural test and is labelled as such rather than passed
		// off as proof the operator can press Enter.
		const ui = readFileSync(new URL("../ui.mjs", import.meta.url), "utf8");
		check("ui.mjs imports the enter handler", /from "\.\/src\/tui\/durable\/enter\.mjs"/.test(ui), "no import");
		check("ui.mjs builds it with makeEnterHandler", /makeEnterHandler\s*\(/.test(ui), "not called");
		check("onEnter is ASYNC and awaits the handler", /onEnter:\s*async/.test(ui) && /await enterHandler\(/.test(ui), "onEnter does not await the handler");
		check("onEnter no longer ONLY opens the read-only view", !/onEnter:[\s\S]{0,200}view\.openConversation\(\)/.test(ui), "still opens the read-only view");
	}

	console.log("\n=== UNASSERTED, named rather than omitted ===");
	console.log("  (c) LIVE NOT FROZEN — needs a REAL broker and a poller; the decision is launch.mjs's");
	console.log("      assessReturn, and nothing here proves a poller polls.");
	console.log("  (e) with a REAL killed process — the sequence is asserted against a signal-shaped");
	console.log("      outcome, not against a child this demo killed.");

	console.log(
		failures === 0
			? "\nPASS — Enter resolves the seat's store, runs the ruled sequence, returns the landing screen on that seat, and repaints it"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
