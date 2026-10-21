# Store probe identity — an id is not a key across namespaces

**Symptom index:** you are querying `selfdev.sqlite` directly to answer a question about a QUEUE item
(`#1234`), and you are about to write `WHERE id = 1234` — or you already did, and the answer looked
plausible but was about something else.

## What goes wrong

The store holds SEVERAL id spaces in one file, and a bare integer matches more than one of them:

| table | what its `id` means | carries queue fields? |
|---|---|---|
| `tasks` | a HARNESS task (a run) | NO — `(id, conversationId, kind, version, input, background, abortRequested, state, startedAt, endedAt)` |
| `entries` | a durable log entry | NO — `(id, conversation_id, head, commit_seq, record)` |
| `documents` | a durable document | only under the queue document's own record |
| `conversations` | a conversation | NO |

So `SELECT * FROM tasks WHERE id IN (2993,3556,3581,3601)` returns **two of four rows**, both real, both
`status=terminal` HARNESS tasks — and a reader who does not check the column set reports on the wrong
records with full confidence. That is worse than an empty result: an empty result says "not here", a wrong
row says "here it is".

There is **no `items` table**, and `deferredTo` is **not a column** anywhere. But the queue is NOT a plain
JSON record in `documents` either ? a prober who looks for `items` in `documents` finds nothing and wrongly
concludes "not in this store" (that happened: #4334 and #4347).

## Where the queue's items ACTUALLY are

| what | where | carries `items`? |
|---|---|---|
| the queue DOCUMENT row | `documents` id=**29**, `kind`=`"durig.queue"`, `scope_kind`=`session` | **NO** ? metadata only: `id, kind, scope, createdAt` |
| the queue's CONTENT | `document_revisions` where `document_id`=**29** | **YES, but DELTA-ENCODED** |

`document_revisions` columns are `(document_id, seq, kind, version, content)`. The queue's revisions are
`kind`=`delta` and `content` is a PATCH, not a snapshot ? its top-level keys are array indices, so
`JSON.parse(content).items` is `undefined` even on a revision whose TEXT contains `"items"`. A prober who
parses one revision and looks for `.items` finds nothing and concludes the field does not exist.

So: `deferredTo` is written into the queue's durable document by `defer_work` (`src/rig.mjs` ?
`item.deferredTo = args.to ?? DEFERRED_TO_NOBODY` since #4405), stored as delta-encoded revisions under
`document_id` 29, and readable through the RIG rather than through SQL. **Prefer `node cli.mjs status`;**
treat a direct SQL probe as a last resort that cannot see a delta.
by `defer_work` (`src/rig.mjs` — `item.deferredTo = args.to ?? DEFERRED_TO_HUMAN`), NOT into a column.

## Two more traps in the same file

- **`kind` values carry EMBEDDED QUOTES.** The stored value is `"durig.queue"`, quotes included, so
  `WHERE kind = 'durig.queue'` returns NOTHING while `WHERE kind LIKE '%durig.queue%'` finds it. An
  equality miss reads as "the document does not exist".
- **`LIKE '%"id":2993%'` matches `"id":29930`.** Substring matching on JSON ids silently returns the wrong
  rows. Anchor the match (`"id":2993,` / `"id":2993}`) or parse the JSON and compare the parsed number.

## Procedure

1. **Decide which namespace you mean before you query.** A queue item id is NOT a task id, even when both
   are small integers and both exist.
2. **Read `PRAGMA table_info(<table>)` first** and check the column set matches the namespace you think you
   are in. If `deferredTo`/`subject`/`to` are absent, it is not the queue.
3. **For queue questions, do NOT expect `items` in `documents`.** `documents` id=29 holds the queue's
   METADATA; its `items` live in `document_revisions` as DELTA content. Use the rig's own reader
   (`node cli.mjs status`) unless you specifically need the raw revisions.
4. **Prefer the broker-served read** (`node cli.mjs status`, `queue`) over opening the store at all — it is
   the authoritative view and it already knows the namespaces. Use a direct store read only when the CLI
   cannot answer, and open it **read-only**.
5. **State the namespace in the finding.** "no `deferredTo` column in `tasks`" and "no deferral recorded
   for queue item #3556" are different claims, and only the second answers a queue question.

## Verify

Run this from the SHARED ROOT (a worktree has no `selfdev.sqlite`):

```
node --experimental-sqlite -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('selfdev.sqlite',{readOnly:true});console.log(db.prepare('PRAGMA table_info(tasks)').all().map(c=>c.name).join(','));db.close()"
```

Expect `id,conversation_id,kind,status,abort_requested,background,record` — **no `deferredTo`**. If a probe
of yours reported a queue field from this table, it read the wrong namespace.

Then confirm the queue document is found only by the `LIKE` form, which is the embedded-quote trap. Put
this in a `.cjs` file rather than `node -e` (PowerShell mangles the nested quotes):

```
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("selfdev.sqlite", { readOnly: true });
const eq = db.prepare("SELECT COUNT(*) n FROM documents WHERE kind='durig.queue'").get().n;
const lk = db.prepare("SELECT COUNT(*) n FROM documents WHERE kind LIKE '%durig.queue%'").get().n;
console.log(`equality: ${eq} | LIKE: ${lk}`);
db.close();
```

```
node --experimental-sqlite ./probe.cjs
```

Expect `equality: 0 | LIKE: 1` — measured on this store. A non-zero equality count means the storage format
changed and this runbook's table needs updating.

## Related

- `store-corruption-recovery.md` — the store is unreadable or a write failed.
- `store-secret-detected.md` — a probe surfaced a secret.
