# Delegate notes on research round 3 — what checked out, what didn't, and what the pins say

<!-- cite-ns: quoted -- this file quotes another file footnote namespace; tools/review-cite-check.mjs reads this marker -->
**Date:** 2026-10-28 (Linux host, clock `UTC−5`) · **Annotates:**
`docs/reviews/harness-tools-skills-public-harnesses-research-r3.md` — landed **byte-for-byte from the session transcript**,
so the delivered bytes are untouched and there is no note inside them. **Corpus:** `inputs/fetched/MANIFEST.md` §4.

## 1. The evidence protocol worked this time — with two residuals, recorded

Round 2 arrived with 50 dangling anchors and no corpus (ROADMAP 243). Round 3 arrived with **60 numbered citations (C1–C60),
each a URL + fetch date + short verbatim quote**, and an explicit separation of `advertised-elsewhere` / `reported-by-users` /
`unverified` / `not found`. The delegate fetched all seven distinct pages plus the four issue pages and grepped every quote
in its own copies:

> **91 of 94 fragments located literally** — 77 of 80 vendor-page fragments, **14 of 14** issue-body fragments; all seven page
> URLs returned **200**.

**Residual 1 — the deliverable still carries legacy anchors.** It is not anchor-free: **24 old-style footnote markers
remain (18 distinct)**, of which **3 are defined** (`[^1]`, `[^2]`, `[^3]`) and **15 use round 2's page-hash namespace**
(`1fe422`, `20106b`, `3a3779`, `5f6188`, `99bc0c`) — the same namespace whose corpus round 2 never delivered (ROADMAP 243).
Those specific cells are still not checkable unless the page happens to be one the delegate re-fetched. Two spot-checks:

- "a timed-out PreToolUse *doesn't block the tool call*" (`[^20106b#789]`, Codex column) — the fetched Codex hooks page has
  **no such sentence** ("block the tool call" occurs zero times). **Unverified as written.** Codex's `permissionDecision`
  path *is* fail-open at the pin (observed, `hooks/src/events/pre_tool_use.rs`), but that is a different failure than a
  timeout, and this delegate will not launder one into the other.
- Cursor "No output, empty stdout = allow" (`[^99bc0c#…]`) — the page states the default differently: `failClosed` is
  `false`, and when true "hook failures (crash, timeout, non-zero exit code, no output) block the action". So the content is
  **confirmed by paraphrase**, not by quotation.

**Residual 2 — paraphrases presented in quote position.** See C6b below.

**The three literal misses**, so the record is not a tidy pass:

| id | their text | what our copy actually says | verdict |
|---|---|---|---|
| C26 | "any `deny` **wins over** `ask`…" | "any **deny** wins over **ask**, and **ask** wins over **allow**, regardless of source" (bold, not code) | **confirmed**; markup differs |
| C6b | "2,000-char preview" | "passes Claude the file path with a **preview of up to the first 2,000 characters**" | **content confirmed**; it was a **paraphrase in a Q4 table and should have been marked as one** |
| A1c | "the recipe page names the canonical repo owner as `aaif-goose`" | the page names **no owner at all** and links `validate_recipe.rs` bare | **citation defect** — substance true by other means, see below |

**The A1c check, done properly:** `api.github.com/repos/block/goose` → **HTTP 301**; `api.github.com/repos/aaif-goose/goose` →
**200**, `full_name: aaif-goose/goose`. So the repo *has* moved orgs. **Consequence for us:** `git -C vendor/eval/goose remote
get-url origin` still reads `https://github.com/block/goose`, and `docs/VENDOR-PINS.md` **records no remote at all** — so a
pin whose upstream moves is invisible to `tools/vendor-pins.mjs --check`. Registered on ROADMAP **242**.

## 2. What the delegate read at the pins, because the researcher was told not to

Its open questions 1 and 2 were addressed to us. Both are now answered from source.

**(a) Goose `Extension::instructions()` — round 2 was right; the file lives at the pin.**
`goose · 775b3958 · documentation/docs/goose-architecture/extensions-design.md` (127 lines): the `Extension` trait is declared
at :16, `fn instructions(&self) -> &str` at **:19**, immediately above `fn tools(&self)` at **:20**. The mirror's opening
sentence is verbatim in that file; the delegate's first grep missed it only because a markdown link splits the phrase
("the [Extensions framework](/docs/getting-started/using-extensions) in goose"). **Lesson for quoting rendered pages:** an
exact-phrase grep against HTML fails on inline links; strip tags before matching.

**(b) Goose is not guard-less — superseding the round-2 report's `not found`, and *not* contradicting our own records.**
(For the record: the researcher wrote that its goose findings "contradict `docs/COMPETITORS.md`'s goose row — guard-less, no
approval plane". **No such row exists.** `docs/COMPETITORS.md` says plainly that Goose was **unexamined here**, and the
`not found` lives in the round-2 report. The researcher was reasoning from a file it had read a round earlier and got *us*
wrong; this delegate repeated it without checking. Same failure as ROADMAP **244**, one layer up: a claim about our own
documentation, asserted from memory rather than from the file.) What the pin actually holds:

- `documentation/docs/guides/context-engineering/hooks.md` — lifecycle hooks, discovered from plugins, **project-scoped at
  `<project>/.agents/plugins/<name>/hooks/hooks.json`** and user-scoped at `~/.agents/plugins/`, following the **Open Plugins
  hooks specification**; the only trust control is a warning that is advice ("Run trusted hooks only").
- a permission plane, not a switch: `crates/goose/src/config/permission.rs:21-24` → `AlwaysAllow | AskBefore | NeverAllow`;
  a **model-based judge** in `permission/permission_judge.rs` with prompt `prompts/permission_judge.md`; plus
  `permission_store.rs`, `action_required_manager.rs`, `agents/state_machine/ops_tool_approval.rs`.

So Task B's Goose `not found` for hooks is **wrong as written** (the vendor-site mirror has no hooks page — the repo does),
and its Q3 "nothing repo-scoped" is wrong for plugins/hooks even though it holds for `config.yaml` extensions. **This is now
the first `observed`-grade guard evidence for Goose**, and it goes in `docs/COMPETITORS.md`, where goose currently has only a
pin row and no guard row.

**(c) Codex's hook-trust mechanism — advertised by the docs, now observed at the pin — answers 241's threat-model question.**

```
/// This intentionally reads only user and session flag layers, including disabled layers…
/// Project, managed, and plugin layers can discover hooks, but they do not get to write user hook state.
```
`codex-rs/hooks/src/config_rules.rs:8-14`, enforced at `:24-30` (only `User` and `SessionFlags` layers are read), over
`HookStateToml { enabled, trusted_hash, trusted_content_hash }` (`codex-rs/config/src/hook_config.rs:30-37`), merged
**field-by-field** so a later write cannot erase an existing enablement (`config_rules.rs:53-64`).

That single sentence is the design durian-pi should copy: **a repository may carry a guard, but it may not enable or bless
itself.** Trust is keyed to *content hash* and lives above the project layer.

**(d) pi has the same idea at one magnitude coarser — which is the gap, and also a trap for us.** Project `.pi/extensions`
and `.pi/skills` load **only when the project is trusted** (`pi@1.4.0 · src/core/package-manager.ts:2465,2484`; untrusted
project storage refuses outright, `:1783`) — but `isProjectTrusted()` is **one boolean for the whole directory**, and a
command-line flag can set it (`src/cli/args.ts:242`). No per-component granularity, no content hash, no enable/review state,
no re-review when a file changes. For our delegate instruments that is *convenient* (the operator's `pi install --local` puts
them in the repo) and *dangerous* (once trusted, everything under `.pi/` loads, forever, silently). ROADMAP **245** takes the
Codex invariant as the model.

## 3. A correction to the delegate's own writing — mine, not the researcher's

`docs/reviews/codex-enforcement-design-2026-10-28.md` tallied **"four of the five inspectable guard designs fail open."**
That tally is too simple and partly wrong. Failure direction is not a vendor property; it is **per event, per version, and
it moves under you**:

- Copilot CLI's command `preToolUse` **fails closed** on crash, non-zero exit and invalid JSON — the docs say the CLI
  "assumes the worst possible outcome … a deny" — which is why GitHub treats a plugin declaring `preToolUse` as a protection
  at all (C49).
- **The same guard changed direction between releases:** reporter's repro at **v1.0.18** passed a malformed hook through; the
  maintainer's answer at **v1.0.57** is "those errors now **deny** instead of silently passing" (#2540).
- **Timeout is the common hole, not the only one:** Copilot CLI defaults to 30 s and its timeout falls back to allow (#2893,
  C50); Claude Code is **fail-open by default** with **opt-in, version-gated** `onFailure: "block"` (C2, C3 — its docs: "Crashes,
  timeouts, and non-zero exit codes other than `2` fail open by default"); Codex's `permissionDecision` path is fail-open
  (observed at the pin); Cursor ships an **opt-in** `failClosed` (C27). The researcher's Q6 ranks this as the #2 thing
  adopters should want ("a documented deny path with a stated fail direction", C2/C3, C17/C18, C24/C25, C49/C50).
- **Which plane a guard is declared on decides whether it runs:** #2540 — a *plugin* declaring `preToolUse` gets it dropped,
  while the same guard in `copilot-settings.json` fires.

The durable conclusion is narrower and harder-won than "prefer fail-closed": **specify the failure direction per event, pin
the version it was measured against, re-assert it at load, and treat the timeout as a separate decision.** That is now
ROADMAP **238**'s revised acceptance, and **245**'s reason for existing.

## 4. What round 3 changed for the rig, in one place

1. **Two mechanisms we did not have, both from shipped harnesses:** trust keyed to **guard content hash** and settable only
   from a non-repo layer (Codex, observed at the pin), and a **declared** failure direction that is opt-in and version-gated
   (Claude Code `onFailure: "block"`, C3; Cursor `failClosed`, C27). Both are better-specified than a hand-written
   `tool_call` guard. → ROADMAP **245**.
2. **The 232 evidence is now *reported-by-users* against a shipped guard, three ways at once:** timeout→allow (#2893),
   `ask`→allow (#3590), plugin-declared hooks dropped (#2540), and **a sandbox-config edit silently killing a hook** (#5098,
   with `/env` still listing it as the only visible signal). → 241; does **not** replace the broker's self-sweep fix.
3. **A guard that is listed as active is not a guard that runs** — three of the four reports had the guard *still listed* while
   dead. → ROADMAP **246** (self-attestation + a per-decision record a reviewer can read; Goose's `checks/*.sh` exit-0
   predicates give us the success half).
4. **Version-dependence is now load-bearing:** the same vendor, same event, opposite direction at 1.0.18 vs 1.0.57. No
   harness's documented fail direction may be assumed current — including the ones in this file.
5. **Corpus honesty, again:** the researcher refused to rank vendors from its corpus because **all ten failure reports come
   from one tracker**, and one (#2893) is "Not a Copilot defect" once the reporter removed a stray stdout line and raised the
   timeout. We should hold our own pi/codex comparison to the same standard.
6. **Our pins instrument under-reports drift** (ROADMAP 242): no remote recorded (goose moved orgs and `--check` is blind), on
   top of the prefixed-tags bug.

## 5. A discrepancy in the deliverable itself — **the paste appears to be truncated**

The working summary this delegate was handed for round 3 described content that **is not in the landed file**, and it is not a
disagreement about wording:

| in the summary | in `…-research-r3.md` as landed | in the pins |
|---|---|---|
| citations **C61–C66** | the file contains **C1–C60** only | — |
| Goose `checks/*.sh` — a recipe step whose **exit code 0 is the success predicate** (proposed as the answer to ROADMAP 240's "how do we know it worked?") | **no such text**; the file's only Goose mentions are the two pages and its own open question 2 | `find vendor/eval/goose -name "*scraper*"` → nothing; `grep -r checks vendor/eval/goose/crates/goose/src/recipes/` → nothing at `775b3958` |
| `permissions_toml.rs` "1,457 lines" | not stated in the file | the file is **680 lines** (measured 2026-10-28) |

**Two readings:** the operator's paste lost its tail on the way in, or the summary elaborated beyond the source. Both point the
same direction for us: **a mechanism that cannot be found in the deliverable or at a pin must not be registered.** ROADMAP 240's
success-predicate question is therefore **still open**, and this delegate has deleted the claim from `docs/COMPETITORS.md` rather
than keep it with a hedge.

**Ask for the operator:** if the research agent's answer included a Goose `checks` mechanism and citations past C60, **re-send the
tail of its reply**; if it did not, then the summary invented it, which is worth knowing about that agent's reliability as a
channel. Either way the landed file is what we stand on.

## 6. Still unanswered, by either side

- **Claude Code has no open source repo** — `github.com/anthropics/claude-code` is an **issues-only** repository, so its guard
  internals are unobtainable at any commit; anything we say about them is `advertised-elsewhere`, forever.
- **Codex: which layers may carry a *hook definition*** (vs the *state*, answered above), and the **permission profiles** —
  the largest unexplored guard design in the corpus, measured at the pin on 2026-10-28:
  `codex-rs/core/src/config/permissions.rs` **883 lines**, `codex-rs/config/src/permissions_toml.rs` **680**,
  `codex-rs/core/src/config/permission_profile_catalog.rs` **145**. Still 241's next read.
  *(Recording this for the record: this delegate first wrote "1,457 lines" for `permissions_toml.rs` from the working
  summary and only then measured — the file is 680, and the 1,457 figure belongs to no file at the pin. That is the exact
  failure ROADMAP **244** is about: a number carried forward from memory instead of a command. Any line count in these
  documents that is not followed by a measurement date should be re-measured before use.)*
- **Claude Code's project-layer precedence over user-level skill directories** — a precedence list is cited (C21) but the
  collision rule is not stated in the page.
- **pi's own behaviour under load at 15+ skills** — nobody has measured it; it remains our biggest unmeasured number.
