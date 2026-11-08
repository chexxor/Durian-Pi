---
runbook: local-provider-down
symptom: "a local seat fails to run: `model_error: 401 \"Invalid API key\"`, `model_error: Connection error.`, or `No API key for provider: local`; `/v1/models` on the configured port 401s or does not list the model the seat's `local/<id>` names. NOTE the port may be OPEN and answering while the provider is unusable — see Diagnose state 3 and the 2026-11-04 state 5"
writes: false
precondition: "none"
last_verified: 2026-11-06
verified_by: delegate
evidence: "2026-11-04 (Linux Fedora 44 7.2.14-200.fc44.x86_64 node v24.22.1): state 5 found and fixed — Strata on 127.0.0.1:47831 returns 401 `Invalid API key` without a credential, so every `local/iq3_s` seat died `model_error: 401`; with `DURIG_LOCAL_API_KEY` supplied the provider's own registration path answered `stopReason:stop` (59 in / 36 out, cost 0 by locality). Earlier: 2026-10-20 reverse move (local DOWN) verified. 2026-11-06: state 6 (a LAN strata box passes /models and /health yet misses the preflight's 20s completion bound -> `START REFUSED`) and state 7 (per-box keys after a rotation: one 74-char `DURIG_LOCAL_API_KEY` 401s on BOTH boxes) found; ROADMAP 325/326. PARTIAL re-verification 2026-11-06T08:0xZ (host signature in docs/NEXT.md): the PORT pointers re-measured — `curl` to `127.0.0.1:47831` and `127.0.0.1:47832` both exit **7** (ECONNREFUSED, `HTTP 000`); `ps -eo pid,args` shows the live launch `-m serve.server … --host 0.0.0.0 --port 8080` and `ss -ltnp` shows **`0.0.0.0:8080`** owned by that serve.server pid; `curl http://127.0.0.1:8080/v1/models` answers `authentication_error: missing or wrong API key`. The firewall section is **NOT** re-verified: `firewall-cmd --state` returns a D-Bus `Did not receive a reply` error with exit **254**, so a delegate cannot answer those questions today. `last_verified: 2026-11-06` records the state-6/state-7 legs only — the Do/Verify legs of this runbook were NOT re-run."
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
| **`BLOCK provider-DURIG_LOCAL_-unauthorized: … ANSWERED /v1/models with HTTP 401`** in `node tools/broker-serve.mjs --status` | **state 5 seen from the preflight, and since #5111 named for what it is: the server ANSWERED, so it is not down.** Read the rest of the line before acting. `/chat/completions COMPLETES … inference WORKS` means only the LISTING refused the credential (a server may protect `/models` and still serve inference) — that is a NOTE, not a block. `/chat/completions also refused (…)` means the block is evidence: supply the key (Do 0). `--no-probe` prints the verdict too and says inference is **unproven**, never a verdict it did not measure. A **404** prints `provider-DURIG_LOCAL_-models-not-found` — reachable, wrong path; only a refused connection or a timeout is still `provider-DURIG_LOCAL_-unreachable`. **If an older transcript says `provider-DURIG_LOCAL_-unreachable: … HTTP 401`, that string is the defect #5111 fixed: re-run `--status`, do not act on it.** Pinned by `demo/broker-serve-provider-auth.test.mjs` (a loopback server that REQUIRES a key: keyed → answers+completes; unkeyed → `unauthorized` naming `DURIG_LOCAL_API_KEY`, never `unreachable`; 404 → path; closed port → still `unreachable`) |
| **`/v1/models` 401 `{"error":"Invalid API key"}`** | **state 5 - the server DEMANDS a credential and the rig sent the loopback placeholder.** `src/providers/local.mjs` sends `LOOPBACK_PLACEHOLDER_KEY` (`"no-key-required"`) whenever the endpoint is loopback and `DURIG_LOCAL_API_KEY` does not resolve, because a *keyless* llama.cpp accepts anything. A server with a key set rejects it, and the seat's run ends `model_error: 401 "Invalid API key"` with no hint about the credential. Fix: supply the key (see Do 0). Measured 2026-11-04 on Strata `:47831` |

A port probe (`netstat`, `Test-NetConnection`) can only tell states 1 from 2/3/4 - it cannot tell a dead
provider from an unrelated listener. Use it to find the PID, not to conclude.
- `log qa` showing `"provider":"local","model":"swift-1.5-iq2_xs"` with `"stopReason":"error"` and
  `"errorMessage":"Connection error."` is the server-down signature.
- `"errorMessage":"No API key for provider: local"` is a DIFFERENT cause — the broker restarted without
  `DURIG_LOCAL_API_KEY` (see `broker-down-or-stalled.md`).
- **`"errorMessage":"401 \"Invalid API key\""` is state 5** — the server wants a real key and got the placeholder.
  The store spells it exactly like that in `attention[].detail` (`<seat> | model_error: 401 "Invalid API key"`), and
  `log <seat>` shows `stopReason: "error"` with zero tokens.

## Do
0. **State 5: give the rig the server's key, from a file that cannot be committed.** The key is a bearer token; it
   must not sit in `durig.config.json` (gitignored, but inside the tree a backup, a worktree copy or a `git add -A`
   can still sweep it) and never in source. Put it **outside the repo, mode 600**, and load it at launch:
   ```bash
   install -m 700 -d "$HOME/.config/durig"
   (umask 077; printf 'DURIG_LOCAL_API_KEY=%s\n' '<key from the Strata app>' > "$HOME/.config/durig/env")
   node --env-file="$HOME/.config/durig/env" cli.mjs serve      # and every `send`/`run` that opens a harness
   ```
   Verified 2026-11-04: `node --env-file` carries it into the verb, `cli.mjs config` prints **0** occurrences of the
   value, and `status.secretFindings` stays `[]`. The provider sends it as a Bearer token; on a loopback endpoint
   the model row keeps `cost: 0` (free by locality) and **no ledger row is written**.
   `tools/broker-serve.mjs --status` is the cheap check (it fetches `/v1/models` and fails when the configured model
   is not advertised) — run it with the same `--env-file` or it will report the 401.
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

## Reaching the same server from ANOTHER computer (measured 2026-11-04, Strata)

> **Ports are DERIVED at launch, so a port in this runbook is a pointer to a probe, never a value to paste.** Every
> `47831`/`47832` below is what the **2026-11-04** launch bound. Re-measure in one command before you cite a port,
> build a tunnel, or open a firewall hole:
>
> ```bash
> ps -eo pid,args | grep -E 'serve\.server|strata --serve' | grep -v grep   # the launch's own --host/--port
> ss -ltnp | grep -E ':(8080|4783[0-9])'                                    # what is actually LISTENing now
> curl -s -w 'HTTP %{http_code}\n' http://127.0.0.1:<measured-port>/v1/models; echo "exit=$?"   # exit 7 = nothing there
> ```
>
> **Re-measured 2026-11-06T08:0xZ** (same host as docs/NEXT.md; no hostname per D205): the live launch is
> `-m serve.server … --host 0.0.0.0 --port 8080`; `ss -ltnp | grep 8080` → **`0.0.0.0:8080`** (python3.12, that
> serve.server pid); an earlier `ss -ltn` the *same hour* showed `127.0.0.1:8080`, so the bind itself moves across a
> restart — another reason to measure rather than quote. `curl` to **47831 and 47832 both exit 7** (ECONNREFUSED,
> `HTTP 000`). So the sentence below about **loopback only** was TRUE of the 2026-11-04 launch and is **not true of the
> 2026-11-06 launch** (it binds `0.0.0.0`), and the port literals throughout are the old launch's numbers kept for
> their structure, not as current values.

The local model server bound **loopback only** as measured 2026-11-04 — `ss -ltnp` showed `127.0.0.1:47831` for the
Strata host and nothing on `0.0.0.0` (see the marker above: re-measure, this changed). Three ways to reach it from a
second machine, cheapest-correct first:

1. **The app's own Share listener (recommended, built in).** Strata ships a *separate, key-protected listener for
   inference only* (`host/server/local-share.mjs`): `createLocalShare({ host = "0.0.0.0", port = PORT + 1 })`,
   serving exactly `/v1/models`, `/v1/chat/completions`, `/v1/messages`, gated on the app's API key, with CORS
   preflight answered — it never serves the UI or the host APIs. With the 2026-11-04 `PORT=47831` the URL was
   **`http://<lan-ip>:47832/v1`** (`sharePort = findFreePort(STRATA_SHARE_PORT ?? PORT + 1)` — i.e. **the share port is
   the serve port + 1**: derive it from the `--port` you just measured, do not copy this one), and it is **off until
   enabled in the app** (measured 2026-11-04: no listener on 47832 while the host was up on 47831; measured
   2026-11-06: no listener on either). Then, from the other
   computer: `Authorization: Bearer <the same key>`.
2. **SSH tunnel (safest; keeps the server on loopback and encrypts the bearer token).** From the second machine:
   `ssh -L <measured-port>:127.0.0.1:<measured-port> <user>@<this-box>` (2026-11-04: `ssh -L 47831:127.0.0.1:47831 …`) and point the client at `http://127.0.0.1:<measured-port>/v1`. Nothing new
   listens on the LAN and the key never crosses the network in cleartext.
3. **Rebind the host itself** (`STRATA_BIND=0.0.0.0`, read at `host/server/index.mjs` alongside `STRATA_PORT`).
   **Not recommended:** that listener also carries the UI and the host APIs, and a key that is set for inference
   does not necessarily gate them.

**The trap that bites durig specifically:** `endpointClass()` (`src/providers/local.mjs:77`) calls any **non-loopback**
URL `metered`, so a seat pointed at `http://<lan-ip>:47832/v1` is refused at registration with
`metered-endpoint-unpriced` unless a price is declared — measured: the same config with
`DURIG_LOCAL_PRICE_USD_IN=0 / _OUT=0` registers, `priceSource: "DURIG_LOCAL_PRICE_USD_IN/OUT"`, because **0 is a
legitimate DECLARED price**. Two consequences: (a) a LAN URL costs a config change (a ruling, not a paste); (b) an
SSH tunnel keeps the URL loopback, so it needs no price declaration at all — one more reason to prefer option 2.

### Firewall on this host (measured 2026-11-04, Fedora 44) — what actually gates a LAN client

> **Not re-verified 2026-11-06 — the instrument itself is unreachable to a delegate.** Re-running the block below that
> day gave `firewall-cmd --state` → `Error: Did not receive a reply …` with **exit 254** for every verb (including
> `--query-port=8080/tcp`), so the allow-list facts recorded here are **2026-11-04 facts whose ports are also stale**
> (the launch moved to `:8080`, see the marker above). Treat every port in this section as `<measured-port>`, and if
> `firewall-cmd` errors like that, say what is missing rather than re-asserting the numbers.

`firewall-cmd` is readable **without root** for queries, and that is the only trustworthy answer:

```bash
firewall-cmd --state && firewall-cmd --get-active-zones   # running; public on enp39s0
firewall-cmd --list-all                                    # RUNTIME
firewall-cmd --permanent --list-all                        # what survives reload/reboot
firewall-cmd --query-port=47832/tcp                        # exit 0 = yes, 1 = no
```

State found: `public` zone on `enp39s0`; services `dhcpv6-client mdns ssh`; runtime ports
`47984/tcp 47989/tcp 48010/tcp 47831/tcp 47998-48002/udp 48010/udp`. Two facts matter:

- **`47831/tcp` is allowed in the RUNTIME config only.** `--permanent --list-ports` does not list it, so that
  allowance **disappears on the next `firewall-cmd --reload` or reboot**. If the rig depends on it, add it
  permanently.
- **The Share listener's port is NOT allowed.** The app's LAN share binds `0.0.0.0:47832`
  (`sharePort = findFreePort(STRATA_SHARE_PORT ?? PORT + 1)`), it is up and key-gated (measured: `401` without a
  bearer token, `200` with), and `firewall-cmd --query-port=47832/tcp` → **no**. A remote machine is rejected by
  firewalld no matter how correct the server is.

**A same-host test through your own LAN IP CANNOT answer this question — measured, and it is a trap.** With a
throwaway listener on `0.0.0.0:39999` (a port in no allow list at all), `curl http://192.168.1.101:39999` returned
**HTTP 200** from the same box, while `firewall-cmd --query-port=39999/tcp` says `no`. Traffic to your own address is
looped back through `lo`, which firewalld accepts, so the packet never arrives on `enp39s0` and the zone is never
consulted. Use `--query-port` / `--list-all`, or test from the second machine.

To let another computer reach the **inference-only** listener (recommended over opening the host port, which also
carries the UI and host APIs):

```bash
sudo firewall-cmd --permanent --add-port=47832/tcp
sudo firewall-cmd --reload
firewall-cmd --query-port=47832/tcp        # expect: yes
```

Then from the other computer:

```bash
curl -s -H "Authorization: Bearer <the key>" http://192.168.1.101:47832/v1/models
```

**No firewall change at all** is needed for the SSH-tunnel option above: `ssh` is already an allowed service, and the
tunnel keeps the URL loopback (so durig also needs no price declaration).

## 2026-11-06: state 6 — the port is OPEN, the model is LOADED, and the box still cannot serve a seat (325)

This is the case where every "is it up?" read says yes. `/v1/models` answers in 2-3 ms and reports
`"status": {"value": "loaded"}`, `/health` answers `{"status":"ok","loaded":true,"max_context":131072}`, and the rig's
preflight still refuses to start:

```
NOTE   provider-local-priced-metered: local/<id> is a metered endpoint priced at $0/$0 per Mtok …
BLOCK  provider-local-completion-failed: local: /chat/completions failed — timeout after 20s
START REFUSED: provider-local-completion-failed
```

Read the box's own scheduler first — it is a **single slot**, and it tells you who is in it:

```bash
curl -s -H "Authorization: Bearer <key>" http://<lan-host>:8080/status
# measured: {"busy":true,"queued":0,"phase":"answering","prompt_tokens":18978,"generated":5316,"max_tokens":16384,
#            "thinking_budget":12288}   … and `generated` moved 5,316 -> 5,830 in 64 s  => ~8 tok/s
```

Then time a real completion **against the preflight's bound**, because that is the number the rig enforces:

```bash
node .spike/delegate-20261106/strata-endpoint-check.mjs   # prints ctx, /status, and ms-vs-20000ms PASS/FAIL
```

Measured on 2026-11-06 (Linux Fedora 45, node v24.22.1): the LAN box took **129.5 s** for a 31-token completion
(`finish_reason: stop`) and timed out at 150 s and 45 s on other attempts; the loopback box took **1.4 s** on the same
prompt. **Do not lower the gate by trial and error.** If a minute-scale seat turn is acceptable, raise
`DURIG_STREAM_TIMEOUT_MS` deliberately (a capacity ruling — put the measured tok/s on the row that raises it). If it is
not, keep the family on loopback: the flip is one `DURIG_LOCAL_BASE_URL` plus `DURIG_LOCAL_CONTEXT` (131072 on the LAN
box, 200000 on loopback — take the number from `/health`'s `max_context`, not from memory) plus that box's key.

**State 7 — after a credential rotation, which box holds which key.** One `DURIG_LOCAL_API_KEY` arms exactly one box.
Measured: the rotated rig key (74 chars) was **401 on both boxes**, while pi's own per-provider entries
(`~/.pi/agent/auth.json`: `strata.key`, `strata-server.key`) each answered **200** on their own box and **401** on the
other. `cli.mjs status`, `check` and the roster stay green through all of this; the only instrument that caught it is the
preflight completion probe. And when you diagnose it, **do not paste preflight output into a report** — the open
**295** prints `DURIG_LOCAL_API_KEY`/`DURIG_VERIFIER_API_KEY` **values**.

**The price footgun on this path (323).** A LAN URL is not loopback, so the family becomes `metered` and needs a DECLARED
price (`0` is legitimate). But `CONFIG_KEYS` has no `DURIG_LOCAL_PRICE_*` keys, so putting them in `durig.config.json`
makes **every** CLI verb exit `unknown config-file key(s) …`. Declare them in the **environment** (`~/.config/durig/env`,
loaded with `node --env-file=…`), and remember the consequence: a start **without** `--env-file` then registers no model
row and the whole author family goes dark with `registration-refused`.

**State 8 — the server was bounced and now serves a different model id (2026-11-08).** Symptoms: every seat turn dies
in ~1 ms with `Model … is not available` / `reason: no_model`, the broker log looks normal (`woke=impl` on pass after
pass), and no conversation gains an assistant entry. Diagnose in this order, all measured on this rig:
1. `curl -s -H "authorization: Bearer $DURIG_LOCAL_API_KEY" http://127.0.0.1:8080/v1/models` — read the **id** the box
   advertises and its `meta.n_ctx`.
2. `node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status | grep -E 'completes|BLOCK'` — the
   preflight prints `BLOCK provider-DURIG_LOCAL_-model-absent: … advertises [<served id>] but the config names
   '<configured id>'`.
3. `node -e 'const{DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("./selfdev.sqlite",{readOnly:true});
   for(const r of d.prepare("SELECT id,conversation_id,record FROM tasks WHERE kind=? ORDER BY id DESC LIMIT 5").all("\"pi.generation\"")){const j=JSON.parse(r.record);console.log(r.id,r.conversation_id,j.state?.outcome?.status,j.state?.outcome?.error?.message)}'`
   — confirms the failure is at registration, not at the wire.
Fix: set `DURIG_LOCAL_MODEL` (and `DURIG_LOCAL_CONTEXT` to the advertised `n_ctx`) in `durig.config.json`, re-point
every `local/<id>` string in `rig.selfdev.json`, re-point the `DURIG_COMPACTION_MODEL_OVERRIDES` key, commit the roster
(a dirty tracked tree makes `broker-serve --start` refuse: `START REFUSED: live-tree-dirty`), then
`node --env-file="$HOME/.config/durig/env" cli.mjs up rig.selfdev.json --refresh` with the broker stopped.
Do **not** rely on llama.cpp's rerouting: a request for an unadvertised id is answered by the served model, so the
stale id looks fine at the wire while the rig refuses to register it.
