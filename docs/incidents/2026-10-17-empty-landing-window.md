> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

---
incident: empty-landing-window
date: 2026-10-17
severity: sev2
status: resolved
symptom: "the exclusive landing window closes with no branches landed"
runbook: land
fix: "#1399 (land.md outside-broker precondition + Do step 0)"
prevention: "ROADMAP 131 pause/unpause (#1388)"
last_reviewed: 2026-10-17
---

# The exclusive landing window closes quiet but empty

*Incident 2026-10-17; detected by impl; analysis recorded in `land.md`.*

## Summary
An operator-declared exclusive landing window closed with **nothing landed**. The pass was assigned to
a **broker-hosted seat**, but quiescing requires stopping the broker — and stopping the broker ends the
run of the very seat hosting the pass, so it can neither stop the broker nor land and report. The
window was structurally unwinnable for a broker-hosted driver.

## Timeline
- Operator declares the exclusive window open.
- The pass is routed to a seat hosted by the running broker.
- Quiescence requires stopping the broker; stopping it kills the pass's own run.
- Window closes "QUIET BUT EMPTY" (no branches landed).

## Impact
The landing pass made no progress; the branches stayed unlanded (invisible value; a stale `main` for
other seats). No data risk.

## Root cause
A landing pass cannot be driven by a broker-hosted seat: the quiesce step and the hosting are the same
process. The procedure named the stop but not "from where".

## Detection
Human observation (the window closed without landings).

## Resolution
`#1399` — `docs/runbooks/land.md` now states the outside-broker precondition and the "Do step 0"
(quiesce, then drive with a plain `run`/`send`, or a DETACHED `scripts/land.mjs`), plus the F11-drain
hand-verify and the `--db` truth fix.

## Prevention
ROADMAP 131 (`pause`/`unpause`, `#1388`): pause the broker without killing it, let seats settle, land
with the broker parked but not driving — no stop needed.

## Evidence
- `docs/runbooks/land.md` Preconditions: *"A landing pass CANNOT be driven by a broker-hosted seat …
  the pass must run OUTSIDE the broker"*; Do step 0; the empty-window note (line ~32).
- `#1399` — the procedure fix; `#1388` / ROADMAP 131 — the durable fix.
- Same class re-observed 2026-10-17 this session: a `send impl` drive self-blocked on its own
  `genlock`, so `scripts/land.mjs` refused (`a generation is in flight`).

## Links
`docs/runbooks/land.md` · `docs/runbooks/merge.md` · queue `#1390`, `#1399`, `#1388`
