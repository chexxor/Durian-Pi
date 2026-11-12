# Spec — the pool: one authoritative team queue, specialisation as a predicate, work sized to the window

**Milestone:** **N19 — The Pool** (`docs/MILESTONES.md`). **Decision:** D275. **Operator approvals:**
2026-11-12, six design questions answered (recorded verbatim in D275 and §9 here).
**Status:** SPEC ONLY. No code is written. `main` at the time of writing is `792445d5` (4 commits ahead of
`origin/main`, unpushed). **Intended reader:** an implementation agent in a fresh context, not the author.

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
| work rows that any eligible seat can pull (not addressed to one seat) | 0 | the majority of new work | `cli.mjs queue --json` → count `pool === true` |
| work rows claimed by a seat OTHER than a fixed owner | 0 (impl holds 380 of 796 queued) | spread across eligible seats | `queueCensus` by `to` among rows with `pool === true` |
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
3. Can a seat earn eligibility via skills — **approved: assigned only**; no self-service grant.
4. Size gate window — **approved**: the claimer's declared window, plus a pool-level warning when a row
   exceeds the smallest seat's window.
5. Split — **approved**: the claimer splits; children inherit `from`/`requires`/`blockedBy`; the parent
   closes as `split`, not `done`.
6. Tier on split — **approved**: tier stays latched; children record their own tiers.

Two further points the delegate decided (offered as "I will decide unless you object", not objected to):
a claimer may **not** bump a pool row's priority (priority stays the operator's / `pm`'s; a seat may only
self-defer with a clock), and `to` is **owner-of-record only** — routing authority is the pool, while the
DONE notice still returns to `from`.

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

**Do not:** push (the operator holds that grant; 4 commits are already local and unpushed); resume the paused
lifecycle goal; build the skill store; add a second queue document; add a `split` status literal; edit
`docs/DISPOSITIONS.md` (append-only) or `docs/NEXT.md` without re-running its two budget demos
(`demo/next-pointer.test.mjs` — 200-line cap and a required `**Blocker:**` line — and
`demo/clockin-digest.test.mjs` — 20 000 B digest cap).

**Definition of done for N19:** the three §1 criteria hold on the live store, every §7 row is landed with
its demo green, `node scripts/test.mjs --area rig` and `--area broker` are green, and `docs/MILESTONES.md`
N19 records the measured before/after.
