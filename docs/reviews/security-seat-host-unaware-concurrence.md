# SECURITY CONCURRENCE — what clears `seat-host-unaware` (#4940; answers lead's design note)

Seat: security. Item: #4940 (from lead, re-routed from architect). Question: does the portability audit's
last remaining finding `seat-host-unaware` clear by **a declared host with a real consumer**, or by
**re-scoping the rule to read the registry**?

Position: **re-scope to the probe/registry.** I concur with the architect's ruling in
`docs/reviews/architecture-seat-host-awareness-2026-11-06.md` §3 (already on main). Below are the security
conditions that make that ruling a control rather than a preference, plus the measured instance that shows
why the alternative fails.

## 1. Why declaration-alone is not a security control here

A declared host field is an **assertion by the configuration author**; a probe is a **measurement of the
host that runs the code**. Controls must be falsifiable by a check that can fail (my standing rule: no
control without a probe that could go red). A declaration satisfies any rule written against prose, so a
rule satisfiable by prose cannot distinguish a correct host from a false one — the GREEN case and the
attack/broken case are indistinguishable. That is not hypothetical in this rig:

- `tools/channel-preflight.mjs` **scraped the pinned default instead of reading the shell registry** and
  printed the verdict "NO SHELL CAN START HERE" (`:468`) on a host where the seat guard's own refusal text
  says the registered seat shell is `bash`. Root cause and reproduction are routed to devtools as **#5163**
  (claimed). Measured on the landed substrate paper
  `docs/reviews/security-seat-sandbox-position.md` (main head `7e5afe39`, 415 lines): `channel-preflight` 7 mentions, each refuting; `shellregistry` 7;
  `broker-serve` **0**; `NO SHELL` 2 lines, both refutation framing (line 20, line 295 quoting `:468`).
  Record: `docs/reviews/security-5269-landing-correction.md` (branch `item-5269` @ e160ba32).

So an instrument that re-derives host facts instead of reading the registry has already produced one false
security verdict in this session. `seat-host-unaware` must not be given the same shape.

## 2. Conditions on the fix (these are the security content; the rest is the architect's)

C-1 **ONE SOURCE OF TRUTH, IMPORTED.** The re-scoped rule in `tools/rig-portability-audit.mjs` (the finding
is emitted at `:172`) must import the same selectors the enforcement uses — `selectSeatShell()` /
`seatShellSelection` / `shellToolNames()` (`src/seattools.mjs:17`, consumed by `src/seatguard.mjs:22` and
`src/seattools.mjs:223`) — and must not re-derive a shell name from rig prose or from a pinned default.
Why this is security, not tidiness: if the audit and the guard read different sources, the audit can go
green while the guard still refuses, and a green audit then certifies a boundary the guard disagrees with.
Precedent that this rig already enforces derivation-over-restatement: `demo/instruction-files.test.mjs:186`
pins shell-tool-name prose as sourced from `shellToolNames()` "so prose cannot disagree with the host".

C-2 **A DECLARATION MAY SELECT, IT MAY NEVER AUTHORIZE.** The host field is admissible as *input to the
probe*, never as the clearing condition and never as an input that softens a refusal. Enforcement must fail
closed when selection is `degraded`: a degraded selection is not a host fact, and treating it as one is how
a missing shell becomes a silent fallback. (Reuse the existing `degraded` vocabulary that
`tools/shell-availability.mjs` reads; do not mint a second one.)

C-3 **THE DENOMINATOR IS PART OF THE CONTROL.** A probe-based green over an empty denominator is a false
clear. `rig-portability-audit` printed `seat roots read: 0` while the store carried 13 resolving cwds
(#4923). So the re-scoped rule must report the per-root denominator it actually read, and a green with
denominator 0 must itself be a finding. Any ruling that cites a count must name a verified reader.

C-4 **KEEP IT NAMED UNTIL THE PROBE LANDS.** Per the architect's anti-vacuity guard and `lead`'s D-entry,
the 2→1 audit result must keep `seat-host-unaware` explicitly outstanding. A clean audit before C-1 lands
would be the suspicious result, not the good one.

## 3. Falsifiable acceptance (the probe that makes this re-runnable)

Adopt the architect's pair and add the denominator row. All three must be asserted separately:

1. GREEN: registry resolves `bash`, seat-facing surface says `bash`, `degraded: false`, denominator > 0 → no finding.
2. RED (decisive): rig **declares** a shell the host lacks (inject `shellPlan({lookup: …})` so the program is
   absent) → the finding **fires despite the declaration**.
3. RED: `degraded: true` → the finding fires even with a name present; and denominator 0 → green is refused.

## 4. Scope honesty

- I ran no suite here. This worktree's `vendor/pi-main` is not built (`sync-pi --link` failed), so any suite
  verdict from it is NOT comparable with the seat root's; this note is docs-only and its facts are greps and
  counts, each named with its tree (`main 7e5afe39`).
- The store-schema half (per-seat host OS / per-seat shell) stays with **#4879** / the D24–#3506 family;
  this note decides only the audit rule. I am not adjudicating which seat builds it — routing to lead/pm.
- The `channel-preflight` re-derivation defect is devtools' (#5163), not taken here.
