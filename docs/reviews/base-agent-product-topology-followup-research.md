```markdown
# Round 2 — base-agent product topology: idle policy, model-pointer staleness, counterexamples, verifier economics

Fetched 2026-11-06. Builds on Round 1 (`docs/reviews/base-agent-product-topology-research.md`) without restating it; section numbers prefixed "R1" refer to it. Uses the delegate's corrected identifiers (`DURIG_MAX_CONCURRENT_SEATS`, `DURIG_EXTENSIONS`, `src/queue-lifecycle.mjs`, `src/extensions.mjs`, D212, ROADMAP 18/299/300/303) and does not re-cite the three paths Round 1 got wrong.

**Budget disclosure.** 5 of 5 tool iterations used; 9 primary pages fetched and 6 search result-sets read; 1 fetch failed (a mistyped host, no content). Stop was **budget-forced, not source-exhausted** — so "no source found" below means "none in this sample", not "none exists". Evidence classes: `observed-in-source` (page read) vs `advertised-elsewhere` (index snippet only, marked).

---

## Q10 — idle/attention policy: nobody publishes a queue-empty backoff; three products publish an idle *state*, one publishes a *hook*

### What shipped products actually do when there is no work

| Product (as of 2026-11-06) | Published idle behaviour | Numbers | What happens to context | Class |
|---|---|---|---|---|
| Devin (Cognition, docs live) | Session **sleeps**; sleeping consumes no usage; a message wakes it | 30 min default inactivity; **5 min** for Lite and API-created sessions (not child sessions); Enterprise can set **5–120 min** | Session state persists across sleep ("wake Devin up and resume the session"); environment snapshot is per-repo and session changes do **not** write back to it | observed-in-source [^5] |
| Claude Code `/loop` (docs rev 2026-10-22) | No queue-empty backoff at all; scheduling is per-prompt cron. Self-paced mode is the only adaptive interval | Fixed min interval **1 min**; self-paced delay **1 min–1 h**, "longer waits when nothing is pending"; recurring tasks **expire after 7 days**; max **50** tasks/session; scheduler ticks every 1 s; no catch-up for missed fires | Loop iterations are ordinary turns in the same transcript; no reset | observed-in-source [^2] |
| Claude Code agent teams | Idle is a **modelled event**, not inferred from silence: `TeammateIdle` fires "when a teammate is about to go idle after finishing its turn" | No interval, because there is no polling | Hook can veto idle: exit 2 sends the teammate back to work with stderr as feedback; `{"continue": false}` stops it entirely | observed-in-source [^6], [^6] |
| Goose (Block, docs live) | Subagents are "temporary instances that exist only for task execution"; nothing waits on an empty queue | Subagent **5-min timeout** default; **5** concurrent max per parent; exceeding tasks queue | Timeout yields **no output** from that subagent; parallel siblings still return | observed-at-our-pin [^P3] — every number in this row is readable in the pinned clone (`goose · 775b3958`); the **5** concurrency default is enforced in **code**, the **5-min timeout** is the vendor's own docs page at that pin |
| Cursor Cloud Agents (docs live) | Idle is a **machine lifecycle**, not an agent loop | Idle timeout exists for self-hosted worker connections (teams set it; on expiry the machine "can reset and re-enter the pool") — **advertised-elsewhere**; API status says the machine "may be hibernated or snapshotted" | Snapshot/restore keeps the workspace; the agent loop and transcript stay in Cursor's cloud | advertised-elsewhere [^11], [^18]; VM/snapshot model observed [^1] |
| Jules (Google, docs live) | No idle loop at all: one task = one short-lived VM, then done | — | Repo-level env snapshot reused; no session to park | observed-in-source [^9], [^9] |

**Negative finding (Q10a).** None of the five publishes a backoff schedule for an empty queue. The published numbers are *scheduling* numbers (minimum interval, max delay, expiry) and *lifecycle* numbers (sleep timeout, subagent timeout, worker reclaim). The closest thing to a queue-empty policy is Claude Code's self-paced loop, and its policy is prose given to the model ("longer waits when nothing is pending"), bounded 1 min–1 h, not an operator-configurable schedule. Our 2-second wake on an empty queue has **no shipped analogue**; it is not a policy anyone else shipped and then tuned, it is a policy nobody shipped.

**Idle-cost figures (Q10b).** No vendor publishes an idle-cost page per se; the numbers are embedded in billing rules:

- Devin states the invariant directly: usage accrues from work performed plus "virtual machine time (typically a small fraction of total usage)", and "Devin will not consume usage when: Waiting for your response / Waiting for a test suite to run / Setting up and cloning repositories" [^5]. Its FAQ answers "Will Devin keep consuming while awake but idling?" with the sleep timer, i.e. the mitigation is **sleep, not backoff** [^5]. Enterprise admins can cap each member's monthly consumption via usage policies [^5].
- Claude Code bounds runaway loops structurally rather than financially: 7-day expiry "bounds how long a forgotten loop can run" [^2].
- Cursor Cloud Agents require a spend limit at first use [^1].
- Our own measurement (1,245 passes / 1,394 escalations / 249 paid calls / $0.086 in 30 min, ROADMAP 300) is therefore the **only quantified empty-queue cost figure in this comparison set** — worth saying plainly in the study, because it means the rig measured something the industry has not published.

**Idle vs wedged (Q10c) — the discriminator, which is the part worth copying.** Claude Code does not time out idleness; it *emits* idleness as an event with a veto, and it separates "the turn ended" from "the turn ended badly":

- `TeammateIdle` = legitimate idle, hook-vetoable [^6].
- `StopFailure` carries a typed error, with matcher values including `rate_limit`, `overloaded`, `billing_error`, `model_not_found`, `max_output_tokens` [^6]. A stuck seat is a *typed failure*, not a silent one.
- `Notification` has `idle_prompt`, `agent_needs_input`, `agent_completed`, and quota-resume types [^6].
- Devin's counterpart is a user-visible state ("Keep Devin awake" while a sleeping session wakes) — advertised-elsewhere [^12], so I mark the operator-facing detail unverified.

Nothing in the sample tells an operator "your supervisor is wedged but your store is fine." Cursor's own community asks for exactly that (configurable idle warn/stop), which is evidence the gap is general rather than ours — but that is a forum request, not product documentation, so it stays out of the evidence table.

### Acceptance: the one row a `lead` can copy

| Field | Proposed policy |
|---|---|
| **Empty-queue backoff** | Poll delays **15 s → 25 s → 45 s → 75 s → 2 min → 3.5 min → 6 min → 10 min (cap)**, ×1.7 growth, ±20% jitter. Reset to 15 s on any claim. |
| **What a woken seat does with nothing claimable** | **No model call.** The wake is a store `claim` first; a turn starts only on a successful claim. On failure: increment `emptyPolls`, do **not** reset context, do **not** spend tokens. |
| **When to park** | After **6 consecutive empty polls (~25 min)**: exit the process, keep the transcript, write seat state `parked`, release the lease. Re-check the store **once per hour** with a read-only query (no model). |
| **Hard bounds** | ≤ **12** empty wake→sleep cycles per seat per hour; a seat parked > **6 h** is reported by `check`, not silently retried. Mirrors Claude Code's 7-day expiry intent [^2]. |
| **Idle vs wedged** | `idle` = the seat's loop ended a turn (our `TeammateIdle` equivalent). `wedged` = broker heartbeat advancing **and** `lastPassAt` older than **3×** the pass timeout. Operator action for wedged = restart the **broker only**, never `up --refresh` on seats (that is the context-reset path that erased the spooled ruling, ROADMAP 300). |
| **What the operator is told** | Two distinct lines: `seat <id> parked (no work, 25m)` and `broker wedged (heartbeat live, lastPass 94s > 3×30s)`; only the second is an alarm. |

---

## Q11 — model retirement: three vendors, three different choices, and none re-validates at resume

| Vendor (docs as of 2026-11-06) | Chosen behaviour of the four | Evidence |
|---|---|---|
| **Anthropic / Claude API** | **Refuse-with-reason at request time.** Lifecycle is Active → Legacy → Deprecated (replacement + retirement date assigned) → Retired ("Requests to retired models fail"). ≥ **60 days' notice** for public models; no alias table, no substitution, no forced migration; the audit path is a usage CSV export, i.e. *the customer* greps for stale IDs. | observed-in-source [^4] |
| **Google Gemini API** | **Silent substitution by server-side routing.** "Effective December 1, 2026, all API requests to `gemini-2.5-pro` will automatically route to `gemini-3.8-flash` and be billed at Gemini 3.8 Flash rates"; same for `gemini-2.5-flash` → `gemini-3.5-flash-lite`. Breaking changes ride along (`thinking_level` replaces `thinking_budget`; sampling params removed; prefilled turns removed). | advertised-elsewhere [^10], [^13] |
| **OpenAI API** | **Scheduled shutdown, and aliases are not a stability guarantee.** Deprecations page carries shutdown dates with six months' notice; `GET /v1/models` exposes an optional `shutdown_date`; undated aliases such as `gpt-4o` follow the base model's shutdown date. | observed-in-source for the page's existence and notice policy [^14]; **advertised-elsewhere** for the alias-follows-base and `shutdown_date` details [^15] |
| **Devin / Cursor / Jules** | **Not documented.** None of the pages read exposes a per-session model pointer, so "what happens at wake when the pointer is stale" is unanswerable from their docs. | negative finding; pages read: [^5], [^1], [^9] |

**What this means for ROADMAP 299.** The two failure modes our rig hit map onto two *different* vendor choices, and we got the worst of both:

- Anthropic's "requests to retired models fail" is exactly our `Model <X> is not available` — 16,166 generations and 65.9 h. Our store kept the pointer and the failure surfaced deep inside a task record as `no_model`, which is Anthropic's behaviour *without* Anthropic's 60-day notice being consumed by anything.
- Google's routing shows the opposite failure: a request that "succeeds" on a different model at different rates. If we ever add alias resolution, we must record the **resolved** model on the generation, or cost and behaviour drift silently.

**Negative finding (Q11).** No product doc in this sample states that it re-validates a session's model pointer at wake, and I found **no published incident** where a retirement broke queued or resumable work — Cognition's local-CLI memory issue is a different failure class. So the "re-validate at wake" design has no published precedent to copy; the precedent is only that vendors publish retirement dates **>= 60 days out and machine-readable-ish**.

**Acceptance for the fix:** validate at **claim**, not at wake, and make it free. A claim preflight that resolves the seat's model against a local `models.cache.json` (`id`, `alias_of`, `retired_at`, `checked_at`) and refuses the claim with a typed `model_not_found` — surfaced by `check` as a seat-level alarm — costs no tokens and no context reset. `up --refresh` stays for operator-initiated changes only.

---

## Q12 — counterexample search, per vendor (this time separately)

| Vendor / mechanism | Exists? | In-product or extension? | Per-agent or per-team durable state? | Source |
|---|---|---|---|---|
| **Devin** | Yes, shipping | In-product (sessions, ACU metering; no customisation layer documented for the session runtime) | **Per-session** durable state (sleep/wake resumes the session), plus a per-repo environment snapshot. "Every session starts from the same clean state. Session changes don't persist back to the snapshot." No customer-visible per-agent DB. | observed [^5]; snapshot rule advertised-elsewhere [^16] |
| **Cursor Cloud Agents** (ex-Background Agents) | Yes, shipping | In-product; team hooks and MCP are the customisation plane | **Per-agent machine** (VM + snapshot/hibernation); transcript and loop stay in Cursor's cloud. Durable state is the machine, not a database per agent. | observed [^1]; snapshot-in-status advertised [^18] |
| **Google Jules** | Yes, "experimental", and being wound down (changelog 2026-10-29 adds full export of sessions/memories/scheduled tasks) | In-product | **Per-task** VM, short-lived; repo-level env snapshot. Nothing per-agent survives the task except the exported activity log. | observed [^9], [^9] |
| **Block Goose — recipes** | Yes, OSS, shipping | **Extension plane**: a recipe is a YAML/JSON bundle of instructions + `extensions:` + parameters; `summon` (delegate/load) is a platform extension that must be listed in a recipe's `extensions:` block or delegation disappears | Per-**parent-session**; subagents are temporary with a 5-min timeout and no persistence. No per-agent store. | observed-at-our-pin [^P3] — recipe bundle shape read at the pinned docs page, `summon` read at the pinned source |
| **Gemini CLI extensions** | Mechanism exists (prompts, MCP servers, custom commands, themes, hooks, sub-agents, skills; installed by GitHub URL or local path) — **but Gemini CLI was replaced by Antigravity CLI on 2026-06-18 for unpaid tier and Google One users** | Extension plane | Per-session; no per-agent store documented | observed [^7] |

**Result of the counterexample search, stated as narrowly as the evidence allows:** still **no shipped product in this sample keeps a durable database per agent.** The nearest thing that exists is a **per-agent machine** at the hosted tier (Cursor: snapshot/hibernate/reset per agent connection; Jules: one VM per task) — state per agent, but a machine image, not a queryable store, and never per-agent-in-a-team at the interactive tier. Round 1 §2's caveat can be closed as "searched, none found in six vendors", with the Gemini CLI→Antigravity CLI retirement as a reminder that the mechanism we would copy may not outlive the vendor's own product.

---

## Q13 — verifier economics: one usable price anchor, and silence on everything else

| Datum | Value | Source / class |
|---|---|---|
| Average cost of one automated PR review (Cursor Bugbot) | **$1.00–$1.50**, "depending on PR size and complexity"; usage-based, billed from plan usage then on-demand | observed [^8] |
| Reviewer model choice | "a combination of frontier and in-house models" — no named model, no version | observed [^8] |
| Published reasoning budget for the reviewer | **None.** Bugbot exposes an "effort level" customers can raise ("think for longer and run deeper reviews") but publishes no token or reasoning budget | advertised-elsewhere [^17] |
| Verification latency as distinct from generation latency | **Silent.** No vendor in this sample publishes review/turn p50/p95 or a review-duration SLA. Claude Code publishes hook timeouts (30 s prompt hooks, 60 s agent hooks, 600 s command) and effort levels `low…max`, which are *bounds*, not latencies | observed [^6], [^6] |
| Cost-control mechanism published | Claude Code: eval cost ceilings and `max_turns`/`timeout_seconds` defaults (R1 §8); Devin: per-member monthly usage caps; Cursor: mandatory spend limit at first Cloud Agent use | [^5], [^1] |

**What the literature says to us, concretely.** Bugbot's $1.00–$1.50 is the only *per-verification* price in the sample, and it is a **diff-scoped** review. Our maximal verifier at 131,072 context = $4.85, i.e. **3.2–4.9× a commercial PR review**, and our 24,576 slot has never been measured. That is not evidence that our verifier is wrong; it is evidence that *full-context verification is not what anybody sells*. The actionable read: bound the verifier's input to the diff + the failing check's output (the thing Bugbot reviews), keep the full-context mode as an explicit, capped escalation, and treat the `finish_reason: "length"` + empty content at `max_tokens: 24` as a **reasoning-model floor** to be measured, not guessed (ROADMAP 297).

**Negative finding (Q13).** "Verification latency, distinct from generation latency" is **not published anywhere in this sample**. Per the delegate's instruction, that is the answer: the team should **measure** it (we already have `demo/settled-within.test.mjs` and `docs/runbooks/slow-loop.md` as the place) rather than keep searching.

---

## Proposed backlog items

Format: one-line problem — evidence class — what the rig must build — owner.

| # | Problem (one line) | Evidence class | What the rig builds | Owner |
|---|---|---|---|---|
| R2-1 | Empty queue wakes every seat every ~2 s and resets context (ROADMAP 300) | observed-in-source (Devin sleep timer, `/loop` bounds; no shipped backoff anywhere) | `src/idlepolicy.mjs`: 15 s→10 min capped ×1.7 backoff with ±20% jitter, `claim`-before-wake, park after 6 empty polls, hourly read-only re-check; `demo/idle-backoff.test.mjs` asserting **zero paid calls** on an empty queue for 30 simulated minutes | impl |
| R2-2 | A parked seat and a wedged broker look identical to the operator (ROADMAP 303) | observed-in-source (Claude Code `TeammateIdle` vs typed `StopFailure`; `idle_prompt` notification) | Typed pass outcomes + `check` rule `broker-wedged` (heartbeat live ∧ `lastPassAt` > 3× pass timeout) vs `seat-parked`; distinct operator lines; runbook `docs/runbooks/wedged-vs-parked.md` | impl |
| R2-3 | Stale per-conversation model pointers burn generations and only surface as `no_model` (ROADMAP 299) | observed-in-source (Anthropic retire→fail; Gemini silent re-route; OpenAI `shutdown_date`) | Claim-time preflight against `models.cache.json` (`id`, `alias_of`, `retired_at`, `checked_at`); typed `model_not_found` refusal before any generation; `check` alarm at seat level; resolved-model recorded on every generation | impl |
| R2-4 | Nothing records which model *actually* answered, so alias re-routing would be invisible to us | advertised-elsewhere (Gemini auto-routing, billed at new rates) | Add `resolved_model` + `billing_rate_id` to the generation record; `metrics` provenance line reports mismatches between configured and resolved | lead |
| R2-5 | Verifier budget ($4.85 max-context call vs $1.00–$1.50 commercial review) is unmeasured at our slot | observed-in-source (Bugbot pricing only) | Calibration harness: diff-scoped verifier vs full-context verifier on the same 20 tasks; emit `{costUsd, wallMs, verdict, contextTokens}` per arm; publish p50/p95 **verification** latency, which no vendor publishes; decide the 24,576/3,000 slot from data | qa |
| R2-6 | Reasoning-model calls can return `finish_reason: "length"` with empty content at tiny `max_tokens` | observed-in-source (ROADMAP 297) | Preflight: refuse a verifier call whose `max_tokens` is below the recorded empty-content floor; record the floor per model in `rig.starter.json` and enforce in `src/seatmodel.mjs` | impl |
| R2-7 | Round 1 §2's counterexample caveat is now closed but not written down | observed-in-source (six vendors, per-vendor table above) | Append the Q12 table to the Round 2 study and add a `docs/DECISIONS.md` row: "no per-agent store; per-agent *machine* at hosted tier is the closest shipped analogue" | delegate |

## Source table

| Marker | URL | Class | Read |
|---|---|---|---|
| [^6] | https://code.claude.com/docs/en/hooks | observed-in-source | 2026-11-06 |
| [^2] | https://code.claude.com/docs/en/scheduled-tasks | observed-in-source (rev 2026-10-22) | 2026-11-06 |
| [^5] | https://docs.devin.ai/admin/billing/usage | observed-in-source | 2026-11-06 |
| [^1] | https://cursor.com/docs/cloud-agent | observed-in-source | 2026-11-06 |
| [^4] | https://docs.claude.com/en/docs/about-claude/model-deprecations | observed-in-source | 2026-11-06 |
| [^P3] | **our pin**, not a fetched page: `vendor/eval/goose · 775b3958` (registered `docs/COMPETITORS.md:380`) — `vendor/eval/goose/documentation/docs/guides/context-engineering/subagents.mdx:265` ("temporary instances that exist only for task execution"), `:274` (Max Concurrent Subagents **5**, `GOOSE_MAX_CONCURRENT_SUBAGENTS`, "Additional tasks wait until a running subagent finishes", per parent session), `:276` (Timeout **5 minutes**), `:71` (fail/timeout ⇒ "no output from that subagent"; parallel execution returns "results only from the successful ones"); **code**, `vendor/eval/goose/crates/goose/src/agents/state_machine_builder.rs:90-94` (`.with_max_concurrency(... .unwrap_or(NonZeroUsize::new(5)))`); recipe plane, `vendor/eval/goose/documentation/docs/guides/recipes/recipe-reference.md:666,699,812` (`instructions:` + `parameters:` + `extensions:`) and `vendor/eval/goose/crates/goose/src/agents/platform_extensions/summon.rs:32` (`EXTENSION_NAME = "summon"`) | observed-at-pin (clone read locally; the concurrency default is source-grade, the 5-min timeout is the vendor's docs text at the pin — no `300 s` default was found in `vendor/eval/goose/crates/goose/src/agents/subagent_handler.rs` / `state_machine/ops_subagent.rs`, whose only timeout is a 5 s abort grace at `subagent_handler.rs:342`) | 2026-11-06 |
| [^3] | https://goose-docs.ai/docs/guides/context-engineering/subagents/ | **superseded by [^P3] — context only** (the outside page carries the same text as the pinned repo path; the numbers above are cited to the pin, per ROADMAP 318 / #5216; the page was not re-fetched, so its liveness is not asserted) | 2026-11-06 |
| [^7] | https://geminicli.com/docs/extensions/ | observed-in-source (rev 2026-02-17) | 2026-11-06 |
| [^9] | https://jules.google/docs/environment/ | observed-in-source | 2026-11-06 |
| [^8] | https://cursor.com/bugbot | observed-in-source | 2026-11-06 |
| [^10] | https://aistudio.google.com/docs/deprecations | advertised-elsewhere | snippet |
| [^13] | https://aistudio.google.com/docs/models/gemini-2.5-pro | advertised-elsewhere | snippet |
| [^14] | https://developers.openai.com/api/docs/deprecations | advertised-elsewhere (page exists; policy text from snippet) | snippet |
| [^15] | https://codersera.com/blog/gpt-4o-gpt-4-1-api-shutdown-migration-2026/ | advertised-elsewhere (third-party) | snippet |
| [^11] | https://cursor.com/blog/self-hosted-machines | advertised-elsewhere | snippet |
| [^18] | https://cursor.com/docs/cloud-agent/api/endpoints | advertised-elsewhere | snippet |
| [^16] | https://docs.devin.ai/onboard-devin/environment | advertised-elsewhere | snippet |
| [^17] | https://cursor.com/blog/may-2026-bugbot-changes | advertised-elsewhere | snippet |
| [^12] | https://docs.devin.ai/release-notes/2026 | advertised-elsewhere | snippet |
```

Three limitations, stated rather than smoothed over: (1) the run stopped on the **5-iteration budget**, not on three consecutive empty attempts per question, so Q13's silence and Q10's "no backoff" are sample-scoped, not proven absences; (2) every Q11 claim about *resume-time* validation is a negative finding — no vendor documents the wake path, so the design in R2-3 is inferred from vendor retirement policy, not copied; (3) `docs/MVP.md`, `docs/COMPETITORS.md`, D212 and the Round 1 study were deliberately not read, so the delegate's diff on that side may find overlap I could not detect from here.

**References**

[^1]: [Cloud Agents | Cursor Docs](https://cursor.com/docs/cloud-agent) (21%)
[^2]: [Run prompts on a schedule - Claude Code Docs](https://code.claude.com/docs/en/scheduled-tasks) (18%)
[^3]: [Subagents | goose | Your open source AI agent](https://goose-docs.ai/docs/guides/context-engineering/subagents/) (13%) — **superseded for these claims**: the same text is in our pinned clone at `documentation/docs/guides/context-engineering/subagents.mdx` (see [^P3] in the Source table). Kept for provenance of what the round originally read; do not re-fetch it to check a number.
[^4]: [Model deprecations - Claude Platform Docs](https://docs.claude.com/en/docs/about-claude/model-deprecations) (11%)
[^5]: [Usage - Devin Docs](https://docs.devin.ai/admin/billing/usage) (10%)
[^6]: [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks) (10%)
[^7]: [Gemini CLI extensions | Gemini CLI](https://geminicli.com/docs/extensions/) (3%)
[^8]: [AI Code Review Built for Production | Bugbot by Cursor](https://cursor.com/bugbot) (3%)
[^9]: [Environment setup | Jules](https://jules.google/docs/environment/) (2%)
[^10]: [Gemini deprecations - Gemini API | Google AI Studio](https://aistudio.google.com/docs/deprecations) (2%)
[^11]: [Run cloud agents on machines you manage](https://cursor.com/blog/self-hosted-machines) (1%)
[^12]: [2026 - Devin Docs](https://docs.devin.ai/release-notes/2026) (1%)
[^13]: [Gemini 2.5 Pro - Gemini API | Google AI Studio](https://aistudio.google.com/docs/models/gemini-2.5-pro) (1%)
[^14]: [Deprecations - OpenAI API](https://developers.openai.com/api/docs/deprecations) (1%)
[^15]: [GPT-4o Deprecation: Jan 14, 2027 Shutdown & Migration Guide](https://codersera.com/blog/gpt-4o-gpt-4-1-api-shutdown-migration-2026/) (1%)
[^16]: [Devin environment setup](https://docs.devin.ai/onboard-devin/environment) (1%)
[^17]: [Updates to Bugbot for Teams and Individuals - Cursor](https://cursor.com/blog/may-2026-bugbot-changes) (1%)
[^18]: [Cloud Agents API | Cursor Docs](https://cursor.com/docs/cloud-agent/api/endpoints) (0%)
[^P3]: **our own pin**, not a web page — clone `vendor/eval/goose` at `775b3958` (gitignored clone; pin registered at `docs/COMPETITORS.md:380`, `node tools/vendor-pins.mjs --check` → PASS, 14 clones). Paths inside that clone: `vendor/eval/goose/documentation/docs/guides/context-engineering/subagents.mdx:71,265,274,276` (subagent lifecycle, max-concurrent **5**, **5-minute** timeout, fail/timeout ⇒ no output); `vendor/eval/goose/crates/goose/src/agents/state_machine_builder.rs:90-94` (the **5** default, in code); `vendor/eval/goose/documentation/docs/guides/recipes/recipe-reference.md:666,699,812` (recipe `instructions:`/`parameters:`/`extensions:`); `vendor/eval/goose/crates/goose/src/agents/platform_extensions/summon.rs:32` (`summon`). Read locally 2026-11-06; grade: the concurrency default is source-grade, the 5-minute timeout is the vendor's own docs text at the pin.
## Delegate diff — what this round adds to what the repo already holds (2026-11-06, delegate)

The 298 acceptance test is **propagation, not publication**, and it carries a second condition the
prompt set itself: *"a counterexample search that only found the systems a prompt suggested is not a
search."* So this block states what is genuinely new to us, what we already held, and where this round
did not meet our own evidence bar. Measured by counting terms in our own docs (`grep -ci`), not by
impression: **`Devin` 0, `Jules` 0, `Bugbot` 0, `background agent` 0, idle-policy language 0** in
`docs/COMPETITORS.md`; **`Cursor` 3, `Goose` 14, `hook` 22** partially held; **`per-seat database` 0**
in `docs/DECISIONS.md` (which is why **B7**/'s written rejection is still the open half of 279).

**Net-new and load-bearing.** Q10 — no shipped product documents an idle policy, and GitHub Code
Quality's two-state Bugbot (persistent agent with a scheduled task vs one-shot reviewer) is the closest
design precedent. That lands on **300** while our own measurement of the cost of *not* having it is warm
(1,406 resets and ~$0.17/h of idle spend), and it is registered as **313**/**314**.

**Two corrections, both of which make the proposed rows cheaper to build.**

1. **R2-5's Goose evidence is weaker than the corpus we already hold.** The study cites vendor *docs*
   paths (`documentation/ai-agent/recipes.md`, `docs/goose/recipes/index.md`). But
   `docs/COMPETITORS.md:380` pins `goose` at `775b3958` (Apache-2.0) with the **full Rust source** read,
   and `:396-397` already cites `crates/goose/src/recipe/local_recipes.rs:155,194`
   (`generate_recipe_filename`). The prompt's §3 source-audit protocol was not applied to the one vendor
   we hold a pin for. The claim ("a recipe is prompt+steps, no planner loop") is probably right; the
   citation should be the pin, and the tool-surface claim Round 2 leans on is exactly the gap
   `docs/COMPETITORS.md:321` records as **unexamined here** for Cline and Goose. Registered as **318**.

   **318(a) FIXED (2026-11-06, item #5216) — and the landed file is not what 318(a) describes, so read
   this before re-opening it.** The two vendor-docs paths 318(a) names (`documentation/ai-agent/recipes.md`,
   `docs/goose/recipes/index.md`) appear **nowhere in the landed deliverable** — `grep -n
   "ai-agent/recipes\|goose/recipes\|goose-docs" docs/reviews/base-agent-product-topology-followup-research.md`
   hits only this diff block (`:182`) plus the `[^3]` rows. The citation the landed Goose rows actually
   used is `[^3]` = the vendor **subagents** page, and it carried the capacity/timeout numbers in **Q10**
   and the recipe/per-session claim in **Q12**. Both rows now cite `[^P3]`, our pin, and `[^3]` is marked
   context-only. The claim did **not** shrink: every number survived re-checking at `goose · 775b3958`
   (`subagents.mdx:265,274,276,71` under `vendor/eval/goose`), and the **5**-concurrent default is additionally enforced in code at
   `crates/goose/src/agents/state_machine_builder.rs:90-94`. What the pin does **not** buy: the **5-minute
   timeout** stays vendor-docs text at the pin — no `300 s` subagent default was found in
   `subagent_handler.rs`/`ops_subagent.rs` — so it must not be quoted as behaviour read from source.
2. **R2-3's `broker-wedged` rule would re-derive a discriminator we already ship.** `docs/MVP.md:40-41`
   records that `src/attention.mjs` emits exactly two notices — `idle_with_queued_work` and
   `last_run_failed` — and that "a seat actively running or settled-and-empty stays silent". Q12's claim
   that nobody distinguishes idle from wedged is about *supervisors in the wild*, not about this rig; the
   wedge rule should extend the two notices we have, not start a parallel taxonomy. Row **314** says so
   in its acceptance text.

**One finding that changes what a ruling should say, not just add to it.** Q12's closest analogue is a
per-agent **machine or workspace** (Cursor: each background agent in its own VM with snapshot/resume;
Jules: per-task VMs). Read together with Round 1 §2, the shipped topology is *one durable store per team,
one isolated filesystem per agent* — which is what this rig already runs (`src/seatroot.mjs`,
`src/worktree.mjs`). So **B7**'s written rejection should be two clauses: reject per-seat *databases*,
**affirm** per-seat *worktrees/scratch*. Recorded in **D216** for the operator's signature.
