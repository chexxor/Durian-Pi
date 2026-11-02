## NEXT SESSION (2026-11-02T02:10Z — D189, Linux: `#4977` is COMMITTED and VERIFIED FIXED on `item-4977`, NOT landed)

**Current item:** `#4977` (the broker pre-flight that falsely blocked the seat shell). `devtools` committed **`ac5e1d37
fix(shell-availability): the broker preflight asks the registry, never vendored text (#4977)`** in worktree `item-4977`, and
the delegate verified in that worktree that the `BLOCK seat-shell-availability` is now a `NOTE`. The row was still `claimed`
at clock-out and **nothing is landed**.
**Next command:** `node cli.mjs land item-4977 --merge --into main` — run from `/home/chexxor/Git/Durian-Pi`, **only after
the operator names that landing** (§1). If the send died in the meantime, read `.spike/fix-20261102/send-devtools2.out`
first and re-brief the `complete` leg only — the commit already exists.
**Blocker:** the landing grant is the operator's and was not given this session; and behind it, the `qa` verify leg (`#4974`)
is blocked on a ruling, not a fix — `tools/model-probes/probe-preflight.mjs` returns `REFUSE: swap 79% used (max 50%)`, and
the only verifier file that fits the one free card is the model with 0/16 clean controls.

Older sessions live verbatim in `docs/NEXT-ARCHIVE.md` (link it, and the pointer test enforces that).

**Pointer hygiene first:** **136 lines** (`wc -l`) / 137 counted entries — measured AFTER the last edit to this file, and
wrong for anyone who edits it after me. The previous pointer was labelled **"D188 daytime"**, but **no `D188` entry exists in
`docs/DECISIONS.md`** (`grep -c D188 docs/DECISIONS.md` = 0) — that session's rulings live inside `D187`'s block and in the
pointer text only. **This session's entry is `D189`** (verifier pre-flight outranks the window argument; `resume` has no
re-arm path; the config surface is cwd-scoped). And `node scripts/test.mjs --red --all --json` — the command this file
queued as step 0 last session — **is not a command**: there is no `--red` flag (`scripts/test.mjs:46-52`), it exits 2 on
the usage block. The runner takes `--area|--all|--list|--jobs|--timeout|--json`; the pointer gate is the `next-pointer`
demo (`demo/next-pointer.test.mjs`).

## Measured state at clock-out (2026-11-02T02:05Z, Linux/Fedora 44 on `Alex-Desktop-Win10`, node v24.22.1)

- **`main = 51e3b9b1` (this session's own docs commit), 90 commits AHEAD of `origin/main` (`eea4effb`)** — 61 at the last
  clock-out, the team added 28 more, and the delegate added 1. `#4977`'s commit `ac5e1d37` is on branch `item-4977`, **not**
  on `main`. **Still no push grant.** That is a durability risk, not a cleanup item.
- **SUITE: 243/244 in ~52 s** at `--jobs 8`, 244 demos, in the full tree (**187 `node_modules` entries + `vendor/pi-main`
  present** — NOT the thin 80-entry tree earlier pointers quoted). One red: `demo/deepinfra-catalog.test.mjs` (pre-existing
  catalog/network). **Running the suite while a seat run is live manufactures reds** — measured 241/244 with
  `seat-turn-shape` + `broker-stop-audit` red, both green standalone 40 s later. Verdict written to
  **`.spike/delegate/suite-marker.json`** so `scripts/clockin.mjs` prints it with its sha and a STALE flag instead of anyone
  re-running the suite.
- **4,989 rows** — 3,782 `done` / 794 `cancelled` / 328 `held` / 65 `queued` / 12 `deferred` / 8 `claimed` = **413
  non-terminal** (was 414; `resume` cleared 2).
- **Broker NOT resident** (`selfdev.sqlite.broker.json` absent). All 12 seats registered with `engine:"local"`; every
  seat's `projection` is `[]` (empty since restart — "no work in flight", not a dead seat).
- **LOCAL ENGINE: UP.** `curl -s http://127.0.0.1:47831/v1/models` → `{"object":"list","data":[{"id":"iq3_s","gpus":[1]}]}`;
  it served a 25-minute `devtools` turn this session. It sits on **GPU1 (`RTX 3090`) at 23,020/24,576 MiB = 94 % full**.
  **`scripts/clockin.mjs` prints `local=NOT SET` and `local endpoint: DOWN (fetch failed)` — FALSE TWICE** (it reads 9
  config keys that exclude `DURIG_LOCAL_*`, and probes a hardcoded `:8080`). Never prioritize off that block.
- **VERIFIER: not loadable right now, by the rig's own guard.** Both private configs declare
  `DURIG_VERIFIER_MODEL=mistralai/ministral-3-14b-reasoning`, window 24576 / maxTokens 3000. LM Studio `:1234` is up with
  **no instance loaded**. `node tools/model-probes/probe-preflight.mjs` → **`REFUSE: swap 79% used (max 50%) — zram is the
  ceiling here, not RAM`** (`strata` 49.2 GiB RSS / 40.2 GiB shmem). The only free card is the **16 GB A4000**, so
  `flint-Q4_K_M.gguf` (**24,166,841,184 B**) cannot load and `Ministral-3-14B-Reasoning-Q6_K` (**11,088,407,584 B**) can —
  and ministral is the model with **0/16 clean controls** (`verifier-model-server.md`, D137). **This is the operator's call;
  take these numbers to them, do not spend a cold load to re-discover them.**

## 0. THE ONE THING THAT MOVED — `#4977` is COMMITTED, VERIFIED, and NOT landed

- `devtools` committed **`ac5e1d37 fix(shell-availability): the broker preflight asks the registry, never vendored text
  (#4977)`** in worktree `/home/chexxor/Git/Durian-Pi/item-4977` (base `67aa0096` — **20+ commits behind `main`**).
- **Verified by the delegate in that worktree:** `node tools/broker-serve.mjs --status` now prints
  `NOTE seat-shell-availability: the seat shell tool "bash" CAN start on linux — /usr/bin/bash (registry: bash [spawns
  bash]: CAN start (/usr/bin/bash) [preferred on this host] | powershell [spawns pwsh, powershell]: cannot start)` —
  **the BLOCK is gone.** The other blocks in that run are artifacts of where it ran (`store-missing` — I passed no `--db`;
  `live-tree-dirty` — the seat was mid-write).
- **`#4977` was still `claimed` at clock-out** and its send was still live at **51+ min**
  (`ps -p $(cat .spike/fix-20261102/send2.pid)`), with **two** commits on the branch — `ac5e1d37` (the fix) and
  `5d65d59c docs(tools/README,runbooks): the rows that asserted the false shell BLOCK are corrected (#4977)` — and a **clean
  worktree**. **READ `.spike/fix-20261102/send-devtools2.out` first.** If the pid is gone and `#4977` is still `claimed`, the
  run was killed a third time: `resume` cancels the submission and leaves both commits alone, then re-brief for the
  `complete` leg ONLY, and say in the brief "the commits exist, do not re-implement".
- **The delivery channel is itself deprecated while no broker is resident:** every `send` prints
  `send is DEPRECATED (opens a full writing harness = a second owner): prefer node intent.mjs <seat> --body-file <file>`
  (D186.4). This rig still has to use `send` because `#4977`'s false `BLOCK seat-shell-availability` is what stops
  `broker-serve --start` — which is why landing it is step 1 and not housekeeping.
- **CONFLICT TO EXPECT when landing:** `devtools` edited `docs/runbooks/session-start-cost.md`,
  `docs/runbooks/hygiene-and-dead-model-pointers.md` and `tools/README.md` **in its worktree** while I edited the same
  `session-start-cost.md` in the operator checkout. Resolve by keeping both sections.

## 1. Land `#4977` — ASK FIRST (the operator has NOT granted this one)

- The standing grant covered `#4966` only, which is already landed. Ask, then:
  `node cli.mjs land item-4977 --merge --into main` — run from `/home/chexxor/Git/Durian-Pi`; expect the doc conflict above.
- Prove it after: `node tools/broker-serve.mjs --status --db ./selfdev.sqlite --show-queue --limit 20 --json 2>/dev/null |
  node tools/parse-broker-status.mjs --check=admit` and confirm `seat-shell-availability` is a NOTE. **That is the gate on
  the operator's `--start` decision (`#4970` HALF A)** — until it lands on `main`, every `send` stays a second store writer.

## 2. Mint the four instrument defects (brief is WRITTEN, deliberately NOT fired)

- `.spike/fix-20261102/lead-instrument-defects.md` — **not sent**, because `devtools` was writing to the same store at that
  minute and a second writer is the recorded crash class. Fire it the moment no run is live, **from a tree that carries
  `durig.config.json`** (§4):
  `cd /home/chexxor/Git/durian-dev/seatroot && DURIG_NO_SERVE=1 DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite DURIG_LOCAL_CONTEXT=160000 timeout 1500 node cli.mjs send lead "$(cat /home/chexxor/Git/Durian-Pi/.spike/fix-20261102/lead-instrument-defects.md)"`
- The four, with `file:line` already in the brief: `cli.mjs config`/`describeConfig` (`src/config.mjs:328-344`) omits every
  `DURIG_LOCAL_*`/`DURIG_VERIFIER_*` key; `scripts/clockin.mjs:306,352` probes a hardcoded `:8080`; the
  `admitted_not_started` notice says "re-arm" while `cli.mjs:1106-1122` cancels; and `#4979` (`doctor` prints
  `bash: command not found` for the suggested `doctor --probe` while `--help` lists `doctor`).
- **Duplicate check is done** — related open rows are `#4977 #4978 #4979 #4985 #4986 #4987 #4970 #4974 #4981 #4983`; the
  bodies are already inside `status`'s `queueItems` (4,989 rows, one read), so re-checking costs 0 s and no second 22 MB dump.

## 3. THEN the `qa` verify leg for the persona split — blocked on a RULING, not on a window

`#4974` is `queued impl->qa`. The previous pointer's plan ("fix the verifier window, then the `qa` leg") is **not
executable as written**: the pre-flight refuses, and the only model that fits the free card is the 0/16-clean-controls
ministral. Escalate the §Measured numbers and ask **which model earns the wake**; D137's rule is that a failing verifier
is worse than none.

## 4. What this session measured so the next one does NOT re-derive it

- **A wake dispatched from a claimed worktree dies as `no_model` in <20 s with zero tokens.** `durig.config.json` is
  gitignored and **no worktree has one** (`item-4977`, `seatroot/item-4955`: absent); precedence is env →
  `./durig.config.json` in the **waker's cwd** (`src/config.mjs:7`). Measured: identical brief from `item-4977` →
  `{"settledStatus":"unanswered","settledReason":"no_model","reply":null}`; from `seatroot` → a real 12+ minute turn.
  `test -f "$PWD/durig.config.json"` before ANY write verb, and pin `DURIG_LOCAL_CONTEXT` when the two private copies
  disagree (**160000** operator checkout vs **200000** seat root — `#4970` HALF B, still the operator's).
- **`resume` settled by cancelling, measured a third time:** `found: 2` → `impl #278592 queued→withdrawn`,
  `devtools #278704 placed→run-cancelled`. It writes no files (12-line worktree + 13-line branch inventories byte-identical
  before/after) and it does **not** re-arm — despite what the attention notice says.
- **A killed run leaves real work uncommitted and recoverable.** The #4977 fix was sitting in the tree as
  `M src/shellregistry.mjs`, `?? tools/shell-availability.mjs`. A continuation brief MUST order "read what is on disk
  first, do not re-derive the design" or the wake rebuilds work that already exists.
- **`output: 8192` + `stopReason: length` is the output budget, not the model.** `pm` `#278816` settled `done` after
  168,830 ms with `output` exactly 8192 and `rawStopReason: length`; `DURIG_LOCAL_MAX_TOKENS` is unset, so
  `src/providers/local.mjs:76` caps every local seat at 8192. Fifth seat on `#4980`'s premise.
- **Re-measure the GPU topology every session (0.2 s, `nvidia-smi --query-gpu=index,name,memory.used,memory.total`)** — it
  has FLIPPED since `verifier-model-server.md`'s 2026-10-29 note, and the flip decides which verifier file can load at all.

## 5. Still open from prior sessions — re-read before acting

`#4970` (A: the operator's `--start` decision, gated on §1; B: the config drift, operator-owned, still present), `#4974`
(§3), `#4981`/`#4983` (idle seats with queued work — a routing question for `lead`, not a wake for you), and `#4966` is
**done and landed — do not re-do it.**

## Standing constraints

- **Do not claim, complete, defer, or route queue rows yourself.** Routing and decomposition belong to `lead`.
- **Do not land anything without the operator naming that landing.** §1 asks; nothing in this session was landed.
- **No push without the operator's grant** — 89 ahead of `origin/main` at `43e26dcc`.
- **Native host only** (Linux here; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103).
- **Never dispatch a write verb from a claimed worktree** (§4), and **never run `doctor`/`resume` while a seat is running**
  (D187, re-measured this session).
