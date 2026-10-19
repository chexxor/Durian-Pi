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

## Deliverable

A written report at `docs/research/daemon-harness-architecture-followup.md`, with one section per
question and a short "how this maps to durian-pi" note per section.

## Evidence discipline

Every external claim cites a URL and states its class (`observed` from source vs
`advertised-elsewhere`). Distinguish `node:sqlite` behaviour from `better-sqlite3`/`sqlite3` behaviour;
do not generalise a claim across drivers.

## Constraints

Written report only; do not modify code. Hand back via the operator.
