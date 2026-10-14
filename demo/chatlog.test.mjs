// Chat-log tests: rendering a seat's conversation for a human (timestamps,
// elapse deltas, per-role styling, collapsed tool output), the JSON contract,
// and --follow streaming new entries as they commit.
// Run: node demo/chatlog.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildTurns,
	extractToolCalls,
	formatArgs,
	formatChat,
	formatChatEntry,
	formatDelta,
} from "../src/chatview.mjs";

console.log("--- elapsed-time formatting ---");

assert.equal(formatDelta(0), "", "sub-second gaps are noise");
assert.equal(formatDelta(900), "");
assert.equal(formatDelta(1000), "+1s");
assert.equal(formatDelta(45_000), "+45s");
assert.equal(formatDelta(60_000), "+1m");
assert.equal(formatDelta(88_000), "+1m28s");
assert.equal(formatDelta(3_600_000), "+1h");
assert.equal(formatDelta(3_780_000), "+1h03m");
assert.equal(formatDelta(90_000_000), "+1d01h");
assert.equal(formatDelta(-5), "", "a clock that went backwards says nothing");
assert.equal(formatDelta(Number.NaN), "");

console.log("--- row rendering ---");

const at = (ms) => ({ timestamp: 1_700_000_000_000 + ms });
const user = { kind: "pi.user", model: [{ role: "user", content: "do the thing", ...at(0) }] };
const assistant = {
	kind: "pi.assistant",
	model: [{ role: "assistant", content: [{ type: "text", text: "line one\nline two" }], ...at(1000) }],
};
const tool = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "claim_work",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			...at(2000),
		},
	],
};
const system = { kind: "pi.system", model: [{ role: "system", content: "constitution", ...at(3000) }] };

assert.deepEqual(formatChatEntry(user, { seat: "pm" }), ["▌ you › do the thing"]);
assert.deepEqual(formatChatEntry(assistant, { seat: "pm" }), [
	"▌ pm › line one",
	"       line two",
]);
assert.deepEqual(formatChatEntry(tool, { seat: "pm" }), ["⚙ claim_work() ✓ ok"]);

// Scaffolding and prose-less turns are not conversation.
assert.equal(formatChatEntry(system, { seat: "pm" }), null);
assert.equal(
	formatChatEntry({ kind: "pi.assistant", model: [{ role: "assistant", content: [], ...at(0) }] }, { seat: "pm" }),
	null,
	"a turn that only called a tool has nothing to show",
);
assert.equal(formatChatEntry(null), null);

console.log("--- timestamps and elapse deltas ---");

// 12:03:10 then +12s then +1m28s, with the delta only where it is legible.
const base = new Date(2026, 9, 10, 12, 3, 10).getTime();
const timed = [
	{ kind: "pi.user", model: [{ role: "user", content: "first", timestamp: base }] },
	{ kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "second" }], timestamp: base + 12_000 }] },
	{ kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "third" }], timestamp: base + 100_000 }] },
];
const stream = formatChat(timed, { seat: "pm", width: 120 });
const streamLines = stream.split("\n");
assert.match(streamLines[0], /^12:03:10\s+▌ you › first$/);
assert.match(streamLines[1], /^12:03:22\s+\+12s\s+▌ pm {2}› second$/);
assert.match(streamLines[2], /^12:04:50\s+\+1m28s\s+▌ pm {2}› third$/, "delta is measured from the previous row, not the first");
assert.ok(!stream.includes("\x1b["), "no colour unless asked for");

// A day boundary gets a rule, because a delta there would read as "hours ago".
const acrossDays = formatChat(
	[
		{ kind: "pi.user", model: [{ role: "user", content: "before", timestamp: base }] },
		{
			kind: "pi.user",
			model: [{ role: "user", content: "after", timestamp: base + 26 * 3600 * 1000 }],
		},
	],
	{ seat: "pm", width: 120 },
);
assert.match(acrossDays, /── 2026-10-11 ──/, "the day change is called out");

console.log("--- collapsed tool output ---");

const longTool = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "claim_work",
			content: [{ type: "text", text: "line one\nline two\nline three" }],
			isError: false,
			...at(0),
		},
	],
};
const collapsed = formatChat([longTool], { seat: "pm", width: 100, full: false });
assert.match(collapsed, /claim_work\(\) ✓ line one/);
assert.match(collapsed, /⎿ \(2 more lines — --full to expand\)/, "capping is always signposted");
assert.ok(!collapsed.includes("line two"), "collapsed by default");

const expanded = formatChat([longTool], { seat: "pm", width: 100, full: true });
assert.match(expanded, /line two/);
assert.match(expanded, /line three/);
assert.ok(!expanded.includes("more lines"), "nothing is hidden when fully expanded");

console.log("--- error and colour ---");

const failed = {
	kind: "pi.tool-result",
	model: [
		{ role: "toolResult", toolName: "send_work", content: [{ type: "text", text: "no org edge" }], isError: true, ...at(0) },
	],
};
// Success/failure is never carried by hue alone: the glyph differs too.
assert.match(formatChat([failed], { seat: "pm", full: true }), /send_work\(\) ✗ no org edge/);

const colored = formatChat([user, tool], { seat: "pm", color: true, width: 120, full: true });
assert.ok(colored.includes("\x1b["), "colour is applied when asked for");

const tinted = formatChat([tool], { seat: "pm", color: true, toolBg: true, theme: "dark", full: true });
assert.ok(tinted.includes("\x1b[48;5;236m"), "dark tool tint when requested");
const lightTint = formatChat([tool], { seat: "pm", color: true, toolBg: true, theme: "light", full: true });
assert.ok(lightTint.includes("\x1b[48;5;253m"), "and a light tint for a light terminal");
assert.ok(!formatChat([tool], { seat: "pm", color: true }).includes("\x1b[48;5;"), "never tinted unless asked");

console.log("--- turn grouping ---");

// An assistant entry can both speak and call tools. The call and its matching
// result are one act of work, so they are one turn with one timestamp; the prose
// is its own turn.
const callEntry = {
	kind: "pi.assistant",
	model: [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "I will claim it." },
				{ type: "toolCall", id: "c1", name: "claim_work", arguments: {} },
			],
			...at(0),
		},
	],
};
const callResult = {
	kind: "pi.tool-result",
	model: [
		{
			role: "toolResult",
			toolName: "claim_work",
			toolCallId: "c1",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			...at(3000),
		},
	],
};

assert.deepEqual(extractToolCalls(callEntry).map((c) => c.name), ["claim_work"]);
assert.deepEqual(extractToolCalls(user), []);
const turnList = buildTurns([callEntry, callResult]);
assert.deepEqual(turnList.map((t) => t.kind), ["agent", "tools"]);
assert.equal(turnList[1].call.name, "claim_work");
assert.equal(turnList[1].result, callResult, "the result is correlated by toolCallId");

const grouped = formatChat([callEntry, callResult], { seat: "worker", width: 100 });
const stamped = grouped.split("\n").filter((l) => /^\d\d:\d\d:\d\d/.test(l));
assert.equal(stamped.length, 2, "one timestamp per turn, not per entry");
assert.match(grouped, /⚙ claim_work\(\) ✓ ok/);

// A tail window can start after the call that produced a result.
assert.match(
	formatChat([callResult], { seat: "worker", width: 100, full: true }),
	/⚙ claim_work\(\) ✓ ok/,
	"an orphaned result is still shown",
);

// Arguments are summarised, never dumped as a payload.
assert.equal(formatArgs(undefined), "");
assert.equal(formatArgs({}), "");
assert.equal(formatArgs({ itemId: 1 }), "itemId=1");
assert.equal(formatArgs({ itemId: 1, resultSummary: "BLOCKED" }), "itemId=1, resultSummary=BLOCKED");
assert.equal(formatArgs({ a: 1, b: 2, c: 3 }), "a=1, b=2, …");
assert.equal(formatArgs({ nested: { deep: true } }), "nested=…");
assert.match(
	formatChat(
		[
			{
				kind: "pi.assistant",
				model: [
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "c2", name: "complete_work", arguments: { itemId: 1 } }],
						...at(0),
					},
				],
			},
		],
		{ seat: "worker", width: 100 },
	),
	/⚙ complete_work\(itemId=1\)/,
	"the call is visible, not just the result",
);

console.log("--- CLI: history, contract, follow ---");

const dir = mkdtempSync(join(tmpdir(), "durig-chatlog-"));
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
const run = (args, e = env) => {
	const res = spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: durigDir, env: e, encoding: "utf8" });
	return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};

try {
	assert.equal(run(["up", rigFile]).code, 0);
	assert.equal(run(["send", "alpha", "first message"]).code, 0);

	const human = run(["log", "alpha", "--human"]);
	assert.equal(human.code, 0, `log --human exits 0 (stderr: ${human.stderr.slice(0, 200)})`);
	assert.match(human.stdout, /▌ you +› first message/, "the operator's own turn");
	assert.match(human.stdout, /▌ alpha +› .*acknowledged/, "the seat's reply, with its role marker");
	assert.match(human.stdout, /^\d\d:\d\d:\d\d/m, "every row is time-stamped");

	// An unknown theme must be refused rather than silently ignored.
	const badTheme = run(["log", "alpha", "--human", "--theme=neon"]);
	assert.equal(badTheme.code, 1);
	assert.match(JSON.parse(badTheme.stdout).error, /--theme must be dark or light/);

	const asJson = JSON.parse(run(["log", "alpha", "--json"]).stdout);
	assert.equal(asJson.ok, true);
	assert.equal(asJson.seat, "alpha");
	assert.equal(asJson.db, db);
	assert.ok(asJson.entries.some((e) => e.kind === "pi.assistant"), "kind preserved");
	assert.ok(
		asJson.entries.some((e) => typeof e.text === "string" && e.text.includes("acknowledged")),
		"entries expose their text, not just a raw provider message",
	);
	assert.ok(asJson.entries.every((e) => e.model !== undefined), "raw model message still available");

	const follower = spawn(process.execPath, ["cli.mjs", "log", "alpha", "--follow", "--human"], {
		cwd: durigDir,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let seen = "";
	let followerErr = "";
	follower.stdout.on("data", (c) => {
		seen += c.toString("utf8");
	});
	follower.stderr.on("data", (c) => {
		followerErr += c.toString("utf8");
	});
	const waitFor = async (pred, label) => {
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			if (pred()) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(`timed out waiting for ${label}; saw ${seen.length} chars${followerErr ? ` stderr=${followerErr.slice(0, 200)}` : ""}`);
	};
	try {
		await waitFor(() => seen.includes("first message"), "the backfilled history");
		assert.equal(run(["send", "alpha", "second message"]).code, 0);
		await waitFor(() => seen.includes("second message"), "the newly committed message");

		// ROADMAP item 10: a --follow backfill and a later turn must render
		// through the same grouping path, so a reader cannot tell where the
		// backfill ended. Concretely: the turn marker (›) of the follow-only
		// "second message" must sit in the SAME column as the backfilled "first
		// message". The old behaviour formatted each later entry as its own
		// isolated block with its own label column width, so these diverged.
		const markerColumn = (needle) => {
			const line = seen.split("\n").find((l) => l.includes(needle));
			assert.ok(line, `follow output should contain a line with "${needle}"`);
			return line.indexOf("›");
		};
		assert.equal(
			markerColumn("first message"),
			markerColumn("second message"),
			"a later --follow turn must align with the backfill (same grouping path)",
		);
		console.log("CHATLOG TEST PASS (rendering, timestamps, collapsing, contract, follow)");
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
