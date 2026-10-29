# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces ([^1] [^2] [^3] …); it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-29T04:0xZ = **2026-10-28 23:0x host-local** (`America/Chicago`, CDT = UTC−5; every stamp here is **Z** — ROADMAP 244). Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc42.x86_64`, node v24.22.1. Delegate session. **This session built ROADMAP 250's two halves** — `tools/review-cite-check.mjs` (1.3 s over 127 files, self-test 12/12) and the alias table `docs/reviews/harness-citation-registry.md` (29 rows) — and registered **252** from what the instrument then measured across the corpus: **292 hard findings — 89 undefined citation keys, 108 key collisions, 71 duplicate definitions, 9 phantom path cites, 5 dead URLs** (`docs/reviews/citation-integrity-corpus-2026-10-29.md`). **It also disproved two numbers this pointer was carrying:** round 2's 9 dangling keys are **3 confirmed + 5 inferred + 1 unnamed**, and **round 3 collides too** (`[^1]`,`[^2]`,`[^3]`), so "already verified" ≠ key-compatible. **Prior session discharged the round-4 research gate** and registered **250/251** (`docs/reviews/harness-r4-verification-2026-10-29.md`): round 4's Task A is **not paste-able**. **Prior session:** **ROADMAP 241's research gate is discharged:** the second design note read the permission planes at the pin — `docs/reviews/codex-permission-model-and-guard-plane-2026-10-28.md` — answering where a rule lives, who may bypass it and where the trust bit persists, with **58 of 59** citation/size self-checks PASSING at the pin. Registered from it: **247** (an upper layer that can only tighten — `src/config.mjs:169-219` has no such direction) and **248** (loaded ≠ enabled ≠ trusted ≠ overridden, typed per component); **249** registers the round-4 sandbox's structural limits. **Round 4 is now VERIFIED and still unintegrated — its Task A must not be pasted (250)** — see the HARNESS STUDY section. Session notes (what was re-measured, what cost turns, speed proposals): this session `docs/reviews/delegate-notes-2026-10-29-r4-gate.md` §8 (and the instrument's durable rules in **D162**); prior `docs/reviews/delegate-notes-2026-10-29-r4-gate.md` §1–§7 and `docs/reviews/delegate-notes-2026-10-28-241-closed.md`. **Committed, not pushed (233 hygiene): `70d5f78d` (tool + registry + MANIFEST §6 + evidence note + 252), `84d32e33` (D162), plus the census-realignment commit at HEAD — read `git log --oneline -3` rather than trusting shas in a pointer, because amending changes them** — the instrument is in git now, so it cannot vanish the way the eight lost ones did. **Newly measured, and it reorders the work: ROADMAP 217, 232, 233 and 235–251 have no queue rows** — none of 4,821 rows names them, so nothing has ever been spooled to `pm` for the items this pointer calls blocking. Five pins (`codex d373d649`, `cline 51f63e4f`, `goose 775b3958`, `claude-code-docs 58d6da1e`, `copilot-cli 84ee80ea`); `tools/vendor-pins.mjs --check` PASS at 14 clones, re-run 2026-10-29T02:44Z. Read me first — do not re-derive the priority from the ~4,700-line roadmap. History: **`docs/NEXT-ARCHIVE.md`**. This file is a **pointer, capped at 200 lines** by `demo/next-pointer.test.mjs`, which also requires the `## NEXT SESSION` block below to carry a current item, a queue id, a `node cli.mjs` command and a `**Blocker:**` line — **rewrite it in place, do not restyle it.** Its two executable readers are `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs` (the digest reads only this section, so **the `NEXT-ARCHIVE.md` link must stay inside the pointer body**). After editing: `node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs`.

## NEXT SESSION

**Current item:** **get claimable work to the head of the queue, then keep the delivery channel resident** — but the
second half is now **blocked on this host by measurement, not by grant**: a seat woken here has **no shell that can
start** (ROADMAP **217**), and the product's own worktree sweep **prunes the `git worktree` ledger**, which on this
moved workspace erases the cross-OS evidence the runbooks call protected (new ROADMAP **232**,
`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`). The channel is still the largest measured
wall-clock lever: `queued=0` and `claimed=0` of 4,821 rows, all **296 non-terminal rows parked** (277 `held`, 19
`deferred`), and the last `done` transition anywhere is **2026-10-22T17:29:11.923Z (row #4787) — 153.4 h, 6.4 days stale**. A broker started
now wakes 9 seats onto *parked rows only* (`selectWakes`/`hasParked`, `src/driver.mjs:108`), and every one of them would
fail its first shell call (`spawn powershell ENOENT`, already firing inside the last broker pass).
**Queue ids:** **#725** (impl, ROADMAP 63 — `src/host.mjs` portable host supervisor), **#726** (devtools, ROADMAP 64 —
`durig daemon` CLI + trigger adapters), **#727** (qa, ROADMAP 67 — host chaos suite): all three `held`, all three in the
drain audit's **orphan-candidate** list (#662/#710 both `done`) while an **operator prose clause — "and the queue drains"
— has no definition anywhere in the tree** (ROADMAP **231**). Rows opened this session: **232** (the sweep prunes the ledger
ahead of any plan), **233** (instruments credited as landed were never committed and are gone), **234** (every gate is
wall-clock arithmetic while the store stamps relatively). Delegate halves landed: preflight §5/§7/§8, 233's check, refs+objects. Rows registered as **235–239** (harness lifecycle study) and **240–243** (the public-harness half + its five pins) — registered, not scheduled; `pm` sequences them against 217/232/233. Registered this session: **250** (citation keys are an unowned namespace — **9 of 23 dangling** in the integrated report, and round 4 re-uses `[^1]`/`[^2]` for **other pages**, so pasting its "repair" silently re-points citations ROADMAP relies on; **both fix halves shipped 2026-10-29: the alias table `docs/reviews/harness-citation-registry.md` + `tools/review-cite-check.mjs`**, which also found a **third** collision — round 3 re-defines `[^1]`,`[^2]`,`[^3]`) and **251** (§6's user reports cite copilot-cli, a vendor **outside the report's own five-harness set**, and its "none of these five is cloned" caveat is stale — 4 of 5 are pinned, so those cells re-anchor **at the pin**). Registered this session from the instrument's census: **252** (the review corpus itself: 524 findings / **292 hard** over 127 files, 81 of them clean — 89 hard dangling keys, 108 collisions, 71 duplicate definitions, 9 phantom path cites, 5 dead URLs; the checker exists, so the repair is unowned queue work — and its `--gate` needs a `check` rule to stop regrowing). Also registered last session: **247** (a deny-only, additive upper plane; `src/config.mjs:169-219` has no such direction) and **248** (loaded ≠ enabled ≠ trusted ≠ overridden, typed per component — the data model 235's `guard-status` needs). **235's delivery shape is ruled (D158): an installable pi package developed in this tree (`pi install --local ./<dir>`), not hand-written `.pi/` files. 232's research gate (241) is DISCHARGED — but 232 is still unclaimed, has no queue row, and still needs the ledger grant.**
**Next command (delegate, read-only — run in this order, ~4 s total):**

```bash
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json   # 3.3 s: four links + §7 seat capability (217) + provider-era attribution (226)
node tools/broker-serve.mjs --dry-run    # 2.9 s and it now REFUSES: `seat-shell-availability` + `live-tree-dirty`
DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json node cli.mjs queue --json \
  | jq -r '.items[] | select(.status=="queued" or .status=="claimed") | [.id,.status,(.to//"-")] | @tsv' | wc -l   # the head of the queue: 0 today
DURIG_DB=./selfdev.sqlite DURIG_CONFIG=./rig.selfdev.json node cli.mjs queue --json \
  | python3 -c "import sys,json,re; o=json.JSONDecoder().raw_decode(sys.stdin.read())[0]; print(sum(1 for i in o['items'] if re.search(r'ROADMAP (217|232|233|23[5-9]|24[0-9]|25[01])\b', i.get('subject','') or '')))"   # 0 — the blocking items were never spooled to pm
# operator action owed (small): confirm whether the round-3 paste lost its tail — the delegate's working summary held content
#   absent from the delivered file (citations past C60; a Goose `checks/*.sh` success predicate in neither the file nor the pin).
#   If such a mechanism exists, re-send that part; if not, record that the channel invented it.
#   Rounds 1–3 are DONE and verified (round 3: 60 citations, 91/94 fragments located, all URLs 200). No push owed: origin/main == HEAD.
```

**Blocker:** the operator ruled (D156/D157): the start stays **withheld on ROADMAP 217**, rehearsals run in the disposable
clone `/home/chexxor/Git/Durian-Pi-ops` (present, HEAD `6a5f7f89`, 469 MB, carries `.env.rehearsal`), and **nothing host-wide
is delegated** (`set-local-rtc 0` changes the whole OS — routed as ROADMAP **234**, detector `tools/channel-preflight.mjs` §8).
**The binding constraint is now spooling, not research:** 241's gate is discharged and 217's fix is small (host-conditional
shell tool in `src/seattools.mjs`; `demo/seattools.test.mjs:30 asserts the opposite and must be rewritten failing-first`), yet
no queue row exists for 217/232/233/235–251 and all 296 non-terminal rows are parked, so no seat can be pointed at it. **Applied under the grant:** the pre-move clone's 3 packs → this checkout: 9,301 →
22,362 objects, `git fsck` clean, **23/30 cited shas resolve**, 455 commits still anchored by nothing. **Granted 2026-10-28 (D158):** `--depth 1` competitor clones (five taken, pins regenerated, `--check` PASS at 14 clones); `.pi/` writes **permitted but disfavoured** — ship an installable pi package developed in this tree instead; and **232 is gated on research (241): do not claim it, do not touch `src/worktree.mjs:649` / `src/broker.mjs:1167`, and run no suite from this checkout while it is open.** Still owed: the 221 seat-root ruling; an evaluable **"the queue drains"** (231); a grant to mint `refs/rescued/orphan-*` for those 455; the Windows-host session corpus + `.spike/delegate-inventory-2026-10-26.txt` (237).
**Routed:** `delegate-routing-fact-20261028-2150`. **History:** `docs/NEXT-ARCHIVE.md`.

### Read-only baseline — run this before anything else (all seven re-run clean, Linux, 2026-10-29T03:5x–04:0xZ)
```bash
cd /home/chexxor/Git/Durian-Pi && git worktree list --porcelain | tee .spike/worktree-inventory-$(date +%Y-%m-%d)-after.txt   # 1 entry (main); the 36-row pre-move ledger is now COMMITTED: docs/incidents/evidence-2026-10-24-windows-ledger.txt
node tools/channel-preflight.mjs --db ./selfdev.sqlite --rig ./rig.selfdev.json      # 3.3 s — §1–§8, incl. seat capability (217), provider-era attribution (226), host-clock posture (234)
node tools/broker-serve.mjs --status      # 2.8 s; now also raises `seat-shell-availability` (217)
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 0.93 s: 91 non-terminal LANDING rows, 71 fully on main, ids printed
node tools/latency-budget.mjs --db ./selfdev.sqlite      # 3.0 s: the two wall-clock currencies
node tools/instrument-provenance.mjs && node scripts/clockin.mjs # 46 ms + 2.6 s: suite members git=238 disk=238 + ledger size (233, exits 1 on drift), then the digest
node tools/harness-usage-census.mjs ~/.pi/agent/sessions/--home-chexxor-Git-Durian-Pi-- # 0.55 s: how often PAST sessions re-used each instrument vs re-deriving it (24% of all calls are one-off measurement code)
node tools/review-cite-check.mjs --gate          # 1.3 s: keys, paths, line anchors, sizes, dead URLs across docs/reviews + docs/incidents (250/244/243, 252). Offline by default; `--fetch N` only if you accept that 403/429 are bot-blocks, not deaths
```

## Rig state, re-measured 2026-10-28T20:1xZ (Linux) — re-read, do not trust; the counts below were **re-confirmed identical** 2026-10-29T02:4x–03:1xZ (queue 4,821 = 3,748 done / 777 cancelled / 277 held / 19 deferred; 1 worktree; broker down, last pass 2026-10-28T17:09:58.308Z, pid 1771484 dead)

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

## OPERATOR OWES (five items; the team is blocked behind them — a sixth, the channel-start recipe, is superseded and cut to `docs/NEXT-ARCHIVE.md`)

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
4. **Commit-or-discard for untracked instruments** (ROADMAP **233**, the cost of **214**). Eight files one session read
   or ran are gone and unrecordable; several ROADMAP rows credit them as landed. **Measured 2026-10-29, two of them are
   still here and one is one `git add` from safety:** `.spike/extract-pi-src.mjs` (gitignored) and
   `.scratch/transcript-write-bodies.mjs` — **`.scratch/` is NOT in `.gitignore`** (only `.spike/` is, line 21;
   `git check-ignore` proves it), so ROADMAP 4480's "`.scratch/`/`.spike/` are gitignored" is half false and
   `docs/reviews/pi-harness-usage-audit-2026-10-28.md:78` still has a working copy. Either the team re-creates the rest
   (labelled re-created, not restored) or the rows citing them get amended — your scope call, not a seat's.
5. **A grant to spool the blocking ROADMAP items to `pm` at all** (measured 2026-10-29T03:0xZ). `queue --json` returns 4,821
   rows and **not one subject names ROADMAP 217, 232, 233 or 235–251** — they exist only in `docs/ROADMAP.md`, so no seat has
   ever been able to claim them and `pm` has never decomposed them. 241's research gate is discharged, so the cheapest real
   unblock (**217**: a host-conditional seat shell in `src/seattools.mjs`, with `demo/seattools.test.mjs:30` — which asserts
   the current no-`bash` choice — rewritten failing-first) is now queue work with no row. **Ask:** may the delegate spool one
   intent asking `pm` to decompose 217/232/233 and the 235–251 cluster against the existing parked rows? Spooling while the
   broker is down only queues (no wake), and decomposition stays `pm`'s.

## OPEN DELEGATE PROPOSALS (ungraded, not spooled, no grant yet — the operator asked that these be worked next; the harness half is now ROADMAP **235–251**, *registered, not scheduled*)

1. **The skill surface is the only thing a fresh session is *given*, and it is stale** — ROADMAP **235**'s cheap half. The harness injects every `.agents/skills/*/SKILL.md` `name:`+`description:` at session start with no read; grepping both skills for `channel-preflight|broker-serve|instrument-provenance|queue-drain-audit|latency-budget|cross-clone` → **0 hits**. **Edit A (~15 lines):** an "instruments you already have" table (cost, question answered, what it refuses) in `.agents/skills/delegating-to-durian-pi/SKILL.md` + those words in its `description:`. Stronger, measured in the audit: `.pi/APPEND_SYSTEM.md` (always injected, survives compaction) and `.pi/extensions/` — `pi.registerTool()` for the instruments, a `before_agent_start` digest, and a `tool_call` guard refusing `git worktree prune` / `git clean -fd` / suite runs on this checkout (the verbs that took the ledger). **No `.pi/` directory exists in this repo at all**; D158 rules the delivery shape as an installable pi package (`pi install --local ./<dir>`), not hand-written `.pi/` files.
2. **Edit B (highest value):** `docs/runbooks/cross-clone-object-recovery.md` **and its symptom row in `docs/runbooks/README.md`** (`a cited commit sha resolves nowhere`; `the other OS's clone holds refs/objects this clone lacks`) — `AGENTS.md` step 5 routes by symptom, no row matched, and the D156 archaeology cost ~15 turns.
3. **Edit C (done):** `instrument-provenance` is in the clock-in baseline. Skills steer the **outer agent**, never seats — seat tools come from `rig.selfdev.json`/`src/seattools.mjs` (217). **Ask:** A+B+C as delegate work, or rows for `pm`?
4. **A citation-checking instrument — BUILT 2026-10-29, so this item is now the CORPUS REPAIR, not the instrument** (ROADMAP **252**): `tools/review-cite-check.mjs` fails any `docs/reviews/*.md` marker with no definition in that file, prints the cross-round key-collision table, resolves every `path:line` reference at a `vendor/eval/` pin, compares asserted "N lines" figures with `wc -l` at that pin, and probes URL liveness opt-in. It replaced the hand-run 59-row check that was **lost** from gitignored `.spike/` (233 recurring). Measured: 127 files (**81 clean**), 524 findings / **292 hard**; `--self-test` **12/12**, because the instrument produced **eight false findings of its own** before it produced a true one (`wc -l` semantics, `.mdx` truncated to `.md`, a trailing backtick inside a URL, own-tree sizes scored as hard, a correction line read as a claim, "family" inferred from cross-citation, **a fenced example of a defect charged as the file having it**, and `--json` swallowing the next flag). The pre-fix run printed 589/297 — the 65 that vanished were its own false positives. **What is left is docs work with no queue row:** re-key rounds 3–4 onto round 2's numbers, then the 89/108/71 corpus repair, and choose a citation convention (path-at-a-pin, or footnotes defined once per file).

## HARNESS STUDY — rounds 1–3 landed and verified; **241 closed by a second design note**; **round 4's gate is DISCHARGED (2026-10-29): its Task A must not be pasted — ROADMAP 250**

Round 3 is verified (`docs/reviews/harness-tools-skills-public-harnesses-research-r3.md`, delivered byte-for-byte from the transcript, + `docs/reviews/harness-tools-skills-r3-delegate-notes-2026-10-28.md`: 91/94 quoted fragments located, all URLs 200). `docs/reviews/codex-permission-model-and-guard-plane-2026-10-28.md` then read the permission planes at the pin and closed 241; register delta = **245/246** plus this session's **247/248**. Everything else from that block — round 3's register changes, the corrected "four of five fail open" tally, the Goose `301` → `aaif-goose/goose` pin blind spot (242), the corpus warning and the two integrity rules — is cut **VERBATIM** to `docs/NEXT-ARCHIVE.md` (heading "CUT VERBATIM 2026-10-29T03:2xZ"); that archive still carries the **#978 mis-citation**, so read the pointer, not the archive. **Census re-measured this session (237 — quote the corpus with the number):** this host alone = **19 sessions / 2,669 tool calls / 296 ad-hoc measurement calls (11.1%)**; the audit's 87 / 11,599 / 24.0% needs both hosts, and the Windows transcripts are not on this box (no D: volume mounted).

**Owed from here — the round-4 gate is DONE, and so is 250's tooling half; what remains is seat work the delegate will not do:** the integration (merge round 4's admissible anchors into round 2) is **unblocked by the alias table `docs/reviews/harness-citation-registry.md`** and gated on the **re-keying** it records — which now covers **round 3 as well** (the checker found `[^3]` defined as `learn.chatgpt.com/docs/hooks` in round 3 vs `…/config-file/config-advanced` in round 2, so round 3 collides on `[^1]`,`[^2]`,`[^3]` and "60 citations, all URLs 200" does not mean key-compatible). It is queue work with no row yet, like 217/232/233/235–251; **8 of the registry's 14 alias rows are still `inferred`** (the checker re-raises them every run until a URL line exists). The Q1–Q6 half is confirmed NOT answering this rig's questions (its own caveat). Two integrity rules in one line: **fetch the cited pointer and read its title before repeating the claim**, and **name host + timezone on every measurement** (244) — the phantom-citation half of 244 is **withdrawn by the operator**; do not chase it. Zero-cost, no grant: open a session with `/skill:delegating-to-durian-pi` (`docs/skills.md` admits the model may skip a skill).
**ROUND 4 VERIFIED** — `docs/reviews/harness-r4-verification-2026-10-29.md` (delegate, 2026-10-29T03:0x–03:1xZ, Linux, HEAD `8557071e`). **Do NOT paste its Task A tables: its `[^1]`/`[^2]` name different pages than round 2's** (round 2 `[^1]`=hooks, `[^2]`=skills; round 4 `[^1]`=skills, `[^2]`=Cursor rules) and it re-keys already-numbered pages as hex tags — a paste silently re-points citations ROADMAP already relies on. Measured: round 2 = **184 marker occurrences / 23 base keys / 14 definitions → 9 DANGLING keys** (`542f21 b736c3 20106b d32e06 04a0b7 5389e9 3d9c8f 5f6188 dccefb`) carrying its load-bearing sentences; round 4 names a source for **6 of 9**, leaves 3 unresolved, and its `3d9c8f/dccefb`, `2d9eb4`, `04a0b7/d2cffc/d3d5bf` mappings are *inferred* (no URL printed) — check before use. **That 6/3 tally is now corrected (re-measured 2026-10-29T03:5xZ with the instrument): 3 confirmed (`542f21`, `5389e9` by printed URL; `d32e06` because its bytes re-fetch byte-identical to MANIFEST's `[^8]` row) + 5 inferred + 1 (`b736c3`) with no named source at all.** NEXT.md's previous "0 exact shared lines" was wrong as stated: **14 lines are identical** (`---`, table separators, `**References**`) and **132 of round 4's 146 non-blank lines appear nowhere in round 2** — so "not a duplicate" stands, "21 of its 64 markers also appear" reproduced exactly.
**Its four corrections, adjudicated:** REAL — §1's "all five" vs §2 line 77's Goose cell ("not found (global `~/.config/goose/config.yaml`)"); write "four of five, Goose's is global-only". NOT SUPPORTED — round 2 line 198 already reads "loadable by the user but unreachable by the model", which is what copilot-cli#4438's thread proves (comment 2026-09-11: the explicit slash invocation *injects* `<skill-context …>`; the model's redundant `skill()` call is what returns `Skill not found`); keep the consequence — a working injection path exists to copy — and drop the accusation. HALF FALSE — claude-code#57776 is closed `duplicate` with 0 reactions ✓, but **copilot-cli#978 is OPEN, `state_reason: reopened`** (8 reactions, 12 comments), so "author closed as model issue" is **false**; do not carry it. REAL-and-now-proved-at-a-pin — the three nav-link anchors: `vendor/eval/cline@51f63e4` `docs/customization/cline-rules.mdx` (398 lines) mentions "Memory Bank" **0 times**, and the fetched bytes carry it only as sidebar markup.
**New defect neither round found (ROADMAP 251):** §6's user-report rows cite **copilot-cli — a vendor outside the report's own five-harness matrix** — and §8 item 7 (line 244), "none of these five is cloned", is **stale**: `claude-code-docs 58d6da1`, `codex d373d64`, `cline 51f63e4`, `goose 775b395`, `copilot-cli 84ee80e` are pinned (14 clones, `--check` PASS), so those cells are upgradeable to `observed` **at a pin**, never by re-fetch (anchors rot). **`inputs/fetched/MANIFEST.md` §4 landed:** 2 pages re-fetched **byte-identical** to their §1 pins (`bfde51ac…`, `ca7dc20c…`) while the Cline locator rotted `features/` → `customization/` — a row must store the *final* URL; plus the 3 issue rows' live state. **MANIFEST §6 now records URL liveness as machine-readable rows** (probed 03:5xZ): the **3 Goose paths round 2 cites as `[^4] [^9] [^10]` are 404 with no redirect** — a naive `curl` without `-L` also calls the live-but-**moved** Cline and Cursor locators dead (308), which is the trap 243's wording invites — and round 2's §2 matrix rows 17–19 cite those 404s **again** as `advertised-elsewhere`, so a fix that edits only References leaves half the defect. Round 4 stays **untracked** until a seat integrates the admissible parts. (Already done, do not redo: the 3 dead Goose URLs are fixed from the pin — ROADMAP **243**; the *page* at `learn.chatgpt.com/docs/guides/goose-2-extensions` is still 404, so "fixed from the pin" means the citation moved to `vendor/eval/goose@775b395`, not that the web page came back.)

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

