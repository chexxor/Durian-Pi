// demo/seat-turn-shape.test.mjs — the shape a seat's NEXT provider call will carry is readable in two seconds,
// and the predicate is the provider template's own rule, not a plausible guess.
//
// WHY (D174, premise for #4886). Four sessions hunted a verifier's CONTEXT WINDOW for a failure that was a role
// sequence — LM Studio's converted template for the served model enforces alternating user/assistant roles and
// answered HTTP 500 in ~30 ms with zero tokens. The instrument (tools/seat-turn-shape.mjs) reads the replay window
// through durian-pi's OWN mirror of pi-durable's replay (`replayView`, `isHeadMarker`). The instrument was first
// written with a plausible predicate ("consecutive user roles"), which CLEARED a turn that then failed — so the
// predicate below is the template's literal rule, quoted in the tool header: the counted projection is every
// `user` plus every `assistant` carrying NO tool calls, and it must alternate from index 0 as user, assistant…
// These assertions pin the parts a later refactor would otherwise quietly lose:
//   - a tool-calling assistant does NOT satisfy the alternation (the miss that produced this rewrite);
//   - a tool result is not counted at all;
//   - the first counted message must be `user`;
//   - an empty-content assistant with no tool calls IS counted, and is reported separately;
//   - a capped scan says the residue is a LOWER BOUND and the window may extend further back (ROADMAP 257);
//   - the tool is read-only, and its failure path exits nonzero rather than printing an empty success.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	alternation,
	assessResidue,
	assessWindow,
	countedSequence,
	findingsIn,
	hasToolCalls,
	readSeatShapes,
	windowIsComplete,
} from "../tools/seat-turn-shape.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tool = join(here, "..", "tools", "seat-turn-shape.mjs");

const user = () => ({ role: "user", content: [{ type: "text", text: "go" }] });
const system = () => ({ role: "system", content: [{ type: "text", text: "s" }] });
const toolResult = () => ({ role: "toolResult", content: [{ type: "text", text: "r" }] });
const asstText = (stopReason) => ({
	role: "assistant",
	content: [{ type: "text", text: "a" }],
	...(stopReason ? { stopReason } : {}),
});
const asstEmpty = (stopReason) => ({
	role: "assistant",
	content: [],
	...(stopReason ? { stopReason } : {}),
});
const asstToolCall = () => ({
	role: "assistant",
	stopReason: "toolUse",
	content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }],
});

// 1. the minimum shape that refused: system, user, user.
{
	const a = assessWindow([system(), user(), user()]);
	assert.deepEqual(a.countedRoles, ["user", "user"], "the counted projection is what alternates");
	assert.equal(a.violations, 1, "system,user,user must read as one parity break");
	assert.deepEqual(
		a.violationAt,
		[{ at: 1, saw: "user", expected: "assistant" }],
		"and name the expectation",
	);
	assert.equal(
		a.nextSendAdmissible,
		false,
		"and flag the seat as unsafe to send to, before the spend",
	);
	assert.equal(findingsIn([a]).length, 1, "it must be a finding, not a footnote");
}

// 2. a healthy window: one user turn answered by one assistant with no tool calls.
{
	const b = assessWindow([system(), user(), asstText("stop")]);
	assert.equal(b.violations, 0, "user,assistant must read clean");
	assert.equal(b.nextSendAdmissible, true, "and it can take one more user turn");
	assert.equal(findingsIn([b]).length, 0, "a clean window is not a finding");
}

// 3. THE RULE THAT GOT THIS REWRITTEN: a tool-calling assistant is SKIPPED by the template, so it does not
//    satisfy the alternation. A resume after a tool-calling turn is what made the next `send` die at 24,576
//    tokens with `stopReason=error` and a 500 from the template.
{
	const c = assessWindow([system(), user(), asstToolCall(), toolResult(), user()]);
	assert.equal(
		hasToolCalls(asstToolCall()),
		true,
		"the pi shape `content[].type === toolCall` must be seen",
	);
	assert.equal(hasToolCalls(asstEmpty("length")), false, "an empty assistant carries none");
	assert.deepEqual(
		c.countedRoles,
		["user", "user"],
		"a tool-calling assistant must NOT enter the projection",
	);
	assert.equal(c.violations, 1, "so the two user turns are adjacent and the template raises");
	assert.equal(c.nextSendAdmissible, false, "and the seat is not safe to send to");
}

// 4. tool results are never counted; a tool result between two user turns does not rescue them.
{
	const d = assessWindow([user(), toolResult(), user()]);
	assert.deepEqual(
		d.countedRoles,
		["user", "user"],
		"toolResult is not part of the counted projection",
	);
	assert.equal(d.violations, 1, "and it does not satisfy alternation");
}

// 5. what a length-cut turn leaves behind: an assistant with no content and no tool calls IS counted (so it
//    satisfies alternation) and is reported separately, because some templates refuse it anyway.
{
	const e = assessWindow([user(), asstEmpty("length")]);
	assert.deepEqual(
		e.countedRoles,
		["user", "assistant"],
		"an empty assistant still counts as an assistant",
	);
	assert.equal(e.emptyAssistant, 1, "and must be reported, not hidden");
	assert.deepEqual(
		e.stopReasons,
		{ length: 1 },
		"with its stopReason tallied where the store keeps it",
	);
	assert.equal(findingsIn([e]).length, 1, "and it counts as a finding");
}

// 6. the first counted message must be `user` (index 0 of the template's counter).
{
	const f = assessWindow([asstText("stop"), user()]);
	assert.deepEqual(alternation([asstText("stop"), user()]).hits, [
		{ at: 0, saw: "assistant", expected: "user" },
		{ at: 1, saw: "user", expected: "assistant" },
	]);
}

// 7. truncation is admitted, not smoothed over.
{
	const g = assessWindow([user()], { windowComplete: false });
	assert.equal(g.windowComplete, false, "a capped scan must carry its cap into the payload");
	assert.equal(findingsIn([g]).length, 1, "an unclosed window is a finding, not a clean read");
	const r = assessResidue(
		[
			{ kind: "pi.user" },
			{ kind: "pi.assistant", model: [{ role: "assistant", stopReason: "error" }] },
		],
		{ lowerBound: true },
	);
	assert.equal(r.lowerBound, true, "residue counts must say they are a lower bound");
	assert.equal(r.userTurns, 1);
	assert.equal(
		r.erroredAssistantTurns,
		1,
		"an errored assistant turn is counted where the store keeps it",
	);
	const noMarker = windowIsComplete([{ id: 4 }, { id: 9 }], null);
	assert.equal(
		noMarker,
		false,
		"no head marker means the whole transcript is in the window — say so",
	);
	assert.equal(
		windowIsComplete([{ id: 4 }, { id: 9 }], { kind: "pi.reset", id: 9, head: "self" }),
		true,
		"a marker inside the scanned range proves the window was covered",
	);
	assert.equal(
		windowIsComplete([{ id: 10 }], { kind: "pi.reset", id: 9, head: "self" }),
		false,
		"a marker older than the scan proves nothing",
	);
	assert.equal(countedSequence([]).length, 0, "an empty window has an empty projection");
}

// 8. the failure path exits nonzero and names the failure, rather than printing an empty success.
{
	const r = spawnSync(
		process.execPath,
		[tool, "--db", join(here, "definitely-not-a-store.sqlite")],
		{
			encoding: "utf8",
		},
	);
	assert.equal(r.status, 1, "an unreadable store must exit 1");
	assert.match(r.stderr, /cannot read/, "and must name the failure on stderr");
}

// 9. a real read of the rig's own store: one shape per seat, and nothing written.
{
	const shapes = await readSeatShapes(join(here, "..", "selfdev.sqlite"), { maxEntries: 500 });
	assert.ok(shapes.length >= 1, "the rig's own store must yield at least one seat shape");
	for (const s of shapes) {
		assert.ok(s.seat && s.conversationId, "every shape names its seat and conversation");
		assert.equal(typeof s.violations, "number", "every shape carries the predicate result");
		assert.equal(typeof s.nextSendAdmissible, "boolean", "and the send pre-flight");
	}
	const after = spawnSync("git", ["status", "--porcelain", "--", "selfdev.sqlite"], {
		cwd: join(here, ".."),
		encoding: "utf8",
	});
	assert.equal(after.stdout.trim(), "", "the instrument must not touch the store on disk");
}

console.log(
	"SEAT TURN SHAPE TEST PASS (the template's own counted projection: a tool-calling assistant does not satisfy alternation; tool results uncounted; empty assistants counted and reported; caps admitted; unreadable store exits 1; a real read stays read-only)",
);
process.exit(0);
