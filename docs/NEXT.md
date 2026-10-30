# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T20:2xZ (**Z** — D177), host-local 2026-10-30 15:2x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D177).
Updated **in place** this session (197 lines, cap 200); the superseded 141-line pointer is cut **verbatim** to
`docs/NEXT-ARCHIVE.md` (entry marker line **8697**, body **8698–8833**), and D176's "What landed this session" section
was cut separately when D177 replaced it (marker **8835**, body **8839–8857**).

**BOTH VERIFY LEGS ON #4849 NOW EXIST, AND BOTH ARE IMPERFECT IN DIFFERENT WAYS — read both before anyone calls
this window verified.** qa's leg (row **#4890**) returned **`VERDICT: PROCEED`** on C1/C2 and is text-complete
(`.spike/fix-20261030/qa-4849-verdict.txt`), **but its row is still `claimed` and uncompleted**: qa claimed it,
read `shellregistry.mjs`, and was then destroyed by the rig's own compaction policy (below). qa2's leg (row
**#4891**) is **`done`** — `stopReason=stop`, PROCEED on C3 (the guard's set is _derived_: `export const
SHELL_TOOLS = new Set(shellToolNames())`) and C4 (no host-OS / per-seat shell field smuggled in), with the
**abstention line pm demanded** (`OUT-OF-SCOPE-NEEDS-RUNTIME-PROOF`: the 22 `spawn … ENOENT`, `bash` at execution
time, Windows paths) and its independence declared **UNESTABLISHED** rather than assumed. Verbatim:
`.spike/fix-20261031/qa2-4891-resultSummary.md`.

**THE SECOND LEG'S CITATIONS DO NOT RESOLVE, AND THE CITATION INSTRUMENT MISSES IT.** qa2 cited
`seatguard.mjs:350-354` for `SHELL_TOOLS` (it is at **`:144`**; 348–356 is an unrelated control-plane comment),
the `shellregistry.mjs` import at **line 20** (it is **`:22`**), and `SHELL_CANDIDATES` at **lines 20–30** (they are
at **`:79`**). I re-read all three regions in the seat root myself. `node tools/review-cite-check.mjs` on the dumped
summary returns **exit 0, `pathCites 1/0`** — it validates that a path exists and that a range is inside the file,
**not that the cited lines contain the cited symbol**. So a verifier can satisfy P1 Grounding's shape and still
point nowhere: the substance corroborates (my own read agrees the set is derived, and `shellToolNames()` maps
`SHELL_CANDIDATES` at `:106-107`), the citations are fabricated-looking, and no instrument catches the difference.
Row for this does not exist yet — pm has the report row **#4897** (qa2's own completion report, `queued`).

**AUTO-COMPACTION IS NOT "DEAD" ON THE VERIFIER WINDOW — IT IS A TRAP THAT FIRES TOO LATE, AND IT KILLED qa's LEG
TONIGHT.** D175's wording ("can never fire") is WRONG and is corrected in `docs/runbooks/compact-a-seat.md`.
Measured (`qa`, window 24,576): a turn went out at `input=17,445`; crossing the selection budget wrote a real
`pi.compaction` entry (**275457**); the next turn returned **`input=20,109, output=1, stopReason=length` with an
empty reply** (**275459**). Cause, from the shipped source: blocking = window − `reserveTokens` = 8,192 (fires
almost always) but `selectCut` refuses until `keepRecentTokens` = **20,000** tokens accumulate, and then the summary
_keeps the newest 20,000 anyway_ — so it cuts at the ceiling and leaves no room to answer. **This is the strongest
evidence yet for the #4887 values** (`keepRecentTokens 8192`, `reserveTokens 4096`, `backgroundTokens 8192`): with
them background fires at 12,288 while there is still room. `docs/runbooks/verifier-serving-headroom.md` Step 5 now
carries the reading cliff: **`src/seatguard.mjs` is 26,532 chars — a brief that lets a verifier read it whole
destroys the turn**, which is what happened; qa2's leg survived only because the reading was bounded.

**#4882 BIT AGAIN, THIS TIME ON THE DELEGATE, AND IT WAS REPAIRED.** qa2's `complete_work` re-pointed its persisted
cwd to the serving process's cwd — the **live checkout** — so pm, lead **and qa2** were all off the operator-approved
root. `up rig.selfdev.json --refresh --dry-run` named all three (`from: /home/chexxor/Git/Durian-Pi → to:
/home/chexxor/Git/durian-dev/seatroot`); the delegate applied it (grant 11: tree-shape acts on the approved root) and
re-ran the dry-run: **12 seats, `changes: {}`**. Worktree and branch inventories diffed before/after: unchanged.
**Next delegate: pre-flight the root before any `send`**, because the F12 guard (`cli.mjs:466`) fails closed the
other way once a seat's persisted cwd disagrees with `DURIG_SEAT_ROOT`.

## NEXT SESSION

**Current item: watch `impl` take row #4898 (`queued`, lead → impl) and release #4887 as the RECIPIENT — the
operator's authorization travels in #4898's body, not from the delegate.** The operator ruled **"Yes, I authorize
those actions"** at 19:1xZ on all three asks (build #4887; raise #4886; spend no further verifier capacity), and that
ruling reached the rig only because **`pm` proved unreachable at its context ceiling** — the delegate conveyed it to
**lead**, which answered `stopReason=stop` with three acts: **#4898 `queued`** (release instruction + corrected
premise + approved values + constraints), **#4899 `held`** (devtools — the citation-integrity class, #4891 as the
non-vacuous fixture), and a **prose** priority raise for #4886 it **could not enact** (row `held by pm`, tier still
`feature`; lead's own #4867 measurement says only sender or recipient may release, and `revise_work` sets no tier).
#4849 stays `claimed` by `impl`; pm's order in addendum #4894 stands: `impl` commits the 5 files FIRST (explicit
paths), then completes with `ROUTED …, NOT YET LANDED` and names the runtime half UNVERIFIED. Order of work is still
lead's: **217 → 263 → 264 → 221/265 → 266 → 267**, 232 gated on #4846.

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker line 8697, body
8698–8833); grants 1–11 and the older do-not lists live there, not here.

**Next commands (delegate, Linux; the first one is the actual next act):**

```bash
# 1. did impl take #4898 and move #4887 off `held`? If #4887 is still `held`, lead's act did not land.
DURIG_DB=./selfdev.sqlite node cli.mjs queue
# 2. is pm STILL unreachable? read the context fraction, not prose — 0.9225 is where it died
DURIG_DB=./selfdev.sqlite node cli.mjs status > .spike/status.json; node -e '
const fs=require("fs"),t=fs.readFileSync(".spike/status.json","utf8"),j=JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1));
console.log("pm context:",JSON.stringify(j.context.pm));console.log("pm last run:",JSON.stringify(j.latestByConv["3"]));
console.log("lead context:",JSON.stringify(j.context.lead));'
# 3. pre-flight the SHAPE before every send, never after (read-only, <1 s, 0 writes)
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # --seat qa | --json | --strict | --explain qa
node demo/seat-turn-shape.test.mjs                                  # its fixture; part of the suite
# 4. rig state — #4849 (impl) and #4890 (qa) MUST still be `claimed`; #4891 `done`; #4894-#4896, #4899 held
DURIG_DB=./selfdev.sqlite node cli.mjs queue
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # the seat-root drift, read-only
# 5. the verifier slot MUST still be 24576×1 — LM Studio restores 8192×4 on app relaunch
node -e 'fetch("http://127.0.0.1:1234/api/v0/models").then(r=>r.json()).then(j=>console.log(j.data.map(m=>[m.id,m.state,m.loaded_context_length].join(" "))))'
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader   # GPU0 ~15.2/16.4 GiB = verifier; GPU1 ~23.0 GiB = strata local
# 6. HOST RAM — this is what killed the delegate's own session on 2026-10-30; check it BEFORE loading the 441 MB store
free -h | head -2; awk '$1=="oom_kill"{print "kernel oom_kill since boot:",$2}' /proc/vmstat
cat /sys/fs/cgroup/user.slice/memory.peak        # 96,140,943,360 B ≈ 96.1 GB peak on a 94 GiB box
# 7. the clock-out trio, always all three, in BOTH trees
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs
node tools/instrument-provenance.mjs                                 # suite membership + cite resolution
git for-each-ref refs/rescued | wc -l                                # 489; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**THE OPERATOR RULED (D177), AND THE RULING IS THE TEAM'S TO ENACT, NOT THE DELEGATE'S TO OBEY-BY-HAND.** Asked
whether the opening "I accept your recommendations" covered the compaction build, the operator answered **"Yes, I
authorize those actions"** at 19:1xZ, covering: **(a) build #4887** (the `DURIG_COMPACTION_*` → `modelOverrides`
change, values and call site in `docs/runbooks/compact-a-seat.md`); **(b) raise #4886's priority**; **(c) spend no
further verifier capacity** — fix the policy, don't widen the window. Recorded as grants **13–15** below and as
**D177** in `docs/DECISIONS.md`; carried into the queue by **lead** in **#4898**, not by the delegate. **Still open
and still an act a seat owes:** #4886's _tier_ is unchanged (`feature`, `held by pm`) — lead ruled the priority in
prose and cannot set a tier. The research prompt
`docs/reviews/seat-scoped-durable-state-research-prompt.md` still sits with the operator; it is the only trigger
for **#4885**.

**Channel:** `send` remains the only wake on this host (a broker start is still refused on `seat-shell-availability`,
which carries **no ack flag**). `send` prints `DEPRECATED … prefer intent.mjs` — with the broker down that advice is
inert, and it is the only verb that wakes a seat here.

**Blocker:** hard, new in D177 — **`pm` cannot receive anything.** Its context is **184,507 / 200,000 = 0.9225** and its
run died _inside_ compaction — `status` `latestByConv["3"].detail`: **`Compaction failed: Summarization hit the token
limit; the summary is incomplete`**. The delegate's findings brief is **in pm's history as an unanswered user turn
(275487/275488)**, so it is recoverable the moment pm can run; do NOT re-send it (a second send is a deposit).
`compact` cannot fix this: it is itself a summarization call, and it failed on **two** seats — pm at 184,507/200,000
and **qa2 at 18,453 / 24,576** (`no compaction entry was written`, tasks 275491 and 275492) — which is #4876
reproduced on a small seat. So the rig has **no non-amnesiac repair** for a seat at its ceiling, and `reset` (#4886) is
the only one: that is the operator's call for `pm`, whose routing history is load-bearing. Soft blocker unchanged: a
verifier leg cannot finish until the compaction policy is configured — **the only leg that ever completed was bounded
by hand.** Do not re-drive `qa`'s #4890 blind: its post-compaction context is already ~20k.

## What landed this session (D177), with its evidence

- **The operator's ruling reached the rig without the delegate doing a seat's work.** `pm` was unreachable
  (context 184,507/200,000; `Compaction failed: Summarization hit the token limit`), so the delegate conveyed the
  ruling to **lead**, which produced `stopReason=stop` and three store acts, verified in the queue rather than
  trusted from prose: **#4898 `queued` lead→impl** (release #4887 yourself, corrected premise, approved values,
  constraints), **#4899 `held` lead→devtools** (cite-check proves path-exists + range-fits, never that the range
  _contains_ the cited symbol; #4891 as the non-vacuous fixture), and a **prose** #4886 priority raise that lead
  **could not enact** — its own #4867 measurement says only sender/recipient may release and `revise_work` sets no
  tier. The lead run survived because it was detached with `setsid`.
- **`compact` is broken as a repair on two seats, not one** — pm (184,507/200,000) and qa2 (**18,453/24,576**):
  `no compaction entry was written`, tasks 275491 / 275492, and the `status` detail names the cause: the
  summarization call itself hits the limit. #4876 reproduced on a small seat; no durable entry written either time.
- **The delegate's own session was killed mid-`send`** — evidence in `docs/incidents/2026-10-30-delegate-session-lost-to-host-memory-pressure.md`.

## Rig state, re-measured at clock-out 2026-10-30T20:2xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (this session's backup `.spike/fix-20261031/store-backup-20261030-135039.sqlite`,
before the `reset`/`up` writes); 12 seats; **all 12 now on the approved root** `/home/chexxor/Git/durian-dev/seatroot`,
branch `seatroot/linux`. **Queue census 4,899 = 3,757 done / 780 cancelled / 321 held / 22 queued / 17 deferred /
2 claimed (#4849 `impl`, #4890 `qa`) → CLAIMABLE 22.** **Broker DOWN, deliberately.** **Verifier** LM Studio
Ministral-3-14B-Reasoning Q6_K on **GPU0** (`:1234`, 15,214/16,376 MiB, **ctx 24576, parallel 1**, verified via
`GET /api/v0/models` `loaded_context_length`); **local** `strata` `iq3_s` on **GPU1** (~22,950/24,576 MiB) — pm,
impl, lead, scribe, devtools, security, architect; verifier family (qa, qa2, advocate, auditor, designer) on GPU0.
**Turn shape at clock-out (the instrument, not memory):** **11 findings across 12 seats, 5 with a counted-projection
parity break, 9 seats `AT RISK` for their next `send`, 3 `ADMISSIBLE`** (`.spike/fix-20261031/turn-shape-clockout.txt`).
**Worktrees 2** (`reapable 0` is not a verdict, 266). **`LocalRTC=yes`** on a dual-boot box while every gate is
`Date.now()` arithmetic — `timedatectl set-local-rtc 0` is the operator's call (ROADMAP 234). `probe-preflight`
REFUSES (swap max 50 %), so no probe arm may start.

## OPERATOR GRANTS (fifteen through D177)

1–9. Unchanged from the archived pointer (seat-root ruling A; the "queue drains" predicate; mint the refs; instrument hygiene; the
verifier paths; decomposition-not-seats with the scale gate; the Linux isolated seat root; the `send` bootstrap while the broker is
un-startable; research-don't-re-architect). 10. **Host model-serving may be changed through the vendor's own API** — report the headroom you measured; do not spend it again
unasked. (Not spent this session.) 11. **Tree-shape acts on the approved seat root are the delegate's** — used: `up … --refresh` re-pointed three seats onto the root. 12. **A4000 headroom may be spent for the verifier** — a capacity spend, not a licence to keep raising (KV is 160 KiB/token here). 13. **The #4887 compaction-config build is AUTHORIZED** (operator, 19:1xZ: "Yes, I authorize those actions") — a grant
to _build it_, held by the team as rows #4887 + #4898; it is not a licence for the delegate to edit `src/`. 14. **#4886's priority RAISE is AUTHORIZED** — enacted only in prose by lead; the tier act is still owed by a seat. 15. **No further verifier capacity for this leg** — the standing grant 12 stays unspent on purpose; report rather than
spend it "while we're at it".

**The operator's opening "I accept your recommendations" was NOT treated as a grant widening any of the above. See
decision (a) under THREE DECISIONS.**

## Do not "fix" these on the strength of the docs

**A verifier that reads a 26 KB file whole loses the turn to its own compaction** (`seatguard.mjs` is 26,532 chars;
the dead band is `input ≳ 20,000` on a 24,576 window). **Auto-compaction CAN fire near the ceiling and then write a
summary that keeps the newest 20,000 tokens anyway** — "it never fires" is D175's error, re-measured 2026-10-30.
**A completed verify row can carry citations that point nowhere, and `review-cite-check.mjs` exits 0 on them** — it
checks existence and range, not content. **A seat's `complete_work` moves its persisted cwd to the serving process's
cwd** — run your `send` from the approved root and re-check with `up … --refresh --dry-run` (F12 then fails closed).
**An errored or length-cut turn leaves its user message and an empty assistant message in the conversation**; a bare
`reset` is what the shape defect makes the cure, and it costs the seat its context. **A provider that answers a
26-token probe is not healthy.** **`send` printing `DEPRECATED` is not a reason to start a broker.** **LM Studio
restores `--ctx-size 8192 --parallel 4` on app relaunch; its `--estimate-only` runs ~0.35 GiB low.** **`pgrep -f
"cli.mjs send …"` matches the shell that asked.** **Running any instrument inside a worktree silently changes the rig
it measures** — pin `DURIG_DB` to a scratch store there. **The portability audit's answer depends on which tree it
runs from** (#4895). **A `--dry-run` that names no removals is not evidence there are none.** **Never read an exit
code through a pipe.** **Append prose with a quoted heredoc + `cat >>`, never `printf`, and never put backticks
inside `git commit -m "…"` — use `-F <file>`.** **Run prettier only on the paths you authored, and NEVER on
`docs/NEXT-ARCHIVE.md` or a durable record you are appending to.** Measured this session: `npx prettier --write` on the
archive reflowed **976 diff lines of pre-existing verbatim prose** (`*word*` → `_word_`, hard-wrap, blank line after
every heading) and silently broke the "cut verbatim" claim — restore with `git show HEAD:<file> > <file>` and re-append.
`demo/format.test.mjs` does **not** gate repo-wide formatting: its own header says the format verb is
"explicit-paths-only and never a tree walk or a hook", and `docs/DECISIONS.md`, `docs/NEXT-ARCHIVE.md` and both
verifier runbooks are **unformatted at HEAD** (checked with `prettier --check`).
**`compact` cannot rescue a seat at its ceiling — it IS a summarization call and fails for the same reason the turn
failed** (pm 184,507/200,000: `Summarization hit the token limit`; qa2 at 18,453/24,576: `no compaction entry was
written`). **`resume`/`doctor` CANCELS a `placed` run, it does not retry it** (`cli.mjs:1101-1112`: `already_placed` →
`conv.abort()`), and it is a compound write. **`cli.mjs <verb> --help` RUNS THE VERB** — there is no per-verb help; the
delegate's `doctor --help` performed a real cancel (benign here, logged in D177). **A backgrounded seat run dies with
the harness unless it is detached with `setsid`** — tonight the delegate's session died mid-`send`, the child died with
it, and lead's submission was left `placed` (the brief itself survived in the conversation). **The host is out of RAM
headroom**: `strata-host` holds **50.6 GB RSS**, `user.slice` **memory.peak 96.1 GB** on a 94 GiB box with **swap 5.1/8
GiB used** and **`/proc/vmstat oom_kill 7`** (7 kernel OOM kills in this user's slice; the killed cgroups are transient
and their counters vanish, and **a SIGKILL leaves no core dump** — `coredumpctl` had cores at 02:30/02:43/11:28/11:29
and **none** in the crash window). Before loading the 441 MB store: check `free -h`, `/proc/vmstat`, and
`/sys/fs/cgroup/user.slice/memory.peak`, and keep **one** store copy, not five.
