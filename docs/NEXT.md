# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T19:0xZ (**Z** — D176), host-local 2026-10-30 13:5x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D176).
The superseded 141-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (entry marker line **8697**, body **8698–8833**).

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

**Current item: give `pm` one batched findings brief (it holds the routing) — it needs the citation defect, the
compaction dead band, and the fact that #4890 is `claimed` but uncompleted — and get the operator's ruling on the
three things only the operator holds (below). #4849 stays `claimed` by `impl`; pm declined the landing act and
ruled the order in addendum #4894: `impl` commits the 5 files FIRST (explicit paths), then completes with
`ROUTED …, NOT YET LANDED` and names the runtime half UNVERIFIED.** Order of work is still lead's:
**217 → 263 → 264 → 221/265 → 266 → 267**, 232 gated on #4846.

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker line 8697, body
8698–8833); grants 1–11 and the older do-not lists live there, not here.

**Next commands (delegate, Linux; the first one is the actual next act):**

```bash
# 1. the batched findings brief to pm (local-model seat: ~12-15 min wall clock; write the file first, never inline)
DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=./selfdev.sqlite \
  node cli.mjs send pm --body-file .spike/fix-20261031/send-pm-findings.md
# 2. pre-flight the SHAPE before every send, never after (read-only, <1 s, 0 writes)
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # --seat qa | --json | --strict | --explain qa
node demo/seat-turn-shape.test.mjs                                  # its fixture; part of the suite
# 3. rig state — #4849 (impl) and #4890 (qa) MUST still be `claimed`; #4891 is `done`; #4894-#4896 held
DURIG_DB=./selfdev.sqlite node cli.mjs queue
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # the seat-root drift, read-only
# 4. the verifier slot MUST still be 24576×1 — LM Studio restores 8192×4 on app relaunch
node -e 'fetch("http://127.0.0.1:1234/api/v0/models").then(r=>r.json()).then(j=>console.log(j.data.map(m=>[m.id,m.state,m.loaded_context_length].join(" "))))'
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader   # GPU0 ~15.2/16.4 GiB = verifier; GPU1 ~23.0 GiB = strata local
# 5. the clock-out trio, always all three, in BOTH trees
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs
node tools/instrument-provenance.mjs                                 # suite membership + cite resolution
git for-each-ref refs/rescued | wc -l                                # 489; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**THREE DECISIONS ARE THE OPERATOR'S, NOT THE DELEGATE'S.** (a) **What "I accept your recommendations" covers.**
The operator said it at the start of D176; the delegate read it as approving the _plan of work_ and **did NOT
convert it into a release ruling on #4887** (the compaction config), because that row's body was written before the
mechanism was known and pm owns its release. Say which it grants and pm can act. (b) **pm's escalation: raise
#4886's priority?** Its workaround is a bare `reset`, i.e. **amnesia as a fix** — tonight `qa2` needed one and it
cost that seat 1,632 turns of context (dry-run first: `writes: 0`, then `resetEntryId 275460`). (c) **Whether to
spend more verifier capacity** — GPU0 has ~1,160 MiB free ≈ 4,096 tokens at 160 KiB/token; the delegate did NOT
raise the slot, since the dead band is a policy defect, not a size defect. The research prompt
`docs/reviews/seat-scoped-durable-state-research-prompt.md` still sits with the operator; it is the only trigger
for **#4885**.

**Channel:** `send` remains the only wake on this host (a broker start is still refused on `seat-shell-availability`,
which carries **no ack flag**). `send` prints `DEPRECATED … prefer intent.mjs` — with the broker down that advice is
inert, and it is the only verb that wakes a seat here.

**Blocker:** none hard. The soft one is that a verifier leg cannot finish until the compaction policy is configured:
**the only leg that ever completed was bounded by hand.** Do not re-drive `qa`'s #4890 blind — its post-compaction
context is already ~20k, so another send re-triggers the same cut and deposits another empty turn.

## What landed this session, with its evidence

- **Leg 2 executed to completion:** bare `reset qa2` (dry-run `writes: 0` → `resetEntryId 275460`), pre-flight
  `next send: ADMISSIBLE`, one bounded brief, **`stopReason=stop`**, `#4891 done by qa2` (claimed 18:51:08Z, done
  18:52:11Z), and qa2 minted its own report row **#4897** so the completion is recoverable from the store.
- **Leg 1's gap is now named instead of papered over:** qa claimed #4890 (18:42:52Z) and never completed it —
  entries 275452 (`read` → `shellregistry.mjs`, `input=17,445`), **275457** (`pi.compaction`), 275459
  (`input=20,109, output=1, length`, empty). The delegate deliberately did **not** close or re-drive it.
- **pm's rulings landed even though its turn errored** (`settledStatus: unanswered`, `settledReason: model_error`,
  `stopReason: toolUse`): **#4890 and #4891 released to `queued`**, and three new rows minted — **#4894** (impl:
  commit before completing; #4882 can strand the 5 files), **#4895** (`rig-portability-audit.mjs` answers
  differently per tree — the gate depends on where you stood), **#4896** (`seat-turn-shape.mjs` as pre-flight and as
  #4886's fixture source; the 6/12 parity break is a separate concern). All three are `held`.
- **Seat-root drift repaired:** `up rig.selfdev.json --refresh` re-pointed **pm, lead, qa2** to
  `/home/chexxor/Git/durian-dev/seatroot`; re-dry-run shows `changes: {}` for all 12; worktrees/branches unchanged;
  `refs/rescued` still **489**.
- **Docs:** `docs/runbooks/compact-a-seat.md` corrected from "effectively dead" to the measured trap (with the entry
  ids and usage figures); `docs/runbooks/verifier-serving-headroom.md` Step 5 gained the **reading cliff** (name the
  size of every file you point a seat at, and bound the read).

## Rig state, re-measured at clock-out 2026-10-30T19:0xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (this session's backup `.spike/fix-20261031/store-backup-20261030-135039.sqlite`,
before the `reset`/`up` writes); 12 seats; **all 12 now on the approved root** `/home/chexxor/Git/durian-dev/seatroot`,
branch `seatroot/linux`. **Queue census 4,897 = 3,757 done / 780 cancelled / 320 held / 21 queued / 17 deferred /
2 claimed (#4849 `impl`, #4890 `qa`) → CLAIMABLE 21.** **Broker DOWN, deliberately.** **Verifier** LM Studio
Ministral-3-14B-Reasoning Q6_K on **GPU0** (`:1234`, 15,214/16,376 MiB, **ctx 24576, parallel 1**, verified via
`GET /api/v0/models` `loaded_context_length`); **local** `strata` `iq3_s` on **GPU1** (~22,950/24,576 MiB) — pm,
impl, lead, scribe, devtools, security, architect; verifier family (qa, qa2, advocate, auditor, designer) on GPU0.
**Turn shape at clock-out (the instrument, not memory):** **11 findings across 12 seats, 5 with a counted-projection
parity break, 9 seats `AT RISK` for their next `send`, 3 `ADMISSIBLE`** (`.spike/fix-20261031/turn-shape-clockout.txt`).
**Worktrees 2** (`reapable 0` is not a verdict, 266). **`LocalRTC=yes`** on a dual-boot box while every gate is
`Date.now()` arithmetic — `timedatectl set-local-rtc 0` is the operator's call (ROADMAP 234). `probe-preflight`
REFUSES (swap max 50 %), so no probe arm may start.

## OPERATOR GRANTS (twelve through D175; none widened this session)

1–9. Unchanged from the archived pointer (seat-root ruling A; the "queue drains" predicate; mint the refs; instrument hygiene; the
verifier paths; decomposition-not-seats with the scale gate; the Linux isolated seat root; the `send` bootstrap while the broker is
un-startable; research-don't-re-architect). 10. **Host model-serving may be changed through the vendor's own API** — report the headroom you measured; do not spend it again
unasked. (Not spent this session.) 11. **Tree-shape acts on the approved seat root are the delegate's** — used: `up … --refresh` re-pointed three seats onto the root. 12. **A4000 headroom may be spent for the verifier** — a capacity spend, not a licence to keep raising (KV is 160 KiB/token here).

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
