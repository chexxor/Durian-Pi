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

import { readFileSync, unlinkSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { RigQueue, Seats } from "./rig.mjs";
import { driveOnce } from "./driver.mjs";
import { claimWorktree, releaseWorktreeLock, removeClaimedWorktree } from "./worktree.mjs";
import { wrapProviderWithSlots, getSeatFromContext } from "./genlock.mjs";

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
 * `source` is the git repository root for creating per-seat worktrees (#473).
 * `worktreeRoot` is the parent directory under which worktrees are created.
 */
export async function drivePass(
  harness,
  probeStorage,
  { context, seatFilter, readBusySeats, onError, onWoke, currentSeat: initialSeat,
    source, worktreeRoot, onSeatCreated } = {},
) {
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const queueDoc = await harness.documentState(RigQueue, undefined, context);
  const inspection = await harness.inspect(context);
  const pendingConvIds = new Set((inspection.submissions ?? []).map((s) => s.conversationId));
  const seats = seatsDoc?.value?.seats;
  const stoppedConvIds = await readStoppedConvIds(probeStorage, seats, context);
  const busySeats = readBusySeats ? await readBusySeats() : new Set();
  let wokenSeat = initialSeat ?? null;
  let worktreeClaimed = false; // track if we created a worktree this pass
  let itemLabel = null;       // the item label for cleanup
  let worktreePath = null;

  // #473: wire worktree lifecycle into the pass.
  // Before driving: create worktree for each seat with queued work, set DURIG_SEAT_ROOT.
  if (source && worktreeRoot && queueDoc?.value?.items?.length) {
    const seatsToWake = Object.entries(seats ?? {}).filter(([name]) => {
      const hasQueued = queueDoc.value.items.some(it => it.to === name && it.status === "queued");
      return hasQueued;
    });
    if (seatsToWake.length > 0) {
      const [seatName] = seatsToWake[0];
      const convId = seats[seatName]?.conversationId;
      // Find the queued item for this seat
      const item = queueDoc.value.items.find(it => it.to === seatName && it.status === "queued");
      if (item) {
        itemLabel = `item-${item.id}`;
        worktreePath = join(worktreeRoot, itemLabel);
        // Check for stale worktree (from a previous interrupted run)
        try {
          await removeClaimedWorktree({ worktree: worktreePath, force: true });
        } catch (err) {
          // A stale worktree may need manual cleanup; surface why removal failed
          // rather than swallowing it — the create below fails if it persists.
          console.warn(`broker: could not remove stale worktree ${worktreePath}: ${err.message}`);
        }
        try {
          const wt = await claimWorktree({ source, worktreeRoot, itemLabel: itemLabel });
          process.env.DURIG_SEAT_ROOT = wt.cwd; // seattools.makeSeatEnv picks this up
          worktreeClaimed = true;
          onSeatCreated?.(seatName, wt);
        } catch (err) {
          console.error(`BROKER: worktree claim failed for ${seatName}: ${err?.message ?? err}`);
          // Fall through to shared-tree run — the seat will work in the shared tree
        }
      }
    }
  }

  const wrapOnWoke = (name) => {
    wokenSeat = name;
    onWoke?.(name);
  };
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
    onWoke: wrapOnWoke,
  });
  // F34: carry the last-woken seat name onto the generation so wrapProviderWithSlots
  // can name it in the genlock lease (otherwise seat:null because the broker process
  // has no seat). For multi-seat concurrency the last woken wins — acceptable over
  // seat:null.
  if (wokenSeat) {
    process.env.DURIG_ACTIVE_SEAT = wokenSeat;
  }
  await harness.waitForIdle(context);

  // #473: after idle, check if the item completed and cleanup the worktree.
  if (worktreeClaimed && itemLabel && worktreePath) {
    try {
      const afterQueue = await harness.documentState(RigQueue, undefined, context);
      const completedItem = afterQueue?.value?.items?.find(it =>
        it.id === Number(itemLabel.replace("item-", "")) && it.status === "done",
      );
      if (completedItem) {
        // Commit the item's files on its branch, then release and remove.
        try {
          await releaseWorktreeLock(worktreePath);
          // The seat commits in its worktree; the broker cleans up the lock and removes.
          await removeClaimedWorktree({ worktree: worktreePath, force: true });
        } catch (err) {
          console.error(`BROKER: worktree cleanup failed for ${itemLabel}: ${err?.message ?? err}`);
        }
      }
    } catch (err) {
      console.error(`BROKER: worktree status check failed: ${err?.message ?? err}`);
    }
    // Clear DURIG_SEAT_ROOT so subsequent passes don't inherit it.
    delete process.env.DURIG_SEAT_ROOT;
  }

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
  dbPath = undefined,
  source = null,
  worktreeRoot = null,
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
      // Check for stop request before sleeping: on Windows there is no SIGTERM,
      // so `serve --stop` relies on a .stop file to interrupt an idle broker.
      if (dbPath && readStopRequest(dbPath) !== null) {
        clearStopRequest(dbPath);
        stoppedBy = "stop";
        break;
      }
      // Never sleep past the deadline: with no further commits a resident broker
      // rests in `signal.wait`, and a signal only interrupts it on SIGINT/SIGTERM.
      // A bounded run must wake itself to re-check `maxDurationMs`.
      let waitMs = scheduler.delayUntilReady(now());
      // Also cap the wait so a .stop file written while idle is honoured within ~1s.
      if (dbPath) {
        const stopDeadline = 1000; // max ms before we re-check for .stop
        waitMs = waitMs > 0 ? Math.min(waitMs, stopDeadline) : stopDeadline;
      }
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
        source: source,
        worktreeRoot: worktreeRoot,
        onError: (failure) => {
          failedSeats.add(failure.name);
          onDiagnostic({ kind: "wake-failed", ...failure });
        },
        onWoke: (name) => {
          scheduler.recordWakes([name], now());
          logBrokerLine(dbPath, `WAKE ${name}`);
        },
      });
      passes++;
      logBrokerLine(dbPath, `PASS ${passes}`);
      if (supervise) {
        const plans = await supervise();
        for (const plan of plans) onDiagnostic({ kind: "escalated", ...plan });
        escalations.push(...plans);
      }
    } finally {
      scheduler.endPass();
    }
    // F35: cooperative stop — a `serve --stop` command writes a .stop file
    // instead of process.kill (which does not deliver SIGTERM on Windows). The
    // broker honours it here, after the pass in flight has settled.
    if (dbPath && readStopRequest(dbPath) !== null) {
      clearStopRequest(dbPath);
      stoppedBy = "stop";
      break;
    }
  }
  return { passes, failedSeats: [...failedSeats], escalations, stoppedBy };
}

/* ------------------------------ broker log (D46) ------------------------------ */
// A resident broker is unobservable unless it writes a log. D46 requires `<db>.broker.log`
// so the broker's activity (passes, wakes, failures) is inspectable without a socket.

export function brokerLogPath(dbPath) {
  if (!dbPath) {
    return null;
  }
  return `${dbPath}.broker.log`;
}

/** Append one line to `<db>.broker.log`. */
export function logBrokerLine(dbPath, line) {
  const path = brokerLogPath(dbPath);
  if (!path) return; // dbPath not set — skip logging
  const ts = new Date().toISOString();
  appendFileSync(path, ts + " " + line + "\n", "utf8");
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

/* ------------------------------ cooperative stop request ------------------------------ */
// A file-based stop request that the broker polls between passes. Solves F35:
// on Windows `process.kill` does not deliver a real SIGTERM, so the broker's
// `finally` (which waits for the pass to settle) never runs and a mid-pass
// stop strands the run. Writing a .stop file is the POSIX-portable equivalent —
// the broker honours it on the next pass-turn.
export function stopRequestPath(dbPath) {
  return `${dbPath}.broker.stop`;
}

export function writeStopRequest(dbPath) {
  writeFileSync(stopRequestPath(dbPath), Date.now().toString());
}

export function readStopRequest(dbPath) {
  const path = stopRequestPath(dbPath);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

export function clearStopRequest(dbPath) {
  try {
    unlinkSync(stopRequestPath(dbPath));
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return true;
    return false;
  }
}
