# A content check that compares whole lines reports false absence (#7388)

Architect note, 2026-11-12. Tree: branch `item-7388`; `@earendil-works/pi-durable` **1.3.0** from this
worktree's lockfile (seat root 1.5.1 - not comparable). Host: Linux, kernel `7.2.15-300.fc45.x86_64`,
Fedora 45, node v24.22.1.

## What was cancelled, and what I checked

pm cancelled #5421 ("LANDING LIST - item-4879 @3c4973c9") with the reason: **"artifact already fully on main
per queue-drain-audit"**. Ancestry is a fast path (#3337), so I checked content:

`node tools/probes/cancel-claim-content-check-7388.mjs 3c4973c99c9a879dea06b857fa9ec8208a40304a` → **exit 0**:
`commit 3c4973c99c resolves; ancestor of main: true`; **211 fragments checked, 211 present on main, 0 absent**.
The fold into rows 303/314/328/329 and the stall runbook is genuinely there - spot-verified against the
distinctive strings the commit introduced (`76,337`, `notice-based`, `stop-grace-expired`, `counts PAIRS`,
`Fourth instance, and the reason field is mis-attributed`, `identity read: it names the pid`).

**The cancellation's claim holds for the artifact it names.**

## F1 - the branch is not the artifact, and the branch still has unlanded content

`git rev-list --count main..item-4879` → **2** commits, neither on main:

| commit | what it carries | on main? |
|---|---|---|
| `45466f1c` | `tools/probes/host-identity-4879.mjs` - "is a seat's host identity declared or derived?" | no - `git show main:tools/probes/host-identity-4879.mjs` → *fatal: path ... does not exist in 'main'* |
| `dab62450` | a host-identity design note + a **provisional `## D265`** in `docs/DECISIONS.md` | no as that text; main's `D265` (line 11783) is a *different* decision - the promote-verb ADR |

So cancelling the landing-list row closed the **row** while leaving a second, unrelated concern on the same
branch - host identity - unlanded, with its ADR number already taken by someone else. That is D291's
failure mode in miniature: a gate with no decision point silently reverts content, and here the cancellation
*was* the decision point, and it reverted content the cancellation never claimed to cover.

**Concrete fix:** a cancellation that closes a branch must state which commits it covers. Two options:
- **(a) land the residue as its own entry** (the probe + a re-minted host-identity ADR) - keeps the decision;
- **(b) explicitly retire the branch** with a recorded reason that the host-identity finding was superseded -
  also fine, provided it says so. What is not fine is the current state: the row is terminal, the branch is
  unreferenced, and the finding has no home.

## F2 - the granularity of a presence check decides whether it can lie

My first version of the probe compared **whole added lines** against main. It reported one MISSING fragment:
the runbook's `evidence_addendum` line added by `3c4973c9`. It was not missing - main's version of that line
is the same text **plus six later addenda**, so the added line is not a substring of the current line. A
line-level presence test can only pass if nothing ever edits the line again.

**Concrete fix:** the unit of a content-presence check is a **fragment** - a clause or sentence, split on
`; `, ` — ` and `. ` - not a line. The probe does this now: 211 fragments, 0 absent. Control runs prove it can
detect absence rather than only confirm it: `item-3570` → 24 of 29 fragments absent; `item-4058` → 28 of 60;
`item-4879` (the branch tip) → 173 of 173 absent. A check that can only ever say "present" is not a check.

Why this matters beyond this row: the rig's whole landing story (#4772 "a green from the wrong tree is not
evidence", #4775, and the `evidence` field now required on completions) rests on presence checks. A presence
check at line granularity produces **false absences**, which reopen closed work - the mirror image of the
#3539 pattern where a rule that starts red gets disabled. Both failure modes come from the same source: the
check's unit is wrong.

## Failure modes

| failure | mechanism | recovery |
|---|---|---|
| false absence | added line later extended; substring test fails | fragment granularity (implemented, measured) |
| false presence | ancestry accepted as content | ancestry is only the fast path; content decides (#3337) |
| branch residue | row cancelled, branch commits never referenced | cancellation names the commits it covers |
| ADR orphan | provisional number consumed by another decision | re-mint at land; a provisional number is not a claim |
