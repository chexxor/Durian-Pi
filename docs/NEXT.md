# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T05:0xZ = **2026-10-30 00:0x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is
**Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session.
The superseded 199-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (entry header at archive line 7898; proof:
`tail -199 docs/NEXT-ARCHIVE.md | md5sum` = the pre-cut file, byte-identical).

**THE D169 CLOSED LOOP IS OPEN.** The operator granted the bounded, coordinator-scoped wake (grant at 2026-10-30T04:2xZ,
"yes"). It executed, and the grant exposed a defect in this repo's own gate: **a BLOCK the operator has ruled on had no way
to be recorded.** `--yes-pm-wakes` acknowledges the spool and `--allow-dirty` acknowledges the tree; `seat-shell-availability`
had **no ack at all**, so `--start` was refused no matter what the operator decided — the instrument could name a hazard but
could not carry the ruling about it. Landed: `tools/broker-serve.mjs --ack-coordinator-wake` (2 commits), which is **measured
per seat by the product's own `toolRemovalsFor`** (`src/seattools.mjs:249`) and never a waiver — a seat that loses its shell
also loses `read/write/edit/prepare_workspace`, so for those seats the absent shell guards an act that runs no command and
lands no artifact; if ANY wake-set seat keeps the shell tool the block stands. It also requires `--max-duration`.

**What the wake did** (all re-measured, Linux): **6/6 intents delivered** (`INTENT delivered=6 dead=0 dup=0`); `pm` decomposed
across two coordinator turns; queue rows **4,821 → 4,861**; **CLAIMABLE 0 → 16**; coverage `roadmap-queue-coverage` items ≥200
named by a row **1 → 15**, with **no row 67 → 53**. The portability class was minted as ONE chain with ONE root: **263 #4847**
(the one validating resolver) → **217 #4849** → **264 #4851** → **221 #4852 + 265 #4854** → **266 #4853** → **267 #4855** →
**256 #4857**; **232 #4850** carries the 241 gate on **#4846**; **233 #4848**; the thin ranges **#4859–#4861**. `pm` revised
its own **#4840/#4842** in place to "folded into 263/221 and 217/264" rather than forking a second seam, and registered
**#4856** (`hold_work` refuses a row it created while `release_work` succeeded as sender — one-way authority).
**Durable: D171.** **New hazard, and it is the headline for the next session: 16 rows are `queued` on a host where no
registered shell exists and all 12 seat roots are foreign — a claimable row is not a runnable row.**

## NEXT SESSION

**Current item: rule on the release ORDER — #4858 (`lead`, `queued`) is the landing plan the class is missing. Nothing in it
is workable until something says in which order 217/221 land *before* the 16 claimable rows are allowed to wake a
file-capable seat. Do not restart the broker to find out.** `pm` named the cost itself and reversed its own earlier `#3350`
release rather than issue the rest: with no broker, no shell that exists and 12 phantom roots, "the class has no order in
which anything is *workable*". The row is `lead`-addressed and claimable, so this needs a wake to act on — which is exactly
the decision the operator now owns, not a gap to fill by hand.

**Ordering is the team's verb.** `pm` minted it and it holds: **263 → 217 → 264 → 221 + 265 → 266 → 267**, with **232 gated on
#4846** (the 241 design note — nobody touches `src/worktree.mjs:649` / `src/broker.mjs:1167` while it is open) and **#4858**
sitting above the class. Read `docs/reviews/cross-os-rig-portability-2026-10-29.md` and `#4847`'s body before decomposing
further; 263's acceptance is that the sweep **calls** the resolver — do not add a third path normalizer.

**Two facts about waking that cost this session its share of wall-clock — read them before diagnosing again.**
1. **Delivered ≠ woken.** `INTENT delivered=6` and every pass still logged `SKIP pm reason=pending conv=3`. That is the
   **per-seat suppression** variant (`docs/runbooks/broker-down-or-stalled.md` case (b), one-seat variant), NOT a down broker
   and not a wedged loop: fresh `heartbeatAt`, frozen `lastPassAt`, no `genlock`, GPU0 at 0 %. The remedy is
   **stop → `resume` (broker STOPPED) → restart**, and it worked: `resume` found **9** and withdrew them (`pm #273999`
   `placed→run-cancelled`, six `queued→settled`).
2. **`resume` cuts a seat's in-flight work short.** Those six withdrawn `queued` submissions were `pm`'s remaining
   generations — which is why the first turn produced 26 rows (**#4820–#4845**) on the memory/LINUX-track numbering and
   **none** of the portability class. Completing the granted act needed one more coordinator turn, delivered with
   `node cli.mjs send pm --body-file .spike/portability-brief-20261030.md --request-id <uuid>`; `send` settled
   `done`. **`send` prints a DEPRECATION warning — it opens a full writing harness = a second owner.** It was admissible
   only because no broker was running, and it is not the sanctioned path (`intent.mjs` + a startable broker is). Do not
   reach for it while a broker drives.

**Blocker:** three, none mine to lift. **(a)** The class is un-wakeable as a *product* act: 16 claimable rows would wake
`impl`/`devtools`/`scribe`/`qa`/`security` with **no registered shell that exists** (217) and a **foreign persisted root**
(221), which is how the phantom dirs below got written. `--ack-coordinator-wake` will not cover a wake set containing them,
by design. **(b)** 53 registered items ≥200 still have no row naming them (`236–238`, `243–252`, `254–255`, `258–262` among
them) — `pm` registered the ranges thin on purpose, because it has no file tools and would not write 30 bodies from a
summary of a doc it could not read. **(c)** OWES 2 (which verifier) is unanswered and `probe-preflight` still **REFUSES**
today (swap **64 %**), so no verifier arm may start.

**Older sessions are verbatim in [NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — this session's cut sits at archive lines 7900–8098.
(`scripts/clockin.mjs` reads only this `## NEXT SESSION` section, so the link to this file's own history lives inside it on
purpose — `demo/clockin-digest.test.mjs` fails if it drifts below the next heading.)

**Next command (delegate, read-only first, in this order, ~35 s total; Linux):**

```bash
node tools/roadmap-queue-coverage.mjs --min 200   # CLAIMABLE 16; 68 items >=200, 53 with NO row naming them. Re-run before reporting: this is the instrument that proves the wake landed (it read 1/67 last session).
node tools/rig-portability-audit.mjs              # exit 1, 15 findings; --self-test exit 0. Re-run after any 217/221/263/266 work — it is the ~1s gate, and 267's oracle belongs per-session.
node tools/broker-serve.mjs --status              # broker DOWN (I stopped it); no genlock. A --dry-run now refuses on seat-shell-availability WITHOUT the ack — correct: the wake set now contains file-capable seats.
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit   # 1 worktree, 12 seatRoots all foreign-shaped; `reapable: 0` is NOT a verdict (266)
ls -A | grep -E '^[A-Za-z]:|\\|dsh-Projects'      # MUST print nothing. These are the phantom roots; git status CANNOT see them (.gitignore:12 `.durig/` matches at any depth). Evidence preserved in .spike/evidence-phantom-roots-20261029/
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # 61 findings, pass:true — a string comparison, not certification (D137); it never looks at a store-carried cwd (210/265)
node demo/local-model-pointer.test.mjs            # PASS today; run after ANY model change (261's offline half)
node tools/model-probes/probe-preflight.mjs       # REFUSE: MemAvailable 22.1 GiB, swap 5.1/8.0 GiB (64%), GPU0 12,648/16,376, GPU1 22,893/24,576. Any allowed arm: node tools/model-probes/capped-run.mjs --node-mem-max 6G -- <cmd>
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 0 (GRANT 3 held); refs/rescued 484 — read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc`
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs   # the clock-out trio, always all three
```

**If the operator rules on a second wake, the sequence that worked, verbatim** (bounded, coordinator-scoped, 2026-10-30):
back up the store → `node tools/broker-serve.mjs --start --yes-pm-wakes --ack-coordinator-wake --max-duration 600 --no-probe`
→ watch `./selfdev.sqlite.broker.log`, not the store → expect `INTENT delivered=N` → if a seat shows `reason=pending`,
`node tools/broker-serve.mjs --stop`; if it does not exit and **no `*.genlock.*` exists**, `kill -TERM <pid>` (mine landed
late; prove `ESRCH` before touching the state file — I removed `selfdev.sqlite.broker.json` only after proving the pid gone)
→ `node cli.mjs resume` → restart. `serve --stop` is a REQUEST. A broker that hits `--max-duration` may sit dormant past it.

## INCIDENT CLASS, measured on my watch — read before trusting `git status` as a safety check

During the 10-minute broker window, three repo-root directories named for another OS's absolute path appeared: **`C:`**,
**`C:\Users\Alex\dsh-Projects\pi-opendurig`**, **`C:\Users\Alex\dsh-Projects\pi-opendurig\item-4789`**, containing
`.durig/queue-{all,security,scribe,impl}.md` — harness per-seat views written into seats' foreign persisted roots (221 made
visible, exactly as `tools/broker-serve.mjs` `phantom-seat-root-path` predicts). Proven by **name diff**, not counts: my
pre-verb inventory `.spike/pre-wake-root.txt` (67 entries) vs after — exactly 3 new, **zero tracked changes, zero losses**.
**They are invisible to `git status`** because `.gitignore:12` is `.durig/`, which matches at any depth — so the *filesystem*
scan is the only instrument that sees this class, and this is the same shape as the 2026-10-26/28 file-loss incidents.
Moved (not deleted) to `.spike/evidence-phantom-roots-20261029/` — 6 files. **Measured distinction that matters:** `pm`'s
turn wrote **none** of them; only **file-capable** seats produce them, which is the coordinator exception holding in the
wild. Do not "repair" this by pointing 12 seats at one root — that is F21 in a repair costume.

## Rig state, re-measured at clock-out 2026-10-30T05:0xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite`: **137,427+** entries; **12** seats. **Queue census 4,861 = 3,748 `done` / 778 `cancelled` /
301 `held` / 16 `queued` / 18 `deferred` → CLAIMABLE 16** (was 0 at clock-in). **Broker DOWN by me, deliberately** — the
granted wake's window closed; the channel is stopped because the 16 claimable rows are not runnable here.
**Portability gate** `tools/rig-portability-audit.mjs`: exit **1**, **15 findings**; `--self-test` exit **0**.
**Providers:** `local/iq3_s` (strata `:47831`, GPU0) — `pm, impl, lead, scribe, devtools, security, architect`;
`verifier/ministral-3-14b-reasoning` (`:1234`, GPU1, `--ctx-size 8192 --parallel 4`) — `qa, qa2, advocate, auditor, designer`.
Both answered at preflight. **flint NOT LOADED** (Q4_K_M on disk); 8,192 cannot hold a real verifier conversation (208).
**Unsettled submissions:** 9 found by `resume`, all withdrawn (that count is now 0 for the seats it touched).
**Worktrees:** 1 (this checkout, `main`); branches 2; `refs/rescued/*` **484**; unreachable **0**; seat roots **12, all
foreign-shaped**; phantom-named dirs at repo root **0** (moved, evidence kept). **Supervisor:** every pass of my run logged
`supervisor: escalated … reason=degeneration` for **auditor, devtools, qa2** — pre-existing degenerate claims from the
Windows era, UNVERIFIED here; `docs/runbooks/degeneration-guard.md` is the entry point, and no seat was reset.
**Box:** 94 GB RAM, **22.1 GiB available**, **zram swap 5.1/8.0 GiB (64 %)** — swap, not VRAM, is the ceiling; GPU0 RTX
A4000 12,648/16,376 MiB (seats), GPU1 RTX 3090 22,893/24,576 MiB (verifier, 93 % full).

## OPERATOR GRANTS (six accepted 2026-10-29T05:0xZ; durable record D165) — and OWES (now one)

1. **221 seat-root, ruling A** — the persisted per-seat root becomes the workspace-root-relative **name**; no migration
   code; implementation is the team's (failing-first demo, `src/`). Amended by D170: `up --root` **does not exist**; today
   the only mechanism is `DURIG_SEAT_ROOT` + `up --refresh`, which is **bulk** (all 12 seats). Now **row #4852**, held,
   gated behind #4847.
2. **"The queue drains" predicate granted** — every released row reaches a terminal state within one resident-broker day,
   AND no `held` row older than 7 days survives a `pm` pass unreleased/uncancelled. 231 is the product half; **#725/#726/#727
   stay `held`** until it exists and `pm` releases them. **Releases are `pm`'s verb; the start is the operator's.**
3. **Mint the refs — done** (452 → 0 unreachable, 484 refs, reversible per ref). **232 itself stays gated** on the 241 note:
   nobody touches `src/worktree.mjs:649` / `src/broker.mjs:1167`, and no suite runs from this checkout while it is open.
4. **233 instrument hygiene — GRANTED, LARGELY DONE.** 262's product half (`check`/`doctor` wiring + a shape check on the
   runbook index) is open.
5. **Verifier — GRANTED, amended by measurement (D166): both local candidates measured and REJECTED.** The whole-module
   mutant run waits on OWES 2; **do not re-run the finished fragment run.** D137's cross-family rule, not the 3090, is the
   constraint; a download grant is priced in `docs/runbooks/verifier-model-server.md`; k=1 gate **before** adoption.
6. **Start decomposition, not seats; hygiene threshold accepted.** **This session executed the decomposition half.** Scale
   gate: hard dimensions zero (no leaked worktree, no stray seat, no branch unmerged while its item reads `done`) over the
   bounded 2-seat rehearsal, ≤2 soft violations per seat-run, then 5, 12. **The phantom dirs above are a soft violation
   already on the record — count them, do not launder them.**

**OPERATOR OWES (one):** **which verifier (D166).** **(A)** remote cross-family verifier — the only option satisfying **253**
today, needs a funded key; **(B)** the corrected local flint re-run (Q4_K_M, **ctx ≥ 24k, `--parallel 1`**, bounding system
message, ~40 min GPU, no money) — highest-value cheap lever, **but the box refuses today** (swap 64 %); **(C)** verification
stays uncertified and `single-model-rig` stays red as an honest finding (D137). **Recommendation unchanged: (B) then (A).
Do not route ministral** — fast + wrong on 16/16 clean controls would clear `single-model-rig` while making verification worse.
A **release order for the portability class** is `pm`'s/`lead`'s verb and now has a row (**#4858**); it becomes actionable
the moment the operator rules on whether a broker may run at all here.

## Do not "fix" these on the strength of the docs

**A `BLOCK seat-shell-availability` is not advice to bypass it, and it is not proof the whole start is unsafe** — the
operator's ruling now has a name (`--ack-coordinator-wake`), and that name **refuses** when any wake-set seat keeps the
shell tool. **`--yes-pm-wakes` does NOT acknowledge the shell block** (measured: the first `--start` was refused with it).
**Delivered ≠ woken**; `SKIP <seat> reason=pending` is a per-seat suppression, and no broker-level remedy fixes it —
`resume` does, with the broker stopped. **`resume` cancels in-flight generations**; it cut `pm`'s decomposition short and
cost a second turn. **`send` is deprecated as a second harness owner** — admissible only with no broker running. **A
`queued` row is not a runnable row** on a host with no shell and foreign roots. **`git status` cannot see `.durig/` leaks**
at any depth; scan the filesystem by name. **A `--dry-run` that names no removals is not evidence there are none**; its
finding count moves for real reasons (probe transience, `live-tree-dirty` from my own edits) — **re-run before reporting,
and never read an exit code through a pipe** (`| tail` reports `tail`'s status; I nearly reported the portability gate as
exit 0). **A promoted instrument is "cited but untracked" until you stage it.** **Append to a growing file with `>>`; never
rewrite a file from its own contents** (D170) — and **diff names, not counts**. **Never quote shas.**
