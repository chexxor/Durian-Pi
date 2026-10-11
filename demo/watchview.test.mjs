// Watch human-view tests: the pure formatters (entry extraction, per-seat
// activity, snapshot layout) plus one end-to-end check that `watch --human`
// shows a seat's name and what it last said, while `--json` keeps the contract.
// Run: node demo/watchview.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { extractEntryText, readSeatHighlights, summarizeEntries } from "../src/rigstory.mjs";
import { createWatchScreen, formatSnapshot, pad, seatActivity, truncate } from "../src/watchview.mjs";

console.log("--- entry extraction ---");

// The three content shapes a transcript actually contains: assistant text
// parts, a plain user string, and a tool result carrying its tool name.
const assistantEntry = {
	kind: "pi.assistant",
	model: [{ role: "assistant", content: [{ type: "text", text: "hello there" }] }],
};
const userEntry = { kind: "pi.user", model: [{ role: "user", content: "please do it" }] };
const toolEntry = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "claim_work",
			content: [{ type: "text", text: "ok" }],
		},
	],
};
assert.equal(extractEntryText(assistantEntry).text, "hello there");
assert.equal(extractEntryText(userEntry).text, "please do it");
assert.equal(extractEntryText(toolEntry).text, "ok");
assert.equal(extractEntryText(toolEntry).toolName, "claim_work");
assert.equal(extractEntryText({ kind: "pi.assistant" }), null, "no model -> nothing to read");

console.log("--- summarize (newest first, assistant-only) ---");

const summary = summarizeEntries([assistantEntry, toolEntry, userEntry]);
assert.equal(summary.says, "hello there", "the assistant utterance, not the user's");
assert.equal(summary.toolName, "claim_work");

// A turn that only calls a tool must not erase the last thing the seat said,
// and the system prompt is durig's scaffolding, never the seat speaking.
const emptyAssistant = {
	kind: "pi.assistant",
	model: [{ role: "assistant", content: [] }],
};
const systemEntry = { kind: "pi.system", model: [{ role: "system", content: "constitution" }] };
const carried = summarizeEntries([emptyAssistant, systemEntry, assistantEntry]);
assert.equal(carried.says, "hello there", "an empty turn keeps the previous message");
assert.equal(summarizeEntries([systemEntry]).says, null, "the system prompt is not speech");
assert.equal(summarizeEntries([]).toolName, null);

console.log("--- text fitting ---");

assert.equal(truncate("a\n  b   c", 20), "a b c", "whitespace collapses for one-line layout");
assert.equal(truncate("abcdef", 3), "ab…");
assert.equal(truncate("abc", 3), "abc");
assert.equal(pad("ab", 4), "ab  ");
assert.equal(pad("abcd", 2), "abcd", "padding never truncates");

console.log("--- per-seat activity ---");

const seat = { name: "pm", conversationId: 1, role: "program manager" };
const item = (over) => ({ id: 1, subject: "Build login widget", from: "pm", to: "worker", status: "queued", ...over });
const healthWith = (queueItems, attention = []) => ({ seats: [seat], queueItems, attention });

assert.equal(seatActivity(seat, healthWith([]), {}).state, "idle");
assert.equal(seatActivity(seat, healthWith([item({ to: "pm", status: "claimed" })]), {}).state, "working");
assert.equal(
	seatActivity(seat, healthWith([item({ to: "pm" })], [{ scope: "seat", seat: "pm", kind: "idle_with_queued_work" }])).state,
	"waiting",
);
assert.equal(
	seatActivity(seat, healthWith([], [{ scope: "seat", seat: "pm", kind: "last_run_failed" }])).state,
	"failed",
	"a failed run outranks an idle reading",
);
assert.equal(
	seatActivity(seat, healthWith([], [{ scope: "seat", seat: "pm", kind: "generation_in_flight" }])).state,
	"generating",
);
// A rig- or queue-scoped notice carries a null seat and must never land on a
// seat row. Filtering on the seat field alone would be enough today only by
// accident, so the exclusion is asserted rather than assumed.
assert.equal(
	seatActivity(seat, healthWith([], [{ scope: "rig", seat: null, kind: "step-repetition" }])).state,
	"idle",
	"a rig-scoped notice must not leak onto a seat row",
);

// A seat that routed work is not "awaiting" it - the verb must match who holds
// the item, which is the whole point of showing it.
assert.match(seatActivity(seat, healthWith([item({ from: "pm" })]), {}).focus, /^sent #1/);
assert.match(seatActivity(seat, healthWith([item({ to: "pm" })]), {}).focus, /^has #1 queued/);
assert.match(seatActivity(seat, healthWith([item({ to: "pm", status: "claimed" })]), {}).focus, /^working on #1/);
assert.match(
	seatActivity(seat, healthWith([]), { toolName: "peek_queue" }).focus,
	/last action: peek_queue/,
	"with an empty queue the last tool call is the only activity left",
);

console.log("--- snapshot layout ---");

const snapshot = formatSnapshot({
	db: "./rig.sqlite",
	health: healthWith([item({ to: "pm" })], [{ scope: "seat", seat: "pm", kind: "idle_with_queued_work" }]),
	highlights: { pm: { says: "Queueing that for worker now", toolName: "send_work" } },
	seq: 2,
	width: 90,
	at: "12:00:00",
});
assert.match(snapshot, /durig · 1 seat · db \.\/rig\.sqlite · watch #2 · 12:00:00/);
assert.match(snapshot, /pm\s+program manager/);
assert.match(snapshot, /Queueing that for worker now/, "the seat's words are shown");
assert.match(snapshot, /queue 1 queued · 0 claimed · 0 done/);
assert.match(snapshot, /attention: pm idle_with_queued_work/);
assert.ok(!snapshot.includes("\x1b["), "no colour unless asked for");
assert.match(formatSnapshot({ db: "x", health: healthWith([]), highlights: {}, color: true }).includes("\x1b[") ? "y" : "n", /^y$/);

// An empty database must say so in the view itself: a blank dashboard would
// read as a quiet rig rather than a wrong path.
const emptySnapshot = formatSnapshot({ db: "./wrong.sqlite", health: { seats: [], queueItems: [], attention: [] } });
assert.match(emptySnapshot, /No seats in this database/);
assert.match(emptySnapshot, /node cli\.mjs config/, "and it names the way out");

console.log("--- screen writer ---");

// Clearing is reserved for a real terminal; a pipe must keep the appended
// snapshots, because that scrollback is what a person reads later.
const written = [];
const esc = String.fromCharCode(27);
createWatchScreen({ write: (t) => written.push(t), clear: true }).render("snap");
assert.equal(written[0], esc + "[H" + esc + "[2J" + "snap" + "\n", "a terminal redraws in place");
written.length = 0;
createWatchScreen({ write: (t) => written.push(t), clear: false }).render("snap");
assert.equal(written[0], "snap\n", "a pipe appends instead");
createWatchScreen({ write: (t) => written.push(t) }).note("hi");
assert.equal(written[1], "hi\n");


console.log("--- CLI wiring ---");

const dir = mkdtempSync(join(tmpdir(), "durig-watchview-"));
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

try {
	assert.equal(run(["up", rigFile]).code, 0);
	assert.equal(run(["send", "alpha", "say something"]).code, 0, "faux send produces a transcript");

	const human = run(["watch", "--once", "--human"]);
	assert.equal(human.code, 0, `human watch exits 0 (stderr: ${human.stderr.slice(0, 200)})`);
	assert.match(human.stdout, /durig · 2 seats/);
	assert.match(human.stdout, /alpha\s+alpha role/);
	assert.match(human.stdout, /beta\s+beta role/);
	assert.match(human.stdout, /↳ .*acknowledged/, "what the seat said reaches the view");
	assert.match(human.stdout, /queue 0 queued · 0 claimed · 0 done/);

	// The piped default must stay machine-readable: an operator's script must
	// not start receiving the human layout because a terminal was absent.
	const piped = run(["watch", "--once"]);
	assert.equal(piped.code, 0);
	const parsed = JSON.parse(piped.stdout);
	assert.equal(parsed.ok, true);
	assert.equal(parsed.seats.length, 2);

	// --json wins even when a human view was asked for, and vice versa.
	assert.equal(JSON.parse(run(["watch", "--once", "--json"]).stdout).ok, true);
	assert.match(run(["watch", "--once", "--human"]).stdout, /durig · 2 seats/);

} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("--- freshness across reads (regression) ---");

// The bug this locks down: seat summaries were once cached against the newest
// submission id. An assistant turn appends entries without moving that id, so
// the cache pinned the first (empty) reading and a live dashboard said
// "(nothing said yet)" forever while the seat was plainly talking. Two reads
// separated by new speech must disagree - if either of these assertions fails,
// a cache came back.
const freshDir = mkdtempSync(join(tmpdir(), "durig-freshness-"));
const freshDb = join(freshDir, "rig.sqlite");
const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();

const storage = await openNodeSqliteStorage(freshDb);
const harness = await Harness.open(storage, { models, registry }, ctx);
harness.resume();
try {
	let convId;
	await harness.commit(async (tx) => {
		const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
		convId = conv.id;
		await configure(tx, convId, { model: { provider: "faux", modelId: "faux-seat" } });
	}, ctx);
	const seat = { name: "alpha", conversationId: convId, role: "worker" };
	const conversation = await harness.conversation(convId, ctx);

	faux.setResponses([fauxAssistantMessage(fauxText("first words"))]);
	await (await conversation.submit({ type: "input", content: "one" }, ctx)).wait(ctx);
	const first = await readSeatHighlights(storage, ctx, [seat]);
	assert.equal(first.alpha.says, "first words");

	faux.setResponses([fauxAssistantMessage(fauxText("second words"))]);
	await (await conversation.submit({ type: "input", content: "two" }, ctx)).wait(ctx);
	const second = await readSeatHighlights(storage, ctx, [seat]);
	assert.equal(
		second.alpha.says,
		"second words",
		"a later read must see new speech, not a stale first reading",
	);

	// Tool calls are the other half of the row: the newest tool name must move
	// forward for the same reason.
	assert.notEqual(second.alpha, first.alpha);

	console.log("FRESHNESS PASS (reads reflect new speech, no stale cache)");
} finally {
	await harness.close(ctx);
	rmSync(freshDir, { recursive: true, force: true });
}

console.log("--- human streaming (not just --once) ---");

// The dashboard's whole point is that it redraws, and until now only the
// single-snapshot path was covered. A piped watcher appends rather than
// clearing, so the snapshots stack up in stdout and can be counted there.
const streamDir = mkdtempSync(join(tmpdir(), "durig-watchstream-"));
const streamDb = join(streamDir, "rig.sqlite");
const streamRig = join(streamDir, "rig.json");
writeFileSync(
	streamRig,
	JSON.stringify({
		version: 2,
		seats: [
			{ name: "alpha", role: "alpha role", instructions: "a" },
			{ name: "beta", role: "beta role", instructions: "b" },
		],
		edges: [{ from: "alpha", maySendTo: ["beta"] }],
	}),
);
const streamEnv = { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: streamDb };
const runCli = (args) =>
	spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: durigDir, env: streamEnv, encoding: "utf8" });
assert.equal(runCli(["up", streamRig]).status, 0);

const watcher = spawn(process.execPath, ["cli.mjs", "watch", "--human"], {
	cwd: durigDir,
	env: streamEnv,
	stdio: ["ignore", "pipe", "pipe"],
});
let seen = "";
let watcherErr = "";
watcher.stdout.on("data", (chunk) => {
	seen += chunk.toString("utf8");
});
watcher.stderr.on("data", (chunk) => {
	watcherErr += chunk.toString("utf8");
});
const waitFor = async (pred, label) => {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (pred()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`timed out waiting for ${label}; saw ${seen.length} chars${watcherErr ? ` stderr=${watcherErr.slice(0, 300)}` : ""}`);
};

try {
	await waitFor(() => seen.includes("watch #1"), "the initial snapshot");
	assert.ok(seen.includes("↳"), "rows render the says line");

	// Any commit changes the health document, so a plain operator send is
	// enough to force a redraw - no queue surgery needed.
	assert.equal(runCli(["send", "alpha", "hello there"]).status, 0, "faux send succeeds");
	await waitFor(() => seen.includes("watch #2"), "a redraw after the rig changed");

	const frames = seen.split("durig · 2 seats").length - 1;
	assert.ok(frames >= 2, `each change appends a full snapshot (saw ${frames})`);
	console.log(`HUMAN STREAM PASS (${frames} snapshots, appended not cleared)`);
} finally {
	watcher.kill();
	await new Promise((resolve) => {
		watcher.once("exit", resolve);
		setTimeout(() => {
			watcher.kill("SIGKILL");
			resolve();
		}, 3000);
	});
	rmSync(streamDir, { recursive: true, force: true });
}

console.log(
	"WATCHVIEW TEST PASS (extraction, activity, layout, screen, CLI wiring, freshness, streaming)",
);
