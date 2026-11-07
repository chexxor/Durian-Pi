# NEXT.md — current state and next actions

**Last update:** 2026-11-07T05:3xZ (delegate session **N2** — the operator **ratifies the cleanup pass** (D228): the push was
executed by the operator, `item-5193` is ordered landed ("*item-5193 is still wanted, please land it*") and is now on `main`
as `1cac166b` → merge `baab6ed8`; `item-4970` is unlocked and reaped; `wip/seat-prompt-files` is kept, not force-deleted;
the three conflicted landings route to `lead`/`scribe`. Rig surface: **24 branches, 18 worktrees, `reapable 0`, `dirty 0`**.
Two new artifacts from the pass: row **345** (the land helper's conflict message names a scratch tree it already deleted) and
pitfall **63** (the sequence that lands a `done`-but-dirty worktree). Credential decision D227 A–D is still open — the
recommendation is restated as a single package in the session report.) Previous close (session **N**, 04:4xZ): the
operator's rulings: **333 is RULED = (b) as a
user-swappable interface** — "*We should provide a recommended implementation, but leave a bare-bones implementation that
pulled it from an env var or local file like Pi does*" (**D227**); **338 (`auth check`) approved — "Go ahead with it."**;
**331 approved to land**; rotation rides the store (`modify()`), not a restart. Measured in the same turn: the seam already
exists (`vendor/pi-main/packages/ai/src/models.ts:375` `credentials?: CredentialStore`, defaulted at `:407` to
`new InMemoryCredentialStore()`, and **`cli.mjs:391` is the only live `createModels(` call site**), and **`Models.checkAuth()`
already ships** (`models.ts:663-693` → `AuthCheck {source,type}` at `auth/types.ts:112-115`, no network call) — which makes
338's presence/source half free. **D225's "stored-wins would break the family guarantee" is corrected in the record**:
`resolve.ts:193-205` always calls our own resolver, so precedence is ours to write. Four decisions now wait on the operator,
each with a recommendation, in **D227** A–D: the recommended backend, the store key shape, the precedence rule, and whether
a seat may ever hold a value. The operator also named the next milestone — see (M) below — and granted push, used:
`4620cecf..d1583c38` then `d1583c38..4f62ccf8`.)

**Land+prune pass at the operator's request (2026-11-07T05:0xZ, session N).** "*I see we have a lot of branches, can you
land the ones that are done and clean them and their workspaces up?*" — done, per `docs/runbooks/branch-cleanup.md` +
`leaked-worktrees.md` + `land.md`: **10 done branches landed** (each proven by
`git merge-base --is-ancestor <tip> main` and a two-parent merge commit), **21 worktrees removed with zero refusals**,
**18 merged refs `-d`'d**, `git worktree prune` clean, and the leak meter is now **`reapable: 0`**. Branches **44 → 26**,
worktrees **41 → 20** at that moment, **24 branches / 18 worktrees** after the ratifications below), `main` advanced only by
the landings. Three done branches are **not** landed and are escalated, not
resolved (evidence in row 311's update and pitfall **62**): `item-4846` (writes `## D-<mint>`), `item-5208` (mints
`## D221`, which main already uses) and `item-4967` (a two-sided runbook rewrite no test can adjudicate). One new row is
registered from the pass: **344** (a patch-equivalent, non-ancestor ref that `prune-branch` and `-d` each refuse — the
`verify-5180` specimen is left in place to reproduce it).
**Ratified by the operator (D228):** the push was executed by the operator themselves; the three conflicted landings are
accepted as a route to `lead`/`scribe`; `item-4970` was unlocked and reaped; `wip/seat-prompt-files` is kept (no `-D`); and
**`item-5193` was ordered landed** — its recovered runbook work is now on `main` as `1cac166b` → merge `baab6ed8`, and the
recovery method is pitfall **63**.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**AS OF 2026-11-07T04:55Z (delegate session M) — read this block before the sections below; where it disagrees with them,
this block is the measured current state.**

**Blocker:** **no seat can be woken** — the `SKIP … reason=pending` wedge in block (W) below; `doctor` settles the
submissions and the next pass skips the same set, so 331 (`#5306`/`#5309`/`#5310`), 338 (`#5277`) and 334 (`#5320`) cannot
be started by anyone until it is understood.

**BLOCKER (W) — no seat can be woken, and the named remedy does not fix it.** Three bounded broker starts (pid 1604076,
1630036, 1549159) each logged `SKIP <seat> reason=pending conv=N` for pm, impl, qa, lead, scribe, devtools, auditor,
security, qa2, architect, and `status` carried 9 `admitted_not_started` notices ("submission #319666 admitted 101s ago, no
run started and no slot held; re-arm it with the resume/doctor verb (item 37(b))"). `doctor` with the broker stopped found
16 and settled them (`run-cancelled` ×10, `abortSubmission:settled` ×2, `withdrawn` ×4) and the **next pass skipped the same
set within 300 ms**. Not slots (`control.paused:false`, `streaming:{}`), not the spool (`broker.inbox` drained to 0), not the
model flip (the same SKIP set appears at 03:25Z, before it). **The sharpest observable: those SKIP lines carry `conv=N` but
NO `age=`** — `pendingConvIds = advancingConvIds(inspection.submissions, …)` (`src/broker.mjs:1278`) counts the conversation
as advancing while `pendingAgeMs` (`src/broker.mjs:1338-1342`) cannot date it from the same `inspection.submissions`;
meanwhile `src/attention.mjs:490` dates it fine ("admitted 101s ago"), so the two readers disagree about one conversation.
`src/broker.mjs:1277` already states the invariant ("#4170: `pendingConvIds` MUST MEAN 'ADVANCING', NOT 'HAS A SUBMISSION
ROW'") and `:805` names the shape from #2576; **#5215 (RM-314, wedged vs IDLE, claimed) is where this specimen belongs.**
Run first, in order: (1) `cat selfdev.sqlite.broker.json` then `ps -o pid,etime,args -p <that pid>` — **do not trust
`pgrep -a node | grep "cli.mjs serve"`, it returned nothing while the process was alive**; (2)
`DURIG_DB=./selfdev.sqlite node cli.mjs doctor`; (3) a deliberately short start
`node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 120` and read
whether the `SKIP reason=pending` lines now carry `age=` — yes: the suppressor is dateable, ask why `advancingConvIds`
counts it; no: ask which document the suppression is keyed on. A fake check exists for the assertion
(`demo/offline.mjs` runs pm→worker→done in 0.3 s): admitted → placed → run started.
**My three intent spools are HELD, not queued, in `.spike/delegate-20261107/held-intent/`** (ruling, wedge, and the earlier
one) — applying an intent in this state creates a submission that suppresses its seat further. Re-spool only after (W) is
resolved: `node intent.mjs lead --body-file .spike/delegate-20261107/intent-lead-ruling.md --request-id
delegate-20261107-ruling` (same for `intent-wedge.md` → lead and architect, and `intent-arch-deadletters.md` +
`intent-arch-correction.md` → architect).

**RULING APPLIED (R2) — the verifiers now run the local model, and `check` says the invariant is broken.** Operator,
2026-11-07: "The next pass can have the verifiers use the local model." Applied at `2e59dd89`: qa, qa2, advocate, auditor,
designer moved to `local/qwen3.8-flash-next-iq3_s` via the only apply path, `up rig.selfdev.json --refresh` (after
`--refresh --dry-run` previewed exactly 5 resets). `node cli.mjs check rig.selfdev.json` went 141 → 142 findings; the new one
is `single-model-rig` (fix-now). **D48/D119 cross-family verification is suspended on this rig, not fixed** — the local
server (`/v1/models`) serves exactly one model, `nvidia-smi` shows the A4000 at 15,816/16,376 MiB and the 3090 at
23,012/24,576 MiB, so no second family fits today. Verifier spend is frozen at **$0.452053 of the $0.50 trigger** (one
15-minute pass cost **$0.06109**; declared price $0.037/M in, `durig.config.json:16-18`, cheaper than the cheapest metered
alternative in `src/providers/deepinfra-prices.json`, so cost is driven by call count and prompt size, not price).
**Trap:** that loopback server answers ANY requested model id with qwen — a request for `openai/gpt-oss-120b` returned a body
whose `model` field read `qwen3.8-flash-next-iq3_s` — and `src/checkup.mjs:599-606` compares resolved model STRINGS, so
repointing `DURIG_VERIFIER_BASE_URL` at loopback instead would keep `check` green while the invariant is false and log a
model that never ran. Nothing anywhere compares the requested id with the returned id (grep: no matches in `src/` or
`vendor/pi-main/packages/{durable,ai}/src`) — fold that into #5212 (RM-315) / #5275 (329), do not mint a fourth.
**The ruling also turned a suite gate red, and it is the gate that no longer matches the state, not the fix that broke:**
`node scripts/test.mjs --area docs` → **5/6**, the failure is `demo/deepinfra-catalog.test.mjs:141`
`real seats exercise BOTH exemptions (verifier=0, local=12) — the fix is not carried only by synthetic cases`, which reads
the LIVE rig's seat models and requires ≥ 1 seat per provider exemption (the regression guard for the 2026-10-19 outage
fix). `--area guard` is 25/25 and the rest of `--area docs` is green. Three ways out, and the choice is the operator's, not
the delegate's: **(A)** leave it red (costs the suite's signal and hides real regressions in that file); **(B) recommended**
— restore exactly ONE metered verifier-family seat as a canary that carries the exemption (measured $0.000414/call; keep it
`paused` unless a landing needs it, so the $0.50 family trigger stays untouched) and leave the other four local; **(C)** give
the test its own two-provider fixture — cheap, but the assertion's own comment refuses synthetic-only carriage.

**CONSEQUENCE FOR 331 (#5306 plumbing / #5309 values / #5310 verify — all still `queued`, unclaimed).** The verifier half of
#5309 now configures **no seat**: `DURIG_COMPACTION_MODEL_OVERRIDES` still keys `verifier/openai/gpt-oss-120b` (keep it —
it is latent policy for a family with no seats, and restoring the family is one seat-model edit each plus `up --refresh`).
#5310 should assert both keys AND `reserveTokens >= maxTokens` per family: my band probe
(`.spike/delegate-20261107/context-bands.mjs`, free, output in `context-bands.out`) shows the defaults put the verifier
behind a **compaction wall** (`keep 20,000 + summary 6,000 = 26,000 > 24,576` window) with a **negative** background
threshold (−24,576), and #5309's accepted verifier reserve (4,096) is smaller than its declared completion (6,000). Full
arithmetic per family: `docs/reviews/task-completion-milestone-intake-2026-11-07.md` §6. **The probes are untracked
(`.spike/` is gitignored): they sit on disk until a scratch sweep, and a sweep is a documented act
(`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`) — so an unpromoted probe is lost without anyone deciding to
lose it. `#5308` owns promotion. Run both policy probes — one says WHICH policy resolves, the other says WHERE it fires and
which band that is.**

**MILESTONE (M) — its references are now fetched and quote-checked, and one of its claims contradicts its own source.**
`inputs/fetched/MANIFEST.md` §7 pins all three URLs (200/200/200 + sha256) and lists which claims are supported verbatim
(incl. the cookbook's `high-level 3/3 preserved, obscure 0/3 preserved`) and which are the doc's own inferences with no
source ("an agent at 90 % of its window is the worst possible judge"; the "often 5–15k" prompt floor). §7.2 records that our
pin exposes no `clear_tool_uses`-style primitive (grep → no matches), only
`ContextEdit {target, action:"omit"|"replace"}` at `vendor/pi-main/packages/durable/src/types.ts:412-426` — which is what
the held pair **#2402/#2403** already owns, so fold the doc's Economy band there rather than minting N6 beside it. New
prompt for the questions the tree cannot answer: `docs/reviews/task-completion-followup-research-prompt.md` (operator hands
it to the research agent; the delegate cannot).

**CORRECTION to the claim in (M) below — the free arm IS recorded, just not in the ledger.** `cli.mjs status --json`'s
`context` block carries per-seat `{consumed, usage, window, fraction, head.state}` for **all twelve** seats from the store's
own usage entries, e.g. `auditor consumed 20,902 / window 24,576 / fraction 0.850 / head.state "current"` and `pm cacheRead
46,691` on the free arm. What is missing is a **series** and a **measured denominator** (`window.candidates.measured` is
`null` for every seat — that is rows 27/97, not new work). **Trap before quoting a fraction:** `consumed` is one turn's
MOVED tokens including `cacheRead`, not the live head (`src/context.mjs:31`, and `docs/runbooks/context-over-window.md`
says acting on the wrong reading is worse). `advocate` prints `fraction 9.96` today because its newest usage entry (244,751)
sits **behind a compaction boundary** (`head.state:"behind-boundary"`) and its declared window is now 24,576 — while the
runbook's worked example still ties that same 244,751 to a 200,000 window ("1.22×"), so **that runbook sentence is now
false in its detail** (check id `runbook-stale` exists and did not fire; worth a row).

**Current item — the milestone the operator named, then the build the ruling just opened.**

**(M) THE MILESTONE: "ensuring LLM task completion."** The operator created
`docs/reviews/ensuring-llm-task-completion-research.md` and ruled it "the next milestone we work on" (2026-11-07); it is
tracked as **milestone source material, authored by the operator** — a raw model reply whose three references (two Anthropic
pages, one vendor blog) were fetched by neither the delegate nor the team, so it is task material, not evidence. Read
`docs/reviews/task-completion-milestone-intake-2026-11-07.md` **first**: it maps the doc's six proposals onto what the rig
already runs (D105's per-item fresh context boundary `src/broker.mjs:55`, whose comment at `:112-114` already warns about a
seat that "drift[s] into the compaction wall while the rig reported it healthy"; the pointer gate
`demo/next-pointer.test.mjs`; the clock-in digest `demo/clockin-digest.test.mjs`; `demo/resume.test.mjs` is the CLI
`resume`/`doctor` verb, not a handoff resume), names the seven new candidates **N1–N7** for `lead`/`pm` to mint as rows
(**the delegate registered none**), and carries the free measurements: the harness resolves `{16384/20000/32768}` for
**every** family (so the verifier's compaction threshold is `24576 − 16384 = 8192` while the policy keeps **20,000** recent
tokens); the metered arm's `prompt_tokens` reach **24,358 = 99.1 % of its 24,576 window** (319 calls ≥ 8,192; 281 up- vs 322
down-transitions > 2 k — a sawtooth); and the **free arm records no trajectory at all** (pitfall **61**; probe
`.spike/delegate-20261107/trajectory.mjs`, 0.3 s). **Do not adopt the doc's 130k-token bands** — compute per family.
**Run before the review, in order (all free):** (1) land **331** (approved) — band arithmetic on a schedule that reaches no
seat is decoration; (2) promote the three `.spike/` instruments under **312** (compaction-policy probe, `/proc` canary for
337, trajectory probe for N2); (3) drain the spool with a **bounded** broker start after reading the 6 dead letters, so
`lead` can route; (4) settle how **#5273** (311) gets claimed — the doc's kill test and the 41 leaked worktrees are the same
failure class; (5) `node scripts/test.mjs --area docs && node scripts/test.mjs --area guard` (1.0 s / 1.9 s).

**(C) THE LAND+PRUNE PASS — state of the branch/worktree surface right now, and what to run first.** Landed (merge
commits on `main`): `item-4829`, `item-4922`, `item-4943`, `item-5090`, **`item-5111`** (= #5134, the
worktree-removal message fix — **half of row 311 is therefore now landed**: `src/worktree.mjs:1242`
`entry.parentPath ?? entry.path ?? worktree`), `item-5145`, `item-5175` (the `item-5094` KEEP-HELD disposition row),
`item-5209`, `item-5216`, `item-5217`. **Still off-main, on their refs, with their worktrees already reclaimed** (so the
refs are all that remain): `item-4846`, `item-4967`, `item-5208` (needs a decision-number re-mint — the ledger owner's
call), `item-5094` + `impl-item-5094-recut` (**identical patch-ids** `323f8b98…`/`b8d62623…` — Step 0c says one claim, and
the landed ledger row for it says **KEEP-HELD**, so the delegate neither landed nor deleted them), `verify-5180` (the 344
specimen), `wip/seat-prompt-files` (ledger row `SUPERSEDED-BY-EVENTS`; removal needs a named `-D` grant — **yours**).
**Worktree surface after the ratifications (measured): 18 trees — 8 seat-root (in use), 9 live
(`claimed`/`held`/`deferred`), 1 `locked` (`item-5094`, held on purpose by its `KEEP-HELD` disposition row), and
`dirty: 0` — the last orphan (`item-5193`) is landed, and `item-4970`'s lingering lock was reaped on the operator's
acceptance.** Re-check in one line each:
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (expect `reapable: 0`) and
`git branch --format='%(refname:short)' | grep -v '^main$' | while read b; do a=$(git rev-list --count main..$b); [ "$a" -gt 0 ] && echo "$b ahead=$a"; done`.

**(R) 333 IS RULED — (b) as an interface — so the credential work is now a build with a known order.** The ruling and the
four follow-up decisions are in **D227**. Rows updated in place, not duplicated: **333** (the ruling, verbatim; open only for
which backend is *recommended*), **334** (the seam: corrected citation — `read`/`list`/`modify`/`delete` at
`vendor/pi-main/packages/ai/src/auth/types.ts:65-97`, swap point `models.ts:375`/`:407` at `cli.mjs:391`, and a stored
credential never silences our resolver), **338** (approved; `checkAuth` + `list()` make presence and source free), **339**
(an OS keychain is a candidate *backend*), **326** (rotation = `modify()`; the cadence is the operator's). **Build order
spooled to `lead`: 331 → 338 (`checkAuth` first, then the paid usability probe) → 334 (bare-bones store + the backend
selector in config) → 336/337/341 (already funded) → then 342's spike**, which measures "does a seat hold a value or a
grant" before any backend beyond the bare-bones one is chosen.

**ARCHIVED THIS SESSION (2026-11-07, delegate session M): the credential-question block (0), the
session-L 331 block (1), the pass-halting block (2), the row list (3) and the numbered operating notes
moved VERBATIM to `docs/NEXT-ARCHIVE.md` under the heading `## from docs/NEXT.md 2026-11-07 (session M cut)` — the
pointer cap is 200 lines (`demo/next-pointer.test.mjs`) and the 200th line must still be readable.
