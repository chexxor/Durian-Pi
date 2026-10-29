# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T07:3xZ = **2026-10-29 02:3x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1, **Linux**. Delegate session, operator-approved continuation. **Three verifier measurements landed, and one retracts a claim this pointer made: the gate COMPLETED, but 3 of its 4 clean-side alarms were true statements about a stripped excerpt (D166).** A second cause this pointer asserted wrongly is also corrected: the gate's
`REQUEST FAILED fetch failed` rows are **Node's 300 s undici `headersTimeout`**, not memory pressure — `gate.mjs:96` calls
non-streaming `fetch`, and llama-server sends headers only when generation finishes. Matched pair, same body
(`.spike/gate/timeout-hypothesis.out`): fetch → **300.8 s, cause `HeadersTimeoutError` [`UND_ERR_HEADERS_TIMEOUT`]**;
`node:http` + `req.setTimeout(0)` → **200 in 372.0 s**. Registered as **254**. **Six asks became six grants** (all six accepted,
2026-10-29T05:0xZ) — the next session **executes** them rather than re-asking (**D165**); **GRANT 3 is already done**, and one
ask returns below. Three intents were **spooled to `pm`** (now discharged); **254–259** registered;
`docs/runbooks/cross-clone-object-recovery.md` landed (+ 2 index rows, so the owed Edit B is **discharged**);
`docs/runbooks/verifier-model-server.md` corrected and extended. The operator set a **new restart condition** (seat hygiene —
**256**) and it is the current item below. Session notes:
**`docs/reviews/delegate-notes-2026-10-29-hygiene-and-transport.md`** and **`docs/reviews/delegate-notes-2026-10-29-verifier-serving-and-calibration.md`**;
durable: **D164**, **D165**, **D166**. **Prior sessions, one line each:**
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
the queue drains" **still has no definition anywhere in the tree** (ROADMAP **231**). **Inbox holds 4 intents** (`selfdev.sqlite.broker.inbox/`): the stranded `delegate-routing-fact-20261028-2150` plus
`hygiene-rehearsal-20261029`, `verifier-merge-20261029`, `release-brief-20261028` — all addressed to **`pm`**.
**Read `docs/reviews/roadmap256-rehearsal-prompt-2026-10-29.md` before decomposing item 1** — it carries the rehearsal
brief (the defect slice, the audit instrument, the verdict file), the settled ordering, what is already measured, and the
trap (answer with a gate, not a date). **The verifier half of that plan is now measured, not assumed (D166):** both local
candidates fail in opposite directions — **flint Q4_K_M** answered **5/24** cells, the truncations a **runaway loop**, and **I
retract** its clean-side alarm rate as mostly **my excerpt** (its one scorable defect cell was a HIT with the right mechanism);
**ministral Q6_K** answered **24/24** in ≤15.7 s but committed `VERDICT: DEFECT` on **0/16 clean controls**, with a
reversed-order control ruling out a wording artifact — **measured and rejected**, and routing it would clear `single-model-rig`
while making verification worse, the exact failure **D137** exists to prevent. Instrument gaps registered: **257**
(denominators), **259** (no system message ⇒ the host's *"think as long as you want"* default; a declared context the server does
not offer is accepted; `TRUNCATED-EMPTY` conflates "budget too small" with "generation degenerated"). **History:**
`docs/NEXT-ARCHIVE.md` (this session's own superseded pointer is cut there verbatim).
**Next command (delegate, read-only first, in this order, ~12 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # §1–§8: links, seat capability (217), provider era (226), clock posture (234)
node tools/broker-serve.mjs --status    # broker + the 4 spooled intents; do NOT start the channel before the rehearsal (D156/D157 + 256)
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # FAILING today: verification-without-evidence ×1 (435 items), duplicate-item ×54, citation-unresolvable ×5, evidence-tree ×1. single-model-rig PASSES — a string comparison, not certification (D137)
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit           # the seed for 256's instrument; heed docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244 — `reapable: 0` is not a verdict
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 452 on 2026-10-29, dated 10-14→10-21; read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc` here
# verifier chain (ministral Q6_K served at ctx 8,192; flint UNLOADED, Q4_K_M on disk, Q6/Q8 set aside at ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/set-aside-flint-q6-q8/ — restore = mv back):
curl -s --max-time 15 http://127.0.0.1:1234/api/v1/models | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).models)console.log(m.key,m.variants.join(" "),m.loaded_instances.map(i=>i.id+"@"+i.config.context_length).join(","))})'
ps -eo args | grep '[l]lama-server' | tr ' ' '\n' | grep -E '^--(model|ctx-size|parallel|n-gpu-layers)' -A1 | tr '\n' ' '   # the ONLY surface naming variant + ctx + parallel — the API key never tells you
free -g | awk 'NR==2{print "available GiB:",$7}'; swapon --show; nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader   # PROBE PRE-FLIGHT, mandatory: my arms helped OOM-kill strata (the seats' server) on 2026-10-29; do not start an arm under 10 GiB available or >50% swap
node .spike/gate/verdict-line-score.mjs .spike/gate/ministral-q6-decl.json   # the two axes kept apart: committed verdict vs mechanism credit (257)
# verifier ARMS ARE BLOCKED on the operator's ruling (below): flint is UNLOADED, and a whole-module arm needs ctx >= 24k at --parallel 1 (whole modules here are 1,686-22,014 est. tokens — my earlier "58,380 for H4" misread the pair-accounting CHARS column)
```

**Blocker:** three, and the first is the operator's own condition. **(a) No hygiene evidence** — 256's instrument does not
exist, no rehearsal has run, and the rehearsal cannot run before **217** (no spawnable shell ⇒ a seat cannot run `git` or the
suite) nor safely before **232** (unscoped `pruneWorktrees`, `src/broker.mjs:1167`/`src/worktree.mjs:649`); releases stay
`pm`'s verb, the start stays the operator's. **(b) Verifier certification has no working instrument behind it, and both local
candidates are measured (D166)** — the cheapest remaining lever is a **corrected flint re-run** (a bounding system message in the
gate's own `SYSTEM` constant, which no run ever varied; declaration-header or whole-module feeding; window-aware artifact
excusal), but flint is **unloaded** and whole-module feeding needs ctx ≥ 24k, so it is the operator's call — until then **253**'s
evidence clause cannot be met locally and `single-model-rig` passing is a string comparison (**D137**). **(c) The queue has
nothing claimable**, `pm` has only just received the rows, and the still-owed rulings are **221** seat-root and **231** "the queue
drains". **Granted 2026-10-28 (D158):** `--depth 1` competitor clones (5 taken, `vendor-pins --check` PASS at 14 clones);
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
**Verifier (D163 + D166, re-measured 2026-10-29):** the rig's predicate is **name/role text** — `VERIFIER_TERMS =
["verif","qa","review","editor"]` (`src/verifierrole.mjs:22`) — so of the five seats on the second provider only **`qa` and
`qa2` count as verifiers**, and **no code enforces family separation**: `single-model-rig` is an exact-string test on resolved
models (`src/checkup.mjs:591-598`; "different family" is its *remedy text*). **Served verifier now
`mistralai/ministral-3-14b-reasoning` Q6_K — `--ctx-size 8192 --parallel 4 --n-gpu-layers 999999 --flash-attn on`, 23.0/24.5
GiB on GPU1, 31.6 tok/s**; flint **unloaded** (Q4_K_M on disk, Q6/Q8 set aside — path in the next-command block). **Both config
surfaces were mis-set and both are corrected:** `durig.config.json` named the unloaded flint and declared `_CONTEXT 65536`/
`_MAX_TOKENS 8192` against an 8,192-token server, and `rig.selfdev.json` still pointed five seats at `verifier/recursivesi/flint`
— **`demo/local-model-pointer.test.mjs` was RED until they agreed; run it after ANY model change.** Now `ministral… / 8192 /
3000` plus `verifier/mistralai/ministral-3-14b-reasoning` ×5 (**259**). **Even corrected, 8,192 cannot hold a real verifier
conversation:** verifier prompts run p50 **55,538** (`qa`) / **108,435** (`advocate`) — ~7× too small, **208** is the fix.
**Seat capability (217):** seat tools are `read write edit powershell prepare_workspace seat_root`; `pwsh`/`powershell` absent here, `bash` present and unregistered. **Unsettled submissions:** 9 `placed` + 2 `queued` → 9 of 12 seats count ADVANCING.
**Worktrees:** **1 (this checkout, `main`)**; branches 2; `refs/rescued/*` **484** — the **452** orphan commits (dated
10-14→10-21) were anchored under GRANT 3 on 2026-10-29, so `git fsck --unreachable | grep -c '^unreachable commit'` is now
**0**; the Windows source clone `/mnt/d/Git/Durian-Pi` is **not mounted** (`/mnt` empty), so those refs are their only anchor —
reversible per ref with `update-ref -d`, and **232 stays gated**. Pi seat-agent state is host-local and absent here, so a seat
worktree here is **created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb
`docs/runbooks/workspace-move.md` gates; inventory diffed clean across today's writes
(`.spike/{pre,post}-writing-inventory-2026-10-29.txt`).
**Box:** 94 GB RAM, ~20 GB available at clock-in, **zram swap 8/8 full later in the session**; **two GPUs** — GPU0 **RTX A4000
16,376 MiB** (`strata-host`, the seats) and GPU1 **RTX 3090 24,576 MiB** (the verifier) — so an "it fits in VRAM" claim must name
the card, and **the binding ceiling is swap, not VRAM** (hence the probe pre-flight above). The `flint` catalog resolves to one
variant (`@q4_k_m`) only while Q6/Q8 are set aside.

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb** the ledger went **36 → 1**, and eight instruments read or run earlier in it are
**gone from disk and from `git ls-files`** — never committed, so `git status` shows no deletion. The ledger half is named in the
product (`src/broker.mjs:1167` → `pruneWorktrees`, `src/worktree.mjs:649`); the file-loss half is **unexplained**, and the same
end state is recorded twice before (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`). Until 232/233 land **do not
run the suite from this checkout** — run it in the disposable clone — and remember `.scratch/` is **not** gitignored (only
`.spike/` is, line 21), so an instrument left there is one `git add` from safety and one sweep from loss (**233**).

## OPERATOR GRANTS (six; accepted 2026-10-29T05:0xZ — **execute these, do not re-ask**; durable record: **D165**)

1. **221 seat-root — ruling A is the ruling.** The persisted per-seat root becomes the workspace-root-relative name;
   `up --root` once per seat; **no migration code**. Implementation is the team's (failing-first demo, `src/`); the delegate's
   part is to spool the ruling to `pm` and hold the line that `up --root` alone does not clear the persisted value
   (`classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` prints **`main-worktree`** on Linux, so this is not inert).
2. **"The queue drains" — predicate granted:** *every released row reaches a terminal state within one resident-broker day*
   (the 314–741 items/day regime), **and** *no `held` row older than **7 days** survives a `pm` pass without being released
   or explicitly cancelled*. 231 is the product half: a `check` rule plus a surface that prints it. **#725/#726/#727 stay
   `held`** until the predicate exists and `pm` releases them — releases are `pm`'s verb.
3. **Mint the refs — GRANTED AND DONE (2026-10-29, D166).** 452 → **0** unreachable commits; `refs/rescued` 32 → **484**;
   each ref resolves; removal is one `git update-ref -d` each. The commands, kept for re-measurement:
   ```bash
   git fsck --unreachable 2>/dev/null | awk '$1=="unreachable"&&$2=="commit"{print $3}' | wc -l   # 452 before, 0 after
   git for-each-ref refs/rescued | wc -l        # 484
   git for-each-ref --format='%(refname:short) %(subject)' 'refs/rescued/orphan-*' | head   # spot-check they resolve
   ```
   **232 itself stays gated** on the 241 design note: nobody touches `src/worktree.mjs:649` / `src/broker.mjs:1167`, and no
   suite runs from this checkout while it is open.
4. **233 instrument hygiene — GRANTED, PARTLY DONE (2026-10-29).** The transport shim **landed** at
   `tools/model-probes/no-headers-timeout-shim.mjs` (labelled a shim; **254** replaces it properly) and `.scratch/` is now
   **gitignored** (38 files were sitting one sweep from loss). **Still the team's:** the two other cited-but-untracked
   files — `.scratch/transcript-write-bodies.mjs`, `.spike/extract-pi-src.mjs` — re-create them or amend the rows that cite
   them; `node tools/instrument-provenance.mjs --db ./selfdev.sqlite` prints that list under **UNTRACKED BUT CITED**.
5. **Verifier — GRANTED (D165), amended by measurement (D166): both local candidates are measured and rejected.** The granted
   **`--whole-module` mutant run** needs flint **re-loaded at ctx ≥ 24k, `--parallel 1`** (it is unloaded; whole modules here are
   1,686–22,014 est. tokens — my "58,380" misread the pair-accounting **CHARS** column), so it waits on the ruling below; **do
   not re-run the finished fragment run.** **The 3090 is not the constraint — D137's cross-family rule is:** the seats run
   **`Qwen3.8-Flash-Next IQ3_S`** (strata-host `:47831`, GPU0), so the obvious fast one-card models (**Qwen3 / Qwen3-Coder MoE**)
   are the seats' own family and would certify a verifier sharing their blind spots. LM Studio's whole chat inventory is flint
   `@q4_k_m` (unloaded) + ministral (measured, rejected) + an embedder, so a real choice needs a download grant — candidates
   priced in `docs/runbooks/verifier-model-server.md` (**`gpt-oss-20b`** ~13 GB, **`mistral-small-3.x-24b`** ~14 GB,
   **`gemma-3-27b`** ~17 GB), each getting a k=1 gate run before adoption, never before. **258** covers the cheaper
   output-contract lever; **259** says a bounding system message is a host-level necessity, not an option.
6. **Start decomposition, not seats; the hygiene threshold is accepted as proposed.** The channel stays down; `pm` decomposes
   217/232/233/235–259 on next start. Scale gate: **hard dimensions zero** (no leaked worktree, no stray seat, no branch
   unmerged while its item reads `done`) **over the bounded 2-seat rehearsal, ≤2 soft violations per seat-run**, then 5, then 12.

## OPERATOR OWES (one item, 2026-10-29 — everything else above is granted)

**Which verifier, now that both local candidates are measured and rejected (D166).** The options, with costs named: **(A)** pay
for a **remote cross-family verifier** — the only option satisfying **253** today, needs a funded key, price it before buying;
**(B)** fund the **corrected local flint re-run** — flint re-loaded (Q4_K_M is on disk) at **ctx ≥ 24k, `--parallel 1`**, then
one arm with a bounding system message + declaration header + window-aware excusal (~40 min of GPU, no money): flint was the
**better-calibrated** of the two, so this is the highest-value cheap lever; **(C)** accept that verification stays uncertified
and `single-model-rig` stays **red as an honest finding** (D137's posture) — which means **253**'s evidence clause cannot be met
and items cannot reach `done` under it. **Recommendation: (B) first (free, ~40 min), then (A). Do not route ministral** — fast
+ wrong on 16/16 clean controls would clear `single-model-rig` while making verification worse.

## Do not "fix" these on the strength of the docs

**A probe that sends no system message is measuring the HOST, not the model** — this LM Studio injects *"think… as long as you
want"* when none is sent (arms A–D in the notes; retained body `.spike/gate/ministral-probe.json`: 600/600 tokens, 599
reasoning, `content=0ch`; a bounding system message → 1.9 s / 62 tokens / correct; four reasoning toggles do nothing) (**259**).
**A model that answers quickly is not verifying** — ministral: 24/24 answers, 16/16 clean controls wrong. **`TRUNCATED-EMPTY`
conflates "budget too small" with "generation degenerated into a loop"**, and **a `ctx-size` you did not read from the process
table is a guess**; a declared `_CONTEXT` above the served one makes the request unsatisfiable (**259**). **Never start a probe
arm without printing available RAM, swap used and per-GPU MiB** — my arms helped OOM-kill the seats' server on 2026-10-29.
**`fetch failed` from a probe is a transport ceiling, not a dead model or an out-of-RAM box** — compute
`budget_tok ÷ measured_tok_per_s` against 300 s (probes) and 600 s (the rig's SDK) and print `err.cause` (**254**, D164).
**`1/1 scored` is not a capability rate** — in the completed run 19 of 24 prompts never reached `finish=stop`, so the
flattering denominator is an artifact of the print, not a result (**257**). **A control-side `FALSE-ALARM` may be our
feeding, not the model** — **three of flint's four** claimed missing imports on a fragment whose import block my window had
cut off; **195**'s excuser saw the class and excused 0. **Decode is not a constant**: 42.21 tok/s isolated vs **21.8–48.9 tok/s
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
