# NEXT.md — current state and next actions

**Last update:** 2026-11-09T09:0xZ (delegate session **N18** — the continuity-note leg of ROADMAP **331**
(D240) was built and verified on the extension plane, and the read surfaces it depends on were bounded. **The git
side is still closed** from N17: `git worktree list` **9**, `git branch` **12**, suite **280/280 in 60 s**
(`node scripts/suite.mjs --jobs 8`), `git status --short -- .` empty before this session's writes. What is now
armed and what is not is stated in *Exact next command* below.)

**Milestone this window worked** — **ensuring LLM task completion (D226 / D240), first tranche ROADMAP 331** — a
seat can now carry a durable continuation note instead of a compaction summary, and the read surfaces that would
have re-introduced the blowup are bounded. Rows **#5931–#5942** (the team's decomposition of this cluster) are
still unclaimed; the delegate built and verified the mechanism but asserted no row.

**N17 still holds the git verdict**: worktrees **58 → 9**, refs **60 → 12**, `main` `6787bd24` → **`ea12fe04`** on
the code, zero `--force`. Read the live tip with `git rev-parse --short main`. The 9 trees left are the seats'
own roots; **the next git-side work is a queue-design act, not a git act** (D249) — see Current item 1.

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

1. **Decide how a landing closes its row** — spooled to `pm` as **`delegate-20261109-auto-clean`** (in
   `selfdev.sqlite.broker.inbox`, undrained: the broker is down). Three options with their costs, all recorded in
   D249 and in `docs/runbooks/branch-cleanup.md` § "The ceiling": (a) `land.mjs` dispositions the row — cheapest,
   but puts a store write in the delegate's hands; (b) the author seat closes its own row after `land` records the
   sha — keeps ownership clean, needs the fleet running; (c) the sweep treats "branch ⊂ main AND gates terminal"
   as its own keep-decision — no status write, but the row then lies about the tree. **Recommendation: (b)**,
   because it preserves the rule that a delegate never asserts acceptance.
2. **Re-cut `item-5301`** (the `worktree reap` verb, ROADMAP 311 cut 2, tip `39f8c92c`). Two reproduced defects,
   both in the branch, not in `main`: backticks inside the `usages:` template literal make `cli.mjs`
   unparseable, and `reapWorktrees` returns only the removed ids while
   `demo/worktree-reap.test.mjs:114` asserts `candidates` / `refusedSoleCarrier` / `kept` / `counts.reapable`.
   This is a seat's re-cut job (the author's branch is stale relative to `main`), not a delegate merge.
3. **The continuity cluster** (D240 / ROADMAP 331) — the mechanism now **exists and is verified offline**:
   `extensions/continuity.mjs` (the `durig.notes` doc, `read_note`/`write_note`/`continue_from_note`, the static
   `durig-continuity` prompt section, and a `beforeCompact` hook that supplies the summary so the summariser call
   never happens), proved by `demo/continuity-note.test.mjs` (0.40 s, exit 0) and `demo/offline.mjs` (0.29 s, pm →
   worker → done with one mid-item `pi.reset`). **It is not yet armed on the live rig**: `DURIG_EXTENSIONS` is
   unset, so `cli.mjs config` reports no extension and `selfdev.sqlite` has no `durig.notes` documents. Arming it
   is an operator grant. Rows **#5931/#5932** (impl), **#5933/#5934** (devtools), **#5935** (impl),
   **#5936/#5937** (impl), **#5939/#5940** (qa), **#5941** (impl), **#5942** (scribe) remain the team's to claim —
   the duplicate-row defect is live, confirm before claiming.
4. **#5785** the compaction fallback — code is on `main`, the row is `deferred`, its own subject says "nesting
   DONE on item-5306". Closing it is a zero-build act for its owner.

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

Expected from the last line (exit 1, and that is the truth of the live store right now): `DURIG_EXTENSIONS:
(unset) - no extension is loaded, so the mechanism cannot exist yet` and `note documents in the store: none`. The
same gate run against the demo store —
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

**Milestone this window worked** — **ensuring LLM task completion (D240, ROADMAP 331)**: a seat can carry a durable
continuation note through a reset/compaction boundary with **zero summariser model calls**, and the read surfaces
that would re-introduce the blowup are bounded. The auto-clean ceiling (D249, ROADMAP **311** cut 2 / **344**,
intents `delegate-20261109-release-role` and `delegate-20261109-auto-clean`) is the *other* open thread and is still
spooled, not delivered.

**Current item:** arm the continuity extension on the live rig. `extensions/continuity.mjs` exists, loads only via
`DURIG_EXTENSIONS`, and is proved offline — but `cli.mjs config` reports `DURIG_EXTENSIONS: null` and
`selfdev.sqlite` holds no `durig.notes` document, so the mechanism is not yet running in any seat. Arming it is an
operator grant (it changes what code runs in every seat). Procedure and the exact edit:
**`docs/runbooks/continuation-notes.md`**. The team's rows **#5931–#5942** remain unclaimed; the delegate asserted
nothing.

**First thing to run:**
`node demo/continuity-note.test.mjs && node demo/offline.mjs && node demo/status-view-bound.test.mjs` (expect
`CONTINUITY PASS`, the offline delegation loop, `STATUS VIEW BOUND OK`; 0.40 s / 0.29 s / 1.8 s, no broker, no key,
no model). Then `node scripts/clockin.mjs`, then `node tools/broker-serve.mjs --status`, then
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (expect `total: 9`, `reapable: 0`, all `seat-root`). If the
operator has supplied `DURIG_LOCAL_API_KEY` / `DURIG_VERIFIER_API_KEY`, start the broker and let `pm` drain the two
spooled intents; otherwise the only landable work is the `item-5301` re-cut, which needs a seat.

**State:** refs **12**, worktrees **9**, `main` tip from `git rev-parse --short main` (code landed at `ea12fe04`;
this session's work is committed as **`26d52d43`** — `git status --short -- .` is empty), suite **280/280**
(`node scripts/suite.mjs --jobs 8`, 56 s), nothing forced. What `26d52d43` contains: `extensions/continuity.mjs`,
`demo/continuity-note.test.mjs`, `demo/status-view-bound.test.mjs`, `docs/runbooks/continuation-notes.md`, plus
edits to `cli.mjs`, `src/readapi.mjs`, `src/config.mjs`, `src/providers/local.mjs`, `scripts/clockin.mjs`,
`durig.config.default.json`, `demo/config.test.mjs`, `demo/offline.mjs`, `demo/test-areas.json`,
`docs/SELFDEV.md`, `docs/DECISIONS.md`, `docs/runbooks/README.md` and this file. The remaining 12 refs: 7 seat-root branches, `main`,
`seatroot/linux`, `verify-5180` (ledger: NOTHING-TO-LAND), `wip/seat-prompt-files` (SUPERSEDED-BY-EVENTS, author
re-cut), `item-5301` (the unlandable reap verb).

**Blocker:** the broker is down and no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401
on 127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). Only the operator holds those grants; 10 intents are spooled and 59 sit as
dead-letters in `selfdev.sqlite.broker.inbox.error` (118 measured 2026-11-09).

**Unverified:** (1) whether the extension armed on the **live** rig produces a note for every seat in one broker
pass — the offline proof is `demo/continuity-note.test.mjs`; the live proof needs a broker, which needs the two
provider grants. Cheapest probe with the broker down: `node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite`, which currently says the mechanism "cannot exist yet". (2) Whether `pm` will accept the D249 framing — the intent is spooled, not delivered; delivery, not `intent.mjs`'s `ok:true`, is the evidence (pitfall 141). Probe: `ls -1 selfdev.sqlite.broker.inbox.out/` after the broker's first pass.

**Cheap probe that proves the git pass is closed:** `git worktree list | wc -l` → **9**, `git branch --format='%(refname:short)' | wc -l` → **12**, `git status --short -- .` → empty, `node scripts/suite.mjs --jobs 8` → **278/278**.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
