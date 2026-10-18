> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# QA VERIFICATION REQUEST — item #642 (#538 shape fold: lead #610 → reconcile → record)

## What the item asked and what impl delivered

#642 = pm's route of lead's #610 ruling into "the #538 work-item shape": record the RULINGS so they
are not lost, RECONCILING against #538's existing record rather than duplicating.

Deliverables:
1. Queue item to pm carrying the reconciled #538 shape (subject "#538 SHAPE (reconciled) — …").
2. This verify request naming the evidence qa can re-run.

## Evidence qa can re-run (steps are in reconcile-538/README.md of the archive commit)

1. **Store reconstruct** (read-only; copy the live DB first — steps + the tool):
   `node reconcile-538/queue-apply.mjs <db-copy.sqlite> out.json 503,538,549,610,632,642`
   — run from the item-642 worktree (has its own node_modules). Verified in this item's run:
   `durig.queue doc=29 base@seq=1 deltas+1583 through=242106 nextId=674 items=673` (exit 0);
   extraction of each wanted item exits 0 and re-writes the item JSONs.
2. **Fold completeness (no-op check)**: grep `item-538-store-record.json` — expected ZERO hits for
   `TUI|worktreeRef|dangling|attention|subject-shape` (beyond the extension-seam mention of
   `workItemId`), i.e., none of the six folds was already in #538's terminal record. Then compare
   `538-shape-reconciled.md` §B (the fold) to `item-610-store-record.json` (lead's ruling) and
   `item-632-store-record.json` (the routed copy routed to impl) — the commitments must be verbatim.
3. **Suite sanity** (worktree has NO code change; the commit is docs-only):
   from the worktree run every `demo/*.test.mjs` as `node demo/<f>` (direct child, exit code kept)
   → expect all exit 0 (this run: 85/85). NB: the same suite under a PowerShell `*> $null` loop
   runner showed 3 byte-sensitive demos failing from redirection quirk, not durig; re-run those
   directly if seen (see `suite-run-notes.md`).

## What should hold after delivery

- pm's queue gains the SHAPE item (non terminal) — visible in the team-wide queue view.
- #642's DONE summary points at the commit hash + this request.
