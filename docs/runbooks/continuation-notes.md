---
runbook: continuation-notes
symptom: "a seat cannot finish its item inside one context window; compaction summaries come back truncated ('Summarization hit the token limit'); a seat woken into a fresh context has no idea what it already established; `status`/`queue` return tens of megabytes"
writes: true                       # arming the extension writes config; the diagnosis below is read-only
precondition: "read-only"          # Diagnose is read-only; the Do steps that edit config need the broker stopped
last_verified: 2026-11-09
verified_by: delegate
evidence: "D240; demo/continuity-note.test.mjs (0.40 s, exit 0); demo/offline.mjs (0.29 s); demo/status-view-bound.test.mjs (1.8 s); docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09.txt"
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

**Bounding the payload must not bound the derivation.** `queueItems` is a *view* (200 rows), but the payload also
carries `queueCensus` (133 B: rows, per-state counts, terminal/active) and `queueDeferred` (51 KB: every deferred
row's id, seat, status and a 55-char subject). Those exist because bounding status once silently broke clock-in:
`scripts/clockin.mjs (`runCli(["status"])` in `main`)` reads `cli.mjs status` for its queue section, and a 200-row view against a 6,021-row
store printed "200 rows" and a **zero** deferred backlog for a store holding 383 rows awaiting the operator. A
script that must join a branch to its row's state passes `--with-terminal-index` — the ids+statuses of the rows the
view dropped, bodies never.

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
- `node docs/evidence/2026-11-08-context-window/milestone-check.mjs` → exit 1 with the per-seat list; output
  captured at `docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09.txt`.
