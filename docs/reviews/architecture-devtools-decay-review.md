# Architecture review — devtools small-local-model instruction decay: lead's proposal A–F

**Status:** review delivered (architect, item **#2730**, 2026-10-19). Reviews lead's proposal **#2708** on
architecture/mechanism grounds. Durable invariant recorded as **D-<mint>** (Proposed) in `docs/DECISIONS.md`.
**Method:** read the proposal against the tree — `src/degeneration.mjs`, `src/inflight.mjs`,
`src/context.mjs`, `src/config.mjs`, `src/providers/local.mjs`, `src/readapi.mjs`, `cli.mjs`
(`superviseOnce`), and D84/D105/D107/D24.

---

## Verdict

**Lead's A+B core judgement is correct; B is a genuine defect. I refine the *shape* of A and B and the
sequencing:** B is not a parallel fix — it is the **denominator** that A2, A3 (#62) and E all depend on,
and the codebase **already has** the relative pattern in two places. So the critical path is
`one window resolver → the guard uses it → #62 ordered guard → A2 D107`, not "A then B".

---

## B — the real defect, stated precisely (agree, with two corrections)

**Agree.** `src/degeneration.mjs` `DEGEN_DEFAULTS.maxContextTokens = 400_000` and the trip
`if (contextTokens >= o.maxContextTokens)` are **absolute**; `contextTokens` is the max
`usage.totalTokens` over the run's assistant turns. `superviseOnce` calls
`assessRun(pages[seat.name] ?? [])` with **no opts** (`cli.mjs:1339`), so the bound is global, not
per-seat. For a local seat whose window is 64 k (`src/providers/local.mjs:25`,
`DURIG_LOCAL_CONTEXT ?? 65536`), `400_000` can never be reached — the context bound is inert.

**Correction 1 — scope of "inert".** It is the **context-tokens backstop** that is inert, not the whole
guard: `tool-turns`, `repeats`, `malformed`, `pseudo-tool-call`, `language-drift`, `degenerate-text` and
`turn-duration` are all window-independent and still fire for a small seat. Say "the context backstop is
inert", not "the guard is inert" — the difference matters for how much B buys.

**Correction 2 — the fix is alignment, not invention.** The **relative** pattern already exists twice:
- `src/inflight.mjs:42-56` — `INFLIGHT_DEFAULTS.contextWindowFraction` (model-aware: "trip when
  estimated streamed tokens reach a share of the seat's context window"), with the explicit rule
  *"No window → NO token bound (honest: never invent a fraction, per ROADMAP 27)"*, using
  `declaredContextWindow` (`src/config.mjs:291`);
- `src/context.mjs` — the three-state denominator (`measured → declared → advertised`) and
  `fraction = consumed / window.value`.

So B is **D84-conformance**: D84 already rules the trigger must be a fraction (~60–70%) of the
**measured effective** window, with the ordered guard's abort above it (~90%). The post-settlement guard
simply never implemented D84. The fix is to make `assessRun`'s context bound use the seat's resolved
window × a fraction, reusing `windowState`/`declaredContextWindow`, and to keep inflight's rule
("no window ⇒ no token bound").

**Correction 3 — a second, structural gap.** `assessRun` is **post-settlement** (it reads committed
pages; `src/inflight.mjs:3` says so). For a small window the run can be **past** the window before the
guard ever sees it, so a post-settlement-only relative threshold still fires late. The **in-flight**
model-aware trigger (`inflight.mjs`) is exactly the answer — and it is **built but NOT WIRED** (grep:
`createInflightWatch`/`assessInflightTurn` appear only in `inflight.mjs`; the active guard is
#1767 trigger / #1768 halt / #1769 ordering, gated on lead's shape ruling and #62). **This is the
highest-leverage finding: the relative, model-aware bound for a small seat already exists and is
disconnected.**

---

## A — land the already-ruled mechanisms (agree; sequence by their real gates)

| Item | State (verified) | Gate |
|---|---|---|
| A1 D105 per-item `pi.reset` | **landed** (`src/broker.mjs` `planLocalContextBoundaries`/`applyLocalContextBoundaries`; #2325/#2337) | — |
| A2 D107 intra-item compaction, cap-2-then-re-anchor | **not landed** — #2402/#2403 held | GATED on #62 + the measured window (#1087) |
| A3 D84 ordered guard (#62) | **not landed** — #62 held | needs the window denominator (B) |

So "land them" is right but **A2/A3 are blocked on the same denominator B provides**, and A3 (#62) is
the ordering core that #1767/#1768/#1769 also wait on. Landing order is forced: **B → #62/A3 → A2/A3 →
wire #1767**. Landing A1 is done.

---

## C — re-anchor instructions (agree; note the duplication risk)

#1090 (constraint pinning: constitution VERBATIM outside any summary + re-inject at each phase
transition + a survival probe) is registered-but-held. It is **orthogonal to B** (B is about *when* to
act; C is about *what survives* the act) and it **complements A2** — a summary that drops the
constitution is the decay C prevents. Architecture note: re-injecting at "each phase transition" must
reuse the EXISTING reset seam (D105's `pi.reset` boundary) rather than add a second injection path;
otherwise two mechanisms will disagree about the context head.

---

## D — smaller-scope items for small-model seats (agree, with a mechanism caveat)

The `tier` already rides each item (`src/rig.mjs` `tierIndex`; `send_work`'s `tier`), so a read-side
flag is derivable **without new schema**: an attention/check rule "small-model seat holds an item above
`small`". But **"single-concern" is not derivable from persisted data** — it is a judgement about the
body — so the *enforcement* is a `pm` intake policy, not a mechanism. Recommend: enforce at intake
(policy) + a read-side flag (mechanism), and do NOT attempt an automatic body-based splitter.

---

## E — measured window + lower trigger (agree; it is the same denominator as B)

E's denominator is B's denominator. Two concrete notes:
- The **measured** window (#1087 / #2231) is **not built**; `src/context.mjs` reserves the state and
  says so. Today the honest denominator for a local seat is **`declared`** — and `readRigHealth`
  already resolves the local provider's window into the `declared` state (`src/readapi.mjs:73-103`,
  `:340-350`). So B can land **today** against `declared`, and upgrade to `measured` when #1087 lands,
  with no change to the guard's shape.
- "Lower than 80/90" is consistent with D84's ~60–70% trigger. Make the fraction a **per-seat/per-model
  parameter** of the one guard, not a second hard-coded default.

---

## F — model change (operator's call; its decision rule depends on B/E)

Agree it is the operator's fallback. Architecture note: **F's evidence rule — "degradation persisting
at a LOW fraction of the effective window ⇒ the model, not the context policy, is the limit" — is
unfalsifiable until the fraction exists.** So B/E are prerequisites for *making the F judgement at all*;
F cannot be evaluated before them. State that so the operator is not asked to decide F on an unmeasurable
basis.

---

## Systemic theme — one window denominator, resolved in four places, agreed in none

The seat's effective window is computed in `src/context.mjs` (display), `src/inflight.mjs` (in-flight
bound), `src/readapi.mjs` (health), and `src/config.mjs` (`declaredContextWindow`) — and the
**post-settlement guard ignores all of them**. The durable fix is one resolver
(`windowState`/`declaredContextWindow`) that **both** guards consume, so a threshold can never diverge
again. This is the one mechanism change that retires B, E, and the "which guard fires" ambiguity.

---

## Failure modes and recovery (the small-seat decay path)

1. **Window fills mid-run** (small local seat). Post-settlement guard cannot see it → run runs past the
   window. *Recovery:* the in-flight trigger (#1767, built, unwired) trips before `turn_end`; **wire
   it**. Until then, the only signal is post-hoc.
2. **Context backstop never fires** (absolute 400 k vs 64 k window). *Recovery:* B (relative bound,
   `declared` denominator today).
3. **Summary drops the constitution** (after A2). *Recovery:* C (#1090 verbatim pinning + survival
   probe).
4. **A multi-part item overflows a small seat.** *Recovery:* D at intake + a read-side flag.
5. **No window declared at all** (neither measured nor declared, and the provider advertises none).
   *Recovery:* the `inflight.mjs` rule — **no window ⇒ no token bound**, never invent a fraction
   (ROADMAP 27); fall back to the window-independent causes.
6. **The two guards disagree** (different denominators/fractions). *Recovery:* the single resolver
   (D-<mint>) + a demo asserting both read the same window for one seat.

---

## Ranked recommendations to `pm`

1. **B — defect, sequence with the bug-fix cluster:** make `assessRun`'s context bound relative to the
   seat's resolved window (`declared` today), reusing `declaredContextWindow`; keep "no window ⇒ no
   bound". Cite D84. Failing-first: a seat at 64 k trips the context cause at ~0.9 × 64 k, and does
   NOT trip when the window is unknown.
2. **Wire the in-flight trigger (#1767) behind the shared ordering (#62/#1769)** — it is built and
   disconnected; it is the only mechanism that can act BEFORE the window is exceeded.
3. **C (#1090)** — prioritize; route through the existing reset seam.
4. **E** — fold into B's parameterization (per-seat fraction), upgrade to `measured` when #1087 lands.
5. **D** — intake policy + a read-side flag (no auto-splitter).
6. **F** — surface to the operator, but state it is unjudgeable until B/E give the fraction.

## Evidence
- Read: `src/degeneration.mjs` (`DEGEN_DEFAULTS.maxContextTokens = 400_000`; the trip line),
  `src/inflight.mjs` (`INFLIGHT_DEFAULTS.contextWindowFraction`; the "no window ⇒ no bound" rule; the
  "post-settlement" note), `src/context.mjs` (`windowState`/`contextConsumption`), `src/config.mjs:291`
  (`declaredContextWindow`), `src/providers/local.mjs:25` (`DURIG_LOCAL_CONTEXT ?? 65536`),
  `src/readapi.mjs:73-103,340-350` (local window → `declared`), `cli.mjs:1339` (`assessRun` with no opts).
- Grep: `createInflightWatch`/`assessInflightTurn` appear only in `inflight.mjs` → **unwired**.
- Decisions: D84 (threshold = fraction of the measured effective window; ordered guard authoritative),
  D105, D107, D24, ROADMAP 27/62/1087/1767-1769/2231.
- No test run claimed: this is a design review; the failing-first checks above are what a build must pass.
