// demo/fleet-health-counts.test.mjs — the fleet census COUNTS, and can be pointed at a seat (#5789).
//
// WHY THIS DEMO EXISTS. ROADMAP 331's acceptance is not "compaction is fixed" — it is "the compaction
// failure count stops growing". That is unverifiable without a counter, and a counter that merely prints a
// table is not an instrument. This demo builds stores whose correct answer is KNOWN IN ADVANCE and asserts
// the numbers, the families, and the attribution. It also proves the counter is not vacuous three ways: a
// completed row must not be counted as a failure; two spend-cap messages that differ only in a dollar figure
// must collapse into ONE family (on the live store the same cause fragments into 10+ raw strings); and a
// failure outside the window must not be counted inside it.
//
// Run: node demo/fleet-health-counts.test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { classifyFamily, countOutcomes } from "../src/fleethealth.mjs";

const HERE = process.cwd();
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
	if (cond) { pass++; console.log(`  ok ${name}`); }
	else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const NOW = Date.now();
const RECENT = NOW - 60_000;
const OLD = NOW - 30 * 60 * 60 * 1000; // 30 hours ago: outside any sane window

/** A store with the real `tasks` shape. `kind` is stored JSON-encoded, exactly as the live rig stores it. */
function makeStore(file, rows) {
	const db = new DatabaseSync(file);
	db.exec("create table tasks (id integer primary key, conversation_id integer, kind text, status text, abort_requested integer, background integer, record text)");
	db.exec("create table document_revisions (document_id integer, seq integer, kind text, version integer, content text)");
	for (const r of rows) {
		db.prepare("insert into tasks (conversation_id, kind, record) values (?, ?, ?)").run(
			r.conversationId,
			JSON.stringify(r.kind),
			JSON.stringify({
				id: r.id ?? 1,
				conversationId: r.conversationId,
				kind: r.kind,
				startedAt: r.at,
				endedAt: r.outcome.status === "inFlight" ? null : r.at + 1000,
				state: { status: r.outcome.status === "inFlight" ? "running" : "terminal", outcome: r.outcome.status === "inFlight" ? null : r.outcome },
			}),
		);
	}
	db.close();
}

function run(tool, args) {
	try {
		return { code: 0, out: execFileSync("node", [tool, ...args], { cwd: HERE, encoding: "utf8", timeout: 15000 }) };
	} catch (err) {
		return { code: err.exitCode ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
	}
}

const dir = mkdtempSync(join(tmpdir(), "fleet-health-demo-"));
try {
	// ---- fixture A: mixed outcomes, two seats, three conversations ----
	const seatMapFile = join(dir, "seats.json");
	writeFileSync(seatMapFile, JSON.stringify([{ name: "impl", conversationId: 42 }, { name: "pm", conversationId: 43 }, { name: "devtools", conversationId: 44 }]));

	const a = join(dir, "a.sqlite");
	makeStore(a, [
		// generations
		{ kind: "pi.generation", conversationId: 42, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.generation", conversationId: 42, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.generation", conversationId: 43, at: RECENT, outcome: { status: "failed", error: { message: "Model faux/x is not available", detail: { reason: "no_model" } } } },
		{ kind: "pi.generation", conversationId: 44, at: RECENT, outcome: { status: "aborted" } },
		{ kind: "pi.generation", conversationId: 44, at: RECENT, outcome: { status: "inFlight" } },
		// compaction: one token-limit failure, TWO spend-cap refusals whose messages differ only in the dollar figure
		{ kind: "pi.compaction", conversationId: 42, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.compaction", conversationId: 42, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.compaction", conversationId: 43, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.compaction", conversationId: 44, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.compaction", conversationId: 42, at: RECENT, outcome: { status: "failed", error: { message: "Summarization hit the token limit; the summary is incomplete", detail: { reason: "model_error" } } } },
		{ kind: "pi.compaction", conversationId: 43, at: RECENT, outcome: { status: "failed", error: { message: "Summarization failed: spend_cap_exceeded: verifier/y projects $0.001165 and would cross $0.1000", detail: { reason: "model_error" } } } },
		{ kind: "pi.compaction", conversationId: 43, at: RECENT, outcome: { status: "failed", error: { message: "Summarization failed: spend_cap_exceeded: verifier/y projects $0.001197 and would cross $0.1000", detail: { reason: "model_error" } } } },
		// out of window: a failure that must NOT be counted in a 60-minute census
		{ kind: "pi.compaction", conversationId: 44, at: OLD, outcome: { status: "failed", error: { message: "Summarization hit the token limit; the summary is incomplete", detail: { reason: "model_error" } } } },
		{ kind: "pi.compaction", conversationId: 44, at: OLD, outcome: { status: "completed" } },
	]);

	const res = run("tools/fleet-health.mjs", ["--db", a, "--since-min", "60", "--seat-map", seatMapFile, "--json"]);
	check("fleet-health exits 0 on a readable store", res.code === 0, `exit ${res.code}: ${res.out.slice(0, 200)}`);
	const h = JSON.parse(res.out || "{}");

	check("generation totals are counted, not guessed", h.generations?.total === 5 && h.generations.completed === 2 && h.generations.failed === 1 && h.generations.aborted === 1 && h.generations.inFlight === 1,
		JSON.stringify(h.generations));
	check("an in-flight row is NOT a failure", h.generations?.inFlight === 1 && h.generations.failed === 1, JSON.stringify(h.generations));
	check("compaction totals: 7 in the 60-minute window, 4 completed and 3 failed", h.compaction?.total === 7 && h.compaction.completed === 4 && h.compaction.failed === 3 && h.compaction.aborted === 0,
		JSON.stringify({ total: h.compaction?.total, completed: h.compaction?.completed, failed: h.compaction?.failed }));
	check("the 30-hour-old rows are outside the window", h.compaction?.total === 7 && !h.compaction.failureClasses.some((f) => f.conversations.includes(44)),
		JSON.stringify(h.compaction.failureClasses));

	const token = h.compaction?.failureClasses.find((f) => f.family === "token-limit-incomplete-summary");
	check("the token-limit family is COUNTED and attributed to a seat", token?.count === 1 && token.seats.join(",") === "impl" && token.conversations.join(",") === "42", JSON.stringify(token));

	const cap = h.compaction?.failureClasses.find((f) => f.family === "spend-cap-refusal");
	check("two messages differing only in a dollar figure collapse to ONE family with count 2", cap?.count === 2 && cap.seats.join(",") === "pm", JSON.stringify(cap));
	check("incompleteSummary is the token-limit count, not all failures", h.incompleteSummary === 1, `got ${h.incompleteSummary}`);

	const noMap = run("tools/fleet-health.mjs", ["--db", a, "--since-min", "60", "--json"]);
	const h2 = JSON.parse(noMap.out || "{}");
	const tokenNoMap = h2.compaction?.failureClasses.find((f) => f.family === "token-limit-incomplete-summary");
	check("without a seat map attribution falls back to the conversation id, and says so", tokenNoMap?.seats.join(",") === "conv:42" && h2.seatsResolved === false, JSON.stringify({ seats: tokenNoMap?.seats, seatsResolved: h2.seatsResolved }));

	const allTime = run("tools/fleet-health.mjs", ["--db", a, "--all-time", "--seat-map", seatMapFile, "--json"]);
	const h3 = JSON.parse(allTime.out || "{}");
	check("--all-time sees every row in the store, 9 compaction records", h3.compaction?.total === 9, JSON.stringify({ total: h3.compaction?.total }));
	const tokenAll = h3.compaction?.failureClasses.find((f) => f.family === "token-limit-incomplete-summary");
	check("--all-time counts the out-of-window failure too", tokenAll?.count === 2 && tokenAll.seats.join(",") === "devtools,impl", JSON.stringify(tokenAll));

	check("--strict exits 1 when compaction failures exist", run("tools/fleet-health.mjs", ["--db", a, "--since-min", "60", "--strict", "--json"]).code === 1);

	// ---- fixture B: a clean store, so --strict's 0 is earned, not defaulted ----
	const b = join(dir, "b.sqlite");
	makeStore(b, [
		{ kind: "pi.compaction", conversationId: 42, at: RECENT, outcome: { status: "completed" } },
		{ kind: "pi.generation", conversationId: 42, at: RECENT, outcome: { status: "completed" } },
	]);
	const clean = run("tools/fleet-health.mjs", ["--db", b, "--since-min", "60", "--strict", "--json"]);
	check("--strict exits 0 on a clean store", clean.code === 0, `exit ${clean.code}`);
	check("a clean store reports zero failures", JSON.parse(clean.out || "{}").compaction?.failed === 0);

	check("a missing store fails loudly", run("tools/fleet-health.mjs", ["--db", join(dir, "nope.sqlite")]).code === 1);

	// ---- the window lens separates CAUSE, not just count ----
	const windowed = run("tools/context-window-health.mjs", ["--db", a, "--since-min", "60", "--seat-map", seatMapFile, "--json"]);
	const w = JSON.parse(windowed.out || "{}");
	check("the window lens reports the token-limit failure as window pressure", w.windowPressure?.length === 1 && w.windowPressure[0].count === 1, JSON.stringify(w.windowPressure));
	check("the window lens does NOT call a spend-cap refusal window pressure", (w.windowPressure ?? []).every((f) => f.family !== "spend-cap-refusal"), JSON.stringify(w.windowPressure));
	check("the window lens --strict exits 1 when window pressure exists", windowed.code === 0 && run("tools/context-window-health.mjs", ["--db", a, "--since-min", "60", "--strict", "--json"]).code === 1);
	check("the window lens --strict exits 0 on a clean store", run("tools/context-window-health.mjs", ["--db", b, "--strict", "--json"]).code === 0);

	// ---- the classifiers themselves, pinned against strings measured in the live store ----
	check("the measured token-limit message classifies as its own family", classifyFamily("Summarization hit the token limit; the summary is incomplete") === "token-limit-incomplete-summary");
	check("the measured spend-cap message classifies as its own family", classifyFamily("Summarization failed: spend_cap_exceeded (durig's own cap, out of budget under it - NOT the provider's): verifier/openai/gpt-oss-120b projects $0.001165 and would cross DURIG_SPEND_CAP_RUN_USD $0.1000 (this process, spent $0.098924).") === "spend-cap-refusal");
	check("countOutcomes buckets exactly", JSON.stringify(countOutcomes(["completed", "failed", "aborted", null, "failed"])) === JSON.stringify({ completed: 1, failed: 2, aborted: 1, inFlight: 1 }));

	// human-readable output must exist too, since the tool is for a human mid-incident
	const human = run("tools/fleet-health.mjs", ["--db", a, "--since-min", "60", "--seat-map", seatMapFile]);
	check("the human view prints generations, compaction and the families", /generations: total=5/.test(human.out) && /compaction: total=7/.test(human.out) && /family=token-limit-incomplete-summary count=1/.test(human.out), human.out.slice(0, 300));
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
