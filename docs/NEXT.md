# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T07:2xZ = **2026-10-29 02:2x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1, **Linux**. Delegate session, operator-approved continuation. **This session corrected a cause this pointer asserted wrongly.** The gate's
`REQUEST FAILED fetch failed` rows are **Node's 300 s undici `headersTimeout`**, not memory pressure: `gate.mjs:96` calls
non-streaming `fetch` and llama-server sends headers only when generation finishes. Matched pair, same body
(`.spike/gate/timeout-hypothesis.out`): fetch → **300.8 s, cause `HeadersTimeoutError` [`UND_ERR_HEADERS_TIMEOUT`]**;
`node:http` + `req.setTimeout(0)` → **200 in 372.0 s**. Registered as **254**. **The seeded-bug gate has still never completed**
(see NEXT SESSION). Three intents were **spooled to `pm`** under the 2026-10-28 spool ask (now discharged); **254/255/256**
registered; runbook `docs/runbooks/cross-clone-object-recovery.md` landed (+ 2 index rows, so the owed Edit B is
**discharged**); `docs/runbooks/verifier-model-server.md` corrected and extended. The operator set a **new restart
condition** (seat hygiene — **256**) and it is the current item below. Session notes:
**`docs/reviews/delegate-notes-2026-10-29-hygiene-and-transport.md`**; durable: **D164**. **Prior sessions, one line each:**
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
trap (answer with a gate, not a date). **History:** `docs/NEXT-ARCHIVE.md` (this session's own superseded pointer is cut there verbatim).
**Next command (delegate, read-only first, in this order, ~12 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # §1–§8: links, seat capability (217), provider era (226), clock posture (234)
node tools/broker-serve.mjs --status    # broker + the 4 spooled intents; do NOT start the channel before the rehearsal (D156/D157 + 256)
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # FAILING today: verification-without-evidence ×1 (435 items), duplicate-item ×54, citation-unresolvable ×5, evidence-tree ×1. single-model-rig PASSES — a string comparison, not certification (D137)
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit           # the seed for 256's instrument; heed docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244 — `reapable: 0` is not a verdict
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 452 on 2026-10-29, dated 10-14→10-21; read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc` here
# verifier chain (server holds flint Q6 at 65,536; a Q4_K_M sits on disk unactivated):
curl -s --max-time 15 http://127.0.0.1:1234/api/v1/models | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).models)console.log(m.key,m.variants.join(" "),m.loaded_instances.map(i=>i.id+"@"+i.config.context_length).join(","))})'
CAL_MAX_TOKENS=6000 node --import ./.spike/gate/no-headers-timeout.mjs tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 recursivesi/flint flint-k1-out6k --replicate 1 --pair-comments strip-both --out .spike/gate/flint-k1-out6k.json   # the shim defeats the 300 s ceiling; --plan first spends nothing. Budget ~3 h at 10.75 tok/s — the verifier choice is OPERATOR OWES 5
```

**Blocker:** three, and the first is now the operator's own condition. **(a) No hygiene evidence** — 256's instrument does not
exist, no rehearsal has run, and the rehearsal cannot run before **217** (no spawnable shell → a seat cannot run `git` or the
suite) nor safely before **232** (unscoped `pruneWorktrees`, `src/broker.mjs:1167`/`src/worktree.mjs:649`); releases stay
`pm`'s verb, the start stays the operator's. **(b) The verifier is uncertified and measurably marginal**: the gate has never
completed, flint's reasoning is **unbounded** (`allowed_options: ["on"]`; `thinking:false` accepted-and-ignored; at 1,200 tok
→ **0 answer chars**, at 4,000 tok → **17,554 reasoning chars, 0 answer**), and `DURIG_VERIFIER_MAX_TOKENS 8192` at
**10.75 tok/s** = **762 s** against the provider's own **600,000 ms** request timeout (`src/config.mjs:330-344`) — **255**.
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
actually matches; `docs/SELFDEV.md` says three and is wrong) resolve to **`verifier/recursivesi/flint`**. LM Studio `:1234`
serves **Q6_K only**, loaded **65,536**, `parallel 4`, `num_experts 6`, flash attention, KV offloaded; **decode 10.75 tok/s**
(4,000 tok / 372.0 s), COLD prefill ~212 tok/s, WARM TTFT 0.23 s at 6,016 tok, and a **cold instance pays ~22 s before its
first token** (32-token reply took 25.5 s just after load). `durig.config.json` (gitignored): `DURIG_VERIFIER_MODEL
recursivesi/flint`, `_CONTEXT 65536`, `_MAX_TOKENS 8192`. Verifier prompt sizes p50 **55,538** (`qa`) / **108,435**
(`advocate`): 65,536 is a floor and **208** is the fix. `demo/local-model-pointer.test.mjs` and
`demo/second-local-provider.test.mjs` **PASS** at this config; `check`'s `single-model-rig` **passes** — a string comparison
(**D137**).
**Seat capability (217):** seat tools are `read write edit powershell prepare_workspace seat_root`; `pwsh`/`powershell` absent
here, `bash` present and unregistered. **Unsettled submissions:** 9 `placed` + 2 `queued` → 9 of 12 seats count ADVANCING.
**Worktrees:** **1 (this checkout, `main`)**; branches 2; `refs/rescued/*` **32**; **452 unreachable commits**; the Windows
source clone `/mnt/d/Git/Durian-Pi` is **not mounted** (`/mnt` empty), so those commits have one home left — **237/233
hygiene + the minting grant (OPERATOR OWES 3)**. Pi seat-agent state is host-local and absent here, so a seat worktree here is
**created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb `docs/runbooks/workspace-move.md`
gates. Inventory diffed clean across today's spool writes (`.spike/{pre,post}-writing-inventory-2026-10-29.txt`).
**Box:** 94 GB RAM, ~20 GB available, **swap 7/7 full**; `strata-host` 55 GB RSS on the 16 GB GPU, flint 18.3 GB on the 3090
(24 GB). Model server: 3 models on disk, `flint` now has **3 variants** (`@q6_k`, `@q8_0`, `@q4_k_m`).

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb** the ledger went **36 → 1**, and eight instruments read or run earlier in it are
**gone from disk and from `git ls-files`** — never committed, so `git status` shows no deletion. The ledger half is named in
the product (`src/broker.mjs:1167` → `pruneWorktrees`, `src/worktree.mjs:649`); the file-loss half is **unexplained** and the
same end state is recorded twice before (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`). Until 232/233 land:
**do not run the suite from this checkout** — run it in the disposable clone. `.scratch/` is **not** gitignored (only `.spike/`
is, line 21), so an instrument left there is one `git add` from safety and one sweep from loss (**233**).

## OPERATOR OWES (six; the team is behind them)

1. **ROADMAP 221 — the seat-root ruling** (D152 §6 + D153 addendum): seats' persisted cwd resolves to a
   `D:\Git\Durian-Pi-worktrees\<seat>`-shaped value; `up --root` does not clear it and no CLI prints it. Proposed ruling **A**:
   the persisted per-seat root becomes the workspace-root-relative name; `up --root` once per seat; no migration code. Not
   inert on Linux — `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` prints **`main-worktree`** here.
2. **The definition of "the queue drains"** inside #725/#726/#727. No threshold, predicate or surface exists, so those three
   top-ranked rows have been `held` 12 days. Neither `pm` nor the delegate can supply it (231 is the product half).
3. **A grant on ledger surgery (232) and on minting `refs/rescued/orphan-*` — now time-critical.** `pruneWorktrees` runs
   unconditionally from the broker sweep, and **452 unreachable commits dated 2026-10-14→10-21** (incl. `25008d8c` #1274,
   `5e00ee7e` #1558, `81005c62` #2111) sit in this object store anchored by **no ref**, past `gc.pruneExpire`'s 2 weeks, with
   the source clone unmounted. One `git gc` anywhere deletes them. Procedure + the ladder:
   `docs/runbooks/cross-clone-object-recovery.md`.
4. **Commit-or-discard for untracked instruments (233).** `.scratch/transcript-write-bodies.mjs` and friends are untracked and
   `.scratch/` is **not** ignored; several ROADMAP rows cite lost files as landed. Either the team re-creates them (labelled
   re-created) or those rows get amended — your scope call, not a seat's.
5. **Which verifier, and at what speed (D137 binds).** Measured options, cheapest first: **(a)** finish the gate k=1 at
   `CAL_MAX_TOKENS=6000` under the transport shim (**~3 h** at 10.75 tok/s; k=3 ≈ 9 h) and keep flint only on a pass;
   **(b)** **activate the Q4_K_M** — you must do this in the LM Studio GUI (the REST `load` body accepts no variant key:
   `variant`/`quantization`/`selected_variant` all return `Unrecognized key(s)`, and `lms load` has no quantization flag;
   `lms` only works at all with `HOME=$HOME/.var/app/ai.lmstudio.lm-studio`) — or grant the delegate to move the Q6/Q8 files
   aside; then re-measure decode, since the whole feasibility question is decode speed; **(c)** a **remote** cross-family
   verifier (money + a funded key); **(d)** start **uncertified** — cheapest, and exactly what **D137** calls worse than no
   verifier, because `check` then reports a green the rig has not earned. Not a fallback: ministral at 8,192 (0/2) or
   single-family `iq3_s`.
6. **Whether to start the channel, and the scale threshold (256).** The queue is **0 claimable**, so "start now" buys a
   started-but-idle team; the team stays **not started** until you say so. The **2 → 5 → 12** seat threshold on the hygiene
   rehearsal's violation counts is **yours and unset** — that number is what the operator's restart condition turns on.

## Do not "fix" these on the strength of the docs

**`fetch failed` from a probe is a transport ceiling, not a dead model or an out-of-RAM box** — compute
`budget_tok ÷ measured_tok_per_s` against 300 s (probes) and 600 s (the rig's SDK) and print `err.cause` (**254**, D164).
**A `TRUNCATED-EMPTY` verdict measures the output budget as much as the model** — read the run's budget and the model's
reasoning shape first; flint emits **0 answer chars** at 1,200 and at 4,000 tokens, so no budget tuning fixes it.
**An unreachable commit is somebody's work, not garbage** — `git gc` deletes it (cross-clone runbook). **A
`single-model-rig` PASS is not certification** (**D137**). **`reapable: 0` in `worktree audit` is not a verdict**
(`docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244`). **0 claimable rows means a started team idles or improvises.** **An
orphan-candidate verdict is not a release recommendation** (#725/#726/#727 are *correctly* held). **A swept worktree ledger
is not "self-healing"** (`src/broker.mjs:1167`). **A suite that runs green after files vanished is not green**
(`scripts/suite.mjs:36`). **A `402` in a recent row is not current provider state.** **A `WAKE` in the preflight's post-pass-1
column is a prediction.** **`queued` (submissions) ≠ `queued` (claimable items).** **`DURIG_MAX_CONCURRENT_SEATS` is unset in
`durig.config.json`, `"1"` in the default — read `src/config.mjs loadConfig` (D153 §4).** **A `--dry-run` names no removals.**
**Model speed is 12.7% of machine time.** **A loaded_instances entry is not a health check.** **Never quote your own shas in
a pointer.**
