---
runbook: competitor-review
symptom: "you want to learn from another project/tool before building something yourself"
writes: false
precondition: "none"
last_verified: unverified
verified_by: delegate
evidence: "docs/reviews/aider-review.md (worked example, 2026-10-17)"
check_rule: null
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
Check whether the project is already reviewed: search `docs/COMPETITORS.md` and the `vendor/eval/`
directory for its name before cloning.
```bash
ls vendor/eval/
rg -n "<project>" docs/COMPETITORS.md
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
2. **Pin the commit and open the review with a header.** Every claim must be reproducible, and a borrowed
   mechanism must be legally borrowable:
   ```bash
   git -C vendor/eval/<name> rev-parse HEAD        # pinned commit
   git -C vendor/eval/<name> log -1 --format=%cI   # commit date
   ```
   Record at the top of the review: **pinned HEAD + date · license · maturity · project version · the
   operator's question**. Maturity matters: a `public-preview`/`alpha` project often ships its spec ahead
   of its code (AGT did). Check the license **before** borrowing — MIT/Apache is borrowable with
   attribution; a copyleft or missing license is an escalation (below), not a quiet copy.
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
`vendor/eval/<name>` is cloned and its HEAD pinned; the review carries the **header** (HEAD + date, license,
maturity, version, the question); every claim cites a path in that tree and is marked **`observed`** or
**`advertised`**; the review carries a **surface-inventory table**, a **"not read" list**, a **durian-pi
coverage matrix**, and a **per-standard adopt / adapt / reject table**; `docs/COMPETITORS.md` has the
entry; each adopt call is either a registered `docs/ROADMAP.md` item or a named rejection; and any open
question has a follow-up prompt or an explicit "closed". `git status` shows only the intended doc files.

## Anti-patterns (do not)

| Anti-pattern | Why it fails |
|---|---|
| **Category dismissal** — "reject compliance/identity/the SDKs" without an opened artifact | The 2026-10-17 OWASP miss; a confident wrong finding |
| **Delta-only re-review of a deficient prior review** | A diff cannot find a miss in unchanged code; the OWASP miss lived in unchanged code |
| Reading aggregators, blog posts, or the project's README instead of its tree | A feature-page summary, not evidence |
| No pinned HEAD (or a bare branch name) | Claims are not reproducible; a re-review cannot diff |
| Treating the spec as the implementation | Preview projects ship specs ahead of code (AGT `HALF_OPEN`, quarantine) |
| Adopting a mechanism you could not verify from the tree | Adoption on faith; name it unverified instead |
| Summarising without a durian-pi counterpart per practice | Not actionable; no item can be registered |
| Burying the license until borrowing time | A copyleft surprise after the code is written |
| Leaving open questions implicit | The topic never closes; the next reviewer re-derives it |

## Re-review (trigger-based)

Re-run brief 3 when (a) upstream moves past the pinned HEAD **and** commits touch a mechanism we adopted
or rejected; (b) a durian-pi mechanism the review named changes; or (c) a `check` rule it references changes.
Do not re-review on a calendar. A review whose pin is stale for an adopted mechanism is a stale doc.

## Machinery (proposed)

Enforcement belongs in `check` (ROADMAP 81/82), not in this prose: a **`competitor-review-covered`** rule
that fails when (a) a `docs/reviews/<name>-review.md` whose `vendor/eval/<name>` clone exists has no
`docs/COMPETITORS.md` entry, or (b) a review's pinned HEAD differs from its `vendor/eval/<name>` clone's
HEAD. Keying on the clone's existence avoids flagging non-competitor reviews under `docs/reviews/`
(e.g. `security-codemode-review.md`). It deliberately does **not** require every `vendor/eval/` clone to
have a review — that directory also holds dependency/TUI evals (`ansi-regex`, `bubbletea`, `node-pty`, …)
that are not competitor reviews. Until the rule lands, the read-only audit is: every competitor review
has an entry, and its pin matches its clone.

## If it fails
- Clone blocked (network, license): do not vendor it; record the blocker in the review and fall back to
  `research-request.md` (the external research agent).
- A practice cannot be verified from the tree: name it **unverified** rather than adopting it.

## Escalate to
`lead` — a design decision that changes seat tooling or the landing path; `pm` — to sequence the
registered items; operator — a license or vendoring question.

## Evidence
Worked example: `docs/reviews/aider-review.md` → `docs/COMPETITORS.md` (Aider entry) → ROADMAP items
(2026-10-17). `last_verified: unverified` until a second independent review exercises these steps.
