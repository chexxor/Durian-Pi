# NEXT.md — current state and next actions

**Last update:** 2026-11-09T07:5xZ (delegate session **N17** — the operator said "finish landing and cleaning up
branches and worktrees… After this cleanup, we should prioritize to fix the rig auto landing and auto cleaning
process". **The git side is closed.** `git worktree list` **58 → 9**, `git branch` **60 → 12**, `main`
`6787bd24` → **`ea12fe04`**, `git status --short -- .` empty, **zero `--force`**, suite **278/278 in 60 s**. What
removes no more clutter is not git: the 9 trees left are the **seats' own roots**, and the 12 refs left are those
seven seat-root branches plus `main`, `seatroot/linux`, `verify-5180`, `wip/seat-prompt-files` and `item-5301`.
**The next work is a queue-design act, not a git act** — see Current item 1.)

**Milestone this window worked** — **closing the branch/worktree backlog and naming the ceiling of the
auto-cleaner** (release-role intent `delegate-20261109-release-role`; ROADMAP **311** cut 2 and **344**; the
decision is **D249**). Inside it, **ensuring LLM task completion (D226)**, first tranche **ROADMAP 331**, is still
the substantive product thread: `item-5306` landed the nested compaction overrides, `src/config.mjs` reads
`compaction.modelOverrides = layered`, and `demo/config.test.mjs` is green in the 278-test suite.

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
3. **The continuity cluster** (D240 / ROADMAP 331) — unchanged from N16: `pm` decomposed **#5931/#5932** (impl,
   the `durig.notes` doc), **#5933/#5934** (devtools, the `DURIG_NOTES_DIR` seam), **#5935** (impl, mirror at
   wake/compaction/reset), **#5936/#5937** (impl, the `beforeCompact` hook), **#5939/#5940** (qa, the compacteval
   A/B), **#5941** (impl, the offline reset-mid-item demo), **#5942** (scribe, the runbook). The duplicate-row
   defect is live — confirm before claiming.
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
and `delegate-20261109-auto-clean`) that cannot be delivered while the broker is down, and **59 dead-letters** in
`selfdev.sqlite.broker.inbox.error` — read one before assuming an intent was lost.

**Traps this window** — `docs/SELFDEV.md` **186–190** (this pass: a composed merge can silently revert a shipped
capability and the derived suite will not see it; backticks inside the CLI usage template literal break the whole
CLI; a demo and its implementation can disagree about the return shape; the worktree count is pinned by queue
state, not git; `channel-preflight.mjs` is itself broken by the config-key guard) and **173–185**. Grep for the
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

**Milestone this window worked** — **closing the branch/worktree backlog and naming the ceiling of the
auto-cleaner** (D249, ROADMAP **311** cut 2 / **344**, intents `delegate-20261109-release-role` and
`delegate-20261109-auto-clean`).

**Current item:** the auto-clean ceiling — a landed branch must close its row. **`#5221`, `#5226`, `#5387`, `#5501`
are `held`/`deferred` and `#5829` is `claimed` even though all five branches are now on `main`;** the decision is
D249 and the re-cut target is `item-5301` (ROADMAP 311 cut 2). Owner: `pm` (routing) and the author seats (row
closure) — the delegate claims nothing.

**First thing to run:** `node scripts/clockin.mjs`, then `node tools/broker-serve.mjs --status`, then
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (expect `total: 9`, `reapable: 0`, all `seat-root`). If the operator
has supplied `DURIG_LOCAL_API_KEY` / `DURIG_VERIFIER_API_KEY`, start the broker and let `pm` drain the two
spooled intents; otherwise the only landable work is the `item-5301` re-cut, which needs a seat.

**State:** refs **12**, worktrees **9**, `main` **`ea12fe04`**, suite **278/278**, tree clean, nothing forced.
Nothing on the git side is pending. The remaining 12 refs: 7 seat-root branches, `main`, `seatroot/linux`,
`verify-5180` (ledger: NOTHING-TO-LAND), `wip/seat-prompt-files` (SUPERSEDED-BY-EVENTS, author re-cut),
`item-5301` (the unlandable reap verb).

**Blocker:** the broker is down and no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401
on 127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). Only the operator holds those grants; 10 intents are spooled and 59 sit as
dead-letters in `selfdev.sqlite.broker.inbox.error`.

**Unverified:** whether `pm` will accept the D249 framing — the intent is spooled, not delivered; delivery, not
`intent.mjs`'s `ok:true`, is the evidence (pitfall 141). Probe: `ls -1 selfdev.sqlite.broker.inbox.out/` after the
broker's first pass.

**Cheap probe that proves the git pass is closed:** `git worktree list | wc -l` → **9**, `git branch --format='%(refname:short)' | wc -l` → **12**, `git status --short -- .` → empty, `node scripts/suite.mjs --jobs 8` → **278/278**.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
