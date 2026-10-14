// View-model tests: the pure structural view behind any interactive client (D21,
// ROADMAP item 7) - turns, collapse state, and the peer navigation graph derived
// from the queue's from/to. The last block pins the renderer to the same view
// model, so the extraction is a single source rather than a parallel copy.
// Run: node demo/viewmodel.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { buildTurns, peerGraph, peerTargets, turnCollapse, turnRemainder } from "../src/viewmodel.mjs";
import { formatChat } from "../src/chatview.mjs";

console.log("--- turns: the unit is a call and its result ---");

const at = (ms) => ({ timestamp: 1_700_000_000_000 + ms });
const user = { kind: "pi.user", model: [{ role: "user", content: "hi", ...at(0) }] };
const callEntry = {
	kind: "pi.assistant",
	model: [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "working" },
				{ type: "toolCall", id: "c1", name: "claim_work", arguments: { id: 7 } },
			],
			...at(1000),
		},
	],
};
const resultEntry = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "claim_work",
			toolCallId: "c1",
			content: [{ type: "text", text: "line one\nline two\nline three" }],
			isError: false,
			...at(2000),
		},
	],
};
const system = { kind: "pi.system", model: [{ role: "system", content: "constitution", ...at(3000) }] };

assert.deepEqual(
	buildTurns([user, callEntry, resultEntry, system]).map((t) => t.kind),
	["operator", "agent", "tools"],
	"system scaffolding is not conversation; a call and its result are one tools turn",
);

console.log("--- collapse state is a value, not a renderer detail ---");

const turns = buildTurns([callEntry, resultEntry]);
const toolsTurn = turns.find((t) => t.kind === "tools");
const collapsed = turnCollapse(toolsTurn);
assert.equal(collapsed.collapsed, true, "a multi-line tool result folds by default");
assert.equal(collapsed.hiddenLines, 2, "the preview line is not counted as hidden");
assert.deepEqual(collapsed.lines, ["line two", "line three"]);
assert.equal(turnCollapse(toolsTurn, { full: true }).hiddenLines, 0, "--full hides nothing");
assert.equal(turnCollapse(toolsTurn, { full: true }).collapsed, false);

const thinkingEntry = {
	kind: "pi.assistant",
	model: [
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "step 1\nstep 2\nstep 3" },
				{ type: "text", text: "answer" },
			],
			...at(4000),
		},
	],
};
const thinkingTurn = buildTurns([thinkingEntry]).find((t) => t.kind === "thinking");
assert.equal(turnCollapse(thinkingTurn).hiddenLines, 2, "thinking folds the same way a tool result does");

const agentTurn = buildTurns([thinkingEntry]).find((t) => t.kind === "agent");
assert.equal(turnCollapse(agentTurn).collapsed, false, "prose is never hidden behind a count");
assert.deepEqual(turnRemainder(user), [], "a turn with no body has nothing to fold");

console.log("--- peer graph: who sent to / received from whom ---");

const item = (id, from, to, subject, status = "done") => ({ id, from, to, subject, status });
const items = [
	item(1, "pm", "impl", "route the work"),
	item(2, "impl", "qa", "for verification"),
	item(3, "qa", "pm", "DONE #1", "queued"),
	item(4, "pm", "impl", "second route"),
	item(5, "impl", "impl", "self-note - not a navigation target"),
];
const graph = peerGraph(items);

assert.equal(graph.edges.length, 4, "a self-addressed item is not an edge");
assert.equal(graph.seats.pm.sent.impl.count, 2, "both pm->impl items are counted");
assert.equal(graph.seats.pm.sent.impl.latestId, 4, "the newest interaction is reported by id");
assert.equal(graph.seats.pm.received.qa.count, 1, "direction is kept: pm received from qa");
assert.equal(graph.seats.pm.received.impl, undefined, "pm never received from impl");
assert.equal(graph.seats.impl.sent.impl, undefined, "a self-item adds no adjacency");
assert.equal(graph.seats.scribe, undefined, "a seat with no queue activity has no entry");

console.log("--- peer targets: the switcher's list ---");

const targets = peerTargets(graph, "pm");
assert.deepEqual(
	targets.map((t) => t.name),
	["impl", "qa"],
	"peers merge both directions, newest interaction first",
);
assert.deepEqual(targets[0], {
	name: "impl",
	sentCount: 2,
	receivedCount: 0,
	sentTo: true,
	receivedFrom: false,
	latestId: 4,
	latestSubject: "second route",
});
assert.equal(targets[1].receivedFrom, true, "qa is a received-from peer for pm");
assert.deepEqual(peerTargets(graph, "scribe"), [], "an isolated seat has no targets");
assert.deepEqual(peerTargets(graph, "nobody"), [], "an unknown seat has no targets");

console.log("--- single source: the renderer folds exactly what the view model says ---");

const rendered = formatChat([callEntry, resultEntry], { seat: "impl", time: false });
assert.ok(
	rendered.includes("(2 more lines — --full to expand)"),
	`the renderer must fold the view model's hidden count, got:\n${rendered}`,
);
const fullRendered = formatChat([callEntry, resultEntry], { seat: "impl", time: false, full: true });
assert.ok(fullRendered.includes("line three"), "--full must reveal the hidden tail");
assert.ok(!fullRendered.includes("more line"), "--full must not print a fold count");

console.log("VIEWMODEL TEST PASS (turns, collapse, peer graph, peer targets, single source)");
