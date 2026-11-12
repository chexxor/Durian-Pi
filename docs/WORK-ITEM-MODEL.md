# Work-item model — kinds, execution modes, and when a worktree is created

**Authority.** This is the canonical model of **how an item is executed**: which items get a worktree and a
branch, which do not, which branches cooperate, and how a finished branch becomes `staging` and then `main`.
It is the third leg of the item record:

| Doc | Owns |
|---|---|
| [`WORK-ITEM-SCHEMA.md`](WORK-ITEM-SCHEMA.md) | identity — ids, titles, `kind`, `blockedBy` |
| [`WORK-ITEM-LIFECYCLE.md`](WORK-ITEM-LIFECYCLE.md) | queue behaviour — statuses, transitions, wakes |
| [`BRANCH-AND-WORKTREE-LIFECYCLE.md`](BRANCH-AND-WORKTREE-LIFECYCLE.md) | git artefacts — what exists and who retires it |
| **this file** | **execution mode** — branch or no branch, shared or private, landing and promotion |

**Status: PROVISIONAL, with round 1 of the research folded in.** Sections marked **DECIDED** are grounded in
code that exists in this tree (path:line given, each verified with `test -e` before citing). Sections marked
**PROVISIONAL** are the team's design decision. External evidence now exists —
[`reviews/branch-lifecycle-llm-agent-teams.md`](reviews/branch-lifecycle-llm-agent-teams.md) is round 1, run
by the delegate on this host (the delegate has a network path, and the taxonomy was blocking the MVP); the
operator-routed off-host prompt in
[`reviews/branch-lifecycle-research-prompt.md`](reviews/branch-lifecycle-research-prompt.md) is **still open**,
and when that report lands it supersedes round 1 where they disagree. Round 1 changed two things: §5 is
**contradicted by prior art and rewritten**, and §8's retirement rule gained a mechanism (ownership marker +
lock + sweep) taken from a shipping agent product. §4's storage question and §7's promotion mechanics stay open.
Do not treat a PROVISIONAL section as settled.

| | |
|---|---|
| `last_verified` | 2026-11-11 |
| `verified_by` | delegate |
| evidence | commands in §1 and §9, run at HEAD `a464e1c4` on **Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0** |

---

## 1. The problem, measured

The rig mints one worktree and one ref **per claimed item**, for every item, whatever the item changes.

```bash
git for-each-ref --format='%(refname:short)' refs/heads | wc -l   # 84 refs at a464e1c4
git worktree list | wc -l                                        # 75 worktrees at a464e1c4
git branch --list | grep -c 'item-'                              # the overwhelming majority are item refs
```

Each one costs the same, whether the item is a Rust-scale rework or a two-line doc note:

| Step | What it does | Where |
|---|---|---|
| `createWorktree` | a full second checkout of the repo | `src/worktree.mjs:286` |
| `installWorktreeDeps` | `npm ci --prefer-offline` into the new tree | `src/worktree.mjs:231`, called at `:861` |
| `enableRerere` | repo config for conflict replay | `src/worktree.mjs:862` |

Nothing retires either artefact when the item closes. `BRANCH-AND-WORKTREE-LIFECYCLE.md` §2 says the branch is
deleted **only when merged**; the merge is a human/delegate pass, so an unlanded item keeps its ref forever.
D249 records the pin as *queue state*, not git state: a merged-but-unclosed row keeps its tree pinned
(`src/broker.mjs:1117`).

The consequence measured on 2026-11-11: **46 refs** that were clean, unmerged and attached to items already
`done`/`cancelled`/`deferred` — each one a decision somebody had to make by hand, in a pass that takes
wall-clock time a seat could have spent implementing.

**So the model has to decide *at claim time* whether an item needs a tree at all, and give every artefact a
owner and a retirement rule.**

---

## 2. Two axes, not one (DECIDED)

`kind` is an **identity** field (SCHEMA R3). It does not tell you how to execute the item. A `task` that
changes one line of a doc and a `task` that rewrites `src/broker.mjs` need different rigs. The missing axis is
the **execution mode**:

| Mode | Worktree? | Branch? | Where the work physically happens |
|---|---|---|---|
| **isolated** | yes, `item-<id>` | yes, `item-<id>` (or the shared feature branch, §5) | the seat's own tree |
| **branchless** | **no** | no ref of its own | the seat's existing cwd, output submitted as a structured delta (§4) |

Everything else — gate, verify row, landing, promotion — is identical in both modes. That is the point: the
mode changes *where the bytes live*, not *what counts as done*.

---

## 3. The mode rule (DECIDED, with the predicate already in the tree)

**Default is branchless. A worktree is granted only on a demonstrated need.**

The rawest material for the rule already exists: `isDocumentationPath()` in `src/landinggate.mjs:45` is the
predicate the landing gate uses to decide that a change cannot break a test. Use the same predicate at claim
time, so "does this item need a tree" and "can this change break the suite" are one function, not two
judgements.

Ask three questions, in this order. The first **yes** grants a worktree:

1. **Does the item write tracked code?** Anything outside a root `.md/.txt/.rst` or under `docs/`
   (`isDocumentationPath`, `src/landinggate.mjs:45`, applied at `:98`) → isolated.
2. **Does the item's acceptance name a command that must run against a changed tree?** A demo, a suite area,
   a probe, a build → isolated. A read-only command (`git log`, `cli.mjs status`, a grep) does not.
3. **Does the item spawn processes or touch the store?** Any item that starts a broker, a seat, or opens
   `selfdev.sqlite` needs its own tree so the shared tree stays clean → isolated.

If all three are no, the item is **branchless**. Mapping onto the SCHEMA R3 vocabulary:

| `kind` | Mode | Why |
|---|---|---|
| `task` (code) | isolated | rules 1–3 |
| `task` (prose-only) | branchless | rule 1 fails, rule 2 names only reads |
| `docs`, `register`, `ruling` | branchless | prose; the gate is the `docs` area |
| `question` | branchless | an answer is text |
| `verify` | branchless for read-only checks; isolated when the verifier must run the suite | rule 2 |
| `notice` | none — no work, no artefact | §8: notices create nothing |
| `landing`, `rebase` | tool verbs, not seat work | git plumbing is the rig's, §6 |

Measured gate cost, so the branchless path is not a slower path in disguise:

```bash
node scripts/test.mjs --area docs            # 7/7 in 40.7 s (runbook-diagnose 40.7 s is the whole cost)
node scripts/suite.mjs --all --jobs 4        # 300/300 in 122.9 s at a464e1c4
```

A `docs`-area gate is a third of a full suite; a full suite at promotion (which the operator runs once, on
the merged result) is the expensive leg, and it is run **once per promotion**, not once per item.

---

## 4. What "branchless" means concretely (PROVISIONAL — the mechanism is the open part)

A seat cannot run state-mutating git. `src/confine.mjs:206-217` denies `checkout`, `switch`, `reset`,
`revert`, `clean`, `stash`, `branch -D`, `add -A`/`add .`, `push`, and the `-C` redirect forms; `src/seatguard.mjs:164`
refuses a command in the shared tree precisely because "it would land ON the shared branch and bypass the
landing pass". So the delta must travel **through a rig verb**, not through the seat's shell.

**DECIDED shape:** the seat submits its change as a structured edit list, and the rig applies it.

```jsonc
// submitted on complete_work, stored on the item
"delta": {
  "edits": [
    { "path": "docs/DECISIONS.md", "oldText": "...exact existing text...", "newText": "..." },
    { "path": "docs/runbooks/promote.md", "create": true, "content": "..." }
  ]
}
```

- `oldText` is an **exact match**, the same semantics as the harness `edit` tool. A mismatch is a refusal,
  not a fuzzy apply — that is what makes the delta re-checkable by a non-author.
- The rig applies the delta in a **detached scratch worktree on `staging`** (the same scratch pattern
  `scripts/land.mjs` already uses), runs the gate there, commits, and advances `staging` by a clean
  fast-forward. The scratch is removed in the same call.
- **Net worktree change: zero.** That is the assertion the mocked-plane demo must make: count
  `git worktree list` before and after a branchless `docs` item, and require equality — not "one fewer",
  because a branchless item never created one.

Why not the obvious alternatives, and why they were rejected:

| Alternative | Why it fails here |
|---|---|
| Seat edits the shared tree, someone commits it | This is the current state, and it is measured destructive: ROADMAP 330 records 203,632 B of uncommitted doc work in the shared tree vanishing with no commit or merge in the log, and two runbook files that existed **only** in a done item's worktree and were recovered from a transcript. |
| Cheap per-seat worktree instead of per-item | Still mints a ref and an `npm ci`, and re-creates the two-seats-one-branch problem `adoptLegacyItemBranch` (`src/worktree.mjs:913`) exists to end. |
| Patch text submitted as a string | A hand-written patch is not re-appliable deterministically when the base moves; an exact-match edit list is. |

**Open for research (§10):** whether the delta should be stored on the item, in a gitignored
`.spike/item-<id>/` directory, or as a blob in the store. The store is already 10 MB of prose; the answer
should come from how other agent fleets carry small diffs.

---

## 5. Cooperative items: one branch, several rows (PROVISIONAL)

SCHEMA R7 says **`item-<id>`, nothing else**, and one ref per item — never per seat. That is correct for
independent items and wrong for a decomposed feature: three rows implementing one change, landed separately,
produce three merges of the same files and the `add/add` conflict class already documented in
`BRANCH-AND-WORKTREE-LIFECYCLE.md` §7 point 2 ("two branches that both ADD the same path cannot be merged in
either order").

**Rule, as revised by the research (round 1, `reviews/branch-lifecycle-llm-agent-teams.md` §"Cooperative work
on one feature"):**

> "Another key rule is how many developers are allowed congregate on a short-lived feature branch. Another
> simple answer: the developer count should stay at one (or two if pair-programming). These short-lived
> feature branches are not shared within a team for general development activity."
> — trunkbaseddevelopment.com, *Short-Lived Feature Branches*, fetched 2026-11-12

A shared branch for several seats is therefore **not** the default. The proven arrangement is ordered
decomposition, not a shared tree:

1. A **cluster** is a set of items that must land together. It is declared structurally — a `feature: <slug>`
   field plus `clusterOf`/`blockedBy` links — never by prose in a title (R8).
2. **Cluster members land one at a time, in declared order**, each re-validated against the staging tip the
   previous landing produced (§6.1). Several rows, several seats, one landing sequence — not one shared tree.
3. A genuinely un-splittable change may use one branch **`feature-<slug>`** with hard bounds: **≤ 2 member
   seats, ≤ 2 days of life, one named owner**. Exceeding a bound is a `check` finding (ROADMAP **360**), not a
   judgement call.
4. The cluster branch is retired when **every** member row is terminal **and** the branch is an ancestor of the
   branch it landed into. Ownership is the cluster, not the last seat.
5. Legacy `item-<id>` refs are never renamed into a cluster (R7's "never rename a branch that holds commits
   others reference"): a cluster starts at its first item.

If a cluster spans files that conflict, it is not one change; it is two items that were mislabeled as one.

Naming for `feature-<slug>` is derived by a function, never hand-written (R7): the slug is minted by the
minting seat from the cluster's lead item id, e.g. `feature-6140`.

---

## 6. Landing: a seat lands its own branch into `staging` (PROVISIONAL — the gate is DECIDED)

Today landing is a human pass: a delegate runs `scripts/land.mjs <branch>... --suite|--changed-suite`.
The gate rules already exist and are enforced (`src/landinggate.mjs:57` `requireGate` refuses a landing with
no gate; `--docs-only` is an attestation checked against the diff, not taken on the flag's word). What does
not exist is the seat making the move, or a branch to move into.

**The contract:**

| Step | Actor | Evidence required |
|---|---|---|
| 1. claim | seat | `claim_work` |
| 2. implement | seat | commits on `item-<id>` (or the delta, §4) |
| 3. verify | **a different seat** | a `kind: verify` row whose `status` is `done` with `evidence {command, exitCode, artifact}` (`src/rig.mjs:993`, ROADMAP 48/W2) |
| 4. land | rig verb, called by the author seat | refuses unless: (a) the verify row for **this tip** is done; (b) the branch tip equals the tip the verify named; (c) `git merge-tree --write-tree staging <branch>` is clean; (d) the gate runs and exits 0 |
| 5. promote | **operator only** | §7 |

Refusal, not repair: the verb reports the failed predicate and does nothing. The current land helper already
proves the right structure — merges happen in a scratch detached worktree and `main` advances only by a clean
FF, so the shared tree is never mid-merge (`scripts/land.mjs` header).

### 6.1 `staging` is a queue, not just a branch (added from round-1 research)

The established pattern at fleet scale is a **merge queue**: "Agentic teams need more: a commit queue, a fast
local build with Test Impact Analysis, and agents that talk to each other before touching shared code", and
"GitHub Merge Queue can help solve the 'race to push' problem. This will automate pull request merges into a
busy branch to increase velocity" — both *advertised-elsewhere*, trunkbaseddevelopment.com, fetched 2026-11-12.
What is worth copying is the mechanism, not the service: **validate at merge time, serialise, re-validate
against the moved tip**. Our gate re-checks ancestry and the diff but not the tip the verify row named, so a
verified candidate can go stale between verification and landing (ROADMAP **359**, row **#6928**).

Concretely: land one candidate at a time; the gate runs on the candidate rebased onto the staging tip the
previous landing produced; if the tip named by the verify row has moved, the landing is refused, not patched.

Two facts the gate structurally cannot see, and therefore the promotion leg is not optional:

- **Derived coverage has a blind spot.** `--changed-suite` runs the tests the change *derives*
  (`tools/what-to-test.mjs`). A change that touches no mapped path is refused rather than advanced
  unchecked (`src/landinggate.mjs` `requireGate`) — but a change that breaks a probe corpus, a doc citation
  check, or an area nobody mapped is invisible to it. The full suite at promotion is the backstop.
- **Point-in-time classification.** `BRANCH-AND-WORKTREE-LIFECYCLE.md` §4.4: landing one branch can make an
  unrelated ref an ancestor of main. Ancestry must be re-evaluated against the **new** tip after every
  landing, in the same pass.

---

## 7. Promotion: `staging` → `main` in one operator verb (PROVISIONAL)

`staging` is a long-lived branch, created once (`git branch staging main`) and never hand-edited. Seats may
move it; the operator is the only party that moves `main`.

The verb must print the evidence, not a success flag. Required output:

```bash
node cli.mjs promote            # staging -> main, with the evidence printed
node cli.mjs promote --dry-run  # what it would do, nothing changes
```

| Printed | Command behind it |
|---|---|
| which refs were merged, in order | the landing log for staging |
| suite: `pass=N fail=M` + **exit code** | `node scripts/suite.mjs > out 2>&1; rc=$?` — never piped (`BRANCH-AND-WORKTREE-LIFECYCLE.md` §6.1) |
| ancestry: `git merge-base --is-ancestor <sha> main` → exit 0 | per merged ref |
| parent count: `git log -1 --format=%p <sha>` → 2 parents = a merge actually landed | the "subject is a description, parent count is a structure" rule |
| refs retired by the promotion | `git branch -d` on each, refused if not an ancestor |

Why staging at all rather than a merge queue: the operator wants a **single deliberate act** that carries the
evidence, and the fleet needs a place to put verified work that is not yet blessed. Which of the two
patterns (long-lived staging branch vs a merge queue) fits an agent fleet better is precisely question 3 of
the research prompt; the mechanism is written so either answer drops in.

---

## 8. Retirement (DECIDED as a rule; the verb is PROVISIONAL)

Every artefact gets an owner and a retirement condition. Extending `BRANCH-AND-WORKTREE-LIFECYCLE.md` §2:

| Artefact | Created by | Retired when | Who may do it |
|---|---|---|---|
| `item-<id>` worktree | `prepareSeatWorkspace` (`src/worktree.mjs:966`) | its item is terminal **and** the branch has landed or is dispositioned | the rig |
| `item-<id>` branch | same | it is an ancestor of the branch it landed into (`git merge-base --is-ancestor`) | rig, then operator/delegate for the ref |
| `feature-<slug>` | a cluster declaration | all cluster members terminal and the branch landed | rig |
| delta (branchless item) | the submission | applied and committed to staging, or refused with a reason | rig |
| scratch `.verify-*` | a verifier | `worktree scratch clean` | the rig |
| `staging` | first promotion setup | never — it is a permanent branch | nobody deletes it |

**Ownership is a fact, not an inference.** Claude Code solves the same residue problem with three primitives,
all of which git already gives us: it "writes a marker into the git metadata of every worktree it creates with
git, and the sweep keeps any worktree without one"; "While an agent is running, Claude Code holds a git
worktree lock on its worktree so that concurrent cleanup can't remove it, and releases the lock when the agent
finishes"; and its sweep "leaves a worktree in place" when it "still holds work: changed or untracked files, or
unpushed commits" (*observed*, https://code.claude.com/docs/en/worktrees, fetched 2026-11-12). The rig's
version: stamp every rig-created worktree with `git worktree lock --reason rig:<item-id>` at creation — the
native `--reason` field IS the ownership marker (`git-scm.com/docs/git-worktree`, fetched 2026-11-12) — and a
sweep may touch **only** marked trees, and only clean ones. Dirty marked trees go to `DISPOSITIONS.md`; they are
never deleted. ROADMAP **358**.

**Never** a force. `git worktree remove` without `--force`, `git branch -d` only (git itself refuses an
unmerged branch). Unmerged refs are **dispositioned** in [`DISPOSITIONS.md`](DISPOSITIONS.md) — a new row,
append-only — never silently deleted.

---

## 9. Enforcement (PROVISIONAL — the rules exist as `check`-family rules today for other shapes)

A lifecycle nobody checks is a suggestion. `src/checkup.mjs` already carries the pattern
(`runbook-stale`, `runbook-unverified`, `item-kind`, `queue-roadmap-link`). The rules this model needs:

1. `landed-but-open`: an item `done` whose branch is not an ancestor of `staging` or `main` → finding.
2. `unverified-landing`: a branch on `staging` with no non-author `verify` row naming its tip → finding.
3. `worktree-leak`: a worktree whose item is terminal and which is not a seat root → reapable, reported.
4. `branchless-violation`: an item classified branchless that spawned a worktree → finding (the mode is
   recorded on the item, so this is a comparison, not a judgement).
5. `cluster-orphan`: a `feature-<slug>` branch with members still live after the branch landed.
6. `branch-age-days`: a ref older than 2 days whose item is not terminal — the literature defines a long-lived
   branch by age, not intent ("Any longer than two days, and there is a risk of the branch becoming a
   long-lived feature branch", trunkbaseddevelopment.com, fetched 2026-11-12).
7. `unmarked-worktree`: a worktree with no `rig:<item-id>` lock reason, i.e. one the rig did not mint — the
   sweep must never touch it, so the finding is "unknown owner", not "reap it".

Each is proven by a **red-first demo**: forge the violation, assert the verb exits nonzero
(`docs/failing-first-recipe.md` is the recipe the repo already uses).
Exit codes and merge-base results are the assertion — never an `ok: true` flag, which is the exact failure
mode documented in `docs/runbooks/land.md` ("A landing entry may NOT close on `ok:true`").

---

## 10. What round 1 answered, and what is still open

Round 1 (`reviews/branch-lifecycle-llm-agent-teams.md`) answers the four questions §4/§5/§7 depended on:

1. **Unit of a branch** — one small change, ≤ 2 days, one owner. Per-item refs with no retirement rule are the
documented failure mode; ours measured **93 refs / 83 worktrees** on 2026-11-12T01:55Z.
2. **Closest pattern to a promoted `staging`** — a merge queue, not Git Flow's `develop`. Keep the human
promotion (no queue gives the operator a single deliberate act with printed evidence); adopt the queue's
mechanism (§6.1).
3. **When a change needs isolation** — no source gives a predicate. The observed behaviour is *no per-change
branch at all*: Aider commits each edit on the current branch, OpenHands shares a workspace and tells the user
to isolate, Claude Code makes a worktree on demand and sweeps it. §3's predicate is our invention, consistent
with that evidence rather than derived from it.
4. **Clusters** — contradicted as proposed; see the revised §5.

Still unverified (named in the report): GitHub merge-queue internals (docs.github.com returned 404 from this
host), Trunk/Mergify, Devin/Copilot/Sweep/Orbi/Miko/Baton/Code Conductor/Sourcegraph, how agent products
regression-test prompts, and whether any tool measures branch sprawl. Follow-up prompt:
`reviews/branch-lifecycle-followup-research-prompt.md`.

## 11. Open questions the research must answer (before §4 and §7 are ratified)

1. Do agent fleets that produce many small changes use per-change branches, a shared integration branch, or
   patch submission — and what does each cost in ref litter and merge conflict rate?
2. What is the closest established pattern to a `staging` branch a human promotes: Git Flow's long-lived
   branch, a merge queue, or trunk-based with short-lived integration? Which is cheapest for a fleet where
   the author is a model and the reviewer is another model?
3. How do other systems decide when a change needs an isolated environment — is there a predicate like §3,
   or is it always "every change gets a tree"?
4. How is a cooperative cluster of changes named and retired without producing `add/add` conflicts?

All four are in `docs/reviews/branch-lifecycle-research-prompt.md`. Until the report lands, §3's predicate
and §6's gate are the parts we can defend from code; §4's storage and §5's naming are held open.

---

## 12. How to re-verify this document

```bash
git for-each-ref --format='%(refname:short)' refs/heads | wc -l   # ref count — re-count, it moves live
git worktree list | wc -l                                         # worktree count — re-count
grep -n "isDocumentationPath" src/landinggate.mjs                 # the mode predicate exists
grep -n "requireGate" src/landinggate.mjs                         # the gate is required, not optional
grep -n "itemBranchFor" src/worktree.mjs                          # one ref per item
grep -nE '"(checkout|switch|branch -D)"' src/confine.mjs          # seats cannot do this themselves
node scripts/test.mjs --area docs                                 # the branchless gate, with its cost
```

If the code disagrees with a rule here, the **document** is wrong — correct the document, never bend the
rig to match the prose.
