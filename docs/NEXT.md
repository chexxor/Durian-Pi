# NEXT.md — current state and next actions

**Last update:** 2026-11-04T09:3xZ (delegate session — the operator's four rulings executed, `#5079` landed as
`#5083`). Superseded blocks are archived verbatim in `docs/NEXT-ARCHIVE.md` (the cut above D205 is at the tail).

Host for everything below, measured in the same command as the measurements: **Linux `Alex-Desktop-Win10`**
(transient hostname; `StaticHostname`/`PrettyHostname` **unset**, `/etc/hostname` empty — do NOT sign work
`ThinkStation-P3`, that label appears in D197b–D204 and was never measured, D205), Fedora 44, kernel
`7.2.14-200.fc44.x86_64`, node v24.22.1, git 2.56.0.

## NEXT SESSION

**Current priority: close the #5083 row, then hand `lead` the three mints the operator's rulings created.**
The git half of the landing is DONE (see "The landing" below) — do not re-merge anything.

1. **Complete `#5083`** (queue id **5083**, `queued` → addressed to `devtools`; the delegate never completes
   rows). The receipt the seat needs is already written:

   ```bash
   cd ~/Git/Durian-Pi
   timeout 3600 node cli.mjs send devtools --body-file .spike/delegate-20261104b/brief-devtools-6.md \
     --request-id d013-devtools --no-stream > .spike/delegate-20261104b/send-devtools-6.out 2>&1
   ```

   A `send` that settles costs 20–50 min of wall clock. **If your send client is killed, the seat keeps
   working** — re-read the row (`node cli.mjs queue --json --id 5083`) before re-sending, and never re-send a
   body you already sent (the 10-second duplicate-intent retry class, #4075).

2. **Then dispatch `lead`** (brief already written, `.spike/delegate-20261104b/brief-lead-3.md`; it says
   `main = 7567a0ff`, which is two commits stale — say so in the send, the rest of its facts were re-measured
   this session):

   ```bash
   timeout 3600 node cli.mjs send lead --body-file .spike/delegate-20261104b/brief-lead-3.md \
     --request-id d012-lead --no-stream > .spike/delegate-20261104b/send-lead-3.out 2>&1
   ```

   It asks `lead` to mint: **(a)** the spend-ledger scoping row (default derived from `DURIG_DB`, register
   `DURIG_SPEND_LEDGER` in `CONFIG_KEYS`, demo, re-run acceptance probe `P6b`); **(b)** the verifier-class row
   (price + `DURIG_VERIFIER_API_KEY` + the 5 roster `model` lines applied with `up`) or a ruling on a
   same-vendor key fallback at the credential seam; **(c)** whether **#5080** waits for an `impl` context reset.
   `lead` also owes answers on **#5003** (pm parked) and **#4970** (architect parked with **no target recorded**).
   Add one ask when you send it: **promote the behaviour-gate probe
   `.spike/delegate-20261104b/gate2.mjs` into `tools/`** — it is the reusable form of the store gate (exit code +
   named cause + store file **absent** after, not zero-byte), and `.spike/` is gitignored, so it is lost next
   session otherwise.

3. **Ask the operator one question: push or not.** `main` is **~7 ahead of `origin/main`, unpushed** — the
   landing merge `2690e6ac`, the three `item-4955` commits it carries, and the docs commits on top. Measure it
   rather than trusting this number: `git rev-list --count origin/main..main`. The delegate does not hold that
   grant (AGENTS.md; D204).

## The landing (done, verified, do not redo)

- **`#5079` `done`** (devtools, 08:45:05Z): re-cut of `item-4955` onto current trunk, artifact **`89f2b975`** —
  **not** `d1c6d8a6`, and note `f5bda0db` was the pre-amend sha of the same tree (the seat amended a wrong
  "255/255" claim out of its own merge message; an amend mints a sha, so **re-measure in the same turn you
  land**, and key on the sha the row reports).
- **`#5083` executed by the delegate:** `git merge --no-ff 89f2b975` → merge commit **`2690e6ac`**, tree
  `20c25a5277a149fe6b2cc56f49a2307e7abe81af`, **identical to the `merge-tree --write-tree` prediction** taken in
  the same turn (exit 0). `git merge-base --is-ancestor d1c6d8a6 main` → **0**, so the **false-landing condition
  that made #4955 unsatisfiable is repaired**. Seatroot mirror `seatroot/linux` fast-forwarded
  (`git -C …/seatroot merge --ff-only main`) → **level with `main` at clock-out** (re-measure with
  `git -C ~/Git/durian-dev/seatroot rev-parse --short HEAD`). **Measure `git rev-parse --short main`** rather than
  trusting this pointer — a pointer that cites its own tip goes stale the instant it is committed.
- **Gates the delegate ran itself at the merged sha, not read from the seat:** full suite
  `node scripts/test.mjs --all --jobs 8 --json` → **254/254, `failed:[] timedOut:[]`**, 62.8 s; behaviour gate
  `DURIG_DB=/tmp/delegate-1104c/no-store-gate.sqlite` → `status`/`queue`/`ps`/`show 1` **exit 1, `cause
  "no_store"`, absolute `db`, store+`-wal`+`-shm` ABSENT after** (probe `.spike/delegate-20261104b/gate2.mjs`);
  `check` → **103 findings** (`duplicate-item 57, citation-unresolvable 44, verification-without-evidence 1,
  evidence-tree 1`), `context-over-window`/`no-verifier-seat`/`single-model-rig` **pass**, 5 rules `skipped`.
- **W2's non-author verifier review was UNAVAILABLE and that gap is now on the record**: no reachable verifier
  model (`:1234` answers nothing; the granted class needs price + credential + roster — D205). Landing was
  therefore made on the delegate's own re-run of the seat's gates, with the artifact sha and ancestry proven.

## pi-durable update chain (OPEN — this is the priority now)

The operator ordered a **proper** update: identify what upstream changed, what it breaks, and accommodate the useful
parts. The research is done and tracked (**`docs/PI-UPGRADE-DELTA-2026-11-04.md`**, D206); the **team** holds the
build/link/migration rows. State at 2026-11-04T13:1xZ (`DURIG_DB=./selfdev.sqlite`):

| row | what | status |
|---|---|---|
| **#5089** | `docs/runbooks/pi-pin-update.md` — the pin-move procedure | **done, NOT landed** (branch `item-5089` = `314ad20d`: runbook 230 lines + README index; `merge-tree main 314ad20d` exit 0, 0 conflicts) |
| **#5090** | promote the store-behaviour gate into `tools/` | **done, NOT landed** (branch `item-5090` = `4c92d550`: `tools/store-behaviour-gate.mjs` + `demo/store-behaviour-gate.test.mjs` + area registration) |
| **#5094** | make the pin a **tag** and drift a **finding** | queued → devtools |
| **#5095 / #5096** | stage 1 pin `v1.4.0`; stage 2 pin `v1.5.0` + symbol migration | queued → devtools |
| **#5083** | the landing **receipt** row | claimed → devtools |

**Delegate-verified #5090 independently** (extracted both files into the checkout, ran them against current `main`'s
CLI, then removed them — `git status` clean): `node demo/store-behaviour-gate.test.mjs` → **exit 0**, and it asserts
**both directions** — the gate passes on the product's real refusal (4 verbs, `cause:no_store`, absolute `db`, target
`-wal`/`-shm` absent after) **and** refuses a live-store name / in-tree path / existing file with named causes
(`gate_target_refused`, `gate_target_exists`), and it has teeth (a fixture that *manufactures* a rig fails the gate
naming it). Running the tool directly: `--target /tmp/delegate-verify-gate/absent.sqlite` → `ok:true, failures:[]`;
`--target selfdev.sqlite` → `ok:false, cause:"gate_target_refused"` and the live store untouched
(463,835,136 B — it has grown since the 11:30Z backup baseline of 463,142,912 B, which is the baseline the runbook
step 1 records for any `checkpointWhen` growth report).

**Rail for whoever moves the pin: the store is backed up** at `.spike/backups/20261104T1130Z/selfdev.sqlite`,
sha256 `02da60e3a5bbb79a4148cfae6f6cf5d19f1a35ddde73bc4d5239759a2f5be952`, byte-identical at copy time, taken with the
broker down. The live store is at `durable_schema = {singleton:1, version:2}` and released pi-durable ≤ 1.3.0 cannot
re-open it, so **`sync-pi --unlink` is not a rollback**; the backup is the only one. Do **not** mint further backups
without lead's ruling.

**Open landing question (operator or lead):** #5089 (docs-only) and #5090 (tools + demo) are complete but unlanded,
and the next stages (#5094-#5096) depend on the runbook being in the tree. `docs/land.md` permits the delegate to land
a docs-only item only when `main == origin/main`, and `main` is **ahead of `origin/main`** right now — so either the
operator pushes first, or lead lands them. See the operator-decision block below.

## Local inference (Strata) — the 401 is FIXED, and the firewall is the next gate (measured 2026-11-04T12:1x–12:4xZ)

**The break:** the Strata server on `127.0.0.1:47831` now **demands an API key**; `src/providers/local.mjs` sends
`LOOPBACK_PLACEHOLDER_KEY` (`"no-key-required"`) when `DURIG_LOCAL_API_KEY` does not resolve, so all **seven**
`local/iq3_s` seats (`pm impl lead scribe devtools security architect`) failed `model_error: 401 "Invalid API key"`.
A `send devtools` (`d014-devtools`) came back **unanswered with zero tokens** and read like a model fault. The
registration path does **not** refuse (loopback needs no key by design), so `check`/`config`/port probes stay green
while every run fails.

**The fix (done, verified, no secret in the tree):** key in **`~/.config/durig/env`, mode 600, outside the repo**;
load it with `node --env-file="$HOME/.config/durig/env" cli.mjs serve` — and every `send`/`run`/`broker-serve`
that opens a harness. Verified: the provider's own path answered `stopReason:"stop"` (59 in / 36 out, cost 0 by
locality); `cli.mjs config` prints **0** occurrences of the value; `status.secretFindings` `[]`; and
`send devtools d015` is **running** and executing tools. **Never** put the key in `durig.config.json`: gitignored
still means *inside the tree*.

**The harness (this pi instance) reaches the same server.** `~/.pi/agent/models.json` provider `strata` now carries
`"apiKey": "!sed -n 's/^DURIG_LOCAL_API_KEY=//p' \"$HOME/.config/durig/env\""` (a `!command`, evaluated per
request, uncached) instead of the literal `"local"` that caused the same 401. Verified with the variable **unset**:
`pi --print --provider strata --model iq3_s` → `PI-STRATA-OK`.

**LAN access — what is true right now:** the app's own **inference-only share listener is UP** on
`0.0.0.0:47832` (`/v1/models` `401` without a bearer token, `200` with; serves only `/v1/models`,
`/v1/chat/completions`, `/v1/messages`, never the UI). The host server stays loopback-only on `47831`. **A remote
machine is now working (operator, 12:5xZ)** — the share port is open: runtime now lists
`47832/tcp 47832/udp`, `--query-port=47832/tcp` → **yes**. Firewall state: firewalld active, zone `public` on
`enp39s0`, services `dhcpv6-client mdns ssh`.
**Still one-way:** `--permanent --list-ports` lists neither `47832` nor `47831`, so **a `firewall-cmd --reload` or a
reboot silently closes the LAN path again** — `sudo firewall-cmd --permanent --add-port=47832/tcp && sudo
firewall-cmd --reload` if the remote setup is meant to survive. (The `47831/tcp` runtime allowance I measured at
12:2xZ was gone by 12:4xZ; firewalld's runtime view on this box moves under the app, so re-query before trusting
any port claim.) **Trap, measured:** a same-host test through your own
LAN IP passes even for a port in no allow list (`0.0.0.0:39999` → `HTTP 200`) because own-address traffic loops back
over `lo` — only `--query-port`/`--list-all` or a second machine answers a firewall question.

**Also found while verifying (a row for `lead` to mint, delegate did not edit it):**
`tools/broker-serve.mjs:228` fetches `/v1/models` with **no auth header**, while its completion probe at `:255` does
send one. On a key-protected loopback server that yields `BLOCK provider-DURIG_LOCAL_-unreachable: … HTTP 401` for a
provider that works — the preflight now lies in the safe-looking direction. One-line fix: send
`authorization: Bearer ${process.env[s.apiKeyEnv]}` on the models probe too, and treat `401/403` as *reachable but
unauthorized* naming the variable.

## State (measured 2026-11-04T09:1x–09:2xZ)

- `main` = the docs commits on top of the landing merge **`2690e6ac`** (measure it), working tree clean, **ahead
  of `origin/main` — unpushed.** 8 worktrees, 6 `item-*` branches, 9 head refs.
- **Two branches are now fully merged and still cannot be pruned:** `item-5079` (devtools' persisted cwd names
  it) and `item-4955` (**impl**'s cwd names it). **Re-point, then prune** — `tools/rig-portability-audit.mjs`
  (0.9 s, read-only, **exit 1** with `seat-host-unaware`, ROADMAP 217) prints the seat→root map in its `note:`
  lines. SELFDEV pitfall 24.
- Broker **down** (`{"state":"down","reason":"no broker state"}`), `paused: false`; 2 read intents have been
  spooled ~7,400 min and `resume` withholds them — they were routed to `lead` in the brief instead of run blind.
- Queue census: **done 3807 | cancelled 803 | held 336 | queued 124 | deferred 15 | claimed 3**. `queue` accepts
  only `--json --id --status --to --no-body` — **`--limit` is not a flag** (it errors; the driving skill still
  shows it, worth fixing there).
- Spend plane (armed, operator-ruled): caps **`0.05 / 0.10 / 4.00`** unchanged; `DURIG_SPEND_LEDGER` is now an
  **absolute store-scoped path in both gitignored private configs** (`durig.config.json`,
  `durian-dev/seatroot/durig.config.json`) — but it is **not in `CONFIG_KEYS`**, and `tools/model-probes/*` still
  call `meteredChat({env: process.env})`, so probes write a **cwd-relative** ledger. That gap is mint (a) above.
  This session spent **$0.000002** (one bounded metered probe, ledgered at `.spike/gate/spend.jsonl`).
- Verifier class **granted, NOT armed**: `deepseek-ai/DeepSeek-V4-Flash-0731` @ 24,576 → `maxCallExposureUsd
  $0.002015` (< the $0.05 call cap), **1,985** maximal turns before the $4 store cap. The provider reads
  **`DURIG_VERIFIER_API_KEY` only** — `DEEPINFRA_API_KEY` is present and works (HTTP 200, 12/5 tokens) but only
  on the probe path. **Operator action, not delegate action:** export `DURIG_VERIFIER_API_KEY` in the shell that
  starts the broker, or let `lead` rule a same-vendor fallback.
- `google/gemini-3.1-pro`'s stderr refusal on every catalog build is **ruled state** — `over-exposed`, $14.00 =
  3.50× the store cap, corroborated against the keyless vendor catalog (2/12 per Mtok). **Not a red; do not
  spend a turn on it.**

## Watch-list (delegate)

- **qa is at 20,110 / 24,576 = 0.818** and **#5052 / #5055 / #5058 are all `queued` to qa** — three rows will not
  fit that window. They also sit behind a verifier endpoint that answers nothing. Do not wake qa until either
  the window or the endpoint changes.
- **`advocate` reports `consumed 244,751` against a 24,576 window, `head.state "behind-boundary"`** — and
  `check`'s `context-over-window` is **pass**, because that rule scores *one turn's moved tokens* vs the seat's
  own window (`src/checkup.mjs:973-985`), not cumulative consumption. Quote which measure you mean (SELFDEV
  pitfall 27). `impl` 162,174/200,000 = 0.811, also `behind-boundary`.
- `auditor` **`last_run_failed`** — `Engine protocol predict request returned 500` (the local verifier engine).
  `devtools` carries **`secret_detected`** at store entry **#284810**: a 40-hex tree sha in a tool result trips
  the redactor (`[redacted by durian-pi: secret-shaped value (high-entropy-token)]`), which hid the artifact id
  from both seats and me — cut shas to 8–12 chars in tool output, quote the full form in prose only.
- `attention` = 18 lines, incl. **`queue-ageing 7,468.8 min` (band 30)** and `step-repetition 1% (1/104)`.
  pm is parked on **#5003** waiting on `lead`; **architect's #4970 has NO TARGET recorded**.
- **Wall-clock savers:** the full suite is **62 s** at `--jobs 8` (not 4+ min); `check` is 0.9 s; the portability
  audit is 0.9 s; a bounded `meteredChat` probe round-trip is ~4 s. The expensive thing is a `send` (20–50 min) —
  so write the *whole* ask into one brief, as the three briefs in `.spike/delegate-20261104b/` do.

## Operator decisions outstanding

1. **Push, and then who lands #5089 / #5090** — `main` is **6 ahead** of `origin/main` (docs only: D206, the
   pi-delta doc, the entry-point change, the runbook's state 5 + firewall section, the pitfalls, the pointer). The
   delegate will not push without your grant. Both completed pi rows are **unlanded**, and #5094–#5096 need the
   runbook in the tree, so the choice is: (a) you push, then the delegate lands the docs-only #5089 under
   `docs/land.md` (its delegate clause requires `main == origin/main`, which a push restores) and lead lands #5090
   with a gate run at the merged sha; or (b) lead lands both. Recommend (a): it is one push and it unblocks the pin
   chain without stretching the landing rule.
2. **`DURIG_VERIFIER_API_KEY`** — export it where the broker starts, so `lead`'s roster row can arm the verifier
   class and W2's non-author review becomes real. Ruled 2026-11-04: **no same-vendor fallback** — the fallback chain
   dies on `DEEPINFRA_API_KEY`, which is the producer's vendor, so a verifier that uses it is not independent.
   Arming is three layers at once (price declaration, the key, and the 5 `model` lines in `rig.selfdev.json`), which
   is why it is a row and not a paste.
3. **The box's hostname** — the *project* rule is settled (no hostnames; sign OS+distro+kernel+node) and the code has
   no host-identity dependence. What is left is whether to fix the **machine** (it reads transient `Alex-Desktop-Win10`
   with no static hostname) or let **#5085** (`scribe`) re-sign the ~20 historical lines. Recommend leaving the box
   alone and letting #5085 run: the record is what misleads.
4. **Store backups** — one pre-pin backup exists (`.spike/backups/20261104T1130Z/`, sha256 in the pi section). The
   store is ~442 MiB and growing. Whether a **second** backup is taken at the `v1.4.0` boundary is **lead's** call; the
   delegate will not mint more without a ruling.

## CLOCK-OUT — 2026-11-04 afternoon delegate session (pi-delta research → local-provider 401 → firewall)

**Value delivered, each line an instrument read.**
- **pi-durable update researched, not guessed:** `docs/PI-UPGRADE-DELTA-2026-11-04.md` — pin `2ec55d80…` stamped
  **1.3.0**, upstream moved twice during the session (`fcebc099` → **`707888ec`**), **508 → 515 behind**, skipped
  **v1.4.0** and **v1.5.0**; per-package commit counts; **9 symbol breaks** located to our files
  (`documentState`/`viewState` → `Conversation.watch`, `watchEvents`/`AgentEvent*` →
  `subscribeCommits`/`Harness.onState`, pi-ai's `Type` removal, `checkpointWhen`, `runFailure`);
  **9 features** to accommodate; **5 rulings** needed, 4 taken by lead (D206). Verified by reading upstream
  `CHANGELOG.md` and the migrations table at tip, and by `spec-compat-probe.mjs` (every import specifier still
  resolves — the breakage is named exports, not paths).
- **Store backed up BEFORE any pin work**, with the broker down: sha256 `02da60e3…`, `cmp` exit 0, 463,142,912 B.
- **Local provider outage diagnosed and fixed at the leaf:** Strata now demands a bearer token on loopback;
  `local.mjs` sends `LOOPBACK_PLACEHOLDER_KEY`, so 7 seats `model_error: 401` and one `send` came back with zero
  tokens. Fixed with `~/.config/durig/env` (600, outside the repo) + `--env-file`; proven by the provider's own
  completion path (`stopReason:"stop"`, 59 in / 36 out), by `cli.mjs config` printing **0** occurrences, and by
  `send devtools d015` then running and completing **#5089 and #5090**.
- **The pi harness reaches the same server** via `~/.pi/agent/models.json` `"apiKey": "!sed …"` — proven with the
  variable **unset** in that shell: `pi --print --provider strata --model iq3_s` → `PI-STRATA-OK`.
- **Firewall question answered with four measurements:** firewalld, zone `public` on `enp39s0`; the app's own
  inference-only share listener is up on `0.0.0.0:47832` (`401` no key / `200` with key / never serves the UI);
  `--query-port=47832/tcp` was **no** at 12:2xZ and **yes** by 13:0xZ; and `curl` to this host's own LAN address is
  **not** evidence (a never-allowed port returned `HTTP 200` from itself) because that path uses `lo`, not
  `enp39s0`. `--permanent --list-ports` lists neither 47831 nor 47832, so a reload/reboot drops them — recorded in
  the runbook.
- **Entry point and D206 updated** (`AGENTS.md`, `docs/DECISIONS.md`): the session-closure response is now a required
  deliverable with decisions + pros/cons + recommendation, and hostnames are out of the project.
- **Delegate-verified #5090** by extracting it against current `main` and running it: demo **exit 0**, tool
  `ok:true` on a scratch target and `cause:"gate_target_refused"` when aimed at the live store, which stayed intact.

**Left unverified, with the cheapest probe named.** (1) Whether a `firewall-cmd --reload` or reboot actually closes
47832 — probe: re-run `firewall-cmd --query-port=47832/tcp` after the next reload (root not available to the
delegate). (2) Whether `--permanent` acceptance of 47832 by the app is intended or a bug — probe: `--permanent
--query-port=47832/tcp` now. (3) Whether the 7 local seats can *complete* work end-to-end after the key fix, beyond
the two rows already done — probe: `cli.mjs ps` plus the row statuses above. (4) The delta doc's symbol list is a
**read** of upstream source, not a compile — probe: `node scripts/test.mjs --all` at the `v1.4.0` pin (#5095's own
first gate). (5) `#5083`'s receipt row is still open even though the merge is in `main` (measured
`d1c6d8a6` is an ancestor of `main`); it needs devtools' completion.

**Cost.** Money: this segment spent **$0** on metered calls (the only metered probe this session cost `$0.000002`,
and local loopback calls are unledgered by design — see pitfall 23's ledger defect: the ledger **file does not exist**,
so seat spend is not recorded at all). Wall-clock: the pi research was ~35 min; the local-provider diagnosis ~25 min;
each seat `send` is 20–50 min, so the pi chain's remaining stages (#5094 → #5095 → #5096) are hours, not minutes —
budget two sends per stage.

## CLOCK-OUT — 2026-11-04 delegate session (four rulings → D205 → `#5079` landed as `#5083`)

**Done, with evidence.** Operator rulings: caps untouched (re-read `durig.config.default.json` + `capsFor()`);
`google/gemini-3.1-pro` stays refused (vendor catalog corroboration, `$14.00 = 3.50×` store cap); the ledger is
store-scoped in both private configs (probe prints the same absolute path from both cwds); the scratch worktree
`item-4799` was **discarded safely** — ancestry proven, its two untracked captures copied with `sha256sum` to
`.spike/delegate-20261104b/item-4799-scratch/`, then `worktree unlock` → `worktree remove` (no `--force`) →
`prune` → `branch -d`; worktrees 8, refs 9. The verifier class was **priced and proved reachable for $0.000002**
but **not armed**, because arming without `DURIG_VERIFIER_API_KEY` turns five dark seats into `no_model` seats.
**`#5079` → `#5083` landed** at `2690e6ac` with the merge tree equal to the prediction, ancestry proven, and the
suite + behaviour gate re-run by the delegate at the merged sha. Docs: **D205** in `docs/DECISIONS.md` (all four
rulings + who executes each), SELFDEV pitfalls 24–27 (re-point-before-prune; host labels are claims; a roster
re-point is three layers; two cheap reads whose labels mislead).

**Unverified / open.** `#5083` the **row** is still `queued` (a seat completes it — step 1). W2's non-author
verifier review remains structurally unavailable until the credential lands. The **prune** of `item-5079` /
`item-4955` is deferred until those seats' cwds are re-pointed. Nothing pushed. Broker left **down** (it was
down when I arrived; nothing in this session needs it up — say so if you want it serving).
