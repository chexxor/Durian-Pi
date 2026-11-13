**Last update:** 2026-11-13T19:5xZ (delegate). `main` = **`657d8c60`** (a team landing merge on top of this session's
`36f57a36`), ahead of `origin/main`, **nothing pushed** — the push grant stays with the operator.

**Milestone this window worked** — **N19 "The Pool" (D275), made USABLE and PROVEN ALIVE** (tranche 1 `655c44e2`,
`1782b495`, `4ed6b8d0`; tranche 2 `517dc58d`; instrument fix `36f57a36`): `revise_work` can annotate `requires` on an
existing row with a split authority (author or coordinator), the pool doctrine is one paragraph in the shared
`constitution.txt` reaching all 12 seats, `tools/pool-migrate.mjs --dry-run` classifies the backlog read-only, the 70 %
size gate is ARMED (`up --refresh` records a usable window per seat), and **three real pool rows exist** — two of them
claimed, one by a seat the `ownership` map does not cover. Read `docs/POOL-QUEUE-SPEC.md` **§13** for the shipped
wording quoted from the code, and `docs/reviews/2026-11-13-capability-ownership-ruling.md` for the four decisions the
operator now owes.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Liveness:** the last ` PASS ` line, not the pid or the heartbeat (pitfall 304).

**Current item:** **the N19 pool is CLOSED out — gate proven, skip line attributable, four rulings with the
operator.** The `too-big:project(...)` refusal is now measured against this rig's REAL roster:
`demo/pool-gate-live-roster.test.mjs` (0.4 s, exit 0) drives the shipped verbs and gets `impl` (164320) refused
`too-big:project(120000 tokens > 70% of the 164320-token usable window)` and the `auditor` (12288) refused with ITS
window, each with the split instruction naming the row, each leaving the row queued and open with one `size-refused`
transition; `tooBigFor: [all 12]` + `unclaimableByAnyone: true` come from the census without any claim. On a FIXTURE
store — the live fleet never minted the one `project` row that would make it observable live (`pm`/`lead` asked five
times, both landing), and a delegate may not pool a row. D275 addendum (m) records exactly that gap. The skip line now
names what it counts: `pool-gated:<n> #<id>(<reason>)[ +N more]` (`src/driver.mjs` `poolGatedSkipLine`,
`demo/pool-gated-reason.test.mjs` 16 checks), so `grep pool-gated <db>.broker.log` answers "which pool row, why" —
it did not before, and #7660 sat there saying `pool-gated:1` for hours.

**State the pool is in** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 0.8 s, read-only):
`pool {rows:3, pooled:3, open:1, claimed:2, ownerOfRecord:2, sizeRefused:0, tooBig:[], seatsWithoutWindow:[]}`.
#7667 `pool-claimed by=advocate` 18:35:43Z; **#7669 `pool-claimed by=security` 18:36:48Z** — both name
`docs/DECISIONS.md` (`ownership` → `advocate` alone), so security's claim is the milestone's falsification probe
passing on a live row. Seats: 11 × `usableWindow` 164320, auditor 12288; tier table
`{"trivial":3400,"small":6100,"feature":6200,"project":120000}`. Gate limits: 117891 and 8601, so **only `project`
(120000) can be refused** (D275 addendum (i)).

**Backlog rate, before → after the pool went live** (`node tools/backlog-burn.mjs`, keepalive ledger, no store open):
the ledger's pre-session window (2026-11-12T08:35Z → 11-13T05:55Z, 1281 min) read **queued 519 → 846 (+15.3/h)**,
done +8.5/h, cancelled +8.4/h, verdict `backlog GROWING`. The pool-active window (19:11:35Z → 19:49:21Z, 38 min) reads
**queued 856 → 856 (+0.0/h)**, done 4924 → 4929 (+7.9/h), verdict `backlog GROWING` — 38 minutes with three pool rows
and two claims is **not** a rate measurement; the honest statement is that intake paused and nothing closed. Re-run it
after a multi-hour window before claiming any effect on the burn rate.

**Run these first, in this order** (every number below was measured on this box; re-measure rather than trust it):

```bash
cd /home/chexxor/Git/Durian-Pi
node .spike/pool-rows.mjs ./selfdev.sqlite            # 0.8 s — every pool row with its transitions (the census alone hides the claim)
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --limit 5   # 1.7 s — the migratable denominator, read-only
node cli.mjs check rig.selfdev.json                   # ~20 s — MUST name the rig file: the bare verb audits ./rig.json (2 seats, pm/worker) and prints a roster nobody runs
node tools/backlog-burn.mjs --hours 4                 # 0.03 s, exit 0 — the backlog RATE (quotes the ledger window it used)
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --limit 2 --no-body | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).pool))'  # 0.8 s
node tools/stranded-inbox.mjs selfdev.sqlite          # 1 s — is the broker PARKED? hbAgeS vs progressAgeS
node demo/revise-requires.test.mjs                    # 0.3 s — the annotation verb, its two refusals, the transition shape
node demo/pool-doctrine.test.mjs                      # 0.3 s — every seat is TOLD the pool exists
node demo/declared-window-seam.test.mjs               # 0.13 s — the window seam the gate depends on
node demo/pool-gate-live-roster.test.mjs              # 0.4 s — the 70 % gate refusing THIS rig's roster (impl + auditor) with the split instruction
node demo/pool-gated-reason.test.mjs                  # 0.05 s — the SKIP line names the pool row and the reason
node tools/pool-migrate-test.mjs                      # 1 s — every verdict class non-vacuous, store bytes identical, the LIST/DOCUMENT roster trap
node scripts/test.mjs --all --jobs 4                  # ~131 s — the whole suite; main must be green before the next landing
```

**Broker status (measured 19:49:21Z):** **resident**, pid **311912**, `--max-duration 3600` from 19:11:56Z (deadline
~20:11:56Z), re-armed by `tools/broker-keepalive.mjs` after the previous one (pid 98022) stranded at 2350 s with no
pass. Restart recipe (the 20 s preflight probe false-blocks on `local2`, stated not hidden):
`set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --no-probe --yes-pm-wakes --max-duration 3600`.

**Blocker:** none for the milestone. Two things are owed by others, neither of them build work: (1) **#7660** is OPEN
in the pool with `requires: "docs"` and no seat advertises `docs` — only its author `lead` or a coordinator can clear
it (`revise_work({itemId: 7660, requires: []})`); `check rig.selfdev.json` reports `pool-dead-gate` until then and
every pass logs it by id. (2) The four operator rulings below.

**Operator decisions owed** (full options/pros/cons in `docs/reviews/2026-11-13-capability-ownership-ruling.md`):
(1) what `ownership` is FOR — advisory (recommended, plus a `check` that names disjoint owner/claimant pairs) or
enforced at claim; (2) `devtools` vs `code` — split the `src-tools-harness` artifact class and/or grant `code`
(recommended: split the class first); (3) should `send_work` refuse a `requires` set no seat advertises (recommended:
no — warn, keep `check` red, let the author repair; **#7660 is the live example**); (4) a pool claim still does not
notify the row's `from` (recommended: annotate the author's own `peek_queue` instead of adding a notice row). The
roster (`capabilities`/`edges`/`ownership`) was READ-ONLY to this goal: `git diff rig.selfdev.json` is empty outside
the size fields `up --refresh` wrote.

**Cost:** **$0.00** — every model call this window went to the loopback provider (priced 0/0); the spend ledger is
unchanged. Wall clock shape: the pool build was ~3 h of the window; the two broker windows cost ~40 min of waiting for
seats; the suite is ~131 s at `--jobs 4`. **Speed-up worth adopting:** `node .spike/pool-rows.mjs` (0.8 s) answers
"what is the pool doing" in one read — promote it into `tools/pool-census.mjs` rather than retyping it (it is gitignored
in `.spike/` today, so it is lost next session).

**Traps this window** — `docs/SELFDEV.md` next `## Operational pitfalls` block: (a) a broker-served read and the
no-broker fallback can return **different shapes for the same view** (`seats` = list vs document) and the consuming
tool silently empties its roster **while still printing balanced arithmetic** — measured 268 vs 0 migratable on the same
store; (b) `up --refresh` records `usableWindow: null` when the window is declared on the provider spec rather than
`DURIG_CONTEXT_WINDOW` — the gate then reads "armed" in the config and "disarmed" in the data; (c) the 70 % gate can be
armed and *unexercisable* when only one tier exceeds it, so "the gate is armed" is not "the gate has fired".

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
