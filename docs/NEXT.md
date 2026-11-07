# NEXT.md — current state and next actions

**Last update:** 2026-11-07T18:2xZ (delegate session **N6** — the operator answered the delegate's five decisions
verbatim: **push "Approved"** → executed, `git push origin main` carried `5bec571b..a314ddd3` and `main` is now **equal to**
`origin/main`; capacity **"(a)"** → land **#5488** before any capacity conversation reopens, `DURIG_MAX_CONCURRENT_SEATS`
stays `1`; **windowed driving "Accepted"** → broker per window, gated by `docs/runbooks/session-start-cost.md` §24, never
resident unattended; credential rotation **"i don't want to rotate credentials unless we commit them to the repo and push
publicly"** → rotation is OUT of RM-295's acceptance, the exposure is at-rest and in tool output; the five un-reset seats
**"Approved waiting"** → `qa`/`scribe`/`architect`/`advocate`/`designer` keep their claimed context. Directive:
**"Continue making progress on priority milestones."** Recorded as **D231**. Session N5's pointer moved VERBATIM to
`docs/NEXT-ARCHIVE.md` in this cut.) The live file is a pointer, cap 200 lines (`demo/next-pointer.test.mjs`) **and
≈16.9 KB** — the digest cap is bytes, not lines (`demo/clockin-digest.test.mjs`,
`docs/runbooks/session-start-cost.md` §19).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**AS OF 2026-11-07T18:2xZ (delegate session N6) — read this block first; where it disagrees with the blocks under it,
this block is the measured current state.**

**Current item:** unchanged — the operator's milestone **ensuring LLM task completion** (D226), first tranche **ROADMAP
331**: **#5306** (plumbing) → **#5309** (values) → **#5310** (non-author verify) → **#5395** (landing entry), with
**#5308** inside 331. Queue id to name: **#5306** — still `queued`, addressed to `impl`, unclaimed since it was minted at
01:38Z. Then credentials **#5320 → #5412**, then **#5407**, then plan rows **#5409/#5410**. **No new tranche.**

**Blocker:** the milestone is now gated by **one 2026-10-19 queue row, #3128**, not by seat health. Ids ARE priority, and
`impl`'s claimed set at 18:17Z is **#3128 #5227 #5258 #5259 #5264 #5271 #5276 #5297 #5298** — nine rows below **#5306**.
`node cli.mjs show 3128` prints the mechanism in four lines of transitions: `10:38:01Z held impl` (obeying the park order
**#5447**) → `10:47:15Z released pm` (the tool lets the **sender** undo a hold, `src/rig.mjs:1223-1247`) →
`17:27:22Z claimed impl` (re-claim is automatic at that id). Below-gate census at window close: `impl` **9** (below
#5306) · `qa` **7** (below #5310) · `devtools` **15** (below #5408) · `scribe` **11** · `pm` **1** (#5373, below #5395).
**The unlock that works is `hold_work` by the recipient plus nobody releasing it, or `complete_work` with
`{command, exitCode, artifact}`** — #3128's hazard is now carried by #5227/#5492/#5334/#5365/#5366, and the operator's
ruling this hour removed rotation from that cluster, which may already satisfy it. `lead` ruled the park order; the
delegate closed, held, released and re-addressed nothing.

**What this window (17:23:37Z → 18:17:24Z, 54 min, broker `pid=2062064`) actually changed — measured, because the
pointer must be truer, not just longer.** 102 wakes, last `PASS 1568`. **12 of the 21 record-shaped claimed rows are out
of `claimed`** (`held 400 → 416`), and `pm`'s lane cleared from 11 below-gate to 0 mid-window — the delegate's two briefs
(`operator-answers-20261107T1105Z-*`, `delegate-park-undo-20261107T1730Z-*`, all applied: `INTENT delivered=7 dead=0
dup=0`) produced that. But **0 commits landed**, `claimed` ended at 56 (from 63), and the surface grew again:
**worktrees 66 → 70, branches 67 → 73**, **27 commits still sit on item branches off `main`**. Money: **118 metered calls,
$0.06844**, every one `openai/gpt-oss-120b` at `api.deepinfra.com` — the verifier/auditor family; the eleven `local/*`
seats that did the churning are unmetered, so the dollar figure understates the cost of a window. Store cumulative
**$0.640976**. `selfdev.sqlite.broker.inbox.error/` grew **66 → 84 files**, all from the read race (pitfall 92).

**Durability, new this window and the operator's grant to change.** `git log --oneline --branches --not --remotes` →
**30 commits exist only on this disk**; **66 local branches have no `origin` counterpart** and **1** `item-*` ref is on
origin. Checking the carriers the queue cites with `git merge-base --is-ancestor <sha> origin/main`: `2dfd0f95` **yes**
(it rode the push), `3c4973c9 141c8307 36689f4f 1fac24a7 0a42b985 e160ba32 6dc1a425` **no**. So the refs named as carriers
by #5421/#5424/#5426/#5440/#5444/#5465/#5466/#5477 are local-only, and ~1.77 GB of gitignored store copies sit on the same
disk. **Landing is the durability route** (#5395, #5440, #5444, #5465); branch pushes were **not** granted. #5475's
"detect by reachability (`merge-base --is-ancestor`), not ref-existence" is the right rule shape — cite it, do not
re-mint.

**Run first (broker is **down**; `resume` settled the 9 in-flight runs at clock-out):**

```bash
cd /home/chexxor/Git/Durian-Pi
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status     # with the env file, or the provider BLOCKs are false (pitfall 87)
DURIG_DB=./selfdev.sqlite node cli.mjs show 3128     # transitions: is #3128 still `claimed` ahead of #5306? (retry on `SqliteStorage is closed`)
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --status claimed | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));const by={};for(const r of j.items)(by[r.to]??=[]).push(r.id);for(const k of Object.keys(by).sort())console.log(k,by[k].length,by[k].sort((a,b)=>a-b).join(" "))})'
# 331 is unreachable while a lower id sits in the same lane; `held` is the only non-claimable state (pitfall 96)
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});console.log("running:",db.prepare("select count(*) n from tasks where status=?").all("running")[0].n)'
node scripts/test.mjs --area docs && node scripts/test.mjs --area guard      # both green at a314ddd3
```

Then, and only if the lane moved: `node --env-file="$HOME/.config/durig/env" cli.mjs serve`, drive one **window** (≤45
min), and stop when `claimed` rises while `git log --all --oneline --since=<window-start>` stays empty. **Stop
early**: a requested stop did not complete in either window — `serve --stop` returns `stopped:false` at ~10 s and the
process survives until SIGTERM (`STOP-REQUESTED 18:12:13Z → EXIT 18:17:24Z`), and the lease check is the wrong safety
gate for `local/*` seats because they take no lease (pitfall 97).

**(D) TRAPS** — `docs/SELFDEV.md` **96–100**: `release_work` by a sender undoes a recipient's `hold_work` and the
lowest-id rule re-claims it (#96); lease files are absent for `local/*` so `running` count is the stop-safety check
(#97); the census mixes statuses unless you filter `r.status` (#98); `show <id>` is the cheap transitions instrument and
is not promoted (#99); the cooperative stop never completes and `EXIT reason=deadline passes=-` is again the wrong reason
(#100). Earlier: un-gated `local/*` provider (#89), concurrency-vs-wedge (#90), claim-mints-a-worktree (#91), the
`SqliteStorage is closed` read race (#92), ref ambiguity (#93), ledger field `at` (#94), `channel-preflight` against
`rig.selfdev.json` (#95).
