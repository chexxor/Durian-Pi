// demo/compacteval.test.mjs - the compaction evaluation harness (#1087, ROADMAP 97).
//
// OFFLINE and deterministic: MemoryStorage + the faux provider stand in for the
// live endpoint, and the judge seam gets a canned models stub. What is proven
// here is the HARNESS (record replay, probe grading, blind pairwise judging,
// delta math, sweep boundary math) plus its compatibility with REAL
// pi-durable records (a real pi.compaction entry from pinned pi-durable code).
//
// The live measurement (real windows, real store items) is the operator-costed
// script scripts/compact-eval.mjs; docs/runbooks/compaction-eval.md owns that
// procedure. This demo pins the engine that script and item 27 ride on.
//
// RED/GREEN: against a tree without src/compacteval.mjs the import fails
// (module absent); the commit ships module + demo together.
//
// Run: node demo/compacteval.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { CompactionEntry, configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";

import {
	artifactProbe,
	buildHaystack,
	continuationProbe,
	decisionProbe,
	entryMessages,
	evalCompactionDelta,
	gradeArtifactsCited,
	gradeNeedleHit,
	leadWithSystem,
	messagesText,
	pairGraded,
	recallProbe,
	replayView,
	sweepProbes,
	sweepWindow,
	SUMMARY_PREFIX,
	SUMMARY_SUFFIX,
} from "../src/compacteval.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
function check(label, fn) {
	try {
		fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}
async function checkAsync(label, fn) {
	try {
		await fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

// --- record helpers (mirrors of the stored shapes) -------------------------
const turn = (id, kind, text, extra = {}) => ({
	id,
	kind,
	model: [{ role: kind === "pi.user" ? "user" : "assistant", content: [{ type: "text", text }] }],
	...extra,
});
const compactionRecord = (id, head, rawSummary, reason = "manual") => ({
	id,
	kind: "pi.compaction",
	head,
	model: [{ role: "user", content: [{ type: "text", text: SUMMARY_PREFIX + rawSummary + SUMMARY_SUFFIX }] }],
	data: { reason },
});
const resetRecord = (id, text) => ({
	id,
	kind: "pi.reset",
	head: id, // the transaction resolves "self" to the marker own id before storage
	model: text === undefined ? [] : [{ role: "user", content: [{ type: "text", text }] }],
});
// A canned judge stub over the ONLY seam the engine touches: completeSimple.
// Votes by exact canned JSON; getModelsOfType present because pairGraded
// resolves through the same two-step lookup src/judge.mjs uses.
const cannedJudgeModels = (verdict) => ({
	getModel: () => ({ id: "faux-judge" }),
	getModelsOfType: () => null,
	async completeSimple() {
		return { content: [{ type: "text", text: JSON.stringify(verdict) }] };
	},
});
const judgeStub = (verdict, rng) => ({
	models: cannedJudgeModels(verdict),
	judgeRef: { provider: "faux", modelId: "faux-judge" },
	...(rng ? { rng } : {}),
});

console.log("\n=== compaction evaluation harness: replay | probes | judge | delta | sweep ===\n");

check("replayView: plain page replays all messages in id order (no marker)", () => {
	const entries = [turn(1, "pi.user", "u1"), turn(2, "pi.assistant", "a1"), turn(3, "pi.user", "u2")];
	const v = replayView(entries);
	assert.equal(v.marker, undefined);
	assert.equal(v.entries.length, 3);
	assert.equal(v.messages.length, 3);
	assert.equal(messagesText(v.messages), "u1\na1\nu2");
});

check("replayView: cutoffId truncates", () => {
	const entries = [turn(1, "pi.user", "u1"), turn(2, "pi.assistant", "a1"), turn(3, "pi.user", "u2")];
	const v = replayView(entries, { cutoffId: 2 });
	assert.equal(v.messages.length, 2);
	assert.equal(messagesText(v.messages), "u1\na1");
});

check("replayView: compaction marker leads with the summary; keeps only entries from head on", () => {
	const entries = [
		turn(1, "pi.user", "dropped-old"),
		turn(2, "pi.assistant", "dropped-answer"),
		turn(5, "pi.user", "kept-a"),
		turn(6, "pi.assistant", "kept-b"),
		turn(7, "pi.user", "kept-c"),
		compactionRecord(8, 5, "the summary"),
		turn(9, "pi.assistant", "kept-d"),
	];
	const v = replayView(entries);
	assert.equal(v.marker?.kind, "pi.compaction");
	assert.equal(v.entries.length, 5); // marker(8) + kept 5,6,7,9
	assert.equal(v.messages.length, 5); // 1 summary message + 4 kept messages
	const text = messagesText(v.messages);
	assert.ok(text.startsWith("The conversation history before this point"), "the summary message must lead");
	assert.ok(text.includes("the summary"), "the raw summary survives the wrapper");
	assert.ok(text.includes("kept-a") && text.includes("kept-c") && text.includes("kept-d"), "kept tail survives");
	assert.ok(!text.includes("dropped-old") && !text.includes("dropped-answer"), "the dropped zone is gone");
	assert.equal(v.marker.data.reason, "manual");
});

check("replayView: newest marker wins when several exist (resummarization)", () => {
	const entries = [
		turn(1, "pi.user", "ancient"),
		compactionRecord(2, 1, "old summary"),
		turn(3, "pi.user", "mid"),
		compactionRecord(5, 3, "new summary"),
		turn(6, "pi.assistant", "tail"),
	];
	const v = replayView(entries);
	assert.equal(v.marker?.id, 5);
	assert.ok(!messagesText(v.messages).includes("old summary"), "an older summary does not resurface");
	assert.ok(messagesText(v.messages).includes("new summary"));
	assert.ok(messagesText(v.messages).includes("mid") && messagesText(v.messages).includes("tail"));
});

check("replayView: reset marker (self) drops everything before it, keeps its handoff", () => {
	const entries = [
		turn(1, "pi.user", "pre-reset"),
		turn(2, "pi.assistant", "pre-reset-answer"),
		resetRecord(3, "handoff: start fresh here"),
		turn(4, "pi.user", "post-reset"),
	];
	const v = replayView(entries);
	assert.equal(v.marker?.kind, "pi.reset");
	const text = messagesText(v.messages);
	assert.ok(text.startsWith("handoff: start fresh here"), "the handoff leads the post-reset context");
	assert.ok(text.includes("post-reset"));
	assert.ok(!text.includes("pre-reset"), "pre-reset turns leave the context");
});

check("replayView: reset WITHOUT handoff yields an empty-ish context that still replays", () => {
	const entries = [turn(1, "pi.user", "old"), resetRecord(2), turn(3, "pi.user", "new")];
	const v = replayView(entries);
	assert.equal(v.messages.length, 1);
	assert.equal(messagesText(v.messages), "new");
});

check("mechanical graders: needle hit/miss and artifact citation counts", () => {
	assert.equal(gradeNeedleHit("the token is DURIG-NEEDLE-1-abc.", "durig-needle-1-abc").hit, true);
	assert.equal(gradeNeedleHit("nothing here", "durig-needle-1-abc").hit, false);
	const c = gradeArtifactsCited("touched src/a.mjs and src/b.mjs", ["src/a.mjs", "src/b.mjs", "src/c.mjs"]);
	assert.deepEqual(c.cited, ["src/a.mjs", "src/b.mjs"]);
	assert.deepEqual(c.missing, ["src/c.mjs"]);
	assert.equal(c.total, 3);
});

check("probe builders produce the four kinds with mechanical grades", () => {
	const r = recallProbe({ needle: "DURIG-NEEDLE-9-xyz" });
	assert.equal(r.kind, "recall");
	assert.equal(r.grade("saw DURIG-NEEDLE-9-XYZ dot").ok, true);
	assert.equal(r.grade("nope").ok, false);
	const a = artifactProbe({ paths: ["src/x.mjs"] });
	assert.equal(a.kind, "artifact");
	assert.equal(a.grade("created src/x.mjs").ok, true);
	assert.equal(a.grade("created src/y.mjs (invented)").ok, false);
	const d = decisionProbe({ constraint: "never touch node_modules" });
	assert.equal(d.kind, "decision");
	assert.equal(d.grade("the constraint is: never touch node_modules").ok, true);
	assert.equal(d.grade("constraints? what constraints").ok, false);
	const c = continuationProbe({ nextAction: "commit the engine" });
	assert.equal(c.kind, "continuation");
	assert.equal(c.grade("commit the engine next, then report to pm").ok, true);
	assert.equal(c.grade("hi").ok, false);
});

check("message-text extraction covers string content and typed parts; system lead moves", () => {
	assert.equal(messagesText([{ role: "user", content: "plain string" }]), "plain string");
	assert.equal(messagesText([{ role: "assistant", content: [{ type: "text", text: "t" }, { type: "thinking", thinking: "th" }] }]), "t\nth");
	assert.equal(messagesText([]), "");
	assert.equal(leadWithSystem([{ role: "user", content: "u" }, { role: "system", content: "sys" }]).map((m) => m.role).join(","), "system,user");
});

console.log("\n--- part 2: blind pairwise judge (canned judge seam) ---\n");

await checkAsync("pairGraded: unparseable judge output fails LOUD (no silent pass)", async () => {
	const models = {
		getModel: () => ({ id: "faux-judge" }),
		getModelsOfType: () => null,
		async completeSimple() {
			return { content: [{ type: "text", text: "I think B is better, honestly." }] };
		},
	};
	await assert.rejects(
		() => pairGraded(models, { provider: "faux", modelId: "faux-judge" }, recallProbe({ needle: "n" }), "x", "y", { rng: () => 0.9 }),
		/no JSON/,
	);
});

await checkAsync("pairGraded: maps BOTH coin-flip assignments back to levels", async () => {
	const probe = recallProbe({ needle: "tok" });
	// The stub reads the prompt only through its candidate labels; it votes for
	// whichever candidate's text is literally "full". The mapping-back under
	// BOTH coin flips is what we pin here.
	const models = {
		getModel: () => ({ id: "faux-judge" }),
		getModelsOfType: () => null,
		async completeSimple(_model, { messages }) {
			const userMessage = messages.find((m) => m.role === "user");
			const user = typeof userMessage.content === "string" ? userMessage.content : messagesText([userMessage]);
			const aIsFull = /Candidate A:\s*\n?full/.test(user);
			const canonical = {
				a: { faithful: aIsFull ? 5 : 1, grounded: aIsFull ? 5 : 1 },
				b: { faithful: aIsFull ? 1 : 5, grounded: aIsFull ? 1 : 5 },
				overall: aIsFull ? "A" : "B",
				reason: "stub votes the candidate that reads full",
			};
			return { content: [{ type: "text", text: JSON.stringify(canonical) }] };
		},
	};
	const r1 = await pairGraded(models, { provider: "faux", modelId: "faux-judge" }, probe, "full", "compacted", { rng: () => 0.2 });
	const r2 = await pairGraded(models, { provider: "faux", modelId: "faux-judge" }, probe, "full", "compacted", { rng: () => 0.8 });
	assert.equal(r1.assignment, "full=A");
	assert.equal(r2.assignment, "full=B");
	assert.equal(r1.winner, "full", `both assignments map voted-full to winner full (r1=${r1.winner})`);
	assert.equal(r2.winner, "full", `both assignments map voted-full to winner full (r2=${r2.winner})`);
});

await checkAsync("pairGraded: ties stay ties under any assignment", async () => {
	const tie = { a: { faithful: 3, grounded: 3 }, b: { faithful: 3, grounded: 3 }, overall: "tie", reason: "equal" };
	const r1 = await pairGraded(cannedJudgeModels(tie), { provider: "faux", modelId: "faux-judge" }, recallProbe({ needle: "n" }), "x", "y", { rng: () => 0.1 });
	const r2 = await pairGraded(cannedJudgeModels(tie), { provider: "faux", modelId: "faux-judge" }, recallProbe({ needle: "n" }), "x", "y", { rng: () => 0.9 });
	assert.equal(r1.winner, "tie");
	assert.equal(r2.winner, "tie");
});

console.log("\n--- part 3: delta evaluation on synthetic stores ---\n");

await checkAsync("evalCompactionDelta: full hits what compaction loses; delta counts it", async () => {
	const base = [
		turn(1, "pi.user", "the standing decision: artifact A lives at artifacts/a.mjs"),
		turn(2, "pi.user", "a marker token NEEDLE-XYZ was filed for later probes"),
		turn(3, "pi.user", "the engine demo has one task left: analyze the sweep wiring"),
	];
	// Compaction drops turns 1-2 and summarizes WITHOUT the marker token:
	const marker = compactionRecord(4, 3, "earlier: the artifact register points at artifacts/a.mjs; the engine demo continued");
	const probes = [
		recallProbe({ needle: "NEEDLE-XYZ" }),
		artifactProbe({ paths: ["artifacts/a.mjs"] }),
		continuationProbe({ nextAction: "analyze the sweep wiring" }),
	];
	// The canned seam is honest: a level can only answer what its context text
	// actually contains.
	const answer = async ({ messages, probe }) => {
		const have = messagesText(messages);
		if (probe.kind === "recall") return have.includes("NEEDLE-XYZ") ? "the marker was NEEDLE-XYZ" : "the marker was lost in the summary";
		if (probe.kind === "artifact") return have.includes("artifacts/a.mjs") ? "artifacts/a.mjs" : "unknown";
		return have.includes("engine demo") ? "analyze the sweep wiring next" : "start over?";
	};
	const result = await evalCompactionDelta({
		fullEntries: [...base],
		compactedEntries: [...base, marker],
		probes,
		answer,
	});
	assert.equal(result.delta.fullPasses, 3);
	assert.equal(result.delta.compactedPasses, 2); // recall lost: the needle lived only in the dropped turns
	assert.equal(result.rows[0].fullOk, true);
	assert.equal(result.rows[0].compactedOk, false);
	assert.equal(result.rows[1].compactedOk, true, "the artifact survives via the summary");
	assert.equal(result.rows[2].compactedOk, true, "the kept tail still carries the task state");
});

await checkAsync("evalCompactionDelta: judge corroboration counts ties and level wins", async () => {
	const base = [
		turn(1, "pi.user", "the task: verify the harness wiring end to end"),
		turn(2, "pi.assistant", "understood, verifying"),
	];
	const marker = compactionRecord(3, 2, "brief note");
	const probes = [continuationProbe({ nextAction: "verify the harness wiring end to end" })];
	const answer = async () => "verify the harness wiring end to end, then report";
	const tie = judgeStub({ a: { faithful: 4, grounded: 4 }, b: { faithful: 4, grounded: 4 }, overall: "tie", reason: "equal" });
	const withTie = await evalCompactionDelta({ fullEntries: base, compactedEntries: [...base, marker], probes, answer, judge: tie });
	assert.equal(withTie.delta.judgeTies, 1);
	assert.equal(withTie.delta.fullPasses, 1);
	assert.equal(withTie.delta.compactedPasses, 1);
	// A judge that prefers whichever answer cites the WIRE (only the full
	// context's answer does): full must win the pairwise delta.
	const prefersWire = {
		models: {
			getModel: () => ({ id: "faux-judge" }),
			getModelsOfType: () => null,
			async completeSimple(_model, { messages }) {
				const userMessage = messages.find((m) => m.role === "user");
				const text = typeof userMessage.content === "string" ? userMessage.content : messagesText([userMessage]);
				const aChunk = text.slice(text.indexOf("Candidate A:"), text.indexOf("Candidate B:"));
				const bChunk = text.slice(text.indexOf("Candidate B:"));
				const aHappy = aChunk.includes("with the recorded wire");
				const bHappy = bChunk.includes("with the recorded wire");
				return { content: [{ type: "text", text: JSON.stringify({ a: { faithful: aHappy ? 5 : 1, grounded: aHappy ? 5 : 1 }, b: { faithful: bHappy ? 5 : 1, grounded: bHappy ? 5 : 1 }, overall: aHappy && !bHappy ? "A" : bHappy && !aHappy ? "B" : "tie", reason: "wire" }) }] };
			},
		},
		judgeRef: { provider: "faux", modelId: "faux-judge" },
		rng: () => 0.7,
	};
	const answerFullOnly = async ({ messages }) => (messagesText(messages).includes("verify the harness wiring end to end") ? "verify the harness wiring end to end, reporting with the recorded wire" : "report without provenance");
	const withFullWin = await evalCompactionDelta({ fullEntries: base, compactedEntries: [...base, marker], probes, answer: answerFullOnly, judge: prefersWire });
	assert.equal(withFullWin.delta.judgeFullWins, 1, `full must win the pairwise (rows=${JSON.stringify(withFullWin.rows.map(r => r.winner))})`);
});

console.log("\n--- part 4: the sweep boundary math (stubbed ask) ---\n");

const plantRegexes = {
	needle: /DURIG-NEEDLE-\d+-[0-9a-z]+/,
	artifact: /src\/compacteval-fixture\/\d+\/sweep-artifact-[0-9a-z]+\.mjs/,
	constraint: /Standing constraint \(verbatim\): [^.]+\./,
};
const sweepStub = (breakBelow) => async ({ messages, question }) => {
	const text = messagesText(messages);
	const est = messages.reduce((n, m) => n + estimateMessageTokens(m), 0);
	const healthy = breakBelow === undefined || est < breakBelow;
	let reply = "lost";
	if (healthy) {
		if (question.includes("marker token")) reply = text.match(plantRegexes.needle)?.[0] ?? "lost";
		else if (question.includes("file path")) reply = text.match(plantRegexes.artifact)?.[0] ?? "lost";
		else reply = text.match(plantRegexes.constraint)?.[0] ?? "lost";
	}
	return { reply, usage: { input: est, cacheRead: 0, cacheWrite: 0, totalTokens: est } };
};

await checkAsync("sweepWindow: the degradation point becomes the boundary; lower bound labelled", async () => {
	const result = await sweepWindow({ lengthsTokens: [1000, 2000, 4000, 8000], ask: sweepStub(4000), seed: 7 });
	assert.equal(result.rows.length, 4);
	assert.deepEqual(result.rows.map((r) => r.targetTokens), [1000, 2000, 4000, 8000]);
	assert.equal(result.rows[0].allPassed, true);
	assert.equal(result.boundaryTokens, 4000, "the first length with a miss");
	assert.equal(result.effectiveWindowLowerBound, 2000, "the last all-pass length; labelled a LOWER BOUND");
	assert.ok(result.rows[3].misses.length >= 1, "beyond the break, misses recorded");
	assert.ok(result.rows[0].reportedUsage && typeof result.rows[0].reportedUsage.input === "number", "usage passthrough");
});

await checkAsync("sweepWindow: an all-pass sweep reports no boundary; an all-fail one no lower bound", async () => {
	const ok = await sweepWindow({ lengthsTokens: [1000, 2000], ask: sweepStub(), seed: 3 });
	assert.equal(ok.boundaryTokens, undefined);
	assert.equal(ok.effectiveWindowLowerBound, 2000);
	const fail = await sweepWindow({ lengthsTokens: [1000], ask: async () => ({ reply: "no idea" }), seed: 3 });
	assert.equal(fail.boundaryTokens, 1000);
	assert.equal(fail.effectiveWindowLowerBound, undefined);
});

await checkAsync("sweepWindow: deterministic per seed (same seed -> same estimated size; different seed differs)", async () => {
	const ask = async () => ({ reply: "n/a" });
	const a = await sweepWindow({ lengthsTokens: [1500], ask, seed: 11 });
	const b = await sweepWindow({ lengthsTokens: [1500], ask, seed: 11 });
	assert.equal(a.rows[0].estimatedTokens, b.rows[0].estimatedTokens);
	const c = await sweepWindow({ lengthsTokens: [1500], ask, seed: 12 });
	assert.notEqual(a.rows[0].estimatedTokens, c.rows[0].estimatedTokens, "different seeds size differently");
});

console.log("\n--- part 5: REAL pi-durable interop (MemoryStorage + faux) ---\n");

await checkAsync("a REAL pi.compaction entry replays through the harness exactly like the records", async () => {
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
	const needle = "durig://fixture/interop-needle-77";
	const artifactPath = "src/compacteval-fixture/interop.mjs";
	let convId;
	try {
		await harness.commit(async (tx) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
			convId = conv.id;
		}, ctx);
		const conv = await harness.conversation(convId, ctx);
		// Big enough that pi-durable's own cut (keepRecentTokens 20000) FINDS
		// something to compact: 34 turns x ~4000 chars/user turn ~ 39K est tokens.
		for (let i = 0; i < 34; i++) {
			const body = i === 3 ? `turn with ${needle} and artifact ${artifactPath}` : `filler turn ${i} about the evaluation of compaction quality over long transcripts`;
			faux.setResponses([fauxAssistantMessage(fauxText(`ack-${i}`))]);
			const run = await conv.submit({ type: "input", content: `${body} ${"x".repeat(3900)}` }, ctx);
			await run.wait(ctx);
		}
		const pre = await conv.context(ctx);
		const preCount = pre.messages.length;

		// A REAL compaction: the canned summary preserves needle + artifact (the
		// summarizer SEAM is what we cannot quality-grade offline - framed).
		faux.setResponses([fauxAssistantMessage(fauxText(`summary keeps ${needle} and ${artifactPath}`))]);
		const taskId = await conv.compact("keep the planted marker token", ctx);
		await harness.waitForTask(taskId, ctx);

		// The REAL records pinned pi-durable wrote:
		const page = await conv.entries({}, 200, undefined, ctx);
		const realEntries = page.items;
		const markerEntry = realEntries.find((e) => e.kind === CompactionEntry.kind);
		assert.ok(markerEntry, "a pi.compaction entry was written");
		assert.equal(typeof markerEntry.head, "number", "stored head is numeric (transaction resolves self)");
		const summaryText = entryMessages(markerEntry)[0]?.content?.[0]?.text ?? "";
		assert.ok(summaryText.startsWith(SUMMARY_PREFIX), "the wrapper is pi-durable own");
		assert.ok(gradeNeedleHit(summaryText, needle).hit, "the summary contains the needle");
		assert.equal(gradeArtifactsCited(summaryText, [artifactPath]).cited.length, 1, "the summary carries the artifact path");

		// The REAL post-compaction view vs MY replay of the same records:
		const post = await conv.context(ctx);
		assert.ok(post.messages.length < preCount, "the real view shrank");
		const replayed = replayView(realEntries);
		assert.equal(replayed.marker?.kind, "pi.compaction");
		assert.ok(messagesText(replayed.messages).includes(needle), "replay keeps the planted needle (via the summary)");
		assert.ok(!messagesText(replayed.messages).includes("filler turn 1 about"), "replay drops compacted-away filler");
		assert.equal(replayed.messages.length, post.messages.length, "replay == real view length on this shape");
	} finally {
		await harness.close(ctx);
	}
});

console.log(failures === 0
	? "\nCOMPACTEVAL PASS (replay, probes, blind judge, delta, sweep boundary; real pi-durable records interop)"
	: `\nCOMPACTEVAL FAIL - ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

