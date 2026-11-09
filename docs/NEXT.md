# NEXT.md — current state and next actions

**Last update:** 2026-11-09T04:4xZ (delegate session **N14** — the operator asked whether a **release manager / ops
seat** should own merging all completed branches, and to prioritise that over the delegate landing branches by hand.
The delegate agrees, with one hard constraint found in the rig's own runbook: **a broker-hosted seat cannot drive a
landing pass** (`docs/runbooks/land.md:427-431` — quiescing requires stopping the broker, which ends the seat's run;
land.md also says `land` is the delegate's/operator's action). So the role is split: a seat owns the *continuous
readiness inventory and the ordered landing plan*; the quiesce-then-merge pass stays outside the broker until a base
seam exists. Intent spooled to `pm`, requestId `delegate-20261109-release-role`. Goal `mw88k2at-1ozydj` (continuity
notes, D240) is **paused** by the operator at this point.
Backlog measured at 04:4xZ: **151** item branches, **62** ahead of `main`, **83** commits unlanded, **43** merge
cleanly into current `main` (`git merge-tree --write-tree`), **19** conflict. `main` = **`429f2b5a`** (docs + gate
work only; nothing landed by this session). Broker resident as `pid 114848` since 03:20:33Z, **860 passes** by 04:40Z,
spool empty, verdict HEALTHY.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

**Window-pressure baseline (measured 21:3xZ, `selfdev.sqlite.spend.jsonl`):** 374 calls today, **$0.18432**,
3,661,636 prompt tokens / 287,337 completion tokens; median prompt 9,787, max 22,963; **67** calls above the default
`reserveTokens = 16,384`, **0** above the verifier's 24,576-token window. The overflow is the compaction step, not the
provider. Field names are `usd` / `prompt_tokens`, not `costUSD` (pitfall 145).

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D226)**, first tranche **ROADMAP 331**. N12 moved
it in one way: the mechanism is now measured end to end (config → `compactionSettings()` → harness defaults → 240
failed summaries on the verifier seat), and the operator's intent for the fix is **spooled to `pm`**
(requestId `delegate-20261108-context-window`), and `pm` turned it into rows #5784/#5787/#5791/#5794/#5796 within
 ten minutes. **N13 changed the priority order**: compaction is no longer the thing to perfect — it is the thing to
avoid. The continuity design is in `docs/reviews/architecture-context-continuity-2026-11-09.md`; `beforeCompact`
(`pi-durable dist/harness/compaction.js:82-88`) lets an extension supply the summary itself, which removes the
summariser model call entirely — the source of 218 truncations and 209 run-cap refusals. What it did NOT move: **this delegate session landed nothing** (its commits are docs-only: `2338f004`,
`47b18e74`, `a9c651b5`, `2362d20a`, `cba0ef3f`), and `grep -n "out.compaction" src/config.mjs` still shows the
override emitted as a sibling — `:455 if (Object.keys(policy).length > 0) out.compaction = policy;` with the
`modelOverrides` block below it — **ROADMAP 331 is not fixed**. `main` = **`cba0ef3f`** (`fb463162` landed
`item-5737` mid-session). Suite on that main: **259/262 passed in 74.3 s**, reds named: `next-pointer.test.mjs`
(fixed in `2362d20a`, the pointer must contain `node cli.mjs`), `seat-turn-shape.test.mjs` (a live-store sha pin that
races a driving broker — pitfall 138), `verifier-arm-probe.test.mjs` (open, unexplained by this session).

**Current item (priority order, as the operator set it on 2026-11-09):**
1. **The release role** — spooled to `pm` as `delegate-20261109-release-role`. Part A is seat-ownable and needs no
model spend: keep the landing list current (three gates: verified in queue, tip matches the list, clean against
CURRENT main), order the train (every stacked entry names its base, `land.md:400-410`), report the 19 conflicts with a
named owner, and own worktree/branch hygiene (ROADMAP 311 and 344). Part B — the quiesce-then-merge act — is **not**
seat-ownable; it is a base-seam question (ROADMAP 131 pause, broker-side quiesced boundary).
2. **The continuity cluster** (D240 / ROADMAP 331), already decomposed by `pm`: **#5931/#5932** `impl` define the
`durig.notes` doc; **#5933/#5934** `devtools` the `DURIG_NOTES_DIR` seam; **#5935** `impl` the mirror at
wake/compaction/reset; **#5936/#5937** `impl` the `beforeCompact` hook; **#5939/#5940** `qa` the compacteval A/B;
**#5941** `impl` the offline reset-mid-item acceptance demo; **#5942** `scribe` the runbook. **Each subject appears
twice** — the duplicate-row defect is live (226 live rows share a subject); confirm before claiming.
3. **The compaction fallback fix** #5785 (nest `modelOverrides`) — still unfixed on `main`; it is the fallback the
notes mechanism replaces, so it stays in the tranche but is no longer the priority.

**Unlanded backlog the next session must handle** (measured 04:4xZ): 62 branches / 83 commits ahead of `main`; 43
merge clean, 19 conflict. Command below reproduces the census in under a minute.

**Exact next command** — the resident broker is `pid 114848`, started 03:20:33Z with `--max-duration 7200`; its first
pass delivered 5 intents `dead=0 dup=0` and woke pm,qa,lead,scribe,devtools,auditor,security,architect. It has wedged
twice this session (pids 3521203 and 23632 both exited `reason=deadline passes=-` — that signature means the process
died with **no completed pass at all** in its life, pitfall 165). A `degraded` verdict is not proof of a stall: compare
`heartbeatAt` (liveness) with `lastPassAt` (progress) first, and check for a live genlock lease before hard-stopping.

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/clockin.mjs                               # BEFORE starting a broker; it hangs while one drives
node docs/evidence/2026-11-08-context-window/milestone-check.mjs   # config, store, shape, broker leg, continuity leg
node cli.mjs queue --json --no-body --status queued    # bounded read; the unbounded census returns ~27.9 MB
node cli.mjs status                                    # answers in ~2 s while the broker is healthy
# landing census (read-only, ~20 s): branches ahead of main and which merge clean
for b in $(git branch --list | sed 's/^[* +]*//' | grep -E 'item-[0-9]+'); do a=$(git rev-list --count main.."$b" 2>/dev/null || echo 0); [ "$a" -gt 0 ] && echo "$b $a"; done
for b in $(git branch --list | sed 's/^[* +]*//' | grep -E 'item-[0-9]+'); do git merge-tree --write-tree main "$b" >/dev/null 2>&1 && echo "CLEAN $b" || echo "CONFLICT $b"; done
node scripts/test.mjs --area docs                      # 6/6 expected
```

**Landing is the operator's/delegate's act, not a seat's.** `scripts/land.mjs` refuses while the tree is dirty or a
generation is in flight; the pass needs a quiesced window (`docs/runbooks/land.md`, `docs/runbooks/merge.md`). Before
any pass: `git status --porcelain` must be empty **including untracked** (ROADMAP 310: `selfdev.sqlite.spend.jsonl` is
untracked, not ignored, and it blocked a whole train), and stray `item-*/` directories block the helper even though
porcelain is empty (`/item-*/` is gitignored).

**Read-path caveat (22:12Z).** A CLI read does not open the store while a broker is resident — `src/readclient.mjs:106-111`
routes it to the broker. With the pass loop stalled (last pass 21:26:06.898Z, 11 `PASS-FAILED … database is locked
errcode=5` dated 2026-11-08 out of 23 in the cumulative log (pitfall 153)) every read verb blocks with 0 bytes: measured two reads at an 8 s cap,
then eight concurrent reads at 25 s, all exit 124, all empty — while a direct read-only sqlite query answered fine
(128,248 tasks). **"Empty queue" and "cannot read the queue" are the same output** — pitfall 152. Seats keep running
regardless (impl conv 9: 58 generations in 10 min, last 22:12:19Z), and `genlock` is empty while generations are
being created 11 s earlier, so it is not a safe-stop signal (pitfall 150). Spool: **21** pending intents, **56** dead
letters.

**The fix is already proven, so #5785 is a one-line change, not a design question.**
`pi-durable/dist/harness/compaction.js:196` does `const { modelOverrides, ...policy } = settings.compaction;` — the
map must live **inside** `compaction`. `src/config.mjs:488` currently emits `out.modelOverrides = layered`; nesting it
(`out.compaction.modelOverrides = layered`) makes the harness resolve `reserve=20480` — shown side by side in
`docs/evidence/2026-11-08-context-window/README.md` §5. The key must be spelled exactly
`local/qwen3.8-flash-next-q2_0`, because the harness matches `${provider}/${modelId}`.

**The schedule that makes the gate green, already checked against the shipped resolver** (`docs/evidence/2026-11-08-context-window/README.md` §9): local `reserve 20480 / keepRecent 20000` (fits 204,800, ceiling 16,384); verifier `reserve 6144 / keepRecent 8192` (fits 24,576, ceiling 4,915 ≤ 6,000). The override key is `openai/gpt-oss-120b`, not `verifier/openai/gpt-oss-120b`.

**The landing pass, re-measured against current `main` (not against the main the branches were cut from):**

| row | branch | tip | merge-tree vs `main` | note |
|---|---|---|---|---|
| **#5736** | `item-5736` | `ef5613ea` | **LANDED** — `git rev-list --count main..item-5736` = 0 | the `DURIG_MAX_CONCURRENT_SEATS` gate for `local/*` is on `main` via `4efce137` |
| **#5398** | `item-5398` | `6d5c126d` | **CONFLICT** (docs/NEXT.md), base stale (`merge-base --is-ancestor main item-5398` exit 1) — re-cut needed; no row routes it yet (`merge-base --is-ancestor main item-5398` exit 1) | the defect it fixes is live: `node scripts/clockin.mjs` prints "digest is 41,439 B, over its 20,000 B budget" and **exits 0** |
| **#5648** | `item-5648` | `8fb668ec` | **CONFLICT** (demo/test-areas.json), base stale | `grep -n "LOCAL2" src/config.mjs` on `main` → **no hits**; the registration is not there |
| **#5488** | `item-5488` | `ade0691a` | do **not** land | forks at `7a1b80e2`, renders D234's docs as deletions; #5736 is its current-base re-cut |

Per `docs/runbooks/land.md` Do 0b, a stale base is **a re-cut job for the author seat, not a merge job for the
delegate**. The delegate preflights, reports, and hands it back.

**Suite on current `main`:** `node scripts/test.mjs --all --jobs 6` → **261/262**, the single red is
`demo/verifier-arm-probe.test.mjs` (ROADMAP 294, cause pinned: the demo scrubs only `API_KEY|SECRET|TOKEN$` from
the environment while `tools/verifier-arm-probe.mjs` reads `durig.config.json` at the repo root, which on this host
legitimately carries `DURIG_VERIFIER_PRICE_USD_IN/_OUT`; the tool supports `--config=PATH`, the demo does not pass
it). `node scripts/clockin.mjs` exits **0** while over budget — that is #5398's job, and until it lands every
`--suite` landing is refused by a gate that cannot fire.

**Is the team operating? Yes.** 12 seats live; broker pid recorded in `selfdev.sqlite.broker.json`; 64 generations
completed in the last 30 minutes with none failed. Queue census (from `cli.mjs status`):
`done 4039, cancelled 858, held 435, deferred 384, claimed 15, queued 42`. The parked-wake defect N11 found
(`WAKE_CONTENT_PARKED` at `src/driver.mjs:55` tells a seat to "Check `status`", and no seat has a `status` tool) is
claimed by `architect` as **#5740**; its worktree `item-5740` is present and its cleanup is refused by the
junction guard — see pitfall 132.

**Capacity.** `DURIG_MAX_CONCURRENT_SEATS = 4` (D238) and, as of `4efce137`, the gate now covers `local/*`. Both
boxes serve `qwen3.8-flash-next-q2_0` (local `n_ctx 204800`, LAN `131072` text-only), so `local2` buys throughput,
not family independence. `8` concurrent remains the operator's call.

**Standing, deliberately unresolved:** the operator's *"We can re-evaluate later, whether we can afford to host a
verifier model on localhost again. Don't let us forget that we want to do that."* Still **no queue row** for it;
minting it is a seat act. Bounding number: RTX 3090 22,387/24,576 MiB (91 %) with eleven generations in flight.

**Broker posture at clock-out (measured 05:2xZ):** resident pid **114848**, started 03:20:33Z with
`--max-duration 7200`, **1,002 passes** logged, verdict HEALTHY. Before any landing, run
`node tools/broker-serve.mjs --status` and prove no generation is in flight — `scripts/land.mjs` refuses on a held
slot, and an empty `ls -1 selfdev.sqlite.genlock*` is **not** proof of that (pitfall 150). A `degraded` verdict is
not a stall: compare `heartbeatAt` (liveness) with `lastPassAt` (progress) first (pitfall 165).

**Blocker:** the release-role intent (`delegate-20261109-release-role`) is spooled and **not yet drained** —
`ls -1 selfdev.sqlite.broker.inbox` still shows 1 file and the last `INTENT` line in `selfdev.sqlite.broker.log` is
03:45:30Z. Delivery, not `intent.mjs`'s `ok:true`, is the evidence (pitfall 141).

**Traps this window** — `docs/SELFDEV.md` **130–169** (165-169 are the continuity/queue-shape ones): a spooled *read* intent makes `broker-serve --start`
refuse with `wake-not-acknowledged`; `--env-file` is not a flag that exists (pitfall 87's mechanism is gone, its
substance stands); compaction failures are a record kind and the kind column is JSON-quoted; a broker past
`--max-duration` keeps its heartbeat and stops passing while holding genlock slots; **the clock-in digest hangs
while the fleet runs because `runCli()` has no timeout** (pitfall 135); wake counts from a stopped fleet are not
today's throughput (136); a landing can make an open row redundant (137); a live-store sha pin in a test races a
driving broker (138); the linger clears by exit and the digest budget now holds (140); **`SqliteStorage is closed`
is the dead-letter reason — confirm delivery from the log, not from `intent.mjs`'s `ok:true`** (141); and the default
compaction policy cannot fit the verifier's 24,576-token window (142).

**Probes left for promotion** (gitignored `.spike/`, all read-only, no model spend, broker-down safe):
`.spike/delegate/compaction-policy-probe.mjs` (resolves the policy through pi-durable's own resolver),
`.spike/delegate/context-window-health.mjs` (generation outcomes + compaction failure census),
`.spike/delegate/fleet-health.mjs`, `.spike/delegate/queue-census.mjs`. Promotion is a row from `lead` (#5617 is
the precedent id).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
