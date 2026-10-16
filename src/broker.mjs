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

import { readFileSync, unlinkSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { RigQueue, Seats } from "./rig.mjs";
import { driveOnce } from "./driver.mjs";
import { wrapProviderWithSlots, getSeatFromContext, reconcileGenerationSlots } from "./genlock.mjs";
import { listWorktrees, removeClaimedWorktree } from "./worktree.mjs";

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

/* ------------------------------ broker intent-inbox ------------------------------ */
// F35's stop file proved a file beside the database is the portable way to reach a
// resident broker. The inbox generalizes it: a producer writes ONE intent as a JSON
// file, and the broker drains it on its next pass and submits it as a real operator
// input to the target conversation. The producer never opens the store, so intent can
// be delivered while the broker drives — no second writer, no `serve --stop`.

export function intentInboxDir(dbPath) {
  return `${dbPath}.broker.inbox`;
}

export function intentErrorDir(dbPath) {
  return `${dbPath}.broker.inbox.error`;
}

/**
 * Write one intent atomically (temp file + rename) so the broker can never read a
 * half-written JSON document. Returns the final path. The name is time-ordered so
 * `readIntentFiles` replays intent in the order it was produced.
 */
export function writeIntent(dbPath, intent) {
  const dir = intentInboxDir(dbPath);
  mkdirSync(dir, { recursive: true });
  const name = `${String(Date.now()).padStart(16, "0")}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  const tmp = join(dir, `.${name}.tmp`);
  const final = join(dir, name);
  // A stable requestId makes a RE-drain idempotent: the harness dedupes a submission
  // by (conversation, requestId), so an intent whose file survived a crash between
  // submit and unlink is not submitted twice on the next pass. A caller-supplied id
  // is kept so a producer retrying a specific intent does not mint a second one.
  const stored = intent.requestId ? intent : { ...intent, requestId: randomUUID() };
  writeFileSync(tmp, JSON.stringify(stored), "utf8");
  renameSync(tmp, final);
  return final;
}

/** Pending intent files, oldest first (the name is time-ordered). */
export function readIntentFiles(dbPath) {
  const dir = intentInboxDir(dbPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Move an undeliverable intent out of the spool into the error dir with its reason, so
 * a bad intent is surfaced once instead of being retried every pass forever.
 */
function deadLetterIntent(dbPath, file, reason) {
  try {
    const dir = intentErrorDir(dbPath);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${basename(file).replace(/\.json$/, "")}.error.json`);
    renameSync(file, target);
    writeFileSync(`${target}.reason`, String(reason), "utf8");
  } catch (err) {
    console.error(`BROKER: could not dead-letter intent ${file}: ${err?.message ?? err}`);
  }
}

/**
 * Drain the inbox into the harness: submit each intent as an operator input to its
 * target seat. Called at the START of a pass, before `harness.inspect`, so a drained
 * intent shows up as a pending submission in the same pass and the seat is not
 * double-woken. An unknown seat or a failed submit is dead-lettered, never retried
 * forever. Returns `{ delivered, deadLettered }`.
 */
export async function drainIntentInbox(harness, probeStorage, { dbPath, context, onDiagnostic } = {}) {
  if (!dbPath) return { delivered: 0, deadLettered: 0 };
  const files = readIntentFiles(dbPath);
  if (files.length === 0) return { delivered: 0, deadLettered: 0 };
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const seats = seatsDoc?.value?.seats ?? {};
  let delivered = 0;
  let deadLettered = 0;
  for (const file of files) {
    let intent;
    try {
      intent = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      deadLetterIntent(dbPath, file, `unreadable intent: ${err?.message ?? err}`);
      deadLettered += 1;
      continue;
    }
    const seat = seats[intent.to];
    if (!seat) {
      deadLetterIntent(dbPath, file, `unknown seat: ${intent.to}`);
      onDiagnostic?.({ kind: "intent-undeliverable", seat: intent.to, reason: "unknown seat" });
      deadLettered += 1;
      continue;
    }
    try {
      const conv = await harness.conversation(seat.conversationId, context);
      if (!conv) throw new Error(`no conversation for seat ${intent.to}`);
      await conv.submit(
        {
          type: "input",
          content: String(intent.content ?? ""),
          ...(intent.requestId ? { requestId: intent.requestId } : {}),
        },
        context,
      );
      unlinkSync(file);
      delivered += 1;
    } catch (err) {
      deadLetterIntent(dbPath, file, `submit failed: ${err?.message ?? err}`);
      onDiagnostic?.({ kind: "intent-undeliverable", seat: intent.to, reason: String(err?.message ?? err) });
      deadLettered += 1;
    }
  }
  return { delivered, deadLettered };
}

/* ---------------------- stranded-submission reconciliation ---------------------- */
// A run can end without settling its input — the crash landed between the run
// task's terminal commit and the submission's settlement. The submission stays
// `placed` forever, and `selectWakes` reads any pending submission as "in flight"
// and never re-wakes the conversation, so the seat stalls silently as
// `admitted_not_started`. The harness offers no recovery for it:
// `abortSubmission` returns "already_placed" (a run picked it up) and
// `conversation.abort()` finds nothing live to abort. So settle it directly: a
// `placed` submission whose conversation has NO live task is an orphan that can no
// longer receive an answer. `conv.commit` is the public way to reach
// `tx.settleSubmission`; a live run always has its task committed with the
// placement in one commit, so a settled orphan cannot race a starting run.
// Returns the ids it settled so the caller can stop counting them as pending.
export async function reconcileStrandedSubmissions(harness, inspection, { context, onDiagnostic } = {}) {
  const liveConvIds = new Set();
  for (const task of inspection?.tasks ?? []) {
    const convId = task?.record?.conversationId;
    if (convId !== undefined) liveConvIds.add(convId);
  }
  const settled = [];
  for (const sub of inspection?.submissions ?? []) {
    if (sub.status !== "placed" || liveConvIds.has(sub.conversationId)) continue;
    try {
      const conv = await harness.conversation(sub.conversationId, context);
      if (!conv) {
        onDiagnostic?.({ kind: "stranded-unknown-conversation", submission: sub.id });
        continue;
      }
      await conv.commit((tx) => tx.settleSubmission(sub.id, { status: "unanswered", reason: "stranded" }), context);
      settled.push(sub.id);
    } catch (err) {
      // A settlement that still fails is reported, never swallowed: the seat stays
      // stranded and the operator has to see why.
      onDiagnostic?.({
        kind: "stranded-settle-failed",
        submission: sub.id,
        conversationId: sub.conversationId,
        error: String(err?.message ?? err),
      });
    }
  }
  return settled;
}

/**
 * Remove `item-<id>` worktrees whose queue item is no longer live. A leaked worktree (a
 * crash before its item's cleanup, or the recorded recursive-nesting defect) is an
 * orphan; one still holding uncommitted work is refused by the clean-only guard in
 * `removeClaimedWorktree` and reported, never force-removed (D60).
 */
export async function reconcileOrphanedWorktrees({ repoPath, liveItemIds, onDiagnostic } = {}) {
  if (!repoPath) return [];
  const worktrees = await listWorktrees(repoPath);
  const removed = [];
  for (const wt of worktrees) {
    const match = /^item-(\d+)$/.exec(basename(wt.worktree));
    if (!match) continue;
    const itemId = Number(match[1]);
    if (liveItemIds.has(itemId)) continue;
    const result = await removeClaimedWorktree({ worktree: wt.worktree });
    if (result?.removed) removed.push(itemId);
    else {
      onDiagnostic?.({
        kind: "worktree-orphan-kept",
        itemId,
        worktree: wt.worktree,
        reason: result?.refused ?? (result?.skipped ? "missing" : "not-removed"),
      });
    }
  }
  return removed;
}

/**
 * One reconciliation at broker start: dead generation leases and orphaned item
 * worktrees. The sweep is scoped to the directory that holds the store, so a broker
 * against a temp database (every demo) never scans an unrelated checkout —
 * `listWorktrees` returns [] for a path that is not a git repo.
 */
export async function reconcileBrokerStartup(harness, { dbPath, context, onDiagnostic } = {}) {
  const leases = reconcileGenerationSlots(dbPath, { onDiagnostic });
  const repoPath = dbPath ? dirname(resolve(dbPath)) : null;
  let worktrees = [];
  if (repoPath) {
    const queueDoc = await harness.documentState(RigQueue, undefined, context);
    const liveItemIds = new Set(
      (queueDoc?.value?.items ?? [])
        .filter((it) => ["queued", "claimed", "deferred", "held"].includes(it.status))
        .map((it) => it.id),
    );
    worktrees = await reconcileOrphanedWorktrees({ repoPath, liveItemIds, onDiagnostic });
  }
  return { leases, worktrees };
}

/**
 * Run one wake pass and hold the harness open until every run it started has
 * settled — closing earlier abandons the run (the F11 class).
 *
 * `readBusySeats` is a caller-owned async reader (generation leases live in
 * files beside the database, not in storage); when omitted, no seat is busy.
 * `onWoke(name)` fires for each seat whose wake was actually submitted, so a
 * broker can start that seat's cooldown. A seat prepares its own per-item
 * worktree through the `prepare_workspace` tool; the broker no longer creates one
 * or sets a process-global root (#broker-tool-workspace).
 */
export async function drivePass(
  harness,
  probeStorage,
  { context, seatFilter, readBusySeats, onError, onWoke, currentSeat: initialSeat,
    dbPath, onDiagnostic, waitForWakes = true } = {},
) {
  // Deliver any spooled operator intent FIRST, so the submission it creates is visible
  // to this pass's `inspect` and the seat is not also submitted a fixed wake.
  if (dbPath) {
    const drained = await drainIntentInbox(harness, probeStorage, { dbPath, context, onDiagnostic });
    if (drained.delivered > 0 || drained.deadLettered > 0) {
      logBrokerLine(dbPath, `INTENT delivered=${drained.delivered} dead=${drained.deadLettered}`);
    }
  }
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const queueDoc = await harness.documentState(RigQueue, undefined, context);
  const inspection = await harness.inspect(context);
  // Orphans first: a `placed` submission with no live task would otherwise read as
  // in-flight and hold its seat out of every wake. Settle them before building the
  // pending set, so the conversation they blocked becomes wakeable in THIS pass.
  const settledStranded = await reconcileStrandedSubmissions(harness, inspection, { context, onDiagnostic });
  if (dbPath && settledStranded.length > 0) {
    logBrokerLine(dbPath, `STRANDED settled=${settledStranded.length}`);
  }
  const settledStrandedIds = new Set(settledStranded);
  const pendingConvIds = new Set(
    (inspection.submissions ?? [])
      .filter((s) => !settledStrandedIds.has(s.id))
      .map((s) => s.conversationId),
  );
  const seats = seatsDoc?.value?.seats;
  const stoppedConvIds = await readStoppedConvIds(probeStorage, seats, context);
  const busySeats = readBusySeats ? await readBusySeats() : new Set();
  let wokenSeat = initialSeat ?? null;
  // The conversations THIS pass submitted a wake to. The settle-wait below is
  // scoped to them (#broker-liveness): the old global wait parked the loop on
  // every ownerless conversation, so one long run held up the re-wake of a seat
  // that had already settled with work still queued.
  const wokenConvIds = new Set();

  // The seat prepares its OWN workspace: the `prepare_workspace` tool creates the
  // item's worktree and points that one conversation at it (#broker-tool-workspace).
  // The broker deliberately does NOT create a worktree or set a process-global
  // DURIG_SEAT_ROOT here — one pass wakes many seats, so a single root applied to all
  // of them was never the isolation D49/D53 promised, and its lifecycle was tied to
  // the pass rather than the item the seat claimed.

  const wrapOnWoke = (name, convId) => {
    wokenSeat = name;
    if (convId !== undefined) wokenConvIds.add(convId);
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
  // Hold the harness open for the runs this pass started, and only those. A
  // one-shot `run` keeps this in-tick wait: it has no resident loop to drain
  // promptly, and its single pass should reflect the run's outcome. The resident
  // broker passes `waitForWakes: false` instead: awaiting here parks the whole
  // loop, so a `serve --stop` request and a spooled intent both wait behind the
  // slowest run (the ~15-minute pass gap). The broker drains the ordinary scope
  // once on loop exit instead (F11), and the commit subscription drives the next
  // pass, so a seat that settles early is re-woken without waiting for the slow
  // one. An empty wake set resolves at once either way.
  if (waitForWakes) {
    const wokenIdle = Promise.all(
      [...wokenConvIds].map(async (convId) => {
        const conv = await harness.conversation(convId, context);
        await conv?.waitForIdle(context);
      }),
    );
    await wokenIdle;
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
}) {
  const failedSeats = new Set();
  const escalations = [];
  let passes = 0;
  let stoppedBy = null;
  // Work may have been queued while nothing was running — the exact #238 finding
  // (three items queued with nothing driving) — so the first pass is forced
  // rather than waiting for a future commit.
  scheduler.markDirty();
  // Broker lifecycle audit (D46): `stoppedBy` reached stdout only, so once the process was
  // gone `<db>.broker.log` could not answer "why did the broker stop?" — a stop request was
  // indistinguishable from a crash or a bound. Log the birth here. A START with no matching
  // EXIT below means the broker died abnormally (a kill or a throw), because logBrokerLine is
  // synchronous and the EXIT line is written before the loop returns.
  logBrokerLine(dbPath, `START pid=${process.pid}`);
  // Reconcile what a previous broker left behind before the first pass: dead
  // generation leases and orphaned item worktrees. Reported here once, rather than
  // masked by the acquire path's lazy steal or left to pollute `git status`. A
  // failure is reported, never allowed to stop the broker from driving.
  if (dbPath) {
    try {
      const reconciled = await reconcileBrokerStartup(harness, { dbPath, context, onDiagnostic });
      if (reconciled.leases.length > 0 || reconciled.worktrees.length > 0) {
        logBrokerLine(
          dbPath,
          `RECONCILE leases=${reconciled.leases.length} worktrees=${reconciled.worktrees.length}`,
        );
      }
    } catch (err) {
      onDiagnostic({ kind: "reconcile-failed", error: String(err?.message ?? err) });
    }
  }
  // Heartbeat: keep the state file fresh so a recycled pid cannot be mistaken for this
  // broker. The token carries across rewrites; only the broker owns this interval.
  let heartbeat = null;
  if (dbPath) {
    const state = readBrokerState(dbPath);
    if (state && state.pid === process.pid) {
      heartbeat = setInterval(() => {
        try {
          writeBrokerState(dbPath, { pid: state.pid, since: state.since, runToken: state.runToken });
        } catch (err) {
          console.error(`BROKER WARNING: heartbeat write failed: ${err?.message ?? err}`);
        }
      }, BROKER_HEARTBEAT_MS);
      if (typeof heartbeat.unref === "function") heartbeat.unref();
    }
  }
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
    const passStartedAt = now();
    const wokeThisPass = [];
    try {
      await drivePass(harness, probeStorage, {
        context,
        seatFilter: scheduler.seatFilter(now()),
        readBusySeats,
        waitForWakes: false,
        dbPath,
        onDiagnostic,
        onError: (failure) => {
          failedSeats.add(failure.name);
          onDiagnostic({ kind: "wake-failed", ...failure });
        },
        onWoke: (name) => {
          scheduler.recordWakes([name], now());
          wokeThisPass.push(name);
          logBrokerLine(dbPath, `WAKE ${name}`);
        },
      });
      passes++;
      // Duration + the seats woken make a pass's liveness legible: a long
      // `ms=` with `woke=-` is a pass that waited, not one that worked.
      logBrokerLine(
        dbPath,
        `PASS ${passes} ms=${now() - passStartedAt} woke=${wokeThisPass.length > 0 ? wokeThisPass.join(",") : "-"}`,
      );
      if (supervise) {
        const plans = await supervise();
        for (const plan of plans) onDiagnostic({ kind: "escalated", ...plan });
        escalations.push(...plans);
        // A reset seat is a fresh context, but the wake THIS pass submitted started its cooldown,
        // so the next pass would suppress it and the seat would sit idle until an unrelated commit
        // — the exact stall the reset exists to break. Clear the cooldown and force a pass so the
        // seat is re-driven now.
        const resetSeats = plans
          .filter((plan) => plan.reason === "degeneration")
          .map((plan) => plan.seat);
        if (resetSeats.length > 0) {
          for (const name of resetSeats) scheduler.clearSeatCooldown(name);
          scheduler.markDirty();
        }
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
  // F11: the per-pass wait is now scoped to the conversations a pass woke, so
  // the loop can exit (a stop request or a bound) while a run started earlier is
  // still live. Never close the harness with a live run — drain the ordinary
  // scope here, exactly as the old global wait used to do at every pass. This
  // is the one place a global wait belongs.
  if (heartbeat) clearInterval(heartbeat);
  await harness.waitForIdle(context);
  // Close the audit opened by START: the reason the broker stopped (a `.stop` request, a
  // bound, or a signal) survives the process here instead of only on stdout.
  logBrokerLine(dbPath, `EXIT pid=${process.pid} reason=${stoppedBy ?? "unknown"} passes=${passes}`);
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

// The broker refreshes its state file this often; a state whose heartbeat is older
// than the timeout is treated as dead. This is the identity proxy Windows needs:
// pids are reused, so `process.kill(pid, 0)` alone can read a recycled pid as the
// broker. A fresh heartbeat can only come from the real broker process.
const BROKER_HEARTBEAT_MS = 20_000;
const BROKER_HEARTBEAT_TIMEOUT_MS = 60_000;

/** Liveness probe by signal 0, hardened against a recycled pid. */
export function brokerAlive(state, { now = Date.now() } = {}) {
  if (!state || typeof state.pid !== "number") return false;
  // A stale heartbeat means the state file outlived the broker that wrote it: the pid
  // may now name an unrelated process, so the pid probe alone would be wrong. A state
  // with no heartbeat (an older writer) falls back to the pid probe.
  if (
    typeof state.heartbeatAt === "number" &&
    now - state.heartbeatAt > BROKER_HEARTBEAT_TIMEOUT_MS
  ) {
    return false;
  }
  try {
    process.kill(state.pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we cannot signal it — still alive.
    return err?.code === "EPERM";
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

export function writeBrokerState(dbPath, { pid, since, runToken = randomUUID(), heartbeatAt = Date.now() }) {
  writeFileSync(brokerStatePath(dbPath), JSON.stringify({ pid, since, runToken, heartbeatAt }));
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
