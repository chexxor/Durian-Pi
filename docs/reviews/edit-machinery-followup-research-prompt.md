# Research prompt — does the *content of a tool error* change agent edit success, as distinct from the edit format?

**Route:** operator's research agent, per `docs/runbooks/research-request.md`.
**Asked by:** delegate, 2026-10-28, after `docs/reviews/edit-machinery-2026-10-28.md`.
**Why this is a research question and not ours to answer:** we have one store, one model family, and 215 recorded
edit errors. Answering "what should a failed edit say back to the model?" from n=1 rig is a guess; the published
literature and other projects' ablations can price it before we spend a seat-milestone on it.

## The question, in one line

For LLM coding agents, is there evidence that **what a failed edit tool call reports** (candidate/near-miss
previews, which sub-edits already applied, named refusal classes such as stale-version / unseen-lines /
no-op, and bounded retry-with-feedback) changes task success or rework rates — separately from the choice of
**edit format** (whole-file vs search/replace vs diff)?

## What to report

1. **Ablations, not features.** Any published or reproducible study/benchmark that holds the model and task
   fixed and varies *only* the failure-feedback content or the retry protocol. Name effect sizes and the task
   set. If nobody has ablated this, **say so plainly** — "no evidence found" is a usable answer, and it changes
   our plan to an internal A/B.
2. **Where edit-format comparisons actually move the metric.** aider's own corpus (`aider/website/_data/*.yml`)
   shows diff-style formats raising malformed-response counts (16–20 vs 1.7 per run) while raising task pass
   rate (54 vs 38). Find any other corpus that separates *well-formed output rate* from *apply failures* from
   *task pass*, and say which of the three each paper actually measures.
3. **Context pressure vs tool protocol.** aider's `quant.yml` has one run at a 2k context window collapsing to
   46.2% well-formed (165 malformed) where quantization variants stayed 88.7–95.5%. Look for stronger, larger-N
   evidence that context headroom (or context rot / position-dependent degradation) dominates tool-protocol
   effects for structured outputs. If context dominates, our roadmap order changes: ROADMAP 208 before 215/216.
4. **Line-addressed or snapshot-tagged editing.** Any published measurement of line-number-addressed edits,
   content-hash/stale-version guards, or read-before-edit enforcement on agent success — including negative
   results and token-cost measurements. oh-my-pi ships these (`crates/pi-edit`) with no published numbers.
5. **Small/local models specifically.** Everything above, restricted to ≤30B or quantized models, since all 12 of
   our seats are `local/iq3_s` and our candidate verifier advertises 13,273 tokens.

## Constraints on the answer

- Cite the artifact, not the blog post: paper, repo, or dataset, with a link and a date.
- Distinguish **measured** from **advertised**; a feature list is not evidence.
- Name what was *not* measured — several agent "edit success" numbers are task pass rates on HumanFix-style
  sets with a different confound per format.
- If a result is behind a benchmark that needs paid APIs to reproduce, say that; we run one local provider.

## What we will do with it

- If the failure-feedback effect is **evidenced** elsewhere: ROADMAP **215** (informed edit refusals) is
  promoted ahead of the context work, with their effect size as our expected value.
- If the evidence is **context-pressure dominated**: 208 first, and 215/216 wait for our own A/B.
- If there is **no evidence at all**: we run the internal A/B described in
  `docs/reviews/edit-machinery-2026-10-28.md` §"Verdict" item 4, and no new editing machinery is scheduled until
  it reports.

**Consumption:** the report lands in `docs/reviews/`, is summarised into `docs/COMPETITORS.md` / the relevant
ROADMAP items, and the ROADMAP items above are re-gated by the operator.
