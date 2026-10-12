# Self-admin improvement register

**What this is.** A durable, evidence-grounded list of *improvements a durig
installation could apply* — configuration changes, platform features, refactors,
and **system-prompt edits** — that a durig **self-admin** consults when a user
hits a platform problem, or when a user asks for improvement ideas directly or
indirectly. It is the answer to "a bare Linux versus a distro with the drivers,
themes and packages a normal user wants pre-installed": durig should carry
sensible defaults and **pre-empt** bad outcomes, and where it cannot yet, it
should *offer* the fix instead of requiring the user to know the architecture.

**How it is meant to behave (deliberately not in-your-face).**
- It is a **resource, not a nag**. Nothing here interrupts a run or a reply.
- It is **consulted, not pushed**: a self-admin seat (or the operator) reads it;
  `check`/`doctor` may *point* at a matching entry when a real finding fires, and
  a user question ("how do I improve my setup?", "why does X keep happening?")
  should route here.
- Every entry is **grounded**: it names the evidence that it would help, so it is
  a hypothesis with a reason, never a wish list.

**Entry format** (one per entry):
`id` · **trigger/symptom** · **evidence** (file/## /dogfood finding/roadmap item) ·
**change** (the concrete edit) · **why it helps** · **risk/effort** · **surfaced by**
(which signal should point here). A prompt-drift entry names the *prompt text* and
what intent it has drifted from.

**Prompt drift is a first-class entry class.** An always-on system prompt corrects
for intent at one moment; over time the operator's intent drifts (a new corpus, a
new workflow, a retired constraint) and the prompt keeps enforcing the old one.
The register is where that is noticed and corrected, with the evidence being the
run where the stale instruction bit.

---

## Seeded entries (grounded)

### SA-1 — Context management should have safe defaults (the biggest hands-off gap)
- **Trigger:** a seat degenerates or its context fills; today this is handled by
  hand (`reset`, `resume`) rather than by default.
- **Evidence:** ROADMAP 27/28 (context visibility/reduction, unbuilt); durig
  needed `reset` (ROADMAP 44) for exactly this; agent-fleet ships an ordered
  pressure guard + session recycle by default (`BORROW-FROM-agent-fleet.md`).
- **Change:** enable a default pressure guard (warn → preserve-and-settle → one
  compaction) and optional session recycle, exposed as settings with sensible
  defaults, plus a budget diagnostic.
- **Why it helps:** stops the most common operator intervention.
- **Risk/effort:** M; changes runtime behaviour, so it needs a measure and a gate.
- **Surfaced by:** `last_run_failed` / context measures / a user "why did it loop".

### SA-2 — A completion should not be readable as a pass
- **Trigger:** a seat's `DONE` is trusted more than the evidence behind it.
- **Evidence:** agent-fleet's Verification Contract (`agent-fleet.runtime-result/v1`)
  separates `execution / changes / verification / acceptance`; durig's pair review
  is behavioural only (`BORROW-FROM-agent-fleet.md`; registered `#61`).
- **Change:** give `complete_work` a structured result (changed? verified? by
  what command/exit? evidence path).
- **Why it helps:** a verifier can act on the shape, not the prose.
- **Risk/effort:** S–M; additive.
- **Surfaced by:** qa "the completion said done but nothing ran".

### SA-3 — Runaway runs should be caught by the platform
- **Trigger:** a seat loops (repeated tool calls / repeated text) and burns turns.
- **Evidence:** ROADMAP 43 (degenerate loop) and 42 (supervisor); the 16 KB
  "OK. Let me call write." repetition that forced `reset`; agent-fleet's drift
  watchdog (`#63`).
- **Change:** deterministic-first in-flight observation that can terminate as
  `drift_stop`.
- **Why it helps:** removes the human "stop it" reflex.
- **Risk/effort:** M; safety-relevant (must not kill healthy runs).
- **Surfaced by:** `step-repetition` measure.

### SA-4 — Proportionality should latch per task, not reset per message
- **Trigger:** a small correction re-opens a large workspace / budget.
- **Evidence:** agent-fleet's post-mortem (a 13-minute change open 47 hours);
  their ratcheting tier (`#60`); durig's PM `S/M/L` is turn-scoped.
- **Change:** the PM task tier survives the next message; raising it needs a reason.
- **Why it helps:** spend tracks the task, not the last message.
- **Risk/effort:** S (protocol).
- **Surfaced by:** budget/metrics outliers.

### SA-5 — Upgrades must not silently change behaviour
- **Trigger:** `up --refresh` or a platform bump changes defaults underneath a rig.
- **Evidence:** agent-fleet records a feature snapshot and never auto-enables new
  features on update; durig re-applies whatever the file says (`BORROW-FROM-agent-fleet.md`).
- **Change:** record and preserve the effective feature set; make enabling new
  defaults an explicit act.
- **Why it helps:** protects operator intent across upgrades.
- **Risk/effort:** S.
- **Surfaced by:** a rig that "changed by itself" after an update.

### SA-6 — Prompt drift: re-check always-on instructions against current intent
- **Trigger:** a seat follows an instruction the operator no longer wants, or
  misses one added later; the constitution/primer drifts from intent.
- **Evidence:** the constitution is injected into **every** seat's prompt and read
  **per request** (`FEATURES.md` §1), so a stale line is enforced everywhere; the
  project has already changed seats/models/pins several times this cycle
  (`DECISIONS.md` pin moves; `rig.selfdev.json`).
- **Change:** a periodic (self-admin or PM) review that diffs the always-on prompt
  text (constitution + primer + seat instructions) against the CURRENT intent and
  proposes edits, each with the run that exposed the drift.
- **Why it helps:** the prompt is the highest-leverage, least-visible surface.
- **Risk/effort:** S; it is a review practice plus a register entry.
- **Surfaced by:** a user correcting a seat for following an outdated rule.

### SA-7 — Common defaults should be pre-set, not discovered
- **Trigger:** the operator must know the architecture to set a sensible value.
- **Evidence:** `DURIG_MAX_CONCURRENT_SEATS`, `DURIG_STREAM_TIMEOUT_MS`,
  per-seat models, `DURIG_SEAT_ROOT` all require knowing *why* they exist;
  agent-fleet ships `--preset default` + a `doctor` (`BORROW-FROM-agent-fleet.md`).
- **Change:** ship a validated starter preset and a repair path, so a new rig is
  correct before the operator learns any of it.
- **Why it helps:** the "distro with drivers" goal directly.
- **Risk/effort:** M.
- **Surfaced by:** `check` findings on a new rig.

### SA-8 — Personas × skills × commands should compose predictably
- **Trigger:** a seat's behaviour is defined ad hoc in one instruction blob.
- **Evidence:** agent-fleet names the *how* (skill) / *who* (persona) / *when*
  (command) layering; durig folds them into the seat's inline `instructions`.
- **Change:** a small skill/reference layer for durig's own seats, plus the named
  layering, so a reference checklist (`definition-of-done`, `testing-patterns`)
  is available without bloating every prompt.
- **Why it helps:** polished, reusable guidance without prompt bloat.
- **Risk/effort:** M.
- **Surfaced by:** inconsistent seat output on the same kind of task.

---

## How this gets implemented (not by hand forever)
The register is useful **only if it is consulted**. The product work is:
1. a self-admin **seat/role** whose remit is this file (and the topology change
   that adds it — see the self-dev rig roles);
2. `check`/`doctor` **pointing at** the matching entry when a finding fires, so it
   is not in-your-face but is discoverable;
3. the **compound-learning** habit: after a session that revealed a platform gap,
   add a grounded entry rather than a private TODO (agent-fleet's `/af-compound`).
