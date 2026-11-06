# NEXT.md — current state and next actions

**Last update:** 2026-11-06T10:0xZ (delegate session **H** closes — the operator's four answers executed, the `local`
family moved to the second strata box and **back to loopback** when the rig's own provider gate refused to start
(**325**), three bounded broker passes ran, and the team decomposed the delegate's fifth `lead` brief into **20 new rows**
(`#5224`–`#5243`) while **cancelling two duplicates** the delegate had flagged. Registered **323–328**; signed **D219**
(the answers, the passes, 303 now 5/5) and **D220** (the strata box, the price-key trap, the $0.50 verifier-family rule).
New measured defect: a **stop request survives its broker and steals the next run** — a `--max-duration 600` pass ended at
`reason=stop passes=15`, 66 s in (**327**). Verifier-family spend is now **$0.27019 = 54.0 %** of the operator's $0.50
trigger; worktrees **26 → 32**. The session-E and session-F pointers are VERBATIM in `docs/NEXT-ARCHIVE.md`.)


Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item: `lead`'s owners work the rows cut from ROADMAP 294–**328**; the operator holds one live decision — the
second strata box.** Queue at max id **`#5243`**: `38 queued, 13 claimed, 355 held, 173 deferred, 3848 done`; verifier-family
spend **$0.27019 of the operator's $0.50 trigger (54.0 %)**; worktrees **32** (`seat-root 8, reapable 15, live 7, locked 2`).
**Do not run another pass before 311 lands** — each pass adds worktrees (26 → 32 in three passes) and the cleanup refusal is
unchanged. **Before any start, `ls selfdev.sqlite.broker.stop`** — a stale stop file silently cut the last 600 s pass to 15
passes of work (**327**). Two queue rows the delegate already executed are cancelled by `lead` (`#5224`, `#5225`): 297's
priced legs and 319's scope answer. New rows this session: **323** (`CONFIG_KEYS` lacks the LOCAL price keys), **324**
(the $0.50 family threshold has no enforcer, and the switch makes the rig single-model), **325** (the LAN box vs the 20 s
bound), **326** (per-box keys; a rotation darkens the rig invisibly), **327** (stale stop request), **328** (`passes=-` makes
a gutted run indistinguishable from a wedged one).

**The live operator decision (325).** The rig's qwen seats were pointed at the second strata box and the rig's own gate
refused to start: `BLOCK provider-local-completion-failed: local: /chat/completions failed — timeout after 20s` →
`START REFUSED: provider-local-completion-failed`. Measured on that box: `/health` ok, `/v1/models` reports the model
**loaded**, `/status` shows a **single slot** serving another client at **~8 tok/s** (`generated` 5,316 → 5,830 in 64 s);
a 31-token completion took **129.5 s**; loopback took **1.4 s** (`ctx` 204800 vs 131072, `images` true vs false).
**Interim now in effect: the `local` family points at loopback** so the seven author seats run. The operator's choice:
(a) stay on loopback, or (b) use the LAN box and **raise `DURIG_STREAM_TIMEOUT_MS` as a dated ruling**, accepting
minute-scale seat turns while another client holds the slot. The gate was **not** lowered to make anything pass.

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
node .spike/delegate-20261106/verifier-spend-tripwire.mjs   # family spend vs the operator's $0.50 trigger (free) — 54.0% at close
ls selfdev.sqlite.broker.stop                               # 327 guard: a stale stop file silently steals the next pass
git worktree list | wc -l                                   # 311 leak meter: 17 at day start, 32 at this close
DURIG_DB=./selfdev.sqlite node cli.mjs status               # empty/timeout + fresh heartbeatAt + frozen lastPassAt = 303, not a broken store
node .spike/delegate-20261106/strata-endpoint-check.mjs     # is the LAN box inside the 20 s preflight bound yet? (free)
node demo/deepinfra-catalog.test.mjs                        # "12 rig seat models resolve ... local=7, verifier=5" = the rig is lit
node scripts/test.mjs --area docs && node scripts/test.mjs --area check && node scripts/test.mjs --area guard
# then, only after 311 lands and the stop file is absent:
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --dry-run   # NEVER paste its output -- 295 prints credential VALUES
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 600
```



**Blocker:** (1) The strata-box capacity call (**325**) — operator's, and it decides whether the author family runs at
second-GPU speed; the interim is loopback. (2) **311 gates every further pass** — worktrees grew 26 → 32 and cleanup still
refuses. (3) **The preflight prints credential VALUES (295)**: the current `DURIG_LOCAL_API_KEY`/`DURIG_VERIFIER_API_KEY`
values are in a durable transcript; cut 295 before further preflights, rotation is the operator's. (4)
`selfdev.sqlite.spend.jsonl` is untracked and not ignored (**310**) — a workspace move that skips it restarts the caps from
zero. (5) The $0.50 verifier-family switch is a ruling with an unsigned consequence: single-model + no cross-family verifier
(**324**); headroom at close is $0.23 and one 600 s pass costs ~$0.007–$0.035. (6) The stop-file writer in **327** is
unresolved — the probe is in the row.

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
