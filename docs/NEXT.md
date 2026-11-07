# NEXT.md — current state and next actions

**Last update:** 2026-11-07T07:2xZ (delegate session **N4** — the operator answers all five open items and adds a
standing directive, verbatim: **"1. I pushed"** → `main` **==** `origin/main` at `5bec571b`, the push ask is closed;
**"2. (b)"** → the verifier wake loop gets a **mechanism, not prose**: do not re-wake a seat whose submission is
`placed`-but-suppressed (**#5407**, `impl`, sibling of #5215/#5373, explicitly not a twin); **"3. (b) now, (a)
after."** → fix **teardown** first through the ROADMAP 311 carriers (**#5408**, `devtools`), the hygiene/reaping pass
is authorized only afterwards; **"4. I approve A. If we are going to have a daemon, it should be a the OS-based KDE
one, but only after the default implementation."** → **D227 sub-decision A is RULED** (0600 file at a rig-owned path =
the recommended backend; **KDE KWallet** = the first optional backend, only after the default lands; Vault stays at
342's spike) and is carried by **#5412** (`held`, parked behind **#5320**); **"5. Agreed."** → **one** digest of the
nine rows parked on the operator, not 171 (**#5409**, `pm`); and **"Please take action to lower risks that is
low-hanging fruit after this milestone is finished."** → ranked as **#5410** (`pm`). One bounded pass delivered all of
it (intent applied 06:44:11Z, `delivered:true`), and `lead` answered the same hour by minting **#5407–#5412** while
`pm` minted #5405/#5406. Recorded as **D229**. Session N3's pointer moved VERBATIM to `docs/NEXT-ARCHIVE.md` in this
cut.) The live file is a pointer, cap 200 lines (`demo/next-pointer.test.mjs`) **and ≈16.9 KB** — the digest cap is
bytes, not lines (`demo/clockin-digest.test.mjs`, `docs/runbooks/session-start-cost.md` §19).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**AS OF 2026-11-07T07:2xZ (delegate session N4) — read this block first; where it disagrees with the blocks under it,
this block is the measured current state.**

**Current item:** the milestone the operator named — **ensuring LLM task completion** (D226) — and its first buildable
tranche, **ROADMAP 331**: **#5306** (plumbing) + **#5309** (values) + **#5310** (verify) + **#5395** (the landing entry)
+ **#5308** (promote the band/floor probes **inside** 331), all `queued`; then the credential build in the order D227-A
now fixes: **#5320** (334 interface + the 0600 default) → **#5412** (the KWallet optional backend, `held` behind #5320,
built only after the default implementation). **#5277** (338, the auth check) is **terminal at close** — devtools' row
#5417 reports it DONE, but the delegate did not gate that completion's artifact: re-check it before planning on it. Read `docs/reviews/task-completion-milestone-intake-2026-11-07.md` §6/§8 before claiming: bands
are **absolute per family**, never the source doc's 130k-token bands.

**Blocker:** 7 of 12 seats cannot be woken, and they own the milestone's build rows — and the previous pointer's "no
blocker" line is now false on this point. `tools/seat-turn-shape.mjs` measures the counted
projection ending on `user` for **pm (4), impl (3), qa (3), scribe (3), architect (3), advocate (1), designer (1)** —
a strict alternating template refuses another user turn *before any window is reached* (these contexts are small: pm
0.4546, impl 0.2402, qa 0.1284 of 200,000 — this is **not** a window problem). Consequence, measured in one bounded
pass: the broker admits the wake, the run never starts, and `status` prints `admitted_not_started`; **5** such notices
were live at 06:5xZ, plus `pass-failed 100% (band 1)` and `repeated_failure pm — 3 consecutive failed runs; the
supervisor escalates it to the human`. `node cli.mjs resume` clears the notices (6 stranded submissions, all
`run-cancelled`) **but withdraws the submission, not the `pi.user` entry** — the projections still end on `user`
afterwards (they grew to 4/3/3/3/3). `impl` owns **#5306 + #5309** (ROADMAP 331) and **#5407** (the operator's own
wake-gate answer); `pm` owns **#5409/#5410**. So **milestone 331 cannot run until a `reset` with a handoff draws a
boundary** on those seats — that is what the Blocker line means, and it is the first thing to settle. The repair is
previewable for free and I ran every preview: `node cli.mjs reset <seat> --dry-run` (note the argument order —
`reset --dry-run <seat>` answers `{"wouldReset":false,"reason":"unknown-seat"}`) returns **`wouldReset: true, writes: 0`
for all seven seats**, so no live lease blocks it and the operator's answer is one command per seat, e.g.
`DURIG_DB=./selfdev.sqlite node cli.mjs reset impl "<handoff naming rows + trunk sha>"`. Until then, the five sendable
seats (`lead`, `devtools`, `auditor`, `security`, `qa2`) still work, so the cleartext-credential fix (**#5366**/#5334,
`devtools`) and **#5408**/**#5411** are not blocked by this — the milestone rows are. `lead`'s recommendation, which I did not overrule: land or explicitly abandon the claimed
rows first (impl holds 8: 3128 4973 5030 5177 5212 5215 5219 5221; pm 7; devtools 4; qa 5; scribe 5; lead 3;
architect 1), then `reset` at a quiet boundary with a handoff naming rows + trunk sha
(`docs/runbooks/session-start-cost.md` §22 — `reset` works, `compact` returns `no-op`). **This is the operator's call,
not a delegate's: it is a decision about in-flight context.** Do not start another broker pass before it is settled —
each pass deposits more stranded submissions and more metered `auditor` wakes.

**Run first (exact, in this order; all free):**

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node cli.mjs status                    # attention kinds; expect last_run_failed + repeated_failure, not admitted_not_started
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs | grep -E "^seat |counted projection" | paste - -   # wakeable now: lead, devtools, auditor, security, qa2 (5/12) — #5366/#5334/#5408/#5411 are devtools-carried and CAN move first
node tools/broker-serve.mjs --status                             # spool depth, 6 dead letters, provider posture
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status   # with the keys: 0 blocking findings (measured)
node scripts/test.mjs --area docs && node scripts/test.mjs --area guard     # both green at 5bec571b; re-run after any doc edit
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit            # 41 total / 12 reapable at close; reaping is the operator's grant and comes AFTER #5408
```

**Do not hand-query the store, and do not read `docs/SELFDEV.md` whole** — `docs/runbooks/session-start-cost.md`
prices the cheap reads (the wake-wedge read is now §23 there); the pitfalls block for this session is **83–88** at the
foot of `docs/SELFDEV.md`.

**(A) WHAT THE OPERATOR RULED THIS SESSION, and where each answer now lives.** (All five are recorded as **D229**.)

1. **Push — closed by the operator.** `git status -sb` → `## main...origin/main` and
   `git log --oneline origin/main..main` prints **nothing**: both at `5bec571b`. Do not re-ask; this cut's own commit is
   reported as a new unpushed one.
2. **(b) — the wake loop becomes a mechanism.** Routed as **#5407** (`impl`, `queued`): stop re-waking a seat whose
   submission is `placed`-but-suppressed; `lead` set the acceptance bar — reproduce the red first, and prove the
   submission still eventually runs, because "fewer wakes" alone is a wedge with better manners. Measured cost of the
   leak, this session too: **`WAKE auditor` fired repeatedly while `SKIP auditor reason=pending` printed for the same
   seat every pass**, 16 metered rows = **$0.008080** in ~4 minutes of broker time; store cumulative **$0.473615**
   (1,143 rows, max single call $0.000902). Still no per-family cap exists (`durig.config.default.json:10-12` =
   per-call 0.05 / per-run 0.10 / per-store 4.00).
3. **(b) now, (a) after — teardown before hygiene.** #5408 (`devtools`) attaches the evidence to the 311 carriers
   (**#5236** live, **#5326** queued) instead of re-minting 311. Live specimen, still firing in `.spike/serve.err`:
   `complete_work: workspace cleanup for #5356 failed: refusing to remove worktree …/item-5356: junction/symlink
   detected at …/node_modules/.bin/anthropic-ai-sdk` — a package-manager symlink under `node_modules` making a
   completion permanently un-reapable, with `undefined/<name>` because `src/worktree.mjs` reads `dirent.path` (node v24
   renamed it to `parentPath`); there is no reap verb fed by `worktree audit`. A hygiene pass is **authorized only
   after** that lands, and `reapable` is a *liveness* verdict, not a content verdict — gate BRANCH cleanup, not the
   sweep (#5184, #5209).
4. **D227-A ruled (B, C, D still the operator's).** Recommended backend = the bare-bones **0600 file at a rig-owned
   path with explicit source attribution**; the first **optional** backend = the **OS credential service, KDE KWallet
   on this host**, landing **only after** the default implementation; Vault stays at 342's spike. Sequenced by `lead`
   as **#5412** (`held`, parked behind **#5320**). `impl`/`devtools` were told plainly that **B** (store key shape),
   **C** (precedence) and **D** (does a seat ever hold a value) are the operator's: a row that needs one defers that
   single question rather than picking.
5. **The digest — agreed and routed.** **#5409** (`pm`): the nine `deferred_awaiting_answer` rows — #4976 `pm`,
   #4354 `impl`, #3350 `qa`, #4881 `lead`, #4835 `scribe`, #4817 `devtools`, #4954 `auditor`, #4827 `security`,
   #4814 `qa2` — one line of question + what it unblocks + the cost of parking, **no recommendations**, and a
   cancel-able mark where the question is stale. I answered none of them.
6. **The standing directive** — #5410 (`pm`) ranks the post-331 risk reducers with an acceptance bar on each:
   **#5334/#5365/#5366** (cleartext `DURIG_*_API_KEY` **values** in `broker-serve --status`'s `env:` line — reproduced
   again this session; #5227's `done` was a false completion) → **#5308 rides INSIDE 331, not after it** (a sweep
   first would destroy the only instrument grounding the band values) → **#5397/#5393** → **#5398** (the digest is
   29,438 B against a 20,000 B budget) → **#5373** → **#5411** (make "which milestone is in flight" machine-visible,
   forward-only, must start green). The six dead letters are a **specimen attached, not minted**: all six are
   `op:"read"` health requests with reason `apply failed: SqliteStorage is closed` — **no operator intent was ever
   refused**.

**(B) RIG STATE at close (measured 07:0x–07:2xZ).** Queue: `done 3897 · cancelled 835 · held 367 · claimed 33 ·
deferred 172 · queued 115`. The 32 passes also let `pm`/`devtools` mint **#5413–#5419** (verify, read-only extraction and
routing rows), so the queue delta in (C) is not all `lead`'s. Attention: `deferred_awaiting_answer 9` (one per seat, all listed above),
`last_run_failed 5` (pm/impl/qa/scribe/architect, detail `aborted`), `idle_with_queued_work 4` (lead 22 queued,
devtools 16, auditor 1, qa2 1), `repeated_failure pm`, `pass-failed 100% (band 1)`, `queue-ageing 1781.7 min
(band 30)`. `check rig.selfdev.json` **with** `--env-file`: exit 0, **144 fix-now** (85 `citation-unresolvable`, 57
`duplicate-item`, 1 `verification-without-evidence`, 1 `evidence-tree`); family guards **green**
(`single-model-rig pass`, `no-verifier-seat pass`); the three `runbook-*` rules are still **skipped** ("no runbook
data was supplied"). Surface: **41 worktrees, 43 branches**, `worktree audit` → `{seat-root 8, live 16, reapable 12,
locked 1, non-item 3, dirty 1}` — **the bare-name inventory diffed empty across every writing verb this session**
(intent spool + one broker pass), so the leak meter did not grow here. Spool at close: 5 stale `op:"read"` intents
(from my own `status`/`ps`/`queue` reads while the broker was down) and the same 6 dead letters. Broker **down**,
broker state file cleared, `git status` clean apart from the docs this cut touches and the gitignored
`selfdev.sqlite.spend.jsonl`.

**(C) THE DELIVERY PASS, measured.** `node intent.mjs lead --body-file … --request-id
operator-answers-20261107T0700Z-lead` → spooled, applied at **06:44:11Z** (`delivered:true` in
`selfdev.sqlite.broker.inbox.out/`). `lead` answered (submission 325129 `done`, answer entry 325329) and minted
**#5407–#5412**; queue moved `queued 106 → 115`, `done 3895 → 3897`, `held 365 → 367`, `claimed 34 → 33`. The broker,
started at 06:44:11Z with **`--max-duration 240`**, was still alive at **28 min 07 s** when I stopped it by hand after
`ls -1 selfdev.sqlite.genlock*` came back empty — and it left `EXIT pid=1741684 reason=deadline passes=-` for a
**SIGTERM** stop, dropping the pass count — it had run **32 passes** (pitfall 74's mis-attribution, **fourth**
observation, row **#5215**; the overrun is **#5373**, do not mint a twin). Cost of the session: **$0.008080 metered (16 rows)** — all
of it `auditor`, woken while `SKIP auditor reason=pending` printed every pass, which is exactly what answer (2) buys
a mechanism for. `lead` could not mint **N1–N7** from inside the seat (`peek_queue` truncates at 417 lines and there is
no read path to `docs/reviews/ensuring-llm-task-completion-research.md`) — paste the seven headings into its next brief.

**(D) TRAPS** — `docs/SELFDEV.md` pitfalls **83–88**: the wake wedge (#85), `resume` is a write verb (#83), the un-keyed
`--status` posture prints four false provider BLOCKs (#87), read-verbs time out against a driving broker (#86).
