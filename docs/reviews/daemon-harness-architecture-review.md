# Daemon-harness architecture review — consuming the research (delegate, 2026-10-19)

**Why this exists.** The operator asked the specialized research agent whether durian-pi's
architecture has a major design flaw we are overlooking, and pointed at the broker-lifecycle /
`database is locked` cluster as the subject. The raw report is
[`docs/research/how-to-design-an-llm-harness-which-apps-use-a-daemon.md`](../research/how-to-design-an-llm-harness-which-apps-use-a-daemon.md).
This note **consumes** it per `docs/runbooks/research-request.md`: it grounds every recommendation
against the tree, accepts or rejects each with a reason, registers the accepted ones in
`docs/ROADMAP.md`, and records the follow-up questions.

**This is delegate analysis, not product code, and it registers no queue item by itself** — the
ROADMAP items it registers are for `pm` to sequence. No seat work was done, no worktree touched.

**Method (read from the tree, not memory).**
- Report read in full: the landscape survey and the `database is locked` / `WAKE-RETRY` deep dive.
- Grounded against the **installed** upstream, not the report's cited public README:
  `node_modules/@earendil-works/pi-durable@1.3.0` (`package.json` declares `^1.0.4`; the pin D17/D108
  resolves to 1.3.0), and `src/broker.mjs` at HEAD (`12b0440`).
- Runtime probes: `node --version` (v24.19.0) and the bundled SQLite version.
- Commit history for the broker hot-loop cluster (`git log -- src/broker.mjs`).

---

## The one-line verdict

**The report's headline "root cause" is not a flaw in this repo.** Its three central claims — that
pi-durable lacks WAL/`busy_timeout`, that writes lack an in-process FIFO lock, and that model
inference is held inside a write transaction — are **already false at our pinned version**. Its
retry claim (the ~0.5 s `WAKE-RETRY … in=60000ms` spin) was a real bug but is **already fixed**
(#2237, landed `3021fe2`). The report was written against the public README and an older snapshot.

What survives is **not** a missing pragma but the **structural** point: one SQLite write lock carries
both document state and high-churn transcript/audit, and the only durable protection is the
single-writer discipline (D94/D111). That is worth one gated investigation item, not an emergency.
The report's *landscape* findings (resource-keyed locks, an SSE tap, a conformance bench, an
`Operations` extension seam) are useful and are registered.

---

## 1. Verification of the report's central claims

| # | Report claim (its "highest-leverage" list) | Grounded finding | Verdict |
|---|---|---|---|
| R1 | pi-durable's open path lacks `journal_mode=WAL`, `busy_timeout`, `synchronous` → `database is locked` | `openNodeSqliteDatabase` sets `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA wal_autocheckpoint`, and opens `new DatabaseSync(path, { timeout })` with `DEFAULT_BUSY_TIMEOUT_MS = 5000` — `node_modules/@earendil-works/pi-durable/src/storage/sqlite/node.ts:189-201` | **REJECT — already present** |
| R2 | Add an in-process FIFO lock tier so intra-process writes serialize before SQLite | `class SerialOperationQueue` (acquire/release with barrier, batch inside one operation) is the connection's access queue; every `run`/`runAsync`/`transaction` goes through it — `node.ts:29-78`, `:145-168` | **REJECT — already present** |
| R3 | Use `BEGIN IMMEDIATE` for known writes; prepare values before `BEGIN` | `transaction()` opens `this.database.exec("BEGIN IMMEDIATE")` and commits/rolls back inside the callback — `node.ts:146-166` | **REJECT — already present** |
| R4 | Verify SQLite ≥ 3.51.3 (WAL-reset race under writer+checkpoint) | Bundle reports **SQLite 3.53.3** (`node:sqlite`, Node v24.19.0) | **REJECT — satisfied** |
| R5 | Seats doing model inference while holding a write transaction is "the single most likely root cause" | pi-durable's generation state machine commits a short storage-only transaction, *then* streams: the `request` phase commits `live.generation` at `generation.ts:170-176`, and `await streamResponse(...)` at `:206` runs **outside** any transaction. The commit callbacks do storage ops only (`scanEntries`/`appendEntry`/`doc`) | **REJECT — not present in the generation path** |
| R6 | `WAKE-RETRY in=60000ms` lines ~500 ms apart = fixed-delay retry spinning, a second independent bug | Real bug, but **already fixed** by #2237 (`3021fe2`): bounded exponential backoff (`wakeRetryMs` 2 s doubling, capped `wakeRetryMaxMs` 60 s), the throwing path honours `.stop`, and `PASS-FAILED … cause=` is logged — `src/broker.mjs:1290-1301`, `:1263-1275` | **REJECT as new — already fixed; a narrow residual remains (item 158)** |
| R7 | Move the audit/transcript off the SQLite write lock to OpenHands' per-record-file + `.lock` append-only model | Not verified as *needed* here: D111 serves all reads from the broker's single pi-durable instance and the in-process contention read was moved to `harness.storage` (commit `8d48cb1`, `6140467`); `repair-pi-live.mjs` found no corruption (contention, not corruption) | **ACCEPT as a gated investigation (item 157), not a change** |

**Evidence discipline for the above:** all six grounds are `observed` by reading the installed file
or running a command in this tree; none rely on the report's cited README.

## 2. Design choice vs established practice

The report surveys three daemon topologies and three reference harnesses. The useful distinction it
flags, recorded here so it is not re-litigated:

- **We deliberately keep `broker-over-durable-store`** (spool writes → broker delivers; one broker
  owns the store; `serve --stop` cooperative reaping) rather than OpenCode's *log-as-queue* or
  Forge's *socket bridge*. The report agrees this is the stronger choice for crash-safety and
  multi-seat; it is a design choice, **not** drift from established practice. Affirmed, no item.
- **`genlock.mjs` is coarser than OpenHands' resource-keyed lock manager.** Our per-seat worktrees
  already give the isolation boundary; the refinement is to serialize only on resource collision.
  Accepted (item 153).

## 3. Accepted recommendations → registered in `docs/ROADMAP.md`

| ROADMAP | Move | Owner |
|---|---|---|
| 153 | Resource-keyed lock manager over `genlock.mjs` (serialize only on file/terminal collision) | impl |
| 154 | Broker event/SSE tap so any client drives the same run (ties the TUI Phase-2 attach work; see `docs/reviews/tui-attach-vs-poll.md`) | impl |
| 155 | Uniform harness conformance probe set (basic turn / tool / streaming / interrupt / model override / policy denial) over `demo/*.test.mjs` | qa · auditor |
| 156 | Formalize the extension seam as a Pi-style `Operations` interface (also closes per-seat tool scoping, ROADMAP 18) | devtools · impl |
| 157 | Gated investigation: move the audit/event trail off the SQLite write lock (per-record append + lock) — only if evidence still shows lock contention after D111/read-op fixes | lead · impl |
| 158 | Retry residual: jitter, retry idempotent work only, controlled overload error on budget exhaustion (extends #2237) | impl |

## 4. Rejected with reasons

- **Add WAL / `busy_timeout` / `synchronous` / `BEGIN IMMEDIATE` / an in-process FIFO lock / upgrade
  SQLite** — all already present at the pin (R1–R4). Adding them would be a no-op or a downgrade.
- **"Model inference inside the write transaction"** — not present in pi-durable's generation path
  (R5); acting on it would have meant a large refactor of code that is already correct.
- **"Replace fixed-delay retry with bounded backoff"** — already `#2237` (R6); only the residual
  (item 158) remains.
- **Immediately split transcripts to per-event files** — gated behind item 157's evidence, because
  the observed wedges were contention from second openers (fixed by D111 / `8d48cb1` / `6140467`),
  not transcript churn on the lock.

## 5. Follow-up questions left open

Written to `docs/reviews/daemon-harness-architecture-followup-research-prompt.md` for the operator to
route. Twelve questions in three clusters: the lock/scale details (OpenHands' `LocalFileStore.lock()`
and `FIFOLock` protocol, the resource-keyed lock manager, `node:sqlite` `database is locked` failure
signatures under WAL, the conformance-bench schema, per-record append vs SQLite at our scale); the
broker-lifecycle cluster (bounded graceful shutdown with a force fallback, a genuinely read-only second
connection, wedge-vs-slow-pass liveness, spool delivery semantics, Windows process lifecycle); and the
seam/scale cluster (suite concurrency/isolation, and the security model of the `Operations` seam).
**One question moved back in-house:** whether *durian-pi's own* `runtime.commit` callbacks ever do slow
or foreign work (pi-durable's generation path is verified clean; our code has not been audited for it).

## 6. What this means for the operator's question

**We are not overlooking a missing-pragma design flaw** — the substrate already carries the
canonical SQLite discipline, and the lock wedge we lived through was a *lifecycle/observability*
defect (#2237 fixed the spin; #2420 still owes the bounded stop) plus *second-opener* contention
(fixed by broker-served reads, D111), not a storage-architecture flaw. The genuine architectural
question the report raises — transcript churn sharing the one write lock — is real but unproven as a
cause here; it is registered as a gated investigation (item 157), not an emergency.
