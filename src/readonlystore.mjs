// src/readonlystore.mjs — a READ-ONLY reader for the rig store, with no harness and no
// ownership claim.
//
// WHY THIS EXISTS. pi-durable's `openNodeSqliteStorage` cannot open read-only: its
// `SqliteStorage.open()` migrates, and `document()` wraps every read in `BEGIN IMMEDIATE`
// (docs/runbooks/broker-down-or-stalled.md, ROADMAP 69/83). So a CLI verb that "just reads"
// while the broker is resident takes the broker's write lock — the contention that poisons a
// session (`SessionFailed`). When the broker cannot answer, the operator still needs the
// store's state, and the only open that cannot contend is `node:sqlite` with
// `readOnly: true`: it opens no harness, claims no ownership and issues no write.
// (Precedents already in the tree: src/fleethealth.mjs and src/notecensus.mjs read this way.)
//
// WHAT IT IMPLEMENTS. Exactly the four `Storage` methods the read views use —
// `findDocument`, `document`, `scanSubmissions`, `scanEntries` — so every read verb can run
// the SAME readapi functions over either path and the two cannot drift. The queries are
// transcribed from the vendor's own read path (dist/storage/sqlite/storage.js); the helpers
// `addressParts`/`scopeColumns`/`encodeIndexedString` are re-implemented here because the
// vendor does not export `rows.js` through its package `exports`, and `docs/../demo` pins
// the two paths agree on a real store.
//
// WHAT IT DOES NOT DO. It cannot write, migrate, or materialise a document at a historical
// `at` (a read-only open has no transaction to keep base+revisions atomic; a snapshot taken
// across two statements can be one commit fresh or one commit stale — acceptable for an
// operator read, and it is labelled as such by the caller).

import { DatabaseSync } from "node:sqlite";
import { apply } from "@earendil-works/chord/delta";

const TABLES = {
  documents: "documents",
  documentRevisions: "document_revisions",
  submissions: "submissions",
  entries: "entries",
  conversations: "conversations",
};

const parseJson = (value) => JSON.parse(value);
// The vendor stores indexed string columns as JSON (lossless for lone UTF-16 surrogates).
const encodeIndexedString = (value) => JSON.stringify(value);

const scopeColumns = (scope) => {
  switch (scope.kind) {
    case "session":
      return { scopeKind: "session", ownerId: 0 };
    case "conversation":
      return { scopeKind: "conversation", ownerId: scope.conversationId };
    case "task":
      return { scopeKind: "task", ownerId: scope.taskId };
    default:
      throw new Error(`readonlystore: unknown scope kind ${scope?.kind}`);
  }
};

const addressParts = (address) => {
  const scope = scopeColumns(address.scope);
  return {
    kind: encodeIndexedString(address.kind),
    ...scope,
    family: address.key === undefined ? 0 : 1,
    keyValue: encodeIndexedString(address.key ?? ""),
  };
};

const page = (values, limit, order) => {
  const items = values.slice(0, limit);
  if (values.length <= limit) return { items };
  return { items, next: { after: items.at(-1)?.id, order } };
};

const isAliveAt = (record, at) => {
  if (at === "current") return record.retiredAt === undefined;
  return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
};

/**
 * Open the store read-only. Throws if the file cannot be opened (missing store, locked store);
 * callers fall back and REPORT which path served the read.
 */
export function openReadOnlyStore(dbPath) {
  // `timeout` is SQLite's busy timeout. A read-only connection does not take the write lock, but it still
  // needs the WAL index, and a concurrent CHECKPOINT can hold it: with the default 0 an ordinary status read
  // fails instantly and pushes the caller onto the write-mode fallback - which is the very second-writer
  // collision this path exists to avoid (see src/readclient.mjs `readLocal`).
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 30_000 });
  const stmtCache = new Map();
  const stmt = (sql) => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
    return stmtCache.get(sql);
  };

  const readConversation = (id) => {
    const row = stmt(`SELECT record FROM ${TABLES.conversations} WHERE id = ?`).get(id);
    if (row === undefined) return undefined;
    return parseJson(row.record);
  };

  /** Oldest first: the fork chain's segments from the root conversation forward, each up to its fork point. */
  function scanEntriesAscending(query, limit, after, conversation) {
    const segments = [];
    let current = conversation;
    let upper = query.maxEntryId;
    while (true) {
      segments.push({ conversationId: current.id, upper });
      if (current.parent === undefined) break;
      upper = upper === undefined ? current.parent.at : Math.min(upper, current.parent.at);
      if (query.minEntryId !== undefined && upper < query.minEntryId) break;
      const parent = readConversation(current.parent.conversationId);
      if (parent === undefined) break;
      current = parent;
    }
    let lower = query.minEntryId;
    if (after !== undefined) lower = Math.max(lower ?? after + 1, after + 1);
    const values = [];
    for (const segment of segments.reverse()) {
      const clauses = ["conversation_id = ?"];
      const params = [segment.conversationId];
      if (lower !== undefined) {
        clauses.push("id >= ?");
        params.push(lower);
      }
      if (segment.upper !== undefined) {
        clauses.push("id <= ?");
        params.push(segment.upper);
      }
      params.push(limit + 1 - values.length);
      const rows = stmt(
        `SELECT record FROM ${TABLES.entries} WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`,
      ).all(...params);
      values.push(...rows.map((r) => parseJson(r.record)));
      if (values.length > limit) break;
    }
    return page(values, limit, "ascending");
  }

  return {
    // Mark the shim so a report line can say "read-only node:sqlite" rather than "pi-durable".
    readOnly: true,

    findDocument(address, at = "current") {
      const parts = addressParts(address);
      const params = [parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue];
      let where = "kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?";
      if (at === "current") where += " AND retired_at IS NULL";
      else {
        where += " AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)";
        params.push(at, at);
      }
      const row = stmt(`SELECT record FROM ${TABLES.documents} WHERE ${where} ORDER BY created_at DESC LIMIT 1`).get(...params);
      return row === undefined ? undefined : parseJson(row.record);
    },

    document(id, at = "current") {
      const row = stmt(`SELECT record FROM ${TABLES.documents} WHERE id = ?`).get(id);
      if (row === undefined) return undefined;
      const record = parseJson(row.record);
      if (!isAliveAt(record, at)) return undefined;
      const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
      const base = stmt(
        `SELECT seq, kind, version, content FROM ${TABLES.documentRevisions}
         WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`,
      ).get(id, upper);
      if (base === undefined) throw new Error(`Document ${id} is missing a required base`);
      let value = parseJson(base.content);
      const tail = stmt(
        `SELECT seq, kind, version, content FROM ${TABLES.documentRevisions}
         WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`,
      ).all(id, base.seq, upper);
      for (const revision of tail) {
        if (revision.kind !== "delta" || revision.version !== base.version) {
          throw new Error(`Document ${id} crosses a stored version boundary without a base`);
        }
        value = apply(value, parseJson(revision.content));
      }
      return { record, version: base.version, value, deltasSinceBase: tail.length };
    },

    // Mirrors the vendor's scan order semantics exactly (dist/storage/sqlite/storage.js,
    // `scanSql` + `page`): ascending starts after the cursor, descending starts before it.
    scanSubmissions(query, limit = 20, cursor = undefined) {
      const ascending = query.order !== "descending";
      const clauses = [ascending ? "id > ?" : "id < ?"];
      const params = [ascending ? (cursor?.after ?? -1) : (cursor?.after ?? Number.MAX_SAFE_INTEGER)];
      if (query.conversationId !== undefined) {
        clauses.push("conversation_id = ?");
        params.push(query.conversationId);
      }
      if (query.status !== undefined) {
        clauses.push("status = ?");
        params.push(query.status);
      }
      params.push(limit + 1);
      const rows = stmt(
        `SELECT record FROM ${TABLES.submissions} WHERE ${clauses.join(" AND ")} ORDER BY id ${ascending ? "ASC" : "DESC"} LIMIT ?`,
      ).all(...params);
      return page(rows.map((r) => parseJson(r.record)), limit, ascending ? "ascending" : "descending");
    },

    /**
     * Entry reads, in the SAME two orders the vendor implements (`readEntries` and
     * `readEntriesAscending`), because `log --follow` asks for ascending and the backfill asks
     * for descending. Getting the order wrong is not cosmetic: a follow poll that returns rows
     * newest-first skips every entry between polls (found live: the second operator message never
     * appeared in `log --follow`). Both orders walk the fork chain so a resumed seat's history is
     * not silently truncated.
     */
    scanEntries(query, limit = 20, cursor = undefined) {
      const conversation = readConversation(query.conversationId);
      if (query.order === "ascending") return scanEntriesAscending(query, limit, cursor?.after, conversation);
      // Descending walk: read this conversation, then step to the parent conversation's oldest
      // visible entry, so a resumed seat's history is not silently truncated.
      let current = conversation;
      let upper = query.maxEntryId;
      if (cursor?.after !== undefined) upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, cursor.after - 1);
      const values = [];
      while (true) {
        const clauses = ["conversation_id = ?"];
        const params = [current.id];
        if (query.minEntryId !== undefined) {
          clauses.push("id >= ?");
          params.push(query.minEntryId);
        }
        if (upper !== undefined) {
          clauses.push("id <= ?");
          params.push(upper);
        }
        params.push(limit + 1 - values.length);
        const rows = stmt(
          `SELECT record FROM ${TABLES.entries} WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`,
        ).all(...params);
        values.push(...rows.map((r) => parseJson(r.record)));
        if (values.length > limit || current.parent === undefined) break;
        upper = upper === undefined ? current.parent.at : Math.min(upper, current.parent.at);
        if (query.minEntryId !== undefined && upper < query.minEntryId) break;
        const parent = readConversation(current.parent.conversationId);
        if (parent === undefined) break;
        current = parent;
      }
      return page(values, limit, "descending");
    },

    close() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
