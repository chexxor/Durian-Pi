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

import { readFileSync, unlinkSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CompactionEntry, configure } from "@earendil-works/pi-durable";

import { RigControl, RigQueue, Seats } from "./rig.mjs";
import { dispatchRead } from "./brokerread.mjs";
import { resetSeatContext, maxSeatsFromEnv } from "./reset.mjs";
import { driveOnce } from "./driver.mjs";
import { LOCAL_PROVIDER_ID } from "./providers/local.mjs";
import { wrapProviderWithSlots, getSeatFromContext, reconcileGenerationSlots } from "./genlock.mjs";
import { listWorktrees, removeClaimedWorktree, uncommittedCount, pruneWorktrees } from "./worktree.mjs";

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

/* ---------------------- D105: per-item fresh context boundary ---------------------- */
// D105 (operator directive 2026-10-18; lead #2164 seam ruling (c)): a seat whose RESOLVED
// provider is `local` draws a fresh `pi.reset` context boundary BEFORE it works each NEW
// work item, so a small-window local model does not carry the previous item's transcript
// into the next. The SIGNAL is the resolved `provider` recorded on the SEAT doc by `up`
// (a bounded single-field write, landing-gated behind the closed cli.mjs writer slot —
// #2017/#2110/#2144); the broker reads it from the seats doc it ALREADY loads, so no
// per-wake cross-conversation model read is added. The ACT fires on the WAKE path,
// BETWEEN runs, so the boundary lands before the wake this pass submits.
//
// Idempotence is carried by the `contextItemId` marker on the seat doc: the item the
// CURRENT context is anchored on. A boundary is drawn at most once per item even across
// a re-wake whose run never claimed. NON-LOCAL seats are untouched.

/** The `pi.reset` handoff a per-item boundary carries. Names the cause and the fix. */
export function localContextHandoff(itemId) {
  return (
    `fresh context boundary (D105): you are starting a NEW work item (#${itemId}). ` +
    `Your context was reset so this item is worked from a clean context — the durable ` +
    `transcript is kept. Re-anchor from your durable instructions and the item body; ` +
    `call claim_work to take the item.`
  );
}

/**
 * The local-provider seats that must draw a fresh context boundary this pass. Pure:
 * it decides, `applyLocalContextBoundaries` writes.
 *
 * A boundary is planned only BETWEEN runs: the seat holds no `claimed`, `deferred` or
 * `held` item (never mid-item), no submission is in flight, no live generation lease is held,
 * and the operator has not stopped it. It fires only for a seat whose recorded provider is
 * `local`, and only once per NEW item (the `contextItemId` marker).
 *
 * @param {{seats?: Record<string,{conversationId:number|string, provider?:string, contextItemId?:number}>, items?: Array<{id:number,to:string,status:string}>, pendingConvIds?: Set, busySeats?: Set, stoppedConvIds?: Set, paused?: boolean}} input
 * @returns {Array<{name:string, conversationId:number|string, itemId:number}>}
 */
/**
 * Item statuses that mean the seat is MID-ITEM. `deferred`/`held` are still HELD by the seat
 * (it will resume them), so a boundary now would wipe the mid-item continuation context and
 * the D105 handoff text would lie ("a NEW work item") while the seat still holds the item
 * (#2337). Only `queued` is between-items work.
 */
const MID_ITEM_STATUSES = new Set(["claimed", "deferred", "held"]);

export function planLocalContextBoundaries({
  seats,
  items,
  pendingConvIds = new Set(),
  busySeats = new Set(),
  stoppedConvIds = new Set(),
  paused = false,
}) {
  const plans = [];
  for (const [name, seat] of Object.entries(seats ?? {})) {
    // NON-LOCAL seats are UNCHANGED (D105: paid seats keep their durable context).
    if (seat?.provider !== LOCAL_PROVIDER_ID) continue;
    // While PAUSED the driver takes no NEW work, so no boundary is owed.
    if (paused) continue;
    const convId = seat.conversationId;
    if (pendingConvIds.has(convId)) continue; // a run is in flight
    if (busySeats.has(name)) continue; // a live generation lease is held
    if (stoppedConvIds.has(convId)) continue; // operator stop: never resurrect
    // BETWEEN items only: a claimed, deferred or held item means the seat is mid-item — never
    // reset it (#2337: deferred/held are reachable through the live pass and are still mid-item).
    if ((items ?? []).some((it) => it.to === name && MID_ITEM_STATUSES.has(it.status))) continue;
    // The item this wake will claim: the OLDEST queued item addressed to the seat
    // (claim_work's own rule), so the boundary is drawn before the seat works it.
    const next = (items ?? [])
      .filter((it) => it.to === name && it.status === "queued")
      .sort((a, b) => a.id - b.id)[0];
    if (!next) continue; // no NEW work to draw a boundary for
    if (seat.contextItemId === next.id) continue; // one boundary per NEW item
    plans.push({ name, conversationId: convId, itemId: next.id });
  }
  return plans;
}

/**
 * Draw each planned boundary through the EXISTING reset mechanism (`resetSeatContext`),
 * so the live-lease refusal is REUSED, not bypassed, and the write is the same `pi.reset`
 * `cli reset` uses — no new write path. The `contextItemId` marker is recorded AFTER the
 * boundary lands, so a refused/failed reset is retried on a later pass rather than
 * silently suppressed. A failure on one seat is reported and does not abandon the others.
 */
export async function applyLocalContextBoundaries(harness, plans, context, { dbPath, maxSeats = Infinity, onDiagnostic } = {}) {
  const applied = [];
  for (const plan of plans ?? []) {
    try {
      const result = await resetSeatContext(harness, plan.name, localContextHandoff(plan.itemId), dbPath, {
        maxSeats,
        context,
      });
      if (result.refused) continue; // unknown seat or a live lease: retry on a later pass
      await harness.commit(async (tx) => {
        const seat = (await tx.doc(Seats)).seats[plan.name];
        if (seat) seat.contextItemId = plan.itemId;
      }, context);
      applied.push({ ...plan, resetEntryId: result.resetEntryId });
    } catch (err) {
      onDiagnostic?.({ kind: "context-boundary-failed", seat: plan.name, itemId: plan.itemId, error: String(err?.message ?? err) });
      console.error(`broker: per-item context boundary failed for ${plan.name}: ${err?.message ?? err}`);
    }
  }
  return applied;
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
 * Do ALL pending intent files ask only for the non-mutating `read` op (#2321)?
 *
 * A `read` must be served WITHOUT a wake pass: `watch` polls it every ~750 ms, and forcing a
 * full pass per poll is what hammered the broker (#2237). The idle loop uses this to tell a
 * watcher's poll apart from real work. An unreadable file is NOT read-only (the drain
 * dead-letters it), and an empty inbox returns false so "nothing pending" is never read as
 * "read-only".
 */
function onlyReadIntents(dbPath) {
  const files = readIntentFiles(dbPath);
  if (files.length === 0) return false;
  for (const file of files) {
    let request;
    try {
      request = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
    if (requestOp(request) !== "read") return false;
  }
  return true;
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
 * Result channel: one JSON per applied request, keyed by `requestId`. A producer
 * awaits the outcome by polling `<requestId>.json` here. It is ALSO the idempotency
 * ledger: a request whose result already exists is not applied again on a re-drain.
 */
export function intentResultDir(dbPath) {
  return `${dbPath}.broker.inbox.out`;
}

export function readIntentResult(dbPath, requestId) {
  if (!requestId) return null;
  const path = join(intentResultDir(dbPath), `${requestId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The dead-letter reason for `requestId`, or null when it was not dead-lettered. The error
 * file is named after the ORIGINAL spool file (not the requestId), so this scans and matches
 * on the parsed `requestId` — a producer must be able to tell "refused" from "still pending".
 */
export function readIntentError(dbPath, requestId) {
  if (!requestId) return null;
  const dir = intentErrorDir(dbPath);
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".error.json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (parsed?.requestId !== requestId) continue;
    const reasonPath = join(dir, `${name}.reason`);
    try {
      return readFileSync(reasonPath, "utf8");
    } catch {
      return "dead-lettered (no reason recorded)";
    }
  }
  return null;
}

/**
 * Await the broker's outcome for a spooled `requestId`: the recorded result, or the
 * dead-letter reason, or a timeout. This is the producer half of the result channel — the
 * CLI uses it so a routed write can report the broker's actual outcome instead of guessing.
 */
export async function awaitIntentResult(
  dbPath,
  requestId,
  { timeoutMs = 120000, intervalMs = 200, now = Date.now, sleep } = {},
) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    const result = readIntentResult(dbPath, requestId);
    if (result) return { ok: true, result };
    const error = readIntentError(dbPath, requestId);
    if (error) return { ok: false, reason: error };
    if (now() >= deadline) return { ok: false, reason: "timed out awaiting the broker's result" };
    await wait(intervalMs);
  }
}

function writeIntentResult(dbPath, requestId, result) {
  const dir = intentResultDir(dbPath);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${requestId}.json`);
  writeFileSync(path, JSON.stringify(result), "utf8");
  return path;
}

/**
 * How long a spooled RESULT file is kept. Long enough that any live poller has consumed it
 * (`awaitIntentResult` polls at 200 ms up to a 120 s timeout), short enough that a client
 * that died mid-poll cannot leak it forever (#2497 / architect A4).
 */
export const INTENT_RESULT_TTL_MS = 10 * 60_000;

/**
 * Garbage-collect spooled RESULT files (`<db>.broker.inbox.out/`) older than `ttlMs`.
 *
 * The result dir is the idempotency ledger AND the producer's reply channel: a client that
 * dies mid-poll leaves `<requestId>.json` behind with nobody to read it, and the `health`
 * view is multi-MB, so the dir would grow without bound. A read client consumes its own
 * result, but every other op (and every crashed poller) does not.
 *
 * GUARDED BY IN-FLIGHT: a result whose `requestId` still has a PENDING intent file in the
 * inbox is SKIPPED — that request has not been applied yet (or a re-drain is about to
 * consume it), so its ledger row is still load-bearing. Only a result with no pending
 * request AND older than the TTL is removed.
 *
 * Age comes from the result's own `at` timestamp; a result with no usable timestamp falls
 * back to the file's mtime, so a malformed row cannot leak forever either.
 *
 * @returns {{removed:number, kept:number}}
 */
export function gcIntentResults(dbPath, { ttlMs = INTENT_RESULT_TTL_MS, now = Date.now } = {}) {
  const dir = intentResultDir(dbPath);
  if (!existsSync(dir)) return { removed: 0, kept: 0 };
  // In-flight = a pending intent file still names the requestId.
  const inFlight = new Set();
  for (const file of readIntentFiles(dbPath)) {
    try {
      const request = JSON.parse(readFileSync(file, "utf8"));
      if (request?.requestId) inFlight.add(request.requestId);
    } catch {
      // Unreadable: the drain will dead-letter it, so it is not a live waiter.
    }
  }
  let removed = 0;
  let kept = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const requestId = name.slice(0, -5);
    if (inFlight.has(requestId)) {
      kept += 1;
      continue;
    }
    const path = join(dir, name);
    let age = null;
    try {
      const at = Date.parse(JSON.parse(readFileSync(path, "utf8"))?.at ?? "");
      age = Number.isFinite(at) ? now() - at : null;
    } catch {
      age = null;
    }
    if (age === null) {
      try {
        age = now() - statSync(path).mtimeMs;
      } catch {
        age = null;
      }
    }
    if (age !== null && age >= ttlMs) {
      try {
        unlinkSync(path);
        removed += 1;
      } catch {
        kept += 1;
      }
    } else {
      kept += 1;
    }
  }
  return { removed, kept };
}

/**
 * The operation a spooled request asks the broker to apply. An absent `op` means the
 * original "deliver a message" intent, so producers written before the spool keep
 * working.
 */
export function requestOp(request) {
  return request?.op ?? "message";
}

/**
 * Apply a rig-level `pause`/`unpause` (ROADMAP 131) with the caller's harness — the
 * SINGLE writer. `pause` gates TAKING new work; it never touches an in-flight run
 * (AC2: pause never kills). With `wait`, hold until every seat has settled, so
 * `pause --wait` returns only at TRUE quiescence (AC5). Exported so the CLI's
 * no-resident-broker path (where it is the sole writer) uses the SAME code.
 */
export async function applyPauseOp(harness, { paused, by = "operator", reason = null, wait = false } = {}, context) {
  await harness.commit(async (tx) => {
    const doc = await tx.doc(RigControl);
    doc.paused = paused === true;
    doc.pausedAt = paused === true ? new Date().toISOString() : null;
    doc.pausedBy = paused === true ? String(by ?? "operator") : null;
    doc.reason = paused === true && reason != null ? String(reason) : null;
  }, context);
  if (paused !== true || !wait) return { paused: paused === true };
  const startedAt = Date.now();
  for (;;) {
    const live = await harness.inspect(context);
    const tasks = (live.tasks ?? []).filter((t) => t.record?.state?.status === "running");
    const subs = (live.submissions ?? []).filter((s) => s.status === "queued" || s.status === "placed");
    if (tasks.length === 0 && subs.length === 0) {
      return { paused: true, quiesced: true, waitedMs: Date.now() - startedAt };
    }
    await new Promise((r) => setTimeout(r, QUIESCE_POLL_MS));
  }
}

/**
 * The operations the command spool accepts (ROADMAP 71). "Do not add a fourth kind":
 * a new mutating verb EXTENDS this list — the broker applies it in-process with its own
 * harness — rather than opening a second writer. `pause`/`unpause` (ROADMAP 131) are
 * rig-level: they carry no seat target.
 */
export const SPOOL_OPS = ["message", "stop", "reset", "compact", "pause", "unpause", "read", "configure"];

/** How often `pause --wait` re-checks for quiescence while the broker drains (ROADMAP 131 AC5). */
const QUIESCE_POLL_MS = 100;

/**
 * Apply one typed request with the broker's OWN harness — the single writer. Throws on
 * an unknown op or seat; the drain dead-letters the throw with its reason.
 */
async function applyRequest(harness, request, { seats, context, dbPath, probeStorage, readStorage }) {
  const op = requestOp(request);
  // `read` is the one non-mutating spool op: the broker serves a view from its OWN
  // pi-durable instance so a second process never opens the database (see
  // src/brokerread.mjs). It is applied with `readStorage` - the SAME `Storage` object the
  // harness was opened over - not the separate `probeStorage`: pi-durable keeps the
  // harness's storage private (`#storage`), and its `document()` takes BEGIN IMMEDIATE
  // even for a read, so a read on the second probe connection contends with the harness's
  // own commits in-process and times out the 5 s busy window (`PASS ms=5051` ->
  // SessionFailed -> wedge). One pi-durable instance, one connection. A caller holding a
  // single handle (a demo's `drainIntentInbox(harness, storage, ...)`) omits `readStorage`,
  // so the fallback keeps that shape working.
  if (op === "read") {
    return await dispatchRead(readStorage ?? probeStorage, request, { dbPath, context });
  }
  if (op === "configure") {
    // Bounded single-field write: `up` records the resolved provider on the seat's
    // conversation (D105/D106). The broker applies it with its own harness — no
    // external writer, no cli.mjs change. The request carries { model: { provider, modelId? } }.
    const seatName = request.to ?? request.seat;
    const seat = seats[seatName];
    if (!seat) throw new Error(`unknown seat: ${seatName}`);
    const convId = seat.conversationId;
    const model = request.model;
    if (!model || typeof model.provider !== "string") {
      throw new Error(`configure: missing model.provider for seat ${seatName}`);
    }
    await harness.commit(
      (tx) => configure(tx, convId, { model }),
      context,
    );
    return { op, seat: seatName, provider: model.provider, modelId: model.modelId ?? null };
  }
  if (op === "message") {
    const seat = seats[request.to];
    if (!seat) throw new Error(`unknown seat: ${request.to}`);
    const conv = await harness.conversation(seat.conversationId, context);
    if (!conv) throw new Error(`no conversation for seat ${request.to}`);
    await conv.submit(
      {
        type: "input",
        content: String(request.content ?? ""),
        ...(request.requestId ? { requestId: request.requestId } : {}),
      },
      context,
    );
    return { op, seat: request.to, delivered: true };
  }
  if (op === "stop") {
    // The broker holds the run in-process, so it can halt a seat without the
    // cross-process pid kill `cmdStop` needs: settle the pending submission to
    // terminal `aborted: <reason>` and abort the run task, both with its own writer.
    const seatName = request.to ?? request.seat;
    const seat = seats[seatName];
    if (!seat) throw new Error(`unknown seat: ${seatName}`);
    const convId = seat.conversationId;
    const reason = String(request.reason ?? "operator stop");
    const inspection = await harness.inspect(context);
    const pending = (inspection.submissions ?? []).find(
      (s) => s.conversationId === convId && (s.status === "queued" || s.status === "placed"),
    );
    let settled = false;
    if (pending) {
      await harness.commit(
        (tx) => tx.settleSubmission(pending.id, { status: "unanswered", reason: `aborted: ${reason}` }),
        context,
      );
      settled = true;
    }
    const runTask = (inspection.tasks ?? []).find((t) => t.record.conversationId === convId);
    if (runTask) await harness.abortTask(runTask.record.id, context);
    return { op, seat: seatName, settled, aborted: Boolean(runTask), reason };
  }
  if (op === "reset") {
    // The shared reset-boundary mechanism (#402), applied with the broker's own writer.
    // A refusal (unknown seat / live lease) throws so the drain dead-letters it with the
    // reason — a reset the operator asked for is never a silent no-op.
    const seatName = request.to ?? request.seat;
    const result = await resetSeatContext(harness, seatName, request.handoff, dbPath, {
      maxSeats: maxSeatsFromEnv(),
      context,
    });
    if (result.refused) {
      throw new Error(result.reason === "unknown-seat" ? `unknown seat: ${seatName}` : result.reason);
    }
    return { op, seat: seatName, resetEntryId: result.resetEntryId, handoff: result.handoff ?? null };
  }
  if (op === "compact") {
    // pi-durable's compaction is designed to run ALONGSIDE a live conversation: `compact()`
    // commits a `pi.compaction` task that summarizes an old prefix and places a summary entry
    // at a turn boundary (the transcript is kept). The broker applies it with its OWN harness —
    // no external writer, no abort of the run. The live-generation-lease guard does NOT apply:
    // it stops an OUTSIDE writer; the broker IS the owner, and pi-durable commits at the turn
    // boundary. Report the summary entry id, not merely the task id (an enqueue-and-exit stub
    // would claim success while nothing was summarized).
    const seatName = request.to ?? request.seat;
    const seat = seats[seatName];
    if (!seat) throw new Error(`unknown seat: ${seatName}`);
    const conv = await harness.conversation(seat.conversationId, context);
    if (!conv) throw new Error(`no conversation for seat ${seatName}`);
    const instructions =
      typeof request.instructions === "string" && request.instructions.trim() !== ""
        ? request.instructions
        : undefined;
    const taskId = await conv.compact(instructions, context);
    await harness.waitForTask(taskId, context);
    const after = await conv.entries({ order: "descending" }, 50, undefined, context);
    const summary = after.items.find((e) => e.kind === CompactionEntry.kind);
    if (!summary) {
      throw new Error(`compact: no pi.compaction entry was written for seat ${seatName} (task ${taskId})`);
    }
    return { op, seat: seatName, taskId, instructions: instructions ?? null, summaryEntryId: summary.id };
  }
  if (op === "pause" || op === "unpause") {
    return await applyPauseOp(
      harness,
      { paused: op === "pause", by: request.from, reason: request.reason, wait: request.wait },
      context,
    );
  }
  throw new Error(`unknown op: ${op} (known: ${SPOOL_OPS.join(", ")})`);
}

/**
 * Drain the inbox into the harness: apply each typed request with the broker's own
 * writer. Called at the START of a pass, before `harness.inspect`, so a drained
 * `message` shows up as a pending submission in the same pass and the seat is not
 * double-woken. An unknown op/seat or a failed apply is dead-lettered, never retried
 * forever. Returns `{ delivered, deadLettered, duplicates }` — `duplicates` counts
 * requests whose `requestId` already had a recorded result (applied ONCE, not again).
 */
export async function drainIntentInbox(harness, probeStorage, { dbPath, context, onDiagnostic, readStorage } = {}) {
  if (!dbPath) return { delivered: 0, deadLettered: 0, duplicates: 0 };
  const files = readIntentFiles(dbPath);
  if (files.length === 0) return { delivered: 0, deadLettered: 0, duplicates: 0 };
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const seats = seatsDoc?.value?.seats ?? {};
  let delivered = 0;
  let deadLettered = 0;
  let duplicates = 0;
  for (const file of files) {
    let request;
    try {
      request = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      deadLetterIntent(dbPath, file, `unreadable intent: ${err?.message ?? err}`);
      deadLettered += 1;
      continue;
    }
    const op = requestOp(request);
    const requestId = request.requestId ?? null;

    // Idempotent re-drain: a request whose RESULT is already recorded was applied on
    // an earlier pass (its file survived a crash before the unlink). Consume the file
    // WITHOUT applying again — a duplicate requestId applies ONCE.
    if (readIntentResult(dbPath, requestId)) {
      unlinkSync(file);
      duplicates += 1;
      continue;
    }
    if (!SPOOL_OPS.includes(op)) {
      deadLetterIntent(dbPath, file, `unknown op: ${op} (known: ${SPOOL_OPS.join(", ")})`);
      onDiagnostic?.({ kind: "intent-undeliverable", op, reason: "unknown op" });
      deadLettered += 1;
      continue;
    }
    try {
      const result = await applyRequest(harness, request, { seats, context, dbPath, probeStorage, readStorage });
      if (requestId) {
        writeIntentResult(dbPath, requestId, { requestId, op, ok: true, result, at: new Date().toISOString() });
      }
      unlinkSync(file);
      delivered += 1;
    } catch (err) {
      deadLetterIntent(dbPath, file, `apply failed: ${err?.message ?? err}`);
      onDiagnostic?.({ kind: "intent-undeliverable", op, seat: request.to, reason: String(err?.message ?? err) });
      deadLettered += 1;
    }
  }
  return { delivered, deadLettered, duplicates };
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

/** The id encoded in a worktree BRANCH ref (`impl-item-<N>` / `item-<N>`), or null. */
function refItemId(ref) {
  const m = /(?:^|[-/])item-(\d+)$/.exec(String(ref ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * The KEEP-REASONS the worktree audit and the orphan sweep share (ROADMAP 76). `reapable` is
 * the ONLY reason the sweep acts on; every other reason is a KEEP, reported so the operator can
 * see WHY a tree is still there instead of guessing.
 */
export const WORKTREE_KEEP_REASONS = [
  "seat-root",
  "non-item",
  "branch-unresolved",
  "live",
  "locked",
  "not-terminal",
  "dirty",
  "reapable",
];

/**
 * qa's THROWAWAY verify-scratch naming (ROADMAP 76 leak source B, #1891): the scratch worktrees a
 * verifier creates under (or beside) an item worktree, e.g. `.verify-8770005`, `verify1194-full`,
 * `wt-658-41d0ec9`. They are throwaway by convention, so an UNLOCKED + CLEAN one is reapable just
 * like a terminal item's tree — the verifier-must-lock protocol is what protects an in-use one.
 */
/**
 * PROVENANCE / OWNERSHIP (WORKTREE-ROT 3/3, #2330): whoever CREATES a worktree owns its cleanup.
 * durian-pi reaps only the trees it creates — `item-<id>` (terminal + unlocked + clean) and the
 * verify-scratch below (unlocked + clean). Anything else is a harness/viewer/operator tree: it
 * classifies as `non-item` and is ALWAYS kept, and a tree that is a live seat's cwd is `seat-root`
 * (also kept). The keep-reasons in `classifyWorktrees` are the per-tree encoding of this rule, and
 * `reconcileOrphanedWorktrees` acts on `reapable` alone — every other reason is a KEEP. Source: the
 * vendored using-git-worktrees / finishing-a-development-branch skills and the rototill design doc,
 * "Provenance-based ownership".
 */
export const VERIFY_SCRATCH_RE = /^\.?(verify|wt)/i;

/**
 * Classify every worktree by the SAME rule the orphan sweep uses (ROADMAP 76 / #1244). Pure: the
 * caller supplies the queue sets, the seat roots and the per-worktree uncommitted COUNT, so the
 * decision is testable without a git repo. One entry per worktree, carrying the queue status, the
 * uncommitted count, the lock state and the keep-reason.
 *
 * @param {{worktrees?:Array<{worktree:string,branch?:string|null,locked?:boolean}>,
 *   liveItemIds?:Set<number>, terminalItemIds?:Set<number>, seatRoots?:Array<string>,
 *   statusById?:Map<number,string>, dirty?:Record<string,number>}} input
 */
export function classifyWorktrees({
  worktrees = [],
  liveItemIds = new Set(),
  terminalItemIds = new Set(),
  seatRoots = [],
  statusById = new Map(),
  dirty = {},
} = {}) {
  const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const roots = new Set(seatRoots.map(norm));
  const out = [];
  for (const wt of worktrees) {
    const path = wt?.worktree;
    if (!path) continue;
    const key = norm(path);
    const uncommitted = Number.isFinite(dirty[key]) ? dirty[key] : null;
    const entry = {
      worktree: path,
      branch: wt.branch ?? null,
      itemId: null,
      status: null,
      uncommitted,
      locked: wt.locked === true,
      // WHAT the tree is (item / verify-scratch / non-item), separate from WHY it is kept, so the
      // audit surfaces qa's scratch distinctly instead of lumping it into `non-item`.
      kind: "non-item",
      keepReason: "non-item",
    };
    const pathMatch = /^item-(\d+)$/.exec(basename(path));
    const pathId = pathMatch ? Number(pathMatch[1]) : null;
    entry.itemId = pathId;
    if (roots.has(key)) {
      entry.keepReason = "seat-root";
      out.push(entry);
      continue;
    }
    if (pathId === null) {
      // Not an `item-<id>` worktree. A verify-scratch tree (leak source B) is classified by the
      // SAME keep decision as a terminal item: LOCKED is a keep, DIRTY is a keep, and an
      // unlocked+clean scratch is reapable.
      if (VERIFY_SCRATCH_RE.test(basename(path))) {
        entry.kind = "verify-scratch";
        if (entry.locked) entry.keepReason = "locked";
        else if (uncommitted === null || uncommitted > 0) entry.keepReason = "dirty";
        else entry.keepReason = "reapable";
      }
      out.push(entry);
      continue;
    }
    entry.kind = "item";
    const branchId = wt.branch ? refItemId(wt.branch) : null;
    if (wt.branch && branchId === null) {
      entry.itemId = pathId;
      entry.keepReason = "branch-unresolved";
      out.push(entry);
      continue;
    }
    const itemId = branchId ?? pathId;
    entry.itemId = itemId;
    entry.status = statusById.get(itemId) ?? null;
    if (liveItemIds.has(itemId)) entry.keepReason = "live";
    else if (entry.locked) entry.keepReason = "locked";
    else if (!terminalItemIds.has(itemId)) entry.keepReason = "not-terminal";
    else if (uncommitted === null || uncommitted > 0) entry.keepReason = "dirty";
    else entry.keepReason = "reapable";
    out.push(entry);
  }
  return out;
}

/**
 * Gather and classify every registered worktree (ROADMAP 76 audit surface). READ-ONLY: it runs
 * `git worktree list` and a `git status` per tree, and writes nothing. `seatRoots` are the seats'
 * persisted `pi.agent.cwd` (the strongest liveness signal); `statusById` maps a queue item id to
 * its status for the report.
 */
export async function auditWorktrees({
  repoPath,
  liveItemIds = new Set(),
  terminalItemIds = new Set(),
  statusById = new Map(),
  seatRoots = [],
} = {}) {
  if (!repoPath) return [];
  const worktrees = await listWorktrees(repoPath);
  const dirty = {};
  for (const wt of worktrees) {
    if (!wt?.worktree) continue;
    const key = String(wt.worktree).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    try {
      dirty[key] = await uncommittedCount(wt.worktree);
    } catch {
      dirty[key] = null;
    }
  }
  return classifyWorktrees({ worktrees, liveItemIds, terminalItemIds, seatRoots, statusById, dirty });
}

/**
 * The EXPLICIT verify-scratch cleanup (ROADMAP 76 leak source B prevention, #1907). Call it when a
 * VERIFY COMPLETES: it unlocks and removes every registered verify-scratch worktree (`.verify-*` /
 * `verify*` / `wt-*`) — unlike the automatic sweep, which only reaps UNLOCKED scratch, this is the
 * verifier saying "I am done, tear my scratch down". A DIRTY scratch is REFUSED (never `--force`,
 * never `git clean`): its uncommitted work is preserved and reported in `kept`. `force` is the
 * caller explicitly accepting that loss and is never passed by the CLI.
 *
 * @returns {Promise<{removed:string[], kept:Array<{worktree:string, reason:string}>}>}
 */
export async function cleanVerifyScratch({ repoPath, force = false } = {}) {
  if (!repoPath) return { removed: [], kept: [] };
  const worktrees = (await listWorktrees(repoPath)).filter((wt) =>
    VERIFY_SCRATCH_RE.test(basename(wt?.worktree ?? "")),
  );
  const removed = [];
  const kept = [];
  for (const wt of worktrees) {
    const result = await removeClaimedWorktree({ worktree: wt.worktree, force });
    if (result?.removed) removed.push(wt.worktree);
    else kept.push({ worktree: wt.worktree, reason: result?.refused ?? (result?.skipped ? "missing" : "not-removed") });
  }
  return { removed, kept };
}

/**
 * Remove ONE verify-scratch worktree by path (the verifier's own scratch). Same contract as
 * `cleanVerifyScratch`: unlock + remove, refuse a dirty tree unless the caller forces it.
 */
export async function removeVerifyScratch({ worktree, force = false } = {}) {
  return removeClaimedWorktree({ worktree, force });
}

/**
 * Remove `item-<id>` worktrees whose queue item is TERMINAL and which are unlocked and clean.
 *
 * A leaked worktree (a crash before its item's cleanup, or the recorded recursive-nesting
 * defect) is an orphan; one still holding uncommitted work is refused by the clean-only guard in
 * `removeClaimedWorktree` and reported, never force-removed (D60).
 *
 * #1194 narrowed this to never reap a LOCKED or BRANCH-HELD worktree — but since every durig item
 * worktree is branch-based (#859), that made the sweep nearly useless as a backstop. #1244 adds a
 * TERMINAL-ITEM signal and ANDs it with the existing checks: a branch-held worktree is reaped
 * ONLY when the branch ENCODES a queue item whose status is terminal, the worktree is UNLOCKED,
 * and it is CLEAN. Terminal-ness is NECESSARY but never SUFFICIENT; every other case is KEPT and
 * reported (`worktree-orphan-kept`), never silently discarded.
 *
 * RESIDUAL RISK (flagged, #1244): a TERMINAL item's worktree can still be IN USE — a verifier
 * checking a completed artifact, or a post-done fix. The `locked` check is the guard for that: a
 * verifier (or any in-flight holder) MUST `git worktree lock` the worktree it uses, or this sweep
 * can remove it from under it. This removes the WORKTREE only — never the branch, so the ref and
 * its commits survive (e.g. the #882/666017a case); branch cleanup is separate (#1209).
 *
 * `terminalItemIds` is the set of queue items whose status is terminal (done/cancelled). An id
 * that is absent from it — non-terminal, or not in the store at all — is KEPT, and so is a
 * branch-held worktree whose branch does not resolve an id (the safe default).
 */
export async function reconcileOrphanedWorktrees({ repoPath, liveItemIds, terminalItemIds, seatRoots = [], onDiagnostic } = {}) {
  if (!repoPath) return [];
  const entries = await auditWorktrees({ repoPath, liveItemIds, terminalItemIds, seatRoots });
  const removed = [];
  const keep = (itemId, worktree, reason) =>
    onDiagnostic?.({ kind: "worktree-orphan-kept", itemId, worktree, reason });
  for (const entry of entries) {
    // `reapable` is the ONLY reason the sweep acts on; every other reason is a KEEP, reported
    // with the SAME reason vocabulary the audit surface shows (ROADMAP 76).
    if (entry.keepReason !== "reapable") {
      if (entry.keepReason !== "non-item" && entry.keepReason !== "seat-root") {
        keep(entry.itemId, entry.worktree, entry.keepReason);
      }
      continue;
    }
    const result = await removeClaimedWorktree({ worktree: entry.worktree });
    if (result?.removed) removed.push(entry.itemId);
    else keep(entry.itemId, entry.worktree, result?.refused ?? (result?.skipped ? "missing" : "not-removed"));
  }
  // PRUNE AFTER REMOVE (#2329): a directory deleted out-of-band leaves a STALE registration that
  // keeps listing and confuses the audit (25 were cleared on 2026-10-19). Prune once at the end
  // so the sweep self-heals those, whether or not it removed anything this pass.
  await pruneWorktrees(repoPath);
  return removed;
}

/**
 * One reconciliation at broker start: dead generation leases and orphaned item
 * worktrees. The sweep is scoped to the directory that holds the store, so a broker
 * against a temp database (every demo) never scans an unrelated checkout —
 * `listWorktrees` returns [] for a path that is not a git repo.
 */
export async function reconcileBrokerStartup(harness, { dbPath, context, onDiagnostic, probeStorage } = {}) {
  const leases = reconcileGenerationSlots(dbPath, { onDiagnostic });
  const repoPath = dbPath ? dirname(resolve(dbPath)) : null;
  let worktrees = [];
  if (repoPath) {
    const queueDoc = await harness.documentState(RigQueue, undefined, context);
    const LIVE_STATUSES = ["queued", "claimed", "deferred", "held"];
    const items = queueDoc?.value?.items ?? [];
    const liveItemIds = new Set(items.filter((it) => LIVE_STATUSES.includes(it.status)).map((it) => it.id));
    // #1244: the complement of the live set is the TERMINAL set (done/cancelled). An id that is
    // in NEITHER set does not exist in the store, so its worktree is KEPT (safe default).
    const terminalItemIds = new Set(items.filter((it) => !LIVE_STATUSES.includes(it.status)).map((it) => it.id));
    // ROADMAP 76: a worktree that is some seat's persisted cwd (`pi.agent`.cwd) is IN USE, so the
    // sweep must not reap it even when its item is terminal and the tree is clean.
    const seatRoots = await readSeatRootsFromStorage(probeStorage, harness, context);
    worktrees = await reconcileOrphanedWorktrees({ repoPath, liveItemIds, terminalItemIds, seatRoots, onDiagnostic });
  }
  return { leases, worktrees };
}

/**
 * The seats' persisted roots (`pi.agent`.cwd), read through the raw storage handle the broker
 * owns (the driving harness would fail its whole session on one bad read). Best-effort: an
 * unreadable agent document is skipped, never fatal.
 */
async function readSeatRootsFromStorage(probeStorage, harness, context) {
  const roots = [];
  if (!probeStorage?.findDocument) return roots;
  try {
    const seatsDoc = await harness.documentState(Seats, undefined, context);
    for (const seat of Object.values(seatsDoc?.value?.seats ?? {})) {
      try {
        const rec = await probeStorage.findDocument(
          { kind: "pi.agent", scope: { kind: "conversation", conversationId: seat.conversationId } },
          "current",
          context,
        );
        const cwd = rec ? (await probeStorage.document(rec.id, "current", context))?.value?.cwd ?? null : null;
        if (cwd) roots.push(cwd);
      } catch {
        // skip an unreadable seat root
      }
    }
  } catch {
    // no seats yet: nothing to protect
  }
  return roots;
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
  { context, seatFilter, readBusySeats, onError, onWoke, onSuppressed, currentSeat: initialSeat,
    dbPath, onDiagnostic, waitForWakes = true, readStorage } = {},
) {
  // Deliver any spooled operator intent FIRST, so the submission it creates is visible
  // to this pass's `inspect` and the seat is not also submitted a fixed wake.
  if (dbPath) {
    const drained = await drainIntentInbox(harness, probeStorage, { dbPath, context, onDiagnostic, readStorage });
    if (drained.delivered > 0 || drained.deadLettered > 0 || drained.duplicates > 0) {
      logBrokerLine(dbPath, `INTENT delivered=${drained.delivered} dead=${drained.deadLettered} dup=${drained.duplicates}`);
    }
    // #2497 (architect A4): bound the result ledger. A client that died mid-poll leaves its
    // `<requestId>.json` behind with nobody to read it, and the `health` view is multi-MB, so
    // the dir would grow without bound. Run the TTL/GC once per PASS (not on the read-poll
    // path, which does not come through here), never touching a result whose request is still
    // in flight. A GC failure is reported, never allowed to stop the pass.
    try {
      const gc = gcIntentResults(dbPath);
      if (gc.removed > 0) logBrokerLine(dbPath, `INTENT-GC removed=${gc.removed} kept=${gc.kept}`);
    } catch (err) {
      onDiagnostic?.({ kind: "intent-gc-failed", error: String(err?.message ?? err) });
    }
  }
  const seatsDoc = await harness.documentState(Seats, undefined, context);
  const queueDoc = await harness.documentState(RigQueue, undefined, context);
  // ROADMAP 131: the rig-level paused flag. While set, the driver does not wake a seat
  // to CLAIM new work (in-flight runs settle untouched).
  const controlDoc = await harness.documentState(RigControl, undefined, context);
  const paused = controlDoc?.value?.paused === true;
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
  // D105: a LOCAL-provider seat draws a fresh context boundary BEFORE it works each NEW
  // item. Drawn on the wake path, before this pass submits its wakes, so the reset lands
  // first and the seat claims its item from a clean context. A no-op for every other rig.
  const boundaryPlans = planLocalContextBoundaries({
    seats,
    items: queueDoc?.value?.items,
    pendingConvIds,
    busySeats,
    stoppedConvIds,
    paused,
  });
  if (boundaryPlans.length > 0) {
    const drawn = await applyLocalContextBoundaries(harness, boundaryPlans, context, {
      dbPath,
      maxSeats: maxSeatsFromEnv(),
      onDiagnostic,
    });
    if (dbPath && drawn.length > 0) {
      logBrokerLine(dbPath, `CONTEXT-BOUNDARY seats=${drawn.map((p) => p.name).join(",")}`);
    }
  }
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
    paused,
    onError,
    onWoke: wrapOnWoke,
    onSuppressed,
    // AC3: a wake refused because the rig is paused is LEGIBLE, never silent.
    onPaused: (name) => onDiagnostic?.({ kind: "wake-refused-paused", seat: name, reason: "rig paused" }),
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
  readStorage,
  scheduler,
  signal,
  context,
  readBusySeats,
  onDiagnostic = () => {},
  supervise = null,
  maxDurationMs = 0,
  maxPasses = Infinity,
  // A wake that FAILS (a per-seat `wake-failed`, not a whole-pass throw) leaves the
  // candidate un-actioned with no commit to re-trigger a pass, so the broker goes
  // dormant (the 2026-10-18 recurrence: fresh heartbeat, frozen `PASS`). This is the
  // delay before the retry pass; it doubles per CONSECUTIVE failing pass up to
  // `wakeRetryMaxMs`, so a transient storage lock heals on its own while a persistent
  // error cannot hot-loop the loop.
  wakeRetryMs = 2_000,
  wakeRetryMaxMs = 60_000,
  now = Date.now,
  startedAt = now(),
  isStopping = () => false,
  dbPath = undefined,
}) {
  const failedSeats = new Set();
  const escalations = [];
  let passes = 0;
  let stoppedBy = null;
  // When a pass drops a real candidate because the seat is inside its cooldown,
  // no commit may follow to trigger another pass. Record when that candidate
  // becomes eligible so the idle loop re-runs a pass then (the revisit gap).
  let cooldownRevisitAt = null;
  // Consecutive passes that dropped a wake via `wake-failed`; drives the retry
  // backoff below. Any pass that failed no wake resets it to 0.
  let consecutiveWakeFailures = 0;
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
      const reconciled = await reconcileBrokerStartup(harness, { dbPath, context, onDiagnostic, probeStorage });
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
      // A scheduled cooldown revisit is due: force the pass that re-wakes the seat
      // the earlier pass had to drop. Re-check `shouldRun` with the dirty bit set.
      if (cooldownRevisitAt !== null && now() >= cooldownRevisitAt) {
        cooldownRevisitAt = null;
        scheduler.markDirty();
        continue;
      }
      // F35/#2237: honor a `serve --stop` BEFORE anything that can force another pass. A
      // persistently-throwing pass with a pending intent re-marked the scheduler dirty every
      // turn, so the stop was only seen at the END of a pass — an operator saw `serve --stop`
      // return stopped:true (and clear broker.json) while the orphan kept looping. Checking
      // here makes the stop authoritative regardless of the inbox or an active backoff.
      if (dbPath && readStopRequest(dbPath) !== null) {
        clearStopRequest(dbPath);
        stoppedBy = "stop";
        break;
      }
      // A spooled operator intent must not wait for an unrelated commit: the
      // producer writes a file to `<db>.broker.inbox`, and only a PASS drains it
      // (drainIntentInbox runs at the start of a pass). Treat a non-empty inbox
      // like a wake-relevant change so the operator's intent is delivered promptly.
      // Safe from spinning: every file is either submitted and unlinked or
      // dead-lettered within the pass, so the inbox is empty again afterwards.
      //
      // #2321: a `read` is the one NON-mutating op, and `watch` polls it every ~750 ms.
      // Forcing a full wake/supervisor pass per poll made the operator's own window into the
      // team the thing that hammered the broker (~80 passes/min); those passes' probe reads
      // contend with the harness's own commits and drive the hot loop that takes the broker
      // down (#2237). Serve read-only intent HERE, in place, with the SAME drain a pass uses,
      // and do NOT mark dirty: a read changes nothing, so there is no wake to evaluate. Any
      // other op (a real message/pause/reset) still marks dirty and runs a full pass.
      if (dbPath && readIntentFiles(dbPath).length > 0) {
        if (onlyReadIntents(dbPath)) {
          try {
            await drainIntentInbox(harness, probeStorage, { dbPath, context, onDiagnostic, readStorage });
          } catch (err) {
            // A failed read drain must neither kill the idle loop nor spin it: fall back to a
            // real pass, which is where a storage failure is reported and retried with backoff.
            onDiagnostic({ kind: "read-drain-failed", error: String(err?.message ?? err) });
            scheduler.markDirty();
          }
          continue;
        }
        // #2237: a NON-read intent must not bypass the retry backoff. `shouldRun` only checks
        // the floor + the dirty bit, so marking dirty here ran a pass NOW even while a retry
        // was already scheduled — a persistently-throwing pass plus a pending intent hot-looped
        // at the floor cadence (the observed 0.5 s `WAKE-RETRY ... in=60000ms` lines, and 120
        // throwing passes in 1.2 s in the demo). While a failure backoff is active, WAIT for it:
        // the pass at the deadline drains the intent and the retry schedule is honoured — and
        // the wait yields the event loop, so a `.stop` written meanwhile is seen. With no failure
        // pending, mark dirty at once (prompt delivery).
        if (consecutiveWakeFailures > 0 && cooldownRevisitAt !== null && now() < cooldownRevisitAt) {
          await signal.wait(Math.max(1, cooldownRevisitAt - now()));
          continue;
        }
        scheduler.markDirty();
        continue;
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
      // Do not sleep past a scheduled cooldown revisit: the loop must wake to
      // mark itself dirty at the deadline even if no stop request or commit does.
      // Clamp to >= 1 so a deadline that raced past cannot produce a 0 (which
      // `signal.wait` would treat as an indefinite park).
      if (cooldownRevisitAt !== null) {
        const untilRevisit = Math.max(1, cooldownRevisitAt - now());
        waitMs = waitMs > 0 ? Math.min(waitMs, untilRevisit) : untilRevisit;
      }
      await signal.wait(waitMs);
      continue;
    }
    scheduler.beginPass(now());
    const passStartedAt = now();
    const wokeThisPass = [];
    const suppressedThisPass = new Set();
    // Seats whose wake failed THIS pass (distinct from the cumulative `failedSeats`,
    // which reports the whole run). Drives the retry schedule below.
    const failedThisPass = new Set();
    // A whole-pass throw (a store read OUTSIDE the per-seat wake path, e.g.
    // `documentState`/`inspect`/`readStoppedConvIds`) is real work the pass did not action
    // and emits no `wake-failed`, so the retry below must key on it too — otherwise a retry
    // pass that throws goes dormant again (recurrence 8, 2026-10-18).
    let passThrew = false;
    try {
      await drivePass(harness, probeStorage, {
        context,
        seatFilter: scheduler.seatFilter(now()),
        readBusySeats,
        readStorage,
        waitForWakes: false,
        dbPath,
        onDiagnostic,
        onError: (failure) => {
          failedSeats.add(failure.name);
          failedThisPass.add(failure.name);
          onDiagnostic({
            kind: "wake-failed",
            name: failure.name,
            conversationId: failure.conversationId,
            ...describeError(failure.error),
          });
        },
        onWoke: (name) => {
          scheduler.recordWakes([name], now());
          wokeThisPass.push(name);
          logBrokerLine(dbPath, `WAKE ${name}`);
        },
        onSuppressed: (name) => suppressedThisPass.add(name),
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
      // A cooldown-suppressed candidate is real work this pass did not action. No
      // further commit may arrive to run another pass, so schedule one for the
      // moment the earliest suppressed seat becomes eligible. `markDirty` in the
      // idle branch below turns that deadline into an actual pass. Recompute from
      // scratch each pass: a pass that suppresses nothing has nothing to revisit,
      // and a stale deadline would spin the idle loop.
      cooldownRevisitAt = null;
      if (suppressedThisPass.size > 0) {
        let soonestDelay = Infinity;
        for (const name of suppressedThisPass) {
          soonestDelay = Math.min(soonestDelay, scheduler.msUntilSeatReady(name, now()));
        }
        if (Number.isFinite(soonestDelay)) cooldownRevisitAt = now() + soonestDelay;
      }
    } catch (error) {
      // #1587 part 2: a per-conversation storage error inside the pass must NOT kill the
      // resident broker (the 17:29Z death). Log it WITH its nested cause and keep driving;
      // the loop's idle pacing keeps a persistent failure from becoming a hot spin.
      passThrew = true;
      const described = describeError(error);
      onDiagnostic({ kind: "pass-failed", ...described });
      // ROADMAP 78 / #2237: a throwing pass must be VISIBLE in `<db>.broker.log`, not only as a
      // later `WAKE-RETRY ... pass-threw` line — the log is the only post-mortem surface (D46),
      // and it could not answer "which pass threw, and why". Messages only, never a payload.
      logBrokerLine(
        dbPath,
        `PASS-FAILED ${described.error ?? "unknown"}${described.cause ? ` cause=${described.cause}` : ""}`,
      );
    } finally {
      scheduler.endPass();
    }
    // Post-pass scheduling runs even when THIS pass threw. A wake failure emitted before
    // an unrelated later throw (e.g. `superviseOnce` hitting the SAME storage error) must
    // still re-arm the loop: recurrence 7 (2026-10-18T17:57Z) reproduced exactly this — a
    // `wake-failed` for pm, then a pass that threw before reaching the scheduler, left the
    // broker parked with a fresh heartbeat and a frozen `PASS` for ~36 min.
    cooldownRevisitAt = null;
    if (suppressedThisPass.size > 0) {
      let soonestDelay = Infinity;
      for (const name of suppressedThisPass) {
        soonestDelay = Math.min(soonestDelay, scheduler.msUntilSeatReady(name, now()));
      }
      if (Number.isFinite(soonestDelay)) cooldownRevisitAt = now() + soonestDelay;
    }
    // A failed wake OR a thrown pass is real work this pass did NOT action, and — unlike a
    // cooldown-suppressed candidate — nothing else will re-arm the loop. Without this
    // scheduled retry the broker rests in `signal.wait` with the seat never driven.
    // `selectWakes` still sees the seat's queued work, so the retry needs no bookkeeping.
    // The backoff doubles per CONSECUTIVE unactioned pass and is capped, so a persistent
    // error stays legible without hot-looping; `wakeRetryMs <= 0` disables the retry,
    // reproducing the pre-fix shape a demo uses to prove the contrast.
    const unactionedFailure = failedThisPass.size > 0 || passThrew;
    consecutiveWakeFailures = unactionedFailure ? consecutiveWakeFailures + 1 : 0;
    if (unactionedFailure && wakeRetryMs > 0) {
      const backoff = Math.min(wakeRetryMs * 2 ** (consecutiveWakeFailures - 1), wakeRetryMaxMs);
      const retryAt = now() + backoff;
      cooldownRevisitAt = cooldownRevisitAt === null ? retryAt : Math.min(cooldownRevisitAt, retryAt);
      const names = failedThisPass.size > 0 ? [...failedThisPass].join(",") : "-";
      logBrokerLine(dbPath, `WAKE-RETRY in=${backoff}ms seats=${names}${passThrew ? " pass-threw" : ""}`);
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

/* ------------------------------ broker diagnostics ------------------------------ */
/**
 * A diagnostic-safe view of a failure, INCLUDING its nested cause chain (#1587 part 2).
 * The CAUSE is the only place a storage error names its real reason — `SessionFailed`
 * wraps the underlying failure, so logging only the outer message left the 17:29Z broker
 * death unexplained. Error MESSAGES only, never a payload (same discipline as #828/#700).
 */
function describeError(error) {
  const chain = [];
  for (let e = error, depth = 0; e && depth < 6; e = e.cause, depth++) {
    chain.push(`${e.name ?? "Error"}: ${e.message ?? String(e)}`);
  }
  return { error: chain[0] ?? null, cause: chain.length > 1 ? chain.slice(1).join(" <- ") : null };
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
