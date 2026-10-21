> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

---
incident: ui-view-undefined
date: 2026-10-17
severity: sev2
status: open
symptom: "durig ui paints (poll failed: ...) and nothing else"
runbook: null
fix: null
prevention: "#1607 (fix + demo/ui-readstate.test.mjs negative control)"
last_reviewed: 2026-10-17
---

# `durig ui` is dead — every poll throws `view is not defined`

*Incident 2026-10-17; reported by the operator; analysis by the delegate.*

## Summary
The interactive TUI (`node ui.mjs`) painted only `(poll failed: view is not defined)` — no seat list,
no transcript. `makeReadState` read `view`, but `view` was declared inside the main `try` block, out of
reach of the module-level function, so every ~700 ms tick threw a `ReferenceError`. Fix routed as
`#1607`; not yet landed.

## Timeline
- `02f0004` (`#1109`, `i` input overlay) adds `view.*` reads inside `makeReadState` and declares
  `view` in the `try` block — the regression is introduced.
- qa `#1184`/`#1188` verify `#1109`; `demo/ui-driver.test.mjs` injects its own `readState`, so the real
  `makeReadState` is never exercised.
- `2026-10-17` operator reports the TUI is unusable.
- Delegate extracts the real function text and reproduces at runtime; routed to `pm` → `#1607`/`#1608`.

## Impact
The operator's primary interactive surface was completely non-functional; no data risk (TUI is
read-only).

## Root cause
`ui.mjs` `makeReadState` is a module-level function; its poll closure reads `view`, but `const view` is
declared inside the entrypoint's `try` block (a narrower scope). The closure cannot resolve `view`, so
each poll throws. `src/tui/driver.mjs:83` catches it and paints the error frame.

## Detection
Operator report. No test covered the entrypoint's real `makeReadState` because `ui.mjs` is a
top-level entrypoint (not importable) and the driver demo injects a stub.

## Resolution
Open. Fix routed: pass `view` into `makeReadState` (signature + one call site), and extract it to a
module so a headless regression test can call the real closure.

## Prevention
`#1607` — the fix plus `demo/ui-readstate.test.mjs`, which asserts the real closure resolves and carries
a negative control that is red on the unfixed module. `#1608` — independent qa verification on a
different model family.

## Evidence
- `ui.mjs`: `makeReadState` at line 66; `view` reads at lines 93, 110, 135, 138; `const view = createViewMode()` at line 206.
- `git blame ui.mjs` — lines 93/110/135/138 and 206 both from `02f0004`.
- Runtime check (real extracted function text, `view` not in scope): `ReferenceError: view is not
  defined`; with `view` passed as a parameter: resolves, returns `view: "seats"`.
- `demo/ui-driver.test.mjs` injects `readState` (lines 53/82/110/141/159/185) — no coverage of the real one.
- Queue: `#1607` (impl fix), `#1608` (qa verify).

## Links
`src/tui/driver.mjs` · `ui.mjs` · queue `#1109`, `#1607`, `#1608`
