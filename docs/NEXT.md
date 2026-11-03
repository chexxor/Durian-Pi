## NEXT SESSION (2026-11-03T09:3xZ — D196, Linux: the verb the last pointer named was disproven before it was spent; the operator's order is now queued as rows, and what blocks them is the operator's lever)

**Current item:** the operator's order (fix the `gate.mjs` scorer → land #5015's cap+ledger with #5024/#5025/#5026 → re-arm
`openai/gpt-oss-120b` at `CAL_MAX_TOKENS=8000`) **is no longer un-minted** — one batched brief to `pm` produced
**#5027** (the scorer defect, → `devtools`, held: `CLEAN-PASSED` 0/552 clean turns over 24 runs), **#5028** (disposition for
#4973 + #4964 → `impl`), **#5029** (disposition for #4981 → `architect`), **#5030** (the three landed-but-registered worktrees → `impl`).
What blocks those rows is **not** decomposition: it is the compaction summarization budget (§2), whose lever is the operator's
(**#4970 HALF B**). History for everything below is VERBATIM in `docs/NEXT-ARCHIVE.md`.
**Queue ids:** new **#5027–#5030** · **#5019** (must land before #4997's baseline), **#5020**, **#4997** (devtools, after #5019) ·
**#5015/#5025** (architect), **#5021/#5022/#5024/#5026** (devtools) · held **#4896, #3128/#4922** (secret-shape false positive, now 3
firings), **#5007/#4993/#5001** · census 2026-11-03: `done 3791 · cancelled 795 · held 335 · queued 90 · deferred 14 · claimed 5`.

**Next command:** the ruling first, then the send — in this order:
1. **Operator ruling (two numbers, §2/#4970):** `DURIG_LOCAL_CONTEXT` **160000 → 200000** in this checkout (the engine already
   serves `--max-context 204800`; the seat root already says 200000), and/or `DURIG_LOCAL_MAX_TOKENS` **unset(=8192) → 16384** so the
   summary budget becomes `min(13107, 16384)`. A per-verb interim exists without editing the file:
   `DURIG_LOCAL_CONTEXT=200000 DURIG_DB=./selfdev.sqlite node cli.mjs send <seat> --body-file <file>` — **name the override** in any
   report that uses it.
2. Re-read the cause before any recovery verb (2 s, `docs/runbooks/session-start-cost.md` §2c): if it still says
   `Compaction failed: Summarization hit the token limit`, nothing has changed.
3. `node tools/seat-turn-shape.mjs --seat <who>` **before every send** (0.4 s), and pair it with provider state (§3 — shape does not
   read the provider).
4. Only after (1): `DURIG_DB=./selfdev.sqlite node cli.mjs resume` (`doctor` is an **alias** of `resume`, `cli.mjs:3102`) to re-arm
   `devtools`' `admitted_not_started` **#279623** — it is a **write**, and at 143,426/160,000 it re-enters the band unless (1) landed.
5. Push: the four D195 docs commits went **on the operator's grant** (`origin/main` `0cc8c9c1 → 9f79f45c`, verified by `git ls-remote`,
   0 ahead). **This session's docs commit is NOT covered by that grant** — ask before pushing it.

**Blocker:** for `lead` (145,429 consumed — over the band **at rest**) and `devtools` (143,426) a send fires a threshold compaction
whose **output** budget is 8,192 tokens; the summarizer hits it, `compaction` fails, and `failModelError` settles the send
`unanswered / model_error` with **zero tokens** while appending another `pi.user` entry (§2, and the store already says so: submission
**#280241**). Separately: **nothing listens on `127.0.0.1:1234`**, so the five `verifier/…` seats cannot take a turn at all (§3), and
7 seats' counted projections still end on `user` (do-not-send). No broker, no `genlock` slot, no `cli/intent` process at clock-out.

### 0. Read before reusing this pointer: the two claims last session's plan rested on, both measured false

1. **`compact lead` does not unblock the rig.** It had already run: `lead`'s newest submission (**#280241**, requestId
   `delegate-20261103-operator-order-scorer-cap-rearm`) sits `unanswered / model_error` with `detail`
   *“Compaction failed: Summarization hit the token limit; the summary is incomplete”*. And even a **successful** compaction leaves a
   seat un-sendable: `selectCut` keeps the most recent `keepRecentTokens` = 20,000 tokens (`harness/compaction.js:211-234`), so the
   trailing `user` entries survive the cut — **`impl` is the proof**: head marker `pi.compaction@278205`, projection still
   `user,assistant,user,assistant,user`. A compaction moves the **head marker**; sendability is the **last element** of the counted
   projection (`session-start-cost.md` §2b). Same-store natural experiment: `devtools` got `pi.compaction@279624` at 05:19Z and is
   still not sendable-by-shape.
2. **`doctor` is not a read.** `cli.mjs:3102` routes `"resume"` and `"doctor"` to the same `cmdResume()` — “run doctor, then resume”
   is **one write verb**, not a diagnosis then a repair. That is why re-arming #279623 was **not** run this session (§2).
3. **The rule that follows: a pointer is a priority list, not a diagnosis.** Before executing a recovery verb copied out of
   `NEXT.md`, re-read that seat's `submissions.detail` (the §2c one-liner, ~2 s, `node:sqlite` read-only). The identical `detail` was
   recorded on four seats on 2026-11-01 (`session-start-cost.md` §2c, **D187**) and the pointer did not carry it — so a session nearly
   spent a verb the store had already reported as failing.

### 1. What moved THIS session (all verified; nothing else changed on disk)

- **Pushed on the operator's grant:** `origin/main` `0cc8c9c1 → 9f79f45c` (`git ls-remote` agrees; `git rev-list --count
  origin/main..main` = 0). The four commits were checked docs-only first (`git log --stat origin/main..main` — docs only).
- **Approved seat root fast-forwarded** `43e26dcc → 9f79f45c` (`git -C /home/chexxor/Git/durian-dev/seatroot merge --ff-only main`,
  exit 0): it was clean, 0 ahead / 31 behind, and **no `package.json`/`package-lock.json`/`pi-main.pin.json` in that range**, so no
  `npm ci`/`sync-pi` was owed. Inventories (`git worktree list --porcelain`, `git branch --list`) are **byte-identical before/after**
  — `.spike/delegate-20261103/inv-{before,after}-{worktrees,branches}.txt`, `diff` exit 0 on both.
- **One batched brief to `pm`** (the only seat both admissible and with a live provider, §3): `send pm --body-file
  .spike/delegate-20261103/brief-pm.md --request-id delegate-20261103-blocker-brief --no-stream` from this checkout. Result
  `settledStatus done, stopReason stop` in ≈12 min (`send-pm.out`, 12,417 B). It minted **#5027–#5030, all `held`**, zero wakes, zero
  releases — verified in `queue --json` (bodies 3,819 / 2,587 / 1,409 / 2,120 B). `pm`'s projection grew 4 → 6 and still ends on
  `assistant` (**still ADMISSIBLE**); no other seat's shape changed, so no poison was deposited.
- **`pm` context: 66,992 → 84,083 of 160,000 (0.526)** from one 6,893-char brief — **+17,091 tokens for one turn.** Price briefs, not
  just wakes: twelve more like it and `pm` is at the band.
- **NOT run, deliberately:** no `compact`, `reset`, `resume`/`doctor`, no claim/complete/defer/route, no provider-block or config edit
  (AGENTS.md boundary; the escalation carries the commands instead). **No suite run either** — a full `--all` pass while a seat turn was
  writing could race the store, and per §1b of the archived D195 pointer a 245/245 reading is a WAL lottery, not evidence. So
  **`main` is unverified-green this session**; the last suite marker is the archived one.

### 2. THE BLOCKER — a summarization OUTPUT cap, named at the lines (it is neither the Jinja alternation nor a window)

`thresholdCompaction` (`vendor/pi-main/packages/durable/dist/harness/generation.js`) fires when
`estimateContext(view, planned) > contextWindow − policy.reserveTokens`. durian-pi sets **no** compaction policy, so the pinned
defaults apply: `reserveTokens 16384, keepRecentTokens 20000, backgroundTokens 32768` (`harness/agent.js:10-15`). With
`DURIG_LOCAL_CONTEXT=160000` the band is **143,616**. Measured `status.context.consumed`: `lead` **145,429** (over at rest),
`devtools` **143,426** (190 under at rest), `impl` **143,278** (338 under) — and the check counts the **appended send**, so a brief
pushes all three over. The summary request's output budget is `min(0.8·16384, model.maxTokens)` = `min(13,107, 8,192)` because
`DURIG_LOCAL_MAX_TOKENS` is unset and defaults to **8,192** (`harness/compaction.js:95`; `src/providers/local.mjs:76,85`). At that cap
the summarizer returns `stopReason=length` → `summaryFailure` prints exactly *“Summarization hit the token limit; the summary is
incomplete”* (`compaction.js:302-303`) → `failModelError` settles the **whole send** `unanswered/model_error`, zero tokens.
**Consequence for #4970:** the declared window is not cosmetic drift — it **is** the trigger. 200,000 moves the band to **183,616** and
all three seats fall under it, with the engine already serving 204,800 (`ps` command line + `tools/model-probes/probe-preflight.mjs`:
window 204800, strata 51.2 GiB RSS, `gpus:[0,1]`). **Still not hand-aligned**: D195's ruling stands (aligning by hand is drift with
better numbers; the fix is one source of truth). Rows in this class, none built: **#4973** (held, gated on #4970 — `pm` judges the
input-bound half capacity-independent, carried in **#5028**), **#4887** (queued — no policy knob exists to set), **#4964** (held),
**#4981** (queued; `pm` routes it as legibility, **#5029**, not gated on capacity).

### 3. Sendability and provider state, measured 09:0xZ — **admissible ≠ workable**, and that is the whole table

| seat | provider | provider up? | counted projection ends on | `next send` | context |
|---|---|---|---|---|---|
| `pm` | local/iq3_s | **yes** | `assistant` | **ADMISSIBLE** | 84,083 / 160,000 |
| `qa` | verifier/… | **no** — nothing on :1234 | `assistant` | ADMISSIBLE **but cannot run** | 20,110 / 24,576 |
| `devtools` | local | yes | `assistant` | AT RISK (1 parity break) | 143,426 (band) |
| `security` | local | yes | `assistant` | AT RISK (4 breaks) | 89,530 |
| `auditor` | verifier/… | no | `assistant` | AT RISK (5 breaks) | 0 (stale) |
| `impl, lead, advocate, scribe, designer, qa2, architect` | mixed | 7 local yes / verifier no | **`user` — DO NOT SEND** | AT RISK | lead 145,429 · impl 143,278 |

- Provider truth: `ss -ltn` listens on **47831 (strata)** and **18500** only; `/v1/models` answers and `broker-serve --status` completes
  a real completion on `local`. `probe-preflight.mjs` prints **GO** but GPU0 14,906/16,376 MiB and GPU1 22,848/24,576 MiB — **no local
  verifier model loads without evicting the seat engine**, which is why the operator's DeepInfra ruling is the only non-destructive
  route. The re-point stays **one change** with **#5024 + #5015 + #5025**; `DURIG_VERIFIER_*` was NOT touched.
- **The verifier band is 8,192 by construction** (`DURIG_VERIFIER_CONTEXT=24576` − `reserveTokens 16384`; the pinned reserve is
  two thirds of the declared window) and its summary output budget is `min(13,107, DURIG_VERIFIER_MAX_TOKENS=3000)` = **3,000**. So
  even with the provider up, `qa` (20,110 consumed) could not take a second turn without a compaction that cannot succeed at 3,000
  tokens. **The re-point must set context AND max-tokens as one pair**, or the §2 failure walks over to DeepInfra. Per-seat band
  table for all of it: `docs/runbooks/session-start-cost.md` §14 (one `status --json` read, prints each seat's own band).
- `pm`'s correction, accepted and load-bearing: `tools/seat-turn-shape.mjs` reads **no provider state**, so it called `qa` admissible
  while its provider is dead — **`pm` is the only seat that is both tonight**. `status.context.consumed` is measured **pre-send**, so
  "at or over the band" is only true once the brief is appended (`impl` is 338 tokens under at rest).

### 4. The three one-liners the operator asked for (`pm`, verbatim in substance — answer each in one line, and `pm` can act)

Verified from the queue dump (**not** pm's guess): #4354 `deferred · to=impl · claimedBy=null · sender=pm`; #4814 `to=qa2`;
#4817 `to=devtools` — each carries a `question` beginning `supervisor escalation:`. So the **release** verb belongs to
`impl`/`qa2`/`devtools` (all un-sendable, §3), but `pm` as **sender** holds `cancel_work` on all three — which is why a one-line
answer is actionable tonight without waking anyone.
- **#4354** (`impl`, re-cut): *content-probe then cancel* — it belongs to the 70-of-89-already-on-main class; do not release it to `impl`.
- **#4814** (`qa2`): *stays parked as CAPACITY* until `DURIG_VERIFIER_*` is re-pointed to DeepInfra and `gpt-oss-120b` is armed at
  `CAL_MAX_TOKENS=8000`; if it must move sooner, move it to a local-family seat and label the verify seat/transcript/execution.
- **#4817** (`devtools`, already answered): the only verb owed is a **close** — `pm` as sender can close it by content probe, or it becomes
  the first non-compaction release after the `DURIG_LOCAL_CONTEXT` ruling; do not wake `devtools` to do it.

### 5. Cheap reads, traps, and the probes this session leaves behind (gitignored — **#5022** is the promotion row)

- `.spike/delegate-20261103/`: `brief-pm.md`, `send-pm.out` (the whole reply), `seat-turn-shape-{1,2}.txt`, `status-{1,2}.json`,
  `q-1.json` (22.2 MB `queue --json`), `latency-budget-1.txt`, `NEXT-pre-cut.md`, the four inventory files. Re-runnable, unpromoted.
- **Queue census, no 22 MB read:** `python3 -c` over a `queue --json` dump with `json.JSONDecoder().raw_decode` (the CLI appends a
  `note:` line, so `json.load` dies). `.spike/delegate-20261102/rows.mjs` still works. `node tools/queue-drain-audit.mjs --db
  ./selfdev.sqlite` (1.5 s) → **89 non-terminal LANDING rows, 70 already fully on main**, 23 rows with an unresolvable citation, 70
  orphan candidates — `pm` still holds #5004 deferred for want of a per-row list; that audit output IS the list.
- **`secret_detected` fired on my own brief** (entry **#280250** @1924, `pi.user`): verified not a credential by reading the entry and
  `secretTokens` from `src/secretdetect.mjs` → `[{offset:1924, family:"high-entropy-token"}]`, which is the **49-char requestId I
  chose** (`delegate-20261103-operator-order-scorer-cap-rearm`). Third firing of the same class (D194 had two) — evidence for held
  **#3128** and queued **#4922**, **no new row**. Practical hygiene: a long hyphenated `delegate-<date>-<words>` request-id deposits a
  secret notice, so keep request-ids short when a brief also carries queue ids.
- **Wall-clock, from `tools/latency-budget.mjs` (4.5 s, read-only):** 24.0% of 61,054 generations end in error, holding 61.2 h; the
  ≥10-min tail is 168 runs holding **65.6% of generation busy time**; compaction has burned **46.7 h** across 1,562 tasks — the class
  in §2 is not new, it has been paying for weeks.

### 6. Standing constraints (unchanged)

- **Do not claim, complete, defer, or route queue rows yourself**; decomposition and routing belong to `pm`/`lead`.
- **No push without the operator's grant.** The D195 grant was spent (4 docs commits). Ask for the next one.
- **Native host only** (Linux; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103). `test -f "$PWD/durig.config.json"`
  before any write verb; **never `doctor`/`resume` while a seat is generating** (D187).
- **Every verification claim names its axis of independence** (seat / transcript / execution), and **`gate.mjs`'s clean-side numbers
  are void until #5027 lands** (D193(8)) — no arm run so far certifies model independence.
- **`inputs/fetched/` must stay clean or the lander refuses** (untracked counts as dirty); the moved `strata-batching.md` fetch still
  needs a manifest row or deletion (`.spike/inputs/`).
