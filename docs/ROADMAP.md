# durig — roadmap

Ordered by operator value; each item names its motivating finding.
State as of **2026-10-10**: work is paused at the end of the viewing/formatting
milestone. `docs/STATUS.md` is the handoff record.

## Milestones

- **M1 — Rig runs and routes. ✅ done.** Queue semantics, org edges, Router at
  harness open, seat prompts, real-model e2e (D3, D4, D5, D16).
- **M2 — Operator can see the rig. ✅ done.** `watch`/`log` human views, live
  stream on `send`, turn-grouped transcripts with timestamps, wrong-database
  guardrail (D18, D19, D20).
- **M3 — Seats can actually do work. ⏳ next, and this is the gap that matters.**
  Seats currently hold only `send_work`, `claim_work`, `complete_work` and
  `peek_queue`. A seat asked to implement a change answers, correctly and
  honestly, that it is blocked: no file access, no way to run a check. Durig can
  coordinate work but cannot perform it.
- **M4 — Interactive client over the same store.** Deferred by decision (D21),
  not by accident. Blocked on choosing TUI vs browser, which needs an operator
  ruling.

## Near-term

1. **Give seats real tools (M3).** The blocking finding of the last session: a
   live worker seat reported "I have no codebase visible … no file system access,
   no code execution" and refused to claim a completed deliverable, which is the
   constitution working correctly on top of a missing capability. Needs a ruling
   on scope: read-only corpus access first, or file edits plus a test runner.
   Whatever is chosen must survive the grounding rule (P1) — a seat may not assert
   what it did not retrieve or run.
2. **Extract the view model and peer navigation graph (D21).** Pure functions:
   turns, collapse state, and "which seat sent to / received from this seat",
   derivable from queue items' `from`/`to` and the Router tools. Unblocks both
   interactive asks without committing to a screen model.
3. **One shared read API.** `watch`, `log` and `status` each re-implement seat and
   health reading today; that duplication is the real refactor smell, ahead of any
   formatting concern.
4. **Repeat-call tolerant tools** — a second `claim_work` in one invocation errors
   with `Cannot use a settled overlay` (RESEARCH.md R2). Tools should return
   current state on repeat calls; models retry naturally.
5. **`watch <seat>` focus / `log --follow` consistency** — `--follow` currently
   prints the backfill as one block and each later entry on its own, so column
   alignment and turn grouping differ between them. Small, self-contained.

## Mid-term

6. **Pods design decision** — OpenRig parity question deferred twice:
   namespace-scoped queues vs a flat queue with pod tags. Needs an operator ruling
   before implementation (the converter currently drops pods with a warning).
7. **Workflow task type** — SOP-style phases enqueueing queue items and waiting on
   DONE notices, built on PD's durable task graph (Core_Ideas layer 7).
8. **Seat handover on context exhaustion** — PD has compaction; the OpenRig
   handover-packet flow does not exist yet.
9. **Queue block/park/wake-after semantics** — OpenRig wake-timer parity.
10. **Human approval gate hook** — PD hooks can block tool calls pending an
    operator decision; wire to the CLI.
11. **Interactive client (M4)** — only after (1) and (2). If chosen, prefer
    `@earendil-works/pi-tui` (already a dependency of `pi-coding-agent@1.1.0`, so
    it is in-stack) over adopting a new framework; the browser/SSE client is the
    cheaper option if the interaction set stays small.

## Explicitly deferred (with reasons)

- Textual interaction in `cli.mjs` itself — would break the JSON contract the
  seats drive (D21).
- Alternate-screen TUI with in-place collapsing — forces mouse reporting and full
  repaint, losing scrollback and pipes, and is the worst-supported combination
  with tmux (RESEARCH.md, "Formatting a transcript").
- Terminal multiplexing as a dependency — no per-seat terminal exists to attach to
  (D22).
- Real push instead of polling — SQLite has no cross-process notification; Honker
  and tailite are catalogued in RESEARCH.md but Windows support is unverified.
- Constitutional-evolution search, Big-Five trait injection, FIPA-ACL performatives,
  Contract-Net auctions, dynamic persona generation, blackboard architecture —
  evaluated against Core_Ideas.txt; rationales in DECISIONS.md.
