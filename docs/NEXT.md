# NEXT.md — current state and next actions

**Last update:** 2026-11-05T03:3xZ (delegate session — the operator's two rulings: **DeepInfra for the verifier**, and
**seat sandboxing is the priority**; D208). Superseded blocks are archived verbatim in `docs/NEXT-ARCHIVE.md` (the
2026-11-05 cut — the two 2026-11-04 CLOCK-OUT logs — is at the tail: `head -227` of the 290-line pre-cut file
`089b8ea00996…` + that block reproduces it).

Host for everything below, measured in the same command as the measurements: **Linux Fedora 44**, kernel
`7.2.14-200.fc44.x86_64`, node v24.22.1, git 2.56.0 (**never sign work with a hostname** — this rig's hostname is
transient and unmeasured labels contaminated D197b–D204, D205).

## NEXT SESSION

**Current item:** the **substrate track** the operator made the priority — ROADMAP **170–174 + 268–273** (queue ids
**4829**, **4833**). `#4829` (`security`, 170's substrate position) is **`claimed` and in flight**; `#4833` (`lead`,
the 171–174 decomposition) is `queued`, `blockedBy #4829`, and is the gate for building anything.

Run this first — it is a **read**, and it tells you whether `#4829` landed its position (do not re-send its brief;
the client timed out at 3600 s but the seat kept working, which is the documented class):

```bash
cd ~/Git/Durian-Pi
git fetch origin && git rev-list --count origin/main..main            # unpushed count — re-measure, never trust this file
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --no-body --id 4829 | head -40
DURIG_DB=./selfdev.sqlite node cli.mjs show 4829 --json | head -60   # the artifact pointer is in the row, not the row state
```

**Then, by what those rows say:** if `#4829` is `done` with an artifact, wake `lead` for **#4833** (the decomposition
of 171–174 **plus** 268–273, in priority order) — the brief I prepared is `.spike/delegate-20261105/brief-lead-1.md`
(already sent once as `d20261105-lead`, which settled and produced **#5125–#5130**; do not re-send that body — the
10-second duplicate-intent class, #4075). A settling `send` costs 20–50 min.

**History:** superseded blocks move VERBATIM to `docs/NEXT-ARCHIVE.md`; this file is a pointer with a **cap 200**
lines, gated by `demo/next-pointer.test.mjs` (0.3 s) — cut before you add.

**Blocker:** nothing is blocked on the rig; **two things are blocked on the operator** — (1) the **push grant**
(**the operator pushed through `6e23742a` at 2026-11-05T02:54:58Z** — `git reflog show origin/main` says `update by
push`, `git ls-remote origin main` confirms the remote is at `6e23742a`; the delegate pushed nothing. Re-measure
`git rev-list --count origin/main..main` — **1** at the time of writing), and (2) **the verifier arming spend decision**: arming `openai/gpt-oss-120b` on DeepInfra is metered, so
an arm gate needs `DURIG_PROBE_CEILING_USD` — a dollar ceiling only the operator sets. `DURIG_VERIFIER_BASE_URL` is
deliberately **unchanged** (`http://127.0.0.1:1234/v1`), so **nothing is armed** and no seat's model state moved.

## Sandboxing the team (the operator's priority, ruled 2026-11-05) — what is and is not on the roadmap

- **Already there:** ROADMAP **60**, **118**, **132**, **170–174** (D130), milestone **M5** (D141), the landed report
  `docs/reviews/zero-trust-zero-agent-research.md`, rows **#4827/#4828/#4829/#4831** (`security`) and **#4833**
  (`lead`). **Do not open a sixth parallel track** — extend 170–174.
- **Added this session, ROADMAP 268–273:** **268** seat egress is unmediated (re-points the parked **118**);
  **269** the flexible permissioning the operator asked for — seat asks, a **verifier adjudicates against project
  policy and the task**, the grant is **raised with a scope+expiry and revoked**, fail-closed; **270** enforce the
  operator's practice that rig-specific controls ship as **installed extensions**; **271** the pinned prior art is
  unconsumed; **272–273** the two verifier-arming blockers. **Amendment on 174:** "native Windows first"
  contradicts **D131** + the report's own finding that **Landlock** is more achievable on Linux (unprivileged,
  self-imposed at spawn, inherited by children, TCP-port rules since ABI v4).
- **Baseline (measured, not assumed).** Credential hygiene is **already done**: `confinedEnv` forces
  `inheritEnv: false`, re-supplies a 12-name OS allowlist, and "a name that looks like a credential never crosses"
  (`src/confine.mjs:340-353,365,491,686-692`); an unknown conversation gets the **read-only** env, never an
  unconfined one (`src/seattools.mjs:303-311`). So 170–174's baseline paragraph ("a seat's shell has the parent
  provider key") is **false today**. What is missing is **reach**: `grep -c -iE "network|socket|egress"
  src/confine.mjs` → **0**; grants are per-seat, not per-claim with expiry; and refusals leave **no durable
  mediation record**. The guard **is already an extension** (`durig.guard`, `src/seatguard.mjs`, `beforeTool` /
  `afterTool`), but this rig runs `DURIG_EXTENSIONS: null` and no invariant keeps new controls in extensions.
- **Prior art pinned, not reviewed:** `vendor/eval/{sandbox-sdk @ 61cac81b, awesome-agent-sandboxes @ db6ffc0a
  (no LICENSE file — escalation class), agent-governance-toolkit @ a918f763}`. `tools/vendor-pins.mjs --check` →
  **PASS, 17 clones**. The old AGT review cites `cfb44576` (18 days stale) and now carries a **PIN MOVED** note.
- **Next delegation, when 170 lands:** route `docs/reviews/agent-sandbox-substrate-research-prompt.md` (written
  2026-11-05, ~$40 estimate, Linux-primary + Windows parity) — the operator's call, and D151 says the delegate must
  not commission it.

## Verifier on DeepInfra (operator ruling) — armed? **No**, and three measurements say why the naive arm fails

1. **The roster names a model DeepInfra does not serve.** `rig.selfdev.json` →
   `verifier/mistralai/ministral-3-14b-reasoning`; `GET /v1/openai/models` with the operator's key → **HTTP 200, 174
   ids, 0.33 s**, exact-membership **false**, no `/Ministral/i` match. ROADMAP **273**.
2. **A metered class is priced by `DURIG_VERIFIER_PRICE_USD_IN/_OUT`, not by `deepinfra-prices.json`.**
   `declaredPrice` reads `data[].metadata.pricing` (`src/providers/local.mjs:104-121`); that file is
   `{fetchedAt,source,unit,note,rows[]}`, and the resolver pointed at it returns `price: null, priceSource: "none"` →
   `metered-endpoint-unpriced` → **no model row**. ROADMAP **272**.
3. **The priced model is not the gated model.** `DeepSeek-V4-Flash-0731` **failed** the G2 floor (defect 3/8);
   **`openai/gpt-oss-120b` met it** (6/8, worst replicate 4/8) **and** DeepInfra serves it at `0.037/0.17` per Mtok →
   `maxCallExposureUsd $0.001419` vs the `$0.05` call cap, **2,818** maximal turns under the `$4.00` store cap
   (offline probe `.spike/delegate-20261105/verifier-arm-probe.mjs` — **promote it to `tools/`**, `.spike/` is
   gitignored). Independence holds at the model (**author seats are `local/iq3_s`**, cross-vendor) but the
   **credential is the same DeepInfra account** — an explicit named variable, not the silent fallback `lead` refused;
   only the operator can mint a second key.
- **Done, reversibly:** `DURIG_VERIFIER_API_KEY` staged in **`~/.config/durig/env`** (mode 600, outside every git
  tree, value never echoed). Check with `grep -o -E "^[A-Z_]+=" ~/.config/durig/env` (names only) and `ls -l`.
  **Nothing armed**: base URL untouched. `lead` cancelled **#5118** and re-decomposed it as **#5125 / #5126 / #5127
  (held, → `pm`, the operator question) / #5128 (held)**; its cancel note mis-numbers them as #5121/#5122/#5123 and
  #5128 cites #5126 where #5127 is meant — fix on release.
- **A `CONFIG_KEYS` instruction to re-rule:** #5118 asked to register `DURIG_VERIFIER_API_KEY` in `CONFIG_KEYS`;
  `src/config.mjs:120-124` refuses on purpose ("a credential belongs in the environment, never in a file that could
  be committed") and `assertNoSecrets` rejects secret-shaped values in config (`:100-106`). No source was changed.
  Suggested rule: register the **price/ledger** keys, keep the **key** env-only, prove unknown-key refusal.

## pi-durable chain + the two landings (done, verified, do not redo)

- **#5079 → `2690e6ac`** and **#5089 → `bb2a3997`** (then `211e912c`, D207): both merges were predicted with
  `git merge-tree --write-tree` in the **same turn** and the landed `^{tree}` matched; ancestry proven with
  `merge-base --is-ancestor` exit 0. Seatroot mirror `~/Git/durian-dev/seatroot` is meant to stay **level with
  `main`** — re-measure, it drifts.
- **Row state at 2026-11-05T03:2xZ:** `#4829 claimed → security`, `#4833 queued → lead` (blockedBy 4829),
  `#5094 claimed → devtools` (its worktree cleanup **fails**: `refusing to remove worktree
  .../item-5094: junction/symlink detected at undefined/anthropic-ai-sdk` — the `undefined` is a diagnostic defect),
  `#5110–#5124` as `lead` routed them, **#5125/#5126 queued → devtools**, **#5127 held → pm**, **#5128 held →
  devtools**, **#5129 queued → security**, **#5130 queued → scribe**, `#5118 cancelled`. Chain as routed:
  **#5110 → #5113 → #5111 → #5112 → #5116 → #5094 → #5095**, then #5096; arming lands **after stage 1**.
- **Gates:** full suite `node scripts/test.mjs --all --jobs 8 --json` → **254/254** at the merged shas; this session's
  run at `294e1806` was **red on two demos** — `demo/next-pointer.test.mjs` (NEXT.md was 290 lines vs the 200 cap and
  its pointer had no `**Current item:**` / `**Blocker:**` line: **fixed by this file**) and
  `demo/seat-turn-shape.test.mjs`, which hashes the **live** `selfdev.sqlite` before/after a read and therefore
  fails whenever any `send` is in flight (passes alone, exit 0). **Run the suite in a linked worktree, not the live
  tree, and not while a seat is running** (#5065). `check rig.selfdev.json` → **116 findings**
  (`duplicate-item 57, citation-unresolvable 57, verification-without-evidence 1, evidence-tree 1`) — **115 → 116 is
  not from this session**: proven by stashing the three tracked docs I changed and re-running: **116 either way**.
- **Store rail:** `.spike/backups/20261104T1130Z/selfdev.sqlite`, sha256
  `02da60e3a5bbb79a4148cfae6f6cf5d19f1a35ddde73bc4d5239759a2f5be952`, 463,142,912 B; live store **465,063,936 B**,
  `durable_schema v2` (a released pi-durable ≤ 1.3.0 cannot re-open it, so **`sync-pi --unlink` is not a
  rollback**). `lead`'s rule: a fresh backup at **every new-build boundary**. 492 GB free on `/home`.

## Local inference (Strata) — the 401 is fixed; the firewall is the next gate

The server on `127.0.0.1:47831` demands a key, and `src/providers/local.mjs` sent `LOOPBACK_PLACEHOLDER_KEY`, so all
seven `local/iq3_s` seats failed `401`. **Fixed:** key in `~/.config/durig/env` (600, outside the repo), loaded with
`node --env-file="$HOME/.config/durig/env" cli.mjs …`; `~/.pi/agent/models.json` provider `strata` uses
`"apiKey": "!sed -n 's/^DURIG_LOCAL_API_KEY=//p' …"` (a per-request `!command`). Verified: `stopReason:"stop"`;
`cli.mjs config` prints **0** occurrences of the value; `secretFindings: []`. **Never** put a key in
`durig.config.json` — gitignored still means *inside the tree*. LAN share: `0.0.0.0:47832` inference-only, `200`
with a bearer token; **`--permanent --list-ports` lists neither port**, so a `firewall-cmd --reload` or reboot closes
it — `sudo firewall-cmd --permanent --add-port=47832/tcp && sudo firewall-cmd --reload` to keep it. **Trap:** a
same-host test through your own LAN IP passes for any port (own-address traffic loops over `lo`); only
`--query-port`/`--list-all` or a second machine answers a firewall question. `tools/broker-serve.mjs:228` probes
`/v1/models` **without** a credential while `:255` sends one → a working provider reads as `unreachable: HTTP 401`
(#5111).

## State (measured 2026-11-05T02:4x–03:2xZ)

- Store **465,063,936 B**; 12 worktrees (`item-4829` is `security`'s, locked, at `294e1806`); broker **down**
  (deliberately — a new build is not staged); 12 registered seats. Spend caps unchanged: **`0.05 / 0.10 / 4.00`**.
  This session spent **$0.00** (catalog read is zero-inference; the arm probe is offline arithmetic).
- **`tools/channel-preflight.mjs` §7 is wrong on this host and that is a live contradiction to settle, not to
  re-derive:** it prints **"VERDICT: NO SHELL CAN START HERE"** while `tools/broker-serve.mjs --status` prints
  `seat-shell-availability … "bash" CAN start … /usr/bin/bash`, and the store's newest shell evidence (entry
  **#285389**, 2026-11-04T21:05:31Z, `devtools`, `isError=false`) plus `#4829`'s own `bash` tool results refute it.
  **217** owns the host-conditional shell (D131: native Windows *checks*, Linux **enforces**).
- Queue census (`cli.mjs status`): **done 3807 | cancelled 803 | held 336 | queued 124 | claimed 3**; `attention`
  22 lines. `queue` accepts only `--json --id --status --to --no-body` — **`--limit` is not a flag**.

## Watch-list (delegate)

- **Do not wake `qa`** — window **20,110 / 24,576 = 0.818**, and **#5052 / #5055 / #5058** are all `queued` to it.
  `advocate` reports `consumed 244,751` against a 24,576 window (`head.state "behind-boundary"`) while
  `check context-over-window` **passes** — that rule scores *one turn's* moved tokens (`src/checkup.mjs:973-985`);
  quote which measure you mean (pitfall 27). `auditor` is `last_run_failed` (engine 500). `devtools` carries
  `secret_detected` at entry **#284810** — a 40-hex tree sha trips the redactor: **cut shas to 8–12 chars in tool
  output, full form in prose only.**
- **New traps found this session (each cost real time):**
  1. **`import("./tui.mjs")` boots the interactive TUI.** `tui.mjs:106` is a top-level `await mode.run()` with no
     `import.meta.main` guard, so importing it for `openTuiStore` attaches to the tty, waits on stdin, and **hangs**
     (this session lost ~45 min that way; the intended read never ran). Use `cli.mjs queue --json --id …`, or
     `node:sqlite` directly, and **never** import `tui.mjs` from a script.
  2. **A `send` client at `timeout 3600` will be killed while the seat keeps working** — `d20261105-security` exited
     **124** and `#4829` is `claimed`. Re-read the row; never re-send the body.
  3. **`--json` on `cli.mjs queue` returns `items[]` without `title`/body when you pass `--no-body`**; for titles +
     `dependsOn`/`blockedBy`, drop `--no-body` or read the row with `cli.mjs show <id> --json`.
- **Wall-clock savers:** full suite **62–67 s** (`--jobs 6-8`); `check` 0.9 s; portability audit 0.9 s; DeepInfra
  catalog read **0.33 s**; a bounded metered probe round-trip ~4 s. The expensive thing is a `send` (20–50 min) —
  write the **whole** ask into one brief.

## Operator decisions outstanding

1. **Push grant — exercised by you, not me, on 2026-11-05T02:5xZ.** `origin/main` moved `211e912c → 6e23742a`
   (my ROADMAP/pins/research/DECISIONS commits). The delegate ran no `git push`; nothing in my env carries
   `DURIAN_PI_ALLOW_PUSH`. What is still unpushed: measure `git rev-list --count origin/main..main` — **1** at
   `1e75a17b` (the pointer re-cut + the SELFDEV pitfalls block). Under `docs/land.md` the docs landings `lead` routed
   to `devtools` keep queueing behind this same grant.
2. **Verifier arming spend.** Approve the candidate (`openai/gpt-oss-120b` on DeepInfra, $0.001419/call, 2,818 maximal
   turns) **and** set a `DURIG_PROBE_CEILING_USD` so the gate arm is ledgered; or rule a second key for
   account-level independence. Nothing is armed until you do.
3. **The substrate research brief** — `docs/reviews/agent-sandbox-substrate-research-prompt.md` (~$40). Say the word
   and I route it; D151 bars me from commissioning it.
4. **`arjan/awesome-agent-sandboxes` has no license file** — pin-only is allowed, consuming it is not. A licensing
   ruling, if you want that catalogue's contents used rather than its structure.
