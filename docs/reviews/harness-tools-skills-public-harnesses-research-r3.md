The research agent results are as follows:

```markdown
TASK A — REPAIR OF ROUND 2'S EVIDENCE CHAIN
Fetched 2026-10-28. Nothing was saved, committed, or cloned from this host; every
artefact below is text for you to land. Codex, Cline and Goose source were NOT read —
delegate reads at the pins.

=====================================================================
A1. The three Goose 404s
=====================================================================

Root cause: goose left block.github.io. The docs now serve from goose-docs.ai and the
project has moved to the Agentic AI Foundation. Quote, class `advertised-elsewhere`:

  "goose has moved to the Agentic AI Foundation (AAIF)"
  — https://goose-docs.ai/docs/getting-started/using-extensions/ , fetched 2026-10-28
    (line 3)

| # | Round-2 URL (404) | Resolvable URL now | Class | Fetched | Lines |
|---|---|---|---|---|---|
| 1 | block.github.io/goose/docs/getting-started/using-extensions | https://goose-docs.ai/docs/getting-started/using-extensions/ | advertised-elsewhere | 2026-10-28 | 694 |
| 2 | block.github.io/goose/docs/goose-architecture/extensions-design | (no live page found) → cite repo at pin: vendor/eval/goose · 775b3958 · documentation/docs/goose-architecture/extensions-design.md | unverified — I did not read it | — | — |
| 3 | block.github.io/goose/docs/guides/recipes/recipe-reference | https://goose-docs.ai/docs/guides/recipes/recipe-reference/ | advertised-elsewhere | 2026-10-28 | 975 |

On (2): the path is attested by a fork mirror of the same tree, which is evidence the
file exists, not evidence of its contents. Quote, class `unverified` (mirror, not the
pinned tree):

  "This document describes the design and implementation of the Extensions framework in goose"
  — https://github.com/SprBull/block-goose-opensource/blob/main/documentation/docs/goose-architecture/extensions-design.md ,
    fetched 2026-10-28

Everything round 2 attributed to the design page — `Extension::instructions()` sitting
beside `tools()` — is therefore still `unverified` until the delegate reads
documentation/docs/goose-architecture/extensions-design.md at 775b3958. Do not carry
that row forward as advertised.

Also worth knowing: the recipe page names the canonical repo owner as `aaif-goose`,
not `block`, in its own validation-rules link ("`validate_recipe.rs`",
https://goose-docs.ai/docs/guides/recipes/recipe-reference/ line 747). If vendor/eval/goose
is pinned under `block/goose`, the pin may be to a stale remote.

=====================================================================
A2. Portable citation set — the load-bearing claims
=====================================================================
Format: claim | class | URL | fetched | verbatim quote (≤40 words) | line

--- CLAUDE CODE ---------------------------------------------------
Page: https://code.claude.com/docs/en/hooks , fetched 2026-10-28, 3,798 lines

C1. A project hook file, and it is committable.
  advertised-elsewhere | line 249
  QUOTE: "`.claude/settings.json` | Single project | Yes, can be committed to the repo"

C2. The guard is fail-open unless you say otherwise.
  advertised-elsewhere | lines 810-811
  QUOTE: "On most events, when a hook fails or times out, Claude Code still carries out
  the action. A policy hook with a wrong path or a crashing script then lets everything
  through."

C3. Fail-closed is opt-in, and gated on a version.
  advertised-elsewhere | line 810
  QUOTE: "To block the action instead, set `\"onFailure\": \"block\"` on a `command` or
  `http` hook. Requires Claude Code v2.1.295 or later."

C4. A deny path exists.
  advertised-elsewhere | line 96
  QUOTE: "extracts the command, and returns a `permissionDecision` of `\"deny\"` if it
  contains `rm -rf`"

C5. The matcher is not the gate. (This is the sentence that kills "hook = enforcement".)
  advertised-elsewhere | line 405
  QUOTE: "Because the `if` filter is best-effort, use the permission system rather than a
  hook to enforce a hard allow or deny."

C6. Injection budget, explicit, with no override.
  advertised-elsewhere | line 942
  QUOTE: "A hook's `additionalContext`, `systemMessage`, and `initialUserMessage` strings,
  and its plain stdout, are capped at 10,000 characters"

C7. A user-typed skill bypasses PreToolUse.
  advertised-elsewhere | line 1380
  QUOTE: "a `PreToolUse` hook matching the `Skill` tool fires only when Claude calls the
  tool, but typing `/skillname` directly bypasses `PreToolUse`"

C8. Skill frontmatter hooks persist for the session, and survive the trust gate in -p.
  advertised-elsewhere | lines 611, 628
  QUOTE: "Claude Code registers them when you or Claude invoke the skill and keeps running
  them for the rest of the session"
  QUOTE: "including in a `-p` run in a folder you haven't trusted."

C9. Capability reload from a directory is a first-class, documented operation.
  advertised-elsewhere | lines 1168, 1186
  QUOTE: "When `true`, Claude Code re-scans the skill and command directories after the
  SessionStart hooks complete."

C10. Hook registration has a hard ceiling, and it is per source.
  advertised-elsewhere | line 637
  QUOTE: "The skills from one source can register at most 1,024 hooks. Those hooks'
  matchers can total at most 16,384 characters."

C11. MCP tool naming.
  advertised-elsewhere | line 326
  QUOTE: "MCP tools follow the naming pattern `mcp__<server>__<tool>`"

C12. Where a reviewer reads the decision.
  advertised-elsewhere | line 648
  QUOTE: "Type `/hooks` in Claude Code to open a read-only browser for your configured
  hooks. The list labels each hook with where it comes from"

--- OPENAI CODEX CLI ----------------------------------------------
Page: https://learn.chatgpt.com/docs/hooks , fetched 2026-10-28, 1,256 lines
NOTE: this is the page that answers round 2's open question "what is the deny verb, exit
code and fail-open behaviour." It is answered, and the answer is not simply fail-open.

C13. Trust is persisted out of band and keyed to the hook's content.
  advertised-elsewhere | lines 134-137
  QUOTE: "Codex records trust against the hook's current hash, so new or changed hooks
  are marked for review and skipped until trusted."

C14. The trust gate is the load-bearing one for a `git pull`.
  advertised-elsewhere | line 128
  QUOTE: "Project-local hooks load only when the project `.codex/` layer is trusted."

C15. Review and trust is a required step, not a nag.
  advertised-elsewhere | line 89
  QUOTE: "Non-managed hooks must be reviewed and trusted before they run."

C16. There is a documented escape hatch that voids C13-C15.
  advertised-elsewhere | line 147
  QUOTE: "pass `--dangerously-bypass-hook-trust` to run enabled hooks without requiring
  persisted hook trust for that invocation"

C17. The deny verb.
  advertised-elsewhere | lines 873-899
  QUOTE: "permissionDecision": "deny", "permissionDecisionReason": "Destructive command
  blocked by hook."
  QUOTE: "You can also use exit code `2` and write the blocking reason to `stderr`."

C18. Managed/non-local path fails *without* blocking.
  advertised-elsewhere | line 412
  QUOTE: "an explicit supported denial can block an action, but a `PreToolUse` callback
  error, timeout, or malformed response can fail the hook without blocking the tool"

C19. `ask` is not implemented — it fails and the call proceeds.
  advertised-elsewhere | lines 938-940
  QUOTE: "`permissionDecision: \"ask\"`, legacy `decision: \"approve\"`, `continue: false`,
  `stopReason`, and `suppressOutput` are parsed but not supported yet. Codex marks the
  hook run as failed, reports the error, and continues the tool call."

C20. Async hooks cannot gate.
  advertised-elsewhere | line 727
  QUOTE: "Background hooks can't block, approve, rewrite, or otherwise control the
  operation that triggered them."

C21. Budget, explicit, per handler.
  advertised-elsewhere | line 618
  QUOTE: "By default, Codex limits each model-visible hook-output message to roughly
  2,500 tokens."

C22. The vendor's own scoping of what this mechanism is.
  advertised-elsewhere | line 552
  QUOTE: "Treat tool hooks as a useful guardrail, not a complete enforcement boundary."

C23. Tool coverage is broader than shell.
  advertised-elsewhere | line 534
  QUOTE: "`PreToolUse` and `PostToolUse` can observe more than shell and MCP calls. Most
  local function tools use the same hook path"

--- CURSOR --------------------------------------------------------
Page: https://cursor.com/docs/hooks , fetched 2026-10-28, 1,314 lines

C24. Default fail direction, stated plainly.
  advertised-elsewhere | line 250
  QUOTE: "Other exit codes - Hook failed, action proceeds (fail-open by default)"

C25. Opt-in fail-closed, and the exception that always blocks.
  advertised-elsewhere | line 527
  QUOTE: "When `true`, hook failures (crash, timeout, non-zero exit code, no output) block
  the action instead of allowing it through."

C26. Merge is deny-dominant across all sources.
  advertised-elsewhere | line 439
  QUOTE: "All matching hooks from every source run, and Cursor merges their responses: any
  `deny` wins over `ask`, and `ask` wins over `allow`"

C27. Project hooks ship in the repo and need trust.
  advertised-elsewhere | line 460
  QUOTE: "Project hooks run in any trusted workspace and are checked into version control
  with your project"

C28. Cloud agents do run repo hooks — i.e. a real delegate path.
  advertised-elsewhere | line 129
  QUOTE: "Cloud agents run command-based hooks from your repository. If you have hooks
  defined in `.cursor/hooks.json` at the root of your project, cloud agents pick them up"

C29. The per-command gate.
  advertised-elsewhere | line 874
  QUOTE: "Crashes, timeouts, and non-zero exit codes other than `2` fail open by default:
  Cursor logs the failure and allows the action through."

C30. Third-party (Claude-format) hooks are loaded.
  advertised-elsewhere | line 97
  QUOTE: "Cursor supports loading hooks from third-party tools like Claude Code."

C31. Where a reviewer reads it.
  advertised-elsewhere | line 1297
  QUOTE: "There is a Hooks tab in **Customize** and a Hooks output channel to debug
  configured and executed hooks and see errors."

--- CLINE ---------------------------------------------------------
Page: https://docs.cline.bot/customization/cline-rules , fetched 2026-10-28, 521 lines.
Canonical URL is `/customization/cline-rules`; `/features/cline-rules` resolves to it.
Page's own last-modified marker: 2026-10-07T03:10:46.514Z (Mintlify `lastModified`).

C32. Malformed frontmatter fails open — the rule loads anyway.
  advertised-elsewhere | line 352
  QUOTE: "If frontmatter can't be parsed, Cline fails open. The rule activates with raw
  content visible to help debugging."

C33. No budget, only advice.
  advertised-elsewhere | line 246
  QUOTE: "Rules consume context tokens. Avoid lengthy explanations or pasting entire style
  guides."

C34. Default with no frontmatter is: inject on every request.
  advertised-elsewhere | lines 275, 350
  QUOTE: "**Without conditionals**: every rule loads for every request."
  QUOTE: "**No frontmatter**: Rules without frontmatter are always active."

C35. Precedence is workspace-over-global, merged, not replaced.
  advertised-elsewhere | line 174
  QUOTE: "When both workspace and global rules exist, Cline combines them. Workspace rules
  take precedence when they conflict with global rules."

C36. Multi-format reader — the widest of the six.
  advertised-elsewhere | lines 146-151
  QUOTE: "Cline recognizes rules from multiple sources, so you can use existing rule files
  from other tools"

C37. The only conditional supported.
  advertised-elsewhere | line 310
  QUOTE: "Currently, `paths` is the supported conditional. It takes an array of glob
  patterns"

C38. Agent-assisted rule authoring exists.
  advertised-elsewhere | line 207
  QUOTE: "You can also use the `/newrule` slash command to have Cline create a rule
  interactively."

NO CLINE HOOK EVIDENCE THIS ROUND. The nav lists a Hooks page at /customization/hooks
(line 63) but I did not read it. Cline's Q6 answer is `not found`, not "none exists."

--- GOOSE ---------------------------------------------------------
Pages: https://goose-docs.ai/docs/getting-started/using-extensions/ (1fe422, 694 lines)
       https://goose-docs.ai/docs/guides/recipes/recipe-reference/ (9dbe24, 975 lines)
Both fetched 2026-10-28.

C39. No-approval default — the whole reason this harness needs an outer guard.
  advertised-elsewhere | 1fe422 line 30
  QUOTE: "goose operates autonomously by default. Combined with the Developer extension's
  tools, this means goose can execute commands and modify files without your approval."

C40. Runtime activation is session-scoped. This is the round-2 claim, now at a live URL.
  advertised-elsewhere | 1fe422 line 430
  QUOTE: "Any extensions enabled dynamically are only enabled for the current session."

C41. The approval prompt is operator-in-the-loop, and says so.
  advertised-elsewhere | 1fe422 lines 480-482
  QUOTE: "goose would like to enable the following extension, do you approve? | ● Yes, for
  this session"

C42. Config is global only; there is no repo-scoped layer.
  advertised-elsewhere | 1fe422 line 305
  QUOTE: "For advanced users, you can also directly edit the config file
  (`~/.config/goose/config.yaml`) to add, remove, or update an extension"

C43. Extensions ≡ MCP.
  advertised-elsewhere | 1fe422 line 120
  QUOTE: "You can install any MCP server as a goose extension."

C44. Every-turn injection exists and is uncapped.
  advertised-elsewhere | 1fe422 line 44
  QUOTE: "Top of Mind: Inject persistent instructions into goose's working memory every turn"

C45. The one mechanism here with a pass/fail contract.
  advertised-elsewhere | 9dbe24 lines 417-428
  QUOTE: "`checks` | Array | ✅ | List of success check configurations"
  QUOTE: "Shell command to execute for validation (must exit with code 0 for success)"

C46. An explicit extensions block REPLACES the defaults — a real footgun.
  advertised-elsewhere | 9dbe24 line 179
  QUOTE: "When a recipe specifies an explicit `extensions` block, only the listed
  extensions are available — default platform extensions like `summon` are not
  automatically included."

C47. Recipes are cwd-discovered, so they are repo-carriable.
  advertised-elsewhere | 9dbe24 lines 26-31
  QUOTE: "Local filesystem: Current directory / Directories specified in `GOOSE_RECIPE_PATH`"

C48. Malware scan before activation — the only pre-activation scan of the six.
  advertised-elsewhere | 1fe422 line 12
  QUOTE: "goose automatically checks external extensions for known malware before
  activation."

NO GOOSE HOOK EVIDENCE. Neither live page documents a pre-execution hook, an exit code, or
a deny path. Goose's Q6 answer is `not found` in vendor docs, and the delegate should
confirm at 775b3958 rather than take "none" from me.

--- GITHUB COPILOT CLI --------------------------------------------
Page: https://docs.github.com/en/copilot/reference/hooks-reference , fetched 2026-10-28,
956 lines. This is the most explicit fail-direction documentation of the six.

C49. Fail-closed on error, for command preToolUse. Unique among the six.
  advertised-elsewhere | line 510
  QUOTE: "Command `preToolUse` hooks are **fail-closed** on errors—a crash or non-zero exit
  (including exit `2`) denies the tool call"

C50. …but timeouts are carved out, even for admin policy hooks.
  advertised-elsewhere | line 510
  QUOTE: "Command hook **timeouts are always fail-open, even for `preToolUse` and
  admin-deployed policy hooks**"

C51. …and the HTTP variant is fail-open wholesale.
  advertised-elsewhere | line 510
  QUOTE: "HTTP `preToolUse` hooks are **fail-open**—a network error, timeout, or non-2xx
  response falls through to the default permission flow."

C52. Malformed config: item-level drop, file-level reject. Graded, not binary.
  advertised-elsewhere | line 114
  QUOTE: "If a hook configuration file loaded from a directory (for example,
  `.github/hooks/`) contains a malformed hook item, only that item is dropped and logged"

C53. Repo hooks under `.github/hooks/`.
  advertised-elsewhere | line 35
  QUOTE: "**Repository-level hook files** — `.github/hooks/*.json` in the repository root."

C54. Trust is "workspace admission", and it is required for repo hooks.
  advertised-elsewhere | line 91
  QUOTE: "Repository and inherited-agent hooks require workspace admission. Hook-disable
  settings, enterprise restrictions, and timeouts still apply."

C55. Policy hooks are machine-wide and cannot be turned off locally.
  advertised-elsewhere | line 51
  QUOTE: "Policy hooks are machine-wide hooks loaded by administrators. They load before
  all other hooks and cannot be disabled by `disableAllHooks`."

C56. The delegate surface: cloud agent has no operator at all.
  advertised-elsewhere | line 105
  QUOTE: "The agent runs with all tool permissions pre-granted, so no permission dialogs
  are shown"

C57. In that surface, `ask` degrades to `deny` rather than to allow. Correct direction.
  advertised-elsewhere | line 750
  QUOTE: "In Copilot CLI autopilot mode, no prompt is shown and `\"ask\"` is denied"

C58. Budget.
  advertised-elsewhere | line 427
  QUOTE: "Hook output (stdout for command hooks, the response body for HTTP hooks) is
  bounded at 10 MiB per invocation"
  plus, line 793: "the results are joined with a double newline and capped at 10 KB"

C59. Cross-tool file compat — Copilot reads Claude's settings files.
  advertised-elsewhere | line 37
  QUOTE: "Cross-tool `.claude/settings.json` and `.claude/settings.local.json` files in the
  repository are also read."

C60. Where a reviewer reads the decision — the event stream, not just a log file.
  advertised-elsewhere | lines 293-298
  QUOTE: "`permissionRequest` | Fires before the permission service runs (rules engine,
  session approvals, auto-allow/auto-deny, and user prompting)."

=====================================================================
A3. GitHub issues — titles as fetched, 2026-10-28
=====================================================================
All four are in github/copilot-cli and all four are OPEN as of fetch.

| # | TITLE (verbatim) | State | URL | Class |
|---|---|---|---|---|
| 2893 | preToolUse hooks silently bypassed under parallel tool calls (timeout->allow fallback + serial dispatch) | open | https://github.com/github/copilot-cli/issues/2893 | reported-by-users |
| 3590 | PreToolUse hook permissionDecision: "ask" auto-approved by TUI since v1.0.53 | open | https://github.com/github/copilot-cli/issues/3590 | reported-by-users |
| 2540 | Plugin-defined preToolUse hooks (hooks.json) do not fire - neither in main session nor subagents | open | https://github.com/github/copilot-cli/issues/2540 | reported-by-users |
| 5098 | sessionStart  hook stops running after adding  sandbox.userPolicy.filesystem  paths | open | https://github.com/github/copilot-cli/issues/5098 | reported-by-users |

Key quotes (≤40 words each):

#2893, body line 9: "`preToolUse` hooks are silently bypassed under parallel tool calls"
#2893, body line 11: "the CLI stops waiting but the hook subprocess keeps running. The CLI
  then proceeds with an **implicit allow** (fail-open)."
#2893, mvelosop 2026-10-27 (line 189), which narrows the earlier claim: "The fail-open
  paths that remain are a hook that is slow on its own, or one whose output isn't
  parseable"
  → NOTE FOR DELEGATE: as of 1.0.104 the *queueing* half of #2893 does not reproduce ("all
  10 denied, the last after waiting ~18 s in the queue", line 187). The surviving failure
  is per-hook slowness and unparseable stdout. Do not cite #2893 as "parallelism breaks the
  guard" without that qualifier.
#2893, line 191, also load-bearing: "overwriting or deleting the hooks file mid-session has
  no effect … the file is read once at session start."

#3590, body line 9: "the TUI permission dialog flashes on screen for milliseconds and is
  **immediately auto-approved** without user interaction"
  → This is an `ask`-degrading-to-allow bug, i.e. the opposite direction from Copilot's
  documented cloud-agent `ask`→`deny`. A hook that returns `ask` is not a guard in the TUI
  on 1.0.53–1.0.56.

#2540, body line 9: "preToolUse hooks defined in a plugin's `hooks.json` file are never
  executed."
#2540, solvaholic 2026-06-08 (line 78): "back then a failed `preToolUse` hook was silently
  allowed. As of 1.0.57 those errors deny instead of silently passing"
  → This is the cleanest statement anywhere in the corpus that the fail direction is a
  *versioned product decision* that changed. It is also the strongest argument against
  copying a guard's semantics from a doc page without pinning the binary.
#2540, line 76: root cause per commenter — hook `cwd` resolved against project cwd, not
  plugin root; workaround `"cwd": "${PLUGIN_ROOT}"` from 1.0.60.

#5098, body line 11: "it never runs again. `/env` still lists the hook."
  → Silent failure: loaded, listed, never executed, no warning.

RE-CITE BAN HONOURED: #978 and #4438 are not cited anywhere in this document. They are
skills issues, not hook issues. Round 2's use of them for hook/deny behaviour is withdrawn.

=====================================================================
A4. What changed in the record, stated plainly
=====================================================================
1. Three Goose citations now resolve. The design page does not; it moves to the repo pin
   and stays `unverified` until read there.
2. Every round-2 line-number-only citation is replaced above by quote+URL+date. Line
   numbers are retained as an aid and are explicitly non-portable.
3. Codex's hook semantics — round 2's largest open question — are answered (C13-C23) and
   the answer is *not* "fail-open": it is trust-gated, deny-capable, and fail-open only on
   callback error.
4. Copilot CLI is the one harness whose command `preToolUse` fails *closed* on crash — and
   the one whose timeout still fails open (C49-C51). Both in the same paragraph.
```

```markdown
TASK B — Q1–Q6 FOR SIX HARNESSES, plus Q7
Fetched 2026-10-28. Classes: advertised-elsewhere unless stated. Every cell cites a quote
in TASK A by ID (Cnn) or an issue number. `not found` means I looked and did not find it in
the pages I read — it does not mean the mechanism is absent.

=====================================================================
Q1. How a tool reaches the model
=====================================================================

| | Claude Code | Codex CLI | Cursor | Cline | Goose | Copilot CLI |
|---|---|---|---|---|---|---|
| Mechanism | MCP, named `mcp__<server>__<tool>` (C11) | MCP, referenced as "an already-connected MCP server" in hook config [^99bc0c#343] | MCP; plus plugin dirs returned at `workspaceOpen` [^5f6188#1275] | MCP (nav only — `not found` in pages read) | MCP ≡ extension (C43) | MCP + plugin-contributed hooks (C53) |
| Is the set mutable mid-session? | Yes — `reloadSkills` re-scans skill/command dirs (C9) | Not found | Not found (pluginPaths binds at workspace open) | Not found | Yes — Extension Manager, session-scoped (C40) | Not found |
| Distinctive | Skill frontmatter can register hooks for the rest of the session (C8) | Hook coverage extends to non-shell function tools (C23) | `pluginPaths` is a repo-conditional loader, not an agent-authoring path | Widest file-format reader (C36) | Extensions carry instructions as well as tools (`unverified` this round) | Reads Claude's own settings files (C59) |

Confidence: Claude Code and Copilot high; Codex medium (the page is about hooks, not tool
registration); Cursor medium; Cline and Goose low for the registration half.

=====================================================================
Q2. Can the agent author a tool that the NEXT session calls as a tool?
=====================================================================

| | Answer | Evidence |
|---|---|---|
| Claude Code | No registration API. Nearest: skill frontmatter registers hooks at invoke time and they persist for the session (C8); `reloadSkills` makes a hook-written skill available in the *same* session (C9). Cross-session capability is a file in a discovered directory, or an MCP server/plugin — both human acts. | C8, C9 |
| Codex CLI | Not found. Plugin-bundled hooks exist and load alongside others, but enabling a plugin is a user act, and its hooks still need trust (C13, C15). | C13, C15 |
| Cursor | Not found. `workspaceOpen` returning `pluginPaths` is close — the *workspace* decides what loads — but nothing lets the agent write that list mid-session. | [^5f6188#1275] |
| Cline | No. The agent-facing write path is `/newrule`, which creates an instruction file (C38), not a callable tool. | C38 |
| Goose | Yes, and this is the important counter-example: `enable_extension` is model-callable, gated by an approval prompt that says "Yes, for this session" (C41), and explicitly session-scoped (C40). Goose built exactly the mechanism round 2 wanted and had to document that it does not survive the session. | C40, C41 |
| Copilot CLI | No. Agent-scoped hooks are declared in a custom agent's frontmatter — authored by a human, run while that agent is selected [^3a3779#71]. | #71 |

Verdict for pi: **`registerTool()` has no peer for agent-authored capability.** Goose's is
the only model-callable registration of the six, and it is deliberately ephemeral. Every
other system routes authored capability through a *file that a human or the harness
discovers*. A design that registers an authored tool at runtime is not wrong, it is
un-precedented among these six — which raises the bar for evidence that it works, not
lowers it.

=====================================================================
Q3. Instruction surface: lifecycle, precedence, and TRUST
=====================================================================

| | Where it lives | Precedence | What a teammate must do after `git pull` | Is trust persisted out of band? |
|---|---|---|---|---|
| Claude Code | `.claude/settings.json`, committable (C1); skill/agent frontmatter; plugins | settings precedence governs; skill-frontmatter hooks are added per-session (C8) | Nothing, if the hooks are in project settings — they load on next session. **But** skill frontmatter hooks register "including in a `-p` run in a folder you haven't trusted" (C8) — that is a gap, not a gate. | Partly. Workspace trust is a per-folder operator action; it does *not* gate skill-frontmatter hooks (C8). No content-hash pinning documented. |
| Codex CLI | `hooks.json` next to active config layers; `<repo>/.codex/hooks.json` | Closest config layer wins for config; hooks from all layers load, they do not replace [^3] | **Review and trust.** Project hooks do not load at all in an untrusted project (C14), and new/changed hooks are skipped until trusted (C13, C15). | **Yes** — trust recorded against the hook's current hash (C13). This is the only true out-of-band persistence of the six. Voidable with `--dangerously-bypass-hook-trust` (C16). |
| Cursor | `<project>/.cursor/hooks.json`, checked in (C27) | Enterprise → Team → Project → User; merged, and any deny wins (C26) | Open the project (trust the workspace) (C27) | Workspace trust only; no per-hook hash. |
| Cline | `.clinerules/`, `.cline/rules/`, plus `.cursorrules`, `.windsurfrules`, `AGENTS.md`, `~/.agents/AGENTS.md` (C36) | Workspace over global, merged (C35) | Nothing. Rules apply on next request. **No trust gate found.** | No. |
| Goose | `~/.config/goose/config.yaml` only (C42) | Global only; recipes replace defaults wholesale (C46) | Nothing arrives on pull — nothing is repo-scoped. | N/A (no repo surface). Malware scan before activation only (C48). |
| Copilot CLI | `.github/hooks/*.json` in the repo root (C53); also inline in `.github/copilot/settings.json` | Policy → user → project → plugins, all combined, all run [^1] | Satisfy "workspace admission" for repo hooks (C54). Policy hooks need an admin and cannot be disabled locally (C55). | Admission is persisted by the host; no hash pinning documented. |

The finding that matters for our incident review: **only Codex persists trust against
content.** Claude Code, Cursor and Copilot gate on *where the file lives*, which means a
malicious or mistaken `git pull` that edits an existing, already-trusted hook file runs
without any new review. Codex re-prompts because the hash changed. That is the property to
copy, and none of the others have it.

=====================================================================
Q4. Persistence and injection budgets (the number, quoted)
=====================================================================

| | Every request | Cap published | Quote |
|---|---|---|---|
| Claude Code | `CLAUDE.md`; hook `additionalContext` when fired | **Yes, hard, no override** | "capped at 10,000 characters" (C6); over the limit it is spilled to a file with a 2,000-char preview |
| Codex CLI | `AGENTS.md` first turn; hook context | **Yes, per handler, tunable** | "roughly 2,500 tokens" (C21); `additionalContextLimit` per handler, `0` = no limit, with the vendor warning that `0` lets one hook eat the window [^3] |
| Cursor | Project/user hooks inject at session start only | **Injection cap: no. Output cap: no.** | Nothing numeric found on the hooks page for context injection. |
| Cline | **Every rule body without `paths:`** (C34) | **No** — prose only | "Rules consume context tokens. Avoid lengthy explanations…" (C33) |
| Goose | Extension `instructions()`; Top of Mind every turn (C44) | **No** | No number on either page. |
| Copilot CLI | `sessionStart` / `subagentStart` `additionalContext` | **Yes, two tiers** | 10 MiB per invocation (C58); `postToolUse` `additionalContext` joined and "capped at 10 KB" [^3a3779#793]; `sessionStart` contributions joined with `"\n\n"` and bounded by the same 10 MiB [^3a3779#358] |

Ranked by how much discipline the vendor *enforces* rather than advises:
Claude Code (hard, unraisable) > Copilot CLI (hard, generous, per-tier) > Codex (hard,
tunable, with a warning) > Cursor / Goose / Cline (advice only).

The number worth arguing with: Cline and Goose can each inject an unbounded prelude every
turn and neither ships a counter. Claude Code caps a *single* hook string at 10,000
characters. Our pointer file plus N instrument descriptions sits inside Claude Code's cap
for any plausible N, so the cost question is not "will we overflow 10k" — it is "how many
descriptions before a harness starts silently dropping the least-used one," which is a
Codex/Claude listing behaviour I did not re-verify this round (`unverified`).

=====================================================================
Q5. Named mechanisms that stop an agent re-deriving finished work
=====================================================================

| | Mechanism | Named in vendor docs? | Quote / status |
|---|---|---|---|
| Claude Code | Skill as a named, invoke-once-per-session unit; `/skillname` direct invocation; hooks can force a skill-run at a lifecycle point | **Yes** | "typing `/skillname` directly bypasses `PreToolUse`" (C7) — i.e. the direct-invocation path is first-class and fast |
| Codex CLI | Nothing named. The nearest adjacent thing is a hook on `Stop`/`SubagentStop` that forces another turn — which is the *opposite* (prevents stopping, not prevents redoing). | `not found` | — |
| Cursor | `stop` / `subagentStop` `followup_message` with `loop_limit` (default 5) — loop control, not work-reuse | Partial | [^2] |
| Cline | Rules as persistent instruction; no reuse mechanism | `not found` | — |
| Goose | **Recipe with `retry` + shell `checks`** — the only mechanism here with a machine-checkable success predicate and an `on_failure` command | **Yes** | "must exit with code 0 for success" (C45); `max_retries`, `timeout_seconds`, `on_failure` |
| Copilot CLI | `agentStop` / `subagentStop` `decision: "block"` forces another turn, with a runaway guard after 8 blocks | Partial | [^3a3779#774] |

Result: **five of six have nothing for this.** Goose's recipe-retry is the closest thing in
the corpus to "a tracked script with a pass/fail contract," and it is the only construct
that could answer "did this instrument actually work" without a human reading a transcript.
Everything else is either loop control (Cursor, Copilot) or instruction persistence
(Cline). For pi, this confirms the round-2 ranking: the gap is not that harnesses solve
re-derivation well — it is that they mostly don't, and the one that does does it with a
shell check.

=====================================================================
Q6. Guards on the agent's own verbs: where the rule lives, what happens when
    the HOOK FAILS or a rule file is MALFORMED, and is it reviewable
=====================================================================

| | Where the rule lives | Hook crashes / non-zero exit | Hook times out | Malformed config | Recorded where a reviewer can read it |
|---|---|---|---|---|---|
| **Claude Code** | `.claude/settings.json` (C1), plugin `hooks.json`, skill/agent frontmatter | **FAIL-OPEN** by default (C2). Opt-in `onFailure: "block"` (C3) | Same — fail-open, and a timed-out PreToolUse "doesn't block the tool call" [^20106b#789] | Malformed JSON = non-blocking error, action proceeds [^20106b#717] | `/hooks` read-only browser, labels each hook by source, shows full text (C12); debug log |
| **Codex CLI** | `<repo>/.codex/hooks.json`; `[hooks]` in `config.toml` | Explicit `deny` blocks (C17); exit `2` blocks (C17); **callback error/timeout/malformed response fails *without* blocking** (C18) | Fail-open (C18) | Not read | `/hooks` inspects sources, reviews, trusts, disables; trust state keyed to hash (C13); startup warning if review needed [^99bc0c#140] |
| **Cursor** | `<project>/.cursor/hooks.json` (C27) | **FAIL-OPEN** (C24, C29). `failClosed: true` to change it (C25). **Exception: invalid JSON or schema mismatch blocks even when `failClosed` is false** [^5f6188#248, #527] | Fail-open unless `failClosed` (C25) | Invalid JSON → blocks (permission hooks); other events → logged and skipped | Hooks tab + Hooks output channel (C31) |
| **Cline** | `.clinerules/*.md` (rules only; no hook layer verified) | N/A — no hook layer found | N/A | **FAIL-OPEN**: "The rule activates with raw content visible" (C32) | Rule panel with per-rule toggle (C38 context); no decision record |
| **Goose** | `~/.config/goose/config.yaml`; no repo layer (C42) | N/A — no hook found | N/A | N/A | Permission modes / tool permissions [^1fe422#30]; no per-decision log documented |
| **Copilot CLI** | `.github/hooks/*.json` (C53); policy hooks in `/etc/github-copilot/policy.d/` (C55) | **FAIL-CLOSED** for command `preToolUse` — crash or non-zero exit denies, "even if the hook's stdout JSON reports `permissionDecision: "allow"`" (C49) | **FAIL-OPEN — always, even for admin policy hooks** (C50) | Item dropped, siblings load; structural error rejects whole file (C52) | `permissionRequest` event before the permission service (C60); `events.jsonl` carries `permission.requested`/`permission.completed` (see #3590) |

THE THREE-WAY SPLIT, which is the actual answer to our question:

1. **Fail-open on crash, opt-in closed:** Claude Code, Cursor. Both pair this with a
   best-effort or advisory matcher (C5, C29). Both are guardrails, not gates, until an
   operator flips one flag.
2. **Fail-open on crash, *except* `preToolUse`:** Copilot CLI. Crash denies
   (C49). Then carves out timeouts (C50). Net: a guard that dies protects you; a guard that
   hangs does not.
3. **No hook layer at all:** Cline, Goose. Cline's *rule* layer fails open on malformed
   YAML (C32) — an unparseable rule is injected raw rather than dropped, which is
   fail-open in the direction that costs tokens, not safety.

And the empirical counterpoint that should govern how we read all of the above: #2540's
commenter records that on 1.0.18 a failed `preToolUse` hook "was silently allowed," and
that "as of 1.0.57 those errors deny instead of silently passing." Fail direction is a
*versioned product decision*. Any port of a guard must pin the binary, not the doc page.

Failure modes documented by users, not vendors:

| Failure | Harness | Class | Evidence |
|---|---|---|---|
| Timeout → implicit allow, deny discarded | Copilot CLI | reported-by-users | #2893: "The CLI then proceeds with an **implicit allow** (fail-open)." |
| A stray log line on stdout turns a deny into an allow | Copilot CLI | reported-by-users | #2893 (mvelosop): "A stray log line on stdout silently turns a deny into an allow." |
| `ask` auto-approved by the TUI in 79 ms | Copilot CLI | reported-by-users | #3590: "immediately auto-approved without user interaction" |
| Repo/plugin hook parsed, counted, listed — never executed | Copilot CLI | reported-by-users | #2540: "it never executes"; banner "Loading: 8 hooks" |
| Hook loaded and listed, silently stops running after a sandbox policy edit | Copilot CLI | reported-by-users | #5098: "it never runs again. `/env` still lists the hook." |
| Hook file read once at session start, so mid-session edits do not apply | Copilot CLI | reported-by-users | #2893 (mvelosop): "the file is read once at session start" |

All six user-reported failures are Copilot CLI. That is not because Copilot is uniquely bad
— it is because Copilot is the only one of the six with a population large enough and a
hook system old enough for users to file these. Cursor, Cline and Goose have **no**
user-report evidence in this corpus. Treat the failure table as one-vendor evidence about a
shared design, not as a ranking.

=====================================================================
Q7. What pi's `registerTool()` is missing, and does anyone have a DELEGATE mode
=====================================================================
Caveat, stated before the table: I did not read pi's source at this pin. `registerTool()`
is characterized here as "the project-extension API through which pi registers a callable
tool," class `unverified`. If that is wrong, the whole comparison is aimed at the wrong
object.

What the five other surfaces have that `registerTool()` alone does not:

| # | Property | Who has it | Evidence | Why it matters to us |
|---|---|---|---|---|
| 1 | **Trust persisted against content hash** — a changed hook is re-reviewed, not silently re-run | Codex only | C13 | Our 36-row worktree ledger was lost to a verb that was already "allowed." Content-hash trust is the only mechanism here that would have noticed the guard itself changed. |
| 2 | **A documented deny path with a stated fail direction** | All except Cline/Goose | C2/C3, C17/C18, C24/C25, C49/C50 | `registerTool()` registers capability; it does not express "this verb is forbidden even if the tool exists." Capability and prohibition are different axes. |
| 3 | **Third-party format compatibility** — one file serves several harnesses | Cursor reads Claude hooks (C30); Copilot reads `.claude/settings.json` (C59) | C30, C59 | A repo-carried guard should not be re-authored per harness. |
| 4 | **Same-session capability reload from a watched directory** | Claude Code (`reloadSkills`, C9) | C9 | This is the mechanism that would let a capture-on-success step land an instrument and have it usable *this* session, not next. |
| 5 | **A per-decision record a reviewer reads** | Claude Code `/hooks` (C12); Copilot event stream (C60); Cursor channel (C31) | C12, C31, C60 | Our census can count invocations; it cannot show *why* a call was allowed. |
| 6 | **A machine-checkable success predicate** | Goose recipes (`checks`, shell exit 0) (C45) | C45 | The falsifiable form of "this instrument worked." |

Ordered by impact ÷ cost for pi, keeping round 2's ranking and amending it with this
round's evidence:

1. Capture-on-success into a discovered directory (unchanged; C9 is its enabling mechanism).
2. Deny rule + blocking guard, **with an explicit fail direction chosen and written down**
   (amended: the direction is a decision, not a default — #2540 proves it moves between
   versions).
3. Description-only advertisement (unchanged).
4. Trust keyed to content hash (new, promoted from "nice" because C13 is the only
   out-of-band persistence in the corpus).
5. Project instruction file (unchanged).

DELEGATE MODE — yes, three of the six have one, and they enforce the guard three different
ways:

| | Is there a no-operator mode? | How the guard is enforced there | Quote |
|---|---|---|---|
| **Copilot cloud agent** | **Yes — the strongest case.** Ephemeral sandbox, "Fully non-interactive", all permissions pre-granted. | `preToolUse` still fires; `ask` is coerced to **deny** because no user can answer. But `permissionRequest` "either does not fire or has no effect" — so the *only* usable gate in delegate mode is `preToolUse`. | "The agent runs with all tool permissions pre-granted, so no permission dialogs are shown" (C56); "`\"ask\"` is treated as `\"deny\"` because no user is available to answer" [^3a3779#298] |
| **Cursor cloud agents** | **Yes.** | Project hooks from `.cursor/hooks.json` run in the cloud VM. `sessionStart`/`sessionEnd`/`workspaceOpen` do **not** run there; `beforeShellExecution` and `preToolUse` do. | "Cloud agents run command-based hooks from your repository" (C28) |
| **Claude Code `-p` / Agent SDK** | **Partial.** Non-interactive with a permission host; `ask` needs a host or it denies. | Skill-frontmatter hooks register even in `-p` in an untrusted folder (C8) — a guard surface that is *more* permissive in delegate mode than in interactive mode. | "including in a `-p` run in a folder you haven't trusted" (C8) |
| Codex CLI | Not read as a delegate mode (sandbox/approval split is a separate page, not re-read this round) | — | `unverified` |
| Cline / Goose | No. Goose's activation flow is an interactive approval prompt ("do you approve?", C41). | — | C41 |

The design lesson, stated once: **in delegate mode the guard must be the pre-execution
hook, because the permission layer is either absent or pre-granted.** Copilot's own docs
say this outright — `permissionRequest` is unusable in cloud, so "Use `preToolUse` to make
permission decisions instead" [^3a3779#815]. Cursor reaches the same shape by disabling
`sessionStart` and keeping `beforeShellExecution`. If pi ever runs without an operator, the
outer guard cannot be an approval prompt; it has to be a deny-capable pre-call check, and
its timeout behaviour becomes the whole of its security (C50 — and that one fails open).
```

```markdown
QUESTIONS WE COULD NOT ANSWER, AND WHY
=====================================================================

1. Goose's extension design — `Extension::instructions()` beside `tools()`.
   WHY: the live page 404s, the path survives only at the repo pin
   (vendor/eval/goose · 775b3958 · documentation/docs/goose-architecture/extensions-design.md),
   and the brief forbids reading source. The only attestation I have is a fork mirror.
   STATUS: `unverified`. Round 2 should not have cited it as advertised.

2. Whether Goose has ANY pre-execution guard — a hook, an exit code, a deny path.
   WHY: neither live page (using-extensions, recipe-reference) documents one. Absence in
   two pages is not absence in the product. The delegate should grep 775b3958 for a hook
   or policy layer before we record "none."
   STATUS: `not found`, not "none exists."

3. Cline's hook layer.
   WHY: the rules page's own nav lists `/customization/hooks` (line 63) but I spent the
   budget on the four copilot-cli issues. Round 2 found that page to be a one-line stub
   pointing at SDK Plugins; I could not confirm whether that is still true.
   STATUS: `unverified`.

4. Whether Claude Code, Cursor, Copilot or Goose persist hook *trust* across sessions the
   way Codex does (hash-keyed).
   WHY: I read the hook reference for each; only Codex documents hash-keyed trust. For the
   others I found "trusted workspace" language and nothing about re-review on change. That
   is a documentation gap I cannot distinguish from a product gap.
   STATUS: `unverified` for the negative.

5. Whether a `PreToolUse` hook sees a tool call the *agent* makes versus one a
   *subagent* makes, per harness.
   WHY: Claude Code documents `agent_id`/`agent_type` in hook input and says settings hooks
   run inside subagents [^20106b#256]. Copilot documents `agentId`/`parentAgentId`
   [^1] and notes the built-in `general-purpose` agent emits no
   `subagentStart` [^3a3779#609]. Cursor and Goose: not read. This matters directly — our
   lost ledger came from a subagent-ish flow, and "the guard covers subagents" is not
   established uniformly.
   STATUS: `unverified` for Cursor, Cline, Goose.

6. Any injection budget for Cursor, Cline or Goose.
   WHY: no number is published. I quoted the prose admonitions (C33) rather than invent a
   figure. If the delegate wants a denominator, only Claude Code (10,000 chars, C6),
   Codex (2,500 tokens, C21) and Copilot (10 MiB / 10 KB, C58) supply one.

7. Whether the Codex `Stop`-hook continuation and Copilot's 8-block runaway guard have a
   pi analogue.
   WHY: not read in pi. Named here only so the delegate can check.

8. pi's `registerTool()` semantics at the pin (whether registered tools survive a session,
   whether they are advertised by description or by schema, whether a registered tool can
   be denied).
   WHY: source not read, per the brief. Q7's comparison rests on the round-2
   characterization and is therefore `unverified` at its foundation.

9. Two round-2 claims I could not re-verify and am flagging rather than repeating:
   (a) the "1% of the context window" skill-listing budget with least-invoked-first
   dropping; (b) `/skill-doctor`. Both came from code.claude.com/docs/en/skills, which I
   did not re-fetch this round. If they are load-bearing in ROADMAP, re-fetch before
   citing.

10. HTTP status, `Last-Modified` response headers and sha256 for any of these pages.
    WHY: structurally unavailable from this host — no headers, no shell. The only
    last-modified marker I could read is Cline's, which exposes `lastModified:
    2026-10-07T03:10:46.514Z` in its page payload. Everything else is date-of-fetch only.
    Do not accept a MANIFEST from me with those columns filled.

NOT DONE, SAID PLAINLY: no files written, nothing committed, nothing cloned. All of the
above is text for the delegate to land in docs/reviews/harness-tools-skills-public-harnesses-research.md
and inputs/fetched/.
```

**References**

[^1]: [GitHub Copilot hooks reference - GitHub Docs](https://docs.github.com/en/copilot/reference/hooks-reference) (69%)
[^2]: [Hooks | Cursor Docs](https://cursor.com/docs/hooks) (20%)
[^3]: [Hooks | ChatGPT Learn](https://learn.chatgpt.com/docs/hooks) (11%)