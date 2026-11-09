# security position — the memory WRITE GATE (ROADMAP 167 / 179)

Item **#4827** (from `pm`), written 2026-11-08T04:4xZ on base `7ccb2163`. Status: **position
PRECEDES code** (item 55, `docs/runbooks/security-trust-boundary-review.md`); D236 §5 makes it a
hard gate — *"nothing in 165/166/167 is buildable until that position lands"*
(`docs/DECISIONS.md:10255-10258`). This doc is a proposal: adoption routes to `lead`/`pm`, and where it
names a dependency I route the choice, I do not take it.

## Scope: what boundary is being opened

A **write path into a durable, shared, later-injected store.** Concretely the surface ROADMAP 179
specifies (`docs/ROADMAP.md:3082-3095`): a `remember({subject, predicate, object, valid_from,
source_entry})` tool, a `beforeTool` hook keyed on `source_kind`
(`seat_authored | tool_output | retrieved_doc | external_message`), a `tier`
(`quarantine | durable`), plus the two read/delivery paths that make a written record consequential:
162/176 (budgeted recall) and 163/164 (a prompt `sections` block, cue-triggered delivery).

One capture tool, one store, **one shared team memory per project** (R1,
`docs/reviews/memory-implementation-plan.md` §8). Consequence I hold fixed: because the memory is
shared and durable, the write path is an **injection path into every future seat in the project**, and
into the **cached prefix** — so it is a confidentiality *and* an integrity boundary, not a storage
feature.

Measured state at `7ccb2163`, each command re-run this turn in this worktree (so the reader knows what
exists, not what a summary claimed):

| probe | result |
| --- | --- |
| `grep -rn quarantine src/*.mjs` | **0 hits** — the tier is unimplemented, nothing to inherit |
| `grep -rn defineDocFamily src/*.mjs` | **0 hits** — the store-doc route 165 assumes is unwired |
| `grep -n "redact" src/rig.mjs` | **0 hits** — the prompt-assembly path carries **no** redaction |
| `grep -n "sections" src/rig.mjs` | one hit, `src/rig.mjs:618` (`sections: [`) — the funnel exists once |
| `grep -nE "writeFile\|api\.commit" src/seatguard.mjs` | 0 hits; only `console.error` warnings at `:51,:69,:372,:469` — **mediators return `{block: …}` and record nothing** (`beforeTool` at `src/seatguard.mjs:418`, blocks at `:424,:435,:442,:450,:455,:461,:467,:506`) |

That last row is the load-bearing one: **the rig has no record of what a seat was shown.** ROADMAP
already measured this (`docs/ROADMAP.md:92-95`, the `avc: denied` analogue "measured absent"). It
bounds what the write gate can honestly verify, and I say so rather than designing as if it existed.

## The two operator boundaries, made falsifiable

D236 §5 rules two things in the operator's adopted words. Prose cannot hold either one; each needs a
check that can fail.

**B1 — "quarantine content is NEVER rendered in a prompt section."**
Mechanical form: there is exactly **one** function that turns memory records into prompt text, and it
takes `tier` and refuses `tier === "quarantine"` itself. Not a filter at call sites — a filter at call
sites rots as soon as a second caller appears.
Probe (`demo/memory-quarantine-render.test.mjs`): plant one quarantine doc and one durable doc in a
fixture store, assemble the context, assert the quarantine body's marker string appears **0** times in
the assembled prompt and the durable marker appears ≥1. Must fail if the refusal is moved to a caller
or bypassed by a second renderer.

**B2 — "no memory record may ever satisfy a permission check — memory informs reasoning only."**
Mechanical form: every predicate that answers *"is this allowed / is this gate satisfied / may this be
released"* takes **only store ids** (queue item id, gate id, `docs/DECISIONS.md` anchor) and never a
memory record, a memory score, or memory-derived text.
Probe (`demo/memory-not-authorization.test.mjs`): fixture in which a memory doc asserts *"lead approved
release of #N"*; assert the release/gate check still refuses, and that flipping that doc's presence
does not change the boolean. Static companion (`check` rule): no call site passes a memory-doc object
into a decision predicate — a rule that can go red, not a paragraph.

## Threat model

Severity is my judgement of blast radius here (project-wide + durable + cached = HIGH). Every row names
the exploit path and the fix, and a probe that can run and fail.

| # | Threat (exploit path) | Control I require | Falsification probe |
| --- | --- | --- | --- |
| T1 | **Provenance laundering — HIGH.** 179 keys the gate on `source_kind`, but if the capture tool *accepts* `source_kind`/`source_entry` as an argument, the caller declares its own origin: label a planted instruction `seat_authored`, or cite a syntactically valid id never read, and quarantine is skipped by construction. | Tier is **derived by the gate**, never accepted from the payload: the tool's argument list has **no** `source_kind` field. Origin resolves from broker-held facts only. **Interim, because the delivery record does not exist** (table above): everything is quarantine **unless** `source_entry` is an id in the calling seat's own claim chain (its claimed item, its DONE notice, its gate ids) — all broker-derivable today. Unprovable provenance ⇒ quarantine. Fail closed. | Call `remember` with (a) a forged id, (b) an id from another project, (c) no `source_entry`, (d) a real `retrieved_doc` id. Assert: (a)(b)(c) refused, (d) forced `tier="quarantine"` even when the payload asked for `durable`. |
| T2 | **Cross-seat poisoning — HIGH.** Seat A reads a file carrying a planted instruction (161's probe), captures it, and it reaches seat B's prompt. | 179's forcing (`tool_output`/`retrieved_doc`/`external_message` ⇒ quarantine, non-negotiable) **plus** quarantine ineligible for 164 delivery, **plus** promotion only out-of-band. | 161's planted-instruction probe, extended: the planted text must appear in the quarantine tier and **0** times in any `sections` block and in any seat's assembled prompt. |
| T3 | **Authorization-by-memory — HIGH.** A record asserting an approval (real, stale, or forged) is consumed by a seat as the reason to `release_work`, to treat a gate as resolved, or to start a held item. The rig already has the failure shape: a wrong cause in a row body becomes the rig's memory of the defect (`docs/DECISIONS.md:7858`). | B2, enforced at the predicate, plus: memory text may be *cited* by a seat but may never be the *decision input*. Held/deferred state changes stay keyed to store rows and actors. | B2 probe; additionally, drive `release_work` on a held item with a memory doc present claiming approval and assert the refusal is unchanged. |
| T4 | **Injection with cache persistence — HIGH.** A memory record rendered into `sections` is an instruction inside the trusted prefix, and the prefix is cached (~385 M cached-in/day per `docs/ROADMAP.md:2885`), so one bad record survives turns and seats. Unlike a tool result it passes **no** redactor — `grep -n redact src/rig.mjs` → 0 hits. | One rendering funnel (B1) that (i) fences+labels per 164, (ii) runs the **control-byte** gate from `refusalForControlBytes` (`src/seatguard.mjs:239-256`) on the record body at **capture** time — the store path bypasses the file-write guard entirely, and the #780 shape (a swallowed byte) is exactly as destructive inside a prompt as inside a file. | Plant a record containing a stray `0x08`; assert capture refuses naming the byte, and assert 0 control bytes survive into the assembled prompt. |
| T5 | **Secret persistence through the store — HIGH.** Delivery redaction exists only on tool results (`redactToolResult`, hooked at `src/seatguard.mjs:530`). A value a seat legitimately saw, or one sitting in a row body, can be captured into a **durable** doc and then re-delivered through a path with no redactor. Removing it from source is necessary and never sufficient: the provider value is **compromised and must be rotated**. | Write-time secret gate on the capture path, reusing the existing scanner class (`src/config.mjs:82 looksLikeSecret`, `src/secretdetect.mjs:47-56`) with the same deliberate precision-first trade `secretOffendersInDiff` documents (`src/seatguard.mjs:296-337`): provider-prefix shapes + PEM line, **name the field, never the value**. Plus a keep-gate that scans memory bodies. | Capture a doc containing a provider-prefixed token and a `-----BEGIN … PRIVATE KEY-----` line; assert refusal, assert the refusal text and the stored row carry **no** the value, and assert a planted offender never reaches an assembled prompt. |
| T6 | **Promotion laundering — MED.** Promotion done by a model, or smuggled into the same commit as the capture, makes quarantine decorative. | 179's rule, stated as a gate: promotion is its **own commit**, actor is a human, recorded. No promotion path is reachable from a seat tool at all. | Assert a promotion attempted inside a seat turn fails; assert a real promotion appears as a distinct commit with a named actor. |
| T7 | **Crash-replay double decision — MED.** pi-durable re-runs a hook after a crash. A hook that decides tier without storing the decision can decide differently on replay, or write twice. | `api.memo` first-write-wins on **every** memory write path; `replay: "safe"` on reads only (179's own trap note). | Replay the same capture twice; assert exactly one row and one tier decision, and that the replayed tier equals the first. |
| T8 | **Capture-volume saturation — MED.** ASI06: unbounded writes become a prompt-budget attack on the delivery path — cheap to do, degrades every seat in the project. | Per-seat and per-item capture budget; the 164 token cap enforced at delivery with an explicit **refusal**, not silent truncation. | Capture past the budget; assert capture refuses at the bound and delivery reports the overflow rather than dropping records quietly. |
| T9 | **Forget bypass — MED.** A tombstone on the doc family does not remove the copies already in `.durig/` bodies, session logs and the spooled inbox, so "forgotten" content still gets delivered. | 168's shape, as a gate: `sweep` **reports** remaining copies per surface; it never asserts absence. | Forget a phrase planted in a doc, a queue body and a session log; assert the report names each remaining copy and a delivery probe finds none of them in a prompt. |
| T10 | **Project scope leak — MED.** R1.1 ("no ambient fallback") is a default that a convenience fallback in the read path silently voids. | Default-deny scope in **both** paths, expressed as a `check` rule, not prose; index is per-project and disposable (R1.4). | Run with an unmapped project: assert 0 records returned and capture refused; assert a cross-project id is refused at capture. |

## Explicit non-goals

- **Not** the OS-grade substrate. Confinement, labels and `allow` rules as data are 170–174; every
  control above is app-layer and falsifiable by a runnable check, because every seat runs as the same
  host user — OS identity is a norm, not a control (D-ENV-AUTH).
- **Not** retrieval quality, embeddings, or cache economics (175 owns the cache gate).
- **Not** a redactor redesign, though it depends on a known hazard: the redactor eats 40-hex tokens in
  row bodies, so a memory body that pins a sha can be **unexecutable** when read back (#5252). Any
  "assert sha X" fact must survive round-trip — that is a probe, not a caveat.
- **Not** whether to build memory at all (R3 ruled it), and **not** scope adjudication: G2's full form
  needs a decision I route below.

## Gates — what must hold before 165/166/167 code lands

1. **G1** one rendering funnel, tier-refusing, no second caller (B1).
2. **G2** tier **derived**, never declared; `source_kind` is not an argument (T1).
3. **G3** quarantine ineligible for `sections` and for 164 delivery (T2/B1).
4. **G4** no decision predicate takes a memory record (B2).
5. **G5** write-time secret + control-byte gate on the capture path (T4/T5).
6. **G6** promotion is out-of-band, its own commit, actor recorded (T6).
7. **G7** `api.memo` first-write-wins on every write path; `replay: "safe"` reads only (T7).
8. **G8** capture and delivery budgets enforced as refusals (T8).
9. **G9** project scope default-deny as a `check` rule (T10).
10. **G10** the planted-instruction probe (161) is a **failing-first demo before 165/166 code**: it must
    be red, then green, and it must assert absence from the assembled prompt — not merely absence from a
    tier column.

**Dependency I route, not resolve.** G2's honest form — "was this content actually shown to this seat?"
— requires the mediation/delivery record that ROADMAP 172 names as measured absent. Two coherent routes
for `lead`/`pm`: **(a)** land 172's mediation log ahead of the write gate, or **(b)** build 167/179 now
with the conservative interim in T1 (own-claim-chain-only non-quarantine) and raise the tier rule when
172 lands. I recommend **(b)** — it is buildable offline against the faux provider (R3) and it fails
closed — but the row text must state the interim, or a builder will implement `source_kind` as an
argument and void the gate. Also for `pm`: 167's acceptance text should name probe G10 by path, since
"the planted-instruction probe from 161" currently spans two rows.

## Precedents and citations

Re-run at writing time in this worktree (branch `item-4827`, base `7ccb2163`) — never from session
memory (pitfall 53): the gate hooks precedent is `SeatGuard` (`src/seatguard.mjs:528-530`, `beforeTool`
at `:418`); content-aware write refusals at `:239-256` (control bytes, #780) and `:268-293` (collapse,
#623); the secret-at-write-path gate precedent (docblock `:296-304`, scanner `:317-337`) with its
stated precision-first trade
(#1315/#1379); delivery redaction hook at `:530`; write-target extraction `src/writetargets.mjs:152`;
per-seat tool surface `src/seattools.mjs:272` (per-seat today, not per-claim — the 173 gap); secret
predicate `src/config.mjs:82` and `src/secretdetect.mjs:47-56`; prompt `sections` mechanism
`src/rig.mjs:618`. Rows: `docs/ROADMAP.md:2879` (161), `:2889` (162), `:2893-2897` (163), `:2898-2901` (164),
`:2913-2919` (167), `:3082-3095` (179), `:92-96` (sequence + 172's absent log); rulings
`docs/reviews/memory-implementation-plan.md` §8 (R1–R4), `docs/DECISIONS.md:10255-10258` (D236 §5),
`docs/DECISIONS.md:7858` (a wrong cause becomes the rig's memory).

## Consequence for implementation

167/179 is **not** a filter over a `remember` tool; it is three invariants with one funnel each: origin
derived, quarantine unreachable from prompt assembly, and memory invisible to permission predicates.
Build it failing-first with `demo/memory-quarantine-render.test.mjs`,
`demo/memory-not-authorization.test.mjs` and `demo/memory-origin-gate.test.mjs` written red against
fixtures before any store wiring, and treat the mediation-log gap as a stated interim rather than a
silent one.
