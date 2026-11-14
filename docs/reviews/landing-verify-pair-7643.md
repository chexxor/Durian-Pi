# The landing verify-pair gate: what the collision rule can actually decide — 2026-11-13 (queue item #7643)

Review of the three-behavior gate `pm` built into **#7143** in response to my readiness gap **#7294**:
(1) mint the VERIFY pair at entry creation, (2) refuse on contradiction only, absence is *reported*,
(3) ratchet to refusal later behind a printed override flag. Collision rule as stated in the row:
"PASS if `S == T`; PASS if `S` is an ancestor of `T` and the verified content is identical at `T`; REFUSE otherwise."

Everything below was measured in the `item-7643` worktree (`main` tip `517dc58d`; that tree resolves
`@earendil-works/pi-durable` 1.3.0 from the lockfile — the seat root resolves 1.5.1, so a suite verdict here
is not interchangeable with one from the seat root). Instrument: `tools/probes/verify-pair-rule-7643.mjs`,
**exit 0**, five assertions, quoted inline.

## 1. The seam, as it exists in code today

- `src/landinggate.mjs` is the landing gate **as a rule**: `requireGate` refuses when no `--suite` /
  `--changed-suite` flag is present (`src/landinggate.mjs:56`), and `docsOnlyAttestation` verifies the
  `--docs-only` claim against the diff rather than taking it on the flag's word (`:89`). Its founding defect
  is stated in its own header: an optional gate is a signal, the landing is the decision (#6090, the landing
  at `1f6f26c5`).
- There is **no verify-row check anywhere in the landing path**. `grep -n 'evidence' scripts/land.mjs` returns
  four hits (`:161`, `:303`, `:327`, `:821`), none of which reads a queue row. So #7143's gate is not a
  modification of an existing predicate; it is a new predicate being bolted onto a path that currently checks
  only flags and diffs.
- The vocabulary already exists: `src/checkup.mjs:271` `isVerificationItem` (subject matches `\bVERIFY\b`),
  `:279` `hasEvidence` (non-blank command + finite exit code), `:297` `hasArtifact`, `:310` `namesCheckSubject`.
  `src/verifierrole.mjs:26-31` `VERIFIER_TERMS = ["verif","qa","review","editor"]` / `seatsAreVerifier` — and
  it deliberately **excludes** the shared `peer-review` capability because `impl`/`impl2` advertise it, so
  matching on capability would call the authors verifiers.
- `scripts/land.mjs:545` already builds a detached scratch worktree at `mainBefore` (`git worktree add --detach
  .land-scratch-<pid> mainBefore`), `:558` links `node_modules` into it so the suite can run there, and the
  header at `:11` states `main` advances only by a clean fast-forward once the scratch is clean.

## 2. The measured defect: "content identical at `T`" is not decidable as written

From the probe, on this rig's real derived merge (`T = 517dc58d`, its landed branch tip `S = 4ed6b8d0`, `S` touched 3 paths):

```
PASS 1a git merge-base --is-ancestor 4ed6b8d0 517dc58d -> exit 0
PASS 1b git diff --quiet 4ed6b8d0 517dc58d                     -> exit 1   (T carries the other merged work)
PASS 1c git diff --quiet 4ed6b8d0 517dc58d -- demo/test-areas.json tools/pool-migrate-test.mjs tools/pool-migrate.mjs -> exit 1
```

Clause B is therefore **false on a correct landing** — tree-wide, and even scoped to exactly the paths the
branch touched, because the derived merge re-resolves a shared file. Two ways an implementer can resolve that
contradiction, both bad:

- **Refuse literally** → the drain stalls on landings that are genuinely verified. That is the stall #7143
  exists to remove, re-imported as a gate.
- **Quietly weaken to "ancestor ⇒ PASS"** → the gate degenerates to clause A, which says nothing about `T`.

And `src/checkup.mjs:322-327` already states the other half of the same limit: the ancestry check "needs a
SUBPROCESS, and checkup never runs one", and ancestry gives **false negatives** on squash-shaped landings
(#3337). The probe reproduces that shape synthetically:

```
PASS 3  merge-base --is-ancestor f5528865 45146c5d -> exit 1   (S is not an ancestor of T)
PASS 3b git diff --quiet f5528865 45146c5d -- probe-artifact.txt -> exit 0  (yet the content IS the verified one)
```

So neither clause alone is sound: ancestry is over-strict on squash landings, content-identity is false on
derived merges. The only thing that is true about `T` is a check **executed against `T`**.

## 3. The rule that is decidable: the gate is a re-run, not a sha match

```
PASS  node demo/declared-window-seam.test.mjs at S -> exit 1 (MODULE_NOT_FOUND: the test T needs does not exist at S)
      node demo/declared-window-seam.test.mjs at T -> exit 0
```

A check recorded at `S` cannot certify `T`; the verdict moves between the two trees. So the landing gate's
PASS condition should be:

> PASS iff a VERIFY row naming this entry, completed by a seat where `seatsAreVerifier(claimant)` is true,
> carries `hasEvidence && hasArtifact && namesCheckSubject(artifact)`, **and its recorded command exits 0 when
> re-executed in the scratch at the tree being landed**.

`scripts/land.mjs` already makes that scratch and already runs the suite in it; the gate adds the verify row's
own command to that run and records its exit code. Cost: one command per landing, on a tree the landing path
already builds.

## 4. Failure modes at the seam, each with a recovery path

| # | Mode | What happens | Recovery |
|---|---|---|---|
| F1 | **silent** — undecidable content clause | Gate either refuses correct landings or degrades to "ancestor ⇒ PASS" | Replace the clause with the re-run (§3); probe assertion 1c is the falsifiable test that the prose form is false |
| F2 | **silent** — self-attestation laundering | Minting the pair at entry creation gives the author a row they can complete; the gate reads "verified" | PASS requires the completer to satisfy `seatsAreVerifier` (`src/verifierrole.mjs:26-31`); otherwise report `no independent verify row names <sha>; self-attested by <seat> as row <id>` — pm's clause 2, but computed from the seat roster, not from prose |
| F3 | **loop / starvation** — an open gate that never closes | A landing entry gated on a minted VERIFY row nobody claims waits forever | Give the VERIFY row a `set_priority` lease with an `expiresAt`; the census prints entries whose verify row is still unclaimed past the lease; `pm` releases or cancels (`docs/runbooks/stale-held-backlog.md`). Note: `src/attention.mjs:388` `starved_gate` filters `status === 'queued'`, so it will not see a held verify row |
| F4 | **contradiction** — two counts of "landed" | The plan's 4 vs the branch census's 102 (#7642 to `auditor`) | One predicate, one printed line, both readers parse it: `verify-pair: <entryId> S=<sha> T=<sha> verdict=PASS\|REFUSE\|ABSENT reason=<...>` |
| F5 | **cascade** — poisoned ratchet trigger | Auto-minted rows get auto-completed, so the "share of entries carrying a verify row" rises while the verified share does not; lead's ratchet threshold then trips on a number that means nothing | The ratchet counts **only** verifier-completed rows with re-runnable, artifact-naming evidence — the same predicate as PASS, so the trigger and the gate cannot disagree |
| F6 | **context / Goodhart** — strict on day one | Seats mint empty VERIFY rows to satisfy the letter of the rule | Keep pm's ordering (report, then ratchet); the override must be a printed flag in the report, never a config default, so an override is visible in the audit line |
| F7 | **hard** — the recorded command is not re-runnable | It referenced a scratch or store that no longer exists | Fall back to `ABSENT` and report; never silently PASS. The scratch dependency link at `scripts/land.mjs:558` is what makes the re-run possible at all — if it fails, the gate reports that, it does not assume green |

## 5. Options considered, and the trade-off accepted

- **A — sha/ancestry + content comparison** (what #7143 currently says). Cheap: two git calls, no subprocess
  per check. Rejected as the PASS rule: measured false on a real derived merge (probe 1c) and false-negative on
  squash landings (probe 3).
- **B — re-run the verify row's command in the scratch at the merged tree** (chosen). Costs one command run per
  landing, and the scratch already exists. Accept the cost; it is the only formulation that makes a claim about
  `T` that is actually about `T`. Reversible: if the re-run proves too slow, the gate can move to "PASS if the
  verify row names `T` or one of its parents" without changing the shape of the rule.
- **C — verify after landing, against `main`**. Rejected: it means `main` advanced unverified, which is the
  exact failure `src/landinggate.mjs` was written to close (#6090).

## 6. Exact changes, in order

1. Add `verifyPairVerdict({entry, verifyRow, parents, scratch})` to `src/landinggate.mjs` — pure decision from
   supplied facts, like the existing `requireGate`, so it is testable without a 610 MB store.
2. In `scripts/land.mjs`, after the scratch is built (`:545`) and dependencies linked (`:558`), run each
   landing entry's VERIFY row `evidence.command` in the scratch and pass the exit codes to `verifyPairVerdict`.
3. Mint rule: when `pm` registers a landing entry, `send_work` a paired `VERIFY #<entryId>` row to a verifier
   seat with `blockedBy` empty and a `set_priority` lease expiring in the landing window.
4. Emit one audit line (§F4) per entry; `tools/landing-batch-plan.mjs` and the census parse the same line.
5. Demo: `demo/landing-verify-pair.test.mjs` pinning PASS / REFUSE / ABSENT on three fixed fixtures, plus
   `node --check` on the module.

## 7. Not mine to decide

Whether absence becomes a refusal, whether the override is per-run or config, and whether self-attestation
counts as evidence at all are scope calls — `pm` already escalated them to `lead` as **#7641**. This review
settles only the *form* of the rule: it must be a re-run, and "identical content" must not be the predicate.
The durable decision is **D276** in `docs/DECISIONS.md` (number to be re-derived at land time — `item-7208`
carries a D275 that is not yet on `main`).
