# Verification for #3797 — encoding damage repair

## seat-instruction-encoding demo -> exit 0
PASS — 44 seat-facing file(s) clean UTF-8, no mojibake, detector proven to fire
Confirmed: prepare-workspace-etarget.md and README.md now report valid UTF-8 / no mojibake / no BOM.

## README.md diff vs pre-corruption = exactly 2 lines
git diff --numstat e700d7c 595b714~1 -- docs/runbooks/README.md -> 2 0
The only difference from the pre-corruption revision is the two legitimately-deleted index rows.
No content drift. VERIFIED.

## docs-gap-audit byte-identical to pre-corruption
git diff e700d7c 595b714~1 -- docs/reviews/docs-gap-audit-2026-10-17.md -> 0 lines
Byte-identical. The single intentional mojibake-shaped grep example on line 28 was preserved.

## BOM status
Fixed files (no BOM): README.md (23 20 64), prepare-workspace-etarget.md (2D 2D 2D), docs-gap-audit (3E 20 2A)
Pre-existing BOM files (still have BOM EF BB BF): DECISIONS.md + 5 review files. Correctly left alone.

## Suite: 7 red -> 6 red
seat-instruction-encoding went GREEN. broker-one-connection still RED. 5 tui-durable-* still RED.
Consistent with a docs-only fix that doesn't touch dependencies.

## Verdict
The fix is correct. README.md is byte-clean of mojibake and BOM, with only the legitimate 2-line deletion
vs the pre-corruption parent. The audit file was correctly restored from the parent since it contained
deliberate mojibake-as-evidence. The 6 pre-existing BOM files were correctly left alone.
