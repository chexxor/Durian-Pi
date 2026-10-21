# Security position — control-plane broker spool-op gate (RATIFICATION, item #2220)

- **Date:** 2026-10-17 · **Owner:** seat `security` · **Status:** RATIFIED WITH TWO REQUIRED SHAPE CHANGES + ONE NAMED RESIDUAL
- **Bounded by:** lead #2216 pt 6; extends #1952 Finding A / #2215; governs impl **#1966** (land sequenced with
  the active-guard fixes #1780); posture it replaces documented in #2186 (currently OPEN).
- **Surface read at HEAD of `security-item-2220`:** `src/broker.mjs:236` (`SPOOL_OPS = ["message","stop",
  "reset","compact","pause","unpause","configure"]`), `:327–347` (pause/unpause → `applyPauseOp`, configure →
  `harness.commit(configure(...))`), `:349/:389` (unknown op → `deadLetterIntent`), `:744` ("Deliver any spooled
  operator intent FIRST"), `:209–217` (`by: request.from`, rig-level `doc.paused/pausedBy`).
- **Principle invoked:** default-deny, least privilege, structured fail-closed refusals (`#1779` fail-closed
  decision point), defense in depth / never a single layer, and D-ENV-AUTH: OS identity is a norm, not a control.

## Scope

The authorization boundary for **control-plane ops that arrive through the broker command spool**: today
`pause`/`unpause` (rig-level transport state) and `configure` (a conversation's runtime `pi.agent` doc
reconfiguration), plus any future spool op in that class. Does NOT cover ordinary `message` flow (seats
talking work through the queue) or the landing/genlock lease. The gate is app-layer and must be falsifiable
by a demo that can run and fail.

## Answers to pm's three questions

**Q1 — is operator-only the right principal? YES, with one binding clarification and one honest caveat.**

Operator-only is the least-privilege default for every mutating control-plane op: the highest-value target of
this boundary is exactly the degenerate/rogue seat (ASI08/ASI10), and no seat has a legitimate reason to
reconfigure a peer's runtime doc or drain the transport. Caveat, stated as a REQUIRED and falsifiable property
rather than an assumption: **`from` is a producer-stamped string inside a spool file** — every seat runs as the
same Windows user, so file-write prevention at the OS layer does not exist, and `src/seatguard.mjs:9–10`
documents the command-string layer itself as unsound (PowerShell aliases, `-EncodedCommand`). Therefore the
boundary claims **detect-and-layer**, not absolute prevent:

| Layer | Control | Falsifiable probe |
|---|---|---|
| File tools | The spool/inbox dir and `.durig/` control files must be **never-writable roots** for every seat file environment (extend the `readOnlyRoots` inversion of #1465 to an explicit never-write list) | Seat `write`/`edit` targeting the inbox dir → structured `permission_denied` refusal (demo: run the refusal, expect nonzero) |
| Shell (best-effort, by its own admission unsound) | `seatguard` path-deny on the inbox dir | Same probe through the shell tool; may be defeated by `-EncodedCommand` (test BOTH and expect exactly that in the demo) |
| Gate decision record | Every gate decision is a stored row: `{requestId, op, from, sourceFile, decision, reason}` — accepted AND refused | After #1966: `checkup` reports any gate-class op accepted with `decision ≠ operator-auth` and any gate row absent for an accepted gate-class op |
| Accepted residual | A same-user process can still forge `from: "operator"` and reach the gate if it evades the first two layers | The demo's EnvCmd-bypass fixture documents it explicitly — the residual is NAMED here as unverified-for-prevention (D-ENV-AUTH), not silently accepted |

The wording matters: the gate is a real control only if the detection rows + tool-layer refusals land WITH it in
#1966. Ratify on that basis; prevent-only `from`-string-checking alone is NOT ratifiable (it is theater against
the named attacker).

**Q2 — does the create-vs-reconfigure carve-out open a hole? YES unless create is structurally insert-only.**
The attack: any non-operator (a seat shell, per D-ENV-AUTH) invokes the create path against an EXISTING seat's
doc and performs de-facto reconfiguration — the carve-out then becomes the bypass of the gate. The carve-out is
ratifiable ONLY with all four properties, as part of #1966:

1. **Existence check inside the same store transaction as the write** (single-writer store: piggyback on
   `harness.commit(tx …)`; a read-before-write outside the tx is a TOCTOU race).
2. **Insert-or-refuse, never overwrite/merge**: a create that finds an existing doc refuses with a structured
   error (`already_exists`, conversation id echoed) and leaves the doc untouched.
3. **No force/recreate flag** on the create path — nothing may bypass property 2.
4. If `up`'s write routes through `configure`'s code, the op model distinguishes **create vs reconfigure
   explicitly** (an `isCreate` bit that reconfigure cannot set from a spool request); reconfigure stays
   operator-gated regardless of which code path produced it.

Falsifiable probe: two concurrent `up`s for the same seat id → exactly one succeeds, the other refuses
`already_exists` (exit ≠ 0); `configure` with `isCreate` spooled by a seat for an existing doc → gate refusal row.
Racing-doc probes live next to the #1489-style concurrency fixtures.

**Q3 — any other control-plane ops that must be covered? THREE notes.**

1. `stop`/`reset`/`compact` are **run-state ops** (no `pi.agent` doc write), but aimed at conversations: read the
   target scope at implementation time. If these can target a conversation other than the sender's own, gate
   NOW (same operator-only class) — a cross-conversation `stop` is the same DoS as `pause` and re-opening the
   boundary later is the cost. In-conversation/self-scoped uses stay ungated.
2. **The automated halt actuator (#1768 [B], extend #1766) must NOT route through this gate.** The broker cannot
   be `from: "operator"` — by design — so a blanket "all spool ops are operator-gated" rule deadlocks the guard
   or tempts an exemption that destroys the boundary. Guards actuate as **internal store transitions** with
   their own structured record (`{cause: "degeneration-guard", …}`), exempt from the from-gate but visible in
   the same audit table. Probe: a simulated degenerate run triggers in-broker halt with NO operator request
   file on disk.
3. `unpause` is gate-class (it mutates the same rig doc as `pause`; an ungated unpause lets a seat undo a
   deliberate operator drain — trivially covered since #131ff already treats pause/unpause as one op family,
   `broker.mjs:327` handles both in one branch).

## Required shape changes for #1966 (state explicitly, for impl to sequence)

- **CHANGE 1 (carve-out hardening):** implement Q2's four properties; the carve-out as currently written
  (create ungated, no stated insert-refuse semantics) is not ratifiable as-is.
- **CHANGE 2 (halt-actuator exemption):** implement Q3.2's internal-transition exemption before the active-guard
  [B] work (#1768) lands, or fold into its sequencing with #1780.
- **CHANGE 3 (detection rows):** the gate-decision audit rows + `checkup` rules above ship IN #1966, not later —
  without them the gate is unverifiable (P1: a control that cannot run and fail is not a control).

## Non-goals

Absolute prevention of same-user forgery (does not exist at the OS layer today: D-ENV-AUTH; re-visit if the
host daemon #725 ever splits identities); message-flow and landing/genlock authorization (separate boundaries);
codemode capability minting (docs/CODEMODE.md remains the door); approval digests (ROADMAP 149/#1804 is the
related but distinct approval protocol).

## Citations

`src/broker.mjs:209–236, 327–349, 389–390, 744`; `src/confine.mjs` (`isInside`, `readOnlyRoots` #1465,
junction-canonicalization QA #1489); `src/seatguard.mjs:9–10`; #1952 Finding A; #2186 (OPEN posture);
#1966 (impl target item); #1779 (fail-closed); #1800/ROADMAP 145 (ASI08/ASI10 rows); ROADMAP 131; ADR
0030 (action-bound approval analog).
