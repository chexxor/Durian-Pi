# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-31T05:1xZ (**D181**), host-local 2026-10-31 00:1x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D181).
Updated **in place** (this file is the pointer, cap 200); the superseded 199-line pointer is cut **verbatim** to
`docs/NEXT-ARCHIVE.md` (marker line **9061**, body **9063–9261**). Verbatim proof, re-runnable:
`sed -n '9063,9261p' docs/NEXT-ARCHIVE.md | diff - <(git show 7e64d33e:docs/NEXT.md)` prints nothing.

## NEXT SESSION

**Current item: 217 is REBASED onto `main` and the approved seat root now forks from current `main`. The open act is the
independent VERIFY LEG #4927 (`lead→auditor`, `queued`) — and it is blocked by a HOST SPEND, not by the team. Behind it
sits the MERGE grant, which the operator holds.**

**What the team did (#4916, `done` by `impl` @04:43:43Z).** `lead` minted and released **#4916** after accepting the
delegate's merge simulation; `impl` claimed it, `prepare_workspace(itemId: 4916)` forked `/home/chexxor/Git/durian-dev/
seatroot/item-4916` from `f8840349`, and it ran **one-argument `git rebase main`** (the two-argument form is refused by
#4136's argument matching) → **exit 0, no conflict**. New tip **`8a950542`**; merge-base == `main`'s tip `7e64d33e`;
`main..HEAD` = **1**, `HEAD..main` = **0**; parent count 1, not a merge commit. Its **patch-id gate PASSED — computed
inside the shell** and reported as a boolean plus two id halves, because the redactor eats 40-hex tokens (see D181).
Acceptance in its own worktree, exit codes with **no pipe**: `node --check` ×3 → **0**; `demo/seatguard.test.mjs` →
**0** "PASS — the guard holds"; `demo/seattools.test.mjs` → **0** "PASS — the controls are wired" with `(linux -> bash)`;
`git status --short` empty.

**What the delegate did, and only that (the move was the agreed Act 3; nothing was merged).** Rescue ref first
(`refs/rescued/seatroot-linux-f8840349`), then `git -C …/seatroot reset --hard 8a950542`. Inventories per
`docs/runbooks/workspace-move.md`, **refs not just directories** (`lead`'s sharpening — the 2026-10-26 casualties were
branches): **206 lines pre, 206 lines post, one changed line** (`seatroot/linux f8840349` → `8a950542`). Geometry at the
move: `seatroot..main` = **0**, `main..seatroot` = **1**, tip patch-id unchanged; delegate-run acceptance from that tree (deps
linked, 187 packages): `node --check` ×3 → 0, both demos → 0. **Re-measure, do not quote: the delegate's own clock-out docs
commit (`a7ab8655`) advanced `main`, so at clock-out the root is 1 behind / 1 ahead again** — the zero-behind state was real
at the move and decays one commit per commit landed on `main`, which is why the next session runs the geometry command. **`tools/rig-portability-audit.mjs` from the moved root:
2 findings → 1.** `seat-shell-availability` is **gone**; what remains is **`seat-host-unaware`**, which `lead` ruled is
**not 217's debt** (it was cut out of #4849 at #4858 and folded into #4906, whose done-condition now *requires* that
finding stay named outstanding — a clean 0 would be the suspicious result).

**THE BLOCKER IS A FORGOTTEN GPU SLOT — read `docs/runbooks/verifier-serving-headroom.md` Step 4 before acting.** The
verify leg failed three times and the delegate initially mis-read why. Measured root cause: LM Studio relaunched and
**restored `--ctx-size 8192 --parallel 4 --n-gpu-layers 27`** (llama-server pid 4095683 on ephemeral `:33893`, proxied by
`lm-studio` on `:1234`), while both gitignored `durig.config.json` files declare `DURIG_VERIFIER_CONTEXT = 24576`.
Probes at the size that actually failed (not a 26-token probe): **6,128 tokens → `finish_reason=length`** (no room to
answer), **9,128 → HTTP 400**, **20,128 → HTTP 400** `request exceeds the available context size (8192 tokens)`. So the
symptoms were: `qa2` → `settledStatus:"done"` + **`stopReason:"length"`** + reply `"I"`; `auditor` → `unanswered` /
`model_error` twice. **Shape was NOT the cause** (`seat-turn-shape` was clean for `auditor`/`qa2`); check shape first
anyway — it is two seconds and it is the trap that cost four sessions.
**Cost of the repair, measured, unspent:** `lms unload --all && lms load mistralai/ministral-3-14b-reasoning -c 24576
--parallel 1 --gpu max -y`; the runbook's measured load is **15,202 MiB at 24576** against GPU0's 16,376 (now
14,489 used with `Qwen3-VL-4B-Instruct` holding an 8192×4 slot, which must be unloaded). **Per that runbook this is the
operator's spend — measure, report, do not spend it unasked.**

**Row level (the census is never evidence):** **#4916 `done`**, #4904/#4849/#4898/#4902/#4903/#4908/#4845 `done`;
**#4927 `queued` (`lead→auditor`)** — short body (~1.5 KB), tree + tip fixed to `8a950542`, read-the-tip-first-and-refuse,
audit pass condition = **1 named finding**, `seat roots read: 0` to be ignored (#4923), patch-id computed inside the shell
with pin halves, **CONFIG_KEYS marked pending** (asserting it against a tree without `item-4898` manufactures a false
RED), explicit permission to abstain. **#4919 `cancelled`** by `lead`, its reason carrying its own error (the headroom
premise died: qa2 0.8216 vs qa 0.8183 is one band, and its own 4,954-byte body was the same mistake as the delegate's
brief); #4907 `cancelled` earlier for the same reason. **New rows from the delegate's findings:** **#4922** (`security`)
40-hex redaction inside row bodies is a gate-killer for patch-id work — fix by checker class, not a wider allowlist;
**#4923** (`devtools`, urgent) `rig-portability-audit` prints `seat roots read: 0` while the store carries 13 resolving
cwds — it breaks the denominator under `lead`'s own 2→0 gate; **#4924** (`devtools`, held) `> /dev/null` is refused as "a
write outside your worktree" — a discard, not a write, and refusing it pushes seats into pipes, the false-green class;
**#4925** (`architect`, queued) probe vs declaration for `seat-host-unaware` — a declared host can be false, a probe
cannot; **#4928** (`devtools`) `settledStatus:"done"` + `stopReason:"length"` is a false green, surface `stopReason` beside
`settledStatus` and refuse at `send` when brief + remaining window cannot fit; **#4920** (`impl→devtools`, tier
`undefined`) and **#4921** (`impl→lead`) the seat's own reports. **Watch for a triple-sent verify leg: #4926 (`lead→qa2`)
and #4918 (`lead→qa`) are also `queued`** — `qa`, `qa2` and `auditor` are all pinned to the same down-to-8192 verifier
slot, so waking all three spends three turns for one capacity failure. Pick **one** seat per option above. **#4917** now enforces **inline briefs**: a `--file` argument sends the path,
not the brief, and `lead` refused to infer content from a filename. **#4905 / #4906 / #4917 released and `queued` to
`devtools`** — workable now that the base is current. **Still gated/held:** #4914 (small) and #4915 (feature)
`devtools→lead`, both "re-mint to devtools when the gate clears", because **a seat cannot author a row to itself**.
3 queued rows still park on the unreachable `pm` (#4826, #4897, #4900).

**ASK THE OPERATOR — two questions, the delegate picks neither.**
1. **How does the verify leg get a model?** **(A)** authorize the LM Studio reload above (GPU spend, ~1.2 GiB of card
   free at 24576×1, then the runbook's three-way check — the API, the real `--ctx-size` in `ps`, and a probe at the
   failing size; **LM Studio forgets on every relaunch**), or **(B)** spend nothing: `lead` re-mints #4927 to a
   **local-model** seat — `security` (13,204/96,768 = **0.1367**) or `scribe` (0.1676) — both permitted `lead→…` edges,
   both untouched by 217, and a security seat is a defensible independent reviewer for a change that *widens* what a
   seat may execute. Option B is cheaper and available tonight.
2. **The merge grant.** 217 now sits **1 commit ahead of `main`** at `8a950542` (`seatroot/linux`, `item-4916`); the
   compaction build is still `item-4898 @ 9beb1ae3`, **not yet re-cut** onto `main`+217 and still missing the five
   `DURIG_COMPACTION_*` registrations in `CONFIG_KEYS` (`src/config.mjs:111`). Nothing is pushed; `main` is 38 ahead of
   `origin/main`. Standing ask unchanged: `pm` is at its ceiling and **`reset` (#4886) is the only repair**, at the cost
   of its routing history; #4886's tier act is still owed by a seat.

**Next commands (delegate, Linux; the first block is the actual next act):**

```bash
# 1. is anything still running, and where do the rows stand (row truth, not census)
pgrep -af "cli.mjs send" | grep -v pgrep || echo "no wake running (expected: settled)"
tail -3 .spike/fix-20261101/send-auditor2.out      # last attempt: unanswered / model_error (capacity, not shape)
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261101/q.json 2>/dev/null
node .spike/fix-20261101/rows.mjs 4916 4927 4926 4918 4919 4920 4921 4922 4923 4924 4925 4928 4905 4906 4917 4914 4915 4910 4890 < .spike/fix-20261101/q.json; rm -f .spike/fix-20261101/q.json
(cd .spike/fix-20261101/insurance-4849 && sha256sum -c sha256sums.txt) && (cd .spike/fix-20261101/insurance-4898 && sha256sum -c sha256sums.txt)   # both OK at clock-out
# 2. the provider check that took the longest to reason out — do it FIRST, it is seconds (runbook Step 1 + Step 4)
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs          # shape before size; AT RISK ⇒ do NOT send
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"        # expect 8192 until the operator spends the slot
curl -s http://127.0.0.1:1234/api/v0/models | grep -o '"loaded_context_length":[0-9]*'
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader   # GPU0 14489/16376, GPU1 23500/24576
# 3. geometry: the seat root must still be main+217, one ahead, zero behind
git -C /home/chexxor/Git/durian-dev/seatroot rev-parse --short HEAD; git rev-list --count seatroot/linux..main; git rev-list --count main..seatroot/linux
git worktree list        # 6 at clock-out; item-4898 LOCKED; item-4902 is the nested one inside this repo — remove BY NAME only if authorized
node .spike/fix-20261101/read-cwd4.mjs    # newest pi.agent revision per seat (doc = conv+5); 1 orphan on a dead C:\ path
# 4. pre-flight EVERY wake: shape, then context, then the store backup. Never unset DURIG_SEAT_ROOT (D180).
DURIG_DB=./selfdev.sqlite node cli.mjs status --json > .spike/fix-20261101/s.json 2>/dev/null
node .spike/fix-20261101/rows.mjs --context < .spike/fix-20261101/s.json; rm -f .spike/fix-20261101/s.json   # 23 MB dump
cp selfdev.sqlite .spike/fix-20261101/store-backup-pre-<item>-$(date +%H%M%S).sqlite
cd /home/chexxor/Git/durian-dev/seatroot && DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot setsid nohup node cli.mjs send <seat> --request-id <id> --body-file <file> > .spike/fix-20261101/send-<x>.out 2>&1 < /dev/null &
# 5. clock-out trio, always all three
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs && node tools/instrument-provenance.mjs
git for-each-ref refs/rescued | wc -l       # 490 at clock-out; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (this cut: marker **9061**, body **9063–9261**)
— grants 1–12 and the older do-not lists live there, not here.

**Blocker:** the verify leg has no model to run on — LM Studio restored the verifier slot to **`8192 × 4`** while
`DURIG_VERIFIER_CONTEXT = 24576` is declared, so a 9,128-token request is refused with HTTP 400 and a 6,128-token one is
truncated to nothing; `qa`, `qa2`, `auditor`, `advocate`, `designer` are all pinned to that slot. Repairing it is a GPU
spend the runbook assigns to the operator. **Second blocker (carried): `pm` cannot receive anything** — 184,507/200,000 =
**0.9225**, conv 3 `unanswered`/`model_error`, `Compaction failed: Summarization hit the token limit`; `compact` cannot
repair a seat at its ceiling (it IS a summarization call), so `reset` (#4886) is the only repair and it is amnesia; three
queued rows already park there (#4826, #4897, #4900). And the merge itself is **not blocked, it is not granted** — the operator holds that verb.

## What landed this session (D181), with its evidence — durable record: `docs/DECISIONS.md` **D178–D181**

- **The landing topology ran without landing anything:** mint → rebase by the author with a patch-id gate → move the root
  → stop at the merge. The root moved from 15-behind to **0-behind**, which un-gates every future worktree and #4905 /
  #4906 / #4917, and it did so with a ref-level inventory that showed **exactly one** changed line.
- **Two delegate errors, both named in the record and both routed rather than buried:** a **4.5 KB brief to a seat at
  0.77 of a 24,576 window** (`length` death, qa2's window grew 18,842 → 20,192), and **backticks in a `printf`-written
  brief**, which the shell ate — the payload reached `auditor` missing `prepare_workspace`, `main`, `item-4898`, `refs/`,
  and the run errored. Write briefs with the file tool, never through the shell; **size the brief to the seat's remaining
  window** (Step 5 of the runbook), and **never re-send a failed brief** — each attempt deposits a user turn.
- **The instrument that lied:** `settledStatus:"done"` for a one-token run. `stopReason` is the only signal (#4928).

## Rig state, re-measured at clock-out 2026-10-31T05:1xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (441 MB); pre-wake backups in `.spike/fix-20261101/` (`…pre-rel4919-*`, `…pre-auditor-*`,
`…pre-qa2-*`, `…pre-d179-*`). **Census 4,928 rows: 3,765 done / 782 cancelled / 323 held / 40 queued / 17 deferred /
1 claimed (`#4890` `qa` only)** — insensitive, never evidence. **Context:** pm **0.9225** (unreachable, conv 3
`unanswered`/`model_error`, compaction hit the token limit), **qa 0.8183 / qa2 0.8216 (both dead band)**, impl 0.5111,
lead 0.3555, scribe 0.1676, security 0.1367, devtools `null`, **auditor `null` (fresh — the strongest independence
argument: no transcript of this debate to anchor on)**, `advocate` **9.9589**, `architect` **1.0932** (both over-window
and **not** in `status.attention`). **Turn shape:** `auditor` showed 1 parity break before its first send; `lead` was
AT RISK earlier in the session — re-run, never re-send blind. **Models:** `local/iq3_s` is healthy at
`DURIG_LOCAL_BASE_URL = http://127.0.0.1:47831/v1` (strata, `--max-context 204800`, GPU1 23,500/24,576); the verifier
slot is the broken one, as above. **The shell env still carries dead pins** (`DURIG_VERIFIER_BASE_URL=:8083`,
`:8081` → HTTP 000) while the gitignored config pins win (`:1234`) — an env-vs-config trap; `rig-portability-audit`'s
`model-slots: none loaded` line is also wrong while two `llama-server` processes run (same family as #4923).
**Worktrees 6** — this repo, the seat root, `item-4898` (**locked**), `item-4904`, `item-4916`, and the nested
`Durian-Pi/item-4902` (clean; remove BY NAME only if authorized). **Branches 7**, `refs/rescued` **490**.
**Host:** 65 Gi used / **28 Gi available**, `/proc/vmstat oom_kill` **7 (unchanged)**. **Clock-out trio PASS.**

## OPERATOR GRANTS (fifteen through D177; none widened this session)

1–12 unchanged (see the archive). **13.** the #4887 compaction build is AUTHORIZED — a licence to *build* it, held as
rows #4887 + #4898, **not** a licence for the delegate to edit `src/`. **14.** #4886's priority RAISE is authorized, but
enacted only in prose. **15.** **no further verifier capacity for this leg** — the reload above is a fresh ask, not a
continuation of 15. The sequence the operator approved (mint → rebase → move the root → verify → stop at the merge) is
**executed through the move**; the verify leg is where it stopped, and the delegate stopped at the merge gate.

## Do not "fix" these on the strength of the docs

**A dead provider is not a shape defect and not a seat defect** — probe at the failing size, read `--ctx-size` in `ps`,
and compare against `DURIG_VERIFIER_CONTEXT` before blaming a seat (this session burned three turns learning it).
**Raising GPU capacity is the operator's spend.** **`send` reporting `done` proves nothing** — read `stopReason`
(`length` = capacity, `error`/`model_error` = refused, and 6,128 input tokens already leaves no room to answer).
**A seat's shell WORKS in its own item worktree and REFUSES in the shared checkout — do not "fix" the refusal.** Any
seat-executed act needs a **claimed row** first; `prepare_workspace` refuses without one and its **default** re-attaches to
the most recently claimed item — **pass the itemId explicitly**. **`up … --refresh --dry-run` printing `changes: {}` is
VACUOUS**; **never unset `DURIG_SEAT_ROOT` to get past a drift refusal** (D180: that is how a seat gets served from a
different checkout and leaves a nested worktree); **a seat's `complete_work` moves its persisted cwd to the serving
process's cwd**, so serve from the approved root. **`status.attention` never lists a seat whose `context` fraction
exceeds 1.** **A `DONE` verify row can cite lines that point nowhere and `review-cite-check.mjs` exits 0 on them.**
**Auto-compaction fires late, not never**, and **`compact` cannot rescue a seat at its ceiling**. **Never read an exit
code through a pipe**; **`> /dev/null` is refused** (#4924) — redirect into your own worktree. **A `--dry-run` that names
no removals is not evidence there are none.** **A backgrounded seat run dies with the harness unless `setsid`.**
**`cli.mjs <verb> --help` RUNS the verb; `resume`/`doctor` CANCELS a `placed` run.** **Pin `DURIG_DB` — running an
instrument inside a worktree silently changes the rig it measures.** **A FRESH worktree has no gitignored
`durig.config.json` and its deps are not linked, so a suite run there is a FALSE RED** (#4915: `DEPENDENCY NOT LINKED`;
`Durable SQLite schema version 2 … newer than supported version 1`; 80 vs 187 packages). **The redactor eats 40-hex
tokens — including pinned patch-ids inside a row body — so assert shas by computing the comparison inside the shell and
reporting halves** (#4922). **Backticks in a shell-written brief are eaten.** **Append prose with a quoted heredoc or
`cat file >>`, never `printf`; never put backticks in `git commit -m` — use `-F <file>`.** **Run prettier only on paths
you authored, NEVER on `docs/NEXT-ARCHIVE.md` or a durable record you are appending to.** **LM Studio restores
`8192×4` on relaunch.**
