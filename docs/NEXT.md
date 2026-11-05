# NEXT.md — current state and next actions

**Last update:** 2026-11-05T19:4xZ (delegate session C — the verifier chain **landed and is proven on trunk**, and the
local model moved to the operator's new Strata endpoint (**D211**). The blocker now is the **delivery channel**, not the
backlog: `send` is refused by the spend-cap gate and a broker start is refused while the verifier endpoint is down —
both measured below, both need an operator ruling.) The superseded pointer moved VERBATIM to `docs/NEXT-ARCHIVE.md`.

Host for everything below, measured in the same command as the measurements: **Linux Fedora 45**, kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 (**never sign work with a hostname** — D205).

## NEXT SESSION

**Current item: restore a working delivery channel.** The queue is fine; **both verbs that reach a seat are now refused**,
and each refusal is an instrument doing its job — so the fix is an operator ruling, not a workaround. Measured
2026-11-05T19:3xZ on **Linux Fedora 45**, kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0:

1. **`cli.mjs send` → `{"spend":"catalog-refused","model":"google/gemini-3.1-pro","cause":"over-exposed","capUsd":4,
   "maxCallExposureUsd":14}`** — an author `send` registers a **metered** catalog row whose one-maximal-call exposure is
   **3.5× the $4 store cap**. Naming the local id instead gives `{"spend":"model-unpriced","provider":"deepinfra",
   "model":"qwen3.8-flash-next-iq3_s","cause":"no dated price for this id"}` — the pins hold no dated row for a local id,
   and the remedy line itself says **"$0 is a legitimate declared price"**. Both refusals land **before any request**, and
   `DURIG_SPEND_LEDGER` (`/tmp/durian-spend.jsonl`) **does not exist**, so **$0 was spent**. The gate that fires is the one
   that landed today as `083d2da2` (#5111, *"metered sends get their cap from the provider spec"*): byte-identical command
   and store were accepted at 13:0xZ, refused at 19:3xZ.
2. **A broker start would be refused:** `node tools/broker-serve.mjs --dry-run` ends `A start would be refused:
   provider-DURIG_VERIFIER_-unreachable, provider-verifier-completion-failed` — `http://127.0.0.1:1234/v1` gives
   ECONNREFUSED on `/v1/models` **and** `/chat/completions`. The same dry-run reports **2 stranded intents >1 h** ("the
   delivery channel, not the backlog, is the critical path") and `supervisor: escalated` for **devtools, auditor, qa2**
   (degeneration).

**Three ways out, not equivalent:** (a) raise `DURIG_SPEND_CAP_STORE_USD` above the metered catalog's worst row — an
operator capacity ruling (D201); (b) give the local model a **dated $0 price row** so a seat turn registers honestly — a
`devtools` row, and note that hand-editing `src/providers/deepinfra-prices.json` is exactly what that file forbids (vendor
pins are fetched, not typed, and carry an `asOf`); (c) bring the verifier endpoint up (or lift the `verifier` provider out
of `rig.selfdev.json` until #5153 lands) and drive the team the blessed way, `intent.mjs` + `cli.mjs serve`. **Recommend
(b) + (c):** (a) buys a metered default this rig does not need when the same gate says the honest answer is a declared $0.
Only the operator can do (a) and (c). **And (b) is not a host-env fix — tried and measured:** declaring
`DURIG_LOCAL_PRICE_USD_IN=0/_OUT=0` in the launch env and naming the model with `DURIG_MODEL` (bare id, `provider/id`, and
`DURIG_PROVIDER=local`) is refused as `model-unpriced` with `"provider":"deepinfra"` every time (the price lines were
removed again afterwards — the host env is as the operator set it), so `DURIG_MODEL` cannot
address the local provider class at all — it is looked up in the metered catalog. That makes (b) a code/pins row, not
something a delegate can configure around.

**Blocker:** the **delivery channel** — `send` is refused by the spend-cap gate (metered catalog row $14 max-call vs the $4
store cap; a named local id has no dated price) **and** a broker start is refused while `DURIG_VERIFIER_BASE_URL`
(`http://127.0.0.1:1234/v1`) answers ECONNREFUSED. Both need the operator (a)/(c) above; no seat can be woken until one is
granted, so #5144 sits `claimed` and #5145/#4829 sit unlanded.

Run this first — all reads, no writes:

```bash
cd ~/Git/Durian-Pi
git status --short -- . && git rev-list --count refs/remotes/origin/main..main   # re-measure: 8 ahead at 20:1xZ, 0 pushed
DURIG_DB=./selfdev.sqlite node cli.mjs queue --id 5143 --id 5144 --id 5145 --id 5146 --id 5149 --id 5152 --id 5153 --id 5154
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status  # 12 s: local CLEAN, verifier 2 BLOCKs
DURIG_DB=./selfdev.sqlite node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.1 s; hygiene counts, pm-owned
```

**Rows this session created (all `lead`-routed — do not re-create):** **#5143 `queued`** (`devtools`, land the verifier
branches — **the delegate landed them by SHA instead**, so `pm` closes it on the evidence in D211); **#5144 `claimed`**
(`impl`, the `pickEnv` secret-value belt — the seat took it, produced **no branch**, its turn ended with an empty reply and
its worktree is gone); **#5145 `done`** (`impl`, branch `item-5145` tip `39ee4fcc`, **unlanded**); **#5146 `queued`**
(`devtools`, the differential gate); **#5147/#5148 `held`** (the two research commissions, operator routing them);
**#5149/#5154 `queued`** (`scribe`, AGPL entry, the dispatch runbook); **#5152 `held`** (`architect`, gated on **#4829 +
#5147 + #5148**); **#5153 `held`** (`devtools`, gated on **#5146 + #5095**). Cancelled with the operator's grant:
**#4833 → #5152**, **#5136 → #5153**, **#5127**.

**Hand these two to `lead` when a channel exists (`.spike/delegate-20261105c/` briefs are gitignored; rewrite from D211 if
gone):** (1) the **instrument leak in the provider check that just landed** — `checkup.mjs:94` / `providers/local.mjs:148`
read the **process env**, not the config-file precedence, so `src/config.mjs:53` `localContextFor` ("a declared 128k would
otherwise admit a 200k request to a 128k server") is false again for anyone who declares context in a config file: on an
**unmodified** checkout it probes `http://127.0.0.1:1/v1`, answers `"no provider config to check"`, and prints
`1300000/128000`; and (2) the **model-id drift** — every tracked fixture still names `local/iq3_s` (`rig.selfdev.json` for
9 seats, `src/model-provision.mjs:178`, `docs/ROADMAP.md:2360`, and the compaction-override key `"local/iq3_s"` in
`durig.config.default.json`, which silently stops matching if the id moves and reverts `reserveTokens` 20480 → 16384).
One server-side alias (`iq3_s` on the new endpoint) fixes both halves for free and keeps every fixture truthful.

**History:** superseded blocks move VERBATIM to `docs/NEXT-ARCHIVE.md`; this file is a pointer with a **cap 200** lines
(and a ~16.9 KB ceiling imposed by the 20,000 B clock-in digest — `demo/clockin-digest.test.mjs`), gated by
`demo/next-pointer.test.mjs` (0.3 s) — cut before you add.

**Queue hygiene — the operator asked "do the 162 `queued` rows need cleanup?" Measured answer: no, not those.** No row was
touched; the delegate has no transition authority (`pm` owns release/cancel). `queued` = **162**, but **67 are `notice`
rows** (terminal-status announcements registered as claimable work; 2,029 exist store-wide, 1,801 already `done`), so real
queued work is **95**: `devtools 34, impl 18, lead 12, scribe 10, qa 8, security 5, architect 4, pm 3, qa2 1`, and only
**1** queued row is older than 7 days (#3350, `qa`, 17 d). The stale mass is elsewhere and `tools/queue-drain-audit.mjs`
counts it every run: **345 `held`** (276 older than 7 d), **93 non-terminal LANDING rows of which 73 are already fully on
`main`** (zero-build closable), **75 orphan candidates**, **33 rows whose citations resolve to no current row**, **12 whose
gate prose cites no resolvable id**. That is a `pm` release/cancel pass plus a `lead` read of the orphan bodies — the held / landing / orphan
classes, not the 162, are where the hygiene work is.
## State (measured 2026-11-05T19:3x–20:0xZ, Linux Fedora 45 / kernel `7.2.15-300.fc45.x86_64` / node v24.22.1 / git 2.56.0)

`main` @`1872d35f` (docs) on top of the landings, **8 ahead of `refs/remotes/origin/main`, 0 pushed** (this pointer's own docs commits move that number — re-measure, do not carry it) (the operator's push
grant of 2026-11-05 was not exercised — the delegate lands locally and reports; `git push origin main` is the operator's to
run or grant). Landed this session by
SHA: `item-5131 3a7abc99` → merge `807f24a0`, `item-5111 083d2da2` → merge `a978bcd9`; `item-5125 385e3973` is **subsumed**
(`merge-base --is-ancestor item-5125 item-5131` exit 0, `git diff 807f24a0 385e3973 -- src | wc -l` = **0**), so `main`
carries all three rows' content. **Suite green on landed trunk, run from the seat root where the vendored deps are
installed: `SUITE GREEN: pass=258 environmental=0 fail=0`, exit 0** (1672 s). The promoted arm probe passes on trunk:
`node tools/verifier-arm-probe.mjs --base=https://api.deepinfra.com/v1/openai --model=openai/gpt-oss-120b` with
`DURIG_VERIFIER_PRICE_USD_IN=0.037/_OUT=0.17` → `endpoint: metered`, `priceSource: DURIG_VERIFIER_PRICE_USD_IN/OUT`,
`maxCallExposureUsd 0.001419`, **`verdict: ARMABLE`** (93 ms); against the loopback class → **`NOT-ARMABLE`** with
`cause: metered-endpoint-unpriced` — the split D210 asked for, answered by an instrument instead of by hand.
`tools/deepinfra-catalog.mjs` says **catalog fresh (182 models, fetched 2026-10-28)**.
Queue histogram: total **5156**, `done 3816, cancelled 812, held 345, queued 162, deferred 16, claimed 5`.

## Traps this session found (each cost real time — they belong in `docs/SELFDEV.md` too)

1. **A `send` without `--env-file` fails the local provider and takes another seat with it.** `node cli.mjs send devtools
   …` (no env file) → submission **#285670** `unanswered / model_error: 401 "Invalid API key"`, zero tokens, **and the same
   wake pass killed `security`** (entry **#285672**). Then `cli.mjs resume` printed **`{"found":0}`** — an
   `unanswered/model_error` submission is *not* `admitted_not_started`, so **`resume` does not repair it**; the fix is a
   corrected re-send, diagnosed from `submissions.detail` (§2c of `session-start-cost.md`).
2. **`show <id>` takes no `--json`** — it errors into the `queue` usage block. Use `queue --id <id> [--id …]`.
3. **Two `send`s at once is a two-writer hazard** — never dispatch a second seat while a `send` harness owns the store.
   That is why `lead` was left unwoken and this handoff exists.
4. **`{"spend":"catalog-refused","model":"google/gemini-3.1-pro",… maxCallExposureUsd 14 … capUsd 4}` used to be noise —
   it is now the finding, and the pointer was corrected to say so.** Last session it annotated a catalog row nothing used.
   After #5111 (`083d2da2`) landed it **refuses the `send` itself** (§1 of NEXT SESSION): the store cap is applied to the
   worst *catalog* row, not to the model the turn will actually run. Read it as a dispatch gate, not as noise. Also still
   noise: `broker-serve --status`'s `NOTE stranded-intent: 2` (`{"op":"read","view":"health","from":"cli"}` files left by
   `cli.mjs status`, §5b) and `lead`'s `secret_detected` at entry **#285629** (`pi.compaction` content, the 40-hex redactor
   class #4922).
5. **`--body-file=<path>` does not work; `--body-file <path>` does.** `cli.mjs:3328` is `const fileAt =
   rest.indexOf("--body-file")`, so the `=` form gives `fileAt = -1` and **this CLI never reads the file**. What the seat
   actually received was a stub — its user entry began `the file you can read with your read tool at:` followed by the path
   — which I could not attribute to a source in this repo (grep for that phrase matches nothing outside `node_modules`), so
   treat the emitter as unfixed. Either way a seat has no read access to a delegate's `.spike/`, and it cost a full
   16-minute `lead` turn plus a re-send.
6. **Config-file keys are allow-listed; provider keys are env-only.** Adding `DURIG_LOCAL_COMPACTION_RESERVE_TOKENS` to
   `durig.config.json` is a **fatal** CLI error (`unknown config-file key(s) … no code reads these`, #5071) — that
   accepted-and-ignored detector is real and saved a silent no-op. `DURIG_LOCAL_*PRICE_USD_*`,
   `DURIG_*_COMPACTION_*` and `DURIG_MODEL` belong in the **environment** (`--env-file="$HOME/.config/durig/env"`).
7. **A green suite needs the seat root, not a detached scratch.** Running the suite from a `git worktree add --detach`
   scratch gave `ERR_MODULE_NOT_FOUND @earendil-works/pi-durable` in
   `demo/commit-discipline-personas.test.mjs` — and the same failure reproduces at the pre-landing commit, so it is a
   dependency-link artifact of the scratch, not a regression. Run the suite from `~/Git/durian-dev/seatroot`, where the
   vendored deps are installed (1672 s on this host).

## Watch-list (delegate)

- **AT RISK** (`seat-turn-shape`, counted projection ends on `user`): `scribe security advocate auditor designer qa2`
   (`impl lead devtools` were counted-clean at 19:1xZ). Re-measure before any dispatch; `security` may need a `reset` with
   a handoff to close **#4829**, whose artifact is committed on `item-4829` but **unlanded** (that worktree is `locked`).
- `qa` window 20,110 / 24,576 = **0.818**; the verifier-band problem (§14 of `session-start-cost.md`) is unfixed —
  `DURIG_VERIFIER_CONTEXT 24576 − 16384 = 8,192`, so any verifier seat above 8,192 consumed cannot take a turn without a
  compaction that cannot succeed at 3,000 summary tokens. **Settle this before #5153 (which replaced #5136) flips the
  roster**, or the same failure walks over to DeepInfra.
- **Probes worth keeping are already in `tools/`**: `tools/verifier-arm-probe.mjs` (offline; prints the resolved spec,
  the price **and its source**, and `maxCallExposureUsd` against the three caps; never a credential). Promoted by #5125 —
  the old `.spike/` copy is gone by design.
- **`git log --all --grep=secret_detected` for every redactor hit before attributing one** — this session's was
  `pi.compaction` content, not a tool result.
- **Next delegation, when a channel exists:** `lead` rules whether the **cheap belts** proceed — **#5145 landed-ready**
  (`item-5145` @`39ee4fcc`, `done`, unlanded) and **#5144 claimed-but-unproduced**. The delegate carries rulings; it does
  not choose them. The two research commissions **#5147/#5148** are the operator's to route (D151 bars the delegate).
