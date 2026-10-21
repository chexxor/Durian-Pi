// src/compacteval.mjs - compaction evaluation harness (#1087, ROADMAP 97).
//
// WHAT: replay an append-only store's entries into an EVAL-level model context
// (a FULL view and a COMPACTED view), fire recall / artifact / continuation /
// decision probes, grade mechanically where the answer is verbatim-checkable
// and by a BLIND PAIRWISE judge where it is not, and report the
// compacted-vs-full delta. The same builder drives the per-model EFFECTIVE
// WINDOW sweep: a deterministic synthetic transcript with planted needles,
// probed at a few lengths against the live endpoint; the first failing probe
// length is the measured boundary (item 27 consumes that number, not the
// advertised contextWindow).
//
// WHY an eval-level replay instead of pi-durable internal deriveContext:
// the deriving functions are internal to the pinned pi-durable (see
// src/pi-main.pin.json), not exported by its package surface. The harness
// therefore consumes the STORE RECORDS (entry.kind / entry.model / entry.head)
// - the durable contract - and mirrors only the record-level semantics that
// the built-in compaction and reset already pin by how they place markers.
// When the pin moves, demo/compacteval.test.mjs interop block re-checks those
// semantics against a REAL compaction run (see the runbook).
//
// Record-level semantics mirrored (grounded in the pinned dist, 2026-10-17):
// - CompactionEntry: { kind: "pi.compaction", head: <numeric firstKept>,
//   model: [UserMessage whose text is SUMMARY_PREFIX + summary + SUMMARY_SUFFIX],
//   data: { reason } } (dist/harness/compaction.js placeSummary; the text is
//   statically wrapped, so the raw summary is recovered by stripping both).
// - ResetEntry drafts use head: "self"; the transaction resolves it to the
//   marker own id at append (dist/session/transaction.js:167), so a stored
//   reset marker head is numeric and the range starts AT the marker (its
//   optional handoff user message leads the post-reset context).
// - The active range of a head marker H: H itself first, then non-marker
//   entries with id >= H.head through the tail (dist/harness/context.js
//   selectActive/rangeQuery); a leading system message moves to the front.
//
// Grading: recall/artifact/decision probes are MECHANICAL (a planted needle or
// exact path either appears in the reply or does not); continuation is graded
// only by the blind pairwise judge (same question, two context levels; the
// judge must not know which answer came from which; coin-flip placement as in
// src/judge.mjs). No probe relies on the judge alone when a mechanical check
// exists - the judge corroborates, it does not fabricate precision.
//
// Determinism: the synthetic transcript is built from a seeded LCG, so a run
// is reproducible per seed and needles differ across seeds (a probe cannot be
// answered from memory of a previous run).

import {
	estimateMessageTokens,
} from "@earendil-works/pi-ai/utils/estimate";

// Mirrors pi-durable built-in wrapper around the summarizer reply
// (dist/harness/compaction.js SUMMARY_PREFIX/SUMMARY_SUFFIX). The harness
// strips them to grade the RAW summary; if pi-durable ever changes the
// wording, the strip fails closed below and the demo interop block fails.
export const SUMMARY_PREFIX =
	"The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
export const SUMMARY_SUFFIX = "\n</summary>";

const HEAD_MARKER_KINDS = new Set(["pi.compaction", "pi.reset"]);

/** The entry id a head marker cuts to: numeric head, or the marker own id for "self" drafts. */
export function resolveHeadEntryId(entry) {
	if (!entry || entry.head === undefined) return undefined;
	if (entry.head === "self") {
		return typeof entry.id === "number" ? entry.id : undefined;
	}
	return typeof entry.head === "number" ? entry.head : undefined;
}

/** True for the record-level head markers whose semantics this harness mirrors. */
export function isHeadMarker(entry) {
	return Boolean(entry) && HEAD_MARKER_KINDS.has(entry.kind) && resolveHeadEntryId(entry) !== undefined;
}

/** An entry provider messages, normalized to an array (records may carry one message, not an array). */
export function entryMessages(entry) {
	if (Array.isArray(entry?.model)) return entry.model;
	if (entry?.model) return [entry.model];
	return [];
}

/** Move a leading system message to the front (mirror of pi-durable leadWithSystem). */
export function leadWithSystem(messages) {
	const index = messages.findIndex((message) => message.role !== "user");
	if (index <= 0 || messages[index]?.role !== "system") return messages;
	return [messages[index], ...messages.slice(0, index), ...messages.slice(index + 1)];
}

/**
 * Replay a page of append-only entries into the eval-level context view.
 * `entries` must be the raw committed records (id, kind, model, head) as
 * storage.scanEntries / conv.entries return them. `cutoffId` truncates the
 * replay (the delta evaluator uses it to build the FULL view of everything
 * before a compaction marker).
 *
 * Returns { marker, entries, messages }: marker is the newest applicable head
 * marker (undefined when none applies), entries the active records in eval
 * order (marker first), messages the eval-level model context (the marker
 * messages lead, when a marker applies).
 */
export function replayView(entries, { cutoffId } = {}) {
	const sorted = [...(entries ?? [])].sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0));
	if (sorted.length === 0) return { marker: undefined, entries: [], messages: [] };
	const tailId = cutoffId ?? sorted[sorted.length - 1]?.id ?? 0;
	let marker;
	for (const entry of sorted) {
		if (entry.id <= tailId && isHeadMarker(entry)) marker = entry;
	}
	if (marker === undefined) {
		const active = sorted.filter((entry) => entry.id <= tailId);
		return { marker: undefined, entries: active, messages: leadWithSystem(active.flatMap(entryMessages)) };
	}
	const from = resolveHeadEntryId(marker);
	const rest = sorted.filter((entry) => entry.id >= from && entry.id <= tailId && !isHeadMarker(entry));
	const messages = leadWithSystem([...entryMessages(marker), ...rest.flatMap(entryMessages)]);
	return { marker, entries: [marker, ...rest], messages };
}

/** The concatenated TEXT of eval messages (text parts plus thinking), for mechanical grading. */
export function messagesText(messages) {
	return (messages ?? [])
		.map((message) => {
			const content = message?.content;
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			return content
				.map((part) => (part?.type === "text" ? part.text ?? "" : part?.type === "thinking" ? part.thinking ?? "" : ""))
				.join("\n");
		})
		.join("\n");
}

const norm = (text) => String(text ?? "").replace(/\s+/g, " ").toLowerCase();

/** Mechanical recall grade: does the reply contain the planted needle (spacing/case-insensitive)? */
export function gradeNeedleHit(reply, needle) {
	return { hit: norm(reply).includes(norm(needle)) };
}

/** Mechanical artifact grade: which of the exact paths the reply cites. */
export function gradeArtifactsCited(reply, paths) {
	const cited = [];
	const missing = [];
	for (const path of paths ?? []) {
		(norm(reply).includes(norm(path)) ? cited : missing).push(path);
	}
	return { cited, missing, total: (paths ?? []).length };
}

/* ------------------------------------------------------------- probes */

/** The probe families the harness fires (ROADMAP 97 four). */
export const PROBE_KINDS = ["recall", "artifact", "continuation", "decision"];

/**
 * Probe builders. A probe is { kind, question, grade(reply) -> {ok, detail} }
 * plus the searchable expectations. Mechanical where possible.
 */
export function recallProbe({ needle, lead = "" }) {
	if (!needle) throw new Error("recallProbe needs a needle");
	const question = `${lead} Answer from the context above: what exact marker token was planted in the earlier material? Reply with the token, nothing else.`.trim();
	return {
		kind: "recall",
		needle,
		question,
		grade(reply) {
			const { hit } = gradeNeedleHit(reply, needle);
			return { ok: hit, detail: hit ? "needle present" : "needle absent" };
		},
	};
}

export function artifactProbe({ paths }) {
	if (!Array.isArray(paths) || paths.length === 0) throw new Error("artifactProbe needs paths");
	const question =
		"From the context above: list every file path the earlier work created, modified or referenced. " +
		"Reply with the exact paths, one per line, nothing else.";
	return {
		kind: "artifact",
		paths,
		question,
		grade(reply) {
			const { cited, missing, total } = gradeArtifactsCited(reply, paths);
			return { ok: missing.length === 0 && total > 0, cited, missing, detail: `${cited.length}/${total} paths cited` };
		},
	};
}

export function decisionProbe({ constraint }) {
	if (!constraint) throw new Error("decisionProbe needs a constraint");
	const question =
		"From the context above: state the standing constraint the earlier material fixed, verbatim as it was given. Reply with the constraint text only.";
	return {
		kind: "decision",
		constraint,
		question,
		grade(reply) {
			const { hit } = gradeNeedleHit(reply, constraint);
			return { ok: hit, detail: hit ? "constraint restated" : "constraint not restated verbatim" };
		},
	};
}

/** Continuation cannot be graded mechanically - the judge carries it. */
export function continuationProbe({ nextAction }) {
	if (!nextAction) throw new Error("continuationProbe needs the expected next action");
	const question =
		"One single action should logically come next in this conversation. Name it in one sentence, then issue nothing - text only.";
	return {
		kind: "continuation",
		nextAction,
		question,
		grade(reply) {
			// Mechanical half: the reply must at least act on the task (not re-greet).
			const okShape = norm(reply).length > 20;
			return { ok: okShape, detail: okShape ? "substantive reply" : "empty or trivial reply" };
		},
	};
}

/* ------------------------------------------------- blind pairwise judge */

export const JUDGE_PAIR_SYSTEM = `You are a strict evaluator of answers to one question about a conversation.

You will see QUESTION and two candidate ANSWERS labeled A and B. Both were produced from DIFFERENT representations of the same source conversation. You are NOT told which representation produced which answer, and you must not guess.

Score both answers on two dimensions, each 1-5:
- faithful: the answer contains no claim that contradicts the question intent, no invented file path, token or constraint
- grounded: the answer quotes or names the SPECIFIC items the question asks for (exact tokens, paths, constraint wording)

Penalize invention, vagueness and filler. Reward precision only.

Respond with ONLY a JSON object, no markdown fences:
{"a": {"faithful": n, "grounded": n},
 "b": {"faithful": n, "grounded": n},
 "overall": "A" | "B" | "tie",
 "reason": "<one sentence>"}`;

function parseJudgeJson(raw) {
	const text = String(raw ?? "");
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) throw new Error(`judge returned no JSON: ${text.slice(0, 120)}`);
	return JSON.parse(text.slice(start, end + 1));
}

/**
 * Blind pairwise grade of one probe answers at the two context levels.
 * Coin-flip placement (rng injectable for deterministic tests) defeats
 * position bias; mapping-back makes the result about LEVELS, not letters.
 * Same discipline as src/judge.mjs: strict JSON, loud parse failures.
 */
export async function pairGraded(models, judgeRef, probe, answerFull, answerCompacted, { rng = Math.random } = {}) {
	const model =
		models.getModel(judgeRef.provider, judgeRef.modelId) ??
		models.getModelsOfType("text", judgeRef.provider)?.find((m) => m.id === judgeRef.modelId);
	if (!model) throw new Error(`judge model not found: ${judgeRef.provider}/${judgeRef.modelId}`);
	const fullIsA = rng() < 0.5;
	const a = fullIsA ? answerFull : answerCompacted;
	const b = fullIsA ? answerCompacted : answerFull;
	const prompt = `QUESTION:\n${probe.question}\n\nCandidate A:\n${a}\n\nCandidate B:\n${b}`;
	const message = await models.completeSimple(
		model,
		{ messages: [{ role: "system", content: JUDGE_PAIR_SYSTEM }, { role: "user", content: prompt }] },
	);
	const raw = (message.content ?? [])
		.filter((part) => part?.type === "text")
		.map((part) => part?.text ?? "")
		.join("");
	const parsed = parseJudgeJson(raw);
	const overall = String(parsed.overall ?? "tie").toLowerCase();
	const winner =
		overall === "a" ? (fullIsA ? "full" : "compacted") :
		overall === "b" ? (fullIsA ? "compacted" : "full") :
		"tie";
	return { winner, parsed, assignment: fullIsA ? "full=A" : "full=B" };
}

/* --------------------------------------------------- delta evaluation */

/**
 * Fire `probes` at both context levels and grade the DELTA.
 * `fullEntries` / `compactedEntries`: replayable store records (the compacted
 * side carries the real or synthetic pi.compaction marker).
 * `answer({messages, probe}) -> reply text`: the model seam (live endpoints in
 * the script, canned replies in the demo).
 * `judge` ({models, judgeRef, rng?}): optional; when present every probe is
 * also judged pairwise (blind: the judge never learns which level is which).
 *
 * Returns:
 * { rows: [{kind, question, fullOk, compactedOk, fullDetail, compactedDetail, winner}],
 *   delta: { fullPasses, compactedPasses, judgeFullWins, judgeCompactedWins, judgeTies } }
 */
export async function evalCompactionDelta({ fullEntries, compactedEntries, probes, answer, judge, rng } = {}) {
	const full = replayView(fullEntries);
	const compacted = replayView(compactedEntries);
	const rows = [];
	const delta = { fullPasses: 0, compactedPasses: 0, judgeFullWins: 0, judgeCompactedWins: 0, judgeTies: 0 };
	for (const probe of probes ?? []) {
		const fullAnswer = await answer({ messages: full.messages, probe });
		const compactedAnswer = await answer({ messages: compacted.messages, probe });
		const fullGrade = probe.grade(fullAnswer);
		const compactedGrade = probe.grade(compactedAnswer);
		if (fullGrade.ok) delta.fullPasses += 1;
		if (compactedGrade.ok) delta.compactedPasses += 1;
		let winner;
		if (judge) {
			const verdict = await pairGraded(judge.models, judge.judgeRef, probe, fullAnswer, compactedAnswer, judge.rng ? { rng: judge.rng } : {});
			winner = verdict.winner;
			if (verdict.winner === "full") delta.judgeFullWins += 1;
			else if (verdict.winner === "compacted") delta.judgeCompactedWins += 1;
			else delta.judgeTies += 1;
		}
		rows.push({
			kind: probe.kind,
			question: probe.question,
			fullOk: fullGrade.ok,
			compactedOk: compactedGrade.ok,
			fullDetail: fullGrade.detail,
			compactedDetail: compactedGrade.detail,
			winner,
		});
	}
	return { rows, delta };
}

/* --------------------------------------------- synthetic window sweep */

/** Small deterministic PRNG so sweeps are reproducible per seed. */
export class Lcg {
	constructor(seed = 97) {
		this.s = (seed >>> 0) || 1;
	}
	next() {
		this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
		return this.s / 4294967296;
	}
}

const FILLER_WORDS =
	"rig store broker verification demo seat model window token context compaction measure probe harness item queue wake drift transcript boundary marker summary needle fold".split(" ");

function fillerSentence(rng, words = 9) {
	const parts = [];
	for (let i = 0; i < words; i++) parts.push(FILLER_WORDS[Math.floor(rng.next() * FILLER_WORDS.length)]);
	return parts.join(" ");
}

/**
 * A deterministic synthetic transcript of about `targetTokens` tokens
 * (estimated at pi-ai 3.5 chars/token), with plants at fixed fractions:
 * - `constraint` planted at ~10% (a standing decision),
 * - an artifact path at ~35%,
 * - the recall needle at ~85% (the area whose loss a too-shallow cut exposes).
 *
 * Returns { messages, plants, estimatedTokens } where plants carry the exact
 * strings a probe must recover. Same seed -> same transcript, so a sweep is
 * reproducible; different seeds -> different needles, so a probe cannot be
 * answered from a previous run.
 */
export function buildHaystack({ targetTokens, seed = 97, turnTokens = 220 } = {}) {
	const rng = new Lcg(seed);
	const tag = (targetTokens % 999983).toString(36);
	const needle = `DURIG-NEEDLE-${seed}-${tag}`;
	const artifactPath = `src/compacteval-fixture/${seed}/sweep-artifact-${tag}.mjs`;
	const constraint = "Standing constraint (verbatim): rewrite-free history is required in the shared tree.";
	const plants = { needle, artifactPath, constraint };
	const messages = [];
	let est = 0;
	const plantSpans = [
		{ at: 0.1, text: constraint },
		{ at: 0.35, text: `the artifact created was ${artifactPath} and nothing else` },
		{ at: 0.85, text: `the marker token for this sweep is ${needle}` },
	];
	let turn = 0;
	while (est < targetTokens) {
		const frac = est / targetTokens;
		const plant = plantSpans.find((p) => frac < p.at && est + 2 * turnTokens >= targetTokens * p.at);
		const userText =
			plant !== undefined
				? `${fillerSentence(rng, 14)} ${plant.text} ${fillerSentence(rng, 14)}`
				: `${fillerSentence(rng, 10)} (turn ${turn})`;
		messages.push({ role: "user", content: [{ type: "text", text: userText }] });
		est += Math.max(1, estimateMessageTokens(messages[messages.length - 1]));
		if (est >= targetTokens) break;
		const ack = { role: "assistant", content: [{ type: "text", text: `ack ${turn}` }] };
		messages.push(ack);
		est += Math.max(1, estimateMessageTokens(ack));
		turn += 1;
	}
	plants.estimatedTokens = est;
	return { messages, plants, estimatedTokens: est };
}

/** The sweep probe set: late recall, artifact citation, verbatim constraint. */
export function sweepProbes(plants) {
	return [
		recallProbe({ needle: plants.needle, lead: "Late in the material above a marker token was planted." }),
		artifactProbe({ paths: [plants.artifactPath] }),
		decisionProbe({ constraint: plants.constraint }),
	];
}

/**
 * The per-model EFFECTIVE WINDOW sweep (MECW-style, boundary flavor):
 * build the synthetic transcript per length, fire the probe set against the
 * injected `ask` seam ({messages, question} -> {reply, usage?}), grade
 * mechanically, and report per-length rows plus the boundary.
 *
 * `boundaryTokens` = the FIRST length where any probe missed (undefined when
 * none missed); `effectiveWindowLowerBound` = the last length where ALL probes
 * passed (undefined when the first length already failed). This is a LOWER
 * BOUND of MECW by construction and is labelled as such everywhere the number
 * is surfaced.
 */
export async function sweepWindow({ lengthsTokens, ask, seed = 97 } = {}) {
	if (!Array.isArray(lengthsTokens) || lengthsTokens.length === 0) throw new Error("sweepWindow needs lengthsTokens");
	if (typeof ask !== "function") throw new Error("sweepWindow needs an ask({messages, question}) seam");
	const rows = [];
	for (const target of [...lengthsTokens].sort((a, b) => a - b)) {
		const { messages, plants, estimatedTokens } = buildHaystack({ targetTokens: target, seed });
		const probes = sweepProbes(plants);
		let passes = 0;
		const misses = [];
		let usage = null;
		for (const probe of probes) {
			const out = await ask({ messages, question: probe.question });
			const grade = probe.grade(out?.reply ?? "");
			if (grade.ok) passes += 1;
			else misses.push({ kind: probe.kind, detail: grade.detail });
			if (out?.usage) usage = out.usage;
		}
		rows.push({
			targetTokens: target,
			estimatedTokens,
			probeHits: passes,
			probes: probes.length,
			misses,
			reportedUsage: usage
				? { input: usage.input ?? null, cacheRead: usage.cacheRead ?? null, cacheWrite: usage.cacheWrite ?? null, totalTokens: usage.totalTokens ?? null }
				: null,
			allPassed: misses.length === 0,
		});
	}
	const firstFail = rows.find((row) => !row.allPassed);
	const lastPass = [...rows].reverse().find((row) => row.allPassed);
	return {
		seed,
		rows,
		boundaryTokens: firstFail ? firstFail.targetTokens : undefined,
		effectiveWindowLowerBound: lastPass ? lastPass.targetTokens : undefined,
	};
}
