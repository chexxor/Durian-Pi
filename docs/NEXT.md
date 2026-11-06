# NEXT.md — current state and next actions

**Last update:** 2026-11-06T03:5xZ (delegate session **F** closes — the operator-granted wake-and-measure pass ran, and it
**reversed the top blocker**. The empty queue was not a routing logjam: **11 of 12 seats were dying at wake with
`no_model`** because per-conversation model pointers in `selfdev.sqlite` still named retired models while every check was
green (ROADMAP **299**). `up --refresh` fixed the pins and the queue moved **#5156 → #5205**, **49 new rows**, **25
`queued`**, 8 `claimed`, claim-wait **p50 = 0.0 m** on 2026-11-06 against **230 m** on 2026-11-05 and **1,232 m** on
2026-11-03. Recorded as **`docs/DECISIONS.md` D215**, registered as **`docs/ROADMAP.md` 299–309**. The pass also found the
expensive thing: on an **empty** queue the wake loop grinds **1,245 passes / 1,394 guard escalations / ~1,400 `pi.reset`
records / 249 paid calls / $0.086 in 30 minutes**, and a reset erases a just-delivered operator ruling (**300**). The
topology research **came back and is verified** — see *Research* below. The superseded session-E pointer moved **VERBATIM**
to `docs/NEXT-ARCHIVE.md`.)

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item: `lead` cuts `docs/ROADMAP.md` 294–312 into rows and keeps cutting — the queue is alive (max id #5205, 25
`queued`, 8 `claimed`), so the binding constraint is backoff, not supply.** Order matters and one rule is load-bearing:
**backoff before capacity.** Any increase in concurrency (`DURIG_MAX_CONCURRENT_SEATS`, `durig.config.default.json` = 1,
`durig.config.json` unset) or verifier context before ROADMAP **300** lands multiplies the idle storm this pass measured.
Delegate's briefed order (cheapest and most visible first): **(1)** **300** idle-queue backoff — a woken seat that finds
"nothing claimable" must **SKIP with backoff**, not escalate-and-reset; **(2)** **299** the store-pin check — compare each
seat's latest `pi.agent` revision's model against `rig.selfdev.json` and print the *effective* pin in
`tools/broker-serve.mjs --status`; **(3)** **303** deadline-state honesty — a broker past `--max-duration` must answer
reads and print its run block, and `--stop` must escalate instead of returning `"stopped": false`; **(4)** **294**
fixture-isolate the one red demo; **(5)** **295/296** the preflight prints credential **values** and probes the paid
endpoint with no ceiling or ledger; **(6)** **297** price three real verify legs **before** anyone touches the slot;
**(7)** **301** the rig's own `next:` advice names instruments that do not exist; **(8)** **302** seats use `powershell`
**20,296** times against `bash` **1,824** on a Linux host; **(9)** **282–293**, the **304–309** research intake, and the hygiene pair **311–312**.

**Blocker:** **verifier capacity is unpriced** — the armed arm runs an inherited `24,576 / 3,000` slot with zero
measured legs, and the vendor's full 131,072 ctx would cost **$4.85 for one maximal call**, over the `$4.00` store cap, so
raising the slot without moving the cap darkens the roster before any request (ROADMAP **297**; only the operator can move
the cap). Closed this session and do not re-open: the **empty queue** (dead store pins, `up --refresh`, now #5192 / 22
`queued`) and the **verifier family** (**"Metered arm"**, `ef29516d`, `single-model-rig` absent from `check`).

Run this first — all reads, no writes:

```bash
cd ~/Git/Durian-Pi
git status --short -- . && git rev-list --count refs/remotes/origin/main..main   # 0 = pushed
DURIG_DB=./selfdev.sqlite node cli.mjs status                                    # attention + non-terminal work
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status        # state + genlock + spool age + providers
cat selfdev.sqlite.broker.json                                                   # heartbeatAt FRESH + lastPassAt FROZEN = idle, not wedged (303)
DURIG_DB=./selfdev.sqlite node cli.mjs queue 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print('max id',max(int(i['id']) for i in d['items']));[print(i['id'],i['status'],i.get('from'),'->',i.get('to')) for i in d['items'] if int(i['id'])>=5157]"
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # modelMismatch/modelReset must be null (299)
python3 -c "import json;L=[json.loads(l) for l in open('selfdev.sqlite.spend.jsonl')];print(len(L),'calls','$%.5f'%sum(r.get('usd',0) for r in L))"
DURIG_DB=./selfdev.sqlite node tools/queue-drain-audit.mjs --config=./rig.selfdev.json --counts-only
node scripts/test.mjs --area check && node scripts/test.mjs --area docs && node scripts/test.mjs --area guard
```

**`cli.mjs status`/`queue` route through the broker.** If the broker is lingering past its deadline they time out at 120 s
with `read health: timed out awaiting the broker's result` while the store is healthy — the discriminator is a **direct**
read-only open (measured: `select count(*) from entries` → 150,347 in **111 ms**) and `tools/latency-budget.mjs`, which
reads the store itself and answered fully throughout. Do not write to the store to "fix" that (303).

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
  detected at undefined/ant`. That message names no resolvable path, so nothing can act on it — registered as **311**.
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
