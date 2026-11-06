# NEXT.md — current state and next actions

**Last update:** 2026-11-06T19:2xZ (delegate session **K** closes — the operator's two answers were executed (credential
rotation verified with a **zero-spend** masked keycheck; bounded pass #2 run), ROADMAP **331** was registered from a free probe
that shows a seat's per-model compaction override **reaches nothing**, `D223` was **corrected** after pass 2 contradicted it, and
pitfalls **47–50** were added. Local commits **`0bce3ed5`** and **`e3232d48`** are **unpushed** — the session-G grant was spent on
`ffbd0e1e..4c3fd7cc`; a fresh operator grant is required. The session-E through session-J pointers are VERBATIM in `docs/NEXT-ARCHIVE.md`.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item — TWO halves, and only one of them costs money.**

**(1) FREE, zero-spend, unblocked right now — ROADMAP 331 (the operator's compaction schedule).** The operator moved the pi-plane
schedule (`~/.pi/agent/settings.json`: harness-wide `reserve 32000 / keep 16000`; `strata → 40960/24000`; `strata-server →
26214/16000`; and `~/.pi/agent/models.json` `strata-server maxTokens 16384 → 24576`). It **cannot reach a seat**: seats resolve
`local/…` or `verifier/…`, and `src/config.mjs:212-218 compactionSettings()` emits `modelOverrides` as a **sibling** of `compaction`
while pi-durable reads it only from **inside** `settings.compaction` (`agent.ts:71`, `compaction.ts:262-263`). Measured by
`node .spike/delegate-20261106c/compaction-policy-probe.mjs` (free, calls pi-durable's own `compactionPolicy`): **every family
resolves the pi-durable defaults `16384 / 20000 / 32768`** — the configured `local/…: 20480` arrives nowhere, and
`verifier/openai/gpt-oss-120b` (window 24,576, max 6,000) compacts above `24576 − 16384 = 8192` while keeping `20000` recent =
**81 % of its whole window**. Next command for that half, in order: `node .spike/delegate-20261106c/compaction-policy-probe.mjs`
(baseline) → the fix (`out.compaction = {...policy, ...(layered ? {modelOverrides: layered} : {})}`) → the gate, which is **a test
that calls pi-durable's `compactionPolicy()` and asserts the configured numbers come back per family** (`demo/config.test.mjs` is
area **`rig`** and **passes with the bug in place** — `node --test demo/config.test.mjs` → 1/1, 3.4 s — so it is not the gate;
`node tools/what-to-test.mjs --paths=src/config.mjs,cli.mjs` derives **73 direct guards**) → then the values
`local/qwen3.8-flash-next-iq3_s 40960/24000` (threshold `200000 − 40960 = 159,040`) and `verifier/openai/gpt-oss-120b
4096/8192/8192` (threshold `24576 − 4096 = 20,480`). **Do not set harness-wide `DURIG_COMPACTION_RESERVE_TOKENS` before the nesting
fix** — it would apply 40960 to a 24,576-window family (`contextWindow − reserve < 0`). Carriers: `lead` has not minted them; the
brief is **spooled undelivered** as `delegate-20261106c-lead11` / `…-lead11b` in `selfdev.sqlite.broker.inbox/` and delivers on the
next drain.

**(2) THE PASS HALF IS STOPPED, and the stop is routing, not capacity.** Pass 1 (pid `884989`) and pass 2 (pid `905867`,
`--yes-pm-wakes --max-duration 600`) both ran. Post-pass-2 queue: max id **`#5294`**, `3864 done, 17 claimed, 56 queued, 364 held,
174 deferred, 819 cancelled`. **`#5273` (`impl`, the ROADMAP 311 carrier) is STILL `queued` after two full passes, and `lead`'s own
instruction row `#5286` ("CLAIM 5273 BY ID FIRST", to `impl`) is `queued` too** — while `claimed` rose `14 → 17`, so seats are
working and that one row is not being picked up. Worktrees grew **`35 → 37 → 41`** (`seat-root 8, reapable 21, live 9, locked 2,
dirty 1`) — the leak 311 exists to stop. Family spend **`$0.34959` of the $0.50 trigger (69.9 %)**, headroom **`$0.15041`**; pass 2
cost **$0.03479** for 3 `done` rows. **Do not start a third pass until `lead` says how `#5273` gets claimed.** Broker state:
**DOWN, self-exited** `2026-11-06T18:34:39.319Z EXIT pid=905867 reason=deadline`, no `selfdev.sqlite.broker.stop` residue, and
**`selfdev.sqlite.broker.json` is gone** (a clean exit removes it). Dead letters: **6**, dated `04:01:55Z, 08:57:13Z, 08:59:44Z,
09:00:22Z, 16:51:48Z, 17:49:24Z` — **none from pass 2**, so **329 did not reproduce**; it stands on one 17:49:24Z specimen plus 5
older letters, and its carrier `#5275` (`architect`) is still `queued`. `#5276` (`impl`, 330) and `#5277` (`devtools`, promote the
keycheck probe) are `queued`; **`#5278` (qa, the Windows-side 311(ii) observation) stays `held`** — 311(ii) cannot be closed from
Linux, and the keep-gate on refs **`item-4829` / `item-5147`** still applies to any 311 reap verb (`#5280`, `pm`, held).

**Corrected at clock-out, do not re-learn it the expensive way:** `pgrep -f` / `pkill -f broker-serve.mjs` **do not see the broker**
(`pgrep -af broker-serve.mjs | wc -l` → `0` at 18:13Z while pid `905867` was alive and logging) — use `ps -p <pid>` /
`test -d /proc/<pid>` with the pid from `broker.json` (pitfall 49, D223 CORRECTION). And a bounded broker **exits on its own when the
turn in flight finishes**: pass 2 self-exited 11m40s past its deadline with no kill; only a **wedged** turn needs `kill <pid>` (pass 1
needed it at 17m07s). Pitfall **47** now carries a second `330` specimen: the delegate's own doc edit was replaced by a lane's between
edit and commit, and the delegate's `git add` swept the lane's text into its own commit — **commit doc work immediately and grep the
COMMIT, not the file.**

**325 is ANSWERED — decision closed, no operator action pending.** The operator's answer (D222, item 3) is **(a) stay on
loopback**; do **not** raise `DURIG_STREAM_TIMEOUT_MS`. So the seven author seats keep running on loopback (measured 1.4 s for a
31-token completion) and the LAN box stays out of the rig (single slot, ~8 tok/s, 31 tokens in **129.5 s**). **The row is still
stale:** `#5230` (pm) is `held` and its body still says "needs the operator" — `lead`/`pm` must release or close it with the
answer, not leave the next session re-asking. `#5257` (scribe, held) is the DECISIONS entry for this ratification; **D222 has
already recorded it**, so the scribe should fold rather than mint a second entry.

**Two rows are already done — do not pay twice.** Queue `#5213` (qa: run 297's three priced legs) is **already run**
(4 legs, $0.00184, finding on ROADMAP **322**; `DURIG_VERIFIER_MAX_TOKENS` is now **6000** by operator approval) — the
measurement still owed is `#5214`/**317**. Queue `#5222` (pm: 319's scope question) is **answered**: option 1b approved and
executed (45 occurrences on Linux-asserting lines, 5 left on OS-unstated lines).

**Order the operator ruled still stands: backoff before capacity** — **313/300** land before any concurrency, verifier slot,
or per-seat cap change. New rows this turn: **323** (`CONFIG_KEYS` has the VERIFIER price keys and not the LOCAL ones —
a LAN local family can only be armed through `--env-file`, else it registers no model row and all 7 author seats go dark),
**324** (the operator's **$0.50 verifier-family** threshold has no enforcer; the switch would make the rig single-model
and drop D137's cross-family verifier), **325** (endpoint readiness vs the 20 s bound), **326** (a rotation darkens the rig
invisibly; keys are per box).

**Next command** (host signature measured with it — Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0):

```bash
cd ~/Git/Durian-Pi
node .spike/delegate-20261106/verifier-spend-tripwire.mjs   # family spend vs the $0.50 trigger (free) — 59.3% ($0.29660) at this close
ls selfdev.sqlite.broker.stop                               # 327 guard: a stale stop file silently steals the next pass
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/status-i.json   # run this only with the broker DOWN — 329: a wedged broker makes it print nothing for 120 s
node tools/broker-serve.mjs --status                        # up? spool depth? provider reachability? — reads files, not the store, so it answers even when the broker is wedged
test -e selfdev.sqlite.broker.json && node -e 'const r=require("fs").readFileSync("selfdev.sqlite.broker.json","utf8");console.log(r)'  # fresh heartbeatAt + frozen lastPassAt = 303
ls selfdev.sqlite.broker.inbox.error | wc -l                # reads the broker destroyed (5 today, all `apply failed: SqliteStorage is closed`) — 329
git worktree list | wc -l                                   # 311 leak meter: 32 at this session's clock-in, 35 at its close
node .spike/delegate-20261106b/queue-counts.mjs             # (probe, promote-or-delete per 312)
node demo/deepinfra-catalog.test.mjs                        # "12 rig seat models resolve ... local=7, verifier=5" = the rig is lit
node scripts/test.mjs --area docs && node scripts/test.mjs --area check && node scripts/test.mjs --area guard
grep -c "<a phrase only your own entry contains>" docs/SELFDEV.md   # 330: prove YOUR doc edit survived; a clean `git status` is what a lost edit looks like
# no pass until 311 lands; then, and only with the operator's intent:
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --dry-run   # NEVER paste its output -- 295 prints credential VALUES
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 600
```

**Push state:** `origin/main` = `ffbd0e1e` (the operator's batch grant, spent). `926a7754` (`.gitignore` disposition),
`1950926a` (D222 + rows 329/330) and `d1ee4e30` (pitfall 42 + the pointer's platform constraint) are **local-only** and need a
fresh per-batch grant (D218). `node tools/broker-serve.mjs --status` also shows **1 unread `[read]` intent still spooled
(`042a2e70-…` waiting 20 min)** — that is one of the `watch --once` polls **329** describes, not a stuck write; it will drain on
the next broker start, and the 5 dead-lettered ops in `selfdev.sqlite.broker.inbox.error/` all read
`apply failed: SqliteStorage is closed`.



**Blocker:** (1) **311 gates every further pass** — worktrees `32 → 35` in one pass and cleanup still refuses with the
unreadable `undefined/anthropic-ai-sdk…` string (`src/worktree.mjs:1237` reads `dirent.path`, which is `undefined` on node
v24.22.1; the property is `parentPath`). (2) **The preflight prints credential VALUES (295)**: `DURIG_LOCAL_API_KEY` /
`DURIG_VERIFIER_API_KEY` are in a durable transcript; do not run or paste preflight output until the mask lands, and rotation
(`#5233`, held) is the operator's. (3) **303's root cause is open** (`#5231`/`#5260`, architect): a broker past its deadline
keeps heartbeating with a closed storage, and that shape now **destroys reads** (**329**) — 5 CLI reads dead-lettered today.
(4) **The $0.50 family threshold has no rig-side enforcer (324)**; the delegate is the tripwire and headroom is **$0.20340**,
which is ~7 more 600 s passes at the measured $0.02641 each. (5) **321 must land before 324** (operator ruling), and 317's
calibration (`#5214`) before further verifier spend. (6) **330** — shared-tree doc edits are volatile: commit doc work before
any broker verb. (7) `selfdev.sqlite.spend.jsonl` is untracked and not ignored (**310**). (8) The **327** stop-file writer is
still unidentified; the probe is in the row.

## State (measured 2026-11-06T03:4xZ, same host signature as above)

- **Trunk:** `main` = `fca4e980` (D214, ROADMAP 294–298, the metered-arm runbook) — **local, unpushed**; session-F commits
  (D215, 299–309, the runbook and pointer) sit on top. `ef29516d` is on `origin/main`.
- **Store pins are now honest:** `up --refresh` refreshed all 12 seats and the closing read is idempotent —
  `modelMismatch: null`, `modelReset: null`, `writes: 0`, empty `wouldRefresh[].changes`. Before the refresh the dry-run
  showed `pm/impl/lead` pinned to `local/iq3_s` and `qa/qa2` to `verifier/mistralai/ministral-3-14b-reasoning`. The
  **cost of the fix verb is a `pi.reset` per seat**, so refresh *before* a pass, never between a delivered intent and the
  turn meant to act on it (299, `docs/runbooks/hygiene-and-dead-model-pointers.md` Do step 2b).
- **Provider waste this pass explained:** `Model local/iq3_s is not available` n=**1,057**,
  `Model verifier/mistralai/ministral-3-14b-reasoning is not available` n=**450** — **16,166 errored generations of 64,401
  (25.1 %)** holding **65.9 h** of busy time; 186 generations ≥10 min hold **517.8 h (64.1 %)** of generation busy time.
  Item split: **WAIT 6,405.5 h (72.8 %) / WORK 1,083.6 h (12.3 %) / HELD 500.9 h (5.7 %)**.
- **Roster:** 7 seats `local/qwen3.8-flash-next-iq3_s`, 5 seats `verifier/openai/gpt-oss-120b`
  (`https://api.deepinfra.com/v1/openai`), slot `24,576 / 3,000` deliberately unmoved (297). Dated price
  ($0.037 in / $0.17 out per Mtok, `DURIG_VERIFIER_PRICE_AS_OF=2026-11-06`) lives only in the **gitignored** host configs.
- **Spend:** the store ledger `selfdev.sqlite.spend.jsonl` **now exists** — **507 calls, $0.19027**, all
  `openai/gpt-oss-120b`, max single call $0.000879. It is **untracked and not in `.gitignore`** (310): the caps read it, so a
  workspace move that does not copy it silently restarts the caps from zero. Delegate probes remain separately ledgered in
  `.spike/delegate-20261106/spend-arm-*.jsonl` (~$0.00003, `DURIG_PROBE_CEILING_USD=0.15`).
- **Suite:** 257/258 — the one failure is `demo/verifier-arm-probe.test.mjs` (ROADMAP **294**, red *because* the arm is
  legitimately priced; `run()` at `demo/verifier-arm-probe.test.mjs:15-22` scrubs only `API_KEY|SECRET|TOKEN$`, not the
  config-file layer). `check` findings 126: `citation-unresolvable` 67, `duplicate-item` 57,
  `verification-without-evidence` 1, `evidence-tree` 1; `single-model-rig` absent.
- **Broker:** **stopped** (a third pass was run to prove the fix holds, and the loop is now off deliberately). Both passes
  that had pending seat conversations **lingered past their deadline**: pid 483056 (`PASS 1373` at 02:28:23, alive 75 min,
  `serve --stop` → `"did not exit within the stop grace; no forced kill"`) and pid 529183 (`PASS 544` at 04:04:04, alive 6 min
  past a 900 s deadline). Only `kill` produced `EXIT … reason=deadline passes=-` (303). `resume` found nothing stranded. A
  pass with **no** pending conversations exits on its own (`EXIT reason=max-duration passes=1245`). **Restart is the next session's first write:**
  `node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 1800`.
- **Worktrees: 17 → 26 during this day of passes** (count it at clock-in and clock-out — it is the cheapest leak
  detector). `item-4943` and `../durian-dev/seatroot/item-5111` still present; cleanup keeps refusing —
  `complete_work: workspace cleanup for #4829 / #5175 / #4943 failed: refusing to remove worktree … junction/symlink
  detected at undefined/anthropic-ai-sdkhropic-ai-sdk`. That message names no resolvable path, so nothing can act on it — registered as **311**.
  The pass-measurement instruments (`.spike/delegate-20261106/pass-report.mjs`, `latency-pass.mjs`) are in gitignored
  scratch and need a row to be promoted into `tools/` — registered as **312**.
- **Research (ROADMAP 298, satisfied on intake):** `docs/reviews/base-agent-product-topology-research.md` landed and is
  **verified** — a `## Delegate corrections` block at its foot records four citation defects it contains
  (`src/queuesync.mjs` and `docs/extensions.mjs` do not exist; the config keys are `DURIG_EXTENSIONS` /
  `DURIG_MAX_CONCURRENT_SEATS` / `DURIG_PROVIDER` / `DURIG_STREAM_TIMEOUT_MS`; 4 not 5 files register `defineExtension`).
  Its headline: **no shipped product keeps a durable store per agent**; isolation is filesystem-level; process topology
  splits by tier. Its backlog is registered as **304–309**. **B7 needs the operator** — a written rejection of the
  per-seat database, citing its §2, so the question stops reopening. Round 2 is drafted, unspent:
  `docs/reviews/base-agent-product-topology-followup-research-prompt.md` (Q10 idle/attention policy, Q11 stale model
  pointers, Q12 the counterexample search Round 1 left unexecuted, Q13 verifier economics).

## Traps this session found (mirrored into `docs/SELFDEV.md` §sessions E–F)

1. **`no_model` is a store failure, not a config failure.** `check`, the pointer demo and the roster all stayed green while
   11 seats died at wake. The only signal was inside the task record. Probe: `up --refresh --dry-run` →
   `wouldRefresh[].changes.model = {from,to}` (299).
2. **`up --refresh` is the fix verb and it is not free** — one `pi.reset` per seat. And it **refuses while a resident broker
   owns the store**: stop the broker first, or route through `intent.mjs`.
3. **A CLI verb that re-registers the catalog needs the env file.** Run `resume`/`up` without
   `--env-file="$HOME/.config/durig/env"` and the verifier family prints `registration-refused …
   metered-endpoint-unkeyed` — I reproduced this twice (D215, 299).
4. **Store values are JSON-encoded.** `kind`/`status` compare against `'"pi.agent"'`, `entries` has no top-level
   `kind`/`at`, and there is no `items`/`seats` table. Hand-written SQL from memory burns time — use
   `tools/latency-budget.mjs`, `cli.mjs status`, `cli.mjs queue`.
5. **`.spike/serve.out` accumulates every run.** Parse the **last** block; a whole-file regex reported an old run's
   `passes=1245` as the current one's result and nearly wrote a false number into this file.
6. **`cli.mjs log <seat>` can hang to timeout while the broker is mid-turn** (exit 124, no output).

## Watch-list (delegate)

- **Operator, four open items, none of which I can decide:** (a) the **hostname scrub** — D214 lists the options, my
  recommendation is option 1 (strip the hostname only on lines already carrying `fc44`/`fc45`, keep distro/kernel/node, add
  a forward-facing gate); 32 tracked files, 17 in `docs/DECISIONS.md`, 27 of 32 already name distro/kernel. (b) the
  **`durian-core` name** — still deferred by ruling; Round 1 §7 now says the defensible move is a capability noun for the
  base and a coordination noun for the team, and that **no rename is needed to be defensible**, so the cheapest ruling is
  "keep `durian` for the team, name the base only when 279/280 ship". (c) **B7** as above. (d) **credential rotation** —
  `tools/broker-serve.mjs:467-471` printed `DURIG_VERIFIER_API_KEY` / `DURIG_LOCAL_API_KEY` **values** to the terminal
  before this session; the tree and the config hold no persisted copy (295).
- **#5145** is `done` and unlanded with both evidence legs (`#5155` qa, `#5156` lead) `deferred`; a real cross-family
  verify leg on `item-5145` @ `39ee4fcc` is finally possible. No author-side leg closes it.
- **#5159** (`pm → auditor`) is `deferred`; **#5157** (`lead → pm` DIGEST REQUEST) is the one `claimed` row above #5156.
- **Untracked `install.sh`** in the repo root — an unrelated installer, not the rig's; disposition is the operator's.
- **Host facts, hostname-free:** Linux Fedora 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0. Both GPUs
  remain full (RTX A4000 14637/16376 MiB, RTX 3090 23098/24576 MiB) — which is why the `:1234` local verifier stays down and
  the metered arm is the arm that runs.
