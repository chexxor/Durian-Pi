I'll research this in parallel: the actual durig repo mechanisms, plus established runbook/SOP practice and agent-execution literature.Now let me read the actual durig runbook docs and baseline docs.Now let me pull the key external sources on runbook practice and agent-executable SOPs.Let me confirm the specific Google SRE claims and maintenance-policy sources.# Runbooks / SOPs for an LLM-operated agent rig — best practice, and a concrete proposal for durig

**Deliverable:** `docs/reviews/runbooks-sop-best-practices.md`
**Status:** research report (written only; no code touched)
**Author:** operator's research agent, 2026-10-16
**Baseline read:** `docs/runbooks/` (README + 5 runbooks), `docs/BROKER-SUPERVISION.md`, `docs/COMMANDS-AND-THE-BROKER.md`, `docs/NEXT.md`, `docs/reviews/runbooks-research-prompt.md`, repo `README.md`
**Evidence classes used below:** `observed` = verified against durig's own tree, code, or logs; `advertised-elsewhere` = an external claim I read but did not re-execute inside durig.

---

## 0. Verdict up front

durig's own conventions are, on the whole, **already ahead of most published runbook guidance** — and they were derived from real failures rather than copied. The skeleton in `docs/runbooks/README.md` (§"Conventions") already carries preconditions, read-only diagnosis, verify, rollback, and a last-verified line[^4] — which is essentially the union of what Google SRE, the sre.wang guide, and the incident-template literature recommend[^9][^1][^11].

What is **missing** is not sections but **machinery**: nothing *enforces* the conventions, nothing *detects rot*, and the one guardrail that matters most for durig — "never proceed on a false `stopped` signal" — is currently **prose only**, and prose is exactly what failed twice on 2026-10-16[^3][^10]. The highest-value recommendations here are therefore:

1. Keep the template, add a **machine-checkable front-matter block** (owner, writes?, last-verified, evidence).
2. Make the single-writer precondition a **hard guard in code** (ROADMAP 69 already names this), not a runbook sentence.
3. Add a `check` rule that **fails a runbook whose "last verified" is stale or whose cited evidence is absent** — turning rot into a failing test, which is what the incident-template literature explicitly calls for[^11].
4. Treat agent execution as a **capability-gated** feature: compile to structure only after a discipline check, because weak models are *harmed* by active-frame guidance (59:237 losses)[^2].

---

## 1. Template and structure

### 1.1 What the evidence supports

| Section | Why it earns its place | Evidence |
|---|---|---|
| Trigger / "when to use" (symptom-first) | The reader arrives with a symptom, not a system name; the trigger is also what links an alert to its runbook | Google SRE: "whenever an alert is created, a corresponding playbook entry is usually created"[^15]; sre.wang "Alert Information / trigger condition"[^1] |
| Impact assessment | Tells the reader how hard to push and whether to escalate | sre.wang "Impact Assessment" (user + business impact)[^1] |
| Preconditions | Separates "what must already be true" from "what to do"; the single most safety-critical section | sre.wang quality checklist: "safety: destructive operations explicitly marked, rollback provided"[^1] |
| Read-only diagnosis | Confirms the situation *before* any write; cheap and always safe | sre.wang: "from surface to deep, from quick to slow; specific commands, not 'check logs'"[^1] |
| Numbered, copy-pasteable steps | Under pressure, prose pseudo-commands are the classic failure | sre.wang: "Every step has specific commands… commands can be copy-pasted and run directly"[^1] |
| Verification (expected output) | Distinguishes "I ran it" from "it worked" | sre.wang pairs each step with "Expected output" + "Interpretation"[^1] |
| Rollback / "if it fails" | Never leave a half-applied write | sre.wang handling-steps: "Include rollback: if action doesn't work, how to roll back"[^1] |
| Escalation | Names who to hand to and when | PagerDuty's whole "Before/During/After an Incident" structure, incl. roles (IC, Scribe)[^8] |
| Owner + last-reviewed date | Makes rot detectable and assigns the fix | "Every runbook must have a last-reviewed date and an owner… inaccurate runbooks should be treated the same as failed tests"[^11] |
| Single canonical source, version-controlled, linked from the alert | Prevents the "three stale copies" problem | "One canonical version… single source of truth, version controlled, linked from the alert"[^11] |

**Evidence class:** all rows above are `advertised-elsewhere`. None was re-tested in durig.

### 1.2 Where durig already complies (observed)

durig's fixed skeleton — `When to use / Preconditions / Diagnose (read-only) / Do / Verify / If it fails / Evidence`[^4] — covers every row in §1.1 except an explicit *impact assessment* and *escalation contact*. Its `Evidence` line is the "owner + last-verified" metadata that the external guides put in a header block[^11][^1], just placed at the foot. This is a real, verifiable strength: the conventions were mined from the 2026-10-16 incidents (`docs/NEXT.md`), not borrowed[^4].

### 1.3 Recommended template (delta only)

Keep the current skeleton; add a **front-matter block** so the fields become machine-readable (see §3), and add the two missing sections:

```markdown
---
runbook: broker-down-or-stalled
symptom: "seats idle with queued work; no serve process; log stops"
writes: true            # does this procedure open a writing Harness?
precondition: "broker-stopped"   # or "none" / "read-only"
last_verified: 2026-10-16
verified_by: delegate
evidence: "items 54,66,68"
check_rule: null        # optional: the check/verify rule that re-tests this
---
# <Runbook title>

## When to use      <observable symptom, in the operator's words>
## Impact           <what breaks if you do nothing; blast radius>   # NEW
## Preconditions    <what must be true; usually: broker stopped and verified>
## Diagnose (read-only)
## Do               <numbered, literal, copy-pasteable; complete env on every line>
## Verify           <command + expected output>
## If it fails      <rollback or escalate>
## Escalate to      <seat/role + condition>                          # NEW
## Evidence         <item/commit + last verified date>
```

**Mapping to durig:** the front-matter `writes`/`precondition` fields are the hook that lets a `check` rule (ROADMAP 46-style, artifact-keyed ownership already exists in `docs/reviews/Agent_Ownership_Review.md` per NEXT.md[^3]) fail a runbook that says `writes: true` but omits the stop step. The `check_rule` field connects a runbook to `cli.mjs check`'s existing rule-id machinery, which already reports "skipped with its reason, never as a pass"[^5] — the honest-reporting posture durig uses elsewhere.

---

## 2. Lifecycle and maintenance

### 2.1 The published cadence (advertised-elsewhere)

- **Cadence by criticality:** critical services every 3 months, important every 6, general annually[^1].
- **Triggers for immediate update:** postmortem revealed a gap; architecture changed; on-call feedback that it was hard to use; alert threshold changed; a new team member found it confusing[^1].
- **Review participants:** the runbook owner (service owner), an SRE rep, and a recent on-call user[^1].
- **Version control:** runbooks live in Git beside the service code, follow the same branching strategy, require owner + SRE review, and are validated in CI (format, links, command validity)[^1].
- **"Last verified" is not optional:** "Every runbook must have a last-reviewed date and an owner"[^11]; templates carry `Last reviewed` / `Last tested` / `Next review due` / `Owner`[^11][^1].
- **Rot is a failing test:** "Inaccurate runbooks should be treated the same as failed tests: something to be fixed before the next deployment"[^11].
- **Coverage/freshness metrics:** % of alerts with a runbook, % reviewed within the window, access counts, % of incidents resolved using the runbook[^1].

**Evidence class:** `advertised-elsewhere`.

### 2.2 Recommended policy for durig (mapped)

durig has an unusual advantage: it already has a **drift-measurement subsystem** with bands, baselines, evidence class, and blind spots, surfaced ambiently through `status`/`watch` rather than on a screen of their own[^5]. Runbook freshness should ride the same channel rather than invent a new one.

| Policy element | Recommended value | durig mechanism to reuse |
|---|---|---|
| Owner | The delegate owns operator-surface runbooks; the **team owns seat-runbooks**; `scribe` keeps them true to code | Already stated in the README conventions[^4]; `scribe` is an existing seat |
| "Last verified" recorded | In front-matter `last_verified:` **and** a `verify` field naming the command | README already records the date in `Evidence`[^4] |
| Cadence | **Trigger-based, not calendar-first**: re-verify on (a) any incident that touched the procedure, (b) any change to a file the runbook names, (c) any `check` rule it references changing | `check` already reads the rig **and** the store[^5]; `metrics` already reports config revision + dirty-tree + active extensions[^5] |
| Enforcement | A `check` rule: `runbook-stale` (`error` if `last_verified` older than N days **and** the runbook's files changed since) and `runbook-unverified` (`fix-now` if `Verify` has never run) | Mirrors the existing `check` severity semantics — `error` gates a run, `fix-now` never fails a run[^5] |
| Verification recording | A runbook is "done" only when its `Verify` step has actually run; otherwise it is marked **unverified** | Already durig's rule[^4]; the whole set is currently unverified per NEXT.md[^3] |
| Version control | In-repo, same PR path as code; a runbook change is reviewed by the owner | Repo is already Git-versioned; the `Evidence` line names the commit[^10] |

**Why trigger-based beats pure calendar cadence for durig:** the failure mode on 2026-10-16 was not a stale *date* — it was a runbook whose step (1) worked mechanically but whose **precondition signal was false** (`serve --stop` returned `stopped:false`, and the step ran anyway)[^10][^3]. A calendar review would not have caught that; a **precondition-change trigger** ("this runbook assumes `serve --stop` is authoritative; item 74 removes that assumption") would have.

**Unverified:** I did not find an external source that prescribes *change-triggered* re-validation specifically for runbooks; the 3/6/12-month cadence is the published norm[^1]. The trigger-based refinement is my recommendation, mapped to durig's existing change-detection surfaces, and should be treated as a **design choice, not an established practice**.

---

## 3. Human vs agent execution — should steps be machine-readable?

### 3.1 The evidence

The strongest, most directly relevant result is the "Compile, Then Page" study (SOPBench, six models, seven domains)[^2]. Its findings:

- **Compiling prose SOPs into a structured program text lifted pass rate from 70.4% → 86.4%** on the clean Bank subset with a strong model — a **+16.0 point** gain in the *same channel*, no runtime[^2]. **Evidence class:** `advertised-elsewhere`.
- **Adding a runtime that pages only the active frame** reached 92.8% (+6.4 more), with **100% refusal correctness (86/86)**[^2]. The gain was "chiefly correct **refusal** behavior" — execution barely moved (74.4 → 71.8 → 76.9), refusal climbed 68.6 → 93.0 → 100[^2].
- **But structure is not universally good:** the two strong models had positive pooled paging contrasts (58:19 and 75:31 wins:losses), the transition model was unchanged, and **a weak model was badly harmed (59:237 losses)**[^2]. "The results reject 'more scaffolding is better.'"[^2]
- **The gate is not capability but discipline:** a state-reconstruction probe scored *all four probed models near ceiling* (0.91–0.99), yet the weak models still lost — the differentiator is **spontaneous state discipline**, not inability[^2].
- **Paging costs tokens:** mean prompt tokens 109,553 / 85,867 / 168,602 for offtext / flat / pg — an accuracy-and-traceability intervention, not a token saving[^2].
- **The runtime is soft:** "every action remains possible, while the stack makes skipped checks and unsupported returns observable"; **irreversible actions still require hard tool-layer guards**[^2][^2].

### 3.2 Agent mis-read failure modes (taxonomy)

The AgentErrorTaxonomy (500+ failed trajectories, 200 annotated) gives the vocabulary[^f7a328#Pages 3-4]. **Evidence class:** `advertised-elsewhere` (shares shown are my calculation over the chart's labels, not author-reported percentages):

| Failure mode | Share of annotated labels | What it looks like in a durig runbook |
|---|---|---|
| Inefficient planning | 48/199 (24.1%) | Agent does the steps in a wasteful order, hits a timeout |
| Over-simplification | 22/199 (11.1%) | Skips a step it judged "obvious" |
| Progress misjudgment | 20/199 (10.1%) | Thinks it's done when `Verify` hasn't run |
| Impossible action | 16/199 (8.0%) | Plans a step whose precondition is false |
| **Constraint ignorance** | 14/199 (7.0%) | **Runs `up --refresh` on a `stopped:false`** — ignores the precondition |
| Outcome misinterpretation | 13/199 (6.5%) | Misreads `stopped:false` as "fine, proceed" |
| Format / parameter errors | 6+4 | Malformed command, wrong path |
| Step-limit exhaustion | 10 (5.0%) | Loops until the broker's max-duration kills it |

The paper's central long-horizon finding is **cascading error**: failures cluster at steps 6–15, and early missteps distort everything downstream[^f7a328#Pages 3-4][^f7a328#Pages 8-8]. This is precisely durig's observed pathology — a seat that "wanders or degenerates"[^3], or that **ignores a bounded instruction and thrashes on hard work** ("the P2-6 Job Object cost ~2 h across two abort/reset cycles… if the seat ignores it, stop + reset")[^3].

Additional corroborating sources (all `advertised-elsewhere`): instruction-following degrades as instructions get "long, layered, and real"[^16]; multistep constraints "require sequential reasoning where each step's output feeds the next; an early error corrupts everything downstream"[^17]; and instruction-following failures are "partial or inconsistent" compliance rather than clean failure[^18].

### 3.3 Recommendation: **structured prose now, executable later — capability-gated**

Should steps be machine-readable? **Partially, and in a specific order** — exactly the paper's "compile first; enable code syntax or paging only after a model-level check"[^2].

1. **Adopt a machine-readable *header*, prose *body*.** The front-matter block in §1.3 is machine-readable without turning steps into a DSL. A seat can parse `writes`, `precondition`, `last_verified` and refuse on a mismatch; the human still reads numbered prose.
2. **Mark each step's kind explicitly.** durig's README already requires this — "a step is either a real command or prose explicitly marked as judgement"[^4]. Keep it, and make the marker syntactic (e.g. a `[judgement]` tag) so a `check` rule can flag an unmarked prose step that looks like a command.
3. **Do not build an executable DSL yet.** The evidence says the runtime layer only pays off above a capability threshold and **harms weak models**[^2]. durig already runs heterogeneous models (the rig spans multiple model families, and `check` has a `single-model-rig` rule[^5]) — so a paging runtime would help some seats and hurt others. Register it as a **research item**, gated on a per-model discipline check, not a v1 feature.
4. **The one place machine-readability pays immediately:** the **precondition**. A structured `precondition: broker-stopped` that a seat must *evaluate with a command and match against expected output* before step 1 is the highest-value structured field, and it is cheap.

---

## 4. Guardrails: hard preconditions, dry-run, rollback, idempotency

This is where durig's incidents are concentrated and where the external evidence converges hardest.

### 4.1 Hard preconditions

The key insight from the SOP paper is a **separation of layers**: the compile step makes "what must hold" and "how to verify it" explicit, and **a false required result branches to refusal before the goal action**[^2]. But the runtime is deliberately **soft** — it makes skipped checks *observable*, not impossible — and the authors state plainly that **irreversible actions still need hard tool-layer guards**[^2][^2]. **Evidence class:** `advertised-elsewhere`.

**Mapped to durig, this is the single most important recommendation.** The 2026-10-16 corruption happened because the "precondition" was a runbook sentence — "Proceed **only** on `"stopped": true`… **Never proceed on `false`**"[^10] — and a human *and* a seat both violated it[^3]. A soft, auditable check would have *recorded* the violation; only a hard guard prevents it.

The right shape for durig:
- **Hard, in code:** the write verbs (`up --refresh`, `reset`, `resume`, `doctor`, `send`) should **refuse** when `<db>.broker.json` names a live broker (or when `serve --stop` did not return `stopped:true`). This is exactly ROADMAP item **69** ("hard write guard, incl. `serve --stop` exit confirmation")[^3][^10]. The invariant already exists in `COMMANDS-AND-THE-BROKER.md` §8 ("One writer per store. Only the broker opens a writing `Harness` while it runs")[^6] — it is stated, but not enforced for every verb.
- **Soft, in the runbook:** the *audit trail* that a step was skipped. This is what the SOP runtime is good at[^2], and durig's broker log already provides it (`START`/`EXIT`/`WAKE`/`PASS`)[^12].

**Unverified:** whether durig's current `run` guard (`run` refuses while a broker is alive[^528a1a#125]) can be extended to the other write verbs without breaking the legitimate `stop` path; that is an implementation question for item 69, not something I verified.

### 4.2 Dry-run / read-only-first

Every external guide agrees diagnosis must be read-only and run first[^1]. durig already splits this cleanly: `status`, `watch`, `log`, `events`, `metrics`, `check`, `config`, `ui.mjs` open the **storage read-only** and are **safe while the broker runs**, while write verbs open a competing `Harness`[^6]. The runbook skeleton encodes this as `## Diagnose (read-only)`[^4].

**Recommendation:** every runbook's `Do` section should be preceded by a **mandatory read-only confirmation** that its `Verify` counterpart will later re-run. durig's runbooks mostly do this (e.g. `broker-safe-change.md` step 2 confirms no `serve` process remains before applying[^10]).

**A durig-specific dry-run gap (observed):** there is no `--dry-run` for the write verbs. The `up --refresh` step reports `refreshed`/`modelMismatch`/`modelReset` *after* the write[^10]. A dry-run that prints the diff (which constitution doc would change, which seat model would swap) before committing would turn a blind write into a reviewable one. This maps to ROADMAP **74** (hot-reload) only indirectly; I recommend a distinct item (§8).

### 4.3 Rollback

durig's rollback story is genuinely strong and should be the model for the whole set:
- **Store backup before any write**, with the `-shm` copy failing as an *implicit signal* that the broker is still running[^13]. That is a rollback mechanism doubling as a precondition check — elegant and worth keeping.
- **Restore path named explicitly** (`cp .spike/store-backup-<ts>/selfdev.sqlite ./selfdev.sqlite`)[^13].
- **"Never leave a half-applied write"** is already a stated convention[^4].

### 4.4 Idempotency

Two mechanisms already exist and are the right pattern:
- **`send --request-id`** makes one send one submission; a retry with the same id reuses it (`reused: true`)[^5].
- **Inbox intents carry a `requestId`** so "a crash between submit and unlink re-drains idempotently"[^3].

**Recommendation:** every *destructive* runbook step must be idempotent or explicitly one-shot. The template should require it: add a per-step `idempotent: yes/no` marker (or prose "safe to re-run"). durig's `broker-down-or-stalled.md` step 3 (restart) is naturally idempotent; `store-corruption-recovery.md` step 3 (retire the corrupt doc) is not, and should say so.

---

## 5. Organization and discoverability

### 5.1 Symptom-first vs system-first

durig chose **symptom-first**: "named for the symptom a person would type: `broker-down-or-stalled.md`, not `troubleshooting.md`. The filename is the index key"[^4]. This matches the external norm — the trigger is what the reader has, and Google SRE links the alert to the playbook[^15]. **Recommendation: keep symptom-first for the top-level runbooks; add a system-first *index* as a second view** (a table keyed by mechanism: broker, store, seats, worktrees, daemon) so a maintainer entering from the code side can find the procedure. durig's README already has a symptom index table with a `Writes?` column[^4] — add a mechanism column.

### 5.2 Discoverability for an agent

An agent retrieves by matching a symptom string to a filename or a front-matter `symptom:` field. The front-matter block in §1.3 makes that retrieval mechanical. **Recommendation:** keep the filename as the primary key (it's human-typable) and mirror it in front-matter so both audiences retrieve the same way.

### 5.3 Linking to design docs (do not duplicate)

durig's rule is right and should be enforced: "Prefer link-out to the design doc over restating it; a runbook that grows a 'background' section should move that to the design doc"[^4]. This is the runbook analogue of Diátaxis's separation of *how-to guides* from *explanation* — Diátaxis identifies four distinct documentation forms (tutorials, how-to guides, reference, explanation) serving four distinct needs[^14]. A runbook is a **how-to guide**; `BROKER-SUPERVISION.md`/`COMMANDS-AND-THE-BROKER.md` are **reference/explanation**[^6]. The current split already respects this, and it is the single best structural decision in the set.

**Mapping:** the `## Background` anti-pattern (see §6) is detectable — a `check` rule could flag a runbook over a line budget or one that restates a design-doc heading.

---

## 6. Anti-patterns

Consolidated from the external evidence and durig's own incidents:

| Anti-pattern | Why it fails | Source | durig status |
|---|---|---|---|
| **Stale / describes a system that no longer exists** | "worse than no runbook… sends engineers down dead-end diagnostic paths" | [^11] | Risk: set is currently unverified[^3] |
| **Multiple copies / informal docs** | "not a Google Doc… a Notion copy six months out of date" | [^11] | Avoided: in-repo, single source |
| **Prose pseudo-commands** | Can't be copy-pasted under pressure; agent can't execute | [^1] | durig already forbids: "Commands are literal. No pseudo-commands"[^4] |
| **Hidden state** | The reader can't tell what the procedure assumes | [^1] | Partially addressed by `Preconditions` section |
| **No rollback / half-applied write** | Leaves the system in a worse state than before | [^1] | durig rule: "never leave a half-applied write"[^4] |
| **Precondition expressed as prose only** | A seat/human can proceed on a false signal — **the exact 2026-10-16 failure** | [^2] + observed[^10] | **Open** — item 69 |
| **Too long / duplicates the design doc** | "a runbook that grows a background section should move that to the design doc" | [^4] | durig rule exists; unenforced |
| **Untested steps** | "Inaccurate runbooks treated like failed tests" | [^11] | **Open** — no artifact test yet |
| **More scaffolding than the executor can hold** | Weak models *lose* 59:237 under active-frame guidance | [^2] | **Open** — relevant if a DSL is built |
| **Assuming a dead process stays dead** | Nothing restarts a dead broker (the supervision gap) | observed[^3] | Known: items 61–64 |
| **Trusting a pid as identity** | Windows reuses pids; a stale `.broker.json` reads as alive | observed[^7] | Addressed by item 65 (pid + runToken + heartbeat) |

---

## 7. Testing runbooks as artifacts

The external consensus is that a runbook is an artifact that must be *tested*, and that inaccuracy should fail a build like a failing test[^11]. CI should validate format, links, and **command validity**[^1]. Google SRE runs the "Wheel of Misfortune" — deliberate practice exercises — precisely to prepare engineers[^9]. **Evidence class:** `advertised-elsewhere`.

### 7.1 What durig can do — and already has the machinery for

durig's testing culture is **failing-first demos**: "one runnable proof per guarantee," written RED before GREEN (`demo/broker-liveness.test.mjs` was RED against the current broker, GREEN after)[^3][^3]. This is directly transferable to runbooks. Ranked by cost/benefit:

| Method | Cost | Benefit | durig hook |
|---|---|---|---|
| **Static check rule** (`check`): front-matter present, `last_verified` fresh, `writes:true` ⇒ stop-step present, cited evidence commit exists | Low | Catches rot, missing guards, broken links | `src/checkup.mjs` already emits stable rule ids + severity[^5] |
| **Read-only diagnosis as an executable test**: run each runbook's `Diagnose` block in CI; assert it exits 0 and prints parseable output | Low–Med | Proves the diagnosis half never rots | Read-only verbs are safe while the broker runs[^6]; the whole TUI suite already runs hermetically (`npm run test:tui`)[^3] |
| **Fault-injection / chaos test of the whole procedure**: crash a faux broker, run `broker-down-or-stalled.md` end-to-end, assert recovery | Med–High | Proves the fix half | NEXT.md already contemplates a "chaos suite" (item #727)[^3]; `demo/broker-*.test.mjs` give the harness |
| **Tabletop / Wheel-of-Misfortune**: a seat (or human) executes the runbook against a fault and the gaps become items | Med | Finds usability gaps a script can't | PagerDuty-style; durig's `check` "skipped with reason" discipline fits the honest-reporting culture[^5] |

**Recommendation:** ship the **static `check` rule first** (cheapest, highest rot-prevention), then convert each runbook's `Diagnose` block into an executable read-only test. Full chaos-testing of the *write* procedures should wait until the hard guard (item 69) exists, because testing a write procedure safely requires the guard.

**Unverified:** I did not find a source that describes testing runbooks via a linter in the *same* system as the service; the CI-validation advice[^1] is generic. The `check`-rule mapping is my proposal, not established practice.

---

## 8. Concrete recommendation for durig

### 8.1 Directory layout (keep, extend)

```
docs/runbooks/
├── README.md                     # conventions + two indexes (symptom + mechanism)
├── _template.md                  # the §1.3 template, as a file
├── broker-down-or-stalled.md
├── broker-safe-change.md
├── store-corruption-recovery.md
├── seat-reset.md
├── leaked-worktrees.md
└── daemon-not-running.md         # NEW — pre-writes the item 61–64 procedure
```

Keep one situation per file, symptom-first filenames[^4]. Add `_template.md` so new runbooks start from the enforced shape, and a `daemon-not-running.md` that will be the operator surface for the host daemon (items 61–64) — the design is already written in `BROKER-SUPERVISION.md` §11 (`durig daemon status` / `restart` / `stop`)[^7], so the runbook is the last mile.

### 8.2 Maintenance policy (adopt)

1. **Front-matter is mandatory** (owner, writes, precondition, last_verified, verified_by, evidence).
2. **A runbook is "verified" only when its `Verify` step has run**; otherwise it is marked unverified in front-matter[^4].
3. **Re-verify on trigger, not calendar:** any incident touching the procedure, any change to a named file, any change to a referenced `check` rule[^1] + observed failure pattern.
4. **Ownership:** delegate owns operator-surface runbooks; the team owns seat-runbooks; `scribe` keeps them true[^4].
5. **`check` enforces freshness:** `runbook-stale` (`error`), `runbook-unverified` (`fix-now`).
6. **A runbook that failed during an incident files a ticket immediately** — the "treat as a failing test" rule[^11].

### 8.3 Agent-execution guardrails (adopt)

- **Structured header, prose body.** Machine-readable `precondition`; steps stay literal commands or explicitly-marked judgement[^4].
- **Preconditions are hard, in code.** Item 69 gates the write verbs on a *verified* stop; the runbook sentence becomes a comment, not the guard[^10].
- **Soft audit of skipped steps** rides the broker log[^2].
- **Do not build a paging runtime yet** — capability-gate it; weak models are harmed[^2].
- **Idempotent or explicitly one-shot** per destructive step; reuse `requestId`[^3][^5].

### 8.4 Proposed ROADMAP items (registered, not scheduled)

| # | Title | Rationale | Depends on |
|---|---|---|---|
| **R1** | `runbook-stale` / `runbook-unverified` `check` rules | Turns rot into a failing check; uses existing rule-id/severity machinery[^5] | — |
| **R2** | Mandatory runbook front-matter + `_template.md` | Makes every runbook machine-retrievable and guard-checkable | R1 |
| **R3** | Hard write guard on all write verbs (extends **item 69**) | The precondition must be code, not prose; the 2026-10-16 corruption[^10] | item 69 |
| **R4** | `--dry-run` for `up --refresh` / `reset` | Print the diff (constitution doc, seat model) before writing[^10] | R3 |
| **R5** | Executable `Diagnose` blocks in CI | Proves the read-only half never rots[^1] | — |
| **R6** | Runbook verification in the `check` provenance line | A reading already reports revision/dirty-tree/extensions[^5]; add "runbooks verified against rev X" | R1 |
| **R7** | Agent-executable runbook runtime (research, gated) | Compile-then-page lifted refusal to 100% but harmed weak models[^2]; needs a per-model discipline check first | research |
| **R8** | `daemon-not-running.md` runbook | Pre-writes the operator surface for items 61–64[^7] | items 61–64 |

### 8.5 Finding → durig mechanism map

| Finding | durig mechanism it maps to | Status |
|---|---|---|
| Precondition must be enforced in code | `check`/`run` guards, `<db>.broker.json`, `serve --stop` result[^528a1a#125][^10] | Partially exists; item 69 |
| Symptom-first naming | README convention + index[^4] | Done |
| Owner + last-verified metadata | `Evidence` line[^4] | Done (in prose) |
| Idempotency | `--request-id`, inbox `requestId`[^5][^3] | Done |
| Rollback via backup | `store-corruption-recovery.md` backup/restore[^13] | Done |
| Freshness as a failing test | `check` rule machinery[^5] | **Gap** |
| Machine-readable structure | front-matter | **Gap** |
| Dry-run | none | **Gap** |
| Executable runbook runtime | none | **Gap (research)** |

---

## 9. Unverified / not established

- **Change-triggered re-validation** as a norm — my recommendation; the published norm is calendar cadence[^1].
- **Runbook linter in the same system as the service** — generic CI advice exists[^1]; the durig-specific `check` mapping is mine.
- **Whether durig's existing `run` guard can be extended to all write verbs without breaking the `stop` path** — implementation question for item 69.
- **The exact empirical share figures** in §3.2 are my calculation over the chart's labels in the AgentErrorTaxonomy figure, not author-reported percentages[^f7a328#Pages 3-4].
- **PagerDuty playbook structure at the level of detail requested** — the `response.pagerduty.com` homepage names the Before/During/After structure and roles but does not give focused playbook-template evidence[^8]; I did not fetch the deeper pages.
- **Google SRE's runbook chapter content** — I could not retrieve focused runbook-structure guidance from the SRE book's on-call chapter (the "3× MTTR" claim is from the book's introduction[^9]); the specific "what belongs in a runbook" guidance was sourced from the sre.wang guide and incident-template literature instead.

---

### One-line summary

durig's runbook conventions are sound and already match published best practice; the work that remains is **machinery** — make the single-writer precondition a hard code guard (item 69), add a `check` rule that treats a stale runbook like a failing test, and keep agent execution as structured prose now with an executable runtime deferred behind a capability gate.

**References**

[^1]: [Runbook Writing Guide: Making Operational Knowledge Reproducible | SRE Engineering Practice](https://www.sre.wang/en/posts/sre-runbook-playbook/) (17%)
[^2]: [[2607.11346v3] Compile, Then Page: Executable SOP Programs and a Capability-Gated Runtime for Procedural LLM Agents](https://arxiv.org/html/2607.11346v3) (15%)
[^3]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/NEXT.md) (14%)
[^4]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/runbooks/README.md) (13%)
[^5]: [chexxor/Pi-OpenDurig GitHub Repo](https://github.com/chexxor/Pi-OpenDurig) (9%)
[^6]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/COMMANDS-AND-THE-BROKER.md) (9%)
[^7]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/BROKER-SUPERVISION.md) (6%)
[^8]: [PagerDuty Incident Response Documentation](https://response.pagerduty.com/) (5%)
[^9]: [Google SRE - IT Service Management: Automate Operations](https://sre.google/sre-book/introduction/) (3%)
[^10]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/runbooks/broker-safe-change.md) (3%)
[^11]: [Incident Runbook Template: The Essential Guide for SRE Teams in 2026 - The Good Shell](https://thegoodshell.com/incident-runbook-template/) (2%)
[^12]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/runbooks/broker-down-or-stalled.md) (1%)
[^13]: [raw.githubusercontent.com](https://raw.githubusercontent.com/chexxor/Pi-OpenDurig/main/docs/runbooks/store-corruption-recovery.md) (1%)
[^14]: [Diátaxis](https://diataxis.fr/) (1%)
[^15]: [Google SRE: What it Means Being On-Call?](https://sre.google/workbook/on-call/) (0%)
[^16]: [Why Did My AI Agent Ignore Half My Instructions?](https://medium.com/tech-ai-made-easy/why-did-my-ai-agent-ignore-half-my-instructions-fde3aea6e9f5) (0%)
[^17]: [ComplexConstraints: A Benchmark for Entangled ...](https://surgehq.ai/blog/complexconstraints-a-benchmark-for-entangled-instruction-following) (0%)
[^18]: [Testing AI Chat Agents for Instruction-Following Failures](https://www.cekura.ai/discover/ai-chat-agent-instruction-following-testing) (0%)