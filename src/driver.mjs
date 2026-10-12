// src/driver.mjs — the missing clock (ROADMAP 38).
//
// A queue item addressed to a seat is inert: `send_work`/`complete_work` only
// write a row, and nothing wakes the recipient, so a routed chain dies after one
// hop unless an external actor sends again. This module is the driver that makes
// the queue advance itself: given the seats, the queue, and which conversations
// already have work in flight, it finds the seats that have queued work and
// nothing advancing it, and submits a wake. `durig run` loops it with
// `waitForIdle` until the rig is quiescent, holding the harness open so the runs
// it starts actually finish.
//
// It must remain a write-side process: a passive viewer never schedules (D11),
// which is why this is a command and not something `watch` does.

/**
 * The wake a seat is sent. A fixed string on purpose: the wake is committed as a
 * user entry, so a body that varied per item would change the conversation
 * prefix on every wake and zero the prompt cache (ROADMAP 33). The seat learns
 * WHICH item from `claim_work`, not from the wake.
 */
export const WAKE_CONTENT =
  "You have queued work. Call claim_work to take the oldest item addressed to you, then act on it.";

/**
 * Which seats to wake. A seat is woken when it has work to advance:
 *   - at least one QUEUED item addressed to it (the ride continues), or
 *   - a STALLED CLAIM - a `claimed` item whose run died: no submission already in
 *     flight (its conversation is not in `pendingConvIds`), no live generation
 *     lease (`busySeats`), and its seat's latest settled submission did NOT end in
 *     an operator stop (`aborted:<reason>`, `stoppedConvIds`). A claimed item
 *     whose run is still advancing (in-flight/lease) or was operator-stopped is
 *     never re-woken (no double-wake; an operator-stopped item is never resurrected).
 * Pure, so the demo can assert the rule without a harness.
 *
 * @param {{seats?: Record<string,{conversationId:number|string}>, items?: Array<{to:string,status:string}>, pendingConvIds?: Set<number|string>, busySeats?: Set<string>, stoppedConvIds?: Set<number|string>}} input
 * @returns {Array<{name:string, conversationId:number|string}>}
 */
export function selectWakes({
  seats,
  items,
  pendingConvIds = new Set(),
  busySeats = new Set(),
  stoppedConvIds = new Set(),
}) {
  const wakes = [];
  for (const [name, seat] of Object.entries(seats ?? {})) {
    const convId = seat.conversationId;
    const hasQueued = (items ?? []).some((it) => it.to === name && it.status === "queued");
    // A stalled claim: the item is claimed but nothing is advancing it (no
    // submission in flight, no live lease) and the operator did not stop the seat's
    // run (its latest submission did not settle `aborted:<reason>`).
    const hasStalledClaim = (items ?? []).some(
      (it) =>
        it.to === name &&
        it.status === "claimed" &&
        !pendingConvIds.has(convId) &&
        !busySeats.has(name) &&
        !stoppedConvIds.has(convId),
    );
    if (!hasQueued && !hasStalledClaim) continue;
    // Already advancing: a submission is in flight, or a generation lease is held.
    // (Applies equally to queued work and to a claim the run has actually resumed.)
    if (pendingConvIds.has(convId)) continue;
    if (busySeats.has(name)) continue;
    wakes.push({ name, conversationId: convId });
  }
  return wakes;
}

/**
 * Submit one wake per selected seat. Returns how many were woken. The wake is
 * admitted durably; the caller is responsible for waiting for the rig to go idle
 * before closing the harness, or the run it started is abandoned.
 */
export async function driveOnce(
  harness,
  { seats, items, pendingConvIds, busySeats, stoppedConvIds, context },
) {
  const wakes = selectWakes({ seats, items, pendingConvIds, busySeats, stoppedConvIds });
  let actioned = 0;
  for (const wake of wakes) {
    const conv = await harness.conversation(wake.conversationId, context);
    if (!conv) continue;
    await conv.submit({ type: "input", content: WAKE_CONTENT }, context);
    actioned++;
  }
  return actioned;
}
