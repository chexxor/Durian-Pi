---
runbook: local-provider-down
symptom: "a local seat (qa/devtools) fails to run: `No API key for provider: local` or `model_error: Connection error.`; nothing listens on 127.0.0.1:8080"
writes: false
precondition: "none"
last_verified: 2026-10-20
verified_by: delegate
evidence: "2026-10-20 reverse move (local DOWN) verified: up --refresh --dry-run named only qa+devtools, the real run recorded resetEntryId 153838/153841, `check rig.selfdev.json` ok:true, PolyStrata server+engine killed and :8080 refused (curl exit 7), `grep -c 'local/' rig.selfdev.json` = 0, and both replacement DeepInfra ids answered a real completion (HTTP 200). Earlier: 2026-10-18T19:10Z PolyStrata restart + live chat completion."
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

## The REVERSE move — taking the local model DOWN (verified 2026-10-20)

Operator-directed, so treat it as a planned operation rather than a recovery: seats that name `local/<id>`
are moved back to their previous hosted models and the PolyStrata stack is stopped. This is a **model
change**, so `broker-safe-change.md` governs the store half — do not shortcut it.

**0. Catalog entry FIRST (the rule that prevented the 2026-10-19 outage).** `buildModels` reads only
`fallbackModels()` in `src/providers/deepinfra-models.ts`; a seat naming an id that is missing from it dies
`no_model` before any request. If the model you are returning to is already there, say so and prove it:
`node demo/deepinfra-catalog.test.mjs` prints `… N rig seats resolve`.

**1. Pick models by HISTORY, not by taste.** `git log -p -- rig.selfdev.json` shows what each seat held
before the local move. Restore each seat's own previous model. Then re-check the author/verifier rule: the
two seats that shared the local model (usually `qa` + `devtools`) become cross-family again as soon as they
are back on different hosted families — but only if you actually picked different families.

**2. Read the change before writing it** (read-only, no stop needed):
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # names the resets
```

**3. Quiesce, then write** (`broker-safe-change.md` steps 1–2), then:
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh   # records resetEntryId per seat
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json           # expect ok:true, exit 0
```

**4. STOP the PolyStrata stack — server AND engine.** The supervisor (`python … serve/server.py`) and the
engine (`strata.exe --serve --pack …`) are separate processes; killing only the server leaves the engine
holding VRAM and RAM:
```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe' or Name='strata.exe'\" | Select-Object ProcessId,Name"
netstat -ano | grep ':8080' | grep -i listen        # the listener pid is the server to stop
```

**Verify (all three, not one):**
```bash
netstat -ano | grep ':8080' | grep -i listen                 # expect NOTHING
curl -s -m 3 http://127.0.0.1:8080/v1/models; echo "exit=$?" # expect exit=7 (connection refused)
grep -c "local/" rig.selfdev.json                            # expect 0
```
Then prove the new model ids for real — a `/v1/models` listing is not inference. A one-line completion per
id against DeepInfra (HTTP 200 + a `choices[0]` with `finish_reason`) is the check that would have caught
the 2026-10-19 `no_model` class.

**Watch the model's output shape, not just its status.** Measured 2026-10-20 on `Qwen/Qwen3.6-35B-A3B`
(the restored `qa` model): with `max_tokens: 16` the completion comes back with an EMPTY `content` because
its reasoning consumes the whole budget, and at 512 the reasoning text leaks into `content`. A smoke test
that sends 16 tokens will read that as "broken"; it is not. **Give a reasoning model enough budget to
finish before concluding anything about resolution.**

**Leave the config, not just the rig.** `durig.config.json` still holds `DURIG_LOCAL_*`; keeping it makes
the reverse move a two-line change later. Restarting is `local-provider-down.md`'s Do section plus
`run-swift-iq2_xs.bat` — note the ENGINE differs between the two local models (`strata.exe` for Swift 1.5,
`strata-poly.exe` for the older Qwen pack), so an old log line naming the other engine is expected.
