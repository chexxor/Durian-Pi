# Where the seams actually are — mode decision, gate composition, the writer of `main`

Item **#6926** (pm → architect). Read as an intent: name the three places where the work-item model
decides something irreversible, and for each, the contract, the defect measured in this tree, the failure
mode, and the recovery path.

**Tree this review is true of:** branch `item-6926` @ `1bbe8f34`, **Linux**, Fedora Linux 45, kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, `git version 2.56.0`. Every path:line below was read or run in
that tree; two probes were executed here and their exit codes are stated.

**Topology before the argument.** There is exactly one ref namespace. A seat's worktree is a *linked*
worktree of the same repository, so every ref — `main`, `staging`, every `item-<id>` — is visible and
writable from every seat's tree by ordinary git. The only thing between a seat and `main` is the confinement
list in `src/confine.mjs`. That single fact is what makes all three seams below one problem: **the model
describes actors ("operator only", "a different seat verifies", "branchless by default") where the rig has
only one mechanism — a verb's exit code.**

---

## Seam 1 — the mode decision: decided nowhere in code

**Intended contract.** `docs/WORK-ITEM-MODEL.md` §3: default is branchless; a worktree is granted only on a
demonstrated need, decided at claim time.

**What the code does.** There is no mode. `src/seattools.mjs:162` calls
`prepareSeatWorkspace({ source, itemId, seatName, base })` — unconditionally — and
`src/worktree.mjs:966` mints a ref and a full checkout (`createWorktree` at `src/worktree.mjs:286`,
`installWorktreeDeps` at `:231`, called at `:861`). Grepping the whole of `src/` for
`branchless|executionMode` returns **zero hits**. The predicate the model says to use,
`isDocumentationPath` (`src/landinggate.mjs:45`), is applied only at `src/landinggate.mjs:98` — i.e. **at
landing, after the tree was already minted and the work already committed**.

**Failure modes.**
1. **Silent (rule with no enforcement).** The measured cost is already in the model: 84 refs / 75
   worktrees, 46 clean unmerged refs on terminal items. A prose rule that is never compared to the git
   state cannot fail, so it drifts. *Recovery:* mint the mode as a field at intake, and add the
   `branchless-violation` checkup rule (§9) that compares recorded mode against `git worktree list`.
2. **Partial (misclassification in the other direction).** A "prose-only" item whose acceptance names a
   probe or a demo has no tree to run in. Today `src/seatguard.mjs:164` refuses a mutating command in the
   shared tree, so such a seat fails closed — good — but with an error that names the guard, not the mode.
   *Recovery:* rule 2 of the predicate must read the **acceptance text**, not just the file extension; a
   branchless item that needs to run anything gets a scratch tree minted by the rig at apply time, not by
   the seat.
3. **Contradiction (two readers of one predicate).** The same function decides "needs a tree" and "cannot
   break a test" at two different moments. If either is edited independently, the two judgements diverge.
   *Recovery:* one function, one call site per decision; the mode recorded on the row so the landing gate
   reads a *decision* rather than re-deriving it.

**Falsifier.** `node demo/<name>.test.mjs` on the mocked plane: claim a docs-only item, assert
`git worktree list | wc -l` is **equal before and after** (equality, not "one fewer"), and assert a code
item still mints one. Until that demo exists, §3 of the model is a wish, not a rule.

---

## Seam 2 — the gate composition is complete for the suite and empty for the verifier

**Intended contract.** `WORK-ITEM-MODEL.md` §6: land only if (a) a `verify` row from **a different seat** is
done, (b) its `evidence` names the tip being advanced, (c) `git merge-tree` is clean, (d) the gate exits 0.

**What the code does, and what is genuinely good.** The gate is a rule, not a habit:
`requireGate` (`src/landinggate.mjs:57`) refuses a landing with no gate flag before `land.mjs` touches git;
`report()` (`scripts/land.mjs:123`) prints and `process.exit(code)`, so a refusal is terminal and cannot fall
through; a derived gate whose set is empty is refused as *no coverage, not a pass* (`scripts/land.mjs:730`);
`--docs-only` is an attestation checked against the diff (`src/landinggate.mjs:92`), not taken on the flag's
word; `main` advances only by a clean fast-forward of the scratch head (`scripts/land.mjs:1040`).

**The defect.** Grepping `scripts/land.mjs` for `verify|evidence` returns only a worktree-name regex
(`:340`) and a test filename (`:814`). **The landing gate does not read the verify row at all.** It composes
`{argv, diff, suite exit}` — conditions (a) and (b) are not implemented anywhere.

**Failure modes.**
1. **Silent — self-attestation.** The author's own green is the whole gate. A landing whose only evidence is
   "the author ran it" is indistinguishable from one a verifier confirmed. *Recovery:* the verb reads the
   store through the broker read seam, requires a `verify` row whose `status` is `done` and whose
   `evidence.artifact` names the exact sha being fast-forwarded; refuses otherwise.
2. **Contradiction — tip drift.** If the verify names sha X and the branch tip has moved to Y (X an
   ancestor of Y), an ancestry check passes while the verified artifact is not the landed artifact. This is
   the same class as `#5681`: judgement by **presence of the named artifact**, not by ancestry. *Recovery:*
   compare literal shas, not genealogy; print both shas in the refusal.
3. **Cascade.** An unverified tip on `staging` is inherited by every later landing on `staging`, so one bad
   landing makes every subsequent "gated" landing partly unverified. *Recovery:* the promote verb (which does
   not exist yet — see seam 3) re-runs the full suite over the merged result exactly once.

**Falsifier.** A demo that forges a landing where the verify row names an ancestor sha and asserts
`land.mjs` exits 1 with a message naming both shas. Until it exists, §6 step 3 is documentation.

---

## Seam 3 — "the operator is the only writer of `main`" is a convention, not a structure

**Measured here.** Two probes, run in this tree:

```
node tools/probes/main-writer-surface-6926.mjs   # exit 0
  REFUSED 0 · ALLOWED 8 of 8
  ALLOWED: git update-ref refs/heads/main <sha>; git merge --ff-only main; git branch -f main item-6926;
           git worktree add /tmp/x main; node cli.mjs promote   (no such verb exists)
node tools/probes/main-ref-writer-falsifier-6926.mjs   # exit 1 = NOT PROTECTED
  probe-main before : 3745a1f68480
  git update-ref refs/heads/probe-main <seat sha>  run FROM a linked worktree → git exit 0
  probe-main after  : 06058fc830a3
```

A command issued inside a seat's own worktree moved a ref it does not own, with no file touched. Linked
worktrees share the ref namespace, so the same holds for the real `refs/heads/main`. The guard knows:
`src/confine.mjs:498` lists `update-ref` in `GIT_WRITING_CLAIMED` with the comment *"runbook-prescribed; can
move any ref, including refs/heads/main - named as open"*, and `:401` says as much. There is **no promote
verb**: grepping `src/` and `scripts/` for `promote` finds no implementation, and the only code that advances
`main` is `scripts/land.mjs:1040`.

**Failure modes.**
1. **Silent — unbounded writer.** Any seat can advance `main` with a routine git verb, bypassing the gate,
   the verify row and the evidence print. Nothing downstream detects it. *Recovery:* deny-list the verb by
   target — a ref-writing verb whose argument names `refs/heads/main` or `refs/heads/staging` is refused for
   a seat (mirrors the existing `push` denial in `src/confine.mjs:206-217`).
2. **Blocklist-by-omission.** The verbs that can move a ref are not just `update-ref`: `branch -f`,
   `merge --ff-only`, `commit` made in main's tree, `reset --hard` on main, `worktree add` + commit. A
   deny-list fails exactly when a new verb is added. *Recovery:* enumerate the capable verbs in the demo and
   assert refusal for each; the enumeration is the spec.
3. **Contradiction — two definitions of blessed.** If both the rig and a seat can move `main`, the ancestry
   checks in the branch census measure a ref nobody recorded. *Recovery:* the promote verb prints the
   evidence (refs merged in order, suite pass/fail **with its exit code**, `merge-base --is-ancestor` per
   merged ref, parent count) so `main`'s history carries its own audit trail.

**Options considered, and the trade-off accepted.**
- **(a) Deny ref-writing verbs aimed at `main`/`staging` in `src/confine.mjs`.** Cheap, reversible,
  falsifiable by a planted-command demo. Accepted cost: it is a blocklist, so completeness is a property of
  the enumeration, not of git.
- **(b) Allow-list at the verb boundary**: a seat may write only `refs/heads/item-<id>`; the rig writes the
  blessed refs. Requires a ref-target parser on every git verb. Stronger, but every future verb must
  remember to parse. Accepted as the durable target, after (a).
- **(c) A separate mirror repository for `main`.** Structurally airtight; breaks the single-writer store and
  doubles the read seam. Rejected — the cost is paid on every read, the benefit is only against a guard bug.

**Decision taken here (reversible):** mint the promote verb as the *only* legitimate path, then close the
convention gap with (a) plus the demo that plants each capable verb. Until that lands, the honest statement of
the model is: *the rig advances `main` by convention; nothing stops a seat from advancing it.*

---

## What this item is NOT

- Not a build. No verb was implemented here; the probes are instruments, not the fix.
- Not a scope ruling: whether the mode decision ships before or after the promote verb is `lead`'s call.
  Routing for both is recorded in `#6900`.

## Re-verify

```bash
node tools/probes/main-writer-surface-6926.mjs          # exit 0, "8 of 8 allowed"
node tools/probes/main-ref-writer-falsifier-6926.mjs    # exit 1, "NOT PROTECTED"
grep -n "requireGate" src/landinggate.mjs               # the gate is required
grep -n "verify\|evidence" scripts/land.mjs             # no verifier binding at the gate
grep -rn "branchless\|executionMode" src/               # zero hits: no mode exists in code
git log -1 --format=%p refs/heads/main                  # parent count, the structural check
```
If a probe's number moves, the **document** is wrong — re-run and correct it here.
