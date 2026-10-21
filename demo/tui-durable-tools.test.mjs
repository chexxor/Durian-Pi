import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";

// Build-spec §5: SKIP — never fail — when the coding-agent package is unavailable (names it).
try {
	await (await import("../src/tui/durable/imports.mjs")).loadCodingAgent();
} catch (err) {
	console.log(`SKIP ${new URL(import.meta.url).pathname.split("/").pop()} — coding-agent unavailable: ${err?.message ?? err}`);
	process.exit(0);
}

function toolCall(name, args, id) {
	return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
}

function toolResults(session) {
	return session.messages.filter((message) => message.role === "toolResult");
}

test("a coding tool runs through the durable harness and its result enters the transcript", { timeout: 20000 }, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "durable-tui-tools-"));
	writeFileSync(join(cwd, "hello.txt"), "hi there\n");
	const { runtime, session } = await bootDurableTui({
		cwd,
		responses: [toolCall("read", { path: "hello.txt" }, "call-read"), fauxAssistantMessage("done reading")],
	});
	try {
		await session.ready;
		await session.prompt("read hello.txt");
		const results = toolResults(session);
		assert.equal(results.length, 1, "the read tool produced one result");
		assert.match(JSON.stringify(results[0].content), /hi there/);
		assert.equal(session.getLastAssistantText(), "done reading");
	} finally {
		await runtime.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("the codemode tool executes a script via the durable sandbox", { timeout: 30000 }, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "durable-tui-codemode-"));
	writeFileSync(join(cwd, "hello.txt"), "code mode file\n");
	const { runtime, session } = await bootDurableTui({
		cwd,
		responses: [
			toolCall("codemode", { code: "const r = await tools.read({ path: 'hello.txt' }); return r;" }, "call-code"),
			fauxAssistantMessage([fauxText("done with code")]),
		],
	});
	try {
		await session.ready;
		await session.prompt("use code mode to read hello.txt");
		const results = toolResults(session);
		assert.equal(results.length, 1, "the codemode tool produced one result");
		assert.match(JSON.stringify(results[0].content), /code mode file/);
		assert.equal(session.getLastAssistantText(), "done with code");
	} finally {
		await runtime.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});
