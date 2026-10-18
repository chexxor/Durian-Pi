# Durable-TUI gap analysis — spike vs durig's current app and requirements

**Status:** delegate analysis, 2026-10-18. Companion to `docs/reviews/durable-tui-merge-plan.md`.
**Question:** the spike runs the real pi TUI on a pi-durable conversation. What does durig's current
app/feature set and its registered requirements have that the new TUI must add before it can replace
or join `durig ui`?

**Method.** Both sides are read from the tree, not from memory:

- **Spike capabilities** — `.spike/durable-tui/HANDOFF.md` §2 (proven), §5 (inventory), §8.4 (gaps),
  §9 (limitations); `.spike/durable-tui/README.md`.
- **Current app** — `ui.mjs`, `src/tui/*` (`client.mjs`, `driver.mjs`, `viewmode.mjs`, `input.mjs`,
  `restore.mjs`, `paint.mjs`, `sync.mjs`, `ctxline.mjs`, `conversation.mjs`), `src/readapi.mjs`,
  `src/viewmodel.mjs`; `docs/FEATURES.md` rows tagged `tui`; the 15 current TUI demos in `demo/`.
- **Requirements** — `docs/ROADMAP.md` items 51–58 and 89/98/99/101/124; `docs/DECISIONS.md`
  D11/D21/D24/D40/D45/D57/D61/D68/D69/D70; `docs/TUI-IMPLEMENTATION-PLAN.md` §C/§D.

Legend: **P1** must-have for the new TUI to be usable as a durig surface; **P2** needed before it
replaces `ui.mjs`; **P3** parity/polish; **DECIDE** an operator/lead call.

---

## 1. Capability matrix

| # | Capability | Current `durig ui` | Spike TUI | Gap / action |
|---|---|---|---|---|
| 1 | **Multiple seats at once** | Seat list, selection, streaming seats | Single durable conversation | **P1** add a seat/conversation switcher over `readapi`/`viewState` |
| 2 | **Seat actions** (open, focus, follow live tail) | Yes (`Enter`, `G`/`End`, auto-follow) | One conversation | **P1** port selection + follow semantics |
| 3 | **Queue / work-item view** | Queue exists in `readapi`; ROADMAP 124 (selected seat's active item) not delivered | None | **P2** show queue + the selected seat's item (ROADMAP 124) |
| 4 | **Read-only fallback** | Whole TUI is read-only (D11) | TUI is fully interactive; no viewer mode | **P1** a viewer/attach mode that never opens a harness |
| 5 | **Interactive generation** (prompt, stream, abort) | Not supported (viewer; D21) | Yes — durable `pi.generation` | **P1** the new capability; wire through attach (ROADMAP 52/56) |
| 6 | **Write substrate while broker drives** | `writeIntent` → intent inbox (D68) | Owns the store (writes directly) | **P1** route prompts/abort through the spool or broker-owned attach; never a second writer (D42/F24) |
| 7 | **Coding tools + code mode** | N/A (viewer) | `read`/`write`/`edit`/`bash`/`powershell` + `codemode` in the durable registry | **P1** keep; add durig's router tools (§2) |
| 8 | **Durig router tools** (`send_work`, `claim_work`, `complete_work`, `defer_work`, …) | N/A | **Not installed** (spike registry is coding-only) | **P1** install the router extension into the merged registry (HANDOFF §8.1.4) |
| 9 | **Streaming partial is not a turn** | Yes — `pi.live` partial rendered in the streaming row, never persisted (D40) | Durable `pi.live` partial | **P1** verify parity in the new renderer; keep the D40 invariant |
| 10 | **Tool-call rows, thinking parity, roles** | In-place tool blocks, thinking, role styling | Real Pi TUI renders its own | **P2** confirm the Pi renderer meets durig's role/thinking expectations or extend it |
| 11 | **Context consumption line** (`ctx`, ROADMAP 98) | Five-state header (`src/tui/ctxline.mjs`) | Pi TUI shows its own context usage | **P2** decide whether durig's ctx line is ported or superseded |
| 12 | **Per-conversation agent config** (model/thinking/extensions/`cwd`) | A subset via rig config | Host `AgentSession` shell; config not written on the conversation | **P2** ROADMAP 57: write agent config on the conversation so it survives restart |
| 13 | **Model / thinking switching** | Read-only display; config-driven | Host catalog wired (`ModelRuntime`); adapter sets a synthesized model view | **P2** register the durable model properly (HANDOFF §8.4) and expose switching |
| 14 | **`/compact`** | Viewer can request via intent; no in-app compaction | Working; running indicator + durable boundary (faux-verified) | **P2** verify against the real provider in a declared window; keep the boundary rendering |
| 15 | **Persistence / resume** | Polls the store; no local state | `session.sqlite`, resumes on reopen (verified) | **P1** decide the store's home and ownership (merge plan §4) |
| 16 | **Sanitise untrusted text** | H1 sanitise at every render boundary (`src/sanitize.mjs`) | Passes durable text into Pi's real TUI — **not verified to sanitise** | **P1** SECURITY: verify/extend sanitisation before any untrusted transcript reaches the terminal |
| 17 | **Secret redaction/detection** | `src/secretdetect.mjs` / `src/secretredact.mjs`; store + viewer classes | None | **P1** SECURITY: hook the same detector/redactor into the new TUI's read + write paths |
| 18 | **Terminal lifecycle** (alt-screen, restore, paste) | H2 restore on every path, H5 bracketed paste (`src/tui/restore.mjs`, `input.mjs`) | Pi TUI owns its own terminal handling | **P2** verify Pi's restore/paste meets H1/H2/H5; add durig's restore-on-every-path if not |
| 19 | **Cell-width correctness** | H4 `src/textwidth.mjs` for wrap/truncate | Pi TUI has its own width logic | **P3** parity check; no port unless a real defect appears |
| 20 | **Synchronized output** (DECSET 2026) | H3 `src/tui/sync.mjs`/`paint.mjs` | Pi TUI's own paint path | **P3** parity check |
| 21 | **Resize / tiny pane** | H6 not landed | Pi TUI handles resize | **P3** verify; keep as a new-TUI requirement |
| 22 | **Anchored scroll + "N new"** | H8 not landed | Pi TUI scrolling semantics | **P3** decide if durig's anchor affordance is still wanted |
| 23 | **`pi.system` / `pi.reset` render on resume** | Reset turns exist in the durable transcript | **Not rendered** (HANDOFF §8.4) | **P2** map them so a resumed reset conversation is honest |
| 24 | **`tokensBefore` on compaction** | Derived from measures | Estimate at start; lost on reopen (HANDOFF §8.4) | **P3** track the pi-durable upstream ask; show an estimate meanwhile |
| 25 | **`abortCompaction` scope** | N/A | Aborts all live tasks (no compaction-only abort) | **P3** document or add a narrow abort |
| 26 | **`newSession` / `fork` / `import`** | Not offered (single rig) | Throw `DurableAdapterError` (out of scope) | **DECIDE** whether the merged TUI needs session lifecycle |
| 27 | **Labels / session-info / custom entries** | N/A | Host `SessionManager` writes are **not durable** (HANDOFF §9) | **P3** decide owner; keep out of the durable contract if not needed |
| 28 | **Usage / cost surface** | `metrics`, `ctx` | Durable `pi.usage` mapped | **P3** expose usage in the new TUI |
| 29 | **Degeneration / halt guard** | Reset guard, `stop` files (`src/halt.mjs`, `src/reset.mjs`) | Harness has `abortTask`/`abortSignal`; not wired | **P2** ROADMAP 58: map the guard onto harness primitives; the TUI must show/handle a halt |
| 30 | **Worktree / `cwd` per conversation** | `prepare_workspace` per item | `NodeExecutionEnv` built from the conversation's `cwd` | **P1** reconcile: the merged TUI must resolve a seat's worktree the same way the broker does |
| 31 | **Headless render tests** | 15 TUI demos via `npm run test:tui` (`demo/tui-suite.mjs`) | 7 tests with `CapturingTerminal` | **P1** port the 7 into `demo/` and the suite; keeps a headless tier |
| 32 | **PTY / raw-mode tier** | Tier 4 not built (operator call) | None | **P3/DECIDE** `vendor/eval/node-pty` or `tui-test` if golden frames prove insufficient |
| 33 | **Dependency pin** | pi-durable/pi-ai pinned (`pi-main.pin.json`) | Resolves pi-coding-agent from the managed install | **P1** pin pi-coding-agent (merge plan §5) |

---

## 2. Durig-specific integrations the spike cannot have

These are not in HANDOFF because the spike predates durig's runtime:

- **Router toolset.** The merged registry = durig's router tools **+** coding tools **+** codemode
  (HANDOFF §8.1.4). The router is in `src/seattools.mjs` / `src/rig.mjs`; installing it into the
  durable registry is the concrete integration.
- **Constitution / seat persona.** Seats get a constitution injected into the system prompt
  (`FEATURES.md`). The new TUI must show and honour the same seat identity.
- **Org edges / capability gates.** `send`/`claim` reach is role-scoped; the TUI must not present an
  action a seat cannot perform.
- **Provenance / audit.** `RigQueue` transitions and the append-only audit trail are durig's; the
  merged TUI's queue view must read them, not a harness-local substitute (ROADMAP 51 "kept" list).
- **Read-only attach contract.** ROADMAP 52's in-process `viewState().subscribe()` and ROADMAP 55's
  security position gate the entire multi-process path.

---

## 3. Prioritized build list for the new TUI

**P1 — must exist before the new TUI is a durig surface**

1. Seat/conversation switcher + live-tail follow (#1, #2) over `readapi`/`viewState`.
2. Read-only/attach mode that opens **no harness**, and a fail-closed ownership guard against a
   broker-owned store (merge plan §4).
3. A write seam that is not a second writer: intent spool or broker-owned attach (#6, #14; ROADMAP 52/56).
4. Install durig's router tools beside the coding tools/codemode (#7, #8; HANDOFF §8.1.4).
5. Reconcile per-conversation `cwd`/worktree resolution with `prepare_workspace` (#30).
6. Keep the D40 invariant (no partial becomes an entry) under the new renderer (#9).
7. Sanitise + secret redaction on every read/write path (#16, #17) — security, before any untrusted
   transcript reaches the terminal.
8. Pin pi-coding-agent (#33; merge plan §5).
9. Port the 7 spike tests into `demo/` + `npm run test:tui` (#31).

**P2 — needed before `ui.mjs` can be retired**

10. Queue + selected-item view (ROADMAP 124) (#3).
11. Per-conversation agent config (ROADMAP 57) and model/thinking switching (#12, #13).
12. `pi.system`/`pi.reset` rendering on resume (#23).
13. Halt/degeneration-guard interaction (ROADMAP 58) (#29).
14. Tool-row/thinking/role parity and the `ctx` line decision (#10, #11).
15. Terminal-restore/paste parity (#18); verify H1/H2/H5 hold under Pi's terminal handling.

**P3 — parity and polish**

16. Width/sync/resize/anchor parity checks (#19–#22).
17. `tokensBefore` exactness behind the upstream ask (#24); narrow `abortCompaction` (#25).
18. Usage/cost surface (#28); labels/session-info ownership (#27).
19. Optional PTY tier (#32).

**DECIDE (operator/lead)**

20. Session lifecycle `newSession`/`fork`/`import` (#26).
21. Whether `durig ui` becomes a mode of the new TUI or stays (merge plan Phase 3).
22. Whether the PTY tier is worth its native dependency (#32).

---

## 4. Explicit non-gaps (do not rebuild)

- **`RigQueue`, org edges, `genlock`, the per-item worktree policy, the CLI/JSON contract, docs gates
  and rig files** stay durig's — they have no harness equivalent (ROADMAP 51 "kept" list).
- **The poller** stays the documented fallback; adopting the subscription seam must not delete D11's
  evidence (ROADMAP 52).
- **`session.sqlite`** is the operator's conversation and is never deleted (HANDOFF §10).
- **Timestamps** are synthesized by the adapter until pi-durable exposes entry time (HANDOFF §8.3).

---

## 5. Upstream asks surfaced by the gap

From HANDOFF §8.3, tracked here so they are not lost:

- pi-durable: entry timestamp; `tokensBefore` on the compaction entry; a compaction event carrying the
  summary entry; a supported `InteractiveMode` hand-off for an external durable runtime.
- durig: a security position for any attach socket **before** the multi-process TUI (ROADMAP 55).
