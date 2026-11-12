I read the attached report. Since it flags GitHub merge-queue internals as its most load-bearing gap (recommendation 3 depends on them, and every fetch 404'd from your host), I pulled the vendor page here and can close that section.

## GitHub merge queue: what it actually does

The docs are now reachable and describe the mechanism precisely [^1]:

> "A merge queue creates temporary branches with a special prefix to validate pull request changes. When a pull request is added to the merge queue, the changes in the pull request are grouped into a `merge_group` with the latest version of the `base_branch` as well as changes from pull requests ahead of it in the queue." [^1]

> "With third-party CI providers, you will need to update your CI configuration to run when a branch that begins with the special prefix `gh-readonly-queue/{base_branch}` is pushed to. These are the temporary branches that are created on your behalf by a merge queue and contain a different `sha` from the pull request." [^1]

Four properties worth copying, and one worth refusing:

| property | GitHub's behaviour | mapping to your rig |
|---|---|---|
| evidence identity | the validated sha is the synthetic `merge_group` sha, explicitly **not** the PR head sha [^1] | the verify row must name the tip it was rebased onto, not the candidate's own head — this is exactly row #6928 |
| serialisation | "first-in-first-out order where the required checks are always satisfied" [^6dae32#114] | your staging queue's ordering |
| stale candidate | not rejected — the group is rebuilt and **re-validated**: "The merge queue recreates the temporary branch with the prefix of `main/pr-2` to only contain changes from the target branch and pull request #2." [^1] | revise recommendation 3: refuse *stale evidence*, then re-gate; refuse the *candidate* only on conflict |
| removal triggers | failing checks, timeout, manual, "Branch protection failure that could not automatically be resolved" [^1] | the gate needs a deadline; a hung verify is currently indistinguishable from a pending one |
| batching | merge groups can span many PRs, with "Only merge unchecked..." → a group may include a PR that already failed checks if the last PR in the group passed (a deliberate escape hatch for flaky tests) | do **not** import this; it is precisely the "unverified work rides along" failure your per-push gate exists to prevent |

Two extra behaviors worth knowing because they match your architecture: queue-jumping forces a full rebuild of every in-flight group (`"bounding ... the queue creates a dependency chain that requires all entries to be re-run"`) — i.e. priority is paid for with recomputation, and any "urgent item jumps the queue" feature would need the same; and build concurrency is an explicit throttle between 1 and 100, which is the queue's analog of your seat limit [^1].

The GA claim your report carries second-hand is confirmed: the changelog is dated July 12, 2023 [^2]. Note the current doc scopes availability to "any public repository owned by an organization, or ... private repositories owned by organizations using GitHub Enterprise Cloud" [^6dae32#21] — so if `durian-pi` is ever private and non-Enterprise, this is not a mechanism you could adopt wholesale even if you wanted to.

## Effect on the report

- **Recommendation 3's acceptance criterion is slightly wrong.** It says "the verb exiting nonzero" when the verify row names a pre-landing tip. Prior art refuses to *trust* the evidence, not the work: it rebuilds and re-validates. Nonzero exit is right only for the conflict case; otherwise it's "stale evidence → re-gate → land", which is also what makes the queue usable at 91 refs.
- **The gate needs a status-check timeout.** A merge queue without one deadlocks; your `src/landinggate.mjs:57` presumably waits forever.
- **One item can come off `## Unverified`:** GitHub merge queue internals. Trunk.io, Mergify, Copilot coding agent, Devin, and question 12(b)–(e) remain open.

If you want, I can take the next gap — the agent-product branch behaviour list (Copilot coding agent, Devin, Sweep) — or review the taxonomy decisions themselves against the fetched sources rather than extending the fetch list.

**References**

[^1]: [Managing a merge queue - GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) (89%)
[^2]: [Pull request merge queue is now generally available! - GitHub Changelog](https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/) (11%)