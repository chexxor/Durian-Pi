# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T21:5xZ (**D178**), host-local 2026-10-30 16:5x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D178).
Updated **in place** (this file is the pointer, cap 200); the superseded 198-line pointer is cut **verbatim** to
`docs/NEXT-ARCHIVE.md` (marker line **8860**, body **8862–9059**). Verbatim proof, re-runnable:
`sed -n '8862,9059p' docs/NEXT-ARCHIVE.md | diff - <(git show HEAD:docs/NEXT.md)` prints nothing.

## NEXT SESSION

**Current item: the wake did its work — now TWO verified change sets sit UNCOMMITTED and await a LANDING RULING that
only the operator or lead can make.** Row **#4849** (ROADMAP 217, 5 files in the seat root) and the **#4898/#4887
compaction build** (3 files in worktree `item-4898`). Neither author can commit: **no seat has a shell on this host**
(the new hard blocker below), so the delegate insured both. Secondary current item: route the `CONFIG_KEYS` finding to
`lead` — it needs a `send`, and `lead` is `AT RISK` on turn shape but at only 0.308 of its window.

**THE RUN SETTLED (`settledStatus: done`, `stopReason: stop`), and BOTH acts are verified in the store, not from its
prose:** `#4849` **`done`** by `impl` @21:14:31Z with the honest `ROUTED …, NOT YET LANDED` summary and an explicit denial
of any commit by it; `#4887` **released by `impl`** @21:14:52Z, now **`queued`**; `#4898` **`done`** @21:31:09Z. **The
census moved NOT AT ALL** (4,901 rows, per-status counts identical to D177) — full row state is under "Rig state" below.

**The build EXISTS, UNCOMMITTED, in a new worktree.** `impl` used `prepare_workspace` (a tool, so no shell was needed)
and created **locked worktree `/home/chexxor/Git/durian-dev/seatroot/item-4898`** on branch `item-4898` at base
`3860e5d1`; `git worktree list` went 2 → 3, so any sweep must name it (ROADMAP 266: "`reapable 0` is not a verdict").
It is in the **approved shape**: `compactionSettings(config)` at `src/config.mjs:361`, **exactly one** call site
(`cli.mjs:430`: `settings: { ...streamSettings(CFG), ...compactionSettings(CFG) }`), plus `compactionReport` used at
`cli.mjs:1363` (the three-state reporting fix). Diff: `src/config.mjs` +145, `cli.mjs` +67/−12,
`demo/config.test.mjs` +112, **nothing committed**. **Both dirty worktrees are now insured**: `insurance-4849` (5 files,
245-line patch) and **`insurance-4898`** (3 files, 405-line patch, `sha256sum -c` all OK) — because the harness reaps
clean terminal worktrees and these are dirty *by necessity*, so nothing will protect them otherwise.

**Delegate-run verification (the #4858/#4864 carve-out — #4901 makes it the seat's own routing; runner: delegate, tree
named with every exit code, `DURIG_DB` pinned):** in `…/seatroot/item-4898`, `node --check` exit 0 ×3 and **
`node demo/config.test.mjs` exit 0** including its new **"COMPACTION POLICY OK (unset invents nothing, verifier triple
reaches `Harness.open`, bad values fail loudly, three report states)"** — D177's predicted `DURIG_MODEL_*` regressions
did NOT fire. Full sweep `for f in demo/*.test.mjs`: **2 RED, both attributed** — `deepinfra-catalog.test.mjs` RED at
`main` too (no key, environmental); `local-model-pointer.test.mjs` RED **only in that worktree**, PASSING in the seat
root, because a fresh worktree has **no gitignored `durig.config.json`** → no `local` provider → it fails closed: a
**false RED of the #4895 tree-class**, not a regression.

**TWO FINDINGS the team owes an act on — report them, do not fix them yourself.** (1) The **five** new
`DURIG_COMPACTION_*` keys (`ENABLED`, `MODEL_OVERRIDES`, `RESERVE_TOKENS`, `KEEP_RECENT_TOKENS`,
`BACKGROUND_TOKENS`) are **not registered in `CONFIG_KEYS`**, which **does exist at `src/config.mjs:111` in the seat's
own tree** — the seat's flag that "there is no `CONFIG_KEYS` list" is FALSE, and the repo's convention asserts
membership (`demo/local-provider.test.mjs:75`, `demo/second-local-provider.test.mjs:146`:`assert.ok(CONFIG_KEYS.includes
(key), …)`), which `impl`'s new demo does not, so nothing catches the gap. The values DO reach `Harness.open` (proved
above), so this is a conformance defect, not a runtime one. (2) The seat's flag that its worktree had **no
`node_modules`** was **false at measurement** — it is there with `@mariozechner/pi-coding-agent` 3.1.6 and 2.8.3 — and
that flag is why the pinned pi-durable key spellings were left unverified: they can now be checked against the extracted
vendor source.

**THE COMMIT IS NOW A RULING, NOT A TASK — the operator's or lead's to make (options under "ASK THE OPERATOR").**
Measured: **no seat has a shell on this host**, so pm's addendum **#4894** ("`impl` commits the 5 files FIRST") is
inenactable by its recipient and is still `held`; D178 records why the delegate took none of the three paths. **Loss
hazard is neutralised twice**: `.spike/fix-20261101/insurance-4849/` (245-line patch + 5 verbatim files + manifest naming
tree/branch/HEAD `3860e5d1`) and `.spike/fix-20261101/insurance-4898/` (405-line patch + 3 files) — both re-verified
**byte-identical to the live trees at clock-out**, `sha256sum -c` clean.

**Both verify legs on #4849 are in, and the delegate re-read their substance in the seat's own tree.** qa (**#4890**,
still `claimed`) PROCEED C1/C2; qa2 (**#4891**, `done`) PROCEED C3/C4 with the abstention pm demanded and independence
UNESTABLISHED. Real numbers: import `src/seatguard.mjs:22`, `SHELL_TOOLS = new Set(shellToolNames())` at **`:144`**,
`SHELL_CANDIDATES` at `src/shellregistry.mjs:79` — qa2's cites point nowhere yet `review-cite-check.mjs` exits 0 on them
(lead's **#4899**, `held`, owns that class; do not fix it by hand).

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker 8860, body 8862–9059) —
grants 1–12 and the older do-not lists live there, not here.

**Next commands (delegate, Linux; the first one is the actual next act):**

```bash
# 1. confirm the settled state, the rows, and re-verify both insurances still match the live trees
pgrep -af "cli.mjs send impl" | grep -v pgrep || echo "no wake running (expected: settled done)"
tail -3 .spike/fix-20261101/send-impl.out    # settledStatus: done, stopReason: stop
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261101/q.json 2>/dev/null
node .spike/fix-20261101/rows.mjs 4849 4887 4890 4894 4898 4899 4900 4901 < .spike/fix-20261101/q.json
(cd .spike/fix-20261101/insurance-4849 && sha256sum -c sha256sums.txt) && (cd .spike/fix-20261101/insurance-4898 && sha256sum -c sha256sums.txt)
git worktree list --porcelain | grep -c "^worktree"   # 3: main, seatroot, LOCKED seatroot/item-4898
# 2. pre-flight the ROOT THE HONEST WAY. `up … --refresh --dry-run` printing `changes: {}` is VACUOUS here (D178): the
#    target is `seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` (cli.mjs:679,794) and rig.selfdev.json declares 0 cwds. Keep
#    the dry-run only as a belt: with DURIG_SEAT_ROOT set it is the F12 guard that fails closed on drift.
node .spike/fix-20261101/read-cwd4.mjs      # newest pi.agent revision per seat; 12 seatroot + 1 orphan on a dead C:\ path
# 3. pre-flight the SHAPE and the REACHABILITY before every send, never after (read-only, seconds, 0 writes)
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # --seat impl | --json | --strict | --explain impl
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/fix-20261101/s.json 2>/dev/null
node .spike/fix-20261101/rows.mjs --context < .spike/fix-20261101/s.json; rm -f .spike/fix-20261101/s.json  # 23 MB dump
# 4. rig state — #4849 and #4898 MUST still be `done`; #4887 `queued`; #4890 `claimed`; #4894-#4896, #4899 `held`
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

**ASK THE OPERATOR (one question, three options) — do not pick for them.** "Two verified, insured, UNCOMMITTED change
sets wait on you — the 217 five files in the seat root, and the compaction build in worktree `item-4898`. The seats that
authored them say so themselves (#4900: "**Nothing is committed by me** … I have **NO working shell** in this seat on
this host"). (a) the delegate commits both on the approved root, (b) a seat served from the seat root so the fix runs its
own commit (first runtime proof of 217, but it promotes unlanded code to the serving harness), or (c) they stay
uncommitted?" — (a) is narrower than it looked: a seat cleared BOTH acts with no shell, and `prepare_workspace` gave it a
worktree, so `git` is the only thing the missing shell blocks. Related open ask, unchanged: `pm` is at its ceiling and
**`reset` (#4886) is the only repair**, at the cost of its routing history; #4886's **tier is still `feature`, `held by
pm`**, because lead ruled the priority in prose and cannot set a tier.

**Channel:** `send` remains the only wake on this host (a broker start is still refused on `seat-shell-availability`,
which carries **no ack flag** — and that finding IS 217, so the refusal and the fix are the same defect). `send` prints
`DEPRECATED … prefer intent.mjs` — inert while the broker is down. The spool `./selfdev.sqlite.broker.inbox` holds **2
pending intents, both `op:read view:health`** (04:37Z, 04:43Z) — harmless, not work deposits.

**Blocker:** hard, NEW in D178 — **every plan that needs a seat to run `git`, `node`, or any shell verb is blocked on
this host.** Landed code registers only a PowerShell shell (`src/seattools.mjs:214-222`: "`bash` is deliberately
absent … the seat shell is PowerShell"; `createPowerShellTool()` resolves `pwsh` then `powershell`, neither present),
and `tools/rig-portability-audit.mjs` names the consequence: "**no git, no demo suite, and completions are
self-declared**". Note the split, because it is easy to "fix" wrongly: the *guard* at `src/seatguard.mjs:122` already
allows `bash` — it is the *tool registration* that does not. Until 217 lands, use the #4858/#4864 delegate-run carve-out
and name runner + tree.
**Blocker (carried):** **`pm` cannot receive anything** — context **184,507 / 200,000 = 0.9225**, `latestByConv["3"]`
`status:unanswered`, `reason:model_error`, `Compaction failed: Summarization hit the token limit`. Its findings brief
sits in its history as an unanswered user turn (275487/275488) — do NOT re-send it; two completion reports are parked on
it (#4826, #4897, #4900). `compact` cannot repair a seat at its ceiling (it IS a summarization call — failed on pm at
184,507/200,000 and qa2 at 18,453/24,576, tasks 275491/275492); `reset` (#4886) is the only way, and it is amnesia.

## What landed this session (D178), with its evidence — the durable record is `docs/DECISIONS.md` **D178**

- **D177's seat-root "proof" was vacuous; the honest read found a leaked root.** All 12 seats really are on
  `/home/chexxor/Git/durian-dev/seatroot`, proven by the newest `pi.agent` document revision each
  (`.spike/fix-20261101/read-cwd4.mjs`), not by the dry-run, which compares nothing to nothing (the rig file declares
  **0** cwds; target `cli.mjs:679`/`:794`). The store also carries a **13th `pi.agent` doc, 216675 rev 2263478, at
  `C:\Users\Alex\dsh-Projects\pi-opendurig`** — an orphan conversation, not a roster seat, so it never trips the F12
  guard and survives every `--refresh`. Also false on this build: `SELFDEV.md`'s claim that `ps`/`status` show each
  seat's `root` (#261) — `status.seats[]` really carries only name/conversationId/role/lastActivity.
- **The wake launched safely** — detached `setsid nohup`, cwd = the approved seat root, `DURIG_SEAT_ROOT` live (it did
  not fail closed), `--request-id`, store backed up first. The queue had sat ~1.5 h with zero movement because **no seat
  was awake**; one wake moved three rows and cleared both acts pm attached to the withdrawn #4894.
- **Delegate-run measurement in both trees** (the #4858/#4864 carve-out, which #4901 makes the seat's own routing): seat
  root — `demo/seatguard.test.mjs` exit 0 "PASS — the guard holds", `demo/seattools.test.mjs` exit 0 "PASS — the controls
  are wired"; `item-4898` — `node --check` ×3 exit 0, `demo/config.test.mjs` exit 0 with its new COMPACTION POLICY
  section, sweep 2 RED both attributed. Both insurances re-verified: **all 8 files byte-identical to the live trees**.

## Rig state, re-measured at clock-out 2026-10-30T21:5xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (441 MB); pre-send backup `.spike/fix-20261101/store-backup-pre-send-20261030-161115.sqlite`.
**Queue census = 4,901 rows: 3,759 done / 780 cancelled / 320 held / 24 queued / 17 deferred / 1 claimed (`#4890`**
**`qa` only)** — **per-status counts UNCHANGED from D177** despite two rows going `done`, one being released and two
reports appearing: **the census is never evidence here.** Row level: **#4849 `done` by impl 21:14:31**, **#4898 `done` by
impl 21:31:09**, **#4887 `queued`** (released by impl 21:14:52, `to=impl` — it left it for lead, correct: lead owns its
fate), #4890 `claimed`, #4891 `done`, #4894/#4895/#4896 `held` by pm, #4897 `queued`→pm, #4899 `held`. **The seat's own
reports are two NEW rows: #4900 `queued` impl→pm (feature) and #4901 `queued` impl→lead (small).** #4900 confirms D178
from inside the seat: "**Nothing is committed by me** … I have **NO working shell in this seat on this host**". **#4901
routes the compaction run to the DELEGATE** — "ROUTED to delegate for the run, NOT YET LANDED — no commit, no land …
three files … UNCOMMITTED in my item worktree … (branch `item-4898`, forked from `3860e5d1`)" — so the delegate-run
verification in this pointer is the seat's routing, not a workaround I chose. **3 queued rows now park on pm (#4826,
#4897, #4900)** — pm unreachable: the re-wedge hazard, quantified.
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
**Worktrees 3** (new one locked `item-4898`, nested in the seat root), **branches 4**, `refs/rescued` **489**. **Host:**
74 Gi used / 19 Gi available, swap 4.9/8 GiB, `/proc/vmstat oom_kill` **7 (unchanged)**, `user.slice memory.peak`
96,140,943,360 B (unchanged). **Clock-out trio PASS at the pre-commit HEAD** (re-run them at clock-out, always).

## OPERATOR GRANTS (fifteen through D177; none widened this session)

1–12 unchanged (see the archive). **13.** the #4887 compaction build is AUTHORIZED — a licence to *build* it, held as
rows #4887 + #4898, **not** a licence for the delegate to edit `src/`. **14.** #4886's priority RAISE is authorized, but
enacted only in prose; the tier act is owed by a seat. **15.** no further verifier capacity for this leg. **Grant 11
(tree-shape acts on the approved seat root) was NOT used to commit either change set** — D178 records the reason.

## Do not "fix" these on the strength of the docs

**A seat cannot commit its own work here, and its plan may assume it can** — no seat shell on Linux
(`src/seattools.mjs:214-222`); the *guard* allowing `bash` is not the *tool* offering it. **`up … --refresh --dry-run`
printing `changes: {}` is not evidence about the seat root** when the rig file names no cwd. **A seat's `complete_work`
moves its persisted cwd to the serving process's cwd** — run `send` with **cwd = the approved seat root**. **Rows that
point a seat at a doc section ignore branch lag: `seatroot/linux` is 8 commits behind `main`** (values were inlined into
the brief; anchors re-verified in the seat's tree). **`status.attention` never lists a seat whose `context` fraction
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
