# NEXT — current priority and exact next command

**Last updated:** 2026-10-28 by the delegate (wall-clock measurement session, Linux box `Alex-Desktop-Win10`,
`node v24.22.1`, `date -u` 2026-10-28T19:05Z). Read me first; do not re-derive the priority from the ~4,100-line
roadmap.

---

## Current priority: **keep the delivery channel resident** — the wall-clock case for it is now measured

**Rig:** `rig.selfdev.json` · **Store:** `./selfdev.sqlite` (274,068 records; 30,944 submissions) · **Queue census**
(`node cli.mjs queue --json | jq -r '.items[].status' | sort | uniq -c`): **4,821 items = 3,748 `done` / 777
`cancelled` / 277 `held` / 19 `deferred`** — so **296 non-terminal rows**, by seat: impl 177, scribe 44, devtools 35,
qa 21, security 6, pm 5, lead 5, auditor 2, qa2 1 (the degenerate seat). **Branch:** `main` @ `8f8052c`.
**Worktree (Linux-native — corrected 2026-10-28 by direct measurement, an earlier note in this file was wrong):**
`git worktree list --porcelain` on this clone returns **exactly 1 entry** (`/home/chexxor/Git/Durian-Pi` @ `16cbb60`,
branch `main`); there are **no seat worktrees** (`/home/chexxor/Git/Durian-Pi-worktrees/` does not exist, there is no
`.git/worktrees/`, and no `selfdev.worktrees.json`); local branches are **2** (`main`, `wip/seat-prompt-files`);
`git worktree prune -n` is silent (nothing stale registered). `D:\` remains only as the *source clone's* remote path
(`/mnt/d/Git/Durian-Pi`). Consequence: on this host a seat worktree is **created**, not migrated — the first
`up`/`worktree`/`run`/`send` is the writing verb the workspace-move runbook gates.
**Pi seat-agent state is host-local and absent here:** no `*selfdev*` entry under `~/.pi/agent`, so the seat's
*persisted cwd* (the first link in `src/seatroot.mjs`'s chain `persisted seat cwd → DURIG_SEAT_ROOT → process cwd`)
**does not exist on this box** — measured, not inferred: `describeSeatRoot({persistedCwd: undefined, env:
{DURIG_SEAT_ROOT: …}})` prints `source: DURIG_SEAT_ROOT`. So 221's Windows residue is **not** present on Linux
(clean-by-absence, not clean-by-fix), and **`DURIG_SEAT_ROOT` must be exported on every Linux run** or a seat resolves
to `process cwd` — the main checkout.
**Broker:** **DOWN BY CHOICE** since 2026-10-28T05:35Z (`node tools/broker-serve.mjs --stop`). `--status` reads
`STOPPED`, 0 `STRANDED`, 0 `RECONCILE`, and a passing completion on **all 10** registered providers (3.4 s).

**Why this priority, in measured hours (not intuition):** `node tools/latency-budget.mjs --db ./selfdev.sqlite`
(3.0 s, read-only; added this session) says the model is **not** the ceiling — model calls are **51.1 h of 402.4 h of
machine busy time (12.7%)**, while **219.6 h of the 404.8 h store span (54.3%) had no generation in flight at all**,
and **69.1% of all item latency is WAIT** (claimable, unclaimed). The store's own history prices the fix: on the
`run`-invoked days (2026-10-13→15) claim-wait p50 was **101.8–114.3 min** and 47–132 items landed per day; on the
resident-broker days (2026-10-17→21) claim-wait p50 was **2.6–5.4 min** and **314–741** landed per day. Full budget and
method: **`docs/reviews/wallclock-budget-2026-10-28.md`**; the ruling and ranked list are **D153**; the new rows are
**ROADMAP 225–228**.

### The next command (delegate, read-only) — re-baseline before touching anything

```bash
cd /home/chexxor/Git/Durian-Pi
git worktree list --porcelain | tee .spike/worktree-inventory-$(date +%Y-%m-%d).txt   # expect 1 entry (main), 0 seat wt
node -e 'import("./src/seatroot.mjs").then(m=>console.log(m.describeSeatRoot({persistedCwd:undefined,env:process.env})))'   # expect source: DURIG_SEAT_ROOT
node tools/broker-serve.mjs --status                                                  # expect STOPPED, 0 STRANDED
node tools/latency-budget.mjs --db ./selfdev.sqlite                                   # 3.0s: the two currencies
DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json DURIG_SEAT_ROOT=/home/chexxor/Git/Durian-Pi-worktrees \
  timeout 1200 node cli.mjs watch --to engineer --json --interval 2000                 # 277+19 parked rows, no scheduler
node scripts/clockin.mjs                                                              # 2.6s, 14.6KB
```

### The item that unblocks everything else is the operator's, and it is a one-line answer

**ROADMAP 221 / the seat-root residue** (`docs/DECISIONS.md` D152 §6): 10 of 12 seats are `local/iq3_s`, **all with
`seatRoot` = `/mnt/d/Git/Durian-Pi-worktrees/<seat>`**, and their **`up` output reports `source: persisted seat cwd`**
even after `up --root /home/...`. The `--root` flag and `DURIG_SEAT_ROOT` win, but the persisted value wins over the
rig file's `seatRoot`. The delegate will **not** mutate a running system's persistent state. The operator only has to
rule on **A**: *"the persisted per-seat root becomes the workspace-root-relative name — the current code already
derives that on write, so `up --root` once per seat is sufficient and no migration code is needed."* Then B (a
`--reconcile` verb) and C (the store rewrite) are the team's.

### Then, in this order (all three are queued/roadmap and already costed)

1. **A first run at a Linux-native seat root** — the queue id for the operator's task is the one it carries. Expect
   this host to **create** the state: `DURIG_SEAT_ROOT=/home/chexxor/Git/Durian-Pi-worktrees` exported, one worktree per
   seat appearing under that dir, `<db>.worktrees.json` appearing for the first time, and the broker log's first lines
   naming what it found. Inventory `git worktree list --porcelain` + `git branch --list` + `ls .spike | wc -l` into
   `.spike/` **before and after** each writing verb and diff them; a `--dry-run` is **not** the safety check (it names no
   removals and resets only model+cwd).
   **Baseline measured 2026-10-28 (the numbers to diff against):** 1 registered worktree / 1 on disk (main), 0 seat
   worktrees, 2 local branches, `prune -n` silent, 27 files in `.spike/`. If a later session sees a seat worktree at a
   `D:\` path, or the count jumping by more than the seats it started, that is the incident
   (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`), not noise.
   **Measured hazard for whoever runs it (grounded, read-only probe):** `classifyGitRoot("D:\\Git\\Durian-Pi-worktrees\\engineer")`
   on **Linux** resolves that string as a path *relative to cwd* and prints **`main-worktree` ("the main checkout")** —
   so a Windows-shaped persisted root on Linux is not merely wrong, it is **mis-classified as the live tree**, which is
   the exact F21 confusion `src/seatroot.mjs` exists to prevent. The team should check what the write guard does with
   that value; the delegate ran no write verb to find out.
2. **ROADMAP 209** *(impl + devtools, unscheduled)* — a cross-platform `broker serve` launcher on **both** hosts:
   single-instance, logs stdout/stderr to `<db>.broker.log`, exits non-zero on immediate failure, prints
   `RECONCILE`/`STRANDED` on entry, survives terminal close. 222's four startup defects and 221's root were both found
   by reading the operator's scrollback; only the delegate reads that scrollback today. **218's `landed-not-started`
   notice is 96 rows wide right now** and is the cheapest way for a seat to see the backlog is there.
3. **A `tools/` demo for the pin guard** — **ROADMAP 224** *(impl + qa, unscheduled)*. `tools/vendor-pins.mjs --check`
   currently **always exits 0**; a `--violation` fixture path is the deliverable (this rig ships broken CI demos twice,
   so "it runs" is not coverage).

### The queue verb has **no filters at all** — verified, and it changes how you must read the backlog

`cli.mjs` `cmdQueue` is `async function cmdQueue()` reading the whole `queue` document (`cli.mjs:1018-1021`): **it takes
no arguments**, so **`--status held` and `--to pm` are silently ignored and every read returns all 4,821 items**
(**21,178,646 B**; `status` is **22,748,093 B**). Unknown flags fail **open** — you cannot tell a filter was ignored.
An earlier note in this file said "`queue --to engineer --json` → 96 open rows / 3,755 non-terminal": **that was wrong**,
it was a number from a different structure. The measured census is the one in the header above (**296** non-terminal,
**277 `held` + 19 `deferred`**), and the way to read it without pulling 21 MB into a session's context is to project
(`jq` is installed at `/usr/bin/jq`):

```bash
node cli.mjs queue --json | jq -r '.items[] | select(.status=="held" or .status=="deferred")
  | [.id,.status,(.to//"-"),(.subject//""|.[0:60])] | @tsv'      # 296 rows, 75 KB not 21 MB
node tools/queue-drain-audit.mjs          # 1.0 s: of the 277 held, 91 LANDING rows, 71 already fully on main
node tools/latency-budget.mjs --db ./selfdev.sqlite   # 3.0 s: held idle a median 213.5h; deferred a median 145.1h
```

Before starting seats, have `pm` decompose from that projected list rather than assuming the backlog is parked.
71 of 277 held rows being zero-build closable is now a **product** gap, not just a delegate measurement — that is
**ROADMAP 227** (`checkup`/`attention` should say it; the delegate re-running a script every session is the tax), and
the missing filters plus the fail-open flags are **228**. **Release/cancel decisions stay `pm`'s**; the delegate only
measures.

## What this session delivered (done / verified / unverified)

- **Done and verified:** the whole-store wall-clock budget — `docs/reviews/wallclock-budget-2026-10-28.md` +
  `tools/latency-budget.mjs` (**3.0 s, exit 0**, read-only: store opened `readOnly:true`, `cli.mjs status` is a viewer)
  + **D153** + **ROADMAP 225–228** + a `tools/README.md` row and two habits (`index before probe`; `node --check`
  before running a new tool). Full suite green on this box: **`node scripts/test.mjs --all` → 238/238 in 41.1 s,
  exit 0** (`demo/worktree-reuse-deps` and `demo/mergeguard`, previously read as known-red, pass now that the worktree
  is Linux-rooted and clean).
- **Verified:** worktree/branch/ref inventory on the Linux clone — **1 registered worktree (main only), 0 seat
  worktrees, 2 local branches, `prune -n` silent, no `<db>.worktrees.json`, no Pi seat-agent state on this host**, and
  **zero ref-tip moves** across a `run`, a `send`, and four `status` reads (`.spike/worktree-inventory-2026-10-28.txt`,
  7 lines: the porcelain entry plus `git branch --list`). An earlier note in this file claimed "13 registered
  worktrees"; that was **wrong** (it came from clock-in's store-derived seat roots, which are *persisted* values, not
  registered trees) and is corrected above — the distinction is what the workspace-move runbook tells you to
  inventory for exactly this reason.
- **Unverified (deliberately):** no seat was woken or started beyond the read-only `run`/`send` identity probes, because
  the broker is down by choice and 221's persisted root is unruled. Nothing in the review is a claim about the rig's
  *future* throughput — the falsifying test is written into D153: re-measure after one resident-broker day.

## Known-red / blocked register

- **`DURIG_DB` vs `DURIAN_PI_DB` precedence is half-applied and points both ways** — **ROADMAP 191**.
- **Provider 402 is real and quantified: 14,377 generations ended `402 "You need positive balance to do inference"`**
  (22.5 h of busy time; 18,309 store entries carry that text). **24.4% of all 59,851 generations ended in an error —
  59.2 h, 14.7% of busy time.** The operator funded the account; **ROADMAP 226** asks the rig to *count the class and
  stop waking seats* rather than re-burning context on a dead provider. `tools/broker-serve.mjs --status` probes one
  real completion per provider (3.4 s) — run it before a start.
- **The long tail is the largest un-diagnosed term:** the 0.23% of generations that run ≥10 min hold **156.8 h
  (39.0%)** of machine busy time while their conversations committed **1–3 events** inside those windows. **ROADMAP 225**
  is the prerequisite for any "make it faster" decision.
- **`cli.mjs status` prints 22,748,093 B and `cli.mjs queue --json` prints 21,178,646 B per read, and `queue` has no
  filters** — **ROADMAP 228**. `cmdQueue` (`cli.mjs:1018`) takes no arguments, so `--status`/`--to` are accepted and
  ignored: **unknown flags fail open**, and a reader cannot tell a filter was applied. `watch`/`tui`/scripted delegates
  pay the full read per pass.
- **Context is at its limit and nothing says so:** **23,053 prompts > 150,000 tokens, max 1,009,360** against a declared
  200,000 window (`status.context.window.denominator = "declared"`, `candidates.measured = null`); compaction cost
  **15.9 h** across 1,459 runs (max 1.5 h). **208** is the guard; the 94.0% cache-hit rate is what makes the fresh
  576.7 M tokens affordable, so the exposure is a policy away, not a model away.
- **`DURIG_MAX_CONCURRENT_SEATS` is unset in `durig.config.json`, `"1"` in `durig.config.default.json`, and the
  observed profile is not single-flight** (max 11 generations in flight; 81 h at 1, 45 h at 2). Do not change the cap on
  the strength of the default file — read `src/config.mjs loadConfig` first (D153 §4).
- **`tools/latency-budget.mjs` is untested like most of `tools/`** (`tools/README.md` rules). If its `--json` shape ever
  becomes a contract that `verify` consumes, **it needs a demo** — that is the moment to add one, not now.

## If a new capability is being considered

Read **`docs/reviews/EXTERNAL_REVIEW_v3_2026-10-26.md`** first. Its rule that this session's evidence supports:
`node tools/external-capability-audit.mjs` scores candidate libraries against the in-house implementation before
importing anything — and the wall-clock analogue applies, i.e. **measure the term before buying it** (D153: model
speed is 12.7% of machine time, so a faster model is not a wall-clock intervention).

## Clock-out checklist for the next session

1. Read me, `docs/SELFDEV.md`, and `docs/runbooks/README.md` → the matching runbook
   (`channel-offline.md` for broker down/stalled, `queue-deadlock.md`, `stale-held-backlog.md`, `store-probe-identity.md`
   before any raw SQL — **stored enum strings carry embedded quotes**, so `WHERE kind='pi.generation'` matches nothing;
   `queueItems` is **delta-encoded**, so query it through `cli.mjs status`, not SQL).
2. Re-run the worktree inventory into `.spike/` before and after any writing verb (`up`, `worktree`, `run`, `send`) —
   see the incident at `docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`.
3. Report done / blocked / unverified with the command that shows it, naming the OS and the clock.
