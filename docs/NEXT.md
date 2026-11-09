# NEXT.md — current state and next actions

**Last update:** 2026-11-09T07:5xZ (delegate session **N16** — the operator said "finish landing and cleaning up branches
and worktrees". **There is nothing left to land, and the clutter is down**: `git worktree list` **80 → 58**, `git branch`
**76 → 60**, `main` unmoved at **`dd217b88`**, `git status --short -- .` empty, `git worktree prune --dry-run --verbose`
silent, **zero `--force`**. The two refs still ahead of `main` are **not merge jobs** — see the census below. The other
49 item worktrees are pinned by **queue state**, not by git, so the next pass is a queue pass.

**N15 recap** — the operator said "run the landing pass now". **58 branches landed** in two passes: `main` moved `7609831c` → `429f2b5a` → `08a8453c` → `85e1127f`
→ `fca496a9` → `b8b94380` → **`21114c36`** (58 `merge: land` commits; 170 commits, 147 files, +7,926/−485 since
session start). Every landing went through `scripts/land.mjs` (tree-clean gate, text-integrity gate, genlock slot); the 20
conflicts were **composed in scratch worktrees**, never side-picked in the shared tree (D248, pitfall 179). Suite: **262/265
before** (`08a8453c`) → **278/278 after** (`21114c36`, 60.5 s, `--jobs 8`). Broker was wedged (`pid 114848`,
heartbeat fresh, last pass 05:20:31Z = 3,162 s before the pass) — `serve --stop` refused, `kill` logged
`EXIT pid=114848 reason=deadline passes=-`, and with it down `cli.mjs status` answers in **0.96 s** and
`tools/queue-drain-audit.mjs` in **1.26 s**. **The fleet is stopped**; restarting it is the operator's call (see the
Blocker row).

The previous window (N14) asked whether a **release manager / ops
seat** should own merging all completed branches, and to prioritise that over the delegate landing branches by hand.
The delegate agrees, with one hard constraint found in the rig's own runbook: **a broker-hosted seat cannot drive a
landing pass** (`docs/runbooks/land.md:427-431` — quiescing requires stopping the broker, which ends the seat's run;
land.md also says `land` is the delegate's/operator's action). So the role is split: a seat owns the *continuous
readiness inventory and the ordered landing plan*; the quiesce-then-merge pass stays outside the broker until a base
seam exists. Intent spooled to `pm`, requestId `delegate-20261109-release-role`. Goal `mw88k2at-1ozydj` (continuity
notes, D240) is **paused** by the operator at this point.
N14 measured 151 item branches, 62 ahead, 83 commits unlanded, 43 clean, 19 conflict. N15 landed **58** of those
62, pruned **80 merged refs**, and re-measured: **5 refs ahead**, `main` = **`21114c36`**.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

**Cost (measured 06:2xZ, `selfdev.sqlite.spend.jsonl`):** 2,030 ledger lines, **$0.92401** cumulative, **$0.03462** on
2026-11-09 UTC — all of it before this pass; the fleet ran until 05:20:31Z and the landing pass itself spent no model
tokens. Field names are `usd` / `prompt_tokens`, not `costUSD` (pitfall 145), and the ledger is untracked **and not
gitignored**, which is why `land.mjs` refuses a dirty tree (ROADMAP 310).

## NEXT SESSION

**Milestone this window worked** — **landing the unlanded backlog and clearing the branch/worktree clutter**
(release-role intent `delegate-20261109-release-role`, Part A: inventory + train; ROADMAP **311** and **344**). The
backlog is now *closed as a merge problem*: 2 refs remain ahead of `main`, neither is a merge job, and the hand pass is
80 → 58 worktrees / 76 → 60 refs with nothing forced. Inside it, **ensuring LLM task completion (D226)**,
first tranche **ROADMAP 331**: `item-5306` landed `fix(331,#5306): nest per-model compaction overrides inside`, so
`src/config.mjs:520` reads `compaction.modelOverrides = layered` and `demo/config.test.mjs` is green in the 278-test
suite. N13's priority order still stands: compaction is the thing to *avoid*, not perfect — the continuity design is
`docs/reviews/architecture-context-continuity-2026-11-09.md`, and `beforeCompact`
(`pi-durable dist/harness/compaction.js:82-88`) lets an extension supply the summary, removing the summariser call that
produced 218 truncations and 209 run-cap refusals.

**Current item (priority order, as the operator set it on 2026-11-09):**
1. **The release role** — spooled to `pm` as `delegate-20261109-release-role`, still undrained. Part A is seat-ownable
and needs no model spend: keep the landing list current (three gates: verified in queue, tip matches the list, clean
against CURRENT main), order the train (each stacked entry names its base, `land.md:400-410`), report the 20 conflicts
with a named owner, own worktree/branch hygiene (ROADMAP 311, 344). Part B — the quiesce-then-merge act — is **not**
seat-ownable; it is a base-seam question (ROADMAP 131 `pause`, a broker-side quiesced boundary).
2. **The continuity cluster** (D240 / ROADMAP 331), already decomposed by `pm`: **#5931/#5932** `impl` define the
`durig.notes` doc; **#5933/#5934** `devtools` the `DURIG_NOTES_DIR` seam; **#5935** `impl` the mirror at
wake/compaction/reset; **#5936/#5937** `impl` the `beforeCompact` hook; **#5939/#5940** `qa` the compacteval A/B;
**#5941** `impl` the offline reset-mid-item acceptance demo; **#5942** `scribe` the runbook. Each subject appears twice
— the duplicate-row defect is live; confirm before claiming.
3. **The compaction fallback fix** #5785 — the code is on `main` now; the row is `deferred` and its own subject reads
"nesting DONE on item-5306", so closing it is a zero-build act for its owner, not work.

**Reclaim census (measured at `dd217b88`, session N16). Only **2** refs are ahead of `main`, and neither is a merge job.**
`git cherry main item-5094` = two `-`, `item-5488` = one `-`, `item-5686` = one `-`: all three refs removed with the
sanctioned verb `node cli.mjs worktree prune-branch <ref>`, which prints the recovery command (`item-5094` came back with
`git branch item-5094 5593bc0391251a72c5f6b09cd4bfd4f246ec6970`). Its **worktree** was already released in N15 because the
lock's own release condition was met (#5173 `done`). `wip/seat-prompt-files` (one `+`) is dispositioned
**SUPERSEDED-BY-EVENTS** (DISPOSITIONS:199): a **re-cut job for its author seat** (land.md Do 0b), not a delegate merge. Its
parked mid-merge scratch (`MERGE_HEAD 262dc1c2`, `UU cli.mjs`) is exported to
`.spike/delegate/quarantine/2026-11-09/wip-seat-prompt-files/residue.patch` (5,779,403 B) and the tree released; the ref is
intact at `04e3ba6b`. `verify-5180` is a verify-tree **snapshot** whose only commit ahead is a merge, so `git cherry`
prints nothing, `prune-branch` refuses it and `git branch -d` refuses it - recorded **NOTHING-TO-LAND** in
`docs/DISPOSITIONS.md`; the ref stays (rule R-B). Thirteen more refs went by `git branch -d`, each proved an ancestor of
`main` first (`git merge-base --is-ancestor`): 4827 5272 5306 5331 5338 5487 5655 5669 5675 5713 4846 5208
impl-item-5094-recut.
**What remains, and why it is a floor rather than debt:** `cli.mjs worktree audit` total 58 = **49 item trees** (35
`deferred`, 11 `held`, 3 `claimed`; every branch merged, `ahead=0`, `dirty 0`) + **9 seat roots**. `reapable: 0` is the
CORRECT answer, not a failed pass - the sweep needs TERMINAL + UNLOCKED + CLEAN, and closing those 49 rows is the seats'
act, not a git verb (SELFDEV pitfall 185).
**Six landed rows are still non-terminal** and their owners must close them (the delegate claims nothing): #5362,
#5491, #5501, #5699 deferred; #5820 claimed; #5912 held. 36 of the 42 landed rows are `done`.

**Exact next command** — the broker is **down** (killed 06:13:32Z after `serve --stop` refused; `cli.mjs resume`
cancelled one stranded run, `impl` submission 418542, `run-cancelled`). Nothing drains until a broker starts, and two
things gate that: the verifier provider registers **no model row** on this box (`"registration-refused"`,
`"provider":"verifier"`, `"model":"openai/gpt-oss-120b"`, `"causes":["metered-endpoint-unkeyed"]` — the tool's own
remedy: set `DURIG_VERIFIER_API_KEY`), and the spend cap refuses `google/gemini-3.1-pro` ($14 max call exposure against
a $4 store cap).
```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/clockin.mjs                                 # BEFORE starting a broker; it hangs while one drives
node tools/broker-serve.mjs --status                     # state + genlock + spool depth + provider reachability
node cli.mjs status                                      # ~1 s once the broker is healthy
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 1.3 s, read-only: 6,021 rows
node scripts/test.mjs --area docs                        # 6/6 expected
```
Landing census, run **inside the loop**, not once (pitfall 173):
`git merge-tree --write-tree main "$b" >/dev/null 2>&1 && node scripts/land.mjs "$b" --db ./selfdev.sqlite`.

**Landing is the operator's/delegate's act, not a seat's.** `scripts/land.mjs` refuses on a dirty tree or an in-flight
generation; the pass needs a quiesced window (`docs/runbooks/land.md`, `docs/runbooks/merge.md`). Before a pass,
`git status --porcelain` must be empty **including untracked** (ROADMAP 310 — `selfdev.sqlite.spend.jsonl` is untracked
and not ignored, and it blocked a whole train), and stray `item-*/` directories block the helper even when porcelain is
clean (`/item-*/` is gitignored): **58 registered worktrees** right now (162 → 81 → 58). **Pruning is no longer stuck:** `cli.mjs worktree audit` classified
**80 trees as `reapable`** (terminal item, unlocked, clean), `git worktree remove` took all 80 with **zero refusals**,
and `git worktree prune` + `git branch -d` deleted **80 refs** — 156 → 76 refs, `main` unmoved, nothing forced. What
is left is explained, not stuck: **54** merged+clean trees stay because their item is not terminal (49 rows are
live) or the tree is locked (60 locked), **17** are merged but dirty and were left alone deliberately (runbook: a
refused removal means files that exist nowhere else — name them, never `--force`; `item-5488` and `item-5686` each
hold 155 staged paths whose diff against `main` is 22 files / 21 insertions), 5 hold the unmerged refs above, and 5
are detached verify scratch. `complete_work` still refuses to remove worktrees because of npm `.bin` symlinks
(pitfall 133), so the sweep — not a hand pass — should own this each session. A stale base is a **re-cut job for the
author seat**, not a merge job for the delegate (`land.md` Do 0b).

**Read-path caveat.** While a broker is resident every CLI read routes through it (`src/readclient.mjs:106-111`); a
stalled pass loop makes every read block with 0 bytes while a direct read-only sqlite query answers fine — "empty queue"
and "cannot read the queue" print the same thing (pitfalls 152, 176). An empty `genlock` is **not** proof no generation
is in flight (pitfall 150); compare `heartbeatAt` with `lastPassAt` before calling a stall (pitfall 165).

**Suite on `main` (`21114c36`; `main` is now `dd217b88`, the two commits since are docs-only — `git diff --stat 21114c36..dd217b88`
prints DECISIONS/NEXT/SELFDEV only): `node scripts/test.mjs --all --jobs 8` → **278/278 in 60.5 s** (278 tests, 9
areas). **Green.** The two reds at `d6118d0e` were stale tests, not landing damage, and both are fixed in `21114c36
(pitfall 180): `demo/clockin-digest.test.mjs` asserted #5596's per-seat inline list against #5398's shipped aggregate,
and `demo/verifier-arm-probe.test.mjs` asserted an unpriced metered endpoint while `durig.config.json` now prices one.
`demo/seat-turn-shape.test.mjs` was flaky under `--jobs 8` earlier in the pass and passed in the final run.

**Is the team operating?** No — the fleet is stopped with the broker. Queue: 6,021 rows,
`done 4154 / cancelled 873 / held 461 / deferred 383 / claimed 12 / queued 138`. Closed by the pass: the parked-wake defect
**#5740** and its implementation **#5741** are both `done`, `item-5740` landed as **D247**, and the fix is on `main`
(`parkedSignature` at `src/driver.mjs:69`, the `PARKED-WAKE seat=… reason=…` log line at `src/broker.mjs:1434`); its
worktree was reaped with the 80. **Capacity:**
`DURIG_MAX_CONCURRENT_SEATS = 4` (D238), gate covers `local/*` since `4efce137`; both boxes serve
`qwen3.8-flash-next-q2_0`, so `local2` buys throughput, not family independence. **Standing, deliberately unresolved:**
the operator's "we can re-evaluate later whether we can afford to host a verifier model on localhost" — still no queue
row; minting it is a seat act.

**Broker posture at clock-out (06:2xZ):** DOWN. pid 114848 (started 03:20:33Z, `--max-duration 7200`) logged 1,002
passes then hit its bound: last pass 05:20:31Z, heartbeat fresh, verdict `degraded`, no genlock file; `serve --stop`
refused, `kill` logged `2026-11-09T06:13:32.508Z EXIT pid=114848 reason=deadline passes=-`. Spool: 9 pending intents
(incl. the release-role one) and 59 dead-letters.

**Blocker:** two, and only the operator can clear the second. (1) the release-role intent is spooled and undrained —
`ls -1 selfdev.sqlite.broker.inbox` still shows 1 file and the last `INTENT` line in `selfdev.sqlite.broker.log` is
03:45:30Z; delivery, not `intent.mjs`'s `ok:true`, is the evidence (pitfall 141). (2) **no provider will register a
model on this box right now** — `broker-serve --status` reports four BLOCKs: `provider-DURIG_LOCAL_-unauthorized`
(127.0.0.1:8080 answers `/v1/models` with 401 — set `DURIG_LOCAL_API_KEY`), `provider-verifier-no-key` and
`provider-verifier-refuses-inference` (`DURIG_VERIFIER_API_KEY` unset; the store shows this shape 18,309 times, 402
"You need positive balance to do inference"), and the spend cap refuses `google/gemini-3.1-pro` ($14 max call exposure
against a $4 store cap). Keys and balance are grants the operator holds.

**Traps this window** — `docs/SELFDEV.md` **173–185** (this pass: re-preflight inside the loop; the text-integrity
gate is absolute, so `main`'s own BOMs block otherwise-clean branches; a batch landing must regenerate
`demo/test-areas.json`; a wedged broker reads exactly like an empty queue; run `git cherry` before calling a branch
unlanded; a conflict is a stop and the composition goes stale when `main` moves; a landed branch can ship a test that
pins a superseded shape; `worktree audit`'s `reapable` set is the cheap way to free merged refs) and **130–169**.
Grep for the symptom; the file is ~50,000 tokens.

**Probes left for promotion** (gitignored `.spike/`, read-only, no model spend, broker-down safe):
`.spike/delegate/queue-census-ro.mjs` (branch-vs-queue census that works with the broker down),
`.spike/delegate/reclaim-pass.sh` (the whole branch/worktree reclaim: diagnose the ahead set, export each terminal tree's
residue, remove, prune refs, then close patch-equivalent refs with `worktree prune-branch` — ran 2026-11-09, 22 trees
and 16 refs, zero `--force`),
`.spike/delegate/preflight.sh` (clean/conflict census against current `main`),
`.spike/delegate/dump-conflicts.sh` (one file per branch of the conflicting hunks, under
`.spike/delegate/conflicts/`), `.spike/delegate/prune-refs.mjs` (delete refs that are ancestors of
`main` and not checked out anywhere — 80 deleted this pass), `.spike/delegate/compose-loop.mjs` (the journal
composer), `.spike/delegate/compaction-policy-probe.mjs`, `.spike/delegate/context-window-health.mjs`,
`.spike/delegate/fleet-health.mjs`. Promotion is a row from `lead` (#5617 is the precedent id).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
