// src/broker.mjs — the resident broker's per-pass orchestration and wake loop
// (PUSH-ARCHITECTURE §3.2/§3.3; D45).
//
// The division of labour is deliberate:
//   - src/driver.mjs decides WHOM to wake (`selectWakes`/`driveOnce`);
//   - src/scheduler.mjs decides WHEN a pass may run (coalescing, floor, cooldown);
//   - this module runs ONE pass against a real harness, and the loop that reacts
//     to the store's in-process commit stream.
// It owns no policy of its own. Both the bounded `run` loop and the resident
// `serve` broker call `drivePass`, so the two cannot drift.
//
// D45: the broker is the single long-lived writer that *is* the harness, so its
// trigger is an in-process commit subscription with none of the cross-process
// gap D11 documented. Read-only viewers keep D11's poll/read-storage rule.

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { RigQueue, Seats } from "./rig.mjs";
import { driveOnce } from "./driver.mjs";

/**
 * Seats whose latest settled submission is an operator stop (`aborted:<reason>`).
 * A claimed item for such a seat must never be re-woken (ROADMAP 42; lead ruling
 * #45/#50). This reads the abort fact READ-ONLY off the settled submission `stop`
 * already writes — no new write path, no queue-item annotation.
 *
 * Recomputed every pass rather than once at start: a resident broker outlives a
 * `stop` issued while it runs, and must honour it on the next pass.
 */
export async function readStoppedConvIds(probeStorage, seats, context) {
  const stopped = new Set();
  for (const seat of Object.values(seats ?? {})) {
    const page = await probeStorage.scanSubmissions(
      { conversationId: seat.conversationId, order: "descending" },
      1,
      undefined,
      context,
    );
    const latest = page.items[0];
    if (latest?.status === "unanswered" && String(latest.reason ?? "").startsWith("aborted:")) {
      stopped.add(seat.conversationId);
    }
  }
  return stopped;
}

/**
 * Run one wake pass and hold the harness open until every run it started has
 * settled — closing earlier abandons the run (the F11 class).
 *
 * `readBusySeats` is a caller-owned async reader (generation leases live in
 * files beside the database, not in storage); when omitted, no seat is busy.
 * `onWoke(name)` fires for each seat whose wake was actually submitted, so a
 * broker can start that seat's cooldown.
 */
export async function drivePass(
  harness,
  probeStorage,
  { context, seatFilter, readBusySeats, onError, onWoke } = {},
) {
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const queueDoc = await harness.documentState(RigQueue, undefined, context);
  const inspection = await harness.inspect(context);
  const pendingConvIds = new Set((inspection.submissions ?? []).map((s) => s.conversationId));
  const seats = seatsDoc?.value?.seats;
  const stoppedConvIds = await readStoppedConvIds(probeStorage, seats, context);
  const busySeats = readBusySeats ? await readBusySeats() : new Set();
  const actioned = await driveOnce(harness, {
    seats,
    items: queueDoc?.value?.items,
    pendingConvIds,
    busySeats,
    stoppedConvIds,
    context,
    storage: probeStorage,
    seatFilter,
    onError,
    onWoke,
  });
  await harness.waitForIdle(context);
  return { actioned, seats };
}

/**
 * The resident loop: run a pass whenever the scheduler says one is due, and
 * otherwise sleep until the next commit or the scheduler's floor — never poll.
 *
 * `signal` is a `createWakeSignal()` the commit subscription raises. The loop is
 * driven by the scheduler, so a change that arrives during a pass marks the next
 * pass dirty rather than being lost. `isStopping()` is checked at each turn;
 * `maxDurationMs`/`maxPasses` bound a run for tests and for `--max-duration`.
 *
 * Returns what happened so the caller can print one JSON document.
 */
export async function runWakeLoop({
  harness,
  probeStorage,
  scheduler,
  signal,
  context,
  readBusySeats,
  onDiagnostic = () => {},
  supervise = null,
  maxDurationMs = 0,
  maxPasses = Infinity,
  now = Date.now,
  startedAt = now(),
  isStopping = () => false,
}) {
  const failedSeats = new Set();
  const escalations = [];
  let passes = 0;
  let stoppedBy = null;
  // Work may have been queued while nothing was running — the exact #238 finding
  // (three items queued with nothing driving) — so the first pass is forced
  // rather than waiting for a future commit.
  scheduler.markDirty();
  for (;;) {
    if (isStopping()) {
      stoppedBy = "signal";
      break;
    }
    if (maxDurationMs > 0 && now() - startedAt >= maxDurationMs) {
      stoppedBy = "max-duration";
      break;
    }
    if (passes >= maxPasses) {
      stoppedBy = "max-passes";
      break;
    }
    if (!scheduler.shouldRun(now())) {
      // Never sleep past the deadline: with no further commits a resident broker
      // rests in `signal.wait`, and a signal only interrupts it on SIGINT/SIGTERM.
      // A bounded run must wake itself to re-check `maxDurationMs`.
      let waitMs = scheduler.delayUntilReady(now());
      if (maxDurationMs > 0) {
        const remaining = maxDurationMs - (now() - startedAt);
        if (remaining <= 0) continue; // deadline reached: re-check and exit at the top
        waitMs = waitMs > 0 ? Math.min(waitMs, remaining) : remaining;
      }
      await signal.wait(waitMs);
      continue;
    }
    scheduler.beginPass(now());
    try {
      await drivePass(harness, probeStorage, {
        context,
        seatFilter: scheduler.seatFilter(now()),
        readBusySeats,
        onError: (failure) => {
          failedSeats.add(failure.name);
          onDiagnostic({ kind: "wake-failed", ...failure });
        },
        onWoke: (name) => scheduler.recordWakes([name], now()),
      });
      passes++;
      if (supervise) {
        const plans = await supervise();
        for (const plan of plans) onDiagnostic({ kind: "escalated", ...plan });
        escalations.push(...plans);
      }
    } finally {
      scheduler.endPass();
    }
  }
  return { passes, failedSeats: [...failedSeats], escalations, stoppedBy };
}

/* ------------------------------ broker lifetime ------------------------------ */
// A resident broker is the one long-lived writer, so at most one may run per
// database. The state file `<db>.broker.json` records the holder's pid, the same
// convention `src/genlock.mjs` uses for generation leases: a missing/dead pid is
// stale, and a second broker refuses to start rather than double-drive the queue
// (two drivers = the double-wake class the driver's guards prevent only in-process).

export function brokerStatePath(dbPath) {
  return `${dbPath}.broker.json`;
}

/** Liveness probe by signal 0: no signal delivered, just "does this pid exist". */
export function brokerAlive(state) {
  if (!state || typeof state.pid !== "number") return false;
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read the broker state; an unreadable file is reported and treated as absent. */
export function readBrokerState(dbPath) {
  const path = brokerStatePath(dbPath);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.error(`BROKER WARNING: unreadable state ${path}: ${err?.message ?? err}`);
    }
    return null;
  }
}

export function writeBrokerState(dbPath, { pid, since }) {
  writeFileSync(brokerStatePath(dbPath), JSON.stringify({ pid, since }));
}

/**
 * Remove the state file, optionally only when it still names `pid`. The pid guard
 * keeps a broker that is shutting down from unlinking the state of a NEWER broker
 * that already took over (a stale pid is replaced, but a live one must not be).
 */
export function clearBrokerState(dbPath, pid) {
  const state = readBrokerState(dbPath);
  if (state && pid !== undefined && state.pid !== pid) return false;
  try {
    unlinkSync(brokerStatePath(dbPath));
    return true;
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    return false;
  }
}
