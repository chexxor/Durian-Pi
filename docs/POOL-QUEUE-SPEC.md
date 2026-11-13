# Spec — the pool: one authoritative team queue, specialisation as a predicate, work sized to the window

**Milestone:** **N19 — The Pool** (`docs/MILESTONES.md`). **Decision:** D275. **Operator approvals:**
2026-11-12, SIX design questions answered, then THREE follow-up answers on 2026-11-12T22:3xZ — all nine are
recorded verbatim in D275 and §9 here; §9 is the authority when this document and a summary disagree).
**Status:** SPEC ONLY. No code is written. `main` at the time of writing is `571094d7` — `origin/main` is
`792445d5`, so this spec's own commit is local and unpushed. **Intended reader:** **a fresh context running a
DIFFERENT LLM model, and NOT a member of the team.** It is not a seat: it has no capabilities, no queue row,
no roster entry and no presence the broker can wake, so it cannot claim this work through the pool it is
building. It implements by editing files and running the demos, exactly like an operator-side delegate.

**Host for every number in this document:** Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0. Probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

---

## 1. Goal

**A seat takes its next piece of work from ONE queue that the whole team shares, gets only work it is
specialised for, and can always finish what it takes inside one context window — splitting it when it
cannot.**

Success is measurable in three numbers, all already instrumented:

| criterion | today | target | probe |
|---|---|---|---|
| work rows that any eligible seat can pull (not addressed to one seat) | 0 | the majority of new work | `cli.mjs queue --json --no-body` → the `pool` line (`pool.pooled`) |
| work rows claimed by a seat OTHER than a fixed owner | 0 (impl holds 380 of 796 queued) | spread across eligible seats | the `pool` line's `claimed`, and the rows themselves by `to` among `pool === true` |
| rows that exceed a claimant's window and are taken anyway | unmeasurable (tier is recorded, never enforced) | 0 | a check rule over `tier` × claimant window |

**Non-goals (do not build these in N19):**

- **A seat skill store.** The operator approved "capabilities are assigned only" — a seat cannot earn
  eligibility by building a skill. That is a later, separate build.
- **A second queue document.** The queue is ONE document; see P7.
- **Notices retention (#7279).** Adjacent and a prerequisite for *counting*, not for this mechanism.
- **Changing the paused lifecycle goal.** It stays paused; do not resume it.

---

## 2. Measured baseline (re-measure; do not trust these numbers)

Taken 2026-11-12T21:5xZ from `DURIG_DB=./selfdev.sqlite node cli.mjs status --json` and
`node cli.mjs queue --json --no-body`:

```
census: done 4848 · cancelled 1091 · held 342 · deferred 431 · claimed 17 · queued 796
queued by recipient: impl 380 · devtools 160 · pm 151 · scribe 75 · qa 20 · architect 5 · lead 3
queued notices: 277 of 796  (2854 notices exist in total)
queued age: median 0.6 d, oldest 2.5 d, 552 under 1 d
4 h ledger: closed 53 (13.9/h), opened 90 (23.7/h) → backlog GROWING
```

The number that motivates the milestone: **`impl` alone holds 380 of 796 queued rows**, because every
row must be addressed to a seat. A shared queue does not add capacity; it lets the other seats take work
that is currently parked behind one seat's attention.

---

## 3. What already exists (build on it; do not re-invent)

| capability | seam | state |
|---|---|---|
| eligibility predicate | `workable(item, seat, {items, capabilities})` — `src/rig.mjs:350` | exists; gates on `requires` + `blockedBy` |
| send-time enforcement | `assertSendAllowed(tx, from, to, requires)` — `src/rig.mjs:82` | exists; `requires` + `Edges.maySendTo` |
| pull-from-queue with order | `selectNextWork(items, seat, {capabilities, strategy, directive})` — `src/rig.mjs:389` | exists; filters `candidate.to !== seat` |
| work size | `RATCHET_TIERS = ["trivial","small","feature","project"]` — `src/rig.mjs:672`; raise needs a stated reason, only a party to the task may re-tier (`:888`) | exists, **recorded but never enforced** |
| specialisation → tools | `toolRemovalsFor(seat)` / `seatIsCoordinator(seat)` — `src/seattools.mjs:290–340` | exists |
| routing restriction | org graph `Edges.maySendTo` — `src/rig.mjs:86` | exists |
| context accounting | `declaredContextWindow` (`src/config.mjs`), `contextConsumption` (`src/context.mjs`), degeneration trip at `min(fraction×window, ceiling)` (`src/degeneration.mjs:213–224`) | exists |
| one write path | `enqueueItem(...)` — `src/rig.mjs:498` | exists; 12 positional args |

**Not present anywhere:** a pool recipient, `requires` as a set, any enforcement of `tier`, a `split`
closure, or a seat skill store (`.agents/skills/` holds three *delegate* skills; `src/*.mjs` has none).

---

## 4. Data model

One new field, two changed semantics, no new document.

```jsonc
{
  "id": 7601,
  "from": "pm",              // author; the DONE notice returns HERE (owner-of-record is `to`)
  "to": null,                // null while pooled; set to the claimant at claim time
  "pool": true,              // NEW: claimable by any seat whose capabilities satisfy `requires`
  "requires": ["landing"],   // CHANGED: a SET with AND semantics (was: one string)
  "tier": "small",           // UNCHANGED: latched per task; now ENFORCED at claim
  "status": "queued",
  "blockedBy": [],           // UNCHANGED
  "closedAs": "split"        // NEW, only on a split parent (status stays "cancelled")
}
```

**Compatibility (load-bearing — every existing row must keep its meaning):**

- `requires` **string** reads as a one-element set. Reason strings must stay byte-identical for a single
  requirement: `requires:landing`. Six existing demos assert that string.
- `pool` absent means **not pooled**; `to` is then mandatory, exactly as today.
- `tier` may be absent; an untiered row is not size-gated (absence ≠ unknown, per the `requires`/`block`
  precedent at `src/rig.mjs:492`).
- Do **not** add a status literal for `split`. `status` keeps its closed set (`queued|claimed|deferred|
  held|done|cancelled`); the split is recorded as `closedAs: "split"` plus a `split` transition. There are
  ~30 status-literal sites in 11 files (queue-lifecycle review F6) — a seventh literal is a seam, not a
  feature.

---

## 5. Invariants (the testable core)

**P1 — Eligibility is a predicate, never a preference.** A pool row may be claimed iff
`workable(row, seat, {items, capabilities})` is true. That predicate checks status, `requires`, and
`blockedBy` — and nothing else. Choice ranges over the eligible set only.

**P2 — `requires` is a set with AND semantics.** A claimant must advertise **every** named capability. A
partial match is the failure this milestone exists to prevent. An empty set means "any capability profile".

**P3 — A capability is never granted by taking work.** `requires` can only name a capability the seat
already holds. No claim path may add to `capabilities`; the only writers are the operator and `pm` (via the
seat roster). Enforce with a check rule, not a comment.

**P4 — Permissions travel with the seat, not the row.** `src/confine.mjs` confines by root and cwd. A pool
row must not become a privilege-escalation path: a seat that cannot write outside its roots cannot acquire
that ability by claiming a row.

**P5 — Ownership is recorded, not routed.** On claim of a pool row, `to` becomes the **owner-of-record**;
`from` stays the author, so the DONE notice returns to `from`. `pool` stays `true` (reporting and census
need to know the row was pooled), and a `pool-claimed` transition records the pair.

**P6 — Work is sized to the window, and the seat may not start what it cannot finish.** Two levels:
  **P6a (structural, at claim):** if the row's `tier` estimate exceeds the claimer's usable context, the
  claim is **refused** with a decompose instruction (see §6.3).
  **P6b (procedural, at turn start):** the claimant enumerates and estimates; if the total exceeds **70 %
  of the working budget**, it does not start — it emits a plan and splits. This rule is already written
  down and research-backed: `docs/reviews/ensuring-llm-task-completion-research.md:64`.

**P7 — One document.** The queue is a single durable document materialised every broker pass
(`src/rig.mjs:202`, re-paid at `src/broker.mjs:1052`, measured 10.4 MB). The pool is a **view over the same
rows**, never a second document.

**P8 — A row leaves the pool for a NAMED cause only.** `done` · `cancelled` (+reason) · `split`
(`closedAs`) · `superseded` (row #/sha evidence). This mirrors the merge-queue rule recorded in
`docs/runbooks/research.md`: removal has named causes, and a stale candidate is re-gated, never silently
dropped.

**P9 — Size never lowers silently.** Tier is latched per task (existing rule); a split records child tiers
and leaves the parent's tier unchanged, so the ratchet history stays readable.

---

## 6. Interfaces — exact changes

### 6.1 `src/rig.mjs`

```js
// NEW, near workable():
export function requiredCapabilities(requires) -> string[]   // string -> [string]; array -> deduped; else []
```

- **`workable(item, seat, opts)`** — replace the single-string check with:
  `missing = requiredCapabilities(item.requires).filter(c => !capabilities.includes(c))`;
  return `{ workable: false, reason: \`requires:${missing.join(",")}\` }` when non-empty.
  A single missing capability must still render `requires:landing`.
- **`assertSendAllowed(tx, from, to, requires)`** — `to === null` means a POOL send: skip `seatId` and the
  per-seat edge check, still validate `from` exists; when `to` is a seat, check every required capability.
  Keep the single-capability message shape (`lacks required capability "x"`).
- **`enqueueItem(...)`** — add a 13th positional param `pool = false`; normalise `requires` via
  `requiredCapabilities` and store it when non-empty; store `pool: true` when pooled.
- **`selectNextWork(...)`** — the candidate filter becomes
  `if (candidate.status !== "queued") continue; if (candidate.to !== seat && candidate.pool !== true) continue;`
  Eligibility stays in `workable()`; do **not** duplicate any gate logic in the selector (the header at
  `src/rig.mjs:378` explains why).
- **`claim_work`** — two paths (named `itemId`, and strategy-picked). Both must handle a pool row, and both
  must then set `to = me`, keep `pool: true`, and push a `{event: "pool-claimed", by: me}` transition
  **inside the same commit** (P5). A named claim of a pool row must be refused if `workable()` says no —
  the same reason string, so the seat learns why.
- **`send_work` args** — `to` becomes optional; add `pool: opt(bool())`; `requires` accepts
  `union([str(), arr(str())])`. Refuse both `pool` without `requires` being honest about it? **No** —
  an empty set is legal ("anyone"). But refuse: `pool: true` **with** a `to`, and no `to` without `pool`.
- **`queueItemLine`** — render `POOL` for a pooled row (and `OWNER=<seat>` once claimed) so a seat reading
  its own queue view sees why it can take the row.
- **`complete_work`** — accept a split outcome for a pooled/large row: write `status: "cancelled"`,
  `closedAs: "split"`, `cancelReason: "split into #a, #b"`, and a `split` transition with the child ids.
  Children are enqueued in the same commit with `from = the splitter`, `requires` inherited, `tier` set per
  child, and a `blockedBy` chain if the children are ordered.

### 6.2 Size model (P6a)

A tier→token table, in config (not code): `DURIG_TIER_TOKENS` as JSON, with **proposed starting values**
(these are DEFAULT guesses, not measurements — calibrate them against `selfdev.sqlite.spend.jsonl` before
relying on them):

| tier | estimate (tokens) | rationale |
|---|---|---|
| `trivial` | 4 000 | a one-file edit plus its test run |
| `small` | 12 000 | a demo + a source file |
| `feature` | 40 000 | several files, a demo, a gate run |
| `project` | 120 000 | **exceeds most seat windows → must be split** |

**CALIBRATION IS A PREREQUISITE, NOT A FOLLOW-UP (operator-approved 2026-11-12).** The four values above are
PROPOSED DEFAULTS, not measurements, and a wrong `feature` estimate silently blocks real work — the failure is
invisible because a refused claim looks like an unlucky start. Before build row 5, derive the table from
`selfdev.sqlite.spend.jsonl` (per-item tokens where the ledger records a claim, aggregated per tier) and commit
the measured numbers WITH the derivation command in the config's comment. If the ledger cannot answer it for a
tier, say so and keep that tier's default explicit rather than interpolating.

Usable window = `declaredContextWindow(seat) − DURIG_COMPACTION_RESERVE_TOKENS − DURIG_COMPACTION_KEEP_RECENT_TOKENS`.
Note the measured trap: the compaction defaults (reserve 16 384, keepRecent 20 000) are **larger than a
24 576 verifier-class window**, so usable can be ≤ 0. The gate must therefore report "no usable budget
declared" rather than dividing by it.

### 6.3 Context gate (P6a) and decomposition (P6b)

- **Claim time:** if `tierTokens(row.tier) > 0.7 × usableWindow(claimer)` → **refuse** the claim with:
  `tier <t> ≈ <n> tokens exceeds 70% of your usable window (<m>); split it: send_work the pieces with
  requires=[...] and close this row with complete_work(itemId, closedAs="split", children=[...])`.
  A refusal is a *measurement*, not an error: record it as a `size-refused` transition so the row shows why
  it keeps being passed over.
- **Turn start:** the seat's own estimate is the P6b rule; the tool cannot enforce reading, only the
  refusal above. Do not add a second estimate handshake (P6b is already written down).
- **Pool-level warning:** if a row's tier exceeds the **smallest** declared window in the roster, `status`
  must say so (`pool: too-big-for-<seat>`), so a `project` row is visibly big-work-only rather than
  invisible to half the fleet.

### 6.4 Census, check, and attention (make it legible)

- `status --json` / `queue --human`: report `pooled` count, `pool-claimed` count, and `size-refused` count
  separately from `to`-addressed rows.
- **Check rule (new, number assigned at land time):** a pooled row whose `requires` names a capability
  **no seat advertises** is unclaimable forever — report it (this is the pool's version of the dead-gate
  rule #6215).
- **Check rule:** a seat that claims rows whose `requires` it does not advertise must be impossible; assert
  it via the invariant, not by scanning history.

---

## 7. Build rows, in dependency order

Each row is independently landable and has its own fast loop. Costs are the measured order of magnitude for
that kind of change on this box; **re-measure, do not quote these as fact**.

| # | row | files | acceptance | verify (fast loop) | est. |
|---|---|---|---|---|---|
| 0 | **calibrate `tier → tokens` from the spend ledger** (prerequisite, §6.2) | `src/config.mjs` or config | each tier's number is backed by a ledger query + the command is in the comment; tiers the ledger cannot answer keep an explicit default | the derivation command itself, re-runnable | ≤ 10 min |
| 1 | `requiredCapabilities()` + `workable()` set semantics, string compat | `src/rig.mjs` | single-string rows behave byte-identically; a 2-set demands both | `node demo/workable-claim.test.mjs` + new case | ≤ 60 s |
| 2 | `assertSendAllowed` accepts a set and a pool target | `src/rig.mjs` | a seat missing ONE of two caps is refused, message names it | `node demo/send-work.test.mjs` (or nearest) | ≤ 60 s |
| 3 | `enqueueItem(pool)` + `send_work` args (`pool`, set `requires`, optional `to`) | `src/rig.mjs` | pooled row stores `to:null`,`pool:true`; bad arg shapes refused | new demo `demo/pool-address.test.mjs` | ≤ 90 s |
| 4 | claim: pool candidate in `selectNextWork`, owner-of-record on claim, `pool-claimed` transition | `src/rig.mjs` | a seat with the cap claims a pool row and `to` becomes it; a seat without the cap is refused with `requires:`; the DONE notice goes to `from` | extend the same demo | ≤ 90 s |
| 5 | tier→token config + claim-time size gate + `size-refused` transition + pool too-big warning | `src/rig.mjs`, `src/config.mjs`, `src/checkup.mjs` | a `project` row is refused for a 24 576-window seat with the split instruction; a `trivial` row is not | new demo `demo/pool-size-gate.test.mjs` (pure function, no store) | ≤ 60 s |
| 6 | `complete_work` split closure + child enqueue | `src/rig.mjs` | parent is `cancelled`+`closedAs:"split"`+`split` transition; children inherit `requires`/`from`/tier | extend the size-gate demo | ≤ 90 s |
| 7 | census surfaces (`pooled`, `pool-claimed`, `size-refused`) + the two check rules | `src/readapi.mjs`, `src/checkup.mjs`, `src/seatsummary.mjs` or equivalent | `status --json` carries the three counts; a pooled row with an unadvertised capability fails `check` | `node demo/test-areas.test.mjs` + `check --json` | ≤ 120 s |
| 8 | docs: `docs/WORK-ITEM-MODEL.md` §pool, `docs/FEATURES.md` row, this spec's §9 reconciled | docs | the queue model states pool/owner-of-record/`requires` set/size gate | `node demo/clockin-digest.test.mjs` **if** NEXT.md changes | ≤ 30 s |

**Landing discipline:** `scripts/land.mjs` is the gate; never land a red tree; run the area of the diff, not
the whole suite by reflex (`node scripts/test.mjs --area <area>`), and `node demo/test-areas.test.mjs` for
any new demo. Register every new demo in `demo/test-areas.json` — its contract is bidirectional ("every
listed file must exist"), so a mapping cannot be pre-added on `main`.

---

## 8. Risks and their mitigations

| risk | why it bites | mitigation |
|---|---|---|
| **~30 status/recipient literal sites** (queue-lifecycle F6) | `to` becomes nullable and is written at claim — every `item.to === name` comparison is now a question | grep for `.to !==`, `.to ===`, `to:` and audit each; prefer `pool`-aware helpers over new inline checks |
| **One 10.4 MB document per pass** (F13) | adding per-row fields grows the scan every pass | fields are small and optional; never add a second document (P7) |
| **`requires` shape change** | 6 demos assert `requires:<cap>`; `queueops`/`overtaken` read `requires` | keep string→set compat and the single-capability reason string byte-identical |
| **A claimed row keeps `pool: true`** | two readers could disagree about "who owns it" | `to` is the owner; `pool` is provenance. Document it in `queueItemLine` and in the census names |
| **Capability sets that no seat satisfies** | silently unclaimable work | the new check rule (§6.4) makes it a failure, not a mystery |
| **Size gate divides by a non-positive window** | the verifier-class window (24 576) is smaller than the compaction defaults | refuse with "no usable budget declared"; never divide by zero or by a negative |
| **Temptation to add a `split` status** | a seventh literal is a seam | `closedAs` + transition, per §4 |

---

## 9. Operator decisions this spec encodes (2026-11-12, verbatim answers)

The operator was offered six questions with a recommendation each and answered:

1. Pool address — **approved**: `to: null` + `pool: true` (not a pseudo-seat).
2. `requires` — **"a set"**: AND semantics; empty set = anyone.
3. Can a seat earn eligibility via skills — **approved: assigned only**; no self-service grant. (Assignee named in item 7 below.)
4. Size gate window — **approved**: the claimer's declared window, plus a pool-level warning when a row
   exceeds the smallest seat's window.
5. Split — **approved**: the claimer splits; children inherit `from`/`requires`/`blockedBy`; the parent
   closes as `split`, not `done`.
6. Tier on split — **approved**: tier stays latched; children record their own tiers.

Two further points the delegate decided (offered as "I will decide unless you object", not objected to):
a claimer may **not** bump a pool row's priority (priority stays the operator's / `pm`'s; a seat may only
self-defer with a clock), and `to` is **owner-of-record only** — routing authority is the pool, while the
DONE notice still returns to `from`.

### 9.1 Follow-up answers (2026-11-12T22:3xZ), and what each one changes

7. **Who assigns capabilities — "pm may assign".** Settled: **`pm` may assign a capability**, both existing and
   a NEW name. Consequence, and it is a real widening of authority: `pm` can therefore grow the specialisation
   vocabulary the pool's eligibility runs on. Two constraints keep that visible rather than silent, and neither
   is negotiable in the build:
   - every capability assignment is written as a **transition on the seat's roster entry** (`by: "pm"`, the name,
     the reason), so "who gave devtools `landing`" is answerable from the store and not from memory;
   - the **`check` rule in §6.4 stays**: a pooled row whose `requires` names a capability NO seat advertises is
     a failure. That rule is what turns a `pm` vocabulary mistake into a red check instead of unclaimable work.
   This supersedes the delegate's earlier recommendation ("a new name requires the operator"). It does NOT
   change item 3: a **seat** still cannot assign itself a capability — the grant is `pm`'s or the operator's.
8. **Calibrate the size table before the build — "approved".** Accepted as recommendation (b): derive
   `tier → tokens` from `selfdev.sqlite.spend.jsonl` BEFORE implementing the gate, as **build row 0** (§7, §6.2).
   A default-only table was rejected because a wrong `feature` estimate refuses real work and reads like an
   unlucky claim rather than a defect.
9. **Who implements — "fresh context, not a seat in the team, but a different LLM model".** The implementer is an
   external context on a different model. It has no capability, no queue row, no roster entry and no broker
   presence, so it cannot claim the work it is building through the pool, and nothing in this milestone may
   assume it can be woken or addressed as a seat. It edits files and runs the demos (see §11).

---

## 10. Open questions for the implementer to settle (not blockers)

1. **Where does the tier→token table live** — `DURIG_TIER_TOKENS` in `durig.config.json`, or a code default
   with config override? *Recommendation:* config, failing loudly on a malformed value, following
   `compactionSettings` (`src/config.mjs:519`) — an ignored setting is the defect class that file exists to
   prevent.
2. **Does `peek_queue` show pool rows** in a seat's own view, or only in a team view? *Recommendation:* show
   them, marked `POOL`, because a seat cannot claim what it cannot see — but only rows it is *eligible*
   for, or the view becomes a dump of other seats' work.
3. **Does a pool row's `tier` change when it is split?** P9 says no. If measurement says the parent's tier
   should ratchet down, that is a new decision, not a detail.
4. **How is the `size-refused` count surfaced** — attention, or census only? *Recommendation:* census only
   at first; the row already carries the transition.

---

## 11. Handoff

**Who you are, operationally (operator, 2026-11-12):** a fresh context running a **different LLM model**, and **not a
seat**. You have no capability, no queue row, no roster entry and no broker presence — you cannot claim, wake or be
addressed, and you must not try to become a seat to get closer to the work. You edit files, run the demos, and
commit explicit paths, exactly like an operator-side delegate.

**Read, in this order:** this file → `docs/DECISIONS.md` D275 → `src/rig.mjs` (`workable`,
`selectNextWork`, `assertSendAllowed`, `enqueueItem`, the `claim_work` execute block) →
`docs/WORK-ITEM-MODEL.md` §4–§7 → `docs/reviews/architecture-queue-lifecycle-redesign-review.md` §F6/F12/F17
(the seam map and the two predicate rules).

**First three commands:**

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node cli.mjs status --json | jq .queueCensus.counts   # the baseline above
node scripts/test.mjs --area rig                                                # must be green BEFORE you touch it
node demo/workable-claim.test.mjs                                               # the predicate's own pin
```

**Do not:** push (the operator holds that grant; this spec's own commit is local and unpushed); resume the paused
lifecycle goal; build the skill store; add a second queue document; add a `split` status literal; build a
capability-**grant** verb (`pm` assigns via the roster, recorded as a transition — §9.1 item 7); edit
`docs/DISPOSITIONS.md` (append-only) or `docs/NEXT.md` without re-running its two budget demos
(`demo/next-pointer.test.mjs` — 200-line cap and a required `**Blocker:**` line — and
`demo/clockin-digest.test.mjs` — 20 000 B digest cap).

**Definition of done for N19:** the three §1 criteria hold on the live store, every §7 row is landed with
its demo green, `node scripts/test.mjs --area rig` and `--area broker` are green, and `docs/MILESTONES.md`
N19 records the measured before/after.

## 12. What shipped (2026-11-13) — the spec reconciled with the code

One commit per §7 row on `main`, each landed with its own demo green. The shas are the record; the right-hand
column is the wording the code actually uses, because prose in a spec and strings in a tree drift, and this
section exists so a reader can tell which one is true.

| row | commit | what landed, in the code's own words |
|---|---|---|
| 0 | `a4502733` | `DURIG_TIER_TOKENS` in `src/config.mjs` + `tierTokenTable()` that **fails loudly** on a malformed value; `usableContextBudget()` = declared window − compaction reserve − keep-recent; `up` writes both into the roster. `tools/tier-token-calibration.mjs` (24.4 s, exit 0) read 1,538 claim→done windows from `selfdev.sqlite.spend.jsonl`: p25 trivial **3410**, small **6101**, feature **6245**; **project** has 4 rows, which the ledger cannot answer, so it keeps an explicit **120000** |
| 1 | `b454d1ea` | `requiredCapabilities(requires)`: string → `[s]`, array deduped, anything else → `[]` (#2673). Single-capability reason byte-identical (`requires:landing`); multi names every missing cap (`requires:a,b`) |
| 2 | `4b4ac11a` | `assertSendAllowed(tx, from, to, requires)`: `to === null` is a pool send — Edges and per-seat caps are skipped, `seatId(tx, from)` still runs; a named send names EVERY missing capability |
| 3 | `a28fe142` | `send_work` takes `pool`, optional `to`; `pool` + `to` refused, neither refused; `enqueueItem` gained its 13th arg `pool` |
| 4 | `6eac7919` | `openPoolRow(item)` = `pool === true && to == null`; named pool claims run `workable()`; owner-of-record written in the same commit as the `pool-claimed` transition; the queue line reads `to=POOL`, or `to=<seat> poolOwner=true` |
| 5 | `f4cb2c32` | `POOL_SIZE_GATE_FRACTION = 0.7`, `sizeVerdict()`, `splitInstruction()`, refusal reason exactly `too-big:<tier>(<estimate> tokens > 70% of the <usable>-token usable window)`; `size-refused` transition on **named** claims only; `poolCensus()` in `src/readapi.mjs` |
| 6 | `785f214e` | `complete_work({itemId, split: [...]})` → parent `cancelled` + `closedAs: "split"` + `split` transition with `children: [<ids>]`; children pooled, inherit the splitter and the parent's set unless they name their own; zero children refused; a child gated on the row being split refused |
| 7 | `6567a568` | `pool-dead-gate` and `pool-claim-without-capability`, both severity `error`, reading the SAME predicates (`openPoolRow`, `requiredCapabilities`) the claim path uses; `status --json` / `queue --human` carry the census |
| 8 | this commit | `docs/WORK-ITEM-LIFECYCLE.md` §2a, `docs/WORK-ITEM-MODEL.md` §3a, `docs/FEATURES.md` five rows, `docs/RULES.md` two rows, `docs/MILESTONES.md` N19 before/after |

**Where the shipped behaviour is deliberately NOT what §6 or §10 proposed, and why:**

1. **§10 Q2** recommended `peek_queue` show only pool rows a seat is eligible for. Shipped: **every open pool
   row is visible to every seat** (`src/rig.mjs:2077`). Eligibility-gated visibility means an ineligible seat
   reads an empty queue and concludes the pool is empty — the opposite of the milestone's purpose. Visibility
   is wider than eligibility on purpose; the skip report then names why a row cannot be taken.
2. **§6.4** named the census fields `pooled`, `pool-claimed`, `size-refused`. The JSON keys are `pooled`,
   `open`, `claimed`, `ownerOfRecord`, `sizeRefused`, `tooBig`, `seatsWithoutWindow`, `fraction`. `claimed` is
   the human name, `ownerOfRecord` the precise one; the human line reads
   `pool: <open> open, <claimed> claimed, <sizeRefused> size-refused (gate: ... 70% ...)`.
3. **`size-refused` is recorded only on named claims.** The wake selector runs every pass for every seat; a
   transition per seat per row per pass would be a write storm and would bury the row's real history. The
   census therefore counts refusals a seat actually attempted.
4. **A seat with no declared window is not gated.** §6.3 said "refuse with 'no usable budget declared'". The
   shipped rule warns and does not refuse: absence of a declaration is not a measurement, and refusing every
   tiered row on a guessed number starves real work (#2673). The warning for a zero-or-negative usable window
   is `no usable budget declared (usable -11808 tokens; the compaction settings leave nothing to work in)` —
   the number is real: pi-durable's defaults (reserve 16 384 + keepRecent 20 000) exceed a 24 576-token
   verifier window. **No division by zero or by a negative is possible anywhere in the gate**; the limit is
   `fraction * usableWindow` and a non-positive window short-circuits before it.
5. **The `pool` field is provenance, not eligibility.** A claimed pool row keeps `pool: true`. Treating that as
   eligibility would let a second seat claim a row that already has an owner — the race P5 exists to close.
6. **The pool census rides the census-bearing `queue` forms, not the bare dump.** §6.4 asks for the three
   numbers in the queue read. `queue` with NO flags is still byte-identical to what it was before N19
   (`{ok, command, items}`) — that compat contract is asserted by `demo/queue-filter-attention.test.mjs` and
   `demo/queue-compat-args.test.mjs`, and a pool key on the 22 MB dump would break it for no gain: anyone who
   wants the counts asks for a bounded read. Every narrowed form (`--no-body`, `--status`, `--to`, `--limit`,
   `--with-gates`) now carries `pool`, derived over the FULL row set before projection — measured
   `node cli.mjs queue --json --limit 2 --no-body` in **0.8 s** on the 7,655-row store (Linux / Fedora Linux 45
   / kernel `7.2.15-300.fc45.x86_64` / node v24.22.1, 2026-11-13). `--limit` is now applied in the JSON forms
   too: previously it was parsed, bounded and then ignored unless `--with-gates` or `--human` was in play, so
   `queue --limit 5` printed 5 of nothing and all of everything.

**Not built, per the boundaries:** the skill store (§9 item 3 — the operator ruled capabilities are
assigned, not earned) and a capability-grant verb (`pm` assigns through the roster; the two `check` rules in
§6.4 are what make a vocabulary mistake red rather than invisible).

**The probe that would falsify the milestone, and its state:** `docs/MILESTONES.md`'s falsification test is
"pooled rows claimed by more than one seat". Measured 2026-11-13, `pool.rows` is **0** on this rig: the
predicate is shipped and proven by demos, but no seat has pooled a row yet, and the 12 existing seats carry no
`usableWindow` until the next `up` re-records them. That is a follow-up measurement, not a hole in rows 0–8.
**That sentence is now out of date — see §13.**

## 13. Tranche 1 and tranche 2, shipped and measured (2026-11-13)

Everything below is quoted from the code or from a command actually run on this rig. Host for every
measurement: **Linux / Fedora Linux 45 (Forty Five) / kernel `7.2.15-300.fc45.x86_64` / node v24.22.1 /
git 2.56.0**. HEAD before these commits: `517dc58d`.

### 13.1 `requires` on a row that already exists (`revise_work`) — commit `655c44e2`

`send_work` was the only writer of `requires`; the backlog could not be annotated, so the predicate had no
data to act on. `revise_work` now takes `requires`, and its description says what it is:

> "You may ALSO set `requires` - the capability SET a claimant must advertise (N19 'The Pool', P2) - on a
> queued row that already exists: its author or `pm` may annotate it; no other seat may (that is a routing
> decision, and widening it is an operator ruling, not a tool's). Annotating a row never pools it (`pool` is
> decided when the row is sent) and never changes any seat's own capabilities."

**The authority is SPLIT, not widened — and it is the CONTRACT's, exactly.** `subject`/`body` stay with the
parties (`from` or `to`) — the #6112 coordinator grant lets a coordinator *release* a parked row, not rewrite
one. `requires` is routing, and the objective's words are "author or `pm` only", so that is what shipped
(`ANNOTATE_REQUIRES_SEAT`). **This was first built with `seatIsCoordinator` and an independent audit of
2026-11-13 rejected it**: that predicate is TRUE for `lead` (`decide|adjudicate`) and for any future
capability-less seat, so it widened who may route work without a ruling — precisely what the contract says to
write a decision request about instead of answering. The verb is narrowed back; whether a coordinator (or
`lead` specifically) should hold this is decision 5 in
`docs/reviews/2026-11-13-capability-ownership-ruling.md`. The refusal names who is missing:

> `item #<id>: only its author (<from>) or pm may set the capability requirement; you are neither
> (from=<from> to=<to>)`

and `demo/revise-requires.test.mjs` now asserts the hard half: **`lead` is refused**, and the demo also pins
that `seatIsCoordinator` WOULD admit lead, so a later refactor that reaches for the wide predicate fails the
demo instead of silently re-widening the verb.

**Two refusals exist because a bad annotation is the pool's version of a dead gate.** A set no seat
advertises makes a row unclaimable forever; catching it in a `check` costs the row, catching it at the write
costs one call:

> `item #<id>: no seat on the roster advertises all [<caps>], so this requirement would make the row
> unclaimable forever. Roster: pm=[route,plan] impl=[implement,code] … - name a capability a seat actually
> has, or change the roster with up --refresh (not this call)`

And an addressed row is a promise to one seat, while `claim_work` does not re-check capabilities for a row
addressed to the claimant (the by-id path historically skips `workable()`), so a set the addressee lacks is a
row nobody can take:

> `item #<id> is addressed to <to>, which does not advertise [<caps>]; a requirement the addressee cannot
> satisfy makes the row unclaimable by the very seat it is addressed to. Capability sets route work in the
> POOL - to put this work in front of a capable seat, send a row to that seat (or pool it at send time). The
> roster is changed with up --refresh, not with this call.`

The transition records `by`, `fields`, and — when `requires` moved — `requiresFrom` / `requiresTo`, so a row's
requirement history is readable without a second store. `demo/revise-requires.test.mjs` (44 checks, 0.3 s,
exit 0) pins all of it; `--area rig` 87/87 in 14.1 s.

**Gap this exposed (operator ruling, not a bug to fix here):** `send_work` has no equivalent guard. A row
minted with `requires` no seat advertises still enters the pool — measured live, **#7660 sits open with
`requires: "docs"** and no seat on the roster advertises `docs`, so it is unclaimable by all 12. The verb
that can *change* a requirement refuses; the verb that *creates* one does not.

The `check` rule sees it, on the live store, and names the whole roster
(`node cli.mjs check rig.selfdev.json`, 12 seats, 2026-11-13T19:55Z):

> `id: pool-dead-gate`, `severity: error`, `subject: #7660` — "#7660 (queued, in the POOL) requires docs and NO
> seat advertises it — roster: pm:[route|plan] impl:[implement|code] qa:[verify|review] qa2:[verify|review]
> lead:[decide|adjudicate] advocate:[review|advocate] scribe:[implement] devtools:[implement] auditor:[verify]
> designer:[review] security:[security|review] architect:[design|review]; the row is queued, invisible to every
> claim, and no wake can fire for it"

and `pool-claim-without-capability` **passes** on the same read, which is the invariant that matters: both live
pool claims (#7667 to `advocate`, #7669 to `security`) are capability-clean, so the *cross-owner* claim was legal
rather than lucky. **Operational trap:** the bare `node cli.mjs check` audits `./rig.json` (a tracked 2-seat
scaffold from 2026-10-10, seats `pm`/`worker` with no capabilities) instead of `rig.selfdev.json`, so it reports
the same finding against a roster nobody runs — on this repo, always pass the rig file explicitly (pitfall 324).

### 13.2 The doctrine — one paragraph, every seat (commit `1782b495`)

Before this, "pool" appeared 0 times in the 12 personas and 0 times in `rig.selfdev.json`. The doctrine lives
in **`constitution.txt`**, the `durig-constitution` system-prompt section (`src/rig.mjs`,
`section("durig-constitution", …)`) — one text, every seat, re-injected per request, so it cannot fork into
12 persona copies and survives compaction. The shipped paragraph, verbatim:

> P2 Pool: the queue is a POOL, not a personal inbox. `claim_work` takes the OLDEST row you are ELIGIBLE for -
> one addressed to you, or an open pool row (no owner of record) whose `requires` capability SET you advertise
> in full and whose tier fits inside 70 % of your usable context window. Eligibility is decided by the claim,
> not by judgement: an ineligible claim is refused with the reason, and a row too big for the window is refused
> with a split instruction - split it (send_work the pieces, then complete_work with `closedAs: "split"`)
> rather than start it. A pool claim is recorded on the row as owner-of-record and is NOT messaged to the
> author, so the pool's state is legible only in the census (`queue --json`, `status --json`); read the census
> before concluding the pool is empty.

The three surfaces that contradicted it are now consistent: `peek_queue`'s description names pool rows and no
longer says "addressed to or sent by you"; `WAKE_CONTENT` (`src/driver.mjs`) says
"one addressed to you, or an open pool row whose capability set you advertise - … an ineligible claim is
refused with the reason"; `queueItemLine` prints `requires=<set>` (a row with no requirement renders
byte-identically to before, which is what keeps the queue-compat demos green). `rig.starter.json`'s
`constitutionInline` is the generated mirror, re-mirrored with `tools/mirror-constitution.mjs`. Evidence:
`demo/pool-doctrine.test.mjs` (24 checks, exit 0), `--area docs` 8/8 in 48.5 s.

### 13.3 `tools/pool-migrate.mjs` — the denominator, read-only (commit `4ed6b8d0`, corrected `36f57a36` — the amend of `01ff4c91`, which never reached `main`)

`--dry-run` only; `--apply` is refused by name; there is no write path in the file. Seven classes, applied in
order so each row lands in exactly one and the classes sum to the queued count:
`already-pooled → notice → blocked → unaddressed → untiered-or-oversized → single-owner → migratable`.
When a row carries no annotation, the honest proposal is the addressee's own capability set.

**The trap this instrument found about broker-served reads** (found on contact, fixed in place): a resident
broker serves the `seats` view as `readSeatList` — an **array**, no tier table — while the no-broker fallback
is `readSeatsDocument` — `{found, value}`, roster keyed by name. Unwrapping one as the other silently empties
the roster: `capsOf` then returns `[]` for everyone, `others.length === 0` for every row, and the tool reports
the whole backlog as `single-owner` while printing balanced arithmetic. Same store, same rows:
**268 migratable-classified rows read directly vs 0 through the broker.** `rosterOf()` now normalises both
shapes and the tool prints which view served it (`roster: 12 seats, from seats document`). Pinned by
`tools/pool-migrate-test.mjs` (36 checks, exit 0), which asserts the naive unwrap yields an empty roster and
that the normalised list classifies identically to the document.

**Live census after the fix** (`node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite`, 1.7 s):
rows 7671, queued 853, pool {3 pooled, 1 open, 2 claimed, 0 size-refused}, tier table in force
`{"trivial":3400,"small":6100,"feature":6200,"project":120000}`, largest declared window 164320.
Classes: already-pooled 1, notice 313, blocked 85, unaddressed 0, untiered-or-oversized 15, single-owner 274,
**migratable 165** — balance OK. **107 of the migratable rows name a claimant the `ownership` map does not
list** for the artifact they name (src-tools-harness 88, workflow-docs 19; 34 rows name no path, so no check
is possible). That list is the trigger for the operator's ownership ruling; the roster is read-only to this
tool.

### 13.3b The milestone's starting numbers, reconciled (every delta explained)

The objective required the live `267 / 311 / 85 / 393`-class numbers to be "reproduced or every difference
explained". Reproduced below from ONE read (`node .spike/pool-reconcile2.mjs`, READ-ONLY, 3.6 s, broker seam), at
**7,687 rows / 858 queued** on 2026-11-13T20:3xZ:

| class | baseline (846 queued) | now (858 queued) | why it moved |
|---|---|---|---|
| impl | 393 | **403** | +10 minted; impl advertises `code`, which no other seat has, so **0 of its rows are capability-clean** |
| pm | 183 | **190** | +7 minted; `route`/`plan` are pm's alone, so 0 clean |
| devtools | 165 | **162** | −3 closed; all 162 clean (its set `implement` is shared) |
| scribe | 78 | **75** | −3 closed; all 75 clean |
| qa | 24 | **25** | +1; all 25 clean (`verify`,`review` shared with qa2/architect/security) |
| advocate / security | 1 / 1 | 1 / 1 | unchanged |
| architect | 1 | **0** | its row closed |
| (no addressee) | 0 | **1** | the open pool row #7660 — a pooled row has `to: null` by design |
| **total** | **846** | **858** | +12 = +10 impl, +7 pm, +1 qa, +1 pool, −3 devtools, −3 scribe, −1 architect |

**`267` is exactly `devtools 165 + scribe 78 + qa 24`** — the seats whose capability set at least one other seat
also advertises. It is **262** now (`devtools 162 + scribe 75 + qa 25`), i.e. the −5 is the drift above, not a
classifier change. And **`267 → 165` is not a shrinkage at all**: the capability-clean tranche is not the migratable
tranche, and the classifier subtracts from it in first-match order —

| the 262 clean rows | count |
|---|---|
| **migratable** | **165** |
| a notice (a DONE/CANCELLED ack is not work) | 53 |
| blocked on an open `blockedBy` gate | 42 |
| untiered, so the size gate has nothing to measure | 2 |
| **sum** | **262** |

The whole-census classes reconcile the same way and balance against the queued count
(`balance: OK, 858 = 858`): already-pooled 1 (that is #7660), **notice 313** (= 311 + 2; the flag is the structural
one, and **28 of the 44 untiered rows are notices**, which is why the untiered class is 16 and not 44 — first match
wins), **blocked 85** (unchanged; no notice carries a `blockedBy`), **untiered-or-oversized 16** (44 raw untiered
minus the 28 notices), **single-owner 278**, **migratable 165**, **unaddressed 0**. The single `tier: "project"` row
is **#7438**, and it is a notice — so it is classified `notice` before the size class is reached, exactly as §13.4
predicts for the gate.

**The `393`-row impl tranche** (403 now) is out of scope for the same reason it always was: pooling it would propose
claimants who cannot advertise `code`, which is the operator's `ownership`/capability question (decision 2 in
`docs/reviews/2026-11-13-capability-ownership-ruling.md`), not a classifier bug.

### 13.4 Tranche 2 — the gate is ARMED, and the pool has rows (commit `517dc58d`)

`up --refresh` wrote `usableWindow: null` for all 12 seats. Cause, named in
`docs/evidence/2026-11-08-context-window/README.md` §11 already: `declaredContextWindow` read only
`DURIG_CONTEXT_WINDOW`, which is unset on this rig, while the rig declares its windows on the provider specs
(`DURIG_LOCAL_CONTEXT` 204800, `DURIG_VERIFIER_CONTEXT` 24576). That is a **missing seam in the base**, not a
customisation, so the seam was grown (D212): `usableContextBudget` now falls back to
`declaredLocalWindow(localProviderSpecs(config), modelKey)`. `demo/declared-window-seam.test.mjs` (14 checks,
0.131 s, exit 0) pins it; `--area rig` 88/88 in 17.7 s.

After `node cli.mjs up rig.selfdev.json --refresh` (0.915 s): **11 seats usable 164320** (204800 − 20480 −
20000), **auditor usable 12288** (24576 − 4096 − 8192), tier table `{"trivial":3400,"small":6100,"feature":6200,
"project":120000}`. Census before: "seats without a declared window: 12", `pool {rows:0}`. After: **0 seats
without a window**, `pool {rows:0, pooled:0, open:0, claimed:0, sizeRefused:0}`. `git diff rig.selfdev.json`
for the refresh is empty outside the size fields — no capability, edge or ownership entry moved.

Gate arithmetic in force: `Math.floor(0.7 * 164320)` = **115023** (11 seats — not 115024: `0.7` is not exactly
representable and the product lands a hair below, which is why the rig floors), 70 % of 12288 = **8601** (auditor). Only the
`project` tier (120000) exceeds both — so the gate bites only on `project` rows, and the backlog contains
exactly one `tier: "project"` row.

**Claims that actually happened** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 0.8 s, read-only):
- **#7667** minted by `lead` with `pool: true`, no addressee, tier small → `pool-claimed by=advocate` at
  `2026-11-13T18:35:43.701Z`, `claimed by=advocate` in the same commit.
- **#7669** minted by `lead` with `pool: true`, no addressee, tier small → **`pool-claimed by=security` at
  `2026-11-13T18:36:48.521Z`**. Both rows name `docs/DECISIONS.md`; `rig.selfdev.json`'s `ownership` assigns
  `workflow-docs` to `advocate` alone. **The security claim is therefore a claim by a seat the ownership map
  does not cover** — the milestone's falsification probe, observed on a live row.
- Census: `pool {rows:3, pooled:3, open:1, claimed:2, ownerOfRecord:2, sizeRefused:0, tooBig:[]}`.

**The gate now BITES, against this rig's LIVE roster (2026-11-13, `demo/pool-gate-live-roster.test.mjs`, 0.5 s, exit
0).** The demo READS the twelve seats and the tier table from `./selfdev.sqlite` through the broker seam (it prints
`roster source: LIVE (12 seats read from ./selfdev.sqlite via the broker seam)`) and falls back to a recorded copy only
when that store is absent, so a roster change cannot leave it asserting yesterday's windows.
It could not be observed on the live store, and the reasons are structural rather than accidental: (a) only the
`project` tier (120000) exceeds 70 % of ANY window here — 115023 for the eleven 164320-token seats, 8601 for the
auditor — so no ordinary backlog row can ever be refused; (b) the wake selector pre-filters through `workable()`,
so an oversized pool row is SKIPPED rather than attempted, and `size-refused` is written only on a NAMED claim
(D275 addendum (c)). The delegate asked `pm` and `lead` five times to mint the one `project` row that would make it
observable and neither did (they were landing; pm minted nine other rows), and a delegate may not pool a row. So the
gate is proven against the **real roster** — the twelve seats' names, capability sets and declared windows, and the
tier table `up` wrote, read from `./selfdev.sqlite` via the broker seam — driven through the **shipped** verbs on a
fixture store:

| seat | row | verbatim refusal |
|---|---|---|
| `impl` (164320 usable) | `pool: true, requires: ["implement"], tier: "project"` | `CLAIM_REFUSED: #1 is in the POOL but you cannot claim it (too-big:project(120000 tokens > 70% of the 164320-token usable window)). It was sent by pm. Close the prerequisite, or ask pm to address it to a seat that can. Split it: send_work the pieces (each with its own tier and requires), then close #1 with complete_work(itemId: 1, closedAs: "split", children: [...]) - a row nobody can finish is a sizing problem, not a queue problem.` |
| `auditor` (12288 usable) | `pool: true, requires: ["verify"], tier: "project"` | `too-big:project(120000 tokens > 70% of the 12288-token usable window)` — the same gate, the seat's OWN window in the string |

Both refusals leave the row **queued and open** (a refusal is not a claim), each writes one `size-refused`
transition with the claimant and the reason, and `poolCensus(...).tooBig` lists the row with
`tooBigFor: [all 12 seats]` and `unclaimableByAnyone: true` **without any claim having to happen** — which is the
instrument a seat-less session should read. The same demo then proves the gate does not starve: a `small` pool row
is claimed by `devtools`, a non-conventional owner, with its `pool-claimed` transition.

**`tools/pool-gate-live-probe.mjs` — the refusal produced from a byte-copy of the LIVE store (7.3 s, exit 0).** The
demo above proves the gate on the live ROSTER but on an empty fixture. This probe closes the gap a delegate can close
without pooling a live row: it copies `selfdev.sqlite` (+ its `-wal`/`-shm`), opens the COPY with pi-durable, keeps
the store's own roster entries and tier table, mints ONE `project`-tier pool row through the shipped `send_work`, and
lets two real seats' entries name it. Measured 2026-11-13T21:2xZ on the 767 MB store (Linux / Fedora Linux 45 /
kernel `7.2.15-300.fc45.x86_64` / node v24.22.1), row **#7696** in the copy:

> `CLAIM_REFUSED (impl, live window 164320, row #7696):`
> `CLAIM_REFUSED: #7696 is in the POOL but you cannot claim it (too-big:project(120000 tokens > 70% of the 164320-token usable window)). It was sent by pm. Close the prerequisite, or ask pm to address it to a seat that can. Split it: send_work the pieces (each with its own tier and requires), then close #7696 with complete_work(itemId: 7696, closedAs: "split", children: [...]) - a row nobody can finish is a sizing problem, not a queue problem.`

> `CLAIM_REFUSED (auditor, live window 12288, row #7696):`
> `... (too-big:project(120000 tokens > 70% of the 12288-token usable window)) ... complete_work(itemId: 7696, closedAs: "split", children: [...]) ...`

Both seats' refusals carry **their own** window; the row stays queued and OPEN with one `size-refused` transition per
attempt; the census reports it `unclaimableByAnyone` across all 12; a refused claim leaves the census unchanged; and
the source store's main file is **byte-identical** before and after (the `-wal`/`-shm` are the live broker's, and the
tool says so rather than claiming them as evidence). `tools/pool-gate-live-probe-test.mjs` drives the probe against a
fixture store (0.6 s): refusal per seat, split instruction, source untouched, and a roster with an undeclared window
makes the probe exit 2 rather than report a false "refused for everyone".

**What is still not claimed:** that a LIVE seat was refused during a working turn. The team never minted the one live
`project` row — `pm` and `lead` were asked six times (17:52Z, 19:08Z, 19:49Z, 19:53Z, 20:43Z, 21:11Z) and were busy
landing — and a delegate may not pool a row. That is the objective's own fallback, and the seats' live decline of the
open pool row is quoted immediately below.

**The live rig's own decline evidence, verbatim.** After the broker was restarted onto this code (pid 540123,
2026-11-13T20:42Z), every pass prints the row and the reason the seats cannot take it — no claim, no query:

```
SKIP auditor  reason=pool-gated:1 #7660(requires:docs)
SKIP designer reason=pool-gated:1 #7660(requires:docs)
SKIP qa2      reason=pool-gated:1 #7660(requires:docs)
SKIP architect reason=pool-gated:1 #7660(requires:docs)
SKIP security reason=queued-gated:gate-open:#6933(queued) pool-gated:1 #7660(requires:docs)
SKIP advocate reason=queued-gated:gate-open:#6508(queued) pool-gated:1 #7660(requires:docs)
```

That is the milestone's fallback measurement — the seats' own reasons, named — and it is exactly what the old
`pool-gated:1` could not say.

**And the skip line names the row (same day, `src/driver.mjs`).** `pool-gated:1` was the only live trace of the
gate and named neither the row nor the reason — measured against #7660
(`SKIP auditor reason=pool-gated:1` on five seats, every pass, for hours). It is now
`pool-gated:<n> #<id>(<reason>)[,#<id>(<reason>)][ +N more]`, bounded at two named rows and a clipped reason
(`poolGatedSkipLine`), so an oversized or dead pool row is attributable **from the broker log alone**:
`SKIP auditor reason=pool-gated:2 #5001(requires:implement),#5002(too-big:project(120000 tokens > 70% of the 12288-token usable window))`.
Pinned by `demo/pool-gated-reason.test.mjs` (16 checks: bounded, count-first for old readers, no wake regression).
