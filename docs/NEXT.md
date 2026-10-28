# durian-pi — NEXT (current pointer)

> Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md) — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-28T03:05Z` session back
> lives in the archive. The cut is proven by concatenation (the block moved this session is 10956 B and is the
> byte-identical tail of the archive) and by `git log -p docs/NEXT.md` — see `docs/DECISIONS.md` D126, D129,
> D138, D139, D140, D141.

## NEXT SESSION (2026-10-28T05:30Z — CLOCK-OUT: THE MILESTONE IS CHOSEN — M5 (substrate → memory) — AND THE MEASURED DEFECT IS THAT THE OPERATOR’S OWN RULINGS NEVER REACHED THE STORE)

> Archive: older sessions live VERBATIM in `docs/NEXT-ARCHIVE.md` (the digest quotes this block, so the
> link has to be inside it — `demo/clockin-digest.test.mjs` checks that it is).
>
> **Label honesty:** these labels mark *sessions*, not a timeline — do not infer order or recency from them.

**Current item:** the operator was asked to **choose the next major milestone**; the delegate chose and
registered **M5 — the rig can say what a seat was allowed to do, and can remember what it saw**
(ROADMAP **171 → 172 → 173**, then **175 → 176 → 161 → 167/179 → 163 → 165/166 → 168/169**), recorded as a
**proposal in D141** and in the `docs/ROADMAP.md` §Milestones list. Case: **`docs/reviews/milestone-choice-2026-10-28.md`**.
**Ratification owed.** The delegate claimed, completed, deferred, routed, sent and transitioned **nothing**.

**The measured defect that chose it.** Over all **4,818** queue subjects: **ROADMAP 161–169 → 0 rows, 170–174 → 0
rows, 175–184 → 0 rows, 185–189 → 0 rows.** The operator ruled “memory first” (R3) and “security precedes” (R4) on
2026-10-27 (D130); neither has a single row in the system of record. Queue state: `done` 3,748 · `cancelled`
777 · `held` **274** · `deferred` **19** · **`queued` 0 · `claimed` 0**; broker `{\u201cstate\u201d:\u201cdown\u201d,\u201creason\u201d:\u201cno broker state\u201d}`;
attention = 5 seats `deferred_awaiting_answer` waiting on a human (#4813 pm, #4354 impl, #4816 lead, #4817
devtools, #4814 qa2). **Not idle because work finished — idle because nothing is releasable.** Of the 274 held
rows: 105 landing bookkeeping, 89 other, 56 registered backlog, 15 build, 9 verify. 98 cite shas; of 103
distinct shas `git cat-file --batch-check` resolves **95**, `missing` for **8** (`0c6fd7665 1d45af6 371f6be
67d885d 756100e a2eaf7b e29ddb8 fd4c233`) — with **1 worktree, 1 branch, 0 unmerged**, so **8 held rows cannot be
released, only re-derived or cancelled** (ROADMAP 190, live side).

**Gaps re-verified in code (so M5 names absences, not prose).** `src/seatguard.mjs` answers `{block: …}` at
`:360,371,378,386,391,397,403,414` and persists nothing — no `avc: denied` analogue (172). Reach is per-seat only
(`toolRemovalsFor` `src/seattools.mjs:262`, `COORDINATOR_REMOVALS` `:247`), never per-claim (173).
`search_history` matches nothing under `src/`, while pi-durable’s BM25 `rankDocuments`
(`vendor/pi-main/packages/durable/src/search.ts:52`) is used only by `codemode`/`tool-search`; the transcript
(273,948 ids, no `DELETE FROM entries`) is unread by any tool (176). `defineDoc` already used
(`src/rig.mjs:22,30,38,53,102`) — 177 needs a family, not a substrate. **M3 recorded DELIVERED** (tools
capability-narrowed; evidence on `complete_work` at `checkup.mjs:736,790`); **independence is the undelivered
half** — `single-model-rig` fix-now, all 12 seats on `local/iq3_s`.

**Baseline, re-measured on native Linux** (`Linux Alex-Desktop-Win10 7.2.11-200.fc44.x86_64`) at the commit
measured: `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` → **`pass: true`, 0 errors, 62
findings** (`duplicate-item` 54, `citation-unresolvable` 5, `single-model-rig` 1,
`verification-without-evidence` 1, `evidence-tree` 1). Suite **238/238 in 42.2 s** (`node scripts/test.mjs`).
Machine: A4000 **2,577 MiB** free, 3090 **305 MiB** free; Strata `iq3_s` live on `:47831` (`\u201cgpus\u201d:[1]`), LM
Studio live on `:1234` (ministral, flint, nomic-embed); no `DEEPINFRA_API_KEY` in the environment. Nothing
restarted, loaded, sent or transitioned.

**Blocker:** four operator rulings, none a build. (1) **Ratify or replace the milestone**: answer `M5`,
`189`, or `drain first`. (2) **The 189 verifier family** — unchanged since D137–D140, and now a
cost/throughput/context/availability choice, not a capability score (the gate cannot rank the resident
families at n = 8). (3) **The five parked rows** — recommended replies are already written in
`docs/reviews/parked-questions-2026-10-26.md`; answering them is the cheapest capacity available. (4)
**`#4785` was `done` with no artifact anywhere**; the \u201ccompletion without an artifact\u201d detector is still
unregistered. D139’s verifier-design ask is **still unsent** (`intent.mjs` spoofs operator input; broker down).

**Next thing, if the operator says `M5`.** Send the prepared intent — `.spike/delegate/pm-intent-milestone-5.md`
(drain precondition + the 171→176 order + hard constraints); it is written and un-sent. Then let `pm` decompose:
the delegate does not claim, route or release. Before ANY writing verb (`up`/`worktree`/`run`/`send`/
`complete`), take the `git worktree list --porcelain` + `git branch --list` + `ls .spike | wc -l` inventory
into `.spike/` and diff after (`AGENTS.md` step 7, `docs/runbooks/workspace-move.md`).

**Exact next command** (baseline, then the audit that makes the milestone actionable):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json
node scripts/test.mjs
DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/delegate/queue-audit.json
# then docs/runbooks/stale-held-backlog.md “Diagnose” steps 2–4 (held rows whose gates are terminal)
node scripts/clockin.mjs          # the bounded digest, not whole files
```

Expected: **`pass: true`, 0 errors, 62 findings, `single-model-rig` present**; **238/238 in ~42 s**; the digest
under its cap (`docs/NEXT.md` ≤ 200 lines).

**Do not:** claim/complete/defer/route anything yourself; release a row whose cited shas are unreachable;
build a memory tier (165/166) before 167’s gate, or an OS backstop (174) before 171’s position doc; add a
second summarizer next to pi-durable’s compaction (176’s rule); write memory to the shared tree (R1/R2 — one
store-mediated fact layer, one git-tracked human layer); cite a git sha as durable evidence (D133 —
`entries.id`); route `qa`/`qa2`/`auditor` at `ministral-3-14b-reasoning` (D137 stands) or edit
`rig.selfdev.json` model fields (the family ruling is the operator’s); download Devstral to settle 189 (it
cannot be settled at n = 8); run the k = 3 gate arms without checking free VRAM (3090 at **305 MiB**); use
`DURIAN_PI_DB` for the CLI (it is `DURIG_DB`); measure throughput with a serial hand-loop (D135) or from a
non-streaming call (D136); restart the operator’s LM Studio/Strata unasked; `git add -A`; push.

**Still in the tree, not the delegate’s, not landed:** `@earendil-works/pi-coding-agent` `1.3.0` → `^1.3.0`,
`package-lock.json`/`package.json` modified, `.scratch/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` untracked,
`AGENTS.md` modified by an earlier actor. The delegate touched none of it and committed only its own paths
(`docs/reviews/milestone-choice-2026-10-28.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/NEXT.md`,
`docs/NEXT-ARCHIVE.md`).
