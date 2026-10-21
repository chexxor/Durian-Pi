import { test } from "node:test";
import assert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";
import { loadCodingAgent } from "../src/tui/durable/imports.mjs";
import { CapturingTerminal } from "../src/tui/durable/terminal.mjs";

// Build-spec §5: the dependency pin (#2095) may not have landed, so SKIP — never fail — when the
// coding-agent package is unavailable. A skip that NAMES the missing package, never a silent pass.
try {
	await (await import("../src/tui/durable/imports.mjs")).loadCodingAgent();
} catch (err) {
	console.log(`SKIP ${new URL(import.meta.url).pathname.split("/").pop()} — coding-agent unavailable: ${err?.message ?? err}`);
	process.exit(0);
}

// Strip the ANSI the renderer emits so assertions can read the frame as text.
function visible(text) {
	return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

test("the real InteractiveMode renders a durable transcript and streams a durable answer", { timeout: 20000 }, async () => {
	const { runtime, session, faux, hostSession } = await bootDurableTui({
		responses: [fauxAssistantMessage("hello from durable")],
	});
	const ca = await loadCodingAgent();
	const terminal = new CapturingTerminal();
	const mode = new ca.InteractiveMode(runtime, { terminal, tuiMode: "regular", initialThemeSetting: "dark" });
	try {
		await mode.init();
		await session.prompt("say hello");
		// The TUI repaints on a debounced tick after the durable commit lands.
		await new Promise((resolve) => setTimeout(resolve, 250));

		const frame = visible(terminal.writes);
		assert.match(frame, /say hello/, "the user message from durable is rendered");
		assert.match(frame, /hello from durable/, "the assistant answer from durable is rendered");

		assert.equal(session.messages.length, 2);
		assert.equal(session.getLastAssistantText(), "hello from durable");
	} finally {
		mode.stop?.();
		await runtime.dispose();
		hostSession.dispose?.();
		void faux;
	}
});
