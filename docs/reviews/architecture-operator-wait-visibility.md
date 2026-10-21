# Architecture — "waiting on the operator": representation, visibility, and the answer flow

**Status:** design exploration / proposal (architect, item **#2700**, 2026-10-19). No build. Durable
decision recorded as **D114** (Proposed) in `docs/DECISIONS.md`.
**Angle (mine):** the ARCHITECTURE/MECHANISM — how "waiting on the operator" is represented in
already-persisted state and surfaced **without a new write path or schema** (D24), and how the answer
flow writes back. Siblings: advocate (flow), designer (surface); `pm` sequences design first, then
decomposition.
**Constraint honoured:** no new write path, no new schema, no second writer. Every mechanism below is
composed from primitives the rig already has.

---

## 1. Grounding — what already exists (do not rebuild it)

| Fact | Where it is already persisted / derived |
|---|---|
| "This item is parked on a question for the human" | `item.status === "deferred"` + `item.deferredTo === "human"` (`src/rig.mjs:692-694`, marker `DEFERRED_TO_HUMAN = "human"` at `src/rig.mjs:115`) |
| The question text | `item.question` (`src/rig.mjs:693`) |
| Who parked it, when, on whom | the append-only `item.transitions` entry `{at, event:"deferred", by, to}` (`src/rig.mjs:695-700`) — the D23 audit trail |
| A seat that stops instead of guessing | `defer_work` tool (`src/rig.mjs:663-716`), incl. seat-to-seat via a `QUESTION #<id>` item |
| A supervisor escalation onto the human | `applyEscalations` writes the **same** `status:"deferred"` + `deferredTo:"human"` (`src/supervisor.mjs`) |
| It is already surfaced | the `deferred_awaiting_answer` attention notice (`src/attention.mjs:359-366`): "N item(s) parked on a question; #id waiting on `<deferredTo>`" |
| The one sanctioned client write surface | the command spool — `SPOOL_OPS` (`src/broker.mjs:368`), `applyRequest` (`src/broker.mjs:377`), `drainIntentInbox` (`src/broker.mjs:508`), result channel |
| Taking an item back | `resume_work` (`src/rig.mjs:721-745`): `deferred → claimed` + a `{event:"resumed"}` transition |
| Re-waking a resumed/claimed item | `selectWakes`'s stalled-claim branch (`src/driver.mjs:56-64`): a `claimed` item with no in-flight submission and no live lease **is re-woken** |

**Conclusion:** the *representation* of "waiting on the operator" already exists and needs **no change**.
The real gaps are (a) an operator-facing **read view** that names it as such, and (b) an **answer flow**
— today the only way an item leaves `deferred` is the **seat** calling `resume_work`; the operator can
`send` a message but cannot resume the item, and a `deferred` item is **never** re-woken by `selectWakes`.

---

## 2. Principle

> Represent by **reuse** (`deferred` + `deferredTo`), surface by a **read-only derivation** over that
> persisted state (the D24 shape: a query, not a new instrumentation surface), and compose the answer
> from the **existing** write path (one spool op the broker applies with its own harness) plus the
> **existing** `transitions` array. No new field. No second writer.

---

## 3. Mechanism proposal

### 3.1 Representation — unchanged
`status:"deferred"` + `deferredTo:"human"` + `question` + the `deferred` transition. The answer, when it
comes, is recorded as **one more `transitions` entry** (`{at, event:"answered", by:"operator"}`) — the
array is append-only and already the audit trail, so this is not a schema change.

### 3.2 Visibility — a read-only `waiting` derivation
- Add a derived view `waiting` = every item with `status === "deferred"`, split by
  `deferredTo === "human"` (operator) vs a seat name, oldest-first, each with
  `{id, to, subject, question, deferredAt, ageMs, escalated}`. Pure query over the persisted queue —
  the same class as `metrics`/`attention` (D24), served by the broker through the read spool (D111).
- Surface it in two places, both read-only: a `status` headline ("N item(s) waiting on you") and
  `node cli.mjs queue --waiting`. The existing per-seat `deferred_awaiting_answer` notice is kept and
  sharpened to distinguish **human** from **seat** and to carry `ageMs` (a stale question must be
  visible; the supervisor already ages deferred items — reuse that logic).

### 3.3 Answer flow — compose the existing write path
The operator answers with one CLI verb:
`node cli.mjs answer <itemId> --body "<text>" [--from operator]`, which spools
`{op:"answer", itemId, content, from:"operator", requestId}`. The broker applies it with its **own**
harness (the existing spool path — `SPOOL_OPS` extends, per ROADMAP 71's rule "a new mutating verb
EXTENDS this list … rather than opening a second writer"), atomically:
1. append `{at, event:"answered", by:"operator"}` to `item.transitions`;
2. flip `item.status = "claimed"` (the exact `resume_work` flip, `src/rig.mjs:733-738`);
3. deliver the answer text to the item's seat conversation as an operator input (the existing
   `message` delivery, `src/broker.mjs` `applyRequest` `op === "message"`).
Steps 1–2 are one commit; step 3 is the same input delivery `message` already performs, so the seat
wakes and continues. If the seat is dead/wedged, the item is now `claimed` with no in-flight run, so
`selectWakes`'s stalled-claim branch re-wakes it on the next pass — the answer flow **self-heals**
instead of stranding.

### 3.4 Options considered (with the accepted trade-off)

| Option | Shape | Trade-off |
|---|---|---|
| **C2 (recommended)** — new `answer` spool op | one op in `SPOOL_OPS`; broker appends the `answered` transition, flips to `claimed`, delivers the text | adds one op to the spool vocabulary (a *sanctioned* extension, not a new write path); the operator's answer is durable **and** the item resumes deterministically |
| **C1** — reuse `message`, zero new ops | `answer` = `send <seat> "ANSWER #<id>: …"`; the seat must call `resume_work` itself | no new op, but the resume depends on the seat acting; if the seat is dead the item stays `deferred` and is **never re-woken** (the seed-incident class) |
| **C3 (rejected)** — add `item.answer` / an `answers` doc | new field/doc | **violates the constraint** (new schema) and D24's read-only ethos |
| **C4 (rejected)** — the CLI opens a harness and writes the resume itself | direct write | **second writer** — the 2026-10-16 corruption class; refused by `refuseWhileBrokerDrives` |

**Recommendation: C2**, with C1 as the zero-op fallback if the operator reads "no new write path"
strictly enough to bar a new op.

---

## 4. Failure modes and recovery (each paired)

1. **Answer arrives while the seat is dead/wedged.** C2: the item is `claimed`; the stalled-claim branch
   (`src/driver.mjs:56-64`) re-wakes the seat. *Recovery:* automatic on the next pass. C1: the item stays
   `deferred` and is never re-woken — *no automatic recovery* (why C2 is preferred).
2. **Answer to an item that is not deferred** (already resumed/done, or a typo). The op **refuses** and
   names the current status (mirroring `resume_work`'s guard, `src/rig.mjs:734-735`), dead-lettered with
   the reason. *Recovery:* none needed — a no-op with a legible reason, never a silent apply.
3. **Two answers race.** The first flips `deferred → claimed`; the second sees `status !== "deferred"`
   and is refused (same as #2). Idempotent by the status guard + the spool's `requestId` ledger.
4. **The broker is down when the operator answers.** The spool is a durable file; it is drained on the
   next broker pass, and the `requestId` result channel makes a re-drain idempotent. *Recovery:* the
   existing spool guarantees (no new mechanism).
5. **The seat re-defers after the answer.** A new `deferred` transition; the operator sees it again in
   `waiting`. Expected, not a fault.
6. **A supervisor-escalated item** (`deferredTo:"human"` written by the supervisor, not the seat) is
   answered the same way — the flow does not care who parked it.
7. **The answer text is huge.** Bounded by the same delivery path `message` already uses; no new limit.
8. **Operator answers the wrong item id** (a valid but unrelated deferred item). The op acts on the
   named item; `waiting` shows subject + question so the operator can confirm before answering. (A
   confirm-by-subject guard is a UX decision for the `designer` sibling, not a mechanism need.)

---

## 5. Contracts

- **CLI:** `answer <itemId> --body <text>` (spools the op); `queue --waiting` / a `status` headline
  (reads). Non-interactive, one JSON document per command (D21).
- **Spool op:** `{op:"answer", itemId:number, content:string, from:"operator", requestId:string}`.
- **Read view:** `waiting → Array<{id, to, subject, question, deferredAt, ageMs, deferredTo, escalated}>`.
- **NOT responsible for:** choosing the answer's content; auto-answering; a new schema; a second writer;
  deciding whether answering should *also* re-anchor the seat's context (a separate question — see §7).

---

## 6. Acceptance probes (falsifiable)

1. **Happy path (RED before C2 exists):** a seat calls `defer_work(itemId)` to the human → `status`/
   `queue --waiting` lists it with the question → `answer <itemId> --body "yes"` → the item becomes
   `claimed` with an `answered` transition, the seat's transcript contains the answer text, and the
   broker re-wakes the seat (stalled-claim) → the seat completes the item.
2. **Negative:** `answer` on a `claimed`/`done` item is refused and dead-lettered with its status; no
   state change.
3. **Liveness:** answer while the seat has no live run → the seat is woken by the *next* pass without an
   external `resume`.
4. **Idempotence:** the same `requestId` answered twice applies once (result ledger).

---

## 7. Open questions (for `lead`/operator, not decided here)

1. **Does answering auto-resume, or leave the item to the seat?** C2 auto-resumes (robust); C1 leaves it
   to the seat (more explicit). This is a policy choice.
2. **Seat-to-seat symmetry:** a seat answering another seat's `QUESTION #<id>` currently cannot resume
   the asker's item either. A symmetric `answer_work(itemId, text)` seat tool would close it — out of
   this item's operator scope, but the same mechanism; flag for `pm`.
3. **Re-anchor on answer:** a local-provider seat may want a context boundary when it resumes after a
   long wait (D105's seam). Separate decision; not needed for the mechanism.
4. **D-numbering:** this ADR uses **D114**; scribe's pending **D113** (control-plane spool ops) lands
   first, and lead #2452's rule re-derives numbers at land time.

## Evidence
- Read: `src/rig.mjs:115,663-716,721-745`; `src/supervisor.mjs` (`applyEscalations`); `src/attention.mjs:359-366`;
  `src/broker.mjs:368,377,508`; `src/driver.mjs:52-64`; `docs/DECISIONS.md` D23/D24/D111; ROADMAP 71.
- This is an exploration: no implementation, no test run claimed. The acceptance probes in §6 are the
  falsifiable checks a build would have to pass.
