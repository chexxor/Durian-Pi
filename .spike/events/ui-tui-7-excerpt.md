=== SOURCE: docs/UI-TUI-INITIAL-THINKING.md — verbatim excerpts ===
extracted: 2026-10-13T18:51:22.127Z

NOTE (grounding correction): the screen-model decision pm/lead call "§7" is actually in this doc's §6 ("Screen model - the one real decision"); this doc's own §7 is "Level 2". §4 carries the pi-tui TuiMainScreen/TuiAltScreen library facts.

----- §7 in full (lines 196-242) -----
## 7. Level 2 (for evaluation, NOT committed): resident harness server + subscribing clients

This is ROADMAP item 40(a) / 38(b) — one architectural decision, named there as the platform-native
path. It is recorded here in more detail so the operator can decide whether it is wanted. **It needs
a `lead` scope ruling before any design commit.**

**What it is.** One long-lived process ("the server") owns the harness, the store, and the queue. It
exposes the platform's structural view — `Conversation.viewState()` / `thread.viewState(context)` —
plus a change stream: `thread.watch()` (compact, socket-friendly) or `watchEvents()` (friendlier,
more bytes). Clients (`log --follow`, `watch`, the Level 1 TUI, a future browser) become subscribers
instead of storage pollers. A late or reconnecting client starts from the current view, so it never
needs history replay.

**What it buys:**

- **Instant** streaming (no 750 ms poll latency) and tool progress.
- **Multiplayer**: several viewers of the same rig; the vacation "One view" feel.
- **A natural home for the queue driver** (item 38b) — wake-on-enqueue rather than an external clock.
- The single-writer discipline is **preserved**: exactly one process writes; clients only read.

**What it changes / risks (the honest costs):**

- It **revisits D11's conclusion.** D11's *evidence* (sqlite has no cross-process notification;
  `documentState` serves a stale replicated value to a separate watcher) still holds. Its
  *conclusion* — "viewers must read storage directly and never attach a harness" — was "too strong",
  per ROADMAP 40: *"a single long-lived writer that IS the harness is the thing to build."* This must
  be recorded as an explicit D-entry with the dissent.
- **New process lifecycle:** who starts/stops the server, what happens on crash (no half-line may
  read as history — the existing D40 rule generalizes to the server), recovery, and the interaction
  with `genlock` leases.
- **A new protocol surface:** subscription wire format, backpressure, reconnection, version skew
  between a client and the server. This is real engineering, not a rendering change.
- **Security:** if the stream ever leaves the machine it is network egress and needs a `security`
  position. If it stays local (named pipe / loopback), still define the boundary explicitly.
- **Testing:** a server + subscriber demo, plus crash/restart and reconnect cases.

**Decision criteria (for `lead`/operator):** Level 2 is only worth it if at least one is true —
(a) sub-poll streaming latency is a felt need; (b) more than one simultaneous viewer is wanted;
(c) remote access is wanted; or (d) item 38b (the queue driver) is being built anyway, in which case
the server is shared infrastructure rather than extra cost. If none hold, **Level 1 is sufficient**
and Level 2 stays deferred.

**Compatibility note:** Level 1 does not foreclose Level 2. The read API is already the seam; the
client would swap "poll `readRigHealth`" for "subscribe to the server" behind the same view model.

---


----- §6 screen-model decision + Level 1 boundaries (lines 159-195) -----
## 6. Level 1 (recommended first): a pi-tui interactive client over the existing poll

**What:** a new interactive entrypoint (e.g. `durig ui`) that is a pi-tui application reading through
the modules already built for this purpose — `src/readapi.mjs` (`readRigHealth`, `readSeatList`,
`readQueueItems`, `readLiveState`) and `src/viewmodel.mjs` (`buildTurns`, `turnCollapse`, `peerGraph`,
`peerTargets`, `partialView`).

**Non-negotiable boundaries:** `cli.mjs` stays non-interactive (D21) — the UI is a separate
entrypoint/file, never a new mode inside the JSON contract surface. No storage writes. The in-flight
partial is **not a turn** and keeps its distinct marker (D40).

**Shape to build:**

- Header: seat count, db, time, queue counts, attention.
- Seat list (`SelectList`, searchable) — switch the transcript target.
- Transcript: per-**turn** components (reusing the `buildTurns` unit), with **per-turn collapse** of
  thinking/tool blocks (`turnCollapse`), Markdown for agent prose.
- A dedicated **streaming row** for `partialView`, visibly distinct from committed turns.
- Footer: queue/attention + key hints.

**Screen model — the one real decision:** prefer **`TuiMainScreen` + keyboard-first** (↑/↓
select/scroll, `e` expand/collapse, tab pane switch, `q` quit), because `RESEARCH.md` found
alt-screen + tmux is the worst-supported combination and D21 chose to preserve scrollback.
`TuiAltScreen` (app-owned scrolling, mouse) is the prettier option but fights tmux
selection/copy. Mouse stays opportunistic. `lead` rules on main-screen vs alt-screen before any
design commit.

**Polling:** 750 ms, matching D11, until Level 2 exists. Live text arrives at poll pace.

**Testing (important):** pi-tui components render *headlessly* — `Component.render(width)` returns
lines with no terminal. So the screen builder can be proven in a demo (assert the rendered lines for
a fixture), while the same `ui_assert`-style approach used elsewhere can drive interaction. **Raw-mode
key handling must be validated on the operator's real terminal** (Windows Terminal / psmux), because
the delegate's shell is Git Bash (MSYS pty), which is not a faithful Windows console.

---


----- §4 pi-tui library facts incl. TuiMainScreen/TuiAltScreen + Git Bash note (lines 92-139) -----
## 4. Library facts — `@earendil-works/pi-tui` (grounded, re-checkable)

Read from `node_modules/@earendil-works/pi-tui@1.1.0` in the pi install tree
(`…/@earendil-works/pi-tui/package.json`, `dist/`, `native/`).

- **License/version:** MIT, `1.1.0`. `engines.node >= 22.19.0` (the host runs v24.19.0).
- **Runtime closure: 2 packages, 0 transitive.**
  - `get-east-asian-width@1.6.0` — MIT, node≥18, zero deps (cell-width table).
  - `marked@18.0.11` — MIT, node≥20, zero deps (Markdown component).
- **No shell, no network, no telemetry.** The complete non-`node:` imports across `dist` are exactly
  those two packages. The only two `child_process` call sites are `spawn("fd", …)` (file-path
  autocomplete) and `execSync("tmux display-message …")` (image-capability detection). Neither is
  needed by durig.
- **Native module — optional and failure-tolerant.** Ships prebuilds per platform
  (`win32-x64/arm64`, `darwin-*`, `linux-*-x11`) linked against Windows `kernel32`/`user32`
  ("console input setup, modifier-key state, clipboard; no Node headers required"). Loading is lazy
  and wrapped in `try/catch` with the failure cached as `undefined` — a missing/mismatched prebuild
  degrades to "no clipboard/modifier extras", it does not crash.
- **It does not open storage, the harness, or the queue.** It is a pure renderer over data handed to
  it, so D11 (no harness in a viewer) and D24 (no new write path) are untouched.
- **Inputs/outputs:** ESM (`"type":"module"`), matching durig's `.mjs`. `TuiMainScreen` renders into
  the terminal's main screen and preserves scrollback; `TuiAltScreen` owns a fixed-height viewport
  (mouse + app-owned scrolling). Differential rendering; CSI 2026 synchronized output.
- **Component set (from `dist/index.d.ts`):** `Text`, `TruncatedText`, `Markdown`, `Input`, `Editor`,
  `SelectList`, `SettingsList`, `ScrollView`, `Loader`, `CancellableLoader`, `MouseRegion`, `Image`,
  `Box`, `Container`, `VStack`, `HStack`, `Spacer`, plus `TuiMainScreen`/`TuiAltScreen` and theme
  helpers (`parseColor`, `mixColors`, `styleText`, `theme.appearance`).

### Git Bash — explicitly NOT introduced

The operator asked whether this drags in a Git Bash dependency. It does not.

- The Git Bash coupling lives in **`pi-coding-agent`'s model-facing `bash` tool**
  (`docs/windows.md`: *"Native Windows uses Git Bash by default for Bash commands"*). **durig does not
  use `pi-coding-agent`**, so it inherits none of it.
- pi-tui spawns no shell (only `fd` and `tmux`, above).
- **durig already decided against bash in the product:** `src/seattools.mjs` — *"`bash` is
  deliberately absent. On native Windows `bash` means Git Bash — an undeclared [dependency]"* — and
  `demo/seattools.test.mjs` asserts it. Seats get PowerShell; internal work `execFile`s `git` directly.

*(An earlier claim in the delegate's reasoning — that the `new URL("..", import.meta.url).pathname`
regex in ~20 demos was "Git Bash coupling" — was wrong and is retracted here: `new URL().pathname`
yields `/C:/…` on Windows under any shell. Concrete follow-up: replace the regex with
`fileURLToPath(import.meta.url)` in the demos that use it. It is not a blocker for this work.)*

---

## 5. Why the vacation-planner TUI feels better than durig's — the "One view"

----- §10 Ask — already-decided constraints + non-goals (lines 271-285) -----
## 10. Ask

Hand to `pm` to **register, split into bite-size one-concern items, sequence, and name the proving
test for each**. Recommended decomposition (PM owns the final split):

- `lead`: rule on (a) Level 2 now vs later, and (b) `TuiMainScreen` vs `TuiAltScreen`.
- `advocate` + `designer`: the consultation checkpoints in §8.
- `impl`: Level 1 client, one concern per change, demo per concern.
- `qa` + `auditor`: independent verification (headless render assertions; terminal behaviour noted as
  operator-validated).
- `scribe`: the client docs / `FEATURES.md`.

**Explicit non-goals:** no browser; do not change `cli.mjs`'s JSON contract; keep `log`/`watch`/JSON
working unchanged; no new write path.


----- §8 consultation checkpoints (lines 243-259) -----
## 8. Consultation checkpoints (required by our norms)

The durig team has both a **workflow/design reviewer** (`advocate`) and a **CLI/UX reviewer**
(`designer`). This UI work must collect their input at these points, and the PM records them
at intake:

1. **Before design commits** — `advocate` states which workflow(s) the view serves and which
   must-not-break loop it can break (`WORKFLOWS.md` is theirs). For a read-only viewer the workflow
   is the operator's situational awareness; the must-not-break loops are (i) the
   storage-only / no-harness discipline (D11) and (ii) "streaming is never committed history" (D40).
2. **Mid-build** — once the Level 1 client runs, `advocate` and `designer` review it **as users**
   (their feedback must be `observed`, per `advocate`'s role: *"never invent a user, quote, or
   demand"*). `designer` reviews discoverability, defaults, and failure legibility of the new surface.
3. **Close** — feedback folded or explicitly rejected with the reason; `scribe` documents.

---


===== END EXCERPTS =====