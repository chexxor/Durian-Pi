# Delegate notes 2026-10-29 — the hygiene runbook lands, two instruments get promoted, and the restart gate turns out to be circular

**Host for every number here:** Linux (Fedora `7.2.11-200.fc42.x86_64`), box `label-withheld-per-D205`, node v24.22.1,
store `./selfdev.sqlite`, rig `rig.selfdev.json`. Session start 2026-10-29T19:1xZ (14:1x host-local CDT), and the
previous session's clock-out was `2026-10-29T07:3xZ`, so this is the same calendar day, ~12 h later.

## Headline: the operator's restart condition cannot be met by a rig that may not start

The condition (2026-10-29): the team restarts **iff** seats are hygienic about their workspace, branches, worktrees
and merging to `main` after review. Measured chain of dependencies, each link re-read today:

1. **Hygiene evidence needs ROADMAP 256's rehearsal**, and 256's instrument is `git` (`worktree audit`, ancestry of
   `main`, branch retirement).
2. **A seat has never run `git` on this host.** `entries`: `"toolName":"bash"` → **0**, `"toolName":"powershell"` →
   **20,340** (all Windows era), `"toolName":"pwsh"` → **0**; spawn errors `spawn powershell ENOENT` **3**,
   `spawn pwsh ENOENT` **1**, newest **#274090** (conv 4930 = `devtools`, 2026-10-28T17:09Z, inside the last broker
   pass). That entry's own reasoning is the symptom: *"PowerShell is not available? … Maybe the shell is pwsh on
   Linux?"* So the fix is **217**, and 217 is *seat* work in `src/seattools.mjs`.
3. **217 has no queue row, and nothing else in the recent band does either.** New instrument
   `tools/roadmap-queue-coverage.mjs` (0.9 s, one queue read): **4,821 rows — done 3,748 / cancelled 777 / held 277 /
   deferred 19, CLAIMABLE 0**; of the **63** registered ROADMAP items ≥ 200, **62 are named by no row at all**, and
   the 63rd (**253**) is named only by `#1146`/`#1149`, both `done`. Of the 28 items ≥ 235, **27 have no row**.
4. **Rows come only from `pm` decomposing, and `pm` only thinks when it is woken.** The rig's own preflight refuses
   the start for the 217 reason: `node tools/broker-serve.mjs --dry-run` → **`BLOCK seat-shell-availability`**
   ("spawns [pwsh, powershell], NONE of which exists on linux").

So the loop closes: **hygiene evidence needs 217 → 217 needs a woken seat → a wake is refused until 217 lands → the
refusal is justified by the absence of hygiene evidence.** Nobody is being unreasonable at any link; the gate as
written is unsatisfiable, and no amount of re-spooling to `pm` changes it, because the intents sit in
`selfdev.sqlite.broker.inbox/` (**5 pending, waiting 65–1,398 min as of the 14:5x re-measure**) while the broker is down.

**The one ruling that opens it (operator's, priced).** `pm` is a coordinator: it has **no** `write`/`edit` and needs
no shell, so `seat-shell-availability` does not apply to what decomposition does. A single bounded
decomposition-only wake — deliver the 5 spooled intents, let `pm` create rows for 217/232/233/235–262, stop — costs
one `local/iq3_s` seat turn (the broker's last pass took **10 ms** of rig time; resident-broker days have landed
**314–741** items/day, `docs/reviews/wallclock-budget-2026-10-28.md`) and creates **no artifact**, so nothing can
reach `done` and no verifier is needed. Guarantees that stay OFF and must be named in the same breath: 253's
verifier-evidence clause, the 256 rehearsal, 217's shell, and every release/claim is still `pm`'s verb, not mine.

## What landed this session (delegate-scoped: no queue item claimed, no seat work done)

| Artifact | What it is | Verified by |
|---|---|---|
| `docs/runbooks/hygiene-and-dead-model-pointers.md` | the runbook the last session indexed but never wrote (D168 named it as owed). Covers: a seat shell that cannot spawn on this host, whether the **host / registration / guard** is at fault, a dead model pointer after a swap, and "is seat hygiene measured?" | every Diagnose command in it was run today; `node tools/doc-integrity-guard.mjs` → **0 hard** |
| `docs/runbooks/README.md` | the mangled index row restored (the previous session's row had been **glued into the row above it**, leaving its symptom text orphaned and its link deleted), **3** duplicate `tool-result-redacted` rows → 1, duplicate `security-trust-boundary-review` → 1, new row for the runbook, **3** new mechanism-index rows | guard + `git diff` (4 hunks) |
| `tools/transcript-recovery.mjs` | promoted from the gitignored scratch extractor, under GRANT 4 / ROADMAP 239, now honours 239's acceptance clause *"never writes a file without an explicit `--out`"* | without `--out`: prints `7,178 B` for `tools/doc-integrity-guard.mjs`, writes nothing; with `--out .spike/recovered-test`: writes 7,202 B |
| `tools/extract-pi-src.mjs` | promoted from `.spike/extract-pi-src.mjs`; recovers pi's TypeScript from installed `.js.map` `sourcesContent` | **83** source files from `@earendil-works/pi-durable` **1.3.0** (pin `2ec55d808d45`, 2026-10-19); recovered `src/tools/bash.ts` puts `createPowerShellTool` at **168** and the default `["pwsh","powershell"]` at **169** — the same lines as `vendor/pi-main`, so 217's citations are right |
| `tools/roadmap-queue-coverage.mjs` | "which registered items has no queue row naming them", with its denominator and its caveat | 0.9 s; 62 of 63 items ≥ 200 unrowed; CLAIMABLE 0 |
| `docs/ROADMAP.md` rows 239, 254 | 239's "the extractors are untracked" claim is now partly closed with the tracked paths named; 254's "a shim exists at `.spike/…`" (a false tree claim) now names `tools/model-probes/no-headers-timeout-shim.mjs` | `node tools/instrument-provenance.mjs` — see the trap below |

**Re-measured at clock-in (do not trust these next time):** 12 seats; `entries` **137,427**; worktrees **1** (this
checkout, `main`), branches **2**, `refs/rescued/*` **484**, `git fsck --unreachable` → **0** commits (GRANT 3 held);
`check rig.selfdev.json` → **61** findings (`verification-without-evidence` 1, `duplicate-item` 54,
`citation-unresolvable` 5, `evidence-tree` 1) and `single-model-rig` **passes** (a string comparison, D137);
served verifier `ministral-3-14b-reasoning` **@8192**, `recursivesi/flint` **NOT LOADED** (catalog `@q4_k_m` only);
`demo/local-model-pointer.test.mjs` → **PASS**; probe pre-flight → **exit 1** (MemAvailable 24.4 GiB, swap **6.1/8.0
GiB = 76 %**, GPU0 A4000 12,648/16,376 MiB, GPU1 3090 23,013/24,576 MiB, `strata` 51 GiB RSS / 40.7 GiB shmem), so
**no probe arm may start today** and OPERATOR OWES (b) is untouched.

## Pitfalls found (each cost me time; each has a cheap fix)

- **`documents.kind` values are JSON-quoted.** `WHERE kind='durig.queue'` returns **0 rows** while
  `GROUP BY kind` prints `durig.queue`; the stored value is `"\"durig.queue\""`. And the queue payload itself lives
  in `document_revisions` as `base`+`delta` rows, so it cannot be read with one `SELECT`. **Fix:** use
  `cli.mjs queue` (or `tools/roadmap-queue-coverage.mjs`), never a hand-rolled store query for queue state.
- **`instrument-provenance` counts a file you created ten seconds ago as "cited but untracked".** After promoting
  two instruments the finding went **3 → 5**, because the new `tools/*.mjs` were not yet in `git ls-files`.
  **Fix:** `git add` the promoted paths *before* re-running provenance, and read the number afterwards.
- **…and it cannot tell a live cite from a supersede-mention.** After the promotion, provenance still reports
  `UNTRACKED BUT CITED (1): .spike/extract-pi-src.mjs` — **7** mentions survive, all of them *about* the old scratch
  path (`docs/ROADMAP.md:4505` "promoted from", `docs/reviews/harness-tools-skills-research.md:273`, the archive). Deleting
  them would erase the provenance the tool exists to protect. **Fix (owed, 262's family):** let a cite be annotated as
  historical, or scope the check to cites that assert an instrument is *present*.
- **A `docs/runbooks/README.md` row can merge with its neighbour and nobody notices.** The orphaned symptom text
  survived with a different runbook's link cell. `doc-integrity-guard` catches a link to a missing file and a
  missing front matter block; it does **not** catch a malformed row. **Fix (owed to 262):** assert that every index
  row has exactly three cells and that its first cell resolves to a file in the directory.
- **`broker-serve --dry-run` is not idempotent.** Two runs ~1 min apart gave `2 blocking
  (provider-local-completion-failed, seat-shell-availability)` then `1 blocking`. A single failed provider probe is
  not proof a provider is dead — re-run before reporting (same lesson class as 254's transport ceiling).
- **A roadmap row's own wording can be the lie.** 254 said "a working shim exists today at `.spike/…`" — true when
  written, false after the promotion, and it is exactly what provenance flags as a cite no clone can check out.

## Proposals that would have shortened this session (and the next one)

1. **Land `tools/roadmap-queue-coverage.mjs`'s answer into the clock-in digest.** Four sessions re-derived "0
   claimable" by hand; the command costs 0.9 s and answers the question the operator actually asks ("will the team
   idle?").
2. **Make the 217 refusal name the coordinator exception.** `seat-shell-availability` blocks a start that would do
   zero shell work (`pm` decomposition). A `--pm-only` / coordinator-scoped variant, or the finding text naming the
   exception, turns a hard block into a decision. That is a **217-family** change for the team, not a bypass.
3. **Give `docs/runbooks/README.md`'s symptom table a shape check** (three cells, first cell = a real file) — 262's
   list, one more rule.
4. **Stop spooling to a down broker without naming the queue.** 5 intents now wait 65–1,398 min; spooling more is
   not progress. **GRANT 6 already grants decomposition "on next start", so the only thing actually missing is a
   ruling on whether the channel may run at all while 217 is unlanded** — put the question to the operator in those
   terms, or keep reporting the spool count as the blocker.
