# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

## NEXT SESSION (2026-11-01T19:0xZ — D188 daytime, Linux: `item-4966` is LANDED — fix the verifier window, then the `qa` leg, then `scribe`'s re-arm)

**History:** everything this pointer supersedes is kept **verbatim** in `docs/NEXT-ARCHIVE.md`; re-derive the cut from
`git log --oneline -- docs/NEXT.md` — never re-point by hand.

**Current item:** **#4966** (persona files) **was LANDED by the delegate** on `lead`'s ruling and the operator's
standing grant: `node scripts/land.mjs item-4966 --db …/selfdev.sqlite` → **exit 0**, `main` = **`986a9e37` "merge: land
item-4966 onto main"**, `git merge-base --is-ancestor refs/heads/item-4966 main` **exit 0**, tree clean, and
`seatroot/linux` fast-forwarded to the same sha — so the 12 `prompts/<seat>.md` files are now IN the approved root
(F5: a root left at an older main silently loses a seat's persona). Open around it: **#4974** (the `qa` verify leg, still
`queued` — `lead` cannot park a row it minted and the delegate must not touch queue rows, so **#4982** (`impl`) or `pm`
must move it), **#4970** (revised to "HALF B": the config-authoritative + bounding-policy questions, which are the
operator's), **#4981** (`architect`, compaction *legibility*, ungated), **#4983** (`impl`, `held`), **#4977/#4978/#4979**
(`devtools` instrument defects), **#4980** (`scribe` re-arm for its claimed **#4967**), plus a **fourth instrument
defect this session found** (below) that needs its own row.

**Exact next command** (delegate, from `/home/chexxor/Git/Durian-Pi`; read the suite result before anything else):

```bash
node scripts/test.mjs --red --all --json          # fast red list; compare against this session's baseline
git -C /home/chexxor/Git/durian-dev/seatroot merge --ff-only main   # rule 11: land, THEN re-point, THEN wake
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_LOCAL_CONTEXT=160000 \
  DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status   # a bare `status` RESUMES sessions
```

**Ready-to-send brief, and the seat-shape gate on the rest:** the `qa` verification brief for the merged tree is written
and un-sent at `.spike/fix-20261101c/qa-4974-verify.md` (gitignored — promote it to `docs/` or `tools/` if it must
survive a machine move; it demands artifact/tree identity — thin 80-package set vs the
full 187-package + `vendor/pi-main` set — and names the 8192/24576 finding). Whether to spend that wake before the slot
is resized is the operator's call, not the delegate's. `tools/seat-turn-shape.mjs` at clock-in said **ADMISSIBLE =
`impl`, `qa`, `lead`, `qa2`** and predicted a turn ending on `user` for **`pm`** — so the pm verb that would move
**#4974** is itself gated on pm's transcript shape, and a `reset` there destroys history. `scripts/clockin.mjs` after the
landing reports `refs=10 worktrees=9 unmerged=3` — `item-4898 +1`, `item-4931 +2`, and `wip/seat-prompt-files +1`
(`no-row`, the provenance branch #4966 was cut from; its content IS in main, the branch is not an ancestor).

**Blocker:** the verifier slot is loaded at **8192** (`--ctx-size 8192 --parallel 4`) against a declared
`DURIG_VERIFIER_CONTEXT 24576` — LM Studio restores `8192×4` on relaunch — so `qa`/`qa2`/`auditor`/`advocate`/
`designer` wakes die on the provider, not on their own work. `lead` cannot park **#4974** (`not yours to revise`) and
the delegate must not touch queue rows, so **#4974 stays queued against a 400-returning server** until the operator
resizes the slot or `pm`/`impl` (#4982) moves it. Second blocker: the broker has been down since
`2026-10-30T04:55:33Z`, so every delivery is a `send` = a second-owner writer; serialize them.

**Deferred rows audited, answers APPROVED, dispatch UNDER WAY (2026-11-01):** all **17** `deferred` rows (every one
`deferredTo: "human"`) were read from a `cli.mjs queue` dump and audited against today's tree; the proposal document is
`.spike/fix-20261101c/deferred-answers.md` (gitignored — promote it if it must survive a machine move). The shape of
the answer set: **5 re-cuts** of work that was reviewed, reported DONE and then lost only from `refs/heads/` — it
survives in **`refs/rescued/`** (485 refs: 33 named `rescued/item-<id>`, the rest `rescued/orphan-<sha>`), covering
#4791/#4794/#4799/#4801 plus the unlanded `idle` verdict at `refs/rescued/item-4746 @81be8985`; **5 still-live builds**
(#4789 the missing `deferred` stage — `src/queue-lifecycle.mjs:20` still has three stages, #4796 wake transition-memory,
#4797 the holder-named refusal, #4354 and #4812 with a mandatory premise re-measure because their premises no longer
reproduce); **5 that only need a CLOSE** because measurement answered them (#4817 gate re-measure, #4814 pointer
numbers, #4813 the notice-is-a-third-thing finding, #4815 landed-by-content, #4805 cancelled-duplicate with survivor
#4136). Delivery is `send`-only — `cli.mjs` has no operator queue verb — so `impl` (ADMISSIBLE) can take one batched
brief, `qa2` (ADMISSIBLE) its own, and `pm`/`devtools` need a `resume` pass plus a shape re-check first (both AT RISK).
The operator approved all of it ("I approve those re-cuts" / "Approved" ×3 / "D1" for the resume-first route). What the
dispatch actually did: `cli.mjs resume` reported **`found: 0`** — the AT RISK seats are not resumable submissions, they
are transcript-shaped, so D1 changed nothing. `qa2` send `#278316` **died with the strict Jinja alternation 500** ("After
the optional system message, conversations should begin with a user message") even though `tools/seat-turn-shape.mjs`
rated it ADMISSIBLE — its engine is the **`verifier`** role, and that template validates the whole conversation start,
not the last turn. `cli.mjs reset qa2 --dry-run` → `{"wouldReset":true,"writes":0}` is the read-only look at the fix;
the reset itself is HELD for the operator (D118: a blind reset destroyed in-flight work — though `qa2` holds no claimed
row). `lead` was briefed twice: the first turn reported verbs and the queue stayed **4,984**; a second, shorter send that
cited the measured count produced **4,986 rows, queued 64 → 66** — the two `devtools` rows for the `clockin.mjs`
detached-worktree defect and the missing row-scoped queue read.

```bash
**IN FLIGHT at clock-out:** the `impl` deferred-batch send started 20:52:10Z as pid 1168126 (timeout 1800 s); by 21:08 it had claimed one formerly-deferred row (deferred 17→16, claimed 3→4) and cut worktree+branch `item-4789` (refs 10→11, worktrees 9→10) without landing to `main` yet. If you start while it is alive, DO NOT write the store — check `pgrep -af "cli.mjs (send|run|resume)"` first.

# 1. confirm the dispatch, bounded and cheap (1.1 s): expect 4986 rows, queued 66
DURIG_DB=./selfdev.sqlite node tools/queue-drain-audit.mjs --store selfdev.sqlite
# 2. read-only look at the alternation-500 fix before anyone asks for a reset
DURIG_NO_SERVE=1 DURIG_DB=./selfdev.sqlite node cli.mjs reset qa2 --dry-run
# 3. the qa verify leg for the landed persona split (needs the operator's context risk-accept, or fix the engine first)
DURIG_NO_SERVE=1 DURIG_DB=./selfdev.sqlite node cli.mjs send qa "$(cat .spike/fix-20261101c/qa-4974-verify.md)"
```
The briefs are gitignored: `.spike/fix-20261101c/{deferred-answers,impl-deferred-batch,devtools-deferred-batch,pm-deferred-batch,qa2-4814,lead-rows-and-rulings,lead-mint2,qa-4974-verify}.md` — promote `deferred-answers.md` if it must survive a machine move.

## What moved while the last pointer slept (`impl` ~2 h, then this delegate session — all measured)

* **#4966 LANDED**: `main` = `986a9e37`; `refs/heads/item-4966` @ `605ebf07` (five commits, from `wip/seat-prompt-files`,
  which stays as provenance) is an ancestor of `main`. Sequence evidence: pre-merge `merge-tree` exit 0 (tree
  `6cbfbb98`), land exit 0 with the store lock reserved (`held 1/1`, `liveHolders 0`), scratch cleaned, worktree/branch
  inventories unchanged, **no push** (`origin/main` still `eea4effb`, 60+ behind). Ref trap: bare `item-4966` is
  ambiguous (a directory of that name exists) — use `refs/heads/<name>`.
* **The landing was NOT regression-checked by the tool**: `--changed-suite` **refused to advance main** — 129/242 derived
  tests ran in the scratch and `demo/clockin-digest.test.mjs` failed THERE for an instrument reason, not a content one:
  `scripts/clockin.mjs` runs `git rev-list --count main..(no branch)`, i.e. it derives landing debt from the **current
  branch name**, which is `(no branch)` in a detached worktree. **That is a fourth instrument defect** and needs its own
  `devtools` row (#4977/#4978/#4979 cover the other three). Landing then proceeded on the documented default path, and
  the tool's own report says to run the suite on `main` separately — which is what this session did.
* **Two of `main`'s four suite reds were fixed by this session** (the pointer file is delegate-owned):
  `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` had been red on `main` since D186's re-cut because
  `docs/NEXT.md` lost its `## NEXT SESSION` heading and its **in-section** link to `docs/NEXT-ARCHIVE.md` (the digest
  extracts the pointer by line range, so an HTML comment above the section does not count). Both **PASS** now. Remaining
  known reds: `demo/deepinfra-catalog.test.mjs`, `demo/local-model-pointer.test.mjs` (machine/network).
* **Roster placement repaired**: `impl` had been persisted at `/home/chexxor/Git/Durian-Pi/item-4966`, `scribe` at
  `/item-4967`. The bare documented repair printed `refreshed: <all 12 seats>` and **changed nothing** —
  `seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` (`cli.mjs:679`/`:794`) and `rig.selfdev.json` names **no**
  `cwd`, so without the env var the field is omitted from the write (**#4979**). With it set all 12 seats persist
  `/home/chexxor/Git/durian-dev/seatroot`, proven by the `--dry-run` "no drift" plus the bare-name worktree inventory
  diff — not by the command's own report. `up` does not enforce the F12 guard (only `send`/`run`/`worktree`/`complete`
  pass `enforceSeatRoot: true`), which is why it can re-point at all. The `item-4966` / `item-4967` worktrees are still
  at the repo root but **registered**, so they are not `scripts/land.mjs`'s stray gate; `lead` ruled **do not route
  deletion** — both branches are live artifacts; `docs/runbooks/leaked-worktrees.md` is the procedure (it flagged one
  residue for that procedure: `item-4955`'s `.probe-cli`).
* **Delegate first-pass on the artifact, THIN dependency set** (80 `node_modules` entries, no `vendor/pi-main`): the
  five #4966 demos passed at `605ebf07` in that worktree, and `demo/seatguard.test.mjs` + `demo/seattools.test.mjs` +
  `src/shellregistry.mjs` (`bash`, `degraded:false`) passed at `238ff91d` in the full 187-package tree.

## The operator's dials (all measured 2026-11-01, Linux)

1. **Verifier window** — served `--ctx-size 8192`, declared `24576`. Read the pair in 0.1 s:
   `ps -eo args | tr '\0' ' ' | grep -oE -- '--ctx-size [0-9]+|--max-context [0-9]+'` vs `durig.config.json`.
2. **Two private `durig.config.json` copies disagree** (the file is gitignored, `.gitignore:8`, so git never shows it):
   the operator checkout says `DURIG_LOCAL_CONTEXT 160000` (the D187 stopgap), the approved seat root says **`200000`**.
   Precedence is env → `./durig.config.json` **in the cwd** (`src/config.mjs:7`), so every wake dispatched from the
   root has been running at 200000 against an engine `--max-context 204800` — the condition D187 measured the four seat
   deaths under — while reads taken from the checkout reported 160000. `lead` folded this into **#4970**. The delegate's
   in-flight wake pinned `DURIG_LOCAL_CONTEXT=160000` explicitly and **edited neither file**.
3. **Broker policy.** Down since `2026-10-30T04:55:33Z EXIT reason=deadline`. `tools/broker-serve.mjs --start`
   currently refuses on a **false** shell verdict (#4977), so a grant needs the instrument fixed or an explicit ack.
4. **Human answers still owed:** #4813 (pm, 2 deferred), #4354 (impl, 13), #4817 (devtools, 1), #4814 (qa2, 1).

## REPAIRED this session: roster placement — and the trap that hides the repair

At clock-in, `impl` was persisted at `/home/chexxor/Git/Durian-Pi/item-4966` and `scribe` at `/item-4967` (worktrees in
the operator's checkout, the D183/D184 class). The bare documented repair printed `refreshed: <all 12 seats>` and
**changed nothing**: `seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT` (`cli.mjs:679`/`:794`) and
`rig.selfdev.json` names **no** `cwd` for any seat, so without the env var the field is omitted from the write. With it
set, the write landed — proof, not the command's own exit code:

```bash
DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite \
  node cli.mjs up rig.selfdev.json --refresh            # exit 0
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=…/selfdev.sqlite \
  node cli.mjs up rig.selfdev.json --refresh --dry-run  # → "no drift"
git worktree list --porcelain | grep '^worktree ' | sort | diff .spike/fix-20261101c/wt-before.txt -  # empty
```

`up` does not enforce the F12 guard (only `send`/`run`/`worktree`/`complete` pass `enforceSeatRoot: true`) — which is
why it can re-point at all; that is now **#4979**. The stray worktrees `item-4966` / `item-4967` still sit at the repo
root; both branches are live artifacts, and `lead` ruled **do not route deletion** — `docs/runbooks/leaked-worktrees.md`
is the procedure (it flagged one residue for that procedure: `item-4955`'s `.probe-cli`).

## Rig state, re-measured 2026-11-01T18:4xZ — re-read, do not trust

`main` = `refs/heads/seatroot/linux` = **`aa0faca2`** (the landing merge `986a9e37` plus the delegate's docs commits are
landed locally;
**not pushed** — `origin/main` = `eea4effb`, 60+ commits behind, no push grant). Store `selfdev.sqlite`
**448,335,872 B, no `-wal`, no `genlock`**; `cli.mjs status` exits 0 with empty stderr, so D187's storage error did not
recur and no repair was shown necessary. Rows **4,976** before `lead`'s turn (+8 minted); non-terminal 406 = `held 328 /
queued 58 / deferred 17 / claimed 3`. Claimed: `scribe` **#4967** (worktree clean, **0 commits ahead, nothing
committed** — the arm was cut by the 8192-token summarization budget: **re-arm (#4980), do not reset**), `impl`
**#4955**, `qa` **#4890**. `attention`: `pm` deferred(2)+idle(4); `impl` deferred(13)+idle(16); `qa` idle(3); `lead` idle(10);
`scribe` idle(2); `devtools` deferred(1)+idle(14); `auditor` **last_run_failed** (Jinja alternation 500 — that refusal
belongs to the **verifier** engine, not the local strata seats); `security` idle(4); `qa2` deferred(1)+idle(2).
Send gate (`tools/seat-turn-shape.mjs`, 0.73 s): **ADMISSIBLE = `impl`, `qa`, `lead`, `qa2`**; counted projection ends
on `user` for `pm`(1), `advocate`(1), `designer`(1), `architect`(1), `scribe`(`user,user`); `auditor` ends on
`assistant` with internal parity breaks. Both providers answer **and** complete at idle (local `ctx=160000 out=8192`,
GPU1 23,047/24,576 MiB; verifier on GPU0 12,618/16,376 MiB). `git worktree list` = 9; branches = 10 (incl.
`wip/seat-prompt-files`, superseded by `refs/heads/item-4966`). Operator checkout tree: clean.

## Do not "fix" these on the strength of the docs

- **Never two store writers at once** (D187: two concurrent `send` produced `Session failed after a storage error`);
  serialize, or broker + `intent.mjs`. **`resume`/`doctor` cancels in-flight work** — never while a seat is running.
- **`tools/broker-serve.mjs --status` prints two wrong verdicts on this host**: `BLOCK seat-shell-availability` (it
  greps the vendored `programs ?? ["pwsh","powershell"]`, which belongs to `createPowerShellTool`, and applies it to the
  registered shell — `src/shellregistry.mjs` reports **`bash`, `degraded:false`**, and `demo/seatguard.test.mjs` +
  `demo/seattools.test.mjs` both PASS) and `NOTE stranded-intent` (the two spool files are
  `{"op":"read","view":"health","from":"cli"}` leftovers). Now #4977/#4978.
- **Declared ≠ served window**: verifier 24576 declared / 8192 served; local 160000 in one config copy / 200000 in the
  other / engine `--max-context 204800`; `status.context.consumed` is the LAST model call's accounting and goes stale
  after a reset. **`submissions.detail` is the first cause read** (`runbooks/session-start-cost.md` §2c): four seats
  died of the 8192-token summarization budget (`DURIG_LOCAL_MAX_TOKENS` unset, `src/providers/local.mjs:76`), not of
  conversation shape. `cli.mjs compact` has no `--dry-run`; `reset` does.
- **`up --refresh` printing `refreshed: <all seats>` is NOT proof a cwd changed** — it writes no cwd without
  `DURIG_SEAT_ROOT` in the invoking env. Prove with the dry run + the bare-name inventory diff.
- **Brief a seat inside its `capabilities`**: `lead`/`pm` are coordinators (queue verbs, no shell, no file tools).
  `lead` also reported its own authority boundary this turn — it **cannot** revise a row it neither sent nor received,
  cannot revise a row once `held`, and cannot park a queued row it minted (fold into #3236/#3486/#3570 at `pm` claim).
- **Not landable by hand:** `item-4931` 2 ahead / 23 behind; `item-4898` 1/44; `item-4930` 0/28; `item-4937` 0/25;
  `item-4955` 0/17. Withheld `-D` on `item-4898` stays withheld.
- Every 40-hex value in a seat transcript is redacted as `secret-shaped value`; `node --check` proves only the FIRST
  path; `better-sqlite3` is absent — use `node:sqlite`; the store opener **CREATES** a file on READ (pin absolute);
  `up --refresh --dry-run` never previews removals; scratch inside a worktree dies with it; `pgrep -f "cli.mjs send"`
  matches your own `bash -c` line; do not `&&`-chain a probe whose output you then verify.
- **A cheap clock-in read exists and was not used:** `scripts/clockin.mjs` (D126) prints POINTER / RIG / QUEUE / GIT /
  RUNBOOKS / PROVIDER / READ MAP / COST in one budgeted pass — measured 6,936 B, exit 0 at the root, and it extracts the
  pointer **by line range**, which is why the pointer must keep its `## NEXT SESSION` heading AND name
  `docs/NEXT-ARCHIVE.md` *inside* that section. Run it before hand-assembling six instrument calls. **But it is broken
  in a detached worktree**: it computes landing debt as `git rev-list --count main..$(branch)`, and the branch is
  `(no branch)` there, so the script throws `git rev-list --count main..(no branch)` — which is what made
  `demo/clockin-digest.test.mjs` fail inside `scripts/land.mjs`'s scratch and block a `--changed-suite` landing.
