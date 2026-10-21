import { test } from "node:test";
import assert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";

// Build-spec §5: SKIP — never fail — when the coding-agent package is unavailable (names it).
try {
	await (await import("../src/tui/durable/imports.mjs")).loadCodingAgent();
} catch (err) {
	console.log(`SKIP ${new URL(import.meta.url).pathname.split("/").pop()} — coding-agent unavailable: ${err?.message ?? err}`);
	process.exit(0);
}

test("compaction runs, reaches the TUI as a boundary, and rebuilds the context", { timeout: 20000 }, async () => {
	const { runtime, session } = await bootDurableTui({
		// A tiny keep window makes a two-message conversation compactable.
		settings: { compaction: { keepRecentTokens: 1 } },
		responses: [fauxAssistantMessage("first answer"), fauxAssistantMessage("the summary of earlier work")],
	});
	const events = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	try {
		await session.ready;
		await session.prompt("do some work");
		assert.equal(session.messages.length, 2);

		await session.compact();
		await new Promise((resolve) => setTimeout(resolve, 50));

		assert.ok(
			events.some((event) => event.type === "compaction_start"),
			"the running signal reaches the TUI",
		);
		assert.ok(
			events.some((event) => event.type === "compaction_end"),
			"the completion signal reaches the TUI",
		);

		const boundary = events.find((event) => event.type === "entry_appended" && event.entry.type === "compaction");
		assert.ok(boundary, "the compaction boundary reaches the TUI as a session entry");
		assert.equal(boundary.entry.summary, "the summary of earlier work");
		assert.ok(boundary.entry.tokensBefore > 0, "the boundary carries a pre-compaction token estimate");

		const entries = session.sessionManager.getEntries();
		assert.equal(entries[0].type, "compaction", "the latest compaction is the first entry");
		const context = session.sessionManager.buildContextEntries();
		assert.equal(context[0].type, "compaction", "the context is compaction-first");
		assert.ok(
			context.slice(1).every((entry) => entry.type === "message"),
			"the kept entries survive the boundary",
		);
	} finally {
		unsubscribe();
		await runtime.dispose();
	}
});
