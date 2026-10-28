# The next major milestone — measured case and recommendation (delegate, 2026-10-28)

Question put to the delegate: **choose the next major milestone.** This document is the case, not the
ruling. The operator ratifies or replaces the choice; `pm` sequences and decomposes within it.
Nothing here is asserted from memory — every number is from a command run in this session.

**Machine state, named:** native Linux, `Linux Alex-Desktop-Win10 7.2.11-200.fc44.x86_64`. Nothing was
restarted, reconfigured, loaded, sent, claimed or transitioned this session.

---

## 1. What the rig actually looks like right now (all measured this session)

| Check | Result |
|---|---|
| `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` | `pass: true`, **0 errors, 62 findings** — `duplicate-item` 54, `citation-unresolvable` 5, `single-model-rig` 1, `verification-without-evidence` 1, `evidence-tree` 1. `single-model-rig` is **fix-now and still present** (honest red). |
| `node scripts/test.mjs` | **238/238 in 42.2 s** (concurrent runner, D135). Slowest: `cli` 18.0 s, `broker-wakepath` 16.9 s. |
| `node cli.mjs queue` (4,818 rows) | `done` 3,748 · `cancelled` 777 · `held` 274 · `deferred` 19 · **`queued` 0 · `claimed` 0** |
| `node cli.mjs status` → `broker` | `{"state":"down","reason":"no broker state"}` |
| `status` → `attention` | 5 seats `deferred_awaiting_answer`: `pm` #4813, `impl` #4354, `lead` #4816, `devtools` #4817, `qa2` #4814 — all **waiting on human** |
| `git worktree list` / `git branch --list` | **1 worktree** (the shared checkout) · **1 branch** (`main`) · **0 branches unmerged into `main`** |
| GPUs (`nvidia-smi`) | A4000 **2,577 MiB free**; 3090 **305 MiB free** |
| Endpoints (`curl /v1/models`) | Strata live on `:47831` (`iq3_s`, `"gpus":[1]`); LM Studio live on `:1234` (`ministral-3-14b-reasoning`, `flint`, `nomic-embed`) |
| Provider key | `DEEPINFRA_API_KEY` **not in the environment** (all 12 seats resolve to `local/iq3_s`) |

**The shape that matters:** the team has **no work it can take.** Not "little work" — zero `queued`, zero
`claimed`. Everything non-terminal is parked: 274 `held` and 19 `deferred`, five of them waiting on a
human answer. The store is not quiet because the work is done; it is quiet because nothing is releasable.

Two cuts of the 274 held rows (classification by subject prefix, this session):

- **What kind of work:** landing bookkeeping **105**, other **89**, registered-backlog **56**, build **15**,
  verify **9**. The mass is administrative, not product.
- **Is it still releasable?** 98 held rows cite commit shas; of the **103 distinct shas**, `git
  cat-file --batch-check` resolves **95** and returns `missing` for **8** (`0c6fd7665`, `1d45af6`,
  `371f6be`, `67d885d`, `756100e`, `a2eaf7b`, `e29ddb8`, `fd4c233`). **8 held rows cite only
  unreachable commits** — with 0 unmerged branches and 1 worktree, those rows cannot be *released*, only
  re-derived or cancelled. This is ROADMAP 190's finding showing up on the live side of the queue.

**The finding that decides the milestone question.** Searching all 4,818 subjects for the roadmap ids of
the newest families:

| Roadmap family | Rows in the store |
|---|---|
| 161–169 (memory, operator-prioritized by R3, D130) | **0** |
| 170–174 (OS-grade security substrate, R4 "security precedes") | **0** |
| 175–184 (the consumed research deltas to both tranches) | **0** |
| 185–189 (Linux as an operating platform) | **0** |

Every one of these is **registered and never commissioned.** The roadmap says "memory first" (R3) and
"security precedes" (R4); the store says neither has a single row. The last four sessions spent their
capacity on 189's *measurement instrument* (a delegate-side probe under `tools/model-probes/`), which is
how a rig ends up with 62 `check` findings, 274 parked rows and zero rows for the two things the
operator actually ruled on.

## 2. Substrate gaps re-verified in code this session (so the milestone names real absences)

- **Refusals leave no record.** `src/seatguard.mjs` answers with `{block: …}` at `:360`, `:371`, `:378`,
  `:386`, `:391`, `:397`, `:403`, `:414` and writes nothing durable. There is no `avc: denied` analogue:
  "which seat was refused, under which rule, when" is unqueryable. (ROADMAP 172.)
- **Reach is per-seat, never per-claim.** `toolRemovalsFor` (`src/seattools.mjs:262`) and
  `COORDINATOR_REMOVALS` (`:247`) decide tool sets from the seat's declared capabilities. There is no
  deny-by-default boundary attached to the item. (ROADMAP 173.)
- **No memory read path exists.** `search_history` matches nothing under `src/`, while pi-durable's BM25
  `rankDocuments` (`vendor/pi-main/packages/durable/src/search.ts:52`) is imported only by `codemode` and
  `tool-search`. The transcript — 273,948 ids, append-only, `DELETE FROM entries` absent — is the rawest
  memory asset in the rig and no tool reads it. (ROADMAP 176, rated "highest value per unit effort".)
- **The doc-family mechanism is already used.** `defineDoc` at `src/rig.mjs:22,30,38,53,102` — so 177's
  facts-as-documents needs no new substrate, only a new family.
- **M3's halves are delivered.** Working tools are installed and narrowed by capability (`src/seattools.mjs`
  gives read/write/edit/shell/prepare_workspace to producing and checking seats, and removes them from
  coordinators), and completion carries evidence (`checkup.mjs:736,790` — `complete_work(<id>, <summary>,
  {command, exitCode, artifact})`, with `verification-without-evidence` and `evidence-tree` rules live).
  What is **not** delivered is the *independence*: `single-model-rig` says all 12 seats are one family.

## 3. The three candidate milestones, and what each is blocked on

**Candidate A — 189 / the verifier family.** This is the incumbent pointer (ROADMAP 189, items 194–200).
It is blocked on an **operator choice about cost, throughput, context headroom and availability**, not on
a measurement: D140 measured that at n = 8 with matched pairs and k = 3 the two resident families are
indistinguishable (whole-module 1/5 vs 1/5, p = 1.000; fragment 4/8 vs 0/8 at p = 0.125), and 200 records
that G2's calibration floor is not replicate-stable at that n. Free VRAM right now is 2,577 / 305 MiB, so
nothing new can be loaded without restarting the operator's servers. **This is a decision plus a corpus
increase, not a milestone** — it produces a routing number, not a capability.

**Candidate B — drain and re-inventory the backlog** (the 274 held, the 8 unreachable-sha rows, the 5
human-gated `deferred`). Necessary, cheap, and not a milestone: it is hygiene. The procedure already
exists (`docs/runbooks/stale-held-backlog.md`, `docs/WORK-ITEM-LIFECYCLE.md` §7) and the recommended
replies to the five parked questions are already written in `docs/reviews/parked-questions-2026-10-26.md`.
**It is week one of whichever milestone is chosen, not the milestone.**

**Candidate C — the substrate-then-memory tranche (ROADMAP 171–173 → 175/176/161 → 167/179 → 163 →
165/166).** The operator ruled it twice: R3 *memory first*, R4 *security precedes* (D130), and
`docs/reviews/memory-implementation-plan.md` §8 already states the sequence. Its expensive half is paid:
the research landed and is consumed (`docs/reviews/zero-trust-zero-agent-research.md` 35 KB,
`docs/reviews/memory-followup-research.md`), and the roadmap deltas 175–184 are written. And it is the
only candidate that **needs nothing the rig does not already have**: no provider key, no second model
family, no GPU headroom, no `up --refresh`, no LM Studio/Strata restart — `docs/reviews/memory-implementation-plan.md`
§8 and ROADMAP 161 both record that 161/162/167 are buildable failing-first against the faux provider
(`DURIG_PROVIDER: "faux"`).

## 4. Choice: **M5 — the rig can say what a seat was allowed to do, and can remember what it saw**

Roadmap ids: **171 → 172 → 173** (the shape half of 60/170–174), then **175 → 176 → 161 → 167/179 → 163 →
165/166 → 168/169**. One sentence of intent: *every enforcement decision becomes a durable, queryable
record; reach becomes labels and `allow` rules as data, default-deny, attachable to the claim; and on top
of that boundary the rig gets a budgeted read path over its own transcript, with an origin-bound write
gate before any seat-writable tier exists.*

Why this one, in order of how load-bearing the reason is:

1. **It is the only tranche the operator has already prioritized twice** (R3, R4 / D130) — and the only
   one with **zero rows in the store**. The mismatch between ruling and queue is the measured defect of
   this session.
2. **It unblocks rather than waits on the thing that has parked four sessions.** 189 needs a family ruling
   and GPU room; M5 needs the faux provider. Waiting for the family decision is what turned the last four
   sessions into instrumentation of an instrument.
3. **It is the cheapest part of the security question and the least risky.** The zero-trust report's own
   verdict — adopted in ROADMAP §"what the security report changes" — is *adopt the shape, not the
   machinery*: one mediation point (we have it at `ToolHooks.beforeTool`), labels not caller identity, a
   default-deny `allow` relation outside the subject, a durable record. None of those four touches a trust
   boundary. SELinux's language, `audit2allow` synthesis, AppContainer/MIC relabelling and per-call human
   prompting are all **rejected in writing**, so the milestone excludes the expensive machinery by design.
   The OS backstop (174 — Landlock/seccomp at the existing spawn point, now that Linux is native) sits at
   the end, after the position doc, where item 55 and `docs/runbooks/security-trust-boundary-review.md`
   put it.
4. **It makes verification cheaper for everything after it.** Item 172's log answers questions the rig
   currently cannot answer except by re-running; 190/177/D133 already ruled that durable records cite
   `entries.id`, so the log lands in the store and survives a machine move — which is exactly the failure
   that produced the 8 unreachable-sha held rows above.
5. **Its verification does not depend on the missing second model family.** A memory A/B (161/182) wants a
   provider and 182's "author seat and verifier seat must not share the memory-writing model" check; the
   substrate's acceptance is deterministic — failing-first demos, a `check` rule, and a query that either
   returns the refusal or does not. That matters while `single-model-rig` is red.

**Deliberately not the milestone:** M4/TUI Phase 2 (parked on the operator's Q2 and on dead local
sessions — 9 of the 19 `deferred` rows are TUI-adjacent), the verifier-family ruling (Candidate A, an
operator decision), and any seat-writable memory tier (165/166) until 167's gate exists.

## 5. What M5 commits the team to (scope for `pm` to decompose — the delegate does not decompose)

| Order | Roadmap | Deliverable (measure, not prose) | Needs |
|---|---|---|---|
| 0 | — | **Drain precondition:** answer the five parked questions (recommended replies already written), release the held rows whose gates are terminal, cancel or re-derive the 8 rows citing unreachable shas. Then `check` and `status` re-measured. | operator answers; no code |
| 1 | 171 | `security` position doc for the substrate **before any code** — boundary, trust model, enforcement points, fallback when the broker dies; each control falsifiable by a named test. | nothing |
| 2 | 172 | Subject identity surviving wake/`reset`/fresh conversation/fork/compaction, **and a durable `avc: denied` analogue**: subject label, object label, class, permission, result, enforce\|complain, policy version — written as a store record. Demo: two runs of one seat distinguishable in the audit; a refused action retrievable by subject and rule. | faux provider |
| 3 | 173 | Labels + `allow` rules as data, deny-by-default, a **complain mode** for rollout, and reach attached to the **claim**, not the seat. Demo: a rig runs with a grant the seat did not have, revoked after, revocation visible in 172's log. No `audit2allow` auto-load. | faux provider |
| 4 | 175 | Cache-economics gate **before any memory `section` is written**: one seat, one draft, static section vs per-turn-changing section, logging prompt tokens/cost. Move changing content into the transcript if the section is the bill. | faux provider (a real endpoint sharpens it; not required to start) |
| 5 | 176 | `search_history` over the immutable transcript — budgeted-by-tokens, pointer-carrying, `replay: "safe"`, reads only. Makes today's compaction pointer-preserving without a second summarizer. | faux provider |
| 6 | 161 | A/B arms (no memory / full history / memory / memory-with-gate-off per 182) built **offline**, arms run the day a provider lands; plus the rig-level cache-hit measure (`cacheRead`/`cacheWrite` per seat) in `src/metrics.mjs`. | build offline; measure later |
| 7 | 167 + 179 | Origin-bound write gate: `remember({subject, predicate, object, valid_from, source_entry})` behind `beforeTool`, `source_kind` keyed, quarantine forced for `tool_output`/`retrieved_doc`/`external_message`, promotion only by an out-of-band human commit. Decision stored in `api.memo` (hooks re-run after a crash). No memory record may ever satisfy a permission check. | after 171/172 |
| 8 | 163 | Human-authored invariants layer as a cache-stable prompt section; agent edits go to a pending artifact. Measure: editing it invalidates the cached prefix **exactly once**. | after 173, 175 |
| 9 | 165/166 → 168/169 | Typed facts as `history:"rewindable"` docs with supersession + `source_event` = entry id; capture at the compaction loss point; tombstones checked before insert **and** before render in both read paths; retention budget. | after 167 |

**Standing rule inside the milestone:** 174 (the OS-level backstop) is evaluated after the position doc and
never before a named escape that the hook layer does not stop — and it is native-only (no WSL, no Docker).

## 6. Escalation — four things that are the operator's, not the delegate's or a seat's

1. **Ratify or replace the milestone choice above** (R3/R4 ordering vs the 189 measurement track). One word
   is enough: `M5`, `189`, or `drain first`.
2. **The 189 verifier family** — unchanged since D137/D138/D139/D140, and now a **cost/throughput/context/
   availability** choice, not a capability score (D140 measured the gate cannot rank the resident families
   at n = 8). Note it also decides whether `worktree.mjs`/`rig.mjs` can ever be shown whole to a verifier.
3. **The five parked rows** — #4813 (pm), #4354 (impl), #4816 (lead), #4817/#4818 (devtools), #4814 (qa2).
   Recommended replies are already written in `docs/reviews/parked-questions-2026-10-26.md`; answering them
   is the cheapest capacity the rig can gain this week.
4. **`#4785` was marked `done` with no artifact anywhere** (unchanged from the previous pointer): the
   "completion without an artifact" detector is still unregistered. M5's item 172 log is a natural home for
   it, but registering it is the operator's call.

## 7. What would show this choice is right — without asking me or the operator

- `node cli.mjs queue` shows **`queued` > 0** and **`claimed` > 0** for 171–173/175/176 ids, and
  `node cli.mjs status` stops reporting `deferred_awaiting_answer` for the five seats.
- `node cli.mjs check rig.selfdev.json` gains a rule that resolves a cited `entries.id`, and the
  `citation-unresolvable` count stops growing on new rows (D133's binding, made enforceable).
- A refusal becomes **queryable**: a demo that refuses a write and then reads the refusal back by seat and
  rule from the store — the row either exists or it does not.
- `search_history` returns a known fact from a fixture transcript **within a token budget**, and the
  planted-instruction probe from 161 lands in quarantine, never in a promoted tier.
- Independent verification by a verifier seat — with the honest caveat recorded, not hidden: while
  `single-model-rig` is red, that verifier shares the author's family. The deterministic demos above are
  what carry the proof until the family ruling lands.
