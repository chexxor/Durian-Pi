# Designer consultation — the intuitive user flow for the multi-seat TUI

**Status:** consultation delivered; a proposal for pm to sequence and lead/operator to rule on.
Not a ruling, and not yet implementation intent. Item: #2629 (re-registration of the cancelled #2103).
Evidence collected 2026-10-19 against `designer-item-2103` (my seat snapshot; isolated worktree): a render
of the parked-seat roster; identical probes at 80x24 / 60x20; `npm run test:tui` 16/16 green baseline at
the same snapshot. Where HEAD disagrees, HEAD wins — function names are cited so it is re-checkable at
any rev.

**Skill basis:** `skills/tui-design/SKILL.md` — `classify product shape`, `apply the clutter audit and
pressure-test the floor to EVERY layout`, plus its review order (#4 action discoverability, #5 clutter,
#6 the floor).

---

## 1. The user loop this surface must serve

The distro test: a first-time operator who has never read `docs/BROKER-ARCHITECTURE.md` should be able to
sit at `durig ui` and, in one glance at the roster, answer five questions — and learn internals only for
an edge case:

1. **Who is doing what?** (the roster's whole job)
2. **Who is waiting on ME?** (a blocked seat is the only state the rig cannot resolve by itself)
3. **Where is the live action?** (which transcript to read now)
4. **How do I steer?** (say something to a seat, from the same screen)
5. **How do I leave safely?** (terminal restored; nothing half-sent)

The architecture-learner's path stays: an operator who *must* answer "which item did the supervisor
escalate, and from which inversion?" reads `durig queue`, `status` JSON, and the runbooks. That is fine.
What is not fine is that today question 2 — the highest-priority one — is answerable from none of the
human surfaces except the `watch` dashboard, and from the TUI it is largely **invisible**.

## 2. What exists (grounded inventory)

- **CLI surface:** 21 verbs in `cli.mjs` USAGE (`resume`/doctor and `reset`/clean are alias pairs), one JSON document per command (D21). `status` prints JSON
  only — `cmdStatus` calls `out({...readRigHealth})` with no `--human` renderer. `watch` has the human
  renderer (`--json|--human`); on a TTY, human is the default.
- **TUI:** `ui.mjs` is a full-screen session (alt screen, D69): exactly two views (seat list,
  conversation) plus one input overlay (`i`), key anchors `q/r/↑↓/Enter/Esc/G/End/i` byte-frozen by the
  #1115 footer contract. Clean-up on every exit path is done (H2: `uncaughtException`/`unhandledRejection`/
  `exit` handlers restore to `src/tui/restore.mjs`).
- **Attention machinery:** `src/attention.mjs` derives the kinds; `computeAttention` produces
  `deferred_awaiting_answer` etc. The `watch` renderer (`seatActivity` in `src/watchview.mjs`) already
  maps every kind to a glyph, a state word, and a focus line. **The TUI does not use it.** That single
  gap is most of the finding below.
- **Escalation machinery:** `src/supervisor.mjs` auto-parks on the human after 15 min for a question
  parked on a seat (`DEFERRED_TO_SEAT_MS`) and for repeated-failure streaks — via the same defer
  representation (`status:"deferred"`, `deferredTo:"human"`, a `question` text), so "waiting on the
  operator" is **one fact in the queue model with two sources** (a seat's own question; a supervisor
  escalation). Any surface design must show both alike.

## 3. Findings, ranked by user harm (each one reproduced on this snapshot)

### F1 — The roster (the surface a multi-seat user watches) shows no seat state at all

In the seats view, the client renders `renderSeatList(seats, null, ...)` — the activity map is literally
`null`, so every seat row is `○ <name> <role>` with an empty focus cell, regardless of what that seat is
doing. A seat with a question parked on the human renders identically to an idle seat. Reproduced frame
(impl holds `#74 status=deferred deferredTo=human`; the parked state actually present):

    0|  durig · 2 seats · TUI
    1|  ────────────────────────────────────────────────────────────────────────────
    2|  ○ designer CLI surface and UX… 
    3|  ○ impl     implementation eng… 

    (quoted verbatim from a renderTui run; impl also had `{id:74, to:'impl', status:'deferred',
    deferredTo:'human'}` and the matching `deferred_awaiting_answer` notice)

The operator's most important question — is anyone blocked on me? — is not answered by the surface that
was built to answer who-is-doing-what. Meanwhile the vocabulary exists and is correct
(`src/watchview.mjs seatActivity`: `○ idle` / `● working|generating` / `◌ parked` / `! waiting` /
`✖ failed`, with a focus line that names the item). The TUI roster is not missing data; it is missing the
render of data it already receives (`health.queueItems`, `health.attention` are on the state object it
paints).

**This is finding #1 because it is the difference between the TUI and a seat-list screenshot.**

### F2 — The status bar speaks internal vocabulary, then collapses at exactly the bar's job

`renderStatusBar` appends up to three attention entries as raw kind tags — `[deferred_awaiting_answer]`,
`[repeated_failure]` — no seat attribution, no detail, `scope:"rig"` entries mixed in beside per-seat
ones. At 60 columns the same bar renders:

    ── seats: 7  │  queue: 4  │  uptime: 12m  │  [deferred_awaiting_ans…  │    │   

two facts gone: the kind tag is truncated to an unreadable fragment, and the part that can no longer
provide a line prints as an **empty slot** (see below/F5). The bar is the wrong shape twice:
- Public vocabulary: `[deferred_awaiting_answer]` is the source-code noun (snake_case of the kind
  constant), not a user phrase. The user phrase is in `attention.mjs`'s own detail string and in
  `watchview`'s focus line — "parked on #74 waiting on human". The TUI chose the string the other two
  surfaces translate.
- No attribution: 90% of what an attention tag should tell you on a **multi-seat** rig is WHICH slot.
  `watch` says `impl parked on …`; the TUI bar says `[deferred_awaiting_ans…]`, applied to nobody.

(Kind strings are user-visible contract too — `status` JSON exposes them — so the probe-sheet owes the
naming change a JSON-contract note; see §5.)

### F3 — Parked work is silently counted as "queue"

The same frame reports `queue: 4` where 2 of the 4 non-terminal items were parked on the human. The rig
therefore reads **busy** (4 things going) when it is in fact **blocked** (2 going, 2 waiting on you).
`watch` already fixed this class: its footer counts parked only as a separate `deferred` segment, shown
only when non-zero (the ROADMAP 5 write-up). The TUI bar never learned the split. Propose the same rule
verbatim (§4), not a new one — one counting rule, three surfaces.

### F4 — Dead chrome: the streaming section renders when there is nothing to show

With nothing streaming, the seats view still prints:

    ── streaming ──
      [idle]

Clutter audit, countably: a section header + a placeholder line, 2 rows every frame, encoding zero
signal ("idle" is already what `○` on every roster row says). The self-contradiction is exactly the
skill's "markers present on every row mark nothing". Cut the header and the placeholder both when no
partial has content; the section's absence IS the idle state, and at a small pane those 2 rows pay for a
scroll line of transcript. (The streaming row when active is fine: one labelled block per active seat —
the seat label is doing real work there.)

### F5 — An empty status-bar cell is printed *inside* the divider

From the same 60-column run, after the truncated tag: `│    │` — an empty part where a piece could not
fit produced `""` and was joined in, so a slot was drawn for information that does not exist. One-line
rule for the painter: never emit a slot whose content is empty. (Found by the floor run; filed here so
the painter rule and the F2 copy change land as one status-bar concern.)

### F6 — The zones that must survive the redesign (verified good; do not break)

- **The conversation view is right at the floor.** At 60x20 the header, both scroll indicators
  (`↑ 24 older turns` / `↓ 5 newer turns (↓ to the live tail)`), and the byte-frozen hint
  (`Esc=back  ↑↓=scroll  G=tail  i=input  q=quit` = 44 cells, fits whole at 48) all render by design,
  not luck (guarded by the #1115 golden). The flow redesign must keep this.
- **The answer loop end-to-end is real** for both roles (steer a seat mid-work, or answer its parked question): `durig ui` `i` → `writeIntent` spool →
  broker drains the spool first per pass (`drivePass` comment) → the seat sees the message as operator
  input. Bounds are respected (D11/D68 and the input's paste discipline).
- **Exit hygiene is done** (H2: every path restores; restore errors print after the cause). The flow is
  free to assume a safe exit is always one `q` away.

### Reproduce all of the above (read-only, no store needed)

    node --input-type=module -e "import {renderTui,frameToLines} from './src/tui/client.mjs'; \
      const seats=[{name:'impl',role:'implementation engineer'}]; \
      const health={seats,attention:[{scope:'seat',seat:'impl',kind:'deferred_awaiting_answer',
      detail:'1 item(s) parked on a question; #74 waiting on human'}],uptime:1200}; \
      const queueItems=[{id:74,to:'impl',status:'deferred',deferredTo:'human'}]; \
      console.log(frameToLines(renderTui({seats,health,queueItems,width:80,height:24})).join('\n'))"

## 4. The proposal — one flow, one vocabulary, no new keys

Principle: **the TUI renders the same vocabulary `watch` already renders.** No invented glyph table for
the TUI, no separate vocabulary: a user who learns which row means what on one surface reads the same state
from any surface. `seatActivity` is the single render rule — the change is to `renderTui`'s seat-list
call, nothing else about the state model.

### The flow (what the user does, button by button)

1. **Glance** — the roster is the dashboard. Every seat row carries the real state:
   `●` working or generating (the focus cell shows the item id) plus a labelled streaming block when live, or
   `◌ parked on you: #<id>` — the state words come from `seatActivity`. The row's focus cell shows the human phrase:
   `parked on #74 — which branch is authoritative?` — the item's *question text*, which exists in the queue
   model (`rig.mjs` sets `item.question`) and today appears on no human surface.
2. **Notice** — the status bar leads with the things only the operator can fix. Replace the three
   `[kind]` tags with ONE phrase listing the operator's open obligations first
   (`impl parked on you: #74 · lead failed x3`), then up to 1 generic notice slot at narrow widths
   (drop the rest; the roster rows already carry per-seat state). Split the count:
   `seats: 7 │ queue 2 · parked 2 │ uptime 12m` — the watch footer's rule, adopted verbatim.
3. **Drill** — Enter on a seat opens its conversation unchanged (D69). For a seat parked on the human,
   the conversation header gains one trailing phrase naming the obligation:
   `durig · impl · conversation · WAITING ON YOU #74` — so the operator who drills from the roster
   doesn't need another look elsewhere to know why the seat is parked.
4. **Steer/answer** — the `i` overlay continues to be the single input row. When the focused seat has a
   parked item, the input chip names the item it will resolve: `→ impl · answers #74` instead of
   `→ impl`. No new key, no new view: the send still routes the same `writeIntent` spool with the same
   content, and the seat-side resume stays as designed. The item-naming is a *surface* change; whether a
   structured tag rides the intent is the architect sibling's decision (#2699, A1/A2).
5. **Leave** — unchanged (`q`; `Esc` twice; the H2 restore paths). Healthy, no change proposed.

Posture notes per the skill:

- **Keyboard reachability:** every proposed surface has keyboard presence by construction (roster rows,
  bar phrases, hint line); no mouse promised, none needed.
- **Color independence:** the glyph vocabulary carries the sense in NO_COLOR (`watch`'s words do the
  same), so the proposal adds zero color-only states.
- **Clutter audit outcome:** the redesign adds one phrase to the header of a parked-seat conversation
  and changes the status bar's content rules; it nets out the redundancies it removes
  ([idle] pair, empty divider slot) — net chrome rows just below the current.

### Floor: which pane wins at 80x24 and in a 60-column split

Measured on this snapshot (7 seats, 1 parked roster, streaming impl, transcript preview):

| Width | What fits | What hides | What truncates |
|---|---|---|---|
| 80x24 | everything (21 lines rendered against 24) | — | role text > 20 cells in roster rows (already budgeted: the role column caps at 20 cells with an ellipsis) |
| 60x20 | same shape (fits whole) | — | kind tags as `[deferred_awaiting_ans…` (the F2 copy change removes the tags that TRUNCATE); question text in a parked row truncates by cells with `…` |
| <=48 | same shape still fits (20/24 lines rendered with 7 seats at 48x24) | - | kind tag collapses to `[deferred_…`; the #1115 hint cuts from the right (`i=in…`) — measured, already guarded by goldens |

The ruling to demand BEFORE this lands (open rulings G1–G4 in TUI-IMPLEMENTATION-PLAN): at narrow
floors, if the phrase line and the count split cannot both fit, **the phrase wins** (it is the only
member of the bar whose loss obfuscates a blocked rig). This is the one behavior claim in this doc that
needs lead sign-off; the rest is vocabulary reuse and simplification.

### What this proposal does NOT touch

- **The JSON contract** (D21). `status` stays one JSON document; kind strings stay as-is there. The
  phrases live on the TUI/watch renderers only. (Done deliberately so `metrics` and `check` can
  keep keying on the same attention kinds.)
- **The screen model.** D69 stands for the flow; no alt/main re-litigation rides on this proposal.
- **Write discipline.** No new store path, no second writer: the input overlay spools intents; the bar
  and roster stay read-only views of `readRigHealth`.

## 5. What pm/lead should sequence next (proposer's non-binding suggestion)

1. Reuse `seatActivity` in the TUI seat list (the F1 change and biggest win; one demo failing-first:
   a parked seat's roster row carries the glyph + question focus, asserted framing at 48 and 80 cols).
2. Status-bar replacement (F2+F3+F5, one concern: roster + bar vocabulary): same demo pattern with a
   60-col golden asserting the parked phrase wins the bar and emits no empty slots.
3. The dead-streaming cut (F4) — a small render change, trivial tier; a frame at reduced height asserts the
   section's absence when idle.
4. The answer-affordance's TUI side depends on doc 2 (item #2699)'s decision — wait for the
   architecture half's ruling before wiring the chip's item naming.
5. Keep the G1–G3 open rulings out of this: they predate it and have their own owners.

## 6. Evidence recap (one place)

| Claim | Evidence |
|---|---|
| Roster shows no state | `renderSeatList(seats, null, ...)` seats view render; frame quoted in §3 F1 |
| `[idle]` prints when idle | same run, §3 F4 |
| Empty status-bar slot at 60 | same run at 60 cols, §3 F2/F5 |
| Vocabulary already exists | `src/watchview.mjs` `seatActivity` (glyph table + focus strings) |
| Question text exists but is nowhere | `rig.mjs` defer handler sets `item.question`; surfaces print count/id-only (`attention.mjs` detail) |
| Supervisor escalations use the same shape | `src/supervisor.mjs` (`DEFERRED_TO_SEAT_MS`, same defer representation) |
| Conversation floor is good | 60x20 conversation render, §3 F6 |
| No suite regression | `npm run test:tui` 16/16 at this snapshot |
