# NEXT.md — current state and next actions

**Last update:** 2026-11-05T22:5xZ (delegate session **D** closes. Two things moved. (1) The operator issued a **second standing
architecture ruling** — **fast development iteration is an architectural requirement** — recorded as **`docs/DECISIONS.md`
D213**, registered as **`docs/ROADMAP.md` 282–289**, made operable as **`docs/runbooks/slow-loop.md`**, turned into a
user-acceptance requirement **UAR-8** in `docs/ACCEPTANCE.md`, and pushed into the entry points (`AGENTS.md`) and both
delegate skills. (2) **The actionable queue is now empty**: at session start `queue-drain-audit` reported `deferred 16 ·
queued 162`; at close it reports `done 3816 · cancelled 812 · held 345 · deferred 183` and **no `queued` rows at all** —
every deferred row's last transition is `{"event":"deferred","by":"supervisor","to":"human"}`, **171 of them inside the single
hour 2026-11-05T20**. Registered as ROADMAP **292** (plus **290** citation resolution, **291** no recency read). The **D212
rows are still not cut**: max queue id is still **5156**, although `lead` received the brief (`INTENT delivered=1` at
`2026-11-05T22:07:56Z`) and was woken. The superseded session-C pointer moved **VERBATIM** to `docs/NEXT-ARCHIVE.md`.)

Host for everything below, measured in the same command as the measurements: **Linux Fedora 45**, kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — the probe is `uname -s && uname -r && (. /etc/os-release && echo
"$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Current item: there is no queued work, so the next cut is the whole backlog — `lead` cuts `docs/ROADMAP.md` **282–292** into
rows, cheapest-and-most-visible first, and the suite goes green hermetically.** Ruling (operator, 2026-11-05): the system is **broken into pieces that each
have a fast iteration loop**; anything that **restricts** iteration is **isolated**; the **LLM** — expected to be the slowest
part — is made iterable **anyway** (prompt engineering, mocking, **smaller/faster models in test cases**); and competitor
research must read **iteration architecture**, not just features. The order the delegate briefed (not routed — routing is
`lead`'s): **(1)** make `demo/deepinfra-catalog.test.mjs` leave the hermetic loop so the offline run reports **258/258**
(ROADMAP **282** clause 2 — it is the only red demo and it is red only for a missing `DEEPINFRA_API_KEY`); **(2)** publish and
enforce **per-area loop budgets** (**282** clauses 1+3+4 — `check` has **zero** timing rules today); **(3)** bound the
**turn** (**283** — 185 generations = 0.29% hold **64.6%** of generation busy time; measure per role first or it manufactures
fake greens, D91); **(4)** refuse doomed spend **before** the request (**285** — 14,377 refusal-ended generations, 22.5 h);
**(5)** the **sleep tax** (**286** — 43/258 demos sleep; seam is `src/eventfeed.mjs`); **(6)** **compaction** budget/lane
reporting (**284** — p95 4.2 min, 55.5 h total); **(7)** split the **49,000-token** `docs/SELFDEV.md` journal (**289**);
**(8)** instrument **WAIT** and `channel-down` duration (**287** — WAIT is **72.4%** of item latency); **(9)** rewrite the
stale **93-line pre-broker** `driving-durian-pi` skill (**288**); **(10)** fix **`tools/channel-preflight.mjs`, which crashes since `8160b8be`** (ROADMAP **293**, Blocker (c)
— it is the blessed first command, so it is the cheapest high-visibility row in the list);
**(11)** the **deferral wave** (**292**) and a **recency read** for the store (**291**). Brief: 
`.spike/delegate-20261105c/brief-lead-4.md` (gitignored — rewrite from **D213** and **282–292** if it is gone).

**Also still open from session C (D212):** the two-minimum-products ruling (**ROADMAP 279–280**, proposed base name
**`durian-core`**, awaiting operator ratification) and the **topology research prompt**, which now also carries the
iteration-architecture questions (**question 8** of
`docs/reviews/base-agent-product-topology-research-prompt.md`). Both need `lead`'s decomposition; the research prompt needs the
**operator** to route it (there is no channel from this rig to the off-host research agent).

**Blocker:** **four**, and none of them is the delivery channel (`INTENT delivered=1` three times — 22:07:56, 22:11:28,
22:52:21; the broker was restarted at `22:52` as `pid=267510` with `--max-duration 900`, so it **self-exits ≈ 23:07** and an
intent spooled while it is down is **pending, not lost**).
**(a)** `lead` has not turned **D212**/**D213** into rows — max queue id is still **#5156**, and there is now **0 `queued`
work**, so a woken seat has nothing to claim (measured: the 22:52 pass woke **9 seats** and fed `lead` *“there is nothing
claimable for you … do not call `claim_work` expecting work”*, `log lead` event 289893); if it is still 5156 after a wake,
re-send the brief (`node intent.mjs lead --body-file <file>`, **space** after `--body-file`). **(b)** the **verifier provider is
temporarily lifted** (`6d2c50e2` removed `DURIG_VERIFIER_BASE_URL` from both host configs and re-pointed the 5 verifier seats at
`local/qwen3.8-flash-next-iq3_s`), so `check` reports `single-model-rig` and `verification-without-evidence` as `fix-now` —
honest and intended, but the cross-family author/verifier invariant cannot hold until the `:1234` model server is up
(ECONNREFUSED; no GPU/RAM room: RTX A4000 14637/16376 MiB, RTX 3090 23098/24576 MiB) or the **metered** arm is approved
(`tools/verifier-arm-probe.mjs` → `ARMABLE`, `maxCallExposureUsd 0.001419`). Restoring needs **both** an operator capacity grant
(`docs/runbooks/verifier-model-server.md`, seats idle first) **and** `git revert 6d2c50e2`. Do **not** schedule 283–286 in a
shape that requires a verifier wake. **(c)** **`tools/channel-preflight.mjs` throws**, so the blessed channel instrument is
unusable: `tools/channel-preflight.mjs:57` spawns `cli.mjs` with **`DURIG_CONFIG: RIG`** (the *rig* file as the *config* file),
and since `8160b8be` (**#5125**, landed by this session's merge of `item-5131`) `src/config.mjs` **refuses** a config file that
sets keys no code reads — so every preflight now dies at `tools/channel-preflight.mjs:59` with
`unknown config-file key(s): _readme, version, seats, edges, ownership, constitution in ./rig.selfdev.json`. Reproduced twice. Registered as ROADMAP **293**.
**(d)** `broker-serve.mjs --dry-run` **refused this cwd** earlier (`BLOCK live-tree-dirty — 3 tracked file(s) modified
here`, F12/F23); after the docs commits the same dry run reports **0 blocking, 3 noted** and the broker started clean.

**Pointer hygiene (this section is what `scripts/clockin.mjs` prints, so it *is* the cost of a cold start):** the live file is
capped at **cap 200** lines by `demo/next-pointer.test.mjs`; superseded history moves **verbatim** to
`docs/NEXT-ARCHIVE.md`, never rewritten.

Run this first — all reads, no writes:

```bash
cd ~/Git/Durian-Pi
git status --short -- . && git rev-list --count refs/remotes/origin/main..main   # 27 ahead at 6cd29bd2, 0 pushed
DURIG_DB=./selfdev.sqlite node cli.mjs queue --id 5143 --id 5144 --id 5145 --id 5146 --id 5149 --id 5152 --id 5153 --id 5154 --id 5155 --id 5156
DURIG_DB=./selfdev.sqlite node cli.mjs queue 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print('max id',max(i['id'] for i in d['items']));[print(i['id'],i['status'],i.get('from'),'->',i.get('to'),str(i.get('subject'))[:90]) for i in d['items'] if i['id']>=5157]"   # >5156 = lead cut the D212/D213 rows; still 5156 = re-send the brief
node --env-file="$HOME/.config/durig/env" tools/broker-serve.mjs --status   # up/down; a broker started with --max-duration SELF-EXITS
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status queued | python3 -c "import json,sys;print('queued rows:',len(json.load(sys.stdin)['items']))"   # measured 0 = the team has NOTHING to claim
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status deferred | python3 -c "import json,sys;d=json.load(sys.stdin);t=[(i['transitions'][-1].get('by'),i['transitions'][-1].get('to'),i['transitions'][-1].get('at')) for i in d['items']];print(len(t),t[-1])"   # the deferral wave, with dates
node scripts/test.mjs --list                                               # 0.1 s — the loop map (9 areas, 258 tests)
DURIG_DB=./selfdev.sqlite node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 1.0 s; hygiene counts, pm-owned
node --env-file="$HOME/.config/durig/env" tools/channel-preflight.mjs      # KNOWN-RED: throws since 8160b8be (Blocker (c)) — do not trust its absence of output as health
```

## State (measured 2026-11-05T22:2xZ, same host signature as above)

- **Trunk:** `main` = `6cd29bd2`, **27 commits ahead of `origin/main`, 0 pushed** (the push grant is the operator's; this
  pointer's own commit makes it 28).
  Session-D commits: `497dddd3` (D213 + ROADMAP 282–288 + `docs/runbooks/slow-loop.md`), `e7287d9d` (ROADMAP 289), `4a787a71`
  (`AGENTS.md` — stop reading the 49k-token journal whole), `17991f37` (UAR-8 + SELFDEV session-D pitfalls), `24fe6c98`
  (the four pointers I invented in my own docs, corrected).
- **Suite:** **257/258 in 57.0 s** parallel (`node scripts/test.mjs`, jobs = `min(8, cores)`). The one failure is
  `demo/deepinfra-catalog.test.mjs` — **credential-shaped, not a regression**. Session C's landed-trunk run was
  `SUITE GREEN: pass=258 environmental=0 fail=0` at `a978bcd9`.
- **Loop costs (the new baseline, in `docs/runbooks/slow-loop.md` front-matter):** `docs` 1.2 s/6 · `guard` 2.0 s/24 ·
  `readapi` 3.8 s/5 · `check` 6.3 s/12 · `worktree` 7.8 s/23 · `toolchain` 11.1 s/16 · `tui` 12.4 s/46 · `rig` 24.0 s/63
  (**`demo/cli.test.mjs` alone = 20.1 s**) · `broker` 25.4 s/63. Mocked delegation loop `node demo/offline.mjs` = **0.301 s**.
  The **closing** run at `6cd29bd2` printed **256/258 in 48.8 s**: the credential red plus
  `demo/seat-turn-shape.test.mjs:292`, whose real-store leg asserts the store's sha256 is unchanged across its own read and
  therefore **cannot hold while a broker is live** — a live-lane test in the fast lane, added to ROADMAP 282 as an addendum.
- **Cost shape** (`tools/latency-budget.mjs`, 3.1 s, 63,172 generations): model-call p50 **52 ms** / p95 **9.0 s** / p99 1.8 m /
  max 2.0 h; **50.8%** of generations ≤ 5 s hold **1.8%** of busy time; **185 (0.29%)** > 10 min hold **517.5 h = 64.6%**;
  compaction p50 23.2 s / p95 4.2 min / **55.5 h**; **WAIT 72.4% / WORK 13.0% / HELD 5.9%**; **308.7 h** with zero generations
  in flight; **14,377** generations ended in refusals (**22.5 h**).
- **Queue:** max id **#5156**. `done` 3816 · `cancelled` 812 · `held` **345** (276 > 7 d) · `deferred` **183** · **`queued` 0**.
  The 183 are not a throughput number: **all** of them end in `{"by":"supervisor","to":"human"}` and **171** are timestamped
  inside `2026-11-05T20` (read them with `queue --status deferred` → `transitions[].at`, the queue JSON **does** carry the
  per-transition time and actor). 67 of the 183 are `notice` rows. `human` is **not a seat** (`rig.selfdev.json` registers 12;
  `intent.mjs human` → `unknown seat: human`), so the deferrals are addressed to a channel that cannot be woken. Landing rows
  already fully on `main`: **73** of 93 (pm-owned); orphan candidates **75**; unresolvable citations **33**; gate prose with no
  resolvable id **12**.
- **Rig state (`scripts/clockin.mjs`, 7.0 s, 22,537 B):** `attention: 30`; **all ten seats' `last_run_failed` is `no_model`**,
  yet `broker-serve.mjs --dry-run` resolves **all 12 seats to `local/qwen3.8-flash-next-iq3_s`**, and a real wake pass at
  22:52 left the records unchanged — so they look stale, which I could **not** prove without a pass that has real work to run
  (the closing probe is one broker pass over a **non-empty** queue). `deferred_awaiting_answer` ≈ 190 rows across 10 seats, most `waiting on human`. `RUNBOOKS dated 40 |
stale 32`. `GIT refs=18 worktrees=16 unmerged=5` (`item-5145 +2`, `wip/seat-prompt-files +1`).
- **Rows in flight:** **#5145 `done`** (`impl`; branch `item-5145` tip `39ee4fcc`, 2 commits, +806/−1, `git merge-tree` clean,
  0 behind / 2 ahead, `what-to-test --base=main` ok with 25 derived tests) — **unlanded**, and its own verification rows
  **#5155** (`impl→qa`) and **#5156** (`impl→lead`) are both **`deferred`**. **#5144 `deferred`** (`lead→impl`) after a turn
  that produced **no branch and no worktree**. `#5152`/`#5153` `held` (gated), `#5147`/`#5148` `held` (operator-routed
  research), `#5149`/`#5154` `queued` (`scribe`).
- **Spend:** **$0.00** — no `DURIG_SPEND_LEDGER` (`/tmp/durian-spend.jsonl`) exists, and every metered attempt this session
  refused **before** any request (`401 Invalid API key` from a `send` without `--env-file`; the `catalog-refused` /
  `model-unpriced` guards).

## Traps this session found (mirrored into `docs/SELFDEV.md` §session D)

1. **The suite is 57 s, not 1672 s.** The previous pointer's 1672 s was a degraded sequential/cold-deps shape. Quote the shape
   with the number, and run from the seat root where vendored deps are linked (`~/Git/durian-dev/seatroot`).
2. **`clockin` carries a stale suite stamp** — `last suite: 245/245 … 43.3 s … STALE: main is now 497dddd3`. Worth a `pm` row
   to refresh after the next full run.
3. **`faux` scripted responses drain in global call order across conversations** (documented in `demo/offline.mjs`'s header).
   That is why ordering-sensitive faux tests rot; count your turns.
4. **`docs/SELFDEV.md` is 195,532 B / 2,088 lines ≈ 49,000 tokens**, 20 append-only pitfall blocks, no size gate; `AGENTS.md`
   used to tell every session to read it whole (**fixed** in `4a787a71`). `scripts/clockin.mjs:9`'s comment (`57,589 B / 749
   lines`) is itself now false — ROADMAP 289 wants generated sizes.
5. **`.agents/skills/driving-durian-pi/SKILL.md` is a stale pre-broker artifact** (93 lines, teaches `cli.mjs send` as primary,
   Windows path examples) sitting beside a current 196-line `delegating-to-durian-pi`. Registered as ROADMAP 288.
6. **A broker started with `--max-duration N` self-exits at N**, and an intent spooled while it is down is **pending, not
   lost**. Delivery is auditable: `grep INTENT ./selfdev.sqlite.broker.log` → `INTENT delivered=1 dead=0 dup=0`.
7. **`tools/channel-preflight.mjs` has thrown since `8160b8be`** (#5125's "a config file may not set a key no code reads",
   landed by this session's `807f24a0`): it spawns `cli.mjs` with **`DURIG_CONFIG` = the rig file**
   (`tools/channel-preflight.mjs:57`), which used to be harmless and is now fatal. A **crashing instrument reads as silence** —
   treat an empty preflight as a crash until you have seen it print findings (ROADMAP **293**; ROADMAP 290 is the same lesson for pointers).
8. **`cli.mjs events --tail 400` returned 15,425 events** (2026-10-11 → 2026-11-05): `--tail` does not bound the read the way
   the name promises, and `events --since` takes a numeric cursor (`cli.mjs:3455`), so "what moved today" costs a full feed.
   Registered as ROADMAP **291**. `queue` has **no** time filter (`unknown argument --since=…`).

## Watch-list (delegate)

- **Did `lead` cut the D212/D213 rows?** Max id > 5156 means yes. If not after two wakes, re-send and then escalate the
  non-response to the operator rather than routing rows yourself.
- **#5145 stays unlanded** until `qa`/verifier evidence exists (`#5155`/`#5156` are `deferred`) — landing it without evidence is
  exactly the `verification-without-evidence` finding the rig is already carrying.
- **`deferred` 16 → 183, `queued` 162 → 0** is a **class**, not a throughput number, and it is dated: 171 deferrals inside
  one hour, all `supervisor → human`. `lead`/`pm` own the read (ROADMAP **292**); the delegate claims nothing.
- **Never buy speed with verification depth.** Any proposal to move a real-model check out of the default loop is an
  operator/pm product call (D91's fake-green hazard applies to speed-ups exactly as to features).
- **`docs/NEXT.md` is a pointer** (cap 200 lines, `demo/next-pointer.test.mjs`) — history goes **verbatim** to
  `docs/NEXT-ARCHIVE.md`, never rewritten.
