# RM-329 part 3/3 — "the marker must tell the truth, and something must read it"

**Status:** build-ready spec (architect, 2026-11-07). Carried by queue item **#5538**; the two
other parts are already routed as **#5370** (1/3, exit sweep + dead-letter) and **#5371**
(2/3, route reads on PROGRESS not liveness). This document scopes **3/3 only** and says what
3/3 must NOT re-do.

**Subject of review:** ROADMAP **329** (`docs/ROADMAP.md:6106`), whose parent fault is ROADMAP
**303** (`docs/ROADMAP.md:6078`) — "a broker past its bound lingers and turns every broker-routed
read dark while the store is healthy".

---

## 1. The residual defect, stated at the code

Roadmap 329 names three shapes of one fault:

- (a) **drain running** → the read is applied and refused: `apply failed: SqliteStorage is closed`,
  dead-lettered;
- (b) **drain not running** → the read is never applied and the client waits the whole
  `timeoutMs = 120_000` (`src/readclient.mjs:35`), printing nothing on either stream;
- (c) **enqueued during shutdown** → the entry is neither answered nor dead-lettered — it strands
  in `<db>.broker.inbox/` silently.

1/3 kills (c). 2/3 kills (b) at the **read** seam. **3/3 is the only part that makes the broker
marker itself legible to a surface that is NOT trying to read the store**, and today it is not:

- Routing is one boolean on **liveness**: `readData` → `brokerAliveFor(dbPath)`
  (`src/readclient.mjs:109-111`, `src/readclient.mjs:22-24`), and `brokerAlive` is heartbeat + a
  pid probe (`src/broker.mjs:2097-2120`). A broker whose event loop turns but whose passes stopped
  advancing is therefore `alive` for routing purposes — the exact 303 signature.
- A richer answer already exists and is **unused by the read path**: `brokerHealth` returns
  `up | degraded | down` from LIVENESS (`heartbeatAt`) plus PROGRESS (`lastPassAt`, bounded by
  `DEFAULT_PASS_TIMEOUT_MS` + `BROKER_PROGRESS_MARGIN_MS`) (`src/broker.mjs:2123-2160`). It is
  consumed by `cli.mjs status` (`cli.mjs:2883-2895`) and by `tools/broker-serve.mjs --status`
  (`tools/broker-serve.mjs:158`) — **only by verbs that are themselves broker-routed or that the
  operator already thinks to run**.
- Nothing in the conformance layer reports a stale marker. The rule catalogue
  (`src/checkup.mjs:44-154`) contains **no** broker-state rule — `grep -n broker src/checkup.mjs`
  returns one hit, and it is `RUNBOOK_PRECONDITIONS` (`src/checkup.mjs:316`), not a rule.
- `readBrokerState` is silent about the one case that matters: it warns only when the file is
  **unreadable** (`src/broker.mjs:2205-2215`); a well-formed file naming a **dead pid** parses
  fine and is believed.

**The circularity 3/3 exists to break:** the verbs that would tell the operator the broker is dark
(`status`, `queue`, `watch`) are the verbs that hang in that state, and so is `check`'s own input
gathering — `check` pulls `stored`, `queueItems` and `contextBySeat` through `readData`
(`cli.mjs:3160-3166`), i.e. through the spool. A finding computed only *after* those reads can
never fire in the window it diagnoses. **So 3/3's non-negotiable property is: the broker-state
finding is produced from the marker FILE, before and independent of any broker-routed read.**

## 2. Decision (what 3/3 is)

One rule, one predicate, one notice:

1. **New check rule `broker-state-pid-not-running`**, id added to the `RULES` catalogue
   (`src/checkup.mjs:44-154`) with `severity: "fix-now"`, `what:` naming the state, not the symptom.
2. **Its input is threaded from a plain file read**, exactly like the other off-store inputs
   (`sharedTreeBranch`, `commitMessages`, `citations` — `cli.mjs:3180-3200`, each `null` → the rule
   is *skipped with a reason*, never silently passed): add a `brokerState` parameter to
   `auditRig` (`src/checkup.mjs:433`) and pass `readBrokerState(DB_PATH)` at the `check` call site
   (`cli.mjs:3203`). No spool round-trip on this input, ever.
3. **The verdict reuses the existing predicate — it does not re-spell a threshold.** Fire when
   `brokerState` is present, `typeof brokerState.pid === "number"`, and `pidAlive(pid)` is false
   (`src/broker.mjs:2171-2183`) or `brokerProcessAlive(pid)` is false
   (`src/broker.mjs:2186-2198`). `pidAlive`/`brokerProcessAlive` are the pid-only probes and are the
   right legs here: `brokerAlive` deliberately folds in the heartbeat as an **identity** proxy
   (`src/broker.mjs:2163-2169`), and a mid-drain broker stops refreshing its heartbeat (F1, #2574)
   — using it here would call a live draining broker dead. **Import it; do not re-implement it.**
   (Dependency direction is safe: `src/checkup.mjs` already imports dependency-free modules —
   see the #5049 note at `src/checkup.mjs:31-38` — but `src/broker.mjs` is NOT dependency-free, so
   if a checkup.mjs import of it endangers the CLI load, move the two probes into a leaf module
   (`src/causes.mjs`-shaped) and re-export. That move is part of 3/3's diff, not a later cleanup.)
4. **The finding text carries the residue counts**, because "dead pid" alone is not actionable:
   `readdirSync(<db>.broker.inbox).length` (unanswered intents) and
   `readdirSync(intentErrorDir(dbPath)).length` (destroyed ops, `src/broker.mjs:176-177`). A dead
   marker with a **non-empty inbox** is the dangerous pairing — those reads will not answer until a
   broker starts (`drainIntentInbox` runs at the start of a pass, `src/broker.mjs:712`, called at
   `src/broker.mjs:1246` and `src/broker.mjs:1699-1714`), and after 1/3 lands they should instead be
   dead-lettered with the exit reason.
5. **A paired attention notice, not a second rule.** `check` and `attention` must apply the same
   predicate through one function — the #5047/#5049 lesson recorded at `src/checkup.mjs:31-38`
   (two spellings of a threshold is how the notice and the rule un-paired). Name the kind in
   `src/attention.mjs`'s kind list (cf. `context_over_window`, `src/attention.mjs:25`) and have both
   call the same exported predicate.

### Explicitly NOT in 3/3

- **Not** the read-path routing (that is 2/3, #5371: the three-way `brokerHealth` table in
  `readData`, a derived read bound, a named cause for `degraded`). 3/3 must not touch
  `readData`/`readViaBroker`.
- **Not** the exit-path spool sweep or dead-lettering (that is 1/3, #5370).
- **Not** any client-side fallback that opens the store. Roadmap 329's option (b) stays refused
  (`src/readclient.mjs:5-10` documents the second-owner hazard; `assertStoreReadable`,
  `src/readclient.mjs:61-72`, exists because pi-durable's open mkdirs and **creates** — #4955).
  A stale marker is not a licence to open the store: only `brokerAliveFor` returning false does
  that, and it must stay the only gate.
- **Not** an ADR number. `D###` numbers are minted at land time in issue order and must not be
  hardcoded on a branch (lead, #3075/#3186). Land this with the 329 ADR as one entry.

## 3. Severity ruling, and why not `error`

The catalogue offers `error` and `fix-now` only (counted: 9 `error`, 13 `fix-now`). Choose
**`fix-now`**:

- An `error`-severity rule becomes a hard gate; the lesson of #3552 is that an error-severity
  rule which false-positives blocks **every seat's** check, and a marker file is a
  concurrently-written, cheaply-stale artifact — exactly the class that misjudges.
- The remedy is an operator verb (`node tools/broker-serve.mjs --status`, then start/resume the
  broker per `docs/runbooks/broker-down-or-stalled.md`), not a source fix, which is the `fix-now`
  shape.
- If 3/3's demo shows the rule firing in a **normal** running rig, the rule is wrong, not the rig:
  it must fire only when the pid probe says gone. That is the false-positive bound to test.

## 4. Failure modes at this seam, each with its recovery path

| # | Failure mode | How it is caught | Recovery path |
|---|---|---|---|
| F1 | **False DEAD** — a live draining broker is called dead because a heartbeat-based probe was used | the demo asserts a state with a **stale** `heartbeatAt` and a **live** pid does NOT fire | use `pidAlive`/`brokerProcessAlive` (pid-only, `src/broker.mjs:2171`, `:2194`); `clearBrokerState`'s pid guard (`src/broker.mjs:2226-2235`) is the precedent that a live-but-stale-heartbeat broker must never be treated as gone |
| F2 | **False ALIVE** — an unknown `process.kill` error code means ALIVE (deliberate fail-safe, `src/broker.mjs:2112-2118`, #3398), so the rule stays quiet while the marker is stale | untestable by construction on the happy path; it is a **documented** quiet zone | accepted: a false ALIVE costs one quiet rule; a false DEAD admits a **second writer** (the corruption class). Do not "fix" the fail-safe from 3/3 — that belongs to #3398's family |
| F3 | **pid recycled** — the marker names a pid that now belongs to another process | the heartbeat leg is identity, not exit proof (`src/broker.mjs:2163-2169`) | the rule reports the marker + `pid`, `heartbeatAt`, `lastPassAt` so the operator can see a fresh heartbeat against an old `lastPassAt`; do not kill on the rule's word (the runbook holds that) |
| F4 | **The rule cannot run in the window it diagnoses** (`check` hangs on its spool-routed inputs) | the acceptance demo: a dark/broken read path must not prevent the finding | the marker read is a **file** read threaded as its own `auditRig` input; a failure there is `skipped` with a reason (`src/checkup.mjs:457`, `:973` pattern), never a pass |
| F5 | **Unreadable or missing marker** — malformed JSON, or no file at all | `readBrokerState` returns `null` and warns on malformed (`src/broker.mjs:2205-2215`) | `null` → **skip with reason** ("no broker state"); a missing file is normal for a brokerless rig and must not fire — otherwise a starter rig turns red (cf. `init`'s file-only rule set, `cli.mjs:964-979`) |
| F6 | **Stranded residue mistaken for health** — dead marker, empty inbox: looks fine, but reads spooled after the death may still be pending | the finding carries the inbox + error-dir counts | counts > 0 → the remedy names both verbs: start/resume the broker (the next pass drains, `src/broker.mjs:1699-1714`) and inspect `inbox.error/` for destroyed ops |
| F7 | **Cross-platform pid semantics** — `EPERM` vs `ESRCH` differ between Linux and Windows, and the rig runs both | the demo must not depend on producing `EPERM` | keep the probe call inside the fail-safe helper; the demo drives the **marker**, never the OS probe, so the assertions are platform-independent |
| F8 | **Contradiction with 2/3** — 2/3 calls the same state `degraded` on the read path, 3/3 calls it `pid-not-running`; a reader gets two vocabularies for one thing | a conformance check that both surfaces name the same three-way state | 3/3's finding text must quote `brokerHealth`'s reason string when the state is `degraded`, and reserve "not running" for `down`. One predicate, two surfaces — that is the pair the #5049 note demands |

## 5. Acceptance (failing-first, and falsifiable)

A new demo, in the **`readapi` or `broker` area** of `demo/test-areas.json` (the manifest is
hand-curated and has no generator — #4090: check you mapped **every** new demo, and run the demo on
the **merged** tree, not the branch tip):

1. **RED on main today.** Write a marker with a pid that does not exist (an unused pid is easy to
   obtain: spawn `process.kill` probe on a pid from a short-lived child, or use a pid above the
   system max — but the assertion must be about the *finding*, not about the probe) and assert that
   `auditRig` **produces zero `broker-state-pid-not-running` findings**. It must fail on current
   main: the rule does not exist. Keep this case in the file after the fix, inverted — this is the
   guard that stops the rule being re-added as a no-op.
2. **GREEN after:** the same marker yields exactly one finding, `severity: "fix-now"`, and the
   finding text contains (i) the pid, (ii) `heartbeatAt`/`lastPassAt` ages, (iii) the inbox and
   error-dir counts, and (iv) the remedy string `node tools/broker-serve.mjs --status`.
3. **The negative pair (this is the decisive pair, not the positive one):** a marker with a **live**
   pid and a **stale heartbeat** (the F1 shape) yields **zero** findings. Assert both cases in the
   same run so the difference is the pid, not the prose.
4. **Skip pair:** no marker file at all → the rule is `skipped` with a reason and the summary is not
   red; malformed marker → skipped, and `readBrokerState`'s warning still reaches stderr.
5. **Independence assertion (the whole point of 3/3):** the finding is produced with
   `stored: { reason: "unreadable" }` — i.e. while the broker-routed reads have failed. Without this
   assertion the rule can pass the suite and still be useless in the field.
6. **Notice/rule parity:** the attention kind and the rule fire on the same input set; assert both
   from one fixture so they cannot drift.

Also required before 3/3 is called done: `node --check src/checkup.mjs src/attention.mjs src/broker.mjs`
and the full suite green **on the merged tree** (the #976 lesson: merge-tree green is not main green).

## 6. Two options considered, and the trade I accept

- **Option A (chosen): a passive check rule + attention notice on the marker file.** Cheap, no new
  surface, no new writer, reversible by deleting one rule id. Cost: it is seen at the next `check`,
  not the moment of the wedge.
- **Option B: an active supervisor that kills/restarts on a dead marker, or writes a `dark` flag
  into the marker from the client that discovers it.** Rejected for 3/3: a *client* writing beside
  the broker's marker makes the marker a multi-writer artifact (the same class as the second-store-
  owner hazard at `src/readclient.mjs:5-10`), and an automatic restart is an actuator the per-seat
  circuit breaker (ROADMAP 137) is meant to own, not a check rule.
- **Option C: fold the finding into `status` only** (the data is already there, `cli.mjs:2883-2895`).
  Rejected: it is broker-routed, hence silent exactly when it matters (F4), and it is invisible to
  the landing gate and to `attention`, which is where an operator looks when nothing is answering.

A **later** step may promote this to an actuator once ROADMAP 137's breaker exists; that is a
different change with a different blast radius, and 3/3 must not pre-build its hook.

## 7. Sequencing

3/3 is independent of 1/3 and 2/3 in **diff** (different files: `src/checkup.mjs`,
`src/attention.mjs`, one `cli.mjs` call site, one new demo + one `demo/test-areas.json` row) and
dependent in **meaning** (its wording must quote `brokerHealth`'s reasons). Land it **after** 2/3 so
the shared reason strings exist on main; if it lands first, the finding text must not hardcode 2/3's
strings or it will read as a dangling claim.
