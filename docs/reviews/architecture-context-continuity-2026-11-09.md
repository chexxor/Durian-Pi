# Context continuity: notes that survive a forced fresh context

**Status:** delegate design, ready for `pm` decomposition. Not implemented — no code was written by this delegate.
**Milestone:** ensuring LLM task completion (D226), first tranche ROADMAP 331.
**Operator directive this session (2026-11-09):** the priority is to *avoid* context compaction. If a task cannot be
finished inside one context window, the seat must be maintaining notes so it can continue from a fresh context when
the harness forces one. The mechanism must be an **extension**, not a change to the base.
**Host for every number below:** Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
git 2.56.0 — measured with `uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

---

## 1. The problem, as measured

Read-only, no model spend. Reproduce with:

```bash
node docs/evidence/2026-11-08-context-window/milestone-check.mjs
node docs/evidence/2026-11-08-context-window/read-path-probe.mjs --n=2 --timeout=8
```

| Fact | Value | Source |
|---|---|---|
| Compaction attempts in the store | 2,333 | `pi.compaction` task rows |
| Failed | 430 (18.4%) | same |
| "Summarization hit the token limit; the summary is incomplete" | 218 lifetime, 10 in the last 24 h | same |
| Refused by the rig's own run cap before any request was sent | 209, all in one 104-minute burst on 2026-11-07 | same |
| Auditor live context vs its declared window | 106% of 24,576 tokens | `milestone-check.mjs` occupancy leg |
| Seats blocked before any window is reached, by turn shape alone | 9 of 12 `AT RISK` | `tools/seat-turn-shape.mjs` via the gate |
| Queue read payload handed to every reader | 27.9 MB, of which 88% is `done`/`cancelled` history (4,100 + 868 of 5,896 rows) | `cli.mjs status` measured this session |
| Broker read path | CLI reads block up to 120 s (`src/readclient.mjs:35`); the progress leg stalls while the heartbeat keeps beating | `read-path-probe.mjs`, `selfdev.sqlite.broker.log` (28 `PASS-FAILED` entries, all `database is locked`) |

The two failure classes are different and both matter:
1. **The summariser call is the fragile part.** It is a model call against a 24,576-token verifier that is either
   out of budget, rate-limited (429 "Model busy"), or too small for the policy it is given.
2. **Even a perfect summary does not make a task finish.** A window carrying ~100 unrelated queue items and a turn
   shape that refuses the next user turn cannot be rescued by compaction at all.

So "avoid compaction" is the right priority: the note, not the summary, is the unit of continuity.

---

## 2. Prior art: nothing in the pi package set can be installed here

Nineteen packages were surveyed on 2026-11-09 (`pi.dev/packages/…`): `pi-blitz-handoff`,
`@protokol11/pi-session-transfer`, `@codeslinger001/pi-auto-handoff`, `pi-tuck`, `pi-observational-memory`,
`@pi-unipi/compactor`, `@foliox/transparent-compact-pi`, `avtc-pi-session-owl`, `@woksin/pi-context-budget`,
`@monotykamary/pi-vcc`, `@sting8k/pi-vcc`, `omp-vcc`, `pi-soft-compact`, `pi-compact-assistant`,
`pi-cached-compaction`, `@hheei/pi-ext-memory`, `pi-voluntary-compaction`, `pi-context-diet`,
`@rustywelch/pi-fuel-gauge`, `@prjct.app/pi-context-control`, `@neruok/pi-compaction-model`, `pi-vigilant`.

They are all **pi coding-agent** extensions — slash commands, TUI footers, `session_before_compact`,
`ctx.mode === "tui"`. `src/extensions.mjs:19-21` is explicit about the boundary:

> This loads pi-DURABLE extensions. A pi *coding-agent* extension is a different thing (slash commands, a TUI,
> project-trust prompts) and cannot load here: durig depends on `pi-coding-agent` for the durable-TUI merge but
> has no interactive surface of its own (D21). See ROADMAP item 23.

So installing one changes the operator's own `pi` session and never a seat. This is the same conclusion
`docs/reviews/memory-implementation-plan.md` §2 reached for the memory packages under ruling D130; the difference
this session is that the *shape* of the solution is now settled by that prior art rather than invented.

What is worth borrowing, and from whom:

| Shape | Package | What we take |
|---|---|---|
| Structured handoff replaces the lossy summary | `@codeslinger001/pi-auto-handoff` | Goal / Constraints / Progress / Key decisions / Critical context / Next steps, written **as the compaction entry's summary** with the cut point preserved |
| Write the state to a file, then compact with the path | `pi-compact-assistant` | the seat authors the note *before* the boundary; the harness does not guess it |
| Facts vs hypotheses vs constraints, git HEAD collected independently | `@woksin/pi-context-budget`, `@protokol11/pi-session-transfer` | the note's field split, and "verified" meaning *evidence-backed*, not prose |
| Zero-model-call, deterministic summaries + recall over the untouched history | `pi-tuck`, `pi-vcc`, `@pi-unipi/compactor`, `@foliox/transparent-compact-pi` | the summary need not be a model call at all; the raw transcript stays searchable |

Roadmap **176** (`search_history` over the immutable transcript) is the in-repo version of the last row and is
already registered. Roadmap **177** already ruled that typed state is a `defineDoc` family with
`history: "rewindable"` + `fork: "asOf"`, not a SQLite table. Roadmap **175** rules how the note reaches the prompt
(see §5.3). This work is therefore a **fold into 161–177 and O1–O4**, not a new subsystem.

---

## 3. The seams already in the pinned runtime (all verified this session)

`node_modules/@earendil-works/pi-durable/dist/`, the pin durian-pi actually runs (1.3.0):

| Seam | Where | What it guarantees |
|---|---|---|
| `beforeCompact` hook | `dist/harness/compaction.js:82-88` | If an extension returns `{summary}`, `place()` commits it at `:374` and **the summariser request is never constructed** — no cap check, no 429, no truncation |
| Summary wrapping | `dist/harness/compaction.js:12-13, :374` | Whatever we supply is fenced as `…was compacted into the following summary:\n<summary>…</summary>`; the fence is unconditional |
| `harness.reset(handoff, context)` | `dist/harness/harness.js:45-48` | Seeds a fresh context with the handoff as its first user message, **un-fenced** — the only clean structured seed |
| tool `control: {handoff}` | `dist/harness/generation.js:547-557` | Ends a run and continues with the handoff as a user message |
| `section(key, render)` | `dist/harness/define.js:10`, used at `src/rig.mjs:621` (`durig-constitution`) and `src/rig.mjs:1428` (`durig-role`) | A prompt section rendered per request — the mechanism that already reaches every seat |
| `defineDoc` | `src/rig.mjs:23, 31, 39, 54, 103` | Store-backed, commit-scoped documents; already the pattern for the roster, edges, constitution, control and queue |
| paged entry reads | `api.entries(range, limit, cursor)` | Bounded transcript reads, the primitive roadmap 176 uses |
| `src/compacteval.mjs:152` `PROBE_KINDS = ["recall","artifact","continuation","decision"]`, `:204 continuationProbe` | in-repo | The grading instrument for "did the compacted/restarted context still let the seat continue?" already exists |
| `src/context.mjs` | in-repo | Per-seat context consumption with a three-state denominator (`measured` / `declared` / `advertised`) |
| `src/reset.mjs:70` `conv.reset(resetHandoff, context)` | in-repo | The reset boundary is already a shared mechanism with a handoff parameter, used by `cli.mjs reset`, `up --refresh` and the broker spool |

**Conclusion:** the base already has every seam. The work is an extension that uses them, plus one config fix so
the fallback compaction actually resolves (ROADMAP 331, `src/config.mjs:513` emits `out.modelOverrides` as a
sibling of `compaction`, which `dist/harness/compaction.js:196` never reads).

---

## 4. The contract being proposed

### 4.1 Where the note lives

* **Source of truth: a durable store document** — `defineDoc({kind: "durig.notes", scope: "conversation", history: "rewindable", fork: "asOf"})`.
  Chosen because a seat's own files are not durable in the way a note must be: `.durig/` is gitignored
  (`.gitignore:16`), seats work in per-item worktrees (D49), and the rig already has an incident where worktree and
  scratch state were swept (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`). A note that dies with the
  worktree is not a continuity mechanism. It also satisfies ruling D130/R2 (store for seat-written state, markdown
  canonical for human-authored layers) and §5.2 of the memory plan (one writer owns the store).
* **Mirror: a file**, for the seat's own read tools and for humans: `<DURIG_NOTES_DIR>/item-<id>.md`, default
  `<rig root>/.durig/notes/`. Configured through `src/config.mjs` like every other setting, one env var, printed
  in `check` output so the resolved location is never guessed.

### 4.2 What the note contains

The handoff shape the surveyed packages converge on, split so "verified" means evidenced:

```
itemId, seat, asOf
goal            — the item's objective, copied, not paraphrased
verified[]      — each {claim, evidence (path or row id)}
hypotheses[]    — believed but not proven
constraints[]   — operator rulings and gates that bind this item
done            — what is committed, with sha/branch
next            — the single next action
blockers[]      — what cannot proceed, and who owns it
worktree, filesTouched
```

### 4.3 How it reaches the model — bounded, and cache-cheap

Roadmap **175** is the governing constraint: pi-durable rebuilds the prompt from sections before every request and
provider caching is prefix-exact, so a **changing** section can be a full-prefix cache miss on every request. Its
own instruction is "move changing content into the transcript (a tool result or a committed entry)".

Therefore:

1. **Static section only.** A constant `durig-continuity` section naming where the note is and the rule ("if your
   context begins with a handoff, re-read your claimed item before acting"). No variable text in the prompt.
2. **Mutable content arrives at boundaries**, never per request:
   - at **wake/claim** — the existing push channel (`src/driver.mjs:54, 242`), extended to name the note;
   - at **compaction** — `beforeCompact` returns the rendered note as the summary, so the model call disappears;
   - at **reset/handoff** — `src/reset.mjs` passes the rendered note as the `pi.reset` handoff.
3. **Never `{decline: true}`.** Roadmap 176 forbids a competing summariser; the hook writing the summary *is*
   pi-durable's own mechanism, and declining compaction just returns to the same wall later.

### 4.4 Extension plane, explicit loading

`extensions/continuity.mjs`, loaded only through the `DURIG_EXTENSIONS` list (`src/extensions.mjs`), with no
auto-discovery — the trust boundary is already written in that file's header. Per D212, if a piece cannot be
expressed as an extension, that is a missing base seam and the seam grows; two candidate seams are already visible:
`beforeCompact` is reachable but per-seat selection of an extension is not exposed at the seat level, and the note's
mirror path is not yet in the config vocabulary.

---

## 5. Acceptance (all model-free except where stated)

1. **Offline resume test.** `demo/offline.mjs` on `fauxProvider`: `pm → worker → done`, the worker is reset
   mid-item with `resetSeatContext(harness, seat, renderedNote)`, and the item still completes. The test asserts
   the note was the *only* carried state (no pre-reset transcript visible after the boundary).
2. **Zero summariser calls.** A compaction in the offline demo produces a `pi.compaction` entry whose text is the
   rendered note, and no provider request is made for it. Measurable without a model.
3. **The gate exits 0.** `milestone-check.mjs` gains a continuity leg: per seat, "can a fresh context resume this
   claimed item from its note?" plus the before/after truncation and model-call counts (baseline 218 lifetime / 10
   in 24 h).
4. **`compacteval` continuation probes.** Roadmap 97's harness already grades `continuation` probes mechanically
   (`src/compacteval.mjs:204`); run it on a compacted view with the note versus without, and report the delta.
5. **Read surfaces bounded.** `cli.mjs status` / `queue` payload measured before and after filtering terminal rows;
   an oversized read fails with a count rather than hanging the broker.

---

## 6. Risks, and the traps the prior art already named

* **Over-trust in a stale note.** Label injected state as such (the memory research found removing the label
  increases over-trust at every model size). A note is a claim, not a fact, unless it carries evidence.
* **Prompt-cache cost.** See roadmap 175; the static/dynamic split above is the mitigation, and 175's measurement
  is the gate.
* **Store write contention.** The broker owns the store (D42/D45); note writes go through the harness commit path
  only. The 28 `PASS-FAILED … database is locked` entries in `selfdev.sqlite.broker.log` are the warning sign.
* **Notes are not a permission source.** Confinement stays in `src/seatguard.mjs` / `src/writetargets.mjs`, which
  fail closed.
* **Verification stays cross-family** (D48/D119): a note-format change must be verified by a seat of a different
  model family than the one that wrote the fixture, and the fixture should include a deliberately stale fact.
* **Turn shape is still a separate blocker.** 9 of 12 seats are `AT RISK` on the alternating-template predicate
  before any window is reached; notes do not fix that, and the gate should report both legs, not conflate them.

---

## 7. What the team owes, and what only the operator can decide

Team (`pm` to decompose and route):

* the extension itself, the `durig.notes` doc, the `write_note` / `read_note` tools, the static section, and the
  `beforeCompact` summary supply;
* the ROADMAP 331 nesting fix and its test correction (`src/config.mjs:513`, `src/config.mjs:455` docstring,
  `demo/config.test.mjs:333-341` asserts the sibling shape today);
* the continuity leg in `milestone-check.mjs` and the promotion of the delegate probes out of
  `docs/evidence/2026-11-08-context-window/` into `tools/` (row #5789 already queued for that);
* bounded read views for `status`/`queue` (88% of the payload is terminal history).

Operator-only:

* whether the verifier/auditor seat moves to the local family (it is at 106% of its declared window and every
  run-cap refusal in the store belongs to conversation 4936), or whether `DURIG_VERIFIER_MAX_TOKENS` / verifier
  context is raised — both are capacity grants, not delegate actions;
* whether notes are per-project or per-rig (D130/R1 says per project; this rig is one project today).

---

## 8. Reproduce the measurements

```bash
# gate: config resolution, window fit, truncation census, turn shape, live occupancy, broker legs
node docs/evidence/2026-11-08-context-window/milestone-check.mjs
# the config fix's own acceptance probe (prints the resolved reserve per family)
node docs/evidence/2026-11-08-context-window/compaction-policy-probe.mjs
# read-path health, no model, no writes
node docs/evidence/2026-11-08-context-window/read-path-probe.mjs --n=2 --timeout=8
# the pinned seam, read directly
sed -n '82,88p' node_modules/@earendil-works/pi-durable/dist/harness/compaction.js
```
