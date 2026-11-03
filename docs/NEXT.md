## NEXT SESSION (2026-11-03T00:0xZ — D195, Linux: **the operator ACCEPTED the recommendation set; the rig cannot take turns until `compact lead` runs**)

**Current item:** **D195 — the operator accepted the delegate's recommendations and said act next session.** In order:
**(1)** `compact lead` (**not** `reset`: ≥1,895 user turns of durable transcript; no live lease, no genlock slot, no `send`/`serve`
process, so the direct path is allowed) — **`compact`/`reset`/`doctor`/`resume` are CLI/broker verbs, no seat has them**
(`src/rig.mjs:632,768,932`), so do not spend a send asking `pm`; **(2)** `doctor`/`resume` to re-arm `devtools`'
`admitted_not_started` submission **#279623** (7,804 s — that is why #4997 looks stalled); **(3)** pre-flight, then send the operator
order (§7) to **`pm`** — the only healthy router besides `qa`; **(4)** **push the 4 docs-only commits (grant given)**, no history
rewrite — `39d09f4f` carries the claim `e56b502c` retracts; **(5)** land the **`gate.mjs` scorer fix**, then **#5015's cap + ledger**
(with #5024/#5025/#5026); **(6)** re-arm `openai/gpt-oss-120b` at `CAL_MAX_TOKENS=8000` (~$0.10, ceiling $0.25); **(7)** `pm` runs
`stale-held-backlog` and brings **only #4354, #4814, #4817** with one-line recommendations. Also standing: **#5019 must land before
#4997's baseline is frozen**, and #4997's seed drops the landed members (#4995/#5013/#4996) while keeping the WAL member by mechanism.
**Queue ids:** #5019, #5020 (impl) · #4997 (devtools, after #5019) · #5015 (architect) · #5021/#5022/#5024/#5026 (devtools) · #5025
(architect) · held #4896 (now 10/12 seats, not 6/12), #3128/#4922 (secret false positive), #5007/#4993/#5001 (pm).

**Next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs compact lead "D195 operator order: fix gate.mjs scoreClean (CLEAN-PASSED
emitted 0 times in 552 clean turns), land #5015 cap+ledger, then re-arm openai/gpt-oss-120b at CAL_MAX_TOKENS=8000 (~$0.10 of $3.91
left)"` — then `node tools/seat-turn-shape.mjs --seat lead` to confirm it came back ADMISSIBLE, `DURIG_DB=./selfdev.sqlite node
cli.mjs doctor` / `resume` for #279623, `git push origin main`, and **before any send: `node tools/seat-turn-shape.mjs --seat <who>`**.

**Blocker:** the rig cannot take turns until step (1) runs. `node tools/seat-turn-shape.mjs` → **10 of 12 seats `next send: AT RISK`**
(only `pm`, `qa` admissible); `lead` is `repeated_failure` — **3 consecutive failed runs, supervisor escalates to the human** — cause
`model_error: terminated`; `auditor`'s cause is the engine's template raise (*"CallExpression at line 48"*), the alternation held
**#4896** predicts. Two sends were refused (#280227, #280240) and each **appended another user entry** — the poison grows. My
context-saturation hypothesis was **disproved**: the endpoint answered a 120,056-token prompt, HTTP 200 in 54.1 s (D174's trap).
Also: `main` reads **245/245 only because the WAL is empty** (§1b, #5019 unclaimed); the broker start is refused by the two verifier
BLOCKs, and **`DURIG_VERIFIER_*` is deliberately NOT re-pointed yet** (§8). Earlier pointer blocks moved VERBATIM to
`docs/NEXT-ARCHIVE.md` — keep that link inside the pointer's first ~15% of lines or `demo/clockin-digest.test.mjs:251` refuses
landings in the scratch (§0a.3).
`demo/clockin-digest.test.mjs:251` refuses landings in the scratch (§0a.3).

### 0a. Three facts the delegate established by measurement, not by repeating a colleague — read before reusing tonight's red set

1. **`main` is GREEN at HEAD — 245/245 at `9ca6c755` (42.6 s, `--jobs 8`) — and that is the §1b lottery, not a fix:** at that
   moment `ls selfdev.sqlite*` shows **no `-wal` sidecar**, exactly the state that lets `demo/seat-turn-shape.test.mjs` pass; a
   run against a private store copy with no other writer fails identically, so it is no one's regression. Green ≠ fixed.
2. **A pointer edit can refuse a landing.** `scripts/land.mjs` is in the derived set of `demo/clockin-digest.test.mjs`, which
   asserts the **live** pointer's first ~15% of lines mention `docs/NEXT-ARCHIVE.md` (`:251`) — keep that link in the top block.

## 1. What moved THIS session (all verified; **pushed to `origin/main` on the operator's grant at 21:2xZ**)

- **`main` moved `8ced6cfb → ae151408 → 2a6422fa` (this pointer's own docs commit) `→ 9ca6c755`**, landing `item-4995`
  (`e04ef32c`/merge `bbd6ef34`), `item-5013` (`13dfdf6e`/`ae151408`) and `item-4996` (`40583ac6`/`9ca6c755`, gate `ran 9/245 —
  areas RAN [check, guard, toolchain, tui, worktree]`). Ancestry exit 0 for all three, two parents each; content proofs: the
  frozen fixture `broker-serve-shell-pre-4977.txt` (64 lines), moving-ref control grep 0, `isLocalProviderId` 4×, `SKIP` 3×.
- **Gate runs:** `node scripts/land.mjs refs/heads/<branch> --db ./selfdev.sqlite --changed-suite` → exit 0, `ran 6/245` for the
  first two and `9/245` for `item-4996`. Use `refs/heads/<name>`: `item-<n>` is ambiguous (branch *and* directory).
- **`origin/main` = `0cc8c9c1`, `0` ahead** (pushed on the operator's grant). Re-measure: `git rev-list --count origin/main..main`.
- **Three landed items' worktrees are still registered and were NOT hand-cleaned**: `complete_work`'s cleanup refused for
  `item-4995`/`item-5013` with `refusing to remove worktree …: junction/symlink detected at undefined/anthropic-ai-sdk` — that
  is **`#5001` firing live** — and `item-4996`'s outlived its landing. All three are disposition material for `pm`'s #5004 pass.

### 1b. THE NEW RED — `demo/seat-turn-shape.test.mjs:292` is red for any store with a non-empty WAL (A/B, mechanism named)

Failure: `AssertionError: the read must not modify …/selfdev.sqlite` — the demo hashes the live store before and after
`readSeatShapes`, and its own connection changed the bytes.

    cp selfdev.sqlite{,-wal} .spike/…/store-copy.sqlite{,-wal} (wal 2,912,872 B) → DURIG_DB=copy node demo/seat-turn-shape.test.mjs
    exits 1; afterwards the copy's -wal is GONE and its db sha changed a40b7304 → 3e3d6931, with no other writer present

Mechanism: the reader opens the store **read-write**, so SQLite replays/truncates the WAL on open, which rewrites the db file
the demo is hashing. So the guard is **red whenever the WAL is non-empty** (the normal state after any write) and green only
when the WAL happens to be empty — a lottery member, the same shape as #4995/#4996, passing until now by luck.
**Blast radius, measured:** `node tools/what-to-test.mjs --no-scan --paths=src/readapi.mjs,demo/seat-turn-shape.test.mjs`
→ **derived guards: 9 test(s) — 9 direct + 0 family mention**, so every `src/readapi.mjs` landing inherits the member.
Fix direction handed to the seat, not chosen by the delegate: assert what the read proves without asserting file immutability
(open read-only, digest the read result, or name the WAL state). `lead`'s ruling put the fix in **product** (`src/readapi.mjs`,
a read-only open) as **#5019 → impl**, the demo forced to **construct** a non-empty WAL; **"flaky" is banned as a label**.

### 1c. THE LANDING SERIALISER IS BLIND TO A `send`-HOSTED GENERATION (measured; land.md's "the lock is what makes it safe" does not hold on this path)

`scripts/land.mjs` gates on `<db>.genlock.<i>` slot files, and `cli.mjs` wraps the provider in slots only on the broker path
(`wrapProviderWithSlots`, `cli.mjs:287,354`). While devtools was generating (turns at 18:33:26Z…18:35:12Z), `ls -1
selfdev.sqlite.genlock*` printed nothing on **all 10 samples over 20 s** and the delegate's own landing reported
`liveHolders: 0`: a `send`-driven seat is invisible to the mechanism the lander trusts, and that landing was safe only because
the tree was clean and merges happen in a scratch — luck about file layout, not a guard. Registered as **#5020 → impl**: the
non-broker path takes the same slot the broker path takes; a `status` read surfacing it is the second half, never the guard.

### 1d. Re-measured at 19:0xZ, cheap, before anything else

- `node scripts/clockin.mjs` (~5 s) — its `PROVIDER … local=NOT SET` and `local endpoint: DOWN (fetch failed)` lines are
  **wrong on this box** (`#4999`, a hardcoded `:8080` probe): `durig.config.json` names
  `DURIG_LOCAL_BASE_URL=http://127.0.0.1:47831/v1`, which answers `/v1/models` in **5 ms**; `broker-serve --status` likewise
  printed `provider-local-completion-failed: timeout after 20s` for that serving endpoint (**#5021**).
- Strata is UP and owns both GPUs (0.2 s): `nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv` then
  `--query-compute-apps=pid,gpu_name,used_memory --format=csv`. It decides whether any second model can load.
- `node tools/queue-drain-audit.mjs` (1.0 s) and `node tools/broker-serve.mjs --status` (2.8 s) rather than any remembered count;
  the `stranded-intent` NOTE in `--status` is two `op:read view:health` requests from **2026-10-30** — stale reads.
- A `send`-hosted seat is not a broker: no `selfdev.sqlite.broker.json`, and the `send` process holds no slot (§1c). **Never run
  `doctor`/`resume` while one is generating** (D187).

### 1e. Probes the next session would otherwise lose (ROADMAP 233; the promotion row is **#5022** → devtools)

- `.spike/delegate-20261102/rows.mjs <dump> [nonterminal|all|grep <re>]` — a row-scoped queue read over a `queue --json` dump
  (`queue --help` prints the whole queue — 22,111,408 B for 5,018 rows — that is **#4986**, open, do not re-mint);
  `.spike/delegate-20261102/logcompact.mjs <seat> [n]` — compact `log` (raw `cli.mjs log` costs ~50 KB per turn in thinking
  blobs, this is ~3 KB; it now tolerates a non-array `model.content`); plus **new this session**: `auth-ledger-shim.mjs` (key +
  ceiling + per-call ledger), `cleanrescore.mjs`, `cleanmech.mjs` (re-score `gate.mjs` transcripts offline). All #5022 material.

## 2. Three landing-gate traps, measured so the next session does not re-derive them

1. **Land `item-4985`-class fixes BEFORE anything gated on them.** The first `--changed-suite` attempt STOPPED with
   `demo/clockin-digest.test.mjs` failing in the **detached** landing scratch: `Error: Command failed: git rev-list --count
   main..(no branch)` — the #4985 defect; landing that branch first cleared it.
2. **`demo/local-model-pointer.test.mjs` was non-hermetic — FIXED, landed (`item-4996`, `9ca6c755`)**: a hermetic core runs in
   every tree and the machine half **SKIPs with a reason** (and `scripts/land.mjs` now reports a SKIP instead of counting it).
3. **No known-red baseline yet — that is #4997** (claimed by `devtools` at 20:11, body sha256 `5e133981e8ca36f0`): seed = the
     *remaining* reds (§1b, mechanism-named), never the three landed; **#5019 must land first** or the baseline launders a live defect.

## 3. The verifier ruling (D190) — do not load a verifier model

**Still binding:** every verification claim states its axis of independence - **seat, transcript, execution** - and says so, the
way `#4956`/`#4962` did. **Now void as evidence:** `gate.mjs`'s clean-side numbers until the scorer is fixed (D193(8)) - no arm
run so far, paid or local, can certify model independence. The D190 VRAM measurement and both amendments are VERBATIM in the archive.

## 5. The 09:30Z hand-back - VERBATIM in docs/NEXT-ARCHIVE.md. Two measurements from it stay load-bearing: **parking
provider-dead rows does not clear a `--start`** (`tools/broker-serve.mjs:411-412` refuses on ANY block finding) and **there is no
liveness gate in the wake path** (`src/broker.mjs:1473` classifies such errors only after a generation failed).
## 6. Still open, re-read before acting

**#4970** HALF B (`DURIG_LOCAL_CONTEXT` 160000 here vs 200000 in the seat root) - **12 `deferred` rows** (#4354, #4814, #4817 plus
9 LANDING) - `LocalRTC=yes` while every broker gate is `Date.now()` (ROADMAP 234) - #4987, #4986, #4992, #4978, #4979, #5001 open.

## 7. The DeepInfra verifier — OPERATOR RULING 2026-11-02T21:2xZ: *"use DeepInfra for verifiers rather than halt the system; we have $4 available to spend"* (the paid arm is now authorised; the cap is still prose)

Push was granted in the same breath and executed: `git push origin main` → `e2f85719..0cc8c9c1` (verified by `git ls-remote`),
preceded by `node scripts/test.mjs --all --jobs 8` → **245/245 in 49.0 s** — with its condition: **no `-wal` sidecar** was
present, so that green is the §1b lottery, not a fix. `origin/main` = `0cc8c9c1`, `0` ahead.

- **The operator's key is invisible to the verifier provider today.** A provider registers by setting
  `DURIG_VERIFIER_BASE_URL` (id from the prefix, `src/providers/local.mjs:49-52`) and its key variable is
  **`DURIG_VERIFIER_API_KEY`** (`:88`, `:145-147`) — **not** `DEEPINFRA_API_KEY`, which is what `cli.mjs config` calls `set`.
  Keep the key env-only; `durig.config.json` holds none (#4991 landed the gitignore).
- **The classification seam #5015 is about:** `isLocalProviderId` (`local.mjs:45`) is true for `verifier`, whose module header
  says the id means *"free context, cheap reset, no paid API"*. Point it at `https://api.deepinfra.com/v1/openai` and every
  free-provider assumption — `broker-serve`'s probes included — survives: **metered, classified as free**.
- **Two config values are already wrong for any candidate:** `DURIG_VERIFIER_MAX_TOKENS=3000` against reasoning-tagged models
  (`local.mjs:71-75` records the failure — "a confident half-verdict — the worst possible failure for a seat whose job is to say
  'no'"; reproduced live: at `max_tokens=24`, `gpt-oss-20b` returned `finish_reason=length` with **empty content**), and
  `DURIG_VERIFIER_CONTEXT=24576` vs a measured **p50 prompt of 55,538 input tokens** (D166's impossible pair).
- **Resolution faults before any request for a non-curated model:** `cli.mjs:327` builds from `fallbackModels()` and
  `fetchDeepInfraModels` is imported **nowhere** (live catalog = **173** models; `gpt-oss-20b/-120b` uncurated). Fields for the
  guard: `metadata.context_length`, `metadata.pricing.{input_tokens,output_tokens,cache_read_tokens}`, `metadata.tags`.
- **Priced on this rig's own shape (55,538 in / 3,000 out), with the $4 question answered — turns the pool buys:**

| candidate | ctx | $/turn | **$4 buys** |
|---|---|---|---|
| `openai/gpt-oss-20b` | 131,072 | **$0.00209** | **1,917 turns** |
| `openai/gpt-oss-120b` | 131,072 | $0.00256 | 1,559 |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 1,048,576 | $0.00387 (≈$0.00187 at 80% prefix-cache) | 1,032 → **2,135 cached** |
| **`zai-org/GLM-5.3-Flash` — the SHIPPED DEFAULT** | 1,048,576 | $0.00983 | **406** |

  (`mistralai/Mistral-Small-3.2-24B-Instruct-2506`: $0.00477 / 839 turns.) The pool is **4.7× bigger** on the cheapest candidate
  than on the default, and the **55k prompt is the cost driver** — bounding the verify prompt is a bigger lever than model
  choice. `mistralai/ministral-3-14b-reasoning` (what the 5 verifier seats name) is **absent from the live catalog entirely**.
- **Spent so far: $0.0945 across 219 metered calls** (per-call ledger `.spike/delegate-20261102/spend.jsonl`), bounded by a
  gitignored `.spike/…/auth-ledger-shim.mjs` that attaches the key and **refuses a call whose projected cost crosses
  `DURIG_PROBE_CEILING_USD`** — the cap is still prose in the product (#5015); `gate.mjs:96` posts with **no `authorization`
  header** (#5024). Three k=3 whole-module arms (transcripts `.spike/gate/run-*.json`):

| arm | defect items (majority-of-3) | G2 floor (bar 4/8) | truncated | cost |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | **6/8** | **MET** (worst replicate 4/8) | 0/24 | ~$0.038 |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 3/8 — spread **5/8, 2/8, 2/8** | NOT MET (worst 2/8) | 0/24 | $0.0169 |
| `openai/gpt-oss-20b` | 1/2 scored — **arm unscorable** | NOT MET | **16/24** | $0.0394 |

  Truncation cause is one env var: `gate.mjs:83` defaults output to `CAL_MAX_TOKENS || 3000` — the same wrong 3,000 as
  `DURIG_VERIFIER_MAX_TOKENS`, under a comment (`:90-92`) that already records D134. For #5015's ledger: **every DeepInfra
  response returns `usage.estimated_cost`**.
- **The finding that outranks the table: the gate's clean controls have never emitted a positive verdict.** Re-scoring the
  instrument's own transcripts (probes `.spike/…/cleanrescore.mjs`, `cleanmech.mjs`): **`CLEAN-PASSED` 0 times across 552 clean
  turns in 24 runs.** `scoreClean` (`gate.mjs:185-224`) needs `declined && !assertedNow && named<2`, but `ASSERT` holds bare
  `bug`/`defect` — inside `DECLINE`'s own phrases ("no defect") and any prose decline — with **no negation handling**: 57 of 468
  FALSE-ALARMs explicitly declined; **154 turns hit `namedMechanism>=2` over `answer+reasoning`**. So **every "false alarm"
  figure this rig has cited — including one I published in D193(6) and have corrected — is artifact-saturated** (full numbers in
  DECISIONS D193(8)). Fix the scorer and re-score the 24 transcripts **before** any model is chosen on clean-side evidence.
- **Outbound network left the box for ~25 min and came back** (`curl https://github.com` → `000`, `getent hosts
  api.deepinfra.com` → empty, `dig @1.1.1.1` timing out through `nameserver 127.0.0.53`); local Strata kept answering in **6 ms**.
  Zero spend during it; **no runbook exists for general outbound loss**.
- **Still true:** do not wake the five `verifier/…` seats (`broker-serve --dry-run` → `BLOCK
  provider-DURIG_VERIFIER_-unreachable: http://127.0.0.1:1234/v1 ECONNREFUSED` + `BLOCK
  provider-verifier-completion-failed`), and do **not** edit the provider block of `durig.config.json` on a delegate's own
  initiative — `runbooks/verifier-model-server.md` requires an explicit ask. Briefs to `lead`:
  `delegate-20261102-operator-rulings-metered-verifier` (22:3xZ — landed, minted #5024/#5025/#5026), then
  `delegate-20261102-metered-arms-and-scorer` and `delegate-20261103-operator-order-scorer-cap-rearm` — both **REFUSED**
  (`unanswered / model_error`, no reply) and each appended a user entry (D194). The rows are `lead`'s to mint.

## Standing constraints

- **Do not claim, complete, defer, or route queue rows yourself.** Routing and decomposition belong to `lead`/`pm`.
- **No push without the operator's grant.** GRANTED for the **4 docs-only commits** (D195) — nothing else.
- **Native host only** (Linux here; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103).
- **`test -f "$PWD/durig.config.json"` before any write verb** (absent in every worktree; precedence env → `./durig.config.json`
  in the waker's cwd, `src/config.mjs:7`), and **never run `doctor`/`resume` while a seat is running** (D187).
- **`inputs/fetched/` must stay clean or the lander refuses**: `scripts/land.mjs` counts **untracked** paths as dirty. One
  uncited, unmanifested fetch (`strata-batching.md`, sha256 `d1f7d558…`) was moved to `.spike/inputs/` this session to let
  the landings run — re-file it properly (manifest row + URL) or delete it, do not leave it in `inputs/fetched/`.
