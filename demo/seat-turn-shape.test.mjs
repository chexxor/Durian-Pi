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

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

// The live leg must know whether another owner is writing the store it is hashing (#6057).
import { brokerAliveFor } from "../src/readclient.mjs";
import { registerSeat } from "../src/rig.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");
const tool = join(rootDir, "tools", "seat-turn-shape.mjs");
// The scratch the fixture store and the failure-path probe both live in. Section 8 used to point
// `--db` at `demo/definitely-not-a-store.sqlite` and section 9 at `./selfdev.sqlite`; neither path
// exists in a fresh worktree, and opening a MISSING path CREATES it — measured at this base: one run
// of this demo left a 118,784-byte `selfdev.sqlite` at the repo root AND a 118,784-byte
// `demo/definitely-not-a-store.sqlite`, both invisible to `git status` because `.gitignore:2`
// ignores `*.sqlite`. Section 10 asserts this demo stops writing into the tree.
const tmp = mkdtempSync(join(tmpdir(), "durig-seat-turn-shape-"));
const sqliteInRepo = () =>
	[...readdirSync(rootDir), ...readdirSync(join(rootDir, "demo"))]
		.filter((n) => n.endsWith(".sqlite"))
		.sort();
const litterAtStart = sqliteInRepo();
const skips = [];
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

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
		[tool, "--db", join(tmp, "definitely-not-a-store.sqlite")],
		{
			encoding: "utf8",
		},
	);
	assert.equal(r.status, 1, "an unreadable store must exit 1");
	assert.match(r.stderr, /cannot read/, "and must name the failure on stderr");
}

// 9. a real store read: a FIXTURE store the demo owns, plus the rig's own store WHEN it resolves.
//
// Why the fixture exists (#4948): the repo-root store is gitignored, so a fresh item worktree has NO
// store at the root and `DURIG_DB` is unset there, and this section died with
// `Error: no seat named null` — an ENVIRONMENTAL failure wearing the clothes of a behaviour red
// (#2126/#2287/#2288's classification). The fixture keeps the wiring that matters running in EVERY
// tree — seat document → `scanEntries` → `replayView` → `assessWindow`, through the same `readLocal`
// path the product uses — and the real-store leg stays, reporting a NAMED skip rather than either a
// silent pass or a bare red when no store resolves. The file stays MAPPED in `demo/test-areas.json`
// and section 9 is not deleted: unmapping it would be tuning the instrument to agree (#4923).
{
	const fixtureDb = join(tmp, "fixture.sqlite");
	const storage = await openNodeSqliteStorage(fixtureDb);
	const harness = await Harness.open(storage, { registry: createRegistry() }, BACKGROUND_CONTEXT);
	harness.resume();
	try {
		await harness.commit(async (tx) => {
			for (const name of ["shape-healthy", "shape-parity"]) {
				const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await registerSeat(tx, name, conv.id, "implementation");
			}
		}, BACKGROUND_CONTEXT);
	} finally {
		await storage.close(BACKGROUND_CONTEXT);
	}
	const fixtureHashBefore = sha256(fixtureDb);
	const shapes = await readSeatShapes(fixtureDb, { maxEntries: 500 });
	assert.equal(shapes.length, 2, `one shape per registered seat, got ${shapes.map((s) => s.seat).join(",")}`);
	assert.deepEqual(
		shapes.map((s) => s.seat).sort(),
		["shape-healthy", "shape-parity"],
		"the seat names come from the store's own seat document, not from an argument",
	);
	assert.equal(new Set(shapes.map((s) => s.conversationId)).size, 2, "and each shape is its own conversation");
	for (const s of shapes) {
		assert.equal(typeof s.violations, "number", "every shape carries the predicate result");
		assert.equal(typeof s.nextSendAdmissible, "boolean", "and the send pre-flight");
		assert.equal(typeof s.entriesScanned, "number", "and how much of the window it read");
	}
	// The read-only claim, checked on BYTES rather than on `git status`. The old check asked git
	// whether the store had changed, and `.gitignore` answers "nothing happened" for every `*.sqlite`
	// — a green from that check is vacuous (#4813's shape): it passed while the run was CREATING a
	// 118 KB store in the tree.
	assert.equal(sha256(fixtureDb), fixtureHashBefore, "the read must leave the store bytes identical");

	// 9b. MOVING SUBJECT (#6057). The byte check is only meaningful if (a) it CAN fail, and (b) the
	// store is not being committed into by another owner while it runs. In the shared checkout the
	// live leg hashed `selfdev.sqlite` before and after the read while a resident broker was attached
	// to that same store; a pass committed between the two hashes and the demo printed `the read must
	// not modify selfdev.sqlite` - a behaviour red measuring a busy machine. Here the two directions
	// are separated in a store this demo owns: a write to the path moves the bytes, a read does not.
	{
		const movingDb = join(tmp, "moving.sqlite");
		let movingConv = null;
		{
			const s1 = await openNodeSqliteStorage(movingDb);
			const d1 = await Harness.open(s1, { registry: createRegistry() }, BACKGROUND_CONTEXT);
			await d1.commit(async (tx) => {
				const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
				await registerSeat(tx, "moving-driver", conv.id, "implementation");
				movingConv = conv.id;
			}, BACKGROUND_CONTEXT);
			await d1.close(BACKGROUND_CONTEXT);
			await s1.close(BACKGROUND_CONTEXT); // closing checkpoints, so the main file is settled
		}
		const settled = sha256(movingDb);
		{
			const s2 = await openNodeSqliteStorage(movingDb);
			const d2 = await Harness.open(s2, { registry: createRegistry() }, BACKGROUND_CONTEXT);
			await d2.commit(async (tx) => {
				for (let i = 0; i < 40; i++) await tx.appendEntry(movingConv, { kind: "pi.assistant", model: [{ role: "assistant" }] });
			}, BACKGROUND_CONTEXT);
			await d2.close(BACKGROUND_CONTEXT);
			await s2.close(BACKGROUND_CONTEXT);
		}
		const afterWrite = sha256(movingDb);
		assert.notEqual(afterWrite, settled, "a write to this path DOES move the bytes, so passing the byte check means something");
		const reread = await readSeatShapes(movingDb, { maxEntries: 500 });
		assert.equal(reread.length, 1, "the store still reports its seat after the write");
		assert.equal(sha256(movingDb), afterWrite, "the read alone leaves the bytes identical");
		process.stdout.write("  ok   MOVING SUBJECT control: a write moves these bytes, a read does not\n");
	}

	// The rig's own store: run it when it resolves. Every failure mode measured at this base is
	// ENVIRONMENTAL, and none of them may read as a behaviour red OR as a silent pass:
	//   - no file at the path (a fresh worktree — `*.sqlite` is gitignored, `.gitignore:2`);
	//   - a file this tree's pinned `@earendil-works/pi-durable` cannot open — measured on a COPY of the
	//     seat root's store: `Durable SQLite schema version 2 is newer than supported version 1`;
	//   - a store that opens but holds no seat document — `src/readapi.mjs:60-61` says an absent session
	//     document is "an empty rig, not an error: the wrong-database guardrail is the caller's job".
	// Tolerating those here is NOT tuning the instrument to agree: the fixture store above exercises the
	// same `readSeatShapes` path unconditionally, so a behaviour regression in the reader still fails
	// this demo whatever the live leg finds. The live leg exists for the real-pages value (D78), and it
	// reports what it met.
	const liveDb = process.env.DURIG_DB || join(rootDir, "selfdev.sqlite");
	const brokerState = (() => {
		try {
			return JSON.parse(readFileSync(`${liveDb}.broker.json`, "utf8"));
		} catch {
			return null;
		}
	})();
	if (!existsSync(liveDb)) {
		skips.push(`no store at ${liveDb} (DURIG_DB=${process.env.DURIG_DB ?? "unset"})`);
		process.stdout.write(
			`  SKIP (ENVIRONMENTAL — not a behaviour red) ${liveDb}: no store resolves in this tree; the fixture leg above ran\n`,
		);
	} else if (brokerAliveFor(liveDb)) {
		// A resident broker owns this store and commits into it. Hashing before and after the read
		// measures the broker, not the read, and the red it prints accuses the reader of writing the
		// rig's store (#6057). Name it, and still read the real pages.
		const pid = brokerState?.pid ?? "unknown";
		let live = null;
		let liveFailure = null;
		try {
			live = await readSeatShapes(liveDb, { maxEntries: 500 });
		} catch (err) {
			liveFailure = String(err?.message ?? err);
		}
		if (live) {
			for (const s of live) {
				assert.ok(s.seat && s.conversationId, "every shape names its seat and conversation");
				assert.equal(typeof s.violations, "number");
				assert.equal(typeof s.nextSendAdmissible, "boolean");
			}
			process.stdout.write(
				`  SKIP (MOVING SUBJECT - not a behaviour red) ${liveDb}: broker pid ${pid} is attached and commits between the hashes, so the byte check is not taken here; the read still ran and got ${live.length} shape(s)\n`,
			);
			skips.push(`moving subject ${liveDb}: broker pid ${pid} attached; byte check not taken, shapes read instead`);
		} else {
			process.stdout.write(`  SKIP (MOVING SUBJECT) ${liveDb}: broker pid ${pid} attached and the read could not open it (${liveFailure})\n`);
			skips.push(`moving subject ${liveDb}: broker pid ${pid} attached, read failed (${liveFailure})`);
		}
	} else {
		// No other owner is attached, which is the only condition under which the byte check is a
		// claim about the read rather than about a broker passing through (#6057).
		const liveBefore = sha256(liveDb);
		let live = null;
		let liveFailure = null;
		try {
			live = await readSeatShapes(liveDb, { maxEntries: 500 });
		} catch (err) {
			liveFailure = String(err?.message ?? err);
		}
		if (live) {
			for (const s of live) {
				assert.ok(s.seat && s.conversationId, "every shape names its seat and conversation");
				assert.equal(typeof s.violations, "number");
				assert.equal(typeof s.nextSendAdmissible, "boolean");
			}
			assert.equal(sha256(liveDb), liveBefore, `the read must not modify ${liveDb}`);
			process.stdout.write(`  ok   REAL STORE ${liveDb}: ${live.length} seat shape(s), bytes unchanged\n`);
		} else {
			const emptyRig = /no seat named/.test(liveFailure ?? "");
			skips.push(`${liveDb}: ${emptyRig ? "opens, but holds no seat document - an empty rig, not an error (src/readapi.mjs:60-61)" : liveFailure}`);
			process.stdout.write(
				`  SKIP (ENVIRONMENTAL - not a behaviour red) ${liveDb}: ${emptyRig ? `opens, but no seat document; the reader's own message is ${JSON.stringify(liveFailure)}` : liveFailure}\n`,
			);
		}
	}
}

// 10. this demo leaves no store inside the repo. Measured at this base, one run CREATED
// `selfdev.sqlite` (118,784 bytes) at the repo root and `demo/definitely-not-a-store.sqlite`
// (118,784 bytes): opening a path that does not exist creates it. That belongs to the storage opener
// (`openNodeSqliteStorage` via `src/readclient.mjs`), not to this demo, so it is REPORTED for its own
// row rather than pinned here as expected behaviour. What IS this demo's job is to stop writing into
// the tree, and both scratch paths now live in a temp dir.
{
	const litter = sqliteInRepo().filter((n) => !litterAtStart.includes(n));
	assert.deepEqual(litter, [], `the demo created store file(s) inside the repo: ${litter.join(", ")}`);
}

rmSync(tmp, { recursive: true, force: true });

console.log(
	`SEAT TURN SHAPE TEST PASS (the template's own counted projection: a tool-calling assistant does not satisfy alternation; tool results uncounted; empty assistants counted and reported; caps admitted; unreadable store exits 1; a store read stays read-only on BYTES; the store read ran against a FIXTURE store${skips.length ? `; SKIPPED (environmental): ${skips.join(" | ")}` : ", and against the rig's own store"})`,
);
process.exit(0);
