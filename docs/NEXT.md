# NEXT.md — current state and next actions

**Last update:** 2026-11-07T06:4xZ (delegate session **N3** — the operator answers three open items and grants the NEXT.md
pass, verbatim: **"1. (a)"** (spend caps stay exactly as they are; the cost lever is `lead`'s **routing rule**, not a new
cap), **"2. leave it"** (the 403 citation stays failing in the cite gate on purpose), **"3. (a)"** (`inputs/fetched/README.md`
is false about its own corpus — fix the sentence and build the cheap gate, do **not** track the multi-MB pages), **"4.
Approved to do what you need to do on NEXT.md"** (this cut). The answers reached the team: two intents delivered at
05:58:26Z, and one bounded pass turned them into rows **#5390 #5392 #5393 #5395 #5397 #5398** with four rows closed. Still
open from before: **D227 A–D** (the four credential sub-decisions) and the **push** — `main` is **2 ahead** of
`origin/main`.) Previous closes — session **N2** (D228, the land+prune ratification) and session **N** (D227, the
credential ruling) — moved VERBATIM to `docs/NEXT-ARCHIVE.md` in this cut; the live file is a pointer, cap 200 lines
(`demo/next-pointer.test.mjs`).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**AS OF 2026-11-07T06:4xZ (delegate session N3) — read this block first; where it disagrees with the blocks under it, this
block is the measured current state.**

**Current item:** the milestone the operator named — **ensuring LLM task completion** (D226) — and its first buildable
tranche, **ROADMAP 331**: **#5306** (plumbing), **#5309** (values), **#5310** (verify) all `queued` and unclaimed, plus
**#5395** (`pm` mints the landing entry with **#5390**'s amendments folded in) and **#5308** (promote the band and floor
probes out of `.spike/` before a sweep deletes them). Read
`docs/reviews/task-completion-milestone-intake-2026-11-07.md` §6 and §8 before claiming: bands are **absolute per family**
(`usable = window − max(reserve, max_output)`; `keep + summary + maxTokens + measuredFloor <= window`), never the source
doc's 130k-token bands. The credential build (331 → **#5277** (338) → **#5320** (334) → 336/337/341 → 342's spike) is ruled
in D227 and interleaves with it.

**Blocker:** none that stops a pass — attention carries **zero** `admitted_not_started` notices and the queue is claimable.
What actually costs the next session is two broken instruments: the suppression trace still cannot date a suppression
(**#5215**, and this session logged a **third** `EXIT … reason=deadline passes=-` mis-attribution on a broker I stopped
with SIGTERM after **486** passes), and `scripts/clockin.mjs` now prints **34,102 B of digest against its 20,000 B
budget** — the digest has become the dump it exists to avoid (**#5398** routes it to `devtools`).

**Run first (exact, in this order; all free):**

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node cli.mjs status                         # attention kinds + per-seat context (no admitted_not_started expected)
node tools/broker-serve.mjs --status                                  # spool depth, intent AGE, 6 dead letters, provider reachability
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 180
tail -20 selfdev.sqlite.broker.log                                    # expect INTENT delivered=, WAKE, PASS advancing
node scripts/test.mjs --area docs && node scripts/test.mjs --area guard   # 1.0 s / 1.9 s; both were green at b094ea54
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit                 # reapable was 12 at close — reaping is the operator's grant
```

**Do not hand-query the store, and do not read `docs/SELFDEV.md` whole** — `docs/runbooks/session-start-cost.md` prices the
cheap reads; the pitfalls block for this session is 77–82 at the foot of `docs/SELFDEV.md`.

**(A) WHAT THE OPERATOR RULED, and where each one is carried.**

- **(1a) Caps untouched; routing is the lever.** Measured caps: `DURIG_SPEND_CAP_CALL_USD` 0.05 /
  `DURIG_SPEND_CAP_RUN_USD` 0.10 / `DURIG_SPEND_CAP_STORE_USD` 4.00 at `durig.config.default.json:10-12`, enforced through
  `SPEND_CAUSE` in `src/causes.mjs` (stops the seat and **parks** the row); **there is no per-family total**, so the
  "$0.50 trigger" quoted in earlier blocks is a delegate probe readout, not a mechanism. Ledger at close: **1,127 rows,
  cumulative $0.465535**, all of it `openai/gpt-oss-120b`; max single call $0.000472. The ruling: routine verification on
  the local family (qa, qa2, advocate, designer), `auditor` (the single metered gate canary in `rig.selfdev.json`) woken
  for landing gates only. Carried as **#5392** (`scribe`, addendum to #5362 — the D-entry that must be minted **once**).
- **(2) The 403 citation stays red.** The row is `docs/reviews/task-completion-followup-research.md:150`; MANIFEST records
  HTTP 403 for it. Re-measured: `node tools/review-cite-check.mjs --gate` → **206 failing / 400 not failing (of 606
  findings), 2 SUPPRESSED, exit 1** — identical to the previous session, i.e. **no drift**. **Do not suppress it.**
- **(3a) The corpus doc is false about itself.** `inputs/fetched/README.md:19` claims "This directory is **tracked** (it is
  not in `.gitignore`, unlike `vendor/eval/` and `.spike/`)" while `.gitignore:73-75` ignores `inputs/fetched/*.html` and
  names `inputs/fetched/MANIFEST.md` as the tracked record. Carried as **#5393** (`scribe`, doc fix) and **#5397**
  (`devtools`, the gate: compare a doc's own "tracked" claim against `.gitignore`, neighbour of `runbook-stale`, must start
  green and demand a pair). The delegate edited neither file.
- **(4) The NEXT.md grant** — used for this cut only: blocks moved VERBATIM to the archive, pointer rewritten. **#5398** is
  the row that says the 200-line cap moved the pile rather than emptying it (the digest is the real cost).

**(B) THE DELIVERY PASS, measured — and the three defects it reproduced.** Pass: pid 1704160, started 05:58:24Z,
`--max-duration 300`. All four spooled intents applied at 05:58:26Z (`delivered:true` in
`selfdev.sqlite.broker.inbox.out/`), including the two 05:45Z ones the previous session left waiting. Team output inside
that one pass: queue counts moved `done 3891 → 3895`, `cancelled 833 → 835`, `held 363 → 365`, `claimed 32 → 34`,
`queued 99 → 106`; new routing rows **#5390–#5405**. Cost: **24 metered rows, $0.009332**, of which `auditor` was woken
**10** times in the window (321 `WAKE auditor` lines in the whole broker log) while `SKIP auditor reason=pending` printed
for it every pass — the routing rule of (1a) is the answer, and it is not yet enforced anywhere. Defects reproduced, all
already on rows (do not mint twins): **`--max-duration` overrun** — a 300 s bound, 29 min 39 s of real runtime
(**#5373**); **`serve --stop` refused the grace** and left the pid alive with a fresh `heartbeatAt` and `lastPassAt` frozen
20 min (runbook sequence: genlock check — none present — then `kill <pid>`), and **`EXIT … reason=deadline passes=-`
mis-attributed** a SIGTERM stop and dropped the pass count (**#5215**). After the stop: **no stranded submissions**, so
`doctor` was correctly not run.

**(C) RIG STATE at close (measured 06:2x–06:4xZ).** Queue: `done 3895 · cancelled 835 · held 365 · claimed 34 · deferred
171 · queued 106`. Attention: **9 notices, all `deferred_awaiting_answer`** — 171 items parked on a question, and one per
seat is explicitly **waiting on the operator**: #4976 `pm`, #4354 `impl`, #3350 `qa`, #4881 `lead`, #4835 `scribe`, #4817
`devtools`, #4954 `auditor`, #4827 `security`, #4814 `qa2`. Surface: **43 branches, 41 worktrees**, `worktree audit` →
`total 41 {seat-root 8, live 16, reapable 12, locked 1, non-item 3, dirty 1}` — the leak meter ran **0 → 11 → 12** across
this session without anyone deciding to create or remove a tree. Spool: 1 stale `op:"read"` intent left, **6 dead letters**
unchanged (12 files = `*.error.json` + `*.reason` pairs). `check rig.selfdev.json` (with `--env-file`): **142 fix-now
findings**, up from 136 — `citation-unresolvable` 83, `duplicate-item` 57; the family guards are green:
`single-model-rig {"status":"pass","found":0}` and `no-verifier-seat` pass; **`runbook-stale` is `skipped` ("no runbook
data was supplied")**, which is why the stale `context-over-window` example never fires. Broker down, `broker.json`
cleared, `git status` clean apart from this doc and the gitignored `selfdev.sqlite.spend.jsonl`.

**(D) THE THREE MILESTONES the operator asked for — and the reason the answer is triangulated, not read.** The rig has no
instrument for this: `docs/ROADMAP.md:66-102` is the only M-list (M1 ✅, M2 ✅, M3 ✅ "delivered", M4 parked, **M5 ⏳ proposed and
never ratified** — D141), and **0 of the 106 `queued` subjects contain the word "milestone"** (measured over the whole
queued set); the team now uses "milestone" for a single row (e.g. **#5395** "MINT THE LANDING ENTRY for milestone 331").
**(1) Most recently finished: M3 — "seats can do work, and the rig verifies it."** Its one named undelivered half was
independence, recorded as `check`'s `single-model-rig` fix-now ("all 12 seats resolve to `local/iq3_s`", ROADMAP:73); the
gate canary at `baa5fd87` closed it and it re-measures **pass** today — at the honest cost that D48/D119 cross-family
verification is **suspended by staffing**, not restored: the local server serves one model, and the two GPUs hold
15,816/16,376 MiB and 23,012/24,576 MiB. **(2) The one in flight now: the credential / secret-brokerage tranche (rows
333–342, D225–D227)** — the *decisions* are landed (333 ruled as a swappable interface, 338 approved, rotation rides
`modify()`), the *build* has not started: #5277 (338) and #5320 (334) are `queued`, the RM-295 mask fix (#5334/#5365/#5366)
is still open, and D227 A–D are unanswered. **(3) The one next: "ensuring LLM task completion"** (D226;
`docs/reviews/ensuring-llm-task-completion-research.md`, intake and fold at
`docs/reviews/task-completion-milestone-intake-2026-11-07.md`, follow-up research quote-checked 25/26) with **N1–N7 still
un-minted by `lead`/`pm`**. Ask for the team: mint a milestone convention (a row kind or a `check`-visible label) so the
next session reads the answer instead of reconstructing it — worth a row, not a delegate edit.

**(E) WAITING ON THE OPERATOR (the delegate did not decide these).** (i) **D227 A–D** — recommended credential backend
(recommendation: a 0600 file at a rig-owned path now, an OS credential service as the first optional backend, Vault
deferred to 342's measurement), store key shape (recommend: keep pi's provider-id keying and enforce role↔provider 1:1 as
a `check` finding), precedence (recommend: explicit-source-wins, no silent fallback), and whether a seat may ever hold a
value (recommend: never for the model path; pilot request-level grants elsewhere). (ii) **Push** — `main` is 2 ahead of
`origin/main` (`baa5fd87`, `b094ea54`); this session's doc commit will make it 3. (iii) **The leak meter** — 12 reapable
trees and 1 dirty; reaping needs the D228-style grant. (iv) **The 171 deferred rows**, 9 of them blocked on an operator
answer (ids in (C)). (v) **#5404** — `lead` escalated that the **pi-durable pin has drifted** (`drift: true`, upstream
moved past `2ec55d80`); that changes what a vendor-pins bump would cost and is a capacity/scope call. (vi) **The D-mint**
— one entry for the 2026-11-07 cluster, carried by #5362 with **#5392** as its addendum; #5322/#5333 are held because
`item-5208` hardcodes a duplicate `## D221` and `item-4846` waits on a `D-<mint>` placeholder.

**(F) TRAPS THIS SESSION (detail in `docs/SELFDEV.md` pitfalls 77–82).** `tools/review-cite-check.mjs` **defaults to FULL
AUDIT** and prints 297 failing where `--gate` prints 206 — the two postures are not comparable and their difference is not
a regression. `cli.mjs check` and `tools/broker-serve.mjs --dry-run` print **two JSON documents** on stdout, so a naive
`JSON.parse` fails; `check` **without** `--env-file="$HOME/.config/durig/env"` prints a `registration-refused` notice for
the metered row before the result. `broker-serve --dry-run/--status` prints the **raw `DURIG_*_API_KEY` values** in its
`env:` line — a live specimen of RM-295 (**#5334/#5365/#5366**): never paste that line into a doc. `ps -eo etime` is the
only trustworthy liveness probe after a stop (`pgrep -f` matches its own invocation, pitfall 64).
