Can you analyze my recent chat with my assistant/agent to help figure out how other systems that run local LLM agents for ongoing workloads get up to speed faster and more efficiently when re-entering a project?


## What your transcript actually shows

The transcript is a post-mortem your agent wrote after sitting in the operator's seat for the first time. Stripped down, the failure mode is this: **the information wasn't missing, it was scattered across three places that don't cross-reference — the roadmap, the selfdev queue in SQLite, and session memory — and nothing named the seat or its entry point.** Concretely, your agent burned ~20+ discovery calls on:

- **No entry point.** `rig whoami` failed (not in an OpenRig session), with no fallback pointing at the `durig` CLI. The `durig` skill existed but only described driving *a* rig generically — not which DB, which worktree, or how to find "next."
- **Two sources of truth for priority that disagreed.** `ROADMAP.md` says it's "ordered by operator value," but the live next step only existed inside queue item #110's subject line in `selfdev.sqlite`. The roadmap's liveness section lists P1–P6 with no "next" pointer.
- **Current state only in the DB.** Claimed vs. queued items, attention notices, seat root, DB path — all needed direct SQLite/CLI probing. `STATUS.md` was stale and said nothing about selfdev.
- **Implicit DB/worktree coupling.** Seats resolve to the run command's cwd when no cwd is persisted (their finding F12), so the store lives in the main checkout while seats operate in a worktree. No single sentence stated that.

That is a textbook **cold-start / re-entry** problem, and it's the same one every long-running-agent harness has been converging on a solution for.

---

## The pattern other systems converged on

Across Anthropic's harness work, the "Ralph loop," Claude Code, Cursor, OpenHands, and the memory frameworks, the same five ideas keep reappearing. The governing principle: **the agent is amnesiac, but the filesystem isn't** [^1].

| Layer | What it is | Who does it | Key detail |
|---|---|---|---|
| **Always-on entry context** | A single file loaded at the top of every session | `AGENTS.md` (open standard, read by Codex, Cursor, Copilot, Devin, Zed), `CLAUDE.md`, Cursor Rules [^10][^8][^11] | "A README for agents" — the predictable place for build steps, conventions, and gotchas that would clutter a human README [^8] |
| **On-demand skills** | Capabilities loaded *only when relevant* | `SKILL.md` (agentskills.io), Cursor Skills, OpenHands microagents [^6][^7][^9] | Progressive disclosure keeps the context window clean; body doesn't sit in context until needed [^6][^7] |
| **State files outside the window** | Progress log + plan + rulebook on disk | `prd.json` (plan), `progress.txt` (lab notes), `AGENTS.md` (rolling rulebook) in the Ralph loop [^1] | Each iteration starts fresh and reads *enough* state from disk to keep going [^1] |
| **Decision log** | Records *why*, not just *what* | `DECISIONS.md` pattern [^2] | Compaction loses the "why" — why B was chosen over A. A decision log preserves it [^2] |
| **Handoff artifact** | A compressed, purpose-built snapshot | `HANDOFF.md` (~1k tokens vs. 50k+ of re-reads), Anthropic "handoff files," `claude-progress.txt` [^4][^2] | Full context in ~1k tokens; auto-regenerated as you work [^4] |
| **Session-as-event-log** | Append-only record of every thought/tool call/observation | Anthropic Managed Agents ("Session"), Devin's event log [^1] | "What makes a long-running agent recoverable" — memory becomes a queryable artifact outside the running process [^1] |

Two more pieces that matter for your case:

**Clock-in / clock-out routines.** The recommended fix is to put the session-start and session-end ritual *into the always-on context file*: at start, read the progress file, read the decision log, run a check, resume from "Next Steps"; at end, update the progress file, run the check, commit [^2]. This is exactly the "how do I re-enter" instruction your agent lacked.

**Handoff timing and the rebuild-cost metric.** Teams hand off *before* the window fills, not at the limit [^3][^3], and the success metric is **rebuild cost** — time for a fresh session to reach an executable state. A good harness compresses that from ~15 minutes to ~3 [^2]. Decision rule: if a task needs more than ~60% of the window, start preparing the handoff [^2]. Anthropic's very-long-job approach uses **full context resets rebuilt from a structured handoff file** — explicitly "how humans onboard a new engineer" [^1].

**On the memory-layer question:** you don't necessarily need a vector DB. Letta's own benchmarking found a plain **filesystem** is competitive with purpose-built memory systems for many agent tasks [^12], and the whole Ralph-loop family is files + a loop. Where the dedicated layers differ: Mem0 extracts facts into a vector store, Letta exposes MemGPT-style editable "memory blocks," Zep uses a temporal knowledge graph [^5]. Given durig is already SQLite + files, the gap isn't a memory engine — it's a **read/index layer over what you already have.**

---

## What this says about durig specifically

Your agent's own four proposals line up almost exactly with the industry pattern — which is a good sign it diagnosed correctly. Mapping them:

| Your agent's proposal | Industry pattern it implements | Verdict |
|---|---|---|
| `durig/docs/SELFDEV.md` runbook | Always-on entry context (AGENTS.md role) + clock-in routine | **Highest leverage.** This is the missing "START HERE." |
| `durig/docs/NEXT.md` one-screen handoff | Handoff artifact (HANDOFF.md / handoff file) | **Do it.** Keep `STATUS.md` as history; `NEXT.md` as the pointer. |
| `cli.mjs next` read-only digest | Session-as-event-log read side | **Do it second** — makes NEXT.md mechanical, not hand-maintained. |
| Point skills at the runbook | Progressive disclosure / entry-point naming | **Cheap, do it.** The skill existed but didn't cover selfdev — fix both. |

I'd add three things from the research your agent didn't propose, all cheap:

1. **A `DECISIONS.md`-style "why" log.** Your agent noted finding F12 (seats root to the run command's cwd) as a *prior finding* — that's a decision log already, but it's not pointed at from the entry doc. The single most common thing lost across sessions is the *why* behind a settled choice [^2]. Your #110 "do P5 first, supersedes #105" is exactly that kind of decision, and it's buried in a queue subject line.

2. **Write the "done-condition" down before work starts.** The highest-leverage move for long runs is an external file with explicit, testable completion criteria, so the agent can't quietly redefine *done* mid-run [^1]. Your roadmap's "ordered by operator value" is not a done-condition — that ambiguity is *why* priority drifted into the queue.

3. **Make the clock-in/clock-out ritual part of `AGENTS.md`.** Not just "read NEXT.md" — an explicit numbered routine at session start (read runbook → read NEXT.md → read decisions → check repo state → resume) and at session end (update NEXT.md → commit) [^2]. That converts a discoverability problem into a deterministic habit.

**One caution — don't overbuild.** Your agent's instinct to do the docs first (1+2) before the code (3) is right, and matches the "state lives outside the window" principle [^1]. A 1,383-line roadmap is not the problem; using it as the *entry point* is. Apply progressive disclosure: one screen that points, with the big docs as reference behind it [^6]. And note the `cli.mjs next` verb should sit on the shared-read-API seam (your ROADMAP item 8) rather than becoming a bespoke query — otherwise you've added a fourth place state can disagree.

Finally, the honest caveat your agent already flagged: part of the friction was **not loading the `durig` skill that existed.** No amount of new docs fixes an agent that doesn't read the entry point — which is why the entry point has to be *unmissable* (named in `AGENTS.md`, first line of the skill) and why the deterministic hook/clock-in approach beats relying on the agent to remember to look [^3].

**References**

[^1]: [Long-running Agents](https://addyo.substack.com/p/long-running-agents) (41%)
[^2]: [Lecture 05. Keeping Context Alive Across Sessions | Learn Harness Engineering](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-05-why-long-running-tasks-lose-continuity/) (27%)
[^3]: [How Context Works for Long-Running Agents: From Cold Start to Resume](https://www.linuxfoundation.org/webinars/how-context-works-for-long-running-agents-from-cold-start-to-resume) (9%)
[^4]: [I built a tool: Handoff - switch AI agents mid-project without burning tokens on redundant file reads](https://www.reddit.com/r/ClaudeCode/comments/1sd5ubf/i_built_a_tool_handoff_switch_ai_agents/) (5%)
[^5]: [Mem0 vs Letta vs Zep: Agent Memory 2026 | AI Workflow Lab](https://aiworkflowlab.dev/article/agent-memory-mem0-vs-letta-vs-zep-2026) (5%)
[^6]: [Onboarding the agent — AI Engineering for Web Developers](https://tpiros.dev/ai-engineering-for-web-developers/onboarding-the-agent/) (3%)
[^7]: [Best practices for coding with agents · Cursor](https://cursor.com/blog/agent-best-practices) (3%)
[^8]: [AGENTS.md](https://agents.md/) (2%)
[^9]: [Microagents Overview - All Hands Docs](https://docs.all-hands.dev/usage/prompting/microagents-overview) (2%)
[^10]: [AGENTS.md — a simple, open format for guiding coding ...](https://github.com/agentsmd/agents.md) (1%)
[^11]: [Rules | Cursor Docs](https://cursor.com/docs/rules) (1%)
[^12]: [Benchmarking AI Agent Memory: Is a Filesystem All You ...](https://www.letta.com/blog/benchmarking-ai-agent-memory/) (1%)