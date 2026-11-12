---
runbook: continuation-notes
symptom: "a seat cannot finish its item inside one context window; compaction summaries come back truncated ('Summarization hit the token limit'); a seat woken into a fresh context has no idea what it already established; `status`/`queue` return tens of megabytes; nobody can say WHICH seat the note mechanism has actually reached"
writes: true                       # arming the extension writes config; the diagnosis below is read-only
precondition: "read-only"          # Diagnose is read-only; the Do steps that edit config need the broker stopped
last_verified: 2026-11-11
verified_by: impl
evidence: "D240; demo/continuity-note.test.mjs (0.40 s, exit 0); demo/offline.mjs (0.29 s); demo/status-view-bound.test.mjs (1.8 s); docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09.txt; #6082: src/notecensus.mjs + demo/note-census.test.mjs (exit 0), live census read on ./selfdev.sqlite 2026-11-10T04:5xZ (`node cli.mjs status --json`, exit 0); #6161: demo/note-wake-seed.test.mjs (exit 0) and demo/note-census.test.mjs (exit 0), era re-measured on ./selfdev.sqlite 2026-11-11 (`node cli.mjs status --json`, exit 0, 12 seats: 8 proven, 2 seeded, 1 idle, 1 predates-arming; 1,980 compactions = 1,893 pre-arm + 87 post-arm, 0 post-arm summariser)"
check_rule: null
---

# Continuation notes: finishing an item that does not fit in one window

**Host for every number here**, measured in the same command as the measurement: **Linux**, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0`.

## When to use

- A seat's turn dies at `stopReason=length`, or `check`/`milestone-check` reports a seat near or over its
  declared window.
- A compaction summary is **incomplete**: the store holds 2,354 `pi.compaction` rows, **432 failed**, **219**
  with "Summarization hit the token limit; the summary is incomplete", **209** refused by
  `DURIG_SPEND_CAP_RUN_USD` before a request was even sent (measured 2026-11-09,
  `docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09.txt`).
- A seat is reset (degeneration guard, `pi.reset`, a between-items reset) and starts with nothing but the
  new instruction.
- `node cli.mjs status --json` is too big to read: **28,543,835 bytes** before this work, **587,109 bytes**
  after the bounded view (measured 2026-11-09 on this rig's `selfdev.sqlite`).

## Impact

Every one of those failures is a **model call made against a window that is already full**. The summariser is
the fragile leg: it costs money, it hits the run cap, and when it truncates the seat proceeds with a summary
that silently omits what it cut. A continuation note replaces that leg with a document the seat writes
itself, in the durable store, before the boundary.

## Preconditions

- The diagnosis is read-only and broker-down safe; it needs no broker.
- **Arming the extension is an operator grant.** `src/extensions.mjs` has **no auto-discovery** on purpose:
  an extension runs inside the rig process with the harness API and the process's OS permissions, so "which
  code runs in here" is an explicit list (`DURIG_EXTENSIONS`), never a directory scan.

## Diagnose (read-only)

```bash
# 1. Is the mechanism armed at all?
node cli.mjs config | grep -E 'DURIG_EXTENSIONS|DURIG_NOTES_DIR'

# 2. What does the gate say, per seat?
node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite

# 3. What is the read surface actually costing, and what does the view admit it dropped?
node cli.mjs status --json | wc -c
node -e 'const j=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));console.log(j.queueView, j.queueCensus, j.queueDeferred.length)'
```

### Per seat: does the note exist, was it read, did compaction use it? (#6082)

`status` carries a **note census** — one row per seat, three facts each, plus a **verdict** and an **owner**
(#6118). It is a direct read-only open of the store (`src/fleethealth.mjs`'s precedent: no harness, no ownership), so it answers even when the broker is
wedged. `--no-notes` skips the scan; it is one pass over `entries` and costs **1.4 s** on this rig's
424,583-entry store.

```bash
node cli.mjs status --json | node -e 'const j=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));console.log(j.noteCensus.lines.join("\n"))'
# or straight from the module, no broker at all:
node -e 'import("./src/notecensus.mjs").then(m=>console.log(m.renderCensus(m.readNoteCensus("./selfdev.sqlite"))))'
```

Measured 2026-11-11 on this rig's `selfdev.sqlite` (exit 0, 2.9 s; the seat names below come from the seat map
`status` passes — run the module directly with no seat map and the rows are labelled `conv-<id>` instead):

```
continuity notes: PROVEN 7 of 12 seats; seeded 2; claimed-only 1; not-armed 0; not-observed 2. 10/12 seats have a written note; 24 read_note calls across 97 turns that offered the tools; 1957 compactions -> note 64, digest 0, summariser 1893
  conv-3       conv 3       note=written  read_note 3x (offered 8x)  compactions 7 (note 4, digest 0, summariser 3)  latest: note  verdict=proven owner=none
  conv-15      conv 15      note=written  read_note 3x (offered 13x)  compactions 571 (note 10, digest 0, summariser 561) latest: note  verdict=proven owner=none
  conv-4936    conv 4936    note=empty doc read_note 0x (offered 8x)  compactions 353 (note 12, digest 0, summariser 341) latest: digest  verdict=seeded owner=seat
  conv-86607   conv 86607   note=written  read_note 1x (offered 2x)  compactions 125 (note 0, digest 0, summariser 125) latest: summariser  verdict=claimed-only owner=open
  conv-4918    conv 4918    note=written  read_note 1x (offered 1x)  compactions 0 (note 0, digest 0, summariser 0)  latest: no compaction  verdict=not-observed owner=none
```

**The verdict vocabulary (#6118)** — "the mechanism works" and "this seat is carried by the mechanism" are
 different claims, and the fleet has been reading one as the other (`src/notecensus.mjs`, `classifySeat`):

| verdict | what the store actually shows | who owns the gap |
|---|---|---|
| `proven` | the seat wrote a note AND a compaction carried it | nobody |
| `seeded` | a compaction was covered, but by a seed pulled from the seat's queue (`extensions/continuity.mjs` `seededGoal`), not by the seat's own note | the seat |
| `claimed-only` | the tools were offered and no boundary ever carried a note; if a note WAS written, either the compactions predate it or the hook missed it — the census cannot tell, so it is reported open, not as a defect | open |
| `not-armed` | 0 turns declared the note tools: `src/extensions.mjs` has no auto-discovery, so an unlisted extension is an absent one | the operator |
| `not-observed` | the seat has never been compacted — a non-observation, neither a failure nor a proof | nobody |

The older measurement, before the verdict column existed, is kept below as the format it rendered then:

```
continuity notes: 4/12 seats have a written note; 6 read_note calls across 21 turns that offered the tools; 1905 compactions -> note 12, digest 0, summariser 1893
  pm           conv 3       note=written  read_note 0x (offered 2x)  compactions 4 (note 1, digest 0, summariser 3)   latest: note
  impl         conv 9       note=written  read_note 5x (offered 5x)  compactions 20 (note 1, digest 0, summariser 19)  latest: note
  qa           conv 15      note=empty doc read_note 0x (offered 3x)  compactions 563 (note 2, digest 0, summariser 561) latest: note
  lead         conv 21      note=none     read_note 0x (offered 1x)  compactions 2 (note 0, digest 0, summariser 2)   latest: summariser
  advocate     conv 4918    note=none     read_note 0x (offered 0x)  compactions 0 (note 0, digest 0, summariser 0)   latest: no compaction
  scribe       conv 4924    note=empty doc read_note 0x (offered 2x)  compactions 2 (note 1, digest 0, summariser 1)  latest: note
  devtools     conv 4930    note=written  read_note 0x (offered 3x)  compactions 841 (note 2, digest 0, summariser 839) latest: note
  auditor      conv 4936    note=empty doc read_note 0x (offered 1x)  compactions 345 (note 4, digest 0, summariser 341) latest: digest
  designer     conv 4942    note=written  read_note 1x (offered 1x)  compactions 0 (note 0, digest 0, summariser 0)   latest: no compaction
  security     conv 55605   note=none     read_note 0x (offered 1x)  compactions 0 (note 0, digest 0, summariser 0)   latest: no compaction
  qa2          conv 86607   note=none     read_note 0x (offered 0x)  compactions 125 (note 0, digest 0, summariser 125) latest: summariser
  architect    conv 107595  note=empty doc read_note 0x (offered 2x)  compactions 3 (note 1, digest 0, summariser 2)   latest: note
```

Three readings that the numbers do **not** support, and are easy to take from them:

- **`note=empty doc` is not a defect.** A `durig.notes` document is created by the first `read_note`; a doc with
  only its `base` revision has never been written. That is why the census reports `noteDoc` and `noteWritten`
  separately (pitfall 199).
- **`offered` is not `used`.** Every `pi.system` entry names the tools the request declared, so a naive
  `record like '%"name":"read_note"%'` scan counted 25 "calls" on a fleet that had actually made **6** — the
  same false green a `check` rule would ship. `readNoteCalls` counts entries with a `toolCall` block; the demo
  pins the difference (`demo/note-census.test.mjs` §4).
- **`digest 0` is expected, not missing.** `beforeCompact` always renders a note — the seat's own note, or a
  seed from its claimed/queued item — so the bare-digest bucket only fires when neither exists.
- **A rig-written note is not a seat-written note (#6161).** The wake seed is now durable — it is written into
  the conversation's `durig.notes` doc at the wake, stamped `origin: "wake-seed"` — so `noteWritten` alone can no
  longer mean the seat kept a note. `noteAuthored` (a `write_note` call in the transcript) is the proof, and
  `classifySeat` uses it.

**The fleet-wide fact the census is for, stated in a way the store can support (#6161):** this store holds
1,980 compactions. **1,893 of them were recorded before the conversation was ever armed** with the continuity
tools; **87 were recorded after, and all 87 took the note path — zero went to the summariser**
(`node cli.mjs status --json`, exit 0, 2026-11-11, this rig, `totals.predatesArming=1893`,
`totals.afterArming=87`, `totals.afterArmingSummariser=0`). "1,893 of 1,905 compactions went to the summariser"
was never a failure rate: it counts weeks of runs from before the extension was loaded into each conversation.
The row now prints the split — `era pre-arm N / post-arm M` — and a seat whose `latest:` is `summariser` is a
defect only if `post-arm` is non-zero.

**The verdict vocabulary, and who owns each gap** (`classifySeat`, pinned by `demo/note-census.test.mjs` §6):

| verdict | what the store shows | owner |
|---|---|---|
| `proven` | a note the seat wrote was supplied as the summary at a boundary | nobody |
| `seeded` | the boundary was covered by a rig seed drawn from the seat's claimed/queued item; the seat never called `write_note` | the seat |
| `path-not-reached` | compactions recorded **after** arming still went to the summariser | the mechanism — the only shape that is a real defect |
| `predates-arming` | every compaction in that conversation predates the extension being loaded into it | history (nobody) |
| `digest-only` | armed compactions carried neither a note nor a seed | the seat |
| `not-armed` | 0 turns declared the note tools: the extension is not in `DURIG_EXTENSIONS` for that conversation | the operator |
| `idle` | the seat holds no claimed or queued item, so it can never reach a boundary | pm — a routing gap, not a mechanism failure |
| `not-observed` | the seat holds work but has never been compacted | open — a non-observation, not a failure |

Measured 2026-11-11 on this rig: **8 of 12 seats `proven`, 2 `seeded` (auditor, security), 1 `idle`
(designer: 0 compactions, 0 held — routing), 1 `predates-arming` (qa2: all 125 compactions before entry
449530, the first that declared the note tools), 0 `path-not-reached`.** The `idle` verdict is the one that
changes the reading: a seat with nothing in its queue cannot hit a window boundary, and counting it as a
coverage failure was the error #6161 closes.

Expected shape of step 2 (from the 2026-11-09 run):

```
== continuity mechanism: can EVERY seat resume from a note, and did compaction stop costing a model call? ==
  DURIG_EXTENSIONS: (unset) - no extension is loaded, so the mechanism cannot exist yet
  note documents in the store: none - durig.notes is not defined
  seats in the roster: 12
  ...
  no write_note call in the transcript yet: the before/after comparison has no anchor - the mechanism has never run on this store.
```

A seat is **resumable** when its `durig.notes` document renders a body with a goal or a next action. The gate
prints, per seat: note revision, resume-text length, whether goal/next/verified are present, and how many
`pi.reset` boundaries that conversation has already drawn.

**Read the verdict in two parts.** Since 2026-11-09 the gate separates three things it used to blend into one
red wall:

- **FAIL (mechanism)** — the code is not sound: the override does not reach the harness, a declared window
  cannot hold its policy, an extension is listed but never loaded, a note is in the store but not mirrored, or
  a compaction since the first note still went to the summariser. This is what exit 1 means.
- **Operational blockers** — the mechanism is fine and the rig is not running it: no `DURIG_EXTENSIONS`, no
  broker, no provider key, a window nearly full. Exit 0, listed separately, each with the grant or action that
  closes it.
- **Advisory** — a risk signal the instrument cannot prove without a real provider. `tools/seat-turn-shape.mjs`
  flags a *shape* a strict alternating chat template would refuse; this rig's seat model was measured accepting
  two consecutive user turns (`docs/runbooks/verifier-serving-headroom.md`, 2026-11-05), so AT RISK is a
  hypothesis, not a refusal.

Measured 2026-11-09 on `./selfdev.sqlite`: **PASS (mechanism)**, 8 operational blockers, 1 advisory —
`docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09-live.txt`. Against the demo store with the
extension armed: **PASS (mechanism)**, 1 blocker, 1 advisory.

**An empty `durig.notes` document is not a broken note.** Reading a document creates it at its initial value,
so a 0-char body means no seat has written one yet — the gate counts that as a blocker, not a mechanism defect
(pitfall 199).

**Bounding the payload must not bound the derivation.** `queueItems` is a *view* (200 rows), but the payload also
carries `queueCensus` (133 B: rows, per-state counts, terminal/active) and `queueDeferred` (51 KB: every deferred
row's id, seat, status and a 55-char subject). Those exist because bounding status once silently broke clock-in:
`scripts/clockin.mjs (`runCli(["status"])` in `main`)` reads `cli.mjs status` for its queue section, and a 200-row view against a 6,021-row
store printed "200 rows" and a **zero** deferred backlog for a store holding 383 rows awaiting the operator. A
script that must join a branch to its row's state passes `--with-terminal-index` — the ids+statuses of the rows the
view dropped, bodies never.

## What the extension does at a boundary (armed, 2026-11-09)

| The seat's situation | What happens | Proof |
|---|---|---|
| Chosen handoff — `continue_from_note` | the note becomes the reset boundary's first user message, un-fenced | `demo/continuity-note.test.mjs` §4, `demo/offline.mjs` |
| Compaction | `beforeCompact` supplies the note as the summary body; the summariser request is never built | §3: `callCount` unchanged across a compaction (22 → 22) |
| **Unchosen** reset — degeneration guard, `cli.mjs reset <seat>`, `up --refresh` (no handoff) | `beforeRequest` puts the note in the **system message** of the next request | §5: the provider request contains `CONTINUITY NOTE` with roles `system,user` and no transcript entry was written |
| Full context, nothing cut | nothing is injected — the note is a boundary mechanism, not a per-request tax | §5: visible roles `system,user,assistant,user`, no note |
| No note written | nothing is injected; the guard cannot invent a goal | §5 (`bare` seat) |

Why the system message and not a new turn: an added `user` turn is precisely the shape a strict alternating
chat template refuses, and `tools/seat-turn-shape.mjs` measured **9 of 12** live seats already carrying
consecutive user turns. The injected text is stable while the note is unchanged, so the cached prefix is not
churned every request (ROADMAP 175). Injection is request-only: `dist/harness/generation.js:118-123` replaces
the messages list and the durable transcript never sees it, so the note is not double-recorded (D133).

## Do

1. **Stop the broker** and confirm it exited (`docs/runbooks/broker-down-or-stalled.md`). Editing rig config
   while a broker owns the store is the second-owner hazard `COMMANDS-AND-THE-BROKER.md` §4 warns about.
2. **Arm the extension** in `durig.config.json` (or the launch environment). One path, spelled exactly:

   ```bash
   node -e 'const p="durig.config.json",j=JSON.parse(require("fs").readFileSync(p,"utf8"));j.DURIG_EXTENSIONS="extensions/continuity.mjs";require("fs").writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
   ```

   `[judgement]` this is the operator's decision: it changes what code runs in every seat.
3. **Set the mirror directory** if the default is not what you want. Default: `<rig root>/.durig/notes`.
   It is gitignored, so the **store document is the source of truth** and the file is a mirror for humans and
   gates (`D240`, `D130/R2`).

   ```bash
   DURIG_NOTES_DIR=.durig/notes node cli.mjs config | grep DURIG_NOTES_DIR
   ```

4. **Check the compaction policy fits the window** before trusting any of this. `modelOverrides` nests INSIDE
   `compaction` (a sibling key is read by nobody — ROADMAP 331), and a key may name a **family**:

   ```bash
   node docs/evidence/2026-11-08-context-window/compaction-policy-probe.mjs
   ```

   Expected (this rig, 2026-11-09):

   ```
   compactionSettings() returns: {"compaction":{"modelOverrides":{"local/qwen3.8-flash-next-q2_0":{"reserveTokens":20480},"verifier/openai/gpt-oss-120b":{"reserveTokens":4096,"keepRecentTokens":8192,"backgroundTokens":8192}}}}
   verifier/openai/gpt-oss-120b  seats: auditor  ...
     resolved: enabled=true reserve=4096 keepRecent=8192 background=8192
   ...
   no inert keys: every declared override is matchable by at least one seat.
   ```

   A `local/*` / `verifier/*` key expands to the model that family's own `DURIG_<FAMILY>_MODEL` declares
   (`overrideKeysForFamily`, `src/config.mjs`). If the family declares no model the entry is **dropped**, not
   kept as a key nothing can match.

## Verify

```bash
node demo/continuity-note.test.mjs          # expect "CONTINUITY PASS", exit 0, ~0.40 s
node demo/note-census.test.mjs              # expect "PASS: 0 failed check(s)", exit 0, ~0.46 s: the exercised seat
                                            # reads note=written / read_note 1x / compaction via note; the control
                                            # seat with no extension reads summariser - the census distinguishes them
node demo/note-wake-seed.test.mjs           # expect "WAKE-SEED PASS: 0 failed check(s)", exit 0: the seed is WRITTEN
                                            # at the wake (goal, itemId, origin wake-seed), mirrored to DURIG_NOTES_DIR,
                                            # returned by read_note, and carried by continue_from_note; a seat-authored
                                            # note is never overwritten and a seat holding nothing gets no phantom note
node demo/offline.mjs                        # pm -> worker -> done with a mid-item handoff, ~0.29 s
node demo/status-view-bound.test.mjs        # expect "STATUS VIEW BOUND OK ...", exit 0, ~1.8 s
node scripts/test.mjs --area rig            # the continuity demo is in the rig area
node scripts/test.mjs --area readapi        # the bounded-view demo is in the readapi area
```

To keep the stores the demos write, so a gate can open them afterwards:

```bash
DURIG_CONTINUITY_KEEP_DIR=.spike/delegate/continuity-store node demo/continuity-note.test.mjs
node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db .spike/delegate/continuity-store/with.sqlite
```

Expected: every listed seat prints `goal=yes next=yes verified=1`, and the before/after block reads
`since: 1 compactions, 0 truncated summaries, 1 note-backed`.

## If it fails

| Symptom | Cause | Fix |
|---|---|---|
| run faults with `"undefined" is not valid JSON` before any tool runs | a tool declared without `parameters` — pi-ai's `toToolDeclaration` does `JSON.parse(JSON.stringify(tool.parameters))` | declare `parameters: Type.Object({})` even for an argument-free tool |
| a faux turn settles `unanswered` with `model_error` | the scripted reply used `stopReason: "toolcall"` | it is `"toolUse"` |
| SQLite `Provided value cannot be bound to SQLite parameter 4` inside a hook | `runtime.commit(...)`'s callback return value **becomes the task state** (`scheduler.js` `#commitState`) | capture the rendered text in a local and return `undefined` |
| a per-model override has no effect | the key names a model no seat runs, or `modelOverrides` sits as a sibling of `compaction` | use the family key (`verifier/*`) and nest inside `compaction` |
| `--full-queue` exits 1 | that is the guard working: an unbounded read is refused with its row count and size | ask for a slice (`--status claimed --to <seat>`, `--queue-limit N`) |
| clock-in prints `## QUEUE 200 rows` for a 6,021-row store, or a deferred backlog of 0 | the digest read the *view* instead of the census | it now reads `queueCensus`/`queueDeferred`; if those fields are missing the status call predates them — check `git log --oneline -- src/readapi.mjs | head` |
| the note is in the store but no file appears | the mirror write failed (permissions, a path outside the cwd) — the note is still authoritative | the tool result names the mirror failure; the store doc is the truth |
| the census says a seat has a note but every compaction is `summariser` | the boundaries happened before the extension was armed, or the seat has not been compacted since | read the era split, not the total: `era pre-arm N / post-arm M`. `post-arm 0` with a non-zero total is history (`predates-arming`), not a defect; `post-arm > 0` with summariser inside it is the real failure (`path-not-reached`) |
| the fleet reads "1,893 compactions went to the summariser" and the mechanism is called broken | the total mixes compactions recorded before the extension was ever loaded into that conversation with ones recorded after it | `totals.predatesArming` vs `totals.afterArming` (#6161). On this rig 2026-11-11: 1,893 pre-arm, 87 post-arm, 0 of the post-arm went to the summariser |
| `status --json` is 1.4 s slower than you expect | the note census scans `entries` in one pass | pass `--no-notes` for a fast read |
| a seat woken by `reset` knows nothing | the extension is not armed — an unlisted extension is an absent one (§Do 2), and a plain reset carries no handoff | arm it; `beforeRequest` then supplies the note in the system message |
| the gate prints `pi.system entries carrying the durig-continuity section: 0` and `requests offering the note tools: 0` | the extension was armed and **no seat has run a request since** — the transcript only shows what ran. Compare the newest entry timestamp with the config write (`ls -l durig.config.json`); on this rig they were 07:54:09Z and 20:59:08Z on the same day | run the mechanism's own proof, `node demo/continuity-note.test.mjs` (0.43 s, no key/network/broker): `CONTINUITY PASS` means the code is sound and the fleet simply has not exercised it. Getting a number on a live fleet needs a provider that registers a model (pitfall 219) |
| a seat has a note but a compaction still paid for a summariser | the note was written after that boundary, or the seat's conversation has no `durig.notes` document yet | the gate's before/after block is anchored on the first real `write_note` tool call; anything before it is history, not the mechanism |

## Escalate to

- **The operator**: granting `DURIG_EXTENSIONS` (which code runs in every seat), and any change to
  `DURIG_NOTES_DIR` for a deployed rig.
- `docs/reviews/architecture-context-continuity-2026-11-09.md` is the design rationale; `docs/DECISIONS.md`
  **D240** is the ruling.

## Related runbooks

- `compact-a-seat.md` — manual compaction of a saturated seat. With the extension armed, that compaction
  takes the note path and makes **zero** model calls.
- `context-over-window.md` — reading the `ctx` fraction honestly.
- `in-turn-read-hangs.md` — when a seat's turn hangs on `status`/`queue`; the bounded view is the payload half
  of that fix.
- `pi-pin-update.md` — the pin. Measured 2026-11-09: manifest `^1.3.0`, installed **1.3.0**, lockfile 1.3.0,
  vendor mirror 1.3.0, registry **1.5.0**. The 1.5.0 tarball's `compactionPolicy(settings, model)` is still
  2-arg and still exact-key matched, so the drift is a version lag, not an API change.

## Evidence

- `node demo/continuity-note.test.mjs` → `CONTINUITY PASS`, exit 0, 0.400 s.
- `node demo/offline.mjs` → full pm→worker→done loop with one `pi.reset` boundary, 0.293 s.
- `node demo/status-view-bound.test.mjs` → fixture of 400 rows: 747,627 B unbounded → 398,601 B shown,
  `droppedTerminal=100 droppedCapped=100`, `queueDeferred` carries all 250 deferred ids, `--full-queue` exits 1
  naming the count.
- `node cli.mjs status --json` → 28,543,835 B before, 587,109 B after (2026-11-09, this rig); of that,
  `queueItems` 389,829 B, `peerGraph` 49,315 B, `queueDeferred` 51,353 B, `queueCensus` 133 B.
- `node demo/note-census.test.mjs` → `PASS: 0 failed check(s)`, exit 0, 0.464 s: the exercised seat reads
  `note=written`, `read_note 1x`, `compactions 1 (note 1, digest 0, summariser 0)`, and the compaction made zero
  model calls (`callCount` 24 → 24); the control seat without the extension reads `summariser 1`.
- `node cli.mjs status --json` on the live store, 2026-11-10 → exit 0, 539,395 B, per-seat census at
  `docs/evidence/2026-11-08-context-window/note-census-2026-11-10.txt` (4/12 seats with a written note, 6 real
  `read_note` calls out of 21 turns that offered the tools, 1,905 compactions: 12 note-path, 1,893 summariser).
- `node docs/evidence/2026-11-08-context-window/milestone-check.mjs` → exit 1 with the per-seat list; output
  captured at `docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09.txt`.
- Same gate after the mechanism was finished, 2026-11-09: **PASS (mechanism)** on both `./selfdev.sqlite`
  (`milestone-check-2026-11-09-live.txt`, 8 operational blockers, 1 advisory) and the armed demo store
  (`milestone-check-2026-11-09-demo-store.txt`, 1 blocker, 1 advisory).
- `node demo/continuity-note.test.mjs` → `CONTINUITY PASS`, exit 0, 0.630 s, five scenarios including the
  unchosen-reset injection case.
