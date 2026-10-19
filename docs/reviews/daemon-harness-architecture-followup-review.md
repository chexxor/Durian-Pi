# Daemon-harness architecture — follow-up review (delegate, 2026-10-19)

**Why this exists.** The operator's research agent answered the 12-question follow-up. Raw report:
[`docs/research/daemon-harness-architecture-followup.md`](../research/daemon-harness-architecture-followup.md).
This note **consumes** it per `docs/runbooks/research-request.md`, grounded against the tree. It is
delegate analysis only; no product code, no queue item by itself.

## Method

- Read the report in full, including its explicit `[observed]` / `[advertised]` / `[inferred]` marks
  and its "what I could not verify" list.
- **Closed the report's own PARTIAL on Q3 with a local probe** (`.spike/delegate/sqlite-busy-probe.mjs`,
  not committed): two `node:sqlite` connections, `BEGIN IMMEDIATE` on one, a competing write on the
  other with `timeout: 0`, on this pinned Node (v24.19.0). Result: `code: ERR_SQLITE_ERROR`,
  `errcode: 5`, `errstr: "database is locked"`, and the error object exposes exactly
  `['stack','message','code','errcode','errstr']`.
- Checked each recommendation against the tree: `src/broker.mjs`, `src/genlock.mjs`,
  `node_modules/@earendil-works/pi-durable@1.3.0/src/storage/sqlite/node.ts`, ROADMAP 61–67.

## Verdicts

| Q | Report finding | Grounded disposition |
|---|---|---|
| 1 | OpenHands lock = mutex+timeout + length-marker, not a reclaimable lease | **Accept as reference only.** Different mechanism from `genlock.mjs`; adopt the length-marker/exact-count sync *only if* item 157 opens. `filelock` Windows semantics remain unverified (see second-round prompt). |
| 2 | ROADMAP 153 shape = per-workspace `Map<resourceKey, Mutex>`, key declared per tool, held per tool call | **Accept.** Refines 153: mutex (held until the call returns/cancels), not a per-file TTL lease; key is *declared by the tool*, not derived. Note the cited OpenHands race (a pending tool starting after cancellation while waiting on a resource lock) as a design hazard. |
| 3 | Residual `database is locked` is `SQLITE_BUSY_SNAPSHOT` or `-shm`/checkpoint races — structural, not timeout-tunable | **Partially accept, narrowed locally.** The extended code is **not** surfaced (we saw primary `errcode: 5`), and the `BUSY_SNAPSHOT` case is a **deferred-`BEGIN` upgrade** — which **cannot apply to pi-durable writes because it always uses `BEGIN IMMEDIATE`** (`node.ts:146`). So our residual is the *retryable* busy (competing writer past the 5 s timeout) or a `-shm` open/close race. Classification by `errcode` is now possible and recorded (item 159). |
| 4 | Conformance schema | **PARTIAL, accepted as-is.** The modes × maturity matrix (Direct/Native × Fully/Maintained/Community) feeds 155; the exact probe data shape was not retrieved (second-round prompt). |
| 5 | Per-record append vs SQLite | **Accept as contingency.** No published numbers at our scale; do **not** open 157 on throughput grounds. Reframed 157 as contingency. |
| 6 | Bounded shutdown: drain deadline → cancel stream/tool → **unconditional** force fallback | **Already captured** by ROADMAP 61/63/67 and the `#2420` bounded-grace ruling. Corroborates; no duplicate. Key borrowed wording: *the fallback must not depend on the same wedge it is escaping*. |
| 7 | One long-lived writer; readers short-lived, `readOnly`, never a read txn across a model call | **Accept, feeds `#2406`/D111.** pi-durable's node open path exposes no `readOnly`, which is *why* "serve reads through the broker's instance" (D111) is the right call. Recorded: a long-lived reader *can* pin the WAL. |
| 8 | Watchdog = counter-advance + per-pass deadline + content-repetition, three orthogonal legs | **Already captured** by ROADMAP 62 (liveness vs progress) plus the existing degeneration detector. Corroborates; no duplicate. |
| 9 | Outbox: one txn, `requestId` dedup via unique index, sequence ordering, TTL GC guarded by in-flight | **Largely already present.** The broker already uses the result ledger as the idempotency ledger and dedups by `requestId` (`src/broker.mjs:239-241,516-519`); the harness dedups by `(conversation, requestId)` (`:178-182`); result files are consumed (`5c946a1`). Residual: no TTL/poison-row GC found (item 160). |
| 10 | Windows stop-contract: explicit channel + down marker + `taskkill /T /F` + Job Objects | **Already captured** by ROADMAP 61 (down marker, two-phase stop) and 63/64 (Job Object, kill-tree). Corroborates; no duplicate. |
| 11 | Suite isolation: per-worker temp dir / DB path / ephemeral port / worktree | **Already routed** (`DURIG_SUITE_CONCURRENCY`). Corroborates the fixture-parameterization shape. |
| 12 | `Operations` seam enforces filesystem / credential / capability scopes; the tool is untrusted | **Accept.** Refines 156: the seam (parent) enforces the boundary, never the child tool. The concrete footgun: relocated processes inheriting host env/keys. |

## What changed in the backlog

- **155** — added the modes × maturity matrix as the rubric skeleton; noted Q4's exact probe schema is still to be retrieved.
- **157** — reframed as **contingency, not default** (Q5: no throughput evidence at our scale).
- **159 (new)** — classify the residual `database is locked` by `errcode` and record that `BUSY_SNAPSHOT` is structurally excluded by `BEGIN IMMEDIATE`; feeds `#2420`/`#2406` diagnosis.
- **160 (new)** — verify the broker spool has no stale/poison-row gap (TTL + in-flight guard), given the `requestId` ledger already provides idempotency.
- **156/153** — shape refined from Q2/Q12 (mutex-not-lease; seam-enforced scopes).

## Still unverified (→ second-round prompt)

Written to `docs/reviews/daemon-harness-architecture-followup-2-research-prompt.md`:
Omnigent's exact probe schema/rubric (Q4); `filelock`'s Windows locking semantics (Q1); whether
`immutable=1` is safe for a snapshot read (Q7); and a head-to-head append-throughput figure (Q5).
