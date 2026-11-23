# Research request — the WINDOWS half of the terminal-multiplexer seam (psmux / herdr / zellij / GNU screen / tmux)

**Ask:** hand this to the operator's research agent. Report to `docs/reviews/windows-multiplexer-vocabulary-research.md`.

This prompt is the follow-up to `docs/reviews/windows-multiplexer-vocabulary-research-prompt.md` round 1
(no round 1 report exists yet — this IS round 1). Nothing here has been answered in the tree
(measured 2026-11-22: `grep -rl psmux tools/ demo/ docs/runbooks/` answers nothing; the word does not
appear anywhere in the seam).

## Context

durian-pi is a durable, multi-seat agent rig on pi-durable. A **single-writer broker** owns one store
(one conversation per seat); **seats** are LLM personas; a **delegate** acts for the human operator. On
top of that base sits an **extension-plane** presentation seam — `tools/mux-surface-core.mjs` (backend-
agnostic: it names ZERO backend words, measured `grep -c -E 'tmux|screen|zellij|herdr' tools/mux-surface-
core.mjs` → 0) plus a discovered driver registry `tools/mux-driver-{tmux,screen,zellij,herdr}.mjs`, one
file per backend, each spelling that backend's own argv as DATA. The core decides verbs, selectors,
panes, ownership, acts and NAMESPACES; a driver only names things. A backend swap is a registration in
that table, not a rewrite.

The product rule the seam must hold on EVERY operating system:

- The rig's session lives in ONE resident detached owner (`cli.mjs serve`, `src/broker.mjs`). A multiplexer
  pane is an **attached client** of one seat, routed through the broker's existing spool ops — never a
  second writer into the seat, never a second `Harness.open`.
- **Namespace by default**: the plugin's panes live in the multiplexer's OWN named session derived from
  the store (`durian-<workspace>`); the user's own session — which may hold other LLM harnesses — is
  reported present-but-not-touched and is never enumerated, captured, or killed by default.
- Closing a pane/terminal never ends the session (the multiplexer's own detach semantics).
- Which session may be touched is the **core's** decision; a driver names it.

Two audiences read the result: the human operator (on a Windows desktop — Windows 11, Windows Terminal,
PowerShell 5 or pwsh, `cmd.exe`) and an LLM seat that executes a documented procedure. The completion
auditor of this milestone objected that **the Windows half of the criterion is thin**: the seam names only
the `;`-PATH separator (`tools/mux-surface-owner.mjs`) and never names a Windows-native route for any of
its four backends, and there is **no per-backend Windows refusal**. This request exists to close that with
outside evidence.

Two rig constraints the agent must respect when answering (they change the answer set):

- **Native host OS only** (D131). Linux and Windows are BOTH operating platforms for this rig; the rig
  runs natively wherever it lives. **`wsl`, `docker`, `cygwin`, `msys2`, `Git Bash` emulation are NOT
  acceptable routes** for this product — a Windows verdict that requires any of them is a refusal, not a
  workaround, and must be named as such.
- **Customization lives on the extension plane, never in the base** (D212). The agent may not propose
  patching tmux, GNU screen, zellij or herdr sources; it may only report what a binary does, and the seam
  adapts.

## Questions

Numbered, each answerable, each mapped to a decision this seam must make.

1. **Which of the four backends has a NATIVE Windows build at all** (no WSL / Cygwin / MSYS2 / Docker),
   and what is its official install route (name the artifact: `.exe`, `.msi`, `winget`, `cargo install`,
   installer URL)? Answer per backend: tmux, GNU screen, zellij, herdr. Where the honest answer is
   "there is no native Windows build", say so AND name the closest Windows-native alternative the same
   command language reaches (e.g. is `psmux` the drop-in for tmux's command language on Windows?) with its
   own install route. State explicitly whether an alias binary named `tmux` is shipped by that alternative
   (a seam that looks for a bare `tmux` on PATH would otherwise read as absent).
2. **Pane identity on Windows.** This seam must answer "which pane holds which seat" from a census, and it
   must survive a client detach. For each backend, what is the LEAST-BRITTLE way to bind a pane to the
   thing the seam started, on Windows specifically? For psmux/tmux cover: `#{pane_current_command}`
   semantics under ConPTY, `#{pane_start_command}`, `#{pane_id}`/`%N`/`@N`/`$N` stability,
   `#{pane_dead}`, `#{pane_pid}`, `#{pane_title}` and the `allow-set-title` option, `automatic-rename`
   and `-n NAME`. For zellij: how pane ids are learned and whether a window `--name` is addressable on
   Windows. For herdr: how it detects the agent in a pane on Windows (its own docs describe a
   descendants-of-the-pane-shell scan) and whether that is the seam's business at all.
3. **Namespace vocabulary on Windows.** psmux documents `-L <name>` server namespaces and a scoped
   `kill-server`. Establish: what a namespace IS on Windows (a separate socket? a separate data dir? a
   separate process tree?), whether a bare `kill-server` or `kill-session` can reach a DIFFERENT
   namespace, and whether the seam's rule — "a session-scoped teardown may name only a session carrying
   the plugin's tag; `kill-server` is refused by name" — is enforceable there. Do the same for herdr
   (`HERDR_SESSION`/`--session <name>`) and zellij on Windows.
4. **Windows path/name/quoting deviations that break a census parse.** psmux documents deviations from
   tmux in this area (backslashes in names, control-character sanitisation, `-F` format output, a bare
   `;`/`\;` as a command separator, `--` as end-of-options, a multi-token command after `--` executed as
   an argv). Establish, per backend: how a session/window/pane NAME containing `\` survives set-and-
   re-census on Windows; how a tab/newline in a `-F`/format line is delimited; whether stdout is UTF-8 and
   what the host's console codepage does to it; and whether a multi-token pane command
   (`node <abs>/mux-pane-client.mjs --db <store> --select <seat> --pane <name>`) can be emitted so that it
   runs WITHOUT a shell rewriting the quoting, in PowerShell 5, pwsh 7, and `cmd.exe`.
5. **Detach semantics on Windows.** Does closing the outer terminal / logging out over Windows OpenSSH /
   closing Windows Terminal keep a session running, per backend? Name what DESTROYS it (a pane whose
   command exited; a process-tree teardown sweep; SmartScreen; an elevated server needing an
   administrator client) and what options change that (e.g. `remain-on-exit`, psmux's `@kill-descendants`,
   herdr's `allow_unelevated_clients`).
6. **Capture on Windows.** Can the seam read a pane's text non-TTY and without attaching a client —
   `capture-pane -p` per backend, zellij's capture/dump route, herdr's pane screen history — and what does
   it NOT show (cursor-only TUIs, colour, the client's own viewport)? Is there any backend for which the
   ONLY route is an interactive client (which the seam must then refuse on Windows, because a client
   would be a second writer)?
7. **ITERATION ARCHITECTURE (D213 — required; without these the prompt is not routable).** For psmux,
   herdr and zellij as competing products: (a) what is the cheapest programmatic, NON-TTY plane they offer
   for "ask one action, read evidence" — argv-per-action vs psmux control mode (`-C`/`-CC`) vs a library
   (libtmux against psmux) — and its measured/advertised cost per call; (b) how does each project test its
   own panes in CI — is there a **hermetic** (no real terminal, no TTY, mocked) test plane, or only live
   terminal sessions; (c) how is a config/prompt change regression-tested (`source-file` + a diff of
   `show-options`/`dump-state`? snapshot? nothing?); (d) what bounds a long-running pane process and how
   are slow tests quarantined; (e) what is the observable cost of a census (one spawn vs many) on Windows.
   We need this because the seam's fast loop is per-piece: our tmux loop runs a self-built binary against
   real argv in ~13 s. We need to know what the equivalent Windows loop is, and whether one exists at all.
8. **Concrete recommendation.** Given 1–7, which backend should this seam treat as the WINDOWS default,
   what per-backend Windows REFUSAL text should it print (BY NAME, with the exact argv it did not emit),
   and does the seam need a per-driver `platform` table (an OS-keyed binary-name/route fact) rather than
   one argv table? Name the ROADMAP items to register.

## Deliverable

`docs/reviews/windows-multiplexer-vocabulary-research.md`, sections in this order, **each section as ONE
fenced code block with no narration glued to the heading** (what arrives in chat is what gets committed
verbatim; a prior report arrived with the agent's own narration fused into the title line):

1. `## Verdict per backend` — one table row per backend: native-Windows status, install route, the binary
   name the seam should look for on PATH, evidence class.
2. `## Pane identity recipe` — the binding rule per backend, with the deviation called out.
3. `## Namespace and teardown scoping` — per backend, what a namespace is and what a teardown reaches.
4. `## Path / name / quoting deviations` — per backend, each deviation and what a census parse must do.
5. `## Detach and death` — what keeps a session, what kills it, per backend.
6. `## Non-TTY capture` — per backend, and what capture cannot witness.
7. `## Iteration architecture` — the D213 answers (loop cost, hermetic vs live planes, regression
   testing of config changes, bounds, quarantine), each with a cost in seconds.
8. `## Recommendation for the seam` — the Windows default, the refusal texts, whether a per-driver
   `platform` table is needed, and the ROADMAP items to register.
9. `## Open questions` — what could not be established.

**Evidence discipline (non-negotiable):** every external claim carries a **verbatim quote of ≤ 40 words +
the URL + the agent's own fetch date**; state the evidence class as `advertised-elsewhere` or `observed`
(the agent has no Windows host on this rig's box, so almost everything will be
`advertised-elsewhere`; a claim is `observed` only if the agent itself ran the binary). A line range into
a page may accompany a quote but is NOT portable and never replaces one. Every finding maps to a
mechanism in this seam (`muxPaneArgv`, `muxPlan`, `muxNamespace`, `muxProbeBackends`, the driver `platform`
idea) or is named **unverified**. Do not answer "tmux-like tools generally do X" — name the backend.

## Evidence the delegate already fetched (confirm or refute each line against a freshly fetched copy)

Fetched by the delegate on **2026-11-22** (Linux host; the pages are upstream, not host-specific). Re-fetch
and confirm/refute — do not re-derive from memory.

1. psmux README, `https://raw.githubusercontent.com/psmux/psmux/master/README.md`:
   > "psmux is a **native Windows terminal multiplexer** built from the ground up in Rust. It uses Windows
   > ConPTY directly, speaks the tmux command language, reads your `.tmux.conf`, and supports tmux themes.
   > All without WSL, Cygwin, or MSYS2."
2. psmux compatibility, `https://raw.githubusercontent.com/psmux/psmux/master/docs/compatibility.md` — the
   overview row: > "Server namespaces | ✅ `-L` for isolated instances"
3. Same page, `pane_current_command` on Windows: > "psmux therefore reports the **executable of the pane's
   immediate child**, which is stable and cheap but is not a service identity (#647)."
4. Same page, the identity recipe: > "To identify a service, combine a controller chosen window or pane
   > name addressed by stable id, `#{pane_start_command}`, pane liveness (`#{pane_dead}` and `#{pane_pid}`),
   > and a health check outside psmux such as a port probe."
5. Same page, backslash deviation: > "One deliberate deviation: a backslash is never doubled. tmux stores
   > `C:\src` as `C:\\src`, which on Windows would corrupt every path shaped window name."
6. Same page, `kill-server` scoping: > "a bare `kill-server` ends the default namespace and leaves every
   > `-L` namespace running, and `-L <name> kill-server` ends that one namespace only."
7. Same page, direct argv: > "`new-window`, `split-window` and `new-session` treat a multi token command
   > after `--` as an argv and execute it directly, exactly like tmux's `execvp` (#582)."
8. zellij installation, `https://zellij.dev/documentation/installation.html`: > "The zip
   > (`zellij-x86_64-pc-windows-msvc.zip`) holds `zellij.exe` and `zellij-terminal.exe`."
9. herdr Windows page, `https://herdr.dev/docs/windows-beta/` (canonical: `https://herdr.dev/tui/docs/windows-beta/`):
   > "Native Windows support is generally available." — plus "Not supported on Windows | Direct terminal
   > attach (`herdr terminal attach`) | unsupported" and "Unix foreground process groups | unsupported".
10. tmux upstream install wiki, `https://github.com/tmux/tmux/wiki/Installing` — the observed ABSENCE: the
    package/build tables list Arch/Debian/Fedora/RHEL/macOS/openSUSE and source builds only; **no Windows
    row**. (Absence in a fetched copy is weaker than a quote that says "no Windows build"; if an upstream
    statement of that exists, cite it instead.)

## Constraints

- Written report only; **do not modify code, do not commit, do not create repo paths** — the research agent
  is off-box and has no write access to this repository. Ask it for content to copy, never for artifacts.
- Do not recommend WSL / Cygwin / MSYS2 / Docker / Git Bash as a route; where those are the only route,
  the answer is a NAMED REFUSAL under D131.
- The seam's baseline is `tools/mux-surface-core.mjs`, `tools/mux-driver-{tmux,screen,zellij,herdr}.mjs`,
  `tools/mux-surface-owner.mjs`, `tools/mux-pane-client.mjs`, `docs/runbooks/pi-inside-tmux.md`.
- Do not propose changing the base (`pi-durable`, `pi-coding-agent`, `vendor/pi-main`); the seam is an
  extension and adaptation must happen in a driver.
