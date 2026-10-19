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
 * @param {{seats?: Record<string,{conversationId:number|string}>, items?: Array<{to:string,status:string}>, pendingConvIds?: Set<number|string>, busySeats?: Set<string>, stoppedConvIds?: Set<number|string>, paused?: boolean}} input
 * @returns {Array<{name:string, conversationId:number|string}>}
 */
export function selectWakes({
  seats,
  items,
  pendingConvIds = new Set(),
  busySeats = new Set(),
  stoppedConvIds = new Set(),
  paused = false,
}) {
  const wakes = [];
  for (const [name, seat] of Object.entries(seats ?? {})) {
    const convId = seat.conversationId;
    // ROADMAP 131: while PAUSED, do NOT wake a seat to CLAIM new work. In-flight work
    // still settles, so the stalled-claim branch below stays open: pause gates TAKING
    // new work, never FINISHING current work.
    const hasQueued = !paused && (items ?? []).some((it) => it.to === name && it.status === "queued");
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
 * Which candidate wakes are safe to deliver. Probing through the DRIVING harness
 * would fail its whole session on the first storage error (pi-durable already-
 * stored-error discipline: one bad read closes the session), so this reads each
 * `pi.live` document through the raw storage handle the caller owns. A seat whose
 * live document cannot be materialized is returned as unreadable, not woken.
 *
 * Pure read: no write path, no repair. Returns the actual error so the caller can
 * report the exact unresolvable path.
 *
 * @param {{scanDocuments:Function, document:Function}} storage
 * @param {Array<{name:string, conversationId:number|string}>} candidates
 * @returns {Promise<{wakeable:Array, unreadable:Array<{name:string, conversationId:number|string, error:Error}>}>}
 */
export async function probeSeatReadability(storage, candidates, context) {
  const wakeable = [];
  const unreadable = [];
  for (const wake of candidates) {
    try {
      const page = await storage.scanDocuments(
        { scope: { kind: "conversation", conversationId: wake.conversationId }, at: "current", kind: "pi.live" },
        1,
        undefined,
        context,
      );
      const liveId = page.items[0]?.id;
      // A conversation with no live document yet is readable (the harness will
      // initialize an empty one); only a present-but-unresolvable one is bad.
      if (liveId !== undefined) await storage.document(liveId, "current", context);
      wakeable.push(wake);
    } catch (error) {
      unreadable.push({ name: wake.name, conversationId: wake.conversationId, error });
    }
  }
  return { wakeable, unreadable };
}

/**
 * Submit one wake per selected seat. Returns how many were woken. The wake is
 * admitted durably; the caller is responsible for waiting for the rig to go idle
 * before closing the harness, or the run it started is abandoned.
 *
 * P5 (#110): one unreadable conversation must never kill the driver. A corrupt
 * `pi.live` document (DOGFOOD F14) makes materialization throw
 * `unresolvable path: [...]`; before this guard that exception escaped `run`, so
 * the pass died before delivering any wake and every claimed item was stranded.
 *
 * When a raw `storage` handle is supplied, candidate seats whose live document is
 * unreadable are reported through `onError` and skipped BEFORE the driving
 * harness reads them (opening the corrupt conversation would fail the harness's
 * whole session, stranding every other seat too). The remaining seats are still
 * woken, and a later pass re-probes the bad one. Without `storage`, a per-wake
 * guard still keeps an unexpected single-conversation failure from killing the pass.
 *
 * `seatFilter` is an optional predicate over a candidate (`{name, conversationId}`),
 * applied BEFORE the storage probe. A resident broker passes the scheduler's
 * per-seat cooldown here so a repeatedly re-woken stalled claim is throttled
 * without teaching this module about time.
 *
 * `onWoke(name)` fires once per SUBMITTED wake, so a caller can start that seat's
 * cooldown; a seat skipped by the probe never fires it.
 *
 * `onSuppressed(name)` fires for each candidate the `seatFilter` dropped (a seat
 * inside its cooldown). The candidate is real work that this pass did NOT action,
 * so the caller can schedule the pass that re-wakes it once the cooldown elapses
 * instead of leaving it until an unrelated commit.
 */
export async function driveOnce(
  harness,
  { seats, items, pendingConvIds, busySeats, stoppedConvIds, context, storage, onError, onWoke, onSuppressed, onPaused, seatFilter, paused = false, shouldStop },
) {
  const candidates = selectWakes({ seats, items, pendingConvIds, busySeats, stoppedConvIds, paused });
  // Legible refusal (ROADMAP 131 AC3): while paused, a seat that WOULD have been woken
  // for NEW queued work is reported, never silently skipped.
  if (paused && typeof onPaused === "function") {
    const woken = new Set(candidates.map((w) => w.name));
    for (const [name, seat] of Object.entries(seats ?? {})) {
      if (woken.has(name)) continue;
      if (pendingConvIds.has(seat.conversationId) || busySeats.has(name)) continue;
      if ((items ?? []).some((it) => it.to === name && it.status === "queued")) onPaused(name);
    }
  }
  const eligible =
    seatFilter === undefined
      ? candidates
      : candidates.filter((wake) => {
          const ready = seatFilter(wake);
          if (!ready) onSuppressed?.(wake.name);
          return ready;
        });
  let wakes = eligible;
  if (storage !== undefined && eligible.length > 0) {
    const { wakeable, unreadable } = await probeSeatReadability(storage, eligible, context);
    for (const failure of unreadable) onError?.(failure);
    const allowed = new Set(wakeable.map((w) => w.name));
    wakes = eligible.filter((w) => allowed.has(w.name));
  }
  let actioned = 0;
  for (const wake of wakes) {
    // #2420: a stop request must interrupt a pass MID-FLIGHT, not only at the loop
    // boundary. Checked before each wake so no NEW wake is submitted once stopping; the
    // wakes already submitted are left to settle.
    if (typeof shouldStop === "function" && shouldStop()) break;
    try {
      const conv = await harness.conversation(wake.conversationId, context);
      if (!conv) continue;
      await conv.submit({ type: "input", content: WAKE_CONTENT }, context);
      actioned++;
      // The conversation id travels with the wake so a caller can scope its
      // settle-wait to the runs THIS pass started (#broker-liveness).
      onWoke?.(wake.name, wake.conversationId);
    } catch (error) {
      // Belt and braces: even a probed-readable seat can fail here. Report and
      // continue rather than abandon the pass.
      onError?.({ name: wake.name, conversationId: wake.conversationId, error });
    }
  }
  return actioned;
}
