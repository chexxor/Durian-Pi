# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T05:5xZ = **2026-10-29 00:5x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1, Linux. Delegate session. **This session changed the verifier, and changed what `done` will mean.** The five verifier seats (what `src/verifierrole.mjs` actually matches — `qa`, `qa2`, `advocate`, `auditor`, `designer`; `docs/SELFDEV.md` names three and is wrong) now resolve to **`verifier/recursivesi/flint`** on LM Studio `:1234`, loaded at **65,536** with `DURIG_VERIFIER_MAX_TOKENS` 32,768 → **8,192**, and `check` flipped `single-model-rig` to **pass, found 0** — which is a **string comparison, not certification (D137)**. The operator's process ruling (review **and** merge to `main` before an item is completed) is registered as **ROADMAP 253**. Durable: **D163**, the runbook `docs/runbooks/verifier-model-server.md` (+ its symptom row in the index), and the skill's instrument table. Session notes, measurements, errors and speed proposals: **`docs/reviews/delegate-notes-2026-10-29-flint-verifier.md`**. **The seeded-bug gate did not complete** — see NEXT SESSION; the verdict is the operator's to weigh. **Prior sessions, in one line each:** round-4 research gate discharged and **250/251** registered (round 4's Task A is **not paste-able**); `tools/review-cite-check.mjs` + `docs/reviews/harness-citation-registry.md` built and **252** registered from its corpus census (**292 hard findings** over 127 files, 81 clean) with the durable rules in **D162**; **241** closed by the permission-plane design note, which registered **247/248/249**. Round 4 stays VERIFIED and unintegrated — see the HARNESS STUDY section. **Committed, not pushed (233 hygiene) — read `git log --oneline -3` rather than trusting shas in a pointer, because amending changes them.** Five pins (`codex d373d649`, `cline 51f63e4f`, `goose 775b3958`, `claude-code-docs 58d6da1e`, `copilot-cli 84ee80ea`); `tools/vendor-pins.mjs --check` PASS at 14 clones, re-run 2026-10-29T02:44Z. Read me first — do not re-derive the priority from the ~4,700-line roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This file is a **pointer, capped at 200 lines** by `demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block below to carry a current item, a queue id, a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in place, do not restyle it.** Its two executable readers are `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` (the digest reads only this section, so **the `NEXT-ARCHIVE.md` link must stay inside the pointer body**). After editing: `node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs`.

## NEXT SESSION

**Current item:** **certify the verifier, then get claimable work to the head of the queue.** Two things gate the team
start and both are now measured rather than assumed. **(1) The verifier is UNCERTIFIED.** The five verifier seats now
resolve to `verifier/recursivesi/flint` (LM Studio `:1234`, loaded at **65,536**, `DURIG_VERIFIER_MAX_TOKENS 8192`) and
`check` prints `single-model-rig` **pass, found 0** — **that pass is a string comparison** (`src/checkup.mjs`), and
**D137**: a verifier that fails the seeded-bug gate is worse than no verifier. The gate at the instrument's default
**3,000**-token output budget returned **6 of 7 cells `TRUNCATED-EMPTY`** (flint spends the whole budget reasoning:
a short probe at `CAL_MAX_TOKENS=9000` answered correctly in 51.6 s using **750 of 803** tokens on reasoning) and the
one cell that did produce text was scored **FALSE-ALARM** (it invented missing ESM imports in `src/worktree.mjs`).
Re-runs die partway with `REQUEST FAILED fetch failed` under memory pressure (**swap 7/7 GB full**, ~19 GB available,
flint's engine **26.4 GB RSS** beside `strata-host`'s **51.3 GB**). **(2) ROADMAP 217:** a seat on this host has **no
spawnable shell**, and the operator's new ruling — review **and** merge to `main` before `done`, registered as
**ROADMAP 253** — demands re-runnable evidence, so **217 lands first or 253 gets switched off**. Queue unchanged:
**4,821 rows, 0 claimable**; 217/232/233/235–**253** have **no queue rows**; both intents below are **unspooled**.
**Queue ids:** **#725** (impl, ROADMAP 63), **#726** (devtools, ROADMAP 64), **#727** (qa, ROADMAP 67) — all `held`, all
three in the drain audit's **orphan-candidate** list (#662/#710 both `done`) while the operator clause "and the queue
drains" **has no definition anywhere in the tree** (ROADMAP **231**); plus the stranded spool intent
`delegate-routing-fact-20261028-2150` (1 `pm` [message], waiting **462 min** at clock-in, 2026-10-29T02:5xZ).
Rows opened this session: **253** (no `done` without a cross-family review **and** an artifact that is an ancestor of
`main` — the gate half of **100**; `complete_work` `src/rig.mjs:931` sets `done` in the author's own commit and then
retires the worktree at `:1055`). Prior sessions: **232/233/234**, **235–243**, **245–252** — registered, not
scheduled; `pm` sequences them.
**Next command (delegate, read-only first — run in this order, ~11 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # 3.3 s: four links + §7 seat capability (217) + provider-era attribution (226)
node tools/broker-serve.mjs --status    # 2.8 s: broker DOWN at clock-in (heartbeat 41,108 s = 11.4 h old), 1 stranded spool intent
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # name the rig. FAILING today: verification-without-evidence ×1 (435 items), duplicate-item ×54, citation-unresolvable ×5 (held item cites eb7e69c1e, absent here), evidence-tree ×1 (#2175,#2213). single-model-rig now PASSES — that is a string comparison, not certification (D137)
curl -s --max-time 15 http://127.0.0.1:1234/api/v1/models | head -c 400   # the loaded verifier's REAL context; then prove servability with a /v1/chat/completions call — the listing lies (docs/runbooks/verifier-model-server.md)
# the certification run (delegate-run, unattended; a seat CANNOT run it until 217 lands): budget it — k=1 is 19 cells ≈ 60–70 min, k=3 ≈ 2.5–3 h at ~2 min/cell
CAL_MAX_TOKENS=9000 node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 recursivesi/flint flint-ctx65k-out9k --replicate 1 --pair-comments strip-both   # --plan first (spends nothing); logs under .spike/gate/
# then, ONLY on the operator's grant, spool BOTH intents (safe while the broker is down — queuing starts nothing, and decomposition stays pm's):
#   .spike/delegate/pm-release-brief-2026-10-28.md          (releases — pm's verb; gated on the 221 seat-root ruling and 231's clause)
#   .spike/delegate/pm-intent-20261029-verifier-and-merge.md (253 WITH 100, 217 first, the five-verifier-seat fact, the SELFDEV docs defect, gate --only)

**Blocker:** the operator ruled (D156/D157): the start stays **withheld on ROADMAP 217**, rehearsals run in the disposable
clone `/home/chexxor/Git/Durian-Pi-ops` (present, HEAD `6a5f7f89`, 469 MB, carries `.env.rehearsal`), and **nothing host-wide
is delegated** (`set-local-rtc 0` changes the whole OS — routed as ROADMAP **234**, detector `tools/channel-preflight.mjs` §8).
**Three blockers now, all cheap to clear:** (a) **no spool grant** — 217/232/233/235–**253** have **no queue row**, all 296
non-terminal rows are parked, and `pm` has never seen them (OPERATOR OWES 5); (b) **the verifier is uncertified** — the gate
has not completed, and if flint fails it the choice is the operator's (OPERATOR OWES 6); (c) **217** — a Linux seat has no
spawnable shell, and its fix is small (host-conditional shell tool in `src/seattools.mjs`; `demo/seattools.test.mjs:30`
asserts the opposite and must be rewritten failing-first). **Applied under the grant:** the pre-move clone's 3 packs → this
checkout: 9,301 → 22,362 objects, `git fsck` clean, **23/30 cited shas resolve**, 455 commits still anchored by nothing.
**Granted 2026-10-28 (D158):** `--depth 1` competitor clones (five taken, pins regenerated, `--check` PASS at 14 clones);
`.pi/` writes **permitted but disfavoured**; and **232 is gated on research (241): do not claim it, do not touch
`src/worktree.mjs:649` / `src/broker.mjs:1167`, and run no suite from this checkout while it is open.** **Granted
2026-10-29 (this session):** model-server control (unload/load/`context_length`) and the verifier-seat edit in
`rig.selfdev.json` — **seat instruction text remains operator-owned and untouched.** Still owed: the 221 seat-root ruling; an
evaluable **"the queue drains"** (231); a grant to mint `refs/rescued/orphan-*` for those 455; the Windows-host session corpus
+ `.spike/delegate-inventory-2026-10-26.txt` (237).
**Routed:** `delegate-routing-fact-20261028-2150` (stranded in the spool). **History:** `docs/NEXT-ARCHIVE.md`.

### Read-only baseline — run this before anything else (these re-ran clean, Linux, 2026-10-29T03:5x–04:0xZ; `latency-budget`, `harness-usage-census` and `review-cite-check` are cut to `docs/NEXT-ARCHIVE.md` — their measured cost and purpose now live in the instrument table in `.agents/skills/delegating-to-durian-pi/SKILL.md`)
```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json      # 3.3 s — §1–§8, incl. seat capability (217), provider-era attribution (226), host-clock posture (234)
node tools/broker-serve.mjs --status      # 2.8 s; now also raises `seat-shell-availability` (217)
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.93 s: 91 non-terminal LANDING rows, 71 fully on main, ids printed
node tools/instrument-provenance.mjs && node scripts/clockin.mjs # 46 ms + 2.6 s: suite members git=238 disk=238 + ledger size (233, exits 1 on drift), then the digest
```

## Rig state, re-measured 2026-10-28T20:1xZ (Linux) — re-read, do not trust; the counts below were **re-confirmed identical** 2026-10-29T02:4x–03:1xZ (queue 4,821 = 3,748 done / 777 cancelled / 277 held / 19 deferred; 1 worktree; broker down, last pass 2026-10-28T17:09:58.308Z, pid 1771484 dead) and re-confirmed again at clock-in 2026-10-29T02:5xZ (heartbeat **41,108 s** = 11.4 h old; **1** stranded spool intent) — **but the seat-model facts in the Providers paragraph are now SUPERSEDED by the Verifier provider paragraph below**

**Store** `./selfdev.sqlite` (438,329,344 B): `entries` **137,427 rows, max id 274,114**, 12 seats. **Queue census**
`node cli.mjs queue --json | jq -r '.items[].status' | sort | uniq -c` → **4,821 = 3,748 done / 777 cancelled / 277 held
/ 19 deferred**, i.e. **0 claimable**. Per-seat parked (held/deferred, oldest-parked): impl 164/13 280.8 h · scribe
44/0 290.0 h · devtools 33/2 290.3 h · qa 21/0 290.2 h · security 6/0 260.1 h · lead 4/1 252.0 h · pm 3/2 225.6 h ·
auditor 2/0 239.2 h · qa2 0/1 145.7 h · advocate/designer/architect 0/0 `no-work`.
**Providers (era-attributed, ROADMAP 226/229):** over the last 30 submission rows the attempts split
`local/iq3_s=14, deepinfra/…=8, unattributed=8` and **every failure in the window belongs to the `deepinfra` era — the
current `local/iq3_s` era has none.** Do not chase the `402`s in the recent rows; they are history (the 14,377 `402`
generations predate the 2026-10-27T04:55Z move to local).
**Verifier provider — CHANGED this session (2026-10-29T05:1x–05:5xZ, Linux; operator-granted, `D163`):** five seats —
`qa`, `qa2`, `advocate`, `auditor`, `designer` — now resolve to **`verifier/recursivesi/flint`** (that is what the
product's own predicate `src/verifierrole.mjs` matches; `docs/SELFDEV.md`'s "three" is wrong and needs a scribe row).
LM Studio `:1234` now serves **only** flint (40B, Q6_K, 32.72 GB) at **65,536** (`parallel 4`, `num_experts 6`, flash
attention, KV offloaded); ministral was unloaded, freeing ~12.7 GB on the 3090. `durig.config.json` (gitignored,
machine-scoped): `DURIG_VERIFIER_MODEL=recursivesi/flint`, `_CONTEXT=65536`, `_MAX_TOKENS=8192` — previously 13273/32768,
against a server that had ministral loaded at **8,192**: the rig was declaring a window it was never given. Measured:
flint decode **9.8 tok/s**, COLD prefill ~**212 tok/s**, WARM TTFT **0.23 s** at 6,016 tokens, 51.6 s for an 803-token
answer of which **750 were reasoning tokens**; verifier prompt sizes p50 **55,538** (`qa`) / **108,435** (`advocate`) and
**37,348 of 60,503** assistant turns exceed 32,768, so 65,536 is a floor and **208** is the fix. `demo/local-model-pointer.test.mjs`
and `demo/second-local-provider.test.mjs` both **PASS** at this config; `check`'s `single-model-rig` **passes** — which is a
string comparison, **not** the gate (**D137**).

**Seat capability (ROADMAP 217):** seat tools are `read write edit powershell prepare_workspace seat_root`; `pwsh` and
`powershell` are **both absent on this host** (`bash` is at `/usr/bin/bash` and is not registered); the store shows
`"toolName":"bash" -> 0`, `"toolName":"powershell" -> 20,340`, `spawn powershell ENOENT -> 3`, `spawn pwsh ENOENT -> 1`,
newest `entry #274074 2026-10-28T17:09:07.533Z conv 4930 = devtools isError=true`.
**Unsettled submissions:** 9 `placed` + 2 `queued` → `advancingConvIds()` counts **9 of 12 seats as ADVANCING**; after
pass 1's `reconcileStrandedSubmissions` all nine read **WAKE**. The 2 `queued` rows sit at the head of **pm's**
conversation and can never be aged out (never placed → no admitted entry to join).
**Worktrees:** **1 (this checkout, `main`)** — and `.git/worktrees` is **empty**; at the start of the previous session
the same command listed **36**, including 20 `C:\Users\Alex\…` paths. **No seat worktrees** exist here, and `/home/chexxor/Git/Durian-Pi-worktrees/`
is absent; local branches 2 (`main`, `wip/seat-prompt-files`). **Pi seat-agent state is host-local and absent here**, so a
seat worktree here is **created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb
`docs/runbooks/workspace-move.md` gates. `D:\` survives only as the source clone's remote path (`/mnt/d/Git/Durian-Pi`) —
never write there.

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb on the workspace** the ledger went **36 → 1**, and eight instruments read or run
earlier in it are now **absent from disk and from `git ls-files`** — never committed, so `git status` shows no deletion and
there is nothing to restore. The ledger half is named in the product (`src/broker.mjs:1167` → `pruneWorktrees`,
`src/worktree.mjs:649`); the file-loss half is **unexplained**, and the same end state is recorded twice before
(`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`, `:30`). Until 232/233 land: **do not run the suite from
this checkout** — run it in the disposable clone.

## OPERATOR OWES (six items; the team is blocked behind them — a sixth, the channel-start recipe, is superseded and cut to `docs/NEXT-ARCHIVE.md`)

1. **ROADMAP 221 — the seat-root ruling** (D152 §6 + D153 addendum). Seats' persisted agent cwd resolves to a
   `D:\Git\Durian-Pi-worktrees\<seat>`-shaped value on the Windows host, and `up` reports `source: persisted seat cwd`
   even after `up --root …`. There is **no `seatRoot` field in `rig.selfdev.json`** (seats carry no `cwd`) and none in
   `status`, so the residue lives in Pi agent state **no CLI prints**. Proposed ruling **A**: *the persisted per-seat root
   becomes the workspace-root-relative name; `up --root` once per seat is sufficient; no migration code.* Not inert on
   Linux: `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` **on Linux** prints **`main-worktree`** — a stale
   Windows root mis-classifies as the LIVE tree (the F21 failure `src/seatroot.mjs` exists to prevent).
2. **The definition of "the queue drains"** in the operator clause inside `#725`/`#726`/`#727` bodies
   (`SEQUENCING CONSTRAINT (operator): do NOT start the daemon-host work before #662/#710 are done and the queue drains;
   not ahead of TUI`). #662/#710 cleared 2026-10-17; the clause has no threshold, predicate or surface, so the three
   top-ranked rows have been `held` for 12 days. **`pm` cannot clear it and neither can the delegate** — it is your
   sentence, and 231 is the product half.
3. **A grant on ledger surgery** (ROADMAP **232**). Today `pruneWorktrees` runs unconditionally from the broker sweep
   and after every removal, and on a moved workspace that deletes the registrations this rig's own runbooks call
   evidence. Until it is scoped, the safe operator stance on this host is: **no `up`, no `worktree`, no channel start**
   from the main checkout, and re-inventory (`git worktree list --porcelain > .spike/…`) before and after any writing
   verb.
4. **Commit-or-discard for untracked instruments** (ROADMAP **233**, the cost of **214**). Eight files one session read
   or ran are gone and unrecordable; several ROADMAP rows credit them as landed. **Measured 2026-10-29, two of them are
   still here and one is one `git add` from safety:** `.spike/extract-pi-src.mjs` (gitignored) and
   `.scratch/transcript-write-bodies.mjs` — **`.scratch/` is NOT in `.gitignore`** (only `.spike/` is, line 21;
   `git check-ignore` proves it), so ROADMAP 4480's "`.scratch/`/`.spike/` are gitignored" is half false and
   `docs/reviews/pi-harness-usage-audit-2026-10-28.md:78` still has a working copy. Either the team re-creates the rest
   (labelled re-created, not restored) or the rows citing them get amended — your scope call, not a seat's.
5. **A grant to spool the blocking ROADMAP items to `pm` at all** (measured 2026-10-29T03:0xZ). `queue --json` returns 4,821
   rows and **not one subject names ROADMAP 217, 232, 233 or 235–251** — they exist only in `docs/ROADMAP.md`, so no seat has
   ever been able to claim them and `pm` has never decomposed them. 241's research gate is discharged, so the cheapest real
   unblock (**217**: a host-conditional seat shell in `src/seattools.mjs`, with `demo/seattools.test.mjs:30` — which asserts
   the current no-`bash` choice — rewritten failing-first) is now queue work with no row. **Ask:** may the delegate spool one
   intent asking `pm` to decompose 217/232/233 and the 235–251 cluster against the existing parked rows? Spooling while the
   broker is down only queues (no wake), and decomposition stays `pm`'s.
6. **Which verifier, if flint fails the gate** (new; **D137** binds). The five verifier seats now point at
   `recursivesi/flint` and `single-model-rig` passes, but the seeded-bug gate has **not completed**: at the instrument's
   3,000-token output budget, 6 of 7 cells were `TRUNCATED-EMPTY` and the one cell with text was a **FALSE-ALARM** that
   invented missing ESM imports. Your three options: **(a)** let the gate finish unattended at `CAL_MAX_TOKENS=9000`
   (~60–70 min k=1, ~2.5–3 h k=3) and keep flint only if it passes; **(b)** a **remote** cross-family verifier (costs money,
   needs a funded key); **(c)** start with the verifier **uncertified** — cheapest, and exactly what **D137** calls worse than
   no verifier, because `check` then reports a green the rig has not earned. The fallback is **not** ministral at 8,192 (0/2,
   **D137**) and not single-family `iq3_s`. The box is the constraint: swap 7/7 GB full with ~19 GB available, flint's engine
   **26.4 GB RSS** beside `strata-host`'s **51.3 GB**.

## Harness study and the open skill/doc proposals — cut VERBATIM to `docs/NEXT-ARCHIVE.md` (2026-10-29T06:2xZ)

Rounds 1–4 of the harness study are **verified and still unintegrated**; the rulings are **D160**/**D162** and the detail is
in the archive plus `docs/reviews/harness-r4-verification-2026-10-29.md` — **do not paste round 4's Task A** (ROADMAP **250**,
it silently re-points citations ROADMAP relies on). Of the open delegate proposals: **Edit A landed this session** (the
instrument table in `.agents/skills/delegating-to-durian-pi/SKILL.md`), the citation instrument is built and its remainder is
ROADMAP **252** (an unowned docs repair with no queue row), and **Edit B is still owed**: `docs/runbooks/cross-clone-object-recovery.md`
+ its symptom row in `docs/runbooks/README.md`. A new runbook landed instead this session: `docs/runbooks/verifier-model-server.md`.

## Then, in this order (measured ranking — `docs/reviews/wallclock-budget-2026-10-28.md` §6, ruling D153, amended by D154)

1. **#725 / #726 / #727 (channel resident) + the head of the queue** — **but land #217 + #232 + #233 first on this
   host** (all three measured this session; the detail is in the INCIDENT section above): a seat here has **no spawnable shell** (217; the delegate half — the `--dry-run` refusal on `seat-shell-availability` — is landed), the broker sweep **prunes the cross-OS ledger** (232, measured **36 → 1** registrations inside one session), and eight instruments are **gone and unrecordable** (233). Only the ledger grant and the commit decision need you; the rest is
   cheaper to land than the channel it unblocks. History prices the channel: `run`-invoked days
   2026-10-13→15 waited **101.8–114.3 min** per claim and landed 47–132 items/day; resident-broker days 10-17→21 waited
   **2.6–5.4 min** and landed **314–741**/day. But 296 of 296 non-terminal rows are parked, so the release comes first — `tools/queue-drain-audit.mjs`: **71 of 91** non-terminal LANDING rows are already fully on `main` and 12 rows are `manual` gate-prose (ids printed; releasing stays `pm`'s verb, and both delegate briefs sit unspooled in `.spike/delegate/`).

## Do not "fix" these on the strength of the docs

**An orphan-candidate verdict is not a release recommendation** — #725/#726/#727 have every cited gate `done` and are
*correctly* held by an operator clause; read the body (`stale-held-backlog.md` §Do). **A swept worktree ledger is not
"self-healing"** — on a moved workspace `git worktree prune` deletes evidence, and it runs unconditionally
(`src/broker.mjs:1167`); if `git worktree list` shrinks across your session, stop and write it down. **A suite that runs
"green" after files vanished is not green** — `scripts/suite.mjs:36` enumerates with `readdirSync(demoDir)`, so a deleted
member is a silent shrink, not a failure (233). **A `402` in a recent submission row is not current provider state** —
attribute it by joining to the first assistant entry after the admitted one (§Rig state, ROADMAP 226/229). **A `WAKE` in the preflight's
"after pass-1 reconcile" column is a prediction about reconcile**, not a delivered wake. **`queued` is not `claimable`**
in the queue sense: the queue's claimable state is `queued` *items*, and submission rows are a different table — mixing
them is how this session nearly mis-wrote 229. **`admissionVerdict` being inert means aged `queued` rows are never
withdrawn** — do not "recover" them by hand with a second writing Harness. `DURIG_MAX_CONCURRENT_SEATS` is unset in
`durig.config.json`, `"1"` in `durig.config.default.json`, and the observed profile is **not** single-flight (max 11 in
flight) — read `src/config.mjs loadConfig` first (D153 §4). The 5-minute degeneration bound is a *turn* guard on a
different quantity, and the 5-minute **admission** deadline is a different 5 minutes again. A `--dry-run` names no
removals (resets model+cwd only) — not a safety check. Model speed is **12.7%** of machine time. `tools/` is untested by
design except where a demo is named. **A `single-model-rig` PASS is not certification** — it compares model *strings*
(**D137**); the seeded-bug gate is the certification. **An empty answer from a reasoning model at a small `max_tokens` is
a budget artifact, not a dead model** (flint: 750 of 803 completion tokens were reasoning; the same call at 8 tokens
returns `finish_reason: stop` with empty content), and **`TRUNCATED-EMPTY` rows measure the output budget as much as the
model** — read the run's budget before reading its verdict. **A model server's `loaded_instances` entry is not a health
check**: the zombie that started this session listed flint loaded at 262,144 while every request 400'd.

