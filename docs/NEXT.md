# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T05:1xZ = **2026-10-29 00:1x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1, Linux. **The state changed twice this session, in this order: the transport cause of `REQUEST FAILED fetch failed` was corrected, then the verifier variant changed and the gate FINISHED.**fc42.x86_64`, node v24.22.1, **Linux**. Delegate session, operator-approved continuation. **This session corrected a cause this pointer asserted wrongly.** The gate's
`REQUEST FAILED fetch failed` rows are **Node's 300 s undici `headersTimeout`**, not memory pressure: `gate.mjs:96` calls
non-streaming `fetch` and llama-server sends headers only when generation finishes. Matched pair, same body
(`.spike/gate/timeout-hypothesis.out`): fetch → **300.8 s, cause `HeadersTimeoutError` [`UND_ERR_HEADERS_TIMEOUT`]**;
`node:http` + `req.setTimeout(0)` → **200 in 372.0 s**. registered as **254**. **The seeded-bug gate has now COMPLETED (2026-10-29T04:0xZ, 24 prompts, no transport failures) and
flint failed it** — see NEXT SESSION and OPERATOR GRANTS 5. **Six asks became six grants** (operator accepted all six,
2026-10-29T05:0xZ) — the next session **executes** them rather than re-asking; durable: **D165**. Three intents were
**spooled to `pm`** under the 2026-10-28 spool ask (now discharged); **254/255/256/257/258**
registered; runbook `docs/runbooks/cross-clone-object-recovery.md` landed (+ 2 index rows, so the owed Edit B is
**discharged**); `docs/runbooks/verifier-model-server.md` corrected and extended. The operator set a **new restart
condition** (seat hygiene — **256**) and it is the current item below. Session notes:
**`docs/reviews/delegate-notes-2026-10-29-hygiene-and-transport.md`**; durable: **D164** and **D165**. **Prior sessions, one line each:**
flint verifier flip + **253** (D163); round-4 research gate + **250/251**; `tools/review-cite-check.mjs` + **252** (D162);
**241** closed by the permission-plane note → **247/248/249**. **Committed, not pushed (233 hygiene) — read
`git log --oneline -3`, never shas quoted in a pointer.** Read me first — do not re-derive the priority from the
~5,000-line roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This file is a **pointer, capped at 200 lines** by
`demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block below to carry a current item, a queue id,
a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in place, do not restyle it.** Its two executable
readers are `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` (the digest reads only this section, so the
**`NEXT-ARCHIVE.md` link must stay inside the pointer body**). After editing:
`node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs`.

## NEXT SESSION

**Current item: answer the operator's question — "will the seats behave, and when can we have them?" — with a rehearsal and
an instrument, not with a hope.** The operator's restart condition (2026-10-29): the team restarts **if and only if** seats
are hygienic about their **seat-personal workspace, git branches, git worktrees, and merging to `main` after review**.
Registered as **ROADMAP 256** (the audit instrument + a 2-seat bounded rehearsal in the disposable clone
`/home/chexxor/Git/Durian-Pi-ops`), and it is sequenced **after 217 and 232** because a seat that cannot run `git` has
unobservable hygiene (store: **20,340** `powershell` calls, **0** `bash`, `spawn powershell ENOENT → 3`) and the sweep that
prunes the ledger is the same code family as the retire-on-`done` path 253 touches. **The queue is unchanged: 4,821 rows,
0 claimable** — 217/232/233/235–**256** still have **no queue row**, so `pm` must decompose what was spooled to it before
any rehearsal has anything to rehearse. **Queue ids:** **#725** (impl, ROADMAP 63), **#726** (devtools, ROADMAP 64),
**#727** (qa, ROADMAP 67) — all `held`, all three orphan-candidates (#662/#710 both `done`) while the operator clause "and
the queue drains" **still has no definition anywhere in the tree** (ROADMAP **231**). **Inbox now holds 4 intents**
(`selfdev.sqlite.broker.inbox/`): the stranded `delegate-routing-fact-20261028-2150` plus the three spooled today —
`hygiene-rehearsal-20261029`, `verifier-merge-20261029`, `release-brief-20261028` — all addressed to **`pm`**.
**Read `docs/reviews/roadmap256-rehearsal-prompt-2026-10-29.md` before decomposing item 1** — it carries the rehearsal
brief (the defect slice, the audit instrument, the verdict file), the settled ordering, what is already measured, and the
trap (answer with a gate, not a date). **The verifier half of that plan just lost its assumption:** the seeded-bug gate
**completed for the first time** (24 prompts, Q4_K_M, `.spike/gate/flint-q4-k1-out6k.log`) and flint is **not certifiable on
that feeding/budget** — `truncated 19 of 24`, `defect items named: 1/1 scored (8 attempted)`, **every control that answered
was a FALSE-ALARM** (leading 1/1, neutral 3/3), while the one scorable defect cell was a clean **HIT** — so **253**'s
"verifier re-runnable evidence before `done`" has no local instrument behind it yet, and **256**'s rehearsal cannot assume
a working verifier gate. **257** is registered for the instrument gap that run exposed (a mostly-unscorable run printing a
rate shaped like a pass). **History:** `docs/NEXT-ARCHIVE.md` (this session's own superseded pointer is cut there verbatim).
**Next command (delegate, read-only first, in this order, ~12 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # §1–§8: links, seat capability (217), provider era (226), clock posture (234)
node tools/broker-serve.mjs --status    # broker + the 4 spooled intents; do NOT start the channel before the rehearsal (D156/D157 + 256)
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # FAILING today: verification-without-evidence ×1 (435 items), duplicate-item ×54, citation-unresolvable ×5, evidence-tree ×1. single-model-rig PASSES — a string comparison, not certification (D137)
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit           # the seed for 256's instrument; heed docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244 — `reapable: 0` is not a verdict
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 452 on 2026-10-29, dated 10-14→10-21; read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc` here
# verifier chain (server holds flint **Q4_K_M** at 65,536 — Q6/Q8 are set aside at ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/set-aside-flint-q6-q8/, restore = mv back):
curl -s --max-time 15 http://127.0.0.1:1234/api/v1/models | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).models)console.log(m.key,m.variants.join(" "),m.loaded_instances.map(i=>i.id+"@"+i.config.context_length).join(","))})'
ps -eo args | grep llama-server | grep -o '\-\-model .*gguf'   # the ONLY surface that names which quantization is live — the API key is identical across variants
CAL_MAX_TOKENS=6000 node --import ./.spike/gate/no-headers-timeout.mjs tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 recursivesi/flint flint-q4-k1-out6k --replicate 1 --pair-comments strip-both --out .spike/gate/flint-q4-k1-out6k.json   # **DONE — do not re-run it**: 24 prompts, 19 truncated, transcript .spike/gate/flint-q4-k1-out6k.json
node .spike/gate/summarize-run.mjs .spike/gate/flint-q4-k1-out6k.log   # per-cell tally + scorability (untracked instrument, 233)
CAL_MAX_TOKENS=10000 node --import ./.spike/gate/no-headers-timeout.mjs tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 recursivesi/flint flint-q4-whole-mutants --whole-module --budget 10000 --replicate 1 --pair-comments strip-both --out .spike/gate/flint-q4-whole-mutants.json   # **the decisive next experiment (~30 min)**: whole-module removes the excerpt confound and targets the 3 proof-backed mutants (M1 2,086 / M3 1,686 / M2 7,139 est. tok) — see the runbook's "first completed gate run" section
```

**Blocker:** three, and the first is now the operator's own condition. **(a) No hygiene evidence** — 256's instrument does not
exist, no rehearsal has run, and the rehearsal cannot run before **217** (no spawnable shell → a seat cannot run `git` or the
suite) nor safely before **232** (unscoped `pruneWorktrees`, `src/broker.mjs:1167`/`src/worktree.mjs:649`); releases stay
`pm`'s verb, the start stays the operator's. `pm`'s work has not started). Still owed rulings: **221** seat-root, **231** "the queue drains". **(b) is now settled as a
measurement, not a suspicion (2026-10-29T04:0xZ):** the gate **completed** — 24 prompts, no transport failures, transcript
kept — and flint **fails it as a verifier**: `truncated (finish=length): 19 of 24`, `defect items named: 1/1 scored
(8 attempted)`, `clean, leading prompt: FALSE-ALARM 1/1`, `clean, neutral prompt: FALSE-ALARM 3/3`, and the one scorable
defect cell a **`HIT+PHANTOM groups=3/3`**. The deadline half of **255** is resolved by the variant change (8,192 tokens =
194–373 s at 42 tok/s); what remains is behavioural, and **257** now covers the instrument trap (a mostly-unscorable run
shaped like a pass).
**(c) The queue has nothing claimable** and `pm` has only just received the rows (the spool ask is discharged; `pm`'s work has
not started). Still owed rulings: **221** seat-root, **231** "the queue drains". **Applied under the grant 2026-10-29:** the
`Q4_K_M` download (24.17 GB, complete) — but **no documented surface can activate it** (REST `load` and `lms` cannot select a
variant; only `selected_variant` in the GUI can), so the rig runs **Q6 at 65,536**, re-verified servable (`"READY"`, 32 tok,
25.5 s cold). **Granted 2026-10-28 (D158):** `--depth 1` competitor clones (5 taken, `vendor-pins --check` PASS at 14 clones);
`.pi/` writes permitted-but-disfavoured; **232 gated on research (241): do not claim it, do not touch `src/worktree.mjs:649` /
`src/broker.mjs:1167`, and run no suite from this checkout while it is open.** **Granted 2026-10-29:** model-server control
(unload/load/`context_length`) and the verifier-seat edit in `rig.selfdev.json`; **seat instruction text remains
operator-owned and untouched.**

## Rig state, re-measured at clock-in 2026-10-29T06:2xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (438,329,344 B): `entries` 137,427 rows, 12 seats. **Queue census** = **4,821 = 3,748 `done` /
777 `cancelled` / 277 `held` / 19 `deferred`, i.e. 0 claimable**. Per-seat parked (held/deferred): impl 164/13 · scribe 44/0 ·
devtools 33/2 · qa 21/0 · security 6/0 · lead 4/1 · pm 3/2 · auditor 2/0 · qa2 0/1 · advocate/designer/architect `no-work`.
**Providers (era-attributed, 226/229):** every failure in the last-30-submission window belongs to the **`deepinfra` era**; the
current `local/iq3_s` era has none — the `402`s in recent rows are history.
**Verifier (D163 + this session):** five seats (`qa`, `qa2`, `advocate`, `auditor`, `designer` — what `src/verifierrole.mjs`
actually matches; `docs/SELFDEV.md` says three and is wrong) resolve to **`verifier/recursivesi/flint`**. **As of
2026-10-29T02:4xZ the served variant is Q4_K_M, not Q6_K** — the Q6/Q8 `.gguf`s were **renamed out of the scanned tree** to
`~/.var/app/ai.lmstudio.lm-studio/.lmstudio/set-aside-flint-q6-q8/` because no documented surface can select a variant
(restore = one `mv`; see `docs/runbooks/verifier-model-server.md` §variant activation). **Same model key, materially
different model — **ratified by the operator 2026-10-29 (GRANT 5, D165)**.** Loaded **65,536**, `parallel 4`, `num_experts 6`, flash attention,
KV offloaded; **decode 42.21 tok/s** (1,500 tok / 35.5 s) — Q6_K was **10.75 tok/s** (4,000 tok / 372.0 s) — COLD prefill
~212 tok/s on Q6, WARM TTFT 0.23 s at 6,016 tok, and a **cold instance pays ~22 s before its first token** (32-token reply
took 25.5 s just after load). Verify which variant is live with `ps -eo args | grep llama-server | grep -o '\-\-model
.*gguf'` — the API reports the same key for every variant. `durig.config.json` (gitignored): `DURIG_VERIFIER_MODEL
recursivesi/flint`, `_CONTEXT 65536`, `_MAX_TOKENS 8192`. Verifier prompt sizes p50 **55,538** (`qa`) / **108,435**
(`advocate`): 65,536 is a floor and **208** is the fix. `demo/local-model-pointer.test.mjs` and
`demo/second-local-provider.test.mjs` **PASS** at this config; `check`'s `single-model-rig` **passes** — a string comparison
(**D137**).
**Seat capability (217):** seat tools are `read write edit powershell prepare_workspace seat_root`; `pwsh`/`powershell` absent
here, `bash` present and unregistered. **Unsettled submissions:** 9 `placed` + 2 `queued` → 9 of 12 seats count ADVANCING.
**Worktrees:** **1 (this checkout, `main`)**; branches 2; `refs/rescued/*` **32**; **452 unreachable commits**; the Windows
source clone `/mnt/d/Git/Durian-Pi` is **not mounted** (`/mnt` empty), so those commits have one home left — **237/233
hygiene + the minting grant, **now GIVEN** (GRANT 3, D165 — mint the refs before anything runs `git gc` here)**. Pi seat-agent state is host-local and absent here, so a seat worktree here is
**created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb `docs/runbooks/workspace-move.md`
gates. Inventory diffed clean across today's spool writes (`.spike/{pre,post}-writing-inventory-2026-10-29.txt`).
**Box:** 94 GB RAM, ~20 GB available, **swap 7/7 full**; **two GPUs** — GPU0 **RTX A4000 16,376 MiB** (~14.8 GB used,
incl. `strata-host`) and GPU1 **RTX 3090 24,576 MiB** (~21.6 GB with Q4_K_M + KV) — so any "it fits in VRAM" claim must name
the card. Model server: 3 model dirs on disk; **the `flint` catalog now resolves to one variant (`@q4_k_m`)** because the
Q6/Q8 files are set aside — with them in place it lists `@q6_k @q8_0 @q4_k_m`.

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb** the ledger went **36 → 1**, and eight instruments read or run earlier in it are
**gone from disk and from `git ls-files`** — never committed, so `git status` shows no deletion. The ledger half is named in
the product (`src/broker.mjs:1167` → `pruneWorktrees`, `src/worktree.mjs:649`); the file-loss half is **unexplained** and the
same end state is recorded twice before (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`). Until 232/233 land:
**do not run the suite from this checkout** — run it in the disposable clone. `.scratch/` is **not** gitignored (only `.spike/`
is, line 21), so an instrument left there is one `git add` from safety and one sweep from loss (**233**).

## OPERATOR GRANTS (six; accepted 2026-10-29T05:0xZ — **execute these, do not re-ask**; durable record: **D165**)

1. **221 seat-root — ruling A is the ruling.** The persisted per-seat root becomes the workspace-root-relative name;
   `up --root` once per seat; **no migration code**. Implementation is the team's (failing-first demo, `src/`); the delegate's
   part is to spool the ruling to `pm` and hold the line that `up --root` alone does not clear the persisted value
   (`classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` prints **`main-worktree`** on Linux, so this is not inert).
2. **"The queue drains" — predicate granted:** *every released row reaches a terminal state within one resident-broker day*
   (the 314–741 items/day regime), **and** *no `held` row older than **7 days** survives a `pm` pass without being released
   or explicitly cancelled*. 231 is the product half: a `check` rule plus a surface that prints it. **#725/#726/#727 stay
   `held`** until the predicate exists and `pm` releases them — releases are `pm`'s verb.
3. **Mint the refs — granted, and it is the first command of the next session** (it decays on its own clock). Then re-measure:
   ```bash
   git fsck --unreachable 2>/dev/null | awk '$1=="unreachable"&&$2=="commit"{print $3}' > .spike/orphans-20261029.txt
   wc -l .spike/orphans-20261029.txt            # 452 on 2026-10-29
   while read -r s; do git update-ref "refs/rescued/orphan-$s" "$s"; done < .spike/orphans-20261029.txt
   git for-each-ref refs/rescued | wc -l        # 32 → ~484
   git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # → 0 once every orphan carries a ref
   ```
   **232 itself stays gated** on the 241 design note: nobody touches `src/worktree.mjs:649` / `src/broker.mjs:1167`, and no
   suite runs from this checkout while it is open.
4. **233 instrument hygiene — plan granted.** Land `.spike/gate/no-headers-timeout.mjs` into `tools/model-probes/` as a
   labelled shim (**254** replaces it properly), label the other two cited-but-lost files **re-created** or amend the rows
   that cite them, then `.gitignore` `.scratch/` (**38 files** today). `instrument-provenance` prints the exact three under
   **UNTRACKED BUT CITED**: `.scratch/transcript-write-bodies.mjs`, `.spike/extract-pi-src.mjs`,
   `.spike/gate/no-headers-timeout.mjs`.
5. **Verifier — option (a) now, (c) if (a) fails; the Q4_K_M serving change is ratified.** Do not re-run the finished
   fragment run; run the **`--whole-module` mutant run** (in the next-command block, ~30 min). Then, if controls still
   false-alarm: **the 3090 is not the constraint — D137's cross-family rule is.** The seats run
   **`Qwen3.8-Flash-Next IQ3_S`** (strata-host `:47831`, GPU0), so the obvious fast one-card models (**Qwen3 / Qwen3-Coder
   MoE**) are **the same family as the seats** and would certify a verifier that shares the seats' blind spots. LM Studio's
   entire chat inventory is **flint `@q4_k_m` + `ministral-3-14b-reasoning` (already 0/2) + an embedder**, so a real choice
   needs a download grant: candidates priced in `docs/runbooks/verifier-model-server.md` are **`gpt-oss-20b`** (MoE,
   non-thinking by default, ~13 GB), **`mistral-small-3.x-24b`** (non-reasoning, ~14 GB), **`gemma-3-27b`** (~17 GB) — each
   then gets the k=1 gate run (~30 min) before adoption, never before. **258** covers the cheaper output-contract lever
   (answer-first / forced-choice / structured output) that may rescue a reasoning model without changing it.
6. **Start decomposition, not seats; the hygiene threshold is accepted as proposed.** The channel stays down; `pm` decomposes
   217/232/233/235–258 on next start. Scale gate: **hard dimensions zero** (no leaked worktree, no stray seat, no branch
   unmerged while its item reads `done`) **over the bounded 2-seat rehearsal, ≤2 soft violations per seat-run**, then 5 seats
   with the audit re-run, then 12.

## Do not "fix" these on the strength of the docs

**`fetch failed` from a probe is a transport ceiling, not a dead model or an out-of-RAM box** — compute
`budget_tok ÷ measured_tok_per_s` against 300 s (probes) and 600 s (the rig's SDK) and print `err.cause` (**254**, D164).
**A `TRUNCATED-EMPTY` verdict measures the output budget as much as the model** — read the run's budget and the model's
reasoning shape first; flint emits **0 answer chars** at 1,200 and at 4,000 tokens, so no budget tuning fixes it.
**`1/1 scored` is not a capability rate** — in the completed run 19 of 24 prompts never reached `finish=stop`, so the
flattering denominator is an artifact of the print, not a result (**257**). **A control-side `FALSE-ALARM` may be our
feeding, not the model** — two of them claimed missing imports on a fragment whose import block the window had cut off;
**195**'s excuser saw the class and excused 0. **Decode is not a constant**: 42.21 tok/s isolated vs **21.8–48.9 tok/s
(p50 35)** inside one run, with `strata-host` at 100 % on the other GPU — budget off the low end, and **a model speed claim
is a claim about a quantization** (**255** acceptance (5)). **A model key does not identify a model** — verify the live
`.gguf` with `ps -eo args | grep llama-server`. **An unreachable commit is somebody's work, not garbage** — `git gc`
deletes it (cross-clone runbook). **A `single-model-rig` PASS is not certification** (**D137**). **`reapable: 0` in
`worktree audit` is not a verdict** (`docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244`). **0 claimable rows means a started team
idles or improvises.** **An orphan-candidate verdict is not a release recommendation** (#725/#726/#727 are *correctly*
held). **A swept worktree ledger is not "self-healing"** (`src/broker.mjs:1167`). **A suite that runs green after files
vanished is not green** (`scripts/suite.mjs:36`). **A `402` in a recent row is not current provider state.** **A `WAKE` in
the preflight's post-pass-1 column is a prediction.** **`queued` (submissions) ≠ `queued` (claimable items).**
**`DURIG_MAX_CONCURRENT_SEATS` is unset in `durig.config.json`, `"1"` in the default — read `src/config.mjs loadConfig`
(D153 §4).** **A `--dry-run` names no removals.** **Model speed is 12.7% of machine time.** **A loaded_instances entry is
not a health check.** **Never quote your own shas in
a pointer.**
