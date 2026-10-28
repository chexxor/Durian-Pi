# The channel-start pre-flight — what a broker start would actually do on this rig (2026-10-28, delegate)

**Question.** `docs/NEXT.md` ranks "keep the delivery channel resident" (**#725/#726/#727**, ROADMAP 63/64/67) as the
single largest measured wall-clock lever, and the start itself is an operator grant. Every pre-flight surface this rig
has (`tools/broker-serve.mjs --status`, `cli.mjs status`, `clockin`) answers **"is the broker process alive?"**. None
answered the two questions that decide whether a start buys anything: **is there anything claimable to wake onto**, and
**does store state already suppress the wake**. This review answers both, and ships the instrument that makes the answer
cheap: `tools/channel-preflight.mjs` (**1.9–2.0 s**, one queue read + one `ps` read + one `submissions`/`tasks`/`entries`
read, store opened `readOnly:true`, no Harness opened — D11).

**Host, named for every number here:** Linux (`Alex-Desktop-Win10`, Fedora), `node v24.22.1`, store `./selfdev.sqlite`
(438,329,344 B), box local zone `America/Chicago` (CDT = UTC−5); all timestamps below are **Z**. Measured
2026-10-28T19:20–19:23Z. Instrument output retained at `.spike/delegate/channel-preflight-2026-10-28.json`.

**Method that matters:** the verdicts are not my re-derivation. The tool **imports the product's own decision functions**
— `advancingConvIds`, `admissionVerdict`, `ADMISSION_DEADLINE_MS` (`src/broker.mjs`) and `selectWakes`
(`src/driver.mjs`) — and runs them over a read of the store, so "wake now / wake after pass 1" is the same code the
broker will run on its first pass.

---

## 1. The precondition chain, measured (four links, only one of them is the process)

| # | Link | Measured state | Consequence for a start |
|---|---|---|---|
| 1 | Channel process | `broker.json` pid **1771484 dead**, heartbeat **2.2 h stale**, `lastPassAt=2026-10-28T17:09:58.308Z`; **0** `cli.mjs serve\|run\|send\|resume\|doctor` processes alive | a start is the first pass in 2.2 h — this is the link everyone was looking at |
| 2 | **Head of queue** | **`queued`=0, `claimed`=0**; parked = 277 `held` + 19 `deferred` = **296** of 4,821 rows | **nothing is claimable.** A start wakes seats onto *parked rows only* (`src/driver.mjs:108` `hasParked`) — it cannot land work until `pm` releases |
| 3 | Suppressed wakes | **9 `placed` + 2 `queued`** unsettled input submissions across 9 conversations, all **2.3 h** old; `advancingConvIds()` counts **9 conversations as ADVANCING** | today every one of those 9 seats reads `skip:pending`; **after pass 1's reconcile all 9 read `WAKE`** — the wedge does *not* survive a restart (see §3) |
| 4 | Seat root | `DURIG_SEAT_ROOT` unset in the starting shell → `resolveSeatRoot(persistedCwd:undefined)` = **`process cwd` → `/home/chexxor/Git/Durian-Pi`, classified `main-worktree`** | a seat would run **in the live checkout** — the F12/F21 shape `src/seatroot.mjs` exists to refuse. ROADMAP **221** (the persisted-cwd half no CLI can print) is still unruled |

**The headline correction to `NEXT.md`:** the lever is not blocked only by the down marker. Link 2 means **a broker
started right now would wake nine seats and land nothing** — last `done` transition in the store is
**2026-10-22T17:29:11.923Z**, 6.1 days before this measurement. Resident-broker throughput history (47–132 items/day
`run`-invoked vs **314–741/day** resident) is only reachable once the head of the queue is non-empty, and **releasing is
`pm`'s verb**, not the delegate's and not the operator's.

## 2. What a start wakes, seat by seat (the selector's own verdicts)

| seat | claimable | held | deferred | oldest parked | wake **now** | wake **after pass-1 reconcile** |
|---|---|---|---|---|---|---|
| pm | 0 | 3 | 2 | 225.6 h | `skip:pending` | **WAKE** (reason `parked`) |
| impl | 0 | 164 | 13 | 280.8 h | `skip:pending` | **WAKE** |
| qa | 0 | 21 | 0 | 290.2 h | `skip:pending` | **WAKE** |
| lead | 0 | 4 | 1 | 252.0 h | `skip:pending` | **WAKE** |
| scribe | 0 | 44 | 0 | 290.0 h | `skip:pending` | **WAKE** |
| devtools | 0 | 33 | 2 | 290.3 h | `skip:pending` | **WAKE** |
| auditor | 0 | 2 | 0 | 239.2 h | `skip:pending` | **WAKE** |
| security | 0 | 6 | 0 | 260.1 h | `skip:pending` | **WAKE** |
| qa2 | 0 | 0 | 1 | 145.7 h | `skip:pending` | **WAKE** |
| advocate / designer / architect | 0 | 0 | 0 | — | `skip:no-work` | `skip:no-work` |

So the *shape* of the next useful hour on this rig is: **pass 1 reconciles the 9 orphans, then wakes 9 seats onto their
parked rows**; `pm` is the only seat that can turn parked rows into claimable ones, and `tools/queue-drain-audit.mjs`
(0.96 s) already says **71 of the 91 non-terminal `LANDING` rows are fully on main — 26% of the held backlog is
zero-build closable today**, plus **69 orphan candidates** whose cited gates are all terminal. Those two numbers are the
release brief; the delegate delivers them to `pm` as a spooled intent, never as a transition of its own
(body: `.spike/delegate/pm-release-brief-2026-10-28.md`).

### 2a. The three rows NEXT.md ranks first are in the orphan list, and the audit is wrong about them

`#725` (impl), `#726` (devtools) and `#727` (qa) appear among the 69 orphan candidates — their cited gates **#662 and
#710 are both `done`**. Their bodies carry more than those ids:

> `SEQUENCING CONSTRAINT (operator): do NOT start the daemon-host work before #662/#710 are done and the queue drains;
> not ahead of TUI.`

The id clauses cleared on 2026-10-17. **"the queue drains" is defined nowhere in the tree** — no threshold, no
predicate, no surface that prints a drain value — so the constraint cannot be shown satisfied, and all three rows have
been `held` since **2026-10-16/17** while the top lever sat unpulled. Two consequences, both load-bearing:

1. **The release decision on the top three rows is the operator's, not `pm`'s.** Anyone acting on the audit alone would
   have `release_work`'d them, which is exactly why `stale-held-backlog.md` says to read the body.
2. **A prose hold reason can be un-evaluable forever, and nothing distinguishes "gate false" from "gate unresolvable".**
   Registered as **ROADMAP 231**, alongside 229 (the missing submission age) and 230 (no surface for the channel-start
   question this review exists to answer).

## 3. The suppression half — why a restart self-heals, and what it does not

`reconcileStrandedSubmissions` (`src/broker.mjs:899`) settles any `placed` submission whose conversation has **no
advancing task**. Live-task evidence, read-only: **9 `pi.generation` task rows are persisted `running`** (`pi.generation:terminal=59851`, `pi.tool:terminal=44291`, `pi.compaction:terminal=1459`, `pi.generation:running=9`) while **no process exists that could own them** (broker pid dead, 0 driver processes). The honest limit of that read: `isAdvancingTask` tests pi-durable's **derived `state.kind`** from a live `#inspectTask`, which is **not persisted** — so the store says "9 rows claim to be running", the process table says "nothing can be", and only the live inspection joins them. Registered as part of ROADMAP **229**; this is the same black box as 225 seen from the other side.

Verdict the tool prints for each row: 9 × `SETTLE` (pass 1), 2 × `NONE — no admission timestamp` for `273999` (`requestId memory-decompose-v2`) and `274000` (`requestId 26d1d943-…`) — two **never-placed** `queued` rows at the head of **pm's** conversation, from intents delivered at 17:06Z by a previous session. A never-placed submission has **no admitted input entry**, so there is no timestamp to join and nothing can age it out.

## 4. The age field the product promises is absent where it would be used — measured twice

This is the part that changes an operator decision, because it decides whether a stall is *visible*:

- `src/broker.mjs:1341` `pendingAgeMs` supplies "the MEASURED age from that submission's `admittedAt`" (#4180), and
  `:1346` appends ` age=Ns` to the SKIP trace **when it is a number**. Measured in the retained
  `./selfdev.sqlite.broker.log` (**80 lines**, span `17:06:23.383Z → 17:09:58.308Z`, 6 passes): **45
  `SKIP … reason=pending` lines, 0 of them carry ` age=`**. The lookup reads the **raw** submission row; the entry join
  that recovers an admission timestamp lives only in `src/readapi.mjs:269-284` (and its own comment says the submission
  record "carries no admission timestamp"). So the trace that exists to separate *"admitted 2 s ago"* from *"stalled 10 h"*
  prints neither number.
- `admissionVerdict` — the primitive ROADMAP 37(c) added so a `queued` row can be withdrawn after
  `ADMISSION_DEADLINE_MS = 300 s` — has **1 hit of `admissionVerdict(` in `src/`**: its own definition (`:879`). No pass
  calls it. It is unit-tested (`demo/admission-deadline.test.mjs`) against rows that **carry** `admittedAt`, a shape no
  real submission row has. So the deadline is inert, and the 2 aged `queued` rows in §3 stay at the head of pm's
  conversation indefinitely.

Neither of those is a *danger* today — the 9 `placed` orphans self-heal — but together they mean **every "how long has
this seat been stuck" read is empty-handed**, which is exactly the blind spot that made the 2026-10-28 pre-flight
necessary at all. Registered as **ROADMAP 229**.

## 5. Provider health on the last admissions (ROADMAP 226's term, at the small scale)

Of the **last 30 submission rows**, **6 settled `unanswered`**: `"402: {"message":"You need positive balance to do inference."` × **5**, `"Provider is not configured: deepinfra"` × **1** — i.e. **20% of the most recent admissions died on the provider**, and both causes are *unfunded/unconfigured accounts*, not model quality. `tools/broker-serve.mjs --status` (2.8 s, probes one **real completion** per provider) reports `local` and `verifier` answering and completing today, and NOTEs that all 12 seats resolve to **one** model (`local/iq3_s`), so the author/verifier cross-family invariant cannot hold. A start is therefore provider-viable *now*; it stops being one the moment the local box's account state changes, and §4 is why that change would not be legible from a SKIP trace.

## 6. What I did **not** do, and did not decide

No channel start, no `--start`, no `up`/`worktree`/`run`/`send`/`resume`/`doctor` — **no writing verb on this
workspace**, per `docs/runbooks/workspace-move.md` and the operator grant still outstanding. No queue row claimed,
released, cancelled, deferred or routed; `pm` owns every ActiveRecord transition
(`docs/runbooks/stale-held-backlog.md` §Do). No intent spooled: the release brief is **prepared** at
`.spike/delegate/pm-release-brief-2026-10-28.md` and the spool command is quoted in `NEXT.md`, but spooling it means it
lands the moment the channel opens and `pm` may then create worktrees on this host — that is the operator's call, not
mine. Nothing pushed. One pre-existing long-lived viewer was left running (pid 154207, `cli.mjs watch`, 40 h; a viewer
never wakes a seat, D11) and is reported rather than killed, since it is not mine.

## 7. The decision, in the operator's terms

1. **Start the channel here** (Linux) with `DURIG_SEAT_ROOT` exported — §1 link 4 is a *blocking* precondition, and it is
   the one thing that makes this a first-time writing verb on this box.
2. **Rule ROADMAP 221** (the persisted seat root) before the first seat worktree, or accept that the first `up` resolves
   from a value no CLI can print.
3. **Get work to the head of the queue** — authorize the spool of the release brief to `pm` (safe while the broker is
   down: `node intent.mjs` only writes to the spool). Without this, links 1+2 leave a resident broker waking nine seats
   onto parked rows and landing nothing, which is the expensive version of "the loop is running".
4. **Answer the one clause that has been holding the top three rows since 2026-10-16**: what does "the queue drains"
   mean — which count, under what threshold? `#725/#726/#727` cannot be released by `pm` until that is said (231).

## Reproduce

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json --json .spike/delegate/channel-preflight-$(date +%F).json   # ~2.0 s
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.96 s — the release brief's numbers
node tools/broker-serve.mjs --status                     # 2.8 s — provider completions, not /v1/models
```

Related: `docs/reviews/wallclock-budget-2026-10-28.md` (the two currencies, D153) ·
`docs/reviews/held-drain-audit-2026-10-28.md` (D142) · `docs/WORK-ITEM-LIFECYCLE.md` §4/§7 ·
`docs/runbooks/stale-held-backlog.md` · `docs/runbooks/workspace-move.md` · D154.
