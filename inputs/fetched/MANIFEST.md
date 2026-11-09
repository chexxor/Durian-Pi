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

## 4. Round 3 corpus (fetched 2026-10-28 22:55–23:11Z, Linux, `UTC−5`) — the protocol held

Round 3 came back under the D159 contract — 61 numbered citations, each a URL + fetch date + short verbatim quote. The
delegate fetched every one and **grepped each quote in its own copy**. **91 of 94 fragments located literally** (77 of 80
vendor-page fragments, 14 of 14 issue-body fragments); the seven distinct page URLs all returned **200**. The three literal
misses are itemised below — two are wording differences over true content, one is a real citation defect.

| copy | source URL | fetched | HTTP | bytes | sha256 (first 16) |
|---|---|---|---|---|---|
| `code.claude.com_docs_en_hooks.html` | https://code.claude.com/docs/en/hooks | 2026-10-28T23:11Z | 200 | 2,616,712 | `be3edf6a150d72d1` |
| `learn.chatgpt.com_docs_hooks.html` | https://learn.chatgpt.com/docs/hooks | 2026-10-28T23:11Z | 200 | 528,904 | `8aea9e0090cae6ed` |
| `cursor.com_docs_hooks2.html` | https://cursor.com/docs/hooks | 2026-10-28T23:11Z | 200 | 1,284,353 | `9698248e28a0a14f` |
| `docs.cline.bot_customization_cline-rules.html` | https://docs.cline.bot/customization/cline-rules | 2026-10-28T23:11Z | 200 | 286,014 | `ca7dc20c5a542abf` |
| `docs.github.com_en_copilot_reference_hooks-reference.html` | https://docs.github.com/en/copilot/reference/hooks-reference | 2026-10-28T23:11Z | 200 | 1,100,766 | `1205d0fab476f227` |
| `goose-docs_ai_docs_getting-started_using-extensions_.md` | https://goose-docs.ai/docs/getting-started/using-extensions/ | 2026-10-28T23:11Z | 200 | 109,894 | `893bcc570b64482b` |
| `goose-docs_ai_docs_guides_recipes_recipe-reference_.md` | https://goose-docs.ai/docs/guides/recipes/recipe-reference/ | 2026-10-28T23:11Z | 200 | 231,779 | `ecb11272fd4dc3ef` |
| `gh-copilot-cli_issue_2893.html` | https://github.com/github/copilot-cli/issues/2893 | 2026-10-28T22:55Z | 200 | 531,316 | `aff0aab82d7542fb` |
| `gh-copilot-cli_issue_3590.html` | https://github.com/github/copilot-cli/issues/3590 | 2026-10-28T22:55Z | 200 | 318,307 | `5f18b361fea55c7e` |
| `gh-copilot-cli_issue_2540.html` | https://github.com/github/copilot-cli/issues/2540 | 2026-10-28T22:56Z | 200 | 809,034 | `63f5a107dcc720a4` |
| `gh-copilot-cli_issue_5098.html` | https://github.com/github/copilot-cli/issues/5098 | 2026-10-28T22:56Z | 200 | 257,972 | `f2fa8466dc01a2f0` |

**The three fragments that did not match literally, and what they actually say** (checked 2026-10-28, so the record is
complete rather than a tidy pass):

- **C26** (Cursor precedence) — found, but worded: "any **deny** wins over **ask**, and **ask** wins over **allow**,
  regardless of source". Their quote used backticks where the page has bold. **Confirmed.**
- **C6b** (Claude Code spill) — found as "writes the text to a file in the session directory and passes Claude the file path
  with a **preview of up to the first 2,000 characters**". Their "2,000-char preview" is a paraphrase in the Q4 table, not a
  quotation. **Confirmed, but it should have been marked as a paraphrase.**
- **A1c** (Goose) — **not found.** The recipe page does not name `aaif-goose` anywhere, and links `validate_recipe.rs` with no
  owner at all. The *substance* is nonetheless true, established independently below, but **the citation as given does not
  support it** — the one real defect in an otherwise clean round.

**Independent check of the Goose owner claim** (delegate, 2026-10-28, via `api.github.com`): `block/goose` returns **HTTP 301**;
`aaif-goose/goose` returns **200** with `full_name: aaif-goose/goose`. So the canonical owner *has* moved — which means **our
pinned clone's remote URL has moved out from under it**: `git -C vendor/eval/goose remote get-url origin` still reads
`https://github.com/block/goose`, and `docs/VENDOR-PINS.md` records **no remote at all**, so a repo that changes orgs is
invisible to `--check`. Registered on ROADMAP **242**.

**Issue-body quotes round 3 asked the delegate to verify** (all from the copies above):

| quote | where | found in our copy? |
|---|---|---|
| "implicit allow (fail-open)"; "stray log line on stdout"; "read once at session start"; the v1.0.104 control "all 10 denied, the last after waiting ~18 s" | #2893 | **yes, all four** — and the reporter's qualifier is present: "**when no response is received in the configured timeout**. … Not a Copilot defect." |
| "never executed"; "as of 1.0.57 those errors **deny** instead of silently passing"; `PLUGIN_ROOT` absent | #2540 | **yes** — including the version pair (1.0.18 open, 1.0.57 closed) |
| "never runs again. `/env` still lists the hook" | #5098 | **yes** |
| "immediately auto-approved"; `79ms`; since v1.0.53 | #3590 | **yes** — written `79ms` with no space, measured from **a v1.0.56 session**, so the number belongs with that version |

## 4. Delegate re-fetch of 2026-10-29 — the columns the research sandbox cannot fill (ROADMAP 249)

The research sandbox states it plainly: *"no response headers. There is no shell, so no `sha256sum`"*
(`docs/reviews/harness-tools-skills-public-harnesses-research-4.md`). Those columns are therefore **delegate-obtained,
on this host** (`label-withheld-per-D205`, Fedora `7.2.11-200.fc44.x86_64`, Linux, fetched 2026-10-29T03:10Z = 2026-10-28
22:10Z host-local, `America/Chicago` CDT; copies in gitignored `.spike/fetch-r4/`):

| requested URL | final URL after redirect | HTTP | bytes | sha256 (first 16) | vs §1 pin |
|---|---|---:|---:|---|---|
| `https://cursor.com/docs/context/rules` | unchanged | 200 | 514,147 | `bfde51ac1ed89008` | **identical to §1** |
| `https://docs.cline.bot/features/cline-rules` | `…/customization/cline-rules` | 200 | 286,014 | `ca7dc20c5a542abf` | **identical to §1 — the path moved** |

**Two rules this settles.** (1) A sha256 column is worth having: the bytes reproduced exactly one day later. (2) A MANIFEST
row must record the **final** URL, not the requested one — the Cline locator rotted (`features/` → `customization/`) while
the bytes did not, so a row can be byte-reproducible and still unfindable. And **line-number anchors survive neither
event**: round 4's copies are `web_fetch` markdown (476 / 1,073 lines), these are HTML (514 KB / 286 KB); there is no
mapping. For the five harnesses now pinned in `docs/VENDOR-PINS.md`, re-anchor at the **pin** (`grep` the source doc),
not at the page; for web-only vendors, only ≤40-word quotes are portable (D159).

**Source-level proof that three round-2 anchors are page chrome, not content.** `vendor/eval/cline` at pin `51f63e4`
carries the doc that generates that page: `docs/customization/cline-rules.mdx`, **398 lines**, which mentions
"Memory Bank" **0 times** — so `[^d32e06#79]` (and `#63`, "Hooks") cannot be content anchors. Confirmed in the fetched
bytes too: "Memory Bank" appears only as `data-title="Memory Bank"` sidebar markup and in nav JSON
(`"group":"Best Practices","pages":[{"title":"Memory Bank"…`).

**User-report rows the §1 table does not cover** (three GitHub issues round 2 cites as `[^12] [^13] [^14]`; read from
`api.github.com` at 2026-10-29T03:10Z — the API is the stable surface, the HTML issue page is not pinned):

| key | issue | state (2026-10-29) | reactions | comments |
|---|---|---|---:|---:|
| `[^12]` | `anthropics/claude-code#57776` | **closed**, `state_reason: duplicate` | **0** | 3 |
| `[^13]` | `github/copilot-cli#4438` | **open** | 19 | 12 |
| `[^14]` | `github/copilot-cli#978` | **open**, `state_reason: reopened` | 8 | 12 |

`[^14]`'s state matters directly: a round-4 correction claimed it was "author closed as model issue" — **false**, it is
open and reopened. `[^13]`'s #4438 thread (comment 2026-09-11) is what settles the direction of that finding: *"the
explicit slash invocation successfully injects `<skill-context name="wayfinder">` … the assistant then redundantly calls
`skill` … which returns `Skill not found`"*. Verdicts on all four round-4 corrections:
`docs/reviews/harness-r4-verification-2026-10-29.md`.

## 6. URLs probed live by the delegate (machine-readable for `tools/review-cite-check.mjs`)

Probed **2026-10-29T03:55:36Z** (host-local Wed Oct 28 22:55 CDT, UTC−5) on `label-withheld-per-D205`, Linux Fedora
`7.2.11-200.fc42.x86_64`, `curl -sSL -m 20 -w '%{http_code} %{url_effective}'`. The three Goose site paths the round-2
report cites as `[^4] [^9] [^10]` (and prints again in its §2 matrix rows 17–19) are **dead today, with no redirect** —
so the §2 cells labelled `advertised-elsewhere` point at a page that does not exist, which is exactly ROADMAP **243**'s
failure mode. Two more rows are **not dead but moved**: the cited locator rots while the page lives, which no
"does it resolve?" check catches and no re-fetch of the old URL shows.

| file | source URL | probed (Z) | HTTP | final URL, or where to re-anchor |
|---|---|---|---|---|
| not fetched — 404 at probe | https://block.github.io/goose/docs/getting-started/using-extensions | 2026-10-29T03:55:36Z | **404** | re-anchor at `goose 775b3958` — `vendor/eval/goose/documentation/docs/` |
| not fetched — 404 at probe | https://block.github.io/goose/docs/goose-architecture/extensions-design | 2026-10-29T03:55:36Z | **404** | re-anchor at `goose 775b3958` — `documentation/docs/goose-architecture/extensions-design.md` (127 lines by `wc -l`; no trailing newline, so 128 content lines) |
| not fetched — 404 at probe | https://block.github.io/goose/docs/guides/recipes/recipe-reference | 2026-10-29T03:55:36Z | **404** | re-anchor at `goose 775b3958` — `documentation/docs/tutorials/recipes-tutorial.md` |
| redirect, page live | https://docs.cline.bot/features/cline-rules | 2026-10-29T03:55:36Z | **200** | https://docs.cline.bot/customization/cline-rules |
| redirect, page live | https://cursor.com/docs/context/rules | 2026-10-29T03:55:36Z | **200** | https://cursor.com/docs/rules |

**A control that matters:** a probe without `-L` (or with `redirect: "follow"` disabled) reports both moved rows above as
`308`, which a naive checker calls *dead*. `curl -sS -o /dev/null -w '%{http_code}'` without `-L` returned **308** for both.
Classify 3xx as *moved*, never as dead; the 404s above return 404 with or without `-L`.

## 7. The milestone doc's three references, fetched by the delegate (2026-11-07) — the milestone's inputs are now checkable

`docs/reviews/ensuring-llm-task-completion-research.md` arrived as **milestone source material authored by the operator**
(a raw model reply) with three footnoted references that **neither the delegate nor the team had fetched** — so at intake
(`docs/reviews/task-completion-milestone-intake-2026-11-07.md` §0) none of its six proposals was evidence, only task input.
They are fetched now. Host signature measured with the fetch: **Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0** (probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version`). Fetch: `curl -sS -L -m 60 -D <hdr> -o <file> -w %{http_code} <url>`.

| file | source URL | fetched (Z) | HTTP | bytes | sha256 (first 16) | page's own `last-modified`/`etag` |
|---|---|---|---|---|---|---|
| `www.anthropic.com_research_effective-context-engineering-for-ai-agents.html` | https://www.anthropic.com/research/effective-context-engineering-for-ai-agents | 2026-11-07T02:00:00Z | **200** | 206,036 | `813eba6339d268ba` | none printed |
| `platform.claude.com_cookbook_tool-use-context-engineering-context-engineering-tools.html` | https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools | 2026-11-07T02:00:01Z | **200** | 587,180 | `3463fd9d438f03a0` | none printed |
| `www.mindstudio.ai_blog_context-rot-ai-agents-session-handoff-fix.html` | https://www.mindstudio.ai/blog/context-rot-ai-agents-session-handoff-fix | 2026-11-07T02:00:01Z | **200** | 109,172 | `d365a5726b2333f4` | `etag: "916f85a7918e1e8d95d3061058a167c1"` |

**All three resolve (200).** No `last-modified` on the two vendor pages, so the sha is the only pin — which is why the
quote-not-line-range rule (ROADMAP **243**, D159) is what makes this section usable.

### 7.1 What the milestone doc claims, checked against our copies (2026-11-07T02:00Z)

| the doc's claim (as written in `ensuring-llm-task-completion-research.md`) | found in our copy? | verdict |
|---|---|---|
| "as the number of tokens in the context window increases, the model's ability to accurately recall information … decreases" (its "context rot" premise) | `…effective-context-engineering-for-ai-agents.html` — verbatim, including "While some models exhibit more gentle degradation than others, this characteristic emerges across all models" | **supported, verbatim** |
| "Context is a finite resource with diminishing marginal returns, not just a size limit" | same file — "Context, therefore, must be treated as a finite resource with diminishing marginal returns." | **supported, verbatim** |
| subagents "burn tens of thousands of tokens … return a 1–2k-token digest" | same file — "Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens)." | **supported, verbatim** |
| "a compaction summary preserved 3/3 high-level facts but 0/3 obscure specifics" | the cookbook page — the notebook's own printed output: `RESULT: high-level 3/3 preserved, obscure 0/3 preserved` | **supported, but it is ONE demo run's printed output on a biology-document task, not a benchmark.** Cite it as a worked example, never as a rate. |
| "cap every tool result server-side … Token-efficient tools are a context-engineering lever" | the cookbook page names the vendor levers: `clear_tool_uses`, "server-side compaction", "**context editing** … (which includes tool-result clearing)", "the memory tool" | **supported** — and it names the exact API-side feature; see §7.2 for what our pin does and does not expose |
| handoffs "more effective when proactive (threshold-triggered) than reactive (symptom-triggered)" | `…context-rot-ai-agents-session-handoff-fix.html` — "Proactive handoffs happen automatically, on a schedule or threshold. For example: 'Every 80,000 tokens, summarize and restart.'" | **supported, verbatim** |
| "a structured state object reduces that risk" | same file — "Using a structured state object (rather than free-form text summaries) significantly reduces this risk." | **supported, verbatim** (it is the page's FAQ prose: `advertised-elsewhere`, not a measurement) |
| **"an agent at 90 % of its window is the worst possible judge of how much room it has left"** | the string `90%` appears in **none** of the three copies | **NOT sourced — the doc's inference.** The pages support "recall degrades as tokens grow"; they do not support a claim about the model's *self-assessment* at 90 %. Keep the inference, label it one. |
| **"Measure the floor first: one API call with an empty message list … (often 5–15k)"** | `5-15k` / `5–15k` in none of the three copies | **NOT sourced.** The *method* is sound and cheap (we can run it: `usage.prompt_tokens` of a system-plus-tools-only request); the "5–15k" figure is the model's own estimate and must be replaced by a measurement per family. |

### 7.2 One place the doc contradicts the source it cites, and one place the substrate has no knob for it

- **Bands vs "no clean threshold".** The doc §1 prescribes hard token bands (60k/80k/95k/110k) and a controller that enforces
  them. Its own `[^3]` says the opposite about the boundary: *"Context rot doesn't hit a clean threshold. It's a gradual
  process … Token Count Isn't the Only Variable — A 50,000-token context might still perform well if the relevant
  information is near the beginning and end."* So the bands are a **policy choice, not an empirical boundary** — which is
  exactly why the intake's rule ("do not adopt the doc's 130k bands; compute per family") is right, and why the bands should
  be stated as fractions of each family's declared window. Worked per family in
  `docs/reviews/task-completion-milestone-intake-2026-11-07.md` §6.
- **Tool-result clearing has no substrate primitive at our pin.** `grep -rn "clear_tool\|context_management\|contextEditing"
  vendor/pi-main/packages/ --include="*.ts"` → **no matches** at the pin. What the pin DOES have is the general
  `ContextEdit { target: EntryId, action: "omit" | "replace", messages }` at
  `vendor/pi-main/packages/durable/src/types.ts:412-426` (applied in `harness/context.ts:145,223` and
  `harness/prompt.ts:74`) — which is precisely the mechanism a tool-result-clearing band needs. The rows that already own it
  are the held pair **#2402/#2403** ("`#2233 (1/2) — D107 mask-only at 80 % via ContextEdit omit/replace … + summarize-at-
  transition + preserve pointers + cap-2 + forced …`"), gated behind the compaction-cluster fold (ROADMAP 92/94, #5220).
  The vendor feature is **server-side**; ours would be **store-side** — same effect, different owner, and it keeps the raw
  entries append-only (D105/D107's non-destructive property).

## 8. The follow-up research report's citations — fetched 2026-11-07T05:15:43Z

Report: `docs/reviews/task-completion-followup-research.md` (arrived untracked at 25,141 B; committed this session).
Prompt it answers: `docs/reviews/task-completion-followup-research-prompt.md`. Quote-check ran as
`.spike/delegate-20261107/quote-check-followup.mjs` (entity-normalized exact substring search):
**25 of the 26 quotes located verbatim in our copies**; the one miss is a fetch that was refused.

| file | source URL | fetched (Z) | HTTP | bytes | sha256 (first 16) | page's own last-modified | quotes found here |
|---|---|---|---|---|---|---|---|
| `platform.claude.com_docs_en_build-with-claude_context-editing.html` | https://platform.claude.com/docs/en/build-with-claude/context-editing | 2026-11-07T05:15:39Z | 200 | 1,846,303 | `9ce9667c441caf98` | not sent | 5/5 (§1–5) |
| `www.anthropic.com_engineering_effective-context-engineering-for-ai-agents.html` | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2026-11-07T05:15:39Z | 200 | 206,036 | `813eba6339d268ba` | not sent | 5/5 (§6–10) |
| `www.anthropic.com_engineering_effective-harnesses-for-long-running-agents.html` | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | 2026-11-07T05:15:40Z | 200 | 191,377 | `d7e7f9b4de9828b7` | not sent | 4/4 (§11–14) |
| `github.com_earendil-works_pi_issues_8651.html` | https://github.com/earendil-works/pi/issues/8651 | 2026-11-07T05:15:40Z | 200 | 246,452 | `1d19faced44a9927` | not sent | 2/2 (§15–16) |
| `arxiv.org_html_2604.14228v3.html` | https://arxiv.org/html/2604.14228v3 | 2026-11-07T05:15:41Z | 200 | 798,527 | `a1bcabcec107daa0` | 2026-10-14T00:58:32Z | 6/6 (§17–22) |
| `docs.vllm.ai_en_latest_features_per_request_metrics.html` | https://docs.vllm.ai/en/latest/features/per_request_metrics/ | 2026-11-07T05:15:41Z | 200 | 208,967 | `cbe8bbc68076b51f` | 2026-11-03T20:13:56Z | 1/1 (§23) |
| `www.simplified.guide_llama-cpp_server-enable-metrics.html` | https://www.simplified.guide/llama-cpp/server-enable-metrics | 2026-11-07T05:15:42Z | 200 | 157,477 | `d25c15d80d566a60` | not sent | 1/1 (§24) |
| `github.com_tontinton_maki_issues_301.html` | https://github.com/tontinton/maki/issues/301 | 2026-11-07T05:15:43Z | 200 | 460,526 | `31ee8718427aec7b` | not sent | 1/1 (§25) |
| `www.researchgate.net_publication_400858436_context_is_what_you_need.html` | https://www.researchgate.net/publication/400858436_Context_Is_What_You_Need_The_Maximum_Effective_Context_Window_for_Real_World_Limits_of_LLMs | 2026-11-07T05:15:43Z | **403** | 21,291 | `ba7d8a49b1ebc004` | n/a | **0/1 (§26) — `unverified`: the fetch was refused by the host (bot block); the saved body is the 403 page, kept so the failure is reproducible** |

Notes that matter to a later reader:

1. **The `/engineering/` and `/research/` paths of the context-engineering article are byte-identical** — this session's
   copy (`813eba6339d268ba`) matches §7's copy fetched from the `/research/` URL. So §7 and §8 corroborate rather than
   duplicate, and a citation to either URL resolves.
2. **pi #8651 is confirmed closed unactioned, at the source**: the fetched HTML carries
   `"state":"CLOSED","stateReason":"NOT_PLANNED"`, opened 2026-08-25T23:20:28Z by `rahulrajaram`, body containing both
   quoted sentences. It is an issue against **our own substrate's repo** (`pi-main.pin.json` →
   `https://github.com/earendil-works/pi.git`, pinned sha `2ec55d808d455b1a64a2bf7888198207a096120a`, pinned 2026-10-19 —
   *after* the issue was closed). So no upstream fix predates our pin, and the shape is live here:
   `vendor/pi-main/packages/durable/src/harness/generation.ts:355-356` reads
   `const blocking = contextWindow - policy.reserveTokens; const background = blocking - policy.backgroundTokens;` —
   no clamp to a fraction of the window. That is the exact formula the issue quotes, and it is what makes our verifier
   family's background threshold negative (−24,576 at the defaults).
3. Supporting strings probed and found in the same copies (not quoted in the table): `clear_tool_uses` (77×),
   `clear_at_least` (19×), `cleared_tool_uses` (3×), `cleared_input_tokens` (6×) in the context-editing doc;
   `maxTurns`, `microcompact` in the arXiv analysis; `claude-progress.txt` (6×), `init.sh` (10×) in the harness doc.
   One string the report used in prose is **not** in the copy it cited: `clear_tool_inputs` appears in the
   context-editing doc (6×), not in the arXiv analysis (0×) — cite the doc for it.

> **Untracked by policy (measured 2026-11-07):** `git check-ignore -v` resolves these page files to
> `.gitignore:75:inputs/fetched/*.html` — the ignore rule at `.gitignore:73-75` records the reason (re-fetchable, too big to
> track). `git ls-files inputs/fetched/` lists only `MANIFEST.md` and `README.md`. **The rows in this file are the durable
> record**; the `.html` copies are checksummed scratch. (`inputs/fetched/README.md` still claims the directory is tracked —
> that sentence is stale; see pitfall 76 in `docs/SELFDEV.md`.)
