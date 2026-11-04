// src/readclient.mjs — the CLIENT half of broker-served reads.
//
// Why this exists. pi-durable allows ONE owner per process; the broker is durig's
// owner. A CLI verb that opens the store itself is a second owner, and because
// `SqliteStorage.document()` takes `BEGIN IMMEDIATE` for a read, that second owner
// contends with the broker's write lock and can poison its session
// (`SessionFailed`). The library's own model is "one owner, many clients"; this
// module makes a read verb a CLIENT of the running broker through the command
// spool: the verb writes a `read` request, the broker answers with its own storage,
// and the verb reads the recorded result. Only when NO broker is alive does the
// caller fall back to opening the store directly (it is then the sole owner).

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { NO_STORE_CAUSE } from "./causes.mjs";
import { awaitIntentResult, brokerAlive, intentResultDir, readBrokerState, writeIntent } from "./broker.mjs";

/** Is a live broker driving `dbPath`? The read verbs branch on this. */
export function brokerAliveFor(dbPath) {
  return brokerAlive(readBrokerState(dbPath));
}

/**
 * Ask the running broker for a read view and return its payload. The request is
 * spooled (a FILE; no store open) and its outcome read from the result channel, so
 * this process never touches the database the broker owns.
 *
 * `timeoutMs` must exceed the broker's idle re-check cadence (~1 s) with margin for
 * a busy pass; 120 s matches the other spool producers and still fails loudly rather
 * than hanging a CLI forever.
 */
export async function readViaBroker(dbPath, view, params = {}, { timeoutMs = 120_000 } = {}) {
  const requestId = randomUUID();
  writeIntent(dbPath, {
    op: "read",
    view,
    ...params,
    from: "cli",
    requestId,
    createdAt: new Date().toISOString(),
  });
  const awaited = await awaitIntentResult(dbPath, requestId, { timeoutMs });
  // The result channel is the spool's IDEMPOTENCY LEDGER for mutating ops. A read is
  // non-mutating and every call mints a fresh requestId, so the client consumes its own
  // result here: a `watch`/`ui.mjs` poll would otherwise leave a fresh result file every
  // ~750 ms (the `health` view is multi-MB), growing `<db>.broker.inbox.out/` without
  // bound. `force: true` tolerates a result that was never written (a timeout).
  rmSync(join(intentResultDir(dbPath), `${requestId}.json`), { force: true });
  if (!awaited.ok) throw new Error(`read ${view}: ${awaited.reason}`);
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

/** The direct-storage path: open the store, run `fn(storage)`, close it. Used ONLY
 * when no broker is alive, so the caller is the sole owner and the close checkpoint
 * contends with no one. A missing store REFUSES (`assertStoreReadable`) rather than
 * being created: this is the seam every CLI read verb runs through. */
export async function readLocal(dbPath, fn) {
  assertStoreReadable(dbPath);
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
 * One read, routed to the broker when one is alive and to the store otherwise.
 * `view`/`params` are the broker request; `fn` computes the SAME payload locally so
 * the two paths cannot drift (both call the same readapi functions).
 */
export async function readData(dbPath, view, params, fn, opts = {}) {
  if (brokerAliveFor(dbPath)) return await readViaBroker(dbPath, view, params, opts);
  return await readLocal(dbPath, fn);
}
