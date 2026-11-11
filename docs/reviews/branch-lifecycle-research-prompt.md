# Research request — branch and worktree lifecycle for a team of LLM-agent seats

**Ask:** hand this to the operator's research agent. Report to `docs/reviews/branch-lifecycle-llm-agent-teams.md`.
The agent is off-host and has no write access to this repo, so it delivers **text in chat**, not files or commits.

## Context

`durian-pi` is a durable, multi-seat agent rig built on pi-durable. A **single-writer broker** drives a
cross-seat work queue; **seats** (LLM personas with a constrained tool set) claim items and act; a
**delegate** operates on the human operator's behalf; a **CLI and a TUI** are the human surfaces. Work is
tracked in a queue store of ~6,900 rows (measured 2026-11-11: 4,630 done, 926 cancelled, 428 held, 524
deferred, 376 queued, 6 claimed).

Two audiences must be able to run the lifecycle: the **human operator**, who decides when work reaches
`main`, and an **LLM seat**, which reads a rule and executes it through tools. A rule that a seat can
misread, or a gate a seat can walk around, is not a rule.

**The problem we are trying to fix, measured on this box 2026-11-11** (Linux, Fedora Linux 45, kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0): claiming an item creates a branch and a worktree;
nothing retires either when the item closes. A census of the rig found **81 refs and 75 registered
worktrees** and it is still growing while we measure — the fleet minted 4 more refs between two runs of
the same command ten minutes apart — of which **46 were clean, unmerged refs attached to items already
marked `done`**: branches whose work never landed and never got a decision. Git cannot tell us which of
those are dead: for every one, `git merge-tree main <ref>` produces a tree different from `main`'s, so
each carries content that is not on trunk. Deleting them would destroy unlanded work.

**What we are about to build (the MVP we want the research to inform):**

1. A seat that finishes an item **lands its own verified branch** into a `staging` branch, behind a gate
   that is enforced, not optional.
2. The **operator promotes `staging` → `main` in one verb**, and that verb prints the evidence of the gate.
3. **Branchless by default**: an item that does not need isolation (a docs edit, a decision record, a
   measurement) never spawns a worktree; the seat asks for one.
4. Cooperative items may share one feature branch.
5. A **branch taxonomy** — what a branch is *for* — that is grounded in how real agent fleets and real
   engineering teams do this, not in what we improvised.

What we already have, so the report does not re-invent it: a landing helper that merges in a scratch
worktree and advances `main` only by a clean fast-forward (`scripts/land.mjs`), a required-gate rule
(`src/landinggate.mjs`: a landing with no `--suite` or `--changed-suite` is refused), a seat guard that
refuses `git branch -D` (`src/confine.mjs`, `branchForceDelete`), an append-only disposition ledger
(`docs/DISPOSITIONS.md`), and a census instrument (`tools/branch-census.mjs`). The regression suite is
300 tests; the full suite runs in ~120 s on this box (`node scripts/test.mjs --all --jobs 4`).

**Already asked, do not repeat:** `docs/reviews/llm-prompting-for-git-merging.md` (how to prompt an agent
through a merge conflict), `docs/reviews/llm-agent-project-management-tools.md` (how agent fleets get their
work items), and `docs/reviews/agent-fleet-containment-domain-map-research-prompt.md` (what a seat is
allowed to touch). This request is about the **branch and merge lifecycle**, not about merge-conflict
prompting or the task queue.

## Questions

Answer each with prior art, and say which of it was **observed** (you saw the behaviour in a tool, a
document, or a repo) versus **advertised** (the vendor or the doc claims it).

1. **What is the unit of a branch, in teams that run many concurrent workers?** Trunk-based development,
   branch-per-task, branch-per-feature, stacked PRs, short-lived branches with a TTL. For a fleet of
   ~10 concurrent LLM seats each handling items of 5 minutes to 5 days, which unit matches the work, and
   what evidence exists that branch-per-task causes sprawl? Cite the sources that measured it.

2. **Is branchless-by-default defensible for small changes, and under what conditions?** Trunk-based
   literature says small, frequent direct commits to trunk. What makes that safe (batch size limits,
   required checks, fast rollback, feature flags), and where does it fail (unsafe to merge unreviewed
   work, concurrent edits to the same file, compliance requirements)? Give the thresholds real teams use.

3. **What is the closest established pattern to a `staging` branch that a human promotes to `main`?**
   Compare: a long-lived `staging`/`develop` branch (Git Flow), a **merge queue** (GitHub merge queue,
   Google's internal merge queue, Trunk's merge queue), a release train, and a protected trunk with a
   required human approval. For each: how batches are grouped, what the promotion actually does to history,
   what the gate checks, and what happens to a queued item that goes stale. Which is best for "an agent
   lands, a human promotes, one verb"?

4. **Who lands the branch — the author or a reviewer?** In teams where the author is an agent, what do the
   real designs do: author-merges-own-PR, reviewer-merges, or a bot merges after checks? What evidence
   exists that author-merges-own-work is a governance risk, and how do teams close it (two-author rule,
   CODEOWNERS, non-author approval required by branch protection)?

5. **How is a gate made non-bypassable?** Branch protection, required status checks, required reviews,
   signed commits, "merge queue required" settings. Which of these are enforced by the platform versus
   convention, and what are the documented bypass paths (direct pushes to trunk, force pushes, PRs opened
   by the author's own bot, merging before checks finish)? We need an enforcement story that survives a
   seat that does not understand the rule.

6. **What retires a branch, and who is responsible?** Auto-delete-on-merge, TTL/branch-age policies, GC
   daemons, "stale branch" alerts, and what happens to a branch whose owner is gone. Any tooling or policy
   that measures branch sprawl (open-branch count, branch age distribution, time-to-merge), and the cost of
   collecting those numbers.

7. **Conflict with trunk: merge, rebase, or re-cut?** What do teams and agent systems do when a branch is
   days behind trunk and conflicts? Is there a policy that distinguishes a mechanical conflict from a
   semantic one, and what do they do with a branch that cannot be brought up to date? We call these
   "zombie branches"; what does prior art call them, and how is the state prevented?

8. **Shared feature branches for cooperative work.** When several workers must build one feature
   concurrently, what are the proven arrangements: one shared branch with a merge queue, stacked PRs,
   feature flags on trunk, or task decomposition so the work never overlaps? What are the documented
   failure modes of shared branches (long-lived divergence, conflict storms, unclear ownership), and how
   does decomposition avoid them?

9. **How do real LLM-agent systems handle branches and worktrees today?** Cover at least the systems that
   run multiple concurrent coding agents: OpenHands, Aider, Devin, Codex, Copilot (Autofix / coding agent),
   Sweep, Orbi, Miko, Baton, Code Conductor, Sourcegraph, and any merge-queue/agent hybrid. For each:
   branch-per-task or shared branch? worktree or per-agent checkout? who merges? what retires the branch?
   what broke? Prefer sources that describe behaviour over marketing pages.

10. **Naming and taxonomy enforcement.** Prior art for naming branches by purpose (`feature/`, `fix/`,
    `docs/`, `verify/`, `scratch/`, `release/`) and *enforcing* it — git hooks, linters, repo conventions,
    CODEOWNERS by path. Does anyone make the taxonomy machine-checkable, and how? What is the payoff, and
    what is the cost of a naming rule the tooling cannot enforce?

11. **Verification and evidence attached to a landing.** What do teams attach to a merge so that a human
    promoting it later can see what was proven: required PR templates with test output, check runs,
    artifact registries, "merge only if X passed" rules? How do teams keep that evidence readable after the
    merge — not just at the merge moment?

12. **Iteration architecture (this is load-bearing for us, D213: every piece must have its own fast loop).**
    For each competing product you examine, report: **(a)** where the piece boundaries are and what the
    change loop costs for each piece; **(b)** whether tests run hermetically or against a live service;
    **(c)** how the model is mocked or substituted in tests, and whether a real model in a test is opt-in
    with a declared budget; **(d)** how **prompt changes** are regression-tested, if at all; **(e)** what
    bounds a long agent turn (timeouts, step caps, resumability); **(f)** how slow or flaky tests are
    quarantined so they do not gate the fast path. Learning what a product *does* without learning how fast
    it can *change* leaves out the half of the comparison that decides our architecture.

13. **Recommendation for `durian-pi`.** Given the constraints above, propose: the taxonomy, who lands and
    who promotes, the gate, the branchless rule, the retirement rule, and the metrics. Then list the
    **ROADMAP items** we should register, each with an owner role and an acceptance test. Flag explicitly
    where our design **diverges from established practice** and whether that divergence is justified.

## Deliverable

Write to `docs/reviews/branch-lifecycle-llm-agent-teams.md` with these sections, **each as one fenced
block containing only that section's content, with no narration before or after it** (what arrives in chat
is what gets committed verbatim; a previous round arrived with the agent's own chatter glued to the title
line and we had to commit it as-is):

- `## Branch taxonomy: what a branch is for`
- `## Branchless work: when no branch is the right choice`
- `## Staging and promotion: merge queue vs staging branch vs protected trunk`
- `## Who lands, and what the gate must enforce`
- `## Retirement and sprawl control`
- `## Conflicts and zombie branches`
- `## Cooperative work on one feature`
- `## What real agent systems do` (table: system | branch unit | checkout | who merges | retirement | iteration loop)
- `## Iteration architecture` (the six items in question 12, per product)
- `## Recommendations for durian-pi` — numbered, each with owner role, acceptance test, and the citation
  that supports it
- `## Where we diverge from established practice`
- `## Unverified` — every claim you could not ground, and what would falsify it

**Evidence discipline.** Every external claim cites a **URL** and states its class: `advertised-elsewhere`
or `observed`. For each load-bearing claim, give a **verbatim quote of 40 words or fewer**, the **URL**, and
**the date you fetched it**. Do not give line ranges into pages you fetched — we cannot open your workspace,
so a quote we can re-find is the only portable evidence. Map every finding to a mechanism we already have
(`scripts/land.mjs`, `src/landinggate.mjs`, `src/confine.mjs`, `src/worktree.mjs`, `tools/branch-census.mjs`,
`docs/DISPOSITIONS.md`) or name it unverified.

**Anti-patterns matter as much as recommendations.** If a practice is widely used and demonstrably harmful,
say so with the evidence.

## Constraints

- Written report only. Do not modify code, do not commit, do not create repo paths — the research agent has
  no write access to this repository.
- Prefer primary sources: vendor docs, engineering blogs, the source of the tools named in question 9, and
  the trunk-based-development literature. Name the fetch date for every source.
- If a question cannot be answered, say so in `## Unverified` rather than reasoning from plausibility.
