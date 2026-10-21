# Durable-TUI Phase 1 — build spec (delegate, 2026-10-18)

**Status:** delegate analysis. Companion to `docs/reviews/durable-tui-merge-plan.md` (§3 Phase 1,
§5 pin) and `docs/reviews/durable-tui-gap-analysis.md` (P1 list). **Not a queue item** — the phases
are already registered (#2094–#2098).

**Why this exists.** Phase 0 is ruled (D102/#2105) and the phases are registered, but two gates in
the merge plan were left as open questions (`#2095` "read §5 before choosing the version"; `#2096`
"add a fail-closed ownership guard") and the plan **predates the D103 rebrand**. This spec resolves
those from the tree so `devtools` (#2095) and `impl` (#2096) can start without re-deriving them, and
so Phase 1 does not ship a stale `DURIG_*` name or repeat the `#1383` wrong-store bug.

**Method.** Read from the tree, not memory: `pi-main.pin.json`, `package.json`, `npm view`
(`1.3.0`), `src/broker.mjs` (`readBrokerState`, `brokerAlive`, `brokerStatePath`), `scripts/land.mjs`
(the `heldGenlocks` / `resolveStore` pre-flight), `src/providers/local.mjs`, `docs/DECISIONS.md`
D101–D104, `.spike/durable-tui/HANDOFF.md` §8/§11.

---

## 1. Dependency pin (#2095) — resolved by inspection

`@earendil-works/pi-coding-agent` is **not** part of the pinned pi monorepo: `pi-main.pin.json`
`packages[]` lists only `pi-telemetry`, `chord`, `pi-codemode`, `pi-ai`, `durable`. It is a separate
**published** package — `npm view @earendil-works/pi-coding-agent version` → `1.3.0`, which is the
exact version the spike ran from the managed install (HANDOFF §11).

**Decision (for `devtools` to implement, not a delegate ruling):**

- Pin it explicitly in `package.json` as `"@earendil-works/pi-coding-agent": "1.3.0"` — an **exact**
  version, no caret — and commit the lockfile change.
- Do **not** add it to `pi-main.pin.json` `packages[]`: that array maps to monorepo `dir`s built by
  `scripts/sync-pi.mjs`, and this package ships release-only. If upstream later publishes it from the
  monorepo, revisit and move it into the pin.
- Reconcile against the pi-durable pin (`8efd314f`): the spike paired coding-agent 1.3.0 with that
  pin and passed 21/21. A future `sync-pi.mjs --update` must re-check the coding-agent compatibility
  before the pin moves — record the pairing in the pin's provenance, not just the version.
- Remove the managed-install resolution from shipped code: `src/imports.mjs` and the
  `DURABLE_TUI_AGENT_PACKAGE` override resolve `~/.pi/agent/install/current-version`, which is
  mutable and machine-local (fine for the spike, wrong for product).

**Acceptance:** a clean checkout plus the documented install reproduces `npm run tui`;
`node scripts/sync-pi.mjs` reports no unexpected drift; no production file resolves the managed
install.

## 2. Ownership guard (#2096) — exact primitives to reuse

Merge-plan §4 requires the new entrypoint to fail closed when a broker owns the target store, "the
same discipline as `land.mjs`'s store resolution (#1383)". The primitives already exist:

- **Broker liveness:** `readBrokerState(dbPath)` + `brokerAlive(state)` are exported from
  `src/broker.mjs`. `brokerAlive` is hardened against a recycled pid by the heartbeat window
  (`BROKER_HEARTBEAT_MS` 20 s / `BROKER_HEARTBEAT_TIMEOUT_MS` 60 s), so a fresh `broker.json` alone
  is **not** the signal — the heartbeat age is.
- **Live generation holders:** `scripts/land.mjs`'s `heldGenlocks(dbPath)` scans `<db>.genlock.<i>`
  and keeps only slots whose holder pid is alive (signal 0; only `ESRCH` means gone, `EPERM` means
  alive-but-unsignalable). This is duplicated locally in `land.mjs` on purpose (it must load without
  the provider stack).

**Recommended shape (for `impl` to implement):**

1. Refuse to open when `brokerAlive(readBrokerState(db))` is true **or** any `<db>.genlock.<i>` has a
   live holder — unless `--own` / `DURIAN_PI_TUI_OWN=1` is passed **and** the operator declared the
   window.
2. Fail closed with a message naming the store path and the holding pid — never open "to check".
3. **Resolve the store explicitly**, mirroring `land.mjs`'s `resolveStore`: an explicit
   `--db`/`DURIAN_PI_TUI_DB` wins; otherwise do **not** silently fall back to a shared store. Phase 1
   defaults the TUI's own store **away from** the rig store, never `selfdev.sqlite`.
4. Prefer extracting the "is this store owned?" check into one dependency-free helper (e.g.
   `src/storeownership.mjs`) shared by `land.mjs` and the TUI, so the rule cannot drift between two
   copies. Keep it free of pi-ai imports — that is why `land.mjs` inlined it.

**Failing-first proof (merge-plan §3 gate):** the test writes a `<db>.broker.json` with a fresh
heartbeat and a live pid, and asserts the guard refuses; with the guard removed the test passes
against the open (RED), then refuses (GREEN).

> D101 note: `durig ui` is a *reader* and does not open a harness, so it needs no such guard. The
> guard exists because the spike is a **writer** — the exact `D42` / `F24` second-writer collision.

## 3. Rebrand reconciliation (D103) — the merge plan predates the rename

The merge plan and HANDOFF use the spike's original names. Under **D103** the merged code must use
the new names with deprecated aliases:

| Plane | Merge plan / spike name | Ship as (D103) | Alias |
|---|---|---|---|
| npm script | `npm run tui` | `npm run tui` (identifier, unchanged) | — |
| store env | `DURABLE_TUI_DB` | `DURIAN_PI_TUI_DB` | `DURIG_TUI_DB` during deprecation |
| ownership env | `DURIG_TUI_OWN` | `DURIAN_PI_TUI_OWN` | `DURIG_TUI_OWN` |
| agent package | `DURABLE_TUI_AGENT_PACKAGE` | **removed** — replaced by the pin (§1) | — |

The alias wiring is the loader's job (D103 owns `DURIG_*` → `DURIAN_PI_*`). The TUI must not add a
second, ad-hoc alias mechanism. **Acceptance** is D103's: `git grep -i durig` returns only deliberate
alias/deprecation sites.

## 4. `cwd` / worktree reconciliation (gap P1 #5) — scoped to Phase 2

The spike builds `NodeExecutionEnv` from the conversation's `cwd` (`HANDOFF` §4.8); durig resolves a
seat's root from its item worktree via `prepare_workspace` and persists it in the seat record with an
F12 fail-closed guard. `src/boot.mjs`'s temp dirs are a spike artifact and must not ship.

**Phase 1 boundary (state it, do not half-wire it):** Phase 1 is a non-default entrypoint on its own
store and **does not resolve a seat at all** — it reads its own store path and nothing else. The
durig-worktree reconciliation is inherent to the attach seam and lands in **Phase 2** (#2097), where
the TUI first addresses a real seat. Shipping a partial resolver in Phase 1 would create a second,
divergent source of truth for a seat's root.

## 5. Test port (#2096)

- Move `.spike/durable-tui/test/*.test.mjs` → `demo/tui-durable-*.test.mjs` (durig's `demo/`
  convention) and wire them into `demo/tui-suite.mjs` (`npm run test:tui`).
- The seven tests boot the **real** `InteractiveMode` from the coding-agent package. Sequence §1
  (the pin) before the port; if the pin cannot land first, the ported tests must **skip when the
  package is unavailable** rather than fail — a skip that names the missing package, never a silent
  pass (merge-plan §6).
- Add the §2 failing-first ownership-guard test; it needs only the store/pid primitives, not a
  provider, so it belongs in `npm run test:tui` from the start.

## 6. Acceptance the delegate will check (merge-plan §3 gate)

1. `npm run test:tui` green; full `demo/*.test.mjs` loop green; `node --check` clean on every
   copied/ported file.
2. `node tui.mjs` boots in a real terminal against its own store; `npm run ui` still boots and polls
   (both work at once).
3. The ownership guard refuses a store with a live broker **and** a store with a live genlock holder,
   demonstrated failing-first.
4. `npm run tui` resolves the pinned coding-agent, not the managed install.
5. `git grep -i durig` returns only the D103 alias sites.

## 7. Dependency unlocked by this session's state

Phase 2's low-risk write seam **(2a) "a broker-paused operator window"** is now viable: `pause`/
`unpause` **landed** (`impl-item-1841`, ROADMAP 131). Record it when Phase 2 is planned — Phase 1
needs nothing from it.

## 8. References

- `docs/reviews/durable-tui-merge-plan.md` §3–§6; `docs/reviews/durable-tui-gap-analysis.md` P1.
- `.spike/durable-tui/HANDOFF.md` §4/§8/§11.
- `pi-main.pin.json`; `package.json`; `scripts/sync-pi.mjs`; `src/broker.mjs`; `scripts/land.mjs`;
  `src/providers/local.mjs`.
- `docs/DECISIONS.md` D101 (parallel entrypoint), D102 (scope b), D103 (rebrand), D104 (local
  provider).
