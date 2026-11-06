# NEXT.md — current state and next actions

**Last update:** 2026-11-06T21:5xZ (delegate session **L** closes — the operator ruled that **moving durian-pi further into the pi
ecosystem is a product requirement and gets prioritized**, that there are **no Windows seats for a long time**, and that the
delegate's other recommendations are accepted (**D224**); ROADMAP **332** (four config-plane seams) and **333** (the credential
fork, operator-gated) were registered from measurements taken in this tree, **331** is now slice 1 of 332's settings seam, `D224`
also **corrects three pointers the delegate shipped wrong** in `e3232d48`, and pitfalls **52–54** were added. Local commits
**`0bce3ed5`, `e3232d48`, `cb07596f`, `41fefe17`, `4ea092e3`** are **unpushed** — the session-G grant was spent on
`ffbd0e1e..4c3fd7cc`; a fresh operator grant is required. The session-E through session-K pointers are VERBATIM in `docs/NEXT-ARCHIVE.md`.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item — TWO halves, and only one of them costs money.**

**(0) THE PRIORITY THE OPERATOR JUST SET: pi-ecosystem alignment (D224, ROADMAP 332).** The measured answer to "does Pi
configuration reach a seat?" is **split**. The substrate is already pi's: the seat harness is pi-durable's `Harness.open`
(`cli.mjs:474`), the provider is pi-ai's `createProvider({id, baseUrl, api, auth:{apiKey:{resolve: ctx.env(…)}}})`
(`cli.mjs:349-357`), and `package.json` carries `pi-ai`, `pi-durable`, `pi-coding-agent@1.3.0`, `pi-tui`, `chord`. The
**configuration** is a parallel plane: `@earendil-works/pi-coding-agent` is imported by exactly **one** file
(`src/tui/durable/imports.mjs`), `SettingsManager`/`ModelRegistry` by exactly **one** file (`src/tui/durable/adapter.mjs`), and the
seat's settings come from `DURIG_*` spread at `cli.mjs:487`. What that costs, measured in this tree: the operator's
`~/.pi/agent/settings.json` schedule reaches **no seat**; one model name carries **three** context windows
(`DURIG_LOCAL_CONTEXT = 200000` at `durig.config.json:5`; pi's `models.json` says `strata 204800/32768`, `strata-server
131072/24576`); thinking level is duplicated (`defaultThinkingLevel "medium"` in pi vs `"thinkingLevel": "high"` in
`rig.selfdev.json`); pi's registry has **no** `verifier`/DeepInfra provider, so adopting it wholesale would delete the
cross-family invariant `src/providers/local.mjs:9-34` exists to protect (D48/D119); and seat turns are invisible to pi's session
plane (`~/.pi/agent/sessions`: 6 entries, 0 naming a seat worktree). **332** names four seams — **S1 settings, S2 model registry,
S3 credentials (row 333, operator-gated), S4 visibility + pin currency** — on the **base** plane per D212, because a seat's config
input is not a customization. Recommended order: **331 → S1 → S2 → S4 → S3**, free of model spend until S4's priced part. Do not
relax build-spec §1 (`src/tui/durable/imports.mjs` header): code resolves the **pinned** package, never
`~/.pi/agent/install/current-version` — so pi's settings plane enters as a named, logged, absence-tolerant **input layer**, never as
a second source of truth for a shipped build.

**(1) FREE, zero-spend, unblocked right now — ROADMAP 331 (slice 1 of 332's S1 seam).** The operator moved the pi-plane
schedule (`~/.pi/agent/settings.json`: harness-wide `reserve 32000 / keep 16000`; `strata → 40960/24000`; `strata-server →
26214/16000`; and `~/.pi/agent/models.json` `strata-server maxTokens 16384 → 24576`). It **cannot reach a seat**: seats resolve
`local/…` or `verifier/…` (provider ids from `src/providers/local.mjs:34` and `src/providers/deepinfra-models.ts:41`), and
`src/config.mjs:432 compactionSettings()` emits `modelOverrides` as a **sibling** (`:488`) of `compaction` (`:455` emits
`compaction` only when a harness-wide key is set) while pi-durable reads it only from **inside** `settings.compaction`
(`agent.ts:71`, `compaction.ts:262-263`). Measured by
`node .spike/delegate-20261106c/compaction-policy-probe.mjs` (free, calls pi-durable's own `compactionPolicy`): **every family
resolves the pi-durable defaults `16384 / 20000 / 32768`** — the configured `local/…: 20480` arrives nowhere, and
`verifier/openai/gpt-oss-120b` (window 24,576, max 6,000) compacts above `24576 − 16384 = 8192` while keeping `20000` recent =
**81 % of its whole window**. Next command for that half, in order: `node .spike/delegate-20261106c/compaction-policy-probe.mjs`
(baseline) → the fix (`out.compaction = {...policy, ...(layered ? {modelOverrides: layered} : {})}`, and keep the **other** consumer
working: `cli.mjs:1596` reads `compactionSettings(CFG).compaction ?? {}` to report the policy in force, so the `compact` report has
been reporting an empty policy for the same reason) → the gate, which is **a test
that calls pi-durable's `compactionPolicy()` and asserts the configured numbers come back per family** (`demo/config.test.mjs` is
area **`rig`** and **passes with the bug in place** — `node --test demo/config.test.mjs` → 1/1, 3.4 s — it pins only the call site
(`:250-251`) and the one-spread count (`:303-305`), so it is not the gate;
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
keycheck probe) are `queued`; **`#5278` (qa, the Windows-side 311(ii) observation) stays `held` and is OFF the critical path** — the
operator ruled **no Windows seats for a long time** (D224), so **311 closes as `verified-partial`** with the NTFS-junction half
explicitly unverified rather than waiting on a host that is not in the plan, and the Windows worktree-audit ask (**#5285**) is parked
too. What that ruling does NOT park: rows **186** (seat personas hard-code the Windows shell) and **217** (on Linux a seat has no
shell at all) — with no Windows seats coming, a Linux seat that cannot shell is the constraint's own precondition. The keep-gate on
refs **`item-4829` / `item-5147`** still applies to any 311 reap verb (`#5280`, `pm`, held).

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

**Order: the pi-ecosystem ladder first, because it is free.** D224 makes **331 → 332-S1 → 332-S2 → 332-S4 → 333** the running order
(no model spend in any of them). The older ruling still governs the PAID half: **backoff before capacity** — **313/300** land before
any concurrency, verifier slot, or per-seat cap change, and `321` before `317`/`324`, with the verifier staying cross-family (189).
New rows this turn: **332** (the parallel config plane — four seams, measured drift of three context windows for one model), **333**
(the credential fork: `cli.mjs:396 fileExists: async () => false` vs pi's `/login` store — **operator-gated**), **323** (`CONFIG_KEYS` has the VERIFIER price keys and not the LOCAL ones —
a LAN local family can only be armed through `--env-file`, else it registers no model row and all 7 author seats go dark),
**324** (the operator's **$0.50 verifier-family** threshold has no enforcer; the switch would make the rig single-model
and drop D137's cross-family verifier), **325** (endpoint readiness vs the 20 s bound), **326** (a rotation darkens the rig
invisibly; keys are per box).

**Next command** (host signature measured with it — Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0):

```bash
cd ~/Git/Durian-Pi
node .spike/delegate-20261106/verifier-spend-tripwire.mjs   # family spend vs the $0.50 trigger (free) — 69.9% ($0.34959) at this close
node .spike/delegate-20261106c/compaction-policy-probe.mjs   # 331: what the harness ACTUALLY resolves per family — free, no model
git ls-files tools/ | grep -c compaction                     # 0 = the probe is still un-promoted (lost next session; #5277 pattern)
ls selfdev.sqlite.broker.stop                               # 327 guard: a stale stop file silently steals the next pass
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/status-i.json   # run this only with the broker DOWN — 329: a wedged broker makes it print nothing for 120 s
node tools/broker-serve.mjs --status                        # up? spool depth? provider reachability? — reads files, not the store, so it answers even when the broker is wedged
test -e selfdev.sqlite.broker.json && node -e 'const r=require("fs").readFileSync("selfdev.sqlite.broker.json","utf8");console.log(r)'  # fresh heartbeatAt + frozen lastPassAt = 303
ls selfdev.sqlite.broker.inbox.error | wc -l                # reads the broker destroyed (6, all `apply failed: SqliteStorage is closed`) — 329
git worktree list | wc -l                                   # 311 leak meter: 35 at session-K clock-in, 41 at its close
node .spike/delegate-20261106b/queue-counts.mjs             # (probe, promote-or-delete per 312)
node demo/deepinfra-catalog.test.mjs                        # "12 rig seat models resolve ... local=7, verifier=5" = the rig is lit
node scripts/test.mjs --area docs && node scripts/test.mjs --area check && node scripts/test.mjs --area guard
grep -c "<a phrase only your own entry contains>" docs/SELFDEV.md   # 330: prove YOUR doc edit survived; a clean `git status` is what a lost edit looks like
# no pass until 311 lands; then, and only with the operator's intent:
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --dry-run   # NEVER paste its output -- 295 prints credential VALUES
# node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 600
```

**Push state:** `origin/main` = **`4c3fd7cc`** (the session-G batch grant, **spent** on `ffbd0e1e..4c3fd7cc`). Since then **five**
local-only commits need a fresh per-batch grant (D218): **`0bce3ed5`** (D223 + pitfalls 43–46), **`e3232d48`** (D223 correction + row
331 + pitfalls 47–50), **`cb07596f`** (session-K pointer), **`41fefe17`** (pitfall 51), **`4ea092e3`** (329 third specimen) — plus
this session's D224 / rows 332–333 / pitfalls 52–54 commit. `git rev-list --count refs/remotes/origin/main..main` is the check.



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

