## NEXT SESSION (2026-11-03T16:3xZ — D197, Linux: the milestone's first verb is ONE `send` to `devtools`; it is not blocked by decomposition, it is blocked by two config numbers, and spending it without them would make the last sendable author seat un-sendable)

**Current item:** the operator's order (D194/D195, unchanged) — **(1)** fix the `gate.mjs` clean-side scorer →
**(2)** land the spend cap + cost ledger (#5015 with #5024/#5025/#5026) → **(3)** re-arm `openai/gpt-oss-120b` at
`CAL_MAX_TOKENS=8000`. Step (1) is now **one prepared send**, not a decomposition problem: the brief is written and
pre-flighted at `.spike/delegate-20261103b/brief-devtools.md`, and **#5027's release verb belongs to `devtools`
itself** (recipient — `src/rig.mjs:1223-1245`, `release_work` is sender **or** recipient), so no `pm` wake is owed.
What blocks the send is the compaction band, whose lever is the operator's (**#4970 HALF B**).
Everything before this block is VERBATIM in `docs/NEXT-ARCHIVE.md`.
**Queue ids:** milestone **#5027** (held, pm→devtools), **#5015** (queued, lead→architect), **#5024/#5026** (queued,
lead→devtools), **#5025** (queued, lead→architect) · other released rows a broker would auto-wake: **#5019/#5020**
(queued→impl), **#4997** (claimed by devtools), **#4981/#4970** (queued→architect) · held: **#5028/#5030** (→impl),
**#5029** (→architect), **#4973/#4964** (→impl), **#4896, #3128/#4922** · deferred: **#4354 (impl), #4814 (qa2),
#4817 (devtools)**, all `waiting on human` · census 2026-11-03T16:24Z (`tools/queue-drain-audit.mjs`):
`done 3791 · cancelled 795 · held 335 · queued 90 · deferred 14 · claimed 5`; 89 non-terminal LANDING rows, **70
already fully on main** (that audit output IS the per-row list `pm` asked for with #5004 deferred).

**Next command:** the ruling, then the one send — in this order:
1. **Operator ruling (the two numbers, #4970 HALF B — capacity is never a delegate or seat ruling).** In
   `durig.config.json` (gitignored, so this is a host edit, not a commit): `DURIG_LOCAL_CONTEXT` **160000 → 200000**
   and `DURIG_LOCAL_MAX_TOKENS` **unset(=8192) → 16384**. Effect, measured from source: the band becomes
   `200000 − 16384 = 183,616` (so `devtools` at 143,426 and `impl` at 143,278 stop tripping `thresholdCompaction` at
   all) and the summary output budget becomes `min(⌊0.8·16384⌋, 16384) = 13,107`. The engine already serves
   `--max-context 204800` (its own command line) and `/v1/models` answers `iq3_s`. **Context alone is enough for
   `devtools`** (it avoids a compaction entirely and keeps its context); `MAX_TOKENS` alone would let the compaction
   *succeed* but summarize away the seat's recent turns — take both, and do not hand-align only one of the two
   private config copies (this checkout says 160000; the seat root's copy is a separate file — name both if you move
   one).
2. Re-read the cause before any recovery verb (2 s, `session-start-cost.md` §2c): `submissions` #280241 (`lead`) and
   #279623 (`devtools`) still read `Compaction failed: Summarization hit the token limit; the summary is incomplete`.
   Unchanged as of 2026-11-03T16:2xZ.
3. `node tools/seat-turn-shape.mjs` **immediately before the send** (0.4 s) and read the LAST element of the counted
   projection, not the `AT RISK` label, and not the head marker (it re-derives per read — see §1).
4. Then, and only then, with cwd at this checkout (which has `durig.config.json`; no worktree does):
   `DURIG_DB=./selfdev.sqlite node cli.mjs send devtools --body-file .spike/delegate-20261103b/brief-devtools.md --request-id d197-devtools --no-stream`
   (request-id kept under 40 chars on purpose — see §4). If the config file was NOT edited, the per-verb interim is
   `DURIG_LOCAL_CONTEXT=200000 DURIG_LOCAL_MAX_TOKENS=16384 …` prefixed to that command — **name the override** in
   any report that uses it.
5. **Do NOT run `run`/`serve` before (1).** 90 `queued` + 5 `claimed` rows auto-wake their seats (a `queued` item
   always wakes; `held` never does — `docs/WORK-ITEM-LIFECYCLE.md:112-115`), and every seat worth waking is either
   over its band or ends its projection on `user`. Starting the broker now spends the milestone's only usable seat.
6. Push: D195's grant is **spent** (`origin/main` = `9f79f45c`). `main` is **3 ahead** (`2c811007`, `a03dce97`,
   `f25075c3`, all docs-only) plus this session's docs commit — **ask before pushing any of them.**

**Blocker:** `durig.config.json` carries `DURIG_LOCAL_CONTEXT=160000`, so the local compaction band is **143,616** and
`devtools` sits at **143,426** — any brief of real size crosses it, the summarizer hits the 8,192-token output cap, and
the whole send settles `unanswered/model_error` at **zero tokens** while appending a `pi.user` entry that moves
`devtools` off `assistant`, i.e. turns the **last boundary-sendable author seat** into another `impl`/`lead`.
Separately, still true and still the operator's: **nothing listens on `127.0.0.1:1234`**, so the five `verifier/…`
seats cannot take a turn at all, and their band is **8,192 by construction** (`24576 − 16384`) with a 3,000-token
summary budget — so the #5024/#5015/#5025 re-point must set context **and** max-tokens as one pair.
No broker, no genlock slot, no generating process at clock-out.

### 0. What last session's pointer got wrong, measured this session (all three change what you should do)

1. **"What blocks #5027–#5030 is decomposition" is FALSE for #5027.** `release_work` (`src/rig.mjs:1223-1245`) allows
   **sender or recipient**; #5027 is `pm→devtools`, so `devtools` releases its own row on its own turn. A `pm` wake
   to release it would cost ~12 min and ≈17,000 context tokens for a verb the recipient already holds.
2. **`devtools` is sendable by the §2b boundary slot, tonight, without any repair.** Its counted projection is now
   `user,assistant,user,assistant,assistant` (5, ends `assistant`); the D196 table recorded it as not
   sendable-by-shape. Shape **mutates between reads** — re-run `seat-turn-shape.mjs` per seat per session; a
   pointer's seat table is a snapshot, not a fact. `security` also ends on `assistant` (5, 89,530 consumed, under band)
   and is a second live-provider seat nobody listed. `pm` ends on `assistant` (6, 84,083). `qa` ends on `assistant`
   (4) but its provider is dead. Everything else (`impl`, `lead`, `scribe`, `advocate`, `designer`, `auditor`, `qa2`,
   `architect`) ends on `user` → **DO NOT SEND**.
3. **The #5027 row's magnitude is overstated, so step (3) of the order cannot be certified by a scorer fix alone.**
   Running the D193 rescore over the 18 transcripts in `.spike/gate/`: 552 clean turns, recorded `FALSE-ALARM 468`,
   recorded `CLEAN-PASSED 0`; the collision is **5 of 12** `DECLINE` phrases containing an `ASSERT` substring
   (`"no defect"`⊃`"defect"`, `"nothing wrong"`⊃`"wrong"`, `"no bug"`⊃`"bug"`, plus the two other `defect` forms), and
   **only 15 of the 468** FALSE-ALARMs flip to CLEAN-PASSED once DECLINE phrases are stripped before the ASSERT scan.
   The other 453 assert outside any decline phrase. So: fix the substring logic (it is real — a canonical decline
   scores `declined:true, asserted:true` and can never be CLEAN-PASSED), but do not expect it to rescue the arms'
   clean-side figures, and do not spend step (3)'s ~$0.10 before #5024's auth header exists (the instrument still
   cannot reach DeepInfra at all: `gate.mjs:96` sends no `authorization` header).

### 1. What moved THIS session (verified; **zero sends, zero claims, zero config edits**)

- **The gate was re-read before touching it** (§2c rule): `submissions` #280241 (`lead`, requestId
  `delegate-20261103-operator-order-scorer-cap-rearm`) and #279623 (`devtools`) both still `unanswered/model_error`
  with that exact `detail`. The blocker is unchanged, so the D196 escalation still stands.
- **Approved seat root fast-forwarded** `9f79f45c → f25075c3` (`git -C /home/chexxor/Git/durian-dev/seatroot
  merge --ff-only main`, exit 0; clean tree). `git diff --name-only 9f79f45c..main` = 5 docs files, no
  `package.json`/`package-lock.json`/`pi-main.pin.json`, so no `npm ci`/`sync-pi` was owed. Inventories
  (`git worktree list --porcelain` 18, `git branch --list` 19) **byte-identical before/after** —
  `.spike/delegate-20261103b/inv-{before,after}-{worktrees,branches}.txt`, `diff` exit 0 on both. So the
  milestone send can be dispatched without a placement step.
- **Band re-derived from source, not remembered:** `DEFAULT_COMPACTION_POLICY = {reserveTokens 16384,
  keepRecentTokens 20000, backgroundTokens 32768}` (`vendor/pi-main/packages/durable/dist/harness/agent.js:10-15`);
  summary budget `Math.min(Math.floor(0.8*policy.reserveTokens), model.maxTokens)` (`compaction.js:95`); the failure
  string is `summaryFailure` on `stopReason === "length"` (`compaction.js:296-303`); local `maxTokens` default 8192
  (`src/providers/local.mjs:76,85`). Provider truth: `/v1/models` → `iq3_s`, `gpus:[0,1]`; **no listener on 1234**;
  GPU0 14,906/16,376 MiB, GPU1 22,712/24,576 MiB; `DEEPINFRA_API_KEY` set in this shell (32 chars, never printed).
- **Milestone step (2) is unbuilt on `main`, and the near-name is a trap.** `tools/model-probes/capped-run.mjs` caps
  **memory** (cgroup `MemoryMax`/`MemorySwapMax`, ROADMAP 260/261), not **spend**; `git grep -ln DEEPINFRA_API_KEY
  main -- src tools` returns only `scripts/compact-eval.mjs` and `src/config.mjs`. The only working ceiling+ledger is
  gitignored (`.spike/delegate-20261102/auth-ledger-shim.mjs`, ledger `spend.jsonl`) — unpromoted, therefore gone next
  session unless #5022 (promotion row) runs it.
- **Doc guards all green before and after the docs edit:** `tools/doc-integrity-guard.mjs` 0 hard / 1 soft exit 0;
  `tools/instrument-provenance.mjs` PROVENANCE CLEAN exit 0; `demo/next-pointer.test.mjs` re-run after this edit.
  **No suite run** — `main` is unverified-green since `9f79f45c`; last marker is the archived 245/245.

### 2. Per-seat state, re-measured 16:2xZ (the two numbers that decide a send are the LAST projection element and the seat's OWN band)

| seat | provider | up? | projection ends | consumed / own band | verdict |
|---|---|---|---|---|---|
| `pm` | local | yes | `assistant` (6) | 84,083 / 143,616 | sendable |
| `devtools` | local | yes | **`assistant` (5)** | **143,426 / 143,616** | sendable-by-shape, **blocked by the band** — the milestone seat |
| `security` | local | yes | `assistant` (5) | 89,530 / 143,616 | sendable (unused) |
| `impl` | local | yes | `user` (5) | 143,278 / 143,616 | DO NOT SEND (shape) and over on the next brief |
| `lead` | local | yes | `user` (20) | **145,429 / 143,616 (over at rest)** | DO NOT SEND |
| `scribe` | local | yes | `user` (2) | 91,123 / 143,616 | DO NOT SEND (shape) |
| `qa` | verifier | **no** | `assistant` (4) | 20,110 / **8,192** | provider dead AND over its own band |
| `auditor` | verifier | **no** | `assistant` (11) | 0 (stale) | provider dead; engine refused its template at line 48 |
| `qa2` | verifier | **no** | `user` (1) | 0 (stale) | DO NOT SEND |
| `advocate` | verifier | **no** | `user` (1) | 244,751 / 8,192 (stale) | DO NOT SEND |
| `designer` | verifier | **no** | `user` (1) | 0 (stale) | DO NOT SEND |
| `architect` | local | yes | `user` (1) | 218,645 (stale, post-reset artifact) | DO NOT SEND |

`status.context.consumed` is usage-derived and **pre-send**: it goes stale at a reset/compaction (hence `architect`
1.37 and `advocate` 9.96 fractions — not emergencies, §14 of the runbook) and it does **not** include the brief you
are about to append (hence "`devtools` is 190 under" is not a green light).

### 3. The three escalated rows the operator asked about — state re-read from the queue fields, no verb taken

`#4354` `deferred · to=impl · sender=pm`; `#4814` `deferred · to=qa2`; `#4817` `deferred · to=devtools` — each still
carries a `supervisor escalation:` question and `waiting on human` in `status.attention`. All three target seats are
un-sendable (`impl` shape, `qa2` provider+shape, `devtools` band), so the only tonight-actionable close is `pm` as
**sender** (`cancel_work`), which costs a ~12-min wake. Left as-is; the operator's D195 instruction ("bring only
#4354/#4814/#4817") was already served by the D196 `pm` brief, which minted #5027–#5030.

### 4. Cheap reads, traps, and probes this session leaves behind (gitignored — #5022 is the promotion row)

- `.spike/delegate-20261103b/`: `brief-devtools.md` (**ready to send**, 4,100 B), `seat-turn-shape-1.txt`,
  `status-1.json` (23.8 MB), `q-1.json` (22.2 MB), `drain-audit-1.txt`, `NEXT-pre-cut.md`, four inventory files.
  Re-runnable, unpromoted.
- **New cheap read worth keeping (0.3 s, read-only):** `node .spike/delegate-20261102/cleanrescore.mjs` re-scores
  every `.spike/gate/*.json` with the instrument's own lists and prints `TOTAL clean turns … recorded CLEAN-PASSED 0`.
  Run it before designing the #5027 fix and again after, to price the fix.
- **Request-id hygiene (measured from the classifier, `src/secretdetect.mjs:37`):** `high-entropy-token` is
  `^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$`. Any request id ≥40 chars carrying a digit deposits a
  `secret_detected` attention notice on the seat and a compromised-store warning. `pm` #280250 and `lead` #280240 /
  #280207 are exactly this class (3rd–5th firing) — **keep ids under 40 chars** (`d197-devtools`). Evidence for held
  **#3128** and queued **#4922**; no new row.
- **`held` has exactly two exits** (`release_work` → `queued`, `cancel_work` → `cancelled`) and **`queued` rows wake
  their seat** — so "don't start the broker" is a real constraint while seats are un-sendable, not timidity
  (`docs/WORK-ITEM-LIFECYCLE.md:79-115`).
- Wall-clock, unchanged from D196: 24.0% of 61,054 generations end in error holding 61.2 h; compaction has burned
  **46.7 h** across 1,562 tasks (`tools/latency-budget.mjs`, 4.5 s, read-only).

### 5. Standing constraints (unchanged)

- **Do not claim, complete, defer, route, or release queue rows yourself**; decomposition and routing belong to
  `pm`/`lead`. (Releasing is the recipient's or sender's verb, never the delegate's.)
- **No push without the operator's grant** — D195's is spent (`origin/main` = `9f79f45c`). Ask.
- **Native host only** (Linux; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103).
  `test -f "$PWD/durig.config.json"` before any write verb (no worktree has one); **never `doctor`/`resume` while a
  seat is generating** (D187), and remember `doctor` is an **alias of `resume`** (`cli.mjs:3102`) — one write verb.
- **Capacity is never a delegate or seat ruling** (`session-start-cost.md`, Escalate to). **Every verification claim
  names its axis of independence**, and **`gate.mjs`'s clean-side numbers are void until #5027 lands** (D193(8)).
- **`inputs/fetched/` must stay clean or the lander refuses** (untracked counts as dirty); the moved
  `strata-batching.md` fetch still needs a manifest row or deletion (`.spike/inputs/`).
