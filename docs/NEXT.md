## NEXT SESSION (2026-11-02T23:5xZ — D193, Linux: **three substrate fixes are on `main` and PUSHED on the operator's grant, but the suite's 245/245 is WAL luck, not a fix**; and the operator has ruled the verifier moves to **DeepInfra, with $4 to spend**)

**Current item:** the order `lead` ruled at 20:14Z, now that **#4995, #5013 and #4996 have all landed** and `origin/main` =
`0cc8c9c1`: **#5019 (the WAL red, §1b) must LAND before #4997's baseline is frozen** — freezing a live defect as a standing
exemption is the failure #4997 exists to prevent — and #4997's seed must **drop the three landed members** while **keeping the WAL
member with its mechanism**. In parallel: **#5020** (generation lease missing on the non-broker path), **#5021/#5022**,
**#5024/#5025/#5026** (minted from the rulings brief), **#5015** (the spend-cap/ledger seam, `queued` to `architect`), and
**#5007/#4993**, still needing `pm`'s release. Second item is now a **ruling, not an option**: verifiers move to **DeepInfra,
$4 to spend, the rig is not to be halted** (§7 — three paid arms done, **$0.0945 spent**, and the gate's clean controls broken).
**Next command:** `node scripts/clockin.mjs` (~5 s), then `DURIG_DB=./selfdev.sqlite node cli.mjs status` plus one `queue --json`
read (§1e) to see whether `impl` has claimed **#5019/#5020** — nothing else in the substrate order is reachable until it does.
**Blocker:** `main` reads **245/245 only because the WAL happens to be empty** (§1b unfixed, #5019 unclaimed); the broker start is
still refused by the two verifier BLOCKs; and further paid probing is gated on #5015's cap plus the scorer fix (§7). Earlier
pointer blocks moved VERBATIM to `docs/NEXT-ARCHIVE.md` — keep that link inside the pointer's first ~15% of lines or
`demo/clockin-digest.test.mjs:251` refuses landings in the scratch (§0a.3).

### 0a. Three facts the delegate established by measurement, not by repeating a colleague — read before reusing tonight's red set

1. **`main` is GREEN at HEAD for the first time in this stretch: 245/245 at `9ca6c755` (42.6 s, `--jobs 8`, live tree).** That
   is the §1b lottery, not a fix: `ls selfdev.sqlite*` at that moment shows **no `-wal` sidecar**, which is exactly the state
   that lets `demo/seat-turn-shape.test.mjs` pass. Green here does **not** mean fixed — #4997's seed must still carry it.
2. **The remaining red is conditional, and the condition is the store's WAL, not the code** (§1b). A run against a private
   store copy with no other writer fails identically, so nobody may call it a regression from the landings.
3. **A pointer edit can refuse a landing.** `scripts/land.mjs` is in the derived set of `demo/clockin-digest.test.mjs`, which
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

    cp selfdev.sqlite{,-wal} .spike/delegate-20261102/store-copy.sqlite{,-wal}   # -wal = 2,912,872 B
    DURIG_DB=.spike/delegate-20261102/store-copy.sqlite node demo/seat-turn-shape.test.mjs   → exit 1; afterwards the copy's
    -wal NO LONGER EXISTS and its db sha changed a40b7304 → 3e3d6931 (no other writer was present)

Mechanism: the reader opens the store **read-write**, so SQLite replays/truncates the WAL on open, which rewrites the db file
the demo is hashing. So the guard is **red whenever the WAL is non-empty** (the normal state after any write) and green only
when the WAL happens to be empty — a lottery member, the same shape as #4995/#4996, passing until now by luck.
**Blast radius, measured:** `node tools/what-to-test.mjs --no-scan --paths=src/readapi.mjs,demo/seat-turn-shape.test.mjs`
→ **derived guards: 9 test(s) — 9 direct + 0 family mention**, so every `src/readapi.mjs` landing inherits the member.
Fix direction handed to the seat, not chosen by the delegate: assert what the read proves without asserting file immutability
(open read-only, or digest the read result, or name the WAL state in the comparison). `lead`'s ruling put the fix in
**product** (`src/readapi.mjs`, a read-only open) as **#5019 → impl**, the demo forced to **construct** a non-empty WAL rather
than hope for one, and **"flaky" banned as a label**; #4997's baseline must carry the member with its mechanism.

### 1c. THE LANDING SERIALISER IS BLIND TO A `send`-HOSTED GENERATION (measured; land.md's "the lock is what makes it safe" does not hold on this path)

`scripts/land.mjs` gates on `<db>.genlock.<i>` slot files, and `cli.mjs` wraps the provider in slots only on the broker path
(`wrapProviderWithSlots`, `cli.mjs:287,354`). While devtools was generating (`cli.mjs log devtools` turns at 18:33:26Z,
18:34:19Z, 18:34:55Z, 18:35:12Z), `ls -1 selfdev.sqlite.genlock*` printed nothing on **all 10 samples over 20 s**, and the
delegate's own landing reported `liveHolders: 0`. A seat driven by the deprecated `cli.mjs send` (that is what runs on this
box — alive for 95 min) is invisible to the mechanism the lander trusts; the landing was safe only because the shared tree was
clean and merges happen in a scratch — luck about file layout, not a guard. Registered as **#5020 → impl**: the fix is the
non-broker path taking the same slot the broker path takes; a `status` read that surfaces "a seat is generating with no slot"
is the second half, never the guard.

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
  `.spike/delegate-20261102/logcompact.mjs <seat> [n]` — compact `log` (raw `cli.mjs log` costs ~50 KB of context per turn in
  thinking blobs, this is ~3 KB); and **new this session**: `.spike/delegate-20261102/auth-ledger-shim.mjs` (key + ceiling +
  per-call ledger), `cleanrescore.mjs` and `cleanmech.mjs` (re-score `gate.mjs` transcripts offline). All four are #5022 material.

## 2. Three landing-gate traps, measured so the next session does not re-derive them

1. **Land `item-4985`-class fixes BEFORE anything gated on them.** The first `--changed-suite` attempt STOPPED with
   `demo/clockin-digest.test.mjs` failing in the **detached** landing scratch: `Error: Command failed: git rev-list --count
   main..(no branch)` — the #4985 defect; landing that branch first cleared it.
2. **`demo/local-model-pointer.test.mjs` was non-hermetic — FIXED, landed (`item-4996`, `9ca6c755`)**: a hermetic core runs in
   every tree and the machine half **SKIPs with a reason** (and `scripts/land.mjs` now reports a SKIP instead of counting it).
3. **No known-red baseline yet — that is #4997** (claimed by `devtools` at 20:11, body sha256 `5e133981e8ca36f0`): seed = the
     *remaining* reds (§1b, mechanism-named), never the three landed; **#5019 must land first** or the baseline launders a live defect.

## 3. The verifier ruling (D190) — do not load a verifier model

Measured, Linux, 08:00Z: `nvidia-smi --query-compute-apps` → strata pid 345372 holds **14,770 MiB on the A4000 AND 20,712 MiB on
the 3090** (`--max-context 204800`, 48 GiB RSS, 41.2 GiB shmem); free VRAM is 1,472 + 1,574 MiB and **LM Studio has no process at
all**. So loading ministral = evicting the author engine, for the model at 0/16 clean controls (D137). D190: keep the verifier
provider dark, and run verify legs the way `#4956`/`#4962` did — **independent by seat/transcript/execution, and say so**.

**Amended 21:2xZ and again at 23:5xZ:** the operator ruled the verifier moves to a **metered remote engine** (§7), so "keep the
provider dark" no longer binds the *provider* choice — the VRAM measurement stands (nothing is evicted locally). The
model-independence rule still binds every report, **but note the instrument caveat before trusting an arm: `gate.mjs`'s clean-side
numbers are void until the scorer is fixed (§7, D193(8))**, so no arm run so far — paid or local — can certify model independence.

## 5. THE HAND-BACK of 2026-11-02T09:30Z — moved VERBATIM to docs/NEXT-ARCHIVE.md (one ruling, three options)

The operator chose none of the three options in words; the work has since walked **option 3** ("leave the broker down and fix
the substrate first"). Two measurements from it remain load-bearing: **parking provider-dead rows does not clear a `--start`**
(`tools/broker-serve.mjs:411-412` refuses on ANY block finding) and **there is no liveness gate in the wake path**
(`src/broker.mjs:1473` classifies such errors only after a generation failed) — the protection is the park, `pm`'s verb (#5007).
## 6. Still open, re-read before acting

`#4970` HALF B (the config-drift lever: `DURIG_LOCAL_CONTEXT` 160000 in this checkout vs 200000 in the seat root —
operator-owned, still present) · **12 `deferred` rows parked on the operator** (`#4354`, `#4814`, `#4817`, plus 9 LANDING
entries) · the host clock: `LocalRTC=yes` on a dual-boot box while every broker gate is `Date.now()` arithmetic (ROADMAP 234;
`timedatectl set-local-rtc 0` is host-wide, so the operator's call) · `#4987`, `#4986`, `#4992`, `#4978`, `#4979` (open
instrument defects) · `#4966`, `#4977`, `#4985`, `#4931`, **#4995, #5013, #4996** are **done and landed — do not re-do them**.

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
- **Spent so far: $0.0945 across 161 metered calls** (per-call ledger `.spike/delegate-20261102/spend.jsonl`), bounded by a
  gitignored `.spike/…/auth-ledger-shim.mjs` that attaches the key and **refuses a call whose projected cost crosses
  `DURIG_PROBE_CEILING_USD`** — the cap is still prose in the product (#5015) and `gate.mjs:96` still posts
  `/chat/completions` with **no `authorization` header** (#5024). Three k=3 whole-module arms (transcripts `.spike/gate/run-*.json`):

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
  turns in 24 runs, 2026-10-27→11-02.** `scoreClean` (`gate.mjs:185-224`) needs `declined && !assertedNow && named<2`, but
  `ASSERT` holds bare `bug`/`defect` — inside `DECLINE`'s own phrases ("no defect") and any prose decline — with **no negation
  handling**: 57 of 468 FALSE-ALARMs explicitly declined, 15 with nothing left after declination, **154 hit `namedMechanism>=2`
  measured over `answer+reasoning`** (`:154`). So **every "false alarm" figure this rig has cited — including one I published in
  D193(6) today and have corrected — is artifact-saturated**; the defect half (HIT/MISS, G2) still carries signal. Fix the scorer
  and re-score the 24 transcripts **before** any model is chosen on clean-side evidence (detail in DECISIONS D193(8)).
- **Outbound network left the box for ~25 min and came back** (`curl https://github.com` → `000`, `getent hosts
  api.deepinfra.com` → empty, `dig @1.1.1.1` timing out through `nameserver 127.0.0.53`); local Strata kept answering in **6 ms**.
  Zero spend during it; **no runbook exists for general outbound loss**.
- **Still true:** do not wake the five `verifier/…` seats (`broker-serve --dry-run` → `BLOCK
  provider-DURIG_VERIFIER_-unreachable: http://127.0.0.1:1234/v1 ECONNREFUSED` + `BLOCK
  provider-verifier-completion-failed`), and do **not** edit the provider block of `durig.config.json` on a delegate's own
  initiative — `runbooks/verifier-model-server.md` requires an explicit ask. Briefs to `lead`:
  `delegate-20261102-operator-rulings-metered-verifier` (22:3xZ, minted #5024/#5025/#5026) and
  `delegate-20261102-metered-arms-and-scorer` (the arms + the scorer defect). The rows are `lead`'s to mint.
## Standing constraints

- **Do not claim, complete, defer, or route queue rows yourself.** Routing and decomposition belong to `lead`/`pm`.
- **No push without the operator's grant** — `main` is **6** ahead of `origin/main` (`e2f85719`).
- **Native host only** (Linux here; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103).
- **`test -f "$PWD/durig.config.json"` before any write verb** (absent in every worktree; precedence env → `./durig.config.json`
  in the waker's cwd, `src/config.mjs:7`), and **never run `doctor`/`resume` while a seat is running** (D187).
- **`inputs/fetched/` must stay clean or the lander refuses**: `scripts/land.mjs` counts **untracked** paths as dirty. One
  uncited, unmanifested fetch (`strata-batching.md`, sha256 `d1f7d558…`) was moved to `.spike/inputs/` this session to let
  the landings run — re-file it properly (manifest row + URL) or delete it, do not leave it in `inputs/fetched/`.
