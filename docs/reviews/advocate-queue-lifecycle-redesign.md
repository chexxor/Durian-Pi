# Advocate review — queue-lifecycle redesign (stuck items made impossible)

**Item:** #2985 (read-only review; operator-directed). **Against:** `docs/reviews/queue-lifecycle-redesign.md`
(@3904020 on main) + `WORK-ITEM-LIFECYCLE.md` + `WORK-ITEM-SCHEMA.md` (R4/R5/§7/§9/§11) +
`docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md` (documented; not reopened — evidence only).
**Reviewer:** advocate (workflow fit). **Delivered to:** pm (routes to the delegate, who owns the proposal).

**Method / evidence discipline.** Every code statement below was re-verified at HEAD `6875bc8`
(`src/rig.mjs` hold/release/defer shapes; `src/driver.mjs` selectWakes; `src/attention.mjs` kind
inventory; `src/checkup.mjs` RULES inventory). Every number is quoted from the named doc and
attributed (incident §Impact; schema §1/§11.1); no live-store re-measure was run — the docs carry
their own verify commands (schema §10). Claims not grounded in a retrieved passage are labelled
INFERRED. One exception to that discipline is filed as its own finding (CR-8): the proposal's own
falsifiable "one state" claim.

**Verdict up front: supported.** The incident's invariant is a workflow must-not-break made
structural; the two-axis model is the honest fix for `held`'s proven gap; the rejected-alternatives
list (§10) shows the author already refused the tempting shortcuts this team's history punishes
(second writers, stale indexes, mass scripted rewrites). What follows are eight change requests, three
of them blocker-grade on SEQUENCING and TRUST rather than on the model itself, and one spec
inconsistency — each with grounds and a concrete alternative.

---

## 1. Judged fit (the item's five questions, answered)

**Q1 — do the loops get clearer? YES, with one condition (CR-4).** Served workflows: W3 (blocked on a
question) + W4's tracking half + W5's read. W3's must-not-break #2 — "a blocked seat's reason must
appear where an operator looks" — becomes DATA under the proposal (`reason/resolver/reviewBy as plain fields`); W4's
must-not-break — "every request becomes a tracked item … closed with a reason rather than left to age
silently" — gains the structural closure the incident lacked. The condition: the proposal must not
fork the "waiting" derivation the D114 chain (#2788/#2789/#2804) is about to build (see CR-4).

**Q2 — noise. THE MAIN RISK IS REAL (CR-2). Scale to judge against (measured in the incident, not by
me): 153 held rows (113 impl), median ~16 h held, 49 rows >24 h, ~51 rows with already-terminal prose
gates.** Under the proposal:

- `parked-review-due` derives from `reviewBy`; proposed defaults (OQ2) end at **manual 1 d**; the
  migration maps EVERY legacy held row to `manual` (`reviewBy: now + grace`) (§9.2). Consequence,
  measured on that scale: roughly ~100 of 153 rows are registered do-not-start backlog rows the
  lifecycle doc itself calls the dominant shape (§6) — with NO human intent to touch them inside one
  day. Attention kinds are derived per pass over the live read set (§4.2); nothing in the kind table
  dedups; so a passed `reviewBy` re-fires every pass until resolved. That is a countable firehose on
  day one, and a firehose erodes exactly the W5 trust channel the attention vocabulary exists to
  carry ("an empty dashboard must never look healthy" mirrors straight into "a firehose is never
  specific"). **Alternative (concrete):** (a) each attention kind fires once per `reviewBy` EPOCH and
  re-arms only when the resolver BUMPS `reviewBy` — no new machinery: the field IS the epoch;
  (b) raise per-reason defaults to workflow truth (see §4); (c) echo the default in `detail`
  ("parked-review-due: #631 held 2.1 d/7 d by pm"); (d) graduate pure backlog registrations onto the
  roadmap ledger (§6) BEFORE §7's rules switch on — 153 parks is the measurement that says the
  graduation must LEAD, not trail.
- `orphan-no-progress` must EXCLUDE rows carrying a `block`. A blocked row's non-progress is implied
  by the block itself; on the incident's numbers most stale parks would qualify under both
  `orphan-no-progress` AND the gate/review kinds — two alarms for one fact, which is schema R8's
  violation from the ALARM side. Honest target set for the kind: the UNBLOCKED stray (neither
  claimable nor blocked) — which under the new §1 invariant is supposed to be UNREPRESENTABLE, so the
  kind's durable shape is as a MIGRATION-aid alarm over legacy rows (pre-migration), retiring at
  enforcement. The proposal leaves N unset and unlabelled; without the exclusion it double-fires the
  same fact (INFERRED from §5's table alone; flagged rather than guessed).
- `gate-cleared-unreleased` (OQ1 one-pass grace): agree with one pass — WITH the epoch dedup above;
  on the incident's numbers the durable-TUI rows would fire exactly once and fall quiet after release.

**Q3 — habit change. Two live breakages named (CR-3, CR-5).** Verified today: `hold_work` takes an
OPTIONAL free-prose `reason` (`src/rig.mjs:748-775`) and register-as-parked is `send_work({held:true})`
(`src/rig.mjs:338-349, 418`).
- Deprecation ORDER: `send_work({held:true})` must NOT deprecate before the roadmap ledger's WRITE
  SURFACE exists. Today it is the rig's only registration verb; "REGISTERED (backlog, HELD —
  trigger-gated, do not start)" is a live cross-seat habit (150+ rows in recent weeks are exactly that
  shape; the register is how MY review items get parked too — #2630's original registration came from
  exactly that verb). §6 names schema-side intent (RM-R1); it names NO write surface (no `up`-time
  routing, no CLI verb, no release path). Deprecating first leaves seats with nothing that does the
  same job — the exact failure mode the redesign removes ("work registered correctly is invisible"),
  this time for intent. **Alternative:** land the ledger write surface FIRST; deprecate per-seat only
  after one seat has actually REGISTERED a row through it (observed, not declared); keep the §9.1
  alias (`held:true` → typed `schedule` block) alive meanwhile.
- `hold_work`'s typed requirement is right for seats (my own re-hold of #2630 is the incident's named
  live instance), but the SEAT-FACING shape must be minimal: `hold_work(id, {reason:"dependency",
  blockedBy:[#2966], reviewBy:null})` where the seat names gates it already knows; `dependency`
  reviewBy stays optional per §3; and where the true trigger is an event with no queue unit, the
  accepted shape must be `operator`/`schedule` with a default reviewBy — the operator window is a
  trigger this rig genuinely uses (`#1957`, `#994`).

**Q4 — must-not-break invariants. HOLDS, with two sorts named:**
- "A seat is woken for `queued` work": mapping keeps `queued` = `open`+block-free, claimable, waking;
  auto-open lands as `open` and the next pass wakes through the same `selectWakes` path (verified:
  wakes queued + stalled-claim only, `src/driver.mjs:56-64`). OK.
- "A parked row never starves a working seat": two axes keep held non-claiming/non-waking; the only
  automatic release is the declared-gate one (§4.3) — the conservativeness is exactly right. OK.
- Single-writer (D42/D46): every write flows the broker's own store session — reads through the read
  path, auto-open and the `answered` transition INSIDE the broker's pass; and §10's rejection of a
  reverse index is the single-writer ethos applied twice (a maintained index is a second source that
  nobody owns). Scan-while-small is measured (~180 non-terminal rows today). OK.
- Four-state legibility (P1): §2's mapping table keeps the four states as VIEWS, and people who know
  `held`/`deferred` keep their bearings. The gap is WHERE THE FACT IS DERIVED (CR-4): D114's
  `waiting` derivation (#2788 build) reads `status==="deferred"` today (verified
  `attention.mjs:363-367`); under the axes it must read `stage+block.reason` — one derivation
  function, every surface consuming it, else `status` headline, watch roster, and `waiting` disagree
  (the R8 sin, surface edition). §8's seam table lists cli projections and docs but NOT the
  attention/watch/TUI re-point — add it, sequenced WITH the axis change, not after; the TUI render
  rule remains designer-led (#2826 lands on the new vocabulary, don't consult late).
- One more naming duty (small, CR-7): `check`'s rule ids are declared "the stable API"
  (`checkup.mjs:35-36`, verified) and runbook front-matter rules tie runbooks to rule ids; the
  incident's runbook (`stale-held-backlog`) must gain the new ids in its `check_rule` at land time.

**Q5 — is "one honest state per item" visible to a HUMAN? For `status` + `queue --blocked`: yes in
design (§5). The acceptance sentence I'd add (workflow-fit contribution): the operator answers the
incident's own question ("what is the status of the TUI migration?") by READING one surface, in one
pass, with no git refs and no branch archaeology — the incident §Timeline 20:14Z moment is the
falsifiable probe. Put it in the build acceptance and it can be demoed red-first.**

## 2. Change requests

| id | severity | finding | grounds | alternative |
|---|---|---|---|---|
| CR-1 | **blocker (sequencing)** | Enforcement (§7 switch-on) must judge PERSISTED state only; the READ mapping (§9.2) must not be rule-input. The 153 legacy rows map into `block` objects their authors never committed; `item-park-reviewby` (fix-now) + `item-block-resolver` (error) would fire against every unmigrated row simultaneously — and a red `check` blocks every landing (`land.md --suite` runs check; `shared-tree-on-main` precedent), so the queue would stop, not tighten. | verified: `checkup.mjs` rules gate landings; §9's backfill is lazy "on re-touch" | rules fire iff the row HAS the block field written by its author; read-mapped blocks feed attention/watch only; legacy exemption = absence of the `block` object (no new flag). Write this ONE sentence into §7 and schema §9 step 4. |
| CR-2 | blocker-grade (trust; measured scale) | Default `reviewBy` + per-pass re-fire = alarm firehose over ~100 rows, day one. | incident §Impact numbers; §5 kind table has no dedup; §9.2's mapping | epoch one-fire (re-arm on `reviewBy` bump) + defaults from §4 of this review + default echoed in `detail` + ledger graduation before enforcement |
| CR-3 | blocker-grade (habit break) | Do not deprecate `send_work({held:true})` before the roadmap ledger write surface exists — it is the rig's only registration verb and a live cross-seat habit. | verified `rig.mjs:338-349, 418`; §6 intent has no write surface | ledger write surface first; deprecate per-seat after one OBSERVED registration through it; alias map (§9.1) alive meanwhile; name the write surface in §8's seam table |
| CR-4 | high | ONE `waiting` derivation across surfaces (attention/watch/TUI re-pointed at `stage+block.reason`, consuming D114's shape); else `status`, watch roster and `waiting` disagree — R8 violated from the surface side. | verified `attention.mjs:363-367`; D114 §2; #2788/#2789/#2804 subjects | add attention.mjs re-point to §8's seam table, sequenced WITH the axis change; TUI remains designer-led under #2826 |
| CR-5 | medium | Spec inconsistency: §3 says `manual`'s resolver is "a named seat"; §9.2 maps legacy `held` → `{reason:"manual", resolver:"pm"}` — the validator would flag the retrofit set it creates. | §3 table vs §9.2 | map legacy held → `{reason:"manual", resolver:<item.to>}` (the ROW's seat re-examines; for #2630 that is me — correct); keep `pm` only under `schedule` (§9.1's alias keeps schedule/pm, defensible because the SENDER parked it) |
| CR-6 | medium | Real-world gates include events that are NOT item-closes ("release when #2103 lands", "when the operator window opens", "after the train clears", dates). Naive `blockedBy` conversion will either release on the wrong close or never fire. | incident timeline; my own #2630 gate was "when the designer's proposal lands" — a LANDING event, not an item close; §4.1 evaluates closes only | one migration paragraph: a `blockedBy` id must name the QUEUE UNIT whose CLOSE IS THE EVENT (a landing-list row, a ruling item, a freeze item); non-item events (operator window, dates) use `operator`/`schedule` + `reviewBy`; per-row backfill judgment, never scripted (matches §9.3) |
| CR-7 | low | Wire the incident's runbook (`stale-held-backlog`) `check_rule` front-matter to the new rule ids at land time | verified: runbook front-matter rules tie runbooks to ids (`runbook-stale` etc.); incident names the runbook | add runbook front-matter update to §8's seam table |
| CR-8 | low | The claimed invariant contains one UNVERIFIABLE clause: "(c) blocked, with a `block` that names a `resolver`" — the model cannot enforce the EXISTENCE of a truthful resolver, only a non-empty field (`item-block-resolver` guards shape; the reviewBy clock + the operator's read surface guard behaviour). Say the honest version: the schema can make a MISSING resolver unrepresentable; a WRONG resolver (poorly named gates, vs CR-6) remains a judgment — that is what `reviewBy` backlog duty and the operator's read surface are for. | §1's invariant vs §7's rule table | one sentence of honesty in §1 (planned overclaim avoided), and `check` stays the shape-guard not the mind-reader |

## 3. Confirmations

1. The §1 invariant's direction, "no item may be non-terminal and have neither an owner nor a
   resolver", is W4's tracked-item principle and W3's visibility principle fused into ONE falsifiable
   sentence — with CR-8's honesty clause.
2. Two axes preserving the four states as views (§2): legibility preserved, ambiguity hidden in
   data — deliberately not more statuses (§10) — supported over a status explosion.
3. Auto-open scoped to `dependency`-only (§4.3): conservatism is the feature.
4. §10's rejections (unsticker / reverse index / C4-style direct writes) refuse the tempting shortcuts
   this rig's own history punishes; the single-writer ethos applied twice.
5. The roadmap/queue split (§6) matches schema §11 (R9/R10/R11) and heals the measured 392 prose
   citations with STRUCTURED links — with CR-3's ordering respected. At adoption my
   `docs/WORKFLOWS.md` W4 language ("every request becomes a tracked item") gets the one-paragraph
   decode that the TRACKED ITEM may be an RM row — same must-not-break, other ledger (my doc, my
   follow-up).
6. OQ5's split (promote read-only rules/attention early, defer the `rig.mjs`/`driver.mjs` axis change
   behind the reliability cluster) is the right sequencing for the same reasons the bug-fix-first
   ruling exists; CR-1/CR-2 sharpen that split; nothing here forces the cluster to wait.
7. Migration order (§9) matches schema §9's phased rule; §9.5 lands user value in one pass
   (the ~51 gate-cleared rows become visible/auto-open — the incident rows among them).

## 4. OQ2 answer (defaults argued, workflow-anchored)

Operator 3 d (a human decision must survive a week's otherwise-reasonable inattention), schedule
14 d, resource 3 d, manual 7 d. Divergence from OQ2's recommendation: `resource` anchor to the
operator's attention rhythm; `manual` 1 d → 7 d because the measured median hold age is ~16 h and 49
rows are already >24 h — a 1-day default floors the current population into immediate nag. Defaults
must also be DECLARED in the detail text where a kind fires (CR-2), so a human calibrates them by
reading, not by archaeology.

## 5. What I did not do (honest scope)

No implementation, no queue-row registration, no proposal edits, noincident reopened (constraints
observed). The delegate's measured numbers are quoted with attribution; I did not re-measure the live
store (schema §10 carries the commands); nothing rests on remembered numbers — every code claim names
the file and the range I read at HEAD `6875bc8`, every doc claim its section.


