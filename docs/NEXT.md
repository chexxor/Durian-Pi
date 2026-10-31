# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-31T07:0xZ (**D182**), host-local 2026-10-31 02:0x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D182).
Updated **in place** (this file is the pointer, cap 200); the superseded 189-line pointer is cut **verbatim** to
`docs/NEXT-ARCHIVE.md` (marker line **9263**, body **9265–9453**). Verbatim proof, re-runnable:
`sed -n '9265,9453p' docs/NEXT-ARCHIVE.md | diff - <(git show de8429b1:docs/NEXT.md)` prints nothing.

## NEXT SESSION

**Current item: ROADMAP 217 IS LANDED — `main` is `ddb94763` (`merge: land seatroot/linux onto main`), and the approved
seat root is exactly `main` (0 behind / 0 ahead). The open act is disposing of #4930, a row `claimed` by a seat that cannot
execute anything, and behind that the compaction re-cut #4931. Push is still NOT granted: `main` is 41 ahead of
`origin/main` (`eea4effb`).**

**The landing happened, on the operator's grant (D182).** Order kept: mint → author rebase → root move → verify → land.
`node scripts/land.mjs seatroot/linux --repo /home/chexxor/Git/Durian-Pi --db ./selfdev.sqlite` → **exit 0**, `main`
`de8429b1` → **`ddb94763`**, `lock: slots 1 held 1 liveHolders 0`, no scratch left behind. Post-landing on `main`: all five
217 files present, the landed change still carries patch-id **`279e0d9861b4d6958cf1f36af03dc00c96fcaa23`** (the pin — content
survived the merge), `node --check` ×3 → 0, `demo/seatguard.test.mjs` → 0 `PASS — the guard holds`,
`demo/seattools.test.mjs` → 0 `PASS — the controls are wired` with `(linux -> bash)`. **`land.mjs` does NOT regression-check
unless you pass `--suite`** — it says so in its own report — so the delegate ran the sweep separately: **239 demo tests, 2
stable RED + 1 flaky, none caused by the merge** (`deepinfra-catalog`: seat pins name the verifier model, absent from the
fallback catalog, no key; `test-areas`: **`demo/seat-turn-shape.test.mjs` is on disk but unmapped in the areas manifest** —
pre-existing, 217 touched 5 files and never the manifest, and that test existed at `de8429b1`; `checkup-citation`: exit 0
standalone, order-dependent). **The `test-areas` gap needs a row; it is trivial and nobody has it.**

**Then the root was fast-forwarded, not reset:** `git -C …/seatroot merge --ff-only main` → exit 0, and the ref inventory
diffed by exactly the three expected groups (HEAD line, the `*`/`+` worktree-branch marker, `seatroot/linux` sha). **One
inventory line looked catastrophic and was not:** `.spike` **191 → 4**. That is a **cwd artifact** — the inventory ran with
`cwd` = the seat root, which has its own 4-entry `.spike`. Re-checked from the main checkout: **191 intact, insurances still
verify, 7 worktrees, 8 branches, `refs/rescued` 490.** Fix for next time: record `pwd` inside the inventory.

**The verify leg did NOT run, and the reason is a new seat defect.** `lead` minted **#4930** (`lead→devtools`, chosen
because it is non-author, on the healthy local model, context `null`) after cancelling **#4927 / #4926 / #4918** — three rows
addressed to one dead verifier slot — plus **#4929**, *the cancellation notice itself*, because **a cancel emits a notice
and a notice to a dead slot is another deposit**. `devtools` **claimed #4930 and created the right tree**
(`…/seatroot/item-4930` @ `8a950542`, **locked** — which is the fix for the D180 drift class), then **twice** emitted
`<tool_call>…<function=powershell>…` **as text** instead of issuing a tool call, so the harness reported
`settledStatus done` / `stopReason stop` with **zero tools executed**. Its reasoning was correct — the log shows it naming
the worktree and the 217 tree — and it also named the **wrong shell tool** (`powershell`, imitating the 20,350 powershell
entries in its own history; 217 registered `bash`). **#4930 is still `claimed`.** Do not complete it yourself; only
`devtools` or `lead` can move it, and `lead` should decide whether to release it or park a defect row first. **This shape is
a candidate `TEXT_PATTERNS` entry** (`src/attention.mjs`, fixtures in `demo/fixtures/degenerate-text/`, detector owned by
`impl`) — the existing patterns catch prose loops, not a tool call written as prose.

**#4914 is now CONFIRMED on landed `main`, measured not predicted.** `tools/channel-preflight.mjs` prints
**`registered shell tool name: "bash"`** (217 fixed that half) and then probes **only `pwsh` / `powershell`** — the vendored
PowerShell fallback list — finds both ABSENT, and concludes **`VERDICT: NO SHELL CAN START HERE`**, two lines below its own
contradiction: `last shell tool result: entry #275973 … name=bash isError=false` (2.0 h ago) and
`"toolName":"bash" -> 21 entries`. **Read that VERDICT as stale until #4914 is fixed**, or the next session will re-open 217
on an instrument artifact. Related nuance on **#4923**: the portability audit printed `seat roots read: 0` from the seat root
and **`seat roots read: 12`** from the main checkout — the reader is cwd-dependent, which is its own defect; its verdict is
**1 finding, `seat-host-unaware`**, which is the *expected* outstanding finding per `lead`'s #4906 ruling.

**Row level (the census is never evidence — 4,931 rows: 3,765 done / 786 cancelled / 324 held / 37 queued / 17 deferred /
2 claimed):** **#4930 `claimed` devtools** (open, unexecuted); **#4931 `held` `lead→impl`** = the compaction re-cut of
`item-4898 @ 9beb1ae3` with the five `DURIG_COMPACTION_*` keys registered in `CONFIG_KEYS` (`src/config.mjs:111`),
`blockedBy [4930]`, released only when a landing entry for 217 exists — **it exists now, so #4931 is lead's to release**;
**un-gated by the landing and `queued` to `devtools`: #4905, #4906 (trivial), #4917 (trivial), #4923, #4928** — routing them
is `lead`'s call, but note they need a seat that can *execute*, which `devtools` currently cannot; **#4914 / #4915 `held`
(`devtools→lead`)**, still needing re-mint to `devtools` because a seat cannot author to itself; **#4920 / #4921 `queued`**
(the author's own reports); **#4890 still `claimed` by `qa`**, #4887 `queued→impl`, #4894–#4896/#4899 `held`. Three rows
still park on the unreachable `pm` (#4826, #4897, #4900).

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker **9263**, body **9265–9453**) —
grants 1–12 and the older do-not lists live there, not here.

**Blocker:** **no seat can be given a verifying turn on a live, admissible endpoint right now.** The verifier slot is still
**`--ctx-size 8192 --parallel 4`** (operator declined the spend — grant 15), so `qa`, `qa2`, `auditor`, `advocate`,
`designer` are unusable; among local-model seats `impl` is **ADMISSIBLE** but is 217's author, while `lead`, `devtools`,
`security` (1,686 user / 1,609 errored assistant turns) and `scribe` are all **AT RISK** (the tolerant provider usually
accepts — that is how this rig runs — but each refusal deposits a user turn). Separately `devtools` has the tool-call-as-text
defect above, and **`pm` cannot receive anything** (184,507/200,000 = **0.9225**, conv 3 `unanswered`/`model_error`,
`Compaction failed: Summarization hit the token limit`; `reset` #4886 is the only repair and it is amnesia).

**Next commands (delegate, Linux; the first block is the actual next act):**

```bash
# 1. row truth + insurances + geometry (the census lies; rows do not)
pgrep -af "cli.mjs send" | grep -v pgrep || echo "no wake running (expected: settled)"
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261101/q.json 2>/dev/null
node .spike/fix-20261101/rows.mjs 4930 4931 4905 4906 4917 4923 4928 4914 4915 4920 4921 4890 4887 < .spike/fix-20261101/q.json; rm -f .spike/fix-20261101/q.json
(cd .spike/fix-20261101/insurance-4849 && sha256sum -c sha256sums.txt) && (cd .spike/fix-20261101/insurance-4898 && sha256sum -c sha256sums.txt)
git -C /home/chexxor/Git/durian-dev/seatroot rev-parse --short HEAD; git rev-parse --short main   # both ddb94763 at clock-out
# 2. the PRE-WAKE GATE, in this order, all read-only — this is what saved the last hour of the session
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # AT RISK ⇒ do NOT send (each failure deposits)
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"          # 8192 ⇒ verifier-family seats are dead tonight
grep -n DURIG_VERIFIER_CONTEXT durig.config.json /home/chexxor/Git/durian-dev/seatroot/durig.config.json
node -e 'fetch("http://127.0.0.1:1234/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:"mistralai/ministral-3-14b-reasoning",messages:[{role:"user",content:"x ".repeat(9000)+"Reply OK"}],max_tokens:8})}).then(r=>r.json()).then(t=>console.log(t.usage||t.error))'
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/fix-20261101/s.json 2>/dev/null
node .spike/fix-20261101/rows.mjs --context < .spike/fix-20261101/s.json; rm -f .spike/fix-20261101/s.json
# 3. if a seat DID run and reported nothing: read the log tail before blaming the window
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 6 | tail -40      # look for tool-call markup sitting in `text`
# 4. landing the compaction set (ONLY after #4931 is released, re-cut, and verified — patch-id pin 258dccc5…)
node scripts/land.mjs <branch> --repo /home/chexxor/Git/Durian-Pi --db ./selfdev.sqlite   # opt-in --suite: run the sweep separately either way
# 5. the two known sweep REDs, with their attributions, so you do not re-litigate the merge
node demo/test-areas.test.mjs > /tmp/a.out 2>&1; echo $?; grep -m2 AssertionError /tmp/a.out   # unmapped seat-turn-shape (pre-existing, needs a row)
node demo/deepinfra-catalog.test.mjs > /tmp/b.out 2>&1; echo $?                                # environmental: no catalog/key
# 6. clock-out trio, always all three
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs && node tools/instrument-provenance.mjs
git for-each-ref refs/rescued | wc -l       # 490 at clock-out; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**ASK THE OPERATOR — three, the delegate picks none.** (1) **Push or not**: `main` is **41 ahead of `origin/main`**; the
merge grant did **not** include push and nothing was pushed. (2) **Who verifies**, now that the no-spend map is the whole
map: pay the verifier reload (grant 15 declined), or accept an AT-RISK local-model seat and own the deposit risk, or accept
**delegate-run verification with the seat leg labelled unverified** (which is what 217 landed on, declared in D182).
(3) **Whether the compaction set lands at all** — #4931 is the team's row and `lead` can release it now.
Standing ask unchanged: `pm` at its ceiling, `reset` (#4886) the only repair, #4886's tier act still owed.

**Grants in force (see also the archive):** **15** = no further verifier capacity (the reload was costed and NOT spent);
**16 (new, D182)** = merge of 217 into `main` granted to the delegate, **push not granted**, GPU spend not granted. The
delegate has not and will not push.

## What landed this session (D182), with its evidence — durable record: `docs/DECISIONS.md` **D178–D182**

- **217 (ROADMAP 217) is on `main`**: `ddb94763`, patch-id `279e0d98…` preserved, seat root == `main`.
- **`land.mjs` is the rig's own chokepoint and it is opt-in about regression checks** — the report says `suite: not run`;
  the delegate owed and ran the 239-test sweep, and attributed every RED instead of calling it a regression.
- **A seat can settle `done` having executed nothing.** Two turns, one row, zero tools — and the harness's own success
  fields said otherwise. `cli.mjs log <seat>` is the instrument; `settledStatus` is not.
- **`lead`'s anti-vacuity hold under the landing**: the portability audit's single remaining `seat-host-unaware` finding is
  *expected*, and a clean 0 after #4906 would be the suspicious result.

## Rig state, re-measured at clock-out 2026-10-31T07:0xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (441 MB), pre-wake backups `…pre-nospend-*`, `…pre-4930-*`. **Worktrees 7** — main,
`Durian-Pi/item-4902` (nested, clean, remove BY NAME only if authorized), `durian-dev/seatroot` **@ `ddb94763`**,
`item-4898` (**locked**, `9beb1ae3`, unlanded compaction), `item-4904` (`f8840349`), `item-4916` (`8a950542`),
**`item-4930` (`8a950542`, LOCKED, holding the open #4930)**. **Branches 8**, `refs/rescued` **490**. **Provider:** local
`iq3_s` healthy at `:47831` (`--max-context 204800`, GPU1 23,500/24,576); verifier `mistralai/ministral-3-14b-reasoning`
loaded at **8192 × 4** behind `:1234` (GPU0 14,489/16,376) — probes: 6,128 → `finish_reason=length`, 9,128 and 20,128 →
HTTP 400. **Env still carries dead pins** (`DURIG_VERIFIER_BASE_URL=:8083`, `:8081` → HTTP 000) while the gitignored config
pins win. **Context:** pm 0.9225 (unreachable), qa 0.8183, qa2 0.8216, impl 0.5111, lead 0.3555, scribe 0.1676,
security 0.1367, `advocate` 9.9589, `architect` 1.0932, `devtools`/`auditor` `null`; **`status.attention` still omits every
over-1 seat**. **Host:** 65 Gi used / 28 Gi available, `oom_kill` 7 (unchanged). **Clock-out trio PASS.**

## OPERATOR GRANTS (sixteen through D182)

1–12 unchanged (see the archive). **13.** the #4887 compaction build is AUTHORIZED as a *build*, not as a licence for the
delegate to edit `src/`. **14.** #4886's priority RAISE, enacted only in prose. **15.** no further verifier capacity for
this leg. **16. (D182) merge of 217 into `main` granted to the delegate** — executed via `scripts/land.mjs`, exit 0;
**push NOT granted; GPU capacity NOT granted.** Grant 11 (tree-shape acts on the approved seat root) was used for the
`merge --ff-only` root move, with inventories.

## Do not "fix" these on the strength of the docs

**`channel-preflight`'s `VERDICT: NO SHELL CAN START HERE` is now a stale alarm on a landed-217 tree** — it reads the
registered name correctly (`bash`) and then probes only `pwsh`/`powershell`; its own store evidence two lines below shows a
successful `name=bash isError=false`. That is #4914, measured. **`rig-portability-audit`'s `seat roots read:` count is
cwd-dependent** (0 from the seat root, 12 from the main checkout) and `model-slots: none loaded` printed while two
`llama-server` processes ran (#4923 family). **`land.mjs` did not run the suite** unless you passed `--suite`.
**`settledStatus:"done"` + `stopReason:"stop"` does not mean a tool ran** — read `cli.mjs log <seat>`.
**Never complete or release another seat's `claimed` row.** **A cancel emits a notice; a notice to a dead seat is a
deposit** (#4929). **A sender may release its own row but may not park it** — `hold_work(4905)` refused `lead` with
"addressed to devtools, not you" (refinement to #4856; ordering goes in the body). **`claim_work` takes oldest-workable** —
name the id. **An `.spike` line count in an inventory is a function of cwd** — record `pwd` in the inventory.
**A dead provider is not a shape defect and not a seat defect**; **raising GPU capacity is the operator's spend**;
**AT RISK ⇒ do not send**; **never re-send a failed brief**; **a fresh worktree is not a comparable verification tree**
(#4915) and has no gitignored `durig.config.json`; **`> /dev/null` is refused** (#4924); **never read an exit code through a
pipe**; **the redactor eats 40-hex tokens — assert shas inside the shell, report halves** (#4922); **inline briefs, and no
backticks in a shell-written brief** (#4917 and D181); **a seat's `complete_work` moves its persisted cwd to the serving
process's cwd**, so serve from the approved root, and **never unset `DURIG_SEAT_ROOT` to pass a drift refusal** (D180);
**`up … --refresh --dry-run` printing `changes: {}` is VACUOUS**; **`status.attention` never lists an over-1 seat**; **a
`DONE` verify row can cite lines that point nowhere and `review-cite-check.mjs` exits 0**; **`compact` cannot rescue a seat
at its ceiling**; **`cli.mjs <verb> --help` RUNS the verb; `resume`/`doctor` CANCELS a `placed` run**; **pin `DURIG_DB`**;
**a backgrounded seat run dies with the harness unless `setsid`**; **append prose with a quoted heredoc or `cat file >>`,
never `printf`; never put backticks in `git commit -m` — use `-F <file>`**; **run prettier only on paths you authored,
NEVER on `docs/NEXT-ARCHIVE.md` or a durable record**; **LM Studio restores `8192×4` on relaunch.**
