# tui-design skill (vendored, durig-adapted)

This directory vendors part of **`gfargo/tui-design-skill`** so durig's design and build seats can
consult a single, version-controlled TUI design reference instead of reconstructing it.

## Provenance

- **Upstream:** https://github.com/gfargo/tui-design-skill
- **Commit vendored:** `ebe79717a09a124dfa95ca76539ae2ec39071cf7` (depth-1 clone, 2026-10-13)
- **License:** MIT (`./LICENSE`). The upstream copyright notice is preserved.
- **Used by:** the `impl`, `designer`, `advocate`, `qa`, and `auditor` seats, whose instruction text
  carries a `## Skill: TUI design (durig-adapted)` block pointing here.

## What is included, and what was left out

Included (the parts that apply to a terminal application regardless of framework):

- `SKILL.md` — the upstream workflow, routing table, cross-cutting contracts, the two review
  reflexes, the build/verification discipline, and the review order.
- `references/visual-patterns.md` — layouts, borders, colour tiers, density, the clutter audit,
  responsive breakpoints and the floor, tables.
- `references/interaction-patterns.md` — keybindings, focus, modes, forms, mouse, confirmation,
  terminal modes and protocols.
- `references/exemplar-apps.md` — case studies of lazygit, k9s, fzf, btop, helix, yazi, atuin, etc.

Deliberately omitted, with the reason:

- `references/ecosystem-go.md`, `ecosystem-rust.md`, `ecosystem-python.md` — durig is Node/JavaScript;
  these document frameworks durig does not use.
- `references/ecosystem-typescript.md` — this documents **Ink**, not pi-tui. Vendoring it would
  invite a seat to write Ink idioms into a pi-tui codebase. durig's framework reference is
  `@earendil-works/pi-tui` itself (see `skills/durig/SKILL.md` and the pi-tui `docs/tui.md`).
- `references/cli-basics.md` — durig's CLI is non-interactive, one JSON document per command
  (D21); the skill's CLI section assumes interactive command-line tools. The `ui` verb's
  non-interactive fallback is the existing `log`/`watch`/JSON surface, which already satisfies the
  skill's plain-mode contract.

## Adaptation notes (read before applying the skill here)

1. **Framework is pi-tui, not Ink.** The lifecycle contracts ("use the framework's own cleanup",
   "restore raw mode on every exit path") map to `@earendil-works/pi-tui`'s `TuiMainScreen` /
   `TuiAltScreen` and `Component.invalidate`. Components are tested headlessly: `render(width)`
   returns lines and needs no terminal, which is the skill's "golden-test rendered frames at pinned
   sizes" layer.
2. **Screen model is a durig decision, not the skill's default.** Upstream defaults a full-screen
   session to the alternate screen. durig found alt-screen + tmux the worst-supported combination
   (`docs/RESEARCH.md`, §"Formatting a transcript"; D21) and chose main-screen + scrollback. `lead`
   rules on `TuiMainScreen` vs `TuiAltScreen` before design commits. The skill's lifecycle, redraw,
   width, and responsive-floor contracts apply under either choice.
3. **Do not re-litigate settled durig decisions.** The skill is guidance for the terminal UI; it does
   not override D11 (readers never open a harness), D21 (the CLI stays non-interactive), or D40 (the
   in-flight partial is never a committed turn).

## Updating this copy

Re-vendor by cloning upstream at a reviewed commit and copying the same file set, then update the
commit hash above. Do not edit the upstream files in place; put durig-specific guidance in this
README and in the seat instruction blocks.
