> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

---
audit: documentation gap audit
date: 2026-10-17
auditor: delegate (operator-requested)
scope: "all doc surfaces: FEATURES, ROADMAP, DECISIONS, runbooks, STATUS/NEXT, encoding, cross-links"
method: "read-only commands over the working tree and git history (no writes by the audit itself)"
---

# Documentation gap audit — 2026-10-17

**Why.** The 2026-10-17 docs-drift finding (feature inventory lagging the code) prompted a fuller audit
across every doc surface, not just `FEATURES.md`. Method is read-only; every finding below names the
command or artifact that produced it.

**Headline:** decisions and runbooks are structurally sound; the **feature inventory and delivery-status
markers lag**, the **decision log is encoding-corrupt**, and **STATUS.md is stale**. One runbook is
missing from the index; three predate the mandatory front-matter rule.

## Findings

| # | Surface | Finding | Severity | Evidence |
|---|---|---|---|---|
| 1 | Feature inventory (`FEATURES.md`) | 8 landed capabilities have **no row**: `format` verb, `--dry-run`, instance key/host lock, TUI paged backfill, `runbook-stale`/`runbook-unverified` rules, `cmdInit`, `verification-without-evidence` rule, `ownership-seat-missing` rule | **HIGH** | `grep -ciE "<term>" docs/FEATURES.md` → 0 hits for each; commits `d0fa7ad`, `dfff51a`, `e3a8e53`, `ed1ce0c`, `ef7f0d6`, `5cb8123`, `50240f9`, `ed2b5dc` |
| 2 | Delivery status (`ROADMAP.md`) | Items **69, 84, 89, 90, 91 landed on `main` but are not marked `DELIVERED`** | MEDIUM | `awk` over each item block → no `DELIVERED`; code commits `c2fa6ee`, `dfff51a`, `ed1ce0c`, `d0fa7ad`, `e3a8e53` |
| 3 | Decision log (`DECISIONS.md`) | Structurally complete (**D1–D91, no gaps**) but **39 entries carry ≤2 of the standard fields** (Decision/Rationale/Why/Status/Alternatives); D29, D31, D36, D37, D38 carry none of the labelled fields | MEDIUM | node field-presence scan |
| 4 | Encoding integrity | **Mojibake**: `DECISIONS.md` 264, `FEATURES.md` 94, `STATUS.md` 41 (`—`, `∈`). `ROADMAP`/`WORKFLOWS`/`SELFDEV`/`NEXT` clean. **No control bytes** present now | MEDIUM | `grep -o "â€" <file> | wc -l`; `grep -P '[\x01-\x08\x0B-\x1F]'` → 0 |
| 5 | Runbook front-matter | **3 runbooks lack the mandatory front-matter** (ROADMAP 82 / README convention): `broker-down-or-stalled.md`, `leaked-worktrees.md`, `store-corruption-recovery.md`. **6 of 16 have `last_verified: unverified`** | MEDIUM | node scan of `docs/runbooks/*.md` |
| 6 | Runbook index | `format-before-commit.md` is **not in the README index** (13/14 listed); no dangling links | LOW | node scan of README vs files |
| 7 | Status truth | `STATUS.md` last touched at `6247597`, **35 commits ago**; it does not reflect the last day's landings | MEDIUM | `git rev-list --count 6247597..HEAD` |
| 8 | Branch-management rules | Merge **procedure** lives in `merge.md` + WORKFLOWS W6; no single **branch-lifecycle** reference (naming, deletion safety, seatguard refusal, exclusive window). Rules in `NEXT.md` are transient | LOW-MED | operator directive 2026-10-17; `grep` across docs |
| 9 | Landing backlog | **61 local branches are ahead of `main`** (`git rev-list --count main..<b>` > 0; not yet deduped with `git cherry`) | MEDIUM | branch loop |

## What is already healthy (so the audit is not read as blanket failure)

- **Decision log coverage:** the last day added **D84–D91** with rationale; D1–D91 all present.
- **Runbooks:** 14 runbooks, front-matter, a README index, a maintenance policy, and the
  `runbook-stale`/`runbook-unverified` `check` rules are live.
- **Research reviews:** every external claim carries a URL + evidence class (per the SOP).
- **`NEXT.md`:** current and delegate-maintained.

## Remediation pointer

- Findings 1–2 are the docs-drift issue already routed to `pm` (`opr-20261017-docs-drift-features`).
- Finding 4 is tracked by `opr-20261017-roundtrip-docs`.
- Finding 5 is ROADMAP 82 (runbook front-matter enforcement) — registered, not scheduled.
- Finding 6 is a one-line index add (delegate-owned).
- Finding 8 is the operator's open directive (canonical docs for branch management).
