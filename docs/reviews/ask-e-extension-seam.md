> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# ASK E — the extension/plugin seam (design capture, closed #505)

_Status: capture of lead's ASK E report (closed #505); durable for the #538 implementer. Not a
numbered decision yet — the seam is to be DEFINED ON #538 (work-item view, smallest blast radius)._

> **Forward-pointer (#782 ruling):** when the seam is defined on **#538**, its own DECISIONS.md entry
> MUST explicitly cite this note and ENFORCE the binding migration constraints (i)–(iv) — the note is
> the analytical source that precedes and grounds that numbered decision.

This note records lead's design report for the extension/plugin seam: what can be extracted today,
what must NOT be, how the seam reconciles with pi-durable, and the migration constraints that BIND
whenever #538 defines the seam. Every file cited here is verified present in the tree.

## 1. Extraction candidates (6)

These modules are self-contained enough to be extractable behind the seam:

- `src/worktree.mjs`
- `src/tui/client.mjs`, `src/tui/driver.mjs`
- the view kit: `src/chatview.mjs`, `src/watchview.mjs`, `src/viewmodel.mjs`
- `src/checkup.mjs`
- `src/extensions.mjs` — **the seam's existing hook** (it already loads pi-durable extensions)
- `scripts/from-openrig.mjs`

Plus a deletion candidate: `src/job-object.mjs` is orphaned — separately routed to `impl`.

## 2. NOT candidates (A1 reasons)

These must NOT be extracted, for the recorded reasons:

- `rig.mjs` — the store seam.
- `broker` / `driver` / `scheduler` / `genlock` — the single-writer wake family.
- `confine.mjs` + `seatguard.mjs` — the OS trust boundary.
- `cli.mjs` — the one-shot JSON contract (D21).

## 3. Seam / contract (reconciled with pi-durable)

- **ADOPT pi-durable's discovery:** an explicit opt-in list, no auto-discovery, fail loudly on load,
  duplicate-name checks. (`src/extensions.mjs` already implements this shape.)
- **ADOPT pi-durable's lifecycle:** a plain `defineExtension` module, installed into the registry by
  name, same-name replace.
- **BUILD the delta** (pi-durable does not provide these):
  - (a) **contract versioning** — pi-durable is name-only, no version field;
  - (b) **capability restriction / mediation** — pi-durable grants in-process harness access plus
    tools that inherit the OS permissions of the process, which is MORE permissive than the seam
    durig allows; the seam must mediate this down.

## 4. Migration requirements (BINDING — preserve A1 one-store/one-broker)

These constraints bind regardless of what is adopted, and pi-durable's capability model violates
them, so the seam must enforce them structurally:

- (i) **no plugin writes the store directly** — access goes THROUGH the broker (F24: a second opener
  races on entry-id allocation);
- (ii) **no plugin gets a second writer path**;
- (iii) **no plugin gets git state-mutation authority** (#146);
- (iv) **extraction must not split the single writer.**

## 5. Build-vs-adopt call

- **ADOPT** pi-durable's loader shape + the existing `src/extensions.mjs` glue.
- **BUILD** contract versioning + capability mediation.
- **DO NOT adopt** pi-durable's capability model.
- Define the seam **ON #538** (work-item view) — smallest blast radius, a real case.
