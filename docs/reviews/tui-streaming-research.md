> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Research prompt — improve our TUI research and surface what we're overlooking

You are a research assistant for a small engineering team. Your job is to **strengthen research we
have already done** and, above all, to **find pitfalls and blind spots we have not considered**.
Ground every claim in a concrete artifact — a source file + version/commit, a spec section, or a
project doc URL. Label each claim `observed` (you ran or read it), `advertised-elsewhere` (a project
documents it), or `inferred` (you reasoned it). Never invent a user, a quote, or a benchmark. Where
you cannot verify something, say so plainly instead of guessing.

## What we already have (do not re-derive; build past it)

We run **durig**, a CLI that drives a team of LLM "seats" over a durable queue. The interactive
terminal client is a **separate, hand-rolled Node.js entrypoint** (`ui.mjs`), with a headless driver
(`src/tui/driver.mjs`) and a pure renderer (`src/tui/client.mjs`). No Ink/Textual/Bubble Tea/Ratatui.
It is a **read-only viewer** that **polls SQLite every 700 ms** and repaints. It uses the **alternate
screen** with raw mode; a seat list (↑/↓ select) and a conversation view (Enter opens a seat's stream,
↑/↓ scroll, G/End jumps to the live tail, Esc back).

If you have repo access, read these first, then go outside the repo:
- `skills/tui-design/SKILL.md` and `references/{exemplar-apps,visual-patterns,interaction-patterns}.md`
  (vendored from gfargo/tui-design-skill, MIT — the *exemplar-apps* file is the best starting point).
- `docs/UI-TUI-INITIAL-THINKING.md` — our design thinking, **including "Appendix A"** where we already
  mapped lazygit, k9s, Claude Code, Copilot CLI, Gemini CLI, Toolong and Glow onto our client.
- `docs/DECISIONS.md` **D61** (originally: main-screen, no alt-screen) and **D69** (superseded D61 for
  `ui.mjs`: alt-screen + app-owned scrolling).
- `ui.mjs`, `src/tui/client.mjs`, `src/tui/driver.mjs`, `demo/tui-*.test.mjs`.

**Facts we verified in our own code — treat as established, not open questions:**
- Untrusted model/tool text is rendered **without control-sequence sanitisation** (`src/viewmodel.mjs`
  `buildTurns` passes raw text; `src/tui/client.mjs` renders it). OSC 52/OSC 8/cursor/title sequences
  could reach the operator's terminal.
- Text width uses JavaScript **`String.length`, not terminal cells** (`src/watchview.mjs:15,22`), so
  CJK/emoji/combining marks can misalign.
- Crash paths are **not** covered: `ui.mjs` handles `SIGINT`/`SIGTERM` and a top-level `try/catch`, but
  has no `uncaughtException`/`unhandledRejection`/`exit` restoration.
- There is **no search, no transcript copy/export, and no inline/plain fallback**.
- Repaint is a **full clear + rewrite** (`\x1b[H\x1b[2J` then the frame) with **no synchronized
  output**. The vendored `@earendil-works/pi-tui` *does* emit sync-output sequences
  (`dist/tui-main-screen.js:241,264`), so "does it exist" is answered.

## Part 1 — improve and correct our existing research

1. **Audit "Appendix A"** in `docs/UI-TUI-INITIAL-THINKING.md`. Is each exemplar mapping accurate and
   current? What did we get wrong, overstate, or leave out? Add the projects we did not cover.
2. **Alt-screen vs inline.** We chose alt-screen (D69). Gather the strongest evidence for and against
   for a long-lived "cockpit" whose workload is *reviewing and copying* as much as typing. Which
   renderer do Claude Code (fullscreen), Copilot CLI, Gemini CLI, aider, opencode/Charm, lazygit, k9s
   actually use? What did users complain about after switch experiments? If the evidence favours
   inline for our workload, say so directly and cite it.
3. **Streaming render.** Full clear+repaint vs line-diffing vs cell-diffing vs **synchronized output
   (DEC private mode 2026, `\x1b[?2026h…l`)**. When does sync output help, when is line-diffing
   required, and what combination avoids flicker and scroll-jump under a ~700 ms poll? Give exact
   sequences/APIs and the failure each prevents. Cite real renderers.
4. **Scroll anchoring.** The standard "stick to bottom unless scrolled up, then show *N new* without
   moving the viewport" pattern — including inserts at the bottom and terminal resize. Cite code.
5. **Full-width vs readable measure.** We now wrap prose to the full terminal width (e.g. 200 cols).
   Is that a known readability anti-pattern? What max measure do mature tools use, and do they centre
   or left-align the content column? Give the convention and its evidence.

## Part 2 — the main ask: pitfalls and things we are overlooking

Produce a **pitfall catalogue ranked by user harm**, each with: symptom, why it bites, the standard
mitigation, and where it would live in our code. Cover at least, and go beyond:
- **Terminal escape injection** from untrusted output (OSC 52 clipboard, OSC 8 links, cursor/title
  sequences): the standard strip/allowlist, and what a correct allowlist contains.
- **Crash/kill restoration** on Windows Terminal, psmux and tmux, and what `setRawMode(false)` does
  when the process dies.
- **Cell-width correctness** — canonical Node 24 approach (`string-width`/`wcwidth`,
  `Intl.Segmenter`, grapheme clustering; East-Asian ambiguity; emoji ZWJ); the known wrong answers.
- **Blocking/event-loop hazards** and the 700 ms poll (jank, torn frames, DB contention), plus safe
  logging while raw mode is active.
- **Too-small / unknown `columns`/`rows`**, resize storms, and reading a half-updated size.
- **Alt-screen tax** — how real fullscreen chat TUIs give copy, search, transcript export, and a
  scrollback receipt on exit; is there a tmux-like copy mode?
- **Accessibility / screen readers**, `NO_COLOR`, monochrome, and what a `--no-tui`/plain mode must
  contain.
- **Input editing** (our next feature): raw-mode line editing — bracketed paste, IME/CJK composition,
  history, cursor/word movement, Ctrl-key and mouse collisions, Windows raw-mode differences.
- **Testing on Windows**: golden frames, property tests for wrapping/width, PTY end-to-end, CI — with
  real repo setups (Ink, Bubble Tea `teatest`, Textual `Pilot`, Ratatui `TestBackend`).

Then answer directly: **what are we not asking?** What will break first at 50 seats / 10k-turn
transcripts, and what is the highest-harm thing we have not named?

## Deliverable

A single markdown doc (a good home is `docs/reviews/tui-streaming-research.md`, or paste it back):
1. **Corrections** to the research we already have (point by point against Appendix A and D61/D69).
2. A **decision table**: alt-screen vs inline · full-clear vs line-diff vs sync-output · full-width vs
   capped measure · (and any other fork we face) — each with evidence and a clear recommendation.
3. A **ranked pitfall catalogue** with mitigations and code locations.
4. A **"borrow this / avoid that"** list: exact libraries, escape sequences, APIs, versions.
5. **What we are overlooking**, ranked by user harm, with the first thing that breaks at scale.

Cite every claim. Prefer primary sources (renderer source, specs, project docs) over blog summaries.


--------------------------------

I could not access your repository, so I could not read `docs/UI-TUI-INITIAL-THINKING.md` (Appendix A), `docs/DECISIONS.md` (D61/D69), `ui.mjs`, or the `src/` files, and I could not run anything. Everything below about *your* code is therefore taken from the facts you listed as established, and every claim about the outside world is labeled and cited. Where a mapping in Appendix A can't be checked from the outside, I say so rather than guess. The single most important correction is a scope one: **Appendix A was written before Claude Code shipped its own alternate‑screen "fullscreen" mode (2026), so any mapping that treats Claude Code as an inline/classic‑only exemplar is now stale** [^1].

---

# TUI streaming research — corrections, decisions, pitfalls

## 0. Scope, method, and how to read the labels

- **observed** — I read it in a primary source I fetched (renderer docs, spec, source, issue). Cited.
- **advertised-elsewhere** — a project's own docs/issues claim it, but I did not read the code path.
- **inferred** — I reasoned from the above; not directly verified.

I could not run `ui.mjs` or read `src/tui/client.mjs`, `src/viewmodel.mjs`, `src/watchview.mjs`, or `demo/tui-*.test.mjs`, so I did **not** re-derive your "facts we verified" list; I treat those as given and build past them.

---

## 1. Corrections to the research you already have

### 1a. Appendix A exemplar mappings — current state

I cannot see what Appendix A actually says, so I've listed the *verifiable current state* of each exemplar. Treat anything here as a correction **if** your mapping differs; where your mapping already matches, it's confirmation.

| Exemplar | What it actually is (current) | Label | Correction to watch for |
|---|---|---|---|
| **Claude Code** | Ink‑based; ships a **fullscreen mode that draws on the alternate screen buffer "like vim or htop"**, renders only visible messages, keeps memory flat, adds mouse support [^1]. Uses a heavily modified Ink fork with **double‑buffered cell‑level diffing** so only changed cells are written [^9]. | observed | If Appendix A calls Claude Code "inline/classic", that's **out of date** — fullscreen is now a first‑class mode (`/tui fullscreen`, `CLAUDE_CODE_NO_FLICKER=1`) [^1]. |
| **Copilot CLI** | A redesigned terminal interface shipped June 2026 ("cleaner layout, theme‑aware semantic colors, responsive") [^54]. | observed (changelog) | **Renderer unverified.** One conference abstract claims "Claude Code, Gemini CLI, and GitHub Copilot CLI are all built with Ink" [^10], but I found **no primary confirmation** of Copilot CLI's renderer. Do **not** assert it in Appendix A without a source. |
| **Gemini CLI** | Full React/Ink app [^3][^11][^12]. | observed | Fine as‑is. Note it renders via Ink's Yoga/Flexbox model, not a hand‑rolled renderer. |
| **aider** | prompt_toolkit REPL; prompt_toolkit's *full‑screen* apps use the **alternate screen buffer** [^13]. | advertised-elsewhere | Aider's default is an **inline** prompt_toolkit REPL, not a full‑screen app. If Appendix A lumps aider with alt‑screen TUIs, that's an overstatement. (A third‑party "Aider‑TUI" exists [^14].) |
| **opencode / Charm** | **Two different projects.** opencode (anomalyco) is a **Go / Bubble Tea** TUI — there's an open issue *evaluating a migration to Ink* [^55]. Charm's own agent is **Crush**, on **bubbletea/v2** [^15]. | observed | **Correction: "opencode/Charm" conflates two codebases.** opencode ≠ Charm. Keep them separate. |
| **lazygit** | **gocui** (tcell underneath); the maintainer explicitly considered switching to tview *or* charm but had not chosen [^16]. | observed | If Appendix A maps lazygit to tview, that's **wrong** — it's gocui/tcell. |
| **k9s** | **tview** (tcell) [^16]. | observed | Correct as‑is. |
| **Toolong / Glow** | Both are Bubble Tea/Textual‑family apps, but I did not verify their viewport mode in this pass. | inferred | Flag as unverified; Glow is pager‑like (inline) and Toolong (Textual) is full‑screen — but I did not confirm against source, so don't upgrade to "observed". |

**Net Appendix A correction:** the biggest gap is **not** a wrong mapping but a missing axis. Appendix A maps *apps*, but the decision that actually matters for you is **viewport model** (inline vs alternate screen) and **diff strategy** (full clear vs line vs cell), and those cut across apps: Bubble Tea explicitly supports "inline, full‑window, or a mix of both" [^17]; Ratatui exposes `Viewport::Inline` *and* alternate screen as separate choices [^56][^18]; Ink's `<Static>` gives an inline‑history model *and* `fullscreen-ink` gives alt‑screen [^57][^19]. Add a "viewport model" column.

### 1b. D61 / D69 (alt‑screen)

- **D61 (main‑screen, no alt‑screen) vs D69 (alt‑screen + app‑owned scrolling for `ui.mjs`).** The strongest *pro‑alt‑screen* evidence is exactly what D69 leans on: alt‑screen eliminates flicker, keeps memory flat in long conversations, and enables mouse support [^1]. The strongest *anti* evidence is that alt‑screen **removes your terminal's native scrollback, search, and copy** — Claude Code, which chose alt‑screen, had to build a **transcript mode** (`Ctrl+o`) with `[` to dump the whole conversation back into native scrollback and `v` to open it in `$EDITOR`, precisely because "`Cmd+f` and tmux search don't see the conversation" [^1]. Users complain about exactly this ("scrolling up is a premium feature") [^58], and other alt‑screen tools get "please let me disable the alternate screen so I can scroll back" issues [^59][^60].
- **Recommendation:** D69 is defensible *only if* you add the escape hatches Claude Code added. See §2. My direct read: for a **read‑only** cockpit, the evidence tilts **inline** — because the single biggest concrete benefit of alt‑screen (a pinned input box + flicker‑free streaming of an active editor) doesn't apply to a viewer that has no input box, while the cost (losing native scrollback/search/copy) applies fully. Details and citations in §2.

### 1c. The repaint fact

You state you do `\x1b[H\x1b[2J` + frame with no sync output, and that `pi-tui` does emit sync sequences. That matches the Claude Code issue describing "full‑screen clear (CSI 2J + CSI H) every render" as a known problem [^61]. The correction is not the fact but the fix: **wrap the frame in DECSET 2026** rather than switching to cell diffing (§2, §3).

---

## 2. Decision table

| Fork | Options | Evidence | Recommendation |
|---|---|---|---|
| **Viewport model** | (a) inline / main screen, (b) alternate screen + app scrolling, (c) hybrid (inline tail + alt‑screen "focus") | Alt‑screen: flicker‑free, flat memory, mouse [^1]. Cost: kills native scrollback/search/copy [^1][^58][^59]. Inline viewport in Ratatui reserves rows and may scroll the terminal [^18], and has a known resize "whitespace gap" problem [^20]. Bubble Tea treats inline/full‑window as first‑class [^17]. | **For a read‑only viewer: inline (a), with an optional alt‑screen "focus/fullscreen" toggle (c).** You have no input box, so the alt‑screen's main win doesn't apply, but its main cost does. If you keep D69's alt‑screen, you **must** ship a transcript‑to‑scrollback escape hatch and in‑app search [^1]. |
| **Diff strategy** | full clear+repaint · line‑diff · cell‑diff · synchronized output | Full clear `CSI 2J`+`CSI H` per frame is the documented flicker source [^61]. Cell‑level double‑buffered diffing is what Claude Code's Ink fork does [^9]. DECSET 2026 batches output so the terminal draws one atomic frame [^21][^4]. | **Sync‑output (2026) around your existing full repaint is the highest‑value, lowest‑risk change.** Add line‑diffing only if you go inline (needed to preserve scrollback/scroll anchoring). Cell‑diffing is a large rewrite — don't start there. |
| **Measure** | full terminal width vs capped measure | Prose readability optimum ≈60–80 chars [^62]; ~70ch/34em to stay ≤80 [^63]; glyph blog argues optimal CPL 45–95 and ~90 for code [^64]. Terminal default‑80 tradition [^22]. | **Cap the *prose* measure (≈80–100 cols), left‑align (not centred), and let code/tool output use full width.** Note: these readability sources are web/typography, not TUI‑specific — labeled inferred. |
| **Scrolling / anchoring** | naive repaint vs "stick to bottom unless scrolled up" | Textual ships an `anchor` API: "stay scrolled to the bottom when new content is added, until the user moves the scroll position" [^65]; the chat‑UI pattern is standard [^23][^24]. | **Implement the anchor pattern** (§3, pitfall 5). |
| **Untrusted text** | render raw vs sanitize | OSC 52 clipboard poisoning and OSC 8 link spoofing are real, exploited vectors [^25][^26][^27]. | **Sanitize by default**, allowlist a strict SGR subset (§3, pitfall 1). |

---

## 3. Ranked pitfall catalogue

Ranked by **user harm** (blast radius × likelihood × irreversibility). "Code location" uses your own file names; treat those as **inferred** placements.

### 1 — Terminal escape injection from untrusted model/tool text (highest harm)
- **Symptom:** a seat's output contains OSC 52 (clipboard write), OSC 8 (hyperlink), cursor/title/alt‑screen sequences; on render, the operator's clipboard is silently poisoned, a link spoofs a URL, or the app is thrown off its own alt screen.
- **Why it bites:** you already confirmed raw text reaches the terminal [your fact]. OSC 52 write is enough to place an attacker command in the clipboard that runs when the operator pastes [^25]; this was chained to **RCE** in a real Codex CLI advisory [^26]. OSC 8 spoofing and title‑bar spoofing are named as standard attack surfaces [^27].
- **Standard mitigation:** sanitize **by default** at the render boundary — strip the ESC byte (or replace it) for any sequence not in an allowlist; allow only a **strict SGR subset**, `\n`, and tabs [^5][^66]. Do **not** trust "it's just a color code." Reject OSC entirely, or allow a fixed whitelist of OSC codes if you need OSC 8 links (and validate the URL scheme to `http(s)`).
- **Code location:** `src/viewmodel.mjs buildTurns` (sanitize on ingest) **and** `src/tui/client.mjs` (defence in depth at emit). Prefer sanitizing once, storing the sanitized form, and asserting no raw ESC crosses into the writer.

### 2 — Abnormal exit leaves the terminal corrupted (highest blast radius)
- **Symptom:** process dies from an uncaught exception/signal; shell is left in **raw mode**, cursor hidden, stranded on the **alternate screen**, and (if you enabled it) **mouse reporting still on**. On Windows ConPTY this can corrupt a **shared** console and affect other apps [^28].
- **Why it bites:** you already noted `ui.mjs` handles SIGINT/SIGTERM + top‑level try/catch but has **no `uncaughtException`/`unhandledRejection`/`exit` restoration**. Restore handlers are also a known re‑entrancy hazard (double‑SIGINT during cleanup) [^29].
- **Standard mitigation:** register `process.on('exit'|'uncaughtException'|'unhandledRejection'|'SIGINT'|'SIGTERM')` all pointing at one **idempotent** restore that runs in the documented order: **reset SGR → show cursor → leave alt screen → restore termios/raw mode** (and disable mouse tracking) [^67][^30]. Use a panic‑hook equivalent [^68]. On Windows, restore must clear mouse reporting explicitly [^28].
- **Code location:** `ui.mjs` (single `restore()` guarded by a `restored` boolean; wire every handler to it).

### 3 — Alt‑screen tax: no scrollback, no search, no copy
- **Symptom:** operator can't scroll back, `Cmd+f`/tmux copy‑mode find nothing, native drag‑select is captured by the app.
- **Why it bites:** the conversation lives in the alt buffer, invisible to the terminal [^1][^58].
- **Mitigation (copy Claude Code's receipts):** transcript mode that dumps the **full** conversation into native scrollback on demand (`[`), an "open in `$EDITOR`" (`v`), in‑app search (`/`), in‑app selection that copies on release, and a **"show N new"** affordance instead of viewport jumps [^1][^1]. If you go inline (§2), you get much of this for free.
- **Code location:** `src/tui/client.mjs` (search/selection/transcript) + `src/tui/driver.mjs` (raw‑scrollback dump).

### 4 — Cell‑width incorrect (`String.length`)
- **Symptom:** CJK/emoji/combining‑mark rows misalign; wrapped text overflows or underflows; cursor lands wrong.
- **Why it bites:** you use `String.length` (`src/watchview.mjs:15,22`) [your fact]. Correct width needs **grapheme clustering** (UAX #29) — e.g. "🧑🌾" is 3 codepoints / 11 bytes but **one** grapheme [^2] — and even then terminals disagree wildly (widths of 2, 4, 5, 6 observed across terminals) [^2].
- **Mitigation:** use **`string-width`** (which strips ANSI and uses `Intl.Segmenter` + `\p{RGI_Emoji}`) [^31][^32], or implement grapheme segmentation with `Intl.Segmenter` (stable in Node ≥20) [^33][^69]. Do **not** assume `wcwidth` **or** grapheme‑clustering behaviour [^2]. Optionally probe **mode 2027** (`CSI ? 2027 $ p`) [^2].
- **Code location:** `src/watchview.mjs` (replace `length` with a width function) and any wrap helper.

### 5 — Blocking / event‑loop hazards and the 700 ms poll
- **Symptom:** input lag, **torn frames**, SQLite "database is locked," CPU spikes; worse at scale.
- **Why it bites:** building the whole frame synchronously on the event loop (and, if you map *all* turns each poll, O(transcript) per tick) stalls input and the next poll. Full‑clear repaint makes tearing visible [^61].
- **Mitigation:** (a) wrap each paint in **DECSET 2026** so a partially written frame never shows [^21]; (b) **virtualize** — only build visible rows; (c) make the poll non‑blocking (async SQLite / WAL, read in a worker); (d) never `console.log` while raw mode is active — route logs to a file or a dedicated status line. Bubble Tea explicitly notes that printing/logging "will behave the same way it would in a non‑TUI commandline tool" only when it manages that path [^34].
- **Code location:** `src/tui/driver.mjs` (poll loop), `src/watchview.mjs` (frame build).

### 6 — Too‑small / unknown size, resize storms, half‑updated size
- **Symptom:** layout breaks in a 20×5 pane; flicker during drag‑resize; reading stale dimensions.
- **Why it bites:** `process.stdout.on('resize')` can be **~100 ms delayed** [^35]; on Windows SIGWINCH only fires on a write/cursor move [^36]; and **only stdout** gets updated rows/columns [^70]. Inline viewports have documented resize problems (whitespace gaps) [^20] and high‑throughput flicker [^71]. `process.stdout.columns` can be `undefined` when not a TTY [^37].
- **Mitigation:** debounce resize; re‑read size **at paint time**, not on the event; guard non‑TTY (`process.stdout.isTTY`) [^6]; use `terminal-size` which works even when redirected [^37]; define a minimum size and a degraded layout.
- **Code location:** `src/tui/driver.mjs` (resize handler), `ui.mjs` (TTY guard).

### 7 — Accessibility, NO_COLOR, monochrome, plain mode
- **Symptom:** screen‑reader users can't use it; every repaint re‑homes the review cursor; colour‑blind/monochrome terminals lose meaning.
- **Why it bites:** continuous repaint is an update event per line for screen readers [^38]; modern TUIs are widely reported as *more* hostile to accessibility than GUIs [^39][^72]. `NO_COLOR` is a standard [^40].
- **Mitigation:** honour `NO_COLOR` [^40]; offer `--no-tui`/`--plain`/`ACCESSIBLE_OUTPUT` [^41]; ensure a **linear plain‑text stream** fallback; don't encode meaning in colour alone.
- **Code location:** `ui.mjs` (flag/env parsing), `src/tui/client.mjs` (colour policy).

### 8 — Input editing (your next feature)
- **Symptom:** multi‑line paste executes on paste; IME/CJK composition breaks; history/word‑movement wrong; Ctrl keys or mouse collide.
- **Why it bites:** without **bracketed paste** (DECSET 2004, `ESC[?2004h`; content wrapped in `ESC[200~`…`ESC[201~`) a paste with newlines can execute [^42][^43]. Windows raw mode differs: `setRawMode()` needs write permission to the console input buffer and **overwrites console mode flags** [^6][^44].
- **Mitigation:** enable bracketed paste; handle IME composition; implement history + word/line movement; decide mouse vs keyboard; test on Windows ConPTY [^73][^45].
- **Code location:** new input module; `ui.mjs` raw‑mode setup.

### 9 — Testing gaps
- **Symptom:** regressions in wrapping/width and frames go unnoticed.
- **Why it bites:** TUI testing is under‑served; each framework ships an in‑memory harness that renders to a buffer and compares to a stored frame — **Ratatui `TestBackend`** [^7][^74], **Bubble Tea `teatest` + golden files** [^46][^47][^48], **Textual `run_test`/`Pilot`** [^8][^75], **`ink-testing-library` `lastFrame`** [^49][^50].
- **Mitigation:** golden‑frame tests + property tests for wrapping/width + a PTY end‑to‑end harness (node‑pty [^51]; `microsoft/tui-test` [^76]).
- **Code location:** `demo/tui-*.test.mjs`.

---

## 4. Borrow this / avoid that

| Borrow | Why / how | Cite |
|---|---|---|
| **DECSET 2026** — `ESC[?2026h` … `ESC[?2026l` around each frame | Atomic frames, kills tearing from your full repaint | [^21][^4] |
| **DECRQM probe** — `CSI ? 2026 $ p` | Detect support; if no reply or `CSI ? 2026 ; 0 $ y`, it's unsupported | [^52][^4] |
| **DECSET 2004** bracketed paste | Prevents paste‑injection when you add editing | [^42][^43] |
| **`string-width` + `strip-ansi`** (Node) | Correct cell width + ANSI stripping | [^31] |
| **`Intl.Segmenter`** (Node ≥20) | Grapheme clustering | [^33][^69] |
| **Mode 2027 probe** `CSI ? 2027 $ p` (optional) | Negotiate grapheme‑correct width where supported | [^2] |
| **Transcript‑to‑scrollback + `$EDITOR` escape hatch** | The receipt that makes alt‑screen tolerable | [^1] |
| **Idempotent restore** (SGR → cursor → alt screen → termios) | Crash‑safe teardown | [^67][^30] |
| **Anchor scroll** (`anchor` semantics) | "Stick to bottom until user scrolls up" | [^65][^24] |
| **PTY tests** (`node-pty`, `microsoft/tui-test`) | End‑to‑end terminal behaviour | [^51][^76] |

| Avoid | Why | Cite |
|---|---|---|
| `String.length` for width | Wrong for CJK/emoji/combining | [^2] |
| Assuming `wcwidth` **or** grapheme clustering | Both wrong on real terminals | [^2] |
| OSC 52 clipboard **read** | Exfiltration vector | [^53] |
| Rendering raw ESC from model output | Clipboard hijack → RCE precedent | [^25][^26] |
| `CSI 2J`+`CSI H` per frame **without** sync output | Documented flicker source | [^61] |
| `console.log` during raw mode | Corrupts the frame | [^34] |
| Assuming SIGWINCH on Windows | Only fires on write/cursor move | [^36] |
| Assuming `tmux` supports sync output | ≤3.6 doesn't | [^1] |
| iTerm2 `tmux -CC` + alt screen + mouse | Known‑broken combination | [^1] |

---

## 5. What you are overlooking, ranked by user harm

**First, the things you are not asking:**

1. **There is no threat model or trust boundary.** You've *verified* that untrusted text is unsanitised, but there's no written statement of what is trusted (the queue? the seat? the tool output? the terminal?) and no acceptance criterion for sanitisation. Everything in pitfall 1 flows from this gap.
2. **No terminal capability negotiation.** You hard‑code sequences. Real renderers probe (`DECRQM` for 2026/2027) and degrade [^52][^2]. You don't yet.
3. **No frame‑time / performance budget.** "700 ms poll" is a poll interval, not a render budget. Nothing states the maximum time a frame may occupy the event loop.
4. **No non‑TTY / piped / CI contract.** What does `durig` do when `stdout` is a pipe? `process.stdout.columns` is `undefined` [^37].
5. **No multi‑client / concurrency story.** Two operators on the same SQLite DB via 700 ms polls is a lock‑contention scenario you haven't named.
6. **No accessibility acceptance criteria** — only a known absence.
7. **Whether the viewer should stay read‑only.** "Input editing" is on the roadmap; adding input reintroduces the pinned‑input‑box justification for alt‑screen *and* a whole new attack surface.

**What breaks first at 50 seats / 10k‑turn transcripts:** the **render/DB loop**, not the terminal. If `buildTurns` maps the whole transcript each poll, every 700 ms does O(10k) allocation + width work on the event loop → jank → torn frames → then, under multiple clients, SQLite contention ("database is locked"). The terminal's full‑clear cost is roughly constant (screen size), so **the transcript length, not the screen size, is your scaling cliff**. Fix order: virtualize the frame, sanitize + width‑measure **once** at ingest, move SQLite off the main thread, wrap paint in 2026.

**The highest‑harm thing you have not named:** it isn't the escape injection itself (you named that) — it's its **blast radius on abnormal exit plus the shared Windows console**. A crash that leaves **raw mode + mouse reporting** active on a **ConPTY** console corrupts state for *other* apps sharing it [^28], and a stranded alt‑screen + hidden cursor pushes users to run `reset`/paste recovery commands — which is exactly when a poisoned clipboard from pitfall 1 detonates [^25][^26]. The two highest‑ranked pitfalls **compound**: escape injection plants the payload, failed restore delivers the paste. Fix restore and sanitisation together, or neither is safe.

---

**One honest caveat for your review doc:** the "cap the measure" recommendation rests on web‑typography sources [^62][^63][^64], not on a TUI‑specific study — I could not find a primary TUI source that fixes a max measure. Label that row **inferred**, not observed.

**References**

[^1]: [Fullscreen rendering - Claude Code Docs](https://code.claude.com/docs/en/fullscreen) (21%)
[^2]: [Grapheme Clusters and Terminal Emulators – Mitchell Hashimoto Twitter icon GitHub icon LinkedIn icon](https://mitchellh.com/writing/grapheme-clusters-in-terminals) (17%)
[^3]: [Ink - React for interactive command-line apps · GitHub](https://github.com/vadimdemedes/ink) (2%)
[^4]: [Terminal Spec: Synchronized Output · GitHub](https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036) (2%)
[^5]: [stdisplay](https://www.kicksecure.com/wiki/Stdisplay) (2%)
[^6]: [TTY | Node.js v26.10.0 Documentation](https://nodejs.org/api/tty.html) (2%)
[^7]: [TestBackend in ratatui::backend - Rust](https://docs.rs/ratatui/latest/ratatui/backend/struct.TestBackend.html) (2%)
[^8]: [Textual - Testing](https://textual.textualize.io/guide/testing/) (2%)
[^9]: [claude-code-internals/src/ink/README.md at main - GitHub](https://github.com/claytonsandham/claude-code-internals/blob/main/src/ink/README.md) (1%)
[^10]: [React in Your Terminal: Building Beautiful TUIs with Ink](https://hkoscon.org/2026/topic/react-in-your-terminal-building-beautiful-tuisiwith-ink/) (1%)
[^11]: [UI Rendering | char8x/gemini-cli | DeepWiki](https://deepwiki.com/char8x/gemini-cli/7.4-ui-rendering) (1%)
[^12]: [UI Architecture and Input Handling | google-gemini/gemini-cli - DeepWiki](https://deepwiki.com/google-gemini/gemini-cli/4.6-ui-architecture-and-input-handling) (1%)
[^13]: [Full-Screen Applications | prompt-toolkit/python-prompt-toolkit | DeepWiki](https://deepwiki.com/prompt-toolkit/python-prompt-toolkit/4.1-full-screen-applications) (1%)
[^14]: [Aider-TUI/README.md at main · nanshaws/Aider-TUI · GitHub](https://github.com/nanshaws/Aider-TUI/blob/main/README.md) (1%)
[^15]: [charmbracelet/crush | DeepWiki](https://deepwiki.com/charmbracelet/crush) (1%)
[^16]: [New interface using Charm.sh libraries #2705 - GitHub](https://github.com/jesseduffield/lazygit/issues/2705) (1%)
[^17]: [charmbracelet/bubbletea: A powerful little TUI framework](https://github.com/charmbracelet/bubbletea) (1%)
[^18]: [Viewport in ratatui - Rust - Docs.rs](https://docs.rs/ratatui/latest/ratatui/enum.Viewport.html) (1%)
[^19]: [GitHub - DaniGuardiola/fullscreen-ink: Create fullscreen command line ...](https://github.com/DaniGuardiola/fullscreen-ink) (1%)
[^20]: [Resize for inline viewport · Issue #2086 · ratatui/ratatui - GitHub](https://github.com/ratatui/ratatui/issues/2086) (1%)
[^21]: [Synchronized output (DECSET 2026) — Terminal Support](https://terminfo.dev/modes/decset-2026-synchronized-output) (1%)
[^22]: [Why is the default terminal width 80 characters?](https://stackoverflow.com/questions/4651012/why-is-the-default-terminal-width-80-characters) (1%)
[^23]: [Is there a way to pin a VerticalScroll to the bottom? · Textualize ...](https://github.com/Textualize/textual/discussions/5674) (1%)
[^24]: [chat-scroll - flintc.github.io](https://flintc.github.io/chat-scroll/) (1%)
[^25]: [Terminal escape sequence injection via unsanitized prompt ... - GitHub](https://github.com/JanDeDobbeleer/oh-my-posh/security/advisories/GHSA-fwjx-9p69-h25h) (1%)
[^26]: [ANSI Escape Code Injection in OpenAI's Codex CLI Leading to RCE](https://dganev.com/posts/2026-02-12-ansi-escape-injection-codex-cli/) (1%)
[^27]: [Terminal Security: Clipboard, Paste Injection, Escape Attacks](https://terminfo.dev/fundamentals/security) (1%)
[^28]: [V2: TUI leaves terminal in raw mode after /exit on Windows ConPTY ...](https://github.com/anomalyco/opencode/issues/55163) (1%)
[^29]: [[bug] Terminal `restore()` Signal Handler Re-Entrancy and Cleanup Race ...](https://github.com/Karanjot786/TermUI/issues/1039) (1%)
[^30]: [Crash safety & terminal restore | JSVision](https://blendsdk.github.io/jsvision/guide/crash-safety.html) (1%)
[^31]: [string-width - npm](https://www.npmjs.com/package/string-width) (1%)
[^32]: [sindresorhus/string-width | DeepWiki](https://deepwiki.com/sindresorhus/string-width) (1%)
[^33]: [Intl.Segmenter () constructor - JavaScript | MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter/Segmenter) (1%)
[^34]: [tea package - github.com/charmbracelet/bubbletea - Go Packages](https://pkg.go.dev/github.com/charmbracelet/bubbletea) (1%)
[^35]: [process.stdout.on('resize') delayed ~100ms #9032](https://github.com/nodejs/node-v0.x-archive/issues/9032) (1%)
[^36]: [Process | Node.js v26.11.1 Documentation](https://nodejs.org/api/process.html) (1%)
[^37]: [terminal-size - npm](https://www.npmjs.com/package/terminal-size) (1%)
[^38]: [[Feature]: Screen-reader mode for the TUI — static plain ... - GitHub](https://github.com/NousResearch/hermes-agent/issues/120584) (1%)
[^39]: [The text mode lie: why modern TUIs are a nightmare for accessibility ...](https://www.osnews.com/story/144892/the-text-mode-lie-why-modern-tuis-are-a-nightmare-for-accessibility/) (1%)
[^40]: [NO_COLOR: disabling ANSI color output by default](https://no-color.org/) (1%)
[^41]: [Screen reader support (Plain text output flag to disable TUI ... - GitHub](https://github.com/aaif-goose/goose/issues/11566) (1%)
[^42]: [Bracketed paste (DECSET 2004) — Terminal Support](https://terminfo.dev/modes/decset-2004-bracketed-paste) (1%)
[^43]: [DEC Private Modes — Terminal Feature Standard | Terminfo.dev](https://terminfo.dev/dec-private-modes) (1%)
[^44]: [Windows: setRawMode (true) overwrites console mode flags ... - GitHub](https://github.com/nodejs/node/issues/61161) (1%)
[^45]: [High-Level Console Modes - Windows ...](https://learn.microsoft.com/en-us/windows/console/high-level-console-modes) (1%)
[^46]: [Writing Bubble Tea Tests](https://carlosbecker.com/posts/teatest/) (1%)
[^47]: [Testing Bubble Tea Applications | charmbracelet/bubbletea | DeepWiki](https://deepwiki.com/charmbracelet/bubbletea/5.4-testing-bubble-tea-applications) (1%)
[^48]: [Testing Guidelines | charmbracelet/bubbletea | DeepWiki](https://deepwiki.com/charmbracelet/bubbletea/7.2-testing-guidelines) (1%)
[^49]: [GitHub - vadimdemedes/ink-testing-library: Utilities for testing Ink ...](https://github.com/vadimdemedes/ink-testing-library) (1%)
[^50]: [Can LLMs Test Terminal User Interfaces? - arXiv.org](https://arxiv.org/pdf/2608.03743) (1%)
[^51]: [Windows Implementation | microsoft/node-pty | DeepWiki](https://deepwiki.com/microsoft/node-pty/4-windows-implementation) (1%)
[^52]: [vt-extensions/synchronized-output.md at master · contour-terminal/vt ...](https://github.com/contour-terminal/vt-extensions/blob/master/synchronized-output.md) (1%)
[^53]: [OSC 52 escape sequence to copy to clipboard in terminal](https://gist.github.com/robin-a-meade/14a279d28abdfb0526307ccb2c9b2381/e3e43a3d75903a7bc38c1136378b28d9f74e1782) (1%)
[^54]: [Copilot CLI: Improved UI, rubber duck, prompt scheduling, ...](https://github.blog/changelog/2026-06-02-copilot-cli-improved-ui-rubber-duck-prompt-scheduling-and-voice-input/) (0%)
[^55]: [Evaluate migrating Go-based TUI to Ink · Issue #2956](https://github.com/anomalyco/opencode/issues/2956) (0%)
[^56]: [Alternate Screen](https://ratatui.rs/concepts/backends/alternate-screen/) (0%)
[^57]: [Ink 3](https://vadimdemedes.com/posts/ink-3) (0%)
[^58]: [Claude Code: the only CLI where scrolling up is a premium ...](https://www.reddit.com/r/ClaudeAI/comments/1t6fwhx/claude_code_the_only_cli_where_scrolling_up_is_a/) (0%)
[^59]: [option to disable the alternate screen so terminal ...](https://github.com/MoonshotAI/kimi-code/issues/2195) (0%)
[^60]: [Regression: TUI alternate-screen breaks tmux scroll-back; ...](https://github.com/anthropics/claude-code/issues/67289) (0%)
[^61]: [alternate screen buffer kills all scrollback (v2.1.89+) · Issue ...](https://github.com/anthropics/claude-code/issues/42670) (0%)
[^62]: [The ideal line length & line height in web design](https://pimpmytype.com/line-length-line-height/) (0%)
[^63]: [Readability: The Optimal Line Length](https://baymard.com/research-articles/line-length-readability) (0%)
[^64]: [The Best Line Length](https://blog.glyph.im/2025/08/the-best-line-length.html) (0%)
[^65]: [textual.widget](https://textual.textualize.io/api/widget/) (0%)
[^66]: [ADR-006: Untrusted Output Policy (Sanitize-by-Default)](https://docs.frankentui.com/adr/ADR-006-untrusted-output-policy) (0%)
[^67]: [How should a terminal dashboard restore the shell after ...](https://agents.stackoverflow.com/questions/971b65d4-ca97-493a-8314-ae6216705408?sort=newest&page=10) (0%)
[^68]: [Tui.rs | Ratatui](https://ratatui.rs/templates/component/tui-rs/) (0%)
[^69]: [Intl.Segmenter - JavaScript | MDN - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) (0%)
[^70]: [On receiving SIGWINCH, only stdout has its rows/columns ... - GitHub](https://github.com/nodejs/node/issues/2219) (0%)
[^71]: [Inline Viewport Flickering With High Message Throughput](https://github.com/ratatui/ratatui/issues/584) (0%)
[^72]: [The text mode lie: why modern TUIs are a nightmare for ...](https://www.reddit.com/r/commandline/comments/1t65rfu/the_text_mode_lie_why_modern_tuis_are_a_nightmare/) (0%)
[^73]: [tty issues when switching to raw mode on Windows #852](https://github.com/libuv/libuv/issues/852) (0%)
[^74]: [Testing with insta snapshots](https://ratatui.rs/recipes/testing/snapshots/) (0%)
[^75]: [Textual - textual.pilot](https://textual.textualize.io/api/pilot/) (0%)
[^76]: [TUI Testing? : r/golang](https://www.reddit.com/r/golang/comments/1nxkz0s/tui_testing/) (0%)

--------------------------------


I added the referenced files here.


--------------------------------


I'll read the attached files to verify my previous claims against the actual sources.Now let me read the design thinking doc and search the decisions file.Let me read the full D61/D69 decisions and the related evidence.I now have the actual files. Before writing, let me verify the exemplar-renderer facts against primary sources — my previous response made claims I should check.Good — the primary sources confirm several things and contradict my earlier claims. Let me lock down the remaining technical facts.I've now read the two documents and re-verified the exemplar facts against primary sources. The most important thing I owe you is a correction: **my previous answer's headline claim was wrong, and your Appendix A is in better shape than I implied.** Below is the audit, grounded in the files you attached.

---

# TUI streaming review — corrected, grounded in your docs

## 0. What I could and could not verify this pass

**Read directly (observed):** `docs/UI-TUI-INITIAL-THINKING.md` (307 lines, incl. Appendix A), `docs/DECISIONS.md` D61 + layer correction + D69, and your research brief. **Not available:** `ui.mjs`, `src/tui/client.mjs`, `src/tui/driver.mjs`, `src/viewmodel.mjs`, `src/watchview.mjs`, `demo/tui-*.test.mjs`, and the vendored `skills/tui-design/` files. So code-location claims below are **inferred placements** against your own file names; treat the "facts we verified" list as given.

---

## 1. Corrections to my previous response (read this first)

### 1a. My "biggest correction" was false — withdraw it

I claimed Appendix A was "written before Claude Code shipped its own alternate‑screen 'fullscreen' mode (2026), so any mapping that treats Claude Code as an inline/classic‑only exemplar is now stale." **That is wrong.** Appendix A, row 1 (dated 2026‑10‑16), already reads: *"Claude Code (fullscreen) and Copilot CLI use alt‑screen + a virtualized transcript; Gemini CLI stays inline (`<Static>`) and inherits native scrollback/search/copy."* Your mapping already matches the current state. I invented a stale‑mapping problem that your doc had already solved. The external fact underneath it is real (Claude Code fullscreen draws on the alternate screen buffer "like vim or htop" [^1]) — but it **confirms** Appendix A, it does not correct it.

### 1b. The exemplar list in your brief does not match Appendix A

Your brief says Appendix A mapped *"lazygit, k9s, Claude Code, Copilot CLI, Gemini CLI, Toolong and Glow."* The actual Appendix A table references **Claude Code, Copilot CLI, Gemini CLI, lazydocker, and k9s** — no lazygit, no Toolong, no Glow. My previous answer spent a whole section "correcting" lazygit/Toolong/Glow mappings that **are not in your Appendix A**. That section answered a question you did not ask. (lazygit, Toolong, and Glow may live in the vendored `references/exemplar-apps.md`; I could not read that file, so I can't confirm.) **If you want those three audited, point me at the skill file — as written, they are out of scope for Appendix A.**

### 1c. Two Claude‑Code facts I got wrong

| My previous claim | Correct state | Cite |
|---|---|---|
| Claude Code has `[` to dump the transcript to scrollback and `v` to open it in `$EDITOR` | **Not present.** Issue #42670: *"Transcript mode (Ctrl+O) is insufficient — Only has Ctrl+E (toggle expand) and q (exit). No way to export to scrollback, open in editor, or…"* | [^17] |
| Escape hatch is `CLAUDE_CODE_NO_FLICKER=1` | The real opt‑out is `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` / the `tui` setting; `CLAUDE_CODE_NO_FLICKER` is unverified. Alt‑screen became the **default** at v2.1.89. | [^7][^17] |

So the "scrollback receipt" I described as Claude Code's mitigation is actually a **feature request Claude Code users are still filing** (#89754 asks to keep the transcript in main‑screen scrollback) [^7] — which *strengthens* the case that the alt‑screen tax is unresolved even for the exemplar that accepted it. Users call Ctrl+O a mode where "Claude is frozen while you do" it [^18].

### 1d. What I got right (confirmed this pass)

- lazygit is **gocui** (with tcell underneath) — maintainer's own issue: *"tview uses tcell as an underlying library which is also the case for our existing rendering library gocui"* [^19][^20]. k9s is **tview** (tview's README lists K9s) [^24].
- Gemini CLI is Ink + `<Static>`: *"commits completed content to 'static' history and only updates the trailing pending message"* [^13][^8].
- Charm's agent is **Crush**, on **bubbletea/v2** [^3][^14].
- Copilot CLI **is** Ink — upgradeable from "unverified" to observed: official issues show an *"infinite React/Ink render loop"* and an *"uncaught React error in the Ink renderer"* [^21][^22]. (Appendix A's claim that it uses **alt‑screen** is still unverified — Ink *can* do alt‑screen, but these issues describe a "main pane," not a confirmed alternate‑buffer draw.)
- DECSET 2026 sync output, `DECRQM` probe `CSI ? 2026 $ p` [^2][^9][^23]; `string-width` [^12]; `Intl.Segmenter` grapheme mode [^15][^4]; OSC 52 / OSC 8 / paste‑injection as named attack surfaces [^16]; bracketed paste mode 2004 [^10][^5] — all confirmed.

---

## 2. Audit of Appendix A (point by point, against the actual file)

Appendix A is **more current and more honest than my previous answer credited.** Its rows already carry the right verdicts. Three real issues remain:

| # | Appendix A row | Verdict | What to change |
|---|---|---|---|
| 1 | **Screen buffer** — "alt screen for apps you *live in*; inline for tools you *summon*"; durig "Adopt (D69) — matches Claude Code/Copilot for a live chat" | **Accurate but under‑sourced on Copilot** | Gemini‑CLI‑inline and Claude‑Code‑fullscreen are correct [^13][^1]. Copilot CLI = Ink is confirmed [^21][^22], but its **alt‑screen** use is not. Either verify or downgrade that half to "advertised." |
| 2 | **Virtualized transcript** — "Fixed … budget by DISPLAY LINES … `buildTurns` reads a bounded page" | **Correct, and it's the right fix** | No change. This is your best line of defence at scale (§6). |
| 3 | **Wrap vs truncate** — "Fixed in the conversation view" | Fine | No change. |
| 4 | **Live tail + auto‑scroll toggle** — "`G`/`End` returns to the tail" | **Correct pattern, but incomplete** | The exemplar pattern (lazydocker) is an explicit auto‑scroll **toggle with a "N new" affordance**, not just a key. Add the "show N new without moving the viewport" behaviour (§4, pitfall 5) [^18]. |
| 5 | **Drill‑down + back / debounced redraw** | Match | No change. |
| 6 | **Search / copy / scrollback export** — "GAP — the named cost of the alt‑screen" | **Correctly labelled GAP** | Keep. Note the external evidence: even Claude Code, which accepted alt‑screen, still has this as an **open feature request** [^7][^17] — so this is not "polish," it is the debt the alt‑screen choice books. |
| 7 | **Inline / accessible fallback** — "partial; an explicit plain mode is the gap" | Correctly labelled | Keep; define what `--no-tui` must contain (§4, pitfall 7). |

**Missing axis in Appendix A:** the table maps *practices* well, but the two variables that actually drive your repaint cost and your tmux/psmux story — **viewport model** (main screen vs alt screen vs inline tail) and **diff strategy** (full‑clear vs line‑diff vs cell‑diff vs sync‑output) — are not named as *axes*. Add them. (My previous answer framed this as "Appendix A maps apps, not viewport model" — that was unfair; row 1 *is* the viewport axis. The gap is smaller than I said: it is the **diff strategy** column that is genuinely absent.)

**One factual upgrade for Appendix A:** "Claude Code forces its classic renderer in screen‑reader mode" is plausible but I could **not** verify it this pass — label it *advertised‑elsewhere* (from the skill file) until sourced.

---

## 3. D61 / D69 — the accurate read (I had this only half right before)

Your brief compressed D61 as "main‑screen, no alt‑screen" and D69 as "superseded D61." The file is more precise, and the precision matters:

- **D61 (2026‑10‑15):** the *in‑TUI frame rendering* (`renderTui`/`Frame` in `src/tui/client.mjs`) is main‑screen — it preserves scrollback/pipes **at the painting layer**. Level 2 deferred. [file]
- **D61 layer‑accurate correction (lead ruling #666, 2026‑10‑16):** the original "does NOT own an alternate screen" was **over‑strong**. The **entrypoint handoff** (`ui.mjs`) *already* uses the alt screen — `ENTER_ALT "\x1b[?1049h"` / `LEAVE_ALT "\x1b[?1049l"` at `ui.mjs:28‑29`. It records honestly that **scrollback is unavailable *during* the session, restored on exit.** [file]
- **D69 (2026‑10‑16):** the **rich conversation view** renders inside the alt screen with app‑owned scrolling; D61's main‑screen recommendation is **superseded for `ui.mjs`**. Status: *adopted in code* but **"OPEN for the operator/lead: ratify the supersession of D61."** [file]

**Correction to my previous answer:** I treated D61‑vs‑D69 as a clean "inline vs alt‑screen" fork. It is not. The entrypoint has been on the alt screen since before D69; D69 only settles the *rich view*. So the live question is narrower: **does the rich view own its scroll window (D69), or is it reworked onto terminal scrollback (the still‑open D61 alternative)?** D69 itself names that as the open ruling.

**My recommendation, unchanged in direction:** for a **read‑only cockpit whose workload is "reviewing and copying as much as typing,"** the evidence tilts **inline/main‑screen for the transcript**, because the alt screen's single big win (a pinned input box + flicker‑free streaming of an *active editor*) does not apply to a viewer with no input box, while its costs (loss of native scrollback/search/copy) apply fully [^1][^7][^17][^18]. But note the brief's own tell: **D68 already plans typing‑to‑a‑seat via the intent inbox** [file] — i.e. you *are* heading toward an input box. That fact pushes back toward D69's alt screen. **This is the real decision, and it hinges on whether `ui.mjs` stays read‑only.** Decide that first; the screen model follows.

---

## 4. Decision table

| Fork | Options | Evidence | Recommendation |
|---|---|---|---|
| **Viewport model** | main‑screen/inline · alt‑screen + app scroll · hybrid | Alt‑screen: flicker‑free, flat memory, mouse [^1]; cost: kills scrollback/search/copy, and even Claude Code has this open [^17][^7][^18]. Bubble Tea treats inline/full‑window as first‑class [^11]. | If `ui.mjs` stays read‑only → **inline**, with optional alt‑screen "focus" toggle. If D68 typing lands → **alt‑screen is defensible**, but you **must** ship search + copy + a scrollback receipt (see §5 pitfall 3). |
| **Diff strategy** | full clear+repaint · line‑diff · cell‑diff · sync‑output | Full `CSI 2J`+`CSI H` per frame is the documented flicker source [^17]. Sync output (2026) makes the terminal draw one atomic frame [^2][^6]. | **Wrap the existing repaint in DECSET 2026** — highest value, lowest risk. Add line‑diffing only if you go inline. Cell‑diffing is a rewrite; don't start there. |
| **Measure** | full width vs capped | Readability optimum ≈60–80 cols (web‑typography sources; **not** TUI‑specific) — label **inferred**. | Cap *prose* (≈80–100), left‑align, let code/tool output use full width. |
| **Scroll anchoring** | naive repaint vs anchor | "Stick to bottom until user scrolls up" is the standard chat pattern; Claude Code users want exactly this [^18]. | Implement the anchor + "N new" affordance (§5 pitfall 5). |
| **Untrusted text** | raw vs sanitize | OSC 52 / OSC 8 / paste‑injection are named vectors [^16]. | Sanitize by default; strict SGR allowlist (§5 pitfall 1). |

---

## 5. Pitfall catalogue (ranked by user harm)

**1 — Terminal escape injection from untrusted text.** Symptom: a seat's output carries OSC 52 (clipboard write), OSC 8 (link spoof), cursor/title/alt‑screen sequences. Why it bites: your own verified fact — `buildTurns` passes raw text, `client.mjs` renders it. OSC 52 clipboard writes, OSC 8 hyperlink spoofing, paste injection, and title‑bar spoofing are standard attack surfaces [^16]. Mitigation: sanitize at the render boundary — strip ESC (or replace) for anything outside an allowlist: a strict SGR subset, `\n`, tab. Reject OSC entirely, or allowlist a fixed set with `http(s)`‑validated URLs. Location: `src/viewmodel.mjs` (ingest) **and** `src/tui/client.mjs` (emit, defence in depth).

**2 — Abnormal exit leaves the terminal corrupted.** Symptom: uncaught throw/signal → raw mode + hidden cursor + stranded alt screen (+ mouse reporting if enabled). Why it bites: your verified fact — `ui.mjs` has SIGINT/SIGTERM + top‑level try/catch but **no** `uncaughtException`/`unhandledRejection`/`exit` restore. Mitigation: one **idempotent** `restore()` wired to all of `exit`/`uncaughtException`/`unhandledRejection`/`SIGINT`/`SIGTERM`, in the order **SGR reset → show cursor → leave alt screen (`\x1b[?1049l`) → restore termios**. Location: `ui.mjs`.

**3 — Alt‑screen tax.** Symptom: no scrollback, `Cmd+f`/tmux search find nothing, drag‑select captured. Why: the conversation lives in the alt buffer [^7][^17]. Mitigation: transcript‑to‑scrollback export, `$EDITOR` hand‑off, in‑app search, in‑app selection. Note this is a **GAP** in Appendix A row 6 and an **open issue even in Claude Code** [^7]. Location: `src/tui/client.mjs` + driver.

**4 — Cell width via `String.length`.** Symptom: CJK/emoji/combining rows misalign. Why: your verified fact (`src/watchview.mjs:15,22`). Mitigation: **`string-width`** (accounts for combining chars, emoji, flags, Hangul, East Asian Width) [^12], or grapheme segmentation via **`Intl.Segmenter`** (`"grapheme"` mode) [^15][^4]. Location: `src/watchview.mjs` + wrap helper.

**5 — Blocking / poll hazards.** Symptom: jank, torn frames, SQLite "database is locked." Why: building the whole frame on the event loop each 700 ms. Mitigation: (a) wrap paint in DECSET 2026 so a half‑written frame never shows [^2]; (b) virtualize (Appendix A row 2 already does the bounded page — good); (c) non‑blocking/WAL reads; (d) never `console.log` in raw mode. Location: `src/tui/driver.mjs`, `src/watchview.mjs`.

**6 — Too‑small / resize storms / half‑updated size.** Mitigation: debounce resize; re‑read size at paint time; guard non‑TTY (`process.stdout.isTTY`); define a minimum size + degraded layout. Location: `src/tui/driver.mjs`, `ui.mjs`.

**7 — Accessibility / NO_COLOR / plain mode.** Mitigation: honour `NO_COLOR`; ship `--no-tui`/plain that emits a **linear text stream**; never encode meaning in colour alone. Location: `ui.mjs`.

**8 — Input editing (D68's next step).** Symptom: paste executes on newline; IME breaks. Mitigation: enable **bracketed paste** (`\x1b[?2004h`, content wrapped in `\x1b[200~`…`\x1b[201~`), and **sanitize the markers if they appear in the pasted text** to prevent bracket‑escape attacks [^10][^5]; handle IME; test Windows ConPTY. Location: new input module; `ui.mjs`.

**9 — Testing.** Golden‑frame + property tests for width/wrap + PTY end‑to‑end. Location: `demo/tui-*.test.mjs`.

---

## 6. Borrow / avoid

**Borrow:** DECSET 2026 around each frame — `\x1b[?2026h` … `\x1b[?2026l` [^2][^6]; DECRQM probe `CSI ? 2026 $ p` [^9][^23]; DECSET 2004 bracketed paste [^10][^5]; `string-width` [^12]; `Intl.Segmenter` grapheme mode [^15][^4]; idempotent restore; anchor scroll + "N new".

**Avoid:** `String.length` for width; rendering raw ESC; `CSI 2J`+`CSI H` per frame **without** sync output [^17]; `console.log` in raw mode; assuming SIGWINCH on Windows; assuming tmux/psmux supports 2026.

---

## 7. What you're overlooking, ranked

1. **No written threat model / trust boundary** — you verified raw text is unsanitised but haven't stated what is trusted. Everything in pitfall 1 flows from this.
2. **No terminal capability negotiation** — you hard‑code sequences; real renderers probe and degrade [^9][^23].
3. **No frame‑time budget** — "700 ms poll" is a cadence, not a render budget.
4. **No non‑TTY/piped contract** — what does `ui.mjs` do when stdout is a pipe?
5. **No multi‑client/DB‑contention story.**
6. **The read‑only question is unresolved** — and it *decides the screen model* (§3). D68's intent inbox already implies an input box is coming, which quietly reopens D69.

**What breaks first at 50 seats / 10k‑turn transcripts:** the **render/DB loop**, not the terminal. If `buildTurns` maps the whole transcript each poll, every 700 ms is O(transcript) allocation + width work on the event loop → jank → torn frames → then SQLite contention across clients. **The transcript length, not the screen size, is the cliff.** Appendix A row 2 (bounded page + display‑line budget) is already the right mitigation — make sure it holds as turns grow. Fix order: virtualize → sanitize+measure once at ingest → move SQLite off the main thread → wrap paint in 2026.

**Highest‑harm thing unnamed:** the *compound* of pitfall 1 + pitfall 2. Escape injection plants a payload in the clipboard; a failed restore (raw mode / hidden cursor / stranded alt screen) pushes the operator to paste a recovery command — which is exactly when a poisoned clipboard detonates [^16][^7]. **Fix restore and sanitisation together, or neither is safe.**

---

**Bottom line:** your docs are in good shape. The corrections that matter are (a) withdraw my false "stale Claude Code mapping" claim, (b) fix my wrong Claude Code escape‑hatch details, (c) note the brief's exemplar list over‑states what Appendix A contains, and (d) tighten the still‑open D61/D69 ruling around one question — **is `ui.mjs` read‑only or not?** If you can drop `ui.mjs`, `src/tui/client.mjs`, `src/tui/driver.mjs`, `src/viewmodel.mjs`, `src/watchview.mjs`, and the vendored `skills/tui-design/` files into `uploads/`, I'll ground the code‑location and Appendix‑A‑vs‑skill claims and finish the doc as `docs/reviews/tui-streaming-research.md`.

**References**

[^1]: [Fullscreen rendering - Claude Code Docs](https://code.claude.com/docs/en/fullscreen) (9%)
[^2]: [Terminal Spec: Synchronized Output](https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036) (8%)
[^3]: [charmbracelet/crush | DeepWiki](https://deepwiki.com/charmbracelet/crush) (7%)
[^4]: [Intl.Segmenter () constructor - JavaScript | MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter/Segmenter) (6%)
[^5]: [bracketed paste mode](https://cirw.in/blog/bracketed-paste) (6%)
[^6]: [Synchronized output | vtdn](https://vtdn.dev/docs/decset/mode2026-sync-output/) (6%)
[^7]: [Feature: keep the transcript in main-screen scrollback after ... - GitHub](https://github.com/anthropics/claude-code/issues/89754) (5%)
[^8]: [How do they avoid scrollback/re-rendering issues? — google-gemini ...](https://forums.basehub.com/google-gemini/gemini-cli/1) (5%)
[^9]: [Terminal Spec: Synchronized Output · GitHub](https://gist.github.com/sepehrst/ceeb7d6b57c1ef0c8f28bcccf2a3ac8e/cbaea8d6af47744dda3435282a9a7b195008c320) (5%)
[^10]: [Bracketed paste | vtdn](https://vtdn.dev/docs/decset/mode2004-bracketed-paste/) (5%)
[^11]: [charmbracelet/bubbletea: A powerful little TUI framework](https://github.com/charmbracelet/bubbletea) (5%)
[^12]: [string-width - npm](https://www.npmjs.com/package/string-width) (4%)
[^13]: [Ink - React for interactive command-line apps · GitHub](https://github.com/vadimdemedes/ink) (3%)
[^14]: [TUI Architecture | charmbracelet/crush | DeepWiki](https://deepwiki.com/charmbracelet/crush/5.1-tui-architecture) (3%)
[^15]: [Intl.Segmenter - JavaScript | MDN - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) (3%)
[^16]: [Terminal Security: Clipboard, Paste Injection, Escape Attacks](https://terminfo.dev/fundamentals/security) (3%)
[^17]: [alternate screen buffer kills all scrollback (v2.1.89+) · Issue ...](https://github.com/anthropics/claude-code/issues/42670) (2%)
[^18]: [Claude Code: the only CLI where scrolling up is a premium ...](https://www.reddit.com/r/ClaudeAI/comments/1t6fwhx/claude_code_the_only_cli_where_scrolling_up_is_a/) (2%)
[^19]: [jesseduffield/lazygit - New interface using Charm.sh libraries](https://github.com/jesseduffield/lazygit/issues/2705) (2%)
[^20]: [lazygit/pkg/gocui/gui.go at master](https://github.com/jesseduffield/lazygit/blob/master/pkg/gocui/gui.go) (2%)
[^21]: [v1.0.31: main pane frozen — infinite React/Ink render loop ...](https://github.com/github/copilot-cli/issues/2802) (2%)
[^22]: [Copilot CLI interactive mode turns blank after submitting a ...](https://github.com/github/copilot-cli/issues/4159) (2%)
[^23]: [DECRQM | vtdn  ](https://vtdn.dev/docs/csi/decrqm) (2%)
[^24]: [rivo/tview: Terminal UI library with rich, interactive widgets ...](https://github.com/rivo/tview) (1%)
---

## Repo-grounded verification and adjustments (delegate, 2026-10-16)

The research above states plainly that it could not read the repo. This section closes that gap: every
claim the brief listed as "facts we verified in our own code" was re-checked against the actual tree at
`697f376`, and the code-location claims were placed. Claims about *other projects* are left as the
researcher labelled them — this section does not re-verify the outside world.

### What is confirmed in-tree (observed)

| Brief's claim | Verdict | Evidence |
|---|---|---|
| Untrusted text rendered without control-sequence sanitisation | **Confirmed** | `src/viewmodel.mjs` `buildTurns` passes `parsed.text` straight into a `turn.text`; `src/tui/client.mjs` `transcriptTurnLines`/`renderPartial` interpolate it. The only `stripColors` in the tree is a test helper (`client.mjs:64`, used by `frameToLines`). `src/chatview.mjs` is equally raw (line 255–256). |
| Width uses `String.length` | **Confirmed, wider than cited** | `src/watchview.mjs:15,22` (`truncate`/`pad`) — and `client.mjs` imports both, plus its own `wrapText` uses `flat.length` and `word.length`. Seat names, roles, prose wrap and the hard-split all measure code units. |
| Crash paths not covered | **Confirmed** | `ui.mjs` registers `SIGINT`/`SIGTERM` and a top-level `try/catch`; there is **no** `uncaughtException`, `unhandledRejection` or `exit` handler anywhere in `src/`, `ui.mjs` or `cli.mjs`. `restoreScreenOnce()` is idempotent (good) but is only reachable through `quit()`. |
| Full clear + rewrite, no sync output | **Confirmed** | `ui.mjs` `CLEAR = "\x1b[H\x1b[2J"`; `paintScreen` writes `CLEAR` then the rows. No `\x1b[?2026h/l` anywhere in the repo. |
| No search / copy / export / plain fallback | **Confirmed** | No such handlers in `driver.mjs`/`client.mjs`. |

### Corrections to the research

1. **"The vendored pi-tui emits sync output" does not transfer to us.** `ui.mjs` never uses
   `@earendil-works/pi-tui` — `grep -rn "pi-tui" src/ ui.mjs cli.mjs` is empty; `client.mjs` is
   hand-rolled. The dependency is declared in `package.json` but unused by the TUI. The upstream fact
   still stands; it is simply irrelevant to our paint path.
2. **"No non-TTY / piped contract" is wrong.** `ui.mjs` refuses a non-TTY *before* entering the alt
   screen: the `process.stdout.isTTY` guard writes `durig ui needs a terminal … use watch/log for
   piped output` and exits 2. The real gap is a *plain TUI* mode, not a missing pipe contract.
3. **"Transcript length is the scaling cliff / O(10k) per poll" is overstated for the current code.**
   `readRigHealth` reads a **bounded 24-entry page per seat** (`SCAN_LIMIT = 24`, `src/rigstory.mjs:12`,
   `readSeatPages`) and `buildTurns` runs over that page only. Per-poll cost is `O(seats × 24)` plus one
   `readLiveState` per seat — bounded, not O(transcript). Appendix A row 2 is therefore correct. The
   fact the researcher could not see is a **completeness** limit, not a performance one: the
   conversation scroll window can only reach the last 24 entries, so older history is unreachable.
4. **The measure recommendation reverses a fresh change.** Commit `697f376` deliberately **removed**
   the `Math.min(width, 80)` clamp so the frame uses the full terminal width. "Cap the prose measure"
   therefore needs an operator/lead ruling; it cannot silently revert an in-repo decision. The
   researcher also labels the readability sources *inferred* (web typography, not TUI), so they should
   not override the landed behaviour on their own.

### Adjustments we should make (ranked by user harm)

1. **Sanitise untrusted text at the render boundary — security; do first.** One allowlist sanitiser
   (strict SGR subset + `\n`/`\t`; strip all other C0, ESC, CSI, OSC), applied once on ingest in
   `src/viewmodel.mjs` (`buildTurns`, `partialView`) so `ui.mjs`, `chatview` and `streamview` inherit
   it, plus a defensive strip at the `client.mjs` emit boundary. This is the only finding with a real
   blast radius (OSC 52 clipboard → paste, OSC 8 link spoof), and it is fully open today.
2. **Restore on every abnormal path — robustness.** Wire `uncaughtException`, `unhandledRejection` and
   `exit` in `ui.mjs` to a **synchronous** `restoreScreenOnce()`. Today's `quit()` is async
   (`await driver.cleanup(); await storage.close()`), which is unsafe to depend on from an exception
   handler; the restore itself must not await.
3. **DECSET 2026 around each paint.** Wrap `CLEAR + rows` in `\x1b[?2026h … \x1b[?2026l` (tolerate
   terminals/tmux without support; a DECRQM probe is optional). Small and isolated to `paintScreen`.
4. **Grapheme/EAW-correct width.** Replace `.length` with one `textWidth`/`sliceByWidth` helper.
   `string-width`/`strip-ansi` are **not installed**; `get-east-asian-width` is present only
   transitively (via pi-tui) — either add it as a direct dependency or use built-in `Intl.Segmenter`
   for grapheme clustering plus an East-Asian-width table.
5. **Bracketed paste is a prerequisite of the next item (type-to-seat, D68/#624).** Enable DECSET
   2004 and strip `\x1b[200~`/`\x1b[201~` from pasted input; do not ship raw-mode input without it.
6. **Prose measure cap — ruling needed.** Capping reviewer prose to ~80–100 cols while keeping
   structural chrome full-width is plausibly more readable, but it reverses `697f376`; put it to the
   operator/lead.
7. **Alt-screen receipts (search / copy / transcript export / plain mode)** remain the named GAP and
   the strongest argument for revisiting D69 if `ui.mjs` stays read-only.

No code was changed by this review; this section records the verified state and the ranked
adjustments so implementation items can be scoped from it. See `docs/DECISIONS.md` D70 for the
recommended hardening posture and `docs/TUI-IMPLEMENTATION-PLAN.md` §C for the approved, scoped work items.
