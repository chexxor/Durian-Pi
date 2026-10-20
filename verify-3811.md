# Verification for #3811 --suite-less fallback expiry

1. Commit 30f12aa is stacked on 235e163 (on top of unreachable @cccccd5 on main 11e87a0).
   Diff from 235e163 to 30f12aa is +21/-0 (exactly as claimed). One file: docs/runbooks/land.md.

2. The expiry clause ADDS (does not amend) — no "expiry" text existed in land.md before this commit.
   pm's premise that an expiry existed was wrong (it lived only in the #3692 queue item prose).

3. The clause content is checkable:
   - Delete fallback when main's red set is EMPTY in seat-root dependency environment
   - Every --suite-less proof must state the dependency set
   - Don't read "red on N" as environmental
   These match the runbook text.

4. land-helper.test.mjs -> exit 0 (Verify step passes).

5. land.md encoding: valid UTF-8 / no mojibake / no BOM (seat-instruction-encoding checks pass).

6. Three commits in the stack: ccccd5 (unreachable) -> 235e163 -> 30f12aa. Only 30f12aa's diff is
   independently checkable (from 235e163). It is correct.

Verdict: Correct addition. The expiry condition is reachable (empty red set in seat-root deps)
rather than unreachable ("when green"), and it requires stating the dependency set.
