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
import { randomUUID } from "node:crypto";
import { awaitIntentResult, brokerAlive, readBrokerState, writeIntent } from "./broker.mjs";

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
  if (!awaited.ok) throw new Error(`read ${view}: ${awaited.reason}`);
  const record = awaited.result;
  if (record && record.ok === false) throw new Error(`read ${view}: ${record.error ?? "broker read failed"}`);
  return record.result;
}

/** The direct-storage path: open the store, run `fn(storage)`, close it. Used ONLY
 * when no broker is alive, so the caller is the sole owner and the close checkpoint
 * contends with no one. */
export async function readLocal(dbPath, fn) {
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
