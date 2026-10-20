# Designer surface spec — the landing screen (per-seat status / queue / current item brief / action type)

**Status:** the surface spec requested in #3307 (operator-directed, extends ROADMAP 124).
ADVISORY and self-contained: impl can build from this document without reading my two earlier
consultations, and qa can verify it against the frames named in §7. NO write path is introduced;
D21 is untouched. Evidence collected 2026-10-20 in the #3307 item worktree against the current
main (post lock-fix): the column ladder below was MEASURED with the repo's own
`src/textwidth.mjs` (numbers in §2/§3 are its output, not estimates).

## 0. The reconcile verdict (the part pm most needed)

**The landing screen EXTENDS #2826; it does not supersede it, and it creates no second render rule.**

Explicitly, item by item:

| Reference | What it already owns | The landing screen's relation |
|---|---|---|
| #2826 — watchview `seatActivity` roster + bar vocabulary + floor precedence (gated on #2788, floor gate cleared) | the STATES and their glyphs (○/●/◌/!/✖ + state words), the status-bar vocabulary and queue/parked split, the #1115 hint discipline | the landing row consumes the SAME `seatActivity` output for glyphs and state words. What changes is only the row ANATOMY beyond the state — see below. |
| #2804 — "Waiting on you:" per-row rules (held; reads from the #2788 `waiting` derivation) | the top-line plus the per-seat parked rule: question text, age, source discrimination, and the answer-hint naming #2789's op | consumed, not duplicated: the landing row shows a PARKED seat's parked state, and its BRIEF slot reads the parked item's question (the #2804 truncate rule); the answer-command hint stays on the #2804 top-line ONLY, so the row does not repeat it. |
| #2788 — the `waiting` derivation + `status` headline + `queue --waiting` (impl, in flight) | the rig-level derivation the #2804 line reads | the spec is written to work WITHOUT it landing first: every today-surface reads the same queue facts `readRigHealth` already returns (`status:"deferred"`, `deferredTo:"human"`, `item.question`). When #2788 lands, the SAME consumers re-point at the derivation, one line each. Nothing blocks. |
| ROADMAP 124 — show the selected seat's current item (id, subject, body, status) | the requirement; its open calls (block location, cap, 48-floor) are answered here | the REQ splits into two surfaces: the LANDING ROW for every seat (id + subject, `#id` always) and the CONVERSATION HEADER for the selected seat (id + subject + status; the BODY is already the seat's own transcript turns after drilling — no separate body block is added). |
| #2748 (my consultation) + its landed ruling | the "conversation header gains `WAITING ON YOU #74`" idea and the roster's blind-spot fix | SUPERSEDED by #2804/#2788 at the phrase level (one owner now). Doc 1's F3 rule (queue/parked split) is RETAINED verbatim — same numbers, same owner. Doc 1's F4 conclusion (idle="[idle]" dead chrome) is FORMALIZED here: in the landing layout the per-seat streaming blocks are CUT; the streaming fact lives in the ACTION column (§3). |

**One row template, two widths.** The build lands as ONE row template in `src/tui/client.mjs`
(`renderSeatList` and its activity map — the seam where `renderSeatList(seats, null, ...)` was
passing a null), not as a second renderer: narrow (<44 cols) keeps the classic 3-field row the
current code already renders, wide (>=44) renders the landing row. Same source, same glyphs, same
selection rules; the width breakpoint carries across resize (H6's re-layout). pm may fold the
#2826 build with this row change directly.

## 1. The row, in words

    <sel> <state> <name> <queue> <brief> <action>

- **sel** — the selection gutter, 2 cells: `▸ ` for the selected row, two spaces otherwise.
  Selection marker + reverse/bold on the selected row (the existing ``renderSeatList`` treatment;
  NO_COLOR-safe: the glyph carries it in mono). Never dropped.
- **state** — glyph + state word from `seatActivity` — unchanged vocabulary: `○ idle`,
  `● working`, `● generating`, `◌ parked`, `! waiting`, `✖ failed`. Width 13 (word <= 11 cells).
  Never dropped. Never colour-only.
- **name** — the seat name, width 9 (observed rig names fit; >9 truncates by cells with `…`).
  Never dropped.
- **queue** — per-seat queue size, width 9: `12q` normally; `0q · 1p` when the seat also holds
  parked work. Definitions, SAME live-status set the broker counts
  (`queued|claimed|deferred|held`): `q` = queued + claimed; `p` = deferred + held. Always shown
  (rows aligned; zero is fact, not clutter - the #2804 top-line keeps its
  show-when-non-zero rule). Never dropped.
- **brief** — THE BRIEF: `<#id> ` + one truncated field, by cells with `…`:
  the claimed item's `subject` normally; for a parked seat the parked item's `question` (the
  operator triage fact, which is what the landing screen is FOR); `—` (dim) when the seat holds
  nothing. `#id` is never truncated - it is the reference the conversation, the answer op
  (#2789) and the queue dumps share. Rung caps in §2.
- **action** — current action type per §3, width <= 16, FIRST to collapse. Blank when no live
  partial. NOT a duplicate of the state word (see the table; `tool <name>` is the only token
  that carries new information a state word cannot).

**The role column is REMOVED from the landing row.** Reasons: the operator's four asks are all
dynamic facts; the role is static (it moves to the conversation header, where it already renders:
`durig · <seat> · <role> · conversation`), and the current roster already budgets the role first
at the floor (`implementation eng…` is what 48 columns cut today). This is the one place the
landing screen deliberately SHRINKS what the current roster shows.

## 2. The brief, numerically

- cap by CELLS (never code units): 24 at 76–80, 16 at 51–75, 12 below (ladder in §4; every rung
  measured: e.g. at 48 the full row renders 46 cells, brief showing `#74 merge r…`).
- `#id` always shown, never truncated: `#74 `, `#1105 ` (id width = digits + 1; two-digit ids
  leave 8+ cells of subject at the 44-col minimum).
- ellipsis: `…` appended when the field truncates; NO ellipsis for `—` (nothing to summarize).
- the parked-seat brief reads the QUESTION, truncating to the same caps, with the source
  readable in its head text ("supervisor escalation: …" vs a seat question) — the #2804 rule,
  consumed as data.

## 3. The action type vocabulary (agreed with #2826 in one table)

Everything renders from the SAME per-seat live partial the streaming block already renders
(`readRigHealth`'s `streaming[seat]` → `partialView`), so there is no second derivation:

| Token | Data predicate (on the per-seat partial) | Where the same fact already renders |
|---|---|---|
| `tool <name>` | the partial has tool calls: the newest call whose status is not `done` (running `↻` first, else pending `◧`), else the newest call; `<name>` = the call's name as the streaming block renders it (`formatTuiToolName`) | the streaming block's tool rows (`↻ claimed_work`, `◧ write …`) |
| `composing` | the partial has text, no pending/running tool | the streaming block's text body |
| `thinking` | the partial has thinking only (incl. `thinkingRedacted`) | the streaming block's thinking role |
| *(blank)* | no live partial | nothing renders today, nothing renders here |

Rules: token width cap 16 cells, cell-truncated; hidden (blank, not `—`) when no partial; the
token NEVER carries a second state word (a `generating` seat's token says WHAT it generates, not
THAT it generates - the state column already says that); two seats streaming render TWO row
facts, not per-seat streaming blocks — the per-seat streaming SECTION is removed in the landing
layout (its duplicate signal moves into the ACTION column and the roster row that already names
the seat).

## 4. The width ladder (measured; all numbers are `textWidth` output on this snapshot)

Fixed prefix: sel 2 + state 13 + name 9 + queue 9 = 33 cells.

| Width band | brief cap | action | Row verifies |
|---|---|---|---|
| 76–80 | 24 | <= 16 | 74/80 cells (7-seat selfdev rig round with worst-case strings) |
| 51–75 | 16 | <= 16 (8 floor) | exactly 60/60 at the 60-col probe; `tool pow…` truncates |
| 46–50 | 12 | hidden | 46/48 at 48 cols; `#74 merge r…` |
| 44–45 | 12 (>=10 available) | hidden | 44/44 measured - the DECLARED LANDING MINIMUM |
| < 44 | n/a | n/a | narrow roster fallback = the pre-landing row (same source), no broken columns ever |

Under ~30 cols the H6 "terminal too small" truthful state takes over (existing behaviour, not
redefined here). The declared minimum (44) is where the brief's contract break quoted above
(end) holds: `#74 ` plus at least 5 readable cells of subject - a rung below that renders
'#74 me…'-noise, which the floor discipline forbids.

## 5. Selection affordance (unchanged; no redesign)

- Selection keyboard is what ships: `↑↓` (alias `jk`) moves the cursor; `Enter` opens the
  selected seat's conversation (the drill); `Esc` returns; `q` quits; `Ctrl+C` always wired.
- The overlay `i` stays an INPUT OVERLAY on the current view (#1109/ROADMAP 99, landed
  `02f0004`): its chip names the target seat; with a PARKED item the chip names the item as in
  doc-1's flow step 4 (`→ impl · answers #74`) — relation rule: the chip edit belongs to the
  #2789 op landing, not this spec (one owner).
- The frozen #1115 footer hint applies untouched (`q=quit  r=refresh  ↑↓/jk=seat  Enter=open
  i=input`); the landing requires no new key.
- On resize: re-layout at the new width and switch the row template per §4 WITHOUT losing the
  selection or the scroll position (layout state is derived, not stored alongside data).

## 6. Degrade rules

1. **More seats than rows.** The roster is the landing screen's dominant pane. Its row budget =
   height minus fixed chrome (~6 rows: header, rules, bar, footer). Seats beyond the budget
   scroll with BOTH-END indicator rows - the transcript pattern already shipped
   (`↑ N older turns` / `↓ N newer turns (↓ to the live tail)`): "↑ N more seats" / "↓ N more
   seats", and the scroll window follows the selection cursor (j/k past the edge enters the
   window). Rows are virtualized: they render on demand; they do NOT paint all seats up front.
2. **Zero queue.** All rows show their counts (`0q`); alignment beats omission at ROW level, the
   aggregated BAR keeps the #2804 hide-when-zero rule (`queue 4 · parked 2` shown when either is
   non-zero; bare `queue 0` omitted).
3. **Seat with no current item.** brief renders `—` (dim); action blank; state read as usual
   (`○ idle` / `! waiting` style states per seatActivity).
4. **A seat waiting on the operator.** state `◌ parked`; queue shows `0q · Np` (the parked count
   is visible in the row, so "waiting on you" NEVER reads as an idle roster row); brief carries
   the parked question per §2; action is blank (no run exists - a parked seat is not working).
   The #2804 top-line (watch + bar render) remains the owner of the ANSWER hint (per the #2789
   op) and of the fleet-level "waiting on you" cue; rows carry the fact, the top line carries
   the command.
5. **Rig-wide statuses.** attention notices with `seat:null` (metric/fleet notices) never land in
   seat rows - the existing explicit-exclusion rule (`watchview.seatActivity`'s scope filter) is
   REUSED, not re-implemented.

## 7. Acceptance (failing-first, per concern)

- `demo/tui-landing.test.mjs` (new): (a) a parked seat renders `◌ parked`, `0q · 1p`, the
  question brief with its `#id`, and a BLANK action cell; (b) a claimed seat renders its item's
  `#id <subject…>` brief and the `tool <name>`/`composing`/`thinking` token for whichever
  partial the fixture provides, FROM the same partial object the streaming block gets;
  (c) NO_COLOR and monochrome asserts the glyph/word rows; (d) the narrow fallback: at 40 cols
  the SAME map renders the classic row with no columns (proving one template, not two rules);
  (e) selection: cursor + reverse/bold pinned on the selected row; Enter opens the conversation
  (already covered by tui-conversation, re-assert against the landing layout).
- Goldens: 80x24 (full ladder rung) and 44x24 (declared minimum), appended to the existing TUI
  golden set (`demo/tui-golden.test.mjs` fixtures) under ROADMAP 124/101 conventions.
- The `i` overlay, conversation scroll floor, and exit hygiene are existing contracts: do not
  re-spec measured paths; existing suites (tui-input-overlay, ui-driver, tui-restore) must stay
  green alongside the new one.
- qa notes: frame compares at the floor are the OBLIGATORY layer (a substring assertion would
  pass a misaligned row that a buffer check fails - the H7 lesson).

## 8. Evidence recap (one place)

| Claim | Evidence |
|---|---|
| Column ladder numbers | the measured runs quoted above (immediately reproducible read-only):
  `node --input-type=module` probe in the spec text of the row function using
  `src/textwidth.mjs` `textWidth`/`sliceToWidth`; floor strings include a long supervisor
  escalation question, a long seat name (`advocate` = 8 chars), and two-digit ids |
| #2788 not yet on main | `impl-item-2788` branch exists (locked worktree, tip a70fc27); main's
  waiting-related commits to date are decision records (D113/D114) - hence today-facts binding |
| Per-seat partial source | `src/tui/readstate.mjs` builds `partials` from
  `health.streaming[seat]` -> `partialView`, the SAME object the streaming section renders |
| Roster seam | `renderSeatList(seats, null, ...)` — the null makes the extension point explicit
  (doc 1 F1; still true on this snapshot) |
| Frozen hint / overlay floor | the #1115 byte-frozen hints; the `i` overlay fix #1109 landed as
  `02f0004` (in main history) |
| Per-seat queue facts | `health.queueItems` items carry `status`/`deferredTo`/`question`;
  the broker live-status set is `queued|claimed|deferred|held` (`src/broker.mjs` LIVE_STATUSES) |
