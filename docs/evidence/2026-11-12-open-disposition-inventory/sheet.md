# OPEN disposition inventory — 53 rows, decision column blank (#6927)

Produced 2026-11-12 by qa. **No decision is recorded here**: the LAND/CANCEL column is
deliberately empty. A disposition is the owning seat's act (docs/DISPOSITIONS.md: "Writer: the
deciding seat"); this sheet is the list those seats decide from.

## How it was derived (reproduce it)

```bash
grep -c '\*\*OPEN' docs/DISPOSITIONS.md                                   # 53 OPEN ledger rows
DURIG_DB=selfdev.sqlite node cli.mjs queue --no-body > queue.json        # exit 0 - live status + owner
git rev-parse <ref>                                                     # is the ref still there
git rev-list --count main..<ref>                                        # commits ahead of main
git merge-tree --write-tree main <ref>                                  # exit 0 clean, exit 1 conflict
git worktree list                                                      # which refs a worktree still holds
DURIG_DB=selfdev.sqlite node cli.mjs ps                                # exit 0 - the live seat roster
```

`main` = `4c111c16`, git 2.56.0. "Deciding seat" = the queue row's `to` field, i.e. the seat that
owns the item the ref is attached to.

## Tally

| dimension | counts |
|---|---|
| ledger rows marked OPEN | **53** (45 UNLANDED, 6 CONFLICTS, 1 DIRTY, 1 UNROUTED) |
| item status on the live read | `done` 53 — none cancelled, none deferred |
| deciding seats | scribe 14, architect 14, devtools 12, impl 8, qa 5 |
| merge-tree against current main | clean 30, **CONFLICT 23** |
| branch tip moved since the 2026-11-11 census | none |
| ref still held by a worktree | 49 yes, 4 no (`item-6101`, `item-6162`, `item-6330`, `item-6517`) |

## The sheet
| branch ref | item | item status (live read) | deciding seat (owner) | ahead of main | merge-tree vs current main | worktree holds it | LAND / CANCEL |
|---|---|---|---|---|---|---|---|
| `item-3094` | #3094 | done | scribe | 1 | CONFLICT | yes |  |
| `item-4758` | #4758 | done | scribe | 3 | CONFLICT | yes |  |
| `item-6139` | #6139 | done | impl | 3 | clean | yes |  |
| `item-6160` | #6160 | done | impl | 2 | CONFLICT | yes |  |
| `item-6161` | #6161 | done | impl | 5 | clean | yes |  |
| `item-6173` | #6173 | done | impl | 3 | clean | yes |  |
| `item-6174` | #6174 | done | impl | 8 | clean | yes |  |
| `item-6180` | #6180 | done | impl | 3 | clean | yes |  |
| `item-6182` | #6182 | done | impl | 2 | clean | yes |  |
| `item-6196` | #6196 | done | devtools | 3 | clean | yes |  |
| `item-6200` | #6200 | done | devtools | 1 | clean | yes |  |
| `item-6207` | #6207 | done | devtools | 1 | clean | yes |  |
| `item-6218` | #6218 | done | devtools | 1 | clean | yes |  |
| `item-6238` | #6238 | done | devtools | 3 | clean | yes |  |
| `item-6314` | #6314 | done | devtools | 2 | clean | yes |  |
| `item-6318` | #6318 | done | scribe | 1 | clean | yes |  |
| `item-6320` | #6320 | done | devtools | 1 | clean | yes |  |
| `item-6322` | #6322 | done | devtools | 2 | clean | yes |  |
| `item-6326` | #6326 | done | scribe | 2 | clean | yes |  |
| `item-6332` | #6332 | done | scribe | 1 | clean | yes |  |
| `item-6334` | #6334 | done | scribe | 4 | clean | yes |  |
| `item-6335` | #6335 | done | devtools | 2 | clean | yes |  |
| `item-6339` | #6339 | done | scribe | 1 | clean | yes |  |
| `item-6343` | #6343 | done | scribe | 5 | clean | yes |  |
| `item-6347` | #6347 | done | scribe | 1 | clean | yes |  |
| `item-6350` | #6350 | done | scribe | 1 | clean | yes |  |
| `item-6352` | #6352 | done | scribe | 1 | clean | yes |  |
| `item-6353` | #6353 | done | scribe | 1 | clean | yes |  |
| `item-6502` | #6502 | done | architect | 3 | CONFLICT | yes |  |
| `item-6531` | #6531 | done | architect | 4 | CONFLICT | yes |  |
| `item-6561` | #6561 | done | architect | 1 | CONFLICT | yes |  |
| `item-6634` | #6634 | done | architect | 7 | CONFLICT | yes |  |
| `item-6639` | #6639 | done | qa | 1 | clean | yes |  |
| `item-6643` | #6643 | done | architect | 9 | CONFLICT | yes |  |
| `item-6664` | #6664 | done | architect | 13 | CONFLICT | yes |  |
| `item-6668` | #6668 | done | architect | 3 | CONFLICT | yes |  |
| `item-6671` | #6671 | done | architect | 4 | CONFLICT | yes |  |
| `item-6679` | #6679 | done | architect | 4 | CONFLICT | yes |  |
| `item-6707` | #6707 | done | architect | 2 | CONFLICT | yes |  |
| `item-6730` | #6730 | done | architect | 2 | CONFLICT | yes |  |
| `item-6731` | #6731 | done | architect | 4 | CONFLICT | yes |  |
| `item-6754` | #6754 | done | qa | 1 | clean | yes |  |
| `item-6782` | #6782 | done | architect | 2 | CONFLICT | yes |  |
| `item-6101` | #6101 | done | impl | 3 | CONFLICT | no |  |
| `item-6116` | #6116 | done | devtools | 3 | CONFLICT | yes |  |
| `item-6162` | #6162 | done | devtools | 4 | CONFLICT | no |  |
| `item-6330` | #6330 | done | qa | 4 | CONFLICT | no |  |
| `item-6336` | #6336 | done | scribe | 5 | CONFLICT | yes |  |
| `item-6429` | #6429 | done | qa | 0 | clean | yes |  |
| `item-6478` | #6478 | done | qa | 3 | CONFLICT | yes |  |
| `item-6517` | #6517 | done | architect | 3 | CONFLICT | no |  |
| `item-6344` | #6344 | done | devtools | 2 | clean | yes |  |
| `item-6369` | #6369 | done | scribe | 2 | clean | yes |  |

## Rows that cannot be decided as a plain LAND, flagged separately

- **23 refs conflict with current main** (`git merge-tree --write-tree main <ref>` exits 1):
  item-3094, item-4758, item-6160, item-6502, item-6531, item-6561, item-6634, item-6643,
  item-6664, item-6668, item-6671, item-6679, item-6707, item-6730, item-6731, item-6782,
  item-6101, item-6116, item-6162, item-6330, item-6336, item-6478, item-6517.
  For these, LAND is not mechanically possible through a delegate merge — the author re-cuts
  against current main, or the row is CANCELLED. Six of them are already labelled CONFLICTS in
  the ledger; **17 were recorded as clean and are no longer**, because `main` moved.
- **4 refs have no worktree** (`item-6101`, `item-6162`, `item-6330`, `item-6517`). Their ledger
  rows say "no worktree holds it" and "item #… status `no row`"; on the live read all four items
  exist and are `done`. The stale evidence, not a missing seat, is what makes them look
  undecidable.
- **No row is undecidable because the deciding seat no longer exists.** Every deciding seat in
  this sheet (scribe, architect, devtools, impl, qa) is a live seat in `node cli.mjs ps`, exit 0.
- **One row is DIRTY** (`item-6429`: 0 ahead of main, 1 uncommitted tracked change). The
  uncommitted work is the only copy, so CANCEL would destroy it — decide that one before the
  others.
