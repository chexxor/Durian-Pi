# NEXT — current priority and exact next command

**Last updated:** 2026-10-28T23:5xZ, delegate session (the tool-and-skill lifecycle **study is now three rounds**: the observed
half (10 systems) + the public-harness half + **round 3, which passed the citation protocol** — 60 numbered citations, **91 of 94**
quoted fragments located in the delegate's own re-fetches; `docs/reviews/harness-tools-skills-public-harnesses-research-r3.md` +
its verification note `docs/reviews/harness-tools-skills-r3-delegate-notes-2026-10-28.md`). **Five `--depth 1` pins**
(`codex d373d649`, `cline 51f63e4f`, `goose 775b3958`, `claude-code-docs 58d6da1e`, `copilot-cli 84ee80ea`). ROADMAP **235–246**
registered; operator ruled on `.pi/` (D158), the off-host citation channel (D159), the phantom citation (**withdrawn**) and
**research-before-232**. Prior session notes: `docs/reviews/delegate-notes-2026-10-28-cross-os-recovery.md`; harness self-audit
(87 sessions mined): `docs/reviews/pi-harness-usage-audit-2026-10-28.md`. Linux box
`Alex-Desktop-Win10` (Fedora `7.2.11-200.fc44.x86_64`), `node v24.22.1`, box zone `America/Chicago` (CDT = UTC−5; every
timestamp here is **Z**, and note the host's own clock is suspect — see §INCIDENT). Read me first — do not re-derive the
priority from the ~4,300-line roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This file is a **pointer, capped at 200
lines** by `demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block below to carry a current item,
a queue id, a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in place, do not restyle it.** Its two
executable readers are `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` (the digest reads only this
section, so **the `NEXT-ARCHIVE.md` link must stay inside the pointer body**). After editing this file:
`node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs`.

## NEXT SESSION

**Current item:** **get claimable work to the head of the queue, then keep the delivery channel resident** — but the
second half is now **blocked on this host by measurement, not by grant**: a seat woken here has **no shell that can
start** (ROADMAP **217**), and the product's own worktree sweep **prunes the `git worktree` ledger**, which on this
moved workspace erases the cross-OS evidence the runbooks call protected (new ROADMAP **232**,
`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`). The channel is still the largest measured
wall-clock lever: `queued=0` and `claimed=0` of 4,821 rows, all **296 non-terminal rows parked** (277 `held`, 19
`deferred`), and the last `done` transition anywhere is **2026-10-22T17:29:11.923Z — 6.1 days stale**. A broker started
now wakes 9 seats onto *parked rows only* (`selectWakes`/`hasParked`, `src/driver.mjs:108`), and every one of them would
fail its first shell call (`spawn powershell ENOENT`, already firing inside the last broker pass).
**Queue ids:** **#725** (impl, ROADMAP 63 — `src/host.mjs` portable host supervisor), **#726** (devtools, ROADMAP 64 —
`durig daemon` CLI + trigger adapters), **#727** (qa, ROADMAP 67 — host chaos suite): all three `held`, all three in the
drain audit's **orphan-candidate** list (#662/#710 both `done`) while an **operator prose clause — "and the queue drains"
— has no definition anywhere in the tree** (ROADMAP **231**). Rows opened this session: **232** (the sweep prunes the ledger
ahead of any plan), **233** (instruments credited as landed were never committed and are gone), **234** (every gate is
wall-clock arithmetic while the store stamps relatively). Delegate halves landed: preflight §5/§7/§8, 233's check, refs+objects. Rows registered this session: **235–239** (harness lifecycle study, `docs/reviews/harness-tools-skills-research.md`) and **240–243** (the public-harness half + its five pins, `docs/reviews/harness-tools-skills-public-harnesses-research.md`) — registered, not scheduled; `pm` sequences them against 217/232/233. **235's delivery shape is ruled (D158): an installable pi package developed in this tree (`pi install --local ./<dir>`), not hand-written `.pi/` files. 232 stays unclaimed: research first (241).**
**Next command (delegate, read-only — run in this order, ~4 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # 3.3 s: four links + §7 seat capability (217) + provider-era attribution (226)
node tools/broker-serve.mjs --dry-run    # 2.9 s and it now REFUSES: `seat-shell-availability` + `live-tree-dirty`
DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json node cli.mjs queue --json \
  | jq -r '.items[] | select(.status=="queued" or .status=="claimed") | [.id,.status,(.to//"-")] | @tsv' | wc -l   # the head of the queue: 0 today
# operator action owed (small): confirm whether the round-3 paste lost its tail — the delegate's working summary held content
#   absent from the delivered file (citations past C60; a Goose `checks/*.sh` success predicate in neither the file nor the pin).
#   If such a mechanism exists, re-send that part; if not, record that the channel invented it.
#   Rounds 1–3 are DONE and verified (round 3: 60 citations, 91/94 fragments located, all URLs 200). No push owed: origin/main == HEAD.
```

**Blocker:** the operator ruled (D156/D157): the start stays **withheld on ROADMAP 217**, rehearsals run in the disposable
clone `/home/chexxor/Git/Durian-Pi-ops`, and **nothing host-wide is delegated** (`set-local-rtc 0` changes the whole OS — routed as ROADMAP **234**, detector
`tools/channel-preflight.mjs` §8). **Applied under the grant:** the pre-move clone's 3 packs → this checkout: 9,301 →
22,362 objects, `git fsck` clean, **23/30 cited shas resolve**, 455 commits still anchored by nothing. **Granted 2026-10-28 (D158):** `--depth 1` competitor clones (five taken, pins regenerated, `--check` PASS at 14 clones); `.pi/` writes **permitted but disfavoured** — ship an installable pi package developed in this tree instead; and **232 is gated on research (241): do not claim it, do not touch `src/worktree.mjs:649` / `src/broker.mjs:1167`, and run no suite from this checkout while it is open.** Still owed: the 221 seat-root ruling; an evaluable **"the queue drains"** (231); a grant to mint `refs/rescued/orphan-*` for those 455; the Windows-host session corpus + `.spike/delegate-inventory-2026-10-26.txt` (237).
**Routed:** `delegate-routing-fact-20261028-2150`. **History:** `docs/NEXT-ARCHIVE.md`.

### Read-only baseline — run this before anything else (all verified working, Linux, 2026-10-28T20:1xZ)

```bash
cd /home/chexxor/Git/Durian-Pi && git worktree list --porcelain | tee .spike/worktree-inventory-$(date +%Y-%m-%d)-after.txt   # 1 entry (main); the 36-row pre-move ledger is now COMMITTED: docs/incidents/evidence-2026-10-24-windows-ledger.txt
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json      # 3.3 s — §1–§8, incl. seat capability (217), provider-era attribution (226), host-clock posture (234)
node tools/broker-serve.mjs --status      # 2.8 s; now also raises `seat-shell-availability` (217)
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.93 s: 91 non-terminal LANDING rows, 71 fully on main, ids printed
node tools/latency-budget.mjs --db ./selfdev.sqlite      # 3.0 s: the two wall-clock currencies
node tools/instrument-provenance.mjs && node scripts/clockin.mjs # 46 ms + 2.6 s: suite members git=238 disk=238 + ledger size (233, exits 1 on drift), then the digest
node tools/harness-usage-census.mjs ~/.pi/agent/sessions/--home-chexxor-Git-Durian-Pi-- # 0.55 s: how often PAST sessions re-used each instrument vs re-deriving it (24% of all calls are one-off measurement code)
```

## Rig state, re-measured 2026-10-28T20:1xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (438,329,344 B): `entries` **137,427 rows, max id 274,114**, 12 seats. **Queue census**
`node cli.mjs queue --json | jq -r '.items[].status' | sort | uniq -c` → **4,821 = 3,748 done / 777 cancelled / 277 held
/ 19 deferred**, i.e. **0 claimable**. Per-seat parked (held/deferred, oldest-parked): impl 164/13 280.8 h · scribe
44/0 290.0 h · devtools 33/2 290.3 h · qa 21/0 290.2 h · security 6/0 260.1 h · lead 4/1 252.0 h · pm 3/2 225.6 h ·
auditor 2/0 239.2 h · qa2 0/1 145.7 h · advocate/designer/architect 0/0 `no-work`.
**Providers (era-attributed, ROADMAP 226/229):** over the last 30 submission rows the attempts split
`local/iq3_s=14, deepinfra/…=8, unattributed=8` and **every failure in the window belongs to the `deepinfra` era — the
current `local/iq3_s` era has none.** Do not chase the `402`s in the recent rows; they are history (the 14,377 `402`
generations predate the 2026-10-27T04:55Z move to local).
**Seat capability (ROADMAP 217):** seat tools are `read write edit powershell prepare_workspace seat_root`; `pwsh` and
`powershell` are **both absent on this host** (`bash` is at `/usr/bin/bash` and is not registered); the store shows
`"toolName":"bash" -> 0`, `"toolName":"powershell" -> 20,340`, `spawn powershell ENOENT -> 3`, `spawn pwsh ENOENT -> 1`,
newest `entry #274074 2026-10-28T17:09:07.533Z conv 4930 = devtools isError=true`.
**Unsettled submissions:** 9 `placed` + 2 `queued` → `advancingConvIds()` counts **9 of 12 seats as ADVANCING**; after
pass 1's `reconcileStrandedSubmissions` all nine read **WAKE**. The 2 `queued` rows sit at the head of **pm's**
conversation and can never be aged out (never placed → no admitted entry to join).
**Worktrees:** **1 (this checkout, `main`)** — and `.git/worktrees` is **empty**; at the start of the previous session
the same command listed **36**, including 20 `C:\Users\Alex\…` paths. **No seat worktrees** exist here, and `/home/chexxor/Git/Durian-Pi-worktrees/`
is absent; local branches 2 (`main`, `wip/seat-prompt-files`). **Pi seat-agent state is host-local and absent here**, so a
seat worktree here is **created, not migrated** — the first `up`/`worktree`/`run`/`send` is the writing verb
`docs/runbooks/workspace-move.md` gates. `D:\` survives only as the source clone's remote path (`/mnt/d/Git/Durian-Pi`) —
never write there.

## INCIDENT (read before any `up`/`worktree`/`run`, and before trusting a "suite is green" claim)

`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md` (+ its committed `evidence-2026-10-24-windows-ledger.txt`).
In one session that ran **no writing verb on the workspace** the ledger went **36 → 1**, and eight instruments read or run
earlier in it are now **absent from disk and from `git ls-files`** — never committed, so `git status` shows no deletion and
there is nothing to restore. The ledger half is named in the product (`src/broker.mjs:1167` → `pruneWorktrees`,
`src/worktree.mjs:649`); the file-loss half is **unexplained**, and the same end state is recorded twice before
(`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md:20-30`, `:30`). Until 232/233 land: **do not run the suite from
this checkout** — run it in the disposable clone.

## OPERATOR OWES (four items; the team is blocked behind them — a fifth, the channel-start recipe, is superseded and cut to `docs/NEXT-ARCHIVE.md`)

1. **ROADMAP 221 — the seat-root ruling** (D152 §6 + D153 addendum). Seats' persisted agent cwd resolves to a
   `D:\Git\Durian-Pi-worktrees\<seat>`-shaped value on the Windows host, and `up` reports `source: persisted seat cwd`
   even after `up --root …`. There is **no `seatRoot` field in `rig.selfdev.json`** (seats carry no `cwd`) and none in
   `status`, so the residue lives in Pi agent state **no CLI prints**. Proposed ruling **A**: *the persisted per-seat root
   becomes the workspace-root-relative name; `up --root` once per seat is sufficient; no migration code.* Not inert on
   Linux: `classifyGitRoot("D:\Git\Durian-Pi-worktrees\engineer")` **on Linux** prints **`main-worktree`** — a stale
   Windows root mis-classifies as the LIVE tree (the F21 failure `src/seatroot.mjs` exists to prevent).
2. **The definition of "the queue drains"** in the operator clause inside `#725`/`#726`/`#727` bodies
   (`SEQUENCING CONSTRAINT (operator): do NOT start the daemon-host work before #662/#710 are done and the queue drains;
   not ahead of TUI`). #662/#710 cleared 2026-10-17; the clause has no threshold, predicate or surface, so the three
   top-ranked rows have been `held` for 12 days. **`pm` cannot clear it and neither can the delegate** — it is your
   sentence, and 231 is the product half.
3. **A grant on ledger surgery** (ROADMAP **232**). Today `pruneWorktrees` runs unconditionally from the broker sweep
   and after every removal, and on a moved workspace that deletes the registrations this rig's own runbooks call
   evidence. Until it is scoped, the safe operator stance on this host is: **no `up`, no `worktree`, no channel start**
   from the main checkout, and re-inventory (`git worktree list --porcelain > .spike/…`) before and after any writing
   verb.
4. **Commit-or-discard for untracked instruments** (ROADMAP **233**, the cost of **214**). Eight files this session read
   or ran are gone and unrecordable; several ROADMAP rows credit them as landed. Either the team re-creates them (labelled
   as re-created, not restored) or the rows that cite them get amended — that is a scope call for you, not for a seat.

## OPEN DELEGATE PROPOSALS (ungraded, not spooled, no grant yet — the operator asked that these be worked next; the harness half is now ROADMAP **235–243**, *registered, not scheduled*)

1. **The skill surface is the only thing a fresh session is *given*, and it is stale.** The harness injects every
   `.agents/skills/*/SKILL.md` `name:`+`description:` at session start with no read; grepping the two skills for
   `channel-preflight|broker-serve|instrument-provenance|queue-drain-audit|latency-budget|cross-clone` → **0 hits**.
2. **Edit A (~15 lines):** an "instruments you already have" table (cost, question answered, what it refuses) in
   `.agents/skills/delegating-to-durian-pi/SKILL.md`, plus those words in its `description:`. Stronger version, measured in the audit: **`.pi/APPEND_SYSTEM.md`** (always injected, survives compaction) and **`.pi/extensions/`** — `pi.registerTool()` for the instruments, a `before_agent_start` state digest, and a `tool_call` guard refusing `git worktree prune` / `git clean -fd` / suite runs on this checkout (the verbs that took the ledger). **This repo has no `.pi/` directory at all.**
3. **Edit B (highest value):** `docs/runbooks/cross-clone-object-recovery.md` **and its symptom row in
   `docs/runbooks/README.md`** (`a cited commit sha resolves nowhere`; `the other OS's clone holds refs/objects this clone
   lacks`) — `AGENTS.md` step 5 routes by symptom, no row matched, and the D156 archaeology cost ~15 turns.
4. **Edit C (done):** `instrument-provenance` is in the clock-in baseline. Skills steer the **outer agent**, never seats —
   seat tools come from `rig.selfdev.json`/`src/seattools.mjs` (217). **Ask:** A+B+C as delegate work, or rows for `pm`?

## HARNESS STUDY — three rounds landed (2026-10-28). The two-halves block and the first 241 summary are cut **VERBATIM** to `docs/NEXT-ARCHIVE.md` (last heading: 2026-10-28T23:5xZ) — that archived text still carries the **#978 mis-citation** this session corrected, so read the pointer, not the archive.

**Round 3 landed and is verified:** `docs/reviews/harness-tools-skills-public-harnesses-research-r3.md` (as delivered, byte-for-byte from the session transcript) + `docs/reviews/harness-tools-skills-r3-delegate-notes-2026-10-28.md` (the check). 60 numbered citations; the delegate re-fetched every cited page and located **91 of 94** quoted fragments (14/14 issue-body quotes, all URLs 200). **Corpus:** `inputs/fetched/MANIFEST.md` §4.

**Register changes:** 241's threat-model question is **answered at the pin** (hook trust = `HookStateToml { enabled, trusted_hash, trusted_content_hash }`, writable only from the `User`/`SessionFlags` layers — `codex · d373d649 · hooks/src/config_rules.rs:8-14,24-30`) → registered **245**: *a repository may carry a guard; it may not bless itself*. **246** registered — a guard *listed as active while not running* (#2540 plugin hooks never fire; #5098 a sandbox-config change silently stops a hook, "`/env` still lists the hook"; #3590 `ask` rendered as allow) means **the per-decision record is the control, not the guard**. **242** gained a second blind spot: pins record **no remote**, and `block/goose` → **HTTP 301** → `aaif-goose/goose` (200), so a moved upstream still "passes" `--check`. Goose is **not guard-less** — first `observed` guard evidence at `goose · 775b3958`: project-scoped `<project>/.agents/plugins/*/hooks/hooks.json`, `AlwaysAllow/AskBefore/NeverAllow` (`config/permission.rs:21-24`) and a **model-based judge** (`permission/permission_judge.rs`).

**The tally this pointer used to carry ("four of five fail open") is corrected:** failure direction is **per-event and per-version** — Copilot CLI's command `preToolUse` fails **closed** on crash/invalid JSON, and the *same* guard flipped direction between **v1.0.18 and v1.0.57** (#2540). Specify the direction per event, pin the release it was measured against, re-assert it at load, and treat **timeout** as its own decision. **241 stays open** on the permission profiles (`core/src/config/permissions.rs` 883, `config/src/permissions_toml.rs` 680, `permission_profile_catalog.rs` 145 — measured at the pin 2026-10-28) and the requirements/network tiers; that is now **delegate source work, not more web research**, alongside `cline · 51f63e4f`'s real `clinerules` loader. **Granted 2026-10-28 (D158), still unbuilt:** the `.pi/`-shaped work (235/236/238) ships as an **installable pi package developed in this tree** (`pi install --local ./<dir>` → one line in `.pi/settings.json`, read only after project trust), not hand-written `.pi/` files; and 232 is **gated on 241** — read `vendor/eval/codex · d373d649`'s permission engine and the Copilot CLI failure class before anyone claims it. **Owed from here (the delegate cannot call the research agent):** route `docs/reviews/harness-tools-skills-followup-2-research-prompt.md`, **Task A first** (50 dangling anchors + 3 dead Goose URLs = ROADMAP **243**), then Q1–Q6. Zero-cost today, no grant needed: open a session with `/skill:delegating-to-durian-pi` (`docs/skills.md` admits the model may skip a skill).

**Corpus warning (237):** `tools/harness-usage-census.mjs` prints no corpus. On this host today: **18 sessions / 2,356 calls / 267 ad-hoc (11.3%)**; the audit's 87 / 11,599 / 24.0% needs both hosts' transcripts and the Windows set is absent here (no D: volume mounted). Quote the corpus with the number.

**Two integrity rules this session produced, both cheap to keep.** (a) **Fetch the pointer, read its title, then repeat the claim** (D159 addendum): the delegate had attributed copilot-cli **#978/#4438** — real issues, correctly cited by the report for its *skills* claims — to that harness's *hooks* behaviour, and propagated it into three files; title-checking replaced a weak citation with #2893/#3590/#2540/#5098. Delegates fetch cited pages into `inputs/fetched/` and keep `MANIFEST.md` (URL, HTTP, sha256, phrases found; **page bytes untracked on purpose** — 8.2 MB). (b) **Name the host and timezone on every measurement** (ROADMAP **244**): every date this session wrote said **2026-10-29** while the host clock is **2026-10-28 CDT (UTC−5)**, and the wrong date reached a filename (now renamed) and ~60 prose lines. **The phantom-citation half of 244 is closed by the operator (2026-10-28): "Forget about the phantom citation"** — `docs/incidents/2026-10-29-windows-vm-suite-self-sweep.md` stays missing and the recovery ask is **withdrawn**; do not chase it unless the operator reopens it. What stays live is the **date/timezone half** and the **cited-path check**, and round 3 caught the same class in the delegate three more times — a `permissions_toml.rs` size asserted from a summary (**1,457** claimed, **680** measured), a claim that `docs/COMPETITORS.md` holds a "goose is guard-less" row when **no such row exists**, and a Goose `checks/*.sh` mechanism inherited from a summary that is in **neither the deliverable nor the pin** (so it was **not registered**, and ROADMAP **240**'s "how do we know a recipe worked?" stays open). One command prevents all of it: read the file before repeating a claim about it.

## Then, in this order (measured ranking — `docs/reviews/wallclock-budget-2026-10-28.md` §6, ruling D153, amended by D154)

1. **#725 / #726 / #727 (channel resident) + the head of the queue** — **but land #217 + #232 + #233 first on this
   host** (all three measured this session): a seat here has **no spawnable shell** (217; the delegate half is landed —
   `--dry-run` now refuses on `seat-shell-availability`), the broker sweep **prunes the cross-OS ledger** (232;
   `src/broker.mjs:1167` → `pruneWorktrees`, measured **36 → 1** registrations inside one session), and eight
   instruments are **gone and unrecordable** (233). Only the ledger grant and the commit decision need you; the rest is
   cheaper to land than the channel it unblocks. History prices the channel: `run`-invoked days
   2026-10-13→15 waited **101.8–114.3 min** per claim and landed 47–132 items/day; resident-broker days 10-17→21 waited
   **2.6–5.4 min** and landed **314–741**/day. But 296 of 296 non-terminal rows are parked, so the release comes first:
   `tools/queue-drain-audit.mjs` says **71 of 91 non-terminal LANDING rows are already fully on main** (26% of held,
   zero-build closable) and names **69 orphan candidates** + **12 `manual` gate-prose rows** — the ids are printed now.
   Delegate brief prepared, **not spooled**: `.spike/delegate/pm-release-brief-2026-10-28.md`; spool with
   `node intent.mjs pm --body-file .spike/delegate/pm-release-brief-2026-10-28.md --request-id release-brief-2026-10-28`
   (safe while the broker is down — it only queues; **it is gated on (1) and (2) above**, because the first released row
   creates this host's first seat worktree).
2. **ROADMAP 225 — decompose a running generation's wall-clock.** **0.23% of generations ≥10 min hold 156.8 h (39.0%)**
   of machine busy time on 1–3 committed events. Related today from the other side: **9 `pi.generation` rows are persisted
   `running` while no process can own them**, and `isAdvancingTask` reads pi-durable's derived `state.kind`, which is not
   persisted — so "is anything running?" is not answerable from the store.
3. **ROADMAP 226 — stop waking seats onto a dead provider.** 14,630 generations (24.4%) ended in an error, 59.2 h;
   **14,377** are one unfunded account's `402`. Measured at small scale: **6 of the last 30 submissions settled
   `unanswered`** (5× `402 "You need positive balance"`, 1× `Provider is not configured: deepinfra`).
4. **ROADMAP 227 — held-backlog drainability as a product finding.** 277 `held` idle a median **213.5 h**; the release
   rule only reports. Releasing stays **`pm`'s** verb.
5. **The rest are measured in the rows themselves, not here:** **228** (big reads, `queue` has no filters —
   `status` 22.7 MB, `queue --json` 21.2 MB, `cmdQueue` `cli.mjs:1018-1021` takes no arguments), **229** (admission age
   never persisted), **230** (the product half of the channel-start surface), **231** (make hold reasons evaluable),
   **208** (94.0% cache hit; 23,053 prompts > 150,000 tokens, max 1,009,360 against a declared 200,000 window).

## Do not "fix" these on the strength of the docs

**An orphan-candidate verdict is not a release recommendation** — #725/#726/#727 have every cited gate `done` and are
*correctly* held by an operator clause; read the body (`stale-held-backlog.md` §Do). **A swept worktree ledger is not
"self-healing"** — on a moved workspace `git worktree prune` deletes evidence, and it runs unconditionally
(`src/broker.mjs:1167`); if `git worktree list` shrinks across your session, stop and write it down. **A suite that runs
"green" after files vanished is not green** — `scripts/suite.mjs:36` enumerates with `readdirSync(demoDir)`, so a deleted
member is a silent shrink, not a failure (233). **A `402` in a recent submission row is not current provider state** —
attribute it by joining to the first assistant entry after the admitted one (§Rig state, ROADMAP 226/229). **A `WAKE` in the preflight's
"after pass-1 reconcile" column is a prediction about reconcile**, not a delivered wake. **`queued` is not `claimable`**
in the queue sense: the queue's claimable state is `queued` *items*, and submission rows are a different table — mixing
them is how this session nearly mis-wrote 229. **`admissionVerdict` being inert means aged `queued` rows are never
withdrawn** — do not "recover" them by hand with a second writing Harness. `DURIG_MAX_CONCURRENT_SEATS` is unset in
`durig.config.json`, `"1"` in `durig.config.default.json`, and the observed profile is **not** single-flight (max 11 in
flight) — read `src/config.mjs loadConfig` first (D153 §4). The 5-minute degeneration bound is a *turn* guard on a
different quantity, and the 5-minute **admission** deadline is a different 5 minutes again. A `--dry-run` names no
removals (resets model+cwd only) — not a safety check. Model speed is **12.7%** of machine time. `tools/` is untested by
design except where a demo is named.

