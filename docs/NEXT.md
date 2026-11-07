# NEXT.md — current state and next actions

**Last update:** 2026-11-07T22:3xZ (delegate session **N7**. The operator's five answers of 2026-11-07T20:5xZ, verbatim:
push **"Granted"** → executed, `git push origin main` carried `a314ddd3..c7e41021`; the #3128 disposition
**"Accepted (i)"** → close it **with evidence as superseded**, not re-held; **"Drive another window now"** → a broker
window was run; durability **"Approved."** → **land, do not push `item-*` refs**; capacity **"Approved."** → cap stays
`1`, **#5488** lands first. Plus a **standing directive**: *"Communicate the milestone you worked in this session above
the value added, and do so for every future session"* — recorded as **D232** and written into `AGENTS.md` §Clock out.
Session N6's pointer moved VERBATIM to `docs/NEXT-ARCHIVE.md` in this cut (65 lines, byte-identical at the tail).)
The live file is a pointer, cap 200 lines (`demo/next-pointer.test.mjs`) **and ≈16.9 KB** — the digest cap is bytes,
not lines (`demo/clockin-digest.test.mjs`, `docs/runbooks/session-start-cost.md` §19).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**AS OF 2026-11-07T22:3xZ (delegate session N7) — read this block first; where it disagrees with the blocks under it,
this block is the measured current state.**

**Milestone this window worked (say this line above Value added in every closure response — D232):** **ensuring LLM
task completion** (D226), first tranche **ROADMAP 331**.

**Current item:** **#5569 — the landing entry for milestone 331, now EXISTENT** (`queued`, addressed to `impl`,
`blockedBy [5306, 5309, 5310]`, tier `feature`, minted by `pm` under **#5395** which is **`done`** at 21:51:39Z). It
lands #5306 + #5309 + #5310 as ONE unit and carries the per-family two-clause band gate, the measured floors/bands
(53/55 empty-turn; 358–1,248 local / 362–1,227 verifier — not the research doc's 130k), upstream-closed (pi #8651
NOT_PLANNED), and landing discipline (`LANDED at <sha>`, never bare `done`; per-file CONTENT for tip drift).
**The queue id to name is #5569**, and its two residuals are **#5571** (`→lead`): cancel **#5307** (false premise —
`DURIG_LOCAL_MAX_TOKENS` IS set: `durig.config.default.json:6` = 16384, default overlaid by `durig.config.json`) and
note **#5390 is `done`**, so its carrier body has no read path. Then **#5488** (`queued`, `→impl`, the capacity gate —
operator's "(a)"), then the credential cluster **#5227/#5492/#5334/#5365/#5366** (rotation is OUT of acceptance, D231).

**History:** every superseded pointer block is kept VERBATIM in `docs/NEXT-ARCHIVE.md` (this cut moved N6 there,
65 lines, byte-identical at the archive tail) — read it for the why, never re-derive it.

**Blocker:** measured at 22:2xZ with the broker down — not #3128 any more. `claimed` **56 → 35**. The rows gating #5306 now:
`impl` **6** — **#5271 #5276 #5297 #5298 #5301 #5447** (#5271 is the gate) · `devtools` **10** (#5308 is inside 331) ·
`scribe` **8** · `qa` **7** · `lead` **2** (#5442 #5449) · `pm` **2** (#5409 #5410). `held` 416 → **423**,
`deferred` 174 → **207**, `queued` 129 → 123, `done` 3939 → **3951**.
**#3128 is `deferred`, `deferredTo: human`, by the SUPERVISOR at 21:02:42.232Z** — "impl has failed 3 runs in a row and
still holds #3128 … cannot make progress without a human decision". The operator's **(i)** is that answer; a seat
executes it with `resume_work(3128)` then `complete_work` carrying `{command, exitCode, artifact}`
(`src/rig.mjs:1144`). **34 rows were deferred by the supervisor in the same 3 seconds** (impl 5, pm 5, devtools 5,
qa 5, lead 4, scribe 5, architect 4, security 1) — all traceable to the delegate's unkeyed broker pass described below,
and **206 rows store-wide are `deferredTo: human`**.

**What the window (21:05:17Z → 22:21:52Z, `pid=2132997`) actually produced.** **0 commits on `main`**, but **4 commits
on item branches** — `#5538` (architect, RM-329 3/3 spec), `#5400` ×2 (devtools, `sync-pi` measures the tree),
`#5491` (scribe, D-5015.1 amendment) — and the **landing entry #5569**. Surface: worktrees **70 → 73**, branches
**73 → 76**, **31 unlanded commits on item branches**. Money: **38 metered calls, $0.02312** (the verifier/auditor
family), store cumulative **$0.664098**; `local/*` turns are unmetered. `running` reached **10** while
`DURIG_MAX_CONCURRENT_SEATS=1` — the **#5488** specimen, reproduced.

**The delegate caused an incident at 21:02Z — read this before diagnosing any seat.** `node cli.mjs serve --help`
**starts the broker** (`--help` is not a flag), and piping it into `head` SIGPIPE-killed it at ~21:02:44Z after 9
passes. It ran **without `--env-file`**, so every `local/*` seat returned `401 … missing or wrong API key`; 10 seats
woken twice, 129 conversation entries appended, **0 metered calls**, and the supervisor's `repeated_failure` rule
deferred **34 rows to the human**, including #3128. `serve --stop` cleared the stale state file
(`cli.mjs:1943` → `"reason":"state was stale; cleared"`). Do not spend a turn on it; the `last_run_failed` /
`repeated_failure` notices are residue.

**Two harness facts the window measured, both already carried.** (1) `--max-duration` **does not bound the exit**
(`stopGraceMs = 0`, `src/broker.mjs:1545`): deadline ≈21:40:21Z, last real pass `PASS 1482` at 21:37:53Z, alive until
the delegate SIGTERMed it at 22:21:52Z — **76 min 35 s for a 35-minute bound**; `EXIT reason=deadline passes=-` is again
the wrong reason. Carriers **#5479**, **#5483**; pitfalls **103–104**. (2) While a broker drains, **the CLI cannot read
the queue** (`"read queue-census: timed out awaiting the broker's result"`, 3 attempts ~2 min each). During a window the
only reads that work are SQLite (`running`/`placed`), `git`, and the spend ledger — **§25** of
`docs/runbooks/session-start-cost.md` prices that trio at ~2 s.

**Run first (broker is **down**; `resume` settled the 2 in-flight runs at clock-out):**

```bash
cd /home/chexxor/Git/Durian-Pi
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status    # ALWAYS with the env file (pitfall 87, and the 21:02Z incident)
DURIG_DB=./selfdev.sqlite node cli.mjs show 5569 5306 5309 5310 3128 5271 5571 5307 5488   # ONE multi-id read, retry on the read race
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --status claimed | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));const by={};for(const r of j.items.filter(r=>r.status==="claimed"))(by[r.to]??=[]).push(Number(r.id));for(const k of Object.keys(by).sort())console.log(k,by[k].length,by[k].sort((a,b)=>a-b).join(" "))})'
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});console.log("running:",db.prepare("select count(*) n from tasks where status=?").all("running")[0].n,"placed:",db.prepare("select count(*) n from submissions where status=?").all("placed")[0].n)'
git log --oneline -1 main; git log --oneline origin/main..main    # main is AHEAD by the N7 docs commit until the operator grants the push
```

Then: **the spool holds 14 undrained `op: read` requests** (spooled 20:41Z–21:19Z by the reads that timed out in the
drain — pitfall 104) and `<db>.broker.inbox.error/` is at **96 files** (read-race family, **#5481**), so `--start` will
ask for `--yes-pm-wakes` again; the three operator intents are already applied
(`<db>.broker.inbox.out/operator-answers-20261107T2055Z-{lead,pm,impl}.json`, `INTENT delivered=3 dead=0 dup=0`).
Then, on the first pass: one brief to `impl` + `lead` + `pm` (via `intent.mjs`, not `send`) telling them **the operator's (i) answer to the
supervisor's escalation on #3128** and to **answer the 34 supervisor deferrals** rather than re-park them; then
`node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --start --max-duration 1800 --yes-pm-wakes`, and
**plan the wall clock as ~2× `--max-duration`** while generations are in flight. Judge the window by §24's four reads
plus §25; the pass that lands is the one where **#5271 leaves `claimed`** and **#5569 or #5306 is claimed**.

**(D) TRAPS** — `docs/SELFDEV.md` **101–106**: `cli.mjs serve --help` starts a broker and `| head` SIGPIPEs it
(#101); a broker started without `--env-file` 401s every `local/*` seat and the supervisor then defers their claimed
rows to the human (#102); `--max-duration` does not bound the exit (`stopGraceMs = 0`) — budget 2× and SIGTERM
(#103); **during a drain the CLI cannot read the queue** — use SQLite/git/ledger (§25) (#104); the queue is not a
table (`record_ids` covers conversation/document/entry/submission/task; the queue is ONE `durig.queue` doc with 3.0 M
revisions) so there is **no SQL shortcut for item state** — use one multi-id `show` (#105); a supervisor-deferred row
is answered by a seat with `resume_work(id)`, not by the delegate (#106). Earlier: the sender's `release_work` undoes a
recipient's `hold_work` (#96), no lease files for `local/*` (#97), the census mixes statuses (#98), `show <id>` is the
cheap transitions instrument (#99), the cooperative stop never completes (#100).
