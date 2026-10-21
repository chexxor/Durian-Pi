# Security position — durable-TUI attach seam (ROADMAP 55; input to lead's ruling, item #3944)

- **Date:** 2026-10-19 · **Owner:** seat `security` · **Status:** CONSTRAINT SET (lead decides; the operator decides question 2 — ui screen vs second terminal)
- **Boundary under position:** the durable TUI's attach to a seat's live conversation (D101 Phase 2), candidates:
  (a) operator window (`pause` → TUI `--own` → resume), (b) broker-owned interactive client via the command
  spool (ROADMAP 52+56), (c) read-only pi-renderer launch mode.
- **What the invariants already fix (already implemented):** the single-writer rule; `src/storeownership.mjs`
  fails CLOSED before a second writer opens a broker-owned store (D42/F24), heartbeat-based liveness
  (20 s refresh / 60 s dead window, recycled-pid hardened, genlock reservations read); ROADMAP 52 puts the
  FIRST subscriber IN-PROCESS behind the existing `readapi` seam — "no socket, no new trust boundary";
  ROADMAP 56 keeps the spool as the out-of-process substrate ("no broker ⇒ no owner ⇒ no harness").

## 1) Is (b) permitted at all — yes, in principle, with named preconditions

A broker-owned interactive client does NOT violate the single-writer rule by construction (the client never
opens the store; it reads a subscription and submits through the spool — that is what (b) was designed to
keep). The real risk of (b) is that an interactive client is the natural **operator surrogate**: whoever
types at that terminal can submit intents. So the preconditions (each falsifiable):

- **P-1 client-never-writer:** the client process passes the `storeownership` refusal exactly as a
  second-writer probe (its only store access is subscription; its only enqueue path is the spool).
  Probe: start the client while the broker is up and make it attempt a direct store open → structured
  refusal, still non-owner.
- **P-2 stamped identity, operator-class preserved:** every client-submitted intent is stamped with a
  client identity the broker can record (client/pid/origin), and **control-plane-class ops
  (pause/unpause/configure/stop/reset-cross) stay behind the #2220 operator gate** — attaching a client
  must never widen privileges. Today `from` is producer-stamped and forgeable at the same OS user
  (my #2220 finding); the client does not make that worse ONLY IF client intent is treated as
  SEAT-class for authorization. Probe: a client-submitted `configure` lands a gate refusal row, not a
  reconfiguration.
- **P-3 render comes from the subscribed store view, never from raw pi stdout:** the store's redaction
  (post-`afterTool`) is the quarantine durig already built; a render path that bypasses it would widen
  exposure by construction. Probe: a rendered tool result that contains a credential renders as the
  redaction marker, never raw.
- **P-4 assistant-output screening is an EXPLICIT residual decision, not a default:** assistant output is
  NOT screened today (#1803 is the registered held item — position 2 of the confirmed 146→150 order). An
  attached client renders assistant text to the operator's terminal unscreened — the same class as
  today's ui, so it may proceed ONLY with the residual named in the ruling ("assistant output renders
  unscreened at the operator's own terminal; all non-operator surfaces stay redacted"), cleared the
  moment #1803 lands. This is a decision lead can make in one line; do not let it be decided silently.
- **P-5 render-layer escape sanitizer is REQUIRED before ANY candidate ships a terminal render** — this is
  a NEW surface the secret redactor does not cover (different threat: terminal control, not secret
  leakage). Model/tool content may contain ANSI/OSC/bidi/zero-width sequences: the renderer must strip or
  allowlist them (no OSC except allowlist; control-CWs off; bidi neutralized). Probe: a fixture string
  containing an OSC-8/CPU-shape sequence rendered via the client does not alter terminal state; the
  sanitizer is its own small item with tests (it does not exist today — named gap N-1).

## 2) Sanitisation and redaction — the existing tool-result redactor is necessary and insufficient; render adds a second screen

-Inheritance: for (b) and (c), if rendering is store-fed (P-3), the redactor that exists today carries over
  AUTOMATICALLY — tool results are redacted at the write path before they are stored. That is the position's
  reason to REQUIRE store-fed rendering: it makes the redaction property structural instead of duplicated.
-Gap (assistant output): unscreened until #1803; see P-4 — an explicit residual label now, screening later.
-Gap (terminal control): the escape sanitizer (P-5) is new work with its own acceptance.
-Gap (composite): redaction markers themselves must survive rendering (the marker is the safety property
  during interim) and the per-pass redaction counter (#3122 fix family) should surface in the client's
  status bar so a false-positive cluster is visible from the attach surface too.

## 3) Fail-closed direction — ownership must never rest with a dead process, and every transfer must write its recovery first

- For **(b)/(c)**: attach takes NOTHING that survives a failure: it holds at most a subscription and a spool
  outbox slot. If the client dies mid-attach: the broker is unaffected; submissions the broker could not
  pair get dead-lettered by the spool's existing dead-letter rule; the next attach builds a new
  subscription. There is NO window in which the store is owned by nobody (PROBE in the ruling acceptance:
  kill the client mid-handoff; assert the broker's writer status and the store open state are unchanged).
- For **(a)** (and this is where the "worse than no seam" case REALLY lives): a pause-and-own window TRANSFERS
  writer ownership from the broker to the operator's TUI process. Constraint T-1: the pause must be a
  TRANSACTION that records the recovery contract BEFORE the store is released (`pausedBy`,
  `attachPending: resume-on-tui-exit`, expected TUI pid) — so a next `durig up`/`serve` knows a TUI exit is
  pending re-acquire. Constraint T-2: crash discipline — if the TUI dies, the store is ownerless only up
  to the heartbeat semantics already implemented (a stale heartbeat beyond
  `BROKER_HEARTBEAT_TIMEOUT_MS = 60_000` reads as dead; the re-acquire is then legal). The operator's
  visible state during that window is `durig status`/the state file (paused + attach-pending + recorded
  pid). Constraint T-3: the TUI's `--own` open path must pass the same `storeownership` discipline
  inverted — it must CHECK it owns (not merely "refuse if broker owns") and DEMOTE on exit, including on
  its own crash path as far as process teardown allows; the unpause always RE-ACQUIRES via the guard,
  never assumes.
- Fallback if the broker dies (ROADMAP 55's acceptance asks for this explicitly): the client remains a
  read-only renderer of the last snapshot with a "broker down — view frozen; go through `up`," never
  promotes to writer, spool intents queue on disk (56's substrate) and drain on the next `up`.

## 4) The floor — (c) with the IN-PROCESS subscriber is a valid interim, and (a) is acceptable only with T-1..T-3

- (c) as interim is the LOWEST-exposure candidate that exists: reads cannot corrupt; it needs no socket;
  ROADMAP 52's in-process `viewState().subscribe()` is the trust boundary that already exists (52's own
  wording: no new one). Its cost vs (a): no steering from the rendered surface (submit stays with the
  queue/other window) — an operator-UX cost, not a security cost; the same P-5 escape sanitizer applies.
  (c) + a subsequent swap of the subscription transport to socketed `watchEvents` is where 55's
  socket-position trigger fires — (b)/(c-socket) require THIS position (exists now) plus the P-1..P-5
  deltas named above, registered as their acceptance.
- (a) is not banned — the operator window is a legitimate mode — but it is the ONLY candidate that
  creates an ownership-transfer window; with T-1..T-3 wired it is bounded (≤ heartbeat window per the
  crash case) and visible; without them it is the seam that manufactures "store owned by nobody".

## Named gaps (so the ruling is made on named facts, not optimism)

- **N-1 escape sanitizer does not exist** (new item, small, tests-first): strip/allowlist-render
  control sequences; bidi/zero-width neutralization; OSC allowlist.
- **N-2 assistant-output screening is #1803** (held, position 2 of 146–150): either sequence the attach
  ruling's P-4 residual label now, or slide 148 ahead of the (b) attach work — lead's sequencing call.
- **N-3 from-stamping remains forgeable at the same OS user** (#2220's residual): the client must not be
  treated as "the operator" by virtue of its keyboard; the #2220 audit-row work stays the guarantee of
  record. docs/CODEMODE.md + BROKER-SUPERVISION.md's unverified egress/credential areas stay unverified
  — an attach surface does not change that; it ADDS an operator-visible read of what the fleet already
  writes.

## Citations

`docs/ROADMAP.md` 52/55/56 (verbatim accepted bits: readapi/in-process first; "no broker ⇒ no owner ⇒ no harness");
`src/storeownership.mjs` (fail-closed writer refusal; `BROKER_HEARTBEAT_TIMEOUT_MS = 60_000`; reservation rule);
`src/confine.mjs` 497-539 (exec discipline as precedent for the client's posture);
`docs/reviews/security-sec-broker-socket.md` (the analog socket precedent 55 cites);
`docs/reviews/security-control-plane-gate-position.md` (#2220 — operator gate + detect-and-layer);
`src/seatguard.mjs:20` + `src/secretredact.mjs` (the existing tool-result redaction path);
`#1803` (assistant-output item, held); `#3122` (redaction counter family); ROADMAP 55 (this position is its
55-commanding "position BEFORE any attach socket" for the remote branch).
