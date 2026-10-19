// The measures that answer "is this rig getting worse?". METRICS.md's whole
// point is that a number is worthless without its band, its direction, its
// evidence class and its blind spot, so the assertions below are mostly about
// what a reading REFUSES to claim: no baseline is not "ok", zero denominators
// are not "0%", a config-derived value has no trend, and a bounded page must not
// turn a turn-boundary artefact into an unverified completion.
//
// Pure functions, so no store and no provider. Run: node demo/metrics.test.mjs
import assert from "node:assert/strict";
import {
	MEASURES,
	RETRIEVAL_TOOLS,
	computeMetrics,
	evaluateBand,
	formatMetrics,
	formatValue,
	measureHasTrend,
	measurePassFailed,
	measureQueueAgeing,
	measureSharedReviewerModel,
	measureStepRepetition,
	measureUnverifiedCompletions,
	splitWindows,
} from "../src/metrics.mjs";

/* -------------------------------------------------------- entry builders */

const BASE = 1_800_000_000_000; // arbitrary epoch ms
const T = (min) => BASE + min * 60_000;

const user = (text, min) => ({
	kind: "pi.user",
	model: [{ role: "user", content: text, timestamp: T(min) }],
});
const assistant = (parts, min) => ({
	kind: "pi.assistant",
	model: [{ role: "assistant", content: parts, timestamp: T(min) }],
});
const toolResult = (toolName, min) => ({
	kind: "pi.tool-result",
	model: [{ role: "toolResult", toolName, content: [{ type: "text", text: "ok" }], timestamp: T(min) }],
});
const text = (t) => ({ type: "text", text: t });
const call = (name, args = {}) => ({ type: "toolCall", id: `${name}-${min0(args)}`, name, arguments: args });
// A stable id without randomness, so a failure is reproducible.
function min0(args) {
	return JSON.stringify(args).length;
}

/* ------------------------------------------------------ 1. step repetition */

// An identical call inside the horizon is a repeat; different arguments are not.
const rep = measureStepRepetition({
	pm: [
		assistant([call("send_work", { body: "b" })], 3),
		assistant([call("send_work", { body: "b" })], 2),
		assistant([call("send_work", { body: "a" })], 1),
	],
});
assert.equal(rep.value, 1 / 3, `one of three calls repeats; got ${rep.value}`);

// Key order is not a semantic difference: same arguments, different order = same call.
const reordered = measureStepRepetition({
	pm: [
		assistant([call("send_work", { b: 2, a: 1 })], 2),
		assistant([call("send_work", { a: 1, b: 2 })], 1),
	],
});
assert.equal(reordered.numerator, 1, "argument key order must not hide a repeat");
assert.equal(reordered.value, 0.5, "one repeat of two calls is a rate of 0.5");

// An alternating loop (A,B,A,B) is caught by the horizon, not just adjacency.
const alternate = measureStepRepetition({
	pm: [
		assistant([call("read", { p: "b" })], 4),
		assistant([call("read", { p: "a" })], 3),
		assistant([call("read", { p: "b" })], 2),
		assistant([call("read", { p: "a" })], 1),
	],
});
assert.equal(alternate.value, 0.5, `alternating loop must count 2 of 4; got ${alternate.value}`);

// A repeat further back than the horizon is NOT counted, by design.
const farBack = measureStepRepetition({
	pm: [
		assistant([call("read", { p: "z" })], 3),
		assistant([call("read", { p: "a" })], 2),
		assistant([call("read", { p: "b" })], 1),
	],
});
assert.equal(farBack.value, 0, "a long-range duplicate is not a stuck step");

// No calls at all is not "0% repetition" - it is nothing to report.
assert.equal(measureStepRepetition({}).value, null, "no calls must be null, not zero");

/* --------------------------------------------- 2. unverified completions */

const verified = measureUnverifiedCompletions({
	impl: [
		assistant([call("complete_work", { itemId: 1, resultSummary: "done" })], 3),
		assistant([call("read", { path: "book.tex" })], 2),
		user("do the thing", 1),
	],
});
assert.equal(verified.value, 0, "a retrieval before complete_work is verified");

const unverified = measureUnverifiedCompletions({
	impl: [
		assistant([call("complete_work", { itemId: 1, resultSummary: "done" })], 2),
		user("do the thing", 1),
	],
});
assert.equal(unverified.value, 1, "complete_work with no retrieval is unverified");

// The turn must reset: a retrieval in the PREVIOUS turn must not vouch for this one.
const staleRetrieval = measureUnverifiedCompletions({
	impl: [
		assistant([call("complete_work", { itemId: 2, resultSummary: "done" })], 4),
		user("second task", 3),
		assistant([call("read", { path: "book.tex" })], 2),
		user("first task", 1),
	],
});
assert.equal(staleRetrieval.value, 1, "retrieval from an earlier turn must not count");

// A bounded page starts mid-turn; a completion near that edge must not be
// reported unverified just because its retrieval fell off the page.
const partialPage = measureUnverifiedCompletions({
	impl: [
		assistant([call("complete_work", { itemId: 3, resultSummary: "x" })], 5),
		assistant([call("send_work", { body: "y" })], 4),
	],
});
assert.equal(partialPage.denominator, 0, "a leading partial turn must be excluded, not counted");

assert.equal(measureUnverifiedCompletions({}).value, null, "no completions must be null, not 0%");

/* ---------------------------------------------------------- 3. queue ageing */

const now = T(100);
const ageing = measureQueueAgeing(
	[
		{ id: 1, to: "impl", status: "queued", transitions: [{ at: new Date(T(10)).toISOString(), event: "queued", by: "pm" }] },
		{ id: 2, to: "qa", status: "queued", transitions: [{ at: new Date(T(55)).toISOString(), event: "queued", by: "pm" }] },
		{ id: 3, to: "ux", status: "done", transitions: [{ at: new Date(T(0)).toISOString(), event: "done", by: "ux" }] },
	],
	now,
);
assert.equal(ageing.value, 90, `oldest QUEUED item is 90 min; got ${ageing.value}`);
assert.equal(ageing.oldest.id, 1, "the finished item must not be the oldest queued one");

assert.equal(measureQueueAgeing([], now).value, null, "an empty queue is null, not a good number");
assert.equal(
	measureQueueAgeing([{ id: 9, to: "x", status: "queued", transitions: [] }], now).value,
	null,
	"a queued item with no timestamp cannot be aged - say so, do not guess",
);

/* -------------------------------------------------- 4. shared reviewer model */

const shared = measureSharedReviewerModel({
	seats: [
		{ name: "impl", role: "implementer" },
		{ name: "qa", role: "verifier" },
	],
	modelsBySeat: { impl: "deepinfra/glm", qa: "deepinfra/glm" },
});
assert.equal(shared.value, 1, "one verifier sharing the author's model");
assert.deepEqual(shared.shared, ["qa"], "the shared verifier is named, not just counted");

const diverse = measureSharedReviewerModel({
	seats: [
		{ name: "impl", role: "implementer" },
		{ name: "qa", role: "verifier" },
	],
	modelsBySeat: { impl: "deepinfra/glm", qa: "deepinfra/llama" },
});
assert.equal(diverse.value, 0, "a different model family is a clean reading");

// No verifier seat is `check`'s finding to raise; reporting 0 here would be an
// all-clear for a rig that has nothing checking it.
assert.equal(
	measureSharedReviewerModel({ seats: [{ name: "impl", role: "implementer" }], modelsBySeat: { impl: "x" } }).value,
	null,
	"no verifier seat is unjudgeable, not clean",
);

/* ------------------------------------------------------------- 5. bands */

const relative = MEASURES["unverified-completions"];
assert.equal(evaluateBand(relative, 0.5, null).state, "unknown", "no baseline must not read as ok");
assert.equal(evaluateBand(relative, 0.5, 0.3).state, "ok", "0.5 is inside the 2x enter threshold of a 0.3 baseline (0.6)");
assert.equal(evaluateBand(relative, 0.5, 0.1).state, "warn", "0.5 against 0.1 is 5x, out of band");
// k x 0 = 0, so a relative rule would never fire and a rig could climb from
// zero to anything in silence. Movement off zero is the signal.
assert.equal(evaluateBand(relative, 0.01, 0).state, "warn", "any movement off a zero baseline is a signal");
assert.equal(evaluateBand(relative, 0, 0).state, "ok", "still zero against a zero baseline is ok");
assert.equal(evaluateBand(relative, null, 0.1).state, "silent", "no data is silent, not ok");

const absolute = MEASURES["queue-ageing"];
assert.equal(evaluateBand(absolute, 45, null).state, "warn", "45 min against an absolute 30 min band");
assert.equal(evaluateBand(absolute, 5, null).state, "ok", "5 min is in band");

/* ------------------------------------------------- 6. window split + config */

const fourTurns = {
	pm: [
		user("t3", 6), assistant([call("a", {})], 6),
		user("t2", 4), assistant([call("a", {})], 4),
		user("t1", 2), assistant([call("a", {})], 2),
		user("t0", 0), assistant([call("a", {})], 0),
	],
};
const { current, previous } = splitWindows(fourTurns);
assert.equal(current.pm.filter((e) => e.kind === "pi.user").length, 2, "newest half holds two turns");
assert.equal(previous.pm.filter((e) => e.kind === "pi.user").length, 2, "older half holds two turns");
assert.equal(current.pm[0].kind, "pi.user", "the current window must start at a turn boundary");

const oneTurn = { pm: [user("t0", 1), assistant([call("a", {})], 1)] };
assert.equal(splitWindows(oneTurn).previous.pm, undefined, "one turn cannot make a baseline");

assert.equal(measureHasTrend(MEASURES["shared-reviewer-model"]), false, "config-derived has no trend");
assert.equal(measureHasTrend(MEASURES["step-repetition"]), true, "a rate has a trend");

/* ------------------------------------------------------- 7. the whole view */

const result = computeMetrics({
	pages: {
		pm: [
			user("t3", 7), assistant([call("send_work", { body: "b" })], 7),
			user("t2", 5), assistant([call("send_work", { body: "b" })], 5),
			user("t1", 3), assistant([call("send_work", { body: "b" })], 3),
			user("t0", 1), assistant([call("send_work", { body: "a" })], 1),
		],
	},
	queueItems: [
		{ id: 1, to: "impl", status: "queued", transitions: [{ at: new Date(T(0)).toISOString(), event: "queued" }] },
	],
	seats: [
		{ name: "pm", role: "program manager" },
		{ name: "impl", role: "implementer" },
		{ name: "qa", role: "verifier" },
	],
	modelsBySeat: { pm: "deepinfra/glm", impl: "deepinfra/glm", qa: "deepinfra/glm" },
	nowMs: T(60),
	bounded: true,
});

const byId = Object.fromEntries(result.measures.map((m) => [m.id, m]));
assert.equal(byId["step-repetition"].value, 0.5, "current window: 1 repeat of 2 calls");
assert.equal(byId["step-repetition"].baseline, 0, "the older window had no repeats");
assert.equal(byId["step-repetition"].state, "warn", "moving off a zero baseline is out of band");
assert.equal(byId["queue-ageing"].state, "warn", "an hour-old queued item is out of band");
assert.equal(byId["shared-reviewer-model"].state, "warn", "qa shares the authors' model");
assert.equal(result.window.turns, 4, "the window counts turns");
assert.equal(result.window.bounded, true, "a bounded scan says so");
assert.equal(result.window.quietForMs, 53 * 60_000, "quiet time is measured from the newest entry");

// Ambient notices are the out-of-band, admissible subset only.
const noticeKinds = result.notices.map((n) => n.kind).sort();
assert.deepEqual(noticeKinds, ["queue-ageing", "step-repetition"], "only admissible out-of-band measures go ambient");
assert.ok(
	!noticeKinds.includes("shared-reviewer-model"),
	"a config-derived measure is already visible in `check`, so it must not go ambient",
);
for (const notice of result.notices) {
	assert.equal(notice.seat, null, "a rig/queue notice carries a null seat so the per-seat glyph path can exclude it");
	assert.ok(["rig", "queue"].includes(notice.scope), `unexpected scope ${notice.scope}`);
	assert.match(notice.detail, /baseline|band/, "an ambient notice must carry what it was measured against");
}

/* --------------------------------------------------------- 8. the render */

const plain = formatMetrics(result, { color: false });
assert.ok(!plain.includes("\x1b["), "a monochrome render carries no escapes");
assert.match(plain, /metrics\s+window: 4 turn\(s\), bounded by the scan limit/, "window and bound are stated");
assert.match(plain, /step-repetition/, "every measure is listed");
assert.match(plain, /\[direct\]/, "the evidence class is printed");
assert.match(plain, /re-reading a file/, "the blind spot is printed beside the value");
assert.match(plain, /config-derived/, "a config-derived measure says so where a baseline would be");
assert.ok(!/shared-reviewer-model.*[↑↓]/.test(plain), "a config-derived measure must not draw a trend arrow");
assert.match(formatValue(byId["queue-ageing"]), /min$/, "a value travels with its unit");

// Trap 1, stated rather than rendered as a good number: a still rig must say
// when its data stops.
const quiet = computeMetrics({ pages: fourTurns, nowMs: T(60 + 600) });
assert.match(
	formatMetrics(quiet, { color: false }),
	/no new data for \d+h/,
	"a quiet rig must announce its quiet time, not report stable rates as good",
);

const empty = computeMetrics({});
assert.equal(empty.window.newestAt, null, "an empty store has no newest entry");
assert.equal(empty.window.quietForMs, null, "an empty store has no quiet time to report");
assert.deepEqual(empty.notices, [], "an empty store is silent, not alarming");
assert.match(formatMetrics(empty, { color: false }), /no entries yet/, "an empty store says so rather than showing zeros");

/* --------------------------------------------- 8. pass-failed (broker log) */

// #2643 (ROADMAP 78 / #2237): the broker's THROWN-pass lines are COUNTED, not just logged. The
// measure reads <db>.broker.log — the only durable artifact of the `pass-failed` diagnostic.
const LOG_NOW = Date.parse("2026-10-19T12:00:00.000Z");
const logLine = (iso, body) => `${iso} ${body}`;
const brokerLog = [
	logLine("2026-10-19T11:59:00.000Z", "PASS 3 ms=12 woke=pm"),
	logLine("2026-10-19T11:00:00.000Z", "PASS-FAILED Error: boom cause=SessionFailed: locked"),
	logLine("2026-10-19T10:00:00.000Z", "PASS-FAILED Error: boom2"),
	// OUTSIDE the 24h window (26h old) — must NOT count.
	logLine("2026-10-18T10:00:00.000Z", "PASS-FAILED Error: ancient"),
	// A similar but different line — not a PASS-FAILED record.
	logLine("2026-10-19T11:30:00.000Z", "PASS-FAILED-PARTIAL nope"),
].join("\n");

assert.equal(measurePassFailed(brokerLog, { nowMs: LOG_NOW }).value, 2, "only PASS-FAILED lines inside the 24h window count");
assert.equal(measurePassFailed(null, { nowMs: LOG_NOW }).value, null, "no log => null, never a false zero");
assert.equal(measurePassFailed("", { nowMs: LOG_NOW }).value, null, "an empty log => null");
assert.equal(
	measurePassFailed(logLine("2026-10-19T11:00:00.000Z", "PASS 1 ms=2"), { nowMs: LOG_NOW }).value,
	0,
	"a log with no PASS-FAILED in the window => 0, not null",
);
assert.equal(
	measurePassFailed("PASS-FAILED Error: partial", { nowMs: LOG_NOW }).value,
	0,
	"a partial tail line with no leading timestamp is skipped",
);

const pfMetrics = computeMetrics({ brokerLog, nowMs: LOG_NOW });
const pfRow = pfMetrics.measures.find((m) => m.id === "pass-failed");
assert.equal(pfRow.value, 2, "computeMetrics carries the pass-failed count");
assert.equal(pfRow.state, "warn", "any PASS-FAILED in the window is a warn");
assert.equal(pfRow.threshold, 1);
assert.equal(MEASURES["pass-failed"].ambient, true, "pass-failed is ambient (an out-of-band notice)");
assert.ok(pfMetrics.notices.some((n) => n.kind === "pass-failed"), "a warned pass-failed is an ambient notice");
assert.match(pfRow.blind, /broker\.log/, "the blind spot names the log");

const noLogRow = computeMetrics({ nowMs: LOG_NOW }).measures.find((m) => m.id === "pass-failed");
assert.equal(noLogRow.value, null, "no log => no value");
assert.equal(noLogRow.state, "silent", "no data => silent, never a false ok");
console.log("  ok   pass-failed is counted from <db>.broker.log (windowed, ambient, silent without a log)");

console.log("METRICS TEST PASS (repetition, unverified, queue ageing, shared model, pass-failed, bands, windows, notices, render)");
