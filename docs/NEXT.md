# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-11-01T17:5xZ (**D188**), host-local 2026-11-01 11:5x (`America/Chicago`, CST = UTC−6).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D188),
read-only clock-in + verification only — **this session ran no writing verb on the store and no send.**
Updated **in place** — no cut was made (`docs/NEXT.md` is 159→~150 lines, under the 200 cap).

**Archive cut:** the superseded pointer blocks are kept **verbatim** in `docs/NEXT-ARCHIVE.md`. Re-derive the cut
from `git log --oneline -- docs/NEXT.md`; do not re-point by hand.

## THE HEADLINE: `#4966` is **DONE ON A ROW** — the artifact is built, current and unverified

`impl` finished the operator-granted persona-files re-cut while this pointer slept. Measured at clock-in:

* Branch **`refs/heads/item-4966` @ `605ebf07`**, **five** commits (`44e9a86d` re-cut: resolver + `prompts/<seat>.md`
  + JSON span + `cli.mjs` + the demos the split breaks · `64029957` persona prose names no shell tool ·
  `bcf0d9dc` `apply-commit-discipline` must not re-inline · `48ed6476` the new resolver demo · `605ebf07` FEATURES
  row), worktree `/home/chexxor/Git/Durian-Pi/item-4966` **clean**, unlocked.
* Currency proof I ran: `git merge-base --is-ancestor main refs/heads/item-4966` **exit 0**;
  `ahead=5 behind=0` against `main = 238ff91d`. (The ref trap is real: bare `item-4966` is ambiguous — there is a
  directory of that name — so `git log item-4966` dies `ambiguous argument`; always `refs/heads/<name>`.)
* **Nothing merged, nothing pushed.** Row **#4966** is `done`; **`#4974`** (`impl→qa`, the verify leg for the
  artifact) is **`queued`, unclaimed**; **#4975** (`impl→lead`, DONE report) and **#4976** (`impl→pm`, a prover
  pitfall) are also `queued`.
* **My independent re-check (delegate, thin dependency set — 80 `node_modules` entries, NO `vendor/pi-main` in that
  worktree):** in `item-4966`, `node demo/instruction-files.test.mjs` (plain and with `DURIG_PREMIGRATION_REF=main`),
  `seat-instruction-encoding`, `commit-model`, `commit-discipline-personas` → **all exit 0**. This is a first-pass
  signal on the THIN set, not the verifier leg; the pinned set is 187 packages + `vendor/pi-main` (that tree has it,
  this one does not). **Name the artifact set with every exit code** (#4939).

**So the next act is verification + landing of `item-4966`, not implementation.**

## THE BLOCKER: the verifier is loaded at **8192** while the config declares **24576**

A verifier model IS now resident (this reverses the D187 measurement — do not re-ask the operator to load one, ask
them to **resize** it):

```
nvidia-smi: GPU0 NVIDIA RTX A4000 12,618 / 16,376 MiB    GPU1 RTX 3090 23,047 / 24,576 MiB
pid 978454 (~10 min old at clock-in) …/llama-server --model …Ministral-3-14B-Reasoning-2512-Q6_K.gguf
  --host 127.0.0.1 --port 42161 … --ctx-size 8192 --parallel 4   (LM Studio proxies :1234)
durig.config.json: DURIG_VERIFIER_CONTEXT "24576"  DURIG_VERIFIER_MAX_TOKENS "3000"
tools/broker-serve.mjs --status: verifier answers, advertises 4 models incl. the seat model, completes (finish=length at 64 tok)
```

**8192 served vs 24576 declared is the #4959 mismatch, live.** `status.context` will price a verifier seat's window
at ~3× what the slot holds, so a wake of `qa`/`qa2`/`auditor`/`advocate`/`designer` will look like context death, not
like a config error. `#4974` (the `qa` verify leg) is exactly such a wake. This is an **operator-side, one-dial
change** (LM Studio ctx), and it is cheap relative to a wasted wake.

**Also newly measured (two false verdicts in `tools/broker-serve.mjs` — instrument defects, not host conditions):**

1. **`BLOCK seat-shell-availability` is FALSE on this host since 217 landed.** §7 (`tools/broker-serve.mjs:296-333`)
   greps the vendored `vendor/pi-main/packages/durable/src/tools/bash.ts` for `programs ?? ["pwsh", "powershell"]`
   and applies that list to whatever shell is registered. Post-217 the registered shell is **`bash`**
   (`src/seattools.mjs:225-231` → `seatShell = seatShellSelection` from `src/shellregistry.mjs`), and reading the
   product's own registry prints **`{name:"bash", degraded:false}`**; `/usr/bin/bash` exists, `pwsh`/`powershell` do
   not. Proof it works: `node demo/seatguard.test.mjs` → **PASS** and `node demo/seattools.test.mjs` → **PASS** in
   the full-dependency tree at `238ff91d`. **Consequence: the instrument's refusal to `--start` a broker is currently
   an instrument defect** — same family as #4938/#4949/#4959.
2. **`NOTE stranded-intent` counts read requests.** Both spool files are
   `{"op":"read","view":"health","from":"cli"}` at `2026-10-30T04:37:03Z` / `04:43:42Z` — leftovers of `cli.mjs status`
   while a broker ran, **not operator intents**. The file's own intent filter (`p.to !== "?" && p.op === "?"`, line
   322) is not applied to the age note (line 182-183). So "2 intents waiting 3,652 min" overstates the spool; the
   broker being down is still true.

Both belong to `devtools` (via `lead` minting; the delegate does not route). Existing `devtools` rows in the same
family: **#4949** (single-sample provider probes), **#4959** (declared 24,576 vs the served slot), **#4960**
(promote the `.spike/` probes into `tools/`).

## Two seats' persisted cwd points INTO the operator's checkout

`up --refresh --dry-run` (read-only, exit 0, 1.3 s) at clock-in:

```
impl   {"cwd":{"from":"/home/chexxor/Git/Durian-Pi/item-4966","to":"/home/chexxor/Git/durian-dev/seatroot"}}
scribe {"cwd":{"from":"/home/chexxor/Git/Durian-Pi/item-4967","to":"/home/chexxor/Git/durian-dev/seatroot"}}
```

`item-4966` and `item-4967` are worktrees **in the operator's checkout at the repo root** (the D183/D184 placement
class). Fix is `up rig.selfdev.json --refresh` — a **writing** verb; it is safe right now (`no writer alive`,
`no genlock`, nothing mid-run) and it must be bracketed by the bare-name inventories
(`.spike/fix-20261101c/wt-before.txt` = 9 worktrees, `br-before.txt` = 10 branches, `ls .spike` = 195) per
`docs/runbooks/workspace-move.md`. **Do not refresh while a seat is mid-run.**

## Next commands (delegate, Linux; ONE WRITER AT A TIME)

```bash
# 0. operator dial first (no model wake): raise the verifier slot to >= the declared 24576, or lower
#    DURIG_VERIFIER_CONTEXT to the truth. Then re-read the pair:
ps -eo args | tr '\0' ' ' | grep -oE -- '--ctx-size [0-9]+|--max-context [0-9]+'   # served
node -e 'console.log(require("fs").readFileSync("durig.config.json","utf8"))'      # declared

# 1. roster write, then re-take the inventories and diff (workspace-move.md):
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh
git worktree list --porcelain | grep '^worktree ' | sort | diff .spike/fix-20261101c/wt-before.txt -

# 2. the verify leg, cwd AT THE APPROVED ROOT (rule 4 in session-start-cost.md), ONE send:
cd /home/chexxor/Git/durian-dev/seatroot
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs send qa --body-file <carry #4974's re-check list
  + the tree/artifact-set demand + the 8192-vs-24576 ctx reading of the server> --no-stream
# 3. then lead (brief already written, unchanged in intent): .spike/fix-20261103/lead-correct-4970.md
#    Add to that same brief: the two broker-serve verdict defects above (ask lead to MINT for devtools),
#    and the #4975 DONE report awaiting lead's landing ruling.
# 4. then architect for the #4970 ruling (it gates #4973), then scribe to finish its claimed #4967,
#    then pm for the triage of #4826/#4897/#4900. One at a time; re-read the gate before each:
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs | grep -E '^seat |counted projection'
# 5. landing, ONLY after qa's verdict on #4974 comes back green and lead rules:
git merge-tree --write-tree main refs/heads/item-4966 && node scripts/land.mjs item-4966 --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite
git merge-base --is-ancestor refs/heads/item-4966 main && node scripts/suite.mjs --jobs 8; echo "exit=$?"
git -C /home/chexxor/Git/durian-dev/seatroot merge --ff-only main    # LAND, then re-point the root, then wake
# 6. still WITHHELD: item-4931 is 2 ahead / 23 BEHIND main (merge-base --is-ancestor main refs/heads/item-4931 = NO).
#    Do not land it by hand; it needs a re-cut row (see #4953/#4963) and the deferred LIVE `compact --dry-run` repro.
```

## Operator decisions now open (all measured this session)

1. **Verifier slot size vs the declared window** — `--ctx-size 8192` served against `DURIG_VERIFIER_CONTEXT 24576`.
   One dial either way; it gates the `#4974` wake on `qa`.
2. **Broker policy.** Broker still down since `2026-10-30T04:55:33Z EXIT pid=3085999 reason=deadline`. Without it
   `send` is the only delivery verb and every `send` is a second-owner writer (the CLI says so on every call). Note:
   the instrument currently **refuses** `--start` on a false shell verdict (above), so a grant needs either the
   instrument fixed or an explicit ack.
3. **The compaction fix (unchanged, still unfixed).** `DURIG_LOCAL_MAX_TOKENS` is unset → `out=8192` for every local
   seat (`src/providers/local.mjs:76`); `tools/broker-serve.mjs --status` prints `ctx=160000 out=8192` for `local`.
   Summarization budget = `min(0.8 × reserveTokens 16384, maxTokens)` = 8192 → a seat past ~100-150k can never
   compact. `#4970` (`architect`, QUEUED) owns the ruling; `#4973` (`impl`, held, `blockedBy=[4970]`) is the build.
   The stopgap `DURIG_LOCAL_CONTEXT 200000 → 160000` moves *when* compaction fires, not whether it fails.
4. **Human answers still owed:** `#4813` (pm, 2 deferred), `#4354` (impl, 13 deferred), `#4817` (devtools, 1),
   `#4814` (qa2, 1).

## Rig state, re-measured 2026-11-01T17:5xZ (Linux) — re-read, do not trust

Store `/home/chexxor/Git/Durian-Pi/selfdev.sqlite` **448,110,592 B, no `-wal`, no `genlock`, no writer alive**, and
`cli.mjs status` exits 0 with **empty stderr** — the D187 `Session failed after a storage error` symptom did **not**
recur and no repair was run or shown to be needed. Rows: **4,976**; non-terminal **406** = `held 328 / queued 58 /
deferred 17 / claimed 3`. Claimed: `scribe` **#4967** (worktree `item-4967` clean, **0 commits ahead of main, nothing
committed** — the arm was cut at the 8192 output cap; it needs a re-arm, not a reset), `impl` **#4955** (create-on-read
opener defect), `qa` **#4890**.
`status.attention`: `pm` deferred(2, #4813 human) + idle_with_queued_work(4); `impl` deferred(13, #4354 human) +
idle_with_queued_work(16); `qa` idle(3); `lead` idle(10); `scribe` idle(2); `devtools` deferred(1, #4817) + idle(14);
`auditor` **last_run_failed** (`Engine protocol predict request returned 500 … Jinja Exception … roles must alternate`
— that refusal belongs to the **verifier** engine's jinja template, not to the local strata seats); `security` idle(4);
`qa2` deferred(1, #4814) + idle(2). No `last_run_failed` on `pm`/`impl`/`lead`/`scribe`.
Send gate (`tools/seat-turn-shape.mjs`, 0.73 s): **ADMISSIBLE = `impl`, `qa`, `lead`, `qa2`**; counted projection ends
on `user` = `pm`(1), `advocate`(1), `designer`(1), `architect`(1), `scribe`(`user,user`), and `auditor` ends on
`assistant` with internal parity breaks. Providers both answer **and** complete at clock-in (`local` ctx=160000
out=8192 on GPU1; `verifier` on GPU0).
`git worktree list` = **9**: repo root + `item-4937`, `item-4966`, `item-4967` (the last three **in the operator's
checkout**), `/home/chexxor/Git/durian-dev/seatroot` + `item-4898`, `item-4930`, `item-4931`, `item-4955`.
Branches = 10 (incl. `wip/seat-prompt-files`, the pre-re-cut WIP — now superseded by `refs/heads/item-4966`).
**`main` = `refs/heads/seatroot/linux` = `238ff91d`** (root and main equal at clock-in — the landing rule's
precondition already holds). `origin/main` = `eea4effb`; **61+ commits ahead, nothing pushed, no push grant.**
Working tree of the operator checkout: **clean** (`git status --short -- .` empty).

## Do not "fix" these on the strength of the docs

- **Never run two store writers at once** (two concurrent `cli.mjs send` produced the storage error in D187).
  Serialize, or broker + `intent.mjs`. `resume`/`doctor` **cancels in-flight work** (`action: run-cancelled`).
- **`tools/broker-serve.mjs --status` prints two wrong verdicts on this host today**: the `BLOCK seat-shell-availability`
  (it reads the vendored powershell program list, not `src/shellregistry.mjs`, which says `bash`, `degraded:false`) and
  `NOTE stranded-intent` (it counts `op:"read"` health requests). Confirm with the registry + `demo/seatguard.test.mjs`
  before acting on either.
- **Declared window ≠ served window**: verifier 24576 declared / 8192 served; local 160000 declared / engine
  `--max-context 204800`. `status.context.consumed` is the LAST model call's accounting and goes stale after a reset.
- **`submissions.detail` is the first cause read** (`docs/runbooks/session-start-cost.md` §2c); four seats died of the
  8192-token summarization budget, not of conversation shape. `cli.mjs compact` has no `--dry-run`; `reset` does.
- **A seat's tool surface is its `capabilities`** (`rig.selfdev.json`: `lead`/`pm` are coordinators — no shell, no
  file tools). Briefing them to run commands wastes an arm.
- **`item-4931` is 2 ahead / 23 behind `main`; `item-4898` 1/44; `item-4930` 0/28; `item-4937` 0/25; `item-4955`
  0/17** — none is landable by hand. Withheld `-D` on `item-4898` stays withheld.
- **A fresh/thin worktree (80 packages, no `vendor/pi-main`) is not the pinned set** — say which set an exit code came
  from (#4939). The root tree at `238ff91d` has 187 + `vendor/pi-main`.
- Every 40-hex value inside a seat transcript is redacted as `secret-shaped value`; `node --check` proves only the
  FIRST path; `better-sqlite3` is absent — use `node:sqlite`; the store opener **CREATES** a file on READ (pin an
  absolute path); `up --refresh --dry-run` previews model/cwd writes and NEVER removals; scratch written inside a
  worktree dies with it; `pgrep -f "cli.mjs send"` matches your own `bash -c` line.
