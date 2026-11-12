# Branch lifecycle for LLM-agent teams — research report

**Provenance.** This is the report the prompt in
[`branch-lifecycle-research-prompt.md`](branch-lifecycle-research-prompt.md) commissioned. It was **run by the
delegate on this host, not by the operator's off-host research agent**: the delegate has a network path, the
runbook's evidence discipline already assumes the delegate re-fetches every cited URL
(`docs/runbooks/research-request.md`, step 5), and the taxonomy decision was blocking the MVP. The
operator-routed prompt is **still open**; if the off-host agent's report lands, it supersedes this one where
they disagree, and this file becomes round 1.

Host for every measurement in this session, taken in the same command as the fetch: **Linux**, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0`.

**Evidence copies.** Every page quoted below was re-fetched into `inputs/fetched/` and its sha256, HTTP status
and `last-modified` recorded in
[`inputs/fetched/MANIFEST-branch-lifecycle.md`](../reviews/../inputs/fetched/MANIFEST-branch-lifecycle.md).
Each quote was checked to be present in *our* copy before this file was written (`python3` substring test over
the fetched HTML, run 2026-11-12T01:2xZ; all 18 load-bearing quotes matched). Quote classes are as the prompt
asked: `advertised-elsewhere` = a vendor or author claims it; `observed` = behaviour we read in a tool's own
documentation or source.

Sources actually fetched (fetch date 2026-11-12T01:22Z for the manifest copies):
trunkbaseddevelopment.com (index, *Committing straight to the trunk*, *Short-Lived Feature Branches*,
*Deciding factors*), Atlassian *Gitflow Workflow*, `git-scm.com/docs/git-worktree`,
`code.claude.com/docs/en/worktrees`, the OpenHands README, aider.chat/docs/git.html.
Not reachable from this host: docs.github.com (HTTP 404 to our fetcher for every merge-queue path tried),
trunk.io feature pages (404), mergify docs (404) — see `## Unverified`.

---

## Branch taxonomy: what a branch is for

The literature converges on **one unit: one small change, short-lived, one owner**.

> "One key rule is the length of life of the branch before it gets merged and deleted. Simply put, the branch
> should only last a couple of days."
> — trunkbaseddevelopment.com, *Short-Lived Feature Branches* · `advertised-elsewhere` (practice literature) ·
> https://trunkbaseddevelopment.com/short-lived-feature-branches/ · fetched 2026-11-12

> "Trunk-Based Development needs you to have small stories/tasks. Optimal is you starting work on a change,
> should only be a matter of hours before completing and pushing it forward for code review."
> — trunkbaseddevelopment.com, *Deciding factors* · `advertised-elsewhere` ·
> https://trunkbaseddevelopment.com/deciding-factors/ · fetched 2026-11-12

The counter-model — named branches by purpose that persist — is Git Flow, and its own documentation states its
cost:

> "Compared to trunk-based development, Gitflow has numerous, longer-lived branches and larger commits. …
> These long-lived feature branches require more collaboration to merge and have a higher risk of deviating
> from the trunk branch."
> — Atlassian, *Gitflow Workflow* · `advertised-elsewhere` ·
> https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow · fetched 2026-11-12

**Reading for us.** A branch is not a namespace for an item; it is a **temporary isolation for one change**.
Our `item-<id>` refs are named by *work-item identity*, not by change, and the measured consequence is exactly
the sprawl the literature predicts: **91 refs / 81 worktrees** on this rig at 2026-11-12T01:0xZ (84/75 an hour
earlier, 77 before the prune pass), and **51 OPEN rows** in `docs/DISPOSITIONS.md` — refs whose items are
already terminal. A taxonomy keyed to identity produces refs that outlive the change; a taxonomy keyed to the
change makes retirement mechanical.

Naming *is* machine-checkable in the systems that care: Claude Code never lets a human name the branch — it
derives it (`worktree-<name>`) — see the retirement section. Prior art for a human-facing purpose taxonomy
(`feature/`, `fix/`, `docs/`) with enforcement was **not found** in the fetched sources; it is in
`## Unverified`.

---

## Branchless work: when no branch is the right choice

**Yes, branchless-by-default is defensible, and the literature states the condition explicitly: the gate moves
from the branch to the push.**

> "Risk mitigation is everyone running the full build (the same build the CI demon would do) before the
> commit/push, and only pushing to trunk if that passes. This is an essential integration activity."
> — trunkbaseddevelopment.com, *Committing straight to the trunk* · `advertised-elsewhere` ·
> https://trunkbaseddevelopment.com/committing-straight-to-the-trunk/ · fetched 2026-11-12

And the agent-specific version of the same advice:

> "Keep each agent's change small, review and integrate them one at a time (re-syncing the others with
> main/trunk as each lands), and throw away the worktrees that did not work out rather than letting them linger."
> — trunkbaseddevelopment.com, *Short-Lived Feature Branches* · `advertised-elsewhere` · fetched 2026-11-12

Observed in shipping agent tools: **Aider does not branch per change at all** — it commits each edit on the
current branch and uses history as the undo mechanism:

> "Whenever aider edits a file, it commits those changes with a descriptive commit message. This makes it easy
> to undo or review aider's changes."
> — aider.chat/docs/git.html · `observed` (the tool's own docs describe its default behaviour) ·
> https://aider.chat/docs/git.html · fetched 2026-11-12

**Conditions under which direct-to-trunk is safe, from the sources:** small change size (hours, not days); a
build/test run *before* the push; a queue that serialises pushes when there are many concurrent writers;
fast revert. **Conditions under which it fails** are the ones we already measure: concurrent writers to the
same tree (`add/add` conflicts, `BRANCH-AND-WORKTREE-LIFECYCLE.md` §7.2), and work that cannot be verified
before it lands (which is why the gate in `src/landinggate.mjs:57` exists at all).

So §3 of `WORK-ITEM-MODEL.md` (branchless by default, worktree on demonstrated need) is **supported by prior
art**, with one addition the literature insists on and we do not yet have: the branchless path must still run
the gate **before** the push to staging — a branchless item is not an ungated item.

---

## Staging and promotion: merge queue vs staging branch vs protected trunk

The closest established pattern is **a merge queue**, not a staging branch.

> "Agentic teams need more: a commit queue, a fast local build with Test Impact Analysis, and agents that talk
> to each other before touching shared code."
> — trunkbaseddevelopment.com, *Committing straight to the trunk* · `advertised-elsewhere` · fetched 2026-11-12

> "Super scaled is merge/patch queues of course"
> — trunkbaseddevelopment.com index (the ladder of trunk-based styles by scale) · `advertised-elsewhere` ·
> https://trunkbaseddevelopment.com/ · fetched 2026-11-12

> "If you are using GitHub as your repository host, GitHub Merge Queue can help solve the 'race to push'
> problem. This will automate pull request merges into a busy branch to increase velocity. GitHub made this
> generally available in July 2023."
> — trunkbaseddevelopment.com, *Deciding factors* · `advertised-elsewhere` (second-hand report of a vendor
> release; the vendor page itself was unreachable from this host — see Unverified) · fetched 2026-11-12

What a merge queue actually does, and what we can copy without a third-party service: it **validates each
candidate against the current tip at merge time, in a batch, and lands it only if that validation passes** —
then the tip moves. Our `scripts/land.mjs` already has the right half of this shape (merge in a scratch tree,
advance only by a clean fast-forward); what is missing is the *queue* semantics: serialisation, per-candidate
re-validation against the tip the previous landing produced, and a stale candidate that is re-validated rather
than trusted.

A long-lived `staging` branch is **Git Flow's `develop` branch**, whose documented cost is quoted above. We
should keep `staging` as the *place verified work waits* (it is the operator's single deliberate act, and
"one verb with printed evidence" is a governance requirement no merge queue gives us), but implement it as a
queue: land one at a time, re-run the gate on the re-based candidate, refuse if the tip the verify row named
has moved. That is the mechanism; the branch is just its storage.

---

## Who lands, and what the gate must enforce

Prior art in the fetched set is thin on *author vs reviewer* merging — GitHub's own governance material was
unreachable. What the sources do support is that **the gate must be structural, not procedural**:

> "a commit queue, a fast local build … and agents that talk to each other before touching shared code"
> (same quote as above) — the queue is where the enforcement lives; prose rules do not survive a fleet.

Our own code already enforces the two halves that matter: seats cannot mutate git state
(`src/confine.mjs:206-217`) and the landing gate is required, not optional (`src/landinggate.mjs:57`). The
research adds one requirement we do not yet meet: **the gate's verdict must be about the candidate against the
current tip at the moment of landing**, because every merge-queue design's value comes from validating at
merge time rather than at submission time. A verify row naming a tip that has since moved is not evidence
about the thing being landed — that is exactly the tip-drift defect row **#6928** is about, so prior art
backs that row rather than merely restating it.

---

## Retirement and sprawl control

The strongest observed prior art is **Claude Code's worktree lifecycle** — a shipping LLM-agent product that
creates a worktree per parallel session, and has solved the residue problem with three primitives we do not
have.

> "By default, the worktree is created under `.claude/worktrees/<name>/` at your repository root, on a new
> branch named `worktree-<name>`" — `observed` (product default, stated in its own docs) ·
> https://code.claude.com/docs/en/worktrees · fetched 2026-11-12

> "Claude Code runs a periodic sweep that removes worktrees that Claude created for subagents and background
> sessions once they are older than your `cleanupPeriodDays` setting" — `observed` · same URL

> "The sweep leaves a worktree in place in these cases: The worktree still holds work: changed or untracked
> files, or unpushed commits." — `observed` · same URL

> "Claude Code writes a marker into the git metadata of every worktree it creates with git, and the sweep keeps
> any worktree without one, including a worktree a `WorktreeCreate` hook created." — `observed` · same URL

> "While an agent is running, Claude Code holds a git worktree lock on its worktree so that concurrent cleanup
> can't remove it, and releases the lock when the agent finishes." — `observed` · same URL

> "Non-interactive runs with `-p` have no exit prompt, so Claude doesn't clean up their worktrees" — `observed`
> · same URL — i.e. **even a mature product leaves residue when the run shape has no cleanup point**. That is
> our situation: an item closes with no verb that retires its artefacts.

The mechanism worth copying, in order of value:
1. **Ownership marker.** The sweeper only ever touches artefacts it minted. We can get this natively: git's
   own worktree surface carries `git worktree lock --reason <string> <worktree>`
   (`git-scm.com/docs/git-worktree`, `observed`), and `git worktree list --porcelain` reports it
   (`tools/branch-census.mjs` already reads `--porcelain`). A `reason` of `rig:item-<id>` *is* an ownership
   marker, and it is the difference between "60 reapable worktrees" and "30 mine, 30 not mine".
2. **Lock while live, sweep when idle.** Never reap a tree whose item is live; that is what the lock is for.
3. **Keep what still holds work.** A sweep that deletes a dirty tree is a data-loss bug, which is why our own
   rule is "never `--force`". The sweep must classify, not delete: dirty → disposition row, clean → reap.

The same docs expose the seam we should use for customisation: "For SVN, Perforce, Mercurial, or other
systems, configure `WorktreeCreate` and `WorktreeRemove` hooks to provide custom creation and cleanup logic"
(`observed`) — exactly D212's rule: the base ships the lifecycle and a hook seam; the fleet-specific policy
rides the seam.

**Sprawl metrics:** none of the fetched sources names a tool that measures branch sprawl. Our own
`tools/branch-census.mjs` + `cli.mjs worktree audit` are the instrument; the research says only that a
retirement rule without a measured age/count is unauditable. Recorded as unverified, and as ROADMAP 361.

---

## Conflicts and zombie branches

Prior art calls our "zombie branch" a **long-lived feature branch**, and defines it by age rather than by
state:

> "Any longer than two days, and there is a risk of the branch becoming a long-lived feature branch (the
> antithesis of trunk-based development)." — trunkbaseddevelopment.com, *Short-Lived Feature Branches* ·
> `advertised-elsewhere` · fetched 2026-11-12

The prevention is not a merge strategy but a **re-sync cadence**: "re-syncing the others with main/trunk as
each lands" (same source). And the disposition of a branch that cannot be brought up to date is, in the
literature, deletion rather than rescue: "throw away the worktrees that did not work out rather than letting
them linger" (same source). Our `DISPOSITIONS.md` is the institutional memory that git's `git cherry`/
patch-equivalence case (ROADMAP **344**) shows we cannot yet act on mechanically — the row records the
decision; no verb executes it. That gap is ROADMAP 344's fix, and the research says the *rule* should be age
plus state, not a judgement call per ref.

---

## Cooperative work on one feature

**The evidence contradicts our proposed `feature-<slug>` shared branch.**

> "Another key rule is how many developers are allowed congregate on a short-lived feature branch. Another
> simple answer: the developer count should stay at one (or two if pair-programming). These short-lived
> feature branches are not shared within a team for general development activity."
> — trunkbaseddevelopment.com, *Short-Lived Feature Branches* · `advertised-elsewhere` · fetched 2026-11-12

The proven arrangements are therefore: **decompose so the work never overlaps**, or serialise through a queue.
Shared branches appear only for review, not for concurrent writing.

Revised rule (replacing PROVISIONAL §5):
1. A cluster is a **decomposition**, not a shared tree. Members land one at a time, in order, each
   re-validated against the moved tip (the queue semantics above).
2. If two items genuinely cannot land independently, the cluster gets one branch **with a hard bound**: ≤ 2
   member seats, ≤ 2 days life, one named owner, and the branch is retired when every member is terminal and
   the branch is an ancestor of the branch it landed into.
3. Never mint a cluster branch retroactively (our R7 "never rename a branch that holds commits others
   reference" survives unchanged).

---

## What real agent systems do

| system | branch unit | checkout | who merges | retirement | how we know |
|---|---|---|---|---|---|
| **Claude Code** (Anthropic) | per *session* or per *subagent*, opt-in via `--worktree`; name derived `worktree-<name>` | git worktree under `.claude/worktrees/`, branched from the repo default branch (`baseRef` option for head) | the user / a PR flow; the product does not merge | periodic sweep by age (`cleanupPeriodDays`), keeps anything that still holds work; ownership marker gates the sweep; lock while the agent runs | `observed` (product docs) — https://code.claude.com/docs/en/worktrees, fetched 2026-11-12 |
| **Aider** | none per change; commits every edit on the current branch | the user's working tree (optionally "a series of aider's changes on a git branch") | the user | git history is the undo; no branch lifecycle | `observed` (tool docs) — https://aider.chat/docs/git.html, fetched 2026-11-12 |
| **OpenHands** | none managed by the system; shared host workspace | containerised conversation execution on a shared workspace | the user | none | `observed` (README) — "Conversations using the same host workspace still share those files; choose separate directories or worktrees to avoid conflicting edits" — https://raw.githubusercontent.com/all-hands-ai/openhands/main/README.md, fetched 2026-11-12 |
| **Devin** | (not established) | — | — | — | page fetched (docs.devin.ai/get-started) but no branch-behaviour content could be extracted — **unverified** |
| GitHub merge queue, Trunk, Mergify, Copilot coding agent, Sweep, Orbi, Miko, Baton, Code Conductor, Sourcegraph | — | — | — | — | **not reachable from this host**; see `## Unverified` |

The pattern across what we *could* observe: **agent tools do not give each change a branch.** They either
commit straight (Aider), share a workspace and tell the user to isolate (OpenHands), or create an isolated
checkout on demand and sweep it later (Claude Code). None mints a permanent ref per unit of work. Our
per-item ref is the outlier.

---

## Iteration architecture (question 12 — what each system's change loop costs)

Honestly scoped: the fetched sources are *user* documentation, not engineering posts about their own test
infra. What is supportable:

**(a) piece boundaries and loop cost.** Claude Code's boundaries are the session and the subagent; its
isolation primitive (a worktree) is created per session and cleaned by a sweep — i.e. its fast loop is
"work in a fresh checkout, throw it away". OpenHands' boundary is the conversation, with shared files as the
explicit hazard. Aider's boundary is the file edit, with every edit a commit — a loop whose unit of review is
one commit, and whose undo is one command. No fetchable page in this set gives a measured second-per-change
number.

**(b) hermetic vs live.** Not documented in the fetched pages. Unverified.

**(c) model mocking in tests.** Not documented. Unverified — and it is the question our own mocked plane
(`demo/offline.mjs`, 0.244 s, currently red) exists to answer internally.

**(d) prompt-change regression testing.** Not documented in any fetched source. Unverified.

**(e) bounds on a long agent turn.** The trunk-based literature bounds *work* (hours, not days) rather than
turns; Claude Code's docs describe background sessions and cleanup but no turn cap in the fetched pages.
Unverified.

**(f) quarantining slow tests.** Not documented in the fetched sources; the trunk-based requirement that
direct-to-trunk needs "a fast local build with Test Impact Analysis" is the closest statement — the fast path
depends on selecting the tests the change affects. That is exactly `tools/what-to-test.mjs`, and its documented
blind spot (probe-corpus rot) is why the promotion leg runs the full suite.

**Net:** no competitor's iteration loop was documented in a form we could measure. The comparison the prompt
wanted is still open; the follow-up prompt names the pages to fetch.

---

## Recommendations for durian-pi

1. **Keep `item-<id>` refs, but make them temporary, not permanent.** Retirement rule: an item ref is
   retired when the item is terminal **and** the ref is an ancestor of the branch it landed into. Owner:
   `devtools`. Acceptance: `node tools/branch-census.mjs --json` reports zero refs that are both terminal and
   merged; a demo asserts the verb refuses a non-ancestor. Cited: the two-day rule and the "one or two
   developers per short-lived branch" rule (trunkbaseddevelopment).
2. **Branchless by default, gated before push.** Owner: `impl`. Acceptance: a mocked-plane demo where a
   docs-only item completes with **zero net change** in `git worktree list | wc -l` *and* a gate run whose
   exit code is captured. Cited: "only pushing to trunk if that passes" (trunkbaseddevelopment).
3. **Make staging a queue, not just a branch.** Land candidates one at a time; re-run the gate on the
   candidate rebased onto the current staging tip; refuse a candidate whose verified tip has moved. Owner:
   `impl`, gate owned by `architect`. Acceptance: two candidates landing back-to-back in a fixture repo, the
   second one's verify row naming the pre-landing tip, the verb exiting nonzero. Cited: merge-queue prior art.
4. **Adopt the ownership-marker + lock-while-live sweep.** Use `git worktree lock --reason rig:<item>` on
   every rig-created worktree; sweep only marked trees; keep dirty ones and write a disposition row. Owner:
   `devtools`. Acceptance: a demo proving an unmarked (human) worktree is never swept, and a marked clean one
   is. Cited: Claude Code's marker and sweep (`observed`).
5. **Replace shared feature branches with ordered decomposition.** Owner: `pm`/`lead`. Acceptance: `check`
   finding `cluster-over-two-seats` and a `check` finding `branch-age-days>2` on a fixture. Cited: the
   developer-count rule.
6. **Instrument sprawl before claiming the lifecycle works.** Owner: `devtools`. Acceptance:
   `tools/branch-census.mjs` prints ref count, worktree count, the age distribution of refs, and count of
   refs whose item is terminal, with a committed baseline file.
7. **Rejected, with reason:** a human-readable purpose taxonomy (`feature/`, `fix/`, `docs/`, `verify/`,
   `scratch/`) enforced by a naming linter. No fetched source shows such a taxonomy being enforced, and our
   R7 rule already derives names from a function; a naming rule the tooling cannot enforce is a second set of
   rules to violate. Keep derived names, enforce *retirement* instead.

---

## Where we diverge from established practice

| our design | established practice | justified? |
|---|---|---|
| one ref per work item, minted at claim | one short-lived branch per small change, one owner | **No** — this is the divergence that produced 91 refs and 51 open dispositions. The divergence is only defensible while the retirement half is unbuilt. |
| a human promotes `staging` → `main` in one verb | an automated merge queue | **Partly** — the operator-approval requirement is real and not served by a queue. But we must adopt the queue's *mechanism* (validate-at-merge, serialise), not just its shape. |
| branchless items submit structured edit deltas | direct commits to trunk | **Yes**, and the research supports it, provided the gate runs before the delta is applied. |
| seats cannot touch git state | humans/agents both run git | **Yes** — in the merge-queue literature the enforcement is structural (the platform); ours is the rig. |
| cooperative items may share a branch | one worker per branch | **No** — revise to bounded clusters with ordered landing. |

---

## Unverified

- **GitHub merge queue internals** (batch grouping, what happens to a stale queued PR, what the gate checks).
  Every fetch of `docs.github.com/...about-merge-queues` returned HTTP 404 from this host; `github.blog`
  changelog paths returned 404 too. Falsifier/cheapest probe: a reachable mirror or the GitHub REST docs; the
  claim we *do* ground is only "merge queue exists and is GA since July 2023" (trunkbaseddevelopment, second
  hand).
- **Trunk.io / Mergify merge queues** — pages 404'd. Unverified.
- **Devin, Copilot coding agent, Sweep, Orbi, Miko, Baton, Code Conductor, Sourcegraph** — question 9's list
  is not answered. Devin's docs were fetched but contained no extractable branch-behaviour text. Cheapest
  probe for each: its public docs page on worktree/branch handling, quoted ≤40 words with a fetch date.
- **How agent products test their own prompts** (question 12d) — no fetched source addresses it.
- **Whether a patch/queue hybrid reduces merge conflicts more than branches do** — no measured comparison in
  any fetched source; our own `DISPOSITIONS.md` counts are the nearest measurement we have.
- **Branch-sprawl measurement tooling** — none found. If a product ships one, it would falsify the claim that
  we must build our own.
