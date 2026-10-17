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
review that cannot cite the source path is a feature-page summary, not evidence.

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

## Do
1. **Shallow-clone read-only** into `vendor/eval/<name>` (gitignored; never a workspace root). Native
   Windows, no `wsl`/`docker`:
   ```bash
   git clone --depth 1 https://github.com/<org>/<project>.git vendor/eval/<name>
   ```
2. **Pin the commit you read** so every claim is reproducible:
   ```bash
   git -C vendor/eval/<name> rev-parse HEAD
   ```
3. **Read the project's own docs and source**, not aggregators. Prefer the docs directory the project
   maintains (for a docs-site repo, the `website/docs/` or `docs/` tree) and the source file that
   implements each mechanism. Cite a **path per claim**.
4. **Write `docs/reviews/<name>-review.md`**: what it is; adoptable practices as a table (practice ·
   evidence path · durig counterpart); where it does **not** fit our constraints; and an explicit
   adopt / adapt / reject call per practice.
5. **Add or update its `docs/COMPETITORS.md` entry** (the maintained list). One row per decision, with the
   durig counterpart it should change or inform, and the pinned HEAD + cited paths.
6. **Register the accepted practices as ROADMAP items** (`registered, not scheduled`) with owner and
   acceptance; reject the rest in the review with a reason. See `research-request.md` step 3.

## Verify
`vendor/eval/<name>` is cloned and its HEAD pinned; every claim in the review cites a path in that tree;
`docs/COMPETITORS.md` has the entry; each adopt call is either a registered `docs/ROADMAP.md` item or a
named rejection. `git status` shows only the intended doc files.

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
