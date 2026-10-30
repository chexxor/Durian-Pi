# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T21:5xZ (**D178**), host-local 2026-10-30 16:5x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D178).
Updated **in place** (this file is the pointer, cap 200); the superseded 198-line pointer is cut **verbatim** to
`docs/NEXT-ARCHIVE.md` (marker line **8860**, body **8862–9059**). Verbatim proof, re-runnable:
`sed -n '8862,9059p' docs/NEXT-ARCHIVE.md | diff - <(git show HEAD:docs/NEXT.md)` prints nothing.

## NEXT SESSION

**Current item: read what the IN-FLIGHT wake of `impl` did — rows #4849 (its `claimed` authorship), #4898 (lead's
release instruction) and #4887 (the operator-authorized compaction build).** The delegate woke `impl` at
21:1xZ with a `send` that is **still running detached**: pid **3749229**, output
`.spike/fix-20261101/send-impl.out`, brief `.spike/fix-20261101/brief-impl-4849-4887.md`, retried only with
`--request-id d178-impl-4849-4887` (a bare retry is a second deposit). It was launched with **cwd = the approved seat
root** and `DURIG_SEAT_ROOT` set, which is what prevents the #4882 cwd re-point at the source instead of repairing it
afterwards. At clock-out the seat root still held the 5 files UNCOMMITTED and no Act-2 file existed yet — so treat the
run as UNSETTLED, and read `settledStatus` from the out file rather than assuming either half happened.

**THE COMMIT IS NOW A RULING, NOT A TASK — and it is the operator's or lead's to make.** Measured: **no seat has a
shell on this host**, so pm's addendum **#4894** ("`impl` commits the 5 files FIRST") is inenactable by its recipient.
Three enactable paths exist and the delegate took none of them (D178): (a) the delegate commits on the approved root
(inside grant 11, but it authors a commit into another actor's `claimed` item and pre-empts the landing gates);
(b) serve the seat from the seat root, where its own uncommitted 217 code selects `bash` — measured at code level:
`selectSeatShell()` → `{"name":"bash","degraded":false}`, `programOnPath("bash")` → `/usr/bin/bash` — but that promotes
unverified code to the serving harness and manufactures the very runtime evidence qa2 abstained from; (c) leave the
files uncommitted. Loss hazard is **already neutralised**: `.spike/fix-20261101/insurance-4849/` holds the 245-line
patch, verbatim copies of all five files, a manifest naming tree/branch/HEAD `3860e5d1`, and `sha256sum -c` verifies
all seven entries.

**Both verify legs on #4849 are in and the delegate corroborated their substance in the seat's own tree.** qa
(row **#4890**, still `claimed`) PROCEED on C1/C2; qa2 (row **#4891**, `done`) PROCEED on C3/C4 with the abstention pm
demanded and independence UNESTABLISHED. The real line numbers, re-read by the delegate: the import is
`src/seatguard.mjs:22`, `export const SHELL_TOOLS = new Set(shellToolNames())` is at **`:144`**, `SHELL_CANDIDATES` is
at `src/shellregistry.mjs:79`. qa2's cites (20 / 350-354 / 20-30) point nowhere; `tools/review-cite-check.mjs` still
exits 0 on them (lead's row **#4899**, `held`, carries that class — do not fix the checker by hand).

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker 8860, body 8862–9059);
grants 1–12 and the older do-not lists live there, not here.

**Next commands (delegate, Linux; the first one is the actual next act):**

```bash
# 1. did the impl wake settle, and what did it DO? read the out file, then the three rows.
pgrep -af "cli.mjs send impl" | grep -v pgrep || echo "process gone"; tail -30 .spike/fix-20261101/send-impl.out
DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/fix-20261101/queue-2.json; node -e '
const fs=require("fs"),t=fs.readFileSync(".spike/fix-20261101/queue-2.json","utf8");
const j=JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1)),by=Object.fromEntries(j.items.map(i=>[i.id,i]));
for(const id of [4849,4887,4890,4894,4897,4898]){const r=by[id],l=r.transitions.at(-1);
console.log(["#"+id,r.status,r.from+"->"+r.to,"tier="+r.tier,l.event+" by "+l.by+" @"+l.at].join(" | "));}'
# 2. pre-flight the ROOT THE HONEST WAY. `up … --refresh --dry-run` printing `changes: {}` is VACUOUS here (D178):
#    the target is `seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` (cli.mjs:679,794) and rig.selfdev.json declares 0 cwds.
node .spike/fix-20261101/read-cwd4.mjs      # newest pi.agent revision per seat; 12 seatroot + 1 orphan on a dead C:\ path
DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run
# 3. pre-flight the SHAPE before every send, never after (read-only, <2 s, 0 writes)
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # --seat impl | --json | --strict | --explain impl
node demo/seat-turn-shape.test.mjs                                  # its fixture; part of the suite
# 4. rig state — #4849 (impl) and #4890 (qa) MUST still be `claimed`; #4891 `done`; #4894-#4896, #4899 held
DURIG_DB=./selfdev.sqlite node cli.mjs queue
DURIG_DB=./selfdev.sqlite node cli.mjs status > .spike/fix-20261101/status-2.json
# 5. the wake channel — the ONLY wake on this host is `send`; channel-preflight says what a broker start would do
DURIG_DB=./selfdev.sqlite node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig rig.selfdev.json
node -e 'fetch("http://127.0.0.1:1234/api/v0/models").then(r=>r.json()).then(j=>console.log(j.data.map(m=>[m.id,m.state,m.loaded_context_length].join(" ")).join("\n")))'
node -e 'fetch("http://127.0.0.1:47831/v1/models").then(r=>r.json()).then(j=>console.log(JSON.stringify(j.data[0]?.id)))'
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader   # GPU0 ~15.2/16.4 GiB verifier; GPU1 ~22.6/24.6 GiB local
# 6. HOST RAM — check BEFORE loading the 441 MB store (this is what killed the delegate's session on 2026-10-30)
free -h | head -2; awk '$1=="oom_kill"{print "kernel oom_kill since boot:",$2}' /proc/vmstat; cat /sys/fs/cgroup/user.slice/memory.peak
# 7. the clock-out trio, always all three; plus the insurance re-check if anything touches the seat root
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs
node tools/instrument-provenance.mjs
(cd .spike/fix-20261101/insurance-4849 && sha256sum -c sha256sums.txt)
git for-each-ref refs/rescued | wc -l       # 489; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**ASK THE OPERATOR (one question, three options) — do not pick for them.** "The verified 217 work is insured and
uncommitted; the seat that authored it cannot run `git` on this host. Do you want (a) the delegate to commit it on the
approved seat root, (b) a seat served from the seat root so the fix runs its own commit (first runtime proof of 217,
and the risk of running unlanded code as the harness), or (c) it left uncommitted?" A related open ask, unchanged:
`pm` is at its ceiling and **`reset` (#4886) is the only repair**, which costs pm its routing history — the operator's
call. #4886's **tier is still `feature`, `held by pm`**: lead ruled the priority in prose and cannot set a tier.

**Channel:** `send` remains the only wake on this host (a broker start is still refused on `seat-shell-availability`,
which carries **no ack flag** — and that finding IS 217, so the refusal and the fix are the same defect). `send` prints
`DEPRECATED … prefer intent.mjs` — with the broker down that advice is inert. The spool
`./selfdev.sqlite.broker.inbox` holds **2 pending intents, both `op:read view:health`** (04:37Z, 04:43Z) — harmless,
not work deposits.

**Blocker:** hard, NEW in D178 — **every plan that needs a seat to run `git`, `node`, or any shell verb is blocked on
this host.** Landed code registers only a PowerShell shell (`src/seattools.mjs:214-222`: "`bash` is deliberately
absent … the seat shell is PowerShell"; `createPowerShellTool()` resolves `pwsh` then `powershell`, neither present),
and `tools/rig-portability-audit.mjs` names the consequence: "**no git, no demo suite, and completions are
self-declared**". Note the split, because it is easy to "fix" wrongly: the *guard* at `src/seatguard.mjs:122` already
allows `bash` — it is the *tool registration* that does not offer it. Until 217 lands, seat-authored acceptance cannot
be run by the seat: use the #4858/#4864 delegate-run carve-out and name runner + tree.
**Blocker (carried):** **`pm` cannot receive anything** — context **184,507 / 200,000 = 0.9225**, `latestByConv["3"]`
`status:unanswered`, `reason:model_error`, `Compaction failed: Summarization hit the token limit`. Its findings brief
sits in its history as an unanswered user turn (275487/275488); do NOT re-send it. Two completion reports are parked on
it (#4826, #4897). `compact` cannot repair a seat at its ceiling (it IS a summarization call — failed on pm at
184,507/200,000 and on qa2 at 18,453/24,576, tasks 275491/275492); `reset` (#4886) is the only way, and it is amnesia.

## What landed this session (D178), with its evidence

- **The seat-root "proof" that D177 relied on was vacuous, and the real read found a leaked root.** All 12 seats are
  genuinely on `/home/chexxor/Git/durian-dev/seatroot` — proven by the newest `pi.agent` document revision each
  (`.spike/fix-20261101/read-cwd4.mjs`), not by `up … --refresh --dry-run`. That dry-run compares nothing to nothing
  here (rig file declares **0** cwds; target `cli.mjs:679`/`:794`). The store also carries a **13th `pi.agent` doc,
  216675 rev 2263478, at `C:\Users\Alex\dsh-Projects\pi-opendurig`** — an orphan conversation, not a roster seat, so it
  never trips the F12 guard and survives every `--refresh`. Also false: `SELFDEV.md` says `ps`/`status` show each
  seat's `root` (#261) — `status.seats[]` has no such field.
- **The insurance act, with its integrity re-verified:** `.spike/fix-20261101/insurance-4849/` — 245-line patch,
  5 verbatim files, manifest naming tree/branch/HEAD, `sha256sum -c` all OK.
- **Delegate-run measurement of the seat's own claim** (the #4858 carve-out): in `/home/chexxor/Git/durian-dev/seatroot`
  at `3860e5d1` + the 5 files, `node demo/seatguard.test.mjs` exit 0 "PASS — the guard holds" and
  `node demo/seattools.test.mjs` exit 0 "PASS — the controls are wired"; exit codes read with no pipe.
- **The wake, launched safely:** detached `setsid nohup`, cwd = approved seat root, `DURIG_SEAT_ROOT` set so the F12
  guard is live (it did not fail closed), `--request-id` for idempotency, store backed up first
  (`.spike/fix-20261101/store-backup-pre-send-20261030-161115.sqlite`). Nothing moved in the queue for ~1.5 h before
  it, because **no seat was awake** — broker down, census byte-identical to D177 clock-out.

## Rig state, re-measured at clock-out 2026-10-30T21:5xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (441 MB); pre-send backup named above. **Queue census 4,899 = 3,757 done / 780 cancelled /
321 held / 22 queued / 17 deferred / 2 claimed (#4849 `impl`, #4890 `qa`) → CLAIMABLE 22** — identical to D177
clock-out. **Broker DOWN, deliberately**; `channel-preflight`: `placed=0 queued=0`, 0 advancing conversations, "the
wedge does NOT survive a restart", 22 claimable rows so a start has real work to wake onto. **Context fractions:**
pm **0.9225** (184,507/200,000), impl **0.756** (151,197/200,000), lead 0.308 (61,537/200,000), **qa 0.818
(20,110/24,576 — the dead band, do not re-drive blind)**, qa2 0.767 (18,842/24,576). **Turn shape:** 11 findings across
12 seats, 5 counted-projection parity breaks; **ADMISSIBLE only for `impl`, `qa`, `qa2`**; `pm`, `lead`, `scribe`,
`devtools`, `auditor`, `designer`, `security`, `advocate`, `architect` AT RISK. **Models are local/verifier, not
DeepInfra** — `rig.selfdev.json` serves `local/iq3_s` (strata, GPU1 22,579/24,576 MiB, ctx 200,000) and
`verifier/mistralai/ministral-3-14b-reasoning` (LM Studio GPU0 15,214/16,376 MiB, `loaded_context_length` **24576**,
parallel 1); `durig.config.json` (host layer, gitignored) carries the base URLs — no API key needed on this host.
**Worktrees 2**, branches 3, `refs/rescued` **489**. **Host:** 74 Gi used / 19 Gi available at clock-in, swap 4.9/8 GiB,
`/proc/vmstat oom_kill` **7 (unchanged)**, `user.slice memory.peak` 96,140,943,360 B (unchanged). **Clock-out trio
PASS at HEAD `d3332af2`**; `doc-integrity-guard` 0 hard / 1 soft.

## OPERATOR GRANTS (fifteen through D177; none widened this session)

1–12 unchanged (see the archive). **13.** the #4887 compaction build is AUTHORIZED — a licence to *build* it, held as
rows #4887 + #4898, **not** a licence for the delegate to edit `src/`. **14.** #4886's priority RAISE is authorized —
still enacted only in prose; the tier act is owed by a seat. **15.** no further verifier capacity for this leg.
**Grant 11 (tree-shape acts on the approved seat root) was deliberately NOT used to commit the 5 files** — that choice
and its reason is D178.

## Do not "fix" these on the strength of the docs

**A seat cannot commit its own work here, and its plan may assume it can** — no seat shell on Linux
(`src/seattools.mjs:214-222`); the *guard* allowing `bash` is not the *tool* offering it. **`up … --refresh --dry-run`
printing `changes: {}` is not evidence about the seat root** when the rig file names no cwd. **A seat's `complete_work`
moves its persisted cwd to the serving process's cwd** — run `send` with **cwd = the approved seat root**. **Rows that
point a seat at a doc section ignore branch lag: `seatroot/linux` is 8 commits behind `main`**, and #4898 pointed
`impl` at a runbook section that exists only on `main` (the approved values were inlined into the brief; code anchors
re-verified in the seat's tree — `src/config.mjs:246`, `cli.mjs:414`/`:423`, `cli.mjs:1344`). **A `DONE` verify row can
cite lines that point nowhere and `review-cite-check.mjs` exits 0 on them.** **Auto-compaction fires late, not never**
(D176/D177), and **`compact` cannot rescue a seat at its ceiling**. **Never read an exit code through a pipe.** **A
`--dry-run` that names no removals is not evidence there are none.** **A backgrounded seat run dies with the harness
unless detached with `setsid`.** **`cli.mjs <verb> --help` RUNS THE VERB.** **`resume`/`doctor` CANCELS a `placed` run.**
**Running any instrument inside a worktree silently changes the rig it measures — pin `DURIG_DB`.** **Append prose with
a quoted heredoc or `cat file >>`, never `printf`; never put backticks in `git commit -m` — use `-F <file>`.** **Run
prettier only on paths you authored, NEVER on `docs/NEXT-ARCHIVE.md` or a durable record you are appending to.**
**LM Studio restores `8192×4` on app relaunch.** **`pgrep -f "cli.mjs send …"` matches the shell that asked.**
**`LocalRTC=yes`** on a dual-boot box while every gate is `Date.now()` — `timedatectl set-local-rtc 0` is the operator's
call (ROADMAP 234). **`probe-preflight` REFUSES (swap max 50 %)**, so no probe arm may start.
