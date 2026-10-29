# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T20:1xZ = **2026-10-29 15:1x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here
is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1, **Linux**. Delegate
session, operator-approved continuation; the superseded 199-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md`.
**The headline is structural, not another measurement: the restart condition is a CLOSED loop (D169).** Hygiene evidence
needs **217**; 217 is seat work that needs a woken seat; `tools/broker-serve.mjs --dry-run` refuses the wake *because*
217 has not landed (`BLOCK seat-shell-availability`); and **62 of 63 registered ROADMAP items ≥ 200 are named by no
queue row** — new instrument `tools/roadmap-queue-coverage.mjs`, 0.9 s — so no seat can pick it up. **Two** asks are owed
below (the verifier choice, and one bounded decomposition wake); everything else is **granted — execute, do not re-ask**
(**D165**). **Executed this session (GRANT 4's remaining half):** `tools/transcript-recovery.mjs` and
`tools/extract-pi-src.mjs` are now tracked instruments (re-verified: 83 pi sources; recovered `bash.ts` lines **168/169**
match 217's citations); the owed **`docs/runbooks/hygiene-and-dead-model-pointers.md`** landed; and the runbook index was
repaired (one row had been **merged into its neighbour**, losing its link; 4 duplicate rows collapsed). Durable:
**D164**–**D169**. Notes: **`docs/reviews/delegate-notes-2026-10-29-hygiene-runbook-promotions-and-coverage.md`**.
**Prior sessions:** doc-hygiene guard + **262** (D168) · memory safety + **260/261** (D167) · both local verifier
candidates measured and REJECTED, GRANT 3 done (D166) · flint verifier flip + **253** (D163) · round-4 research gate +
**250/251** · `tools/review-cite-check.mjs` + **252** (D162). **Committed, not pushed — read `git log --oneline -3`, never
shas quoted in a pointer.** Read me first; do not re-derive the priority from the ~5,300-line roadmap. This file is a
**pointer, capped at 200 lines (so `wc -l` ≤ 199)** by `demo/next-pointer.test.mjs`, which also requires the
`## NEXT SESSION` block to carry a current item, a queue id, a `node cli.mjs` command and a line starting
`**Blocker:**` — **rewrite it in place, do not restyle it.** Its two executable readers are `demo/next-pointer.test.mjs`
and `demo/clockin-digest.test.mjs` (the digest reads only this section, so the **`NEXT-ARCHIVE.md` link must stay inside
the pointer body**). After editing: `node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs &&
node tools/doc-integrity-guard.mjs` — the third verb (**262**) hard-fails on a cited `**NNN**` with no registration behind
it, an index row naming a runbook that was never written, and a runbook with no front matter.

## NEXT SESSION

**Current item: get ONE ruling, not more spool.** The operator's restart condition (2026-10-29) is: the team restarts
**iff** seats are hygienic about their seat-personal workspace, git branches, git worktrees, and merging to `main` after
review — registered as **ROADMAP 256**. Today every link in that chain is measured, and the chain **closes on itself**
(**D169**, `docs/reviews/delegate-notes-2026-10-29-hygiene-runbook-promotions-and-coverage.md`):

1. 256's instrument is `git` (`worktree audit`, ancestry-of-`main`, branch retirement) — **and no seat has ever run
   `git` on this host**: `entries` shows `"toolName":"bash"` **0**, `"toolName":"powershell"` **20,340** (Windows era),
   `pwsh` **0**; spawn errors `powershell ENOENT` **3** + `pwsh ENOENT` **1**, newest **#274090** (`devtools`) reasoning
   *"PowerShell is not available? … Maybe the shell is pwsh on Linux?"*. So seat hygiene today is **unmeasured**, not
   good — see `docs/runbooks/hygiene-and-dead-model-pointers.md` (landed this session).
2. The fix is **217** (`src/seattools.mjs` registers `shell: createPowerShellTool()`; pi's default program list is
   `["pwsh","powershell"]`; neither exists here, `/usr/bin/bash` is present and unregistered). That is **seat** work,
   and `demo/seattools.test.mjs:30` asserts the current choice — a failing-first rewrite, not a hand-patch.
3. Rows for it exist only if `pm` decomposes. `tools/roadmap-queue-coverage.mjs --min 235` → **4,821 rows / CLAIMABLE 0**,
   **27 of 28** items ≥ 235 named by **no** row; of 63 items ≥ 200, **62** are unrowed and 253's only two rows
   (`#1146`, `#1149`) are `done`.
4. `pm` thinks only when woken, and the rig's own preflight refuses the start for the 217 reason. **Five** intents sit in
   `selfdev.sqlite.broker.inbox/` waiting **65–1,398 min** (re-measured 20:1xZ).

**The ask (§OPERATOR OWES 1) is one bounded, coordinator-scoped wake:** deliver the spooled intents, let `pm` create rows
for 217/232/233/235–262, stop. `pm` has **no** `write`/`edit` and needs no shell, so the block guards an act that runs no
command; it creates no artifact, so nothing can reach `done` and no verifier is implicated. Cost: one `local/iq3_s` turn
(the last logged broker pass was **10 ms**; resident-broker days land **314–741** items/day,
`docs/reviews/wallclock-budget-2026-10-28.md`). Guarantees that stay OFF: 253's evidence clause, the 256 rehearsal, 217's
shell; releases stay `pm`'s verb, the start stays the operator's. **Queue ids unchanged: #725** (impl, ROADMAP 63),
**#726** (devtools, 64), **#727** (qa, 67) — all `held`, all three orphan-candidates (#662/#710 both `done`), still
**held** until 231's granted predicate exists and `pm` releases them. **Read
`docs/reviews/roadmap256-rehearsal-prompt-2026-10-29.md` before decomposing item 1** (the rehearsal brief, the settled
ordering **217 → 232 → audit → 2-seat rehearsal → operator threshold**, and the trap: answer "when" with a gate, not a
date).

**Blocker:** four, and none is mine to lift. **(a)** the closed loop above — it needs the operator's ruling, and
spooling is not a wake; **(b)** verifier certification has no working instrument behind it and **both local candidates are
measured and rejected** (D166), while `node tools/model-probes/probe-preflight.mjs` **exits 1** today (swap 76 %), so no
arm may start and OWES 2 is untouched; **(c)** 0 claimable rows, `pm` has only just received the intents, and the still
unwritten rulings are **221** seat-root (A granted, implementation owed) and **231** "the queue drains" (predicate granted,
surface owed); **(d)** 217/232/233/235–262 still have **no queue rows** (the coverage instrument prints the list).

**Older sessions are verbatim in [NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — this session's cut sits at archive lines 7489–7687.

**Next command (delegate, read-only first, in this order, ~15 s total):**

```bash
node tools/roadmap-queue-coverage.mjs --min 235    # NEW (0.9s, one queue read): rows, CLAIMABLE 0, which items have NO row. Prints its denominator.
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # §1–§8: links, seat capability (217), provider era (226), clock posture (234)
node tools/broker-serve.mjs --status ; node tools/broker-serve.mjs --dry-run   # broker DOWN (pid gone, heartbeat 97,242 s stale), 5 spooled intents; after this session's commit exactly 1 BLOCK remains (seat-shell-availability) — live-tree-dirty was MY uncommitted edits; do NOT start the channel before the rehearsal (D156/D157 + 256)
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # 61 findings: verification-without-evidence ×1, duplicate-item ×54, citation-unresolvable ×5, evidence-tree ×1. single-model-rig PASSES — a string comparison, not certification (D137)
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit           # 1 worktree, `reapable: 0` is NOT a verdict (docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244); heed docs/runbooks/hygiene-and-dead-model-pointers.md
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 0 (GRANT 3 held); refs/rescued 484 — read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc` here
node demo/local-model-pointer.test.mjs             # PASS today; run it after ANY model change (261's offline half)
node tools/model-probes/probe-preflight.mjs        # PROBE PRE-FLIGHT, mandatory before any prompt — exit 1 = do not start an arm (today: swap 6.1/8.0 GiB = 76 %, GPU1 1,563 MiB free, strata 51 GiB RSS / 40.7 shmem)
#   any arm that IS allowed: node tools/model-probes/capped-run.mjs --node-mem-max 6G -- <cmd>  (MemorySwapMax=0; a `run-<digits>.scope` kill = the cap worked; an `app-…appimage` / `strata` / `llama-server` kill = an incident). Verifier chain: ministral Q6_K served @8192; flint UNLOADED, Q4_K_M on disk, Q6/Q8 set aside at ~/.var/app/ai.lmstudio.lm-studio/.lmstudio/set-aside-flint-q6-q8/ (restore = mv back)
curl -s --max-time 15 http://127.0.0.1:1234/api/v1/models | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).models)console.log(m.key,m.variants.join(" "),m.loaded_instances.map(i=>i.id+"@"+i.config.context_length).join(",")||"NOT LOADED")})'
ps -eo args | grep '[l]lama-server' | tr ' ' '\n' | grep -E '^--(model|ctx-size|parallel|n-gpu-layers)' -A1 | tr '\n' ' '   # the ONLY surface naming variant + ctx + parallel — the API key never tells you
node tools/transcript-recovery.mjs ~/.pi/agent/sessions/--home-chexxor-Git-Durian-Pi-- <basename> [--out <dir>] ; node tools/extract-pi-src.mjs node_modules/@earendil-works/pi-durable .spike/pi-src   # NEW tracked instruments: recover a lost file's BODY (writes only with --out; label the result "re-created", 239) and pi's real TypeScript (83 files) so pi citations carry real line numbers
node tools/instrument-provenance.mjs --db ./selfdev.sqlite    # UNTRACKED BUT CITED — stage a promoted tool BEFORE re-running it, or it counts your own new file as untracked
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs   # the clock-out trio, always all three
```

## Rig state, re-measured at clock-out 2026-10-29T20:1xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite`: `entries` **137,427** rows, **12** seats. **Queue census 4,821 = 3,748 `done` / 777
`cancelled` / 277 `held` / 19 `deferred` → 0 claimable.** Per-seat parked (held/deferred): impl 164/13 · scribe 44 ·
devtools 33/2 · qa 21 · security 6 · lead 4/1 · pm 3/2 · auditor 2 · qa2 0/1 · advocate/designer/architect `no-work`.
**Coverage (new):** 62 of 63 registered items ≥ 200 have **no row naming them**; 253's two rows are `done`. **Providers
(era-attributed, 226/229):** every failure in the last-30-submission window is `deepinfra`-era; the current `local/iq3_s`
era has none, and the `402`s in recent rows are history. **Verifier (D163 + D166):** the rig's predicate is name/role text (`VERIFIER_TERMS = ["verif","qa","review","editor"]`, `src/verifierrole.mjs:22`), so of the
five second-provider seats only **`qa` and `qa2`** count as verifiers, and **no code enforces family separation**
(`single-model-rig` is an exact-string test, `src/checkup.mjs:591-598`). Served verifier **`mistralai/ministral-3-14b-
reasoning` Q6_K, `--ctx-size 8192 --parallel 4 --n-gpu-layers 999999`**, GPU1 23,013/24,576 MiB; **flint NOT LOADED**
(catalog `@q4_k_m` only, Q6/Q8 set aside). `demo/local-model-pointer.test.mjs` **PASS**; **even corrected, 8,192 cannot
hold a real verifier conversation** — verifier prompts run p50 **55,538** (`qa`) / **108,435** (`advocate`); **208** is the fix. **Seat capability (217):** tools are `read write edit powershell prepare_workspace seat_root`; `pwsh`/
`powershell` absent here, `bash` present and unregistered; `seatguard`'s `SHELL_TOOLS` already whitelists **both** names
(`src/seatguard.mjs:122`) — that is the guard's set, **not** a registered tool. **Unsettled submissions:** 9 `placed` +
2 `queued`. **Worktrees:** 1 (this checkout, `main`); branches 2; `refs/rescued/*` **484**; unreachable commits **0**.
Pi seat-agent state is host-local and absent here, so a seat worktree here is **created, not migrated** — the first
`up`/`worktree`/`run`/`send` is the writing verb `docs/runbooks/workspace-move.md` gates; inventory
`.spike/{pre,post}-writing-inventory-2026-10-29.txt`. **Box:** 94 GB RAM, **24.4 GiB available**, **zram swap 6.1/8.0 GiB
(76 %)** — swap, not VRAM, is the ceiling; **GPU0 RTX A4000 12,648/16,376 MiB** (`strata-host`, the seats, 51 GiB RSS /
40.7 GiB shmem), **GPU1 RTX 3090 23,013/24,576 MiB** (the verifier). An "it fits in VRAM" claim must name the card.

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb** the ledger went **36 → 1**, and eight instruments read or run earlier in it are
**gone from disk and from `git ls-files`** — never committed, so `git status` shows no deletion. The ledger half is named
in the product (`src/broker.mjs:1167` → `pruneWorktrees`, `src/worktree.mjs:649`); the file-loss half is **unexplained**
and recorded twice before (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`). Until 232/233 land **do not
run the suite from this checkout** (use the disposable clone), and remember both scratch directories are gitignored:
anything that must survive belongs in `tools/` — hence `tools/transcript-recovery.mjs`, `tools/extract-pi-src.mjs`.

## OPERATOR GRANTS (six; accepted 2026-10-29T05:0xZ — **execute these, do not re-ask**; durable record: **D165**)

1. **221 seat-root — ruling A is the ruling.** The persisted per-seat root becomes the workspace-root-relative name;
   `up --root` once per seat; **no migration code**. Implementation is the team's (failing-first demo, `src/`); the
   delegate spools the ruling and holds the line that `up --root` alone does not clear the persisted value —
   `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` prints **`main-worktree`** on Linux, so this is not inert.
2. **"The queue drains" — predicate granted:** *every released row reaches a terminal state within one resident-broker
   day* (the 314–741 items/day regime), **and** *no `held` row older than **7 days** survives a `pm` pass without being
   released or explicitly cancelled*. 231 is the product half: a `check` rule plus a surface that prints it.
   **#725/#726/#727 stay `held`** until that predicate exists and `pm` releases them — releases are `pm`'s verb.
3. **Mint the refs — GRANTED AND DONE.** 452 → **0** unreachable commits; `refs/rescued` 32 → **484**; re-measure with
   `git fsck --unreachable … | grep -c '^unreachable commit'` (0) and `git for-each-ref refs/rescued | wc -l` (484);
   reversible per ref with `update-ref -d`. **232 itself stays gated** on the 241 design note: nobody touches
   `src/worktree.mjs:649` / `src/broker.mjs:1167`, and no suite runs from this checkout while it is open.
4. **233 instrument hygiene — GRANTED, NOW LARGELY DONE.** The transport shim landed at
   `tools/model-probes/no-headers-timeout-shim.mjs` (a labelled shim; **254** replaces it properly); `.scratch/` is
   gitignored; and **this session** promoted the two remaining cited instruments to `tools/transcript-recovery.mjs` (239's
   named target; prints without writing unless `--out`) and `tools/extract-pi-src.mjs`, then amended 239/254 to cite
   tracked paths only. Still the team's if it wants them: the read-body extractor and the 233 witness remain scratch.
   **262**'s product half (the `check`/`doctor` wiring, and a shape check on the runbook index table) is open.
5. **Verifier — GRANTED (D165), amended by measurement (D166): both local candidates are measured and rejected.** The
   granted **`--whole-module` mutant run** needs flint **re-loaded at ctx ≥ 24k, `--parallel 1`** (whole modules here are
   1,686–22,014 est. tokens — the earlier "58,380" misread the pair-accounting **CHARS** column), so it waits on OWES 2;
   **do not re-run the finished fragment run.** **The 3090 is not the constraint — D137's cross-family rule is:** the seats
   run **`Qwen3.8-Flash-Next IQ3_S`** (strata-host `:47831`, GPU0), so Qwen3 / Qwen3-Coder MoE are the seats' own family.
   LM Studio's whole chat inventory is flint `@q4_k_m` (unloaded) + ministral (measured, rejected) + an embedder, so a real
   choice needs a **download grant** — priced in `docs/runbooks/verifier-model-server.md` (`gpt-oss-20b` ~13 GB,
   `mistral-small-3.x-24b` ~14 GB, `gemma-3-27b` ~17 GB), each getting a k=1 gate run **before** adoption, never after.
   **258** = the output-contract lever; **259** = a bounding system message is a host-level necessity.
6. **Start decomposition, not seats; the hygiene threshold is accepted as proposed.** The channel **stays down**, and `pm`
   decomposes 217/232/233/235–262 **on next start** — decomposition is granted, a start is not, and the 217 block refuses
   every start: that gap is exactly OWES 1. Scale gate: **hard dimensions zero** (no leaked worktree, no stray seat, no
   branch unmerged while its item reads `done`) **over the bounded 2-seat rehearsal, ≤2 soft violations per seat-run**,
   then 5, then 12.

## OPERATOR OWES (two items, 2026-10-29 — everything else above is granted)

1. **One bounded, coordinator-scoped wake (NEW — the head blocker).** Answer **yes, with the envelope**: deliver the 5
   spooled intents, `pm` creates rows for 217/232/233/235–262, then the channel stops. Or **no** — in which case 256 can
   never produce evidence, and the honest answer to "when can we have them?" is "not yet, by construction". Why this is not
   a bypass: `seat-shell-availability` blocks "a broker whose seats cannot run a single command", and `pm` is a coordinator
   with **no `write`/`edit` and no shell need** — decomposition runs no command and lands no artifact. Mechanism if
   granted: `cp selfdev.sqlite .spike/store-backup-$(date +%Y%m%d-%H%M%S).sqlite`, then
   `node tools/broker-serve.mjs --start --yes-pm-wakes` (the only flag set that acknowledges delivery), watch one pass,
   `serve --stop`, and confirm `stopped:true` (a stale stop request survives a kill — `runbooks/broker-safe-change.md`).
2. **Which verifier, now that both local candidates are measured and rejected (D166).** **(A)** pay for a **remote
   cross-family verifier** — the only option satisfying **253** today; needs a funded key, price it before buying.
   **(B)** fund the **corrected local flint re-run** — flint re-loaded (Q4_K_M on disk) at **ctx ≥ 24k, `--parallel 1`**,
   one arm with a bounding system message + declaration header + window-aware excusal (~40 min of GPU, no money): still the
   highest-value cheap lever, **but the box refuses today** (probe pre-flight exits 1 at swap **76 %**, GPU1 has 1,563 MiB
   free behind ministral, `strata-host` holds 51 GiB RSS), so it needs ministral unloaded *and* `capped-run.mjs`, or a lower
   seat-server window (the operator's call, 260). **(C)** accept that verification stays uncertified and `single-model-rig`
   stays **red as an honest finding** (D137) — which means **253**'s evidence clause cannot be met. **Recommendation: (B)
   then (A). Do not route ministral** — fast + wrong on 16/16 clean controls would clear `single-model-rig` while making
   verification worse.

## Do not "fix" these on the strength of the docs

**A `BLOCK seat-shell-availability` is not advice to start anyway** — and it is not proof the *whole* start is unsafe
(`pm` needs no shell): name the exception, do not bypass the guard. **Seat hygiene is currently UNMEASURED**, not good —
**20,340** `powershell` calls are the Windows era and **0** `bash` rows mean no seat has ever run `git` here. **A
`documents.kind` value is JSON-quoted** (`WHERE kind='durig.queue'` returns nothing) **and the queue payload lives in
`document_revisions` deltas** — read queue state through `cli.mjs queue` / `tools/roadmap-queue-coverage.mjs`, never a
hand-rolled query. **`--dry-run`'s finding count moves for real reasons** (provider-probe transience; `live-tree-dirty`
while the delegate's own edits are uncommitted) — **re-run before reporting**, and **it never names a removal**. **A model key
does not identify a model** — verify the live `.gguf` with `ps -eo args | grep llama-server`, and **an `ctx-size` you never
read off the process table is a guess**. **A probe that sends no system message measures the HOST, not the model** (**259**).
**A model that answers quickly is not verifying** — ministral 24/24 answers, 16/16 clean controls wrong.
**`TRUNCATED-EMPTY` conflates "budget too small" with "generation degenerated"**. **Never start a probe arm
without printing available RAM, swap used and per-GPU MiB** — my arms helped OOM-kill the seats' server. **`fetch failed`
from a probe is a transport ceiling, not a dead model** — compute `budget_tok ÷ tok/s` against 300 s (probes) / 600 s (the
SDK) and print `err.cause` (**254**). **`1/1 scored` is not a capability rate** (**257**). **A control-side `FALSE-ALARM` may
be our feeding, not the model** (**195**). **Decode is not a constant** (42.2 tok/s isolated vs 21.8–48.9 in-run) — budget off
the low end, and **a speed claim is a claim about a quantization** (**255**). **An unreachable commit is somebody's work.** **A `single-model-rig` PASS is not certification** (**D137**). **`reapable: 0` is
not a verdict**, and **a swept worktree ledger is not "self-healing"** (`src/broker.mjs:1167`). **A suite that runs green
after files vanished is not green** (`scripts/suite.mjs:36`). **A `402` in a recent row is not current provider state**, and
**`queued` (submissions) ≠ `queued` (claimable items)**. **An orphan-candidate verdict is not a release recommendation**
(#725/#726/#727 are *correctly* held). **A promoted instrument is "cited but untracked" until you stage it.** **Never quote shas.**
