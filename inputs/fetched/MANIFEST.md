# `inputs/fetched/MANIFEST.md` — vendor pages a report cites, fetched by the delegate

**Generated 2026-10-28 by the delegate**, from the copies it fetched while verifying
`docs/reviews/harness-tools-skills-public-harnesses-research.md`. **The page copies are deliberately NOT tracked**: 11 pages,
**8.2 MB** total, largest 2.6 MB — `inputs/fetched/*.html` is in `.gitignore`. They are re-fetchable from the URL, so this
file is the tracked record of *what we saw*: the sha256 pins the bytes, the date says when, §2 lists the report's
load-bearing phrases found in those bytes. Regenerate the copies with:

```bash
mkdir -p .spike/fetch && cd .spike/fetch
for u in $(grep -oE "https://[^ )|]+" ../../docs/reviews/harness-tools-skills-public-harnesses-research.md | sort -u); do
  curl -sS -L -o "$(echo "$u" | sed 's|https://||;s|/|_|g').html" "$u"
done
sha256sum *.html
```

**Round 3 changes the procedure** (D159): the research agent supplies **≤ 40-word verbatim quotes**, the manifest gains a
*quotes found in this copy* column, and each row is checked by `grep` — because **a line range does not survive a
re-fetch**, while a quoted sentence usually does.

## 1. Pages fetched (all 11, including the ones that no longer resolve)

| file | source URL | fetched (Z) | HTTP | bytes | sha256 (first 16) | page `last-modified`/`etag` |
|---|---|---|---|---|---|---|
| `code.claude.com_docs_en_hooks.html` | https://code.claude.com/docs/en/hooks | 2026-10-28T22:47:31Z | **200** | 2,616,712 | `be3edf6a150d72d1` | Wed, 28 Oct 2026 22:08:14 GMT |
| `code.claude.com_docs_en_skills.html` | https://code.claude.com/docs/en/skills | 2026-10-28T22:47:31Z | **200** | 926,767 | `7603e4b409705b52` | Wed, 28 Oct 2026 22:08:14 GMT |
| `cursor.com_docs_context_rules.html` | https://cursor.com/docs/context/rules | 2026-10-28T22:47:31Z | **200** | 514,147 | `bfde51ac1ed89008` | "1ebb10f59463add912ee77ba0752163d" |
| `cursor.com_docs_hooks.html` | https://cursor.com/docs/hooks | 2026-10-28T22:47:32Z | **200** | 1,284,353 | `9698248e28a0a14f` | "ffd26fdfde1fc62fe5c296681531b68c" |
| `developers.openai.com_codex_agent-approvals-security.html` | https://developers.openai.com/codex/agent-approvals-security | 2026-10-28T22:47:32Z | **200** | 467,767 | `23d69fc09659b6a7` | Wed, 28 Oct 2026 22:19:17 GMT |
| `docs.cline.bot_features_cline-rules.html` | https://docs.cline.bot/features/cline-rules | 2026-10-28T22:47:33Z | **200** | 286,014 | `ca7dc20c5a542abf` | Wed, 28 Oct 2026 20:06:35 GMT |
| `learn.chatgpt.com_docs_config-file.html` | https://learn.chatgpt.com/docs/config-file | 2026-10-28T22:47:34Z | **404** | 478,709 | `d01059b074e52f73` | Wed, 28 Oct 2026 22:16:54 GMT |
| `learn.chatgpt.com_docs_config-file_config-advanced.html` | https://learn.chatgpt.com/docs/config-file/config-advanced | 2026-10-28T22:47:34Z | **200** | 554,650 | `e3c26063d08c9a82` | Wed, 28 Oct 2026 22:24:08 GMT |
| `learn.chatgpt.com_docs_config-file_config-basic.html` | https://learn.chatgpt.com/docs/config-file/config-basic | 2026-10-28T22:47:34Z | **200** | 416,377 | `a4fbd7854c17c1d2` | Wed, 28 Oct 2026 22:20:25 GMT |
| `learn.chatgpt.com_docs_hooks.html` | https://learn.chatgpt.com/docs/hooks | 2026-10-28T22:47:34Z | **200** | 528,904 | `8afe47ec82cf389e` | Wed, 28 Oct 2026 22:18:23 GMT |
| `learn.chatgpt.com_docs_skills.html` | https://learn.chatgpt.com/docs/skills | 2026-10-28T22:47:35Z | **404** | 478,709 | `d01059b074e52f73` | Wed, 28 Oct 2026 22:16:54 GMT |

**Two rows are `404`** — `learn.chatgpt.com/docs/config-file`, `learn.chatgpt.com/docs/skills` (the fetched bytes are an
error page, excluded from verification) and any Goose path listed in §2. **A dead URL in an evidence table is worse than no
URL, because it reads as evidence** (ROADMAP **243**).

## 2. Load-bearing phrases the delegate found in our copies (2026-10-28)

| phrase or token (verbatim from the page) | found in |
|---|---|
| "scales at 1% of the model's context window" | `code.claude.com_docs_en_skills.html` |
| "truncated at 1,536 characters in the skill listing" | same |
| "keeping the first 5,000 tokens of each" · "combined budget of 25,000 tokens" | same |
| `/skill-doctor` · `/run-skill-generator` · `/verify` | same |
| `project_doc_max_bytes` · `project_doc_fallback_filenames` · `thread.skills.truncated` · `skill.injected` · `history.jsonl` · `hooks.json` · `PreToolUse` | `learn.chatgpt.com_docs_config-file_config-advanced.html` |
| `beforeShellExecution` · `failClosed` · `pluginPaths` | `cursor.com_docs_hooks.html` |
| "hook failures (crash, timeout, non-zero exit code, no output) block the action instead of allowing it through" | same |
| "Keep rules under 500 lines" | `cursor.com_docs_context_rules.html` |
| "If frontmatter can’t be parsed, Cline **fails open**. The rule activates with raw content visible to help debugging." | `docs.cline.bot_features_cline-rules.html` — **found verbatim**, alongside `clinerules` (11 hits), `Cline/Rules` (6), `paths: []` "means the rule never activates", and `AGENTS.md` auto-detection (3 hits). This is a **fourth fail-open design** beside Codex/Copilot CLI/Cursor: a malformed rule *activates anyway* — see `docs/reviews/codex-enforcement-design-2026-10-28.md` §2 |

**Goose.** The report's three vendor-site paths (`…/getting-started/using-extensions`,
`…/goose-architecture/extensions-design`, `…/guides/recipes/recipe-reference`) are **404**. Resolvable equivalents exist in
the pinned clone: `vendor/eval/goose/documentation/docs/tutorials/recipes-tutorial.md` and
`…/documentation/docs/` generally, at `775b3958` — cite repo paths at a pin, not dead site paths.

## 3. GitHub issue pages fetched by the delegate (2026-10-28) — and a citation error **the delegate made**

The delegate fetched each cited issue **by number** and read its `<title>`. **The round-2 report's issue citations are
sound**; the mis-attribution was introduced **during folding**, when this delegate attached the report's skills-issue
numbers to its hooks/deny-rule claims and propagated them into `docs/COMPETITORS.md`, `docs/ROADMAP.md` **238**, and two
review files. All of those have now been corrected to the citations below.

**What the report's own numbers actually are (both correct for the claims it attached them to):**

| issue | title as fetched (2026-10-28) | the report's use of it | verdict |
|---|---|---|---|
| [#978](https://github.com/github/copilot-cli/issues/978) | "Skills are not used unless explicitely stated" | skill advertisement unused unless named | **correct** |
| [#4438](https://github.com/github/copilot-cli/issues/4438) | "`disable-model-invocation: true` makes a skill unreachable, not manual-only (Skill not found on explicit invocation)" | a visibility flag turns into a hard block | **correct** — and directly relevant to our own `exposure`/`"hidden"` question |
| #3122 | "Display Plugin name after skill name when using /skills command to display skill list" | (delegate checked it while auditing; not a report citation) | skills-surface noise, no bearing |
| #3123 | "/research can't write it's research report" | (delegate checked; **not** "Skill tool calls fail after SessionStart hook") | the round-2 row that maps to this claim cites a **dangling** anchor |

**What is still unverified in the report:** its Copilot **hooks/deny-rule** claims — "deny-rule hook times out at 10 s with
no way to reload a changed rules file" and "`sandbox:workspace-write` cannot read `~/.copilot` (macOS TCC)" — are cited to
`[^b736c3#L18-24]` / `[^b736c3#L26-40]`, an **undefined anchor to an unidentified page**. The URLs resolve, but the citation
is not checkable as written.

**The claim survives; the citation was the wrong one.** Searching that tracker (`api.github.com/search/issues`, 2026-10-28)
finds issues that support the fail-open conclusion **better** than anything round 2 cited:

| real issue | title (verbatim from `<title>`) | what it establishes | our copy, sha256 (first 16) |
|---|---|---|---|
| [#2893](https://github.com/github/copilot-cli/issues/2893) | "preToolUse hooks silently bypassed under parallel tool calls (timeout->allow fallback + serial dispatch…)" | **the fail-open mechanism, named in the vendor's own tracker**: a hook timeout falls back to *allow*, and parallel dispatch skips the hook | `aff0aab82d7542fb` |
| [#3590](https://github.com/github/copilot-cli/issues/3590) | "PreToolUse hook permissionDecision: \"ask\" auto-approved by TUI since v1.0.53" | a guard's **ask** silently became an **allow** — the exact confusion ROADMAP **238** forbids | `5f18b361fea55c7e` |
| [#2540](https://github.com/github/copilot-cli/issues/2540) | "Plugin-defined preToolUse hooks (hooks.json) do not fire - neither in main session nor subagents" | **which plane a guard is declared on decides whether it runs at all.** Directly load-bearing for 241's trust question and for D158's package-installed-guard plan | `63f5a107dcc720a4` |
| [#5098](https://github.com/github/copilot-cli/issues/5098) | "sessionStart hook stops running after adding `sandbox.userPolicy.filesystem` paths" | a **sandbox config edit silently disables a guard** — the planes interfere | `f2fa8466dc01a2f0` |
| [#4508](https://github.com/github/copilot-cli/issues/4508) | "Feature request: reload .github/instructions mid-session (long-running sessions never pick up instruction updates)" | the closest real support for the report's "no way to reload" claim — and it is a **feature request about *instructions***, not deny rules, so that claim stays **unverified** | `5bdc488c2d1f247e` |

**Lesson, stated as protocol:** an issue number is portable *only if it points where claimed*, and a wrong pointer is worse
than none because it reads as verified. **Fetch the cited page or issue and read its title before repeating a claim** —
that is now a required step in `docs/runbooks/research-request.md` (Do 5, Verify) alongside the quote check (D159).
