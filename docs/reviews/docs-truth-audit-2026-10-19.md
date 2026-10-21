# Docs truth-up audit — last 50 commits (as of `main bd0712c`, 2026-10-19)

**Audience:** the delegate, `pm`, `scribe`, and each owning seat. **Purpose:** check the operator's
worry that development is outrunning the docs — are the last 50 commits' new/changed features actually
documented, and do any changes contradict a doc that should have been updated?

## Method
- `git log -50 --name-only` parsed per commit; flag **code/behaviour changes** (`feat`/`fix`/`refactor`
  touching `src/`, `cli.mjs`, `scripts/`, `demo/`) with **no same-commit docs change**.
- For each flagged commit, grep `docs/FEATURES.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`,
  `docs/STATUS.md`, `docs/runbooks/`, `README.md` for the item id **and** the feature phrase.
- Same-commit is a proxy only: a later `scribe` commit can cover an earlier code commit (e.g. `#2321` is
  documented later in `FEATURES.md`), so every gap below was phrase-checked against the current docs.

**Result:** 50 commits parsed, 11 code/behaviour changes with no same-commit docs update. Of those, most
are covered elsewhere; **6 are genuinely undocumented or now contradict a current doc.**

## Genuinely missing / contradictory
| # | Change (commit) | Doc surface | Finding |
|---|---|---|---|
| 1 | `status` context-pressure **now visible** for local seats — the declared window denominator resolves (`#2231`, `166d51f`) | `docs/FEATURES.md:277` and `:475` | **Contradiction** — `:277` still says "Context pressure \| **Not visible.**"; `:475` still lists visibility as future work |
| 2 | `lastActivity` now means ACTIVITY, not the last admitted submission (`#2229`, `0715e67`) | `docs/FEATURES.md:59` (`status` row) | **Contradiction** — the row states "the newest admitted submission's input-entry timestamp", the pre-`#2229` semantics |
| 3 | Broker **bounded retry** + `.stop` honored on the throwing path + `PASS-FAILED <error> cause=<chain>` logging (`#2237`, `3021fe2`; the ROADMAP 78 remainder) | `docs/ROADMAP.md` item 78 status; `docs/FEATURES.md` | **Missing** — no DELIVERED mark and no FEATURES row for the pacing bound / pass-failed legibility |
| 4 | Pinned pi build reproduced in worktrees (`sync-pi --link` after `npm ci`, `#2412`, `16aa6bf`) | `docs/SELFDEV.md` (+ a runbook); `docs/FEATURES.md` toolchain | **Missing** — the phrase `sync-pi --link` is absent from the docs; the `pi-build-version-visibility` incident stays open though the fix landed |
| 5 | Land slot-cap resolver mirrors the broker (`resolveSlotCount`: env > config file > shipped defaults; `#2224`/`#1498`, `6683790`) | `docs/runbooks/land.md`; `docs/ROADMAP.md`/`DECISIONS.md` | **Partial** — "slot cap" appears in DECISIONS/STATUS, but `land.md` does not describe the resolution order |
| 6 | Read result-file consumed after use, so `<db>.broker.inbox.out/` does not grow under `watch`/`ui` polling (`5c946a1`) | `docs/FEATURES.md` broker-served-reads / command-spool rows | **Missing detail** — the result channel is described, the consumption/cleanup is not |

## Covered (no action)
- **Broker-served reads / `read` spool op** — `FEATURES.md:182–183`, incl. `#2321`/`onlyReadIntents`. Good.
- **TUI context line** — `FEATURES.md:196` (`#1108`). Good.
- `#2211`/`c5daca5` (one-time WIP reconcile) — no doc needed beyond the read-op-regression incident.

## Plan
1. **`scribe`** (owns `FEATURES.md`/`STATUS.md`): fix the two **contradictions** (#1, #2); add/refresh
   rows for #3 (bounded retry + `pass-failed` legibility) and #4 (verifier pi-build reproduction).
2. **`devtools` / `impl`** (own dev docs): document #4 in `docs/SELFDEV.md` (per-worktree pin
   reproduction) and #5 in `docs/runbooks/land.md` (slot-cap resolution order); mark ROADMAP 78 / `#2237`
   status.
3. **`pm`**: register one "docs truth-up — last 50 commits" item carrying this table; route the
   FEATURES/STATUS half to `scribe` and the runbook/SELFDEV half to `devtools`/`impl`; close the
   `pi-build-version-visibility` incident as fixed by `#2412`.
4. **Prevention** (the "moving too fast" concern): a `check` rule / periodic sweep that flags a
   `feat`/behaviour commit whose feature has no `FEATURES.md` row, so drift is caught mechanically.

## Limits
- A heuristic: it reads commit subjects, changed paths, item ids and phrase presence — not full
  semantics. A feature documented under different wording can be missed; a mention can be stale.
- Same-commit docs are not required; the check is coverage in the *current* docs, not per-commit.
