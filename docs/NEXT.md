# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T21:5xZ (**D178**), host-local 2026-10-30 16:5x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D178).
Updated **in place** (this file is the pointer, cap 200); the superseded 198-line pointer is cut **verbatim** to
`docs/NEXT-ARCHIVE.md` (marker line **8860**, body **8862–9059**). Verbatim proof, re-runnable:
`sed -n '8862,9059p' docs/NEXT-ARCHIVE.md | diff - <(git show HEAD:docs/NEXT.md)` prints nothing.

## NEXT SESSION

**Current item: 217 and the compaction build are COMMITTED on branches, and 217's execution half is now proven BY A SEAT
— the open act is the MERGE RULING lead minted (#4904 `done`; #4907 is qa's verify leg, gated on the merge).** On the
operator's grant the delegate committed: `seatroot/linux` **`f8840349`** (#4849 / ROADMAP 217: new
`src/shellregistry.mjs` + `src/seattools.mjs` + `src/seatguard.mjs` + two demos, 273 insertions) and branch `item-4898`
**`9beb1ae3`** (#4887/#4898 compaction build, 3 files, 310 insertions). Nothing pushed, no merge, `main` untouched.

**THE SEAT RAN ITS OWN ACCEPTANCE — the artifact this rig had never produced.** `lead` minted **#4904** (lead→impl is a
permitted edge) precisely to be the *claimed item* `prepare_workspace` requires; `impl` claimed it, got
`WORKSPACE READY (created): …/seatroot/item-4904` (branch `item-4904`, tip read FIRST = `f8840349`), and ran six commands
with exit codes read with no pipe: `uname -s` → `Linux` **0**; `git rev-parse --short HEAD` → `f8840349` **0**;
`node --check` ×3 **0**; `demo/seatguard.test.mjs` → **"PASS — the guard holds"** **0**; `demo/seattools.test.mjs` →
**"PASS — the controls are wired"** **0**; `git status --short` → empty **0**. Its own suite printed the new rule passing:
`ok #3992: a shell command from a seat's OWN worktree is NOT refused`. Report = **#4908 → devtools**; store:
**#4904 `done` by impl @00:57:52Z**.

**So D178's blocker is SPLIT, and the split is the discovery.** A seat's shell works **inside its item worktree**; it is
still refused **in the shared checkout**, by design — "your seat cwd IS the SHARED checkout … call `prepare_workspace`
first", and that refusal text is 217's own wording naming `bash`. Chain for any seat-executed act: *claimed row →
worktree forked from a ref that carries the change → shell allowed there*. The delegate's commit was not "doing the
seat's work"; it supplied the missing ref that breaks the loop (no shell → no commit → no ref to fork → no shell).

**lead's merge ruling (in #4904's body, 00:52Z) — the delegate will NOT execute it, it is a seat act:** do NOT merge
`seatroot/linux` anywhere (it is **14 commits behind `main`**, 1 ahead — `3860e5d1` is the merge-base; lead's brief said 8,
re-count before acting on any lag number, and merging an older tree is the `595b714` failure mode). Land **217 first** by
author rebase onto `main` (#3271 author-owns-own-rebase), then **re-cut** `item-4898 @ 9beb1ae3` onto `main`+217 as a
stacked pair; compare per-file
**content**, not ancestry (#3337); pin the reviewed diff and treat a tip move as an abort. Neither set attempts `land.mjs`
before #4904's outputs exist — they exist now.

**Rows minted while this ran:** **#4905** (`devtools`, held) the org-edge question (`impl maySendTo` has no `lead`, yet
**27 rows `from=impl, to=lead`** exist, #42 … #4901); **#4906** (`devtools`, held, trivial) **delete** the "the shell tool
is powershell" sentence from `rig.selfdev.json` — devtools' ruling on it, unexecuted: per-seat instruction text should
name **no** shell tool, single source `shellToolNames()`; **#4907** (`qa`, held) the verify leg gated at mint time
(`blockedBy` #4904). **`devtools` then closed #4902/#4903/#4908/#4845 and minted #4910/#4914/#4915** (above).
**Un-gating condition for #4906/#4907/#4914/#4915: 217 reaching `main`.**

**THREE FINDINGS ARE NOW ROWS, not prose — `devtools` did that, in its own wake, and it corrected two delegate numbers
while doing it.** **#4915** (`devtools→lead`, **held, feature**): a fresh item worktree is **not a comparable
verification tree** — `prepare_workspace` itself printed `DEPENDENCY NOT LINKED … the sync-pi --link step FAILED
(vendor/pi-main is not built in this worktree … run --sync first)` and the versions are **identical (`1.3.0`) while the
artifacts differ** (lockfile copy vs the vendored build the pin validates against). That is the mechanism under the
delegate's `Durable SQLite schema version 2 … newer than supported version 1` and the 80-vs-187 package counts — which
**devtools could not re-verify** (no shell), so they stay delegate-measured. **#4914** (held, small): the landing-gate
instruments don't read the registered shell — `channel-preflight` §7 scrapes the vendored PowerShell fallback and will
print **"NO SHELL CAN START HERE" AFTER 217 LANDS**; `rig-portability-audit` printed the worktree failure with an **empty**
reason. **#4910** (`queued`): devtools' own `spawn powershell ENOENT`. **New class defect surfaced while filing them: a
seat cannot register a row to itself** (`org edge` refuses `devtools → devtools`), so held backlog for your own next
session needs another author — #4914/#4915 carry an explicit "re-mint it to `devtools` when the gate clears".

**TOP HAZARD, and it is the delegate's doing — read D180 before you touch a wake. `DURIG_SEAT_ROOT` is the ROOT SELECTOR,
not just a guard input.** A wake under it was refused because **another** seat's cwd had drifted (`impl` left in an
unlocked `item-4904` by #4904's `prepare_workspace`), and the error's own advice — "or unset `DURIG_SEAT_ROOT`" — moved
`devtools` from the approved root into **`/home/chexxor/Git/Durian-Pi`** (its newest `pi.agent` doc 4935 rev 2373156 says
so) and produced a **nested worktree `Durian-Pi/item-4902`** (clean, no commits, invisible to `git status`, visible to
`git worktree list`). Consequence: **two seats, same rig, same minute, two registrations** — `impl` at `f8840349` got
`bash`; `devtools` at landed `main` got `powershell` and **cannot spawn anything** (`src/shellregistry.mjs` does not exist
there). So "what the rig can do" is only true **of the tree you read it from**.

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker 8860, body 8862–9059) —
grants 1–12 and the older do-not lists live there, not here.

**Next commands (delegate, Linux; the first one is the actual next act):**

```bash
# 1. confirm no wake is running, read the rows (NOT the census), and re-verify both insurances still match the trees
pgrep -af "cli.mjs send impl" | grep -v pgrep || echo "no wake running (expected: settled done)"
tail -3 .spike/fix-20261101/send-impl-3.out   # settledStatus: done, stopReason: stop
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261101/q.json 2>/dev/null
node .spike/fix-20261101/rows.mjs 4849 4887 4890 4894 4898 4899 4900 4901 4904 4907 4908 < .spike/fix-20261101/q.json
(cd .spike/fix-20261101/insurance-4849 && sha256sum -c sha256sums.txt) && (cd .spike/fix-20261101/insurance-4898 && sha256sum -c sha256sums.txt)
git worktree list --porcelain | grep -c "^worktree"   # 4: main, seatroot, LOCKED seatroot/item-4898, seatroot/item-4904
# 2. pre-flight the ROOT THE HONEST WAY. `up … --refresh --dry-run` printing `changes: {}` is VACUOUS here (D178): the
#    target is `seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` (cli.mjs:679,794) and rig.selfdev.json declares 0 cwds. Keep
#    the dry-run only as a belt: with DURIG_SEAT_ROOT set it is the F12 guard that fails closed on drift.
node .spike/fix-20261101/read-cwd4.mjs      # newest pi.agent revision per seat (doc = conv+5); 13 rows, 1 orphan on a dead C:\ path
#    A WAKE MUST SET DURIG_SEAT_ROOT or it SELECTS A DIFFERENT CHECKOUT (D180: devtools got landed main, no shell, and left
#    a nested worktree in this repo). If the drift guard refuses because SOME OTHER seat moved, do NOT unset it — record it.
# 3. pre-flight the SHAPE and the REACHABILITY before every send, never after (read-only, seconds, 0 writes)
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # --seat impl | --json | --strict | --explain impl
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/fix-20261101/s.json 2>/dev/null
node .spike/fix-20261101/rows.mjs --context < .spike/fix-20261101/s.json; rm -f .spike/fix-20261101/s.json  # 23 MB dump
# 4. rig state — #4904/#4849/#4898 MUST still be `done`; #4902/#4903/#4908 `queued`→devtools; #4905/#4906/#4907 `held`;
#    #4887 `queued`→impl; #4890 `claimed`; #4894-#4896, #4899 `held`
git -C /home/chexxor/Git/durian-dev/seatroot rev-list --count seatroot/linux..main   # 13 behind
DURIG_DB=./selfdev.sqlite node cli.mjs queue
# 5. the wake channel — the ONLY wake on this host is `send`; channel-preflight says what a broker start would do
DURIG_DB=./selfdev.sqlite node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig rig.selfdev.json
node -e 'fetch("http://127.0.0.1:1234/api/v0/models").then(r=>r.json()).then(j=>console.log(j.data.map(m=>[m.id,m.state,m.loaded_context_length].join(" ")).join("\n")))' && nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader  # GPU0 ~15.2/16.4 verifier; GPU1 ~22.6/24.6 local
# 6. HOST RAM — check BEFORE loading the 441 MB store (this is what killed the delegate's session on 2026-10-30)
free -h | head -2; awk '$1=="oom_kill"{print "kernel oom_kill since boot:",$2}' /proc/vmstat; cat /sys/fs/cgroup/user.slice/memory.peak
# 7. the clock-out trio, always all three; plus the insurance re-check if anything touches the seat root
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs && node tools/instrument-provenance.mjs
git for-each-ref refs/rescued | wc -l       # 489; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**ASK THE OPERATOR — two questions now, and the delegate picks neither.** (1) **Landing:** both change sets are on
branches and 217's proof is a seat's own, so the only thing left is `lead`'s merge topology (217 rebased onto `main` by
its author, then `item-4898` re-cut on top; never merge `seatroot/linux`, **14 behind `main`**) — and **that rebase
un-gates #4906/#4907/#4914/#4915**, so it is now on the critical path for the whole team, not just for these two rows.
(2) **Which tree serves seats** (asked first-hand by `devtools` in #4910): landed `Durian-Pi` — host-blind, no shell on
Linux — or `durian-dev/seatroot @ f8840349`, which carries unlanded 217? Tonight the answer was accidental and differed
per seat. Standing ask unchanged: `pm` is at its ceiling and **`reset` (#4886) is the only repair**, at the cost of its
routing history; #4886's **tier is still `feature`, `held by pm`**.

**Channel:** `send` remains the only wake on this host (a broker start is refused on `seat-shell-availability`, which
carries **no ack flag** — that finding IS 217). `send` prints `DEPRECATED … prefer intent.mjs` — inert while the broker is.

**Blocker:** the D178 blocker is **resolved inside item worktrees and still refuses in the shared checkout — by design.**
A seat's shell runs real processes in its own item worktree (#4904: `uname`, `git log`/`rev-parse`/`status`,
`node --check`, both demo suites, all exit 0); in the shared checkout the guard refuses on degraded cwd. What is blocked
NOW is that **nothing is on `main`**: 217 sits on `seatroot/linux` `f8840349`, the compaction build on `item-4898`
`9beb1ae3`, so every instrument reading landed code still reports the old state (`rig-portability-audit.mjs` → NOT
PORTABLE, 2 findings; `channel-preflight` → `registered shell tool name: "powershell"`) until a seat executes lead's
rebase/re-cut. Separately: a fresh item worktree resolves an OLDER pi-durable (80 vs 187 packages; `Durable SQLite
schema version 2 … newer than supported version 1`) — measure from `main` or the seat root, never from a fresh worktree.
**Blocker (carried):** **`pm` cannot receive anything** — context **184,507 / 200,000 = 0.9225**, `latestByConv["3"]`
`status:unanswered`, `reason:model_error`, `Compaction failed: Summarization hit the token limit`. Its findings brief
sits in its history as an unanswered user turn (275487/275488) — do NOT re-send it; two completion reports are parked on
it (#4826, #4897, #4900). `compact` cannot repair a seat at its ceiling (it IS a summarization call — failed on pm at
184,507/200,000 and qa2 at 18,453/24,576, tasks 275491/275492); `reset` (#4886) is the only way, and it is amnesia.

## What landed this session (D179), with its evidence — durable record: `docs/DECISIONS.md` **D178 and D179**

- **The grant ran in order:** (b) two wakes from the seat root for the runtime proof → (a) the two commits, because the
  proof needed a ref to fork from → (c) the residue (win32 paths, 22 ENOENT arms, audit still NOT PORTABLE) unverified.
- **Insurance became a backup, not the only copy** (`insurance-4849`/`insurance-4898`: patch + verbatim copies +
  sha256sums, re-verified against the live trees at clock-out), and **seat-authored commit discipline is worth copying:**
  `impl` left `EXIT=__` placeholders in its own commit-message file with the rule that only a real runner may fill them —
  the delegate ran them in that tree, filled them, and appended a RUNNER block naming itself, the OS and the tree (#4858).

## Rig state, re-measured at clock-out 2026-10-31T01:0xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (441 MB); pre-wake backups in `.spike/fix-20261101/` (`…pre-send-20261030-161115.sqlite`,
`…pre-d179-193819.sqlite`, `…pre-devtools-20261030-224825.sqlite`). **Queue census = 4,915 rows: 3,764 done / 780
cancelled / 325 held / 28 queued / 17 deferred / 1 claimed (`#4890` `qa` only)** — **the census is never evidence here.**
Row level: **#4904/#4902/#4903/#4908/#4845 `done`**; **#4910 `queued` devtools→lead**; **#4914 (small) / #4915 (feature)
`held` devtools→lead**, both "re-mint to devtools when the gate clears"; #4905/#4906 `held` (devtools), #4907 `held` (qa),
#4887 `queued`→impl, #4894-#4896 `held` by pm, #4899 `held`. **3 queued rows park on the unreachable pm (#4826, #4897,
#4900)** — the re-wedge hazard, quantified.
**Broker DOWN, deliberately**; `channel-preflight`: `placed=0 queued=0`, 0 advancing conversations, "the wedge does NOT
survive a restart", 24 claimable rows so a start has real work to wake onto. **Context fractions (`status.context`, full
store):** pm **0.9225** (184,507/200,000), **impl 0.3961 (79,220/200,000 — it was 0.7985 mid-session: its consumed FELL
by half during the run, auto-compaction working — the strongest evidence yet for #4887/#4898)**, lead 0.3077,
**qa 0.8183 (20,110/24,576 — the dead band, do not re-drive blind)**, qa2 0.7667, **`advocate` 9.9589 (244,751/24,576)**
and **`architect` 1.0932 (218,645/200,000)**. **Instrument finding, route it, do not fix it: `status.attention` never
flags a seat whose fraction is over 1** — neither over-window seat appears in `attention` or on the blocked list. Take
the map from `rows.mjs --context` (unreachable: pm 0.92, advocate 9.96, architect 1.09; `latestByConv`
shows exactly one unanswered row, conv 3 = pm, `model_error`). **Turn shape:** 11 findings across 12 seats, 5 counted-projection parity breaks; **ADMISSIBLE only for `impl`, `qa`,
`qa2`**; the other nine AT RISK. **Models are local/verifier, not DeepInfra** — `rig.selfdev.json` serves `local/iq3_s`
(GPU1 22,579/24,576 MiB, ctx 200,000) and `verifier/mistralai/ministral-3-14b-reasoning` (GPU0 15,214/16,376 MiB,
`loaded_context_length` **24576**, parallel 1); the gitignored `durig.config.json` carries base URLs, no API key here.
**Persisted cwd drift (docs map conv+5): doc 14 = `impl` → `seatroot/item-4904` (unlocked); doc 4935 = `devtools` →
`/home/chexxor/Git/Durian-Pi`.** Both clean. **Worktrees 5** — the 5th is the nested `Durian-Pi/item-4902` (`item-4898`
locked; `item-4904` clean and **unlocked**). If you remove anything, remove it BY NAME after the workspace-move inventory,
never by sweep: `git worktree remove /home/chexxor/Git/Durian-Pi/item-4902`. **Branches 6**, `refs/rescued` **489**.
**Host:**
74 Gi used / 19 Gi available, swap 4.9/8 GiB, `/proc/vmstat oom_kill` **7 (unchanged)**, `user.slice memory.peak`
96,140,943,360 B (unchanged). **Clock-out trio PASS at the pre-commit HEAD** (re-run them at clock-out, always).

## OPERATOR GRANTS (fifteen through D177; none widened this session)

1–12 unchanged (see the archive). **13.** the #4887 compaction build is AUTHORIZED — a licence to *build* it, held as
rows #4887 + #4898, **not** a licence for the delegate to edit `src/`. **14.** #4886's priority RAISE is authorized, but
enacted only in prose; the tier act is owed by a seat. **15.** no further verifier capacity for this leg. **Grant 11
(tree-shape acts on the approved seat root) was NOT used to commit either change set** — D178 records the reason.

## Do not "fix" these on the strength of the docs

**A seat's shell WORKS in its own item worktree and REFUSES in the shared checkout — do not "fix" the refusal.** The
guard's degraded-cwd rule is correct and 217's own demo proves it (`ok #3992: a shell command from a seat's OWN worktree
is NOT refused`). To get any seat-executed act you need a **claimed row** first: `prepare_workspace` refuses without one
(`no claimed item #NNNN is yours`), and its **default** re-attaches to the most recently claimed item — pass the itemId
explicitly or you land in someone else's worktree. **`up … --refresh --dry-run`
printing `changes: {}` is not evidence about the seat root** when the rig file names no cwd. **A seat's `complete_work`
moves its persisted cwd to the serving process's cwd** — run `send` with **cwd = the approved seat root**, and NEVER unset
`DURIG_SEAT_ROOT` to get past a drift refusal: that is how a seat gets served from a **different checkout** (D180).
**`status.attention` never lists a seat whose `context` fraction
exceeds 1** (measured: `advocate` 9.96, `architect` 1.09, both absent) — compute reachability from `status.context`
before every wake. **A `DONE` verify row can cite lines that point nowhere and `review-cite-check.mjs` exits 0 on them.**
**Auto-compaction fires late, not never** (D176/D177), and **`compact` cannot rescue a seat at its ceiling**. **Never read
an exit code through a pipe.** **A `--dry-run` that names no removals is not evidence there are none.** **A backgrounded
seat run dies with the harness unless detached with `setsid`.** **`cli.mjs <verb> --help` RUNS the verb; `resume`/
`doctor` CANCELS a `placed` run.** **Pin `DURIG_DB` — running an instrument inside a worktree silently changes the rig
it measures.** **A FRESH worktree has no gitignored `durig.config.json`, so a suite sweep run there returns a FALSE
RED** (#4895 tree-class). **Append prose with a quoted heredoc or `cat file >>`, never `printf`; never put backticks in
`git commit -m` — use `-F <file>`.** **Run prettier only on paths you authored, NEVER on `docs/NEXT-ARCHIVE.md` or a
durable record you are appending to.** **LM Studio restores `8192×4` on relaunch.**
