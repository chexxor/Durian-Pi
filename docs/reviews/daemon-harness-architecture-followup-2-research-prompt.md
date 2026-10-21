# Second-round follow-up research prompt — daemon-harness architecture (2026-10-19)

**Context.** The first follow-up report
(`docs/research/daemon-harness-architecture-followup.md`) answered 12 questions and was consumed in
`docs/reviews/daemon-harness-architecture-followup-review.md`. Four details it explicitly left
unverified remain. They are narrow, so this is a short round. Written per
`docs/runbooks/research-request.md`.

## Questions

1. **Omnigent's exact conformance-probe schema and rubric.** The first round confirmed only the
   *modes × maturity* matrix (Direct/Native × Fully supported/Maintained/Community). Give the probe
   **data shape** and a **pass/fail rubric** for: basic turn, tool calling, streaming, interrupt,
   model override, policy denial. In particular, how are **interrupt** and **policy denial** asserted
   deterministically (on which observable event)? This is the missing input to ROADMAP 155.

2. **`filelock`'s Windows locking semantics.** OpenHands' `LocalFileStore.lock()` uses the `filelock`
   library (its docstring says "flock"). On Windows this backend is not POSIX `flock`. What primitive
   does it use (LockFileEx / msvcrt / a lock file), what is the behaviour when the holder dies (stale
   detection), and does it work on a network/synced filesystem? We would only port this if ROADMAP 157
   opens, so a short answer suffices.

3. **`immutable=1` for a snapshot reader under WAL.** Is SQLite URI `immutable=1` safe and correct for
   a read-only connection to a database another process is still writing (WAL)? What exactly does it
   promise, and can it return stale or corrupt results if a writer is live? Relevant to `#2406`'s
   read-seam choice.

4. **Append throughput at our scale.** Any concrete figure (published or benchmarkable) for an
   append-only, one-file-per-record store at a few thousand records/minute on a single Windows host,
   versus WAL SQLite. The first round found none; even a rough order-of-magnitude with sources would
   let us decide whether ROADMAP 157 is worth ever opening.

## Deliverable

A written report at `docs/research/daemon-harness-architecture-followup-2.md`, with one short section
per question. If a question cannot be answered, say so explicitly rather than inferring.

## Evidence discipline

Every external claim cites a URL and states its class (`observed` from source vs
`advertised-elsewhere`). Do not generalise `node:sqlite` behaviour to other drivers, or Unix locking
behaviour to Windows.

## Constraints

Written report only; do not modify code. Hand back via the operator.
