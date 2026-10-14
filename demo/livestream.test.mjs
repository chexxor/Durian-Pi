// Live-stream tests (ROADMAP 40c): a follower process reads the in-flight
// assistant partial from the `pi.live` document and shows it as streaming, before
// the turn commits - then the committed entry supersedes it. The partial must
// never be rendered or carried as an entry, because it is not committed history.
// Run: node demo/livestream.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { partialView } from "../src/viewmodel.mjs";
import { formatPartial } from "../src/chatview.mjs";

console.log("--- partialView: the in-flight message as a value ---");

assert.equal(partialView({}), null, "idle (no generation) is null, not an empty partial");
assert.equal(
	partialView({ generation: { message: { role: "assistant", content: [] } } })?.hasContent,
	false,
	"a generation with no content yet has nothing to show",
);

const live = {
	generation: {
		attempt: 2,
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "weighing the options" },
				{ type: "text", text: "Forming the reply" },
			],
		},
	},
	tools: [
		{ callId: "t1", name: "claim_work", status: "running" },
		{ callId: "t0", name: "peek_queue", status: "done" },
	],
};
const pv = partialView(live);
assert.equal(pv.text, "Forming the reply");
assert.equal(pv.thinking, "weighing the options");
assert.deepEqual(pv.tools.map((t) => t.name), ["claim_work"], "only a running tool is progress");
assert.equal(pv.attempt, 2);

console.log("--- formatPartial: visibly NOT a committed turn ---");

assert.equal(formatPartial(null), "", "no partial renders nothing");
const rendered = formatPartial(pv, { seat: "impl", color: false });
assert.match(rendered, /streaming… \(not yet committed\)/, "states plainly that it is not committed");
assert.match(rendered, /◌/, "uses the streaming marker");
assert.ok(!rendered.includes("▌"), "never uses the committed-turn marker");
assert.match(rendered, /weighing the options/, "thinking is shown");
assert.match(rendered, /Forming the reply/, "text is shown");
assert.match(rendered, /⚙ running: claim_work/, "the running tool is surfaced");

console.log("--- CLI: a follower sees the partial, then the committed entry ---");

const dir = mkdtempSync(join(tmpdir(), "durig-livestream-"));
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = join(dir, "rig.sqlite");
const rigFile = join(dir, "rig.json");
writeFileSync(
	rigFile,
	JSON.stringify({
		version: 2,
		seats: [
			{ name: "alpha", role: "alpha role", instructions: "a" },
			{ name: "beta", role: "beta role", instructions: "b" },
		],
		edges: [{ from: "alpha", maySendTo: ["beta"] }],
	}),
);
const env = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db };
const run = (args) => {
	const res = spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: durigDir, env, encoding: "utf8" });
	return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};

// The live partial is written directly to the store. A real generation is too
// fast under the faux provider to observe mid-flight, so the fixture stands in
// for "a run is in flight"; the settle half below is a real `send`, so the
// supersede path is exercised rather than simulated.
async function setLive(conversationId, value) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const rec = await storage.findDocument(
			{ kind: "pi.live", scope: { kind: "conversation", conversationId } },
			"current",
			BACKGROUND_CONTEXT,
		);
		await storage.commit([
			{ type: "document.change", id: rec.id, content: { version: 1, kind: "base", value } },
		]);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}
async function conversationOf(name) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const rec = await storage.findDocument(
			{ kind: "durig.seats", scope: { kind: "session" } },
			"current",
			BACKGROUND_CONTEXT,
		);
		const value = (await storage.document(rec.id, "current", BACKGROUND_CONTEXT))?.value ?? {};
		return value.seats?.[name]?.conversationId;
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
}

try {
	assert.equal(run(["up", rigFile]).code, 0, "up");
	const conv = await conversationOf("alpha");
	const PARTIAL = "STREAMING-PARTIAL-MARKER alpha is thinking out loud";
	await setLive(conv, {
		generation: { attempt: 1, message: { role: "assistant", content: [{ type: "text", text: PARTIAL }] } },
	});

	const follower = spawn(process.execPath, ["cli.mjs", "log", "alpha", "--follow", "--json"], {
		cwd: durigDir,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let seen = "";
	let followerErr = "";
	follower.stdout.on("data", (c) => (seen += c.toString("utf8")));
	follower.stderr.on("data", (c) => (followerErr += c.toString("utf8")));

	// Each `out()` is one pretty-printed JSON document (multi-line), so the stream is
	// scanned for balanced objects rather than split on newlines. A partial carries
	// a `partial` key and never `entries`, so the two are distinguishable by shape.
	const extractObjects = (text) => {
		const objects = [];
		let depth = 0;
		let start = -1;
		let inString = false;
		let escaped = false;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (inString) {
				if (escaped) escaped = false;
				else if (ch === "\\") escaped = true;
				else if (ch === '"') inString = false;
				continue;
			}
			if (ch === '"') inString = true;
			else if (ch === "{") {
				if (depth === 0) start = i;
				depth++;
			} else if (ch === "}") {
				depth--;
				if (depth === 0 && start >= 0) {
					try {
						objects.push(JSON.parse(text.slice(start, i + 1)));
					} catch {
						// A half-written object is skipped; the next poll re-reads it whole.
					}
					start = -1;
				}
			}
		}
		return objects;
	};
	const parsedLines = () => extractObjects(seen);
	const waitFor = async (pred, label) => {
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			if (pred(parsedLines())) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(
			`timed out waiting for ${label}; objects=${JSON.stringify(parsedLines().slice(-4))}${followerErr ? ` stderr=${followerErr.slice(0, 200)}` : ""}`,
		);
	};

	try {
		await waitFor(
			(objs) => objs.some((o) => o.partial?.text === PARTIAL && o.partial.hasContent === true),
			"the in-flight partial",
		);
		// The cardinal rule: the partial is not history and must never be emitted
		// inside an `entries` array, where a replay would treat it as committed.
		assert.ok(
			!parsedLines().some((o) => Array.isArray(o.entries) && o.entries.some((e) => (e.text ?? "").includes(PARTIAL))),
			"the partial is never emitted as a committed entry",
		);

		// Settle: withdraw the in-flight generation, then a real send appends the
		// committed assistant entry. Clearing first keeps the harness from starting
		// against a fabricated in-flight run; the committed half is a real run.
		await setLive(conv, {});
		const sent = run(["send", "alpha", "second message"]);
		assert.equal(sent.code, 0, `send settles the run: ${sent.stdout.slice(0, 200)} ${sent.stderr.slice(0, 200)}`);
		await waitFor(
			(objs) => objs.some((o) => Array.isArray(o.entries) && o.entries.some((e) => (e.text ?? "").includes("acknowledged"))),
			"the committed reply",
		);
		await waitFor((objs) => objs.some((o) => o.partial === null), "the partial withdrawn after settle");
		assert.ok(
			!parsedLines().some((o) => Array.isArray(o.entries) && o.entries.some((e) => (e.text ?? "").includes(PARTIAL))),
			"the partial never becomes history after settle either",
		);
		console.log("LIVESTREAM TEST PASS (partial view, distinct rendering, follower sees it, committed entry supersedes)");
	} finally {
		follower.kill();
		await new Promise((resolve) => {
			follower.once("exit", resolve);
			setTimeout(() => {
				follower.kill("SIGKILL");
				resolve();
			}, 3000);
		});
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
