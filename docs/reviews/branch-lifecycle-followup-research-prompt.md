---
runbook-ish: research follow-up
topic: branch lifecycle for LLM-agent teams
round: 2
last_verified: 2026-11-12
verified_by: delegate
evidence: "docs/reviews/branch-lifecycle-llm-agent-teams.md (round 1, delegate-conducted)"
check_rule: null
---

# Round 2: what round 1 could not answer

**Context.** Round 1 (`branch-lifecycle-llm-agent-teams.md`) was run by the delegate on this host. It grounded
four questions in the trunk-based-development literature, Atlassian's Git Flow doc, git's own worktree
documentation, and the shipped behaviour of Claude Code, Aider and OpenHands. It left five things genuinely
unverified, and the taxonomy decision in `docs/WORK-ITEM-MODEL.md` §4/§7 is still PROVISIONAL because of them.
We now need the parts a delegate on one Linux box cannot reach.

**What round 1 established** (so round 2 does not re-do it): one branch per small change, ≤ 2 days life, one
owner; a merge queue is the pattern at fleet scale; agent products either commit straight (Aider), share a
workspace and warn (OpenHands), or create a worktree on demand and sweep it by age with an ownership marker
(Claude Code); shared branches for many workers are contradicted by the literature.

## Questions

1. **GitHub merge queue internals.** How are candidates batched? What exactly does the gate check before it
   lands (the PR's own CI, or a re-run against the current tip)? What happens to a queued candidate whose base
   moves — is it re-validated or dropped? Which of these are enforced by branch protection versus convention?
   **We could not fetch docs.github.com from this host** (HTTP 404 on every path tried, 2026-11-12). If the
   agent can reach it, quote ≤ 40 words per load-bearing claim, with URL and fetch date.

2. **Merge-queue products with public docs**: Trunk (trunk.io), Mergify, Aviator. Both trunk.io feature pages
   and mergify documentation returned 404 here. Report: what the queue validates, whether it rebase-reviews
   speculatively, and how it retires a candidate that goes stale.

3. **How agent products handle branches and worktrees — the ones we could not reach.** Devin, GitHub Copilot
   coding agent (Autofix), Sweep, Orbi, Miko, Baton, Code Conductor, Sourcegraph. For each, in the round-1
   table shape: branch unit | checkout | who merges | what retires the branch | what broke. If a product has no
   public description of this, say so — do not infer.

4. **Iteration architecture, the half we could not measure.** For each product in question 3: (a) piece
   boundaries and the change-loop cost per piece; (b) hermetic vs live tests; (c) how the model is mocked or
   substituted in tests, and whether a real model in a test is opt-in with a declared budget; (d) how **prompt
   changes** are regression-tested; (e) what bounds a long agent turn; (f) how slow or flaky tests are
   quarantined. Round 1 found none of this in user documentation — engineering blogs, published test
   directories, or open-source repos of these tools are the material.

5. **Branch-sprawl measurement.** Does any tool or policy measure open-branch count, branch age distribution,
   or time-to-merge, and report it? Round 1 found none. If one exists, name it and quote the metric definition.

6. **Isolation predicate.** Is there any published rule — not prose, a rule — for when a change needs an
   isolated environment versus a direct commit? Round 1's answer was "no source states a predicate". If one
   exists, give it; if not, say so explicitly so §3 of `WORK-ITEM-MODEL.md` can be recorded as our invention
   rather than prior art.

## Deliverable

Write to `docs/reviews/branch-lifecycle-llm-agent-teams-round2.md`, each section as one fenced block with no
narration around it:

- `## Merge queue mechanics` (batching, validation, stale candidates)
- `## What agent products do` (the round-1 table, extended — one row per product, `unverified` cells where
  there is no source)
- `## Iteration architecture` (the six items above, per product)
- `## Sprawl measurement`
- `## Changes to our design` — numbered, each naming the section of `docs/WORK-ITEM-MODEL.md` it changes and
  the round-1 claim it corrects
- `## Still unverified`

**Evidence discipline.** Every external claim: URL, evidence class (`advertised-elsewhere` or `observed`), and
for load-bearing claims a verbatim quote of 40 words or fewer plus the agent's own fetch date. No line ranges
into pages you fetched — we cannot open your workspace; a quote we can re-find is the only portable evidence.

## Constraints

Written report only. Do not modify code, do not commit, do not create repo paths — the research agent has no
write access to this repository. Prefer primary sources: vendor docs, engineering blogs, and the source of the
tools named in question 3.
