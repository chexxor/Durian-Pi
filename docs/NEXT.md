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

3. **Ask the operator one question: push or not.** `main = 2690e6ac` is **5 ahead of `origin/main`, unpushed**
   (`760630c9` docs, `2690e6ac` the landing merge, and the three `item-4955` commits it carries). The delegate
   does not hold that grant (AGENTS.md; D204).

## The landing (done, verified, do not redo)

- **`#5079` `done`** (devtools, 08:45:05Z): re-cut of `item-4955` onto current trunk, artifact **`89f2b975`** —
  **not** `d1c6d8a6`, and note `f5bda0db` was the pre-amend sha of the same tree (the seat amended a wrong
  "255/255" claim out of its own merge message; an amend mints a sha, so **re-measure in the same turn you
  land**, and key on the sha the row reports).
- **`#5083` executed by the delegate:** `git merge --no-ff 89f2b975` → **`main = 2690e6ac`**, tree
  `20c25a5277a149fe6b2cc56f49a2307e7abe81af`, **identical to the `merge-tree --write-tree` prediction** taken in
  the same turn (exit 0). `git merge-base --is-ancestor d1c6d8a6 main` → **0**, so the **false-landing condition
  that made #4955 unsatisfiable is repaired**. Seatroot mirror `seatroot/linux` fast-forwarded
  (`git -C …/seatroot merge --ff-only main`) → also `2690e6ac`.
- **Gates the delegate ran itself at the merged sha, not read from the seat:** full suite
  `node scripts/test.mjs --all --jobs 8 --json` → **254/254, `failed:[] timedOut:[]`**, 62.8 s; behaviour gate
  `DURIG_DB=/tmp/delegate-1104c/no-store-gate.sqlite` → `status`/`queue`/`ps`/`show 1` **exit 1, `cause
  "no_store"`, absolute `db`, store+`-wal`+`-shm` ABSENT after** (probe `.spike/delegate-20261104b/gate2.mjs`);
  `check` → **103 findings** (`duplicate-item 57, citation-unresolvable 44, verification-without-evidence 1,
  evidence-tree 1`), `context-over-window`/`no-verifier-seat`/`single-model-rig` **pass**, 5 rules `skipped`.
- **W2's non-author verifier review was UNAVAILABLE and that gap is now on the record**: no reachable verifier
  model (`:1234` answers nothing; the granted class needs price + credential + roster — D205). Landing was
  therefore made on the delegate's own re-run of the seat's gates, with the artifact sha and ancestry proven.

## State (measured 2026-11-04T09:1x–09:2xZ)

- `main = 2690e6ac`, working tree clean. **5 ahead of `origin/main` — unpushed.** 8 worktrees, 6 `item-*`
  branches, 9 head refs.
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

1. **Push or not** — `main` is 5 ahead of `origin/main` (the delegate will not push without your grant).
2. **`DURIG_VERIFIER_API_KEY`** — export it where the broker starts (then `lead`'s roster row can arm the
   verifier class and W2's non-author review becomes real), or rule that `lead` may allow a same-vendor fallback.
3. **The hostname drift** — this box reads transient `Alex-Desktop-Win10` with no static hostname, and the
   durable record says `ThinkStation-P3` for D197b–D204. `#5085` (`scribe`) can re-sign; you may want to fix the
   box's static hostname instead.

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
