# NEXT.md — current state and next actions

**Last update:** 2026-11-05T08:0xZ (delegate session — the operator's four rulings of 2026-11-05: standing verifier spend,
AGPL option (a), **research before design**, push. All four are in **D210**; the verifier grant was exercised and is
**measured** below). The superseded D208-era pointer moved VERBATIM to `docs/NEXT-ARCHIVE.md` (183 lines / 16,036 B, git
blob `2f826aa02a54f453b9139ded5d15c7fa02b04a00` = `git show 1dff8590:docs/NEXT.md`).

Host for everything below, measured in the same command as the measurements: **Linux Fedora 44**, kernel
`7.2.14-200.fc44.x86_64`, node v24.22.1, git 2.56.0 (**never sign work with a hostname** — D205).

## NEXT SESSION

**Current item:** the **substrate track** is **re-gated on external research** by the operator's ruling H — *"we should
have a thorough understanding of the domain before we design a solution for our needs"*. So the design rows
**#4829** (`security`, `claimed`, artifact committed but **unlanded**), **#4833** (`lead`, `queued`, the 171–174
decomposition), and **274–278** do NOT proceed until the two research reports below land and are consumed. The verifier
chain is a separate track and **moved this session**: **#5125 `done`**, **#5131 `done`**, **#5136 still `held`**.

Run this first — reads, then **one** send that carries the ruling `lead` has not yet received:

```bash
cd ~/Git/Durian-Pi
git status --short -- . && git rev-list --count origin/main..main          # 0 at the time of writing
DURIG_DB=./selfdev.sqlite node cli.mjs queue --id 4829 --id 4833 --id 5136 --id 5111 --id 5132 --id 5134
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs | grep -E "^seat |next send"   # 1 s; never send to an AT-RISK seat blind
```

**Then** deliver the operator's rulings to `lead` (it owns the re-gating of #4833 and the retirement of #5127). The
verbatim rulings are in **D210**; the brief that was prepared but NOT sent is
`.spike/delegate-20261105b/brief-lead-1.md` (gitignored — if it is gone, rewrite it from D210). Dispatch **from the seat
root** and **always with the env file** (see Traps):

```bash
cd ~/Git/durian-dev/seatroot && git merge --ff-only main
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite DURIG_NO_SERVE=1 \
  node --env-file="$HOME/.config/durig/env" cli.mjs send lead --body-file <path-to-the-lead-brief>
```

**History:** superseded blocks move VERBATIM to `docs/NEXT-ARCHIVE.md`; this file is a pointer with a **cap 200** lines
(and a ~16.9 KB ceiling imposed by the 20,000 B clock-in digest — `demo/clockin-digest.test.mjs`), gated by
`demo/next-pointer.test.mjs` (0.3 s) — cut before you add.

**Blocker:** nothing is blocked on the rig. **Two things sit with the operator:** (1) **routing the two research
commissions** (D151 bars the delegate; the operator offered to route them — they are the current critical path), and
(2) **the fit of the armed verifier** — #5131 met the G2 floor but recorded **`CLEAN-PASSED 0`** in every replicate
(see *Verifier* below), and whether that model may flip the roster (#5136) is an operator/`lead` call, not a measurement
the rig will answer on its own.

## Operator rulings of 2026-11-05 (full text and receipts in D210)

1. **Standing verifier spend** — *"You can continue spending money on verifiers. I accept your recommendation"* → the
   bounded #5127 terms ($0.15 ceiling, one corpus, k=3, gate before the flip). **Exercised once**, ledgered, closed at
   **$0.0387**. Roster untouched.
2. **AGPL** — *"(a) but we can adopt AGPL if must."* → AGPL prior art stays **read-for-design-only**; adoption permitted
   only if a mechanism is unobtainable otherwise, which is an operator decision (our tree is MIT). Measured:
   **`@anthropic-ai/sandbox-runtime` is Apache-2.0** (npm, versions `0.0.78`–`0.0.81`, repo `anthropics/sandbox-runtime`)
   → **274's licence blocker is closed**; the pin/adopt call is still `security`'s inside 170, and **SRT is not vendored**.
3. **Research before design** — two commissions **READY TO ROUTE** (paths below).
4. **Push granted** — the delegate pushed `main` `6e23742a → 1dff8590` (`ls-remote` confirms, reflog `update by push`).
   Grant is per-ruling; seats still cannot push on their own initiative.

## Research now gates the substrate design

- `docs/reviews/agent-sandbox-substrate-research-prompt.md` — **round 2, amended this session**: the security position's
  measured baseline (the belt-vs-boundary spine, F1–F5), the ten-project intake, the SRT question, the licensing ruling,
  and `lead`'s ask — *"what is the minimal Landlock ruleset that admits git/node/sqlite/vendor-links `/tmp`/loopback
  providers, and what demonstrably remains unmediated after it"*. 12 questions, 14 required sections, quote+URL+fetch-date
  evidence discipline.
- `docs/reviews/agent-fleet-containment-domain-map-research-prompt.md` — **new**: the domain/competitor map (who contains
  agent fleets and at what fidelity; the six control axes — fs, egress, credentials, grant lifecycle, audit, posture;
  settled standards/vocabulary + terminology collisions; a failure catalogue with title-checked receipts; a licence map
  for MIT-compatibility and what AGPL adoption would oblige; the gaps we must fill ourselves).
- **On landing, the delegate does the consumption** (`docs/runbooks/research-request.md` Do 3–5): commit the report
  verbatim, re-fetch cited URLs into `inputs/fetched/` with a manifest, check every quote in our own copy, register or
  explicitly reject each proposed ROADMAP item, add `docs/COMPETITORS.md` rows, cross-link, and write the follow-up
  prompt. Then `lead` releases #4833.

## Verifier (measured this session, not carried forward from the last one)

- **#5125 `done`** → `item-5125` `8160b8be` + `385e3973` (7 files, 462 insertions): price/ledger keys registered in the
  config inventory, a demo that an **unknown key is refused, not ignored**, a demo that the credential surface reports
  only **presence**, and the arming probe **promoted** to `tools/verifier-arm-probe.mjs` + `demo/verifier-arm-probe.test.mjs`.
  **Not on `main` yet** — landing needs a wake (push grant is open).
- **#5131 `done`** — the paid gate arm, run in `item-5131` with `DURIG_PROBE_CEILING_USD=0.15`,
  `DURIG_SPEND_LEDGER=<worktree>/.spike/gate/spend-5131.jsonl`, `DURIG_PROBE_PRICE_USD_IN=0.037/_OUT=0.17`,
  `--whole-module --budget 120000 --replicate 3`. **72 accounted calls, $0.0387 of the $0.15 ceiling**, ~$0.0009/call,
  `priceSource: "env"`, `authKeyEnv` named never valued. **Defect named 6/7 in all three replicates → G2 floor MET**
  (bar ≥ 4/7; the earlier recorded arm was 6/8). **But**: `clean, leading prompt FALSE-ALARM 7–8/8, CLEAN-PASSED 0` and
  `clean, neutral FALSE-ALARM 7–8/8` in **every** replicate — on this corpus the model never passes a clean control.
  Historical context: the old scorer census was 502 FALSE-ALARM / 0 CLEAN-PASSED and the `assertscan.mjs` fix moved it to
  460/21/5 **on saved transcripts**; this is a fresh arm, so it is about the model, not the old scorer.
  **Open, and load-bearing for 269 (G7 — "adjudicator armed first") and for #5136: is a `CLEAN-PASSED 0` verifier fit to
  adjudicate a capability grant, or to be the roster?** Close it by ruling, not by re-running the same corpus.
- **Nothing is armed.** `DURIG_VERIFIER_BASE_URL` is still `http://127.0.0.1:1234/v1`, measured **ECONNREFUSED** on both
  `/v1/models` and `/chat/completions` → `qa qa2 advocate auditor designer` cannot take a turn at all. **#5136 `held`**
  behind #5125 + #5131 + **#5095** (stage 1, `deferred`): arm early, flip late, so #5096 lands under a working verifier.
- **Independence:** cross-family/cross-vendor (`local/iq3_s` authors vs `openai/gpt-oss-120b` on DeepInfra), **same
  account** — `lead` declined a second key and the operator did not overturn it. Key stays at `~/.config/durig/env`
  (mode 600, out of tree; check with `grep -o -E "^[A-Z_]+=" ~/.config/durig/env`, names only).

## Substrate state (what exists, and what is provisional)

- **#4829 `claimed` → `security`.** Its deliverable is committed but **unlanded**: `item-4829 96f810f1`,
  `docs/reviews/security-seat-sandbox-position.md`, 360 lines — a measured baseline table (egress, sibling-worktree
  `rm -rf`, `git config --global …`, lifecycle scripts all **ALLOW**; the write-target resolver returns
  `targets:[] unresolved:[]` for them), findings F1–F7, gates G1–G10, and the position's spine: **the boundary is the
  spawn seam of every seat-initiated child**. The row was never closed (its generating turn ended `aborted` at
  04:42:04Z, then a 401 at 05:37:26Z). Per ruling H it is **provisional** until the reports are consumed.
- **#4833 `queued` → `lead`**, blockedBy #4829 — re-gate it on the reports; do not mint the 171–174 rows before.
- **#5111 `claimed` → `devtools`** (the credential-less health probe): a `demo/broker-serve-provider-auth.test.mjs` was
  passing in its worktree at the time of writing (`OK (3 listing hits, 2 completion hits, 3 carrying the credential)`).
  **The defect is real and reproduced**: `node --env-file=… tools/broker-serve.mjs --status` prints `local: completes
  (finish=stop, 57 tok/28 tok)` **and** `BLOCK provider-DURIG_LOCAL_-unreachable … HTTP 401` in the same run.
- **#5132 / #5134 `queued` → `devtools`**; **#5133 → `security`**. `tools/channel-preflight.mjs` §7 still prints
  "NO SHELL CAN START HERE" on a host where `broker-serve --status` prints `"bash" CAN start — /usr/bin/bash`.

## State (measured 2026-11-05T05:2x–08:0xZ)

Store `./selfdev.sqlite`; census **done 3812 | cancelled 809 | held 342 | queued 154 | deferred 16 | claimed 3** (re-read
— it drifts). Worktrees: the operator checkout holds `item-4829/4937/4967/4997/5083/5090/5094`, the seat root holds
`item-4955/4970/5079` plus this session's `item-5125` and `item-5131` (both under `~/Git/durian-dev/seatroot`, correct
placement). Broker **down** (no broker state). Spend caps `0.05 / 0.10 / 4.00`; **this session's spend $0.0387**, all of
it #5131, ledgered by the seat that ran it. Gates run here: `doc-integrity-guard` **0 hard / 1 soft**, `instrument-provenance`
**clean (2 soft cite drifts)**, `review-cite-check --gate` **205 failing / 336 not failing** — a pre-existing baseline,
and **zero findings name the two new prompt files**.

## Traps this session found (each cost real time — they belong in `docs/SELFDEV.md` too)

1. **A `send` without `--env-file` fails the local provider and takes another seat with it.** `node cli.mjs send devtools
   …` (no env file) → submission **#285670** `unanswered / model_error: 401 "Invalid API key"`, zero tokens, **and the same
   wake pass killed `security`** (entry **#285672**). Then `cli.mjs resume` printed **`{"found":0}`** — an
   `unanswered/model_error` submission is *not* `admitted_not_started`, so **`resume` does not repair it**; the fix is a
   corrected re-send, diagnosed from `submissions.detail` (§2c of `session-start-cost.md`).
2. **`show <id>` takes no `--json`** — it errors into the `queue` usage block. Use `queue --id <id> [--id …]`.
3. **Two `send`s at once is a two-writer hazard** — never dispatch a second seat while a `send` harness owns the store.
   That is why `lead` was left unwoken and this handoff exists.
4. **Noise that is not a finding:** every CLI start prints
   `{"spend":"catalog-refused","model":"google/gemini-3.1-pro",… maxCallExposureUsd 14 … capUsd 4}` — that is the
   **vendored DeepInfra catalog** being priced (`src/providers/deepinfra-models.ts`), D201 working; and
   `broker-serve --status`'s `NOTE stranded-intent: 2` are `{"op":"read","view":"health","from":"cli"}` files left by
   `cli.mjs status` (§5b); and `lead`'s `secret_detected` at entry **#285629** (`pi.compaction` content) is the 40-hex
   redactor class (#4922), not a leak.

## Watch-list (delegate)

- **AT RISK** (`seat-turn-shape`, projection ends on `user`): `scribe security advocate auditor designer qa2` — do not
  re-send blind; `security` may need a `reset` with a handoff to close #4829. ADMISSIBLE: `devtools lead pm impl
  architect qa` (re-measure first).
- `qa` window 20,110 / 24,576 = **0.818**; the verifier-band problem (§14 of `session-start-cost.md`) is unfixed —
  `DURIG_VERIFIER_CONTEXT 24576 − 16384 = 8,192`, so any verifier seat above 8,192 consumed cannot take a turn without a
  compaction that cannot succeed at 3,000 summary tokens. **This must be settled before #5136 flips the roster**, or the
  same failure walks over to DeepInfra.
- **Probes worth keeping are already in `tools/`**: `tools/verifier-arm-probe.mjs` (offline; prints the resolved spec,
  the price **and its source**, and `maxCallExposureUsd` against the three caps; never a credential). Promoted by #5125 —
  the old `.spike/` copy is gone by design.
- **Next delegation, when the reports land:** `lead` re-gates #4833 and rules whether the **cheap belts** (the position's
  G10 — refuse `git config --global/--system`, value-level `looksLikeSecret` in `pickEnv`, push unresolved mutating
  forms into the existing "NOT checked" surface) proceed now. The delegate carries the ruling; it does not choose it.
