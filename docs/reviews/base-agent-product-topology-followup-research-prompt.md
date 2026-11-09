# Research request 2 — base-agent product topology: the gaps Round 1 could not reach

Issued by the delegate for the operator on 2026-11-06. This prompt is the **Round 2** named in
`docs/reviews/base-agent-product-topology-research-prompt.md` §"Follow-up", and its destination is the path that section
fixed: a new file at **`docs/reviews/base-agent-product-topology-followup-research.md`**, with decisions propagated into
`docs/MVP.md`, `docs/COMPETITORS.md` and a `docs/DECISIONS.md` addendum to D212 — not into the study files.

**Do not redo Round 1.** Round 1 (`docs/reviews/base-agent-product-topology-research.md`, fetched 2026-11-06) established,
with observed-in-source evidence: no shipped product keeps a durable store per agent; isolation is filesystem-level; the
process split is by tier (one supervisor for an interactive team, one VM per task when unattended); crash recovery is
per-agent durable state plus a restartable supervisor, and Claude Code's in-process teammates do not survive `/resume`
(§4); team capabilities ship in-product behind flags/tiers with reusable roles on the extension plane (§5); the
extension-context cost is mitigated by install-time context bloat, not runtime routing (§7); and a WITH/WITHOUT ablation is
how the vendor literature attributes capability to a component (§6). Build on those; cite their section numbers.

## What the delegate verified in-repo, so Round 2 does not restate it

Measured on `Linux Fedora 45`, kernel `7.2.15-300.fc45.x86_64`, node `v24.22.1`, git 2.56.0, 2026-11-06. Four citations in
Round 1 need correcting before they are relied on (the project rule is that a `path:line` must be `test -e`-checked —
D159 addendum, D211 CORRECTION):

- `src/queuesync.mjs` **does not exist** (§5's "`queuesync` seam"). The seams that do exist are `src/queue-lifecycle.mjs`,
  `src/broker.mjs`, `src/queuesync`-equivalent routing inside `src/broker.mjs`.
- `docs/extensions.mjs` **does not exist**. The rule Round 1 quotes lives in `docs/DECISIONS.md` D212 and in the
  `src/extensions.mjs` header; the seat-tool surface is documented in `docs/SEAT-TOOLS.md`.
- The env keys are `DURIG_MAX_CONCURRENT_SEATS` and `DURIG_EXTENSIONS` (`src/config.mjs:115`, `:117`), not
  `DURIAN_PI_MAX_CONCURRENT_SEATS` / `DURIAN_PI_EXTENSIONS`. The rename is half-applied and points both ways (ROADMAP 191,
  D103): `src/config.mjs` reads only `DURIG_*` for these.
- "`5` of `59` register `defineExtension`" — the file count is right (`ls src/*.mjs | wc -l` = 59); the registering count
  is **4** (`grep -l defineExtension src/*.mjs`). ROADMAP 18 exists (line 772, "an extension registry with named profiles —
  not two editions") and ROADMAP 2802 calls it "per-seat tool scoping".

**Round 2 must cite paths it has actually read, and state the class of each claim** (the Round 1 discipline worked; keep it).

## Question 10 — the idle/attention policy of a supervisor-driven team (highest priority)

Round 1 §3 found how supervisors start and stop agents but **nothing about what they do when there is no work**. This rig
just measured the cost of not having that policy: on an empty queue, `tools/broker-serve.mjs` woke every seat every ~2 s
for 30 minutes — **1,245 passes, 1,394 guard escalations, ~1,400 context resets, 249 paid calls / $0.086**, and the resets
erased the operator's own ruling that had just been spooled to `lead` (ROADMAP 300). A separate defect: a broker past its
`--max-duration` **lingers with a live heartbeat and a frozen `lastPassAt`** and every read routed through it times out,
while a direct read of the same store answers in 111 ms — the rig looks broken while it is healthy (ROADMAP 303).

Find, with sources:
- any shipped multi-agent coding product that **quiesces** — parks sessions, applies backoff, or skips wake when a queue is
  empty — and what its published policy is (interval, backoff ceiling, what it does to context);
- any published **idle-cost** figure for agent teams: heartbeats, cron-driven agents, "agent that checks every N minutes"
  cost pages, budget/cap mechanisms, or incidents of runaway loops (the Devin "AI tokens" budget model, Cursor's spend
  controls, GitHub's metering pages, Cognition's "Don't Build Multi-Agents" thread are the classes to search);
- how shipped systems distinguish **idle** from **wedged** in a supervisor, and what their operators are told to do
  (the discriminator matters more here than the fix).

**Acceptance:** a policy a `lead` could copy in one row — a backoff schedule with numbers, and a definition of what a
woken seat with nothing claimable should do (exit? park? hold context?).

## Question 11 — does anyone re-validate a worker's model pointer at wake, and what breaks when it goes stale?

Round 1 §3 quotes the OpenHands README on "conversation state persistence and recovery" but did not answer whether shipped
systems **re-check that a worker's configured model/endpoint still exists** when resuming. This rig lost **16,166
generations (25.1% of all)** and **65.9 h** of busy time to `Model <X> is not available` because per-conversation model
references in the store stayed pinned to models that had been renamed or retired while every check stayed green — the
signal was only `no_model` inside a task record, and the fix verb (`up --refresh`) costs a context reset per seat
(ROADMAP 299).

Find: how shipped agent products handle **model retirement/aliasing** for long-lived sessions and queued work — forced
migration, alias tables, refuse-with-reason at resume, or silent substitution — and any published incident where a
retirement broke queued or resumable work. State which of those four each product chose, with the source.

## Question 12 — the counterexample search Round 1 flagged as unexecuted

Round 1 §2 caveat: it **did not run the full counterexample search** for a product that really does keep a per-agent store.
Run it properly, and separately: the vendors it named as unreachable from the sandbox — **Devin, Cursor background agents,
Google Jules, Block Goose recipes, Gemini CLI's extension mechanism**. For each: does it exist, is it in-product or an
extension, and does it keep per-agent or per-team durable state? If a vendor's docs are unreachable, say so per vendor
rather than leaving the gap in one aggregate sentence.

## Question 13 — verifier-family economics and latency in the literature (bounded)

This rig restored its verifier to a metered arm and hit a decision with no outside data: at the vendor's full context
(131,072) **one maximal verifier call would cost $4.85**, over the `$4.00` store cap, so the arm is currently running at an
inherited `24,576 / 3,000` slot that has never been measured, and a reasoning model returned `finish_reason: "length"`
with **empty content** at `max_tokens: 24` (ROADMAP 297). Find any published figure for **reviewer/critic model choice**:
what frontier products use for a reviewing or gating agent, what it costs, what reasoning budget they publish, and whether
anyone publishes **verification latency** as distinct from generation latency. If the literature is silent, **say it is
silent** — that is a usable answer and it tells the team to measure rather than seek.

## Cost and bounds (same discipline as Round 1)

- State the wall-clock spent and the number of sources fetched; stop when a question returns **no new source for three
  consecutive attempts** and record the attempts and the negative result.
- **Do not read the local `docs/` tree** (the research lane cannot see it): the required reads are
  `docs/MVP.md` ("Explicitly out of MVP scope"), `docs/COMPETITORS.md`, `docs/DECISIONS.md` D212, and the Round 1 study.
  The delegate will diff your findings against those three files on this side — that is cheaper than paying you to do it.
- Evidence classes stay as Round 1 defined them: `observed-in-source` vs `advertised-elsewhere`.
- **Name the product and version** in every claim. This rig's cost of an unversioned claim is documented in D205: an
  unlabelled host label contaminated 32 tracked files.

## Answer placement — where each artifact goes (delegate ruling, 2026-11-06)

- **Study** → `docs/reviews/base-agent-product-topology-followup-research.md`, with a `## Proposed backlog items` section
  (format: one-line problem, the evidence class, what the rig would have to build, and who owns it). Registration into
  `docs/ROADMAP.md` is the delegate's job, not yours.
- **Decisions** → `docs/MVP.md` and `docs/COMPETITORS.md` for product claims, and an addendum to **D212** for topology
  rulings. Cite the ROADMAP row each decision closes.
- **Nothing else lands in the repo from research output.** No source changes, no queue edits, no new top-level docs.
