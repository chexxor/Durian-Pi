## NEXT SESSION (2026-11-03T19:5xZ — D199, Linux `chexxor@ThinkStation-P3`: **step (1) of the operator's order is DONE and LANDED** (`main 84edff3c`), the cleanup pass cut worktrees 18→8 / branches 19→9, and the operator's `MAX_TOKENS=16384` is now **proven** — a compaction fired mid-turn and survived)

**What just happened, in one paragraph.** `devtools` built #5027 on `refs/heads/item-4997` (`a0bd029f` fix +
`e61ac4f5` dispositions), completed the row, and I **landed** it: `main` `93ae0145 → 84edff3c`
(`scripts/land.mjs … --db ./selfdev.sqlite`, `lock {slots:1, held:1, waitedMs:1, reserved:true}`, tree clean,
`git merge-base --is-ancestor item-4997 main` exit 0). Landing proof was **two full suite runs**, not `--suite`
(see §2): **245/245 before → 246/246 after**, `failed: []` both sides, +1 demo. Then a cleanup pass: worktrees
**18 → 8**, branches **19 → 9**, every removal proven an ancestor of `main` first, `main` unmoved by the prune,
nothing forced, and the one superseded ref removed by the sanctioned verb (`worktree prune-branch item-4898`,
`patchEquivalent:1`, recovery `git branch item-4898 9beb1ae3…`). **`main` is 4 ahead of `origin/main` and
unpushed — tonight's push grant is spent; ask again.**

**Current item:** the operator's order (D194/D195). **Step (1) — the `gate.mjs` clean-side scorer — is closed:
built, verified by me independently, landed.** Step (2) is next: the spend cap + cost ledger **#5015** with
**#5024** (auth header + spend recording) and **#5025** (the `verifier/` pointer decision), plus the trivial
**#5026** docs fix. Step (3) is the `openai/gpt-oss-120b` re-arm at `CAL_MAX_TOKENS=8000` (`gate.mjs:83`
`CAL_MAX_TOKENS || 3000`, verified on `main`). Everything before this block is VERBATIM in
`docs/NEXT-ARCHIVE.md`.

**Queue ids that matter now:** #5027 **done** (author `devtools`) · **#5031 `queued` devtools→lead** — the
re-cut of `item-4986` (the row-scoped queue read, still unlanded) · #5024 / #5026 / #5022 `queued`→**devtools** ·
#5015 / #5025 `queued`→**architect** · #4997 (known-red baseline) still **held** by `devtools` with a measured
reason · #5004 `deferred`→**pm** (70 zero-build-closable LANDING rows) · #4970 (the two local keys, one source of
truth) `queued`→architect · deferred-and-waiting-on-human: #4354 (impl), #4814 (qa2), #4817 (devtools) ·
census 2026-11-03T19:4xZ: `done 3792 · cancelled 795 · held 335 · queued 92 · deferred 14 · claimed 4` (5,032 rows).

**Blocker:** three, all named, none of them mine to rule. (a) The push grant is spent — 4 commits sit unpushed.
(b) `devtools` is the only seat sendable-by-shape **and** provider-live, and the capacity numbers are a per-verb
prefix rather than a config fact (#4970). (c) Every *non-author review* leg is currently impossible: nothing listens
on `127.0.0.1:1234` (five verifier seats, band 8,192) and `lead`/`pm` end their projections on `user`, which is why
#5031 (the `item-4986` re-cut) and #5004 (70 zero-build-closable rows) are parked.

### 0. The capacity ruling is now MEASURED, not assumed — this changes what a wake costs

- `devtools` crossed the band mid-turn and **a compaction fired and succeeded**: head marker
  `pi.compaction@279624 → pi.compaction@280362`, `context.consumed` **156,614 → 88,069**, and the counted
  projection still ends `assistant` (`user,assistant,assistant,user,assistant,user,assistant`). Under the old
  default (`DURIG_LOCAL_MAX_TOKENS` unset ⇒ 8192) the same compaction died at the summary output cap and settled
  `unanswered/model_error` at zero tokens. The summary budget is
  `min(0.8·policy.reserveTokens, model.maxTokens)` = `min(13107, 16384)` with the operator's number.
- **Still true:** the grant is a **per-verb environment prefix**, `DURIG_LOCAL_CONTEXT=200000
  DURIG_LOCAL_MAX_TOKENS=16384`, because `durig.config.json` is gitignored and the two private copies drift
  (`cli.mjs status` in *this* checkout still prints `devtools 88069 / 160000`). #4970 is the durable close.
- **Cheap pre-flight before any wake (1.5 s, read-only):** `node tools/seat-turn-shape.mjs | grep -A2 "seat
  devtools"` (read the LAST element of the counted projection) and `status --json`'s `context.devtools.consumed`
  against **183,616** (the 200,000 band), not 143,616. As of clock-out: ends `assistant`, consumed 88,069 ⇒
  **~95,500 of headroom with the prefix**. `impl` (143,278) and `lead` (145,429) remain over the 160,000-declared
  band; `qa`/`advocate`/`auditor`/`designer`/`qa2` have a 24,576 window (band 8,192) and nothing on `:1234`.

### 1. Next commands, in order

1. **Push on a fresh grant** (4 commits: `93ae0145`, `a0bd029f`, `e61ac4f5`, `84edff3c` — the last three are the
   #5027 build and its landing). `git rev-list --count origin/main..main` = 4 as of clock-out.
2. **Then step (2) with a third `devtools` wake** — it already holds #5024 and #5026 (`queued`→devtools). Brief
   the build: the `authorization` header + spend recording at `tools/model-probes/gate.mjs:96` (no header today,
   verified) and the shim docs at #5026; keep the **spend cap + ledger (#5015)** with `architect` unless the
   operator re-addresses it. Exact next command, run from the approved seat root (already fast-forwarded to `main`,
   and `cli.mjs` resolves there because it is a linked worktree of the same repo):
   `cd /home/chexxor/Git/durian-dev/seatroot && DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite DURIG_LOCAL_CONTEXT=200000 DURIG_LOCAL_MAX_TOKENS=16384 node cli.mjs send devtools --body-file .spike/delegate-20261103c/brief-devtools-3.md --request-id d200-devtools --no-stream`
   (request ids **under 40 chars**; seed the seat root's `.spike/` first if the brief names a probe — runbook §18;
   `send` is legal only with **no broker up**, and there is none).
3. **#5031 (the `item-4986` re-cut) is the one unlanded branch holding real value.** It is addressed to `lead`,
   and `lead`'s projection ends on `user` — un-sendable. Either the operator re-addresses it to `devtools` (a
   later wake) or a `lead` repair (reset/compact — a seat/capacity verb, the operator's call) unblocks it.
   Measured by the seat and re-measured by me: `ahead=2`, base `43e26dcc`, `git merge-tree --write-tree main
   item-4986` exit **1**, the **only** conflict is `docs/runbooks/session-start-cost.md` (front-matter
   `evidence` + §1 + Do step 1, both sides edited the same lines — a union is the resolution), and
   `demo/test-areas.json` must be **regenerated at re-cut time** (stale derived manifest, land.md).
4. **Then step (3)'s ~$0.10 re-arm**, which is the first metered arm whose clean-side numbers mean something —
   see §2 for how to read them.

### 2. How I verified the scorer fix, and the number axis that nearly fooled me

- **Instrument, not reimplementation:** `gate.mjs --rescore` re-scores saved transcripts with no prompt. Three
  arms ship now (`GATE_SCORER=raw|strip|strip+neg`, default `strip+neg`; `raw` reproduces the pre-fix scorer so
  "before" is reproducible). My own runs in **this** checkout (vendor dependency set, my process) over the
  transcripts with clean-side cells — 25 files — gave: `raw` → **FALSE-ALARM 502 / CLEAN-PASSED 0 /
  TRUNCATED-EMPTY 51** (553 cells); `strip+neg` → **FALSE-ALARM 460 / CLEAN-PASSED 21 / AMBIGUOUS 5 /
  TRUNCATED-EMPTY 51** (537 cells). That reproduces the seat's table on the `strip+neg` row exactly.
- **THE AXIS:** the clean side here is **`cond !== "defect"`** (clean **and** neutral). My first tally filtered
  `cond === "clean"` only and showed **zero** flips — an axis error, not a refutation. Name the denominator
  before believing or reporting any clean-side number.
- **Hermetic proof now exists:** `demo/gate-clean-scorer.test.mjs` + `demo/fixtures/gate-clean-scorer-transcript.json`
  pin the five shapes × three arms and an end-to-end `--rescore`; it is the +1 in 246/246. The scorer lists live in
  `tools/model-probes/assertscan.mjs` (importable — `gate.mjs` has no import guard, so importing it RUNS the gate
  and spends GPU/API; that is why the scorer went untested for 24 runs).
- **`--suite` is currently unusable for ANY landing**, and this is not the branch's fault: `land.mjs … --suite`
  stopped on `demo/commit-discipline-personas.test.mjs` with `ERR_MODULE_NOT_FOUND
  @earendil-works/pi-durable` from `/tmp/durig-discipline-personas-*`. I proved the cause is the landing shape, not
  the merge: the same demo is **exit 0 in the operator checkout** (245/245 before) and **exit 1 in a throwaway
  detached worktree at plain `main`**. So land without `--suite` and prove with **two full suite runs** and diff
  `failed[]` (52 s each, never while a seat is generating). This is the #4985/#4995/#4996 instrument family and
  worth a row; #4997 (known-red baseline, still held) is what absorbs it.

### 3. Cheap reads this session leaves (gitignored — #5022 is the promotion row)

- `.spike/delegate-20261103c/`: `brief-devtools-2.md` (what was sent), `send-devtools-2.out` (**the whole settled
  reply**), `land-item-4997*.out`, `suite-before.json` / `suite-after.json`, 51 `*.rescored.json`, `q-2.json`
  (22 MB census), before/after inventories.
- **`node .spike/delegate-20261102/cleanrescore.mjs` now CRASHES** — it scraped the DECLINE/ASSERT lists out of
  `gate.mjs` with a regex and they moved to `assertscan.mjs`. Promote-and-rewrite it under **#5022** by
  `import {DECLINE, ASSERT, assertedTokens} from "../../tools/model-probes/assertscan.mjs"`. A probe that scrapes
  a module is a probe that breaks on refactor.
- Landings this session proved the value of `tools/queue-drain-audit.mjs` (1.5 s): **70 of 89 non-terminal LANDING
  rows are already fully on `main`** — closing them is `pm`'s verb (#5004, `deferred`), and `pm` is un-sendable.

### 4. Standing constraints

- **Do not claim, complete, defer, route, or release queue rows yourself** (`pm`/`lead` own routing; releasing
  belongs to recipient or sender, `src/rig.mjs:1223-1245`). **Landing is the delegate's/operator's call**
  (`land.md`), and `land` is NOT `complete`: say `LANDED at <sha>` or `ROUTED, NOT LANDED`.
- **No push without the operator's grant.** Tonight's is spent; `main` is 4 ahead. Ask.
- **Native host only** (Linux; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103). Never `doctor`/
  `resume` while a seat is generating (D187; `doctor` is an alias of `resume`, `cli.mjs:3102`).
- **Capacity is never a delegate or seat ruling.** **Name the axis of independence and the denominator** for every
  verification claim, and name the **tree + dependency set** for every suite verdict (land.md).
- **The pointer has a byte cap:** keep `docs/NEXT.md` **≤ ~16.9 KB** and run **both** `demo/next-pointer.test.mjs`
  and `demo/clockin-digest.test.mjs` after editing it (runbook §19).
- **`inputs/fetched/` stays clean or the lander refuses** (untracked counts as dirty); the moved
  `strata-batching.md` fetch still needs a manifest row or deletion (`.spike/inputs/`).
