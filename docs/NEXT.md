# durian-pi — NEXT (current pointer)

> **Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-25T01:52Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126, D129).

## NEXT SESSION (2026-10-27T20:55Z — CLOCK-OUT: THE SECOND PROVIDER IS IN, THE SUITE IS CONCURRENT (41s), AND THE VERIFIER SEAT FLIP WAITS ON ONE LM STUDIO SETTING)

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
the cause. Commit `3bff94a`; the config-leak half is **193**.

**Run the gate with `node scripts/test.mjs`, never a hand-loop.** It runs 8 at once by default (D135) and measures
**238/238 in 41.2s** here; the serial loop costs **276.8s** for the identical tests. It prints per-test durations
and the 5 slowest, turns a hung demo into `TIMEOUT` instead of never returning, and
`demo/test-runner-concurrency.test.mjs` pins the default so the concurrency cannot be lost again. Use `--jobs 16`
only when nothing else runs: this box also serves two models, and at 16 the suite competes with the rig it tests.

**Blocker:** three operator rulings, none of them a build:
1. **Cross-family verification on one local model — the CAPABILITY is now landed; only the seat flip is owed.**
   A second locally-served provider (`verifier`) registers beside `local` (`src/providers/local.mjs`, pinned by
   `demo/second-local-provider.test.mjs`, which also pins two couplings a naive version would have broken
   silently: the **D105 between-items context reset** was gated on the literal string `"local"`, so a second local
   provider would never reset and would drift into the compaction wall while reading healthy; and the **declared
   context window** was read from a single spec, so the second window would be absent, not wrong). Tool calling
   was proven on the live endpoint BEFORE building anything (`finish_reason: tool_calls`, valid JSON args). **Why
   no seat points at it yet:** Flint is loaded as **Q8_0 (42.35 GB) at 262,144 context on a 16 GB card**, decodes
   at **2.8–14.5 tok/s**, and pulled the **primary from 31–39 tok/s down to 11.0** — the rig got slower on the
   model it already uses. Finish by reloading LM Studio at **`UD-IQ2_XXS` (11.86 GB, VRAM-resident) with context
   65,536**, re-measuring, then setting `qa`/`qa2`/`auditor` to `verifier/recursivesi/flint` in `rig.selfdev.json`
   and confirming `check` clears `single-model-rig`. **Before routing real work**, run the seeded-bug calibration
   in ROADMAP 189 — Flint is 5 days old with no published evals, so its capability is unverified. **LM Studio owns
   that instance: never restart it unasked.** D134.
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
  `DURIG_LOCAL_BASE_URL=http://127.0.0.1:47831/v1`, `DURIG_LOCAL_MODEL=iq3_s`, `DURIG_LOCAL_CONTEXT=200000`, and
  now `DURIG_VERIFIER_BASE_URL=http://127.0.0.1:1234/v1`, `DURIG_VERIFIER_MODEL=recursivesi/flint`,
  `DURIG_VERIFIER_CONTEXT=65536`, `DURIG_VERIFIER_MAX_TOKENS=32768`.
  `demo/local-model-pointer.test.mjs` legitimately reads it to check the tracked rig file against this machine.
  `DURIG_VERIFIER_CONTEXT` is a **chosen cap**, not the server's ceiling — LM Studio currently reports
  `loaded_context_length: 262144`.
- **Rig tuning travels in the launch environment**, where it cannot move a demo's contract:
  `DURIG_MAX_CONCURRENT_SEATS=2 DURIG_STREAM_TIMEOUT_MS=1800000 node cli.mjs …`
- `rig.selfdev.json` (tracked) carries `local/iq3_s` for all 12 seats. Concurrency **2** is measured: 3
  concurrent requests gave ~21 % aggregate for a 2.8× worse worst-request decode.

**Exact next command** (the gate, then what the second provider still reports):

```bash
node scripts/test.mjs
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
```

Expected: `pass: true`, 0 errors, ~62 fix-now, and `citation-unresolvable` reporting 4 live rows plus the
308-row terminal baseline recorded in `docs/STATUS.md`.

**Do not:** run `up`/`send`/`run`/`complete` before re-taking the worktree/branch/`.spike` inventory into
`.spike/` and diffing it after (`AGENTS.md` clock-in step 7, `docs/runbooks/workspace-move.md`); run
`git add -A`; use `DURIAN_PI_DB` for the CLI (the variable is `DURIG_DB`); measure the suite with a serial
hand-loop instead of `node scripts/test.mjs`; **route any seat at Flint while it is loaded as Q8_0** (2.8–14.5
tok/s, and it halves the primary); restart the operator's LM Studio instance without asking; or start broker work
on this workspace — the store is intact but its git history is only partially here
(`git cat-file -t 78991031` fails; the docs' own baseline sha is not an object in this clone).
