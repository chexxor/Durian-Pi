// src/halt.mjs — the IN-BROKER halt actuator (item B / #1768).
//
// WHY. The degeneration guard's only intervention today is a BOUNDARY RESET: `applyResets`
// (src/supervisor.mjs) calls `conversation.reset(handoff)`, which the platform admits but, while
// the seat is busy, "places at the next boundary" — it does NOT interrupt the in-flight
// generation. `reset`/`compact` deliberately REFUSE a seat holding a live generation lease,
// because resetting a running seat corrupts the boundary. So a runaway turn keeps running: the
// reset cannot touch it, and the seat stays wedged until the turn ends on its own.
//
// THE SEAM IS ALREADY IN THE PLATFORM — this is WIRING, not new platform capability. A
// conversation's `abort(context, options?)` "withdraw[s] queued inputs, mark[s] every live
// non-background task of the ordinary ownership scope, signal[s] them, and resolve[s] once the
// scope is idle" (dist/harness/types.d.ts). That is a COOPERATIVE halt: the run invocation's
// `AbortSignal` fires, the generation stops at its next await, and the abort is recorded
// durably (`Submission.reason === "aborted"`). The `harness.abortTask(id)` seam is the same
// mechanism aimed at one task.
//
// WHY NOT process.kill. In-process, the generation lease is the BROKER's own pid (src/genlock.mjs
// writes `pid: process.pid`), so a `SIGKILL` aimed at the holder would kill the broker itself —
// `cmdStop`'s process.kill is an EXTERNAL-driver tool. Inside the broker the correct actuator is
// the cooperative abort, never a self-kill. It is also the only path that keeps the SINGLE
// WRITER invariant: the abort is admitted through the broker's own harness, so no second writer
// ever touches the store.
//
// BOUNDED AUTHORITY (lead #1766/#1773). The actuator may HALT ONLY — no delete, no history
// rewrite, no destructive op. The stop is LEGIBLE (`aborted:<reason>`) and OBSERVABLE (the
// durable submission record carries `reason:"aborted"`, and the returned notice names the seat).
// The seat stays RECOVERABLE: its transcript is untouched, so a following reset/compact can
// re-anchor it and it can run again.

/** The legible stop contract: every halt is labelled `aborted:<reason>`. */
export const HALT_LABEL_PREFIX = "aborted:";

/** The `aborted:<reason>` label for a halt cause. */
export function haltLabel(reason) {
	return `${HALT_LABEL_PREFIX}${reason ?? "unknown"}`;
}

/**
 * Halt ONE seat's in-flight generation cooperatively, through the platform's own abort seam.
 * Pure of storage and the clock: it only calls the conversation handle the harness already owns,
 * so it adds no write path and no schema.
 *
 * @param {object} harness the open harness (the single writer)
 * @param {{name?:string, conversationId:number|string}} seat
 * @param {{reason?:string, context:object, background?:boolean, onNotice?:(notice:object)=>void}} opts
 * @returns {Promise<{halted:boolean, state:string, seat:string|null, conversationId:*, reason:string,
 *   label:string, notice:object, error?:string}>}
 */
export async function haltSeat(harness, seat, { reason = "degeneration", context, background = true, onNotice } = {}) {
	const name = seat?.name ?? null;
	const conversationId = seat?.conversationId ?? null;
	const label = haltLabel(reason);
	const notice = { kind: "halted", seat: name, conversationId, reason, label };

	if (conversationId === null || conversationId === undefined) {
		const result = { halted: false, state: "no_conversation", seat: name, conversationId, reason, label, notice };
		if (typeof onNotice === "function") onNotice({ ...notice, state: result.state, halted: false });
		return result;
	}

	const conv = await harness.conversation(conversationId, context);
	if (!conv) {
		const result = { halted: false, state: "not_found", seat: name, conversationId, reason, label, notice };
		if (typeof onNotice === "function") onNotice({ ...notice, state: result.state, halted: false });
		return result;
	}

	try {
		// Cooperative: signals the live run's AbortSignal and resolves once the scope is idle.
		// `background: true` crosses background boundaries so a nested run is not left running.
		await conv.abort(context, { background });
		const result = { halted: true, state: "aborted", seat: name, conversationId, reason, label, notice };
		if (typeof onNotice === "function") onNotice({ ...notice, state: result.state, halted: true });
		return result;
	} catch (err) {
		const result = {
			halted: false,
			state: "failed",
			seat: name,
			conversationId,
			reason,
			label,
			notice,
			error: String(err?.message ?? err),
		};
		if (typeof onNotice === "function") onNotice({ ...notice, state: result.state, halted: false, error: result.error });
		return result;
	}
}

/**
 * Halt ONE task by id through `harness.abortTask` — the narrower seam, for a caller that already
 * holds the runaway task's id. Same contract and same bounded authority as `haltSeat`.
 */
export async function haltTask(harness, taskId, { reason = "degeneration", context, onNotice } = {}) {
	const label = haltLabel(reason);
	try {
		const outcome = await harness.abortTask(taskId, context);
		const notice = { kind: "halted", taskId, reason, label, outcome };
		if (typeof onNotice === "function") onNotice({ ...notice, halted: true });
		return { halted: true, state: "aborted", taskId, reason, label, outcome, notice };
	} catch (err) {
		const notice = { kind: "halted", taskId, reason, label };
		if (typeof onNotice === "function") onNotice({ ...notice, halted: false, error: String(err?.message ?? err) });
		return { halted: false, state: "failed", taskId, reason, label, notice, error: String(err?.message ?? err) };
	}
}
