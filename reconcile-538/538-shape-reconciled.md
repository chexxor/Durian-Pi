THE #538 SHAPE — RECONCILED RECORD (impl #642, from lead's #610 ruling routed by pm #632)

WHAT THIS IS: the complete #538 work-item shape with lead's #610 fold recorded in one place, so the
fold is not lost between the queue record and #538 implementation. #538 itself is TERMINAL (done by
lead 2026-10-15T21:14:40Z: the design/proposal), so it cannot be revised; the fold lives HERE and pm
applies it (gate line below) when creating the #538 implementation item.

A. STANDING SHAPE (already recorded; NOT re-argued here — no-op for these)
- WorkItem = STORE RECORD {id, title, assignees[], featureBranchName, worktreeRef, status, reviews[]};
  ONE WorkItem : N QueueItems, linked by ONE additive nullable `workItemId?` on queue items
  (standalone items behave exactly as today). [#503 result]
- The work-item VIEW is the FIRST EXTENSION case for #505's seam: 4-part contract — opt-in pull
  discovery (core must not require the extension); bounded read-only lifecycle; least-privilege
  MEDIATED read through the broker/readapi, never a direct DB handle (F24: a second DB opener races
  entry-id allocation); declared contract versioning. Roll-up is COMPUTED AT READ TIME, not stored.
  [#538 result, lead]
- One store, one broker (A1) — no new writer; view is read-only (D11). [#503/#538 results]
- Standing guardrails carried by earlier rulings and invoked by name, not re-argued: store
  authoritative, not git; seats never commit/merge git state (#146); coordinators get no read tools
  back (F9/#144); no second wake/execution path (#121).

B. THE FOLD (lead's #610 ruling, verbatim commitments; recorded 2026-10-16)
1. FIRST SURFACE: FIRST = TUI card (where the operator first looks for live state); SECOND =
   status/CLI row; NO dedicated `workitem` verb. Additive fields in the EXISTING JSON that
   TUI/status/watch already render — no new command surface (smallest surface: a new verb ADDS
   surface; additive fields ADD none; METRICS.md admissibility: actionable, rare-when-abnormal,
   not-already-visible; consistent with D21: cli.mjs stays non-interactive, UI is a separate
   entrypoint). NOT folded into #505 (deferred awaiting research agent) — ruled so #538 is unblocked.
2. WORKTREE BINDING (designer's D) — RECORD (a): the WorkItem HOLDS the `worktreeRef`; its queue
   items ride along. Preserves 1 work item : N queue items (#503); avoids per-queue-item worktree
   churn; consistent with #473 claimWorktree/removeClaimedWorktree (the worktree is a WORK-level
   resource). NON-OBVIOUS KERNEL: D49's create-on-claim/remove-on-complete binds to the WORKITEM's
   claim/complete, NOT each queue item's — otherwise create-on-claim per queue item contradicts (a).
3. DANGLING REF (designer's E) — ACCEPT: a `worktreeRef` pointing at a REMOVED directory while
   queue items are non-terminal MUST surface as an ATTENTION NOTICE, same channel as
   `idle_with_queued_work` (push-not-poll). Same invariant-tracking class as
   stalled-claim/held/repeated-failure.
4. R1–R4 CONFIRMED AS REJECTED (each matches a standing ruling):
   R1 persona-review as merge GATE — rejected (#538/#503: review is a RECORD informing the operator,
        not seat-held merge authority; designer #549 adds the distro test: a user must not need to
        know which seats merge).
   R2 any WorkItem field derived from git state — rejected (#503: the STORE is authoritative, not
        git; a git-derived head goes stale silently under D50 developer commits).
   R3 restored read tools for viewing — rejected (#144/F9: view is STORE-MEDIATED; designer #549/D55
        adds: a path a coordinator cannot open is worse than a body).
   R4 a new wake/execution path — rejected (#121 no-second-wake-path binding; the ONE serve broker
        is the single writer).
5. CODE-DERIVED BINDING (designer's read #549, confirmed by lead): `workItemId` MUST be an EXPLICIT
   field, NOT derived from subject shape — subject-shape derivation is fragile and can
   false-positive against DONE-notice items (cf. Router isDoneNotice).
6. THE GATE: #538 remains gated on #503's C-1 read surface (the `workItemId?` additive field +
   WorkItem store record + read path). DO NOT START implementation before that surface EXISTS in
   code. #538 needs ONLY C-1; it does NOT need C-2/C-3/C-4 from #503's decomposition.

C. RECONCILE / NO-OP FINDINGS (impl's store read, for the "already carried?" check pm asked for)
- None of the SIX folds appears in either #538's queued body or lead's #538 result. Store extract
  grep: zero hits for first-surface/TUI/worktreeRef/dangling/attention/subject-shape; `workItemId`
  appears only as the extension-seam field reference. Nothing of the fold was duplicated; this is
  a COMPLETE fold.
- Closely-related statements that ALREADY stand in #538 (left as-is, no re-recording): mediated
  read-only access, no-new-writer, roll-up computed at read time, C-1 dependency. The fold ADDS the
  first-surface ruling, the worktree binding + D49 kernel, the dangling-ref notice, the explicit
  R1–R4 rejection set, and the explicit-workItemId binding.
- The fold's standing rulings are INVOKED, not re-argued (their homes: #503/#538 results, #146,
  #144/F9, #121, D21, D49, #473, Designer #549).

D. DISPOSITION
- pm holds the #538 record and the gate. When #503's C-1 read surface EXISTS in code, pm creates
  the #538 implementation item from THIS shape (one-concern slices per #503's C-decomposition).
- impl has NOT started implementation (gate respected). No new verb, no implementation bundled.
