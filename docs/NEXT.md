# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T06:2xZ = **2026-10-30 01:2x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is
**Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session.
The superseded 162-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (entry header at archive line 8102, body
8103–8264).

**THE HOST IS ADDRESSABLE NOW — AND ONE ITEM IS ALL THAT REMAINS.** The operator ruled the cross-host deadlock gets broken
**here**, not on the Windows box (grant recorded as **D172**): an isolated Linux worktree of `main` at
`/home/chexxor/Git/durian-dev/seatroot`, created with `node cli.mjs worktree`, deps installed offline (`npm ci
--prefer-offline`, **4.4 s**), pinned pi linked (`scripts/sync-pi.mjs --link` → 9 `@earendil-works/*` links), and the oracle
**verified runnable there by the delegate** (`demo/next-pointer`, `demo/seattools`, `demo/ctxline` each exit 0). The 12 seats
were re-pointed at it. **`node tools/rig-portability-audit.mjs` went 15 findings → 2, and both survivors are ROADMAP 217.**
The 12 `seat-root-unresolvable` findings are gone, and the **232 `seat-root-unmatchable` finding cleared as a side effect** —
the stored roots now match a *registered* worktree under the guard's exact normalized equality, so the `seat-root` keep-reason
is reachable on this host for the first time since the machine move. No phantom `C:\…` directory can be written again unless
the store goes foreign (the filesystem name-scan is still the only instrument that sees that class).

**AND THE ACK THIS RIG MINTED YESTERDAY IS INERT — measured, not inferred.** `tools/broker-serve.mjs:322` computes the
coordinator-ack wake set as `pending.filter((p) => p.to !== "?" && p.op === "?")`, i.e. only spool files with **no `op`
field**. The product's own producer `intent.mjs` writes `{"op":"message", …}`, and the broker defaults a missing op to
`"message"` (`src/broker.mjs:421`). So with the spool holding exactly two coordinator messages, `--dry-run --yes-pm-wakes
--ack-coordinator-wake --max-duration 600` is **REFUSED** on `seat-shell-availability` with **no admissibility suffix** —
the computed wake set is empty, so the ack can never be measured admissible. D169's remedy ("record the operator's ruling,
do not bypass the guard") is therefore unexecuted in practice. Fix is one seam — ask the broker's own op-resolution what the
op is — and it must be failing-first, not a fourth hand-rolled filter.

## NEXT SESSION

**Current item: choose the channel that wakes ONLY the coordinators, so lead can rule #4858 and `pm` can re-gate the 16
claimable rows to that order.** There is now a second, independent reason a broker start must refuse even after the ack
filter is fixed: with 16 claimable rows spread over 10 seats, the first-pass wake set is **not** coordinator-only. The
product's own `toolRemovalsFor` removes the shell from **`pm` and `lead` only** — `architect`, `designer`, `advocate`,
`auditor`, `security`, `scribe`, `devtools`, `impl`, `qa`, `qa2` all **keep** it (`review` and `security` are
WORKING_CAPABILITIES, so "coordinator" is NOT a name for architect/designer/advocate/auditor/security; seat `capabilities`
in `rig.selfdev.json` decide it, not the seat's name). **`cli.mjs pause` is rig-level only** (`to: null`, one control doc),
so there is no per-seat gate to lean on. The only bootstrap that wakes exactly the two coordinators is
`node cli.mjs send <seat> --body-file <file>` **with no broker running** — deprecated as a second harness owner, and
admissible only for exactly that reason. Briefs are already written and spooled:
`.spike/repoint-20261030/brief-pm-20261030.md`, `.spike/repoint-20261030/brief-lead-20261030.md` (rids in that directory).

**Ordering stays the team's verb.** lead's **#4858** (`queued`, `lead`-addressed, claimable) is the landing plan the class is
missing: **263 → 217 → 264 → 221 + 265 → 266 → 267**, **232 gated on the 241 note (#4846)**. The delegate put ONE measured
question in front of lead rather than deciding it: since the re-point, 217 is the *only* finding this rig's instrument
reports, and 217 is what stops every author from running its own oracle — so may **#4849 (217)** be released AHEAD of
**#4847 (263)**? 217 changes the seat-shell **registry** (`src/seattools.mjs`, `src/seatguard.mjs:122`, and
`demo/seattools.test.mjs:30` which asserts the no-bash choice and must be rewritten failing-first) and does not touch path
resolution, so it arguably does not fork 263's seam. If lead holds the order, it must name the mechanism by which 263's
author runs any check on this host at all.

**Blocker:** three, none mine to lift. **(a)** The sanctioned channel's gate is broken (above) and no coordinator-scoped
broker start exists while the claimable head stands — the operator has the channel question. **(b)** 53 registered items
≥200 still have no row naming them (`236–238`, `243–252`, `254–255`, `258–262` among them). **(c)** OWES 2 (which verifier)
is unanswered and `probe-preflight` still **REFUSES** (swap 58 %, MemAvailable 17.3 GiB, GPU1 95 % full — strata holds
51.1 GiB RSS), so no verifier arm may start.

**Five rows are `deferred` awaiting a HUMAN answer** — **#4813, #4354, #4816, #4817, #4814** (oldest parked 315 h;
`queue-ageing 62.9 min`). The delegate recommended answers (below, §PARKED QUESTIONS); **the operator's adoption is what
makes them answers.** Do not deliver them as rulings until adopted.

**Next command (delegate, read-only first, in this order, ~40 s total; Linux):**

```bash
node tools/rig-portability-audit.mjs              # MUST be exit 1 with exactly 2 findings, both 217; --self-test exit 0. 12 seat-root-unresolvable ⇒ the store's roots went foreign again.
node tools/roadmap-queue-coverage.mjs             # CLAIMABLE 16; 68 items >=200, 15 named / 53 no row. The instrument that proves the wake landed.
node tools/broker-serve.mjs --status              # broker DOWN. BLOCK seat-shell-availability; spool holds 2 coordinator messages + 2 stale `?` read intents (>1 h).
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit   # 2 registered worktrees; `reapable: 0` is NOT a verdict (266)
git worktree list --porcelain | grep '^worktree ' # MUST show 2: the live checkout + /home/chexxor/Git/durian-dev/seatroot
ls -A | grep -E '^[A-Za-z]:|\\|dsh-Projects'      # MUST print nothing (git status cannot see `.durig/` leaks at any depth)
DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # the ONLY surface that prints a seat's persisted cwd; must show changes:{} for 12 seats and no model resets
node tools/model-probes/probe-preflight.mjs       # REFUSE: swap 4.7/8.0 GiB. Any allowed arm: node tools/model-probes/capped-run.mjs --node-mem-max 6G -- <cmd>
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 0 (GRANT 3 held); refs/rescued 484 — read docs/runbooks/cross-clone-object-recovery.md before anything runs `git gc`
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs   # the clock-out trio, always all three
```

**To execute the channel ruling once the operator picks it** (recommended: `send`, because a broker start cannot be scoped
to coordinators while 16 rows are claimable):
`DURIG_DB=./selfdev.sqlite node cli.mjs send pm --body-file .spike/repoint-20261030/brief-pm-20261030.md --request-id <rid in .spike/repoint-20261030/rid-pm.txt>`
then the same for `lead`. `send` **blocks until the whole generation settles**; a harness timeout that kills it strands the
seat (`runbooks/broker-safe-change.md`). Delete the two stale `?` read intents from `selfdev.sqlite.broker.inbox/` before a
start if a broker is ever chosen — they are >1 h `op:"read"` requests, not intents, and they pollute the wake line.

**PARKED QUESTIONS — delegate recommendations, pending the operator's adoption** (all grounded this session, no queue verb
touched):
1. **#4816 (pm→lead, the `brokerHealth`/`pass-failed` shape).** It is already answered twice and needs a SHAPE, not an
   answer: lead ruled it at **#4822** (it is the GAP, not the contract; halves **#4819** defect = split attempt-time from
   last-good-pass-time, **#4820** wiring = an attention row), and pm's own operator-approved row **#4844** is queued to lead
   (`lastPassOkAt`/`lastPassAttemptAt`, `up`/`stalled`/`failing`, `pass-failed` as an ARGUMENT to the verdict). **Recommend:**
   adopt #4844 verbatim, and `resume_work 4816` → complete citing #4822/#4844. Do not re-defer.
2. **#4813 (impl→pm, the notice assertion).** **Recommend: close as answered-by-ruling, not built.** impl's refusal to write
   the assertion was right — an idle rig cannot emit `pass-failed` at all, so a demo would pass because the mechanism does
   not exist; the assertion belongs in **#4820**'s demo. impl's "stray count of 8 was wrong, I over-reported by NAME"
   correction stands and is now closed by the measurement below.
3. **#4817 (pm→devtools, re-measure the landing gate).** **Recommend: hand devtools the re-measured numbers and let them
   land exactly one branch** (measured on `main` at this clock-out): `git log --oneline 910fac7..HEAD | wc -l` = **554**
   commits; registered worktrees = **2**; stray `item-*` directories at the repo root = **0 by name AND by registration**
   (so the ten plain directories are gone and the gate question they were waiting on has no strays left); `land.mjs` lives
   at **`scripts/land.mjs`**, not `tools/`. The honest test of "does it still refuse" is one real landing, then confirm
   `main` moved, then stop — never a batch.
4. **#4814 (pm→qa2, re-measure with the sha).** **Recommend: close it.** Re-measured on `main`: `docs/NEXT.md` = **162
   lines**, `docs/NEXT-ARCHIVE.md` = **8,264** lines — neither the scribe's 157 nor qa2's 186, because the pointer has been
   re-cut twice since; both prior numbers were correct for their own trees. Any future count names its tree and command.
5. **#4354 (pm→impl, name rung 9→10 + the ONE intersection fixture).** **Recommend: unblocked, but hold it until 217
   lands.** Its blocker is clear — designer's **#4352 is `done`** and its re-derived §4 (NAME rung 10, "rung ≥ longest seat
   name + 1", fixed 34→35) is in `docs/reviews/designer-landing-screen-spec.md`; and the work is genuinely owed, since
   `src/tui/client.mjs:238` still reads `pad(truncate(sanitizeTerminalText(seat.name), 9), 9)` and the intersection fixture
   (`architect4q · 175p`) exists in no demo. It is a failing-first golden-and-goldens change, which no seat can prove here
   while 217 stands.

## Rig state, re-measured at clock-out 2026-10-30T06:2xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (backed up at `.spike/repoint-20261030/store-backup-20261030-005816.sqlite`); **12 seats**, all
12 now resolving to `/home/chexxor/Git/durian-dev/seatroot` (one shared root — the F21 compromise, see D172 §4).
**Queue census 4,861 = 3,748 `done` / 778 `cancelled` / 301 `held` / 16 `queued` / 18 `deferred` → CLAIMABLE 16.**
**Broker DOWN, deliberately** — the start was refused on the broken gate, and no coordinator-scoped broker exists while the
claimable head stands. **Portability gate: exit 1, 2 findings (both 217); `--self-test` exit 0.** **Worktrees: 2**
(this checkout + the seat root); `reapable 0`; branches 2; `refs/rescued/*` 484; unreachable 0; phantom-named dirs at repo
root 0. **Pre/post name-diff over worktrees + branches + `.spike`: 4 added lines, zero deletions.** **Live tree: 0 tracked
changes.** **Providers:** `local/iq3_s` (strata, GPU0) — pm, impl, lead, scribe, devtools, security, architect;
`verifier/ministral-3-14b-reasoning` (`:1234`, GPU1) — qa, qa2, advocate, auditor, designer; **both answer and complete**.
The store's stale `local/iq3_s` for the five verifier-family seats was reset by the re-point (D172 §4a). **flint NOT
LOADED**; 8,192 ctx cannot hold a real verifier conversation (208). **Supervisor:** the last window logged
`reason=degeneration` for `auditor, devtools, qa2` — pre-existing, UNVERIFIED here, no seat reset;
`docs/runbooks/degeneration-guard.md` is the entry point. **Box:** 94 GB RAM, 17.3 GiB available, **zram swap 4.7/8.0 GiB
(58 %)** is the ceiling; GPU0 12,648/16,376 MiB, GPU1 23,468/24,576 MiB (95 %); strata holds 51.1 GiB RSS.
**`LocalRTC=yes` on a dual-boot box** while every broker gate is `Date.now()` arithmetic — `timedatectl set-local-rtc 0` is
host-wide, so it stays the operator's call (ROADMAP 234).

## OPERATOR GRANTS (six from 2026-10-29, D165; the seventh this session, D172)

1–6. Unchanged from the archived pointer (seat-root ruling A; the "queue drains" predicate; mint the refs; instrument
hygiene; the verifier paths; decomposition-not-seats with the scale gate). **Grant 6's scale gate now has a cheaper
rehearsal available:** `impl` authors 217 in the isolated tree with `write`/`edit`, the delegate runs
`demo/seattools.test.mjs`, `qa` reviews by reading — 2 seats, oracle run by the delegate.
7. **NEW — this host, not the Windows box.** Isolated Linux worktree of `main` as the seat root; `up --refresh` under
`DURIG_SEAT_ROOT` applies it; the five model resets and the one shared root are its accepted costs. **Nothing from the
isolated tree lands on `main` without a landing act, and no landing runs while a wake window is open.**

## Do not "fix" these on the strength of the docs

**A `BLOCK seat-shell-availability` is not advice to bypass it** — but it is also not proof the start is unsafe: check
whether the finding is *computing* anything. `--ack-coordinator-wake` currently never can (the `op === "?"` filter above).
**A broker start is not coordinator-scoped just because you addressed coordinators** — the queue's claimable head decides
who wakes. **`pause` is rig-level**; there is no per-seat gate. **"Coordinator" is a capability verdict, not a seat name** —
`review` and `security` keep the shell. **A `--refresh` without `DURIG_SEAT_ROOT` exported repairs nothing about the root**
(it writes `cwd` only when defined, `cli.mjs:679`), and `--refresh` is all-12 at once and applies model resets you did not
ask for — read its `wouldReset`. **`vendor/pi-main` is gitignored, so a new worktree has none**: copy the built one
(723 MB, 2 s) and run `sync-pi --link` rather than rebuilding the pin; `npm ci --prefer-offline` is 4.4 s offline, not the
~12 s quoted in the code comment. **`git status` cannot see `.durig/` leaks** at any depth; scan the filesystem by name.
**A `--dry-run` that names no removals is not evidence there are none.** **Never read an exit code through a pipe.**
**A promoted instrument is "cited but untracked" until you stage it.** **Append to a growing file with `>>`; never rewrite a
file from its own contents** (D170) — and **diff names, not counts**. **Never quote shas.**
