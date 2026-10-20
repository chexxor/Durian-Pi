---
runbook: local-provider-down
symptom: "a local seat (qa/devtools) fails to run: `No API key for provider: local` or `model_error: Connection error.`; nothing listens on 127.0.0.1:8080"
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

## Preconditions
None. Restarting `PolyStrata` is not a durig store write, so the broker may stay up. Do **not** stop the
durig broker for this.

## Diagnose (read-only)
```bash
netstat -ano | grep ':8080' | grep LISTENING
curl -s -m 5 http://127.0.0.1:8080/v1/models
DURIG_DB=./selfdev.sqlite node cli.mjs log qa 3
```
- Nothing on `:8080` (or `curl` returns nothing) = the server is down.
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
```bash
curl -s -m 5 http://127.0.0.1:8080/v1/models
```
Expect HTTP 200 with `"status": {"value": "loaded"}` and `"n_ctx": 65536`, e.g.
`{"id":"qwen3.6-35b-a3b-ud-q3_k_m", …, "status":{"value":"loaded"}, "meta":{"n_ctx":65536}}`.
Then confirm a real completion (not just the model list):
```bash
curl -s -m 60 http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"swift-1.5-iq2_xs","messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":32}'
```
A `choices[0]` with a `finish_reason` and non-zero `usage` proves inference works. The next local wake
(queued work or a re-driven seat) should then end in `stopReason: "toolUse"`/`"stop"`, not `"error"`.

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
