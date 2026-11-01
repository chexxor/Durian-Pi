# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

## NEXT SESSION (2026-11-01T18:4xZ — D188 daytime, Linux: land `item-4966`, then fix the verifier window, then re-arm `scribe`)

**History:** everything this pointer supersedes is kept **verbatim** in `docs/NEXT-ARCHIVE.md`; re-derive the cut from
`git log --oneline -- docs/NEXT.md` — never re-point by hand.

**Current item:** the operator-granted persona-files re-cut, **#4966**, is **`done` on the row** and `lead` has now
ruled the order (its verdict, `.spike/fix-20261101c/lead-send.out`, settled `done`): **land `refs/heads/item-4966` @
`605ebf07` FIRST; the `qa` leg (#4974) follows the landing and does not gate it**, because the persona files are
*derived* and the meaningful verify is the merged 187-package + `vendor/pi-main` tree. Rows opened by that turn:
**#4977/#4978/#4979** (`devtools`, the three instrument defects below), **#4980** (`scribe` — the re-arm brief for its
claimed **#4967**), **#4981** (`architect` — the compaction *legibility* half, ungated), **#4982/#4983** (`impl`; #4983
`held`). **#4970** was revised to "HALF B" — the config-authoritative + bounding-policy questions, which are the
operator's, not a seat's.

**Exact next command** (delegate, from `/home/chexxor/Git/Durian-Pi`, no second writer alive, land then re-point):

```bash
git merge-tree --write-tree main refs/heads/item-4966                      # expect a tree sha, exit 0
node scripts/land.mjs item-4966 --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite   # operator grant; --suite would
                                                                                   # refuse on main's 4 pre-existing reds
git -C /home/chexxor/Git/durian-dev/seatroot merge --ff-only main          # LAND, THEN re-point the root, then wake
node scripts/suite.mjs --jobs 8; echo "exit=$?"                            # expect the same 4 reds; prove pre-existing
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status    # re-read attention afterwards
```

**Blocker:** the verifier slot is loaded at **8192** (`--ctx-size 8192 --parallel 4`) against a declared
`DURIG_VERIFIER_CONTEXT 24576` — LM Studio restores `8192×4` on relaunch — so `qa`/`qa2`/`auditor`/`advocate`/
`designer` wakes die on the provider, not on their own work. `lead` cannot park **#4974** (`not yours to revise`) and
the delegate must not touch queue rows, so **#4974 stays queued against a 400-returning server** until either the
operator resizes the slot or `pm`/`impl` (#4982) moves it. Second blocker: the broker has been down since
`2026-10-30T04:55:33Z`, so every delivery is a `send` = a second-owner writer; serialize them.

## What moved while the last pointer slept (`impl`, ~2 h, measured by this session)

* Branch **`refs/heads/item-4966` @ `605ebf07`**, five commits (`44e9a86d` re-cut: `instructionsFile` resolver +
  `prompts/<seat>.md` + rig JSON span + `cli.mjs` + the demos the split breaks · `64029957` persona prose names no
  shell tool · `bcf0d9dc` `apply-commit-discipline` must not re-inline · `48ed6476` resolver demo · `605ebf07`
  FEATURES row). Worktree `/home/chexxor/Git/Durian-Pi/item-4966` clean, unlocked. Nothing was merged or pushed.
* Currency at measurement: `git merge-base --is-ancestor main refs/heads/item-4966` **exit 0**, ahead=5 behind=0
  against `main = 238ff91d`. Ref trap: bare `item-4966` is ambiguous (a directory of that name exists) — use
  `refs/heads/<name>`. `merge-tree` after the delegate's docs commits: **exit 0**, tree `76ca662e`.
* **Delegate first-pass, THIN dependency set** (80 `node_modules` entries, no `vendor/pi-main` in that worktree):
  `instruction-files` (plain and `DURIG_PREMIGRATION_REF=main`), `seat-instruction-encoding`, `commit-model`,
  `commit-discipline-personas` → all **exit 0**. Not the verifier leg; name the artifact set with every exit code
  (#4939).
* **`main` carries four pre-existing suite reds** (impl proved them on a pristine `git archive main`; the delegate
  reproduced two): `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` — both because the pointer file
  lost its `## NEXT SESSION` heading when D186 re-cut it (this pointer restores it) — plus
  `demo/deepinfra-catalog.test.mjs` and `demo/local-model-pointer.test.mjs`, which are machine-config.

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

`main` = `refs/heads/seatroot/linux` (the delegate's docs commits are landed locally and the root fast-forwarded after
each; **not pushed** — `origin/main` = `eea4effb`, 60+ commits behind, no push grant). Store `selfdev.sqlite`
**448,110,592 B, no `-wal`, no `genlock`**; `cli.mjs status` exits 0 with empty stderr, so D187's storage error did not
recur and no repair was shown necessary. Rows **4,976** before `lead`'s turn (+8 minted); non-terminal 406 = `held 328 /
queued 58 / deferred 17 / claimed 3`. Claimed: `scribe` **#4967** (worktree clean, **0 commits ahead, nothing
committed** — the arm was cut by the 8192 output cap: **re-arm (#4980), do not reset**), `impl` **#4955**, `qa`
**#4890**. `attention`: `pm` deferred(2)+idle(4); `impl` deferred(13)+idle(16); `qa` idle(3); `lead` idle(10);
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
  RUNBOOKS / PROVIDER / READ MAP / COST in one budgeted pass — measured 6,936 B, exit 0, and it extracts the pointer by
  line range, which is why the pointer must keep its `## NEXT SESSION` heading AND name `docs/NEXT-ARCHIVE.md` *inside*
  that section. Run it before hand-assembling six instrument calls.
