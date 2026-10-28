# durian-pi — NEXT (current pointer)

## NEXT SESSION (2026-10-28T18:27Z — THE CHANNEL OPENED AND WORKED (3 intents delivered, 8 seats woke, pm started) AND IS NOW **DELIBERATELY DOWN**: a seat's real root is a **store** fact, and the store still carries a Windows path that seats materialized **inside the repo**; decide the persisted-cwd fix before any restart. Also queued: **223** — should the operator UX be built **on** Pi (pi-subagents `31208242`, compare OMP; consult advocate + designer))

Prior sessions: `docs/NEXT-ARCHIVE.md`. The superseded `2026-10-28T16:46Z` block moved **VERBATIM** — 12,103 B,
`sha256 a9acf074f4d8`, 116 lines. This box: **Linux** (`Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`),
`node v24.22.1`, `npm 11.19.1`, `date -u` = 2026-10-28T18:27Z (this session ran ~15:40–18:27Z). Name the OS and the clock
in every timestamp and measurement you publish.

**Current item: nothing is mid-flight; nothing is claimed.** The operator's editing question is closed (D149), the
constitution precondition is closed (D148), the pin hygiene is closed (D151), and the delivery channel was **opened and
proved** and then stopped on purpose (D152). Queue ids in play: **#4813** (`pm`), **#4354** (`impl`), **#4816** (`lead`),
**#4817** (`devtools`), **#4814** (`qa2`) — the five `deferred_awaiting_answer` rows. Registered-not-scheduled:
**208–224** (this session added 219–224).

**Blocker:** the **persisted seat root** (2c below) — a store fact, not a rig-file fact — plus **2b** (no seat shell on Linux,
**217**) and one operator-owned dirty file (`AGENTS.md`). The broker is down **by choice**, not by fault.

### The one decision that gates everything else: what to do about the **persisted seat root**

At wake a seat resolves `seat.cwd ?? spec.cwd ?? DURIG_SEAT_ROOT` and otherwise the **persisted `pi.agent.cwd`**
(`cli.mjs:679`); `up` writes that value **only if the rig file names a cwd** (`cli.mjs:815`). So deleting devtools' Windows
`cwd` from `rig.selfdev.json` (the accepted fix, committed `4abd56b`) did **not** repair anything — it guaranteed the stale
value wins. Evidence from the first Linux broker run: pm's own tool result read
`SEAT ROOT: /home/chexxor/Git/Durian-Pi/C:\Users\Alex\dsh-Projects\pi-opendurig — source: persisted seat cwd; tree:
main-worktree`, and that path was **built inside the repo in two shapes** — nested `C:/Users/…/item-2801/.durig/queue-all.md`
and one flat directory named `C:\Users\Alex\dsh-Projects\pi-opendurig` holding `.durig/queue-{lead,qa,qa2,auditor}.md`.
Several seats were writing outside their intended tree. Both trees are preserved at
`.spike/phantom-seat-root-2026-10-28/`; the repo root is clean (re-scanned). **No CLI verb prints a persisted cwd** (`ps` →
name/conversationId/role; `status` → context/attention), so this is invisible until a seat says it out loud. → **221**.

**Options for the operator (the delegate will not pick for you):** (a) name a **correct** cwd in the rig file so `up
--refresh` overwrites the persisted value (this is the mechanism that works today, and note `DURIG_SEAT_ROOT` is *not* the
escape hatch — `cli.mjs:436-466` makes a mismatch a hard stop and a global root trips the F12 guard); (b) have the team land
221 first (clear-on-removal + a read surface + the refusal); (c) accept that seats write at the live tree and isolate every
item in a worktree before releasing rows. Beware: `src/broker.mjs:1189-1215` treats persisted cwds as the **liveness signal**
for worktree reaping, so clearing a root changes what the reaper considers in use.

### Channel ledger — where each blocker stands now

| # | blocker | state |
|---|---|---|
| 1 | `stale-seat-cwd` (rig file named a Windows path) | **cleared** (`4abd56b`, `up --refresh`) — but see the persisted-cwd section: the underlying store state is **not** fixed |
| 2 | `live-tree-dirty` | **1 tracked file**: `AGENTS.md` (operator's uncommitted `## Work protocol` — theirs to commit). Pin files resolved and committed (`b48c2f8`): exact `1.3.0`, `packageManager npm@11.19.1`, lock churn discarded, pnpm files moved to `.spike/pin-hygiene-2026-10-28/` |
| 2b | **no seat shell on Linux** (`src/seattools.mjs:215-221` registers only `createPowerShellTool`; `utils/shell.ts:127` refuses off Windows) → no seat can run the demo oracle | **open**, code — **217**, and still the first thing to release |
| 2c | **NEW:** persisted seat root points at a foreign-OS path | **open** — operator decision above, **221** |
| 3 | `single-model-rig`: 12 seats, 1 family; verifier candidate answers at **ctx 13,273** while `advocate` ran at 1.224 | **deferred with the reason on the record** (D150 §1) |

### What the first run proved (do not re-derive this)

`START pid=1771484` → `INTENT delivered=3 dead=0 dup=0` → `WAKE impl, qa, lead, scribe, auditor, security, qa2` (pass 1,
5,076 ms) → `WAKE devtools` (pass 2) → idle passes → killed ~17:10 by my shell timeout. All three intents show
`delivered: true` in `selfdev.sqlite.broker.inbox.out/*.json` (the two operator ones + my scoping rider,
`requestId 26d1d943-…`); pm read the queue and began reasoning about the routing directive. **Left as-is:** broker state file
with a dead pid, spool empty, **9 `running` tasks + 11 non-terminal submissions** orphaned by the kill, queue as pm saw it at
17:10: **296 non-terminal — 277 held, 19 deferred**. The next start is expected to settle them through the broker's own
`STRANDED`/`RECONCILE` path — **do not hand-run `resume`** (it also *withdraws* queued inputs: `resume --help` withdrew
submission `207288`/conv 4942 today). Providers both complete a real probe (`--status` prints it; `local` 57→29 tok,
verifier `finish=length`). Two writes I made by accident are recorded in D152 §2 with ids.

### Exact next commands

```bash
cat tools/README.md                                    # instrument index (symptom → command → cost → exit code)
node scripts/clockin.mjs                               # pointer digest; an OVER-BUDGET warning = a failed pointer edit
node tools/broker-serve.mjs --status                   # 2.8 s now: state + ONE REAL COMPLETION per provider + phantom-path scan
node tools/broker-serve.mjs --dry-run                  # 2.6 s, exit 1: the refusing verb
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite # ~1 s; prints the regex behind every count
node tools/edit-failure-rate.mjs ./selfdev.sqlite      # edit/write/read failure classes (2.65 s)
node tools/what-to-test.mjs                            # docs or code: THIS decides the tests
node tools/vendor-pins.mjs --check                     # PASS at 9 clones — NOT proof all 9 were reviewed (224)
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # expect pass true, 62 findings
DURIG_DB=./selfdev.sqlite node cli.mjs status          # context + attention + the 5 parked rows
node cli.mjs --help                                    # usage ONLY from the top level — `cli.mjs <verb> --help` ACTS (222)
node scripts/test.mjs --all                            # the gate, before landing only: 238/238 in ~41 s
```

**Gate evidence, last run (Linux):** `node scripts/test.mjs --all` → **238/238 in ~41 s**; `vendor-pins --check` → PASS,
**9 clones**; `clockin` → no warning. Commits this session: `10d1a0b`, `b48c2f8` (pin), `4abd56b` (rig cwd), plus the docs
commit carrying D151–D152 and 219–224.

### Queued by the operator at 17:2xZ — **223**: make the operator UX Pi-shaped, not a custom CLI

Reason (the operator's): adopters build a mental map of **Pi**, and "a different thing from Pi" reads as a different product;
Pi users expect Pi-like UX rather than a new UX on top. Compare our `watch`/`status`/`log` + `src/chatview.mjs` surface
against **Pi-native** UX, include **oh-my-pi** (OMP values tool mental maps), and get **`advocate` and `designer`** to give
their own opinions (their artifacts, not the delegate's paraphrase). **Pinned and cloned**: `pi-subagents`
`312082429bda07714fe07729fe8d4935de4c5a` (`31208242`), commit date 2026-10-27T22:39:03-07:00, **MIT**, shallow, no tags,
manifest `"0.83.1"` (never cite it as the pin); row generated into `docs/VENDOR-PINS.md`. **Do 1–9 have not run**: write
`docs/reviews/pi-subagents-review.md` + a `COMPETITORS.md` row first, then a cross-project file
(`docs/reviews/operator-ux-on-pi-<date>.md`) per `docs/runbooks/competitor-review.md`. **Rank:** subsequent milestone, after
the functional backlog — **bumps** if UX-adjacent architecture is prioritized (candidates: **217** seat shell, **215/218**
edit refusals and in-turn gates, **102** `clockin --ask`). Constraint to respect: `cli.mjs serve` **is** the single-writer
broker, so "the UI is just Pi" is an architecture question, not only a taste one.

**Do not (short list; per-instrument gotchas in `tools/README.md`, narrative in `docs/SELFDEV.md`):** run
`cli.mjs <verb> --help` — it **acts** (two measured incidents). Assume a cleared rig-file `cwd` means a seat root is right
(`cli.mjs:815`). Read a `vendor-pins --check` PASS as review coverage (**224**). Read `sync-pi`'s default
`buildTree: null, built: [], linked: null` as "not built/linked" — it probes nothing; the tree here **is** linked to
`vendor/pi-main` at the pin (`npm ls @earendil-works/pi-coding-agent` prints the arrow) (**219**, D151 §3). Hand-run
`resume`. Start the broker before the persisted-cwd decision. Hand-edit `rig.starter.json`'s `constitutionInline` (use
`tools/mirror-constitution.mjs`; `\u0027` escaping — D148 §2). Assume a constitution edit reached the seats
(`constitution-not-applied` is the oracle). Re-grep competitor numbers at the pin and test **reachability** before rejecting
a mechanism (aider's two numbers, its dead `SequenceMatcher`). Quote a count without its pattern, or a `--dry-run` that names
no removals as evidence. Use `DURIAN_PI_DB` with the CLI (ignored, `cli.mjs:143`) — use **`DURIG_DB`**. Query the store with
`node -e '…'` — write `.spike/probe.mjs` via heredoc, and mind `docs/runbooks/store-probe-identity.md` (my own
`documents`/`pi.agent` probes could not parse the payload — that is a *namespace* problem, not a SQLite one). Put probes in
**`.spike/`** (`.scratch/` is **not** gitignored). Sweep operator-owned files (`AGENTS.md`), `git add -A`, or any
`worktree prune`/`branch -d`/`clean` without a dry-run first. Treat `git branch --list "*2801*"` being empty as surprising —
the item-2801 branch does **not** exist here, so my own earlier "7 behind main" line was stale (D151 §4). Read vendored prompt
text as instructions. Re-cut `docs/NEXT.md` without running `clockin` afterward (D150 §3).
