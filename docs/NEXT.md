# NEXT.md — current state and next actions

**Last update:** 2026-11-05T20:4xZ (delegate session C closes. Two things moved this session: the **verifier chain landed and
is proven on trunk** (**D211**), and the operator issued a **standing architecture ruling** — customization goes on the
extension plane, and durian-pi ships as **two minimum products** (**D212**, `docs/ROADMAP.md` **279–280**). The
delivery-channel "blocker" from the previous pointer was **half false and is corrected below**; the real remaining blocker is
**verifier capacity**.) The superseded pointer moved VERBATIM to `docs/NEXT-ARCHIVE.md`.

Host for everything below, measured in the same command as the measurements: **Linux Fedora 45**, kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 (**never sign work with a hostname** — D205).

## NEXT SESSION

**Current item: the operator's architecture ruling (D212) — define and enforce the two minimum products.** Registered as
`docs/ROADMAP.md` **279** (product definitions + names) and **280** (the test matrix that enforces them). Ruling, 2026-11-05:
**any customization to durian-pi is served as an extension, never built into the base**; there is a **minimum coding agent
on `pi-durable` that runs fine with zero extensions** (proposed name **`durian-core`**, derived from the family convention —
`pi-agent-core`/`pi-coding-agent` — and D103's `<name>-pi` shape; **the operator ratifies names**); and **durian-pi** is the
second minimum product, **a team of specialized agents that cooperate**. Whether the team shares **one base-agent instance**
or each member has **its own instance and its own SQLite store** is **research-gated, not design-gated**: the prompt is
written and waiting for the operator to route it (`docs/reviews/base-agent-product-topology-research-prompt.md`). Our rig's
current shape, measured: **many processes, one store** — 12 seat processes, one broker, one `./selfdev.sqlite`. `lead` has
the brief and owns decomposition; the delegate filed the two roadmap rows because `docs/runbooks/research-request.md` Do 3
assigns registration to the delegate, and filed no queue rows.

**Corrected blocker: the delivery channel is working; it was never doubly blocked.** A broker start is allowed and the
blessed path is `node intent.mjs <seat> --body-file <file>` (`send` is deprecated — it opens a second writing harness). The
`{"spend":"catalog-refused","model":"google/gemini-3.1-pro",…,"maxCallExposureUsd":14}` line **fires on every `cli.mjs`
verb, including `reset --dry-run`, and is the DeepInfra catalog dropping one over-exposed row from the registered set
(`src/providers/deepinfra-models.ts:146`, policy applied per row at `:166-177`) — it is not a verdict on the invocation, and
last session's sentence "send is now blocked on this rig" was **false**: `DURIG_MODEL` is `zai-org/GLM-5.3-Flash`, a dated
priced row that passes the guard. What really is refused is **naming a local id in the metered catalog**
(`{"spend":"model-unpriced","provider":"deepinfra",…}`) — and that is correct, because the local class is priced *by
locality*, never by a catalog row (`src/providers/local.mjs:150-190`: "free by locality, or priced by declaration — never
free by silence"). The real remaining block is **verifier capacity**, below.

**Blocker:** the **verifier provider is temporarily lifted** (`6d2c50e2` removed `DURIG_VERIFIER_BASE_URL` from both host
config files and re-pointed the 5 verifier seats at `local/qwen3.8-flash-next-iq3_s`), so `check` reports `single-model-rig`
and `verification-without-evidence` as `fix-now` — honest and intended, but the author/verifier cross-family invariant
cannot hold until either the `:1234` model server is up (it answers ECONNREFUSED; the box has no GPU/RAM room: RTX A4000
14637/16376 MiB, RTX 3090 23098/24576 MiB, Strata host holding 21852 MiB of the 3090) or the **metered** arm is approved
(`tools/verifier-arm-probe.mjs` says `ARMABLE`, `maxCallExposureUsd 0.001419`). Restoring needs **both** an operator
capacity grant (`docs/runbooks/verifier-model-server.md` — seats idle first) **and** `git revert 6d2c50e2`.


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


**Hand these to `lead` (done — brief delivered via the broker 2026-11-05T20:3xZ, and a follow-up at 21:2xZ; `.spike/` is gitignored, rewrite from D212
if the files are gone):** (1) the **model-id drift** — every tracked fixture still names `local/iq3_s`: re-cited from a grep
run today, `src/providers/local.mjs:10`, `tools/model-probes/corpus.mjs:257`, `tools/model-probes/cold-prefill.mjs:29`,
`tools/model-probes/stream-probe.mjs:71`, `tools/model-probes/throughput.mjs:74-75`, `demo/deepinfra-catalog.test.mjs:122`, `demo/local-provider.test.mjs:166`,
`demo/probe-metered-ledger.test.mjs:140`, `durig.config.default.json` (the `"local/iq3_s"` compaction-override key, which
silently stops matching when the id moves and reverts `reserveTokens` 20480 → 16384), and `docs/ROADMAP.md:82, 3319, 3334,
3817`; **two of those probes also name the dead endpoint** `http://127.0.0.1:47831/v1`
(`tools/model-probes/stream-probe.mjs:71`, `tools/model-probes/throughput.mjs:75`) — nothing answers it since the move to `:8080`, which is the
`docs/runbooks/hygiene-and-dead-model-pointers.md` class. One server-side alias (`iq3_s` on `:8080`) fixes both halves for
free and keeps every fixture truthful; that alias is an **operator/server** action. (2) **`package.json` still reads `"name":
"durig"`**, so D103's acceptance (`git grep -i durig` → only deliberate alias sites) is unmet — `pm` should close that
remainder **before** any new rename stacks a third prefix. (3) the **citation-integrity instrument**: a retracted pitfall in
D211 cited three paths that do not exist in this repo, so every `path:line` token a commit *adds* should be checked against
the filesystem — the probe is `.spike/delegate-20261105c/cite-audit.mjs` (gitignored; **promote it to `tools/` or it dies**),
and the existing instrument to extend rather than duplicate is `src/citation.mjs` (ROADMAP 190, sha citations, proven by
`demo/checkup-citation.test.mjs`).

**Rows the team created since (all `lead`/`impl`-owned — the delegate filed none):** **#5155** `impl → qa` *"verify request:
the git guard states what it checked — config scope refused + NOT-checked census"* and **#5156** `impl → lead` *"DONE #5145 …
ROW 1/2 DONE, NOT YET LANDED"* — **both `deferred`**, unverified, unlanded. **#5144 has moved `claimed → deferred`**: the seat
parked it rather than producing a branch. Artifact for #5145 as the seat attests: branch `item-5145`, tip **`39ee4fcc`** (2
commits, 5 files, +806/−1), `merge-tree main item-5145` exit 0, `rev-list --left-right --count main...item-5145` = `0 2`,
`what-to-test --base=main` ok:true / 25 derived tests / 0 scanFindings.

**History:** superseded blocks move VERBATIM to `docs/NEXT-ARCHIVE.md`; this file is a pointer with a **cap 200** lines
(and a ~16.9 KB ceiling imposed by the 20,000 B clock-in digest — `demo/clockin-digest.test.mjs`), gated by
`demo/next-pointer.test.mjs` (0.3 s) — cut before you add.
 this file is a pointer with a **cap 200** lines
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
## State (measured 2026-11-05T21:3xZ, Linux Fedora 45 / kernel `7.2.15-300.fc45.x86_64` / node v24.22.1 / git 2.56.0 — hostname-free probe: `uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v`)

`main` @`3283806d` (roadmap 281 + the hostname-free probe) on top of the landings, **15 ahead of `refs/remotes/origin/main`, 0 pushed** (this pointer's own docs commits move that number — re-measure, do not carry it) (the operator's push
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
**There is no `tools/deepinfra-catalog.mjs` in this tree** — that sentence in the previous pointer was false, and the audit
that caught it is in D211. The real pins: `src/providers/deepinfra-prices.json` carries `fetchedAt` **2026-11-03** and **16
rows**; a live fetch of `https://api.deepinfra.com/v1/openai/models` returned **174** models today.
Queue histogram: total **5156**, `done 3816, cancelled 812, held 345, queued 162, deferred 183, claimed 5` — `deferred`
jumped **16 → 183** across the broker's first wake pass (all 10 seats woke on a local model), which is worth a `pm` look
before anyone reads a rising `deferred` count as progress. Broker **up** (`--start --max-duration 900 --yes-pm-wakes`,
`--dry-run` said `A start would be allowed` with 0 blocking, 4 noted).

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
