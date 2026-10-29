# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T21:1xZ = **2026-10-29 16:1x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here
is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate
session; the superseded 199-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (its entry carries a paste-ready
proof diff). **Two live items now, and one is a new class.** (1) Unchanged: the restart gate is a **CLOSED loop** (D169)
and needs exactly one ruling — a bounded `pm` wake. (2) Opened by the operator this session: *make the team and its
definition cross-platform friendly, prioritising oh-my-pi's learnings.* Measured, not inferred — new gate
`tools/rig-portability-audit.mjs` (tracked; exit **1**, **15** findings, ~1 s; `--self-test` exit **0**) says **12 seats'
real root is a foreign-OS store value**, the worktree `seat-root` keep-guard is **unreachable on this host**, the registered
seat shell **does not exist on this host**, and **no seat is told what host it is on**. Registered **263–267**; **210** and
**232** amended, because as written each would have read **green**. Durable: **D164**–**D170**. Review:
`docs/reviews/cross-os-rig-portability-2026-10-29.md`; routing facts spooled to `pm` as `cross-os-portability-20261029`.
**Two remedies this repo had already written down do not work, and that is the finding:** 210's rule reads only the rig
file (the tracked layer is clean — 0 host-absolute hits — while the winning value lives in the **store**), and
`docs/DECISIONS.md:6314` grants an **`up --root` that does not exist** (`cli.mjs help` has no such flag; measured:
`up --refresh --dry-run` previews **0** cwd changes for 12 seats, exporting `DURIG_SEAT_ROOT` previews **12** — a hazard,
not a fix; see §PORTABILITY). **Against myself:** while cutting this pointer a read-modify-write **truncated
`docs/NEXT-ARCHIVE.md` in place, 7,687 → 207 lines**; `git status` caught it pre-commit and `git checkout --` restored it
byte-identical — it survived only because it is **tracked**, the 233/239 lesson demonstrated on a delegate.
**Prior sessions:** **262** (D168) · **260/261** (D167) · verifier candidates REJECTED (D166) · **253** (D163) · **252** (D162) — all in the archive.
**Committed, not pushed — read `git log --oneline -3`, never shas quoted in a pointer.** Read me first; do not re-derive the
priority from the ~5,400-line roadmap. This file is a **pointer, capped at 200 lines (`wc -l` ≤ 199)** by
`demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block to carry a current item, a queue id, a
`node cli.mjs` command and a line starting `**Blocker:**` — **rewrite it in place, do not restyle it.** Its two executable
readers are that test and `demo/clockin-digest.test.mjs` (the digest reads only this section, so the **`NEXT-ARCHIVE.md`
link must stay inside the pointer body**). After editing run the trio: `node demo/next-pointer.test.mjs &&
node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs` — the third (**262**) hard-fails on a cited `**NNN**`
with no registration behind it, an index row naming a runbook that was never written, and a runbook with no front matter.

## NEXT SESSION

**Current item: treat portability as ONE class with ONE seam, and get the one ruling — do not patch four paths.** The
operator's restart condition (256) still gates the team, and the chain still **closes on itself** (D169): hygiene evidence
needs **217**; 217 needs a woken seat; `tools/broker-serve.mjs --dry-run` refuses the wake *because* 217 has not landed; and
**67 of 68 registered items ≥ 200 are named by no queue row** (`tools/roadmap-queue-coverage.mjs`, 0.9 s). The same knot has
a **second face**: the team definition does not travel between hosts, and its four symptoms are one defect seen four ways — a
path chosen for one host, **stored without validation**, **matched by string equality**, **never named to the seat**.
Ordering suggested to `pm` (spooled, not decided): **263** (the one resolver everything else calls) → **217** → **264** →
**221 + 265** → **266** → **267** (also 256's rehearsal precondition). **Read
`docs/reviews/cross-os-rig-portability-2026-10-29.md` before decomposing.**

1. **The store, not the rig file, owns a seat's root.** `resolveSeatRoot` returns a persisted cwd **unconditionally**
   (`src/seatroot.mjs:29`); all **12** seats resolve to `C:\Users\Alex\…` and `classifyGitRoot` calls the phantom
   **`main-worktree`** — a woken file-capable seat is told it is in the **live checkout** while its file tools aim at nothing
   (221; GRANT 1's ruling A is the shape of the fix).
2. **The keep-guard for a seat's own tree cannot fire here** (266, *not* 232's liveness guard — do not fold them): `seat-root`
   is marked on **exact normalized-string** equality (`src/broker.mjs:988-1010`), so 12 stored roots match 1 registered tree
   **zero** times while the sweep runs at **every broker start** (`src/broker.mjs:1145-1170`) — the path that took the ledger
   36 → 1. Proven by the gate's `--self-test`.
3. **A seat cannot run a command and does not know it** (217 + 264): `src/seattools.mjs:218` registers
   `shell: createPowerShellTool()`; `pwsh`/`powershell` absent, `bash` present and unregistered; store
   `"toolName":"powershell"` **20,340**, `"bash"` **0**, `ENOENT` 3+1, newest **#274090** *"PowerShell is not available? …
   Maybe the shell is pwsh on Linux?"*; `demo/seattools.test.mjs:30` asserts the current choice — a failing-first rewrite.
4. **Rows exist only if `pm` decomposes, and `pm` thinks only when woken.** **Six** intents sit in
   `selfdev.sqlite.broker.inbox/` (65 → 1,444 min) — **spooling is not a wake.**

**The ask (§OPERATOR OWES 1) is unchanged: one bounded, coordinator-scoped wake** — deliver the six spooled intents, let
`pm` create rows for **217/232/233/235–267**, stop. `pm` has **no** `write`/`edit` and needs no shell, so the block guards an
act that runs no command and lands no artifact; nothing can reach `done` and no verifier is implicated. Cost: one
`local/iq3_s` turn (last logged broker pass **10 ms**; resident days land **314–741** items/day). Guarantees that stay OFF:
253's evidence clause, the 256 rehearsal, 217's shell. Releases stay `pm`'s verb; the start stays the operator's.
**Queue ids unchanged: #725** (impl, ROADMAP 63), **#726** (devtools, 64), **#727** (qa, 67) — all `held` until 231's granted
predicate exists and `pm` releases them (all three orphan-candidates, #662/#710, read `done`).
**Read `docs/reviews/roadmap256-rehearsal-prompt-2026-10-29.md`** before decomposing the hygiene item (answer "when" with a
gate, not a date).

**Blocker:** four, none mine to lift. **(a)** the closed loop above — needs the operator's ruling; **(b)** verifier
certification has no working instrument and **both local candidates are measured and rejected** (D166), while
`tools/model-probes/probe-preflight.mjs` **REFUSES** today (swap **71 %**) — no arm may start, OWES 2 untouched; **(c)** 0
claimable rows, and the still-unwritten implementation halves are **221** seat-root (ruling A granted) and **231** "the queue
drains" (predicate granted, surface owed); **(d)** 217/232/233/235–**267** have **no queue rows**, and 232 stays **gated** on
the 241 design note — nobody touches `src/worktree.mjs:649` / `src/broker.mjs:1167` while it is open.

**Older sessions are verbatim in [NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — this session's cut sits at archive lines 7696–7894.

**Next command (delegate, read-only first, in this order, ~30 s total):**

```bash
node tools/rig-portability-audit.mjs            # NEW GATE (≈1s, exit 1): 15 findings — 12 store-carried foreign seat roots, the unreachable seat-root keep-guard, the absent shell, no host hint. `--self-test` (exit 0) proves the guard IS reachable same-host and NOT for a foreign root; re-run after any 217/221/263/266 work.
node tools/roadmap-queue-coverage.mjs --min 200    # 4,821 rows / CLAIMABLE 0; 68 items ≥200, 67 with NO row naming them (prints its denominator)
node tools/broker-serve.mjs --status ; node tools/broker-serve.mjs --dry-run   # broker DOWN (pid gone, heartbeat 100,925s); 6 spooled intents; 2 BLOCKs — seat-shell-availability (real) and live-tree-dirty (MINE: uncommitted edits; re-run after the commit)
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit   # 1 worktree, 12 seatRoots (all foreign-shaped), `reapable: 0` is NOT a verdict — the seat-root guard cannot fire here (266); heed docs/runbooks/hygiene-and-dead-model-pointers.md
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # 61 findings: duplicate-item ×54, citation-unresolvable ×5, verification-without-evidence ×1, evidence-tree ×1. single-model-rig PASSES — a string comparison, not certification (D137); and it never looks at a store-carried cwd (210's amendment)
node demo/local-model-pointer.test.mjs           # PASS today; run after ANY model change (261's offline half)
node tools/model-probes/probe-preflight.mjs      # REFUSE today: MemAvailable 22.1 GiB, swap 5.7/8.0 GiB (71%), GPU0 12,648/16,376, GPU1 23,095/24,576 (1,481 free), strata 51.3 GiB RSS / 40.7 shmem. Any arm that IS allowed: node tools/model-probes/capped-run.mjs --node-mem-max 6G -- <cmd>  (a `run-<digits>.scope` kill = the cap worked; a `strata`/`llama-server` kill = an incident)
ps -eo args | grep '[l]lama-server' | tr ' ' '\n' | grep -E '^--(model|ctx-size|parallel|n-gpu-layers)' -A1 | tr '\n' ' '   # the ONLY surface naming variant + ctx + parallel — the API key never tells you
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 0 (GRANT 3 held); refs/rescued 484 — read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc` here
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs   # the clock-out trio, always all three
```

## PORTABILITY — what is safe to say, and what is not (opened 2026-10-29; D170)

Copy from the peer, don't review it: `vendor/eval/oh-my-pi` HEAD `6f3fbc94` (2026-10-27, MIT, pinned; full citations in
`docs/reviews/cross-os-rig-portability-2026-10-29.md`). Its claim has a mechanism — it **owns the host-dependent layer**
(embedded shell + patched in-process builtins), has **one validating path resolver** (`crates/pi-builtins/src/host.rs:427-434`;
cwd *"validated via filesystem `stat`"*), **names OS differences in prose**, and makes evidence a **throwaway-state
`--smoke-test` on each host leg** while its unit legs stay Linux. **Do not copy:** the Rust shell / vendored brush fork, a
multi-OS CI matrix, container isolation (D131). **Calibrated claim, once 217/263/264/267 land:** *"the host-dependent layer is
ours, it validates, and one real seat turn is proven on each named host"* — never "durian-pi is cross-platform". **Never**
"repair" a dead cwd by pointing twelve seats at one root (F21 in a repair costume).

## Rig state, re-measured at clock-out 2026-10-29T21:0xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite`: `entries` **137,427** rows, **12** seats. **Queue census 4,821 = 3,748 `done` / 777
`cancelled` / 277 `held` / 19 `deferred` → 0 claimable.** Per-seat parked: impl 164/13 · scribe 44 · devtools 33/2 · qa 21 ·
security 6 · lead 4/1 · pm 3/2 · auditor 2 · qa2 0/1 · advocate/designer/architect `no-work`. **Providers (era-attributed,
226/229):** every failure in the last-30 window is `deepinfra`-era; a `broker-serve` provider BLOCK that clears on re-run is
**probe transience**, not a dead model (**254**). **Verifier (D163 + D166):** the predicate is name/role text
(`VERIFIER_TERMS`, `src/verifierrole.mjs:22`), so only `qa`/`qa2` count; **nothing enforces family separation**
(`src/checkup.mjs:591-598` is an exact-string test). Served verifier `mistralai/ministral-3-14b-reasoning` **Q6_K @
`--ctx-size 8192 --parallel 4 --n-gpu-layers 999999`**; **flint NOT LOADED** (Q4_K_M on disk). 8,192 **cannot** hold a real
verifier conversation — prompts run p50 **55,538** (`qa`) / **108,435** (`advocate`); **208** is the fix. **Seat capability (217):** tools are `read write edit powershell prepare_workspace seat_root`;
`seatguard`'s `SHELL_TOOLS` whitelists `bash` **and** `powershell` (`src/seatguard.mjs:122`) — the guard's set, **not** a
registered tool. **Unsettled submissions:** 9 `placed` + 2 `queued`. **Worktrees:** 1 (this checkout, `main`); branches **2**;
`refs/rescued/*` **484**; unreachable commits **0**; seat roots **12, all foreign-shaped**. Seat worktrees here are
**created, not migrated** (Pi seat-agent state is host-local and absent); the first `up`/`worktree`/`run`/`send` is the
writing verb `docs/runbooks/workspace-move.md` gates (re-verified on Linux; its `ps`-shows-cwd claim and count-based
inventory are corrected). Inventories + store backup: `.spike/`. **Box:** 94 GB RAM, **22.1 GiB available**, **zram swap
5.7/8.0 GiB (71 %)** — swap, not VRAM, is the ceiling; **GPU0 RTX A4000 12,648/16,376 MiB** (`strata-host`, the seats: 51.3
GiB RSS / 40.7 GiB shmem), **GPU1 RTX 3090 23,095/24,576 MiB** (the verifier).

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb** the ledger went **36 → 1**, and eight instruments read or run earlier in it are
**gone from disk and from `git ls-files`** — never committed, so `git status` shows no deletion. The ledger half is named in
the product (`src/broker.mjs:1167` → `pruneWorktrees`, `src/worktree.mjs:649`); the file-loss half is **unexplained** and
recorded twice before (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`). **266 names why the keep-guard
would not have saved it here.** Until 232/233 land **do not run the suite from this checkout** (use the disposable clone);
both scratch dirs are gitignored, so anything that must survive belongs in `tools/` — hence this session's promotion.

## OPERATOR GRANTS (six; accepted 2026-10-29T05:0xZ — **execute these, do not re-ask**; durable record: **D165**)

1. **221 seat-root — ruling A is the ruling.** The persisted per-seat root becomes the **workspace-root-relative name**; no
   migration code; implementation is the team's (failing-first demo, `src/`). **Amended by D170:** the granted "`up --root`
   once per seat" **does not exist** — today the only mechanism is `DURIG_SEAT_ROOT` + `up --refresh`, which is bulk — and it
   would not clear the persisted value (`classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` prints **`main-worktree`**).
2. **"The queue drains" — predicate granted:** *every released row reaches a terminal state within one resident-broker day*
   (the 314–741 items/day regime), **and** *no `held` row older than **7 days** survives a `pm` pass without being released or
   explicitly cancelled*. 231 is the product half. **#725/#726/#727 stay `held`** until that predicate exists and `pm`
   releases them — releases are `pm`'s verb.
3. **Mint the refs — GRANTED AND DONE.** 452 → **0** unreachable commits; `refs/rescued` 32 → **484**; reversible per ref with
   `update-ref -d`. **232 itself stays gated** on the 241 design note: nobody touches `src/worktree.mjs:649` /
   `src/broker.mjs:1167`, and no suite runs from this checkout while it is open.
4. **233 instrument hygiene — GRANTED, LARGELY DONE.** The transport shim landed (labelled; **254** replaces it);
   `.scratch/` is gitignored; `tools/transcript-recovery.mjs` (239's named target), `tools/extract-pi-src.mjs` and **this
   session's `tools/rig-portability-audit.mjs`** are tracked instruments, and `docs/runbooks/workspace-move.md` was
   corrected. **262**'s product half (the `check`/`doctor` wiring + a shape check on the runbook index) is open.
5. **Verifier — GRANTED (D165), amended by measurement (D166): both local candidates are measured and rejected.** The
   granted **`--whole-module` mutant run** needs flint re-loaded at **ctx ≥ 24k, `--parallel 1`** (whole modules here are
   1,686–22,014 est. tokens — the earlier "58,380" misread the pair-accounting **CHARS** column), so it waits on OWES 2;
   **do not re-run the finished fragment run.** **The 3090 is not the constraint — D137's cross-family rule is:** the seats
   run **`Qwen3.8-Flash-Next IQ3_S`** (strata-host `:47831`, GPU0); a real choice needs a **download grant**, priced in
   `docs/runbooks/verifier-model-server.md`, each candidate getting a k=1 gate run **before** adoption.
6. **Start decomposition, not seats; the hygiene threshold is accepted as proposed.** The channel **stays down**, and `pm`
   decomposes **217/232/233/235–267 on next start** — decomposition is granted, a start is not, and the 217 block refuses
   every start: that gap is OWES 1. Scale gate: **hard dimensions zero** (no leaked worktree, no stray seat, no branch
   unmerged while its item reads `done`) **over the bounded 2-seat rehearsal, ≤2 soft violations per seat-run**, then 5, 12.

## OPERATOR OWES (two items — everything else above is granted)

1. **One bounded, coordinator-scoped wake (the head blocker).** **Yes, with the envelope:** deliver the **six** spooled
   intents, `pm` creates rows for **217/232/233/235–267**, then the channel stops. Or **no** — in which case 256 can never
   produce evidence and the honest answer to "when can we have them?" is "not yet, by construction". Why this is not a
   bypass: `seat-shell-availability` blocks "a broker whose seats cannot run a single command", and `pm` is a coordinator
   with **no `write`/`edit` and no shell need** — decomposition runs no command and lands no artifact. Mechanism if granted:
   back the store up, then `node tools/broker-serve.mjs --start --yes-pm-wakes`, watch one pass, `serve --stop`.
2. **Which verifier (D166).** **(A)** a **remote cross-family verifier** — the only option satisfying **253** today; needs a
   funded key, price it first. **(B)** the **corrected local flint re-run** (Q4_K_M on disk, **ctx ≥ 24k, `--parallel 1`**,
   one arm with a bounding system message + declaration header + window-aware excusal, ~40 min GPU, no money) — the
   highest-value cheap lever, **but the box refuses today** (OWES 3), so it needs ministral unloaded *and* `capped-run.mjs`,
   or a lower seat-server window (260). **(C)** verification stays uncertified and `single-model-rig` stays **red as an
   honest finding** (D137) — so **253**'s evidence clause cannot be met. **Recommendation: (B) then (A). Do not route
   ministral** — fast + wrong on 16/16 clean controls would clear `single-model-rig` while making verification worse.

## Do not "fix" these on the strength of the docs

**A `BLOCK seat-shell-availability` is not advice to start anyway**, and it is not proof the *whole* start is unsafe (`pm`
needs no shell): name the exception, do not bypass the guard. **Seat hygiene is UNMEASURED**, not good — **20,340**
`powershell` calls are the Windows era; **0** `bash` rows mean no seat has run `git` here. **A rig file that looks clean is
not a rig that works here** — the winning seat root is a **store** value (210, 221), and **a check that reads one layer
proves nothing about another** (265). **`up --refresh` re-points a seat only if a cwd is defined**, and pointing twelve seats
at one root, the live checkout included, is F21 in a repair costume. **`reapable: 0` is not a verdict** and **a swept ledger
is not "self-healing"** (`src/broker.mjs:1167`, 266). **A `--dry-run` that names no removals is not evidence there are
none**; its finding count moves for real reasons (probe transience; `live-tree-dirty` from my own edits) — **re-run before
reporting**. **A `documents.kind` value is JSON-quoted** and the queue payload lives in `document_revisions` deltas — read
queue state through `cli.mjs queue` / `tools/roadmap-queue-coverage.mjs`. **A model key does not identify a model** — verify
the live `.gguf` in the process table; **an `ctx-size` you never read off it is a guess**. **A probe with no system message
measures the HOST, not the model** (**259**); **`TRUNCATED-EMPTY` conflates "budget too small" with "generation degenerated"**; **`fetch failed` is
a transport ceiling, not a dead model** (**254**); **a control-side
`FALSE-ALARM` may be our feeding** (**195**) (D165/D166 hold the rest). **Never start a probe arm without printing available RAM, swap and per-GPU MiB** — my arms helped
OOM-kill the seats' server. **An unreachable commit is somebody's work.** **A `single-model-rig` PASS is not certification**
(**D137**). **A suite that runs green after files vanished is not green** (`scripts/suite.mjs:36`). **A `402` in a recent row
is not current provider state**; **`queued` (submissions) ≠ `queued` (claimable items)**. **A promoted instrument is "cited
but untracked" until you stage it.** **Append to a growing
file with `>>`; never rewrite a file from its own contents** (D170's near-miss) — and **diff names, not counts**. **Never
quote shas.**
