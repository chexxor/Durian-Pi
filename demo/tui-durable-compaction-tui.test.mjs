import { test } from "node:test";
import assert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";
import { loadCodingAgent } from "../src/tui/durable/imports.mjs";
import { CapturingTerminal } from "../src/tui/durable/terminal.mjs";

// Build-spec §5: SKIP — never fail — when the coding-agent package is unavailable (names it).
try {
	await (await import("../src/tui/durable/imports.mjs")).loadCodingAgent();
} catch (err) {
	console.log(`SKIP ${new URL(import.meta.url).pathname.split("/").pop()} — coding-agent unavailable: ${err?.message ?? err}`);
	process.exit(0);
}

function visible(text) {
	return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

test("the TUI shows compaction running, then the committed boundary", { timeout: 20000 }, async () => {
	const { runtime, session, faux, hostSession } = await bootDurableTui({
		settings: { compaction: { keepRecentTokens: 1 } },
		responses: [fauxAssistantMessage("first answer")],
	});
	// Delay the summarization call so the running indicator is observable before it finishes.
	faux.appendResponses([
		async () => {
			await new Promise((resolve) => setTimeout(resolve, 500));
			return fauxAssistantMessage("the summary of earlier work");
		},
	]);
	const ca = await loadCodingAgent();
	const terminal = new CapturingTerminal();
	const mode = new ca.InteractiveMode(runtime, { terminal, tuiMode: "regular", initialThemeSetting: "dark" });
	try {
		await mode.init();
		await session.prompt("do some work");
		terminal.takeWrite();

		const compacting = session.compact();
		await new Promise((resolve) => setTimeout(resolve, 200));
		const during = visible(terminal.takeWrite());
		assert.match(during, /Compacting context/, "the running indicator is visible while compaction runs");

		await compacting;
		await new Promise((resolve) => setTimeout(resolve, 300));
		const after = visible(terminal.takeWrite());
		assert.match(after, /\[compaction\]/, "the boundary row is rendered");
		assert.match(after, /Compacted from/, "the boundary reports the pre-compaction token count");
	} finally {
		mode.stop?.();
		await runtime.dispose();
		hostSession.dispose?.();
	}
});
