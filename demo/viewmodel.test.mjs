// demo/viewmodel.test.mjs — golden assertions for src/viewmodel.mjs.
//
// Pure functions over plain data: buildTurns, turnCollapse, turnRemainder,
// peerGraph, peerTargets, partialView. No storage, no harness, no I/O.
//
// Failing-first: before this file exists, `node demo/viewmodel.test.mjs`
// cannot run. After: all golden checks pass.
//
// Run: node demo/viewmodel.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import {
	buildTurns,
	turnRemainder,
	turnCollapse,
	peerGraph,
	peerTargets,
	partialView,
} from "../src/viewmodel.mjs";

let failures = 0;

function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// ─── Fixture entries ───────────────────────────────────────────────────────

const userEntry = {
	id: 1,
	kind: "pi.user",
	model: [{ content: [{ type: "text", text: "hello" }], timestamp: 1000 }],
};

const assistantTextEntry = {
	id: 2,
	kind: "pi.assistant",
	model: [{ content: [{ type: "text", text: "hi back" }], timestamp: 2000 }],
};

const assistantToolEntry = {
	id: 3,
	kind: "pi.assistant",
	model: [{
		timestamp: 3000,
		content: [
			{ type: "text", text: "let me check" },
			{ type: "toolCall", id: "tc1", name: "cat_file", arguments: { path: "x.js" } },
		],
	}],
};

const toolResultEntry = {
	id: 4,
	kind: "pi.tool-result",
	model: [{ toolCallId: "tc1", content: [{ type: "text", text: "contents of x.js\nline2\nline3" }], timestamp: 4000 }],
};

const assistantThinkingEntry = {
	id: 5,
	kind: "pi.assistant",
	model: [{
		timestamp: 5000,
		content: [
			{ type: "thinking", thinking: "I think this is right\nand also this" },
			{ type: "text", text: "done" },
		],
	}],
};

const assistantRedactedThinkingEntry = {
	id: 6,
	kind: "pi.assistant",
	model: [{
		timestamp: 6000,
		content: [
			{ type: "thinking", thinking: "", redacted: true },
			{ type: "text", text: "output" },
		],
	}],
};

const systemEntry = {
	id: 7,
	kind: "pi.system",
	model: [{ text: "system scaffolding", timestamp: 0 }],
};

// ─── buildTurns ────────────────────────────────────────────────────────────

console.log("buildTurns — single user/assistant pair");
const turns1 = buildTurns([userEntry, assistantTextEntry]);
check("2 turns: operator + agent", turns1.length === 2);
check("first turn is operator", turns1[0].kind === "operator");
check("first turn has correct ts", turns1[0].ts === 1000);
check("second turn is agent", turns1[1].kind === "agent");
check("agent has text", turns1[1].text === "hi back");

console.log("\nbuildTurns — tool call + result (one turn)");
const turns2 = buildTurns([userEntry, assistantToolEntry, toolResultEntry]);
check("3 turns: operator + agent + tools", turns2.length === 3);
check("first is operator", turns2[0].kind === "operator");
check("second is agent", turns2[1].kind === "agent");
check("third is tools", turns2[2].kind === "tools");
check("tool call has name", turns2[2].call?.name === "cat_file");
check("tool result is attached", turns2[2].result?.kind === "pi.tool-result");
check("result text shows content", turns2[2].result?.model?.[0]?.content?.[0]?.text?.includes("contents of x.js"));

console.log("\nbuildTurns — thinking turn");
const turns3 = buildTurns([userEntry, assistantThinkingEntry]);
check("3 turns: operator + thinking + agent", turns3.length === 3);
check("thinking turn has text", turns3[1].text === "I think this is right\nand also this");
check("agent turn has text", turns3[2].text === "done");

console.log("\nbuildTurns — redacted thinking");
const turns4 = buildTurns([userEntry, assistantRedactedThinkingEntry]);
check("thinking turn is redacted", turns4[1].redacted === true);
check("redacted turn has empty text", turns4[1].text === "");

console.log("\nbuildTurns — system entries are excluded");
const turns5 = buildTurns([systemEntry, userEntry]);
check("system entry excluded, only 1 turn", turns5.length === 1);
check("turn is operator", turns5[0].kind === "operator");

console.log("\nbuildTurns — orphan result (no matching call)");
const orphanResult = {
	id: 10,
	kind: "pi.tool-result",
	model: [{ toolCallId: "missing", text: "orphan", timestamp: 500 }],
};
const turns6 = buildTurns([userEntry, orphanResult]);
check("2 turns: operator + tools (orphan)", turns6.length === 2);
check("orphan turn has result but no call", turns6[1].kind === "tools");
check("call is null for orphan", turns6[1].call === null);
check("result is present", turns6[1].result?.kind === "pi.tool-result");

console.log("\nbuildTurns — empty and null inputs");
check("empty array returns []", buildTurns([]).length === 0);
check("null input returns []", buildTurns(null).length === 0);

// ─── turnRemainder ─────────────────────────────────────────────────────────

console.log("\nturnRemainder — thinking with multi-line text");
const thinkingTurn = turns3[1];
const rem1 = turnRemainder(thinkingTurn);
check("remainder has 1 extra line", rem1.length === 1);
check("remainder line is 'and also this'", rem1[0] === "and also this");

console.log("\nturnRemainder — redacted thinking");
const rem2 = turnRemainder(turns4[1]);
check("redacted has no remainder", rem2.length === 0);

console.log("\nturnRemainder — operator turn has no remainder");
check("operator turn remainder is empty", turnRemainder(turns1[0]).length === 0);

console.log("\nturnRemainder — tool result with multi-line output");
const toolTurn = turns2[2];
const rem3 = turnRemainder(toolTurn);
check("tool remainder has 2 extra lines", rem3.length === 2);
check("first extra line is 'line2'", rem3[0] === "line2");
check("second extra line is 'line3'", rem3[1] === "line3");

// ─── turnCollapse ──────────────────────────────────────────────────────────

console.log("\nturnCollapse — thinking is collapsed by default");
const col1 = turnCollapse(thinkingTurn);
check("collapsed === true for thinking", col1.collapsed === true);
check("hiddenLines === 1", col1.hiddenLines === 1);
check("lines has 1 element", col1.lines.length === 1);

console.log("\nturnCollapse — thinking with full=true shows everything");
const col2 = turnCollapse(thinkingTurn, { full: true });
check("collapsed === false when full", col2.collapsed === false);
check("hiddenLines === 0 when full", col2.hiddenLines === 0);

console.log("\nturnCollapse — operator is never collapsed");
const col3 = turnCollapse(turns1[0]);
check("operator never collapsed", col3.collapsed === false);
check("operator hiddenLines === 0", col3.hiddenLines === 0);

console.log("\nturnCollapse — redacted thinking has no lines");
const col4 = turnCollapse(turns4[1]);
check("redacted thinking has no lines", col4.hiddenLines === 0);

// ─── peerGraph ─────────────────────────────────────────────────────────────

console.log("\npeerGraph — directional edges");
const items = [
	{ id: 1, from: "alpha", to: "beta", subject: "A" },
	{ id: 2, from: "beta", to: "alpha", subject: "B" },
	{ id: 3, from: "alpha", to: "gamma", subject: "C" },
	{ id: 4, from: "alpha", to: "alpha", subject: "self" }, // skipped
];
const graph = peerGraph(items);
check("3 seats present", Object.keys(graph.seats).length === 3);
check("3 edges (self-item skipped)", graph.edges.length === 3);
check("alpha sent to beta", graph.seats.alpha.sent.beta.count === 1);
check("beta received from alpha", graph.seats.beta.received.alpha.count === 1);
check("beta sent to alpha", graph.seats.beta.sent.alpha.count === 1);

// ─── peerTargets ───────────────────────────────────────────────────────────

console.log("\npeerTargets — alpha's peers, sorted by newest interaction");
const targets = peerTargets(graph, "alpha");
check("3 targets: beta and gamma", targets.length === 2);
check("first target is beta (same latest id as alpha->gamma but beta sent first in list)",
	targets[0].name === "beta" || targets[1].name === "beta");

// ─── partialView ───────────────────────────────────────────────────────────

console.log("\npartialView — text generation");
const live1 = {
	generation: {
		message: { content: [{ type: "text", text: "hello pi-tui" }] },
		attempt: 1,
	},
};
const pv1 = partialView(live1);
check("has text", pv1.text === "hello pi-tui");
check("hasContent === true", pv1.hasContent === true);
check("attempt === 1", pv1.attempt === 1);

console.log("\npartialView — thinking generation");
const live2 = {
	generation: {
		message: { content: [{ type: "thinking", thinking: "thinking here" }] },
		attempt: 2,
	},
};
const pv2 = partialView(live2);
check("has thinking", pv2.thinking === "thinking here");
check("hasContent === true", pv2.hasContent === true);

console.log("\npartialView — tool progress");
const live3 = {
	generation: {
		message: { content: [{ type: "text", text: "running" }] },
	},
	tools: [{ name: "cp", callId: "c1", status: "running" }],
};
const pv3 = partialView(live3);
check("tool in progress", pv3.tools.length === 1);
check("tool name matches", pv3.tools[0].name === "cp");

console.log("\npartialView — no generation = null");
check("null when no generation", partialView({}) === null);
check("null when generation without message", partialView({ generation: {} }) === null);
check("null when empty message — actually returns partial with hasContent=false", (
		partialView({ generation: { message: { content: [] } } })?.hasContent === false),
);

console.log("\npartialView — text alone, no thinking");
const pv4 = partialView(live1);
check("text only, thinking is empty", pv4.text === "hello pi-tui" && pv4.thinking === "");

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(failures === 0 ? "\nPASS — viewmodel golden checks" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
