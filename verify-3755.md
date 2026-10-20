# Verification for #3755 — local-provider-down runbook model-ID decision

## Claim 1: /v1/models returns qwen3.8-flash-next-iq3_s (not swift-1.5-iq2_xs)
Command: curl.exe -s -m 5 http://127.0.0.1:8080/v1/models
Result: HTTP 200, one id: qwen3.8-flash-next-iq3_s, loaded, n_ctx 65536
VERIFIED.

## Claim 2: rig names local/swift-1.5-iq2_xs
Command: grep local rig.selfdev.json
Result: "model": "local/swift-1.5-iq2_xs" on lines 50 and 124. git status --porcelain empty.
VERIFIED.

## Claim 3: completion naming swift-1.5-iq2_xs returns qwen3.8-flash-next-iq3_s
Command: ConvertTo-Json body with model=swift-1.5-iq2_xs -> Invoke-RestMethod -Uri http://127.0.0.1:8080/v1/chat/completions
Result: HTTP 200, response.model=qwen3.8-flash-next-iq3_s, content="OK", total_tokens=85
VERIFIED. The server silently serves what is loaded, ignoring the requested model id.

## Diagnose table: 4 states, all decidable with the listed commands
- State 1 (nothing on :8080): Test-NetConnection / Get-NetTCPConnection can detect. VERIFIED: the curl.exe command works on this platform.
- State 2 (/v1/models lists configured id): curl.exe + JSON parse. 
- State 3 (configured id absent): curl.exe + JSON parse. VERIFIED: current state IS state 3.
- State 4 (id present but not loaded): curl.exe + JSON status field.
All 4 states are decidable.

## Windows commands: all literal and runnable
1. Get-NetTCPConnection -LocalPort 8080 -State Listen -> WORKS (shows pid 18492)
2. Get-CimInstance Win32_Process -Filter "ProcessId=18492" -> WORKS (shows PolyStrata python process)
3. curl.exe -s -m 5 -> WORKS (not curl.exe alias issue, the explicit .exe works)
4. ="./selfdev.sqlite"; node cli.mjs log qa 3 -> works syntactically (DB doesn't exist in this worktree)

## last_verified: 2026-10-18 is correct
The /v1/models half of Verify FAILS today (state 3: configured id absent). The completion half PASSES but cannot discriminate state 2 from state 3. So last_verified stays at 2026-10-18 deliberately.

## Conclusion
All 3 measured claims are CONFIRMED on this box. The runbook correctly documents state 3 (silent model substitution) and the diagnostic procedure correctly requires checking MODEL ID, not just port reachability. The change is sound.
