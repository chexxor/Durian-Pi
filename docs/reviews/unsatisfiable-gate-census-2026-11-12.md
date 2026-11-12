# The unsatisfiable-gate census — 2026-11-12 (queue item #7172)

Read-only enumeration for the N35 cleanup. Every number below was produced by a command named at the
end of each section, run in the `item-7172` worktree against the live store
(`DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite`) and the live tree (`main` tip at read time:
`60380781`). No row was claimed, released, cancelled or routed — `pm` holds those transitions
(`docs/runbooks/stale-held-backlog.md` §Do).

## 1. First, the naming problem: `cli.mjs check` has no such rule

`node cli.mjs check rig.selfdev.json` → **exit 0, 175 findings**, and the 33 rules in `src/checkup.mjs`
are: constitution-missing, constitution-not-applied, unreachable-seat, dangling-edge, store-missing-seat,
stray-seat, no-verifier-seat, single-model-rig, seat-without-capabilities, runbook-stale, runbook-unverified,
runbook-front-matter, ownership-seat-missing, verification-without-evidence, evidence-tree,
citation-unresolvable, feature-row-missing, duplicate-item, shared-tree-on-main, commit-message-encoding,
text-integrity, context-over-window, doc-count-drift.

**There is no `unsatisfiable-gate` rule.** `grep -rn "unsatisf" src/ cli.mjs docs/` returns no rule, and
`docs/SELF-ADMIN.md:205` says so in words: a `check` rule "must report rows gated on a terminal or
nonexistent id, **which today nothing does**". So the enumeration cannot come from `check`; it had to be
built from the queue document itself. The instrument that exists is `tools/held-gate-audit.mjs` (#6071),
and it does not use the phrase either — its classes are release-candidate / cancel-candidate /
standing-rule / gate-open / unattributed, and it reads **held rows only** (428 of them), never the 524
deferred rows.

## 2. What "unsatisfiable" means here, from the code, not from prose

- `src/rig.mjs:319` `deadGateId(item, items)` returns the first `blockedBy` id whose row is `cancelled`.
- `src/rig.mjs:327` `workable()` returns `gate-cancelled:#<id>` for that row, and `gate-open:#<id>(<status>)`
  for a live gate. A gate id that names **no row at all** is treated conservatively as satisfied (continue).
- `src/rig.mjs:1416` `release_work` is **REFUSED** for a parked row whose gate names a cancelled row:
  "not released: its gate names #N, which is cancelled — releasing it would make a row claimable whose
  prerequisite was dropped".
- `src/rig.mjs:211` `cancelItem()` writes the cancellation and sends a notice, and **touches no
  dependent row**. That is the accumulation mechanism: cancelling a gate silently leaves every row that
  named it gated on an id that can never close.
- There is no verb to remove a gate. `normalizeBlockedBy` (`src/rig.mjs:434`) validates shape at write
  time only — it does not check existence or terminality of the ids. So the only repair is
  **cancel + re-mint**, exactly as `docs/SELF-ADMIN.md:205` proposes.

Pinned by demos, run here: `node demo/workable-claim.test.mjs` exit 0; `node demo/pm-release-authority.test.mjs`
exit 0 ("a dead gate is refused"); `node demo/held-gate-audit.test.mjs` exit 0.

## 3. The census

From `node cli.mjs queue --json` (unbounded: **7,183 rows**, `bounded: null` — the capped
`queue --held --with-gates` view is capped at `GATE_VIEW_CAP = 200` (`src/queue-lifecycle.mjs:366`) and
would have truncated a 428-row held census, so it was not used):

- non-terminal rows: **1,501** (held 428, deferred 524, queued 535, claimed 14)
- rows carrying a structured `blockedBy`: **244**, with **290** gate references
- those references resolve to: **105 done**, **19 cancelled**, **0 nonexistent**, **166 still open**
- **0** rows are `queued` with a dead gate — so nothing is currently "registered but unclaimable"; all 19
  dead-gated rows are parked, which is why nothing in `status` screams.

## 4. The 19 rows whose recorded gate can never close

Every one has exactly one dead gate. `in-main` is `git merge-base --is-ancestor <sha> main`, exit 0.

| row | to | status | dead gate | why that gate died | artifact named | disposition |
|---|---|---|---|---|---|---|
| #3377 | impl | held | #3343 | reissued; the ledger union landed as ffa2ab3 (#3326 done) | e08d1a9, e3a67b1704, fa4e03d414 — all IN MAIN | content already merged → close; re-mint only if the mint-order entry still needs processing |
| #3452 | impl | held | #3274 | SUPERSEDED: the provider-field premise no longer describes the rig | 53fd8c6f8, bcf1a191c — UNLANDED | premise dead → cancel; the two branches still need a separate landing decision |
| #3456 | impl | held | #3455 | SATISFIED — landed as cc82331, verified by #3276 (done) | 9de833f, c304976, cc82331 — IN MAIN | fulfilled → cancel |
| #3663 | impl | held | #3660 | duplicate of #3659, which is done and VERIFIED | ca7c19c — IN MAIN | fulfilled → cancel |
| #4852 | impl | held | #4847 | re-minted as lead's ruling #4864 (done), which maps 221→#4852 and names gate #4849 (done) | none | still needed → re-mint with the live gate #4849, not the dead #4847 |
| #4853 | impl | held | #4847 | same | none | still needed → re-mint |
| #5816 | impl | held | #5815 | superseded by #6454 (done), which verified f458a129 on main 46cd5234 | f458a129 — IN MAIN | fulfilled → cancel |
| #5817 | impl | held | #5815 | same | f458a129 — IN MAIN | **identical subject AND body to #5816** — duplicate; cancel both |
| #5925 | lead | deferred | #5924 | duplicate of #5923, which is deferred and under supervisor escalation | none | still owed → re-gate on #5923, or cancel and keep #5923 |
| #5940 | qa | deferred | #5937 | absorbed into #6082 (done) and #6118 (done) | e1169548, bf1412c5 — IN MAIN | the absorbing work landed; the A/B probe itself is still owed → re-gate on ROADMAP 331's open half |
| #5942 | scribe | deferred | #5937 | same | none | `docs/runbooks/continuation-notes.md` already exists → fulfilled → cancel |
| #5947 | impl | deferred | #5945 | superseded by #6454 (done) | 6fe48480 — IN MAIN | fulfilled → cancel (note #5948 is gated on this row) |
| #5953 | devtools | held | #5945 | superseded by #6454 (done); row also has a LIVE gate #5947 (deferred) | 2ec555d808d45 — an UPSTREAM sha, not ours | genuinely still open (schedule park, reviewBy 2026-11-16, resolver operator): drop the dead id, keep the schedule park |
| #5954 | devtools | held | #5945 | same, also live gate #5947 | 2ec555d808d45 | **identical subject AND body to #5953** — duplicate; keep one, cancel the other |
| #5973 | impl | deferred | #5968 | duplicate of #5967, **which is itself cancelled** — the whole chain is dead | 478d5f5a — IN MAIN | fulfilled by #6454 → cancel |
| #5988 | devtools | held | #5986 | cancelled because the auditor seat failed `no_model` this session | none | **still needed** — and this is the very rule N35 wants: `src/checkup.mjs` has no gate-integrity rule |
| #5990 | devtools | deferred | #5989 | same `no_model` reason | none | still needed — only `demo/release-terminal-first.test.mjs` and `demo/pm-release-authority.test.mjs` exist for terminal-vs-authority |
| #5994 | impl | deferred | #5993 | superseded by #6454 (done) | 9129d33 — IN MAIN | fulfilled → cancel |
| #6005 | impl | deferred | #6003 | superseded by #6454 (done); the row's other gate #6004 is done | 67ef6d2 — IN MAIN | fulfilled → cancel |

## 5. Six more rows are stuck one level deeper (25 in total)

A gate whose target is itself parked behind a dead gate is equally unsatisfiable. Chains (measured by
walking `blockedBy` transitively):

- #3503 (scribe, held) → #3377 → **#3343 cancelled**
- #5885 (pm, held) → #3377 → **#3343 cancelled**
- #4854 (devtools, held) → #4852 → **#4847 cancelled**
- #4855 (devtools, held) → #4853 / #4852 → **#4847 cancelled**
- #4857 (qa, held) → #4855 → #4853 → #4852 → **#4847 cancelled**
- #5948 (scribe, deferred) → #5947 → **#5945 cancelled**

**Total: 25 rows.** That is the number lead measured on 2026-11-11, and it is the right number for the
cleanup — but it is not the same set the audit tool reports.

## 6. Reconciling the two "25"s

`node tools/held-gate-audit.mjs` (exit 0, `rows=7202 held=428`) reports **25 release-candidates**:
1582, 2144, 2149, 2190, 2598, 2681, 3419, 3452, 3456, 3460, 3535, 3552, 3607, 3663, 4269, 4339, 5059,
5517, 5659, 5660, 5826, 5918, 6186, 6249, 6337. Only **3** of those (3452, 3456, 3663) have a cancelled
gate; the other 22 have gates that are all **done** — stale parks, not dead gates. And the tool misses
the 524 deferred rows entirely.

So: 19 rows have a directly dead gate; 25 including chains; the audit tool's 25 is a third, different
set. Naming one number without saying which definition produced it is how this cleanup goes wrong.

## 7. Defects found in passing, with the exact fix

1. **`tools/held-gate-audit.mjs` advertises a flag it does not implement.** Its usage line
   (`tools/held-gate-audit.mjs:14`) says `[--seat <name>] [--ids <id> ...]`, but `parseArgs` (line 40)
   accepts only `db, limit, seat, json` plus bare ids. `node tools/held-gate-audit.mjs --ids 3377` →
   exit 1, "unknown argument: --ids". Fix: add `"ids"` to the `KNOWN` set and consume the following
   tokens, or delete `--ids` from the usage line. Bare ids already work and are what the runbook shows.
2. **The census cannot see deferred rows.** `auditHeldRows` is scoped to `status === "held"`
   (`rows=428`), so 524 deferred rows with dead gates are invisible to the only classifier that exists.
   Fix: widen the scope to "parked" (held + deferred) and report the status in the class line.
3. **No gate-integrity rule in `check`.** A rule of the shape `dead-gate` (severity warning, non-terminal
   row whose `blockedBy` names a cancelled id, reporting the chain) is cheap, model-free, and would make
   this whole class queryable instead of a one-off audit.

## Verify

```bash
node cli.mjs check rig.selfdev.json            # exit 0, 175 findings, no gate rule
node tools/held-gate-audit.mjs                 # exit 0, release-candidate: 25
node demo/workable-claim.test.mjs              # exit 0  (cancelled gate = gate-cancelled)
node demo/pm-release-authority.test.mjs        # exit 0  (release refused on a dead gate)
node demo/held-gate-audit.test.mjs             # exit 0  (the five classes are pinned)
node tools/held-gate-audit.mjs --ids 3377      # exit 1  (the advertised flag does not exist)
```
