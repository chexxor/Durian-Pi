// demo/tui-conversation-header.test.mjs — #3359: the conversation screen names the seat's
// CURRENT WORK ITEM (id + subject + status) in its header, and the steering write stays on
// the EXISTING spool lane.
//
// THE GAP: the conversation header said `durig · <seat> · <role> · conversation` — it named
// WHO you are talking to and nothing about WHAT they are doing, so steering from this screen
// meant remembering the landing row you came from. Designer spec #3307 §0 puts the item in
// the header (id + subject + status) and deliberately adds NO separate body block: the body
// is the seat's own transcript below.
//
// FAILING-FIRST: before this change the second header line does not exist; every header
// assertion below fails.
//
// THE HARD STOPS OF #3359 ARE ASSERTED HERE TOO, as negative checks, so a later change that
// drifts into them fails loudly instead of shipping:
//   - no subscribe-grade read-attach (poll only),
//   - no non-spool write (the TUI stays a viewer with exactly one spooled write).
//
// Run: node demo/tui-conversation-header.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { frameToLines, renderTui } from "../src/tui/client.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const SEATS = [
	{ name: "impl", role: "implementation engineer" },
	{ name: "qa", role: "verifier" },
	{ name: "lead", role: "technical lead" },
];
const QUEUE = [
	{ id: 74, from: "pm", to: "impl", subject: "merge the carry stack onto main", status: "claimed" },
	{ id: 92, from: "pm", to: "qa", subject: "verify the landing screen", status: "deferred", deferredTo: "human", question: "which tip?" },
];
const HEALTH = { seats: SEATS, queueItems: QUEUE, attention: [] };
const root = process.cwd();

const convo = (selectedSeat, params = {}) =>
	frameToLines(
		renderTui({
			seats: SEATS,
			health: HEALTH,
			queueItems: QUEUE,
			turns: [{ kind: "agent", text: "here is where I am" }],
			selectedSeat,
			view: "conversation",
			width: 80,
			height: 24,
			...params,
		}),
	);
const headerOf = (lines) => lines[1] ?? "";

try {
	console.log("\n=== the header names the seat AND its current item (id + subject + status) ===");
	const impl = convo("impl");
	check("line 1 still names the seat, its role and the view", impl[0].includes("durig · impl · implementation engineer · conversation"), impl[0]);
	check("line 2 carries the item id", headerOf(impl).includes("#74"), headerOf(impl));
	check("line 2 carries the subject", headerOf(impl).includes("merge the carry stack onto main"), headerOf(impl));
	check("line 2 carries the status word from the shared vocabulary", headerOf(impl).includes("working"), headerOf(impl));

	console.log("\n=== selecting seat A opens A, not B ===");
	const qa = convo("qa");
	check("qa's header names qa", qa[0].includes("durig · qa · verifier"), qa[0]);
	check("qa's header carries QA's item, not impl's", headerOf(qa).includes("#92") && !headerOf(qa).includes("#74"), headerOf(qa));
	check("the two headers differ", headerOf(impl) !== headerOf(qa));

	console.log("\n=== a parked seat says WHO it waits on; an idle seat says it holds nothing ===");
	check("parked header reads 'parked on human'", headerOf(qa).includes("parked on human"), headerOf(qa));
	const lead = convo("lead");
	check("a seat with no item says so instead of showing a blank line", headerOf(lead).includes("no current item"), headerOf(lead));
	check("and still carries its status", headerOf(lead).includes("idle"), headerOf(lead));

	console.log("\n=== ONE projection: the header and the roster row agree ===");
	const roster = frameToLines(renderTui({ seats: SEATS, health: HEALTH, queueItems: QUEUE, selectedSeat: "impl", view: "seats", width: 80, height: 24 }));
	const implRow = roster.find((l) => l.includes("impl") && l.includes("#"));
	check("the roster row and the header name the same item", implRow?.includes("#74") === true && headerOf(impl).includes("#74"));
	check("both use the same status word", implRow?.includes("working") === true && headerOf(impl).includes("working"), `${implRow} | ${headerOf(impl)}`);

	console.log("\n=== 80x24 golden: the conversation header ===");
	check("golden line 0", impl[0] === "  durig · impl · implementation engineer · conversation", JSON.stringify(impl[0]));
	check("golden line 1 (the item)", impl[1] === "  #74 merge the carry stack onto main · working", JSON.stringify(impl[1]));
	check("the frame still fits 80x24", impl.length <= 24, `lines=${impl.length}`);

	console.log("\n=== THE STOPS (#3359): poll + spool only ===");
	// ui.mjs is the poller that renders this client. It is a top-level script with side
	// effects, so these are SOURCE assertions — deliberately narrow: they pin the lane the
	// item is allowed to use, not the implementation inside it.
	const ui = readFileSync(join(root, "ui.mjs"), "utf8");
	check("the steering write is the landed spool op (writeIntent)", /import\s*\{[^}]*writeIntent[^}]*\}\s*from\s*"\.\/src\/broker\.mjs"/.test(ui));
	check("the send path passes the target seat and the operator as sender", /writeIntent\(DB_PATH,\s*\{\s*to,[^}]*from:\s*"operator"/s.test(ui), "writeIntent call shape changed");
	check("NO subscribe-grade read-attach (poll cadence only)", !/viewState\(\)\.subscribe|\.subscribe\(/.test(ui), "ui.mjs gained a subscribe read");
	check("the TUI opens no store of its own", !/openNodeSqliteStorage|openStore\(/.test(ui), "ui.mjs opened storage");
	// Delivery is not re-proven here: it is already covered end to end by
	// demo/broker-inbox.test.mjs and demo/broker-intent-wake.test.mjs, which drive the
	// spool through the broker. Re-testing it in a render demo would be a weaker copy.
	for (const demo of ["broker-inbox.test.mjs", "broker-intent-wake.test.mjs"]) {
		check(`delivery coverage exists: demo/${demo}`, readFileSync(join(root, "demo", demo), "utf8").includes("writeIntent"));
	}

	assert.ok(true);
	console.log(
		failures === 0
			? "\nCONVERSATION HEADER PASS (item in the header from the shared projection; spool-only steering lane)"
			: `\nCONVERSATION HEADER FAIL — ${failures} check(s)`,
	);
} catch (err) {
	console.error("ERROR:", err?.message ?? err);
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
