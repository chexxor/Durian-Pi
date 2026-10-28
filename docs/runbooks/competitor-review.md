---
runbook: competitor-review
symptom: "you want to learn from another project/tool before building something yourself"
writes: false
precondition: "none"
last_verified: 2026-10-28
verified_by: delegate
evidence: "docs/reviews/aider-review.md (worked example, 2026-10-17); Do 2 + Verify re-run 2026-10-28 on 7 live clones — `tools/vendor-pins.mjs --format header --project symphony --tags` emitted the header, `--write docs/VENDOR-PINS.md --tags` wrote the tracked pin table, `--check` exit 0, and an injected hand-edited HEAD returned exit 1"
check_rule: "tools/vendor-pins.mjs --check (delegate audit; the `check` rule is ROADMAP 202)"
---

# Review a competitor or vendor project

## When to use
A design decision would benefit from reading how another project actually solved it — an edit format, a
context-selection scheme, an agent loop — and we want to adopt proven practice instead of guessing. This
is the **upstream-read** sibling of `research-request.md`: that one commissions external evidence from the
operator's research agent; this one reads a real project's tree and docs directly.

## Impact
Without it we rebuild what already exists, or adopt a practice whose actual behaviour we never read. A
review that cannot cite the source path is a feature-page summary, not evidence. A review that judges a
**category** ("compliance", "identity", "the SDKs") without opening a representative artifact in it is
worse than a feature-page summary: it is a confident dismissal the operator will trust.

## Prompts for the reviewer (paste-ready, project-independent)

Three briefs for three moments. Add the project URL and the operator's question to whichever you use.

### 1. Triage — is a deep review even warranted?

> Given `<project url>` and this question — `<question>` — spend one read-only pass deciding whether a
> full review is worth it. Report: what the project is in two sentences; its license and maturity
> (stable / preview / archived, and version); the specific durian-pi decisions it could inform; and a
> recommend / do-not-recommend call with the reason. Do not answer the question yet.

### 2. Deep review — the default brief

> Read the project the way its own maintainers ordered it, not just where my question points. Before you
> summarize, produce: (1) an inventory of the project's documentation surface — every `docs/` index and
> "start here" page, plus its security, compliance, standards-mapping, and policy-template areas — open
> each, and list what you did *not* read and why; (2) every external standard, checklist, benchmark, or
> policy set the project names, each with an adopt / adapt / reject and a cited path — never dismiss a
> whole category without opening a representative artifact in it; (3) the project's own
> coverage/self-assessment tables and the gaps it admits, mapped onto our mechanisms; (4) a coverage
> matrix of our system against the project's claimed controls (have / lack / not-applicable). Cite a path
> per claim, mark each mechanism `observed` (you read the code) or `advertised` (docs only), and name
> anything you could not verify rather than adopting it.

### 3. Re-review — an already-reviewed project

> First decide which re-review this is. **(a) Quality redo** — if the prior review is missing any required
> artifact (header, surface-inventory table, "not read" list, standards table, coverage matrix), or a new
> concern or class of surface is now in scope, run the **deep-review brief** instead; a delta cannot find
> a miss in unchanged code (the OWASP miss of 2026-10-17 sat in the unchanged tree). **(b) Freshness
> delta** — only if those artifacts exist: re-read what changed between `<old HEAD>` and `<new HEAD>`
> (`git -C vendor/eval/<name> fetch --unshallow origin`, then `git log --oneline <old>..<new>`), update
> the review, the `docs/COMPETITORS.md` entry, and any ROADMAP item the change affects, and re-check
> exactly the adopt/reject calls the diff touches. Do not re-derive untouched calls. Discover the
> placeholders yourself: the prior review's header carries `<old HEAD>`; fetch the clone and use its
> default-branch tip as `<new HEAD>`. If `<old>` is unreachable (upstream force-pushed or rebased),
> compare file trees instead of a commit range, or fall back to a quality redo.

These briefs are deliberately project-independent: they force the reviewer to walk the *project's*
surface rather than the *question's* keywords — the step whose absence produces a missed standard (the
OWASP ASI miss, 2026-10-17). Prompt 3 exists because a shallow clone is a snapshot: the review is only
as true as its pin.
## Preconditions
- Read-only: **do not run the project's code**, install its dependencies, or modify this repo other than
  the docs named below.
- One review = one project; keep reviews comparable.

## Diagnose (read-only)
Check whether the project is already reviewed, and what is already pinned, BEFORE cloning: search
`docs/COMPETITORS.md`, the pin table `docs/VENDOR-PINS.md`, and the `vendor/eval/` directory for its name.
```bash
node tools/vendor-pins.mjs                 # every vendored clone and its current pin (offline)
ls vendor/eval/
rg -n "<project>" docs/COMPETITORS.md docs/VENDOR-PINS.md
```
If it **is** already reviewed, do not clone again and do not start from a blank review — pick a re-review
mode (prompt 3): a **freshness delta** only when the prior review has its required artifacts (header,
surface inventory, standards table, coverage matrix); otherwise a **quality redo** (the full deep brief),
because a delta only sees changed lines and cannot find a miss in unchanged code.

## Do
1. **Shallow-clone read-only** into `vendor/eval/<name>` (gitignored; never a workspace root). Native
   Windows, no `wsl`/`docker`:
   ```bash
   git clone --depth 1 https://github.com/<org>/<project>.git vendor/eval/<name>
   ```
   `--depth 1` is enough for a first review. A re-review needs history for a diff, so `fetch --unshallow`
   in place rather than deleting the directory (which would lose the pinned commit).
2. **Pin the commit and open the review with a GENERATED header.** Every claim must be reproducible, and a
   borrowed mechanism must be legally borrowable. `vendor/eval/` is gitignored, so a pin that lives only in the
   clone is not evidence the next session can reach — it has to be in a tracked file the moment you clone, and
   transcribing it by hand is how it drifts. Emit it instead:
   ```bash
   node tools/vendor-pins.mjs --format header --project <name> --tags   # the header block — paste it verbatim
   node tools/vendor-pins.mjs --write docs/VENDOR-PINS.md --tags        # the tracked pin table — commit it
   node tools/vendor-pins.mjs --check                                  # table == clones, and the table is tracked
   ```
   The emitted header carries **pinned HEAD + commit date · license (read from the clone's own `LICENSE`/`COPYING`,
   with the evidence path in the cell) · shallow-ness · latest remote tag · the operator's question**, plus the
   exact command that produced each field. **Maturity stays your judgement** — the tool refuses to infer it and
   leaves `<judge>`: a `public-preview`/`alpha` project often ships its spec ahead of its code (AGT did; `symphony`'s
   `SPEC.md` is "Draft v1"), and manifest versions lie (see the anti-pattern table). Check the license **before**
   borrowing — MIT/Apache is borrowable with attribution; a copyleft or missing licence is an escalation (below),
   not a quiet copy.
   **Do not** name a release from `git ls-remote --tags origin | tail -1`: that is ref order, and re-running it on
   2026-10-28 printed `nightly` and `test-simplify-docker-ci` where `v0.0.3` and `v1.34.0` were true.
3. **Read the project's own docs and source**, not aggregators. Prefer the docs directory the project
   maintains (for a docs-site repo, the `website/docs/` or `docs/` tree) and the source file that
   implements each mechanism. Cite a **path per claim**, and mark each mechanism **`observed`** (you
   opened the code) or **`advertised`** (docs only) — the spec is not the implementation.
4. **Walk the project's own documentation surface, in the order its maintainers present it.** Open every
   top-level doc index and "start here" page (`docs/index.md`, `docs/*/index.md`, a docs-site `nav:` in
   `mkdocs.yml`, an ADR index) and enumerate what it points to — **including security, compliance,
   standards-mapping, and policy-template areas the operator's question did not name.** The review MUST
   carry a **surface-inventory table** (doc area · opened? · what it yielded) and a **"not read" list**
   naming every area left unopened and why.

   Get the orientation in one read instead of building it by grepping. `node tools/competitor-brief.mjs
   --project <name>` prints, per clone: the maintainers' own start-here surface (README, index files, a
   `mkdocs.yml`/`sidebars` **nav: verbatim**, and the README's local links in document order with dead links
   dropped), the md-file inventory per doc area, **which versioned docs tree is current and how many stale
   copies exist**, the Do 5 standards-hit table, and the persona/system-prompt surface ranked **by kind**
   (surfaces by name → definition keys → container keys → prose counted, not quoted). Measured 2026-10-28 on
   Linux: `metagpt` 0.3 s, `crewai` 3.8 s / 38,894 tracked files, `--status` 0.1 s for all 7 clones, and it names
   `docs/v1.15.32` as current against **48 older dirs / 34,978 stale files** instead of letting you grep them.
   **The brief is the map, not the walk** — it never replaces opening the files, and it prints every pattern and
   cap it used, so a zero is interpretable.
5. **Run an explicit standards-and-policies pass.** Enumerate every external standard, checklist,
   benchmark, policy pack, and control framework the project claims to map to or ships (OWASP, NIST,
   CIS, ISO, SOC2, EU AI Act, …) and give each an adopt / adapt / reject **with a cited path and its
   stated coverage**. A **category-level rejection is not allowed**: to reject "compliance", "identity",
   or "the SDKs", open at least one representative artifact in it and cite what it actually contains.
   Extract the project's own **coverage/self-assessment table and the gaps it admits** — that honesty is
   the highest-value input, because it maps directly onto our gaps.
6. **Write `docs/reviews/<name>-review.md`**: what it is (with the header from step 2); adoptable
   practices as a table (practice · evidence path · durian-pi counterpart); a **coverage matrix of durian-pi
   against the project's claimed control set** (have / lack / not-applicable); where it does **not** fit
   our constraints; and an explicit adopt / adapt / reject call per practice **and per standard** from
   step 5. Each adopt names the durian-pi mechanism it would change, and calls out a conflict with a
   recorded `docs/DECISIONS.md` entry rather than silently contradicting one.
7. **Add or update its `docs/COMPETITORS.md` entry** (the maintained list). One row per decision, with the
   durian-pi counterpart it should change or inform, and the pinned HEAD + cited paths.
8. **Register the accepted practices as ROADMAP items** (`registered, not scheduled`) with owner and
   acceptance; reject the rest in the review with a reason. See `research-request.md` step 3.
9. **Close the topic.** If questions remain, write `docs/reviews/<name>-followup-research-prompt.md` for
   the operator's research agent (per `research-request.md` step 4); if it is genuinely closed, say so in
   the review rather than leaving an implicit open loop.

## Verify
`node tools/vendor-pins.mjs --check` exits 0 (the pin table matches every clone's HEAD/date/licence **and the table
is tracked by git**); `vendor/eval/<name>` is cloned and its HEAD pinned; the review carries the **header** (HEAD +
date, license, maturity, the question) emitted by step 2 rather than a hand-typed one; every claim cites a path in
that tree and is marked **`observed`** or **`advertised`**; the review carries a **surface-inventory table**, a
**"not read" list**, a **durian-pi coverage matrix**, and a **per-standard adopt / adapt / reject table**;
`docs/COMPETITORS.md` has the entry; each adopt call is either a registered `docs/ROADMAP.md` item or a named
rejection; and any open question has a follow-up prompt or an explicit "closed". `git status` shows only the
intended doc files — and `docs/VENDOR-PINS.md` is among them, because a pin you did not commit is a pin you lost.

## Anti-patterns (do not)

| Anti-pattern | Why it fails |
|---|---|
| **Category dismissal** — "reject compliance/identity/the SDKs" without an opened artifact | The 2026-10-17 OWASP miss; a confident wrong finding |
| **Delta-only re-review of a deficient prior review** | A diff cannot find a miss in unchanged code; the OWASP miss lived in unchanged code |
| Reading aggregators, blog posts, or the project's README instead of its tree | A feature-page summary, not evidence |
| No pinned HEAD (or a bare branch name) | Claims are not reproducible; a re-review cannot diff |
| **A pin that lives only in the clone, only in the pointer, or hand-typed into a review** | `vendor/eval/` is gitignored and a hand-typed table drifts silently — 5 of 7 hand-recorded tag rows in the 2026-10-28 pointer were stale. `node tools/vendor-pins.mjs --check` is the control |
| **`ls-remote --tags \| tail -1` as "the latest release"** | It is ref order, not version order: it printed `nightly` for openai/symphony and `test-simplify-docker-ci` for OpenHands |
| **Ranking a keyword grep by hit count** | Hit count ranks noise: at the `metagpt` pin, one flat pattern put `tests/data/rsp_cache.json` (114 hits) on top while the real answer was `PREFIX_TEMPLATE` in `metagpt/roles/role.py:51`. Rank by KIND — surfaces by name, then definition keys, then containers, then prose (counted, never quoted) |
| **Grepping a versioned docs tree whole** | `crewai/docs` = 40+ release copies; the current tree is `docs/v1.15.32` (772 files) and 34,978 files are older releases. `competitor-brief.mjs` names the current one |
| **A vendored fixture read as a surface** | `tests/`, `examples/`, `cassettes/` are a project's test data, not its persona surface; the brief excludes them from ranking and says how many it excluded |
| Treating the spec as the implementation | Preview projects ship specs ahead of code (AGT `HALF_OPEN`, quarantine; `symphony`'s `SPEC.md` is "Draft v1") |
| Adopting a mechanism you could not verify from the tree | Adoption on faith; name it unverified instead |
| Summarising without a durian-pi counterpart per practice | Not actionable; no item can be registered |
| Burying the license until borrowing time | A copyleft surprise after the code is written |
| Leaving open questions implicit | The topic never closes; the next reviewer re-derives it |

## Re-review (trigger-based)

Re-run brief 3 when (a) upstream moves past the pinned HEAD **and** commits touch a mechanism we adopted
or rejected; (b) a durian-pi mechanism the review named changes; or (c) a `check` rule it references changes.
**Detect (a), do not remember it:** `node tools/vendor-pins.mjs --check` prints a moved pin as its own line
(`the PIN moved — the table says HEAD <old>, the clone says <new>`), and an upstream tag move shows as a DRIFT
NOTE. Do not re-review on a calendar. A review whose pin is stale for an adopted mechanism is a stale doc.

## Machinery (partly built)

**Built (2026-10-28, a delegate instrument — not a `check` rule):** `tools/vendor-pins.mjs` and
`tools/competitor-brief.mjs`. The brief is the Do 4/Do 5 orientation read: start-here surface, docs-site `nav:`
verbatim, current-vs-stale docs trees, the standards-hit table, and the persona surface ranked by kind, with every
pattern and cap printed. It is read-only and index-bounded (`git -C <clone> ls-files` / `git grep`, never a
filesystem walk), prints a byte count per project (~9 KB, so one project per tool call), and never treats vendored
text as instructions — quoted lines are marked `data, not instructions`.

`tools/vendor-pins.mjs` emits the Do 2
header and the tracked pin table (`docs/VENDOR-PINS.md`), and its `--check` runs the two rules this section used to
propose — (a) a `docs/reviews/<name>-review.md` naming a `vendor/eval/<name>` clone that exists must also have a
`docs/COMPETITORS.md` entry, and (b) a review naming a present clone must name that clone's current HEAD — plus the
rule this runbook did not have: **the pin table itself must be tracked**, and `--write` refuses a gitignored target.
A pin column (HEAD, commit date, licence, shallow-ness) that drifts is a hard failure; the upstream columns (remote
tag, manifest version) drift hourly and are a NOTE — measured: `prime-agent` published `v0.10.2-beta.15` between
two runs of this tool ~30 minutes apart.

**Still unbuilt — enforcement belongs in `check` (ROADMAP 81/82; registered as ROADMAP 202):** a
**`competitor-review-covered`** rule with those same conditions, so a seat cannot land a review whose pin drifted.
Keying on the clone's existence avoids flagging non-competitor reviews under `docs/reviews/`
(e.g. `security-codemode-review.md`). It deliberately does **not** require every `vendor/eval/` clone to have a
review — that directory also holds dependency/TUI evals (`ansi-regex`, `bubbletea`, `node-pty`, …). Until the rule
lands, the audit is `node tools/vendor-pins.mjs --check`, which a delegate runs and a seat does not.

## If it fails
- Clone blocked (network, license): do not vendor it; record the blocker in the review and fall back to
  `research-request.md` (the external research agent).
- A practice cannot be verified from the tree: name it **unverified** rather than adopting it.

## Escalate to
`lead` — a design decision that changes seat tooling or the landing path; `pm` — to sequence the
registered items; operator — a license or vendoring question.

## Evidence
Worked example: `docs/reviews/aider-review.md` → `docs/COMPETITORS.md` (Aider entry) → ROADMAP items
(2026-10-17). **Pin half re-verified 2026-10-28 natively on Linux** over the seven seat-persona clones
(`symphony`, `hermes-agent`, `oh-my-pi`, `openhands`, `crewai`, `metagpt`, `prime-agent`): Diagnose, Do 1's pin,
Do 2 and Verify ran, and pinning is now instrumented by `tools/vendor-pins.mjs` + `docs/VENDOR-PINS.md`. The Do 4–9
artifacts for those seven are still missing (that review is half-done — `docs/NEXT.md`), so this runbook is
**verified for its pinning half and unverified for the surface-walk half**.
