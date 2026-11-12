I'll research this in focused batches, starting with the primary sources the request prioritizes.```
## Branch taxonomy: what a branch is for

**Evidence classes used throughout this report.** `observed` = I read the mechanism described in a primary doc, source README, issue report, or vendor changelog, and the description states behaviour rather than benefit. `advertised` = a vendor, blog, or directory page states a claim about a product or practice that I could not confirm at the mechanism level. Every item carries URL and fetch date 2026-11-12.

**The finding that should drive the taxonomy.** In every fleet I could inspect, the branch name records *nothing a machine can act on*: who created it, when it dies, or where it is allowed to land. Anthropic names worktree branches `worktree-<name>` and puts them under `.claude/worktrees/` (observed) — https://code.claude.com/docs/en/worktrees, quote: "By default, the worktree is created under `.claude/worktrees/<name>/` at your repository root, on a new branch named `worktree-<name>`". OpenHands names them `openhands/<id>` (observed, from a user issue) — https://github.com/OpenHands/OpenHands/issues/18142. GitHub's Copilot generated names "better branch names" as a shipped change, i.e. naming was previously arbitrary (observed changelog) — https://github.blog/changelog/2025-10-16-copilot-coding-agent-uses-better-branch-names-and-pull-request-titles, quote: "When Copilot starts work, it creates a new branch and opens a draft pull request."

None of these encode a lifetime or an owner. That is exactly the datum our census lacks.

**Proposed taxonomy for durian-pi.** A branch name must answer four questions mechanically: *which item*, *who retires it*, *when it dies*, *where it may land*. The prefix is the machine-readable part.

| Prefix | Unit | Created by | May land into | TTL / retirement trigger | Owner of retirement |
|---|---|---|---|---|---|
| `main` | trunk | operator only (via `promote`) | — | never | operator |
| `staging` | integration pointer | broker (reset to `main` after each promotion) | `main` | reset on every promote | broker |
| `item/<id>-<slug>` | one queue row | seat, only if isolation requested | `staging` | 72 h or item close, whichever first | broker sweeper |
| `feature/<slug>` | one cooperative feature | operator or lead seat | `staging` | 7 d hard cap | operator |
| `verify/<id>` | evidence-only, tests added, no product code | verifier seat | `staging` | 24 h or on land | broker sweeper |
| `docs/<slug>` | doc/disposition/measurement edit — **normally not created at all** | — | direct to `staging` from the seat's own checkout | — | — |
| `scratch/<seat>/<yyyymmdd>` | experiments, spikes | seat | **never** | 24 h, deleted without disposition | broker sweeper |
| `archive/<item>` | quarantined zombie, read-only ref | broker | never (requires operator decision) | 30 d then disposition-or-delete | operator |

**Why those boundaries and not `feature/`-for-everything.** The load-bearing split is `item/` vs `docs/` vs `scratch/`. Trunk-based literature's unit is *not* the task; it is the *commit that can go live*: "Anything bigger than a single commit is built behind an abstraction or a flag, so that every push is able to go live" (advertised-elsewhere, trunkbaseddevelopment.com) — https://trunkbaseddevelopment.com/committing-straight-to-the-trunk/. Our items range 5 minutes to 5 days, so a task-shaped branch is the wrong unit for roughly the fraction of items that are single-commit work. Taxonomy must therefore let most items have **no branch at all** (see next section), and reserve `item/` for those that mutate executable code.

**Machine-checkability (question 10).** Prior art splits cleanly into client-side convention and server-side enforcement:
- Client-side, prefix-only: "Husky pre-push hook that rejects branch names not matching a prefix convention (feat/, fix/, chore/, gsd/) — runs on push so local scratch branches stay free-form" (observed design write-up) — https://blakepetersen.io/hooks/branch-name-enforcement. Note the deliberate escape hatch: free-form local names. That is the same concession our `scratch/` prefix should make explicitly rather than implicitly.
- Regex in a pre-commit config, restricting commits on non-matching branches — https://www.devwithimagination.com/2020/04/13/git-commit-hooks-for-branch-naming-pre-commit/ (observed).
- Commit-message linting enforced on the server: "We use Conventional Commits, enforced by commitlint via the commit-msg Git hook" (observed, repository CONTRIBUTING) — https://github.com/Devlaner/devlane/blob/main/CONTRIBUTING.md.

**Payoff and cost.** Payoff is that retirement, census bucketing, and gate selection become queries rather than heuristics; today `tools/branch-census.mjs` must guess intent from ref shape. Cost of an unenforceable naming rule is measurable drift: our 81 refs include names that cannot be classified without reading the item row. A naming rule the tooling cannot enforce is worse than no rule, because it produces false confidence in the census.

**Enforcement point we already own.** `src/confine.mjs` is the seat's tool boundary, so prefix validation belongs there (refuse `checkout -b` outside the prefix set), not in a git hook a seat can skip with `--no-verify`. This is the same layering Claude Code documents: its worktree checks block tool calls, and one check is explicitly unremovable — "You can't turn this check off." (observed) — https://code.claude.com/docs/en/worktrees.
```

```
## Branchless work: when no branch is the right choice

**The defensible case.** Trunk-based practice is not "branch rarely"; it is "the trunk is always releasable, and anything that cannot be released yet is hidden behind a flag or an abstraction". Observed statement of the technique: "Branch by Abstraction is a set-piece technique to effect a 'longer to complete' change in the trunk" (advertised-elsewhere, trunkbaseddevelopment.com) — https://trunkbaseddevelopment.com/branch-by-abstraction/. And the discipline that makes small direct commits safe: "The short-lived feature branch should only last a day or two and never diverge from the trunk enough so that a merge back is problematic" — https://trunkbaseddevelopment.com/youre-doing-it-wrong/.

**Prior art for literally branchless agent work.** Aider commits its edits into whatever checkout it is given, one commit per change, with no branch of its own (observed docs) — https://aider.chat/docs/git.html, quote: "--no-auto-commits will stop aider from git committing each of its changes." That is branchless-by-default at the tool level: the user's branch is the unit, the commit is the atom. Our `docs/` case is the same shape.

**What makes it safe — the four conditions, with real thresholds.**
1. **Batch size.** The published threshold is a day: "The DORA research that backs trunk-based development as a high-performance practice draws the line at 24 hours" (advertised-elsewhere, vendor learning page) — https://mergify.com/learn/trunk-based-development/short-lived-branches. Treat 24 h as the branchless-equivalent budget for a *single* change too: anything a human cannot review in one sitting is not branchless material.
2. **Required checks.** Not optional and not "latest run wins": GitHub requires checks on the latest commit and only accepts recent ones — "Required checks must pass on the latest commit SHA. Checks from earlier commits don't satisfy the requirement." (observed) — https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks.
3. **Fast rollback.** Trunk-based practice needs a revert path that costs one commit. Our `docs/` and `measurement` items satisfy this trivially (revert a markdown file); `src/` changes do not, because our suite is 300 tests / ~120 s and a bad trunk commit blocks 10 seats.
4. **Feature flags / abstraction** for anything not instantly releasable — https://trunkbaseddevelopment.com/feature-flags/. Flag debt is the known tax: a cited Chrome study found "53% of release toggles survived more than 10 releases" (advertised-elsewhere, secondary) — https://journal.daniellopes.dev/p/trunk-based-development-vs-feature-branches-ai.

**Where branchless fails, concretely.**
- **Concurrent edits to one file.** Two seats editing `docs/DISPOSITIONS.md` branchlessly produce a conflict with no branch to rebase — the conflict lands in the append path itself. Mitigation is structural (append-only file, single writer), which our broker already provides.
- **Unreviewed executable change.** Stripe's design point is the inverse: unattended agents still route through human review, "more than a thousand pull requests merged each week. Though humans review the code, minions write it from start to finish" (observed, vendor engineering blog) — https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents.
- **Compliance / audit.** If the artefact of record is a review, a branchless commit leaves no review object. Google's model works around this by making *pre-submit* the gate rather than a branch: "Each team to create a fast subset of tests, often a project's unit tests, that can be run before a change is submitted" (observed, engineering write-up) — https://xgwang.me/google-ci/.

**Rule for durian-pi.** Branchless is permitted when *all* of: no executable code touched (`docs/`, `docs/DISPOSITIONS.md`, `tools/` measurement output); diff under ~200 changed lines; `--changed-suite` completes under ~20 s; and a disposition row is written in the same commit. Everything else asks for an `item/` branch and a worktree. This is a narrowing of our current default, not a widening: today every claim creates a branch and a worktree, which the census shows nobody retires.
```

```
## Staging and promotion: merge queue vs staging branch vs protected trunk

| Pattern | How batches group | What promotion does to history | What the gate checks | A queued item that goes stale |
|---|---|---|---|---|
| Git Flow `develop`/`staging` (long-lived) | by release intent, not by readiness | merge commits accumulate; `develop` diverges permanently from `main` | whatever the team runs on `develop` | rots silently; divergence grows; the classic "merge hell" |
| GitHub merge queue | FIFO groups of PRs rebased onto the target plus everything ahead of them | temporary branches validated, then one merge into the base | required status checks **on the merged result**, not on the PR head | auto-removed: "if there are failed required status checks or conflicts with the base branch, the pull request will be removed from the queue" (observed) — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue |
| Google-style CB + TAP | pre-submit fast subset on the change; post-submit full affected set asynchronously | submit is linear onto trunk | fast pre-submit tests per team; slow tests run after submit | change is already in; breakage is caught post-submit and reverted |
| Release train | time-boxed cut, cherry-picks | cut branch + cherry-picks; trunk unaffected | release-candidate validation | missed the train; waits for next cut |
| Protected trunk + required human approval | one PR at a time | one merge per approval | required reviews + required checks | PR sits until approved or checks expire |

**Reading of the prior art.** The merge queue is the only pattern that solves the actual problem we have (many writers, one trunk, checks that must pass against the *combined* result) and it does so by making validation a property of the batch, not of the branch. It also has a documented cost that matters at our scale: "Be aware that jumping to the top of a merge queue will cause a full rebuild of all in-progress pull requests" (observed) — same URL. With 300 tests in ~120 s and up to 10 seats, a full rebuild per queue jump is affordable; a full rebuild per *landed item* is what we must avoid.

**The pattern that is not on the list but is what "agent lands, human promotes, one verb" actually is:** a **serialized merge queue of one with a fast-forward-only promotion**. `scripts/land.mjs` already does the hard part — it merges in a scratch worktree and advances `main` only by clean fast-forward. The mistake available to us is making `staging` a *divergent long-lived branch* (Git Flow) and thereby re-importing the failure mode trunk-based practice exists to avoid. `staging` must be a **pointer that is reset to `main` after every promotion**, so its divergence from `main` is exactly the set of landed-but-unpromoted commits and is always linear.

**Compared explicitly for our constraint set:**

- **Merge queue (GitHub)**: best gate semantics, wrong control surface. We are on a local box with a single-writer broker, not GitHub; adopting the semantics without the platform means we *are* the queue, which is fine — but we must copy two specific behaviours: (a) checks run against the composed result, (b) a stale/failing entry is removed with a stated reason rather than left in place.
- **Google CB/TAP**: closest match to our existing 120 s suite. The split we should steal is *fast subset gating, slow set after*: gate promotion on the fast subset plus `--changed-suite`, run `--all` on a schedule and on promotion.
- **Git Flow `staging`**: the anti-pattern. It is the pattern our words ("staging branch") most invite and the one with the worst documented outcome for frequent small landings.
- **Protected trunk + approval**: correct end state for `main`; insufficient alone for parallel seats because it gives no batch validation and no place for un-promoted work to accumulate safely.
- **Release train**: unnecessary; we have no artefact to release, only a repo state. It would add a second long-lived branch (exactly what we are trying to delete).
```

```
## Who lands, and what the gate must enforce

**Who lands, in observed fleets.**
- Devin: authors a PR, humans merge, and is explicitly subjected to the same rules as staff — "Devin is subject to the exact same branch protections and SDLC policies as any human engineer." (observed) — https://docs.devin.ai/essential-guidelines/sdlc-integration.
- GitHub Copilot coding agent: drafts, and the platform adds a check humans get anyway — "the agent's pull requests require human approval before any CI/CD workflows are run" (advertised, GitHub product blog, mechanism described) — https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/.
- Stripe Minions: unattended authoring, human review, ~1000+ PRs/week merged — https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents.
- Cursor Cloud Agents: open the PR themselves, human decides — "open pull requests in the repos it changes" (observed docs) — https://cursor.com/docs/cloud-agent.
- Claude Code in worktrees: no merge authority at all; it isolates and lets the human land.

So the industry default for *agents* is: **the agent lands nothing that a human has not approved, and the platform — not the agent — enforces it.** Author-merges-own-work is treated as a governance risk that is closed structurally, by requiring a non-author approval or a bot-after-checks merge, rather than by asking the author to behave.

**Our divergence is forced and safe only if `staging` is genuinely non-authoritative.** A seat landing its own verified branch into `staging` is author-merges-own-work. That is acceptable *because* `staging` is not the artefact anyone consumes — `main` is — and `main` is reachable only by the operator's one verb. If a seat could reach `main`, this design would be the documented governance risk with no compensating control. State that in the rule text the seat reads, in those terms.

**What the gate must enforce (question 5 + question 11).**

Platform-enforced on GitHub, for comparison, and the bypass paths that are documented rather than hypothetical:
- Branch protection is **off for admins by default**: "By default, the restrictions of a branch protection rule don't apply to people with admin permissions to the repository or custom roles with the 'bypass branch protections' permission." (observed) — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches. The mitigation is a checkbox, i.e. convention at the org level, and it does not cover force-push if "Allow force pushes" is on.
- Required checks are only as good as their freshness and identity: they must run on the latest SHA, must have succeeded within seven days, and "If a check and a commit status have the same name, both must pass when that name is required" (observed) — https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks.
- A check that *reports* is not a check that *blocks*: Devin documents this trap for its own review check — "Posting a check does not make it a merge requirement: configure the displayed check as required in your repository's branch rules to block merges." (observed) — https://docs.devin.ai/work-with-devin/devin-review.
- The real bypass at our scale is not force-push; it is a writer whose tool set includes "advance main". No vendor setting can close that. Claude Code's approach is the only pattern I found that survives a seat that does not understand the rule: enforce at the tool boundary and refuse to make the refusal configurable — the four worktree checks, of which the command-shape check is unremovable (https://code.claude.com/docs/en/worktrees).

**Mapping onto what we already have.**
- `src/landinggate.mjs` refusing a landing with no `--suite`/`--changed-suite` is a **negative** gate (it cannot proceed without evidence). That is stronger than a required-check convention because it is in the only code path that advances a ref.
- `scripts/land.mjs`'s fast-forward-only advance is the mechanism that makes the gate non-bypassable *by construction*: a seat cannot "merge anyway" without producing a non-FF, which the helper refuses.
- `src/confine.mjs` (no `git branch -D`) is the retirement half of the same boundary.
- `tools/branch-census.mjs` is the **audit**, and an audit is what converts a convention into a detectable violation. Without it, a bypass is invisible; with it, a bypass becomes a census delta — which is exactly how we noticed 4 new refs in 10 minutes.

**Evidence attached to a landing, readable later (question 11).** Prior art attaches evidence at merge time and loses it: check runs point at a commit, CI logs expire, PR templates are free text. The patterns that stay readable are those that write a durable artefact *in the repo*: Google's post-submit accounting, and our own `docs/DISPOSITIONS.md` append-only ledger. Cursor's cloud agents attach videos, screenshots and logs to the PR (observed) — https://cursor.com/help/ai-features/background-agents — which is good at merge time and unreadable a month later without the hosting account. Recommendation: the promote verb prints the evidence **and** the disposition row records (item id, ref, commit range, suite name, suite result, duration, census counts before/after), so evidence survives independently of any hosting service.
```

```
## Retirement and sprawl control

**Observed practice, and observed failure.**
- Claude Code retires on exit with a work-guard, and sweeps by age afterwards: on exit it "checks the worktree for work that removal would delete"; a periodic sweep removes worktrees "once they are older than your `cleanupPeriodDays` setting" (observed) — https://code.claude.com/docs/en/worktrees. Two documented gaps are directly relevant to us: non-interactive runs never clean up ("Non-interactive runs with `-p` have no exit prompt, so Claude doesn't clean up their worktrees"), and it holds a `git worktree lock` while running so a concurrent sweep cannot delete live work. That lock is the mechanism our sweeper lacks.
- OpenHands has the failure we are living in, reported as a bug: "Worktree is per conversation (Local Repo / New Worktree selector), but worktrees are never cleaned up: deleting a conversation leaves its worktree and openhands/<id> branch in the repo." (observed, user issue) — https://github.com/OpenHands/OpenHands/issues/18142. This is the strongest available external corroboration that branch+worktree-per-task without retirement produces unbounded growth even in a well-funded product.
- Copilot's model makes retirement a consequence of the PR object, not a separate chore: branch → draft PR → merge, with delete-on-merge available at the platform level (observed changelog behaviour) — https://github.blog/changelog/2025-10-16-copilot-coding-agent-uses-better-branch-names-and-pull-request-titles.

**Metrics that exist in the wild.** Branch age distribution with a 7-day expectation — "Healthy repositories have most branches in the 0-7 day range" (advertised, vendor blog) — https://pullpanda.io/blog/git-branch-visualization-monitoring-tools. The same page supplies a cheap census query pattern (count refs older than 30 days via `git for-each-ref`), which is what `tools/branch-census.mjs` already does. LinearB ships an "Active Branches Metric" defined as branches "that remained open (i.e., unmerged or not closed)" in a window — https://linearb.helpdocs.io/article/3oscrws8cy-active-days-metric-ldb. Managed sentinels exist for exactly our threshold problem (sprawl above a threshold triggers alerts) — https://kestra.io/blueprints/github-stale-unmerged-branch-governance-sentinel.

Cost of collecting: negligible for ref counts and ages (one `for-each-ref`), cheap for time-to-merge (needs item timestamps we already have in the queue store), expensive for "is this branch dead" — which is precisely the question git cannot answer and the reason our 46 clean unmerged `done` branches are stuck. Do not build a metric that requires answering it.

**Responsibility model for durian-pi.** Retirement must not be the seat's job. A seat that finished an item has no incentive and no authority to judge whether its unlanded work is safe to delete, and `src/confine.mjs` already denies it the destructive verb. So:
1. **The broker** (single writer, already the only serialization point) owns a `retire` transition: `item closed → item/<id> ref enters one of {landed, quarantined, abandoned-with-disposition}`.
2. **Landed** refs are deleted immediately on promotion of `staging`→`main`, because the commits are provably on trunk (`git merge-base --is-ancestor`).
3. **Quarantined** refs (unmerged, item `done`, content not on trunk — our 46) are renamed `archive/<item>`, marked read-only in the census, and require an operator decision. Deletion without a `docs/DISPOSITIONS.md` row is refused by `src/confine.mjs`.
4. **Abandoned** refs get a disposition row that says *why* nothing landed. That row is the retirement artefact; the ref is then deleted.
5. **A TTL sweeper** runs on the broker's clock, not a seat's, and only for prefixes whose TTL is machine-readable (`scratch/` 24 h, `verify/` 24 h, `item/` 72 h, `feature/` 7 d).
6. **Sweeper safety**: adopt Claude Code's lock pattern — never delete a worktree the broker did not create, never delete one holding unpushed commits, and never delete one with a live claim in the queue store.

**The counter-rule.** Retirement must not be so aggressive that it destroys undecided work. Our 46 refs each carry content not on trunk (`git merge-tree main <ref>` differs), so the safe operation is *decision*, not *deletion*. A TTL that deletes unlanded work without a disposition converts sprawl into data loss.
```

```
## Conflicts and zombie branches

**What prior art calls them.** Not "zombie". The literature's vocabulary is *long-lived*, *stale*, *abandoned*, *divergent*, and the operational term is *stale branch* with an age threshold (30 days is the common alert line) — https://pullpanda.io/blog/git-branch-visualization-monitoring-tools, https://codepulsehq.com/guides/git-branch-aging-report. Our "zombie" is a *specific* case none of them name well: the item is `done`, the branch is clean, and the content never landed. Git has no state for it, which is why the queue disposition ledger is the right home for the concept rather than the ref name.

**Merge vs rebase vs re-cut.**
- Our `scripts/land.mjs` already implements the correct shape: merge in a scratch worktree, advance the target only by fast-forward. In practice that means **rebase-by-replay** (or a merge that is then FF-able) — never a merge commit onto `main`.
- GitHub's queue takes the third option implicitly: it validates the composed result and drops an entry whose composed state conflicts — "if there are failed required status checks or conflicts with the base branch, the pull request will be removed from the queue" (observed) — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.
- Trunk-based practice's prohibition is the design constraint that makes choice 1 affordable: "never diverge from the trunk enough so that a merge back is problematic" — https://trunkbaseddevelopment.com/youre-doing-it-wrong/.
- Published cost curve, useful as a policy boundary rather than a law: "The cost is not linear in branch lifetime. A two-day branch is roughly a regular merge. A two-week branch is a project." (advertised-elsewhere) — https://mergify.com/learn/trunk-based-development/vs-feature-branch.

**Policy for durian-pi, three states, mechanically distinguishable.**
1. **Behind but mergeable** (`git merge-tree main <ref>` produces a tree, no conflict): re-cut is not needed. Land via `scripts/land.mjs`; the suite decides. This is the common case and needs no human.
2. **Mechanical conflict** (merge-tree reports conflict markers): *never auto-resolve*. Re-cut from current `main` and re-apply the item's diff; if re-application fails, the item returns to `queued` with a `conflict` disposition and the ref is quarantined to `archive/<item>`. Rationale: an automatic resolution is an unreviewed semantic decision, and the seat has no standing to make it.
3. **Semantic conflict — the state nobody names.** Merge is clean, suite fails. This is *more* dangerous than a textual conflict because the tooling says "fine" and the behaviour says "broken". Treat suite failure on a clean merge as a semantic conflict, block the landing, and require the operator or a second seat. This is the only place our design needs a human in the fast loop, and it should be rare if `item/` branches stay under 72 h.

**Prevention, in order of strength.**
- Short TTL on `item/` (72 h) — prevents the class rather than managing it.
- `--changed-suite` required at landing — makes semantic conflict visible at land time instead of at promote time.
- Census field "age of unmerged ref attached to a closed item" — turns zombies into a number that goes up and gets fixed, instead of a discovery.
- Archive-before-delete — keeps the option to recover work that a conflict made unlucky.

**What we should not do.** Do not run a nightly job that merges `main` into every open branch to "keep them fresh". It manufactures merge commits, hides the divergence that the TTL is meant to punish, and turns a policy problem into a graph problem.
```

```
## Cooperative work on one feature

**The four arrangements, and what each costs.**
1. **One shared branch + merge queue.** Proven at scale (GitHub's queue, Google's CB), but the queue's validation cost is per-batch, and a shared branch adds a second, manually-managed integration point above the queue. Only worth it when the feature genuinely cannot be decomposed.
2. **Stacked PRs.** Devin ships this as a first-class mode: "an ordered series of pull requests that make up one piece of work and land together, bottom-up" (observed) — https://docs.devin.ai/work-with-devin/stacked-prs. This is the best fit for *reviewable* decomposition, but it multiplies the retirement problem: N branches per feature, all of which must be retired together.
3. **Feature flags on trunk.** The trunk-based answer to "longer to complete": build behind a flag, integrate continuously, flip when done — https://trunkbaseddevelopment.com/feature-flags/. Costs flag debt (53% of Chrome toggles outlived 10 releases, per the secondary source above) and requires the flag registry to be retired too.
4. **Decomposition so work never overlaps.** Anthropic states this as the required discipline for its team mode: "Agent teams don't isolate teammates in worktrees, so partition the work so each teammate owns a different set of files." (observed) — https://code.claude.com/docs/en/agents. That single sentence is the most useful design constraint I found for our case: if teammates cannot be isolated, the partition *is* the isolation.

**Documented failure modes of shared branches.**
- Long-lived divergence: the branch becomes a second trunk with no owner and no gate — the Git Flow failure, restated.
- Conflict storms: with N writers on one branch, each landing invalidates the others' validated state; the queue exists precisely to serialize this, so a shared branch *without* a queue is the worst of both.
- Unclear ownership: retirement requires a named owner; a `feature/` branch owned by "the team" is retired by nobody. Our census already shows the endpoint of ownership-free refs.

**Recommendation for durian-pi: decomposition first, stacking second, shared branch third, never as default.**
- Default cooperative shape: one `feature/<slug>` branch **plus** per-seat `item/<id>` branches stacked on it, with the broker serializing landings onto the feature branch exactly as it serializes onto `staging`. This reuses one mechanism instead of inventing a second.
- Precondition the operator must satisfy before a `feature/` branch exists: a written path-ownership map (which seat owns which paths). No map, no shared branch. This makes Claude Code's constraint into an artefact we can check, and it is checkable mechanically against the seats' diffs.
- Hard cap 7 days; at 7 days the feature branch either lands or its items are re-cut. The cap is what prevents the second-trunk failure.
- Feature flags: adopt only with a retirement row per flag in `docs/DISPOSITIONS.md`, otherwise we trade branch debt for flag debt.
```

```
## What real agent systems do

| System | Branch unit | Checkout | Who merges | Retirement | Iteration loop |
|---|---|---|---|---|---|
| OpenHands | branch per conversation, `openhands/<id>` (observed in issue) | git worktree per conversation, or Docker sandbox per conversation | user, outside the tool | **none** — "worktrees are never cleaned up" (issue #18142) | conversation-scoped; runtime is a startup flag or env var, so loop cost is high for runtime changes |
| Claude Code (harness) | worktree branch `worktree-<name>` under `.claude/worktrees/`, one per session/subagent | git worktree, with tool-level blocking of edits/git that escape it | user | on exit with work-guard; `cleanupPeriodDays` sweep; locks while running; **not** for `-p` runs | fast, local; enforcement is in-harness and one check cannot be disabled |
| Aider | none of its own — commits into the checkout you give it | your working tree | user | n/a | very fast; per-change commits, `/undo`-style history; no sandbox |
| Codex Cloud | one task workspace per task, branch + PR on request | OpenAI-managed container per task | user commits or opens PR | platform-managed with the task | two-phase runtime: setup with network, agent phase offline by default |
| GitHub Copilot coding agent | new branch per task → draft PR | GitHub-hosted environment; "pushes commits to a draft pull request" | human approval required before CI/CD runs; branch protections apply | branch follows the PR lifecycle | platform-mediated; iteration is PR-comment driven |
| Cursor Cloud Agents | separate branch per agent, PR opened on completion | dedicated VM per agent with repo, deps, secrets | human, or `/autopilot` handoff | not documented at mechanism level (see Unverified) | long-running by design; artefacts (video, screenshots, logs) attached to PR |
| Devin | branch + PR per session; stack of PRs for large work | Devin's own environment; `/pickup` moves the branch local | human, under the same protections as staff; Devin Review offers merge but respects repo rules | follows PR lifecycle | session-scoped; review is a separate product surface |
| Stripe Minions | branch + PR per task, one-shot | pre-warmed devbox per task, isolated from prod and internet | humans review and merge (~1000+/week) | not described at mechanism level | 10 s devbox spin-up is the headline loop cost; agent harness custom-built |
| Google (CB/TAP) | one change onto trunk, no per-task branch required | developer workstation, distributed build/test | author submits; pre-submit gate decides | n/a (no branch) | fast pre-submit subset per team; slow tests post-submit |
| durian-pi (today) | branch + worktree per claimed item | worktree per item (`src/worktree.mjs`) | nobody — refs are abandoned | none | 300 tests / ~120 s full suite; census is manual |
```

```
## Iteration architecture

The six probes, per system. Where I could not observe a mechanism I say so rather than infer — a plausible answer here would be the most expensive kind of error, because this section decides our architecture.

**Claude Code (harness).**
(a) Boundaries: session / subagent / worktree / hook / tool-permission layer. Loop cost is dominated by local git + test runtime; worktree creation is a git operation, not a container.
(b) Hermetic: local, against your real repo. Not hermetic by default.
(c) Model substitution: not documented as a test-time mechanism; the Agent SDK is the seam an integrator would mock.
(d) Prompt regression: not observable. Hooks are the deterministic seam (they fire on tool events), and one worktree check is explicitly non-optional.
(e) Turn bounding: session-scoped with resume; background sessions and `cleanupPeriodDays` bound lifetime; `git worktree lock` prevents cleanup racing a live turn. Explicit step/time caps not observed.
(f) Quarantine: not observable.

**OpenHands.**
(a) Boundaries: agent / conversation / workspace / runtime (Docker). The runtime is a server-wide flag (`OH_CONVERSATION_RUNTIME=docker`), which a user issue calls out as making per-conversation choice impossible (observed) — https://github.com/OpenHands/OpenHands/issues/18142.
(b) Live service: the runtime *is* a container; tests of runtime behaviour need Docker.
(c) Not observed.
(d) Not observed.
(e) Conversation-scoped; container retention and idle stop are env vars only (same issue).
(f) Not observed.
Note the architecture statement that the Canvas is "not responsible for ... Providing the sandbox or workspace isolation layer" — https://github.com/OpenHands/OpenHands/blob/main/docs/architecture.md — i.e. isolation is a separate piece, which is the boundary discipline D213 is asking for.

**Codex Cloud.**
(a) Boundaries: environment (setup phase) / agent phase / task workspace / PR. Two-phase runtime means environment changes and agent changes have different loops.
(b) Setup may use the network; the agent phase is offline by default — that is a genuinely hermetic-by-default design (observed) — https://developers.openai.com/codex/llms-full.txt, quote: "the agent phase runs offline by default unless you enable internet access for that environment".
(c) Not observed.
(d) Review-as-agent exists (Codex reviews PRs against repo guidance) but as a product, not as a regression suite for prompts — https://learn.chatgpt.com/docs/third-party/github.
(e) Task-scoped; each task keeps working while your machine is asleep (observed) — https://developers.openai.com/codex/cloud.
(f) Not observed.

**Cursor Cloud Agents.**
(a) Boundaries: agent / VM / repo set. Multi-repo tasks are supported, which widens the loop.
(b) Live VM per agent, full environment with secrets and network — the opposite of hermetic.
(c) Not observed.
(d) Not observed.
(e) Long-running by design; `/autopilot` hands a PR to a cloud subagent to iterate remotely.
(f) Not observed.

**GitHub Copilot coding agent.**
(a) Boundaries: agent session / GitHub-hosted environment / PR / Actions workflow. Loop cost is platform-mediated, i.e. minutes, not seconds.
(b) Live service; the agent validates with your tests and linter in its environment (observed) — https://github.blog/changelog/2026-03-24-ask-copilot-to-make-changes-to-any-pull-request/.
(c) Not observed.
(d) Not observed.
(e) Session-scoped, tracked through session logs (observed) — https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/.
(f) Not observed.

**Devin.**
(a) Boundaries: session / environment / PR / review surface. `/pickup` moves a session's PR branch to a local session, which is a genuine boundary-crossing affordance.
(b) Live environment.
(c) Not observed.
(d) Not observed; notably its review check **does not gate** unless configured (quote in the gate section) — evidence that "we post a check" is not "prompt regressions are gated".
(e) Session-scoped.
(f) Not observed.

**Stripe Minions.**
(a) Boundaries: devbox (10 s, pre-warmed) / agent harness (custom, separate from the human devbox tooling) / PR. The explicit separation of harness from devbox is the cleanest piece-boundary statement I found — https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2.
(b) Runs in Stripe's QA environment, "minions don't have access to real user data, Stripe's production services, or arbitrary network egress" — a *network-walled* live environment rather than a mocked one.
(c) Not observed.
(d) Not observed.
(e) One-shot by design: "fully unattended and built to one-shot tasks" (observed) — https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents.
(f) Not observed.

**Google CB/TAP (the reference implementation of fast/slow split).**
(a) Boundaries: per-team fast test subset vs the global post-submit set.
(b) Live distributed build/test (Forge); not hermetic per change.
(c) n/a.
(d) n/a.
(e) Submit-bound; asynchronous post-submit verification.
(f) **This is the quarantine pattern, industrialised**: the fast subset gates, the slow set runs after and is allowed to break — "After a change has been submitted, we use TAP to asynchronously run all potentially affected tests, including larger and slower tests" — https://xgwang.me/google-ci/.

**Prompt-regression prior art, separate from any one agent product.** The coherent pattern is to treat evals as tests with flake budgets: statistical thresholds, sampled runs, and quarantine rather than blind reruns — "Quarantine them — just like you'd quarantine a flaky unit test" (advertised, practitioner blog) — https://buildpulse.io/blog/flaky-evals-non-deterministic-llm-tests. And run them in CI with cost caps — https://buildpulse.io/blog/llm-ci-prompt-regression-testing-evals. Nothing I found does prompt regression at the *seat* level for a git-lifecycle rule specifically; that is our gap to fill, and the cheapest instrument is a frozen corpus of (item, tool-call sequence, expected refusal) cases replayed through `src/confine.mjs`.

**Implication for D213.** The pieces with a fast loop are: prefix validation, gate rules, land helper, retirement sweeper — all pure functions over refs and rows, all testable with no model and no worktree. The pieces with a slow loop are: a seat's judgement, a prompt change, a real landing. Architecture should push every *rule* into the fast piece and keep the slow piece model-free of policy. The failure to avoid is a rule that only exists in a prompt, because then its test loop is a model call — unbounded cost and non-determinism.
```

```
## Recommendations for durian-pi

Each item: what to build, owner role, acceptance test, and the citation it rests on. Owner roles are the ones we already have: **operator**, **broker**, **seat**, **verifier**.

1. **Adopt the eight-prefix taxonomy and validate it in `src/confine.mjs`, not in a git hook.** Owner: broker (code), operator (ratifies the list). Acceptance test: a seat calling `checkout -b wip/foo` gets a refusal naming the legal prefixes, and `tools/branch-census.mjs` classifies 100% of refs into a prefix bucket or reports `unclassified` as a hard error. Citation: Claude Code enforcing isolation at the tool layer with one unremovable check — https://code.claude.com/docs/en/worktrees.
2. **Make branchless the default for `docs/`, decisions, and measurements; require a branch only for executable change.** Owner: broker. Acceptance test: an item tagged `docs` closes with zero new refs and zero new worktrees, census count unchanged, disposition row present. Citation: trunk-based "single commit that can go live" plus flag/abstraction for the rest — https://trunkbaseddevelopment.com/committing-straight-to-the-trunk/.
3. **Redefine `staging` as a reset-on-promote pointer, never a divergent branch.** Owner: broker. Acceptance test: after `promote`, `git rev-list --count main..staging` is 0 and the promote verb refuses if it is not; a test asserts no merge commit is created on `main`. Citation: Git Flow divergence vs queue semantics — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.
4. **Gate on the composed result, not the branch head.** Owner: broker (`scripts/land.mjs` + `src/landinggate.mjs`). Acceptance test: a landing whose branch passes alone but whose composition with `staging` fails is refused, with the failure reason recorded in the disposition row. Citation: same merge-queue doc (checks run against base plus everything ahead; failing composed entries are removed with a reason).
5. **Seat lands to `staging`; only the operator's verb reaches `main`; the seat has no tool that can write `main`.** Owner: operator + broker (`src/confine.mjs`). Acceptance test: a seat-issued command attempting any ref update on `main` (including `push`, `update-ref`, `reset --hard` while checked out) is refused, and a replay test of the frozen refusal corpus fails if any of them is allowed. Citation: Copilot requiring human approval before workflows run, plus Devin being subject to the same protections as humans — https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/ and https://docs.devin.ai/essential-guidelines/sdlc-integration.
6. **Make bypass detectable, since it cannot be made impossible.** Owner: verifier. Acceptance test: `tools/branch-census.mjs` runs as a post-condition of every promote and of every N minutes, and a main-tip SHA that the broker did not record is reported as a `BYPASS` row. Citation: GitHub's default admin bypass, which proves protection is a setting and not a property — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.
7. **Retirement is a broker state transition with three outcomes — landed / quarantined / abandoned-with-disposition — and deleting a quarantine requires an operator decision.** Owner: broker, with operator approval for archive deletion. Acceptance test: the 46 clean unmerged refs attached to `done` items each end in a disposition row; zero refs deleted without a row; `src/confine.mjs` still refuses `branch -D` from a seat. Citation: OpenHands' never-cleaned worktrees as the failure mode — https://github.com/OpenHands/OpenHands/issues/18142.
8. **Add a TTL sweeper with Claude Code's safety rules: never delete a broker-unowned worktree, never delete one with unpushed commits, never delete one with a live claim; lock while a seat runs.** Owner: broker. Acceptance test: a fixture worktree with an unpushed commit survives a sweep; a locked worktree survives; a `scratch/` worktree older than 24 h with no commits is removed. Citation: https://code.claude.com/docs/en/worktrees (cleanup, sweep, lock, and the documented gap for non-interactive runs — which is exactly the gap our non-interactive seats would fall into).
9. **Classify conflicts in three states and refuse to auto-resolve case 2 or 3.** Owner: verifier. Acceptance test: a fixture branch with a textual conflict returns the item to `queued` with a `conflict` disposition and quarantines the ref; a fixture branch that merges cleanly but fails `--changed-suite` is blocked as a semantic conflict and is not quarantined but escalated. Citation: queue entries removed on conflict — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.
10. **Cooperative work requires a path-ownership map before a `feature/` branch may exist, and per-seat `item/` branches stack on it.** Owner: operator (map), broker (enforcement), seats (work). Acceptance test: `feature/` creation is refused without a map row; two seats' diffs touching the same path on the same feature branch are refused at land time. Citation: "Agent teams don't isolate teammates in worktrees, so partition the work so each teammate owns a different set of files." — https://code.claude.com/docs/en/agents.
11. **Evidence is written into the repo at land time, not attached to a remote object.** Owner: broker. Acceptance test: every disposition row carries item id, ref, commit range, suite name/result/duration, and census counts before/after; `promote` prints exactly those fields. Citation: a posted check is not a gate unless configured as one — https://docs.devin.ai/work-with-devin/devin-review; and Cursor's PR-attached artefacts as the readable-at-merge, unreadable-later counterexample — https://cursor.com/help/ai-features/background-agents.
12. **Prompt/rule regression: a frozen corpus of refusal cases replayed through `src/confine.mjs`, gated in the fast suite.** Owner: verifier. Acceptance test: a change to any seat-facing rule text or to `confine.mjs` reruns the corpus in under 10 s; a rule that no longer produces its refusal fails the build. Citation: quarantine/statistical handling for anything that needs a model — https://buildpulse.io/blog/flaky-evals-non-deterministic-llm-tests; keep the corpus model-free so this test never needs one.
13. **Metrics: refs by prefix, refs by age bucket, unmerged refs on closed items, time-to-land, time-to-retire, promote-to-promote interval.** Owner: verifier. Acceptance test: the census emits all six, and the "unmerged refs on closed items" number appears on the operator's promote output so it is seen before it is fixed. Citation: 0–7 day healthy age distribution and the >30-day count query — https://pullpanda.io/blog/git-branch-visualization-monitoring-tools.
```

```
## Where we diverge from established practice

| Our design | Established practice | Divergence justified? |
|---|---|---|
| A seat lands its own verified branch into `staging` | Agents author PRs; humans (or bots-after-checks) merge — Devin, Copilot, Stripe, Cursor all converge on this | **Yes, conditionally.** It is author-merges-own-work, which is a governance risk when the target is authoritative. It is safe only because `staging` is reset-on-promote and unreachable from `main`. If a future change lets a seat write `main`, this becomes the exact documented risk with no compensating control. Write that sentence into the rule the seat reads. |
| `staging` exists at all | Trunk-based practice argues against a second long-lived integration branch | **Yes, but only in the pointer form.** As a divergent branch it is Git Flow and the divergence is unjustified. As a reset pointer it is a merge queue with batch = the unpromoted set, which is established practice under a different name. |
| Branchless by default | Most agent products are branch-per-task by construction (worktree per conversation, branch per session) | **Yes, and it is the divergence most likely to be right.** Aider already commits into the ambient branch; trunk-based practice commits straight to trunk. We are aligning with the practice and against the products, and the products' behaviour is precisely what produced our 81 refs. |
| Retirement owned by the broker, not the author | Products either auto-delete on merge or never delete (OpenHands) | **Yes.** Product behaviour is bimodal and neither mode handles "unmerged work attached to a closed item", which is our actual mass (46 of 81). The disposition ledger is the mechanism no product has. |
| No feature-flag subsystem | Trunk-based practice relies heavily on flags for multi-day work | **Unjustified as a permanent state.** Our answer to multi-day work is a 7-day `feature/` branch. That is weaker than flags-in-trunk. Keep it only while the seat count is ~10 and the item mix is mostly small; register flag adoption as a roadmap item rather than declaring the divergence correct. |
| Gate lives in code (`landinggate.mjs`), not in a platform setting | Industry gates are platform settings (required checks, CODEOWNERS, branch protection) | **Yes, forced by environment.** We have no platform. But copy the platform's stronger behaviours: freshness (checks must be on the composed tip), removal-with-reason for stale entries, and an explicit non-bypass setting rather than an implicit admin exemption. |
| Taxonomy enforced by tool refusal | Naming conventions are enforced by hooks and review, and deliberately allow free-form local names | **Yes.** A hook is skippable by a seat that does not understand it; a tool-boundary refusal is not. Keep the free-form escape hatch explicitly, as `scratch/`, so the rule stays honest instead of being quietly worked around. |
| Census as a first-class instrument | Most teams pay for a dashboard (LinearB, Pull Panda) or run a sentinel | **Yes.** Ours answers a question the commercial tools do not: *unmerged content attached to a closed item*. That is a queue-store join, not a git query, and it is the reason we can act where git cannot. |
```

```
## Unverified

Every item here is a claim I could not ground at the mechanism level. Each comes with what would falsify it.

1. **Sweep, Orbi, Miko, Baton, Code Conductor, Sourcegraph — branch/worktree behaviour.** Not verified at all. Search results for these were directories and marketing pages (e.g. https://aiagentslist.com/agents/sweep-ai, https://sourcegraph.com/docs/cody) with no statement of branch unit, checkout model, or retirement. **Falsifier:** source code or a doc page showing branch creation and cleanup. Do not treat these systems as evidence in any decision until then.
2. **Devin's retirement behaviour.** Merge semantics and review mechanics are documented (https://docs.devin.ai/work-with-devin/devin-review); what deletes the branch after merge is not. **Falsifier:** a Devin doc statement about branch lifecycle or an API that deletes refs.
3. **Cursor Cloud Agents' retirement.** VM-per-agent and PR-on-completion are documented; ref cleanup is not. **Falsifier:** docs stating branch deletion policy.
4. **Turn bounding for every product (item 12e).** I found no documented step caps or wall-clock budgets for Claude Code, Devin, Cursor, Copilot, or Codex. Only Claude Code's lifetime/sweep mechanics were observable. **Falsifier:** a doc naming a max-turn or timeout setting. Treat "long agent turns are bounded" as false until shown.
5. **Model mocking and opt-in real-model budgets in vendor test suites (12c).** Nothing observed for any product. **Falsifier:** a vendor engineering post describing their test harness. Do not assume any product has this.
6. **Prompt regression testing inside vendor products (12d).** Nothing observed, for any product. The practitioner pattern (evals in CI with flake quarantine) is advertised, not observed in a product's own pipeline. **Falsifier:** a vendor post describing prompt-change CI.
7. **The DORA 24-hour line.** Sourced only to a vendor learning page (https://mergify.com/learn/trunk-based-development/short-lived-branches) restating DORA research; I did not read the DORA report. **Falsifier:** the DORA report itself, or a different measured threshold. Use 24 h as a policy default, not as a measured constant.
8. **"Branch-per-task causes sprawl" as a general law.** The strongest evidence is *our own* measurement plus one product bug (OpenHands #18142) plus a secondary blog observation ("One per task, machine-named, dead at merge" — https://journal.daniellopes.dev/p/trunk-based-development-vs-feature-branches-ai). I found no study that measured ref growth as a function of branch-unit choice. **Falsifier:** any repository-scale study reporting ref counts and ages against branching model. Until then, say "our measurement shows it" rather than "studies show it".
9. **The 53% Chrome flag-longevity figure.** Arrived via a secondary blog, not the Chrome paper. **Falsifier:** the primary Chrome release-toggle study.
10. **GitHub's delete-branch-on-merge and "automatically delete head branches" settings.** Real features; I did not fetch the doc, so no quote and no date. **Falsifier:** the settings doc page. Do not cite it as observed.
11. **Google merge-queue internals beyond the CB/TAP split.** One engineering write-up (https://xgwang.me/google-ci/) was read; statements about TAP's queueing, batching, or conflict handling beyond fast/slow split are not grounded. **Falsifier:** a primary Google paper (e.g. the TAP or CB paper).
12. **Whether any product enforces a branch-name taxonomy mechanically.** I found hook-based convention (pre-push, pre-commit, commitlint) and vendor auto-naming, but no product that *rejects* an out-of-taxonomy branch at the tool boundary other than Claude Code's worktree-location checks, which validate location, not purpose. **Falsifier:** a product doc showing purpose-prefix enforcement.
13. **The claim that `git merge-tree main <ref>` differing from `main` proves unlanded work.** This is our own reasoning and our own measurement, not external prior art. It is a heuristic: a ref can differ yet contain nothing worth keeping (whitespace, a reverted change). **Falsifier:** a sample of the 46 refs whose diffs are substantively empty. If that sample is large, the quarantine process should include a cheap emptiness screen before it consumes operator attention.
```