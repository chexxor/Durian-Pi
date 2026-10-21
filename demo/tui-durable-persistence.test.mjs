import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";

// Build-spec §5: SKIP — never fail — when the coding-agent package is unavailable (names it).
try {
	await (await import("../src/tui/durable/imports.mjs")).loadCodingAgent();
} catch (err) {
	console.log(`SKIP ${new URL(import.meta.url).pathname.split("/").pop()} — coding-agent unavailable: ${err?.message ?? err}`);
	process.exit(0);
}

async function openSqlite(path) {
	const mod = await import("@earendil-works/pi-durable/storage/sqlite/node");
	return mod.openNodeSqliteStorage(path);
}

test("a typed message survives a close and reopen of the durable store", { timeout: 20000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "durable-tui-persist-"));
	const dbPath = join(dir, "session.sqlite");
	try {
		const first = await bootDurableTui({
			responses: [fauxAssistantMessage("stored reply")],
			storage: await openSqlite(dbPath),
		});
		await first.session.ready;
		await first.session.prompt("remember me");
		assert.equal(first.session.messages.length, 2);
		await first.runtime.dispose();

		const second = await bootDurableTui({ storage: await openSqlite(dbPath) });
		await second.session.ready;
		assert.equal(second.session.messages.length, 2, "the transcript is loaded from the reopened store");
		assert.equal(second.session.getLastAssistantText(), "stored reply");
		await second.runtime.dispose();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
