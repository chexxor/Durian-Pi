# Milestone intake brief — "Ensuring LLM task completion" (read this before reviewing the doc)

**Why this file exists.** The operator created `docs/reviews/ensuring-llm-task-completion-research.md` and ruled it
**the next milestone we work on** (2026-11-07). The delegate has not reviewed it as a peer and has **not** registered rows
from it. What follows is the grounding pass that makes the review short: what the doc proposes, what durian-pi **already
has**, what is genuinely new, and the numbers we now hold that bear on it.
Host for every measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
git 2.56.0 (measured with the commands below).

## 0. What the doc proposes, in six lines

1. Split the window into **controller-enforced bands** (working / economy / checkpoint / wrap-up / emergency) decided from
   API `usage`, never from the model's self-assessment; **disable auto-compaction above the checkpoint threshold**;
   **reserve room for verification**, not just for writing.
2. **Write-ahead handoff**: the next-session doc is written *before* each work item and updated *after*, so it is always
   valid and at most **one item** stale, and stale in the safe direction.
3. Keep state in a machine-readable `state.json`, **render** the human doc from it, plus an append-only `PROGRESS.log`;
   a controller that **rejects** `done` without an artifact path that exists on disk.
4. Make finishing a **planning** problem: estimate the whole item list's token cost up front and refuse to start work
   that does not fit — "stop with a plan" is a clean finish.
5. A **handoff document shape** whose test is: a fresh session with only that file and the repo can state and execute the
   next action without asking a question — and it must carry **dead ends** and **fragile/known-broken** state.
6. **Prove it**: a resume test in CI, a kill test at three points (mid tool call, after a mutation before checkpoint,
   mid-compaction), and a per-turn context-size chart that should be a **sawtooth**, not a ramp.

Its evidence base is three web sources (Anthropic's context-engineering article and cookbook, plus a vendor blog) —
**uncited by us, unfetched by us, and no numbers in it are ours**. Its token bands are written for a 130k window, which
is not this rig's: our two families are **200,000** (`local`) and **24,576** (`verifier`).

## 1. What durian-pi already has — the mapping, with citations

| The doc's proposal | What we already run | State | Row |
|---|---|---|---|
| Controller-enforced context bands, not model self-assessment | The per-item **fresh context boundary** (D105): `src/broker.mjs:55` ("per-item fresh context boundary"), applied only where the seat is on a local provider (`:112-114`, with the warning that a seat skipping it "would grow every item and drift into the **compaction wall** while the rig reported it healthy") | **partial** — we have a *boundary*, not *bands*; and it is arm-dependent by design (paid seats keep durable context) | 331, 313, 314 |
| Compaction must not fire during wrap-up; reserve for verification | Per-family compaction policy exists as config (`src/config.mjs:432 compactionSettings()`) and **does not reach the harness** — measured baseline below | **lack (measured)** — the configured schedule resolves to pi-durable's defaults for every family | **331** (the current free priority) |
| Cap tool results server-side; ranged reads instead of whole-file reads | `src/seattools.mjs:335 scopeSeatTools` scopes tools per *persona*, and **306** says the tool surface is global so a seat cannot be scoped; no output-size cap found | **lack** | 306, new N6 |
| The handoff doc must always be valid | `docs/NEXT.md` + `docs/NEXT-ARCHIVE.md`, and its structural gate `demo/next-pointer.test.mjs` (names current item, queue id, exact next command, `**Blocker:**` line, ≤ 200 lines) — **PASS** at this close. Downstream there is already a consumer with its own test: `scripts/clockin.mjs` digests the pointer and `demo/clockin-digest.test.mjs` gates it (5 references to `docs/NEXT`) | **partial** — ours is written at **session** close, not at item boundaries, so a mid-session crash leaves it one *session* stale, which is exactly the doc's critique | new N3 |
| Machine-readable state + rendered doc + append-only log | **The store is the state file**: queue rows carry status, owner, and body; the broker spool and dead-letter directory are the append-only layer (`selfdev.sqlite.broker.inbox{,.error}`) | **have (state) / lack (render)** — nothing renders the pointer from the store | new N3 |
| Reject `done` without an artifact that exists | `complete_work` refuses cleanup today with an unreadable string (**311**, `src/worktree.mjs:1237` reads `dirent.path`, `undefined` on node v24.22.1); no artifact-existence postcondition anywhere (`grep -rn postcondition src/ cli.mjs` → **no matches**) | **lack** — and the row that would carry it (311) is the row two passes have failed to claim | **311** (`#5273`), new N4 |
| Per-turn context-size chart (sawtooth vs ramp) | A per-call ledger exists (`cli.mjs:276-296`, the spend guard at the one provider seam) with `prompt_tokens` per row | **partial and lopsided** — measured below: it exists **only for the metered arm** | new N2, 310, 316 |
| Kill/resume tests | Kill semantics are documented (303 wedged broker, 327 stop-file, 328 `passes=-`) and pass-level recovery exists. There **is** a `demo/resume.test.mjs`, but it tests the `resume`/`doctor` **CLI verb** ("a submission ADMITTED durably but never STARTED … finds the stranded submission, withdraws it") — not a handoff resume. No test anywhere hands a fresh agent only the pointer (`grep -c "NEXT" demo/resume.test.mjs` → 0) | **lack (of the doc's test) / have (an unrelated `resume`)** | new N5, 303/327/328 |
| Front-load the fit estimate; "stop with a plan" | Nothing gates a claim on an up-front estimate; the wall-clock instrument (`tools/latency-budget.mjs`, "the model is only 12.7 % of the machine's time") measures after the fact | **lack** | new N7, 313/314, the wall-clock section of `docs/ROADMAP.md` |

## 2. What is genuinely new (candidates to register **at** the review, not before it)

- **N1 Bands, per family, from `usage` not from self-report.** Prerequisite: 331 (the nesting fix) — band arithmetic on a
  schedule that reaches no seat is decoration. Fast loop: extend `.spike/delegate-20261106c/compaction-policy-probe.mjs`
  (free, ~1 s) to print the band a family is in; gate is that pure-function probe, no model.
- **N2 A trajectory we can actually see.** Measured below: the **seven author seats are invisible** — the metered ledger has
  rows only for `api.deepinfra.com`. Free: read the existing rows; needs one small seam to record the free arm.
- **N3 Write-ahead pointer, rendered from the store.** Note the tension the review must resolve: `docs/NEXT.md` lives in
  the **shared** main tree, seats work in **worktrees**, and pitfall 47/row **330** is precisely "a doc edit in the shared
  tree got clobbered mid-session". So a seat must not write the pointer directly — it writes an item-level record, and the
  broker/`lead` renders. Fast loop: `demo/next-pointer.test.mjs` (0 s) plus a render probe.
- **N4 A `done` refusal with a postcondition** (`complete_work` names an artifact path; the rig checks it exists). Free:
  the mocked `fauxProvider` plane runs a full pm→worker→done loop in **0.3 s** (`demo/offline.mjs`).
- **N5 The resume test** (name it `handoff-resume` to avoid colliding with the existing `demo/resume.test.mjs`, which is the
  CLI `resume`/`doctor` verb). Give a faux seat only `docs/NEXT.md` + the repo and require it to state the next three
  actions without a question; "it asked a question" = failing test. Cheap (faux plane) but needs a fixture per milestone —
  and it would have caught several real stale-pointer incidents.
- **N6 Output-size caps at the tool surface** with a "use ranged read" hint (pairs with 306).
- **N7 A fit estimate before claiming**, with "stopped with a plan" named as a clean finish state (pairs with 313/314 —
  the rig has no name for "cannot act" either).

## 3. Numbers the review should start from (all measured this session, all free)

- **What the harness actually resolves** (`node .spike/delegate-20261106c/compaction-policy-probe.mjs`): every family gets
  pi-durable's defaults `{reserveTokens 16384, keepRecentTokens 20000, backgroundTokens 32768}`. For
  `verifier/openai/gpt-oss-120b` (window **24,576**, max out 6,000) that is a compaction threshold of
  `24576 − 16384 = `**8,192** while the policy insists on keeping **20,000** recent tokens — more than the window leaves.
  For `local/…` (window 200,000) the threshold is **183,616**. The nested shape the fix would emit resolves correctly
  (`local 40960/24000`, `verifier 4096/8192/8192`), as the operator's pi schedule does under `strata`/`strata-server`.
- **The metered arm runs at the very edge of its window** (`selfdev.sqlite.spend.jsonl`, 856 rows, all
  `api.deepinfra.com`): `prompt_tokens` p50 **6,371**, p90 **19,480**, p99 **20,918**, **max 24,358 = 99.1 % of the
  24,576 window**; **319 calls ≥ 8,192** (the in-force threshold), **167 ≥ 16,384**, **66 ≥ 20,000**. Turn-to-turn
  transitions: up > 2 k **281**, down > 2 k **322** — the trajectory **is** a sawtooth, so the doc's charting proposal is
  measurable with data we already keep.
- **The free arm is invisible.** Both ledger files contain only metered hosts: `selfdev.sqlite.spend.jsonl` → 856 rows,
  `{"api.deepinfra.com":856}`; `.spike/gate/spend.jsonl` (the default path in `cli.mjs:286`) → **1 row**, also
  `api.deepinfra.com`. So the seven author seats' context growth — the very thing the doc wants charted — is **not recorded
  anywhere**. (Also a live specimen of **310**: two ledgers, different paths, neither tracked.)
- **The credential sweep's finding still applies to this milestone**: rows **336/337/341** are now funded by the operator,
  and 337's `/proc` hole is a *seat-boundary* fact like the doc's band boundaries — both say "enforce at the harness, not
  in the prompt".

## 4. What to do before the review (the operator's question) — cheapest first, all free

1. **Land 331.** It is the current priority, it costs nothing, and every band number in the doc is unresolvable until the
   configured schedule actually reaches a seat. Order is already in the row: probe → nesting fix → a gate that calls
   pi-durable's `compactionPolicy()` and asserts per-family numbers → then the values
   `local 40960/24000`, `verifier 4096/8192/8192`.
2. **Promote the instruments out of gitignored `.spike/`** (row **312**): the compaction-policy probe, the `/proc` canary
   (337), and — new — a **trajectory probe** over the ledger (N2). A review of a context-milestone that has no
   context instrument will re-invent one.
3. **Drain the spool deliberately, then stop.** Five intents are waiting (four `lead` briefs for the 331 carriers, oldest
   236 min) and six dead letters sit unread. Read the dead letters first, then a **bounded** broker start
   (`--max-duration`, no `--yes-pm-wakes`) so `lead` can route; that is a delivery decision, not a pass.
4. **Settle the `#5273` routing question** (311). The doc's kill test and our worktree leak (41) are the same failure
   class — "at most one item stale, in the safe direction" — and 311 is where the artifact postcondition lands.
5. **Run the two free structural checks** so the review starts from a green baseline:
   `node scripts/test.mjs --area docs && node scripts/test.mjs --area guard` (1.0 s / 1.9 s at this close).
6. **Then review the doc once**, with this brief beside it, and mint rows N1–N7 as *registered, not scheduled*, marking
   each row's fast loop in seconds per D213. Do **not** adopt the 130k token numbers; the only defensible numbers are
   per-family, computed from each family's declared window and what `compactionPolicy()` actually resolves.

## 5. Questions the review must answer (with the trade)

- **Q1 Bands per family or harness-wide?** Per family is the only safe answer (a 24,576-window verifier and a 200,000-window
  author cannot share a reserve); the cost is three policy tables instead of one. Harness-wide is simpler and is already
  what we *have* by accident — and the 331 pitfall is exactly what happens when a harness-wide reserve meets a small
  window.
- **Q2 Who writes the pointer under write-ahead discipline?** Seats (fast, but the shared-tree clobber 330 bites and seats
  live in worktrees) versus seats-write-item-records + broker renders (extra machinery, no clobber). **Recommendation:
  records in the store, rendered pointer** — it is also what makes N5's resume test automatable.
- **Q3 Is the resume test a gate or a probe?** As a gate it prevents stale pointers forever; as a probe it is cheaper to
  keep. Recommendation: probe first (one row, `devtools`), promote to gate once it has caught something.
- **Q4 Does "refuse to start what does not fit" bind the broker or the seat?** Broker-side (a claim-time budget check,
  machine-enforced, needs the estimate in the row) vs seat-side (a persona instruction, cheap, unenforced). Recommendation:
  broker-side claim check, with the estimate as a queue-row field — consistent with the rig's "enforce at the seam"
  history (307, 311, 337, 341).

## 6. The bands, computed PER FAMILY (delegate pass 2026-11-07T02:0–02:4xZ — the §4/§6 rule, executed)

Host for every number below, measured in the same command as the probe: **Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0**. Probe: `.spike/delegate-20261107/context-bands.mjs` (output
`.spike/delegate-20261107/context-bands.out`) — **free**: no model call, no store write, no broker, no key. It merges
`durig.config.default.json` under `durig.config.json` (skipping the defaults is how a "`MAX_TOKENS` is unset" claim goes
wrong: `durig.config.default.json:6` sets `DURIG_LOCAL_MAX_TOKENS=16384`; the user file sets only
`DURIG_VERIFIER_MAX_TOKENS=6000` at `durig.config.json:8`; `src/providers/local.mjs:159` falls back to `8192`) and applies
the substrate's own arithmetic at the pin: `types.ts:507-512` (reserve = "room kept free for the answer"; background starts
that many tokens **below** the blocking threshold, `0` disables), `generation.ts:355-358` (blocking =
`window − reserve`, background = `blocking − backgroundTokens`), `compaction.ts:148-152` (the summarizing call's maxTokens
is `min(floor(0.8 · reserveTokens), model.maxTokens)`), `compaction.ts:279 selectCut` (walks back from the tail until
`keepRecentTokens` are kept, then cuts at the first candidate that is not a tool result).

Bands re-based as fractions of each family's **declared** window (the doc's 130k bands divided by 130,000 — its §1 shape
carried onto our windows, which is what §4.6 demands):

| family | window | working ≤ | economy ≤ | checkpoint ≤ | wrap-up ≤ | emergency ≤ |
|---|---|---|---|---|---|---|
| `local/qwen3.8-flash-next-iq3_s` (7 seats) | 200,000 | 92,308 (46.2 %) | 123,077 (61.5 %) | 146,154 (73.1 %) | 169,231 (84.6 %) | 200,000 |
| `verifier/openai/gpt-oss-120b` (5 seats) | 24,576 | 11,343 (46.2 %) | 15,124 (61.5 %) | 17,959 (73.1 %) | 20,795 (84.6 %) | 24,576 |

Where each policy's **blocking** and **background** thresholds land:

| policy in force | family | blocking threshold | band | background threshold | band | post-cut floor (`keep + summary`) |
|---|---|---|---|---|---|---|
| today — pi-durable defaults win (331 unfixed) | local | 183,616 (91.8 %) | **emergency** | 150,848 (75.4 %) | wrap-up | 24,000→20,000 + 13,107 = 33,107 (16.6 %) |
| today — pi-durable defaults win (331 unfixed) | verifier | 8,192 (33.3 %) | **working** | **−24,576** | (always above) | **20,000 + 6,000 = 26,000 = 105.8 % of the window** |
| #5309 accepted values | local | 159,040 (79.5 %) | wrap-up | 126,272 (63.1 %) | checkpoint | 24,000 + 16,384 = 40,384 (20.2 %) |
| #5309 accepted values | verifier | 20,480 (83.3 %) | wrap-up | 12,288 (50.0 %) | economy | 8,192 + 3,276 = 11,468 (46.7 %) |
| the operator's pi schedule harness-wide (`32000/16000`) | local | 168,000 (84.0 %) | wrap-up | 135,232 (67.6 %) | checkpoint | 16,000 + 16,384 = 32,384 (16.2 %) |
| the operator's pi schedule harness-wide (`32000/16000`) | verifier | **−7,424** | **never fires** | **−40,192** | (always above) | 16,000 + 6,000 = 22,000 (89.5 %) |

**Three findings the rows do not yet carry** (spooled to `lead` as intent `delegate-20261107-bands` for #5309 / #5310 /
#5308 — the delegate minted nothing, per protocol):

1. **The verifier is behind a COMPACTION WALL today, not merely compacting early.** The smallest view a cut can leave is
   `keepRecentTokens + min(0.8 · reserve, model.maxTokens)` = `20,000 + 6,000` = **26,000 tokens against a 24,576 window**.
   Compaction cannot bring that family under its own window at any threshold. This is the mechanism behind the phrase
   `src/broker.mjs:112-114` already warns of ("drift into the compaction wall while the rig reported it healthy") — and it
   is stronger than "compacts at 8,192 while keeping 20,000".
2. **`backgroundTokens 32768` on a 24,576 window makes the background threshold negative (−24,576)**, so by
   `generation.ts:355-358` **every** verifier call sits above it: a background compaction is eligible on every turn for 5
   of the 12 seats. Feed this to the compaction **cause-class vocabulary** rows (#5206 claimed, #5331) — a
   `background`-class event on every turn is a baseline, not an anomaly, and a chart that does not know that will be
   re-drawn within a week.
3. **#5309's own accepted verifier reserve is smaller than the rig's declared completion: `reserveTokens 4096 <
   DURIG_VERIFIER_MAX_TOKENS 6000`.** `types.ts:507` defines the reserve as the room kept free for the answer, so at the
   blocking point (20,480) there is no room for the 6,000-token completion the same config asks for. #5309 should either
   raise the reserve to ≥ 6,000 or lower the declared maxTokens, and **#5310 should assert `reserveTokens ≥ maxTokens`
   per family** from the resolved policy. Same failure shape the rig already prints at the money seam — `maxCallExposureUsd`
   vs `capUsd` (a live specimen printed itself to `.spike/serve.err` this session: `google/gemini-3.1-pro`,
   "one maximal call at its own declared maxima costs $14.00 = 3.50x the $4 store cap … the row is NOT registered"). For
   contrast the local family clears it (`40,960 ≥ 16,384`), and today's defaults sit at **exact equality** (`16,384 =
   16,384`) on 7 seats — zero headroom, and `DURIG_LOCAL_MAX_TOKENS` set nowhere in the user file (#5307).

**What the substrate cannot express, so the review must decide rather than measure.** The pinned harness has **two**
thresholds (`blocking`, `background`) and one cut rule. The doc's **Checkpoint band — "no new work items may be
started"** — has **no policy field**; it is a notice plus an actuator, and the actuator is explicitly unbuilt
(`docs/runbooks/context-over-window.md`: "the notice **accepts, it never decides** (#3271/#3575). The actuator that would
halt a seat is a separate, unbuilt row (#1781)"). So N1 splits: bands-as-thresholds is a config change (cheap, per
family), bands-as-a-work-stoppage is a new mechanism with an owner and a refusal design. Say which one the milestone
funds; do not let "we set per-family reserves" stand in for "we enforced bands".

**The doc's Economy band ("clear old tool results, no whole-file reads") has a seam, and it is not new.** The vendor
feature is server-side (`clear_tool_uses`, "context editing … which includes tool-result clearing" — see
`inputs/fetched/MANIFEST.md` §7.1). At our pin there is **no such primitive**:
`grep -rn "clear_tool\|context_management\|contextEditing" vendor/pi-main/packages/ --include="*.ts"` → **no matches**.
What exists is `ContextEdit { target: EntryId, action: "omit" | "replace", messages }`
(`vendor/pi-main/packages/durable/src/types.ts:412-426`, applied at `harness/context.ts:145,223`, `harness/prompt.ts:74`).
The rows that already own that shape are the **held pair #2402/#2403** (D107 mask-only at 80 % via ContextEdit
omit/replace; summarize-at-transition + preserve pointers + cap-2 + forced), gated behind the compaction-cluster fold
(ROADMAP 92/94, carrier #5220 `queued`). **Recommendation: fold the milestone's Economy band into #2402/#2403 rather than
minting N6 beside it** — a store-side clear keeps the raw entries append-only, which the server-side version does not give
us, and it inherits D105/D107's non-destructive property.

## 7. The milestone's three references are now fetched and checked (was: unfetched, so not evidence)

See `inputs/fetched/MANIFEST.md` **§7** — all three URLs return **200**, the pages are pinned by sha256, and §7.1 lists
which of the doc's claims are **supported verbatim** (context rot as a token-count effect; context as a finite resource
with diminishing returns; subagents returning "often 1,000-2,000 tokens"; the cookbook's
`RESULT: high-level 3/3 preserved, obscure 0/3 preserved`; proactive-vs-reactive handoffs; "a structured state object …
significantly reduces this risk") and which are **the doc's own inferences with no source** ("an agent at 90 % of its
window is the worst possible judge"; the "often 5–15k" system-prompt floor). §7.2 records the one place the doc
contradicts its own citation — it prescribes hard token bands while its `[^3]` says *"Context rot doesn't hit a clean
threshold … Token Count Isn't the Only Variable"* — which is the direct justification for §6's re-basing.

**A cheap measurement the milestone should run and has not:** the doc's "measure the floor first" is executable here and
free on the loopback provider — one request carrying the seat's system prompt + tool schemas and nothing else, reading
`usage.prompt_tokens`. That number is the denominator every band should be relative to; today we have only the window, and
for 7 of 12 seats we have no trajectory at all (§3, pitfall 61).

## 8. The follow-up research, folded — checked, not pasted (2026-11-07T05:3xZ)

Report: `docs/reviews/task-completion-followup-research.md`, produced by the operator's research agent from
`docs/reviews/task-completion-followup-research-prompt.md`. Pinning and quote-check: `inputs/fetched/MANIFEST.md` §8 —
**25 of its 26 verbatim quotes located in our own fetched copies**; the 26th is recorded `unverified` because the host
refused the fetch (HTTP 403, ResearchGate). Everything below is the fold, with our measurements beside its claims.

**8.1 What it settles, and the cross-check that makes it load-bearing.**

1. **The reserve defect is a named, reproduced upstream class that upstream declined to fix.** pi #8651 (our substrate's own
   repo) is `"state":"CLOSED","stateReason":"NOT_PLANNED"` in the fetched HTML, opened 2026-08-25T23:20:28Z. Our pin is
   *later* (`pi-main.pin.json` sha `2ec55d80…`, pinnedAt 2026-10-19T07:20:20.541Z), and the shape is live at that pin:
   `vendor/pi-main/packages/durable/src/harness/generation.ts:355-356` — `blocking = contextWindow - policy.reserveTokens`,
   `background = blocking - policy.backgroundTokens`, no clamp. So §6's verifier numbers are not a local mis-tuning to wait
   on; **the invariant has to be enforced in durian-pi's config layer**, which is a seam we own.
2. **The rule worth writing into the gate**: `usable = window − max(reserve, max_output)` — "a reserve smaller than the
   declared completion budget is not a reserve". For us: #5309's verifier reserve 4,096 against `maxTokens` 6,000
   under-reserves by 1,904 (their arithmetic, checked: 6,000 − 4,096).
3. **No product enforces a token-band work-stoppage rule, and no vendor publishes band boundaries scaling with the window.**
   Adjacent mechanisms: Hermes' iteration cap plus a tool-stripped closing call; Claude Code's `maxTurns` plus reactive
   compaction after `prompt_too_long`; OpenClaw's pre-compaction "save your notes" reminder (a warning, not a refusal — the
   same "accepts, never decides" shape §6 flagged). So the milestone's Economy band is **our design choice**, and the doc
   should say so rather than implying it is borrowed.
4. **Fractions are the wrong axis for a mixed-window rig** — and this is measurable here, not rhetorical: windows are
   200,000 and 24,576 (8.1×) while `maxTokens` is a per-family constant. A 10 % band is 20,000 tokens on one family and
   2,458 on the other, i.e. **below** the verifier's declared completion. Recommended axis: absolute per family,
   `floor + max_tokens + k`, re-derived when the floor moves.
5. **The actuator gap has an answer that does not touch the model**: refuse at **claim** time — the broker declines to
   dequeue a new item for a seat whose last measured view exceeds the band, and the refusal is a queue-visible seat state with
   an audit row. That is a broker decision, not a sentence in context the model may ignore. It lands on the unbuilt actuator
   named in `docs/runbooks/context-over-window.md` (`#1781`), not on a new mechanism.
6. **Write-ahead handoff is not the industry practice** — the best-documented harness (Anthropic's long-running-agent
   harness) writes at session *end* plus per-commit, and gets idempotency from the commit boundary and from a machine-checkable
   JSON feature list whose only legal edit is a `passes` boolean ("the model is less likely to inappropriately change or
   overwrite JSON files compared to Markdown files"). The transferable finding is **format + validation**, not timing. It also
   names our risk exactly: a rendered `NEXT_SESSION.md` beside a writable `state.json` is a **second mutable representation of
   the same truth** — make the render derived and write-protected.
7. **Summary budgets are absolute, not fractional**: Anthropic's compaction example lands at ~2–3k tokens (2–3 % of a 100k
   window, 8–12 % of our 24,576). Our `min(floor(0.8 × reserve), maxTokens)` resolves to **3,276** at reserve 4,096 — same
   absolute range as theirs by coincidence, not design. And because Claude Code's summary step is a **non-deterministic
   blocking stall** (retained content fluctuates on identical inputs), **nothing load-bearing may exist only inside a
   summary**: identifiers belong in the store or the state file.
8. **A store-side clear must emit its audit entry in the same commit as the view change.** Anthropic reports the divergence
   rather than hiding it (`applied_edits` with `cleared_tool_uses`, `cleared_input_tokens`); that is the pattern for
   `ContextEdit {action:"omit"}`, which is what held pair **#2402/#2403** already owns. Reinforces §7's recommendation.
9. **The counter trap is the one to fear most**: if an `omit`/`replace` shrinks the view without recomputing the counter,
   both thresholds are computed from a number that no longer describes the request (the arXiv analysis' account of the
   "snip" shaper being invisible to a counter that reads `usage` off the last assistant message). Our `status --json`
   `context` block is exactly such a counter.

**8.2 The floor it told us to measure first — measured this session.** Host: Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1 (printed by the probe itself, `.spike/delegate-20261107/floor-probe.mjs`,
`floor-probe-seats.mjs`, output `floor-probe-seats.out`, 2026-11-07T05:35:21Z / 05:35:39Z).

| family | declared window | minimal turn (one "." user msg) | with a real seat instruction file | instruction floor as % of window |
|---|---|---|---|---|
| `local/qwen3.8-flash-next-iq3_s` | 200,000 | **53** prompt_tokens | `lead` 358 · `qa` 1,105 · `auditor` 1,131 · `impl` 1,248 | 0.18 – 0.62 % |
| `verifier/openai/gpt-oss-120b` | 24,576 | **55** prompt_tokens | `lead` 362 · `qa` 1,088 · `auditor` 1,114 · `impl` 1,227 | 1.47 – 4.99 % |

- **The milestone's "often 5–15k token system-prompt floor" is refuted for this rig**: our seat instructions cost
  358–1,248 tokens. The two families tokenize the same files within ~2 % of each other.
- **Limitation to carry, not hide**: these floors exclude **tool schemas**, which the harness sends. The honest floor for a
  live seat is therefore higher, and the cheap way to get it is the ledger, not another probe (below).
- **Empirical metered-arm trajectory** (the ledger, 1,073 turns with `prompt_tokens > 0`): p0 449, p5 1,548, **p50 6,411**,
  **p90 19,787**, p99 21,078, **max 24,358** = 99.1 % of the declared window, and **zero** turns over the window.
- **Band consequence, computed from our own history rather than from a curve**: today's default reserve (16,384 → blocking
  8,192) would have fired on **38.7 %** of those turns; #5309's accepted reserve (4,096 → 20,480) on **5.6 %**. That is
  #8651's "fires on essentially every turn" class, at our magnitudes.
- **Cost disclosure**: the 8 probe calls above were raw provider fetches, so they never entered the spend ledger (pitfall 60
  in `docs/SELFDEV.md`). Ledger reads **$0.456203**; true verifier-family cumulative is ≈ $0.4568.

**8.3 Corrections to the report's own arithmetic** (recorded so the circulating number is ours, not a rounding drift):
`min(floor(0.8 × 4096), 6000)` = **3,276**, not "≈ 3,277". `clear_tool_inputs` is a string in the **context-editing doc**
(6 matches), not in the arXiv analysis (0 matches) — cite the doc. Its 1,904 under-reserve and the 26,000 wall both check out.

**8.4 What stays unanswered, so the next reader does not re-ask it** (the report says so itself, and I could not close it
from the tree either): a ≤ 20-call protocol for placing an effective window (it says 20 calls cannot place a threshold, only
detect a grossly misplaced one); any vendor statement of reserve-vs-max-output as a rule (issue trackers only); a published
fraction for summary size; any product with a token-band stoppage; any automated resume test for handoff docs; measured
tokenizer-estimate error against a chat template plus tool schemas; and any wall-clock seconds for policy iteration —
"not reported", so §9's numbers-in-seconds requirement is unmet by construction.

**8.5 Where this lands in the queue (rows the team already holds — no new rows minted here).**
`#5306`/`#5309`/`#5310`: gate on both `reserveTokens >= maxTokens` **and**
`keepRecentTokens + summaryBudget + maxTokens + measuredFloor <= window`, per family; `#5308`: promote
`context-bands.mjs` **and** the two floor probes so the constants stop being re-derived; `#5316`/`#5317` (332 S2/S4): the
measured floor is a per-family registry constant — which is also what `window.candidates.measured` still lacks (rows 27/97);
`#2402`/`#2403`: the same-commit audit entry for `ContextEdit omit`; `#5215`: the suppression trace's missing `age=`
(`docs/NEXT.md` block (W)).
