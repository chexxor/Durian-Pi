# Comparators we can learn from

Other multi-agent / durable-agent systems whose **design and architecture**
decisions are worth reading, with the concrete mechanism and where it lives.
This is a maintained list, not a feature-page summary: a claim here cites a file
in that project's own tree.

The deep feature matrix over our substrate candidates (OpenRig, agent-fleet +
pi-durable, tuios, hermes-agent) lives in the project workspace,
`docs/ORCHESTRATION-COMPARISON.md`; this file records the *reusable lessons*.

**How to add an entry.** Clone the project read-only under
`../vendor/eval/<name>/` (the project already keeps comparators there), pin the
commit you read, and cite a path per claim. One row per decision, with the durig
counterpart it should change or inform.

---

## agent-fleet — `chankov/agent-fleet`

- **Repo:** https://github.com/chankov/agent-fleet
- **Read at:** clone `../vendor/eval/agent-fleet`, HEAD `7c34dde`
- **What it is:** pi-first multi-agent fleet — a thin dispatcher over specialist
  personas, an on-disk **Verification Contract**, and a documented engineering
  methodology (`docs/PHILOSOPHY.md`). It is the *source* of the **AF+PD** column
  in `docs/ORCHESTRATION-COMPARISON.md` (AF over pi-durable); the integration is
  assembly we would own, not an existing stack.

| What it does | Why it is worth learning from | durig counterpart |
|---|---|---|
| **Thin-context dispatcher** — research/subagent output goes to disk; the hub resumes a specialist with *paths, not bodies* | The coordinator's context window is the scarce resource; keeping dumps out is what lets one hub run a whole fleet | durig seats already write to disk, but our tool results still return bodies; the lesson is the *return* contract |
| **Proportionality as a ratcheting task tier** — `trivial/small/feature/project` **is** the budget; it survives the next user message; raising it needs a stated `reason` | A turn-scoped size that resets on every correction is how their post-mortem saw a 13-minute change stay open 47 hours | durig's PM `S/M/L` timebox is turn-scoped; the lesson is to **latch** the tier per task |
| **Verification Contract on disk** — `agent-fleet.runtime-result/v1` with orthogonal `execution / changes / verification / acceptance`, bound to task, revision, command, integer exit status and evidence | Separates "changed but unverified" from "failed", so a claim cannot be read as a pass | durig's pair review + qa re-run is behavioural; the lesson is a **structured result shape** |
| **Drift watchdog** — in-flight observation of the JSON event stream; deterministic rules (out-of-scope writes, tool-call loops, consecutive failures) escalate to one cheap LLM judge that can terminate a run as `drift_stop` | Our ROADMAP 43 (degenerate loop) and 42 (supervisor) are exactly this; theirs is **deterministic-first, model-second** | ROADMAP 42/43 — read this before designing the supervisor |
| **Context-pressure guard with ordering** — warn at 80%, abort the pre-model continuation at 90%, **wait for `agent_settled`**, then one compaction | Compacting before the result is persisted loses it; the *ordering* is the invariant, not the threshold | ROADMAP 27/28 (context visibility / reduction) |
| **No automatic retry (single-flight recovery)** — a hard rule; retries are explicit and human-authorized | The conservative pole opposite durig's `resume` / stalled-claim re-wake; worth weighing rather than assuming | durig `resume` + the stalled-claim re-wake |
| **Independent axes** — work mode (`operator`/`orchestrator`) × native roster × peer topology, switched live, no implicit coupling | Three orthogonal knobs, each with its own switch | durig folds all of these into one seat spec |
| **External-blocker stop** — a specialist emits `EXTERNAL_BLOCKED: …` and the hub refuses the next dispatch until a human is addressed, instead of approximating the missing fact | Names "I need something outside my reach" as a gated stop rather than hours of scripts and fixtures | durig's `defer_work` (ROADMAP 5, done) — the closest existing match |

**Where each claim lives** (agent-fleet's own tree): `docs/ARCHITECTURE.md`
("Fleet hierarchy", "Task-tier budgets", "Runtime acceptance and recovery",
"Drift watchdog", "Context pressure and recovery", "One Hub runtime, independent
axes") and `docs/PHILOSOPHY.md` ("Deterministic process, room for judgment",
"Proportionality is part of the methodology").

**What it does not give us:** it is pi-coding-agent-side (harnesses/extensions),
not a durable-queue substrate, so the AF+PD integration is work we would own; and
its Windows posture is unverified (`docs/ORCHESTRATION-COMPARISON.md` footnote [2]).
