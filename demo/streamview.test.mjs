// Live seat view tests: the renderer labels each generation, streams text and
// thinking, surfaces tool calls and errors, and never writes to stdout. The
// provider wrapper forwards every event unchanged while mirroring it.
// Run: node demo/streamview.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

import {
	createLiveRenderer,
	wrapProviderWithLiveView,
} from "../src/streamview.mjs";

// --- renderer: labelled, ordered, plain when colour is off -----------------
{
	let buf = "";
	const r = createLiveRenderer({ write: (s) => (buf += s), color: false });
	const ctx = r.begin("pm");
	r.event(ctx, { type: "thinking_delta", delta: "weighing options" });
	r.event(ctx, { type: "thinking_end", content: "weighing options" });
	r.event(ctx, { type: "text_start", contentIndex: 0 });
	r.event(ctx, { type: "text_delta", delta: "Decomposing" });
	r.event(ctx, { type: "text_delta", delta: " into items." });
	r.event(ctx, { type: "text_end", content: "Decomposing into items." });
	r.event(ctx, {
		type: "toolcall_end",
		contentIndex: 1,
		toolCall: { name: "send_work", arguments: { to: "impl", subject: "Spike" } },
	});
	r.end(ctx, { type: "done", reason: "toolUse" });

	assert.match(buf, /── pm /, "header labels the seat");
	assert.match(buf, /weighing options/, "thinking text rendered");
	assert.match(buf, /Decomposing into items\./, "text deltas streamed in order");
	assert.ok(
		buf.indexOf("Decomposing") < buf.indexOf("send_work"),
		"output follows event order",
	);
	assert.match(buf, /⚙ send_work/, "tool call surfaced with its name");
	assert.match(buf, /"to":"impl"/, "tool arguments shown");
	assert.match(buf, /── pm done \(toolUse\)/, "footer names the outcome");
	assert.ok(!buf.includes("\x1b["), "colour disabled means no ANSI escapes");
}

// --- renderer: colour on / long tool args complete / error branch ----------
{
	let buf = "";
	const r = createLiveRenderer({ write: (s) => (buf += s), color: true });
	const ctx = r.begin("qa");
	r.event(ctx, { type: "text_delta", delta: "hi" });
	r.event(ctx, {
		type: "toolcall_end",
		contentIndex: 0,
		toolCall: { name: "claim_work", arguments: { body: "x".repeat(500) } },
	});
	r.event(ctx, { type: "error", reason: "error" });
	r.end(ctx, { type: "error", reason: "error" });

	assert.ok(buf.includes("\x1b[36m"), "seat label coloured when enabled");
	assert.ok(
		buf.includes("x".repeat(500)),
		"tool arguments are never clipped: a live viewer must see the whole command too",
	);
	assert.match(buf, /✖ error \(error\)/, "error event rendered");
	assert.match(buf, /── qa error \(error\)/, "error footer rendered");
}

// --- renderer: a transport failure outside the stream is reported ----------
{
	let buf = "";
	const r = createLiveRenderer({ write: (s) => (buf += s), color: false });
	const ctx = r.begin("impl");
	r.failure(ctx, new Error("socket closed"));
	assert.match(buf, /socket closed/, "failure surfaces with its message");
}

// --- wrapper: forwards every event and still yields a result ---------------
{
	const events = [
		{ type: "text_start", contentIndex: 0, partial: {} },
		{ type: "text_delta", contentIndex: 0, delta: "ok", partial: {} },
		{ type: "done", reason: "stop", message: { role: "assistant" } },
	];
	const fakeProvider = {
		id: "fake",
		stream: () => {
			const s = new AssistantMessageEventStream();
			for (const ev of events) s.push(ev);
			s.end({ role: "assistant", content: [] });
			return s;
		},
		streamSimple: () => {
			throw new Error("streamSimple should not be called by this test");
		},
	};
	let seen = "";
	const renderer = createLiveRenderer({ write: (s) => (seen += s), color: false });
	const wrapped = wrapProviderWithLiveView(fakeProvider, {
		renderer,
		getSeat: () => "theorist",
	});

	const outStream = wrapped.stream({}, {}, {});
	const forwarded = [];
	for await (const ev of outStream) forwarded.push(ev);

	assert.equal(forwarded.length, events.length, "every event forwarded");
	assert.match(seen, /── theorist /, "wrapper labels with the live seat");
	assert.match(seen, /ok/, "wrapper rendered the streamed text");
	assert.match(seen, /── theorist done \(stop\)/, "wrapper closes the block");

	const result = await outStream.result();
	assert.ok(result, "mirror still resolves a terminal result for consumers");

	console.log("STREAMVIEW TEST PASS (labels, ordering, tools, errors, forwarding)");
	process.exit(0);
}
