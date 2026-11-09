# NEXT.md — current state and next actions

**Last update:** 2026-11-09T06:2xZ (delegate session **N15** — the operator said "run the landing pass now". **42
branches landed**: `main` moved `429f2b5a` → `08a8453c` → `d6118d0e`, 42 two-parent merge commits, 97 commits, 84 files
changed, +4,783/−253. Every landing went through `scripts/land.mjs` (tree-clean gate, text-integrity gate, genlock
slot), and the pass was proven by a full suite before and after: **262/265 before** (`08a8453c`) and **276/278 after**
(`d6118d0e`, 61.1 s and 65.5 s, `--jobs 8`) — no landing introduced a red; the only new reds were two derived-manifest
failures caused by a landed demo and fixed in `58dd8ad2`. Backlog after the pass: **24 refs / 35 commits ahead of
`main`** — **4** merge clean — three of them then refused by the BOM gate, see pitfall 174), **20** conflict. Broker was
wedged (`pid 114848`, heartbeat fresh, last pass 05:20:31Z = 3,162 s before the pass) — `serve --stop` refused, `kill`
logged `EXIT pid=114848 reason=deadline passes=-`, and with it down `cli.mjs status` answers in **0.96 s** and
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
N14 measured 151 item branches, 62 ahead, 83 commits unlanded, 43 clean, 19 conflict. N15 landed 42 of those 62 and
re-measured: **24 refs ahead** (`git rev-list --count main..<ref>` > 0), **35 commits**, **4** clean against current
`main`, **20** conflicting. `main` = **`d6118d0e`**.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

**Cost (measured 06:2xZ, `selfdev.sqlite.spend.jsonl`):** 2,030 ledger lines, **$0.92401** cumulative, **$0.03462** on
2026-11-09 UTC — all of it before this pass; the fleet ran until 05:20:31Z and the landing pass itself spent no model
tokens. Field names are `usd` / `prompt_tokens`, not `costUSD` (pitfall 145), and the ledger is untracked **and not
gitignored**, which is why `land.mjs` refuses a dirty tree (ROADMAP 310).

## NEXT SESSION

**Milestone this window worked** — **landing the unlanded backlog** (release-role intent
`delegate-20261109-release-role`, Part A: inventory + train), and inside it **ensuring LLM task completion (D226)**,
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

**Unlanded backlog (measured 06:2xZ against `d6118d0e`): 24 refs / 35 commits ahead.** 20 conflict, named by file so an
owner can be assigned: `docs/DECISIONS.md` 4846, 5208, 5211, 5275, 5740, 5824; plus `docs/NEXT.md` 5615, 5684, 5712;
`docs/runbooks/broker-down-or-stalled.md` 4879, 5663, 5758; `docs/runbooks/session-start-cost.md` +
`scripts/clockin.mjs` 5596; 5398 (`docs/NEXT.md`, `demo/clockin-digest.test.mjs`); `demo/local-slot-gate.test.mjs` +
`demo/test-areas.json` 5488, 5686; `inputs/fetched/README.md` 5393; `tools/README.md` 5617; `docs/SELFDEV.md` 5702;
`cli.mjs` + `prompts/impl.md` + `rig.selfdev.json` (`wip/seat-prompt-files`). **4 merge clean but refused by
`scripts/land.mjs`**: `item-5094`, `item-5400`, `impl-item-5094-recut` — all carry a **UTF-8 BOM on
`scripts/sync-pi.mjs`**, which `main` itself ships (`git show main:scripts/sync-pi.mjs | head -c 3 | xxd` → `efbbbf`);
strip it on `main` and all three land. `verify-5180` merges clean but is a verify-tree snapshot — never merge a snapshot
(branch-cleanup step 4). `item-5488` needs no build: `git cherry main item-5488` prints one `-`.
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
clean (`/item-*/` is gitignored): 154 registered worktrees right now. A stale base is a **re-cut job for the author
seat**, not a merge job for the delegate (`land.md` Do 0b).

**Read-path caveat.** While a broker is resident every CLI read routes through it (`src/readclient.mjs:106-111`); a
stalled pass loop makes every read block with 0 bytes while a direct read-only sqlite query answers fine — "empty queue"
and "cannot read the queue" print the same thing (pitfalls 152, 176). An empty `genlock` is **not** proof no generation
is in flight (pitfall 150); compare `heartbeatAt` with `lastPassAt` before calling a stall (pitfall 165).

**Suite on `main` (`d6118d0e`):** `node scripts/test.mjs --all --jobs 8` → **276/278 in 57 s** (278 tests, 9 areas).
Reds: `demo/verifier-arm-probe.test.mjs` — "an unpriced metered endpoint must exit non-zero (the spike copy exited 0 —
the false-green shape #5090 removed)" — and `demo/clockin-digest.test.mjs` — "digest is 20274 B, over its 20000 B
budget". Both were red before this pass (262/265 at `08a8453c`); neither was caused by a landing.
`demo/seat-turn-shape.test.mjs` is flaky under `--jobs 8` and passes standalone.

**Is the team operating?** No — the fleet is stopped with the broker. Queue: 6,021 rows,
`done 4154 / cancelled 873 / held 461 / deferred 383 / claimed 12 / queued 138`. Still open: the parked-wake defect
#5740 (`WAKE_CONTENT_PARKED`, `src/driver.mjs:54`) and its worktree `item-5740`. **Capacity:**
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

**Traps this window** — `docs/SELFDEV.md` **173–177** (this pass: re-preflight inside the loop; the text-integrity gate
is absolute, so `main`'s own BOMs block otherwise-clean branches; a batch landing must regenerate
`demo/test-areas.json`; a wedged broker reads exactly like an empty queue; run `git cherry` before calling a branch
unlanded) and **130–169**. Grep for the symptom; the file is ~49,000 tokens.

**Probes left for promotion** (gitignored `.spike/`, read-only, no model spend, broker-down safe):
`.spike/delegate/queue-census-ro.mjs` (branch-vs-queue census that works with the broker down),
`.spike/delegate/compaction-policy-probe.mjs`, `.spike/delegate/context-window-health.mjs`,
`.spike/delegate/fleet-health.mjs`. Promotion is a row from `lead` (#5617 is the precedent id).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
