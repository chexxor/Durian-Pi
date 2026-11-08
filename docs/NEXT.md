# NEXT.md — current state and next actions

**Last update:** 2026-11-08T18:5xZ (delegate session **N11** — the operator's three rulings (cap accepted, push approved, "I want throughput now") plus "ensure the team in the rig is operating as you expect". Measured: the fleet runs, 96 % of the queue is parked, and the two verified fixes are still unlanded) — the operator bounced both LLM servers and raised
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
(`demo/clockin-digest.test.mjs`, `docs/runbooks/session-start-cost.md` §19, §26–§28). **#5398 is landed**: the deferred
list is now **aggregated** rather than line-per-row — measured **40,161 B → 15,013 B** on a snapshot of the live store
(5,636 queue rows, 365 deferred, 9 seats), ~11 s to re-run, and **over budget is exit 1**, with the ids greppable at
`.durig/clockin-deferred.txt`.

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D226)**, first tranche **ROADMAP 331**. N11 moved it
in exactly one way: the two verified fixes are still **not on `main`**, and the fleet's real ceiling is now measured.
`main` = `origin/main` = **`496cb462`**.

**Current item:** the landing pass below, owned by `lead` (**#5619/#5624** carry the landing list; **qa** holds **#5641**
to verify the cap gate independently); the `local2` roster act (**#5651**, `pm`, `held`) cannot run until the code half
(**#5648**) is on `main`.

**Exact next command** (broker down, ~70 s for the status read plus the landing):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node cli.mjs status          # attention + non-terminal work, broker-down safe
node scripts/land.mjs item-5398 item-5736 --changed-suite   # then item-5648
```

**The one act that matters: a landing pass, in this order.** Branches and their verified state, all re-measured by an
independent runner on the current `main`:

| row | branch | tip | status | what it does |
|---|---|---|---|---|
| **#5736** | `item-5736` | `f4554164` | `claimed` (devtools) | the **re-cut, current-base** version of #5488: `DURIG_MAX_CONCURRENT_SEATS` gates `local/*`. Forks at `37651f23`, so it needs no rebase. `demo/local-slot-gate.test.mjs` exit 0, 11 assertions; suite **261/262** (only the digest test, see below) |
| **#5398** | `item-5398` | `9ae25f09` + `6d5c126d` | `done` (devtools) | the clock-in digest inside its 20,000 B budget, **exit 1** when over |
| **#5648** | `item-5648` | `8fb668ec` | `done` (devtools) | registers the `DURIG_LOCAL2_` prefix → `local2`. Its demo is **green in the branch**: "2 specs ungated, 3 with the prefix configured; id derived to `local2`; `local3` still false; 27 per-prefix keys; third provider's window resolves at 131072", and `broker-serve.mjs --status` in that tree prints **`local2: completes (finish=stop, prompt=57 tok, completion=24 tok)`**. `durig.config.default.json` untouched |

Do **not** land `item-5488` (`ade0691a`) — it forks at `7a1b80e2` and renders D234's docs as deletions. #5736 is that
same change on a current base.

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/test.mjs --all --jobs 6                      # BEFORE: 259/261 on main, two red, both explained below
node scripts/land.mjs item-5398 item-5736 --changed-suite # digest gate first, then the cap
git rev-parse --short main                                # must move
node scripts/land.mjs item-5648 --changed-suite           # local2 registration
node scripts/test.mjs --all --jobs 6                      # AFTER, on the new main
```

**Why `main` is red today, and why that is not a regression.** `node scripts/test.mjs --all --jobs 6` → **259/261**:
1. `demo/clockin-digest.test.mjs` — the live digest is **50,412 B** against a 20,000 B budget. The whole excess is one
   28,093 B line: `deferred (awaiting the operator): #3128 (impl) BUILD (RELEASED by pm…` — the unbounded per-row dump
   #5398 replaces. Landing #5398 is the fix; until then every `--suite` landing is refused.
2. `demo/verifier-arm-probe.test.mjs` — **ROADMAP 294**, already registered, cause pinned: the demo scrubs only
   `API_KEY|SECRET|TOKEN$` from the environment, but `tools/verifier-arm-probe.mjs` reads `durig.config.json` at the
   repo root, and *this host's* gitignored config legitimately carries `DURIG_VERIFIER_PRICE_USD_IN/_OUT`. So the
   probe resolves a price, exits 0, and the "unpriced must exit 1" assertion cannot be satisfied. Nothing in the
   tracked tree regressed — the **host** moved. The tool already supports `--config=PATH`; the demo does not pass it.
   Probe, already run: `node tools/verifier-arm-probe.mjs --family=VERIFIER
   --base=https://api.deepinfra.com/v1/openai --model=openai/gpt-oss-120b --config=/tmp/nonexistent-config.json` →
   `price:null, priceSource:"none", verdict:"NOT-ARMABLE"`. One-line demo fix, failing-first.

**Is the team operating? Yes, with one measured defect.** Since 08:00Z: **216 completed generations, 20 failed, 9
commits** across 12 seats (`devtools 36`, `scribe 27`, `qa 24`, `architect 22`, `pm 18`, `impl 18`, `lead 15`,
`security 14`, `auditor 11`, `qa2 31`). The failures are three classes: engine exit **-11** (llama crash under load),
"engine stopped while this request waited; it was not sent", and **`auditor` 6 × `Compaction failed: Summarization hit
the token limit; the summary is incomplete`**. The defect: **174 parked wakes vs 72 claimable wakes** (entries since id
400000), because `WAKE_CONTENT_PARKED` (`src/driver.mjs:55`) tells a parked seat to "Check `status`" and **no seat has
a `status` tool** — the registry is `claim_work`, `peek_queue`, `release_work`, `resume_work`. `lead` notices it in its
own reasoning: "It's the fifth repetition… I don't have a `status` tool." **`architect` claimed that row as #5740.**
Queue census: `done 4032, cancelled 857, held 436, deferred 384, claimed 16, queued 35` — 96 % of the non-terminal work
is parked; only 35 rows are claimable, 24 of them to `impl`. Wakes are not throughput, claimable rows are.

**Capacity, the number the operator asked for.** `DURIG_MAX_CONCURRENT_SEATS = 4` (accepted, D238) and **inert for
`local/*` until #5736/#5488 lands** — pitfall 128's measurement: **11 `pi.generation` rows `running` against a box
declaring `total_slots: 4`**, `GET /status` reporting `queued: 0`, seat turns aged 100–290 s. Both boxes serve
`qwen3.8-flash-next-q2_0` (local `n_ctx 204800`, text+image; LAN `131072`, text-only, **idle, 2 connections**), so the
`local2` move buys throughput, not family independence. **8 concurrent is still the operator's call**, and it becomes
safe only after the gate lands.

**Standing, deliberately unresolved:** the operator's *"We can re-evaluate later, whether we can afford to host a
verifier model on localhost again. Don't let us forget that we want to do that."* **No queue row exists for it yet**
— searched `tasks` for `%localhost%verifier%` and `%verifier model%`: **0 rows**. `pm` was asked (intent spooled
08:4xZ) to mint it; the bounding number is RTX 3090 **22,387/24,576 MiB (91 %)** with eleven generations in flight.
It is recorded in D238 and here so it survives; minting the row is a seat act, not a delegate act.

**Blocker:** the roster act #5651 (`pm`, `held`) is gated on **#5488 and #5605** — **#5605 is `cancelled`**, a dead gate that
must be re-pointed to #5736 (pitfall: a cancelled row cannot gate anything). #5708 (`pm`, `deferred`) is the roster
release. **ROADMAP 331's** landing entry **#5569** waits on **#5271 → #5306/#5309/#5310**; **#5598** (operator digest)
waits on **#5594**; the memory-write gate cluster **165/166/167** waits on `security` writing the position against the
D236 boundaries.

**New traps this window** — `docs/SELFDEV.md` **126–129**: the wake body names a tool no seat has; a fleet can be fully
awake with 436 held / 384 deferred rows and 35 claimable; `/props total_slots` is not admission (11 generations
running, `queued: 0`); engine exit **-11** surfaces only as a seat-level `last_run_failed`, never in the broker log.
Promote the two delegate probes out of gitignored `.spike/` (**#5617**): `fleet-health.mjs` (completed vs failed
generations per seat, ~1 s, broker-down safe) and `seat-turn-read.mjs` (what a seat's turn actually did).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
