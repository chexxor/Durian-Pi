// demo/readboundary-corrupt-live.test.mjs — one unreadable `pi.live` must not kill a
// command's whole pi-durable session (ROADMAP 70 / P5 / #110 / D44).
//
// The corruption is the exact F14 shape: a `pi.live` document whose base is `{}` plus an
// orphaned append, so materializing it throws
// `unresolvable path: ["generation","message","content",0]`. Against such a store:
//   - `run` and `serve` must START and keep driving — the corrupt seat is reported and
//     skipped, the pass continues (the driveOnce P5/#110 guard);
//   - `send` must START and report it against the SEAT and the repair, not surface a bare
//     storage error that does not say which conversation is wedged.
// Viewers (`ps`/`queue`/`status`) already tolerate it by reading via `openStore` (D44).
//
// Failing-first: before the `send` fix, `send` reported the raw `unresolvable path` with no
// seat and no repair (assertion below fails).
// Run: node demo/readboundary-corrupt-live.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, compilePersona, enqueueItem, registerSeat } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-readboundary-"));
const db = join(dir, "rig.sqlite");
const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

/** Run one CLI verb against the temp store; return { code, stdout, stderr, json }. */
function runCli(args) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["cli.mjs", ...args], {
			cwd: repoRoot,
			env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
		child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
		const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
		child.once("exit", (code) => {
			clearTimeout(timer);
			let json = null;
			try {
				json = JSON.parse(stdout.trim());
			} catch {
				// leave null
			}
			resolve({ code, stdout, stderr, json });
		});
	});
}

let failures = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

try {
	// Seed a store with a healthy seat and a corrupt one, then corrupt the corrupt one's pi.live.
	{
		const storage = await openNodeSqliteStorage(db);
		const harness = await Harness.open(storage, { models, registry }, ctx);
		let badId;
		await harness.commit(async (tx) => {
			const mk = async (name) => {
				const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await configure(tx, c.id, {
					model: { provider: "faux", modelId: "faux-seat" },
					instructions: compilePersona({ role: "worker" }),
				});
				await registerSeat(tx, name, c.id, "worker");
				return c.id;
			};
			badId = await mk("bad");
			await mk("good");
			await enqueueItem(tx, "pm", "bad", "work for the corrupt seat", "details");
		}, ctx);
		await harness.close(ctx);
		await storage.close(ctx);

		const s2 = await openNodeSqliteStorage(db);
		const page = await s2.scanDocuments(
			{ scope: { kind: "conversation", conversationId: badId }, at: "current", kind: "pi.live" },
			10,
			undefined,
			ctx,
		);
		const liveId = page.items[0].id;
		await s2.commit(
			[
				{
					type: "document.change",
					id: liveId,
					content: {
						kind: "delta",
						version: 1,
						ops: [["a", ["generation", "message", "content", 0, "text"], "orphan"]],
					},
				},
			],
			ctx,
		);
		await s2.close(ctx);
	}

	console.log("\n=== a corrupt pi.live must not kill the command ===\n");

	await check("run starts, reports the corrupt seat, and exits 0", async () => {
		const { code, stderr, json } = await runCli(["run"]);
		assert.equal(code, 0, `run must survive (got ${code}); stderr=${stderr.slice(0, 200)}`);
		assert.ok(json?.ok, `run ok:true; stdout=${JSON.stringify(json)}`);
		assert.ok(json.failedSeats.includes("bad"), `failedSeats names the corrupt seat: ${JSON.stringify(json.failedSeats)}`);
		assert.match(stderr, /wake-failed/, "the failure is reported on stderr");
		assert.match(stderr, /unresolvable path/, "the report names the exact F14 cause");
	});

	await check("serve starts, reports the corrupt seat, and exits 0", async () => {
		const { code, stderr, json } = await runCli(["serve", "--max-duration", "3"]);
		assert.equal(code, 0, `serve must survive (got ${code}); stderr=${stderr.slice(0, 200)}`);
		assert.ok(json?.ok, `serve ok:true; stdout=${JSON.stringify(json)}`);
		assert.ok(json.failedSeats.includes("bad"), `failedSeats names the corrupt seat: ${JSON.stringify(json.failedSeats)}`);
		assert.match(stderr, /unresolvable path/, "the report names the exact F14 cause");
	});

	await check("send starts and reports the seat + the repair (not a bare storage error)", async () => {
		const { code, stdout, json } = await runCli(["send", "bad", "hi"]);
		assert.equal(code, 1, `send must exit 1 (got ${code}); stdout=${stdout.slice(0, 200)}`);
		assert.equal(json?.ok, false, `send ok:false`);
		const error = String(json?.error);
		assert.match(error, /seat bad/, `the report names the SEAT: ${error}`);
		assert.match(error, /pi\.live document is unreadable/, `the report names the document: ${error}`);
		assert.match(error, /D44|repair-pi-live/, `the report names the repair: ${error}`);
	});

	await check("a viewer (queue) reads through the corruption", async () => {
		const { code, json } = await runCli(["queue"]);
		assert.equal(code, 0, `queue must read (got ${code})`);
		assert.ok(json?.ok, "queue ok:true");
	});

	console.log(
		failures === 0
			? "\nREAD-BOUNDARY PASS (a corrupt pi.live is tolerated + reported by run/serve/send)"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
process.exit(failures === 0 ? 0 : 1);
