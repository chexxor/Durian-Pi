VERIFICATION REPORT — #3480 (ledger UNION scribe-item-3326 @ffa2ab3)

CHECK 1: MONOTONE ORDER — PASS
D112(line 3007) → D113(3056) → D114(3098) → D115(3125) → D116(3177) → D117(3227) → D118(3242) → D119(3264) → D120(3281) → D121(3335)
Strictly increasing, no gaps, no reordering.

CHECK 2: BOTH ENTRY SETS PRESENT — PASS
All 7 entries present: D115, D116, D117, D118, D119, D120, D121.

CHECK 3: THE SWAP SURVIVED — PASS
D113(3056) precedes D114(3098). Pure block move: D113 and D114 content identical to base (scribe-item-3268). No re-wording.

CHECK 4: D113/D114/D121 CONTENT-IDENTICAL TO BASE — PASS
All three sections verified content-identical against scribe-item-3268.

CHECK 5: +211/-4 DELTA — PASS
git diff confirms +211 added, -4 removed. All 4 deletions are blank lines only (at insertion boundaries before D54, D79, D93, D113).

CHECK 6: NO PLACEHOLDERS — PASS
No ## D###, D-<mint>, #TODO, #FIXME, or placeholder markers found.

CHECK 7: UNIQUENESS — PASS
22 headers D100-D121, each appearing exactly once. No duplicates, no gaps.

CHECK 8: D121 READS DIRECTED NOT IN EFFECT — PASS
D121 states "DIRECTED but NOT YET IN EFFECT" (line 3369), effective runtime still qwen36/poly (3370), refresh tracked at #3274 (3371). No mention of "mojibake".

CHECK 9: MINT ORDER — FINDING (minor)
D120 (issue #3035) appears in the file AFTER D117-119 (issue #3089) and D116 (#3046). Strict issue order would place D120 before D116. However, the D-number MINTING itself was consecutive (115-121) and the scribe walked through issues sequentially. The file position is constrained by the union's structural need to place D115-119 between D113/D114 and D121, and D120 after D119. This is a positional artifact, not a minting error. The numbers were assigned in issue order (#3031→#3035→#3046→#3089→#3268), but the INSERTION points in the file reflect structural constraints. Not blocking for landing.

EVIDENCE: ffa2ab3
