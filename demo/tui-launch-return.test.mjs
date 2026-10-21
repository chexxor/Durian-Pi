// demo/tui-launch-return.test.mjs — LAUNCH AND RETURN GLUE (#4006): the round trip, its order, its
// exit key, its handoff and its NOT-LIVE state.
//
// WHAT THIS CAN AND CANNOT TEST, stated first because the difference matters: everything here is the
// glue's DECISION layer (src/tui/durable/launch.mjs) — order, key choice, handoff, return state,
// reaper, and the `--own` replacement — all of which is decidable WITHOUT a terminal. The live round
// trip (Enter → session renders → Ctrl-] → repaint) needs a TTY and a broker and is NOT claimed by
// this demo.
//
// FAILING-FIRST: before this glue existed none of it was expressible. `tui.mjs` WARNED and then
// opened a store the broker still owned (two writers with a log line), there was no exit key at all,
// no handoff, and no return state to be wrong about.
//
// Run: node demo/tui-launch-return.test.mjs   (exit 0 = pass)

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EXIT_KEY_CANDIDATES,
	assessReturn,
	assertHandoffPreservesSeat,
	buildHandoff,
	decideOpen,
	enterHintFor,
	planOperatorWindow,
	reapAbandonedWindow,
	resolveExitKey,
	sessionChromeFor,
} from "../src/tui/durable/launch.mjs";
import { acquireSeatStore, beginOperatorWindow } from "../src/tui/durable/attach.mjs";
import { brokerStatePath } from "../src/storeownership.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
const writeBrokerState = (dbPath, pid) =>
	writeFileSync(
		brokerStatePath(dbPath),
		JSON.stringify({ pid, since: new Date().toISOString(), runToken: "demo", heartbeatAt: Date.now(), lastPassAt: Date.now() }),
	);

const base = await mkdtemp(join(tmpdir(), "durig-launch-"));
const db = join(base, "selfdev.sqlite");
await writeFile(db, "");

try {
	console.log("\n=== (vi) THE EXIT KEY: lead's order, the collision check, and the two rejections ===");
	{
		const free = resolveExitKey([]);
		check("with no collisions the key is Ctrl-]", free.key === "ctrl+]", JSON.stringify(free));
		const second = resolveExitKey(["ctrl+]"]);
		check("Ctrl-] taken -> Ctrl-^", second.key === "ctrl+^", JSON.stringify(second));
		const third = resolveExitKey(["ctrl+]", "ctrl+^"]);
		check("both taken -> Ctrl-\\", third.key === "ctrl+\\", JSON.stringify(third));
		const none = resolveExitKey([...EXIT_KEY_CANDIDATES]);
		check("all three taken -> NO key, and a refusal rather than a silent default", none.key === null, JSON.stringify(none));
		check("...naming the two-key-sequence fallback, not 'quit and relaunch'", /two-key sequence/.test(none.reason ?? ""), none.reason);
		check("Ctrl-C is never a candidate", !EXIT_KEY_CANDIDATES.includes("ctrl+c"));
		check("Esc is never a candidate", !EXIT_KEY_CANDIDATES.includes("esc"));
		check("the refusal explains WHY Ctrl-C is out (muscle memory)", /muscle memory/.test(none.reason ?? ""), none.reason);
		check("the refusal explains WHY Esc is out (sometimes-exits is worse)", /sometimes exits/.test(none.reason ?? ""), none.reason);
	}
	{
		const footer = enterHintFor("impl", "ctrl+]");
		const chrome = sessionChromeFor("impl", "ctrl+]");
		check("documented BEFORE entering (landing footer)", /ctrl\+\] returns/.test(footer), footer);
		check("documented WHILE inside (session chrome)", /ctrl\+\] returns/.test(chrome), chrome);
		check("both name the seat", footer.includes("impl") && chrome.includes("impl"));
	}

	console.log("\n=== THE SEQUENCE IS STOP-AND-RESTART, AND THE ORDER IS THE SAFETY PROPERTY ===");
	{
		const plan = planOperatorWindow({ seat: "impl", conversationId: 7, dbPath: db, tuiPid: 1234 });
		const steps = plan.map((s) => s.step);
		check("the steps are the ruled sequence", steps.join(" -> ") === "record-contract -> stop-broker -> acquire -> session -> release -> restart-broker", steps.join(" -> "));
		check(
			"RELEASE comes BEFORE RESTART (restarting while the TUI holds the contract is two writers)",
			steps.indexOf("release") < steps.indexOf("restart-broker"),
			steps.join(" -> "),
		);
		check("the contract is recorded BEFORE the broker stops", steps.indexOf("record-contract") < steps.indexOf("stop-broker"));
		check("acquisition comes AFTER the stop (a live broker cannot be acquired)", steps.indexOf("stop-broker") < steps.indexOf("acquire"));
		check("there is no 'pause' step anywhere — pause is not release", !steps.some((s) => /pause/i.test(s)), steps.join(" -> "));
		check("the plan carries the seat through every step that needs it", plan.filter((s) => "seat" in s).every((s) => s.seat === "impl"));
	}

	console.log("\n=== (iv) THE SEAT CONTEXT SURVIVES THE HANDOFF — its own demo, because that is where it breaks ===");
	{
		const built = buildHandoff({ seat: "qa", conversationId: 15, dbPath: db, exitKey: "ctrl+]" });
		check("the handoff is built", built.ok === true, JSON.stringify(built));
		check("it names the seat EXPLICITLY in argv", built.handoff.argv.join(" ").includes("--select qa"), built.handoff.argv.join(" "));
		check("it names the store explicitly", built.handoff.argv.join(" ").includes(db), built.handoff.argv.join(" "));
		check("a handoff with no seat is REFUSED", buildHandoff({ dbPath: db }).ok === false);
		check("...because it would return the operator to seat #1", /seat #1/.test(buildHandoff({ dbPath: db }).reason ?? ""));
		check("the same seat coming back passes", assertHandoffPreservesSeat({ seat: "qa" }, { seat: "qa" }).ok === true);
		const wrong = assertHandoffPreservesSeat({ seat: "qa" }, { seat: "impl" });
		check("a DIFFERENT seat coming back is caught, naming both", wrong.ok === false && /qa/.test(wrong.reason) && /impl/.test(wrong.reason), wrong.reason);
		check("a return with no selection is caught", assertHandoffPreservesSeat({ seat: "qa" }, {}).ok === false);
	}

	console.log("\n=== (i)/(iii) THE RETURN STATE: live, or explicitly NOT-LIVE — never a stale snapshot ===");
	{
		const live = assessReturn({ seat: "impl", brokerAlive: true, pollerAlive: true, releasedOwnership: true });
		check("broker + poller alive -> LIVE", live.state === "live", JSON.stringify(live));
		check("...and the label names the seat (focus returns there)", live.label.includes("impl"), live.label);

		const noBroker = assessReturn({ seat: "impl", brokerAlive: false, pollerAlive: true, releasedOwnership: true });
		check("broker absent -> NOT-LIVE", noBroker.state === "not-live", JSON.stringify(noBroker));
		check("...and says the screen is NOT updating", /NOT updating/.test(noBroker.label), noBroker.label);

		const noPoller = assessReturn({ seat: "impl", brokerAlive: true, pollerAlive: false, releasedOwnership: true });
		check("broker up but poller dead -> NOT-LIVE too (a frozen frame is not live)", noPoller.state === "not-live", JSON.stringify(noPoller));
		check("...and names the poller as the reason", /poller/.test(noPoller.label), noPoller.label);

		const leaked = assessReturn({ seat: "impl", brokerAlive: true, pollerAlive: true, releasedOwnership: false });
		check("ownership NOT released -> NOT-LIVE regardless of liveness", leaked.state === "not-live", JSON.stringify(leaked));
		check("...and says the broker cannot restart until it is", /cannot restart/.test(leaked.label), leaked.label);
	}

	console.log("\n=== (ii) THE REAPER IS TWO-SIDED: release the dead owner's hold AND restore the screen ===");
	{
		writeBrokerState(db, 999_999);
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: 999_998 });
		const reaped = reapAbandonedWindow({ dbPath: db, now: Date.now() });
		check("an abandoned window is reaped", reaped.reaped === true, JSON.stringify(reaped));
		check("it released the dead owner's hold", reaped.released === true, JSON.stringify(reaped));
		check("it reports the screen half: which seat must come back", reaped.restore?.selectSeat === null || "selectSeat" in reaped.restore, JSON.stringify(reaped.restore));
		check("and that the screen is not-live until the restart", /not-live/.test(reaped.restore?.state ?? ""), JSON.stringify(reaped.restore));

		// A LIVE window must NOT be reaped: the reaper must not touch a session someone is using.
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: process.pid, now: Date.now() });
		const untouched = reapAbandonedWindow({ dbPath: db, now: Date.now() });
		check("a LIVE window is left alone", untouched.reaped === false, JSON.stringify(untouched));
	}

	console.log("\n=== (v) THE `--own` BYPASS IS GONE: refusal means DO NOT OPEN (no process shape change) ===");
	{
		writeBrokerState(db, process.pid); // a live broker owning the store
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: process.pid });
		const refused = decideOpen({ dbPath: db, acquire: acquireSeatStore });
		check("while the broker owns the store the glue REFUSES to open", refused.open === false, JSON.stringify(refused));
		check("the refusal carries the seam's reason (the broker keeps writing)", /keeps writing/i.test(refused.reason ?? ""), refused.reason);
		check("there is no override argument to bypass it", decideOpen.length === 1, `arity ${decideOpen.length}`);

		writeBrokerState(db, 999_999); // the broker is gone -> the store is free
		beginOperatorWindow({ dbPath: db, surface: "operator", tuiPid: process.pid });
		const opened = decideOpen({ dbPath: db, acquire: acquireSeatStore });
		check("once the broker is genuinely gone the glue opens", opened.open === true, JSON.stringify(opened));
	}

	console.log(
		failures === 0
			? "\nPASS — the window's order, exit key, handoff, return state and reaper are decided and pinned; the --own bypass is replaced by a refusal"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
} finally {
	await rm(base, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
