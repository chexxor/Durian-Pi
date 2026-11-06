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
