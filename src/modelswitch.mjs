// Amendment #154 (queue item #154, folded into #148): a model CHANGE defaults to a context
// RESET via `conversation.reset(handoff)` — NOT a new conversation — and the handoff must
// (a) report the switch (old model -> new model, and that this reset exists because of it)
// and (b) carry the in-flight `claimed` queue items so the session on the far side of the
// boundary knows what work it already owns. This module builds ONLY that handoff text and
// detects the change; it never writes — the boundary is always written by the caller that
// already holds the harness, exactly like `cmdReset` (cli.mjs) does. Keeping it pure is what
// lets demo/modelchangeswitch.test.mjs assert the four acceptance clauses (boundary written,
// transcript survives, claimed item surfaced, switch reported) without a live model.

import { RigQueue } from "./rig.mjs";

/**
 * Is this seat's declared model a CHANGE from what its conversation already runs?
 *
 * Both sides resolve to bare model ids (`deepseek-ai/DeepSeek-V4-Flash-0731` vs
 * `XiaomiMiMo/MiMo-V2.6-Flash` style) before comparison, because `resolveSeatModel`
 * (src/seatmodel.mjs) splits a `"provider/modelId"` raw string using the registered
 * provider prefix — `AgentState.model.modelId` is already the bare id, while the rig spec's
 * `seat.model` may still carry the prefix. Comparing raw strings would report a false
 * "change" for every rig that writes the id with its provider prefix and nothing at all for
 * one that does not.
 *
 * @param {{model: {modelId?: string, provider?: string}?}} storedAgent Conversation's AgentState
 *   (read from `harness.snapshot(AgentDoc, ...)` or `conv.agent()`), or undefined/null for a
 *   conversation that has never been configured.
 * @param {string} declaredModelId the model id `resolveSeatModel` resolved for this seat from
 *   the rig file (see `prompt.seatModel.modelId` in `cmdUp`).
 * @param {(seatModelRaw: string) => string} bareModelId a resolver for the rig-file side's raw
 *   string — inject `resolveSeatModel(...).modelId` at the call site (not here) so this module
 *   does not need the `Models` registry, keeping it unit-testable against any fixture.
 * @returns {boolean} true when the conversation must be reset because the model changed.
 */
export function isModelChanged(storedAgent, declaredModelId, bareModelId) {
	const stored = storedAgent?.model?.modelId;
	if (typeof declaredModelId !== "string" || declaredModelId === "") return false;
	if (typeof stored !== "string" || stored === "") return false;
	return bareModelId(declaredModelId) !== bareModelId(stored);
}

/**
 * The `pi.reset` handoff for a model switch: reports the switch and carries the seat's
 * in-flight `claimed` queue items (amendment #154's two required halves).
 *
 * @param {object} opts
 * @param {string} opts.seat the seat name being reset (for traceability in the handoff).
 * @param {string} opts.oldModel id the conversation ran under before the change.
 * @param {string} opts.newModel id the rig file now declares.
 * @param {readonly{id:number,subject:string,from:string,status:string}[]} opts.claimedItems
 *   items currently `status === "claimed"` for this seat (read from `RigQueue` in the same
 *   pass the caller already makes for `Seats` — one `documentState` sweep, no second query).
 * @returns {string} the handoff text (never empty: even with zero claimed items it still
 *   reports the switch, which is half the acceptance criterion).
 */
export function modelChangeHandoff({ seat, oldModel, newModel, claimedItems }) {
	const lines = [
		`Model switch: this seat moved from ${oldModel} to ${newModel} (changed in the rig file).`,
		"A context reset was written because of this model change — not a new conversation; the durable transcript is preserved and this boundary starts a clean context for the new model.",
	];
	if (claimedItems.length === 0) {
		lines.push(`No in-flight claimed queue items for ${seat} at the time of the switch.`);
	} else {
		lines.push(
			`In-flight claimed queue items for ${seat} (continue these past the boundary): ${claimedItems
				.map((it) => `#${it.id} "${it.subject}" (from ${it.from})`)
				.join("; ")}.`,
		);
	}
	return lines.join("\n");
}

/**
 * Read one seat's claimed queue items — the `claimed`-status slice amendment #154 says must be
 * carried into the handoff — from the already-read `RigQueue` state (never triggers its own
 * query: the caller passes `queueState` from the same `documentState`/`snapshot` pass it uses
 * for `Seats`/`AgentDoc`).
 *
 * @param {{value?: {items?: readonly {to: string, status: string}[]}}|undefined} queueState
 *   `harness.documentState(RigQueue, ...)` / `snapshot(RigQueue, ...)` result (or its `.value`).
 * @param {string} seat the seat whose claims we want.
 * @returns {readonly{id:number,subject:string,from:string,status:string}[]}
 */
export function claimedItemsForSeat(queueState, seat) {
	// Tolerate the caller passing either the DocumentState wrapper or the raw `.value`:
	// both `harness.documentState()` (returns `{value}`) and `tx.doc(RigQueue)` (returns the
	// value itself) appear at call sites in cli.mjs, and swallowing the difference here means
	// the caller never has to unwrap — but a missing/structurally-wrong input still yields an
	// empty list rather than throwing, because an unreadable queue must not block the reset
	// itself (the reset is the safety act; the handoff's claimed-items half degrades to "none
	// carried" only if the queue genuinely cannot be read, which this surfaces as `[]` and the
	// caller is expected to log — see demo/modelchangeswitch.test.mjs's non-empty case).
	const items = queueState?.value?.items ?? queueState?.items;
	if (!Array.isArray(items)) return [];
	return items.filter((it) => it?.to === seat && it?.status === "claimed");
}