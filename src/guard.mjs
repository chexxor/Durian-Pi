// src/guard.mjs — the SHARED detect → halt → wait-idle → resolve ordering core.
//
// WHY THIS IS SHARED (lead #1766/#1773). Two triggers need the SAME machinery once a run has to
// be stopped: the ACTIVE degeneration guard (cause-based: a runaway turn / a degenerate loop) and
// the ordered CONTEXT-PRESSURE guard (#62: warn 80 → abort 90 → settle → one compaction). Their
// TRIGGERS are siblings and stay separate; the ordering is ONE mechanism, built ONCE here. A
// trigger decides WHAT fired; this core decides HOW the stop is carried out, in one fixed order.
//
// THE ORDER (the invariant). detect → HALT → WAIT IDLE → RESOLVE:
//   1. HALT cooperatively through the platform seam (`Conversation.abort` / `abortTask`, see
//      src/halt.mjs) — never a process kill, never a boundary reset of a live lease.
//   2. WAIT IDLE — confirm the generation lease is released before touching the conversation.
//      `reset`/`compact` REFUSE a seat holding a live lease (they corrupt the boundary), so the
//      old path (`applyResets` on a busy seat) was a no-op that left the run going. The wait is
//      what makes the resolve step admissible.
//   3. RESOLVE by cause — a caller-supplied resolution, so the SAME core serves both triggers:
//      degeneration → the cause-specific boundary reset (`resolveDegeneration`, which REUSES
//      `applyResets`' handoff mapping rather than duplicating it); context pressure → a
//      compaction. The core never resets a LIVE lease: it halts and waits first.
//
// BOUNDED AUTHORITY (lead #1766/#1773). The core may HALT only — no delete, no history rewrite,
// no destructive op; the stop is legible (`aborted:<reason>`) and observable (a notice), and the
// seat stays RECOVERABLE (its transcript is preserved, so a reset/compaction re-anchors it).
// No new write path and no schema: every write is an existing harness operation.

import { haltSeat } from "./halt.mjs";
import { applyResets } from "./supervisor.mjs";

/** The fixed order every guard follows. Named so a caller (and a doc) can point at one step. */
export const GUARD_STEPS = ["detect", "halt", "wait-idle", "resolve"];

/**
 * Wait until a conversation has no live non-background task — i.e. the generation lease has been
 * released. `Conversation.waitForIdle` resolves on the scope; `harness.inspect` then confirms no
 * task is still `running`, so a "waited" result is not taken on faith.
 *
 * @returns {Promise<{idle:boolean, state:string, liveTasks:number}>}
 */
export async function waitForIdle(harness, conversationId, context) {
	const conv = await harness.conversation(conversationId, context);
	if (!conv) return { idle: true, state: "not_found", liveTasks: 0 };
	await conv.waitForIdle(context);
	const tasks = (await harness.inspect(context))?.tasks ?? [];
	const live = tasks.filter(
		(t) => t.record?.conversationId === conversationId && t.record?.state?.status === "running",
	);
	return { idle: live.length === 0, state: live.length === 0 ? "idle" : "busy", liveTasks: live.length };
}

/**
 * The ordering core. HALT the triggered seat, WAIT for its lease, then RESOLVE by cause. Returns
 * a legible, step-by-step record so a caller can log or assert exactly what happened.
 *
 * @param {object} harness the open harness (the single writer)
 * @param {{seat:string, conversationId:number|string, reason:string, detail?:string}} plan
 * @param {{context:object, resolve:Function, background?:boolean, onNotice?:Function}} opts
 */
export async function haltIdleResolve(harness, plan, { context, resolve, background = true, onNotice } = {}) {
	const steps = [];
	const halt = await haltSeat(
		harness,
		{ name: plan.seat, conversationId: plan.conversationId },
		{ reason: plan.reason, context, background, onNotice },
	);
	steps.push({ step: "halt", halted: halt.halted, state: halt.state, label: halt.label });
	if (!halt.halted) return { resolved: false, outcome: "halt-failed", plan, steps, halt };

	const idle = await waitForIdle(harness, plan.conversationId, context);
	steps.push({ step: "wait-idle", idle: idle.idle, state: idle.state, liveTasks: idle.liveTasks });
	if (!idle.idle) return { resolved: false, outcome: "not-idle", plan, steps, halt, idle };

	const resolution = await resolve({ harness, plan, context });
	steps.push({ step: "resolve", applied: resolution?.applied === true, action: resolution?.action });
	return {
		resolved: resolution?.applied === true,
		outcome: resolution?.applied === true ? "resolved" : "resolve-failed",
		plan,
		steps,
		halt,
		idle,
		resolution,
	};
}

/**
 * The DEGENERATION resolution: the cause-specific boundary reset, REUSING `applyResets` (one
 * handoff mapping for the whole degeneration cause family — pseudo-tool-call, wall-clock,
 * language-drift, prose, generic — not a second copy here). Called only after the seat is idle.
 */
export async function resolveDegeneration({ harness, plan, context }) {
	const applied = await applyResets(
		harness,
		[{ seat: plan.seat, conversationId: plan.conversationId, reason: "degeneration", detail: plan.detail ?? "" }],
		context,
	);
	return { action: "reset", applied: applied.length > 0 };
}

/**
 * Pure: turn a trigger's assessment into an ordering plan, or null when nothing fired. Keeps the
 * decision testable without a harness; the trigger (src/inflight.mjs) supplies the assessment.
 */
export function planGuard({ seat, assessment, reason = "degeneration" }) {
	if (!assessment?.degenerate) return null;
	return {
		seat: seat?.name ?? null,
		conversationId: seat?.conversationId ?? null,
		reason,
		detail: Array.isArray(assessment.reasons) ? assessment.reasons.join(", ") : "",
	};
}
