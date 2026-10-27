# durian-pi — NEXT (current pointer)

> **Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-25T01:52Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126, D129).

## NEXT SESSION (2026-10-27T05:20Z — THE RIG IS ON THE OPERATOR'S LOCAL MODEL AND ON LINUX; WHAT IS OWED IS THE CROSS-FAMILY VERIFIER RULING AND A DECISION ABOUT THE SWEPT ITEM WORKTREES)

**Current item:** the operator's rulings are implemented — seats on the local endpoint, concurrency 2, the
pin relinked, and Linux registered as an operating platform. Two things now block useful seat work, and both
are rulings rather than builds:

1. **`check rig.selfdev.json` reports `single-model-rig`, severity fix-now** — "all 12 seats resolve to
   `local/iq3_s`, so a shared blind spot is systemic; per-seat models are already supported". The local
   server (`http://127.0.0.1:47831/v1`, Strata/PolyStrata) serves exactly **one** model, and
   `src/providers/local.mjs` builds **one** provider from one base URL, so the cross-family author/verifier
   rule (D48/D119) cannot hold while every seat is local. Ruling owed: load a second family and pay for the
   per-seat-base-URL code change, keep one verifier remote (needs the DeepInfra balance), or waive the rule
   in writing while the rig is single-model. Registered as **189**.
2. **The item worktrees, `item-*` branches and `.spike` scratch were swept mid-session** — see
   `docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`. Measured: `git worktree list` now returns 1
   (main) and `git branch` returns `main` only, where earlier in the same session they returned 13 and 12;
   `.spike` went 436 → 16. `git fsck --unreachable` finds **0** unreachable commits, and the shas the pointer
   cited as unmerged (`500969f42` = item-4785's seatguard fix, `8990303` = item-2801) are not objects in this
   clone, so on this machine that work is unreachable. `#3454` is still `held` with its branch gone. Decide
   whether to recover from the Windows rig (`C:\Users\Alex\dsh-Projects\pi-opendurig`, still the `cwd` the
   store holds) before anything else ages out.

**Provider economics measured on this box (they set the concurrency ruling):** 30,154 fresh prompt tokens
prefill in 16.9 s (~1,790 tok/s) and the server's prefix cache works (`cached 893/898` on a repeat); decode
31–39 tok/s one at a time. Three identical requests at once: 20.4 s wall vs 17.5 s sequential — aggregate
throughput rose ~21% while the worst request's decode fell to 14.7 tok/s. **So 2, not 3**: a seat turn is a
latency-bound agent loop, and 3 buys ~21% aggregate by making every seat's turn up to 2.8× slower. A real
seat turn on the local model is proven end-to-end: `scribe` replied `local ok` (store entry 273995).

**Suite, re-measured here at the relinked pin: 227 pass / 8 fail** (`for f in demo/*.test.mjs; do node
"$f"; done`). D129's six are stale; the current eight are listed in ROADMAP **185**, and one of them —
`broker-health` reading `up` with `passAgeMs: 420613` — is **not** OS-shaped, it is the `#4746`/`#4816`
verdict defect failing in the suite.

**Both research prompts came back and are consumed in part:** `docs/reviews/zero-trust-zero-agent-research.md`
(read in full for its verdict, gap table and decision table — it confirms 170 first, and its "smallest real
boundary = a spawn-time wrapper: Landlock/seccomp/bwrap on Linux" is *better* supported now that the rig is
on Linux) and `docs/reviews/memory-followup-research.md` (72 KB; **it contains two passes concatenated**, so
section numbers repeat — the second pass is operative). Its changes are registered as **175–184**; the
highest-value one is 176 (`search_history` over the immutable transcript, ~20 lines, `replay: "safe"`) and
the one that must run before any memory `section` is written is 175 (a per-turn-changing section may be a
full-prefix cache miss; whether the delta path is taken on our endpoint is `unverified`).

**Answers to the five parked questions** are in `docs/reviews/parked-questions-2026-10-26.md`, with the
read-only audit behind them (274 `held`, 22 carrying `blockedBy`, **15 whose gates are all terminal**). They
await the operator's approval before anything is spooled to `pm`.

**Blocker:** two operator rulings, not builds — (1) how cross-family verification holds while every seat is
on one local model (`check` says `single-model-rig`, fix-now; ROADMAP 189), and (2) whether to recover the
swept `item-*` branches/worktrees from the Windows rig before the unmerged work (`500969f42`, `8990303`,
`#3454`) ages out entirely; see `docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`.

**Exact next command** (after the two rulings above):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json      # single-model-rig must stop being fix-now
DURIG_DB=./selfdev.sqlite node intent.mjs pm --body-file .spike/delegate/intent-memory.md --request-id memory-decompose
```

**Config of record on this box** (`durig.config.json`, gitignored): `DURIG_DB=./selfdev.sqlite`,
`DURIG_MAX_CONCURRENT_SEATS=2`, `DURIG_LOCAL_BASE_URL=http://127.0.0.1:47831/v1`,
`DURIG_LOCAL_MODEL=iq3_s`, `DURIG_LOCAL_CONTEXT=200000`, `DURIG_STREAM_TIMEOUT_MS=1800000`. The rig file
(`rig.selfdev.json`, tracked) now carries `local/iq3_s` for all 12 seats.

**Do not:** run `up`/`send`/`run`/`complete` on this workspace before re-taking the worktree/branch/`.spike`
inventory into `.spike/` and diffing it after (AGENTS.md clock-in step 7); run `git add -A`; use
`DURIAN_PI_DB` (the variable is `DURIG_DB`); claim a suite-green state — it is 227/8 here.

