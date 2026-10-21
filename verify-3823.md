# Verification for #3823 (#3807) — explicit base= on CREATE path

All 5 behavioral scenarios verified:
1. Explicit base, leftover at DIFFERENT commit -> REFUSED, no dir created, no worktree registered
2. No base, leftover branch -> RE-ATTACHED, created:true, branchAction:"attached-existing"
3. Explicit base EQUAL to leftover tip -> ATTACHED, fork claim is TRUE
4. Fresh branch + explicit base -> CREATED FROM base, branchAction:"created"
5. Unresolvable base + leftover -> REFUSED legibly, nothing created

Additional checks:
- prepare-workspace.test.mjs -> exit 0
- worktree-lifecycle.test.mjs -> exit 0
- Syntax: node --check src/worktree.mjs -> 0
- 4 files changed: src/worktree.mjs (+78/-9), demo (new +151), runbook (new +124), README (+3/-2)
- prepare-workspace-refused.md: valid UTF-8, no mojibake, no BOM
- Seat-instruction-encoding: all checks pass for new runbook

Scope boundary correct: REUSE path defect remains (impl-item-3558 unlanded). This fix only covers CREATE path.

Verdict: CORRECT. Explicit base= is honoured or refused on the CREATE path. No git mutation occurs on refusal.
