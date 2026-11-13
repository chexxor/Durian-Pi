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
//
// The wake predicate reuses the CLAIM predicate (`workable`, src/rig.mjs, #2673/#2677) rather than
// re-deriving it from a status literal (#6189). A gate rule kept in two places is a rule that drifts
// (#6112), and the drift here is invisible: the seat wakes, `claim_work` refuses, and the log says
// nothing about why.
import { workable, openPoolRow } from "./rig.mjs";
import { DEFAULT_TIER_TOKENS } from "./config.mjs";
import { escalations, escalationSignature } from "./deferlease.mjs";

/**
 * The wake a seat is sent. A fixed string on purpose: the wake is committed as a
 * user entry, so a body that varied per item would change the conversation
 * prefix on every wake and zero the prompt cache (ROADMAP 33). The seat learns
 * WHICH item from `claim_work`, not from the wake.
 */
export const WAKE_CONTENT =
  "You have queued work. Call claim_work to take the oldest item you are ELIGIBLE for - one addressed to you, or an open pool row whose capability set you advertise - then act on it; an ineligible claim is refused with the reason.";

/**
 * The wake a seat is sent when its CLAIM IS STALLED rather than when it has QUEUED work (#4557).
 *
 * THE DEFECT THIS CLOSES, measured over SEVEN CONSECUTIVE TURNS: `selectWakes` wakes a seat for EITHER a
 * queued item (the ride continues) OR a stalled claim — but ONE fixed string described only the first. So a
 * seat woken for a stalled claim was told "You have queued work. Call claim_work…" and `claim_work` returned
 * NO_QUEUED_WORK every time, because its item was `claimed`, not `queued`. THE PROMPT WAS A CALL TO ACTION
 * AND THE VERB WAS THE ANSWER, AND THEY DISAGREED — which teaches "the prompt lies" and erodes every later one.
 *
 * WHY TWO CONSTANTS AND NOT ONE VARIABLE STRING: ROADMAP 33 — the wake is committed as a user entry, so a
 * body that varied per item would change the conversation prefix on every wake and ZERO THE PROMPT CACHE.
 * Two FIXED strings, one per REASON, keeps every wake body constant for its own case.
 */
export const WAKE_CONTENT_STALLED =
  "Your claimed item is stalled — nothing is advancing it. Call resume_work, or claim_work if you have a queued item too.";

/**
 * The wake a seat is sent when its queue holds PARKED rows and NOTHING CLAIMABLE (#4607).
 *
 * THE STATE THIS NAMES: a seat whose only non-terminal rows are held or otherwise unclaimable. Before this it
 * was told "You have queued work", took the offered action, and `claim_work` refused — seven turns of that,
 * which teaches "the prompt lies" and erodes every later one. Silence was the alternative and it is wrong in
 * the other direction: a seat that KNOWS a row is parked can act or wait, and one told nothing can only poll.
 *
 * CONSTANT, AND DELIBERATELY WITHOUT AN ID OR AN OWNER. ROADMAP 33: the wake is committed as a user entry, so
 * a body that varied per item would change the conversation prefix on every wake and ZERO THE PROMPT CACHE.
 * The COUNT would also be per-pass, so it is not named either — the seat learns which rows from `status`.
 * AND NOT AN ATTENTION NOTICE: that path is `!inFlight`-gated and switches off IN THE GAP, which is the trap
 * designer already refuted for `idle_with_queued_work`.
 */
export const WAKE_CONTENT_PARKED =
  "Your queue holds parked rows awaiting release - there is nothing claimable for you. Read them with peek_queue (pass all: true for the team view); do not call claim_work expecting work.";

/**
 * The parked SET of one seat, as a comparable string: the sorted (itemId, status) pairs of that seat's
 * held/deferred rows. Pure (#5740 ruling, option A), so a demo can assert it without a harness and the
 * dedup cannot hide a state change it never looked at.
 *
 * Deliberately NOT in the wake body: the wake text is a fixed string so it does not zero the prompt cache
 * (ROADMAP 33). The signature is selection-state only.
 *
 * @param {Array<{to:string,status:string,id:number|string}>} items queue rows
 * @param {string} seatName
 * @returns {string} "" when the seat has nothing parked
 */
export function parkedSignature(items, seatName) {
  return (items ?? [])
    .filter((it) => it.to === seatName && (it.status === "held" || it.status === "deferred"))
    .map((it) => `${it.id}:${it.status}`)
    .sort()
    .join(",");
}

/**
 * Which seats to wake. A seat is woken when it has work to advance:
 *   - at least one QUEUED item addressed to it THAT THIS SEAT CAN CLAIM (the ride continues).
 *     #6189: "queued" alone is not claimable. A queued row whose `blockedBy` gate is still open, or
 *     whose `requires` capability the seat does not advertise, is refused by `claim_work` (#2673), so
 *     waking for it is a no-op wake: the observed 4-wake streak on a seat whose only queued row was
 *     gated. The SAME predicate the claim path uses decides this; the ambiguous case (a gate id naming
 *     no row) stays WORKABLE by ruling, because a false negative starves real work.
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
  // N19 row 5: the size gate reads the same tier table the claim path reads, so a seat is never WOKEN for a
  // row it will be refused for. The table rides in the roster (written by `up`); without it the shipped
  // defaults stand and no seat is gated on a guess.
  tierTokens = DEFAULT_TIER_TOKENS,
  // #4171: THE SUPPRESSION TRACE. Nothing recorded WHY a candidate seat was skipped, so a ten-hour
  // outage and a two-second wait looked identical in the log. `onSkip` is called once per skipped
  // candidate per pass with the REASON, and for `pending` the AGE of the submission that caused it —
  // the age is the load-bearing field, because 2s is normal and 10h is the outage. `pendingAgeMs` is
  // supplied by the caller (it has the submission rows); without it the trace still names the reason.
  onSkip = () => {},
  pendingAgeMs = null,
  // #5740 option A: a seat whose parked SET has not changed since it was last told needs no wake - the
  // wake would carry zero new information and would itself dirty the scheduler, which is how the loop
  // sustains (4 wakes in 120 s for one held row, measured in the review §1). `parkedChanged(seat, sig)`
  // is supplied by the WakeScheduler, which OWNS the last-seen signature; the default (no predicate) keeps
  // the old behaviour so callers and existing demos are unaffected.
  parkedChanged = null,
  onParked = () => {},
}) {
  const wakes = [];
  // THE ESCALATION PATH (operator ruling 2026-11-12T20:2xZ): a park on the human operator is a LEASE, and when
  // the clock runs out `lead` decides rather than the row idling. Measured before this existed: 493 rows parked
  // on the operator at a median age of 5 days, 84 of them landing work, while the operator was away — the queue
  // looked stalled and the rig said "waiting on human" nine times.
  //
  // The wake is DEDUPED on the escalation signAPture (same rule as a parked seat, #5740): a wake that carries no
  // new information would dirty the scheduler and sustain the loop. `lead` is woken only if it is a real seat,
  // not pending, not busy and not stopped — the ordinary guards apply, the escalation is just a new REASON.
  const escalationCensus = escalations(items ?? []);
  const escalationSig = escalationSignature(escalationCensus.rows);
  for (const [name, seat] of Object.entries(seats ?? {})) {
    const convId = seat.conversationId;
    // An ESCALATION reachable by this seat: `lead` owns deciding a park the operator did not answer. It is
    // added to the seat's wake reasons below rather than short-circuiting the other branches, so a lead with
    // its own claimable work is woken ONCE with both reasons named.
    // NOTE the dedup is NOT consulted here, and that ordering is load-bearing: this value is read BEFORE the
    // pending/busy guards, so consuming the signature here would record an escalation as "told" on a pass that
    // then suppressed the wake (measured shape: `SKIP lead reason=pending conv=21` on the pass that would have
    // escalated). The signature is taken at the PUSH below, where the wake actually issues.
    // `stopped` is checked HERE because nothing later does; pending/busy are checked below, after this value
    // is read, which is exactly why the dedup signature is taken at the push instead.
    const escalationRelevant = escalationCensus.count > 0 && name === "lead" && !paused && !stoppedConvIds.has(convId);
    // ROADMAP 131: while PAUSED, do NOT wake a seat to CLAIM new work. In-flight work
    // still settles, so the stalled-claim branch below stays open: pause gates TAKING
    // new work, never FINISHING current work.
    // THE CLAIMABILITY GATE (#6189). `workable` is the predicate `claim_work` already uses, so the wake
    // and the verb cannot disagree. Verdicts are kept because the SKIP line must NAME the reason: a seat
    // that never wakes is otherwise indistinguishable from a seat with nothing in its queue.
    // N19 row 4 (P1): an OPEN pool row is a wake candidate for every seat, gated by the SAME predicate the
    // claim path uses - so a seat never wakes for pool work it cannot claim, and the wake and the verb cannot
    // disagree. Pool rows are counted separately rather than spelled out one by one: a fleet-sized pool would
    // otherwise put hundreds of reason codes in a single SKIP line.
    const queuedVerdicts = (items ?? [])
      .filter((it) => (it.to === name || openPoolRow(it)) && it.status === "queued")
      .map((it) => ({
        verdict: workable(it, name, {
          items,
          capabilities: seat.capabilities ?? [],
          tierTokens: tierTokens ?? DEFAULT_TIER_TOKENS,
          usableWindow: seat.usableWindow ?? null,
        }),
        pool: openPoolRow(it),
      }));
    const gatedReasons = queuedVerdicts.filter((v) => !v.verdict.workable && !v.pool).map((v) => v.verdict.reason);
    const poolGatedCount = queuedVerdicts.filter((v) => !v.verdict.workable && v.pool).length;
    const hasQueued = !paused && queuedVerdicts.some((v) => v.verdict.workable);
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
    // #4607: PARKED ROWS AND NOTHING CLAIMABLE. A row the seat holds or that is otherwise unclaimable
    // is not a claim offer and not a stalled claim - but telling the seat NOTHING leaves it polling. It gets
    // its own reason and its own fixed body, so the wake names the state instead of advertising work.
    // #5740: the parked branch fires only when the parked SET changed. Same set -> no wake, and the
    // suppression is LOGGED, because today a parked seat's silence is indistinguishable from "nothing here".
    const parkedSig = parkedSignature(items, name);
    const parkedUnchanged = parkedSig !== "" && parkedChanged !== null && !parkedChanged(name, parkedSig);
    const hasParked = !hasQueued && parkedSig !== "" && !parkedUnchanged;
    if (parkedSig !== "") {
      onParked({ seat: name, reason: parkedUnchanged ? "deduped" : "set-changed" });
    }
    if (!hasQueued && !hasStalledClaim && !hasParked && !escalationRelevant) {
      // `queued-gated:<code>` is reported ahead of `no-work` so the log distinguishes "this seat has rows
      // it cannot claim yet" from "this seat has nothing". Both were `no-work` before #6189.
      const reason = [gatedReasons.length ? `queued-gated:${gatedReasons.join(",")}` : "", poolGatedCount ? `pool-gated:${poolGatedCount}` : ""]
        .filter(Boolean)
        .join(" ") || (parkedUnchanged ? "parked-deduped" : "no-work");
      onSkip({ seat: name, reason });
      continue;
    }
    // Already advancing: a submission is in flight, or a generation lease is held.
    // (Applies equally to queued work and to a claim the run has actually resumed.)
    if (pendingConvIds.has(convId)) {
      const ageMs = typeof pendingAgeMs === "function" ? pendingAgeMs(convId) : null;
      onSkip({ seat: name, reason: "pending", conversationId: convId, ageMs });
      continue;
    }
    if (busySeats.has(name)) {
      onSkip({ seat: name, reason: "busy" });
      continue;
    }
    // #4557: the wake carries WHY it was sent, so the caller can pick a body that MATCHES the verb the seat
    // will actually reach for. Without it one string had to describe two different situations and lied about one.
    if (escalationRelevant) {
      // The wake is about to ISSUE, so this is where the escalation set is marked as told.
      const fresh = parkedChanged === null || parkedChanged(name, `escalation:${escalationSig}`);
      if (!fresh && !hasQueued && !hasStalledClaim) {
        onSkip({ seat: name, reason: "escalation-deduped" });
        continue;
      }
    }
    wakes.push({
      name,
      conversationId: convId,
      reason: escalationRelevant && !hasQueued && !hasStalledClaim ? "escalation" : hasQueued ? "queued" : hasStalledClaim ? "stalled-claim" : "parked",
      ...(escalationRelevant ? { escalationCount: escalationCensus.count } : {}),
    });
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
  { seats, items, pendingConvIds, busySeats, stoppedConvIds, context, storage, onError, onWoke, onSuppressed, onSkipped, pendingAgeMs, onPaused, seatFilter, paused = false, shouldStop, parkedChanged = null, onParked = () => {} },
) {
  // #4180: forward the trace. `onSkipped` receives one event per skipped candidate per pass with the
  // reason; `pendingAgeMs` supplies the MEASURED age from the submission rows - the caller holds them,
  // so the number is looked up rather than invented. Both optional: without them nothing is emitted and
  // the decision is unchanged.
  const candidates = selectWakes({ seats, items, pendingConvIds, busySeats, stoppedConvIds, paused, onSkip: onSkipped, pendingAgeMs, parkedChanged, onParked });
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
      await conv.submit({ type: "input", content: wake.reason === "stalled-claim" ? WAKE_CONTENT_STALLED : wake.reason === "parked" ? WAKE_CONTENT_PARKED : WAKE_CONTENT }, context);
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
