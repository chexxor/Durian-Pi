# NEXT.md — current state and next actions

**Last update:** 2026-11-06T00:4xZ (delegate session **E** closes. The operator answered six questions and three of them
moved state — recorded as **`docs/DECISIONS.md` D214**, registered as **`docs/ROADMAP.md` 294–298**. (1) **"Metered arm"**:
the verifier family is restored, cross-family *and* cross-vendor, at `ef29516d`, and `single-model-rig` is gone from
`check`. (2) **"Granted"**: the push grant was exercised — `git push origin main` → `4c585f5b..ef29516d`, and
`git rev-list --count origin/main..main` = **0**. (3) **"Accepted"**: the wake-and-measure pass (`--yes-pm-wakes`) is
granted and in flight. (4) **"Routed"** for the topology research, with the answer placement now defined by ROADMAP
**298**. (5) **naming deferred until the research completes** — `durian-core` is still unratified. (6) the hostname scrub
came back as *"please continue… provide a recommendation amongst options"*, so the options are in D214 and **nothing was
edited**. The superseded session-D pointer moved **VERBATIM** to `docs/NEXT-ARCHIVE.md`.)

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — the probe is `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item: the queue is still empty, so the cut is the whole backlog — `lead` cuts `docs/ROADMAP.md` 282–298 into
rows, cheapest-and-most-visible first.** Max queue id is still **#5156**: `lead` has now been briefed twice (`INTENT
delivered=1` at `2026-11-05T22:52Z` and this session's `intent 27b1a681` at `2026-11-06T00:1xZ`, brief at
`.spike/delegate-20261106/brief-lead-1.md`) and the wake-and-measure pass is running on the operator's explicit
**"Accepted"** grant. Routing is `lead`'s; the delegate's briefed order (cheapest and most visible first) is:
**(1)** ROADMAP **294** — the *only* red demo, and it is red **because the metered arm succeeded**:
`demo/verifier-arm-probe.test.mjs` asserts host config state; the fix probe is already run
(`--config=<fixture>` → `verdict:NOT-ARMABLE cause:metered-endpoint-unpriced`), so the demo must supply its own config
fixture per arm and pin both directions; **(2)** ROADMAP **295** — the blessed first command prints credential **values**
(`tools/broker-serve.mjs:467-471`); **(3)** ROADMAP **296** — the same preflight probes the paid endpoint with no ceiling
and no ledger row; **(4)** ROADMAP **297** — price and measure three real verify legs on the armed arm before anyone
touches the slot; **(5)** **282** clauses 1+3+4 (per-area loop budgets — `check` still has zero timing rules) and
**283–289**, **291**, **293** (`tools/channel-preflight.mjs` still throws, and it is the blessed first command);
**(6)** the deferral wave (**292**) — now measurable, because the operator granted the pass; **(7)** ROADMAP **298** as
the research intake.

**Blocker:** **the team has nothing to claim** — `queued 0`, max id **#5156** — and a broker pass over an empty queue
costs wakes and proves only that the queue is empty. Below it, in order of cost to the rig: the credential-printing
preflight (**295**), the unaccounted metered probe spend (**296**), the red-because-success demo (**294**), the
still-crashing channel instrument (**293**), and the un-priced verifier slot (**297**). Closed this session and do not
re-open: the verifier (**"Metered arm"**, `ef29516d`) and the push grant (**"Granted"**, exercised, 0 unpushed).

Run this first — all reads, no writes:

```bash
cd ~/Git/Durian-Pi
git status --short -- . && git rev-list --count refs/remotes/origin/main..main   # 0 = pushed; ef29516d is trunk
DURIG_DB=./selfdev.sqlite node cli.mjs status                                    # 7 s — attention + non-terminal work
DURIG_DB=./selfdev.sqlite node cli.mjs queue 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print('max id',max(i['id'] for i in d['items']));[print(i['id'],i['status'],i.get('from'),'->',i.get('to'),str(i.get('subject'))[:90]) for i in d['items'] if i['id']>=5157]"   # >5156 = lead cut the rows; still 5156 = re-send the brief
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status queued | python3 -c "import json,sys;print('queued rows:',len(json.load(sys.stdin)['items']))"
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status         # broker up/down + provider classes
node scripts/test.mjs --list                                                     # 0.1 s — the loop map (9 areas, 258 tests)
node scripts/test.mjs --area check                                               # 6 s — the roster gate: `single-model-rig` must stay ABSENT
DURIG_DB=./selfdev.sqlite node tools/queue-drain-audit.mjs --config=./rig.selfdev.json --counts-only   # 1.1 s
```

The intent instrument is **`intent.mjs` at the repo root** (`git ls-files`), *not* `tools/intent.mjs`: the path in the
previous pointer and in the broker's own guidance text throws `MODULE_NOT_FOUND`. Re-send the brief with
`node intent.mjs lead --body-file <file>` (**space** after `--body-file`).

## State (measured 2026-11-06T00:3xZ, same host signature as above)

- **Trunk:** `main` = `ef29516d`, **pushed** (`origin/main..main` = 0). Session-E commits: `ef29516d` (the roster returns
  five verifier-capable seats — `qa`, `qa2`, `advocate`, `auditor`, `designer` — to `verifier/openai/gpt-oss-120b`).
  Docs for this session (D214, ROADMAP 294–298, this pointer) land with it.
- **The verifier arm (the operator's "Metered arm"):** `verifier` = `https://api.deepinfra.com/v1/openai`,
  `openai/gpt-oss-120b`, ctx 24,576 / out 3,000 — **the slot was deliberately not moved** (ROADMAP 297). Price came from
  the vendor catalog fetched 2026-11-06 (174 models: ctx 131,072, $0.037 in / $0.17 out per Mtok) and is recorded in the
  **gitignored** host configs (`durig.config.json`, `../durian-dev/seatroot/durig.config.json`) with
  `DURIG_VERIFIER_PRICE_AS_OF=2026-11-06`. Arming order is the finding: the probe first returned
  `NOT-ARMABLE / metered-endpoint-unpriced`, and only after the dated price row returned **`ARMABLE`** with
  `maxCallExposureUsd 0.001419` → **2,818 legs** under the `$4` store cap (`check` 284.7 % of cap, `run` 240.7 %, `call`
  35.5 %). Capability by observation, not vendor card: `tool_choice=auto` and `=required` both returned valid
  `tool_calls` — 3 calls, **$0.00003**, ledgers `.spike/delegate-20261106/spend-arm-*.jsonl` under
  `DURIG_PROBE_CEILING_USD=0.15`. At `max_tokens=24` the arm returned `content:""` with `finish:length` — it spends the
  completion budget thinking, which is why 297 measures legs rather than trusting the slot.
- **Suite:** **257/258** — the one failure is `demo/verifier-arm-probe.test.mjs` (ROADMAP **294**, red *because* the arm
  is legitimately priced; it inherits `durig.config.json`, which the demo cannot scrub). The two instruments
  `docs/runbooks/verifier-independence.md` says must move together both moved: `deepinfra-catalog` exit 0
  (`12 rig seat models resolve across providers local=7, verifier=5`) and `local-model-pointer` exit 0. **Correct the old
  claim wherever it appears:** that demo's red cause was **the roster lift** (`real seats exercise BOTH exemptions
  (local=12)`), not a missing `DEEPINFRA_API_KEY`.
- **`check`:** 126 findings — `citation-unresolvable` 67, `duplicate-item` 57, `verification-without-evidence` 1,
  `evidence-tree` 1 — and **`single-model-rig` is gone**. `check` has no timing budget (ROADMAP 282).
- **Queue:** max id **#5156**. `done` 3816 · `cancelled` 812 · `held` 345 rows (276 > 7 d) · `deferred` 183 rows ·
  **`queued` 0**. All 183 deferrals end `{"by":"supervisor","to":"human"}` and `human` is not a seat.
- **Spend:** the store ledger (`selfdev.sqlite.spend.jsonl`) still does **not exist** — every call this session was
  either on the free `local` arm or a probe ledgered in `.spike/`. The non-existence is itself evidence for ROADMAP
  **296**: the preflight's metered probe leaves no row.

## Traps this session found (mirrored into `docs/SELFDEV.md` §session E)

1. **A red demo can mean success.** `demo/verifier-arm-probe.test.mjs` asserts a *host* config property; arming the arm
   the operator asked for turned the suite red. Read the failure's *cause*, not its count (ROADMAP 294).
2. **Two commands documented in the pointer do not exist as written.** `tools/intent.mjs` → the file is `intent.mjs` at
   the repo root. Run `test -e` before citing a path (D159 addendum, D211 CORRECTION) — ROADMAP 291/298 family.
3. **`--dry-run` is not a health check of the queue.** It reports provider classes, the spool and the wake set, and it
   *refuses a dirty live tree* (`BLOCK live-tree-dirty` — F12/F23): commit the docs before starting a pass, or a seat
   woken from this cwd edits this tree.
4. **Reasoning models eat the completion budget.** `max_tokens=24` → `finish_reason:"length"`, `content:""`. A verifier
   leg needs completion headroom, not just a context slot (ROADMAP 297).
5. **A stale read is a trap in a compacted session.** Editing against an earlier read result failed on exact-match —
   the live pointer is 159 lines, not the 221 an earlier read showed. Re-read the file you are about to edit.

## Watch-list (delegate)

- **The pass is the evidence.** If `queue --id` shows rows above **#5156**, ROADMAP **292** is measurable: publish
  per-role **wake → claim** latency and the `tools/latency-budget.mjs` `WAIT 72.4% / WORK 13.0% / HELD 5.9%` split.
- **#5145** is `done` and unlanded with both evidence legs (`#5155` qa, `#5156` lead) `deferred`; the lift is gone, so a
  real cross-family verify leg on `item-5145` @ `39ee4fcc` is finally possible. No author-side leg closes it.
- **#5151** (`deferred → human`) is now **answered** by the operator's ruling and by `ef29516d`; whether the gate the
  earlier ruling asked for (**#5146**, also `deferred → human`) is still owed *after* the fact is `lead`'s call.
- **Naming:** `durian-core` stays unratified by operator ruling until the research completes. Do not cut a rename row.
- **Untracked `install.sh` in the repo root** — an unrelated installer (Strata Terminal), not the rig's. Disposition is
  the operator's; nothing in this repo references it (`git grep` clean).
- **Host facts, hostname-free:** Linux Fedora 45, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0. Two GPUs
  remain full (RTX A4000 14637/16376 MiB, RTX 3090 23098/24576 MiB), which is why the local `:1234` verifier stayed down
  and the metered arm is the arm that runs.
