I read the repo and the two documents that frame this thread: the `research-request` runbook you attached, and `docs/NEXT.md` on `main`. That pins the task precisely — the generator here is not "answer a question", it is **round 2 of the branch-lifecycle commission**, which `NEXT.md` records as the one remaining operator action ("Still an operator action: routing the round-2 prompt `docs/reviews/branch-lifecycle-followup-research-prompt.md` to the research agent" [^1]). I am the off-host agent that prompt is addressed to, so I started with the question your host could not reach.

## First finding, before the content

Your prompt says `docs.github.com` returned HTTP 404 on every path tried on 2026-11-12 [^2]. From here `docs.github.com` returns 200 and serves the full page. So that block was **host-side or path-side, not a permanent absence** — worth recording in the report's `## Still unverified` section rather than as a vendor gap, because it is exactly the failure class your own runbook warns about (an input nobody could open).

## Deliverable slice: `## Merge queue mechanics`

Fetched 2026-11-12. Evidence class for all of it is `advertised-elsewhere` (vendor documentation), not `observed` — nothing here was run.

```markdown
## Merge queue mechanics

Source: GitHub Docs, "Managing a merge queue", https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue — fetched 2026-11-12. Evidence class: advertised-elsewhere.

**1. Batching.** Ordering is FIFO, and a candidate is validated as a STACK, not alone: "the changes in the pull request are grouped into a `merge_group` with the latest version of the `base_branch` as well as changes from pull requests ahead of it in the queue." This is the load-bearing sentence for us — the unit of validation is the prefix of the queue, which is why a group can be merged as one push.

**2. What the gate checks.** Not the PR's own CI. Each candidate gets a synthetic branch whose sha differs from the PR: "temporary branches that are created on your behalf by a merge queue and contain a different `sha` from the pull request." Required checks must be re-reported on a `merge_group` event; a workflow that only triggers on `pull_request` leaves the queue waiting until its status-check timeout, and "the merge will fail as the required status check will not be reported."

**3. A candidate whose base moves is REBUILT, not dropped.** When a candidate ahead of it fails, "The merge queue recreates the temporary branch ... to only contain changes from the target branch and pull request #2." The same rebuild happens on a queue jump, and the doc is explicit about the cost: "jumping to the top of a merge queue will cause a full rebuild of all in-progress pull requests, as the reordering of the queue introduces a break in the commit graph."

**4. What actually removes a candidate** — four causes, and only one of them is a test failure: failing required checks in a merge group; "Timed out awaiting a successful CI result based off the configured timeout setting"; operator removal; "Branch protection failure that could not automatically be resolved." A base move is not among them.

**5. Enforced by branch protection, not convention.** "Repository administrators can require a merge queue by enabling the branch protection setting 'Require merge queue'." The knobs are build concurrency (1–100 `merge_group` webhooks), status-check timeout, merge method, and min/max merge limits (1–100) with a wait time — with the caveat that "Merge limits do not combine `merge_group` **builds**."

**Consequence for our design (WORK-ITEM-MODEL §5/§6.1).** Round 1's "a merge queue is the pattern at fleet scale" survives, but the mechanism it implies is sharper than we wrote: the queue validates *prefixes*, so a landing pass is a stack of candidates, and the retirement rule for a stale candidate is re-gating, never dropping. That is the same conclusion your own landing pass reached empirically — "pairwise-clean is NOT a proof a 12-way merge composes — a pass must drop the member that conflicts and re-gate" [^1] — now with a vendor mechanism behind it rather than an inference.
```

## What I have not done, and what I need from you

Q2–Q6 are untouched: merge-queue products (Trunk/Mergify/Aviator), the eight agent products you could not reach, the iteration-architecture half, sprawl measurement, and the isolation predicate. Two of those (Q3, Q4) are the expensive ones and Q4 is the one your runbook marks mandatory for any pass over competing products — "Learning what a competitor *does* without learning how fast they can *change* it leaves out the half of the comparison that decides our own architecture" (your attached runbook, `Do` 1). I can work them, but each product is a multi-fetch job and I would rather spend that budget in the order you want.

Three things worth deciding before I continue:

1. **Scope order.** Q2 and Q5 are cheap and close (a dozen fetches). Q3+Q4 are the heavy ones. Do you want the cheap pair first as a landing round, or the whole Q1–Q6 in one report?
2. **Q6 may be answerable as a negative.** Round 1 already found "no source states a predicate", and nothing I saw implies an industry rule exists for when a change needs isolation. If you want, I will treat Q6 as a documented *absence* — which is more useful to `WORK-ITEM-MODEL.md` §3 than a stretch for prior art, since it lets that section be recorded as your invention.
3. **Delivery shape.** Per your runbook the agent has no write access, so what reaches you is chat text: one fenced block per section, no narration inside, quotes ≤ 40 words with URL and fetch date. That is what the block above is. Confirm that is still the shape you want committed to `docs/reviews/branch-lifecycle-llm-agent-teams-round2.md`, and I will keep every subsequent section in it — including `## Changes to our design`, where each numbered item names the `WORK-ITEM-MODEL.md` section and the round-1 claim it corrects, and `## Still unverified`, which already has its first entry (the docs.github.com 404).

**References**

[^1]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Durian-Pi/main/docs/NEXT.md) (63%)
[^2]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Durian-Pi/main/docs/reviews/branch-lifecycle-followup-research-prompt.md) (37%)