# Re-Verification Report for #3719

## 1. #2543 + #2701 (DEEPINFRA_API_KEY absence) - VOID
Claim: live-run-unreachable, DEEPINFRA_API_KEY absence, $-estimate assertions
Evidence: DEEPINFRA_API_KEY is empty/not set
Result: CONFIRMED. The key is still absent. Live-run against DeepInfra is unreachable.

## 2. #2997 (#2545 trace requests) - VOID
Claim: TRACE wrap, thinking/reasoning_effort request shape is provider-specific
Evidence: node demo/trace-requests.test.mjs -> exit 0; syntax checks pass
Result: CONFIRMED. Provider seam shape verified on main.

## 3. #2897 (#2777 degen context-tokens) - VOID
Claim: degen context-tokens backstop relative to seat's window (was absolute 400k)
Evidence: main has contextFraction:0.33 (from #1823), no maxContextTokens; branch impl-item-2777 @2db5545 NOT an ancestor of main
Result: MECHANISM SUPPLANTED. Main has the fractional approach via #1823. The #2777 branch diverged and never landed.

## 4. #2201 (#2123 D105 broker) - CHEAP
Claim: broker draws fresh context boundary per NEW item for local-provider seats only
Evidence: node demo/local-reset.test.mjs -> exit 0
Result: CONFIRMED.

## 5. #2279 (#2126 suite-env) - CHEAP
Claim: suite-classify resource aborts as ENVIRONMENTAL, not regression
Evidence: node demo/suite-env.test.mjs -> exit 0
Result: CONFIRMED.

## 6. #2654 (compaction-harness) - VOID
Claim: per-model window/measure semantics in compaction evaluation harness
Evidence: node demo/compaction-harness.test.mjs -> exit 0
Result: CONFIRMED. Harness runs on main.
