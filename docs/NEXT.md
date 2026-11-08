# NEXT.md — current state and next actions

**Last update:** 2026-11-08T00:4xZ (delegate session **N8** — the digest-budget + provider-capacity session. The
operator's five answers of 2026-11-07T22:4xZ, verbatim: push **"granted"** → executed, `c7e41021..7a1b80e2` on
`main`, diff screened for secrets (0 hits); #3128 disposition **"approved"**; "drive another window now"
**"approved"**; durability **"approved"** → **land, do not push `item-*` refs**; capacity **"approved"** → cap stays
`1` until **#5488** lands. Then the priority order, verbatim: *"Will you be resolving the 'digest still over budget'
issue? If not, that sounds serious, and we should prioritize resolving it."* Then two capacity intents mid-session:
the local server had ~4 min of planned maintenance and *"now allows batching of 3 requests at once … Consider
updating the team to support concurrency of 2 or 3"*, and *"Can you put 2 seats on the strata-server provider, when
it's easy to do so? It has two slots available, and only two are being used right now."* All recorded as **D233**.
Session N7's pointer moved VERBATIM to `docs/NEXT-ARCHIVE.md` in this cut (86 lines, 8,101 B,
sha256[12] `50d22ff925ea`, byte-identical at the tail.) The live file is a pointer, cap 200 lines
(`demo/next-pointer.test.mjs`) **and ≈16.9 KB** — the digest cap is bytes, not lines
(`demo/clockin-digest.test.mjs`, `docs/runbooks/session-start-cost.md` §19).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Milestone this window worked** — the milestone in force is **ensuring LLM task completion** (**D226**), first
tranche **ROADMAP 331**. N8 did **not** move 331: the operator re-ordered the window onto **the clock-in digest
budget** (#5398) and then onto **provider capacity** (slots, `DURIG_MAX_CONCURRENT_SEATS`, a second model server).
Treat 331 as parked-but-gated: **#5488** → `local/*` concurrency → **#5271** → **#5306/#5309/#5310** → **#5569**
(`impl`, blockedBy those three). Prior pointers are verbatim at [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — this cut
moved 86 lines / 8,101 B there.

**Current item:** **#5398** (`devtools`, `claimed`) — the clock-in digest over its byte budget, which the operator
ordered first. Exact next command: `node scripts/clockin.mjs | wc -c`, against
`DIGEST_BUDGET_BYTES = 20000` (`scripts/clockin.mjs:37`); measured **40,404 B**. The row was re-armed
(`resumed@2026-11-07T23:43:58.831Z`) but no ref carries the change.

**Blocker:** the team's actionable surface is parked on a human — `queued 123 → 7`, `claimed 35 → 11`, and 365 rows
`deferredTo:"human"` after two supervisor sweeps (cause and repair in **B**); and the capacity change the operator asked
for is gated by **#5488**, which has not landed.

**(0) RUN FIRST** — the four reads, in order, before touching anything:

```bash
cd /home/chexxor/Git/Durian-Pi
# 1. BEFORE `--start`: is the seat provider answering, and how many slots does it have? (§27, ~3 s, prevents a 158-row sweep)
set -a; . "$HOME/.config/durig/env"; set +a
curl -s --max-time 15 -H "authorization: Bearer $DURIG_LOCAL_API_KEY" http://127.0.0.1:8080/props | head -c 200
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status | grep -E 'completes|BLOCK'
# 2. the digest the operator ordered, measured on the live store
node scripts/clockin.mjs | wc -c     # stderr carries the budget warning; budget 20,000 B
# 3. store at rest (§24) — queue counts and `claimed` per seat
DURIG_DB=./selfdev.sqlite node cli.mjs show 5398 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(JSON.stringify(j.counts))})'
# 4. worktree/branch inventory + diff vs the last snapshot (§22)
git worktree list --porcelain > .spike/wt-$(date -u +%Y%m%dT%H%MZ).txt; ls .spike | wc -l
```

**(A) THE ITEM THE OPERATOR ORDERED FIRST — the clock-in digest is over budget, and it got worse.** Measured at
`2026-11-08T00:1xZ`: `node scripts/clockin.mjs` prints **40,404 B** against
`DIGEST_BUDGET_BYTES = 20000` (`scripts/clockin.mjs:37`), stderr: *"clockin: digest is 40404 B, over its 20000 B
budget — a digest that grows into the dumps it exists to avoid has failed at its job"*. Carrier: **#5398**
(`devtools`) — `deferred@2026-11-07T23:17:41.785Z (supervisor)` → **`resumed@2026-11-07T23:43:58.831Z (devtools)`**,
so it is `claimed` and live, but **no commit on any ref touches the file**:
`git log --all --since=2026-11-07T23:00:00Z --name-only -- scripts/clockin.mjs demo/clockin-digest.test.mjs` → empty.
The driver is measured, not guessed: `scripts/clockin.mjs:203-207` prints **one line per `deferredTo:"human"` row**
— **15,244 B of 29,045 B (52%)** when there were 207 such rows; at 365 rows the digest is 40,404 B. So the fix is
aggregate-then-list (counts + ids, capped), and **the cap must fail something**: at 40,404 B live,
`demo/clockin-digest.test.mjs` prints `CLOCKIN DIGEST TEST PASS` because it builds a **7-row fixture** store
(5 deferred rows) and never sees a real backlog — same class as the `--filter` vacuity rule (pitfall 88). State the
budget in seconds and bytes on the row: `node scripts/clockin.mjs | wc -c` is the gate, not the fixture.

**(B) THE BLOCKER — the team's actionable surface is now parked on a human.** Store counts moved
`queued 123 → 7`, `claimed 35 → 11`, `deferred 207 → 365`, `done 3951 → 3957`, `held 416 → 422`: the supervisor
swept **~158 queued/claimed rows to `deferredTo:"human"`** — in the maintenance minutes (23:17:40.785Z–23:18:05.788Z,
169 transitions) and again in the second window. Cause, from `cli.mjs status` attention (the broker log shows none
of it): `last_run_failed: stranded: Connection error.` + `repeated_failure: 5 consecutive failed runs; the supervisor
escalates it to the human` for **9 of 12 seats** — the operator's planned local-server maintenance inside a live
broker window. First act next session: deliver the sweep brief again (`.spike/delegate-20261107g/brief-lead-sweep-and-concurrency.md`)
and have **seats** call `resume_work(<id>)` (pitfall 106); the delegate resumes nothing. The **nine real operator
questions** are still unanswered — **#4976** pm, **#4354** impl, **#3350** qa, **#4881** lead, **#4835** scribe,
**#4817** devtools, **#4954** auditor, **#4827** security, **#4814** qa2 — and `pm`'s digest row **#5409** is
`claimed` with its earlier deferral already resumed (`resumed@2026-11-07T22:44:53Z (pm)`).

**(C) PROVIDER CAPACITY — what was asked, and what the code actually allows.** Both servers, measured in one command:

| endpoint | slots | model alias | `n_ctx` | measured |
|---|---|---|---|---|
| `http://127.0.0.1:8080` (`local/*`) | **3** | `qwen3.8-flash-next-iq3_s` | **204,800** | 3 concurrent 96-token calls **3,436 ms** wall vs 3 sequential **799 ms** |
| `http://192.168.1.52:8080` (`strata-server` in pi's `models.json`) | **4** | **`qwen3.8-flash-next-iq3_xxs`** | **131,072**, text-only | 2 concurrent **5,271 ms** wall (each 4.9–5.3 s) |

Two facts decide the sequencing. (1) **`DURIG_MAX_CONCURRENT_SEATS=1` does not gate `local/*`** — `running` reached
**10** and **9** in the two windows with the cap at 1; the carrier is **#5488** (`impl`, `queued`, priority 19999,
no `blockedBy`), and its gate sentence is *"no seat cap conversation reopens until it lands."* So raising the cap to
2–3 before #5488 changes nothing: today the concurrency is bounded only by server slots. (2) **"Put 2 seats on
strata-server" is not config-only**: a seat's provider comes **only** from the leading segment of its `model` string
(`src/seatmodel.mjs:13-22`) and only `local` and `verifier` are registered locally-served providers
(`src/providers/local.mjs:36-44`, `LOCAL_ENV_PREFIXES`). Adding a third endpoint means registering a third prefix
(`DURIG_LOCAL2_*` → `local2/qwen3.8-flash-next-iq3_xxs`) — a small devtools change to those two constants plus
`CONFIG_KEYS` (`src/config.mjs:118-121`) with a failing-first demo and the existing pointer tests
(`demo/local-model-pointer.test.mjs`, `demo/second-local-provider.test.mjs`). Note the two traps the row will hit:
`endpointClass` is derived from the **host**, so a LAN address is `metered`, not `loopback`
(`src/providers/local.mjs:60-77`) — the provider must then carry a **declared price** (`DURIG_LOCAL2_PRICE_USD_IN/OUT`,
where `0` is legitimate "free by declaration", `local.mjs:83-95`) and a real key from the environment
(`apiKeyEnv: <PREFIX>API_KEY`, `local.mjs:174`; API keys are deliberately **not** config keys, `src/config.mjs:122-124`);
and adding the id to `LOCAL_PROVIDER_IDS` makes it "local" by id while it stays metered by endpoint, which is exactly
the D-5015.3 confusion `local.mjs:83-95` warns about. The no-code alternative (repoint
`DURIG_VERIFIER_*`) is **rejected** because `auditor` is the rig's only cross-family verifier and `single-model-rig`
is `fix-now` (`src/checkup.mjs:80, 604-607`, D-5015 independence, `docs/runbooks/verifier-independence.md`).
Also note the declared-vs-loaded mismatch on the pi side: `~/.pi/agent/models.json` declares
`strata-server` → `qwen3.8-flash-next-iq3_s` while that server's `/v1/models` answers
`qwen3.8-flash-next-iq3_xxs` (machine config, not repo state).

**(D) WHAT THE TWO WINDOWS PRODUCED (honest, and it is thin).** **A**: started `22:54:31Z`, 1800 s bound,
`EXIT pid=2226333 reason=max-duration passes=1979` at `23:28:36.303Z` = 34 min 5 s wall; **1 commit** landed on an
`item-*` ref (`24e29528`, architect, #5501 docs), and **lead took #5571 to `done` at 23:03:05Z** (so cancelling
**#5307** is now reachable — the next `lead` turn should run `node cli.mjs show 5307`); **42 metered calls,
$0.02240**. Mid-window the operator took the server down, which produced the sweep in (B). **B**: started
`23:40:40Z`, 1500 s bound, last PASS `00:05:41Z`, `EXIT pid=2248247 reason=deadline passes=-` at `00:11:27.532Z`
after a requested stop + SIGTERM (10 generations in flight; `resume` settled them — `running 0`, `placed 0`);
**0 commits**, **35 metered calls $0.01917**, and the one durable effect is devtools **resuming #5398**. Session
money: **77 metered calls, $0.04157** (store cumulative **$0.705665**). State at cut: `main` = `origin/main` =
`7a1b80e2`; **worktrees 70 → 74**, **branches 76 → 77**, **32 unlanded commits on item refs** — durability is by
landing (#5569, D232 (4)), so the number to watch is unlanded commits, not `done`.

**(E) TRAPS** — `docs/SELFDEV.md` **107–113**: a planned model-server maintenance inside a broker window makes the
supervisor park the team on the human, 169 rows in 25 s, and only `status` attention shows it (#107);
`broker-serve --start` refuses on ONE 1-token probe sample, and a transient `429 Model busy` looks like a dead
provider — re-run `--status`, never `--no-probe` (#108); **correction** to 100/103: `--max-duration` *does* bound the
exit when nothing is in flight (1800 s bound → exit at 34 min 5 s with the correct reason) (#109); a delivered brief
does not un-defer rows the sweep defers later in the same window (#110); project `.pi/settings.json` does not load in
print/JSON/RPC mode without a saved trust decision, and the A/B that proves the pin (#111); the delegate's own pi
model and the seat provider are **the same server** — probe `/props`, and remember an unkeyed `GET /v1/models`
answers the same 401 string as the incident (#112); `tools/what-to-test.mjs` reports every post-window commit as non-doc-only because the untracked `<db>.spend.jsonl` counts as a changed path, so read its `changedPaths` before obeying the full-suite prescription (#113). Earlier: 96–106, 87–95, 83–86.

**(F) WATCH-LIST (delegate)** — (1) the human-attention backlog and its digest rows **#5409/#5410**
(`pm`, claimed) are unchanged in kind and worse in count: store-wide `deferredTo:"human"` moved **206 → 365 rows** (2) the three standing
gates from D227 remain unexecuted: 113 (`tools/what-to-test.mjs --base=HEAD~1` must run), 114
(`tools/review-cite-check.mjs --pr <id>` before merging a reviewable PR), 115 (`tools/instrument-provenance.mjs
--json` every window); (3) this workspace pins pi to the **`strata`** provider in `.pi/settings.json`
(`defaultProvider strata`, `defaultModel qwen3.8-flash-next-iq3_s`, `pi auth check` → ready, A/B-proven); `.pi/` is
**gitignored** (`.gitignore:11`) so that pin is machine-scoped, never a commit — and it means a delegate session and
the seat fleet contend for the same 3 slots (pitfall 112); (4) a **probe worth promoting** sits at
`.spike/delegate-20261107g/provider-slots-probe.mjs` (gitignored, so it is lost next session unless `lead` mints a
promotion row into `tools/`): in ~5 s, with no seat turn and no metered call, it prints `slots`, the model id an
endpoint **actually** serves, `n_ctx`, and the concurrent-vs-sequential wall shape — re-run clean at `00:5xZ` on this
box: `slots 3`, `qwen3.8-flash-next-iq3_s`, `n_ctx 204800`, 3 concurrent **2,306 ms** vs 3 sequential **905 ms**. It is
the instrument behind **§27**, and it is what makes any "add a second server" decision cheap to re-check.
