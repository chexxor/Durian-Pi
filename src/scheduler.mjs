// src/scheduler.mjs — the change-triggered wake SCHEDULER (PUSH-ARCHITECTURE §3.2/§3.3).
//
// The driver (src/driver.mjs) decides WHOM to wake. This module decides WHEN a
// wake pass runs, and it is the piece a resident broker subscribes to. `durig
// run` is itself a clock: it polls and a human must invoke it. A broker that
// owns the harness (the single long-lived writer) can instead react to the
// store's own commit stream through `Session.subscribeCommits` — an in-process
// trigger with none of the cross-process gap D11 documented, precisely because
// the process reacting is the one writing.
//
// Two invariants live here; both are pure so a demo can prove them without a
// harness:
//   - coalescing — many commits between passes cause ONE pass, and a change
//     arriving DURING a pass is not lost: it marks the next pass dirty
//     (the no-wake-storm rule, §3.3);
//   - throttling — a global floor between pass starts, plus a per-seat
//     cooldown, so a repeatedly re-woken stalled claim cannot hot-loop the
//     harness.
//
// The durable event feed (PIECE 2) is a separate, read-only concern; nothing
// here depends on it. This module writes nothing and owns no harness: it only
// classifies commits and gates timing.

/**
 * The stored documents whose change can alter the wake decision. `durig.queue`
 * changes on enqueue/claim/complete/defer/hold/release; `durig.seats` changes
 * when a seat is registered or the roster shifts. Both are session-scoped, so
 * they surface as `type:"document"` commit changes, not conversation copies.
 */
export const WAKE_DOC_KINDS = new Set(["durig.queue", "durig.seats"]);

/**
 * Does this committed change set warrant re-evaluating the wake decision? Pure.
 *
 * A submission change counts even though it is not a queue row: a submission
 * settling is what removes a conversation from `pendingConvIds`, which is
 * exactly when a stalled claim becomes wakeable again. A false positive costs
 * only an idempotent no-op pass; a false negative strands work, so the
 * predicate stays deliberately inclusive of submissions.
 *
 * @param {{ changes?: Array<{type?: string, record?: {kind?: string}}> } | undefined} publication
 * @returns {boolean}
 */
export function isWakeRelevantCommit(publication) {
  for (const change of publication?.changes ?? []) {
    if (change?.type === "submission") return true;
    if (
      (change?.type === "document" || change?.type === "document.copy") &&
      WAKE_DOC_KINDS.has(change?.record?.kind)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The timing gate for a resident wake loop. Inject `now` for deterministic
 * tests; the defaults are a 500 ms global floor (coalesces a burst of commits
 * into one pass without adding perceptible latency) and per-seat cooldown off.
 */
export class WakeScheduler {
  #minIntervalMs;
  #seatCooldownMs;
  #now;
  #dirty = false;
  #inFlight = false;
  #lastStartMs = null;
  #lastWakeBySeat = new Map();

  constructor({ minIntervalMs = 500, seatCooldownMs = 0, now = Date.now } = {}) {
    if (minIntervalMs < 0) throw new Error("minIntervalMs must be >= 0");
    if (seatCooldownMs < 0) throw new Error("seatCooldownMs must be >= 0");
    this.#minIntervalMs = minIntervalMs;
    this.#seatCooldownMs = seatCooldownMs;
    this.#now = now;
  }

  /** Called from the commit listener. Must not throw, block, or call Session APIs. */
  notify(publication) {
    if (isWakeRelevantCommit(publication)) this.#dirty = true;
  }

  /** Force a pass to be eligible (e.g. a broker's first pass after restart). */
  markDirty() {
    this.#dirty = true;
  }

  get dirty() {
    return this.#dirty;
  }

  get inFlight() {
    return this.#inFlight;
  }

  get lastStartMs() {
    return this.#lastStartMs;
  }

  /**
   * Start a pass only when something changed, nothing is running, and the global
   * floor since the last start has elapsed. Pure with respect to `now`.
   */
  shouldRun(now = this.#now()) {
    if (this.#inFlight || !this.#dirty) return false;
    return this.#lastStartMs === null || now - this.#lastStartMs >= this.#minIntervalMs;
  }

  /** Milliseconds until the next pass may start (0 when ready now). */
  delayUntilReady(now = this.#now()) {
    if (this.#lastStartMs === null) return 0;
    return Math.max(0, this.#minIntervalMs - (now - this.#lastStartMs));
  }

  /**
   * Consume the changes seen so far and mark a pass in flight. A change arriving
   * DURING the pass re-marks `dirty`, so it drives the next pass rather than
   * being swallowed by this one.
   */
  beginPass(now = this.#now()) {
    if (this.#inFlight) throw new Error("wake pass already in flight");
    this.#inFlight = true;
    this.#lastStartMs = now;
    this.#dirty = false;
  }

  endPass() {
    this.#inFlight = false;
  }

  /** Per-seat backoff: has `name`'s cooldown elapsed since its last wake? */
  seatReady(name, now = this.#now()) {
    if (this.#seatCooldownMs <= 0) return true;
    const last = this.#lastWakeBySeat.get(name);
    return last === undefined || now - last >= this.#seatCooldownMs;
  }

  /** Record that these seats were woken now, starting their cooldown. */
  recordWakes(names, now = this.#now()) {
    for (const name of names ?? []) this.#lastWakeBySeat.set(name, now);
  }

  /**
   * A predicate for `driveOnce`'s optional `seatFilter`: drops candidates still
   * inside their cooldown. Bound to `now` at call time by the caller.
   */
  seatFilter(now = this.#now()) {
    if (this.#seatCooldownMs <= 0) return () => true;
    return (wake) => this.seatReady(wake.name, now);
  }
}

/**
 * A one-shot wake signal (a manual condition variable). The commit listener
 * must not block, so it only calls `raise()`; the resident loop `wait()`s and is
 * interrupted immediately rather than polling on a timer. A finite timeout turns
 * a wait into a bounded sleep, which is how the scheduler's global floor is
 * honored without spinning.
 */
export function createWakeSignal() {
  let resolveWaiting = null;
  let raised = false;
  return {
    raise() {
      raised = true;
      const resolve = resolveWaiting;
      resolveWaiting = null;
      resolve?.();
    },
    async wait(timeoutMs = 0) {
      if (raised) {
        raised = false;
        return;
      }
      await new Promise((resolve) => {
        let timer = null;
        const done = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };
        resolveWaiting = done;
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
          timer = setTimeout(() => {
            resolveWaiting = null;
            done();
          }, timeoutMs);
        }
      });
      raised = false;
    },
  };
}
