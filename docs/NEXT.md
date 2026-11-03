## NEXT SESSION (2026-11-03T17:2xZ — D198, Linux: the operator GRANTED the two numbers (env vars, no file edit); step (1) ran — `send devtools` settled **done**, **#5027 is claimed**, the fix is designed, and `devtools` is now at **156,614**, so EVERY later verb needs the prefix)

**What just happened (read this first):** one `send` to `devtools` under the operator-approved per-verb override
`DURIG_LOCAL_CONTEXT=200000 DURIG_LOCAL_MAX_TOKENS=16384` — **no `durig.config.json` was edited anywhere**, so
**#4970 HALF B (one source of truth for the declared ceiling) is still open and is still the row that ends this
recurring crisis.** Settled `done` / `stopReason stop` in ~7 min, reply verbatim at
`.spike/delegate-20261103b/send-devtools.out`. `devtools` independently confirmed the scorer mechanism, **released
then claimed #5027 by id**, **held #4997 with a measured reason** (see §0.4), left #5024/#5026 queued deliberately
(the ledger must not ship scoring a dead metric), and found the instrument for its own acceptance test:
**`gate.mjs:354` is a re-score mode** — old/new numbers from the saved transcripts, no paid prompt. Its post-turn
shape is still sendable: projection `user,assistant,user,assistant,assistant,user,assistant` (ends `assistant`).
**The number that decides the next verb: `devtools` consumed is now 156,614 — over the 143,616 band of this
checkout's 160,000 declaration, under the 183,616 band of 200,000.** Without the prefix, the next send is the §2
failure by construction.

**Current item:** the operator's order (D194/D195, unchanged) — **(1)** fix the `gate.mjs` clean-side scorer →
**(2)** land the spend cap + cost ledger (#5015 with #5024/#5025/#5026) → **(3)** re-arm `openai/gpt-oss-120b` at
`CAL_MAX_TOKENS=8000`. Step (1) is **claimed and designed**; the build has not happened yet.
Everything before this block is VERBATIM in `docs/NEXT-ARCHIVE.md`.
**Queue ids:** milestone **#5027** (**claimed by `devtools`**), **#5024/#5026** (queued→devtools), **#5015/#5025**
(queued→architect), **#4997** (now **held** by devtools, with a reason), **#5019/#5020** (queued→impl),
**#4981/#4970** (queued→architect) · held: **#5028/#5030** (→impl), **#5029** (→architect), **#4973/#4964** (→impl),
**#4896, #3128/#4922** · deferred: **#4354 (impl), #4814 (qa2), #4817 (devtools)**, all `waiting on human` ·
census 2026-11-03T17:1xZ: `done 3791 · cancelled 795 · held 335 · queued 90 · deferred 14 · claimed 5` (pre-send
figures; #5027 moved claimed, #4997 moved held) — and `devtools` attention now reports **25 queued items addressed
to it**. 89 non-terminal LANDING rows, **70 already fully on main** (`tools/queue-drain-audit.mjs` prints the list;
it IS the per-row list #5004 asked for).

**Next command:** continue step (1), then the two legs below — in this order:
1. **Pre-flight, always the same two reads (1.5 s total):** `node tools/seat-turn-shape.mjs | grep -A2 "seat devtools"`
   (read the LAST projection element) and `status --json`'s `context.devtools.consumed` against **183,616**, not
   143,616. As of 17:1xZ: ends `assistant`, consumed **156,614** ⇒ sendable **only with the prefix**.
2. **The next verb is a second `devtools` wake to build what it just designed** — it already holds #5027, so do NOT
   re-brief the problem; brief the build, and carry its own design back (strip each `DECLINE` phrase, then scan
   `ASSERT` per occurrence with a negation window; score variants (i) stripping-only and (ii) +negation separately;
   acceptance = re-score the SAME transcripts through **`gate.mjs:354`** reporting old AND new counts, plus a
   hermetic `demo/fixtures/` test because the transcripts are gitignored). Dispatch from the approved seat root with
   the prefix, and re-seed its `.spike/` if the transcripts moved (see runbook §18):
   `cd /home/chexxor/Git/durian-dev/seatroot && DURIG_LOCAL_CONTEXT=200000 DURIG_LOCAL_MAX_TOKENS=16384 DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node /home/chexxor/Git/Durian-Pi/cli.mjs send devtools --body-file <brief> --request-id d198-devtools --no-stream`
   (under 40 chars — §4). **Its cwd is `item-4997`, a thin config-less worktree on lockfile pi-durable 1.3.0**
   (§0.4): if the fix needs the pinned vendor build or the real store, re-point the seat first (`up --refresh
   --dry-run` after fixing the cwd the rig file names — ROADMAP 210), do not fight it from the worktree.
3. **Then step (2) as ONE change, after one operator ruling:** #5015 (spend cap + cost ledger) + #5024
   (`gate.mjs:96` sends no `authorization` header) + #5025 (the `verifier/` pointer names a model no provider serves
   and declares 24,576 against a p50 of 55,538). Values still unrulled (D195's note): `DURIG_VERIFIER_MODEL=openai/
gpt-oss-120b`, `DURIG_VERIFIER_MAX_TOKENS=8000`, `DURIG_VERIFIER_CONTEXT=131072`. Context **and** max-tokens move
   together or the §2 failure walks over to DeepInfra (verifier band is 8,192 by construction today).
4. **The leg that buys the most wall-clock: make landings gated again** — **#4997** (held by `devtools` with a reason
   now — see §0.4), **#5019** (a *read* opens the store read-write, so WAL replay mutates the db bytes), **#5020**
   (`send` takes no genlock lease, so `land.mjs` reports `liveHolders:0` beside a live writer). None needs capacity;
   all three need `impl`/`devtools` to be sendable, which the override bought — `impl` still ends on `user`, so it is
   a shape problem first (runbook §2b).
5. **Push state:** this session's grant is **spent** — `origin/main` = **`1a8edb5d`** (`git ls-remote` agrees,
   `git rev-list --count origin/main..main` = 0). Ask before the next one.

**Blocker:** the capacity fix exists **only as a per-verb environment prefix**, and it is now load-bearing rather
than precautionary: `devtools` consumed **156,614**, which is over this checkout's declared band (**160,000 − 16,384
= 143,616**) and under the seat root's (**200,000 − 16,384 = 183,616**). Any verb that does not carry the prefix —
including `resume`/`doctor` and including a broker pass — re-enters the summarization-cap failure.
**#4970 HALF B (one source of truth) and #4887 ("no compaction policy knob exists to set") are the durable fixes and
both are still open.** Separately, still true and still the operator's: **nothing listens on `127.0.0.1:1234`**, so
the five `verifier/…` seats cannot take a turn at all (band **8,192 by construction**, 3,000-token summary budget),
which is why independent verification — the product's central claim — is currently offline. `impl` and `lead` still
end their projections on `user` (do-not-send). No broker, no genlock slot, no generating process at clock-out.

### 0. What last session's pointer got wrong, measured this session

1. **"What blocks #5027–#5030 is decomposition" is FALSE for #5027.** `release_work` (`src/rig.mjs:1223-1245`) allows
   **sender or recipient**; #5027 is `pm→devtools`, so `devtools` releases its own row on its own turn — which is
   exactly what it did at 17:05. A `pm` wake to release it would have cost ~12 min and ≈17,000 context tokens.
2. **`devtools` was sendable by the §2b boundary slot, with no repair.** D196's table recorded it as not
   sendable-by-shape. Shape **mutates between reads** — re-run `seat-turn-shape.mjs` per seat per session; a
   pointer's seat table is a snapshot, not a fact. `security` (ends `assistant`, 89,530 consumed) is a second
   live-provider seat nobody listed; `pm` ends `assistant` (84,083); `qa` ends `assistant` but its provider is dead.
   Everything else (`impl`, `lead`, `scribe`, `advocate`, `designer`, `auditor`, `qa2`, `architect`) ends on `user`.
3. **The #5027 row's magnitude was overstated, and `devtools` accepted the correction and built its acceptance around
   it.** The collision is **5 of 12** `DECLINE` phrases containing an `ASSERT` substring; **only 15 of the 468**
   recorded FALSE-ALARMs flip once DECLINE phrases are stripped, the other 453 assert outside any decline phrase, so
   the seat is scoring variant (i) stripping-only and variant (ii) +negation-window **separately**. Consequence for
   step (3): do not read a scorer fix as certifying the arms' clean-side figures, and do not spend the ~$0.10 arm
   before #5024's `authorization` header exists (`gate.mjs:96` posts unauthenticated).
4. **NEW: a thin item worktree cannot see the rig, and that is now a routing fact, not a nitpick.** `devtools` ran in
   `item-4997` — gitignored `durig.config.json` absent, so `node cli.mjs config` printed **no** local/context/max-token
   keys and it could **not** verify the very numbers the operator had just granted; and its lockfile `pi-durable 1.3.0`
   is **schema v1** against the live store's **v2**, which is why `demo/seat-turn-shape.test.mjs` exits 0 there with
   `SKIP (ENVIRONMENTAL — not a behaviour red) … no store resolves in this tree`. That is #4997's measured hold reason
   (seeding a known-red entry from a tree that cannot reproduce the member would freeze an exemption nobody can
   re-measure), and it means the next wake must either re-point the seat's cwd to the deps-complete root or accept
   that config- and store-dependent work is unmeasurable in it.

### 1. What moved this session (morning: zero sends, zero claims, zero config edits — then the operator granted the numbers and the afternoon dispatched one send and one claim)

- **The dispatch, so it is auditable:** `send devtools` from the approved seat root (`/home/chexxor/Git/durian-dev/
  seatroot`, branch `seatroot/linux`, ff'd to `73ece38c`; worktree 18 / branch 19 inventories byte-identical across
  the verb), env prefix as above, `--request-id d197-devtools`; reply `settledStatus done` / `stopReason stop` in ≈7
  min. Before it: projection ends `assistant`, consumed 143,426 vs band 183,616. After: ends `assistant` (7 items),
  consumed **156,614**, no worktree or branch added, seat root clean. **Pushed on this session's grant:** three
  docs-only commits; `origin/main` is at the commit that contains this file (verify with `git ls-remote`).

- **SUITE MARKER:** `node scripts/test.mjs --all --jobs 8` = **245/245** at `main 1a8edb5d` + these docs (43.3 s, no
  broker / no genlock / no generating seat; axis: execution; `DEEPINFRA_API_KEY` set, `durig.config.json` present).
  An **intermediate 244/245** reading is recorded too, with its cause measured, because it is a trap: the one red was
  `demo/clockin-digest.test.mjs`, and **the pointer was the cause** — clockin embeds `docs/NEXT.md` **VERBATIM**
  (`scripts/clockin.mjs:39,189,426`) against a **20,000 B** digest budget (`:37,463`), so a 17,003 B pointer made the
  digest 20,100 B; trimming to 16,892 B turned it green. **Two caps, one undocumented coupling:** the pointer cap is
  200 **lines** (`demo/next-pointer.test.mjs`), the digest cap is **bytes**. Worth a row: cap the pointer in bytes, or
  make the digest summarize rather than embed — and this is exactly what the missing known-red baseline **#4997** exists
  to absorb. Markers: `.spike/delegate/suite-marker.json`.
- **Everything else this session is recorded in `docs/DECISIONS.md` (D197, D197b, D198) rather than repeated here:**
  the gate re-read before touching it; the seat-root fast-forwards with byte-identical inventories; the band
  re-derived from pinned source (`harness/agent.js:10-15`, `compaction.js:95,296-303`, `src/providers/local.mjs:76,85`);
  provider truth (`/v1/models` → `iq3_s`, no listener on 1234, GPU0 14,906/16,376 MiB, GPU1 22,712/24,576 MiB);
  and the `capped-run.mjs` = **memory** cap not **spend** cap trap.

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

### 3. The three escalated rows — unchanged, no verb taken

`#4354` (`to=impl`), `#4814` (`to=qa2`), `#4817` (`to=devtools`), all `deferred`, `sender=pm`, each carrying a
`supervisor escalation:` question and `waiting on human`. All three addressees are still un-sendable (`impl` shape,
`qa2` provider+shape, `devtools` needs the prefix), so the only close available without a wake is `pm` as **sender**
via `cancel_work`. The operator's D195 ask ("bring only #4354/#4814/#4817") was served by the D196 `pm` brief.

### 4. Cheap reads, traps, and probes this session leaves behind (gitignored — #5022 is the promotion row)

- `.spike/delegate-20261103b/`: `brief-devtools.md` (what was sent), `send-devtools.out` (**the whole settled
  reply**), `seat-turn-shape-1.txt`, `status-{1,2}.json`, `q-1.json`, `drain-audit-1.txt`, `suite-all*.json`,
  `NEXT-pre-cut.md`, eight inventory files. The probe + 37 transcripts were **copied into the seat root's own
  `.spike/`** so the seat could run them in its tree — that copy is what makes #5027 verifiable. Probe inventory and
  promotion ask: runbook §17.
- **New cheap read (0.3 s, read-only):** `node .spike/delegate-20261102/cleanrescore.mjs` — re-scores every
  `.spike/gate/*.json` with the instrument's own lists. Run before and after the #5027 fix to price it.
- **Request ids stay under 40 chars** (`src/secretdetect.mjs:37`, `high-entropy-token`); #280250 / #280240 / #280207
  are that false-positive class — evidence for held **#3128** and queued **#4922**, no new row.
- **`held` has two exits (`release_work` / `cancel_work`) and `queued` wakes its seat** — so "don't start the broker"
  while seats are un-sendable is a constraint, not timidity (`docs/WORK-ITEM-LIFECYCLE.md:79-115`).
- Wall-clock, unchanged from D196: 24.0% of 61,054 generations end in error holding 61.2 h; compaction has burned
  **46.7 h** across 1,562 tasks (`tools/latency-budget.mjs`, 4.5 s, read-only).

### 5. Standing constraints (unchanged) and where the push stands

- **Do not claim, complete, defer, route, or release queue rows yourself** — decomposition and routing belong to
  `pm`/`lead`; releasing belongs to recipient or sender (`src/rig.mjs:1223-1245`).
- **No push without the operator's grant.** Tonight's grant was used (three docs-only commits). **As of clock-out
  `main` is 1 ahead of `origin/main`** — a 2-line staleness fix to this file — unpushed because the grant is spent.
  Push it on the next grant before anything else.
- **Native host only** (Linux; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103). `test -f
  "$PWD/durig.config.json"` before a write verb (no worktree has one); **never `doctor`/`resume` while a seat is
  generating** (D187) — `doctor` is an **alias of `resume`** (`cli.mjs:3102`), one write verb.
- **Capacity is never a delegate or seat ruling.** **Every verification claim names its axis of independence.**
  **`gate.mjs`'s clean-side numbers are void until #5027 lands** (D193(8)). **`inputs/fetched/` stays clean or the
  lander refuses**; the moved `strata-batching.md` fetch still needs a manifest row or deletion (`.spike/inputs/`).
- **The pointer has a hidden byte cap.** `demo/clockin-digest.test.mjs` fails if `docs/NEXT.md` exceeds ≈ 16,900 B,
  because clockin embeds it verbatim into a 20,000 B digest. Keep the live file near or under **16.5 KB** when you
  edit it, and re-run that demo — not just `next-pointer.test.mjs` — after any pointer edit.
