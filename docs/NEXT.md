# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T07:3xZ = **2026-10-30 02:3x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is
**Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session.
The superseded 153-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (entry marker at line 8265, body 8266–8422).

**217 IS AUTHORED AND VERIFIED — IN A WORKTREE, AND IT HAS NOT LANDED.** Seat `impl` wrote `src/shellregistry.mjs` (new) and rewired
`src/seattools.mjs` + `src/seatguard.mjs` + both demo suites in `/home/chexxor/Git/durian-dev/seatroot`; the delegate ran the oracle
and the portability gate went **2 findings → 1** there (`seat-shell-availability` gone, `seat-host-unaware` survives as 217's schema
half, **#4879**). From the live checkout the gate still prints 2, because `main` does not carry the change — *that difference is the
measurement*. Full details and the why are in **D173**; the queue row is **#4849**, status **claimed**, deliberately **not closed**
(lead's rule #4866: a seat without an oracle may author, may not close).

**THE VERIFIER LEG OF THE RATIFIED LOOP IS DEAD ON THIS HOST, MEASURED.** Two `send qa` attempts (~7k-char brief, then 1.1k-char)
both returned `settledReason: model_error` with **no reply**, and the mechanism is pinned by a direct request to the served model:
`exceed_context_size_error: request (9129 tokens) exceeds the available context size (8192 tokens), try increasing it`. The verifier
slot is **n_ctx 8192**; `compact qa` fails too (`no compaction entry was written`) because compaction needs the same window. This
upgrades ROADMAP **208** from a design concern to a hard failure: **impl authors → delegate runs the oracle → qa reviews** works for
two legs and not the third, and all five verifier-family seats (`qa, qa2, advocate, auditor, designer`) are on that same slot, so
there is no substitute leg on this box. Raising it is a host-side model-serving change on a GPU already at 22.6/24.6 GiB —
**operator's call**, and per `runbooks/local-provider-down.md` it is never an `up --refresh`.

## NEXT SESSION

**Current item: close the verifier leg, then land #4849, then let the class resume in lead's order (217 → 263 → 264 → 221/265 → 266
→ 267).** Nothing may land while #4849's verifier is unreachable, and nothing may be authored by a seat that cannot run its own
done-condition until 217 is on `main`. Two delegate-side facts gate that: (1) the seat root has **no `./durig.config.json`**, so
`demo/local-model-pointer.test.mjs` refuses there and the audit prints "a moved workspace has no host config at all"; (2) the root
is a **detached** worktree, so `demo/clockin-digest.test.mjs` dies on `git rev-list --count main..(no branch)`. Both are tree-shape,
not code — but until they are fixed, a seat working in the approved root cannot get a clean suite, and the suite is the constitution's
oracle.

**Archive:** everything superseded by this cut is verbatim in `docs/NEXT-ARCHIVE.md` (entry marker line 8265, body 8266–8422); the
grants 1–7 and the older do-not lists live there, not here.

**Next commands (delegate, read-only first, in this order; Linux):**

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs queue            # #4849 MUST still be `claimed`, not `done`; #4879/#4882/#4883/#4884/#4885 MUST be held
DURIG_DB=./selfdev.sqlite node cli.mjs status           # attention notices; qa2 escalated `reason=degeneration` earlier and no seat has been reset
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit   # 2 registered worktrees; `reapable: 0` is NOT a verdict (266)
node tools/rig-portability-audit.mjs                    # run from the LIVE checkout: 2 findings (both 217). Run from the seat root with --db/--rig: 1 finding. Read both; one number is not the state.
node tools/roadmap-queue-coverage.mjs                   # CLAIMABLE 21, claimed 1; items >=200 with no row naming them: 52
node tools/broker-serve.mjs --status                    # broker DOWN; BLOCK seat-shell-availability persists until 217 lands (it has no remedy and NO ack flag)
curl -s http://127.0.0.1:1234/v1/chat/completions -H 'content-type: application/json' -d '{"model":"mistralai/ministral-3-14b-reasoning","messages":[{"role":"user","content":"x x x <9000 tokens>"}],"max_tokens":8}'   # the 8192 wall, in one command
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs   # the clock-out trio, always all three
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'   # 0 (GRANT 3 held); refs/rescued 484 — read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**To resume the loop once the verifier window exists:** re-send the pinned review brief to `qa` (`.spike/repoint-20261030/send-qa-4849.md`
+ the evidence copy at `/home/chexxor/Git/durian-dev/seatroot/.spike/review-4849-evidence.md`), then route the verdict to pm for the
landing act. **Channel:** `cli.mjs send <seat> --body-file <file>` remains the only wake on this host (a broker start is refused on
`seat-shell-availability`, which carries **no ack flag** — `--yes-pm-wakes --ack-coordinator-wake --allow-dirty --yes-stale-cwd` do
not touch it), and it must run with **`DURIG_SEAT_ROOT` unset** until #4882 lands: the guard checks EVERY seat, and `pm`/`lead` are on
the live checkout because `complete_work` moved them there.

**Blocker:** three, none mine to lift. **(a)** The verifier slot is n_ctx 8192 — a host-side serving change (GPU1 22.6/24.6 GiB), so
the operator holds it; until then no seat can verify anything. **(b)** 52 registered items ≥200 still have no row naming them
(`236–238`, `243–252`, `254–255`, `258–262` among them). **(c)** The operator holds the research prompt
`docs/reviews/seat-scoped-durable-state-research-prompt.md` — it must be routed to the off-host research agent, and its landing is the
trigger for **#4885**.

## What landed this session, with its evidence

- **lead ruled #4858**: **217 → 263 → 264 → 221/265 → 266 → 267**, 232 gated on #4846; adopted #4844 with the amendment *an
  unreadable verdict renders `unknown` and never collapses to `up`*; #3743 (does the process exist) and #4844 (is it making progress)
  stay separate axes — **ALIVE-and-FAILING is legal**. It could not execute its own gate: `release_work(4849)` was refused to the
  adjudicator ("only the sender or recipient may release it") → **#4867**, third member of the #3570/#4856 gate-authority family.
- **pm re-gated and executed it**: released #4849 (as sender), cancel-and-re-minted the stale-premise rows (#4847→**#4874**,
  #4850→**#4876**, each required to *manufacture* its RED rather than lean on a broken host), split the schema half as **#4879**,
  routed the adopted parked-question answers as **#4869/#4871**, registered the instrument defects as **#4872/#4873**, the phantom-dir
  dispositions as **#4878**, and the root-decay family as **#4882/#4883/#4884**. It also named two traps: #4852 is gated on the now
  -cancelled #4847 (re-mint at its turn, never release), and it cannot re-park #3350.
- **impl authored #4849** after its first turn died on `stopReason: length` with **zero files changed** (it had drafted the whole
  registry in prose). The corrective was one short directive — *apply, do not re-derive, one `edit` per hunk, no code in prose* — and
  the second turn settled with `stopReason: stop` and 5 files changed. Its own report flagged that 217's two findings will not both
  close without the schema row, which the audit confirms.
- **The delegate's verification** (all commands and outputs in `D173` and `.spike/repoint-20261030/`): GREEN on
  `demo/seattools/seatguard/ctxline`; **RED verified** by reverting the two `src` files and moving the new module aside —
  `seatguard.test.mjs` fails on a substantive assertion, `seattools.test.mjs` fails **only by a missing import**, and *whether that
  counts as failing-first is an open question a verifier must answer, not the delegate*; files restored byte-identically
  (`sha256sum -c` OK). Suite 238×2: `main` 4 fails, seat root 3, divergences attributed to the missing host config and the detached
  HEAD. **No regression attributable to the change.**
- **The architecture ruling** (operator): do not split per seat; research it. Registered **#4885** (architect, trigger-gated), prompt
  committed at `docs/reviews/seat-scoped-durable-state-research-prompt.md`.

## Rig state, re-measured at clock-out 2026-10-30T07:3xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (last full backup `.spike/repoint-20261030/store-backup-20261030-005816.sqlite`); 12 seats; **`pm` and
`lead` are on the live checkout, the other 10 on the approved seat root** (root decay, D173). **Queue census 4,885 = 3,756 done / 780
cancelled / 311 held / 20 queued / 17 deferred / 1 claimed → CLAIMABLE 21** (the 1 claimed is #4849). **Broker DOWN, deliberately.**
**Portability gate:** 2 findings from the live checkout, 1 from the seat root; `--self-test` exit 0. **Worktrees: 2**; `reapable 0`;
`refs/rescued/*` 484; unreachable 0; phantom-named dirs at repo root 0; tracked changes 0 at clock-out. **Providers:** `local/iq3_s`
(GPU0 12.6/16.4 GiB) — pm, impl, lead, scribe, devtools, security, architect; `verifier/ministral-3-14b-reasoning` (`:1234`, GPU1
22.6/24.6 GiB, **n_ctx 8192**) — qa, qa2, advocate, auditor, designer. Both providers answer and complete a *tiny* probe, which is
exactly why a port probe is not a health check. **flint NOT loaded** (8,192 ctx cannot hold a real conversation, 208). **Supervisor:**
last window logged `reason=degeneration` for `auditor, devtools, qa2` — pre-existing, UNVERIFIED, no seat reset;
`runbooks/degeneration-guard.md` is the entry point. **Box:** 94 GB RAM, ~19 GiB available, zram swap ~58 % is the ceiling;
`probe-preflight` REFUSES (swap max 50 %), so no probe arm may start. **`LocalRTC=yes` on a dual-boot box** while every gate is
`Date.now()` arithmetic — `timedatectl set-local-rtc 0` is host-wide, operator's call (ROADMAP 234).

## OPERATOR GRANTS (seven through D172; two more this session)

1–7. Unchanged from the archived pointer (seat-root ruling A; the "queue drains" predicate; mint the refs; instrument hygiene; the
verifier paths; decomposition-not-seats with the scale gate; the Linux isolated seat root).
8. **The `send` bootstrap is sanctioned for this rig while the broker is un-startable** — `cli.mjs send pm|lead|impl|qa --body-file …`.
It is deprecated as a second harness owner and admissible only because no broker runs; a working seat's turn writes real files, so the
delegate runs the oracle and no seat closes its own row on a degraded host.
9. **Do not re-architect per seat; research it.** The delegate crafts the prompt, the operator routes it, the delegate lands the report.

## Do not "fix" these on the strength of the docs

**A provider that answers a 26-token probe is not healthy** — the verifier is alive and unusable at 8,192 tokens; probe with a *real
request size*. **Brevity does not fix a window**: qa failed at 1.1k characters too. **`compact` cannot rescue a seat whose window is
the wall.** **`pgrep -f "cli.mjs send …"` matches the shell that asked** — it lied "RUNNING" three times tonight; test the process
line or the JSON's `stopReason` instead. **Running any instrument inside a worktree silently changes the rig it measures** — no
`./durig.config.json`, no store, detached HEAD: `rig-portability-audit` there read an EMPTY store and printed clean roots. **The
portability audit is blind to the `complete_work` root decay** (#4884 is the carrier for that). **`complete_work` re-points a seat's
persisted cwd to `process.cwd()`** — never treat a re-point as durable before #4882. **A `--dry-run` that names no removals is not
evidence there are none.** **Never read an exit code through a pipe.** **Append prose with a quoted heredoc + `cat >>`, not `printf`**
(parentheses in the text abort the shell). **A promoted instrument is "cited but untracked" until you stage it.** **Never quote shas.**
