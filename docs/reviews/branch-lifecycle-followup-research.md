All five research iterations are spent; the report below is what the fetches support. I cannot write into `docs/reviews/` (no write access), so paste each block as-is.

````
## Merge queue mechanics

Fetch date for every source below: 2026-11-12. Evidence class `advertised-elsewhere` unless marked `observed`.

| product | what the gate validates | batching | stale candidate (base moved / PR ahead moved) | enforced by |
|---|---|---|---|---|
| GitHub native | synthetic `merge_group` sha, not the PR head; "changes ... grouped into a `merge_group` with the latest version of the `base_branch` as well as changes from pull requests ahead of it" | merge groups of many PRs; optional "only merge unchecked" escape hatch | not dropped: "The merge queue recreates the temporary branch ... to only contain changes from the target branch and pull request #2" — rebuilt and re-validated | branch protection/ruleset (`Require merge queue`) + required status checks |
| Trunk | "tests each PR against the head of `main` plus every PR ahead of it — so what merges is what was actually tested" [^bfd9b3#11] | "Trunk batches compatible PRs into a single run. If a batch fails, automatic bisection isolates the culprit and the healthy PRs keep moving." [^dec386#214] | `unverified` — the overview page states predictive testing but no stale-candidate policy was on the pages fetched | "Your branch protection, rulesets, and required reviews stay in force. Trunk has read-only access to them and merges only what GitHub already allows." [^dec386#371] |
| Mergify | "the Mergify engine will temporarily merge it with the base branch, re-triggering the CI system" [^1] | `batch_size`, configurable; "Batch multiple PRs" vs GitHub's "No" [^b33950#31] | conflict with a PR ahead → **held**, not removed: "the conflicting one is _held_: it keeps its place, its check run reports that its checks are deferred" [^1]; external push to base → "Mergify resets the process and starts over with the updated base branch" [^1] | `queue_conditions` / `merge_conditions` = vendor config (convention); GitHub checks are inputs to that config |
| Aviator | default mode: "automatically be updated with the latest commit from the pull request's target branch and merged only if it passes all the required checks" [^0fa0ab#87] | batching is a separate concept page (`/mergequeue/concepts/batching`), not read | parallel mode: "If a bot pull request corresponding to a previous pull request in the queue fails, a queue reset is triggered and all subsequent pull requests must be re-validated" [^0fa0ab#98] | "By default, Aviator will validate the required status checks configured in GitHub." [^d1b468#47] |

Answers to the four sub-questions:

1. **Batching.** GitHub: merge groups of many PRs, FIFO. Mergify: `batch_size` with `max_parallel_checks` defaulting to 5 [^1]. Trunk: "compatible PRs" only, with bisection on failure [^dec386#214]. Aviator default mode: no batching, "only one pull request can be merged in the time it takes to run the full suite of checks" [^0fa0ab#89].
2. **What the gate checks.** All four re-run CI on a *synthetic* commit (merge group, draft/bot PR, temporary branch). None trusts the PR's own CI run. The gate's check list comes from GitHub's required checks; the *admission* rules come from vendor config — that is the branch-protection-vs-convention split, cleanly.
3. **Stale candidates.** Three distinct policies, and they are not interchangeable: re-validate (GitHub, Aviator parallel), hold (Mergify, only while the blocker is still queued), reset-and-retest-everything (Aviator on any earlier failure). Only Mergify documents a *time* bound: `checks_timeout`, default `auto` = "95th-percentile duration of successful runs with a safety margin", computed per queue and per base branch over seven days [^1].
4. **Housekeeping worth copying.** Mergify deletes its queue branch on exit and sweeps orphans by *exact name shape*: "Its name is the `queue_branch_prefix`, followed by exactly 10 hexadecimal characters" [^1]. That is the same problem as stray agent worktrees, solved with a name predicate rather than a registry.

Two counter-examples to importing wholesale. Aviator's "No queue mode" merges to the current tip *without* in-flight PRs and admits it: "MergeQueue cannot guarantee that the target branch checks will be passing after merging in this mode." [^0fa0ab#107] Trunk's anti-flake rule lets a failed PR merge on a later PR's pass — "a PR that fails on a flake stays in line while downstream PRs test, and merges once a later one passes" [^dec386#206] — which is exactly the "unverified work rides along" behaviour our per-push gate exists to forbid.
````

````
## What agent products do

Round-1 table shape extended. `unverified` means no source was reachable in this pass; nothing is inferred.

| product | branch unit | checkout | who merges | what retires the branch | what broke |
|---|---|---|---|---|---|
| GitHub Copilot (cloud agent / Copilot in the cloud) | one branch per task, hard rule: "Copilot can only work on one branch at a time and can open one pull request per task" [^c55084#192] | ephemeral development environment — "cloud sandbox, on GitHub Actions, or in a custom environment" [^c55084#72]; "In its ephemeral development environment, Copilot can build or compile your project and run automated tests, linters and other tools" [^816f53#113] | human reviews the PR; optionally "Agent Merge ... watches a pull request and works on the blockers you select: failed GitHub Actions workflows, merge conflicts, or both" [^c55084#134] | `unverified` (no doc on branch deletion; the session, not the branch, is the retired unit) | branch protection can block it: "A ruleset or branch protection rule can prevent Copilot from creating or updating pull requests" [^c55084#197] |
| Devin | `unverified`; docs describe sessions ending in "draft PRs waiting for review" [^1b070c#64] | cloud VM ("Workspace" with shell, IDE, browser) [^1b070c#76] | human | `unverified` | none published; `/work-with-devin/devin-sessions` returned 404 on 2026-11-12, so the session/branch page is not where round 1 guessed |
| Sweep | `unverified` for branch mechanics; product effectively retired — "We're now building an AI coding assistant for JetBrains" [^9a9d40#602] | self-hosted Docker stack (`docker-compose.yml`, `bin/server/*`) `observed` [^2] | bot opens PR from ticket; human merges (repo file tree includes `handlers/create_pr.py`, `core/pull_request_bot.py`) `observed` [^9a9d40#404,381] | `unverified` | pivoted away; repo left public |
| Sourcegraph / Amp | `unverified`; the only unit named is an "orb": "Machines that Amp creates per thread, with your code, tools, and plugins already set up" [^12] | per-thread machine | `unverified` | `unverified` | none published |
| Miko, Orbi, Baton, Code Conductor | `unverified` — no reachable public description in this pass | `unverified` | `unverified` | `unverified` | `unverified` |

One design signal worth recording: Copilot is the only product here with a *hard, published* work bound, and it is a clock, not a size budget — "Each Copilot session that runs on GitHub Actions has a maximum execution time of 59 minutes. This limit cannot be extended or bypassed." [^c55084#193] The setup-step `timeout-minutes` is capped at the same 59 [^816f53#97], so the cap is structural rather than per-repo policy. Devin's bound is the opposite: an admission heuristic, "if you can do it in three hours, Devin can most likely do it" [^1b070c#15].
````

````
## Iteration architecture

Six items per product. Most cells are `unverified`; that is the finding, not a gap in the writing.

| product | (a) piece boundary / loop cost | (b) hermetic vs live tests | (c) model mocked in tests / opt-in budget | (d) prompt-change regression | (e) turn bound | (f) slow-or-flaky quarantine |
|---|---|---|---|---|---|---|
| Copilot | one PR per task per session [^c55084#192]; loop cost = one environment setup + one 59-min session | live, in an ephemeral env: "Copilot can build or compile your project and run automated tests, linters and other tools" [^816f53#113]; dependency install is agent-driven trial and error unless pinned — "Copilot can discover and install these dependencies itself via a process of trial and error, but this can be slow and unreliable" [^816f53#115] | `unverified` | `unverified` | 59 minutes, "cannot be extended or bypassed" [^c55084#193] | `unverified` |
| Devin | `unverified` | `unverified`; only a verification *recommendation*: "Make tasks easy to verify — e.g. checking that CI passes" [^1b070c#55] | `unverified` | `unverified` | none published; 3-hour rule of thumb [^1b070c#15] | `unverified` |
| Sweep | `observed` from repo layout: unit = one ticket/PR handler (`handlers/on_ticket.py`, `handlers/create_pr.py`) [^9a9d40#404,412] | `observed`: two tiers — `tests/e2e/` drives real CLI/PR paths, `tests/` replays recorded webhook payloads from `tests/events/*.pkl` and `tests/jsons/` fixtures [^2] | `observed` partial: fixture replay is the default, so no live model in the unit tier; e2e tier has `tests/monitor_prod.py` `observed` [^9a9d40#545] — whether e2e calls a real model with a declared budget is `unverified` | `unverified`; `tests/modify_benchmark.py` exists `observed` [^9a9d40#541] but its definition was not read | `unverified` | `unverified` |
| Amp / Sourcegraph, Miko, Orbi, Baton, Code Conductor | `unverified` | `unverified` | `unverified` | `unverified` | `unverified` | `unverified` |

What can be generalised, and only at the level of the queue products rather than the agents:

- **Quarantine is a solved problem elsewhere.** Trunk: "Trunk Flaky Tests quarantines known flakes so they never block the queue at all" [^dec386#206]. Mergify turns it into a metric rather than a mechanism: "Checks Retries: how often checks are retried, and how often a retry ends in a merge. A low recovery rate points at genuinely broken tests rather than flaky ones." [^3]
- **Prompt changes have no published regression gate at any vendor surveyed.** Not one of the six agent products documents a prompt-change test suite, a golden-transcript corpus, or a behaviour diff. Sweep's `tests/modify_tests/` and `tests/jsons/*.json` are the closest artefact — fixture inputs with expected modification outputs — and it is `observed`, unlabelled, and in a retired repo.
- **Model substitution with a declared budget:** no source. If we build it, it is ours.
````

````
## Sprawl measurement

Branch-age and open-branch-count reporting: **no product found**. Round 1's answer stands, with one correction: the *adjacent* metric is well instrumented, just not per branch.

| product | metric | definition as published |
|---|---|---|
| Trunk | time to merge, main-red rate, queue wait | "your P90 time to merge, how often main is red, the hours lost waiting in the queue, and the CI compute a parallel, batched queue would give back" [^dec386#254]; headline case study "6 hrs → 90 min / Time to merge" [^dec386#168] |
| Mergify | queue time, queue size, throughput, CI runs per merged PR | "Average Queue Time: the full time a pull request spent in the queue" [^d17ac0#121]; "Max Queue Size: the largest the queue got" [^d17ac0#92]; "CI Runs: how many CI runs the queue starts for each pull request it merges, and the share of those runs that were wasted" [^3] |
| Aviator | analytics page exists (`/mergequeue/concepts/analytics`), contents `unverified` — page was listed in the docs index [^0fa0ab#28] but not fetched |
| GitHub Copilot | org-level PR metrics: "organization and enterprise metrics on pull request creation, merges, and time to merge" [^c55084#247] |

So: time-to-merge is a commodity metric with at least three implementations. Branch *age distribution* and open-branch *count* are not, which is consistent with the queue framing — a queue is a place branches go to die quickly, so nobody measures the ones that never arrive. That is precisely the leak an agent fleet has, and it means our `## Unverified` entry should read "no prior art for the metric", not "not measured by anyone we looked at".
````

````
## Changes to our design

Numbered; section numbers are as cited in round 1 (`docs/WORK-ITEM-MODEL.md` §3, §4, §7).

1. **§3 (isolation predicate) — record as our invention.** No published rule was found in six agent products and four queue products. Every agent product that documents the choice branches unconditionally per task (Copilot: one branch, one PR [^c55084#192]); every queue product assumes a branch already exists. Round 1's "no source states a predicate" is confirmed, not merely unfalsified. Record it as our invention so nobody later mistakes §3 for prior art.
2. **§4 (work-item taxonomy) — split "verified" from "validated against the current tip".** Row #6928's problem is the same one all four queues solve by re-running CI on a synthetic commit. The taxonomy needs a distinct state for "passed against a tip that is no longer the tip". Mergify's `checks-timeout` / `conflict-with-base-branch` `dequeue` reasons are the vocabulary to borrow [^1].
3. **§4 — correct round 1's "a merge queue is the pattern at fleet scale".** It is four different patterns. Re-validation (GitHub), holding (Mergify), reset-all (Aviator), and predictive-plus-bisection (Trunk) have different failure modes: holding needs a blocker to still be queued, reset-all converts one bad PR into N wasted CI runs [^0fa0ab#98]. Pick one explicitly rather than saying "queue".
4. **§4 — adopt a stale-candidate deadline.** Mergify's `checks_timeout` exists because "the pull request would block the queue indefinitely" [^1]; GitHub lists "timeout" as a removal trigger. Our landing gate has no deadline, which makes a hung verify indistinguishable from a pending one.
5. **§4 — adopt the name-shape sweep, not a registry.** For stray worktrees/branches, copy Mergify's predicate — exact prefix plus fixed-length hex, delete only if "not in use by an active queue" [^1] — rather than maintaining a manifest that can drift.
6. **§7 (branch lifetime ≤ 2 days) — correct the bound's basis for agent work.** For humans the bound is calendar; for agents it is a turn clock or an admission heuristic (Copilot 59 min [^c55084#193]; Devin 3 h [^1b070c#15]). A 2-day lifetime is unbounded for an agent that can run 40 sessions in it. §7 should bound sessions *and* branches.
7. **§4 — do not import the anti-flake skip.** GitHub's "only merge unchecked" and Trunk's "merges once a later one passes" both land work whose own checks never passed. That contradicts the per-push gate; write the refusal down before someone proposes it as a throughput win.
````

````
## Still unverified

Grouped by why, because the reasons differ.

**Reachable but not fetched (budget).**
- Trunk's stale-candidate policy and testing concurrency (`/merge-queue/optimizations/predictive-testing`, `/administration/advanced-settings`).
- Aviator: `/mergequeue/concepts/reducing-queue-failures-due-to-staleness` (listed in the index [^0fa0ab#48] — the exact page this question wanted), `/concepts/batching`, `/concepts/analytics`.
- Mergify `/merge-queue/queue-modes` (parallel vs isolated semantics), `/merge-queue/batches` (bisection), `/merge-queue/two-step`.

**Unreachable.**
- `docs.sweep.dev` did not resolve (DNS) on 2026-11-12; the GitHub repo is the only Sweep source, and it is retired.
- `docs.devin.ai/work-with-devin/devin-sessions` → 404; `docs.devin.ai` has no page found describing branch creation, branch naming, or branch cleanup.

**Not published, as far as anything fetched shows.**
- Prompt-change regression testing: zero sources, all six agent products.
- Model mocking in tests with a declared budget: zero sources. Sweep's fixture replay is the closest artefact and is `observed`, not documented.
- Per-product flaky/slow test quarantine for agents (as opposed to queue products).
- Branch age distribution and open-branch count as a reported metric: no product.
- Miko, Orbi, Baton, Code Conductor: nothing reachable; round 1's table cells for these should stay blank rather than inferred.

Sources (all fetched 2026-11-12):
[^4]: Trunk, "Merge Queue overview", https://docs.trunk.io/merge-queue
[^5]: Trunk, "Merge Queue for GitHub", https://trunk.io/merge-queue
[^1]: Mergify, "Pull Request Lifecycle", https://docs.mergify.com/merge-queue/lifecycle
[^6]: Mergify, "Merge Queue", https://docs.mergify.com/merge-queue/
[^3]: Mergify, "Monitoring your Merge Queue", https://docs.mergify.com/merge-queue/monitoring
[^7]: Aviator, "MergeQueue", https://docs.aviator.co/mergequeue
[^8]: Aviator, "Queue Modes", https://docs.aviator.co/mergequeue/concepts/queue-modes
[^9]: GitHub Docs, "GitHub Copilot on GitHub.com and GitHub Mobile", https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
[^10]: GitHub Docs, "Configure the development environment for agents on GitHub Actions", https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/customize-the-agent-environment
[^11]: Devin Docs, "Introducing Devin", https://docs.devin.ai/get-started/devin-intro
[^12]: Amp Docs, "Introduction", https://ampcode.com/manual
[^2]: GitHub, "sweepai/sweep" repository (file tree + README), https://github.com/sweepai/sweep — `observed`
````

The load-bearing new finding is item 3 in "Changes to our design": round 1's phrase "a merge queue is the pattern at fleet scale" hides four incompatible behaviours, and the difference between Mergify's *hold* and Aviator's *reset-all* is the difference between one PR waiting and N PRs re-running CI. If you want the five fetchable pages above turned into a round-3 pass, the Aviator staleness page and Mergify's batch page are the two with the highest chance of changing a decision.

**References**

[^1]: [Pull Request Lifecycle](https://docs.mergify.com/merge-queue/lifecycle) (59%)
[^2]: [sweepai/sweep GitHub Repo](https://github.com/sweepai/sweep) (18%)
[^3]: [Monitoring your Merge Queue](https://docs.mergify.com/merge-queue/monitoring) (3%)
[^4]: [Trunk Merge Queue overview](https://docs.trunk.io/merge-queue) (2%)
[^5]: [Merge Queue for GitHub: Parallel and Flake-Proof | Trunk](https://trunk.io/merge-queue) (2%)
[^6]: [Merge Queue](https://docs.mergify.com/merge-queue/) (2%)
[^7]: [MergeQueue | Aviator Documentation](https://docs.aviator.co/mergequeue) (2%)
[^8]: [Queue Modes | Aviator Documentation](https://docs.aviator.co/mergequeue/concepts/queue-modes) (2%)
[^9]: [GitHub Copilot on GitHub.com and GitHub Mobile - GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) (2%)
[^10]: [Configure the development environment for agents on GitHub Actions - GitHub Docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/customize-the-agent-environment) (2%)
[^11]: [Introducing Devin - Devin Docs](https://docs.devin.ai/get-started/devin-intro) (2%)
[^12]: [Introduction | Amp Docs](https://ampcode.com/manual) (1%)