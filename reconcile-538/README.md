# reconcile-538 — the #538 shape fold (item #642)

The #538 work-item shape with lead's #610 ruling folded in, recorded so it is not lost between the
queue record and #538 implementation. Built by impl on item #642 (routed by pm #632; ruling = lead
#610, delivered to pm as DONE #632).

## Contents

- `538-shape-reconciled.md` — THE canonical #538 shape (standing shape + the six folds + the gate).
- `reconcile-worksheet.txt` — the no-op/missing analysis that answers #642's "if #538 already
  carries any of these, treat as reconcile/no-op" instruction.
- `item-{503,538,549,610,632}-store-record.json` — the extracted queue-store records of the five
  referenced items (full bodies, results, transitions) as evidence of what was already recorded.
- `queue-apply.mjs` — how the store records were extracted, and what qa re-runs to verify:
  reconstruct the `durig.queue` document from its base+delta revisions using chord's own delta
  apply (`@earendil-works/chord/dist/delta`), then pull wanted items.

## How qa re-runs the store read (all read-only; the live DB is copied, never opened in place)

1. Copy the live store + sidecars to a temp dir (never open the live DB directly so the running
   broker is not blocked):
   ```powershell
   $dst = Join-Path $env:TEMP "durig-dbcopy"
   New-Item -ItemType Directory -Force $dst | Out-Null
   Copy-Item C:\Users\Alex\dsh-Projects\pi-opendurig\selfdev.sqlite            $dst\ -Force
   Copy-Item C:\Users\Alex\dsh-Projects\pi-opendurig\selfdev.sqlite-wal        $dst\ -Force -ErrorAction SilentlyContinue
   Copy-Item C:\Users\Alex\dsh-Projects\pi-opendurig\selfdev.sqlite-shm        $dst\ -Force -ErrorAction SilentlyContinue
   ```
   (The live DB is whichever durig's `durig.config.json` DURIG_DB names; at the time of this item it
   was `selfdev.sqlite` in the repo root. Verify with `node cli.mjs config` before re-running later.)
2. Reconstruct + extract the wanted items:
   ```powershell
   node reconcile-538/queue-apply.mjs "$dst\selfdev.sqlite" out-queue.json 503,538,549,610,632
   ```
   Expected: `deltas+... through=...` line, then one `queue-item-<id>.json` per wanted id. In this
   run: base@seq=1, 1583 deltas applied through seq=242106, nextId=674, items=673 (the item-642 DB
   copy of 2026-10-16 ~00:05; the live numbers move as the queue moves — only the extracted item
   records need to match).
3. Check the fold completeness claim: grep `item-538-store-record.json` — there must be NO hits for
   `TUI|worktreeRef|dangling|attention|subject-shape|R1` beyond the extension-seam mentions of
   `workItemId` (that is the honest basis for "none of the six folds was already in #538"), then
   compare `538-shape-reconciled.md` section B against lead's ruled text in
   `item-610-store-record.json` (the ruling) and `item-632-store-record.json` (the routed copy) —
   verbatim commitments, not paraphrase.

## Why a snapshot, and its limit

The store was read from a copy taken while the broker was live; the item counts (`nextId=674`) are
exact as of THAT copy. Any queue activity after the copy (including the delivery this item creates)
appears only in the live store, not in the pinned source records. The SOURCE records
(#503/#538/#549/#610/#632) are terminal (done) items, so their bodies/results cannot change after
the snapshot — the completeness/no-op conclusions below hold against the live store too: a terminal
item's record is immutable in the relevant sense (it cannot be claimed/revised).
