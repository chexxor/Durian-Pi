# TUI client for durig — initial thinking (operator's agent, starting point)

**Status:** initial thinking only — input for the team to decompose, not a decision.
**Author:** operator's delegate session (not a seat).
**Date:** 2026-10-13.
**For:** `pm` (intake/decomposition), `lead` (Level 2 scope ruling), `advocate` (workflow fit),
`designer` (surface/defaults), `impl`/`qa`/`auditor` (build/verify).

This document is the operator's starting point. It is deliberately written as *reasoning with
evidence and open questions*, not as a spec. The team owns decomposition, sequencing, and the final
design. Where this document disagrees with the repo, the repo wins — the citations are here so a
seat can re-check them.

---

## 1. Intent

Make durig's operating view — `log`, `watch`, `log --follow`, and the new live streaming — **modern,
intuitive, and friendly**. The operator finds the recent streaming work *functional but not
beautiful*. The operator's stated preference is a **TUI, not a browser**: the plain `pi` (non-durable)
UI is already sufficient, and the pi-durable **vacation-planner demo TUI** is the reference for what
"good" looks like. A browser UI is, in the operator's words, "a bit of a beast" and is not wanted
unless the TUI cannot do the job.

The questions the operator asked, which this document answers:

1. What can a browser web app do that a TUI app cannot easily do?
2. Is the relevant axis "stateful" or "modal"?

---

## 2. The real diagnosis: this is not a "TUI vs browser" problem

The current viewer is **not an interactive application**. `src/chatview.mjs` (`formatChat`,
`formatPartial`) and `src/watchview.mjs` (`formatSnapshot`) are **one-shot, append-only line
renderers**: they compute a whole string from scratch and print it. There is no component tree, no
persistent render state, no input loop, no focus, no viewport.

That was a deliberate choice, and the reasoning is sound where it was made:

- **D21** (`docs/DECISIONS.md`): *"keep `cli.mjs` non-interactive as the operator/LLM surface …
  `log` writes to stdout and leaves scrollback, pipes and log files alone. That choice is why the
  format is line-oriented rather than a repaint."*
- **`docs/RESEARCH.md`** §"Formatting a transcript": *"a REPL has nothing to repaint"*, and
  *"alternate screen … breaks scrollback and tmux, and tmux defeats every rendering strategy in the
  dataset."*

So the felt gap is precisely the one D21 named and deferred: **collapse/expand/scroll/focus require
owning a screen model, and the current code deliberately does not own one.** Streaming then had to be
bolted onto a poll-and-print model (`formatPartial`), which is why it reads as an add-on rather than a
design.

**Vocabulary correction (answering question 2).** "Stateful" and "modal" are orthogonal, and a TUI
does both:

| Axis | Meaning | TUI support (pi-tui) |
|---|---|---|
| **Stateful** | the view retains state across renders — selection, scroll, collapse, focus | `setFocus`, component state, differential rendering |
| **Modal** | an input mode/overlay captures focus — compose dialog, command palette, vim modes | `ctx.ui.custom()`, `showOverlay()`, modal editors |

The actual missing axis is **one-shot renderer vs interactive component tree**. D40 already built the
half that matters most (a pure view model + one read API), explicitly so that *"the screen is still
the operator's call"*.

---

## 3. TUI vs browser — what a browser genuinely does that a TUI cannot easily

Honest capability list. "Relevant?" is judged for *this* product (one operator, in a terminal,
subscribing to a local SQLite store).

| Browser-only, realistically | Relevant to durig? |
|---|---|
| Proportional fonts, headings/weights, CSS grid/flex, cards, shadows, gradients, opacity | Cosmetic. A TUI is one monospace cell grid plus a few attributes. pi-tui's OKLCH colour math (`parseColor`, `mixColors`) recovers much of the colour side. |
| Inline rich media: images, diagrams, syntax-themed code, charts, **video, WebGL/3D, maps** | pi-tui renders images only via Kitty/iTerm2 protocols (inconsistent; no charts/video). A transcript cockpit does not need these. |
| Rich controls: native text selection, drag-drop, date pickers, sliders, hover tooltips, context menus | Useless for this product. |
| Accessibility: screen readers, browser zoom, OS high-contrast, an a11y tree | Real, but the operator is a single terminal user. |
| Remote / multi-viewer: open from a phone, share a URL, many simultaneous viewers, zero install | **The one capability to weigh.** A TUI requires a terminal plus store access; the operator always has both, so this matters only if remote viewing becomes a requirement. |

Everything that makes a transcript *feel* modern — hierarchy via dim/bold, collapse/expand, a scroll
viewport, a live streaming row, a searchable seat list, overlays, peer navigation — is doable in
pi-tui. Meanwhile the TUI wins on exactly durig's architectural concerns: **no server, no build, no
auth, no deploy surface; works over SSH; stays composable with pipes/`grep`/`tee`; and the JSON CLI
contract stays untouched (D21).**

**Conclusion for question 1:** the browser wins on remote/multi-viewer and rich media. If those are
not requirements, a TUI is strictly better *for durig*. The browser is not foreclosed either — D40
made the data layer screen-independent, so a browser would later be "just another client."

---

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

`docs/REVIEW-pi-durable-demos.md` §"The architectural claim worth understanding" is the key evidence.
The vacation TUI (`experimental/vacation`, `tui.ts`) rests on one claim:

> the TUI renders `Conversation.viewState()`, the structural mount of the transcript and the
> built-in documents (`pi.live`, `pi.inbox`, `pi.agent`, `pi.usage`). Streaming, tool progress, the
> queue, retries, compaction status, the model, and usage all come from it.

It is beautiful partly because it is **single-process by construction**: one process owns the harness,
SQLite, and the TUI, so the view updates from in-process commit subscriptions. The review says
plainly: *"the demos are single-process … while durig is deliberately multi-process — seats in
separate terminals, cross-process polling (D11, D12, D22)."* The controller is a closed set of seven
plain-value actions (`submit`, `compact`, `abort`, `cycleThinking`, `setModel`, `toggleTasks`,
`switchConversation`).

So the vacation feel cannot be obtained by copying its widgets. It is two levels.

---

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

## 9. What the delegate already touched (so the team is not surprised)

- **Live tree only, uncommitted:** `durig/package.json` + `durig/package-lock.json` add
  `@earendil-works/pi-tui@^1.1.0` (verified resolvable; existing demo suite still green in a smoke
  run of `viewmodel`/`watchview`/`livestream`). **No product code was written.**
- Scratch probes were created and removed; nothing else changed.
- The **seat root** is `C:/tmp/durig-dev/pi-rebase/durig` (the worktree), so the dependency must be
  added there for the team to build. The team owns that step.

---

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
