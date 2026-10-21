import { test } from "node:test";
import assert from "node:assert/strict";
import { DurableEventBridge } from "../src/tui/durable/bridge.mjs";

test("a run maps to agent_start, then agent_end and agent_settled", () => {
	const bridge = new DurableEventBridge();
	assert.deepEqual(bridge.translate([{ type: "run_start", inputs: [1] }]).map((e) => e.type), ["agent_start"]);
	assert.deepEqual(bridge.translate([{ type: "run_end", inputs: [1] }]).map((e) => e.type), ["agent_end", "agent_settled"]);
});

test("a streamed assistant message is accumulated across message_update deltas", () => {
	const bridge = new DurableEventBridge();
	bridge.translate([{ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } }]);
	const updates = bridge.translate([
		{ type: "message_update", usage: {}, changes: [{ type: "text_delta", contentIndex: 0, delta: "hel" }] },
		{ type: "message_update", usage: {}, changes: [{ type: "text_delta", contentIndex: 0, delta: "lo" }] },
	]);
	assert.equal(updates.length, 2);
	assert.equal(updates[1].message.content[0].text, "hello");
	assert.equal(updates[1].assistantMessageEvent.type, "text_delta");
});

test("message_end emits the committed entry message and clears the accumulator", () => {
	const bridge = new DurableEventBridge();
	bridge.translate([{ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "x" }] } }]);
	const events = bridge.translate([
		{ type: "message_end", entry: { id: 2, conversationId: 1, kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "final" }] }] } },
	]);
	assert.equal(events[0].message.content[0].text, "final");
});

test("tool output trims and appends accumulate into partialResult", () => {
	const bridge = new DurableEventBridge();
	bridge.translate([{ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: {} }]);
	bridge.translate([{ type: "tool_execution_update", toolCallId: "c1", toolName: "bash", output: { set: "abc" } }]);
	const updates = bridge.translate([
		{ type: "tool_execution_update", toolCallId: "c1", toolName: "bash", output: { trimStart: 1, append: "Z" } },
	]);
	assert.equal(updates[0].partialResult.content[0].text, "bcZ");
});

test("tool_execution_end carries the committed result and isError", () => {
	const bridge = new DurableEventBridge();
	const events = bridge.translate([
		{
			type: "tool_execution_end",
			toolCallId: "c1",
			toolName: "bash",
			entry: { id: 4, conversationId: 1, kind: "pi.tool-result", model: [{ role: "toolResult", content: [{ type: "text", text: "boom" }], isError: true }] },
		},
	]);
	assert.equal(events[0].isError, true);
	assert.deepEqual(events[0].result.content, [{ type: "text", text: "boom" }]);
});

test("durable-only events are recorded as ignored instead of silently dropped", () => {
	const bridge = new DurableEventBridge();
	assert.deepEqual(bridge.translate([{ type: "snapshot" }]), []);
	assert.deepEqual(bridge.translate([{ type: "usage_changed", usage: {} }]), []);
	assert.deepEqual(bridge.ignoredEvents, ["snapshot", "usage_changed"]);
});
