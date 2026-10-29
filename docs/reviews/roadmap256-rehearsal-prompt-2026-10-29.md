# ROADMAP 256 — the seat-hygiene rehearsal: the prompt you should read *instead of* re-deriving this

Write this to a file and run it through a fresh model (the same instrument as `gate.mjs`/`latency-budget` self-checks,
per `docs/runbooks/write-docs-critically.md` §Self-check prompts). It is deliberately **not** in `docs/NEXT.md` — the
pointer stays short (200-line cap; `demo/next-pointer.test.mjs`) — and the pointer must not rewrite shas (229).

## The operator's ask, verbatim in substance

> Get the team working again **if and only if the agents will behave well**: be hygienic about their seat-personal
> workspace, git branches, git worktrees, and regular merging of their branches back to `main` after a review.
> **When** can that be achieved? Queue this to evaluate at the start of the next session.

## What you must produce (a *date-shaped answer is wrong*; a measured gate with a threshold is right)

1. **A defect-slice rehearsal task, written down before the channel starts** — one small item per seat, touching
   **disjoint files**, in the **disposable clone** `/home/chexxor/Git/Durian-Pi-ops`, never this checkout. State the
   per-seat completion condition in the rehearsal brief so `done` means an artifact in `main`'s history (**253**, **100**),
   not a branch tip.
2. **A read-only violation counter over a bounded run** — `tools/seat-hygiene-audit.mjs`, zero new state, reusing the
   instruments that already exist rather than inventing a parallel account: `worktree audit` (worktrees ↔ queue items ↔
   seat roots), `src/seatroot.mjs` + `demo/seatroot-name.test.mjs`, the confine family (`src/seattools.mjs`,
   `demo/seat-confine-*.test.mjs`), scratch-per-tree, `check`'s `shared-tree-on-main` / `stray-seat` /
   `evidence-tree` / `verify-scratch-cleanup`, and the git-side questions 100's measure answers (is the artifact an
   ancestor of `main`? are there branches that should be retired? is any branch 200+ commits from its base? — 146).
   Every violation must print **file:line or a command you ran**.
3. **A verdict file** `docs/reviews/seat-hygiene-rehearsal-<date>.md`: the violation counts per dimension, the cost of
   the run, and the **scale threshold the operator must approve** (e.g. 2 seats → 5 → 12). Say plainly if the rehearsal
   is inconclusive.

## Read first, in this order

`docs/ROADMAP.md` 256 (acceptance criteria, blind spots, *Do not*) · **217** (a Linux seat has **no working shell**:
**20,340** `powershell` calls, **0** `bash`, `spawn powershell ENOENT → 3` — a seat has never run `git` or the suite, so
its hygiene is *unobserved*, not good) · **232** (unscoped `pruneWorktrees` deletes ledger rows for trees that exist —
the same sweep the retire-on-`done` path reaches; fix the scope before you let a rehearsal's `done` verbs prune) ·
`docs/runbooks/leaked-worktrees.md`, `worktree-sweep.md`, `land.md`, `merge.md`, `branch-cleanup.md` ·
`docs/runbooks/model-server-broker-race.md` (**the model server's lifetime is serialized against broker in-flight runs —
never load/unload a model while the channel is live**) · `docs/runbooks/scale-team.md` (the 5→12 economics you will be
justifying) · `docs/reviews/delegate-notes-2026-10-29-hygiene-and-transport.md` (this session's measurements) · **D164**.

## What is already true, so you do not re-measure it

- **The ordering is settled: 217 → 232 → audit → 2-seat rehearsal → operator threshold → scale.** Do not re-litigate it;
  a seat that cannot run `git` cannot be audited for branch hygiene.
- **Queue is empty of claimable work: 4,821 rows, 0 claimable.** 217/232/233/235–256 have no queue rows, so **no seat
  will pick any of this up** until `pm` decomposes. Three intents are already spooled to `pm`
  (`hygiene-rehearsal-20261029`, `verifier-merge-20261029`, `release-brief-20261028`) — **spool only, never start**.
  `pm` owns decomposition and routing; you do not claim or complete anything.
- **The verdict you are designing for has teeth**: under **253** nothing may be driven to `done` without verifier
  re-runnable evidence **and** ancestry — so a hygiene rehearsal that trips 232's ledger-deleting prune is not a rehearsal,
  it is a data-loss incident.
- **The channel economics you will quote** (`docs/reviews/wallclock-budget-2026-10-28.md`): resident-broker days waited
  **2.6–5.4 min** per claim and landed **314–741** items/day; `run`-invoked days waited **101.8–114.3 min** and landed
  **47–132**. Also: at 5 seats the broker spends **48.5%** of a window in `askSeat`, with **42.9%** of dispatches
  `no_healthy_seat` — which is why "more agents = more throughput" needs the rehearsal, not just more seats.
- **Costs are now in the ROADMAP header** (236): read them before proposing a scale change.

## The trap to avoid

Do not answer "when" with a date. The honest answer is a gate: *the rehearsal runs when 217 and 232 land; scaling is
approved on the rehearsal's numbers.* If asked to start anyway, the safe interim is the 5-seat configuration under
**199**'s ceiling (≤2 non-verifier seats per model), with **253 applied by hand** — every merge checked by the delegate
before it lands — and say in the same breath which guarantee is off. Also: never run the rehearsal in this checkout, and
do not let the rehearsal's `done` verbs run against `Durian-Pi`'s ledger.
