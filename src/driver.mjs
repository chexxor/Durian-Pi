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
 * Which seats to wake. A seat is woken when it has at least one QUEUED item
 * addressed to it, no submission already in flight (its conversation is not in
 * `pendingConvIds`), and no live generation lease (`busySeats`). Pure, so the
 * demo can assert the rule without a harness.
 *
 * @param {{seats?: Record<string,{conversationId:number|string}>, items?: Array<{to:string,status:string}>, pendingConvIds?: Set<number|string>, busySeats?: Set<string>}} input
 * @returns {Array<{name:string, conversationId:number|string}>}
 */
export function selectWakes({ seats, items, pendingConvIds = new Set(), busySeats = new Set() }) {
  const wakes = [];
  for (const [name, seat] of Object.entries(seats ?? {})) {
    const hasWork = (items ?? []).some((it) => it.to === name && it.status === "queued");
    if (!hasWork) continue;
    // Already advancing: a submission is in flight, or a generation lease is held.
    if (pendingConvIds.has(seat.conversationId)) continue;
    if (busySeats.has(name)) continue;
    wakes.push({ name, conversationId: seat.conversationId });
  }
  return wakes;
}

/**
 * Submit one wake per selected seat. Returns how many were woken. The wake is
 * admitted durably; the caller is responsible for waiting for the rig to go idle
 * before closing the harness, or the run it started is abandoned.
 */
export async function driveOnce(harness, { seats, items, pendingConvIds, busySeats, context }) {
  const wakes = selectWakes({ seats, items, pendingConvIds, busySeats });
  let actioned = 0;
  for (const wake of wakes) {
    const conv = await harness.conversation(wake.conversationId, context);
    if (!conv) continue;
    await conv.submit({ type: "input", content: WAKE_CONTENT }, context);
    actioned++;
  }
  return actioned;
}
