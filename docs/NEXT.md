# durian-pi — NEXT (current pointer)

> Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-28T05:30Z` session back
> lives in the archive. The cut is proven by concatenation (the block moved this session is 7061 B and is the
> byte-identical tail of the archive, `sha256 dcea18fdc00bd5a3…`) and by `git log -p docs/NEXT.md` — see
> `docs/DECISIONS.md` D126, D129, D138, D139, D140, D141, D142.

## NEXT SESSION (2026-10-28T07:10Z — CLOCK-OUT: THE HELD-DRAIN AUDIT IS DONE, IT CORRECTS TWO POINTER NUMBERS, AND THE OPERATOR'S RULING IS STILL THE ONLY THING STANDING)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).
>
> **Label honesty:** these labels mark *sessions*, not a timeline — do not infer order or recency from them.

**Current item:** the audit `NEXT.md` named as the step that makes M5 actionable is **done and durable**:
**`docs/reviews/held-drain-audit-2026-10-28.md`** (read-only; decision D142). The delegate claimed, completed,
deferred, released, routed, sent, fetched and transitioned **nothing**. Two numbers the previous block asserted
are now **corrected**, and the `drain first` option is **priced**:

- **70 of the 86 held `LANDING LIST/ENTRY` rows are provably-landed bookkeeping** — every sha they cite is
  already an ancestor of `main` (`git cat-file -e <sha>^{commit}` + `git merge-base --is-ancestor <sha> main`).
  That is **26 % of the 274 held rows closeable with zero build work** — the cheapest capacity in the rig.
  Ids are in the review §4 and in the staged intent. (`#4378`, deferred→impl, is the team's own prior attempt
  at this class and may already cover a subset — `pm` should check before re-doing it.)
- **ROADMAP 190's live side is 30 shas / 38 rows / 2 stores, not 8 / 8 / 1** — and its **built detector is
  under-scoped too**. `src/citation.mjs`'s `CITED = /\b[0-9a-f]{8,40}\b/` reports **178 distinct / 73 unresolvable /
  218 rows / 4 non-terminal rows** (#3506, #3603, #3743, #4378); the same rule with the lower bound moved **8 → 7**
  reports **1,048 / 213 / 957 / 39 non-terminal** — exactly my 38 held rows plus #4378. 7 is git's default short-sha
  abbreviation and it is what this rig's landing convention writes (`@02f1a36`-style); **140 of the 213 unresolvable
  shas are 7-char**. So "4 non-terminal rows" is the sound of the rule being blind, not a clean bill — the owed half of
  190 needs the lower bound **plus an ambiguity check** (≈84 % of the new 7-char tokens resolve, so some resolve as an
  abbreviation of a *different* object).
- Of the 30 unresolvable shas, **24 exist as commit objects in the Windows repo** (remote `win`, mounted at
  `/run/media/chexxor/0094126294125A8C/Users/Alex/dsh-Projects/pi-opendurig`) but are **on no ref there** — proven with
  a `rev-list` over **every** ref tip (1,556 reachable objects; `win` has 32 `refs/heads`, 9 `refs/remotes/origin`,
  HEAD, and **no `refs/archived/*`**), not with `branch -a --contains`, which walks only `refs/heads` + `refs/remotes`
  and cannot see `refs/recovered/*` or `refs/archived/*`. **`git fetch win` will NOT recover them** (fetch transfers
  only ref-reachable objects); recovery is `git --git-dir=<win>/.git update-ref refs/recovered/<sha> <sha>` then fetch
  — a **write to the operator's Windows repo**, so a grant, not a delegate action. That convention already exists here
  (`refs/recovered/53fd8c6f8, bcf1a191c, be40620c9, dd2583b12`) and is why 5 held rows still resolve.
  **6 shas are in neither store:** `0c6fd7665 5d8c6237a c04cfac cfb4457 e8fdab6 eb7e69c1e` — but **that is not proof of
  lost work**: `src/citation.mjs`'s own header says the rule cannot tell a stale pointer from a loss, and its worked
  example is `0c6fd7665` (landing `0c6fd76e465…`, change on `main`). Patch-equivalence probes returned only
  defect-about-the-defect commits (`6a8180b`, `d5c268f`) for #3506/#3603/#3726/#3743/#4378 and **zero** for the
  `cfb4457` family (#1779–1782, 1786, 1788). Route the six to **#4804** (deferred → impl, "THE NINE SHAS ARE NOT
  REACHABLE"), do not open a seventh row. Whether GitHub `origin` holds any of them is **unverified** — nothing fetched.
- Why the old "8" was low: **the count was the width of its regex.** Strict `@([0-9a-f]{7,40})` → 135 distinct
  / 15 missing; loose hex (≥7, must contain a letter) → 237 / 30. Publish the regex with the count (D136, D138,
  D140, now D142).
- Orphan candidates (`WORK-ITEM-LIFECYCLE.md` §7, verbatim): 134 held rows carry gate prose, **67 cite only
  terminal gates**, **12 of those cite no resolvable id**; by recipient impl 47, devtools 6, qa 6, lead 3,
  auditor 2, scribe 2, pm 1. **A lead, not proof** — #994 (operator quiet window) and #2217 (machine capacity)
  sit in the cleared set and are correctly held.
- **Sync state, newly measured:** `origin/main` = `refs/remotes/win/main` = `b4c86ea`; local `main` = `0159af9`
  is **33 ahead / 0 behind**, and the Windows store does not contain `0159af9`. So 33 commits of project history
  exist only on this Linux box (unpushed — the operator holds the grant) and 24 shas the queue pins its gates on
  exist only, unreachable, on the Windows drive. That is D133's cost, measured: **a queue that pins gates on
  git object positions has no durable truth layer under it** — the strongest argument yet for M5's substrate half.

- **Three propagated claims that measured FALSE this session (native Linux, `cd52f76`).** (a) `DURIAN_PI_DB` is
  **ignored by the CLI** — pointing it at `./definitely-not-a-store.sqlite` still resolved `db: ./selfdev.sqlite`;
  `cli.mjs:143` is still `CFG.DURIG_DB ?? "./rig.sqlite"`, and what actually pins the store is **`durig.config.json`**
  (`DURIG_DB: "./selfdev.sqlite"`, plus the LOCAL/VERIFIER provider URLs). So bare `cli.mjs` is safe *on this repo* and
  wrong *anywhere else* — the passed path is silently discarded, which is worse than an error. `AGENTS.md` clock-in
  step 4 states the old shape ("silently opens an empty `./rig.sqlite`"); it is the operator's file and dirty, so it is
  a correction to *ask* for, not one to commit. (b) `docs/runbooks/broker-down-or-stalled.md` is **Windows-shaped**
  (`taskkill /F`, `$env:`, `scripts/serve-noroot.ps1`) and `scripts/` contains **no `*.sh`** — on a Linux host the
  runbook AGENTS.md step 5 mandates cannot be followed natively, and D131 forbids `wsl`/`docker`. Its own Diagnose
  line also passes the ignored `DURIAN_PI_DB=`. (c) **7 of 39 runbooks are `last_verified: unverified`**, and
  `staleRunbooks` (`scripts/clockin.mjs:110`) skips any runbook without a *dated* `last_verified` — so the staleness
  probe is structurally blind to exactly the runbooks that were never verified. That broker runbook is one of them.

**Delivery channel, newly measured — this is the real critical path.** The broker is down, and the only launcher in
`scripts/` is `serve-noroot.ps1` (15 lines: pin `DURIG_DB`, unset `DURIG_SEAT_ROOT`, spawn `node cli.mjs serve` detached
into `.spike/serve.{out,err}`). On this Linux host there is **no broker artifact at all** — `selfdev.sqlite.broker.json`
and `selfdev.sqlite.broker.log` are absent and no `[c]li.mjs serve` process exists, which is runbook shape (a) in its
extreme form: **this store has never been served from this box.** And the cost of that is already booked:
`selfdev.sqlite.broker.inbox/` holds **two operator intents to `pm`, stranded since 2026-10-27T05:04:46Z** —
`audit-15-orphans-and-5-parked` and `memory-decompose-v2`. The operator commissioned the decomposition ~a day before
this audit measured the backlog it would have had to work. **Do not spool my `.spike/delegate/pm-intent-held-drain.md`
before reading those two bodies** — `audit-15-orphans-and-5-parked` is very likely the same ask, and a duplicate intent
is noise delivered to a seat, not help. What is worth spooling is only the delta: the 71/69/30 measurements and the
recovery ask.
Provider status, measured and **stale in the roadmap's favour**: `ROADMAP.md:2875` says "none on the Linux box", but
`127.0.0.1:47831` advertises `iq3_s` (Qwen3.8-Flash-Next IQ3_S, 1 GPU) and `127.0.0.1:1234` advertises
`mistralai/ministral-3-14b-reasoning` — both HTTP 200. **161's provider gate is satisfied on this host right now**, which
unblocks the A/B harness if the operator picks M5. A Linux launcher is ~15 lines plus a demo — 191's own pattern, "one
mechanism, and a demo that proves the docs match the code".

**Blocker:** unchanged in kind, and no build is waiting on it — four operator rulings (D141). (1) **ratify or
replace the milestone** — answer `M5`, `189`, or `drain first`; this audit makes `drain first` a concrete
first option (**71** rows at floor 7, no GPU). (2) **The 189 verifier family** — a cost/throughput/context/availability
choice, not a capability score; the gate cannot rank the resident families at n = 8 (D140). (3) **The five
parked rows** — recommended replies already in `docs/reviews/parked-questions-2026-10-26.md`. (4) **`#4785`
`done` with no artifact anywhere**; the "completion without an artifact" detector is still unregistered.
D139's verifier-design ask is **still unsent** (broker down; `intent.mjs` spoofs operator input). **(5) NEW and most urgent: the broker, or a Linux launcher** — two operator intents have been undelivered since
2026-10-27; it gates (1)–(4) becoming real work.

**Queue (re-measured):** 4,818 subjects — `done` 3,748 · `cancelled` 777 · `held` **274** · `deferred` **19** ·
`queued` **0** · `claimed` **0**; broker `{state: down, reason: "no broker state"}`; attention = 5 seats
`deferred_awaiting_answer` (#4813 pm, #4354 impl, #4816 lead, #4817 devtools, #4814 qa2).

**Baseline, re-measured on native Linux** (`Linux Alex-Desktop-Win10 7.2.11-200.fc44.x86_64`, git 2.56.0) at
`0159af9`: `check rig.selfdev.json` → **`pass: true`, 62 findings** (`duplicate-item` 54, `citation-unresolvable`
5, `single-model-rig` 1, `verification-without-evidence` 1, `evidence-tree` 1), 0 errors; **238/238 in 41.9 s**;
`scripts/clockin.mjs` 111 lines. Nothing restarted, loaded, sent, fetched or transitioned.

**Next thing, if the operator says `M5`.** Spool the prepared intent — `.spike/delegate/pm-intent-milestone-5.md`
(drain precondition + the 171→176 order + hard constraints) — and **also** `.spike/delegate/pm-intent-held-drain.md`
(the 71 rows, the 69 candidates, the 6 lost shas, the recovery ask), `--request-id held-drain-facts-2026-10-28-1`.
Both need the broker up to confirm `delivered`. Then let `pm` decompose: the delegate does not claim, route or release.

**Exact next command** (measure first, then the one question):

```bash
node tools/queue-drain-audit.mjs --db ./selfdev.sqlite   # 1.2 s; prints its own regex; see the number rule below
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
node demo/next-pointer.test.mjs   # when you only touched docs, THIS first — ~40 s cheaper than the whole suite
node scripts/test.mjs
node scripts/clockin.mjs          # the bounded digest, not whole files
git fetch --dry-run=off --quiet origin && git rev-list --left-right --count refs/remotes/origin/main...main
# ^ only if the operator grants a fetch; expected 0 33 until a push happens
grep -c "check_rule: null" docs/runbooks/*.md | grep -c ':1'   # 39 today — 0/39 runbooks can re-test themselves
```

**The number rule (D142):** the audit prints the regex that produced it. `heldLandingAlreadyOnMain` is **71 today**
(floor 7, case-insensitive `LANDING (LIST|ENTRY)`; the same run at `--floor 8` returns **2**, which is the extractor
being blind, not progress). If that number is still 71 at the next clock-in, the drain has not been worked — that is the
falsifiable form of "soon enough", and it is one second to check rather than a four-minute audit. Counts in this file
moved when the pattern moved (86 → 91 landing rows, 67 → 69 orphan candidates): publish the pattern with the count.

Expected: **`pass: true`, 0 errors, 62 findings, `single-model-rig` present**; **238/238 in ~42 s**; digest under
its 200 B/line budget (`docs/NEXT.md` ≤ 200 lines).

**Do not:** claim/complete/defer/route/release anything yourself; release a row on the strength of the §7
heuristic without reading its body; **`git fetch win` expecting the 24 dangling shas back** (they are not
ref-reachable — they will not transfer); use `branch -a --contains` to prove reachability (it cannot see
`refs/recovered/*` or `refs/archived/*` — use `rev-list` over every ref tip); read the `citation-unresolvable`
rule's 4 findings as a clean bill (its `{8,40}` floor is blind to 7-char citations); write to the Windows repo
(`update-ref refs/recovered/*`) without the operator's grant; quote a held-row count without the regex that
produced it; treat `all-cited-landed` as proof outside the `LANDING LIST/ENTRY` family (the instrument reports **91**
such held rows, **71** already landed — the rest need their bodies read; #994, #2217 are legitimate); build a memory tier (165/166) before 167's gate, or an OS backstop (174)
before 171's position doc; add a second summarizer next to pi-durable's compaction (176's rule); cite a git sha as
durable evidence (D133 — `entries.id`); route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning` (D137 stands) or
edit `rig.selfdev.json` model fields (the family ruling is the operator's); run k = 3 gate arms without checking free
VRAM; restart the operator's LM Studio/Strata unasked; `git add -A`; push; run `wsl`/`docker`.

**Still in the tree, not the delegate's, not landed:** `@earendil-works/pi-coding-agent` `1.3.0` → `^1.3.0`,
`package-lock.json`/`package.json` modified, `.scratch/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` untracked,
`AGENTS.md` modified by an earlier actor. The delegate touched none of it and committed only its own paths
(`docs/reviews/held-drain-audit-2026-10-28.md`, `docs/DECISIONS.md`, `docs/NEXT.md`, `docs/NEXT-ARCHIVE.md`).
Sidecars are gitignored under `.spike/delegate/` (`queue-audit.json`, `held-sha-unresolvable.json`,
`held-sha-reach.json`, `inventory-pre-20261028.txt`, `pm-intent-held-drain.md`).
