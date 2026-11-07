# `inputs/fetched/` — the corpus a research report cites

**Why this exists.** A research report cited line ranges of vendor pages it had fetched — `[^542f21#49]`,
`[^20106b#1026]`, **50 of the report's 64 in-body anchors** — into a directory that stayed in the research agent's own
workspace. Anyone holding only this repo could not open a single one of them. That is ROADMAP **233**'s failure mode one
layer up: the *inputs* to a finding are not durable, so the finding is not checkable
(`docs/reviews/harness-tools-skills-public-harnesses-research.md`, measured 2026-10-28; registered as **243**).

**Who fetches — the delegate, not the research agent.** The agent is **not on this machine and has no write access to this
repo** (operator, 2026-10-28), so it cannot ship a corpus and must never be asked to. What it *can* supply is the portable
unit: **a verbatim quote of ≤ 40 words + the URL + its own fetch date**. The delegate fetches the page here, writes the
manifest row, and searches for that quote in our copy. **A quote we cannot locate is recorded `unverified` in the folded
docs**, while the agent's report body stays verbatim — we correct our record, not their artifact. The trap this avoids: a
page fetched today is not the page the agent read, so **a line range is not portable across re-fetches, while a quoted
sentence usually is.**

**The rule.** If a report cites a fetched page, the page is fetched here and gets a manifest row. A report whose citations
point at neither a file here nor a resolvable URL gets **returned, not folded** — a dead URL or an unopenable line range is
worse than no citation, because it reads as evidence.

**What is tracked, and what is not** (corrected 2026-11-06; this file used to claim the *directory* was tracked, which
`.gitignore` has contradicted since 2026-10-28). Tracked here: **this README and `MANIFEST.md`** — `git ls-files
inputs/fetched` lists exactly those two. The **page copies are deliberately untracked**: `.gitignore` carries
`inputs/fetched/*.html` (11 pages, **8.2 MB**, largest 2.6 MB) because they are re-fetchable from the URL and the manifest's
`sha256` pins the bytes we saw. Check either half in one line each:

```bash
git ls-files inputs/fetched                              # README.md, MANIFEST.md only
git check-ignore -v inputs/fetched/<file>.html           # matches .gitignore: inputs/fetched/*.html
```

The consequence the original sentence was reaching for still holds, one level narrower: a corpus that lives only in the
research agent's workspace counts as **lost**, because the durable record is the manifest row, not the bytes — recover a
copy by re-fetching the URL, and record a row while you are there.

**Naming.** One file per fetched page: `<host>_<path-with-underscores>.html` (or `.md`), e.g.
`code.claude.com_docs_en_skills.html`. The report's citations point at the **URL**, not the file; the manifest maps the two.
**Save the copy as `.html`**: the ignore rule above covers `*.html` only, so a page saved as `.md` is neither ignored nor
tracked and `scripts/land.mjs` counts an untracked path as a **dirty tree** and refuses to land (measured: `git
check-ignore -v inputs/fetched/probe-page.html` exits 0, `…probe-page.md` exits 1 — if that happens, see
`docs/runbooks/land.md`).

**Manifest: `inputs/fetched/MANIFEST.md`** — one row per page, produced by the fetch, never hand-typed:

| file | source URL | fetched (Z) | HTTP | sha256 | page's own "last updated" | quotes found in this copy |
|---|---|---|---|---|---|---|

Reproduce a row with:

```bash
curl -sS -L -D - -o inputs/fetched/<file> "<url>" | grep -iE "^HTTP/|^last-modified"
sha256sum inputs/fetched/<file>
grep -o "<40-word quote>" inputs/fetched/<file> | head -1     # the verification step, not a formality
```

**What does *not* go here.** Source code (competitor clones are pinned under `vendor/eval/` and recorded in
`docs/VENDOR-PINS.md`), and anything a report does not cite. This is evidence for citations, not an archive.
