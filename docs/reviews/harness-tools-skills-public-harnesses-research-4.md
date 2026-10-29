# Status: I could not execute this as specified

I have to be blunt about three things before any content, because each one changes what this reply is worth to you.

**1. The prompt file is not in this sandbox.** `docs/` does not exist here. The workspace contains only `inputs/fetched/` (empty at session start), `inputs/search/`, `work/agents/`, `work/notes/`, `output/`, and `uploads/`. The two files I do have are the *earlier* prompts (`harness-tools-skills-research-prompt.md` and `harness-tools-skills-followup-research-prompt.md`). So I never read `harness-tools-skills-followup-2-research-prompt.md`, and **"Q1–Q6" below is my reconstruction from the parent and follow-up prompts, not your Q1–Q6.** If they differ, this section is aimed at the wrong questions. I attempted to retrieve the file from `raw.githubusercontent.com/chexxor/Durian-Pi/main/...` and the step budget expired before the fetch ran — unverified whether the path is public.

**2. I cannot write, so I did not commit, and the report file is untouched.** The workspace is read-only for me: no `docs/reviews/harness-tools-skills-public-harnesses-research.md` edit, no `inputs/fetched/MANIFEST.md`. Per your instruction, saying so plainly: **I committed nothing; the delegate must land all of it.** The repaired citation index is reproduced below as text to paste.

**3. Three of the five MANIFEST columns are not producible here.** `web_fetch` returns page text with a tag and a line count — no response headers. There is no shell, so no `sha256sum`. So of *URL, fetch date, HTTP status, sha256, last-modified marker*: I can produce **URL and fetch date** (2026-10-28), plus line counts as a weak integrity proxy. HTTP status, sha256, and `Last-Modified` are **not obtainable** — not "forgotten", structurally unavailable. A MANIFEST with those columns filled would be fabricated. Don't accept one.

What did land: `web_fetch` persists to `inputs/fetched/`. Two pages are now there and re-verified this turn:

| File | URL | Lines | Tag |
|---|---|---|---|
| `rules-cursor-docs_5389e9.md` | https://cursor.com/docs/context/rules | 476 | `5389e9` |
| `extend-claude-with-skills-claude-code-docs_542f21.md` | https://code.claude.com/docs/en/skills | 1,073 | `542f21` |

Both reproduced their prior tags **and** line offsets exactly — `#216` is still Cursor's "not inlined" paragraph, `#49` still `/run-skill-generator`, `#512` still the compaction budget, `#1043` still the 1% listing budget. The other 12 files are absent from this sandbox; they were verified in the previous turn but are not on disk now.

---

## Task A — the citation repair, as text

Every `key#line` marker in the body, deduplicated, re-anchored. These are the 50-odd pairs.

### `[^20106b]` Claude Code hooks — code.claude.com/docs/en/hooks

| Key | Anchor | Backs |
|---|---|---|
| `#29-63` | Event table, `SessionStart` → `SessionEnd` | ~30 events |
| `#96-114` | `block-rm.sh` returning `permissionDecision: "deny"` | deny path exists |
| `#242-256` | Hook locations; `.claude/settings.json` committable | committable guard |
| `#326-338` | MCP tools as `mcp__<server>__<tool>` | schema tools |
| `#395-405` | `#405` = "`if` filter is best-effort, use the permission system" | hook ≠ hard gate |
| `#666`, `#686` | `transcript_path` in hook input; JSONL example | transcript addressable |
| `#708-720` | Exit-code matrix | exit 2 blocks |
| `#808-855` | `onFailure: "block"`; crash/timeout fails **open** | fail-open default |
| `#942-946` | 10,000-char `additionalContext` cap | injection budget |
| `#1026` | "prefer CLAUDE.md… loads without running a script" | static file |
| `#1169`, `#1184-1197` | `reloadSkills` on `SessionStart` | mid-session pickup |
| `#1380` | `/skill` bypasses `PreToolUse`; `UserPromptExpansion` exists | coverage gap |
| `#1742-1770` | allow/deny/ask/defer, `updatedInput` | deny semantics |

### `[^1]` Claude Code skills — verified live this turn

| Key | Anchor (re-read) | Backs |
|---|---|---|
| `#49` | `/run-skill-generator` commits `.claude/skills/run-<name>/`; `/verify` writes `.claude/skills/verify/SKILL.md` "so later runs and other agents follow the same steps"; edits only "when it steered a run wrong" | **capture-on-success** |
| `#53-57` | Commit instructions run `verify`/`simplify` before each commit, v2.1.286+ | forcing function |
| `#138-146` | Seven skill locations incl. plugin and claude.ai | file discovery |
| `#159` | Parent walk; worktree fallback; nested loads lazily | discovery edges |
| `#179-188` | Collision table; plugin skills namespaced | precedence |
| `#445-452` | `helper.py (utility script — executed, not loaded)` | scripts ≠ schema tools |
| `#491-497` | "Description always in context, full skill loads when invoked" | description-only advertising |
| `#512` | Re-attach 5,000 tok/skill within 25,000 after compaction | compaction budget |
| `#516` | "Workspace trust doesn't gate this field… can grant itself broad tool access" | trust gap |
| `#780` | `/skill-doctor` lists never-invoked skills and per-skill cost | maintainer-acknowledged defect |
| `#1043` | Listing = 1% of context; overflow drops "the skills you invoke least"; `skillListingBudgetFraction`, `SLASH_COMMAND_TOOL_CHAR_BUDGET`, `skillListingMaxDescChars` | silent de-advertisement |

One correction from the live read: `#1043` also names **`skillListingBudgetFraction`** and **`skillListingMaxDescChars`** as the knobs, which the report never mentions — that is the setting a rig our size would actually turn.

### `[^3d9c8f]` Codex CLI config · `[^dccefb]` Codex approvals

| Key | Anchor | Backs |
|---|---|---|
| `3d9c8f#173-190`, `#177` | `.codex/config.toml` walk; untrusted ⇒ project layers ignored | trust gate |
| `3d9c8f#192-226` | `hooks.json` locations; `Matcher = "^Bash$"` | pre-tool hook exists |
| `3d9c8f#232-245` | `AGENTS.md` walk, `project_root_markers` | discovery |
| `3d9c8f#472-477` | "block `git commit` outside the sandbox, use `rules`" | policy lives in `rules` |
| `3d9c8f#698-707` | `thread.skills.truncated`, `skill.injected{status}` | vendor instruments failure |
| `3d9c8f#855-873` | `history.jsonl`, `persistence`, `max_bytes` | cross-session state |
| `3d9c8f#887-894` | "limited amount of project guidance in the first turn" | capped injection |
| `dccefb#141-155` | sandbox mode vs approval policy | two-axis model |
| `dccefb#381-390` | `.git`/`.agents`/`.codex`/`.aws` read-only | protected paths |
| `dccefb#400` | `granular` approval, `skill_approval` | per-category policy |
| `dccefb#402-438` | auto-review; `#437` prompt/review/parse failures **fail closed** | only fail-closed reviewer here |

### `[^2]` Cursor rules — all re-read live

`#86-109` contents at start of context · `#90` `.cursor/rules` version-controlled · `#135-152` four activation modes + matrix · `#142` manual `@`-mention · `#216` **"The file's contents are not inlined into the prompt"** · `#244` "Keep rules under 500 lines" · `#275` description presented to agent · `#396` Team → Project → User, earlier wins · `#446` nested `AGENTS.md`, more specific wins · `#464` FAQ restating non-inlining.

### `[^5f6188]` Cursor hooks

`#97` loads Claude Code-format hooks · `#246-251`, `#250` other exit codes ⇒ action proceeds · `#459-460` `.cursor/hooks.json` checked in · `#519-528` `failClosed` default `false` · `#581-593` trusted workspace required · `#651`, `#1286` `transcript_path` / `CURSOR_TRANSCRIPT_PATH` · `#870-901`, `#874` `beforeShellExecution` allow\|deny\|ask, fail-open by default · `#1254-1275` `workspaceOpen` → `pluginPaths`.

### `[^d32e06]` Cline · `[^2d9eb4]` Cline hooks

`d32e06#143-153` `.clinerules/`, `.cline/rules/`, `.cursorrules`, `.windsurfrules`, `AGENTS.md`, `~/.agents/AGENTS.md` · `#174` workspace > global · `#207-211` `/newrule` + toggle · `#246` "Rules consume context tokens" — no cap · `#275-279` body injected every request · `#350-351` no frontmatter ⇒ always on; `paths: []` ⇒ never · `#352` invalid YAML **fails open** · `2d9eb4#5-9` entirety: "See details under SDK Plugins page".

### `[^04a0b7]` Goose · `[^d2cffc]` design · `[^d3d5bf]` recipes

`04a0b7#16` malware scan · `#33-35` "operates autonomously by default… without your approval" · `#43` Chat Recall · `#45` Extension Manager + `enable_extension` · `#46` Skills extension · `#49` Top of Mind, every turn · `#120-124` extensions ≡ MCP · `#303-317` global `config.yaml` only · **`#427` "only enabled for the current session"** · `d2cffc#15-27` `instructions()` beside `tools()` · `d3d5bf#22-31` recipe search path · `#33-52` schema incl. `retry` · `#177-187` explicit `extensions` replaces defaults · `#407-457` `checks[{type: shell}]`, `on_failure`.

### User reports

| Key | Anchor | Caveat |
|---|---|---|
| `[^50ad47]` | claude-code#57776: "the harness has never injected its list" | **closed** as dup of #15178, zero reactions |
| `[^ded888]` | copilot-cli#4438: `skill()` ⇒ `Skill not found` for `disable-model-invocation: true`; repro'd 1.0.79 → 1.0.87-0 | framing below is inverted |
| `[^f06a5e]` | copilot-cli#978: "will not trigger the skill use unless told to" | author closed as model issue |

---

## Four things in the report that do not survive re-checking

1. **§1 says "all five" for a repo-committed instruction file. Goose has none** — §2's own cell says `not found (global ~/.config/goose/config.yaml)` `[^04a0b7#303-317]`. Four of five. §1 contradicts §2.
2. **`[^ded888]` is backwards in §6.** The issue says the *user's* `/skill-name` path works and injects the body; it is the model-facing `skill()` tool that fails, because resolution runs against the model-filtered list. §6 reports "loadable by the user but unreachable by the model" as if the user path were the broken one. The finding is real and stronger than reported, and the direction matters: there is already a working path to copy.
3. **Two of three user reports are closed** (#57776 dup; #978 model limitation). And Cursor, Cline and Goose have **no** user-report evidence at all in this set — §6 is effectively a two-vendor table presented as five.
4. **Three citations are sidebar nav links, not claims:** `[^5389e9#27]` (MCP), `[^d32e06#63]` (Hooks), `[^d32e06#79]` (Memory Bank). The "schema-registered tool" cell for Cursor and Cline rests on a nav entry. It needs the MCP page. `#79` was also the sole basis for the Memory Bank follow-up in §8 — which is why that question was unanswerable.

---

## Q1–Q6 as tables (reconstruction — see caveat 1)

Six columns: Claude Code, Codex CLI, Cursor, Cline, Goose, OpenHands agent-sdk. All cells `advertised-elsewhere`; **OpenHands is `not found`** — I did not read its docs this turn or last, and I will not fill it from memory.

**Q1 — how a tool reaches the model / is the set mutable mid-session?**

| | Claude Code | Codex CLI | Cursor | Cline | Goose | OpenHands |
|---|---|---|---|---|---|---|
| Surface | native + MCP `mcp__s__t` + plugin `[^20106b#326-338]` | MCP via `config.toml` `[^3d9c8f#527-529]` | MCP | MCP | MCP ≡ extension `[^04a0b7#120-124]` | not found |
| Mutable mid-session | yes — skill load, `/reload-skills`, `reloadSkills` on `SessionStart` `[^20106b#1169]` | not found | `workspaceOpen` → `pluginPaths` `[^5f6188#1254-1275]` | not found | yes — `enable_extension`, **session-only** `[^04a0b7#427]` | not found |

**Q2 — can the agent author a capability the next session invokes as a tool?**

| | Answer |
|---|---|
| Claude Code | Not by registration. Via MCP/plugin (human act) — or **file capture**: `/verify` writes `.claude/skills/verify/SKILL.md` after a successful run `[^542f21#49]` |
| Codex CLI | not found |
| Cursor | `/create-rule` writes `.cursor/rules` `[^5389e9#237]`; `pluginPaths` is repo-conditional, not agent-authoring |
| Cline | `/newrule` `[^d32e06#207-211]`; no registration |
| Goose | `enable_extension` — model-callable, **session-scoped by design** `[^04a0b7#427]` |
| OpenHands | not found |

**Q3 — skill/instruction lifecycle**

| | Discovery | Advertised | Load | Gate / precedence |
|---|---|---|---|---|
| Claude Code | 7 locations, parent walk to repo root, nested lazy `[^1]` | name + description only `[^1]` | body on invoke, stays `[^542f21#512]` | enterprise > personal > project; plugin namespaced `[^1]`; trust does **not** gate `allowed-tools` `[^542f21#516]` |
| Codex | `AGENTS.md` walk to project root `[^3d9c8f#232-245]` | "limited amount… first turn" `[^3d9c8f#887-894]` | not found | untrusted ⇒ project layers ignored `[^3d9c8f#177]`; closest `config.toml` wins |
| Cursor | `.cursor/rules/*.mdc`, nested `AGENTS.md` `[^5389e9#90, #410-446]` | `alwaysApply` body; else description `[^5389e9#146-152, #275]` | glob/manual/agent-chosen; `@file` **not** inlined `[^5389e9#216]` | Team > Project > User; nested more specific `[^5389e9#396, #446]` |
| Cline | `.clinerules/`, `.cline/rules/`, 4 foreign formats `[^d32e06#143-153]` | **whole body** unless `paths:` `[^d32e06#275-279]` | always | workspace > global `[^d32e06#174]`; bad YAML fails open `[^d32e06#352]` |
| Goose | global `config.yaml` only `[^04a0b7#303-317]` | `Extension::instructions()` `[^d2cffc#15-27]` | on demand (Skills ext.) `[^04a0b7#46]` | recipe `extensions` replaces defaults `[^d3d5bf#177-187]` |
| OpenHands | not found | not found | not found | not found |

**Q4 — what survives a session boundary? Is the transcript greppable, and does it hold tool arguments?**

| | Store | Greppable | Tool args? |
|---|---|---|---|
| Claude Code | JSONL; `transcript_path` in every hook input `[^20106b#666, #686]` | yes, on disk | **not verified** |
| Codex | `history.jsonl`, `persistence`, `max_bytes` `[^3d9c8f#855-873]` | yes | **not verified** — this is the open question that decides whether Codex is a second recovery source for our nine lost instruments |
| Cursor | `transcript_path` / `CURSOR_TRANSCRIPT_PATH` `[^5f6188#651, #1286]` | likely | not verified |
| Cline | not found | — | — |
| Goose | Chat Recall: "search conversation content across all your session history" `[^04a0b7#43]` | via tool | not verified |
| OpenHands | not found | — | — |

**Q5 — injection cost**

| | Every request | Cap published? |
|---|---|---|
| Claude Code | skill names + descriptions; `CLAUDE.md`; hook context when fired | **yes** — 1% of context window, 1,536 ch/description, 10,000 ch/hook `[^542f21#1043] [^20106b#942]` |
| Codex | `AGENTS.md` first turn; enabled-skills list | partial — `project_doc_max_bytes`, default value not on page |
| Cursor | `alwaysApply` bodies | **no** — "under 500 lines" guidance `[^5389e9#244]` |
| Cline | all rule bodies | **no** — prose warning `[^d32e06#246]` |
| Goose | extension instructions; Top of Mind | **no** |
| OpenHands | not found | not found |

**Q6 — guards on destructive verbs**

| | Mechanism | Fail mode | Per-project? |
|---|---|---|---|
| Claude Code | `PreToolUse` deny / exit 2 / permission rules `[^20106b#96-114] [^20106b#708-720]` | **fails open** unless `onFailure: block` `[^20106b#808-855]`; `if` filter best-effort `[^20106b#405]` | yes, `.claude/settings.json` committable `[^20106b#242-256]` |
| Codex | `PreToolUse` hook + `rules` execpolicy `[^3d9c8f#192-226] [^3d9c8f#472-477]`; auto-review fails closed `[^dccefb#437]` | deny verb **unread** | yes, `.codex/hooks.json` |
| Cursor | `beforeShellExecution` allow/deny/ask `[^5f6188#870-901]` | **fails open**, `failClosed: true` to opt in `[^5f6188#874]` | yes, checked in, trusted workspace `[^5f6188#459-460, #593]` |
| Cline | not found at feature level `[^2d9eb4#5-9]` | — | — |
| Goose | none — "autonomous by default" `[^04a0b7#33-35]`; permission modes only | n/a | no repo layer |
| OpenHands | not found | — | — |

The cross-cutting result for our ledger (36 rows, `git worktree prune`): **every guard that exists here fails open by default**, and the vendors say so themselves. A hook alone is not the outer-layer equivalent. Pair it with a deny rule.

---

## What I could not verify

- **The prompt itself.** `harness-tools-skills-followup-2-research-prompt.md` unread; Q1–Q6 above are reconstructed from the two prompts I do have.
- **The report file.** Absent from this sandbox — I could not apply an edit, and the citation table above is text for the delegate to paste, not a patch against known line numbers in the current file.
- **12 of the 14 URLs.** Not on disk now; their anchors were verified in the previous turn, not this one. They will drift on the next docs edit — nothing is pinned.
- **HTTP status, `Last-Modified`, sha256 for any URL.** Structurally unobtainable here (no headers, no shell).
- **Codex hook deny semantics** — locations and a `PreToolUse` matcher are read; the deny verb, exit codes and fail-open behaviour are not. Don't port our guard to Codex on this.
- **`cursor.com/docs/skills`, Cline Memory Bank, `history.md`** — unread, so "the industry converged on Agent Skills" remains unproven for Cursor.
- **OpenHands agent-sdk** — not read at all; every cell is `not found`, not "none exists".
- **Nothing committed.** The delegate lands the report edit, the corpus and the MANIFEST.

**References**

[^1]: [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills) (96%)
[^2]: [Rules | Cursor Docs](https://cursor.com/docs/context/rules) (4%)