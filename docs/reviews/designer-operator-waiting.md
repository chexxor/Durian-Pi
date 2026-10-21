# Designer proposal — the surface/UX for "waiting on the operator" (visibility + answering)

**Status:** design exploration delivered to pm. This is the SURFACE half of the sibling set
(pm's explore intake, operator directives 2026-10-19 §3): advocate owns the workflow fit,
**architect owns the mechanism**, and this document owns two questions — *where the signal is
shown so the operator actually sees it* and *the shape of the answer affordance*. It proposes;
it does not build, and it does not adjudicate the mechanism. Item: #2699.
Evidence collected 2026-10-19 at `designer-item-2103` (my seat snapshot, isolated worktree):
code quoted below was read and where behavior is claimed it was rendered or grep-verified.
Findings already reported in the TUI flow consultation (item #2629,
`docs/reviews/designer-multi-seat-tui-flow.md`) are cited as F1..F6 rather than re-derived.

---

## 1. The chain that exists (all of it verified in this snapshot)

A "waiting on the operator" state is **one durable fact in the queue model**, written through two
doors that converge on the same representation:

1. a seat parks its own item — `defer_work` sets `item.status = "deferred"`, `item.question`,
   `item.deferredTo = "human"` with a `deferred` transition (`src/rig.mjs` defer handler);
2. **the supervisor escalates** a stuck situation into exactly the same shape (`src/supervisor.mjs`):
   a question parked on ANOTHER seat ages past `DEFERRED_TO_SEAT_MS` (15 minutes) → escalated to
   the human; a seat that failed N runs in a row while holding an item → parked on the human.
   The escalation's `question` text is prefixed "supervisor escalation: …", which is the only
   in-band marker distinguishing it from a seat's own question.

So "waiting on the operator" is **one fact in the queue with two sources**, already durable,
already loaded by every renderer: `readRigHealth` reads ALL queue items unfiltered
(`src/readapi.mjs`), and `item.question` is a plain field. Where each surface takes it today:

| Surface | Where a parked item appears | What it conveys | Question text? |
|---|---|---|---|
| `node cli.mjs status` (JSON, D21) | `attention` notice (`src/attention.mjs`) | count + FIRST item id + who it waits on | **no** |
| `node cli.mjs queue` (JSON) | the raw items | full items (all fields) | **yes** |
| `watch` human view | seat row + footer (`src/watchview.mjs`) | focus "parked on #74 waiting on human"; footer adds `· N deferred` when non-zero | **no** |
| `durig ui` (TUI) | status bar only (`renderStatusBar`) | raw kind tag `[deferred_awaiting_answer]`, no seat, no detail (doc 1 F2); the roster is state-blind (doc 1 F1) | **no** |

Answering today is prose plus memory: `node cli.mjs send <seat> "…"` (or the TUI `i` overlay →
`writeIntent` spool) reaches the seat's conversation; the seat correlates it to the parked item
and calls `resume_work(itemId)` by convention (`rig.mjs`'s defer tool result tells the seat
exactly that). No surface links an operator message to an item id; no verb flags the item; a
wrong or mistimed reply fails only socially, never legibly.

## 2. Findings — the four moments, what breaks at each

### M1 — Raised (the seat asks)

- Works: the attention notice exists and the DEFER tool result tells the seat where its
  question went ("the human operator, who sees it on the status line" — `rig.mjs` toolText).
  Note it names the STATUS LINE — which is precisely the surface that has no human renderer
  (`cmdStatus` emits one JSON doc, D21).
- Breaks: the question's TEXT reaches no human surface outside the raw `durig queue` JSON. The
  notice leads with a COUNT ("1 item(s) parked on a question; #74 waiting on human"). Counts
  are arithmetic; the prose inside the item is what a human can act on immediately
  (is this a design decision? a secret? an approval?). The prose is fully available and unused.
- Observed harm: this class is not hypothetical — re-registration row #2629 records a routed
  consultation that was escalated to the human and sat unnoticed through a stale-queue
  close-out that then CANCELLED it. The signal existed; the prose never surfaced where a human
  reads.

### M2 — Waiting

- Works: the parked item is durable — the notice survives a failed run (the attention comment
  says a failed run does not unpark it) and `watch`'s ◌ glyph distinguishes parked from idle
  and from working.
- Breaks:
  - **First-item-only attribution**: `attention.mjs` reports `deferred[0]` only. With two seats
    parked on you, one question is named; the other is silently a plus-one.
  - **No age**: the deferral timestamp exists (item `transitions`; the supervisor computes
    exactly this age for its 15-min escalation) but no human surface shows it. A question 4
    hours stale and one 40 seconds old read identically — on the surface where the supervisor's
    own clock implies the human is expected within 15 minutes.
  - **Source invisibility**: a seat's design question and a supervisor's failure escalation
    render the same. The first wants design input; the second wants the operator to inspect a
    failure mode. The discriminators exist (prefix text); no surface carries them.

### M3 — Answering

- Breaks (the deepest read of the directive's "answerable"): both existing paths are
  prose-only. Nothing on the operator side names the item being answered; nothing refuses a
  wrong-shaped reply (answering prose to a seat parked on a different item is undetected);
  the seat-side correlation is memory. The structural datum — `#74` — appears in the round-
  trip ZERO times.
- Works: a non-harness write substrate for the answer already exists: the intent spool
  (`writeIntent`, `intent.mjs`), drained FIRST by every broker pass (`drivePass` — the spool is
  delivered before the pass's submissions are inspected). An answer can therefore reach a seat
  without becoming a second store writer or opening a harness.

### M4 — Resolved

- Works: the notice disappears when the item leaves `deferred` (fact-based; nothing to expire).
- Breaks: silence in both directions. Nothing reports where an operator's answer went after
  spooling (drained? who is driving? — a dormant broker means the answer sits in the spool, a
  state the `broker-down-or-stalled` runbook currently diagnoses in prose). And the item's
  return to work is indistinguishable from a cancellation without reading the feed. The facts
  exist: `resume_work` writes a `resumed` transition, `release_work` writes `released`
  (`rig.mjs`), and `eventfeed.mjs` surfaces unknown transition kinds as `queue.<event>`
  (its own comment: "surfaced, not dropped"), so `queue.resumed`/`queue.released` are already
  real feed records.

### Floor behavior (the design is judged at 60 columns and 80x24)

Measured on this snapshot: the TUI seats view at 48/60/80 columns renders the full chrome with
7 seats (doc 1 §3 table). Within that budget, one "waiting on you" package costs: gutter+name
column (measured budget: ~6+14 = 20 cells at 60 cols) + item id (5) + age (5–7) + the question
in quotes. At 60 columns that leaves ~25–30 cells of question before anything else must give.
Three such rows stacked do not fit a 20-row pane with the roster above them — hence the rules:

- the question truncates BY CELLS from the end with `…` (its head carries the discrimination:
  "which branch…" vs "supervisor escalation: impl has failed …");
- the item id and seat never truncate — they are the reference the answer affordance uses;
- age collapses to a compact number (`14m`);
- below a minimum height the line degrades to one honest row:
  `waiting on you: 3 — answer with: node cli.mjs answer <item> <text>`;
- NO_COLOR: no meaning rides hue alone; the words and glyphs carry it (same rule as `watch`).

## 3. The proposal

### S1 — One render rule: the `Waiting on you:` line, shared by watch and the TUI

Both renderers adopt ONE fixed line, identical fields, identical truncation rules, and the
roster rows show the per-seat version (doc 1's flow steps). Shape (watch = full rows; the TUI
status bar = the same fields truncated to the bar):

    Waiting on you:
      impl  #74  since 14m  "which branch is authoritative?"
      lead  #77  since 3m   "supervisor escalation: lead has failed 3 runs and still holds
                             #77 (scope ruling on D11 eviction order)"

Zero-parked means: no line (matches `watch`'s existing "shown only when non-zero" footer
discipline — no nag, no empty section).

Publish the question text, seat, id, age, and source on every attention surface. This needs no
new data anywhere: the fields are on the items `readRigHealth` already hands out. Whether the
ATTENTION KIND STRING changes in the JSON contract is a ruling for pm/lead (proposal: keep the
kind, let the detail text learn the question — additive, so scripts keying on `attention[].kind`
keep working).

### S2 — The answer affordance: two entry points, one destination

- **A1, CLI verb `answer`** — `node cli.mjs answer <item> <text>`. The item id is the primary
  key; the seat is derived from the item (so a seat-name typo cannot misroute an answer). The
  verb must refuse legibly on a non-deferred item: `item #74 is status=done (not parked on
  you)` — a wrong-shaped answer fails at the door with the state, before it reaches a model.
  It is requested as a NEW verb, not a `send` variant: one concern per verb keeps the D21
  one-JSON-document contract clean, and `answer`'s failure modes (item not parked; no broker
  driving) are legible exactly because it is a separate verb.
- **A2, TUI:** focus a parked seat and press `i` — the input overlay continues to be the only
  input row, but its chip names the item it will resolve: `→ impl · answers #74` (doc 1 flow
  step 4). `a` opens the same overlay without first focusing the seat when several seats are
  parked: same overlay machinery, the "Waiting on you:" rows as its rows (the SelectList
  pattern the seat list already vets), no third view.
- **A3, refused shapes:** no modal wizard, no free-form "reply sessions", no transcript export
  bolt-on. The overlay rides the input-overlay machinery that already landed (ROADMAP 99).

Every entry point names the ITEM it is answering. That is the structural half of the fix; once
the linkage is a fact in the message rather than a convention in a head, the seat-side resume
is mechanical (`rig.mjs`'s own toolText already instructs the seat to resume once the answer
arrives).

### S3 — The outputs tell the truth about reachability

When an answer is spooled, name what happens next, derived from read-only facts the CLI
already has machinery for:

- broker driving: `intent spooled for impl — the broker drains the inbox before its next pass.`
- broker NOT driving: `intent spooled for impl — no broker is running, so nothing will wake
  the seat. Start one: node cli.mjs serve (or node cli.mjs up <rig.json>).`

The moment an answer languishes in an un-drained spool is the exact moment the operator is
already paying attention — the repair advice lands where it is actionable, instead of in a
runbook that is read later (doc 1's distro test).

### S4 — The M4 receipt (small, fact-based)

The surfaces that listed the parked item also note its release, using the transitions that
already exist (`queue.resumed` / `queue.released` in the event feed; the attention notice
vanishing when the item resumes). No new state is invented; "resolved" stops being an absence
and becomes an observed event. Keep this as a follow-up small item rather than gating S1.

## 4. What is deliberately NOT decided here (mechanism owner: architect)

- The exact tagging format of the answer intent (a field beside the spooled text, a structured
  envelope, or a naming convention), and what race rules apply if an operator answers an item
  the seat already resumed. Required property only: the item linkage must be structural and
  readable at the seat.
- Auto-resume semantics (an answer itself resuming the item). Attractive, genuinely
  mechanism-shaped, and explicitly NOT proposed here because its failure handling (who receipts
  an answer that fires a resume while nobody is driving) needs the architect's design.
- Queue-count semantics beyond the render split (S1/doc 1 F3 propose the SPLIT of parked vs
  active in the totals; whether the queue DOC's item fields learn more is architect/pm).

## 5. Sequencing (proposer's non-binding suggestion)

1. **S1 (+ the M1/M2 detail rules)** — pure render change on two renderers, failing-first demo
   per renderer (watch human render + TUI golden at 48/60/80). Deliverable even if the verb
   takes longer; it directly pre-empts the #2629/#2103 failure (an escalated question unseen).
2. **S2's TUI half (chip naming)** — small tier, after S1.
3. **S2's verb half + S3** — after the architect rules the payload tagging. Scope: one verb,
   one JSON doc, refuse-when-not-parked, reachability wording.
4. **S4's release receipt** — a later small item; never gate S1 on it.

## 6. Evidence recap (one place)

| Claim | How it was verified |
|---|---|
| Defer writes a durable parked fact with question + deferredTo + transition | `src/rig.mjs` defer handler (and the toolText telling the seat how to resume) |
| Supervisor escalates with the same representation; 15-min seat-question timeout; "supervisor escalation:" prefix | `src/supervisor.mjs` (`planEscalations`, `DEFERRED_TO_SEAT_MS = 15 * 60_000`) |
| Every renderer receives parked items WITH question | `src/readapi.mjs` `readRigHealth` reads ALL queue items unfiltered; `item.question` is a plain item field |
| Attention detail leads with a count and names only the first item | `src/attention.mjs` `computeAttention` (`deferred[0]` in the detail string) |
| `status` is JSON-only | `cli.mjs` `cmdStatus` → `out({...})`; no `--human` branch for `status` |
| `queue` shows the question in raw JSON | `cmdQueue` returns `readQueueItems` items verbatim |
| Watch carries the question in prose? It does not; footer counts it only | `src/watchview.mjs` `seatActivity`/`formatSnapshot` (focus line; `deferred` count when non-zero) |
| TUI renders none of it (bar tags, blind roster) | doc 1 F1/F2 evidence; `renderStatusBar` tag join + `renderSeatList(seats, null, ...)` |
| Answer today is prose by memory | `cli.mjs` `send` (opens harness, waits) and `ui.mjs` input overlay → `writeIntent`; no item linkage exists |
| Non-harness answer sink exists | `drivePass` drains spooled intents FIRST per pass (`src/broker.mjs`); the TUI already routes sends this way (`intent.mjs`) |
| `resumed`/`released` are real, surfaced transitions | `src/rig.mjs` (`event: "resumed"` / `event: "released"`); `src/eventfeed.mjs` default branch (`queue.<event>`, "surfaced, not dropped") |
| Column arithmetic for the 60-col floor | measured col budgets in doc 1 §3/§4 (name/role/id columns), plus this §2 floor rules |
