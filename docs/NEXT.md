# NEXT.md — current state and next actions

**Last update:** 2026-11-07T09:5xZ (delegate session **N5** — the operator accepted the delegate's recommendation
**"(c) then (b)"** and gave the standing directive **"Then continue working the milestones, becoming more efficient and
improving product quality and functionality."** The delegate executed the accepted part it was authorized to execute
(`reset impl` entry **325537**, `reset pm` entry **325539**, each with a handoff naming its claimed rows + trunk sha) and
spent the rest of the session driving the rig and measuring what a 130-minute pass actually produces. It found the
mechanism behind the low throughput and handed it to `lead`, which minted the rows: **build #5488** (the
`DURIG_MAX_CONCURRENT_SEATS` gap below) and **docs #5491** (the false "every provider is slot-gated" claim in
D-5015.1), on top of the pacing order **#5447 / #5448 / #5453**. Session N4's pointer moved VERBATIM to
`docs/NEXT-ARCHIVE.md` in this cut.) The live file is a pointer, cap 200 lines (`demo/next-pointer.test.mjs`) **and
≈16.9 KB** — the digest cap is bytes, not lines (`demo/clockin-digest.test.mjs`,
`docs/runbooks/session-start-cost.md` §19).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**AS OF 2026-11-07T09:5xZ (delegate session N5) — read this block first; where it disagrees with the blocks under it,
this block is the measured current state.**

**Current item:** unchanged — the operator's milestone **ensuring LLM task completion** (D226) and its first buildable
tranche **ROADMAP 331**: **#5306** (plumbing) + **#5309** (values) + **#5310** (non-author verify) + **#5395** (the
landing entry) + **#5308** (promote the band/floor probes **inside** 331). All five were still **`queued`** at 09:42Z
after 130 minutes of driving — the queue id to name is **#5306**. What decides whether 331 finally runs is the order
`lead` minted off the delegate's pacing brief: **#5447** (`lead`→`impl`, "park the 8 secondary claimed rows so #5306 is
next"), **#5448** (`lead`→`pm`, hold the secondary queued rows so #5306/#5309/#5310/#5395/#5320 are claimable),
**#5453** (`lead`→`qa`, park the secondary qa rows so #5310 is next). Under the rig's "ids ARE priority" rule a seat
holding 9 older claimed rows cannot reach #5306, so those three rows, not more minting, are the unlock. Then the
credential build in D227-A's order: **#5320** (interface + the 0600 default) → **#5412** (KDE KWallet, optional, later);
**#5277** (338, the auth check) is **terminal** — devtools' #5417 reported it DONE and nobody gated the artifact, so
re-check before planning on it. **#5407** (the operator's own wake-gate answer) is unchanged. **No new tranche.**

**Blocker:** **`DURIG_MAX_CONCURRENT_SEATS` does not gate the provider
this rig actually runs on — and the next session should not re-derive it.** At `c43ec1fa`, `cli.mjs:325-333` (the `faux` provider) and `cli.mjs:400-408`
(the default/metered provider) wrap the provider in `wrapProviderWithSlots`, but the `local/*` providers are registered
at `cli.mjs:433-441` as `withSpend(wrapProviderWithTrace(createLocalProvider(…)))` with **no slot wrapper**, and
`src/providers/local.mjs` has **0** matches for `genlock|Slot`. All eleven seats except `auditor` run on
`local/qwen3.8-flash-next-iq3_s` (`rig.selfdev.json`). Measured while the broker drove:
`cli.mjs config` → `DURIG_MAX_CONCURRENT_SEATS: "1"` (the value comes from `durig.config.default.json:3`,
`durig.config.json` does not set it); `select count(*) from tasks where status='running'` → **9–10** concurrent
`pi.generation` tasks; `ls -1 selfdev.sqlite.genlock*` sampled **40 times over ~16 s** → **0** lease files on every
sample; `grep -cE "genlock|slot" selfdev.sqlite.broker.log` → **0** for the whole log. So the knob the docs tell
operators to set for a single slow local model (`src/config.mjs:304`, `docs/SELFDEV.md`'s 3090 recipe) is a no-op for its
stated purpose, and 9–10-way thrash on one model is the most likely mechanism behind "long turns, nothing lands".
Carried as **#5488** (`lead`→`impl`, `queued`) with **#5491** (`scribe`) correcting **D-5015.1**, which claims
"`cli.mjs:344-391` … already wraps **every** provider" — false at this HEAD, and the cited range is where the local
providers are NOT registered. Do not raise concurrency before #5488 lands: the standing gate is **#5194/#5268**
(backoff before capacity).

**What 130 minutes of driving bought, measured (broker `START pid=1837129` 07:33:22Z → read at 09:42Z).** 133 wakes;
queue `done 3897 → 3921`, **`claimed 33 → 64`**, `queued 102 → 114`; **0 commits landed**
(`git log --all --oneline --since=2026-11-07T07:30:00` → empty) while **19 item branches carry 26 commits that are not
on `main`** (`git for-each-ref refs/heads` + `git rev-list --count "main..refs/heads/<branch>"`) — work waiting on a
landing entry, which is exactly what **#5395** is for. Surface grew faster than work: **worktrees 41 → 66**, **branches
43 → 67**, `worktree audit` at close → `{seat-root 9, live 35, reapable 16, locked 1, non-item 4, dirty 1}`; a worktree and a
branch are minted per claim even when nothing is ever committed, and the **#5408** teardown refusal means nothing is
reclaimed. Money: **173 metered calls, $0.09892** for the pass (`selfdev.sqlite.spend.jsonl`, timestamp field is **`at`**,
not `ts`), store cumulative **$0.572539**.

**Run first (~5 s, all read-only; broker was left **down** at clock-out — start it with
`node --env-file="$HOME/.config/durig/env" node cli.mjs serve`):**

```bash
cd /home/chexxor/Git/Durian-Pi
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status     # with the env file, or the provider BLOCKs are false (pitfall 87)
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});console.log("running generations:",db.prepare("select count(*) n from tasks where status=?").all("running")[0].n,"placed subs:",db.prepare("select count(*) n from submissions where status=?").all("placed")[0].n)'
# generations > 1 while config says 1  ==  #5488 still open. sample leases in the same breath:
for i in $(seq 1 20); do ls -1 selfdev.sqlite.genlock* 2>/dev/null | wc -l; sleep 0.4; done
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --status queued --status claimed   # counts + attention; on `apply failed: SqliteStorage is closed` RETRY (pitfall 92)
git rev-list --count "main..refs/heads/item-5306"    # NEVER bare `main..item-5306`: the worktree dir of that name makes it ambiguous (pitfall 93)
node scripts/test.mjs --area docs && node scripts/test.mjs --area guard                # both green at c43ec1fa
```

**What the delegate did this window (it claimed nothing).** Two resets the operator authorized, with previews first:
`reset impl` → entry **325537** (handoff names #3128 #4973 #5030 #5177 #5212 #5215 #5219 #5221 + trunk sha + #5306/#5309/
#5407/#5320/#5412), `reset pm` → entry **325539** (handoff names #5157 #5183 #5206 #5225 #5255 #5287 #5290 + #5409/#5410/
#5395). The other five un-sendable-by-shape seats (`qa`, `scribe`, `architect`, `advocate`, `designer`) were **not** reset
— the accepted sequence parks them until their claimed rows land or are explicitly abandoned. Three briefs were spooled to
`lead` (the operator directive; a pacing brief at 08:25Z; the slot-gap brief at 08:55Z), and `lead` answered by minting
**#5447, #5448, #5453, #5488, #5490→#5491**. Two probes live in gitignored `.spike/delegate-20261107d/` and need a
`lead` row to survive: `poll.mjs` (one progress read with the read-race retry: counts, named rows, spend delta, commits
since a timestamp) and `redact.mjs` (masks `DURIG_*_API_KEY`/`sk-` values in tool output, for RM-295).

**CORRECTED CLAIM — do not re-derive it.** The N4 block asserted "7 of 12 seats cannot be woken" and attributed the
failed pass to counted projections ending on `user`. That is **not causal on this rig**: every seat except `auditor` rides
the **tolerant local provider**, and `tools/seat-turn-shape.mjs` says in its own header that a tolerant provider accepts
those shapes ("its seats look healthy"). In this pass the same seats woke (133 wakes) and ran; `SKIP <seat> reason=pending`
alongside 9–10 `running` `pi.generation` tasks means **concurrency in flight**, not a wedge. Read "ends on `user`" as a
risk flag for strict-template providers only.

**State at close (10:5xZ, broker down).** Queue `done 3931 · cancelled 839 · held 400 · queued 121 · deferred 174 ·
claimed 62`; attention is **only** the 9 `deferred_awaiting_answer` rows (the pass cleared the failed-run and idle-with-
queued notices). The unlock is **in flight**, not parked: the lead's park orders **#5447** (`impl`) and **#5453** (`qa`) are
**`claimed`**, while #5306/#5309/#5310/#5395/#5320/#5407/#5408/#5488/#5491/#5492 are `queued` and **#5412** stays `held`.
The stop itself is a specimen: `serve --stop` reported `stopped:false` at 10 s, the process lived **13 min 54 s** with no
`PASS` line and **0** lease files held, and `kill -TERM` ended it ~10 s later logging `EXIT pid=1837129 reason=deadline
passes=-` (a fifth exit-misattribution specimen for #5215/#5373, and a live specimen for **#5479** and **#5483**) — spooled
brief `delegate-stop-specimen-20261107T1050Z-lead` carries it. `cli.mjs resume` then settled **187** pending submissions.
`selfdev.sqlite.broker.inbox.error/` grew **9 → 66 files**, all of them `op:"read"` with the reason file starting
`apply failed: SqliteStorage is closed` (pitfall 92), and `tools/channel-preflight.mjs` does not run against this rig's own
rig file (pitfall 95).

**(D) TRAPS** — `docs/SELFDEV.md` pitfalls **89–95**: the un-gated `local/*` provider (#89), `SKIP reason=pending`
meaning concurrency (#90), claim-mints-a-worktree (#91), the `SqliteStorage is closed` read race that manufactures dead
letters (#92), `git rev-list main..item-NNNN` ambiguity (#93), the ledger's `at` field (#94), and
`tools/channel-preflight.mjs` crashing against `rig.selfdev.json` because it passes the rig file as `DURIG_CONFIG` (#95).
Also new: `docs/runbooks/session-start-cost.md` §24 prices the concurrency/lease/unlanded-work reads at ~20 s.
