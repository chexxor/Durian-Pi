# durian-pi — NEXT (current pointer)

> **Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-25T01:52Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126, D129).

## NEXT SESSION (2026-10-27T12:05Z — CLOCK-OUT: THE SUITE IS GREEN ON LINUX 236/236, THE CITATION RULE IS BUILT, AND THREE OPERATOR RULINGS ARE OWED BEFORE SEAT WORK RESUMES)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).

**Current item:** nothing is in flight and **no queue item is claimed by the delegate** (it never claims,
completes, defers or routes). The team is stopped on rulings, not on defects. Work registered and BUILT this
session: ROADMAP **190** (the `citation-unresolvable` rule, detection half) and **193** (ambient config vs demo
verdicts). Work registered and NOT started: 189, 191, 192, and the memory/security programme (161–184).

**The single fact that changed today: the suite is 236 pass / 0 fail on Linux.** The Windows-era baseline was
229/235; this box measured 227/8 at the relinked pin, and D129's "six Linux-shaped defects" was stale in both
count and membership. Two of the eight were **product bugs, not OS drift** — `linkWorktreeDeps` handed a script
path to `npm` as a command, so dependency linking had **never** worked on any platform, and
`waitForProcessDeath` on POSIX answered on the first `kill(pid,0)` instead of polling to its deadline, so a
cleanup could report a permanent false "still running". The other six were Windows-shaped fixtures, fixed at
the cause. Commit `3bff94a`; the config-leak half is **193**. **Re-measure, never quote**: `for f in
demo/*.test.mjs; do node "$f" || echo "FAIL $f"; done`.

**Blocker:** three operator rulings, none of them a build:
1. **Cross-family verification on one local model** — `check` reports `single-model-rig`, fix-now: all 12 seats
   resolve to `local/iq3_s` and `/v1/models` serves exactly one model, so an author and its verifier cannot
   differ in family (D48/D119). Options: serve a second family and pay for per-seat base URLs, keep one
   verifier on a remote provider, or waive the rule in writing. **189**.
2. **Evidence binding** — should durable records cite store-native ids (`entries.id`) rather than
   machine-local git objects? This decides how memory items 165/167 and the substrate item 170 are written, so
   ruling it now is cheaper than migrating later. **190**.
3. **`#4785` was marked `done` with no artifact anywhere** — its commit `500969f42` never existed on the
   Windows rig either, and `win/item-4785` points at plain main. That is a completion without an artifact, and
   the honest detector for it is a design question, not a repair. Not yet registered as an item.

**Queue work awaiting the operator, not the delegate:** the 4 stale citations (#3506 #3603 #3743 #4378) are
one-line amendments to the landing commits (`eb7e69c1e`→`ce79c354`, `0c6fd7665`→`0c6fd76e465`; `5d8c6237a` is
context in a row held on #2788), and the 15 gate-cleared orphans plus the five parked questions are answered in
`docs/reviews/parked-questions-2026-10-26.md`. Both are `pm` transitions; the delegate has spooled nothing and
the broker is down.

**Config of record on this box** — the split matters, because `durig.config.json` sits at a
`DEFAULT_CONFIG_PATH` and therefore reaches every demo:
- `durig.config.json` (gitignored) carries **machine identity only**: `DURIG_DB=./selfdev.sqlite`,
  `DURIG_LOCAL_BASE_URL=http://127.0.0.1:47831/v1`, `DURIG_LOCAL_MODEL=iq3_s`, `DURIG_LOCAL_CONTEXT=200000`.
  `demo/local-model-pointer.test.mjs` legitimately reads it to check the tracked rig file against this machine.
- **Rig tuning travels in the launch environment**, where it cannot move a demo's contract:
  `DURIG_MAX_CONCURRENT_SEATS=2 DURIG_STREAM_TIMEOUT_MS=1800000 node cli.mjs …`
- `rig.selfdev.json` (tracked) carries `local/iq3_s` for all 12 seats. Concurrency **2** is measured: 3
  concurrent requests gave ~21 % aggregate for a 2.8× worse worst-request decode.

**Exact next command** (read what the new rule reports, then decide the evidence-binding ruling):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
```

Expected: `pass: true`, 0 errors, ~62 fix-now, and `citation-unresolvable` reporting 4 live rows plus the
308-row terminal baseline recorded in `docs/STATUS.md`.

**Do not:** run `up`/`send`/`run`/`complete` before re-taking the worktree/branch/`.spike` inventory into
`.spike/` and diffing it after (`AGENTS.md` clock-in step 7, `docs/runbooks/workspace-move.md`); run
`git add -A`; use `DURIAN_PI_DB` for the CLI (the variable is `DURIG_DB`); quote the suite number instead of
measuring it; or start broker work on this workspace — the store is intact but its git history is only
partially here (`git cat-file -t 78991031` fails; the docs' own baseline sha is not an object in this clone).
