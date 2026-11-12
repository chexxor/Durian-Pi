# The branchless mode cannot be checked against worktrees, because the worktree is minted unconditionally (#7160 / #7158, #7159)

Architect review, 2026-11-12. Tree: branch `item-7160`; `@earendil-works/pi-durable` **1.3.0** from this
worktree's lockfile (seat root 1.5.1 - not comparable). Host: Linux, kernel `7.2.15-300.fc45.x86_64`,
Fedora 45, node v24.22.1, git 2.56.0.

Instrument: `node tools/probes/branchless-check-baseline-7160.mjs` → **exit 1**.

## Measured state the check would run against

| fact | value | source |
|---|---|---|
| worktrees | **140** (137 item-linked, **113 reapable**, 7 dirty, 2 locked) | `node cli.mjs worktree audit --json` |
| non-terminal queue rows | **1564** | `node cli.mjs queue --json --no-body` |
| claimed rows | **11** | same |
| non-terminal rows with a live worktree | **11** | joined |
| non-terminal rows without one | **1553** | joined |
| seats whose cwd is the SHARED CHECKOUT | **pm, lead, advocate** | `worktree audit` `seatRoots` |
| uncommitted tracked changes in the main worktree right now | **2** | `worktree audit` |
| occurrences of `executionMode`/`branchless` in src/ and scripts/ | **0** | grep |
| `src/seattools.mjs:162` | calls `prepareSeatWorkspace` **unconditionally** | read |
| `src/seatguard.mjs:129-141` | from a degraded cwd the guard **refuses every shell command**; only `prepare_workspace` is allowed | read |

## F1 - the check as specified fires on 1553 rows, and a rule that starts red gets disabled

"Compare the recorded mode against `git worktree list`" is a comparison between a **row field** and a
**filesystem state** that has nothing to do with the row's stage. A queued, held or deferred row has no
worktree because `prepare_workspace` runs at **claim**, not at intake. So the naive rule reports 1553
findings on a population of 11 claimed rows. pm's own note requires the baseline count before going live
(#3539: 498 findings, rule disabled) - measured, the baseline is **1553**.

**Concrete fix:** the rule's population is **claimed rows only** (11 today), and the finding is not "no
worktree exists" but **"the mode the row claims contradicts what the row did"**. Concretely:
- `modeClaim` minted at intake from kind + acceptance text;
- `modeActual` derived at landing from `changedPaths` via `isDocumentationPath` (`src/landinggate.mjs:45`);
- the check fires on the **mismatch** (claimed branchless, produced code; claimed isolated, produced nothing),
  and on **reapable worktrees belonging to terminal rows** (113 today), which is the residue the census
  already names.

## F2 - `isDocumentationPath` is a post-diff fact, not a mint-time predicate

`docs/WORK-ITEM-MODEL.md` §3 says "use the same predicate at claim time, so 'does this item need a tree' and
'can this change break the suite' are one function". They cannot be one function, because at mint there is
no diff: `isDocumentationPath` takes a path, and paths exist only after work. Minting a mode from prose is a
**prediction**; the landing gate's use of the same predicate is a **fact**. Naming them the same thing is how
a rig ends up trusting a prediction it never verified.

**Concrete fix:** two names, one predicate. `modeClaim` (prediction, intake) and `modeActual` (fact, landing).
Report the delta. The value of the field is the delta, not the field.

## F3 - the branchless path does not exist, and the guard refuses it

§4 is marked PROVISIONAL: branchless work happens "in the seat's existing cwd, output submitted as a
structured delta". Today:
- `src/seattools.mjs:162` creates a worktree for every claimed item, unconditionally;
- `src/seatguard.mjs:129-141` refuses **every** shell command from a degraded cwd (the shared checkout),
  allowing only `prepare_workspace`;
- three seats (pm, lead, advocate) sit in the shared checkout now.

So a row minted `branchless` has no legal place to write. The seat hits a refusal and defers - the mode
manufactures the stall it was meant to avoid, and the row joins the 501 deferred pile.

**Concrete fix:** do not mint `branchless` for any row whose acceptance names a file write until the
structured-delta sink exists. Mint it only for rows whose work is genuinely read-and-report (a census, a
status read, an answer to a question). That is a scope call for lead; the safety rule is mine.

## F4 - the cascade if branchless seats write into the shared tree

`worktree audit` shows 2 uncommitted tracked changes in the main worktree right now, and this rig has
already recorded (`docs/SELFDEV.md` 281) that `broker-serve --start` refuses on a dirty live tree
(`BLOCK live-tree-dirty`). A branchless mode that lets seats write there converts one item's work into a
fleet-wide stop: nobody can start the broker, nobody can land. Recovery path: the dirty-tree refusal is
already the backstop; the check rule must attribute the dirty files to a seat+item (the shape registered as
#3648), not just say "the tree is dirty".

## F5 - worktree residue is the measurable half, and it is already measurable

113 of 140 worktrees are reapable. That is not a violation, it is the cost the mode rule is supposed to
reduce. If #7159 wants a real baseline, it is this: **reapable worktrees per non-terminal row**. Today
113/1564. Anything else the rule reports is inference about intent.

## Failure modes

| failure | mechanism | recovery |
|---|---|---|
| red at birth | 1553 findings from unclaimed rows | scope the population to claimed rows; report the baseline before enabling |
| prediction as fact | mode minted from prose, checked against a filesystem that never saw the prose | `modeClaim` vs `modeActual`, delta reported |
| unimplementable mode | guard refuses shell from shared cwd (seatguard.mjs:129-141) | mint `branchless` only for read-only acceptances until the delta sink exists |
| cascade | branchless writes dirty main → broker refuses to start → fleet stalls | attribution per seat+item (#3648), not a bare "dirty" flag |
| two sources | row field vs `git worktree list` disagree | the check reads the row; the filesystem is evidence, not truth |
| loop | unconditional `prepareSeatWorkspace` keeps minting trees the mode says are unnecessary | the mode must reach `prepareSeatWorkspace` before any rule can judge it |

## Options weighed
- **(A) Mint the mode and run the check as specified.** Rejected: measured 1553 findings; it disables itself.
- **(B) Mint the mode as a claim, derive the fact at landing, and check the mismatch on claimed rows.**
  Chosen: cheap, reversible, and it measures something true.
- **(C) Make `prepareSeatWorkspace` conditional on the predicate first.** Rejected as the *first* step:
  you cannot change isolation semantics before you can measure them, and the unconditional tree is what
  makes today's census tractable.

## Not my decision
Whether `branchless` should exist as a mode at all (§4 is PROVISIONAL) and which acceptances qualify - lead's.
Sequencing of #7158 and #7159 - pm's. I changed no broker, seattools or checkup code.
