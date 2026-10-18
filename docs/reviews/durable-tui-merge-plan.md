# Durable-TUI merge plan — landing the spike into durig

**Status:** delegate proposal of record, delivered to `pm` for registration. **Not a queue item yet.**
**Source spike:** `.spike/durable-tui/` (gitignored; `HANDOFF.md` is the merge-oriented summary).
**Author:** delegate (operator-directed), 2026-10-18.
**Companion:** `docs/reviews/durable-tui-gap-analysis.md` — the functionality the new TUI still needs.

This plan exists so the team can register, decompose, implement and verify the merge without
re-deriving it. The delegate does not claim or route queue items; the phases below are proposals.

---

## 0. TL;DR

The spike proves a clean seam: **pi-durable owns the conversation, generation, tools and compaction;
pi-coding-agent's real `InteractiveMode` TUI is an unmodified client of it** (HANDOFF §0). The merge is
worth doing, but it must be **staged and kept parallel** to the existing `durig ui`:

1. Land the spike as a **second, self-contained entrypoint on its own store** — this alone delivers
   "both working while migrating" at near-zero risk.
2. Only then solve the hard problem — attaching the interactive TUI to a **broker-owned** seat — which
   is gated on ROADMAP 52 and 55.
3. Converge (`ui.mjs` becomes a mode, or stays) last.

The whole plan is shaped by one rule: **the store has one writer** (D42 / dogfood F24). The broker is
that writer while it runs; the spike is a writer, not a viewer.

---

## 1. The constraint that shapes everything

- `durig ui` (`ui.mjs`) is a **read-only viewer**: it opens storage with no harness (D11), polls
  ≤700 ms, and its only write is an intent spooled through `writeIntent` (D68). Source: `docs/DECISIONS.md`
  D11/D24/D40/D68 and the header comment of `ui.mjs`.
- The spike (`tui.mjs` + `src/adapter.mjs`) **owns** the store: it opens `openNodeSqliteStorage`, builds
  a pi-durable `Harness`, installs coding tools + codemode into the registry, and runs generation,
  compaction and persistence in one process (HANDOFF §3).
- Therefore the spike **cannot point at `selfdev.sqlite` while the broker drives** — that is exactly the
  second-writer collision (D42, F24). Every phase below answers one question: *who owns the
  store/harness for the durable-TUI conversation?*

Two supporting facts:

- `durig ui` is already a **separate entrypoint** (`package.json` `"ui": "node ui.mjs"`), not a
  `cli.mjs` verb. `cli.mjs` stays non-interactive (D21). Parallel entrypoints are the native shape.
- The spike resolves **pi-coding-agent from the operator's managed install**
  (`~/.pi/agent/install/current-version`, `src/imports.mjs`) and pi-durable/pi-ai from the repo's
  `node_modules`. pi-coding-agent is **not a durig dependency today** — `package.json` lists only
  `@earendil-works/pi-tui`. Pinning it is the main mechanical prerequisite (§5).

---

## 2. Scope decision (operator ruling, Phase 0)

HANDOFF §8.1 offers two products:

- **(a) A per-seat "open a durable conversation in the real Pi TUI" view** — the spike, wired to a
  `RigQueue` seat's conversation. Little new design; mostly integration.
- **(b) Use the adapter as the rendering core of a richer multi-seat operator TUI** — replace/augment
  `ui.mjs`; adds seat switching, the queue view, and the attach/security question.

**RULED (operator, 2026-10-18): option (b).** The durable TUI is the intended replacement for
`durig ui` as durian-pi's multi-seat surface. The delegate recommended (a) first (lower risk, defers the
attach protocol); the operator chose the destination directly. Consequences: the merge must add the
multi-conversation / attach work that (a) deferred (ROADMAP 52 + 55), and `ui.mjs` becomes the fallback
rather than a co-existing surface.

**ADDED REQUIREMENT (operator, 2026-10-18): a team-status viewport.** The surface must show the state of
the whole team (queue depth, per-seat state, attention), not only one conversation. The best UX for this
is an OPEN DESIGN QUESTION — the operator directed a consultation with `designer` and `advocate`
(intent `92682546-ad8e-4406-9efb-c7b1208e38c3`). Phase 2 must not hard-code a layout before that
proposal exists.

---

## 3. Phases

Each phase names the deliverable, the owner, and the gate. "Owner" is the seat the proposal suggests
`pm` route to; `pm` decomposes and registers. The delegate verifies the gate and reports.

### Phase 1 — land the spike as a non-default, separate-store entrypoint

**Goal:** the spike is in the tracked tree, runs as `npm run tui`, and the existing `npm run ui` is
untouched. Both run at once with no shared writer.

**Deliverable / mechanical checklist** (from HANDOFF §8.2):

- Copy `.spike/durable-tui/src/*.mjs` → `src/tui/durable/` (keep the adapter/bridge/translate split:
  `adapter.mjs`, `bridge.mjs`, `translate.mjs`, `real-host.mjs`, `boot.mjs`, `terminal.mjs`,
  `imports.mjs`).
- Copy `.spike/durable-tui/tui.mjs` → a new root entrypoint (proposed `tui.mjs`) with a fail-closed
  ownership guard (§4).
- Move `.spike/durable-tui/test/*.test.mjs` → `demo/tui-durable-*.test.mjs` and wire them into
  `demo/tui-suite.mjs` (`npm run test:tui`).
- Add `"tui": "node tui.mjs"` to `package.json`; leave `"ui": "node ui.mjs"` unchanged.
- Do **not** edit `ui.mjs`, `src/tui/client.mjs`, or the broker write paths.
- Make the store path explicit (`DURIG_TUI_DB`) and default it **away from** `selfdev.sqlite`.
- `session.sqlite` stays gitignored (`*.sqlite` already covers it) and is **never deleted** (HANDOFF §10).

**Owner:** `impl` (with the delegate's checklist). **Consulted:** `devtools` for the dependency pin
(§5). **Verifier:** `qa`.

**Gate:**
- Ported tests green; `npm run test:tui` green; full `demo/*.test.mjs` unchanged.
- `node --check` clean on every copied/ported file.
- `node tui.mjs` boots in a real terminal; `npm run ui` still boots and polls.
- A failing-first test proves the ownership guard refuses when a broker owns the target store.

### Phase 2 — attach the durable TUI to a real seat

**Goal:** the TUI shows and drives a real seat's durable conversation.

**Sub-steps, in order:**

- **2.1 — read seam.** Replace the poll/`viewState()` read with the **in-process
  `viewState().subscribe()`** (ROADMAP 52); no socket, no new trust boundary. `watchEvents()`/remote
  only after ROADMAP 55's security position.
- **2.2 — write seam.** Interactive generation is a write. Two acceptable steps:
  - **(2a) operator window:** `tui.mjs` owns one seat's conversation store only while the broker is
    **paused** (`pause`/`unpause`, ROADMAP 131 / `#1841`). Low risk, limited reach.
  - **(2b) broker-owned interactive client:** extend the command spool (`SPOOL_OPS` in
    `src/broker.mjs`) with the prompt/abort ops so the broker applies them with its own harness while
    the TUI subscribes (ROADMAP 52 + 56). This is the first-class seat view and is gated on ROADMAP 55.

**Owner:** `impl`; **ruling:** `lead` (D11 attach seam) and `security` (ROADMAP 55, before any socket).
**Verifier:** `qa`, with an `auditor` second pass on the attach boundary.

**Gate:** a late-join test — attach mid-run, the snapshot shows the running tool's partial, later deltas
arrive, and **no partial becomes an entry** (D40) — plus the security position written before any
remote path (ROADMAP 55).

### Phase 3 — converge

Only after Phase 2 verifies, decide whether `durig ui` becomes a mode of the new TUI or stays a
separate entrypoint. Then (and only then) refactor shared surfaces (sanitise, restore, `readapi`).
**Keep the poller as the documented fallback** (D11's evidence is not erased).

---

## 4. The ownership guard (Phase 1 safety)

Phase 1's "both working" depends on the new entrypoint never opening a store a broker owns. The guard:

- Refuse to open when `<db>.broker.json` exists or `<db>.genlock.*` is held, unless an explicit
  `--own` (or `DURIG_TUI_OWN=1`) is passed and the operator has declared the window.
- Fail closed with a message naming the store and the owning process — the same discipline as
  `land.mjs`'s store resolution (`#1383`).
- The point is to make the accidental second writer impossible, not merely discouraged.

---

## 5. Dependency pin (prerequisite, `devtools`)

The spike's managed-install resolution is fine for a spike and wrong for product code (mutable, machine-
local). The merge must:

- Add `@earendil-works/pi-coding-agent` to the pi pin (`pi-main.pin.json` `packages[]`) if it ships from
  the pinned pi monorepo, **or** pin its version explicitly in `package.json` and
  `scripts/sync-pi.mjs` if it is release-only.
- Reconcile the coding-agent version with the pi-durable pin: the spike used coding-agent **1.3.0** with
  the repo pin `8efd314f` (HANDOFF §11).
- Keep the same provenance policy as pi-durable (pinned, reproducible, no copying vendor internals —
  the operator **declined** that speed lever).

**Gate:** a clean checkout + documented install reproduces `npm run tui`; `node scripts/sync-pi.mjs`
reports no unexpected drift.

---

## 6. Risks and escalations

- **Scope.** (a) vs (b) is an operator/lead ruling and must precede code (Phase 0).
- **Writer ownership.** The single biggest hazard. Phase 1 avoids it entirely; Phase 2 must not land
  before ROADMAP 55 for any socket path.
- **Ported-test weight.** The spike's 7 test files depend on the managed install; porting them without
  the pin (§5) will be flaky. Sequence §5 before Phase 1's test port, or keep the spike tests
  skip-when-unavailable during Phase 1.
- **Known feature gaps** — carried into `docs/reviews/durable-tui-gap-analysis.md` and not re-litigated
  here (HANDOFF §8.4/§9): `pi.system`/`pi.reset` do not render on resume; `tokensBefore` is an estimate
  lost on reopen; `abortCompaction` aborts all live tasks; `newSession`/`fork`/`import` throw; no PTY
  tier for raw-mode keys.

## 7. References

- `.spike/durable-tui/HANDOFF.md` §0/§3/§8 (seams, architecture, merge checklist, upstream asks).
- `docs/reviews/durable-tui-gap-analysis.md` (this session).
- `docs/ROADMAP.md` items 51–58; `docs/DECISIONS.md` D11/D21/D24/D40/D45/D57/D61/D68/D69/D70.
- `docs/PI-DURABLE-INTEGRATION.md`; `docs/TUI-IMPLEMENTATION-PLAN.md`; `docs/TUI-TESTING.md`.
