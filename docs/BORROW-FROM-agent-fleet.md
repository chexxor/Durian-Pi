# What to borrow from agent-fleet — inventory → filter

**Date:** 2026-10-12 · **Source read:** `../vendor/eval/agent-fleet` HEAD `7c34dde`
(MIT, `@chankov/agent-fleet@2.0.17`). Companion to
`ARCH-COMPARISON-agent-fleet.md` (layer map + adopt-or-build) and
`COMPETITORS.md` (the maintained comparator list).

This is the **filtered** list: an inventory of what agent-fleet has, then an
explicit keep/drop decision per item, so nothing is borrowed by accident and
nothing useful is dropped by accident.

## Legend
**borrow** — do it, it fits durig · **adapt** — take the idea, change the shape ·
**defer** — real but not now · **drop** — deliberately not for durig (with a reason).

## The inventory and the filter

| agent-fleet feature | What it is | durig today | Decision |
|---|---|---|---|
| **30 skills** (SDLC) + **11 reference checklists** (`definition-of-done`, `testing-patterns`, `prompting-patterns`, …) | Pre-written, auto-triggered procedures with exit criteria | seats get inline `instructions` + a 6-tool protocol; no skill library | **adapt** — a *small* skill/reference layer for durig's own seats; not 30 SDLC skills (our domain differs) |
| **15 personas** | Reusable role definitions, each hooked to a skill | durig seats have inline roles; no reusable persona library | **adapt** — personas for the self-dev rig (see the topology work) |
| **Skill × persona × command layering** ("the *how* / the *who* / the *when*") | A stated composition model | implicit in durig's router + PM | **borrow** — name it, so seats and skills compose predictably |
| **`setup`/`doctor`/`uninstall`** with `--preset default/full`, platform-gated features, a dry-run plan, and reconciliation | Deterministic lifecycle; a bare workspace still comes configured | `up` + `check`; no repair, no presets | **borrow** — a `doctor --fix`-style repair path and a starter preset are core to the "polished distro" goal |
| **Default-preserving upgrades** (new features never auto-enable; recorded feature snapshot) | An upgrade cannot silently change behaviour | `up --refresh` re-applies what the file says | **borrow** — cheap, and it protects operator intent |
| **Verification Contract** (`runtime-result/v1`: orthogonal execution/changes/verification/acceptance, bound to revision/command/exit/evidence) | A completion cannot be read as a pass | prose completion + qa re-run | **borrow** — structured result on `complete_work` |
| **Drift watchdog** (deterministic rules → one cheap judge → terminal `drift_stop`) | Automatic runaway detection | ROADMAP 42/43, unbuilt | **borrow** — feeds 42/43 |
| **Context-pressure guard** (80% warn / 90% abort pre-model / wait for settle / one compaction) + **session recycle** (≥60% or N runs) + **`/af-context`** budget diagnostic | Automatic context management, default on | ROADMAP 27/28, unbuilt; a seat must be reset by hand | **borrow** — highest-value "hands-off" gap |
| **Compound learning** (`/af-compound`: every session improves the next) | Lessons feed back into the setup | none | **borrow** — this *is* the self-admin improvement register (`SELF-ADMIN.md`) |
| **Index-first rule discovery** (project rules/docs pointers rendered into the prompt, folders resolved index-first) | Context assembled cheaply and predictably | seats get a static primer | **adapt** — a rules index for durig seats |
| **Bounded output** (500 entries / 64 KiB / 180-char previews, truncation names a retained path) | Default guard on context growth | thin-context return contract now (#59) | **borrow** — the concrete bounds, once #59 lands |
| **Damage-control approvals** + **write-isolation sandbox** (bubblewrap/Seatbelt) | OS-level confinement | per-conversation cwd + tool capability scoping | **drop (for now)** — no Windows backend; durig's cwd/tool scoping is the Windows answer, revisit only if a Windows sandbox appears |
| **Tool-catalog deltas** (`tool-catalog-delta/v1`, per-turn effective tools, refusal counter) | The model is told what tools it actually has, and enforcement is code-owned | capability scoping is per conversation | **adapt** — worth a smaller "effective tools" statement in the seat prompt |
| **Single-flight recovery — no automatic retry** | Conservative retry policy with explicit human-authorised retry | durig has `resume` + stalled-claim re-wake (optimistic) | **defer** — a policy comparison, not a defect; keep our behaviour but record the tension |
| **Deterministic flows** (`just flow`: phase order, retries, gates, branch) | Code-owned multi-phase pipeline | PM decomposes; no flow engine | **defer** — overlaps the PM protocol; revisit if the tier/item model proves insufficient |
| **Task-tier budgets** (trivial/small/feature/project; ratcheted; reason to raise) | Proportionality encoded in code | PM `S/M/L` timebox, turn-scoped | **borrow** — registered as `#60` |
| **Thin-context dispatcher** (research → disk; resume with paths, not bodies) | Bounded coordinator context | registered `#59` | **borrow** — routed (rank 1) |
| **Independent runtime axes** (work mode × roster × peer topology) | Three live-switchable knobs | one seat spec | **defer** — registered `#64`, lead ruled |
| **Peer/`coms`/`herdr` panes**, Desktop panel, phone relay, Claude Code bridge | Multi-surface, cross-process fleet | durig is deliberately one process + a durable queue | **drop** — this is the OpenRig pane-per-agent model we rejected; the durable queue is our answer |
| **`npx` install + `doctor` preflight + provenance footer** | Batteries-included install & honesty | `up` from a rig file | **adapt** — a durig `doctor`/provenance path serves the same goal without npm |

## The filtered borrow list (what to actually take, in priority order)

1. **Automatic context management** — pressure guard + recycle + a budget diagnostic. Biggest hands-off gap; the operator currently resets seats by hand.
2. **The self-admin improvement register** — `docs/SELF-ADMIN.md`; agent-fleet's compound-learning idea, reframed as a grounded, non-intrusive resource (`COMPETITORS.md`/`SELF-ADMIN.md`).
3. **Verification Contract result shape** — `#61`.
4. **Drift watchdog** — feeds ROADMAP 42/43 (`#63`).
5. **Ratcheting task tier** — `#60`.
6. **Thin-context return + bounded output** — `#59` (routed), then the concrete bounds.
7. **Personas × skills × commands layering + a small skill/reference layer** — the "polished distro" surface for our own seats.
8. **`doctor`-style repair + default-preserving upgrades + provenance** — the batteries-included lifecycle.
9. **Index-first rule discovery + effective-tools statement** — cheap context quality.

## Deliberately dropped (recorded so it is not re-proposed)

The peer/`coms`/`herdr` pane model and its surfaces (Desktop panel, phone relay,
Claude Code bridge, ChatGPT session client): they are the per-agent-pane model we
left OpenRig over. durig's durable cross-seat queue is the substitute. Revisit only
if a concrete need lands that the queue cannot serve.
