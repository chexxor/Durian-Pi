import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMessageChanges, assistantMessageEventFor, sessionEntryFromDurable, toolResultFromDurableEvent } from "../src/tui/durable/translate.mjs";

test("sessionEntryFromDurable maps a user entry to a coding-agent message entry", () => {
	const entry = { id: 7, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: "hi" }] };
	const mapped = sessionEntryFromDurable(entry, "2026-01-01T00:00:00.000Z");
	assert.equal(mapped.type, "message");
	assert.equal(mapped.id, "7");
	assert.equal(mapped.timestamp, "2026-01-01T00:00:00.000Z");
	assert.equal(mapped.message.content, "hi");
});

test("sessionEntryFromDurable drops bookkeeping and system entries rather than rendering them", () => {
	const system = { id: 1, conversationId: 1, kind: "pi.system", model: [{ role: "system", content: "" }] };
	const reset = { id: 2, conversationId: 1, kind: "pi.reset" };
	assert.equal(sessionEntryFromDurable(system, "t"), undefined);
	assert.equal(sessionEntryFromDurable(reset, "t"), undefined);
});

test("applyMessageChanges accumulates text deltas on a started block", () => {
	const message = { role: "assistant", content: [], usage: {} };
	const next = applyMessageChanges(message, [
		{ type: "text_start", contentIndex: 0, block: { type: "text", text: "he" } },
		{ type: "text_delta", contentIndex: 0, delta: "llo" },
	]);
	assert.equal(next.content[0].text, "hello");
	// The source message is not mutated.
	assert.deepEqual(message.content, []);
});

test("applyMessageChanges appends a delta to text already present on the partial", () => {
	const message = { role: "assistant", content: [{ type: "text", text: "he" }] };
	const next = applyMessageChanges(message, [{ type: "text_delta", contentIndex: 0, delta: "llo" }]);
	assert.equal(next.content[0].text, "hello");
});

test("applyMessageChanges applies toolcall argument deltas at a path", () => {
	const message = {
		role: "assistant",
		content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "/a" } }],
	};
	const next = applyMessageChanges(message, [
		{ type: "toolcall_delta", contentIndex: 0, path: ["path"], delta: "/b" },
	]);
	assert.equal(next.content[0].arguments.path, "/a/b");
});

test("applyMessageChanges lets a whole-message change override earlier deltas", () => {
	const message = { role: "assistant", content: [{ type: "text", text: "" }] };
	const replacement = { role: "assistant", content: [{ type: "text", text: "authoritative" }] };
	const next = applyMessageChanges(message, [
		{ type: "text_delta", contentIndex: 0, delta: "ignored" },
		{ type: "message", message: replacement },
	]);
	assert.equal(next.content[0].text, "authoritative");
});

test("assistantMessageEventFor names the change so a consumer can switch on it", () => {
	assert.equal(assistantMessageEventFor({ type: "text_delta", contentIndex: 0, delta: "x" }, {}).type, "text_delta");
	assert.equal(assistantMessageEventFor({ type: "thinking_delta", contentIndex: 0, delta: "x" }, {}).type, "thinking_delta");
	assert.equal(assistantMessageEventFor({ type: "block", contentIndex: 0, block: {} }, {}).type, "message");
});

test("toolResultFromDurableEvent reads a committed tool-result entry", () => {
	const event = {
		entry: {
			id: 3,
			conversationId: 1,
			kind: "pi.tool-result",
			model: [{ role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "out" }], isError: true }],
		},
	};
	const result = toolResultFromDurableEvent(event);
	assert.equal(result.isError, true);
	assert.deepEqual(result.content, [{ type: "text", text: "out" }]);
});

test("toolResultFromDurableEvent reads a nested call result", () => {
	const result = toolResultFromDurableEvent({ result: { content: [{ type: "text", text: "nested" }], isError: false } });
	assert.deepEqual(result.content, [{ type: "text", text: "nested" }]);
	assert.equal(result.isError, false);
});
