# The delivery channel on Linux — can the broker be opened, and what does opening it cost?

*Delegate review, measured 2026-10-28T15:05–15:20Z on **Linux** (`Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`,
`node v24.22.1`, `date -u` = 2026-10-28T15:20Z).* Store `./selfdev.sqlite`, rig `rig.selfdev.json`.

**The question.** Three sessions in a row ended with "the delivery channel is the critical path, not the backlog"
(`docs/NEXT-ARCHIVE.md`, commits `aacf66b`, `446f63f`, `d0be2e4`). Two operator intents to `pm` have been undelivered
since `2026-10-27T05:04:46Z` — **2,037 minutes** at the time of the run below. This document answers the two things that
were still unmeasured: what a broker start on this box would actually do, and what one seat turn costs on the resident
local models.

**New instruments (delegate-only, `tools/`):**

| Instrument | What it establishes | Run |
|---|---|---|
| `tools/broker-serve.mjs` | the broker preflight: store, rig, spool depth + the **age of every pending intent**, provider reachability *and whether it advertises the configured model*, seat model families, seat cwds that do not resolve on this OS, the live-tree hazard, and the exact command/env a start would run. `--dry-run` writes nothing; `--start` refuses unless the blockers are acknowledged. | `node tools/broker-serve.mjs --dry-run` → exit 1, **2 blocking / 4 noted** |
| `tools/model-probes/cold-prefill.mjs` | what the **first** turn of a seat costs versus a re-send of an already-cached prefix, read from the server's own `timings`, with RAM/swap/load printed beside every number. | `node tools/model-probes/cold-prefill.mjs [baseUrl] [model]` |

## 1. The state, from the preflight (exit 1)

```
BROKER PREFLIGHT — linux (node v24.22.1), cwd=/home/chexxor/Git/Durian-Pi
  store: ./selfdev.sqlite (present)   rig: rig.selfdev.json (present)
  broker: down (no broker state)      genlock: none held
  spool: 2 pending intent(s) → pm [message] audit-15-orphans-and-5-parked — waiting 2037 min
                              → pm [message] memory-decompose-v2            — waiting 2037 min
  providers: local     http://127.0.0.1:47831/v1  model=iq3_s  ctx=200000  → answers, advertises iq3_s
             verifier  http://127.0.0.1:1234/v1   model=mistralai/ministral-3-14b-reasoning ctx=13273 → answers
  seats: 12 across 1 model — local/iq3_s (pm, impl, qa, qa2, lead, advocate, scribe, devtools, auditor, designer, security, architect)
  live tree: 3 tracked change(s) — M AGENTS.md, M package.json, M package-lock.json (+4 untracked)
  WOULD WAKE on the first pass: pm — and the routing decisions pm takes can wake other seats
  BLOCK stale-seat-cwd: devtools: C:/Users/Alex/dsh-Projects/pi-opendurig/item-2801
  BLOCK live-tree-dirty: a seat woken from this cwd edits this tree (F12/F23)
```

`cli.mjs check rig.selfdev.json` → `pass: true`, **62 findings**, including the `fix-now` `single-model-rig`:
*"all 12 seats resolve to local/iq3_s, so a shared blind spot is systemic."* `cli.mjs status` agrees: the only
`attention` entries are the five `deferred_awaiting_answer` rows (`#4813 pm`, `#4354 impl`, `#4816 lead`,
`#4817 devtools`, `#4814 qa2`), and `metrics.window` reads `turns: 103, quietForMs: 123,971,529` — **34 h 26 m**
since the newest seat turn.

### 1a. A claim in `docs/SELFDEV.md` that a dry run contradicts

`docs/SELFDEV.md` says *"`up --refresh` re-points each seat's persisted `cwd`"*. Measured:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run
# → writes: 0, wouldRefresh: 12 seats, every one with changes:{}  — devtools included
```

`previewUp` (cli.mjs:794, 815) computes `seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` and reports a cwd
change **only when the store disagrees with the rig file**. `rig.selfdev.json` itself names
`devtools.cwd = C:/Users/Alex/dsh-Projects/pi-opendurig/item-2801`, so a refresh would **re-assert the dead Windows
path, not repair it**. The repair starts in the rig file. (`src/seatroot.mjs:28` — a persisted cwd wins
unconditionally: `persisted seat cwd → DURIG_SEAT_ROOT → process cwd`. So that seat would wake into a directory that
does not exist on this box.)

### 1b. Two seats are already past their declared context window, and nothing fires on it

`cli.mjs status` → `context` (`src/context.mjs` sums one turn's `input + output + cacheRead + cacheWrite`):

| seat | consumed (last turn) | declared window | fraction | cacheRead |
|---|---:|---:|---:|---:|
| `advocate` | **244,751** | 200,000 | **1.224** | 243,200 |
| `architect` | **218,645** | 200,000 | **1.093** | 218,112 |
| `scribe` | 4,986 | 200,000 | 0.025 | 0 |
| the other 9 | 0 | 200,000 | 0 | 0 |

`grep -rn "fraction" src/attention.mjs src/checkup.mjs` → **no hits**: the number is computed and displayed and
**no rule reads it**. The 2026-10-27 provider measurement in `docs/ROADMAP.md` (≈line 3312) says this server answers
200 at 191,805 prompt tokens and **HTTP 400 at 207,219**. Both numbers cannot be true of the same server as the 243,200
cached-token turn above, so either that turn was recorded against the other box's provider (the store crossed machines)
or the enforcement differs from the advertised window. **Either way it is a wake risk with no guard** — registered as
ROADMAP 208, not asserted as a root cause.

## 2. What a seat turn costs on the resident models (the number every local-rig decision needs)

The repo's own method (`throughput.mjs`, per **D136**) computes prefill from a `max_tokens: 1` non-streaming call.
Run today it reports `5 / 23 / 59 tok/s` for prompts of 189 / 451 / 1,072 tokens — **a rate that rises with prompt
size is not a rate**. The strata server ships the ground truth in the final SSE chunk (`timings`), so the new probe
reads that instead:

```bash
node tools/model-probes/cold-prefill.mjs http://127.0.0.1:47831/v1 iq3_s
```

| prompt | COLD prefill (server-reported) | COLD decode | WARM (same bytes re-sent) |
|---|---:|---:|---|
| 419 tok | **438 tok/s** (956 ms) | 45 tok/s | 414/419 cached → **115 ms** total prompt time |
| 2,678 tok | **1,272 tok/s** (2,106 ms) | 58 tok/s | 2,673 cached → **131 ms** |
| 8,762 tok | **1,946 tok/s** (4,503 ms) | 63 tok/s | 8,757 cached → **96 ms** |

Machine during the run: `mem total 94G avail 23.0G used 71G | swap used 5.4G | load 8.5 8.4 6.2` — the swap and load
are printed because "the model is slow" and "the box is short of expert RAM" look identical from the endpoint
(`docs/SELFDEV.md`, "check the machine before blaming the rig").

**Consequences, each tied to a row above:**

1. **Cold prefill is ~2,000 tok/s and rises with prompt size** (fixed startup cost), which reconciles with the
   2026-10-28 `docs/ROADMAP.md` figure of 191,805 tokens in 79.9 s (≈2,400 tok/s). A *fresh* seat wake at ~200k
   tokens is therefore **~85–95 s**, not the "~13 h/day impossible" reading the 2026-10-20 local-capacity section
   feared for the old engine.
2. **A warm turn re-reads its whole context in ~0.1 s.** The prefix cache, not the GPU, is what makes a resident
   broker affordable — the same conclusion `docs/SELFDEV.md` reached from DeepInfra's cached-in token bill, now
   measured locally.
3. **The verifier endpoint cannot host a seat context.** `DURIG_VERIFIER_CONTEXT=13273`; LM Studio reports no
   `timings`, only TTFT: 712 ms / 2,260 ms / 7,672 ms for 500 / 2,791 / 8,959 tokens (≈0.7–1.2k tok/s prefill).
   That is the hard input for the pending ruling on **the 189 verifier family** (NEXT.md ruling 3): its cost is
   *context*, 13,273 tokens, not capability.
4. **`throughput.mjs`'s prefill column is wrong for a reasoning server and its decode column is right.** The D136
   method is quoted in docs; it should carry this caveat wherever it is cited.

## 3. What "just start the broker" would do, priced

Delivering the two spooled intents is not a read: `audit-15-orphans-and-5-parked` asks `pm` to issue
`release_work`/`cancel_work` transitions over **15 held rows**, and `memory-decompose-v2` (10,678 chars) asks `pm` to
decompose **ROADMAP 161–169** into queue items with *"start now, ahead of the rest of the registered backlog"*. pm has
no file capabilities, so the intents themselves are safe; **the routing they produce wakes `impl`/`scribe`/`devtools`**,
and those seats resolve to the cwd of the command that woke them (F12) — this tree, which holds three tracked operator
edits.

Five things must be true first. Rows 1–3 are one-liners and **all three are the operator's call**; row **2b** is a
code change in our own source and was found while measuring edit failures for a different question
(`docs/reviews/edit-machinery-2026-10-28.md` §2, D149 §4) — it is registered as ROADMAP **217** and is the one
that decides whether a woken seat can do its job at all.

| # | precondition | command / change | who |
|---|---|---|---|
| 0 | the constitution is in the seats' system prompts — **met mid-session, 2026-10-28T15:32Z** | `P2 Work protocol` added to `constitution.txt`, `rig.starter.json`'s inline copy regenerated by `tools/mirror-constitution.mjs`, then `up rig.selfdev.json` wrote the `durig.constitution` store doc the prompt section reads. Proven by `check` going from `constitution-not-applied` **error** (store 2,693 B vs file 3,643 B) to both rules **pass**. See D148 and `docs/runbooks/constitution-amendment.md` | operator instruction, executed by delegate |
| 1 | `devtools` cwd resolves | delete or re-point `seats[devtools].cwd` in `rig.selfdev.json`, then `node cli.mjs up rig.selfdev.json --refresh` (after `node tools/broker-serve.mjs --dry-run` shows `changes.cwd` for that seat) | operator (writing verb) |
| 2 | the live tree is not what a seat would edit — or is accepted as such | either the operator commits `AGENTS.md`/`package.json`/`package-lock.json`, or seats get per-item worktrees (on Linux that path needs `npm ci` + `node scripts/sync-pi.mjs --link`, **unverified here**) | operator |
| 2b | **a seat has a working shell on this host** — currently it does **not** | `src/seattools.mjs:215-221` registers `shell: createPowerShellTool()` and deliberately omits `bash` ("the seat shell is PowerShell, which `createPowerShellTool` resolves as `pwsh`, then `powershell`"), and pi throws **"The powershell tool is only available on Windows."** (`vendor/pi-main/packages/coding-agent/src/utils/shell.ts:127`). On this box `command -v pwsh` is empty and `bash` is `/usr/bin/bash`. The store agrees: `"toolName":"bash"` appears **0 / 137,368 entries**, `"toolName":"powershell"` **20,338** times, the last at entry **216,527 of 273,995** — i.e. **no seat shell call since the Linux move**, and the powershell errors cite `C:\Users\…`. A seat with no shell cannot run `node demo/<name>.test.mjs`, which is the constitution's oracle and the completion rule, so it can edit and not verify. Needs a host-conditional shell tool (ROADMAP 217); the seat instruction "The shell tool is powershell, all lowercase" lives in the operator-owned `rig.selfdev.json`, so it is proposed here, not edited | devtools (code) + operator (rig instruction text) |
| 3 | the author/verifier family split | `DURIG_VERIFIER_*` is already configured and answers; moving `qa`/`qa2`/`auditor` to `verifier/ministral-3-14b-reasoning` clears `single-model-rig` but costs the 13,273-token context ceiling | operator (model change is an operator action) |
| 4 | start it | `node tools/broker-serve.mjs --start --max-duration <s>` (needs `--allow-dirty --yes-pm-wakes`); verify with `tail -8 selfdev.sqlite.broker.log` expecting `START`, `INTENT delivered=2`, `PASS` advancing | delegate, once 1–3 are granted |

**Not done in this session: the broker was not started, so no intent was delivered.** The preflight refused it on
rows 1 and 2, and both are decisions rather than work. The two intents stay in the spool, which is idempotent —
`writeIntent` keeps a caller-supplied `requestId`, and the harness dedupes on `(conversation, requestId)`, so a retry
does not submit them twice (`src/broker.mjs:185`).

## How to re-verify this document

```bash
node tools/broker-serve.mjs --dry-run                        # exit 1; the 2 BLOCK rows above
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json # pass true, 62 findings, single-model-rig fix-now
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # 12 seats, changes:{} for all
DURIG_DB=./selfdev.sqlite node cli.mjs status                 # context.advocate.fraction > 1; attention = the 5 parked
node tools/edit-failure-rate.mjs ./selfdev.sqlite                       # edit 11.5% (71% anchor misses); bash row = 0 on Linux until 217 lands
node tools/model-probes/cold-prefill.mjs http://127.0.0.1:47831/v1 iq3_s          # the COLD/WARM table (Linux-only machine probe)
ls selfdev.sqlite.broker.inbox/                              # still 2 files until the channel is opened
```
