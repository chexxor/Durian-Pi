# NEXT.md — current state and next actions

**Last update:** 2026-11-08T06:4xZ (delegate session **N10** — the operator bounced both LLM servers and raised
provider concurrency ("*I bounced the LLM server, and raised the concurrency to 8… poke the agents… raise the
concurrency count for the team*"). What that broke and what is now fixed: **every seat turn was dying at registration**
with `Model local/qwen3.8-flash-next-iq3_s is not available` (`no_model`) because both boxes now advertise
`qwen3.8-flash-next-q2_0` (`GET /v1/models`, `n_ctx 204800` local / `131072` LAN, LAN **text-only**); the roster and
the config are re-pointed and `up --refresh` refreshed all 12 seats (**D237**), and `DURIG_MAX_CONCURRENT_SEATS` is now
**4** (measured: 4 concurrent seat-sized turns 5.41 s wall, 8 concurrent 5.28 s wall, `/props total_slots 4`). The
N9 rulings below still stand.

**N9 in brief** — the operator's four approvals of `00:3xZ` were executed and a fifth ruling arrived mid-session: **"add two seats that we sometimes rely on to use the strata-server provider."** Executed: the push (`7a1b80e2..c047b767` → `origin/main`), the sweep-residue ruling (delivered; seats
resumed their own rows — `queued 7 → 35`), and the capacity ruling (delivered as rows **#5605** code / **#5608**
roster, and the `DURIG_LOCAL2_*` env block is **already written and measured**). Two of the team's fixes are now
**verified by an independent runner and still unlanded**: **#5488** (`item-5488` = `ade0691a`, 262/262 suite green)
and **#5398** (`item-5398` = `9ae25f09`, digest **43,967 B → 15,117 B on the live store**). `main` is still
`c047b767`. The N8 pointer moved **verbatim** to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) in this cut (header + pointer,
145 lines, 13,487 B, sha256[12] `c87865d86f5b`; the pointer text is byte-identical in the archive tail.) The live file
is a pointer, cap 200 lines (`demo/next-pointer.test.mjs`) **and ≈17 KB** — the digest cap is bytes, not lines
(`demo/clockin-digest.test.mjs`, `docs/runbooks/session-start-cost.md` §19/§27).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Milestone this window worked** — the milestone in force is **ensuring LLM task completion** (**D226**), first
tranche **ROADMAP 331**. N9 moved it the way 331 has to move: **#5488 is `done`** (the row that makes
`DURIG_MAX_CONCURRENT_SEATS` real for `local/*`, the gate on every capacity ask) and **#5398's fix is written and
measured green**. Neither is on `main` — `main` = `origin/main` = **`cc4d85d4`** (N10's roster/config fix). So the first
act of the next session is a **landing pass**, not another build: land **#5488** then **#5398**.

**N10 (06:3xZ) — the fleet was dead and is now alive, and the cap the operator asked for is set but inert.** The
operator bounced both LLM servers and raised provider concurrency to 8. Measured consequence: every seat generation
died in ~1 ms with `Model local/qwen3.8-flash-next-iq3_s is not available` (`no_model`), because both boxes now
advertise **`qwen3.8-flash-next-q2_0`** (`GET /v1/models`: local `n_ctx 204800`, text+image; LAN `n_ctx 131072`,
**text only**). Re-pointed: 11 seat strings in `rig.selfdev.json`, `DURIG_LOCAL_MODEL`/`DURIG_LOCAL_CONTEXT` and the
`DURIG_COMPACTION_MODEL_OVERRIDES` key in `durig.config.json`; `up --refresh` refreshed all 12 seats (**D237**).
Afterwards: **111 completed generations, 0 failures across 10 seats in 10 minutes**, and the box reports
`{"busy":true,"queued":0}`. **`DURIG_MAX_CONCURRENT_SEATS` is now 4** (was unset → default 1) — but it is **inert for
`local/*` until #5488 lands**, which is exactly the row still unlanded: 6 seat generations were observed running at once
with the cap at 4. GPU state at that moment: RTX 3090 **22,637/24,576 MiB (92%)**, 100 % util; A4000 13,034/16,376 MiB.
So 8 concurrent seat turns is measured fine at small prompts (5.28 s wall for 8) but is **not safe at full context**
until #5488 makes the cap real. Gate chain unchanged: **#5488 → cap real → #5271 → #5306/#5309/#5310 → #5569**
(`impl`, the ROADMAP-331 landing entry).

**Current item:** the landing pass above, owned by `lead` (row **#5619/#5624** carry the landing list; qa holds
**#5641** to verify #5488 independently; my numbers are in §A). **Intents are already spooled for this** — to `lead`,
`impl`, `pm`, `security`, `auditor`, `devtools`, written while the broker was down, sitting in
`selfdev.sqlite.broker.inbox/`; the next `--start` delivers them (bodies in `.spike/delegate-20261108h/`). That inbox
file is not a fault, and it is the reason the closing window woke nobody (pitfall 121: a `claimed` row never wakes a
seat). **D236 is now the governing ruling set: the operator accepted all seventeen N9 recommendations verbatim
("I accept your recommendations. Please act on them.") and the acts are enumerated there — read D236 before routing.**

**Blocker:** none for the landing pass itself — both fixes are green and `main` is reachable. What is blocked is the
rest of the chain: **the cap is only real after #5488 lands**; the `local2` code half is now **#5648** (`devtools`,
`claimed`, `demo/local2-provider-prefix.test.mjs` already written in `item-5648`) after lead cancelled the duplicates
**#5605/#5655/#5705**; the roster half is **#5651** (`held`, lead's re-cut replacing **#5608**), and **#5708**
(`pm`, queued) is its release gate; **ROADMAP 331's** landing entry **#5569** waits on **#5271 → #5306/#5309/#5310**;
**#5598** (the operator digest) waits on **#5594**. **One thing only the operator can decide: whether the team cap goes
to 8** — the provider measured 8 concurrent seat-sized turns at 5.28 s wall, but the 3090 is at 92 % memory with 6
seat turns running, so my recommendation is 4 until #5488 lands, then raise it as a dated ruling.

Exact next command:

```bash
cd /home/chexxor/Git/Durian-Pi
# (0) the four reads, in order, before touching anything (§27 preflight, ~8 s)
set -a; . "$HOME/.config/durig/env"; set +a
DURIG_DB=./selfdev.sqlite node cli.mjs status   # attention + non-terminal work; broker-down safe
git log --oneline -1 main && git log --oneline -1 item-5488 && git log --oneline -1 item-5398
curl -s --max-time 15 -H "authorization: Bearer $DURIG_LOCAL_API_KEY" http://127.0.0.1:8080/v1/models   # the id the box ADVERTISES must equal DURIG_LOCAL_MODEL and every seat string — D237/pitfall 122
node .spike/delegate-20261108h/fleet-health.mjs $(date -u +%FT%TZ -d '-10 min')   # completed vs failed generations per seat (promote to tools/ per #5617)
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status | grep -E 'completes|BLOCK|local providers'
node scripts/clockin.mjs | wc -c        # budget 20,000 B, exit 1 if over — measured 15,117 B once #5398 lands
git worktree list --porcelain > .spike/wt-$(date -u +%Y%m%dT%H%MZ).txt; git branch --list | wc -l
```

**(A) WHAT IS VERIFIED AND WAITING TO BE LANDED (the only thing standing between this session and durability).**
`main` = `origin/main` = `c047b767`; the two fixes live on item refs and are green under a runner that is not their
author's loop:

- **#5488 — `DURIG_MAX_CONCURRENT_SEATS` gates `local/*`** (`item-5488` = `ade0691a`, row `done`).
  `node demo/local-slot-gate.test.mjs` **(that demo exists only on `item-5488`, not on `main`** — run it in that
  worktree**)** → exit 0, 11 assertions: the lease `<db>.genlock.0` is **held** for the
  generation naming seat + pid, **released** at the end, and a second local generation **QUEUES** (no byte reached
  the wire) then goes through; **acquire overhead 0.070 s** (ungated 1.135 s vs gated-and-free 1.205 s).
  `node scripts/test.mjs --all --jobs 6` → **262/262 in 81.5 s**. `durig.config.default.json` untouched → the default
  cap is still 1 (acceptance bar 3). Non-vacuity is observed on `main`: with the cap at 1 I sampled 5× in one window
  and saw **6 `running` `pi.generation` rows with 0 `genlock` files** and 12 TCP connections to a 3-slot box.
  **Caution: that branch predates `c047b767`** (`git diff main..item-5488` renders D234's docs as deletions) — land on
  a current `main`, and re-run the full suite after the rebase, per `tools/what-to-test.mjs`.
- **#5398 — the clock-in digest inside its budget** (`item-5398` = `9ae25f09` code + `6d5c126d` docs; row `claimed`
  by devtools under **#5607**). Both operator-approved bars, measured by me with the broker stopped:
  (a) `DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node scripts/clockin.mjs | wc -c` → **15,117 B** in the
  item tree vs **43,967 B** in the `main` tree, same store, same minute, budget 20,000 B, and over-budget is now
  **exit 1** not a stderr comment; (b) `node demo/clockin-digest.test.mjs` → exit 0 with **160 `deferredTo:"human"`
  rows** and a production-sized rest-of-digest, asserting the OLD shape is **over** budget at that size while the
  aggregate shape fits and stays bounded from 160 → 4,000 rows. The unbounded list moved to a gitignored grep file
  (`.durig/clockin-deferred.txt`, 366 lines for 362 rows) — grep it, never read it whole.

**(B) THE OPERATOR'S FIFTH RULING — two seats on `strata-server`; the code half is the only missing piece.**
Verbatim, `2026-11-08T00:4xZ`: *"If you haven't yet, please add two seats that we sometimes rely on to use the
strata-server provider."* State at cut: the **machine half is done** — `~/.config/durig/env` (mode 600) carries a
complete `DURIG_LOCAL2_*` block, every value measured: `BASE_URL=http://192.168.1.52:8080/v1`,
`MODEL=qwen3.8-flash-next-iq3_xxs` (what `GET /v1/models` actually serves — pi's `~/.pi/agent/models.json` claims
`…_s` for that host and is **wrong**), `CONTEXT=131072` (= `/props n_ctx`), `MAX_TOKENS=16384`,
`PRICE_USD_IN/OUT=0` **declared** (a LAN host is `metered`, not loopback — `src/providers/local.mjs:60-77` — so an
unpriced spec is a refusal), and the box's own key (the LOCAL key gets `authentication_error`). Probe:
`total_slots: 4`, text-only, a 57-token prompt completes with content (`finish=stop`, 26 completion tokens).
The **code half is row #5605** (`devtools`, `queued`): add `DURIG_LOCAL2_` to `LOCAL_ENV_PREFIXES` /
`LOCAL_PROVIDER_IDS` (`src/providers/local.mjs:41,44`) and `CONFIG_KEYS` (`src/config.mjs:118-128`) — the id
`local2` is derived from the prefix (`local.mjs:131-133`), so nothing else can drift. **Roster half = #5608**
(`pm`, `held`): set `"model": "local2/qwen3.8-flash-next-iq3_xxs"` on two seats in `rig.selfdev.json` and `up
--refresh` (which re-points EVERY seat) with the **broker stopped**. Recommended pair and the exclusions are in the
delegate's `00:4xZ` brief: **qa2 + security**; never `designer`/`advocate` for this (the box is **text-only**);
never `impl`/`architect`/`pm`/`lead`/`qa`/`scribe` (they need the 204,800 window and the faster quant).
**Trap for #5605:** a tiny-token probe against that box returns `finish_reason=length` with `content: null` — at 8
tokens it produced 8 tokens and no content, at 64 it produced `OK`. A 1-token preflight probe (#549, pitfall 108)
will therefore BLOCK the broker start on a healthy server.

**(C) THE DEFECT THAT ATE THREE WINDOWS — file it before it becomes folklore.** A **broker-routed read issued from
inside a seat's own turn cannot be answered**, because the broker is inside the pass waiting for that turn. Three
windows, three overruns: last passes at `00:59:45`, `02:03:17`, `02:41:55`; each broker then sat inside that pass
until killed (`EXIT … reason=deadline` at `01:41:57` = **42 min past a 1800 s bound**, `02:25:12` = 22 min past a
1200 s bound, `02:53:06`). Cmdlines in hand, two reproductions: seats hung in
`node cli.mjs queue --id N` (90 s timeout) and in `node scripts/clockin.mjs --db …`, and from outside the same
shape answers `{"ok":false,"error":"read queue-census: timed out awaiting the broker's result"}` — which is also why
`scripts/clockin.mjs` fails mid-window (its `health` read times out). The instrument is 0.3 s:
`ps --ppid <broker pid>` plus the nonterminal `tasks` rows (`status <> 'terminal'`). Scribe registered the same gap
as **#5640**. Related standing fact: **there is no SQL shortcut for item state** (pitfall 105) — the newest
`durig.queue` revision is **5,819 B** while the store holds 5,661 rows, so a broker-free queue read cannot be written
either; use one multi-id `cli.mjs show`.

**(D) WHAT THE TEAM DID WITH THE RULINGS (evidence the residue ruling is working).** 57 new rows since #5604.
`queued 7 → 35`, `deferred 365 → 362`, `claimed 11 → 10`, `done 3957 → 3981`. The sweep-residue rows were minted to
each owner (**#5609** qa, **#5610** qa2, **#5612** lead, **#5613** security, **#5607** devtools, **#5606** impl) and
the four "unpark or restate" rows (#5572/#5574/#5575/#5576) went through **#5603/#5634**. **#5615** recorded the four
approvals as **D234**; **#5595** is the standing class ruling. Still open, unchanged: the **nine** real operator
questions — **#4976** pm, **#4354** impl, **#3350** qa, **#4881** lead, **#4835** scribe, **#4817** devtools,
**#4954** auditor, **#4827** security, **#4814** qa2 — scribe's digest carrier is **#5598** (gated on **#5594**).
Also waiting on a `lead`/`pm` act: **#5617** (promote the provider-slot probe out of gitignored `.spike/` into
`tools/`), and the landing list rows **#5619/#5624**.

**(E) TRAPS NEW THIS SESSION** — `docs/SELFDEV.md` **114–121** (see (C) for the read deadlock): **`cli.mjs send` is
deprecated and refuses on this rig** (`spend: catalog-refused … $14 exposure vs a $4 cap`); the route is
`node intent.mjs <seat> --body-file <path>` (pitfall 114). The clock-in digest **does** work with the broker down
(`43,967 B`, exit 0) — D234 (4)'s "blocked, needs a broker" does not reproduce (pitfall 115). **`broker-serve.mjs
--status` prints live credential VALUES** — already **ROADMAP 295**, redact in the same command before any paste
(pitfall 120). And a closing idle window is a delivery problem, not a stall: **351 passes, `woke=-` on every one**,
because a `claimed` row does not wake a seat — spool an intent instead (pitfall 121). Two delegate probes live in
gitignored `.spike/` and are lost unless promoted: `digest-scale-probe.mjs` (calls the exported
`renderDigest`/`deferredTerm` at a 365-row backlog: **24,107 B old-shape vs 856 B new-shape**, <1 s, no broker) and
`queue-state.mjs` (proves pitfall 105 the other way).

**(F) STATE AT CUT** — store **5,685 rows** `{done 3995, cancelled 850, held 431, deferred 358, claimed 13,
queued 38}` (session start: `{done 3957, cancelled 842, held 422, deferred 365, claimed 11, queued 7}` — so **+38 done,
−7 deferred, +31 queued**, the residue ruling working); **87 worktrees, 90 branches, `unmerged=23`** (session start: 74
worktrees, 77 branches); no broker
running (`resume` settled the interrupted turns, `running 0`); `selfdev.sqlite.broker.inbox` holds **3** files — the 2
spooled landing intents above and one stale unanswered `op=read from=cli` left by an interrupted turn (the (C) defect,
in file form), `inbox.error` 96 (all `apply failed: SqliteStorage is closed`, all pre-existing). Money: **111 metered
calls, $0.06364** this session (4
windows), store cumulative **$0.769304** over 1,660 ledger rows — all of it `auditor` on the metered verifier; every
seat runs free on the local box. The four windows produced **1 commit (D234) + 1 (#5488) + 2 (#5398) + 2 (this
record)**; the honest read is that the windows are being spent, not the work — which is what (C) costs. Full history
of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).

**(G) WHAT D236 CHANGED FOR THE QUEUE (so nobody re-asks the operator).** Released as ordinary seat work now:
**#4354** (gate **#4352** is `done`), **#4835** (blocker **#4849** is `done`), **#3350** (gate **#3349** is
**`cancelled`** — re-point it, a dead row cannot gate anything). Granted and consumed: the **push** for the record
batch (`#5580`'s "11 unpushed" is stale — measured 2). A **no-op**: the stray-`item-*` cleanup half of **#4817** —
measured **81** root `item-*` dirs, **81** registered worktrees, **0** strays. Ruled, awaiting an owner's act:
independence by risk class (verifier cannot carry `auditor` turns: slot 8192×4 vs p50 16,518 — never read
`status.context` as health, #4957); the two memory boundaries for **#4827** (quarantine never rendered; memory never
an authorization); the print fix for **ROADMAP 295** without key rotation; **#5617** widened to promote **both**
probes; **#5640** registered as the read-deadlock BUILD row; and the seat prompts must name **`bash`** — measured
`grep -rIo "bash" prompts/ | wc -l` → **0**, the wording is in D236 (10). Duplicate code rows **#5605**/**#5655** are
one unit; resolving them is `lead`'s.

**(H) N10 ADDENDUM (06:3x–07:0xZ).** Operator answers to N10 are in **D238**: cap **4 accepted**, **push granted and
consumed** (`7ccb2163..dc4491bf`, ahead 0), and **throughput now** is the priority. The throughput bottleneck, measured:
local box 4 slots carrying all 11 seats (`/status {"busy":true,"queued":0}`), LAN box **4 slots, idle, 2 connections**.
**A question the operator wants kept open, not closed:** *"We can re-evaluate later, whether we can afford to host a
verifier model on localhost again. Don't let us forget that we want to do that."** The number that bounds it: RTX 3090
**22,637/24,576 MiB (92 %)**, 100 % util, with six seat generations running; both boxes now serve the **same** id
(`qwen3.8-flash-next-q2_0`), so the LAN move buys throughput, not family independence. `pm` was asked to mint the row
that carries it. Routing defect from the same read: **one change, four live rows** — #5605/#5655/#5705 cancelled,
re-cut as #5648 (claimed) + #5714 + #5721. Two new delegate probes live in gitignored `.spike/` and need promotion
(#5617): `fleet-health.mjs` (completed vs failed generations per seat, ~1 s, broker-down safe) and
`seat-turn-read.mjs` (what a seat's turn actually did). `.gitignore` now carries `*.spend.jsonl`.
