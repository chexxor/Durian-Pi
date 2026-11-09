# NEXT.md — current state and next actions

**Last update:** 2026-11-09T11:0xZ (delegate session **N19** — the continuity mechanism from N18 is committed and
re-verified; the milestone ledger and the next milestone's definition of done were written; the git verdict is
unchanged: worktrees **9**, refs **12**, suite **280/280** in 57 s, doc guard **0 hard, 0 soft**, `git status
--short -- .` clean.)

**Milestone this window worked** — **ensuring LLM task completion (D226 / D240), first tranche ROADMAP 331** — a
seat can now carry a durable continuation note instead of a compaction summary, and the read surfaces that would
have re-introduced the blowup are bounded. Rows **#5931–#5942** (the team's decomposition of this cluster) are
still unclaimed; the delegate built and verified the mechanism but asserted no row.

**New this window:** the milestone ledger is now a file — **`docs/MILESTONES.md`** (previous = the auto-clean
ceiling, D249; current = 331; next = M5) — and **M5 has a runnable definition of done**: `node
docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite`, baseline **3 PASS, 1 PARTIAL, 4 FAIL**,
decomposed in `docs/reviews/milestone-m5-solidified-2026-11-09.md`. Roadmap **347–350** registered from this
measurement.

**N17 still holds the git verdict**: worktrees **58 → 9**, refs **60 → 12**, zero `--force`; read the live tip with
`git rev-parse --short main`. The 9 trees left are the seats' own roots; **the next git-side work is a queue-design
act, not a git act** (D249) — see Current item 1.

**Host for every number below**, measured in the same command as the measurement: **Linux**, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version` (**never sign
work with a hostname** — D205, ROADMAP 281).

**Cost (from `selfdev.sqlite.spend.jsonl`, measured 07:5xZ):** 2,030 ledger lines, **$0.92401** cumulative,
**$0.03462** on 2026-11-09 UTC — **all of it before this pass**; the land+reap pass itself spent **$0.00000** (no
model call was made; the fleet was down). Wall clock of the pass: ~50 minutes, dominated by two full-suite runs
(60 s each) and the conflict compositions.

## What this pass actually changed (evidence, not activity)

- **Landed, with `scripts/land.mjs` or a composed merge:** `item-5387` (`c8217425`, runbook fix), `item-5501`
  (`e741f415`, two DISPOSITIONS rows), `item-5829` (`53a415c8`, the forge-before-every-read correction to
  `docs/runbooks/broker-down-or-stalled.md`), `item-5226` (`35efd976`, `SHARED_PRICE_JSON_KEY`), `item-5221`
  (`67567a73`, RM-306 shell withhold). Before merging, each tree's uncommitted residue was **committed on its own
  branch** so it could not vanish with the worktree.
- **Removed:** **49** item worktrees, **48** refs. Every removal was preceded by `git diff HEAD --binary` and a
  move of every `??` path into `.spike/delegate/cleanup-20261109/quarantine/` (52 files, 2 non-empty diffs). No
  `git worktree remove --force`, no `git branch -D`, no unlock of a live seat's tree.
- **Proved nothing was lost:** each pruned ref was checked with `git merge-base --is-ancestor <ref> main` before
  `git branch -d`; `main` advanced only by clean fast-forwards and merges.
- **One regression caught and fixed:** the `item-5226` composition dropped `LOCAL2_ENV_PREFIX` from
  `LOCAL_ENV_PREFIXES`. The **46-test derived suite passed**; the **278-test full suite** failed
  (`demo/local2-provider-prefix.test.mjs`). Fixed in `ea12fe04`; suite re-run green. Rule now in
  `docs/runbooks/branch-cleanup.md` Do step 7 and pitfall **186**.
- **The ceiling, measured:** before the pass, 49 trees had branches that were **provably ancestors of `main`**
  while their rows read `deferred` (35), `held` (11) or `claimed` (3). `src/broker.mjs:1117` keeps any tree whose
  item is live, so `worktree audit`'s `reapable: 0` was **correct**. That is the defect the next pass must fix
  (D249).

## Current item (priority order)

1. **Arm the continuity extension** (operator grant) — procedure in `docs/runbooks/continuation-notes.md`.
   Rows **#5931–#5942** remain the team's to claim; the delegate asserted nothing.
2. **Decide how a landing closes its row** (D249) — spooled to `pm` as `delegate-20261109-auto-clean`, undrained
   while the broker is down. Options, costs and the recommendation are in `docs/DECISIONS.md` (D249) and
   `docs/runbooks/branch-cleanup.md` § "The ceiling".
3. **Re-cut `item-5301`** (the `worktree reap` verb, ROADMAP 311 cut 2) — a seat job: its `cli.mjs` does not
   parse and `reapWorktrees` returns a different shape than `demo/worktree-reap.test.mjs` asserts.
4. **#5785** — the code is on `main`, the row is `deferred`, its own subject says the nesting is done. A
   zero-build close for its owner.

## Exact next command

The broker is **down**; nothing drains until one starts, and two things gate that (both are operator grants): no
provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401 on 127.0.0.1:8080; `DURIG_VERIFIER_API_KEY`
unset → 402 "You need positive balance"), and the spend cap refuses `google/gemini-3.1-pro` ($14 max call exposure
against a $4 store cap).

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/clockin.mjs                                 # BEFORE starting a broker; it hangs while one drives
node tools/broker-serve.mjs --status                     # state + genlock + spool depth + provider reachability
node cli.mjs status                                      # ~1 s once the broker is healthy
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 1.2 s, read-only, works with the broker down
node scripts/test.mjs --area docs                        # 6/6 expected
```

**The continuity leg — run these first, they need no broker, no key and no model** (measured on this box:
0.40 s / 0.29 s / 1.8 s, all exit 0):

```bash
node demo/continuity-note.test.mjs        # CONTINUITY PASS — the note survives a reset and compaction costs 0 model calls
node demo/offline.mjs                     # pm -> worker -> done with one mid-item pi.reset, 0.29 s
node demo/status-view-bound.test.mjs      # STATUS VIEW BOUND OK — the view reports what it dropped
node scripts/test.mjs --area rig          # 8/8;  node scripts/test.mjs --area readapi  # 6/6
node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite
```

Expected from the last line (exit **0** now — the mechanism passes and the gate lists what is operational):
`DURIG_EXTENSIONS: (unset) - no extension is loaded, so the mechanism cannot exist yet` under
**Operational blockers (8)**. The same gate run against the demo store —
`… milestone-check.mjs --db .spike/delegate/continuity-store/with.sqlite` — prints every seat resumable and
`since: 1 compactions, 0 truncated summaries, 1 note-backed`. The gap between those two runs **is** the arming
step, and arming is the operator's grant: add `"DURIG_EXTENSIONS": "extensions/continuity.mjs"` to
`durig.config.json` with the broker stopped. Full procedure: **`docs/runbooks/continuation-notes.md`**.

**Cheap state reads that work with the broker down** (this pass used these; they are the reason the pass cost
nothing):
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (9 trees, all `seat-root`, `reapable: 0`),
`node tools/queue-drain-audit.mjs --db ./selfdev.sqlite` (6,021 rows in 1.2 s), and
`git worktree list` + `git branch --format='%(refname:short)' | wc -l`. **Do not reach for
`tools/channel-preflight.mjs`** — it currently sets `DURIG_CONFIG` to the rig file and the #5071 unknown-key guard
makes the tool itself fail (pitfall **190**).

**Is the team operating?** No — the fleet is stopped with the broker. Queue: 6,021 rows,
`done 4154 / cancelled 873 / held 461 / deferred 383 / claimed 12 / queued 138`. `cli.mjs worktree audit` now
reports **9** trees, all `seat-root`: `main`, `durian-dev/seatroot`, and `item-5604` (auditor), `item-5801`
(devtools), `item-5829` (impl), `item-5834` (qa), `item-5912` (scribe), `item-5965` (architect), `item-5976`
(security). Landed-but-still-non-terminal rows this pass: **#5221, #5226, #5387, #5501, #5829** — their owners
close them; the delegate claims nothing.

**Blocker:** the two provider grants above, plus 10 spooled intents (including `delegate-20261109-release-role`
and `delegate-20261109-auto-clean`) that cannot be delivered while the broker is down, and **118 dead-letters**
(measured 2026-11-09: `ls -1 selfdev.sqlite.broker.inbox.error | wc -l` → 118; 10 intents still spooled in
`selfdev.sqlite.broker.inbox/`, 0 delivered in `.out/`) in
`selfdev.sqlite.broker.inbox.error` — read one before assuming an intent was lost.

**Traps this window** — `docs/SELFDEV.md` **191–198** (this pass: a tool with no `parameters` faults the run
before any tool runs; a hook's `runtime.commit` callback return value becomes the task state; faux replies use
`stopReason: "toolUse"` not `"toolcall"`; a per-model override pinned to a model id goes inert when the family
repoints, and a config file's override map REPLACES the shipped defaults wholesale; a durable document cannot be
read out of `document_revisions` by kind; **a bounded view is not a census** — bounding `status` silently made
clock-in report 200 rows and a zero deferred backlog against a 6,021-row store; and substring assertions are
vacuity traps) plus **186–190** and **173–185**. Grep for the
symptom; the file is ~50,000 tokens.

**Probes left for promotion** (gitignored `.spike/`, read-only, no model spend, broker-down safe):
`.spike/delegate/cleanup-20261109/reap.sh` (this pass's whole reclaim: capture residue, unlock, remove, then
`git branch -d` only on proven ancestors — 49 trees, 48 refs, zero `--force`),
`.spike/delegate/cleanup-20261109/roots-probe.cjs` (read the store's tables with `node:sqlite`, no dependency),
`.spike/delegate/queue-census-ro.mjs`, `.spike/delegate/preflight.sh`, `.spike/delegate/dump-conflicts.sh`,
`.spike/delegate/prune-refs.mjs`, `.spike/delegate/compose-loop.mjs`, `.spike/delegate/compaction-policy-probe.mjs`,
`.spike/delegate/context-window-health.mjs`, `.spike/delegate/fleet-health.mjs`. Promotion is a row from `lead`
(#5617 is the precedent id).

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D240, ROADMAP 331)**, with the *next* milestone
(M5) defined and gated this window. The ledger of what each milestone is and how it is closed is now
**`docs/MILESTONES.md`**; the auto-clean ceiling (D249, ROADMAP **311** cut 2 / **344**, intents
`delegate-20261109-release-role` and `delegate-20261109-auto-clean`) is the *other* open thread and is still
spooled, not delivered.

**Current item:** the mechanism is finished; **arming it on the live rig is the only thing left**, and it is an
operator grant. `extensions/continuity.mjs` loads only via `DURIG_EXTENSIONS` (`src/extensions.mjs` has no
auto-discovery on purpose — "which code runs in here" is an explicit operator list), and `cli.mjs config` still
reports `DURIG_EXTENSIONS: null`. Procedure, exact edit and verification: **`docs/runbooks/continuation-notes.md`**.
The team's rows **#5931–#5942** remain unclaimed; the delegate asserted nothing.

**First thing to run:**
`node demo/continuity-note.test.mjs && node demo/offline.mjs && node demo/status-view-bound.test.mjs` (expect
`CONTINUITY PASS`, the offline delegation loop, `STATUS VIEW BOUND OK`; 0.63 s / 0.29 s / 1.8 s, no broker, no key,
no model). Then the two milestone gates — `node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db
./selfdev.sqlite` (exit **0**, *PASS (mechanism)*, 8 operational blockers, 1 advisory) and `node
docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite` (exit **1**: **3 PASS, 1 PARTIAL, 4 FAIL** —
that is M5's honest baseline, not a bug). Then
`node scripts/clockin.mjs`, then `node tools/broker-serve.mjs --status`, then
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (expect `total: 9`, `reapable: 0`, all `seat-root`). If the
operator has supplied `DURIG_LOCAL_API_KEY` / `DURIG_VERIFIER_API_KEY`, start the broker and let `pm` drain the
spooled intents; otherwise the only landable work is the `item-5301` re-cut, which needs a seat.

**State:** refs **12**, worktrees **9**, `main` tip **`b645a8ec`** (check with `git rev-parse --short main`),
`git status --short -- .` empty, suite **280/280** (`node scripts/suite.mjs --jobs 8`, 57 s), nothing forced.
Continuity evidence: `docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09-live.txt` (PASS mechanism,
8 operational blockers, 1 advisory) and `...-demo-store.txt` (PASS mechanism, 1 blocker) — both exit 0. M5
evidence: `docs/evidence/2026-11-09-milestone-m5/gate-baseline-2026-11-09.txt` and
`docs/evidence/2026-11-09-milestone-m5/escape-baseline-2026-11-09.txt`. The 12 refs: 7 seat-root
branches, `main`, `seatroot/linux`, `verify-5180` (ledger: NOTHING-TO-LAND), `wip/seat-prompt-files`
(SUPERSEDED-BY-EVENTS, author re-cut), `item-5301` (the unlandable reap verb).

**Blocker:** the broker is down and no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401
on 127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). Only the operator holds those grants; 10 intents are spooled and **118** sit
as dead-letters in `selfdev.sqlite.broker.inbox.error` (measured 2026-11-09).
**Unverified:** (1) whether an armed live rig produces a note for every seat in one broker pass — the offline
proof is `demo/continuity-note.test.mjs` (5 scenarios) and `demo/offline.mjs`; the live proof needs a broker, which
needs the two provider grants. (2) Whether the note-injection cost is acceptable on a real provider: the faux
provider estimates tokens as chars/4 and never shows a real tokenizer's cache behaviour. Cheapest probe once a key
exists: `node tools/model-probes/…` / the compacteval A/B rows #5939–#5940. (3) Whether `pm` will accept the D249
framing — the intent is spooled, not delivered; delivery, not `intent.mjs`'s `ok:true`, is the evidence (pitfall
141). Probe: `ls -1 selfdev.sqlite.broker.inbox.out/` after the broker's first pass. (4) **The cost of a
spawn-time OS wrapper on this box is unmeasured.** The research report says Landlock is unprivileged and
self-imposed; nothing here has run one. Anyone scheduling ROADMAP 174 must measure the spawn tax in seconds first
(D213), not assume it.

**Traps this window** — `docs/SELFDEV.md` **191–210** (N19 adds: the spend ledger cannot see cache hits because it
only meters metered endpoints, while the durable entries carry 9.64 billion `cacheRead` tokens; a milestone
sentence is not a milestone; before claiming an escape exists, call the guard's own function on the command;
`toolRemovalsFor` has no claim argument and no rule data to consult; 95 registered roadmap items have no queue
row; `check`'s `single-model-rig` passes while the verifier is unregistered — read the two spend lines above the
verdict). Grep for the symptom; the file is ~50,000 tokens.

**Cheap probe that proves the git pass is closed:** `git worktree list | wc -l` → **9**, `git branch --format='%(refname:short)' | wc -l` → **12**, `git status --short -- .` → empty, `node scripts/suite.mjs --jobs 8` → **280/280**.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
