# Follow-up research prompt — daemon-harness architecture (2026-10-19)

**Context.** Our specialized research agent produced
`docs/research/how-to-design-an-llm-harness-which-apps-use-a-daemon.md` (a survey of daemon-based
LLM harnesses plus a `database is locked` deep dive). The delegate consumed it in
`docs/reviews/daemon-harness-architecture-review.md` and **rejected its head-line root cause**: at
our pinned `@earendil-works/pi-durable@1.3.0`, the storage open path already sets
`journal_mode=WAL`, `synchronous=NORMAL`, `wal_autocheckpoint`, a 5,000 ms busy timeout, and
`BEGIN IMMEDIATE`, with an in-process `SerialOperationQueue`; the bundled SQLite is 3.53.3; and
pi-durable's generation path calls the model outside any write transaction. Those claims were
written against the public README and an older snapshot.

The accepted refinements are registered as ROADMAP 153–158. The questions below are the details we
**cannot apply without more evidence**. Written per `docs/runbooks/research-request.md`.

## Questions

1. **OpenHands' lock protocol, exactly.** For `openhands/sdk/io/local.py` (`LocalFileStore.lock()`
   and the `FIFOLock`), give the concrete on-disk layout and protocol: the lock file name, the
   acquisition/`timeout`/renewal semantics, how a stale lock from a dead process is detected and
   reclaimed, how the two tiers (in-process vs cross-process) interact, and how an append
   "synchronizes against on-disk state" after taking the lock. We want enough to decide whether it
   maps onto `src/genlock.mjs` or is a different mechanism entirely.

2. **OpenHands' resource-keyed lock manager.** The exact keying of a tool's declared resources
   (file/terminal/browser), how two calls are decided to conflict, and the scope/lifetime of a
   resource lock relative to `step()`. A short comparison to a per-file lease would let us decide
   ROADMAP 153's shape.

3. **`BEGIN IMMEDIATE` + busy-timeout failure mode under WAL.** With WAL + a 5,000 ms busy timeout on
   every connection, what *other* condition besides a competing writer yields a non-retryable
   `database is locked` in Node's `node:sqlite` (`DatabaseSync`)? Specifically: a long-lived reader
   pinning the WAL, a checkpoint starvation, or a `SQLITE_BUSY_SNAPSHOT` upgrade failure. We need the
   failure signatures (error `code`/`errno`) to classify our residual `SessionFailed … cause=Error:
   database is locked` instead of guessing.

4. **Conformance-bench schema.** For Omnigent's harness probes (basic turns, tool calling, streaming,
   interrupts, model override, policy denial), give the probe data shape and pass/fail rubric — enough
   to design ROADMAP 155's uniform probe set, including how "interrupt" and "policy denial" are
   asserted deterministically.

5. **Per-record append vs one SQLite file, at our scale.** For a single-writer broker with a few
   thousand events/minute, is OpenHands' one-JSON-file-per-event + `.lock` model materially better
   than WAL SQLite, or does it trade a lock problem for an inode/fsync/latency problem? Any published
   numbers on append throughput and recovery time would decide whether ROADMAP 157 is worth opening.

### The broker-lifecycle cluster (informs `#2420`, `#2406`, ROADMAP 61–64)

6. **Bounded graceful shutdown with an unconditional force fallback.** How do the reference daemons
   (OpenCode's server, OpenHands' Agent Server, Forge under PM2/systemd) terminate a *wedged* run: how
   they bound the drain, what they cancel (stream vs tool call vs commit), and when they escalate to
   `SIGKILL`/`TerminateProcess`. Give the concrete deadline/escape pattern. This is the design behind
   our owed `#2420` (the broker currently waits `harness.waitForIdle()` unbounded).

7. **A genuinely read-only second connection under WAL.** For a durable store that must be read while a
   single writer owns it, what is the canonical recipe so the reader can never acquire or stall the
   writer: SQLite URI `mode=ro`, `PRAGMA query_only`, `immutable=1`, or a snapshot read? Does a
   long-lived read-only connection ever pin the WAL and stall the writer's checkpoint, and does
   `node:sqlite` (`DatabaseSync`) differ from `better-sqlite3` here? This decides `#2406` and whether
   our "no second store opener" rule is sufficient.

8. **Distinguishing a wedged loop from a slow pass.** What liveness contract do the reference daemons
   expose — a monotonic progress counter, a wall-clock deadline on each pass, a heartbeat that is
   *separate* from liveness? How do they avoid both false positives (killing a slow model call) and
   false negatives (a fresh heartbeat over a frozen loop)? Informs the ROADMAP 61–64 watchdog.

9. **Durable spool / transactional-outbox delivery semantics.** For a file-spool that a resident
   broker drains (our `intent.mjs` → `<db>.broker.inbox/`), what is the established practice for
   idempotent/exactly-once delivery: `requestId` dedup, safe retry, stale/abandoned request garbage
   collection, and ordering with the in-flight run of the target seat? Prior art from message-queue
   outboxes is fine as long as it maps to a single-writer SQLite broker.

10. **Windows-native daemon process lifecycle.** Since durian-pi is Windows-only, how do comparable
    Node daemons handle signal delivery (`SIGTERM` is not delivered on Windows), process-tree
    termination (Job Objects / `taskkill /T`), crash vs graceful-exit detection (exit codes, a
    `down` marker), and running under a service manager. Any prior art on the stop-contract.

### The seam / scale cluster (informs ROADMAP 153–156)

11. **Test-suite concurrency and isolation that does not flake.** How do reference projects bound and
    isolate tests that spawn processes, create git worktrees, or touch fixed paths, so a suite runs
    concurrently without cross-test interference? We are trying to replace a ~5-minute serial suite
    (`DURIG_SUITE_CONCURRENCY`) with bounded concurrency; give the isolation primitives they use.

12. **Security model of the `Operations` relocation seam.** Pi gives each tool an `Operations`
    interface as the single remoting seam. How is that seam constrained so a relocated or per-seat
    scoped tool cannot escape its boundary (credential scope, filesystem scope, capability
    enumeration)? Informs ROADMAP 156 and the per-seat tool-scoping gap (ROADMAP 18).

## Deliverable

A written report at `docs/research/daemon-harness-architecture-followup.md`, with one section per
question and a short "how this maps to durian-pi" note per section.

## Evidence discipline

Every external claim cites a URL and states its class (`observed` from source vs
`advertised-elsewhere`). Distinguish `node:sqlite` behaviour from `better-sqlite3`/`sqlite3` behaviour;
do not generalise a claim across drivers.

## Constraints

Written report only; do not modify code. Hand back via the operator.
