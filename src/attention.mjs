// Attention: derive operator-visible notices from durable state. Pure
// functions over storage-shaped inputs so the same computation backs both
// `durig status` (one-shot) and the `durig watch` stream, and so the
// proving test can drive it without a live model.
//
// Blocked means one of three things an operator must hear about:
// - "idle_with_queued_work": work is addressed to the seat but nothing of
//   theirs is in flight and their last run settled — nobody will pick it
//   up until something wakes the seat.
// - "last_run_failed": the seat's most recent run ended unanswered (crash,
//   abort, provider error). The reason travels with the notice.
// - "deferred_awaiting_answer": the seat parked an item on a question and is
//   waiting for the answer. A deferred item is a fact, not an inference from
//   idleness, so it is reported even when the run also failed.
// - "admitted_not_started": a submission was admitted durably (the input
//   committed) but nothing has started a run for it - the `send` was killed
//   mid-flight (dogfood F11), so the rig reads idle-healthy while a request sits
//   unprocessed. Derived from already-persisted data only (no new write path,
//   D24).
// - "spend_cap_exceeded": the run was STOPPED BY THE RIG'S OWN SPEND CAP, not by a model
//   fault (#5047). Same visible shape as a model error (an unanswered run), entirely
//   different meaning: the next attempt costs the same money and meets the same cap. The
//   notice names the cap and says who may raise it, because the operator's reflex would
//   otherwise be "retry it".
// - "provider_auth": the provider REFUSED THE CREDENTIAL (#6081). Identical visible shape - an unanswered run,
//   again and again - opposite meaning: the operator sets a variable, and a human has nothing to decide. The
//   notice names the credential variable the rig reads and says nothing is escalated.
// - "context_over_window": ONE TURN moved more tokens than the seat's window allows (#5049,
//   ROADMAP 208). The fraction already existed in `status.context` and NOTHING consumed it, so a
//   seat reading 9.96x its window was displayed and dropped. The notice carries the denominator's
//   STATE and the axis, and it stays silent on the two known artifacts (a measure behind a
//   compaction/reset boundary, and a seat with no declared window). Notice only: it decides nothing.

// How long an admitted submission may sit unstarted before it is judged
// stranded. The submission record carries NO admission timestamp of its own
// (scanSubmissions returns only conversationId/type/status/entry/id), so the
// age is recovered from the admitted input ENTRY's timestamp, attached by the
// caller as `admittedAt`. The threshold separates a submission a live harness
// is about to schedule (fresh, under the wire) from one nothing is driving
// (aged past it).
export const STRANDED_ADMITTED_MS = 30_000;

/**
 * Consecutive failed runs after which a seat is surfaced as `repeated_failure`. The driver
 * retries and re-wakes, but a run that keeps failing is a DIAGNOSIS gap: only a human read of the
 * cause breaks the loop, so the supervisor escalates it (ROADMAP 42 / P3).
 */
export const REPEATED_FAILURE_STREAK = 3;

import { SPEND_CAUSE, isSpendStopMessage, spendCapNamed, PROVIDER_AUTH_CAUSE, isProviderAuthStopMessage, CONTEXT_OVER_WINDOW_CAUSE } from "./causes.mjs";
import { deadGateIds } from "./rig.mjs";
import { contextOverWindow } from "./context.mjs";
import { LOCAL_ENV_PREFIXES } from "./providers/local.mjs";

/** The credential variables the rig reads, derived from the prefixes that actually REGISTER a provider
 * (`src/providers/local.mjs`), so an operator-facing remedy can never name a variable the loader would
 * reject (#6081). */
const PROVIDER_KEY_ENVS = LOCAL_ENV_PREFIXES.map((prefix) => `${prefix}API_KEY`);

/** Thousands separator for token counts in operator text — 244751 and 244,751 are different reads. */
function tokens(n) {
	return Number.isFinite(n) ? n.toLocaleString("en-US") : String(n ?? "unknown");
}

/** Rejected-malformed-arguments tool calls after which a seat is surfaced as `malformed_tool_call`. */
export const MALFORMED_TOOL_CALL_NOTICE = 2;

/**
 * The harness's marker for a tool call whose ARGUMENTS failed schema validation (`invalid_arguments`
 * in pi-durable's tool.ts). This is a CAUSE, not a symptom: a file-not-found or an edit's oldText
 * mismatch is the model's normal feedback loop and must NOT count. The structured diagnostic code
 * is not persisted on the entry (only its text is), so this reads the one marker the harness emits
 * for the malformed-arguments cause — recorded as the blind spot rather than hidden.
 */
const MALFORMED_ARGUMENTS_MARKER = /\[error\] Validation failed for tool "/;

/** Did this entry record a tool call the harness rejected as malformed arguments? */

function deferredTargetPhrase(deferredTo) {
	if (!deferredTo) return "waiting on an answer";
	if (deferredTo === "nobody") return "waiting on an answer — NO TARGET was recorded, so nobody has been asked";
	if (deferredTo === "human") return "waiting on human";
	return `waiting on ${deferredTo}`;
}

export function isMalformedToolResult(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : entry?.model;
	if (message?.isError !== true) return false;
	const parts = Array.isArray(message.content) ? message.content : [];
	return MALFORMED_ARGUMENTS_MARKER.test(parts.map((part) => part?.text ?? "").join("\n"));
}

/** How many malformed-argument tool calls are in a seat's entry page. */
export function countMalformedToolCalls(entries) {
	let count = 0;
	for (const entry of entries ?? []) {
		if (entry?.kind !== "pi.tool-result") continue;
		if (isMalformedToolResult(entry)) count++;
	}
	return count;
}

/**
 * The model's recurrent malformed shape: a tool-call block written into the message TEXT instead
 * of the tool channel. Two forms were observed (`impl`, three times on #700):
 *   - DeepSeek's DSML framing — a `<parameter name="TOOL">` opener, then argument tags written
 *     with the DSML special-token delimiter (fullwidth vertical line, "DSML", fullwidth vertical
 *     line) and a matching `invoke`/`calls` close. The delimiter must never appear in ordinary
 *     prose, so it is the reliable tell; the terminal strips it, which is why a screen read showed
 *     a plain `<parameter>` and hid the fault.
 *   - the plain nested form — a `<parameter name="TOOL">` opener immediately followed by a second
 *     `<parameter name="ARG">`, with no `<invoke>` between them.
 * Kept strict on purpose: the remediation is a context reset, and D64 accepts one wasted reset as
 * cheaper than a seat stalled mid-item with an uncommitted artifact.
 */
const DSML_TOOL_DELIMITER = /\uFF5CDSML\uFF5C/;
const PLAIN_PARAMETER_BLOCK = /<parameter\s+name="[^"]+"\s*>\s*<parameter\s+name="/;

/**
 * Did this assistant turn try to act but emit the tool call as text instead of a tool call?
 *
 * @param {{kind?:string, model?:unknown}} entry one seat entry
 * @returns {boolean}
 */
export function isPseudoToolCallTurn(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : entry?.model;
	if (!message || message.role !== "assistant") return false;
	const parts = Array.isArray(message.content) ? message.content : [];
	// A real tool call means the model used the tool channel; there is nothing to repair.
	if (parts.some((part) => part?.type === "toolCall")) return false;
	const text = parts
		.filter((part) => part?.type === "text")
		.map((part) => part?.text ?? "")
		.join("\n");
	return DSML_TOOL_DELIMITER.test(text) || PLAIN_PARAMETER_BLOCK.test(text);
}

/**
 * How many assistant turns in a page emitted a tool call as text (the F29-adjacent fault the
 * validation-error marker cannot see, because no tool call was ever submitted to be rejected).
 *
 * @param {Array<{kind?:string, model?:unknown}>} entries seat entries
 * @returns {number}
 */
export function countPseudoToolCalls(entries) {
	let count = 0;
	for (const entry of entries ?? []) {
		if (entry?.kind !== "pi.assistant") continue;
		if (isPseudoToolCallTurn(entry)) count++;
	}
	return count;
}

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_CHAR = /[A-Za-z]/;
// Code spans are stripped before judging a reply's language: a code block may hold CJK data
// (a quoted label, a fixture), and counting it would false-positive on a legitimate report.
const CODE_SPAN = /```[\s\S]*?```|`[^`]*`/g;

/**
 * Did this assistant turn reply in a non-English (CJK) script? The constitution's P3
 * Language rule is one line in a large system prompt, and a Chinese-family model (GLM,
 * Qwen) drifts back to its native language under load; once a drifted turn is in the
 * transcript it self-conditions every later turn, so the guard must reset the seat (D85).
 *
 * This is deliberately not "contains a CJK character": a reply that quotes a Chinese
 * filename or error string is normal. The tell is a reply whose LETTERS are predominantly
 * CJK — measured over CJK ideographs/kana vs Latin letters, with code spans excluded — so a
 * Chinese quotation inside an English report cannot trip it, while a reply actually
 * composed in Chinese does.
 *
 * @param {{kind?:string, model?:unknown}} entry one seat entry
 * @param {{minChars?:number, minRatio?:number}} [opts]
 * @returns {boolean}
 */
export function isLanguageDriftTurn(entry, opts = {}) {
	const minChars = opts.minChars ?? 40;
	const minRatio = opts.minRatio ?? 0.5;
	const message = Array.isArray(entry?.model) ? entry.model[0] : entry?.model;
	if (!message || message.role !== "assistant") return false;
	const parts = Array.isArray(message.content) ? message.content : [];
	const text = parts
		.filter((part) => part?.type === "text")
		.map((part) => part?.text ?? "")
		.join("\n")
		.replace(CODE_SPAN, "");
	let cjk = 0;
	let latin = 0;
	for (const ch of text) {
		if (CJK_CHAR.test(ch)) cjk++;
		else if (LATIN_CHAR.test(ch)) latin++;
	}
	const letters = cjk + latin;
	if (letters === 0) return false;
	return cjk >= minChars && cjk / letters >= minRatio;
}

/**
 * How many assistant turns in a page replied in a non-English script. The degeneration
 * guard's own cause (the D77 shape): a language-drifted run is a fault the repetition and
 * malformed counts cannot see, because the run is otherwise structurally clean.
 *
 * @param {Array<{kind?:string, model?:unknown}>} entries seat entries
 * @param {{minChars?:number, minRatio?:number}} [opts]
 * @returns {number}
 */
export function countLanguageDriftTurns(entries, opts = {}) {
	let count = 0;
	for (const entry of entries ?? []) {
		if (entry?.kind !== "pi.assistant") continue;
		if (isLanguageDriftTurn(entry, opts)) count++;
	}
	return count;
}

/**
 * NAMED-PATTERN registry for degenerate PROSE. Each pattern is a PURE predicate over ONE
 * assistant turn's joined message text, so a new degeneracy SHAPE is one new entry here — no
 * change to assessRun, the supervisor, or the test plumbing.
 *
 * Why a registry and not a single heuristic: D78 shipped one fragment-repetition rule and it
 * false-positived on real transcripts the moment it went live (it reset five healthy seats). The
 * lesson (docs/DECISIONS.md D78 REVERTED) is that a context-resetting heuristic must be validated
 * against EVERY seat's real pages with ZERO false positives, and that a slightly different shape
 * must be cheap to add. Naming each pattern makes the firing cause legible in the reason
 * (`degenerate-text=<name>=N`) and lets each pattern be tested independently against the stored
 * fixtures in demo/fixtures/degenerate-text/.
 */

/** A turn's text as trimmed, non-empty sentences. Fenced code is dropped: code repeats legitimately. */
function sentences(text) {
	const body = String(text ?? "").replace(/```[\s\S]*?```/g, " ");
	return body
		.split(/[\n.!?]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Lowercase, collapse whitespace, drop punctuation, so "Emit." and "emit" compare equal. */
function normalizePhrase(text) {
	return text
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[^a-z0-9 ]/g, "")
		.trim();
}

/** The longest run of consecutive "short" sentences, with the number of distinct phrases in it. */
function longestShortRun(sents, maxSentenceLen) {
	let best = { run: 0, distinct: 0 };
	let i = 0;
	while (i < sents.length) {
		if (sents[i].length > maxSentenceLen) {
			i++;
			continue;
		}
		let j = i;
		const distinct = new Set();
		while (j < sents.length && sents[j].length <= maxSentenceLen) {
			distinct.add(normalizePhrase(sents[j]));
			j++;
		}
		if (j - i > best.run) best = { run: j - i, distinct: distinct.size };
		i = j;
	}
	return best;
}

export const TEXT_PATTERNS = [
	{
		name: "short-sentence-wall",
		// The observed F29 shape: the tail of a turn becomes a long UNBROKEN run of very short
		// sentences ("Emit. OK. Go. Now." / "Completing:") with almost no variety. A healthy
		// document does not put dozens of near-identical micro-sentences in a row; when it does
		// have many short lines (a list), the lines DIFFER, so `distinct` is high and this does
		// not fire. Thresholds are deliberately conservative and the real-corpus gap is wide:
		// degenerate walls run 61+ consecutive short sentences at <= 20 distinct, while the
		// healthy fixtures never string more than a handful together. (D78 lesson: measure against
		// real pages, not synthetic fixtures.)
		detect(text, opts = {}) {
			const maxSentenceLen = opts.maxSentenceLen ?? 30;
			const minRun = opts.minRun ?? 60;
			const maxDistinct = opts.maxDistinct ?? 20;
			const { run, distinct } = longestShortRun(sentences(text), maxSentenceLen);
			return run >= minRun && distinct <= maxDistinct;
		},
	},
];

/** The names of the prose patterns one turn's text matches (usually none). */
export function matchTextPatterns(text, opts = {}) {
	return TEXT_PATTERNS.filter((pattern) => pattern.detect(text, opts)).map((pattern) => pattern.name);
}

/** Joined text of one assistant entry (empty for any other entry kind). */
export function assistantText(entry) {
	const message = Array.isArray(entry?.model) ? entry.model[0] : entry?.model;
	if (!message || message.role !== "assistant") return "";
	const parts = Array.isArray(message.content) ? message.content : [];
	return parts
		.filter((part) => part?.type === "text")
		.map((part) => part?.text ?? "")
		.join("\n");
}

/** Per-pattern counts of the assistant turns in a page that match each prose pattern. */
export function countTextPatternTurns(entries, opts = {}) {
	const counts = {};
	for (const entry of entries ?? []) {
		if (entry?.kind !== "pi.assistant") continue;
		for (const name of matchTextPatterns(assistantText(entry), opts)) {
			counts[name] = (counts[name] ?? 0) + 1;
		}
	}
	return counts;
}

/**
 * The reason a run failed, plus the CAUSE when the entry knows it.
 *
 * A submission record carries a category - "model_error" - and nothing else,
 * while the entry carries the provider's message. Those two are not
 * interchangeable to a reader: a transient rate limit and a real fault look
 * identical as a category, and they call for opposite responses (wait it out,
 * or go investigate). Found by dogfooding, F3 in docs/DOGFOOD.md.
 */
function failureDetail(latest, errorMessage) {
	const reason = String(latest.reason ?? "unknown reason");
	const cause = summarizeError(errorMessage);
	return cause ? `${reason}: ${cause}` : reason;
}

/**
 * A readable one-liner from a provider error string. These usually arrive as
 * "NNN: {json}" with the useful part under `message`, and the raw string can
 * carry a whole response body - so this is best-effort and always bounded.
 * Exported so a caller can reuse it rather than re-deriving the same rule.
 */
export function summarizeError(errorMessage) {
	const raw = String(errorMessage ?? "").trim();
	if (!raw) return "";
	const json = /^(\d{3}):\s*(\{[\s\S]*\})$/.exec(raw);
	if (json) {
		try {
			const parsed = JSON.parse(json[2]);
			const message = parsed?.message ?? parsed?.error?.message;
			if (message) return `${json[1]}: ${String(message).slice(0, 160)}`;
		} catch {
			// Not JSON after all; the bounded raw form below is still useful.
		}
	}
	return raw.replace(/\s+/g, " ").slice(0, 160);
}

/**
 * @param {Array<{name:string, conversationId:number|string, role?:string}>} seats
 * @param {Array<{to:string, status:string}>} queueItems
 *        items may also carry `deferredTo` (which seat, or "human", an item is parked on)
 * @param {Map<number|string, {status:string, reason?:string, admittedAt?:number}|undefined>} latestByConv
 *        latest submission record per conversation id (any status). `admittedAt`
 *        is the timestamp of the submission's admitted input entry, recovered
 *        by the caller from the entry because the record itself has none.
 * @param {Map<number|string, string>} [errorByConv] latest provider error per conversation
 * @returns {Array<{scope:string, seat:string, kind:string, detail:string}>}
 *
 * Every notice carries a `scope`, added alongside `seat` rather than replacing
 * it (additive, so an existing reader keying on `seat` keeps working). Seat
 * notices are `scope:"seat"`; the metrics layer contributes rig- and
 * queue-scoped notices with a null seat, and a per-seat renderer must exclude
 * those EXPLICITLY - filtering on the seat field alone would put a rig-wide
 * notice on whichever seat row happened to match.
 *
 * `nowMs`, `seatsWithSlot` and `strandedMs` pin the facts behind the stranded
 * rule: the submission record and its entry timestamp are persisted, but
 * whether a harness is presently driving the submission is NOT, so "started"
 * is inferred from a live generation slot plus the admission age - passed in
 * here rather than fabricated.
 */
export function computeAttention(
	seats,
	queueItems,
	latestByConv,
	errorByConv = new Map(),
	{ nowMs = Date.now(), seatsWithSlot = new Set(), strandedMs = STRANDED_ADMITTED_MS, failureStreakByConv = new Map(), repeatedFailureStreak = REPEATED_FAILURE_STREAK, malformedCountByConv = new Map(), malformedToolCallNotice = MALFORMED_TOOL_CALL_NOTICE, contextBySeat = null, compactGateBySeat = {} } = {},
) {
	const notices = [];
	for (const seat of seats) {
		const queued = queueItems.filter((it) => it.to === seat.name && it.status === "queued");
		// Work explicitly parked on an unanswered question. This is the visible half
		// of deferring to a human (MAST: no reason to defer to humans, 6.8%): before
		// it, a seat that needed a decision could only say so in prose, and prose
		// appears nowhere an operator looks. Reported before the failed-run check
		// and without `continue`, because a parked item is a durable fact rather
		// than an inference from idleness - a failed run does not unpark it.
		const deferred = queueItems.filter((it) => it.to === seat.name && it.status === "deferred");
		if (deferred.length > 0) {
			const held = deferred[0];
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "deferred_awaiting_answer",
				// #4574: the target is rendered as WHAT IT MEANS, not echoed raw. A deferral with no target records
				// `DEFERRED_TO_NOBODY`, and echoing it verbatim prints "waiting on nobody" — a new value silently
				// taking the old branch in a new spelling.
				detail: `${deferred.length} item(s) parked on a question; #${held.id} ${deferredTargetPhrase(held.deferredTo)}`,
			});
		}
		// #6215: a queued row whose gate names a CANCELLED row can NEVER be claimed. Until this notice
		// existed the only symptom was a seat that never wakes: the row counts as `queued` in every
		// census, and the reason appears only inside a claim response the seat never receives, because it
		// never gets to claim. The notice is the operator-visible half of the enqueue rule; it ACCEPTS,
		// it never decides (#3271) - nothing parks or cancels on it.
		const starved = queued.filter((it) => deadGateIds(it, queueItems).length > 0);
		if (starved.length > 0) {
			const named = starved.map((it) => `#${it.id} gates on cancelled #${deadGateIds(it, queueItems).join(", ")}`).join("; ");
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "starved_gate",
				detail: `${starved.length} queued item(s) can never be claimed: ${named}. The GATE is the problem, not the seat: fix the gate or cancel the dependent. See docs/runbooks/stale-held-backlog.md (umbrella rows are pointers, never gates).`,
			});
		}
		const streak = failureStreakByConv.get(seat.conversationId) ?? 0;
		// #5047: a run stopped by the rig's OWN cap is a money stop, not a model fault. Read from the entry's
		// message (the same source `last_run_failed` quotes), because the submission record carries only the
		// category `model_error` and the category is exactly what hides this cause. Reported INSTEAD of the streak
		// notice: the streak is a symptom of the same cap, and two notices for one cause is noise that reads as two
		// problems. Deliberately not a retry hint - the next attempt costs the same money and meets the same cap.
		const stopText = errorByConv?.get(seat.conversationId);
		if (isSpendStopMessage(stopText)) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: SPEND_CAUSE,
				detail:
					`the rig's own spend cap stopped this run${spendCapNamed(stopText) ? ` (${spendCapNamed(stopText)})` : ""}; ` +
					`not a model fault and not retried - the item is parked. Money record: .spike/gate/spend.jsonl; ` +
					`only the OPERATOR raises a cap, deliberately and for a named run (D193)`,
			});
		} else if (isProviderAuthStopMessage(stopText)) {
			// #6081: the credential, not the seat. Reported INSTEAD of the streak notice for the same reason the cap
			// stop is - the streak is one cause wearing three symptoms - and it does NOT escalate: a human has no
			// decision to make about a variable the broker process never had.
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: PROVIDER_AUTH_CAUSE,
				detail:
					`the provider refused the CREDENTIAL (${summarizeError(stopText)}); this is ENVIRONMENTAL, not a seat that cannot make progress. ` +
					`The rig reads the credential from the process that runs the broker: ${PROVIDER_KEY_ENVS.join(", ")}. ` +
					`Set the one this seat's provider uses there and re-wake - see docs/runbooks/local-provider-down.md. ` +
					`Nothing is escalated to a human and the seat is not reset: every retry meets the same refusal.`,
			});
		} else if (streak >= repeatedFailureStreak) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "repeated_failure",
				detail: `${streak} consecutive failed runs; the supervisor escalates it to the human`,
			});
		}
		const malformed = malformedCountByConv.get(seat.conversationId) ?? 0;
		if (malformed >= malformedToolCallNotice) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "malformed_tool_call",
				detail: `${malformed} tool call(s) rejected as malformed arguments; the seat is emitting invalid argument shapes`,
			});
		}
		// #5049 (ROADMAP 208): one turn moved more than the seat's window. The measure already existed and
		// nothing read it — `status.context` printed a fraction of 9.96 and the number went nowhere. It is
		// pushed BEFORE the failed-run branch on purpose: `last_run_failed` ends with `continue` (one notice per
		// cause), and a seat under context pressure is often a seat whose run just failed — suppressing the
		// context fact there would hide the likely CAUSE of the failure. This notice ACCEPTS, it never DECIDES
		// (#3271/#3575): nothing parks or retries on it, and the stop actuator is a different row (#1781).
		const measure = contextBySeat?.[seat.name] ?? null;
		if (measure) {
			const gate = compactGateBySeat?.[seat.name] ?? null;
			const over = contextOverWindow(measure, { keepRecentTokens: gate?.keepRecentTokens ?? null });
			if (over.fired) {
				notices.push({
					scope: "seat",
					seat: seat.name,
					kind: CONTEXT_OVER_WINDOW_CAUSE,
					detail:
						`one turn MOVED ${tokens(over.consumed)} tokens = ${over.fraction.toFixed(2)}x the ${over.denominator} window of ${tokens(over.windowValue)}; ` +
						`axis: tokens the provider MOVED in one turn (input+output+cacheRead+cacheWrite, cacheRead ${tokens(over.cacheRead)} of them), NOT the live head; ` +
						`measure is current (no pi.compaction/pi.reset entry after entry ${over.head?.usageEntryId ?? "?"}); ` +
						`the compact verb's gate is the accumulation budget: keepRecentTokens=${over.keepRecentTokens ?? "unknown"} willCut=${over.willCut ?? "unknown"}` +
						(over.keepRecentTokens === null
							? gate?.error
								? ` (DURIG_COMPACTION_* is invalid, so the gate cannot be read: ${gate.error})`
								: " (no DURIG_COMPACTION_* value is set here, so the gate is pi-durable's default and durig does not read it)"
							: "") +
						` — a notice, not a stop; remedies: docs/runbooks/context-over-window.md`,
				});
			}
		}
		const latest = latestByConv.get(seat.conversationId);
		// One notice per cause: the credential refusal above already names the stop, so the generic failed-run
		// line would report the same event twice under two classes (#6081, same rule as the cap stop).
		if (latest?.status === "unanswered" && !isSpendStopMessage(stopText) && !isProviderAuthStopMessage(stopText)) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "last_run_failed",
				detail: failureDetail(latest, errorByConv.get(seat.conversationId)),
			});
			continue; // a failed run explains idleness; one notice per cause
		}
		const inFlight =
			latest?.status === "queued" || latest?.status === "placed";
		// A submission admitted but never started is the rig reading idle-healthy
		// while a request sits unprocessed (dogfood F11): `send` was killed, the
		// submission stayed "queued"/"placed", and until now the inFlight guard
		// suppressed every notice. Detect it from the already-persisted admission
		// age plus the absence of a live generation slot (nothing is running, so
		// nothing will advance it).
		//
		// BLIND SPOT: a viewer never opens a harness (D11), so this cannot tell
		// "no harness will ever drive this submission" from "a live harness is
		// momentarily between scheduling passes"; strandage is inferred from the
		// admission age exceeding the threshold AND the seat holding no LIVE
		// generation slot. A live slot means a run is genuinely ahead of it and the
		// submission is legitimately waiting (backpressure), so it is not flagged;
		// a DEAD slot (stale holder) is treated as nothing running, so the
		// submission IS flagged stranded and the generation_stale notice separately
		// explains the wedged slot.
		if (latest && inFlight) {
			const age = Number.isFinite(latest.admittedAt) ? nowMs - latest.admittedAt : null;
			const seatHasSlot = seatsWithSlot.has(seat.name);
			if (age !== null && age > strandedMs && !seatHasSlot) {
				notices.push({
					scope: "seat",
					seat: seat.name,
					kind: "admitted_not_started",
					detail: `submission #${latest.id ?? latest.entry ?? "?"} admitted ${Math.round(
						age / 1000,
					)}s ago, no run started and no slot held; re-arm it with the resume/doctor verb (item 37(b))`,
				});
			}
		}
		if (queued.length > 0 && !inFlight) {
			notices.push({
				scope: "seat",
				seat: seat.name,
				kind: "idle_with_queued_work",
				detail: `${queued.length} queued item(s), last submission ${
					latest ? latest.status : "none"
				}`,
			});
		}
	}
	return notices;
}
