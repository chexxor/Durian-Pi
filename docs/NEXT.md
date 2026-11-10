# NEXT.md — current state and next actions

**Last update:** 2026-11-10T19:0xZ (delegate session **N26** — the **branch-landing + cleanup pass**: **56 refs
pruned**, **57 worktrees released**, refs **82 → 26**, worktrees **75 → 18**, `main` proven green. The three
compaction-gate landings are **reverted** because they took the whole CLI down. Measured with `git branch --format='%(refname:short)' | wc -l` and `git worktree list | wc -l`);
**count it live, do not trust this number** — the fleet mints refs while you measure. Nothing was pushed; the
delegate claimed, completed or deferred no row.)

**Milestone this window worked** — **landing the pinned pi (D255 → D256, ROADMAP 353–357)**. D255 staged the move;
this window executed it: pin → tag `v1.5.1`, `pi-schema` first in `packages`, the symbol migration in our source,
the two seams (`src/commitstream.mjs`, `src/livewatch.mjs`), the per-demo attribution in
`docs/reviews/pi-1.5.1-delta-review-2026-11-10.md` §8, and the landing pass. What is **not** closed: the three
policy calls (rows **#6171/#6172/#6173**), the item-5301 rework (**#6174**), the superseded WIP disposition
(**#6178**), and the 13 held worktrees. The other open thread, the auto-clean ceiling (D249, ROADMAP **311** cut 2 /
**344**), is still spooled and now has a named defect row, **#6174**.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** the **branch-cleanup pass** (`docs/runbooks/branch-cleanup.md`). Its git half is **closed**: refs
**82 → 26**, worktrees **75 → 18**, `main` green. What is left is fleet work, not git work — the **item-5301 re-cut
(#6174)**, the uncommitted `sync-pi --no-repair` work stranded in the `item-6057` worktree (**#6060**), the four
dirty trees named below, and the three pin-policy rows (**#6171/#6172/#6173**).

**Milestone this window worked** — **landing the accumulated branches and pruning them (the branch-cleanup pass)**,
with the pin move (D255 → D256, ROADMAP 353–357) as the frame it operated in.

**Run these first, in this order** (every number below was measured on this box; re-measure rather than trust it):

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/suite.mjs --jobs 8                                        # 289 demos, expect exit 0
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json          # 1.15 s — total 18: seat-root 10, live 4, dirty 4, locked 0
DURIG_DB=./selfdev.sqlite node cli.mjs queue --status claimed --json --no-body   # 4 claimed rows; `rows: 6423` is the CENSUS, the payload is the filtered items
git branch --list; git worktree list | wc -l                          # 26 refs, 18 worktrees at clock-out
node scripts/sync-pi.mjs --check                                     # pin dd30101cf tag v1.5.1, drift true
```

**Blocker:** the broker is **DOWN, not wedged** — it exited at `2026-11-10T18:48:19Z` (`EXIT pid=3566266
reason=max-duration passes=328`), there is no `selfdev.sqlite.broker.json` and no `genlock` slot, so every read now
takes `readLocal` and answers fast: `node cli.mjs status --json` → `ok:true` in **2.46 s**, `cli.mjs worktree audit`
in **1.15 s**. **Restarting it wakes 12 seats and spends model money — the operator's call.** If restarted:
`node tools/broker-serve.mjs --dry-run`, then `set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 1800`. Ten read intents are still spooled in
`selfdev.sqlite.broker.inbox` and drain on the first real pass.

**What the cleanup left (all measured, `cli.mjs worktree audit`)** — 18 worktrees, **0 locked**: 10 seat roots
(`main`, `seatroot/linux` = advocate, and item trees for impl 6101, qa 6330, scribe 6216, devtools 6150, auditor
5604, designer 5995, security 6208, architect 5631), **4 live** rows (`item-1158` claimed, `item-3087` claimed dirty
2, `item-5912` held, `item-6177` claimed dirty 3), and **4 dirty orphans** whose items are `done`: `item-6057`
(2 tracked edits — a `sync-pi --no-repair` flag and its demo, **not on `main`**: `grep -c "no-repair" scripts/sync-pi.mjs`
→ 0, while `git merge-base --is-ancestor refs/heads/item-6057 refs/heads/main` exits 0, i.e. the branch is merged and
the work is not), `item-6290` (23 untracked solo-run logs, 45 KB), `item-6317` (3 logs), `item-6328` (1 log). Every
residue is exported to `.spike/worktree-residue/` (gitignored, 148 KB) before anything is touched. A dirty orphan is
refused on purpose: a seat commits it, or the operator rules it discarded.

**The recipe that made this fast (re-run it, it is idempotent):**

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit --json > .spike/wt.json
node -e 'const j=JSON.parse(require("fs").readFileSync(".spike/wt.json","utf8"));
 for(const w of j.worktrees) if(w.keepReason==="reapable") console.log(w.worktree)' | while read -r p; do git worktree remove "$p"; done   # 75 s for 57 trees, never --force
git worktree prune
```

**Paused goal (the operator resumes it with `/goal-resume`):** "every CLI verb answers or fails fast against a team
that is running or stopped, no 120 s silence, and Ctrl-C actually terminates the running command." Its WIP is in
`stash@{0}` (a copy at `.spike/goal-wip/wip-tracked.patch`, 640 lines) and was deliberately NOT restored — half-written
code breaks the green suite. The cheapest probe that shows where it stands now: `time node cli.mjs status --json`
with the broker down (**2.46 s**) versus with a broker resident but not passing (120 s, exit 1).

**Operator decision owed, not a git one:** `.spike/` is **13 GB** of gitignored scratch — 4.2 GB `fix-20261101`,
1.1 GB `fix-20261031`, 1.1 GB `backups`, 814 MB `delegate`, plus four store backups (435 MB, 419 MB, 419 MB, and
`.spike/backups/20261110T0551Z/selfdev.sqlite`). Deleting a store backup is the operator's call; the fix-* scratch
dirs are prior landing passes and can be pruned once their content is confirmed on `main`. Also note **`docs/NEXT.md`
is at 199 of the 200 counted lines** (`demo/next-pointer.test.mjs` enforces the cap): before appending anything, move
a section verbatim to `docs/NEXT-ARCHIVE.md`.

**Open decisions the operator owns:** (a) **item-6063/6064/6066** — the compaction-gate trio was reverted. Either
re-cut it against the 1.5.1 pin and current `main`, or accept the guard and set
`DURIG_COMPACTION_RESERVE_TOKENS=8192`, `DURIG_COMPACTION_KEEP_RECENT=9288`, `DURIG_COMPACTION_BACKGROUND=8192` in
the gitignored `durig.config.json` (the config write is operator-owned — `docs/runbooks/compaction-policy-refused.md`)
and fix `demo/compaction-coherence.test.mjs:77`, which asserts the pin has no `modelOverrides` reader while
`vendor/pi-main/packages/durable/dist/harness/agent.js:145` reads it. (b) **`item-3570`** and **`item-5301`** need a
seat re-cut, not a delegate merge (evidence in `docs/DISPOSITIONS.md` §Pass 2026-11-10). (c) Landing #3570 makes
**D261** false — it says there is no post-mint gate write path; `revise_work` would create one.

**State at clock-out:** refs **26**, worktrees **18** (`git branch --format='%(refname:short)' | wc -l` and
`git worktree list | wc -l`). Every ref left standing is either pinned by a worktree, ruled-kept (`item-3570`,
`item-5301`, `item-5301-resolved`, `verify-5180`, `wip/seat-prompt-files`) or the reverted compaction trio
(`item-6063/6064/6066`, kept as re-cut input). Queue census 6,423 rows — 4,365 done, 901 cancelled, 542 deferred,
435 held, 176 queued, 4 claimed. Store backup unchanged: `.spike/backups/20261110T0551Z/selfdev.sqlite`
(617,492,480 bytes, sha256 `0996cd61…`, `cmp` exit 0).

**Hazards the next session must not mistake for green:** (1) **`item-5301` and `item-5301-resolved` are not
landable** — the resolved branch merges clean but its own demo is red (`demo/worktree-reap.test.mjs:114` asserts
`dry.candidates/.refusedSoleCarrier/.kept/.counts`; `reapWorktrees` returns a bare array → `TypeError: Cannot read
properties of undefined (reading 'map')`, exit 1). (2) **`item-3570` is not landable as-is** — its demo needs the
1.5.1 `documentState`→`snapshot` migration AND asserts a refusal message (`blockedBy.0: must be integer`) that does
not exist in the installed pi-durable 1.5.1 (`grep -rn 'must be integer' node_modules/@earendil-works/pi-durable/dist/`
exit 1). (3) **`item-6063/6064/6066` are ancestors of `main` but their content is reverted** — `git branch -d` would
succeed on them; do not prune them, they are the input to the re-cut.

## The pinned-pi thread — v1.5.1 LANDED (ROADMAP 353–357)

Pin: tag `v1.5.1` = `dd30101cfc5b0609411dd80b6f93adbc14db14cf`; `pi-schema` **first** in the pin's `packages`
(chord fails `TS2307` otherwise); 10 built packages all 1.5.1. `--check` reports `policyGap: null` and
`drift: true / behind 14` against upstream tip `b2aabe029…` — **a tag pin can never satisfy `drift: false`, so the
contract's `drift: false` is mis-specified** (register the fix; do not chase it). The live store still reads
`durable_schema = [{singleton:1,version:2}]`: the move **migrated nothing**.

Migration, in our source (no upstream patching): `Type` → `pi-schema` builders (closed by default — `src/rig.mjs`'s
`Type.Object({}, {additionalProperties: true})` sites need `{ open: true }`); `documentState` → `snapshot`, which
returns the **value**, not a wrapper; `watchEvents` → `src/livewatch.mjs` `watchLive()`; `subscribeCommits` →
`src/commitstream.mjs` `followCommits()` over `Session.observeCommits`; `Storage.commit(batches, receive, ctx)`;
and `checkpointWhen: () => false` on the 6 rig docs, **provisional** (ROADMAP 355, rows #6171–#6173). Both seams are
documented as approximations: turn boundaries come from the generation attempt, not a turn record; tool results are
synthesised from committed `pi.tool-result` entries, not streamed.

**Stop rule that still applies:** `--unlink` is NOT a rollback — the live store is schema v2 and released pi-durable
≤ 1.3.0 cannot open it. Procedure: `docs/runbooks/pi-pin-update.md`; pitfalls **227–236**.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/test.mjs --all --jobs 8                  # 289 demos (290 on disk, 1 declared exclusion); exit 0
node demo/next-pointer.test.mjs                       # the pointer cap: NEXT.md must stay <= 200 counted lines
node tools/broker-serve.mjs --dry-run                 # "A start would be allowed" with ~/.config/durig/env sourced
set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --yes-pm-wakes --max-duration 1800
node cli.mjs status
```

## Current item (priority order)

1. **Close the three pin-policy rows** (ROADMAP 355): `checkpointWhen` per rig doc (**#6171**, architect),
   `persistWithinMs` 1,000 ms + `watchDoc()` or 0 + transaction load (**#6172**, lead), `restartLimit = 3` at the
   single `openHarness()` seam in `cli.mjs` pinned by a demo (**#6173**, impl).
2. **Re-cut `item-5301`** (**#6174**) — four defects, measured on the merged tree, listed in
   `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md` §8 and pitfall **232**. Do not land until all four close.
3. **Close the install gap** (ROADMAP **352**, rows **#6125/#6127**): nothing at session start runs
   `tools/compaction-guard-install.mjs --check`, so a fresh clone or worktree starts unguarded with no signal.
4. **Resolve the four DIRTY worktrees — the merged refs are gone; this is the residue.** `cli.mjs worktree audit`
   reports `dirty 4`: `item-6057` (2 tracked edits — `scripts/sync-pi.mjs` + `demo/syncpi.test.mjs` adding a
   `--no-repair` flag, **#6060 work that is NOT on `main`** even though `item-6057`'s tip is an ancestor of `main`),
   `item-6290` (23 untracked solo-run logs), `item-6317` (3), `item-6328` (1). All residue is exported to
   `.spike/worktree-residue/` (gitignored, 148 KB). A dirty orphan is refused on purpose — a seat commits it or the
   operator rules it discarded (`docs/runbooks/leaked-worktrees.md` §Do 2). `verify-5180`, `item-5301`,
   `item-5301-resolved`, `item-3570`, `wip/seat-prompt-files` and the reverted `item-6063/6064/6066` stay by ruling
   (ROADMAP 344, `docs/DISPOSITIONS.md` rows) — none of them is held by a worktree any more, so the *only* thing
   keeping them is the ledger.
5. **Promote the pin probes out of `.spike/`** (**#6176**): `.spike/pin-update/migrate-symbols.mjs` and
   `.spike/pin-update/signature-classify.mjs` are the instruments that made this window fast; an unpromoted probe
   is lost (ROADMAP 312).
6. **Broker alive-but-dead** (**#6160**): heartbeat advances, pass clock freezes, every broker-routed read times out
   while a direct read-only open answers. Observed twice this window; recovery is `kill -INT` → `resume` → restart.
7. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5, gate baseline
   **3 PASS, 1 PARTIAL, 4 FAIL** (`docs/evidence/2026-11-09-milestone-m5/gate.mjs`, 1.6 s).

## State the team is in

Fleet awake: 12 seats (11 on `local2/qwen3.8-flash-next-q2_0`, auditor on `verifier/openai/gpt-oss-120b`). Queue
census **6,423 rows** measured 2026-11-10T19:0xZ with no broker resident: 4,365 done, 901 cancelled, 542 deferred,
435 held, 176 queued, 4 claimed. pm minted **#6171–#6178** from the delegate intent (`requestId b0488417-b203-4df7-83dd-077406980a9f`,
`delivered: true`); other seats minted their own rows this window (#6163–#6170). **The delegate asserted no row.**
Six branches landed (`item-1779`, `item-2915`, `item-3041`, `item-6067`, `item-6082`, `item-6121` + the
`item-6082-mig` fork); two are deliberately not landed and are named with reasons above.

**Blocker (operator grants only):** the verifier leg is armed but `DURIG_VERIFIER_API_KEY` spend is capped, and
`local2` is a shared LAN box — `broker-serve --dry-run` BLOCKed once on `provider-local2-completion-failed: timeout
after 20s` while a direct curl answered in **1.6 s**. Retry the preflight rather than reconfiguring.

**Unverified:** (1) live TUI streaming is coarser at the new pin because it rides `pi.live`'s throttled partial
commits — plausible, not measured; the probe that would close it is a `latency-budget` run comparing entry cadence
before/after. (2) Whether any rig doc actually needs checkpoints (the `() => false` provisional) is undecided by
design. (3) `item-5301-resolved` exists as a fork with only the syntax fix; it was **not** landed, so its reap verb
is not on `main`.

**Cost:** spend ledger unchanged — **$0.00** this window (every call went to the loopback provider priced 0/0).
Wall clock: the full suite is **47.8 s** (was 61.8 s at the old pin); a merged-tree gate per branch is ~47 s;
`rig-portability-audit` 1,084 ms when the store is readable; the broker preflight ~4 s. **Speed-up worth adopting:** gate every candidate
branch with `node --check cli.mjs` + `git merge-tree --write-tree` before spending a 47 s suite (pitfall **232**),
and never run three full suites concurrently — contention produced two false reds this window (pitfall **235**).

**Traps this window** — `docs/SELFDEV.md` **245–248** (a broker that exits on `--max-duration` cures the dark reads
by disappearing; an ancestor ref can still hide sole-copy work in a dirty worktree; `queue --json`'s `rows` is the
census, not the match; the 57-tree worktree release is 75 s and needs no broker, no store write, no model). The
previous window's traps are **241–244** and **232–240**.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
