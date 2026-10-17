// supervisor.mjs — the narrow supervisor's ESCALATION pass (ROADMAP 42 / P3).
//
// Why this exists at all: the driver recovers mechanically (provider retry, re-wake, `doctor`
// re-arm) but nothing ESCALATES a persistent problem to the human. ROADMAP item 42 left an
// evaluation gate — build the supervisor only if dogfooding shows a residual class the driver +
// notices cannot handle. This run met it: a seat failed run after run (tool-call failures,
// `model_error`) and a question sat parked on a seat for 78 minutes, and neither reached the human.
// So this builds the narrow supervisor for exactly that class: consume the notices durig already
// derives and, for the two that need a human, park the item on the human.
//
// It is an OBSERVER, not a participant: it writes only through the EXISTING defer representation
// (`status:"deferred"`, `deferredTo:"human"`) that `defer_work` already uses, so there is no new
// write path and no new polling tool (D23/D24: push, not pull). The driver stays mechanical;
// escalation lives here. `run --watch` runs this as a pass (bounded, idempotent).

import { REPEATED_FAILURE_STREAK } from "./attention.mjs";
import { DEFERRED_TO_HUMAN, RigQueue, isTerminalItem } from "./rig.mjs";

/** How long a question parked on another SEAT waits before the human is escalated. */
export const DEFERRED_TO_SEAT_MS = 15 * 60_000;

/**
 * The leading run of failed submissions in a newest-first page. Pure, so the planner can be
 * tested without a harness. A `done` run ends the streak — the seat did make progress.
 */
export function failureStreak(submissions) {
  let streak = 0;
  for (const submission of submissions ?? []) {
    if (submission?.status !== "unanswered") break;
    streak++;
  }
  return streak;
}

/** Milliseconds since the item was last deferred, or null when it carries no deferral time. */
function deferredAgeMs(item, nowMs) {
  const last = (item?.transitions ?? []).filter((t) => t.event === "deferred").at(-1);
  const at = Date.parse(last?.at ?? "");
  return Number.isFinite(at) ? nowMs - at : null;
}

/**
 * The human escalations to apply this pass. Pure: it decides, `applyEscalations` writes.
 *
 * Two classes, both ending in "a human must decide":
 *   - a seat that has failed `repeatedFailureStreak` runs in a row and still holds a non-terminal
 *     item — its run cannot make progress, so the item is parked on the human;
 *   - a question parked on ANOTHER SEAT beyond `deferredToSeatMs` without an answer — the edge
 *     that was supposed to answer is not, so it is escalated to the human.
 * Idempotent by construction: an item already owned by the human (`deferredTo === "human"`) is
 * never re-planned, so repeated passes are harmless.
 *
 * @param {{seats: Array<{name:string, conversationId:number|string}>, queueItems: Array, failureStreakByConv: Map<number|string, number>, nowMs?: number, repeatedFailureStreak?: number, deferredToSeatMs?: number}} input
 * @returns {Array<{seat:string, itemId:number, reason:string, question:string}>}
 */
export function planEscalations({
  seats,
  queueItems,
  failureStreakByConv,
  nowMs = Date.now(),
  repeatedFailureStreak = REPEATED_FAILURE_STREAK,
  deferredToSeatMs = DEFERRED_TO_SEAT_MS,
}) {
  const plans = [];
  const escalatedItemIds = new Set();
  for (const seat of seats ?? []) {
    const streak = failureStreakByConv?.get(seat.conversationId) ?? 0;
    if (streak < repeatedFailureStreak) continue;
    // The item a human can actually decide on: the seat's oldest non-terminal one. A `deferred`
    // item is excluded here — the queue scan below covers the ones parked on a seat.
    const held = (queueItems ?? [])
      .filter((it) => it.to === seat.name && (it.status === "claimed" || it.status === "queued"))
      .sort((a, b) => a.id - b.id)[0];
    if (!held || held.deferredTo === DEFERRED_TO_HUMAN) continue;
    escalatedItemIds.add(held.id);
    plans.push({
      seat: seat.name,
      itemId: held.id,
      reason: "repeated_failure",
      question: `supervisor escalation: ${seat.name} has failed ${streak} runs in a row and still holds #${held.id} (${held.subject}). It cannot make progress without a human decision.`,
    });
  }
  for (const item of queueItems ?? []) {
    if (item.status !== "deferred") continue;
    if (escalatedItemIds.has(item.id)) continue;
    // Already on the human, or on a seat with no recorded deferral time to measure.
    if (!item.deferredTo || item.deferredTo === DEFERRED_TO_HUMAN) continue;
    const age = deferredAgeMs(item, nowMs);
    if (age === null || age < deferredToSeatMs) continue;
    escalatedItemIds.add(item.id);
    plans.push({
      seat: item.to,
      itemId: item.id,
      reason: "deferred_awaiting_answer",
      question: `supervisor escalation: #${item.id} (${item.subject}) has waited on ${item.deferredTo} for ${Math.round(age / 60_000)} min with no answer. Escalated to the human.`,
    });
  }
  return plans;
}

/**
 * Apply the plans through the defer representation `defer_work` already uses. One commit, so the
 * queue is never half-updated; returns the plans actually applied (an item that vanished or was
 * completed between planning and applying is skipped, not forced).
 */
export async function applyEscalations(harness, plans, context) {
  if (!plans || plans.length === 0) return [];
  return harness.commit(async (tx) => {
    const queue = await tx.doc(RigQueue);
    const applied = [];
    for (const plan of plans) {
      const item = queue.items.find((it) => it.id === plan.itemId);
      if (!item || isTerminalItem(item)) continue;
      item.status = "deferred";
      item.question = plan.question;
      item.deferredTo = DEFERRED_TO_HUMAN;
      item.transitions.push({
        at: new Date().toISOString(),
        event: "deferred",
        by: "supervisor",
        to: DEFERRED_TO_HUMAN,
      });
      applied.push(plan);
    }
    return applied;
  }, context);
}

/**
 * The degenerate seats to reset this pass. Pure: it decides, `applyResets` writes.
 *
 * This is the intervention the metrics alone could not make: `step-repetition` and
 * `malformed-tool-call` DETECT a seat going degenerate, but nothing acted on them, so a
 * seat could loop for hours until an operator noticed (F29). Resetting the conversation
 * clears the context the loop feeds on; the durable instructions re-anchor it on the next
 * wake. Only seats the detector flags are planned, so a healthy rig is untouched.
 *
 * @param {{seats: Array<{name:string, conversationId:number|string}>, assessmentsByConv: Map}} input
 * @returns {Array<{seat:string, conversationId:number|string, reason:string, detail:string}>}
 */
export function planResets({ seats, assessmentsByConv }) {
	const plans = [];
	for (const seat of seats ?? []) {
		const assessment = assessmentsByConv?.get(seat.conversationId);
		if (!assessment?.degenerate) continue;
		plans.push({
			seat: seat.name,
			conversationId: seat.conversationId,
			reason: "degeneration",
			detail: assessment.reasons.join(", "),
		});
	}
	return plans;
}

/**
 * Apply the resets through the EXISTING reset boundary (`conversation.reset`, the same write
 * `cli reset` uses) — no new write path and no queue annotation. A failure on one seat is
 * reported and does not abandon the others: one seat's storage problem must not leave the
 * rest looping.
 */
export async function applyResets(harness, plans, context) {
	const applied = [];
	for (const plan of plans ?? []) {
		// The handoff must name the CAUSE and the fix: a format fault, a wall-clock stall, a prose
		// loop, and a generic runaway each need a different re-anchor, or the model repeats the
		// same habit.
		const detail = String(plan.detail ?? "");
		let handoff;
		if (/pseudo-tool-call/.test(detail)) {
			// A tool call emitted as text is a FORMAT fault, not a runaway loop.
			handoff =
				`malformed tool call (${plan.detail}): your last turn wrote the tool call into the message ` +
				`TEXT — a <parameter name="…"> block — instead of using the tool API, so the run ended ` +
				`without acting. Your context is reset to break the pattern. Re-anchor from your durable ` +
				`instructions and the queue; re-claim your item if you still hold it, and issue each tool ` +
				`call through the tool channel, never as message text.`;
		} else if (/turn-duration/.test(detail)) {
			// A single turn that ran past the wall-clock bound is a STALL, not a loop: name the time
			// so the model re-anchors onto acting, not onto one long unbroken turn.
			handoff =
				`per-turn wall-clock bound (${plan.detail}): a single turn ran past the time bound ` +
				`without progressing — the run is stalling, not working. Your context is reset to break ` +
				`the stall. Re-anchor from your durable instructions and the queue; re-claim your item if ` +
				`you still hold it, and keep each turn short: act, then report.`;
		} else if (/language-drift/.test(detail)) {
			// A reply in another language is a LANGUAGE fault: a Chinese-family model drifted back
			// to its native script, and a drifted turn self-conditions later turns. The reset clears
			// that context; the handoff must restate the rule, not merely name the fault.
			handoff =
				`language-drift guard reset (${plan.detail}): your last reply was written in a ` +
				`language other than English. Think and write ONLY in English — reasoning, tool ` +
				`probes, comments, commit messages and replies; never switch languages mid-task. ` +
				`Your context is reset to break the pattern. Re-anchor from your durable ` +
				`instructions and the queue; re-claim your item if you still hold it.`;
		} else if (/degenerate-text/.test(detail)) {
			// A prose loop (a NAMED pattern): name the fault and the fix, or the model re-anchors onto
			// the same repeated-phrase habit.
			handoff =
				`degenerate text (${plan.detail}): your last turn filled its message with the same short ` +
				`phrase over and over instead of acting — the run is looping on its own output. Your ` +
				`context is reset to break the loop. Re-anchor from your durable instructions and the ` +
				`queue; re-claim your item if you still hold it, and state each next action ONCE, then ` +
				`issue it as a tool call.`;
		} else {
			handoff =
				`degeneration guard reset (${plan.detail}): the run you were in outgrew its bounds, ` +
				`so your context is reset to break the loop. Re-anchor from your durable instructions ` +
				`and the queue; re-claim your item if you still hold it.`;
		}
		const conv = await harness.conversation(plan.conversationId, context);
		if (!conv) continue;
		try {
			await conv.reset(handoff, context);
			applied.push(plan);
		} catch (err) {
			// Report and continue: a failed reset is surfaced, not swallowed, and one bad
			// conversation must not stop the guard from resetting the others.
			console.error(`supervisor: reset failed for ${plan.seat}: ${err?.message ?? err}`);
		}
	}
	return applied;
}
