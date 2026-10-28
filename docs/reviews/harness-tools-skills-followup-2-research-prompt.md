# Research prompt — tool/skill lifecycle, round 3: evidence integrity + the closed-harness gaps

> **This prompt is self-contained.** A research agent runs in its own context window, with no memory of the
> rounds that produced it. Everything it needs is in this file. Read every path listed under **Start here**
> before writing anything.
>
> **Written:** 2026-10-29 by the durian-pi delegate, from `docs/reviews/harness-tools-skills-research.md`
> (round 1, observed) and `docs/reviews/harness-tools-skills-public-harnesses-research.md` (round 2, public
> docs). **Parent prompt chain:** `harness-tools-skills-research-prompt.md` →
> `harness-tools-skills-followup-research-prompt.md` → this file.
>
> **Two tasks, one deliverable.** Task A repairs the evidence chain of the round-2 report. Task B answers the
> six questions that report could not. Do Task A first; it is mechanical and it is blocking.

## Start here

- The original study prompt: `docs/reviews/harness-tools-skills-research-prompt.md` (the question set, the
  four-axis frame, the evidence rule).
- Round 1, observed over 10 systems: `docs/reviews/harness-tools-skills-research.md`.
- **Round 2, the report you must repair:** `docs/reviews/harness-tools-skills-public-harnesses-research.md`.
- The evidence discipline you are being held to: `docs/runbooks/research-request.md` ("every external claim
  carries a URL and an evidence class", and the rule that a report which does not cite sources gets
  downgraded to unverified).
- The finding this research feeds: `docs/reviews/pi-harness-usage-audit-2026-10-28.md` — skills are 15% of
  tool calls, ad-hoc work is 11–24%.

## What changed since you last ran (read this before you search for anything)

Five harnesses are now **pinned git clones in this repo**, under `vendor/eval/`, recorded in
`docs/VENDOR-PINS.md`:

| clone | pinned HEAD | what is in it |
|---|---|---|
| `vendor/eval/codex` | `d373d649` | OpenAI Codex CLI **full Rust source** (`codex-rs/`) + `docs/` |
| `vendor/eval/cline` | `51f63e4f` | Cline **full TypeScript monorepo** (`apps/`, `sdk/`) |
| `vendor/eval/goose` | `775b3958` | Goose **full Rust source** (`crates/`) + `documentation/docs/` |
| `vendor/eval/claude-code-docs` | `58d6da1e` | Claude Code **CHANGELOG + docs + plugins only** — no implementation |
| `vendor/eval/copilot-cli` | `84ee80ea` | GitHub Copilot CLI **README + `install.sh` + changelog only** — the CLI itself is closed |

**Do not re-clone and do not answer source-level questions.** Anything readable from those five trees
(Codex policy/approval engine, hook trust storage, `project_doc_max_bytes`, Cline rule-merge and `paths:`
matching, Goose recipe library write-back at `crates/goose/src/recipe/local_recipes.rs:155,194`, Goose
doc paths under `documentation/docs/`) is the delegate's job now, at a pin. If a question you were asked can
be answered by reading one of those trees, say so in one line and move on.

**Your scope is the closed and product-level surface only:** Claude Code (no public source), Cursor (no
public source), plan/edition gating, headless/CI behaviour, defaults vs opt-in, roadmap/deprecation notices,
and pricing/quota mechanics that only vendor pages state.

## Task A — repair the round-2 evidence chain (blocking)

Verified against the report as committed (`318838f5`):

1. **50 of 64 in-body citation markers are dangling.** They are hash-and-line anchors of the form
   `[^542f21#49]`, `[^20106b#1026]`, `[^d32e06#246]`, `[^5389e9#216]`, `[^04a0b7#43]`, `[^3d9c8f#177]`,
   `[^dccefb#400]`, `[^5f6188#593]`. Each names a page it fetched into `inputs/fetched/` — and that directory
   **is not in this repo**. So on this host those line ranges cannot be opened.
2. The footnote definitions at the end of the report are a different, working set (`[^1]`…`[^14]`), each with
   a URL and a class. Those are fine.

Do both halves of the repair:

- **A1.** Re-emit the in-body markers so a reader with only this repo can resolve them: either map each one to
  its `[^1]`…`[^14]` URL (keeping the line range), or renumber the body to the existing table. Keep the line
  ranges — they are what make a claim checkable. A claim you cannot resolve to a URL becomes
  `unverified`, stated as such in the body.
- **A2.** Ship the fetched corpus. For each page you cite, deliver the file plus a manifest row: source URL,
  fetch date, HTTP status, sha256 of the file you cited, and the page's own `last-modified` / "last updated"
  marker if it shows one. Put them at `inputs/fetched/` and the manifest at `inputs/fetched/MANIFEST.md`.
  Without the corpus, a line-range citation is a claim about a page nobody can re-open.

**Already confirmed by the delegate on 2026-10-29, from the live pages — do not re-verify, and correct your
report if any of this contradicts it:** the Claude Code skills page states the listing budget "scales at 1%
of the model's context window", `description` + `when_to_use` "truncated at 1,536 characters", re-attached
skills keep "the first 5,000 tokens of each" within a "combined budget of 25,000 tokens", and it names
`/skill-doctor`, `/run-skill-generator` and `/verify`; the Codex `config-advanced` page does contain
`project_doc_max_bytes`, `project_doc_fallback_filenames`, `thread.skills.truncated`, `skill.injected`,
`history.jsonl`, `hooks.json` and `PreToolUse`; the Cursor hooks page does contain `beforeShellExecution`,
`failClosed` and `pluginPaths` — and it states the default exactly: with `failClosed: true`, "hook failures (crash,
timeout, non-zero exit code, no output) block the action instead of allowing it through", which means **the default is
fail-open**; the Cursor rules page states "Keep rules under 500 lines" as guidance.

**Your three Goose citations are dead links** (`.../getting-started/using-extensions`,
`.../goose-architecture/extensions-design`, `.../guides/recipes/recipe-reference` all return 404). Replace
them with citations into the pinned clone — `vendor/eval/goose/documentation/docs/...` at `775b3958` — or with
working live URLs. A dead URL in an evidence table is worse than no URL, because it looks like evidence.

## Task B — the six open questions

Answer each with a table row per harness: **Claude Code · Codex CLI · Cursor · Cline · Goose · GitHub Copilot
CLI**. Where you cannot find it, write `not found`, and say where you looked.

**Q1 — injection budgets, for the harnesses that hide theirs.** Claude Code's numbers are established above.
Find the equivalent numbers, or state that none are published, for: Codex's AGENTS.md budget (units, cap,
what happens on truncation and whether the model is told), Codex's skill-truncation thresholds, Cursor's rules
budget ("Keep rules under 500 lines" is confirmed on the live page as **guidance, not enforcement** — find out
whether any hard cap exists at all, and get the same for the other five), Cline's per-file rule budget, Goose's
recipe injection budget.

**Q2 — defaults, not capabilities, for destructive-verb guarding.** For every guard you found in round 2
(Claude Code hooks, Cursor `beforeShellExecution` + `failClosed`, Cline hooks, Codex `PreToolUse`/`hooks.json`,
Copilot CLI deny rules): is it **on by default, opt-in, or opt-out**, and does a **team** get it from a repo
commit or must each developer install it? Quote the sentence that decides it.

**Q3 — headless and CI behaviour.** When any of these runs non-interactively (`-p`, `--print`, `ci`,
`--no-interactive`, GitHub Actions), what happens to a permission or approval request that would have asked a
human: denied, auto-approved, or queued? What happens to a hook that times out — is the command allowed or
blocked, and is that documented or only implied? For Codex, cite the vendor statement of the approval-policy
escalation ladder in non-interactive mode.

**Q4 — who can a guard be bypassed by, and is that visible.** For each harness: does an approval, an
allow-rule, or a hook decision get **stored**, and can a later non-interactive session inherit it? Does any of
them record the decision anywhere a reviewer can read? (Round 2 found Codex persists hook trust
out-of-band, in an `mcp-oauth`-shape, outside config and outside git. Confirm, and find whether Claude Code,
Cursor, Cline and Copilot CLI do the same.)

**Q5 — capture-on-success, the mechanism this rig most wants.** Claude Code's `/run-skill-generator` +
`/verify` and Goose's "recipe cookbook generator" (which mines past sessions into recipes) are the only two
examples found. Find more, and answer precisely for each: what gets written, by whom (the model, the user, a
generator command), where it lands (repo-committed or user-scoped), whether it is reviewed, and whether it
survives the session. Note explicitly if a vendor has **deprecated or wound down** the feature — Goose's
cookbook program is marked ended as of its own blog post, at pin `775b3958`.

**Q6 — dual-host (Windows + Linux) distribution of instruction files.** Everything in both rounds assumed
POSIX config locations. For each harness, find: where its per-project instructions live on Windows, whether
the same file is used by the Windows and Linux builds, how symlinks are handled (are they supported at all
without developer mode), and whether any vendor states precedence across hosts. Quote the doc or issue. This
is for a rig whose operator runs both hosts, and whose measured ad-hoc rate differs by host (Linux 10.5%,
Windows 34.0%).

## What not to do

- **No `git clone` of anything.** If a claim needs source, name the repo and the question and leave it to the
  delegate; five are already pinned here.
- **No source-level answers** for Codex, Cline or Goose — see the table above.
- **Do not answer Q1–Q6 in prose.** Tables, one row per harness, with a citation in every cell that is not
  `not found`.
- Do not restate round 1 or round 2 findings except where you are **contradicting** one; a contradiction is
  the most valuable thing you can send back, so flag it in a section named for it.
- Do not write to any file in this repo except your deliverable and `inputs/fetched/`.

## Deliverable

Write to **`docs/reviews/harness-tools-skills-public-harnesses-research.md`** — the same file as round 2, so
the report stays one artifact. Structure it as:

1. Task A result: what you changed, per citation, and the manifest.
2. A **"Corrections"** section: every claim from round 2 you now withdraw or downgrade, with the reason.
3. Q1–Q6 tables, in that order, with the six harness columns.
4. An **evidence table**: row per claim — claim · class · URL · date · what it supports. Classes are
   `advertised-elsewhere` (vendor states it) and `observed` (you ran it). **Anything without both is recorded
   as `unverified`**, not dropped.
5. A **"still not found"** list: what you searched, in what words, and what came back empty.

**Budget: 6 pages / 30 KB of findings.** Prefer tables over prose. Every external claim carries its URL and
its class inline.

**Land it.** Commit your deliverable and the fetched corpus (`git add <the explicit paths> && git commit`) so
the work is in `git ls-files` when you finish — an untracked report is a lost report. If you cannot run git,
say in your final message that you did not land it, and name the paths, so the delegate can land it in the
same turn it reads them.

**End with a next-prompt block.** List the next research prompt's questions, naming the repo path of the
parent prompt (`docs/reviews/harness-tools-skills-followup-2-research-prompt.md`) and its parent
(`docs/reviews/harness-tools-skills-followup-research-prompt.md`), with a one-line status per question:
`answered`, `answered-negative`, `unanswered`, `partially answered`, or `abandoned because …`.
