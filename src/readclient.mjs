// src/readclient.mjs — the CLIENT half of broker-served reads.
//
// Why this exists. pi-durable allows ONE owner per process; the broker is durig's owner. A CLI
// verb that opens the store itself is a second owner, and because
// `SqliteStorage.document()` takes `BEGIN IMMEDIATE` for a read, that second owner contends with
// the broker's write lock and can poison its session (`SessionFailed`). The library's own model is
// "one owner, many clients"; this module makes a read verb a CLIENT of the running broker through
// the command spool: the verb writes a `read` request, the broker answers with its own storage,
// and the verb reads the recorded result. Only when NO broker is alive does the caller fall back to
// opening the store directly (it is then the sole owner).
//
// THE BOUND (this goal, #314 / #2321 / #6160). A wait with no end is a wait the operator cannot
// escape, so every leg here is bounded and every failure is NAMED:
//   LIVENESS  — is a broker resident at all? (heartbeat + pid)
//   PROGRESS  — has it completed a pass recently? (`lastPassAt`; brokerHealth)
//   ANSWER    — did it reply to THIS request within the bound?
// A resident-but-degraded broker gets a SHORT bound (10 s), not 120 s, and the failure names the
// cause and the remedy instead of printing nothing for two minutes.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { openReadOnlyStore } from "./readonlystore.mjs";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { NO_STORE_CAUSE } from "./causes.mjs";
import {
  awaitIntentResult,
  brokerAlive,
  brokerHealth,
  intentResultDir,
  pidAlive,
  readBrokerState,
  writeIntent,
} from "./broker.mjs";
import { isStopping, stopSignal } from "./signals.mjs";

/** The bound for a broker that is RESIDENT and ADVANCING: a real pass can take minutes, so a
 * healthy broker keeps the long bound. (This is the value the verb used before the bound existed.) */
export const BROKER_READ_TIMEOUT_MS = 120_000;
/** The bound for a broker that is resident but NOT progressing (fresh heartbeat, frozen PASS).
 * If it has not answered within this, it is not going to. */
export const DEGRADED_READ_TIMEOUT_MS = 10_000;

let LOCAL_READS = false;

/** `--local`: answer reads from the store directly, bypassing the broker. Set once at CLI startup. */
export function setLocalReads(on) {
  LOCAL_READS = Boolean(on);
}
export function localReadsEnabled() {
  return LOCAL_READS;
}

/** Is a live broker driving `dbPath`? The read verbs branch on this. */
export function brokerAliveFor(dbPath) {
  return brokerAlive(readBrokerState(dbPath));
}

/**
 * Which generation leases are LIVE right now (`<db>.genlock.N` whose holder pid still exists).
 *
 * WHY THIS GATES THE FALLBACK: a seat mid-generation is a live WRITER in the broker process. A
 * second owner opening the store while that writer is committing is exactly the contention that
 * poisons a pi-durable session. With no live lease the direct read is a bounded, low-risk escape
 * hatch; with one it is not, and the verb says so rather than gambling.
 */
export function liveGenerationLeases(dbPath) {
  const dir = resolve(dbPath).replace(/[^/]*$/, "");
  const prefix = basename(resolve(dbPath)) + ".genlock.";
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(dir, name);
    try {
      const holder = JSON.parse(readFileSync(path, "utf8"));
      if (holder && pidAlive(holder.pid)) out.push({ path, pid: holder.pid, seat: holder.seat ?? null });
    } catch {
      /* a malformed lease is not a live writer; the broker's reconcile pass cleans it */
    }
  }
  return out;
}

/** A structured read failure: `code`, `view`, `path`, `detail`, `remedy` — so a caller branches on
 * the CAUSE rather than the wording, and the operator is told what to run next. */
export function readFailure(view, detail, { path = "broker", remedy = "", cause = "broker_read_timeout" } = {}) {
  const err = new Error(`read ${view}: ${detail}`);
  err.code = cause;
  err.view = view;
  err.readPath = path;
  err.remedy = remedy;
  return err;
}

/**
 * Ask the running broker for a read view and return its payload. The request is spooled (a FILE;
 * no store open) and its outcome read from the result channel, so this process never touches the
 * database the broker owns.
 *
 * `signal` is the process-wide AbortController from src/signals.mjs: Ctrl-C returns here in one
 * poll (200 ms) rather than running out the bound. On any failure the CLIENT unlinks its own
 * intent file, so an abandoned read does not litter `<db>.broker.inbox` for the next drain.
 */
export async function readViaBroker(
  dbPath,
  view,
  params = {},
  { timeoutMs = BROKER_READ_TIMEOUT_MS, signal = stopSignal() } = {},
) {
  const requestId = randomUUID();
  const intentPath = writeIntent(dbPath, {
    op: "read",
    view,
    ...params,
    from: "cli",
    requestId,
    createdAt: new Date().toISOString(),
  });
  const awaited = await awaitIntentResult(dbPath, requestId, { timeoutMs, signal });
  // The result channel is the spool's IDEMPOTENCY LEDGER for mutating ops. A read is
  // non-mutating and every call mints a fresh requestId, so the client consumes its own
  // result here: a `watch`/`ui.mjs` poll would otherwise leave a fresh result file every
  // ~750 ms (the `health` view is multi-MB), growing `<db>.broker.inbox.out/` without bound.
  // `force: true` tolerates a result that was never written (a timeout).
  rmSync(join(intentResultDir(dbPath), `${requestId}.json`), { force: true });
  if (!awaited.ok) {
    // Clean up OUR intent: a read nobody is waiting for is garbage in the spool, and garbage
    // in the spool is what makes `onlyReadIntents` true for a drain that has nothing to do.
    rmSync(intentPath, { force: true });
    throw readFailure(view, awaited.reason, {
      path: "broker",
      cause: isStopping() ? "interrupted" : "broker_read_timeout",
      remedy:
        "The broker did not answer. Check `node cli.mjs status --local` for the store's own state, " +
        "or restart the broker: `node cli.mjs serve --stop` then `node cli.mjs serve`. " +
        "Runbook: docs/runbooks/broker-down-or-stalled.md",
    });
  }
  const record = awaited.result;
  if (record && record.ok === false) throw new Error(`read ${view}: ${record.error ?? "broker read failed"}`);
  return record.result;
}

/**
 * The gate every read site passes through: is there a store at this path to read at all? (#4955)
 *
 * WHY IT EXISTS. The engine CANNOT open read-only. `@earendil-works/pi-durable`'s
 * `openNodeSqliteDatabase` (dist/storage/sqlite/node.js) does `mkdir(dirname(path), {recursive: true})`
 * then `new DatabaseSync(path, {timeout})`, and `NodeSqliteDatabaseOptions` offers only
 * `walAutocheckpointPages`/`busyTimeoutMs` — no read-only mode, no create-disabling flag. `SqliteStorage.open`
 * then migrates. So an ordinary READ at a wrong path produced a real 118,784 B store and answered
 * `ok: true, seats: []`: the instrument manufactured its own subject and then reported it healthy
 * (`tools/rig-portability-audit.mjs` #4923 read "0 seat roots" from a file it had just made). Creation is
 * a property of the WRITE path; a read verb must refuse instead, naming the path it was pointed at.
 *
 * The error is structured (`code`, `db`) so surfaces render a cause and a field rather than matching prose.
 */
export function assertStoreReadable(dbPath) {
  if (existsSync(dbPath)) return dbPath;
  const abs = resolve(dbPath);
  const err = new Error(
    `no store at ${abs} - reading does not create one. ` +
      "pi-durable's open mkdirs the parent and creates the file, so durian-pi refuses before opening. " +
      "Create the rig with `node cli.mjs up <rig.json>`, or point DURIG_DB at the store you meant.",
  );
  err.code = NO_STORE_CAUSE;
  err.db = abs;
  throw err;
}

/** The direct-storage path: open the store, run `fn(storage)`, close it. Used ONLY when no broker
 * is alive (or when the operator asked for it with `--local`), so the caller is the sole owner and
 * the close checkpoint contends with no one. A missing store REFUSES (`assertStoreReadable`) rather
 * than being created: this is the seam every CLI read verb runs through. */
export async function readLocal(dbPath, fn) {
  assertStoreReadable(dbPath);
  // FIRST CHOICE: the read-only open. It claims no ownership, runs no migration and issues no
  // `BEGIN IMMEDIATE`, so it is the only direct read that is safe while a broker is resident.
  try {
    const ro = openReadOnlyStore(dbPath);
    try {
      return await fn(ro);
    } finally {
      ro.close();
    }
  } catch (err) {
    // A readable-but-locked store, or a view the shim does not implement. Falling back to the
    // pi-durable open means taking the write lock — refused while a seat is mid-generation, and
    // that refusal is reported by name rather than silently attempted.
    if (brokerAliveFor(dbPath) && liveGenerationLeases(dbPath).length > 0) {
      throw readFailure(
        "local",
        `direct read could not be served read-only (${String(err?.message ?? err)}) and a seat holds a live generation lease, so opening the store in write mode is not safe`,
        { path: "local-readonly", cause: "local_read_blocked" },
      );
    }
  }
  let storage;
  try {
    storage = await openNodeSqliteStorage(dbPath);
  } catch (err) {
    throw new Error(`cannot open ${dbPath}: ${String(err?.message ?? err)}`);
  }
  try {
    return await fn(storage);
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

/**
 * One read, routed to the broker when one is alive and to the store otherwise. `view`/`params` are
 * the broker request; `fn` computes the SAME payload locally so the two paths cannot drift (both
 * call the same readapi functions).
 *
 * The decision tree, in order:
 *   1. `--local` (or opts.local)        -> read the store directly. The operator asked for it.
 *   2. a broker is resident             -> ask it, bounded by HEALTH: 120 s while advancing,
 *                                         10 s while it is alive-but-not-progressing.
 *   3. the broker did not answer        -> fall back to the store ONLY if no seat holds a live
 *                                         generation lease (no second writer while one is writing);
 *                                         otherwise fail with the named cause and the remedy.
 * Every path prints, on stderr, which one served the read — an instrument that does not say how it
 * got its number is indistinguishable from one that invented it.
 */
export async function readData(dbPath, view, params, fn, opts = {}) {
  if (opts.local || LOCAL_READS) {
    if (brokerAliveFor(dbPath)) {
      const leases = liveGenerationLeases(dbPath);
      console.error(
        `note: --local read ${view} from the store directly while broker pid ${readBrokerState(dbPath)?.pid} is resident` +
          (leases.length ? `; ${leases.length} generation lease(s) live (${leases.map((l) => l.seat ?? l.pid).join(", ")})` : ""),
      );
    }
    return await readLocal(dbPath, fn);
  }

  const state = readBrokerState(dbPath);
  if (!brokerAlive(state)) return await readLocal(dbPath, fn);

  const health = brokerHealth(state, { streamTimeoutMs: opts.streamTimeoutMs });
  const timeoutMs = opts.timeoutMs ?? (health.state === "up" ? BROKER_READ_TIMEOUT_MS : DEGRADED_READ_TIMEOUT_MS);
  try {
    return await readViaBroker(dbPath, view, params, { timeoutMs, signal: opts.signal ?? stopSignal() });
  } catch (err) {
    if (isStopping()) throw err; // the operator pressed Ctrl-C; the CLI exits 130, not a fallback
    const leases = liveGenerationLeases(dbPath);
    if (leases.length === 0) {
      console.error(
        `note: read ${view} served directly from the store - the broker (pid ${state.pid}) did not answer ` +
          `within ${timeoutMs} ms (heartbeat ${health.hbAgeMs ?? "?"} ms old, last pass ${health.passAgeMs ?? "never"} ms old)`,
      );
      return await readLocal(dbPath, fn);
    }
    throw readFailure(view, `${err?.message ?? err} (broker pid ${state.pid} is resident and ${leases.length} seat(s) hold live generation leases, so a direct read is not safe)`, {
      path: "broker",
      cause: health.state === "degraded" ? "broker_degraded" : "broker_read_timeout",
      remedy:
        "Wait for the seat to finish, or stop the broker and read directly: " +
        "`node cli.mjs serve --stop` then `node cli.mjs status --local`. " +
        "Runbook: docs/runbooks/broker-down-or-stalled.md",
    });
  }
}
