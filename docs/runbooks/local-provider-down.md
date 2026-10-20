---
runbook: local-provider-down
symptom: "a local seat (qa/devtools) fails to run: `No API key for provider: local` or `model_error: Connection error.`; `/v1/models` on 127.0.0.1:8080 does not list the model the seat's `local/<id>` names. NOTE the port may be OPEN and answering HTTP 200 while the provider is unusable - see Diagnose state 3"
writes: false
precondition: "none"
last_verified: 2026-10-18
verified_by: delegate
evidence: "2026-10-18T19:10Z PolyStrata restart (pid 9220 -> listener 15268, strata-poly 5944); HTTP 200 on /v1/models + a live chat completion; qa's 3 `Connection error.` runs were the server being down"
check_rule: null
---

# Local inference server (PolyStrata) is down, so local seats cannot run

## When to use
A seat whose model is `local/<id>` (`qa`, `devtools` in `rig.selfdev.json`) reports
`last_run_failed: model_error: Connection error.` or `No API key for provider: local`, or
`status` shows the seat's runs all ending in `stopReason: "error"`. This is the **inference server**
being down, not a durig bug — the server is a separate process (`PolyStrata`) that a host reboot does
not bring back.

## Impact
Only the seats pinned to the local provider are affected; the paid-provider seats keep running. If the
server is down, every local-seat wake fails, the supervisor escalates the seat after repeated failures
(`repeated_failure`), and the `qa`/`devtools` lane stalls until the server is restarted.

**A listener on `:8080` is not the same as a working provider.** Something else can hold the port, or a
PolyStrata instance can be up serving a DIFFERENT model than the one the rig names. In that state the
port probe reads "safe" while every local wake still fails. That is why the decision below is made on
the MODEL ID, never on the port.

**Do not "fix" this with `node cli.mjs up --refresh`.** `up --refresh` reads `rig.selfdev.json` and
pushes its provider strings into the store. What that costs depends on which state you are in, and the
cheap version of the warning is wrong: measured 2026-10-20, the server on `:8080` ANSWERS a request that
names `swift-1.5-iq2_xs` (it ignores the id and serves the loaded model, see Verify), so a refresh does
not produce two dead seats - it moves every local seat onto whatever model is loaded while the rig still
says `swift-1.5-iq2_xs`, with no error anywhere. A silent model substitution is harder to notice than an
outage. Restoring provider values in `rig.selfdev.json` is an OPERATOR call (lead R1) - a seat doing it
is a second seat-authored provider move.

## Preconditions
None. Restarting `PolyStrata` is not a durig store write, so the broker may stay up. Do **not** stop the
durig broker for this.

## Diagnose (read-only)
```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object ProcessId,CommandLine
curl.exe -s -m 5 http://127.0.0.1:8080/v1/models
$env:DURIG_DB="./selfdev.sqlite"; node cli.mjs log qa 3
```
Literal on Windows: `curl` alone is PowerShell's alias for `Invoke-WebRequest` and rejects `-s -m 5`, so
the binary is named `curl.exe`.
Decide on the MODEL ID, not on the port. The model the rig names is `DURIG_LOCAL_MODEL` in
`durig.config.json`, and the seat's `local/<id>` in `rig.selfdev.json` must name the SAME id. Compare it
against the `id` values returned by `/v1/models`:

| What you see | What it means |
|---|---|
| nothing listening on `:8080` (or `curl` returns nothing) | state 1 - the server is down: do the restart below |
| `/v1/models` 200 and the configured id IS listed with `"status":{"value":"loaded"}` | state 2 - the provider is fine: the seat's failure is NOT the provider, look at the seat's log/keys |
| `/v1/models` 200 and the configured id is ABSENT (a different id is listed) | state 3 - the port answers, the provider is unusable: this is the state a port probe cannot see. Restart with the config that serves the configured model (see the 2026-10-20 note in Evidence) |
| `/v1/models` 200, configured id listed, `"status"` not `loaded` | state 4 - still loading or the load failed: poll, then read `server.err` |

A port probe (`netstat`, `Test-NetConnection`) can only tell states 1 from 2/3/4 - it cannot tell a dead
provider from an unrelated listener. Use it to find the PID, not to conclude.
- `log qa` showing `"provider":"local","model":"swift-1.5-iq2_xs"` with `"stopReason":"error"` and
  `"errorMessage":"Connection error."` is the server-down signature.
- `"errorMessage":"No API key for provider: local"` is a DIFFERENT cause — the broker restarted without
  `DURIG_LOCAL_API_KEY` (see `broker-down-or-stalled.md`).

## Do
1. Confirm the model files and engine exist (they are outside this repo, under
   `C:\Users\Alex\dsh-Projects\PolyStrata-data`):
   ```bash
   ls "C:/Users/Alex/dsh-Projects/PolyStrata/engine-poly/strata-poly.exe"
   ls "C:/Users/Alex/dsh-Projects/PolyStrata-data/models/qwen36-UD-Q3_K_M/Qwen3.6-35B-A3B-UD-Q3_K_M.gguf"
   ```
2. Start the server detached (no browser window; stdout/stderr go to the PolyStrata logs):
   ```bash
   powershell -NoProfile -Command "\$root='C:\Users\Alex\dsh-Projects\PolyStrata'; \$p = Start-Process -FilePath \"\$root\.venv\Scripts\python.exe\" -ArgumentList @('serve\server.py','--engine','strata','--config',\"\$root\strata-qwen36-ud-q3_k_m.json\",'--port','8080') -WorkingDirectory \$root -RedirectStandardOutput \"\$root\server.out\" -RedirectStandardError \"\$root\server.err\" -PassThru; Write-Output ('pid={0}' -f \$p.Id)"
   ```
   The config (`strata-qwen36-ud-q3_k_m.json`) already pins `--max-context 65536`,
   `--vram-reserve-mib 512`, and `min_free_vram_mib 6000`. The operator's canonical launcher is
   `C:\Users\Alex\dsh-Projects\PolyStrata\run-qwen36-ud-q3_k_m.bat` (adds `--open`).
3. The first load takes a minute or two; a warm start returns in seconds. Poll until it is loaded:
   ```bash
   curl -s -m 5 http://127.0.0.1:8080/v1/models
   ```

## Verify
```powershell
curl.exe -s -m 5 http://127.0.0.1:8080/v1/models
```
Expect HTTP 200 with `"status": {"value": "loaded"}` and `"n_ctx": 65536` **for the id the rig names** —
not merely for whichever id happens to be loaded. Then confirm a real completion (not just the model list):
```powershell
$body = @{ model = "swift-1.5-iq2_xs"; messages = @(@{ role = "user"; content = "Reply with exactly: OK" }); max_tokens = 32 } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://127.0.0.1:8080/v1/chat/completions -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60
```
A `choices[0]` with a `finish_reason` and non-zero `usage` proves INFERENCE works. **It does not prove the
configured model is the one being served.** Measured 2026-10-20: a request naming `swift-1.5-iq2_xs` came
back with `"model": "qwen3.8-flash-next-iq3_s"` and `choices[0].message.content = "OK"` - the server
ignores the requested id and serves whatever is loaded. So read `response.model` and compare it with the id
you asked for; that field and the `/v1/models` list are the discriminators, and a completion is not.
(`curl.exe -d "{...}"` does not survive PowerShell quoting - the server replies `Expecting property name
enclosed in double quotes` - which is why the body is built with `ConvertTo-Json` here.)
The next local wake (queued work or a re-driven seat) should then end in `stopReason: "toolUse"`/`"stop"`,
not `"error"`.

## If it fails
- Read `C:\Users\Alex\dsh-Projects\PolyStrata\server.err` and the tail of `server.out`.
- VRAM gate: the config refuses to start below `min_free_vram_mib: 6000`; close other GPU consumers and
  retry. An engine OOM is fixed by the config's `--vram-reserve-mib`.
- If the port is held by a stale process, terminate that pid and retry (`taskkill /F /PID <pid>`).

## Escalate to
The operator — only if the model files or GPU are missing/changed, or the server will not load after the
VRAM gate is cleared.

## Evidence
2026-10-18: after the host reboot the server was down (nothing on `:8080`); `qa`'s three most recent runs
failed `model_error: Connection error.` Restarted per this runbook (`pid=9220` launcher, listener
`15268`, `strata-poly.exe` `5944`); `/v1/models` returned HTTP 200 `{"status":{"value":"loaded"},
"n_ctx":65536}`; a chat completion returned a valid `choices[0]` at ~224 tok/s. The related
broker-restart-key requirement is in `broker-down-or-stalled.md`; the incident is
`docs/incidents/2026-10-18-local-provider-empty-key.md`.

2026-10-20 (~09:50Z) — **STATE 3 MEASURED, and the reason the probe changed.** The rig names
`local/swift-1.5-iq2_xs` for `qa` and `devtools` (committed by `595b714`, a "docs(NEXT)" commit; the
working tree is clean for that file, so a checkout cannot undo it), and `durig.config.json` sets
`DURIG_LOCAL_MODEL=swift-1.5-iq2_xs` with `DURIG_LOCAL_BASE_URL=http://127.0.0.1:8080/v1`. What is
actually listening on `:8080` is pid `18492`, `python.exe` running PolyStrata
`serve\server.py --engine strata --config strata-iq3_s.json --port 8080`, and `/v1/models` returns HTTP
200 with exactly one id: `qwen3.8-flash-next-iq3_s` (`loaded`). So the port answers, PolyStrata answers,
and the configured model is not served. **AND THE SUBSTITUTION IS SILENT:** a chat completion whose body
names `swift-1.5-iq2_xs` returned HTTP 200 with `"model": "qwen3.8-flash-next-iq3_s"`,
`"content": "OK"`, `finish_reason: stop`, `usage.total_tokens: 85` - the server ignores the requested id
and serves whatever is loaded. So a local seat does not necessarily FAIL here; it can run, on a model the
rig did not choose. Commands: `Get-NetTCPConnection -LocalPort 8080 -State Listen`,
`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`, `curl.exe -s -m 5 http://127.0.0.1:8080/v1/models`,
and the `Invoke-RestMethod` body in Verify. **The `/v1/models` half of the Verify step FAILS today** (the
configured id is absent) while the completion half PASSES - which is exactly why the completion cannot be
the check. `last_verified` stays at 2026-10-18 deliberately: Verify has not passed since.

2026-10-20 — **THE LOCAL MODEL IS NOW SWIFT 1.5, ON A DIFFERENT ENGINE.** The served id is
**`swift-1.5-iq2_xs`** (UkisAI's shorter-thinking fine-tune of Qwen3.8-Flash-Next, IQ2_XS, ctx 65536) and it
runs on **`engine\strata.exe`** — the Qwen engine — not `engine-poly\strata-poly.exe`. So the two shapes
below are both stale in their PATHS: the start script is `run-swift-iq2_xs.bat` (config
`strata-swift-iq2_xs.json`), and the model files are under
`PolyStrata-data\models\swift-IQ2_XS\Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-0000{1,2}-of-00002.gguf`.
**Before following the qwen36 steps, read `/v1/models`** — the model and the engine can change
independently of the rig, and following the old paths starts nothing while looking like a fix.
Also: IQ2_XS holds ~22 GB of experts in RAM (PolyStrata wants ~48 GB of RAM+VRAM and this PC has 32, so it
runs in low-RAM mode). If the machine is under memory pressure, a seat's local run can fail slowly rather
than cleanly; the install tip (`"env": {"STRATA_RESIDENT_HEADROOM_GIB": "6"}` in `strata-swift-iq2_xs.json`,
default 4) trades a little decode speed for ~2 GiB back to the system.
