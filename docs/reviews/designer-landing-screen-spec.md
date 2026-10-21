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
  measured: e.g. at 48 the full row renders 44 cells, brief `#74 merge …` - the clamp, not a demand, sizes the floor).
- `#id` always shown, never truncated: `#74 `, `#1105 ` (id width = digits + 1; at the 40-content floor the clamp leaves 3 subject cells + the ellipsis - the id survives).
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

## 4. The width ladder, RE-DERIVED FOR (a) (the #4300 ruling; derivation commissioned in #4352)

The section keeps the rule it learned in the #3810 rewrite - describe the ladder the code SHIPS, or
one it can be VERIFIED to ship; a spec demand a run does not honor is the exact defect this section
has twice rewritten (#3483, ee495e7) - and the settled shape has moved once more: #4300 ruled option
(a), so the NAME RUNG becomes 10 and the freed cell is spent AFTER the name (the gap between the
name and the queue column lives in the name field's own right-hand padding; there is no separate
separator to remember, the padding edge IS the separator). Nothing in the absorption model changes;
one fixed cell moves, and this section books its cost. Everything below is either MEASURED on the
builder at this snapshot or DERIVED from that measurement plus the one named delta: when impl lands
(a) the new numbers are SUBSTITUTIONS, not further investigations. Until then the shipped builder is
still the (b) state, `node demo/tui-landing.test.mjs` (exit 0 at this snapshot, 37 checks) stays the
acceptance reference, and the pins re-cut per the golden accounting below.

**The denominator, measured once and then trusted:** `renderSeatList` is handed the TERMINAL width -
`renderTui` feeds it `getSize().width` untouched (src/tui/client.mjs) and the 80x24 golden pins rows
of exactly 80 cells (measured: the 80x24 golden's brief is 30 cells = 80 - 33 - 17; the cap rungs
rise at exactly 72/47 TERMINAL columns, the landing floor is 44). The (b) section's two-denominator
table - content cells with a `(terminal in parentheses)` column - is retired by this rewrite: its
parenthetical column ran four cells high against the code it described, and its "handed `width - 4`"
premise has no counterpart in the live path (`renderTui` does not subtract a gutter before the
roster call). One denominator lives on - the builder's own cells, which ARE terminal cells here - so
a code change copies the formula below instead of converting a denominator. The (b) per-band brief
prose that echoed those bands in §2 (`min(12, C - 33)` -> 7..12) retires with the (b) table; §2's
band line re-points at B(w)/R(w) when (a) lands.

**THE DERIVED FIXED PART - 33 -> 34, shown not assumed, every term named (the decomposition impl
#4459 asked for):** sel 2 (the cursor replaces the leading space: selection adds no width) + state
13 (glyph + space + the state padded to 11) + NAME 10 (the rung (a) spends) + SEPARATOR 0 (no
dedicated cell exists between name and queue - the 10th name cell IS the gap; the padding edge is
the separator) + queue 9 = 34. A builder that ADDS an 11th cell for a "separator after the name" has
misread the ruling: there is no second fixed cell to book. The queue rung is not the payer and
cannot be: the parked pole `4q · 175p` fills its nine cells EXACTLY today (measured on `impl` with
175 parked) and the busiest seat must keep reading it whole - the constraint this derivation starts
from. THE CONSTRAINT WAS NEVER TOTAL WIDTH; the cell was inside the row all along, and (a) pays for
it where the row has slack: AFTER the name.

**THE BUILDER CHANGE IS MECHANICAL, TWO LINES:** `nameCol` pad/truncate 9 -> 10 and
`LANDING_FIXED_WIDTH` 33 -> 34 (src/tui/client.mjs). The "+2" reading one might take from the
routing text - "name 9 -> 10 AND a separator AFTER the name" as TWO fixed cells - is killed by the
sum above: it would insert a phantom cell no (a) row has, and at the 44 floor a 35-fixed prefix
would leave the brief 9 cells, one below the floor discipline the shipped ladder asserts. The
"34 -> 35" that #4352's routing text carries is the ACTION-ROOM constant below, not this boundary.

**THE RUNG'S GENERAL FORM (why 10 is exactly sufficient):** rung >= longest seat name + 1.
The seat-name census today tops at `architect` = 9, so (a)'s 10 leaves every CURRENT seat a
one-cell gap and NO seat a glued row; a 10+-cell seat name would re-run this derivation rather
than inherit the number. impl's intersection fixture - a nine-cell name WITH the full parked pole -
is therefore the worst row the census OFFERS: the glued `architect4q · 175p` shape dies under (a),
and no real seat can reproduce it while the invariant holds.

**WHY THE NAME RUNG IS WHERE THE CELL GOES (the #4300 rule, recorded here for future rungs):**
- FIX THE CLASS, NOT THE INSTANCE: a boundary bought in the name field survives ANY column that
  widens later (a longer state word, a new verb, a wider parked form); freeing the cell inside the
  parked form would re-create the collision the first time a third form or a wider count appears.
- CONSISTENCY BEATS COVERAGE - the principle that killed the refuted fourth option (right-align the
  name in a FULL field): it widens the gap on bare rows and vanishes on full-name rows, leaving
  parked rows ambiguous, so the reader cannot learn the rule. A fix that works on some rows and not
  others teaches the operator there is no rule to learn; a uniform gap they can at least work around
  is better than that.
- (a) PAYS IN WORK, NOT IN LEGIBILITY: the rejected alternative compressed the parked pole
  (`4q · 175p` -> `4q·175p`) to buy the same separator - spending legibility on the parked count,
  the triage fact this screen exists for, to recover a one-cell gap on the name. This derivation is
  the work (a) buys; WORK IS RECOVERABLE, a shipped legibility regression is not.

**THE ONE ACTION FORMULA, the constant derived as fixed + separator** (a future rung change
substitutes the fixed value; the constant is never just a number again):

    A(w) = min(16, max(0, w - 35 - R(w))),   R(w) = 24 @ w >= 72 | 16 @ 47..71 | 12 @ w <= 46
    B(w) = w - 34 - (A(w) > 0 ? A(w) + 1 : 0)

35 = 34 fixed + 1 brief/action separator (the (b) constant decomposed the same way: 33 fixed + 1).
R is the brief's RESERVED rung (the (b) `briefCap` band: >= 72 / 47..71 / else, unchanged by (a) -
the brief is not this change's payer) and 16 is the action's own ceiling. A yields 0 by itself below
the 47 band, so no separate hidden rule exists; the code's `max(1, ...)` floor on B only arms below
the 44 landing floor, where no landing row exists. The ACTION_MIN_ROOM mask (the token hides below
9 cells of room) is the §3 show-rule, not a §4 rung: it decides whether the slot PAINTS, never where
it opens - A is the ROOM, the mask is the display.

**The derived runs** (from the formula; each (b) measured value sits one cell to the left):
- 44..46: A = 0; B = w - 34 -> 10..12; the row closes at w exactly. At the 44 floor the brief clamps
  to 10: `#74 merge…` - id + a readable subject head + ONE ellipsis, the id never truncated, the
  floor discipline intact.
- 47..51: A = 0 (the budget cannot open while w - 34 - 16 <= 0); B = w - 34 -> 13..17; action hidden.
- 52..66: A = w - 51 runs 1..15 - the budget OPENS at 52 (was 51); B holds the brief rung at 16.
  PAINT is the §3 mask's call, not this rung's: room < 9 stays blank, so at 59 (A = 8) the slot is
  STILL blank and the slot first paints whole at 60 (A = 9).
- 67..71: A pins at 16 (was 66); B = w - 51 -> 16..20, the brief re-takes the spare.
- 72..74: the 24 rung steals back from the action: A = w - 59 -> 13..15 (visible, intended); B
  holds 24.
- 75..: A = 16 again (75 - 59 = 16); the brief absorbs unboundedly to its 24 cap; the row closes in
  the frame at EVERY width (fixed + (A > 0 ? A + 1 : 0) + B = w by construction - the invariant the
  demo sweeps 40..100).

**The landmark moves with the rung:** 60 (was 59) is where a nine-cell token first fits whole
(34 + 16 + 1 + 9). At 59 NOTHING truncates and nothing fragments: the room is 8, one cell short of
§3's ACTION_MIN_ROOM, so the slot ships BLANK - a blank is the honest 8, an eight-cell fragment is
not (that reading is the #4233 mask, unchanged by (a)). One cell, one paint-rung, one substitution.

**GOLDEN ACCOUNTING - the count, and the rule that catches a lying golden:** the acceptance
reference is `node demo/tui-landing.test.mjs`: 37 checks, exit 0 at this snapshot (measured by
counting the `ok` lines), of which exactly THREE pin a row LITERALLY (the 80x24 golden rows 1-3;
the "pins the three seat rows" check above them asserts only the row COUNT). The name cell and the
fixed prefix sit LEFT of both the brief and the action cell in every pinned row, so a one-cell
fixed-part change repaints every pinned string; the DERIVED projections impl re-pins at land time
(verified arithmetic on the (b) builder with name 10 / fixed 34 / constant 35 only):

    "▸ ● working    impl      2q       #74 merge the carry stack on… tool complete_w…"
    "  ◌ parked     qa        0q · 1p  #92 supervisor escalation: w…                 "
    "  ○ idle       advocate  0q       —                                             "

(under the terminal-80 arithmetic the brief cap is DERIVED, so it reads w - 34 - 17 = 29: the fixed
part took the cell, the brief keeps the books, nothing "absorbs" the (a) cell twice.) The other 34
checks are presence-and-invariant assertions - state words, queue counts, substring content, the
44/48-floor presence bounds, the 40..100 no-overflow sweep, NO_COLOR, selection, degrade - which
the rung change does not touch by construction AND which must stay green; a red invariant after
(a) lands is a regression no re-pin excuses. THE FALSIFIER: a pinned literal that does NOT move
when the fixed part changes by one is not asserting the layout - query it at land time, do not
silence it.

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
