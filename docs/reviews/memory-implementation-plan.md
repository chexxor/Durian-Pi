# Memory for seats and the rig — implementation plan (PROPOSAL)

**Author:** delegate (external to the team), 2026-10-27.
**Source research:** `docs/research/Adding_Memory_to_Pi_Agent_Harness.md` (operator's research agent, landed
2026-10-27; four rounds: package selection → effectiveness literature → open-source reference
implementations → pitfalls/anti-patterns). Raw report stays in `docs/research/`; this file is the
consumption document.
**Status:** **proposal, not a ruling.** Items **161–169** are registered in `docs/ROADMAP.md` as
*registered, not scheduled* — `pm` sequences them, and three operator rulings (§8) gate the sequencing.
**Not started:** no code, no queue items created by this delegate.

---

## 1. What the report actually establishes (and what it is worth here)

The report's load-bearing conclusion is not "add a memory component". It is that **the memory component is
the least valuable part of memory, and retrieval, delivery, and integrity are where the returns are**:

| Finding (as reported) | Class | Why it changes our design |
|---|---|---|
| Retrieval choice moves accuracy ~20 pp; write strategy 3–8 pp | `advertised-elsewhere` | Spend the first phase on a read path over what we already store, not on a write pipeline. |
| Agents do not initiate recall: **zero memory calls across 114 turns** when the store held exactly what was needed; deterministic cue-triggered injection fired every time | `advertised-elsewhere` | Recall must be **pushed by the harness**. durian-pi already rules this way — roadmap item 4 keeps a polling tool out of the rig, and D28 is the push channel (attention/wake). The research and our own architecture agree. |
| Similarity retrieval served the **superseded** value 15–40% of the time; a deterministic supersession rule over two time axes brought that to ~0% | `advertised-elsewhere` | If we ever store facts that change, the data model (valid/invalid × recorded/expired + `supersedes`) is the fix, not a better retriever. |
| Prose summaries as the canonical store did not survive a model upgrade (+9.91/−13.28 pp; 0/48 in-store repairs) while raw history recovered 34/48 | `advertised-elsewhere` | The raw log stays canonical. **This is already true here** — a seat's conversation is durable rows (`pi-durable` entries), immutable, and `log`/`watch` read them. |
| Origin binding **at write time**: 0% attack success; prompt-level defences ≤3.2 pp; isolation-from-execution alone 2.19% | `advertised-elsewhere` | The only security control worth building first is a write gate that binds provenance, not an instruction to the model. |
| End-to-end "forget" compliance: best of six systems **1.5%** | `advertised-elsewhere` | Scope deletion as tombstone + verified sweep + report, never as a silent DELETE. |
| Skill-library precision fell 29.6% → 3.3% as the library grew 5 → 100 | `advertised-elsewhere` | Our `skills/` + skill loader (item 35) is procedural memory and needs a size budget, not an append-only directory. |
| LoCoMo/LongMemEval numbers are unsound (6.4% corrupt answer key; judge accepted 62.8% of deliberately wrong answers) | `advertised-elsewhere` | Do **not** tune to a public benchmark. Our only valid benchmark is an A/B on our own completed items — hence item 161 before anything else. |

**Evidence caveat carried from the report itself:** most of the strongest evidence is 2026 preprint work, and
the 3,283-paper synthesis was LLM-assembled from abstracts. Treat the direction as reliable and the
magnitudes as not portable. That is exactly why 161 is a measurement item, not a feature item.

## 2. Where the report does **not** apply to this rig (correction to its top recommendation)

The report's implementation half is written for a **pi coding-agent extension** in an interactive session
(`pi install npm:pi-memory`, `PI_MEMORY_DIR`, `ctx.sessionManager.getBranch()`, `session_before_compact`,
`agent_settled`, `ctx.mode === "tui"`). **None of that is durian-pi's runtime.** Verified against this tree:

- durian-pi has **no interactive surface** (D21) and loads **pi-durable** extensions only —
  `src/extensions.mjs:19-21` states this explicitly: *"A pi *coding-agent* extension is a different thing
  … and cannot load here."* Installing `pi-memory`/`pi-mem`/Basic Memory's `bm install pi` would affect an
  operator's own `pi` session, **never a seat**.
- There is **no auto-discovery**: extensions are an explicit list via `DURIG_EXTENSIONS`
  (`src/extensions.mjs`), with a stated trust boundary. So "which memory package" is not a package-manager
  decision here; it is a design decision about a durig extension we own.
- The pi-durable hook surface the report never sees is what we would use:
  `GenerationHooks.beforeRequest / afterResponse / onYield / afterTools`,
  `ToolHooks.beforeTool / afterTool`, `CompactionHooks.beforeCompact`
  (`vendor/pi-main/packages/durable/src/harness/types.ts:844-895`), plus `section` / `wrapSection` /
  `defineDoc(Family)` / `api.commit`.
- The report's Pi-lifecycle pitfalls (`agent_end` ≠ settled, `/fork` double-write, abandoned branches,
  cancelling compaction) **do** transfer as *shapes*, and they map onto durable equivalents:
  a compaction hook returning `{decline:true}` is durable's version of "never cancel compaction"; a
  conversation fork/replay is durable's version of the double-write; `beforeCompact` is durable's version
  of the pre-compaction capture window.

**Consequence:** adopt the report's *mechanisms*, ignore its install guidance, and read its Pi-coding-agent
pitfalls as durable-lifecycle warnings.

## 3. What durian-pi already has (the plan is mostly a read layer, not a new subsystem)

The roadmap said this in 2026-10-12 already — `docs/ROADMAP.md:1939`: *"…over a plain filesystem, not a
memory engine, because durian-pi is already SQLite + files and the gap is a read/index layer over what we
have."* Verified inventory:

| Memory layer the research wants | durian-pi today | Where |
|---|---|---|
| Raw event log as source of truth | **have it** — every seat turn is a durable entry; `log`/`watch` read them; `storage.scanEntries` is the direct read path | `pi-durable` storage; roadmap 27 |
| Human-authored invariants in a prompt section | **have it** — the constitution reaches every seat as a prompt section rendered from a session-scoped doc | `src/rig.mjs:37-38, 615-628` |
| Harness-delivered (not agent-initiated) context | **have it as a rule** — no polling tool (item 4); wake text + attention notices are the push channel | `src/attention.mjs`, `src/metrics.mjs`, D28 |
| Procedural memory (skills) | **partial** — skills are inlined at `up` for the whole run; item 35 proposes the budgeted loader | roadmap 35, `skills/`, `.agents/skills/` |
| Boot orientation / handoff (the O1–O4 onboarding work) | **half-built** — the delegate has `AGENTS.md`/`NEXT.md`; seats have nothing pushed at them | roadmap O1–O4 |
| Typed facts with validity intervals | **absent** | — |
| Retrieval over history (BM25/FTS) | **absent as a seat-facing path** — durable ships an in-process BM25 ranker used only for *tool search* | `pi-durable/src/search.ts:rankDocuments` |
| Provenance-gated writes | **pattern exists, not for memory** — `beforeTool` already gates shell writes outside the worktree; `afterTool` already redacts secrets at the commit boundary | `src/seatguard.mjs:464-467`, `src/secretredact.mjs` |
| Forget / tombstones / retention | **absent** | — |
| Context-pressure instrument | **exists** — per-seat consumed tokens with `cacheRead`/`cacheWrite`, three-state denominator | `src/context.mjs` (roadmap 27) |

So the honest framing for the operator: **this is 20% new storage and 80% read path, delivery timing, and
gates** — and half of the delivery half is already the roadmap's onboarding work (O1–O4). Do not build a
second silo; fold.

## 4. Design of record (layers L0–L7)

Each layer is independently useful and independently reversible — the report's "big-bang is the anti-pattern"
warning, and this rig's failing-first discipline (`docs/failing-first-recipe.md`).

**L0 — Baseline before any write path (roadmap 161).** Two arms: *no memory* and *full history*, on ~a dozen
already-completed queue items replayed in a worktree, plus the two cheap adversarial probes the report names
(a planted instruction in a file the seat reads; "what is the current value of X" after X changed). Add a
rig-level **cache-hit measure** to `src/metrics.mjs` (nothing there reports `cacheRead` today — verified).
Without this arm, every later claim ("memory helped") is unfalsifiable in a rig whose whole cost model is
prompt-cache hits (§5.1).

**L1 — Raw layer, read-only recall (162).** Reuse durable's BM25 (`rankDocuments`) over entry text + item
bodies; results returned **by token budget, not by count**, with a pointer back to the entry id. No table, no
index file, no embeddings. This is the highest-evidence-value-per-line layer.

**L2 — Invariants layer (163).** Human-authored, agent read-only, **static** prompt section (the constitution
proves the mechanism). Static is not a style choice: it keeps the cached prefix stable (§5.1). The agent
proposes edits into a pending artifact; a human applies them.

**L3 — Cue-triggered recall at boundaries, never per turn (164).** Fire at: seat wake/claim, pre-compaction,
item completion. Content fenced and labelled (`[MEMORY — may be stale]` — the report: removing such a label
increased over-trust at every model size), deduped across the injection boundary, budget-capped. Delivery
rides the existing wake/primer push, not a tool the seat must think about.

**L4 — Typed facts, only if 161/162 show a need (165).** Bi-temporal: `valid_at/invalid_at` (world) vs
`recorded_at/expired_at` (system), `supersedes_id`, `source_event`, keyed on `(subject, predicate)` with a
**content-hash id** so a fork/replay upsert is idempotent. Two query paths: "true now" (`WHERE invalid_at IS
NULL`) and "true as of T". Store it as `pi-durable` docs (`defineDocFamily`) so writes go through
`api.commit` and inherit the single-writer discipline and the existing migration machinery
(`pi-durable/src/storage/sqlite/migrations.ts`). Skip the graph.

**L5 — Capture at loss points (166).** `CompactionHooks.beforeCompact` gives the entries and messages about
to be replaced → write an **extractive** working-thread checkpoint plus a pointer into the raw range; never
`{decline:true}`. No LLM in the hot write path.

**L6 — Write gate (167).** A single capture tool; `beforeTool` refuses a write with no structured provenance
(which entry id it derives from), and routes anything whose source is retrieved content (file, web, tool
output, another seat's prose) to a **quarantine tier** that is retrieved labelled and never promoted without
a human. Needs a `security` position doc first (precedent: `docs/reviews/security-*-position.md`, runbook
`docs/runbooks/security-trust-boundary-review.md`). **Memory must never satisfy a permission check** —
permissions live in `seatguard`/`writetargets`/`confine`, which fail closed.

**L7 — Forget and decay (168, 169).** Tombstone keyed on normalized content, checked **before insert**;
a `sweep` that reports remaining copies (index, item bodies under `.durig/`, session logs) rather than
claiming they are gone; expiry/review queue so the store stays small enough to be retrieved from.

## 5. Constraints this rig imposes that the report could not know

**5.1 The cached prefix is the economic model.** `docs/SELFDEV.md` records a month of billing for the
high-volume seat as **~385 M cached-in vs ~6.3 M fresh-in and ~1.7 M output tokens per day** (the underlying
CSV is on the Windows side, not in this clone — class `proxy` here, not re-read). Any memory content that
changes **every request** and sits in the prompt invalidates that prefix; the report makes the same point
from the platform side. Therefore: static blocks only in the prompt; dynamic recall delivered at
**boundaries**, and 161's cache-hit measure is the acceptance instrument for 163/164.

**5.2 One writer owns the store.** The broker owns the store; two write-side drivers collide (F24, D42/D45).
So no side-car database, no watcher/thread spawned from an extension factory, no writing to `selfdev.sqlite`
outside the harness commit path.

**5.3 Seat writes are confined to the worktree.** `SeatGuard.beforeTool` refuses shell writes outside it, and
`src/writetargets.mjs` polices the edit/write tools. So seat-writable memory is either **in the store via a
durig tool**, or a designated path added to the allow-list — which is a trust-boundary change and needs the
`security` seat's position before implementation, not after.

**5.4 Verification is cross-family.** A verifier must not share a model family with the author
(`docs/SELFDEV.md` §author/verifier split). For memory items this is not cosmetic: the report's over-trust
result is **capability-gated** (bigger models resist simple conflicts and collapse hardest on sophisticated
ones), so a memory change must be verified by a *different family than the seat that wrote the fixture*.
Include a deliberately-stale-fact trap in the demo.

**5.5 Portability.** Six Linux-only demo defects are open (`docs/NEXT.md`), and the pinned build is currently
**not linked** here (`node scripts/sync-pi.mjs` → `"linked": null`; re-link with `--sync --link`). Any
filesystem-level memory layer must be proven on both sides, or it inherits that debt.

## 6. Explicitly not doing (with reasons — candidates for `docs/DECISIONS.md`)

1. **Installing a pi coding-agent memory package** (`pi-memory`, `pi-mem`, Basic Memory's `bm install pi`) —
   wrong layer for seats (§2); two memory extensions injecting into one prompt is the report's named
   anti-pattern; Basic Memory is AGPL-3.0, which matters if we ever lift code.
2. **Knowledge-graph retrieval as the default** — the report rates it *contested* (55–56% vs 77–81% for
   Mem0/RAG/full-context, and the lead vanished once retrieval budget was equalised). Borrow the
   **schema** (Graphiti, Apache-2.0), not the traversal.
3. **LLM consolidation on the write path** — it is the 35:1 compression step that lost temporal markers, and
   consolidation is where provenance laundering lands.
4. **Agent-writable always-in-context tier** — Letta's own documented weakness ("agent-editable core lacks a
   trust model"). Human-authored, agent-read-only, propose-edits-instead.
5. **Embeddings/vector search before a named vocabulary-mismatch failure** — ranking instability (6.2 pp from
   swapping the embedding model alone changed which system *looked better*).
6. **Cancelling compaction from a memory hook** — durable's `{decline:true}` is the same trap.
7. **A polling `memory_search` tool as the primary surface** — conflicts with item 4 and the evidence that
   agents don't ask. A search tool may exist for *operator* use; delivery must be push.

## 7. Reference implementations to read (all open source; read architecture, don't vendor)

| Take | Project | License | Read |
|---|---|---|---|
| Bi-temporal fact schema, invalidate-don't-delete | `getzep/graphiti` | Apache-2.0 | `graphiti_core/edges.py` (`valid_at` / `invalid_at` / `expired_at` docstrings; note `episodes` provenance; strip its telemetry default) |
| Tiered, **budgeted** context blocks | `letta-ai/letta` | Apache-2.0 (brand assets excluded) | memory-blocks docs — copy the budget discipline, not agent-writable core |
| Markdown-canonical, index-derived-and-rebuildable; a real Pi integration | `basicmachines-co/basic-memory` | **AGPL-3.0** (check `integrations/pi/LICENSE`) | `integrations/pi/` (`recall.ts`, `capture.ts`), `plugins/claude-code/hooks/pre_compact.py`. Architecture only; one-way flow, never their sync engine |
| Compaction as an auditable event; symmetric keep-recent-half | `OpenHands/software-agent-sdk` | MIT | `openhands-sdk/openhands/sdk/context/condenser/` |
| Zero-embedding, budgeted structural selection | `Aider-AI/aider` | Apache-2.0 | repo map (tree-sitter → PageRank → budget) |
| Capability/taint control flow (design reference only) | `google-research/camel-prompt-injection` | Apache-2.0 | self-described research artifact — read, do not vendor |

Pin a commit before copying any of these; paths move.

## 8. Open rulings for the operator (delegate does not decide these)

- **R1 — Whose memory, and what scope?** (a) team memory shared by seats per rig, (b) the delegate/operator
  clock-in memory (`NEXT.md` today, informal), (c) both, with separate scopes. Per-project or crossing
  projects? The report's privacy finding ("global memory by default is a leak") says: explicit mapping, no
  ambient fallback — but which mapping is a scope call.
- **R2 — Where does memory live?** store (`pi-durable` docs: transactional, single-writer, migration
  machinery exists; but it grows the v2 store, currently 437 MB per `docs/NEXT.md`) vs repo markdown
  (human-editable, git-audited, greppable — but seats cannot write outside their worktree without a
  confinement change). My recommendation: **markdown canonical for human-authored layers (L2), store for
  seat-written facts (L4), index always derived and disposable** — and R2 should be ruled before 165 is
  sequenced.
- **R3 — When, against the rest of the book?** The rig's outstanding debt is the six Linux defects, the
  landing stack, and **the provider ruling** (all 8 running seats reported 402 on this box; no broker is up
  here — `status` → `broker.state: "down"`, measured this session). **L0 (161) cannot run without a working
  provider**, and L0 gates the credibility of everything after it. If memory work is bought now, it should
  be bought after the provider ruling; 162–163 can proceed without a provider only as fixture-driven demos.
- **R4 — Does `security` get the write-gate item as a precondition (167 before 165/166), or after?**
  Precedent in this repo is a position doc before implementation.

## 9. Measured this session (so the next reader does not re-derive it)

- `node scripts/sync-pi.mjs` → `pinnedSha 2ec55d80…`, `"linked": null`, `drift: true` (upstream tip
  `6c384aa3…`). Pinned build is not linked in this Linux clone right now.
- `DURIG_DB=./selfdev.sqlite node cli.mjs status` → seats present; **`broker.state: "down"`, `attention: []`**.
- **Docs defect (worth a one-liner from `scribe`/`devtools`, not a delegate fix):** `AGENTS.md` step 4 and
  `docs/SELFDEV.md` print `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs …`. `cli.mjs:142` reads
  `CFG.DURIG_DB ?? "./rig.sqlite"`, so the documented spelling silently audits an **empty** `./rig.sqlite`.
  Observed directly this session: with `DURIAN_PI_DB`, `status` returned an empty queue and "no verifier seat
  to judge"; with `DURIG_DB`, it returned the 12 seats and 4,818 queue rows.
- Queue shape (re-measured): 4,818 rows — 3,748 `done`, 777 `cancelled`, 274 `held`, 19 `deferred`. **No
  memory-feature item exists in the queue** (searched all 293 non-terminal rows).

## 10. Follow-ups

Unresolved questions are written to `docs/reviews/memory-followup-research-prompt.md` (required by
`docs/runbooks/research-request.md` step 4) and are for the operator to route to the research agent.
