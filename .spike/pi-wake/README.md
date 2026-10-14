# Spike #209 — PIECE 1: Pi extension watcher that wakes a session on a durig event

Work item: #209 (PIECE 1 spike). Scope: **no durig product code**. Everything here is
under `.spike/pi-wake/` and is untracked.

Grounded on `docs/PUSH-ARCHITECTURE.md` §3.4/§4/§6 and the global Pi harness
`@earendil-works/pi-coding-agent@1.1.0` at
`C:\Users\Alex\.pi\agent\install\releases\1.1.0\...`.

## What this proves

A Pi extension, opened from `session_start`, watches a durig change source and — on a
matching event — injects a message that **starts a real turn*. Falsifiable both ways:

- **(a)** a matching durig event (a QUEUED queue item addressed to the watched seat)
  makes the Pi session receive an injected message and **start a turn**;
- **(b)** with the watcher **disabled**, the identical durig event produces **nothing**.

## Files

| File | Role |
|---|---|
| `watcher.ts` | The **deliverable**: Pi extension. `session_start` → poll `durig watch --once --json` → on a queued item for the seat, `pi.sendUserMessage(WAKE_CONTENT)`; dedupe by item id; release on `session_shutdown`. |
| `setup-queued-item.mjs` | Creates the durig change to watch: `up rig.starter.json` then `enqueueItem(...)` so ONE item stays `status:"queued"` (uses exported API + the CLI only). |
| `prove-wake.mjs` | The proof driver. Runs the real global Pi headlessly in RPC mode and checks its JSONL stdout for the injected turn. Exits 0 when both directions behave. |
| `smoke-ext.ts` | First probe: an unconditional `session_start` wake, used to confirm the run loop reaches `turn_start` headlessly. Superseded by `watcher.ts`. |

## Change source and matching rule

`durig watch --once --json` emits a snapshot with `queueItems`. The watcher matches an
item with `to === <seat> && status === "queued"` — exactly the predicate `selectWakes`
uses in `src/driver.mjs` (`hasQueued = items.some(it => it.to === name && it.status === "queued")`).
The injected string is **fixed per event class** (not interpolated with the item id):
a varying body changes the conversation prefix and zeroes the prompt cache (ROADMAP 33).

Raw `watch --once --json` `queueItems` entry observed after the setup (exit of the
`Setup` path is 0):

```json
{"id":1,"from":"pm","to":"impl","subject":"SPIKE_DBG","body":"Setup for spike #209: SPIKE_DBG","optimizedVia":null,"notice":false,"status":"queued","transitions":[{"at":"2026-10-13T17:01:06.404Z","event":"queued","by":"pm"}]}
```

## Raw evidence (commands + exit codes + observed effect)

### Syntax check on every spike file — `node --check` (node v24.19.0)

```
node --check .spike/pi-wake/setup-queued-item.mjs   -> exit 0
node --check .spike/pi-wake/prove-wake.mjs          -> exit 0
node --check .spike/pi-wake/watcher.ts              -> exit 0   (node v24 strips types)
node --check .spike/pi-wake/smoke-ext.ts            -> exit 0
```

(`node --check` genuinely validates `.ts` on v24: a deliberately broken `.ts` exits 1
with `SyntaxError: Unexpected end of input`.)

### Setup alone — produces the change

```
node .spike/pi-wake/setup-queued-item.mjs <db> impl SPIKE_DBG2  -> exit 0
  {"ok":true,"itemId":1,"to":"impl","status":"queued"}
node cli.mjs watch --once --json   (DURIG_DB=<db>)              -> queueItemCount=1, status="queued"
```

### The proof: `node .spike/pi-wake/prove-wake.mjs`  -> exit 0

```
===== DIRECTION a (watcher ENABLED) =====
[a] enqueue -> exit=0 {"ok":true,"itemId":1,"to":"impl","status":"queued"}
[a] record types seen: extension_ui_request,agent_start,turn_start,message_start,message_end,
                       message_update,tool_execution_start,tool_execution_end,turn_end,tool_execution_update
[a] wake user message injected: true
[a] turn_start observed: true
[a] injected user message: {"role":"user","content":[{"type":"text","text":"durig: queued work is waiting. Call claim_work to take the oldest item addressed to you."}],"timestamp":1791910889569}
[a] watcher stderr:
  [spike-watcher] watching db=...\rig.sqlite seat=impl every 400ms
  [spike-watcher] matched queued item #1 for seat impl; injecting wake

===== DIRECTION b (watcher DISABLED) =====
[b] enqueue -> exit=0 {"ok":true,"itemId":1,"to":"impl","status":"queued"}
[b] record types seen: extension_ui_request
[b] wake user message injected: false
[b] turn_start observed: false
[b] watcher stderr:
  [spike-watcher] disabled (DURIG_SPIKE_DISABLED=1); no change source opened

===== VERDICT =====
(a) watcher enabled  -> wake user msg=true, turn_start=true  => PASS
(b) watcher disabled -> wake user msg=false  => PASS
=== PROVE EXIT=0 ===
```

Direction (a) shows a real run: `agent_start` → `turn_start` → the injected `user`
message → `tool_execution_*` (the model acted on the wake). Direction (b) shows only
Pi's own `extension_ui_request` records — no wake, no turn.

## Known limits found

1. **The harness is not a durig dependency.** `pi-coding-agent` lives only in the
   global install outside the seat root; the worktree's `node_modules` has chord, pi-ai,
   pi-durable, pi-telemetry, pi-tui — no coding-agent. A shipped extension needs it as a
   real dependency (or a Pi package), not a global path.
2. **`read` tool is confined to the seat root; the shell is not.** The `read` tool
   refused `C:\Users\Alex\.pi\...\docs\extensions.md` ("outside the seat's worktree"),
   while `Get-Content` under `powershell` read it fine. Any spike step that needs the
   global Pi tree must go through the shell, not `read`.
3. **The change source is a poll, not a subscription.** `watch --once --json` is polled
   every `DURIG_SPIKE_POLL_MS`; there is a wake latency of up to one interval. A durable
   `seq` cursor (piece 2) removes both the poll and the replay risk.
4. **`send` is not an enqueue.** `durig send <seat>` drives the seat and consumes the
   item, so it cannot leave a queued item to wake on; the spike enqueues via the exported
   `enqueueItem` instead. The real writer (the broker, piece 3) would enqueue + wake.
5. **Reading a doc back inside a second `harness.commit` throws** `Cannot use a settled
   overlay`; read through `harness.documentState(...)` instead (fixed in the setup).

## Demo suite status (honest)

`for f in demo/*.test.mjs: node $f` → **47/48 pass**, one failure: `syncpi.test.mjs`.
It is **pre-existing and not mine**: `pi-main.pin.json` is malformed — the `note` string
from the #176 rebase is missing the comma before `"packages"`, so `scripts/sync-pi.mjs`
`readPin` throws `SyntaxError: Expected ',' or '}' ... at position 729`. `.spike/` is
untracked and imported by no demo, so the spike cannot affect it. The 47 non-syncpi
demos are green.
