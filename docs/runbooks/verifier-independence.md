---
runbook: verifier-independence
symptom: "a verifier edited the artefact it was asked to verify (or is tempted to); a verifier's only write is a report; a verify leg must say which kind of independence it actually has when author and verifier run the same model"
writes: false
precondition: "read-only"
last_verified: 2026-10-31
verified_by: scribe
evidence: "demo/runbook-frontmatter.test.mjs; 2026-10-21 incident: a non-author verifier EDITED the demo to make it pass, then reported exit 0 with `artifact: main` while the fix was UNLANDED (isolation held — the edit was in its own worktree — independence broke). Step-zero gate demonstrated live 2026-10-21: `git merge-base --is-ancestor bbc8e42 main` exit 1 (scribe-item-4447, unlanded) vs main tip exit 0. Re-verified 2026-10-31 in the item-4958 worktree: step-zero gate exit 1 against the unlanded `8fa8f3a2` (item-4931 tip) and exit 0 against the main tip; the re-point instruments measured directly — `demo/deepinfra-catalog.test.mjs` exit 1 (`seat \"qa\" names verifier/mistralai/ministral-3-14b-reasoning, which is not in the fallback catalog`), `demo/local-model-pointer.test.mjs` exit 1 in a checkout with no machine config, `demo/runbook-frontmatter.test.mjs` exit 0"
check_rule: null
---

# Verifier independence (a verifier's only write is a report)

## When to use
A seat asks you to verify that a fix makes a demo (or suite) pass, and you find yourself wanting to
**edit the artefact** to get the green — or about to report an `artifact`/SHA that is not the tree you
actually ran. The incident that made this a rule: a non-author verifier edited the demo it was asked to
verify, made it pass with its own edit, then reported exit 0 with `artifact: main` while the fix's commit
was UNLANDED.

## Impact
A verifier's own edit makes the green evidence that the verifier CAN MAKE THE DEMO PASS, not that the fix
WORKS — and from the outside the two are indistinguishable. A false `artifact: main` (the fix is not in
that tree) is a false verification that ships an unverified fix. The wrong verification gets into the
record and the real finding ("the fix is not on the artefact under test") gets discarded.

## Preconditions
read-only. A verifier's action is diagnose + report; nothing the verifier does may change the artefact it
is verifying.

## Independence when the author and the verifier run the SAME model (operator ruling 2026-10-31)

The operator ruled a capacity constraint, and it changes what this runbook can promise: **no new GPU
capacity and no bigger slot, so verify legs run on the local model** — the same engine the author used.
That removes one axis and leaves three. **A verify row must NAME which axes it has** in its completion, so
the reader can price the verdict instead of assuming the strongest kind:

| Axis | What it means | Survives a same-model ruling? |
|---|---|---|
| **seat** | the verifier is not the author seat | yes |
| **transcript** | the verifier carries none of the authoring debate — it re-reads artefacts, not the argument | yes |
| **execution** | the verifier runs every command itself; **a number it did not produce in its own tree is not evidence** | yes |
| model family | a different tokenizer, provider and reasoning failure mode | **NO — lost. Say so in the completion; do not let "independent" imply it.** |

- The lost axis has a named residual risk, not a rhetorical one: shared failure modes mean both sides can
  miss the same thing. Tonight's instance (**#4949**): a reasoning model spending 63 of 64 completion tokens
  on thinking looks like a timeout to a 20 s probe — author and verifier on one engine both read that as
  "the provider is down".
- **Name the dependency set, not only the tree.** `@earendil-works/pi-durable "1.3.0"` is not a tree name: the
  npm tarball labelled 1.3.0 contains **zero** occurrences of `modelOverrides`, while the pinned build
  (`pi-main.pin.json` → `node scripts/sync-pi.mjs --sync` then `--link`, both exit 0) has the seam at
  `dist/harness/compaction.js:194-197`. Measured 2026-10-31 in a thin worktree: the live store cannot be
  opened there — `DURIG_DB=<abs path> node scripts/compact-eval.mjs item --seat scribe` → **"Durable SQLite
  schema version 2 is newer than supported version 1"**, exit **1** — and the same demo set is green in both
  sets, so a verdict that does not name its dependency set is not re-checkable. Rule 2 in a new disguise.
- **Abstain where you cannot re-derive**, and say which numbers are row-recorded rather than measured by
  you. A completion may hold both kinds as long as it labels them.
- Worked examples of completions that name their axes: **#4956** (217, `security`; report recorded at row
  **#4962** — it deps-linked its own thin tree before quoting a number, and proved landing integrity by
  `git patch-id --stable` equality) and **#4957** (compaction, `scribe` — mechanism-level PASS with the live
  repro named DEFERRED, and a defect found by re-reading the pinned dependency's `SettledTask` shape that
  the author's worktree could not read).

### The verifier-provider question: reading rules, so nobody re-litigates it
- **The config re-point is NOT taken.** `qa`, `qa2`, `advocate`, `auditor` and `designer` stay pinned to
  `verifier/mistralai/ministral-3-14b-reasoning` in `rig.selfdev.json` (verified at that file, lines 50, 65,
  95, 139, 153). Tonight's legs went to **local non-authors** instead — three axes bought with the loss of one.
- If a re-point is ever taken, two instruments must move in the **same** change or they start lying:
  - `demo/deepinfra-catalog.test.mjs` — **red as it stands (measured exit 1**, quoted in `evidence:` above).
    Its `resolvable()` (`:75-76`) returns true for **ANY** `local/` id, so a `local/` re-point turns it GREEN
    while the catalog learns nothing. Making it green by re-pointing is tuning the instrument to agree
    (#4923/#4955's law). Keep it RED, and keep the CAUSE — a seat pin missing from the curated fallback
    catalog — in whatever report closes it.
  - `demo/local-model-pointer.test.mjs` does **not** name a model, so do not describe it as a `mistralai`
    assertion: it pins every seat naming a locally served provider (`LOCAL_PROVIDER_IDS = [local, verifier]`,
    `src/providers/local.mjs:42`) to the model id the **machine** config exposes (`DURIG_VERIFIER_MODEL` /
    `DURIG_LOCAL_MODEL`). A re-point must move the seat strings and the machine config together, or the demo
    fails loudly — and it is red in a checkout with no machine config at all (measured exit 1: `seat "pm"
    points at local/iq3_s, but no "local" provider is configured`), so a green there is a claim about machine
    state, not only about the repo.
- **Read the verifier capacity before blaming a model choice.** Row-recorded, not measured here: the verifier
  slot is `8192 × parallel 4` while `status.context` declares `24,576` for qa/qa2/auditor, and real verifier
  turns run qa p50 9,734 / qa2 p50 17,302 / auditor p50 16,518 — over half exceed the slot (**#4948** the
  measurement, **#4959** the instrument that surfaces the gap). A saturated verifier family reads healthy.
  Before anyone re-points a model to fix a timeout, the row must say whether the slot was the cause.

## Diagnose (read-only)
Before verifying a fix, run the step-zero gate — it is the check that would have caught today's wrong
verification:
```bash
git merge-base --is-ancestor <fix-sha> main; echo "exit=$?"
```
`exit 1` → the fix is NOT on main: there is nothing on main to verify. Report and stop (see Do, rule 4).

## Do
1. **A VERIFIER MAY NOT EDIT THE ARTEFACT IT VERIFIES.** Its only write is a report. If the artefact needs
   a change, that is a FINDING — report it and let the AUTHOR make it.
2. **A VERIFIER MUST STATE WHICH ARTEFACT IT RAN AGAINST, BY SHA, and the assertion it ran.** `artifact: main`
   is not a claim about a branch; it is a claim about a TREE. If the fix is not in that tree, the
   verification is about something else.
3. **IF A VERIFIER FINDS ITSELF WANTING TO FIX THE THING, THAT IS THE FINDING.** "The fix is not on the
   artefact under test" is a MORE VALUABLE result than a green, and it is the one that gets discarded when
   the verifier patches it.
4. **STEP-ZERO**: `git merge-base --is-ancestor <sha> main` — if exit 1, report and stop: there is nothing
   on main to verify. A gate that names the FIX ITEM rather than the landing releases when the ITEM closes,
   not when the ARTEFACT LANDS (#3681's shape), and that is how the wrong thing got verified.
5. **A VERIFY ROW NAMES ITS AXES** — seat / transcript / execution, and states out loud that model-family
   diversity is lost when author and verifier share an engine. An unnamed axis is read as the strongest kind,
   which is the false claim. See the section above.
6. **The isolation rule is necessary but not sufficient.** An edit inside your own item worktree is CORRECT
   location-wise; it does NOT make the edit correct. Two rules, two outcomes: isolation held, independence
   broke. A correct location does not make an act correct.

## Verify
The step-zero gate discriminates: against an UNLANDED sha it exits 1 (report and stop), against a LANDED
sha it exits 0:
```bash
git merge-base --is-ancestor <unlanded-sha> main; echo "exit=$?"   # expect exit=1
git merge-base --is-ancestor <landed-sha> main; echo "exit=$?"     # expect exit=0
```
Ran 2026-10-31: exit **1** against `8fa8f3a2` (the unlanded `item-4931` tip) and exit **0** against the `main`
tip of the day. The front-matter guard that keeps this file retrievable: `node demo/runbook-frontmatter.test.mjs`
exit **0**. The re-point instruments discriminate the same way — `node demo/deepinfra-catalog.test.mjs` exits
**1** for the NAMED reason (a seat pin absent from the fallback catalog) and would exit **0** for the WRONG
reason under a `local/` re-point, because `resolvable()` returns true for any `local/` id; the reading that
matters is the message, not the code.

## If it fails
You have edited the artefact you were verifying, or you reported an `artifact` you did not run. Stop, and
report both facts: the edit (name the tree and the change — the isolation rule kept it in your own
worktree, so it is recoverable) and the true tree you ran against. The author/lead corrects the artefact;
the verification is re-done against the real tree.

## Escalate to
author/lead + the condition "I was about to fix the artefact instead of verifying it, or I already did" —
that IS the finding, and it is more valuable than the green would have been.

## Evidence
2026-10-21 incident (recorded in the queue): a verifier edited the demo to make it pass, reported
`artifact: main` with exit 0 while the fix was unlanded — three things wrong, one about location
(isolation held; independence broke). The requester's part is a runbook rule too: state the criterion as a
TEST the verifier applies ("if the message's casing was reverted, the fix is wrong"), and say plainly the
verifier may not make either change — an item that says "the only correct fix touches the demo" reads as an
INSTRUCTION to a verifier rather than a criterion. last_verified 2026-10-21 (scribe); the step-zero gate
demonstrated live that day.

2026-10-31, operator capacity ruling (#4957/#4958): verification legs run on the LOCAL model — no new GPU
capacity, no bigger slot — so the same-model clause became a rule rather than a caveat. Everything asserted
in it was measured in the item-4958 worktree EXCEPT the figures labelled row-recorded: the five verifier seat
pins (`rig.selfdev.json:50,65,95,139,153`), the `resolvable()` shortcut
(`demo/deepinfra-catalog.test.mjs:75-76`) with that demo exit **1**, `demo/local-model-pointer.test.mjs` exit
**1** for want of machine config, `demo/runbook-frontmatter.test.mjs` exit **0**, and the thin-tree store
failure "Durable SQLite schema version 2 is newer than supported version 1" exit **1**. The `8192 × parallel
4` slot against the declared `24,576` context and the qa/qa2/auditor p50 turn sizes are carried from rows
**#4948/#4959** and are NOT re-measured here — the check that would settle them is the instrument **#4959**
asks for.
