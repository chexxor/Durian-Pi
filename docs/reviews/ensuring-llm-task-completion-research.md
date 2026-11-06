I'll ground this in current practice on context engineering and agent handoffs, then give you a concrete design.## The core reframe

You can't get this from a prompt. An agent at 90% of its window is the worst possible judge of how much room it has left — it's exactly the condition where recall degrades and instruction-following drifts [^1]. So the guarantee has to come from **the harness outside the model**, and it has to be structured so that "end cleanly" is the *default* rather than a heroic act performed at the last minute.

There are two facts that dictate the whole design:

1. **Every turn re-sends the entire context.** A 20k-token file read at 60k tokens doesn't cost 20k — it raises the floor for every remaining turn, and it crowds out attention on all of them. Context is a finite resource with diminishing marginal returns, not just a size limit [^1].
2. **Compaction is lossy in a specific way.** In Anthropic's own worked example, a compaction summary preserved 3/3 high-level facts but 0/3 obscure specifics — appendix-table values, exact statistics, precise identifiers [^2]. Anything you need *verbatim* must live in a file, not in the transcript.

So: **the handoff document must never be something the agent writes from memory at the end. It must be a continuously-maintained artifact whose final version is a render, not a recollection.**

---

## 1. Split 130k into four budgets, not one

Measure the floor first: one API call with an empty message list tells you what your system prompt + tool schemas already consume (often 5–15k). Everything below is relative to the remainder.

| Band | Approx. tokens | Controller-enforced behavior |
|---|---|---|
| **Working** | 0 – 60k | Full autonomy. Normal tool use. |
| **Economy** | 60 – 80k | Clear tool results older than 3 calls; no whole-file reads, only `grep`/`head`/ranged reads; route exploration to subagents. |
| **Checkpoint** | 80 – 95k | Force a `NEXT_SESSION.md` rewrite. **No new work items may be started.** Only finish what's in flight. |
| **Wrap-up** | 95 – 110k | Only write/edit tools permitted. Finalize the doc, run verification, stop. |
| **Emergency** | 110 – 130k | One shot, no tools: emit the doc from the state file alone and exit non-zero. |

Two rules that matter more than the exact numbers:

- **Disable auto-compaction above the checkpoint threshold.** Otherwise it fires *during* wrap-up and eats the reserve you set aside for it — a genuinely common and very annoying failure.
- **Reserve for verification, not just writing.** The last phase must have enough room to re-read its own claims and check them, or you get confident, unverified "done" labels.

And in `tools` design: cap every tool result server-side (truncate to N tokens with an "use ranged read for more" hint). Token-efficient tools are a context-engineering lever in their own right [^1].

---

## 2. Write-ahead handoff: the doc is always valid

This is the single highest-leverage pattern. Don't write the handoff at the end — **write it before each work item, and update it after.**

```
Before item N:  doc says "IN PROGRESS: item N — approach X, expected artifact path Y"
After item N:   doc says "DONE: item N — artifact Y verified by check Z"  + next item queued
```

Consequences:

- If the process is killed at any instant, the doc on disk is at most **one item stale**, and it's stale in the *safe* direction (it points at work that may not have finished, rather than claiming work finished that didn't happen).
- The "end by creating a next-session doc" requirement dissolves — there's nothing left to create. The final action is a normal doc update plus a `status: complete` flag.
- **Idempotency becomes mandatory**, because a successor may find a half-applied item. Make mutations atomic: write to temp + rename, one commit-sized unit per item, and have the doc state the exact postcondition to check (`"if src/auth.py contains function X, item 4 is done — don't redo it"`).

Keep three artifacts, all on disk:

| Artifact | Purpose | Update rule |
|---|---|---|
| `state.json` | Machine-readable ledger: items with status, artifact paths, decisions, open questions, blockers | Written by a `checkpoint()` tool call, validated by the controller |
| `NEXT_SESSION.md` | The brief a fresh session reads first | Rendered from `state.json`, overwritten every checkpoint |
| `PROGRESS.log` | Append-only chronology, cheap and lossless | One line per action; used to recover when the doc and reality disagree |

Have the controller **reject** a `checkpoint(status="done")` that lacks an artifact path that actually exists on disk. This is what converts "the model says it's done" into "the filesystem says it's done."

---

## 3. Make "finish all its work" a planning problem, not a stamina problem

At turn 1–2, before doing anything, force a cost estimate:

> Enumerate the work items. For each, estimate tokens (including tool output). Sum them. If the total exceeds **70% of the working budget**, do not start — emit a scoped plan plus `NEXT_SESSION.md` and stop. That is a clean finish.

This front-loading is the only reliable way to "finish everything," because no amount of careful rationing rescues a plan that was never going to fit. It also gives you a natural granularity: one item = one checkpoint = one resumable unit.

For exploration-heavy items, use subagents: they can burn tens of thousands of tokens in their own window and return a 1–2k-token digest [^1]. The lead agent's context stays flat while the work gets wide.

---

## 4. The handoff document itself

Structure matters more than prose quality. The test is: **a fresh session with only this file and the repo must be able to state and execute the next action without asking a single question.**

```markdown
# NEXT SESSION BRIEF — <project> — <timestamp>
STATUS: in_progress | blocked | complete
SESSION: 4 of ?   |  Stopped because: context budget (checkpoint band)

## Objective (verbatim, do not paraphrase)
<the original task, quoted>

## State of the world right now
- Done and verified: [item, artifact path, how it was verified]
- Done but UNVERIFIED: [item, artifact path, what check is still owed]
- In progress when I stopped: [item, approach, exact file/line, was it left consistent?]
- Not started: [ordered list]

## Next action (be literal)
1. `read src/parser.py lines 120-190`
2. Change `parse_header()` to return dict not tuple
3. Run `pytest tests/test_parser.py -k header` — expect 4 passed

## Decisions already made (do not relitigate)
- Chose X over Y because Z. Path: docs/adr-003.md

## Dead ends — do not repeat
- Tried approach A; fails because <specific reason>. Cost me ~8k tokens.

## Open questions / risks
- Unknown: does the upstream API rate-limit? Unverified.
- Fragile: migration 004 is half-applied in staging. Check before touching.

## Environment
- Branch, uncommitted files, running processes, credentials location, commands that work
```

Two things people omit and shouldn't: **dead ends** (the most expensive thing a successor can do is rediscover your failures) and **"fragile / known-broken"** state. And write in absolute terms — no "the file we discussed," no pronouns pointing into a dead transcript.

---

## 5. How to *verify* the guarantee instead of hoping

Session handoffs are more effective when proactive (threshold-triggered) than reactive (symptom-triggered) [^3], and the failure mode of a badly-built one is a summary that omits a key constraint — a structured state object reduces that risk substantially [^3]. So test for it:

- **Resume test, in CI.** Spawn a fresh agent with *only* `NEXT_SESSION.md` and the repo. Ask it for its next three tool calls. Compare against the expected ones. If it asks a clarifying question, the doc is incomplete — that's a failing test, not a model problem.
- **Kill test.** Terminate the process at a random point in a long run, then resume. You should lose at most one work item, and no work should be silently duplicated.
- **Kill at 3 points:** mid-tool-call, right after a mutation but before checkpoint, and mid-compaction. Those are where the seams show.
- **Log context size per turn** and chart it. A healthy trajectory is sawtooth (clearing/compaction) that stays under the checkpoint band; a straight ramp means your triggers aren't firing.

---

## The short version

1. Treat 130k as four bands with a hard wrap-up reserve, enforced by the controller using API `usage`, not by the model's self-assessment.
2. Write the handoff doc **before** each work item (write-ahead), so it's always valid; the last update is a flag flip.
3. Keep state in `state.json` and render the doc from it — never summarize from memory.
4. Cap tool output, clear old results, delegate exploration to subagents so the floor stays low [^1] [^2].
5. Estimate total cost at turn 1 and refuse to start work that doesn't fit — "stop with a plan" is a legitimate clean finish.
6. Prove it with a resume test that only has the doc.

The mental model: you're not asking the agent to be disciplined near the edge. You're making the artifact exist continuously, so that whenever the edge arrives — planned or not — cleanup is already done.

**References**

[^1]: [Effective context engineering for AI agents \ Anthropic](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) (33%)
[^2]: [Context engineering: memory, compaction, and tool clearing | Claude Cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) (33%)
[^3]: [Context Rot in AI Agents: What It Is and How to Fix It with Session Handoffs | MindStudio](https://www.mindstudio.ai/blog/context-rot-ai-agents-session-handoff-fix) (33%)