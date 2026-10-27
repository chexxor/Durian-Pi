# Research prompt — memory, follow-up (unresolved after `docs/research/Adding_Memory_to_Pi_Agent_Harness.md`)

Written per `docs/runbooks/research-request.md` step 4. **Hand to the operator to route to the research
agent** — the delegate cannot call it. Report path requested below; register what comes back into
`docs/ROADMAP.md` (items 161–169 are already open) before acting on it.

## Context

durian-pi is a harness for a **team** of coding agents: ~12 named seats (an orchestrator-worker topology —
`pm` decomposes and routes, workers claim from a per-seat queue) driven by `pi-durable` conversations over one
SQLite store, one single-writer broker, no interactive surface. Each seat is a **long-lived conversation that
accumulates context across the whole project**; the raw transcript is durable, immutable rows. Delivery to
seats is **push** (a wake/primer text plus attention notices); a polling tool is deliberately kept out of the
rig. Seats run on cheap-to-mid models (DeepSeek/GLM/gemma class), authors and verifiers are deliberately
different model families, and the rig's inference cost is dominated by **cached prompt prefix reads**.

The first research round (`docs/research/Adding_Memory_to_Pi_Agent_Harness.md`, consumed in
`docs/reviews/memory-implementation-plan.md`) settled the *architecture* questions: raw log canonical,
retrieval over write-pipelines, typed facts with two time axes if facts change, harness-delivered recall,
origin-bound writes, tombstones. It left the questions below unanswerable from our tree.

## Questions

1. **Multi-agent memory, not single-agent memory.** What is published on memory **shared between agents in
   one team**: per-agent vs shared store tradeoffs, conflict resolution when two seats record contradictory
   facts about the same artifact, and **cross-agent contamination** (one seat's poisoned or stale write read by
   a different seat with a different role). Is there any evaluation of **role-scoped** or **provenance-filtered**
   retrieval ("retrieve only facts this seat may believe")? We have one constitution and one store shared by all
   seats; we need to know whether that is a known failure mode with known mitigations.
2. **Does the bi-temporal / supersession result transfer to software-engineering agents?** The strong numbers
   we are leaning on (superseded value served 15–40% of the time; deterministic supersession → ~0%) come from
   conversational/persona benchmarks. Find evaluations on **code or task-state** corpora — API versions, deploy
   targets, "which branch is authoritative", ownership of a file — or state plainly that the transfer is
   untested, so we size item 165 honestly.
3. **Delivery timing and prompt-cache interaction — measured.** Is there any measured comparison of
   (a) per-request dynamic injection, (b) boundary-triggered injection (session start / claim / compaction),
   and (c) static-instruction-only, reporting **both** task accuracy **and** provider-side cache hit rate /
   cost? We need to know whether "inject at boundaries to keep the cached prefix stable" costs accuracy or buys
   money, or both are folklore.
4. **Origin-bound write gates that are actually implemented.** Beyond CaMeL (self-described research artifact):
   name **maintained, permissively licensed** code that binds provenance/authority at write time and enforces a
   quarantine tier for retrieved-content-derived writes. We want a schema and an enforcement point, not a paper.
5. **Verifiable forgetting across derived stores.** Every copy of a fact (FTS/vector index, summaries, caches,
   item bodies, backups) must go. What exists that is *demonstrably* complete — tombstone-before-insert,
   tombstone propagation, cryptographic erasure with a checkable receipt — and what evaluation exists beyond the
   single "best system 1.5%" figure? Verify the open-source status and licence of anything cited (e.g. Lethe).
6. **Procedural memory sizing.** The 5→100 skill-library collapse (actual-use precision 29.6%→3.3%) is the
   evidence behind a size budget on our skill loader. What is the largest skill/task library with a *reported*
   measured benefit, what selection method was used (embedding? lexical? classifier? human-curated?), and at what
   library size does selection stop working in **code** tasks?
7. **Defensible internal A/B methodology for agent memory.** Published guidance on designing a small
   replay evaluation on your own past tasks: how many tasks, how to construct controls (no-memory /
   full-history / memory), how to avoid a lenient LLM judge (the 62.8% figure), how to include stale-fact and
   poisoning traps, and how to report so a later reader can tell evidence class from guesswork. A worked example
   from a coding-agent shop would be ideal.
8. **Cheaper-first context levers.** For a long-lived agent conversation: evidence ordering **masking stale tool
   output** (lossless, pointer-preserving) against **summarizing compaction**, in *coding* agents. If masking is
   cheaper and safer, our sequencing (context items 92–97 and compaction items before any memory write path) is
   right; if not, say so.

## Deliverable

Report at **`docs/reviews/memory-followup-review.md`**, sections: (0) one-paragraph verdict; (1–8) one section
per question above; (9) "what this changes in `docs/ROADMAP.md` items 161–169" naming each item it affects or
kills; (10) open questions that remain.

## Evidence discipline

Every external claim carries a **URL** and an **evidence class** in our vocabulary: `direct` (measured by the
report authors) / `advertised-elsewhere` (a vendor or paper's own claim) / `community` (practitioner report) /
`observed` (a fact read from a repo, doc, or LICENSE we can point at). State benchmark caveats inline (answer-key
errors, judge leniency, ceiling effects) rather than quoting a headline score. **A finding that has no
implementation and no measurement is to be listed as `unverified`, not folded into advice.** For every project
cited as reusable, verify and name its **licence** and the exact file path examined, at a pinned commit.

## Constraints

Written report only — do not modify code or docs other than the report itself. Do not recommend a pi
**coding-agent** extension as a seat-side mechanism: seats are `pi-durable` conversations and coding-agent
extensions cannot load in this process (`src/extensions.mjs:19-21`). Prefer open-source implementations with a
permissive licence; where the only source is AGPL or proprietary, say so explicitly and mark it
architecture-reading-only.
