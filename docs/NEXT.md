# NEXT.md — current state and next actions

**Last update:** 2026-11-04 (delegate session, post-landing pass).

## NEXT SESSION

Superseded session blocks are archived verbatim in `docs/NEXT-ARCHIVE.md`.

**Current item:** **#5079** — devtools re-cuts `item-4955` onto today's trunk (union-resolve the
`docs/runbooks/session-start-cost.md` conflict), then **#5083** is my landing entry (gated on row id **5079**,
land the SHA it reports, never `d1c6d8a6`, never the ref).
**Blocker:** none for the dispatch — but `main` moves under it (#5080/#5082/#5085/#5087 are queued), and there
is no verifier-class provider (nothing on `127.0.0.1:1234`), which gates #5052/#5055/#5058.

**ROADMAP 228 is delivered and in `main`.** `main = origin/main = 89c474d0`, 8 worktrees (5 locked),
branches with unique work = 2 (`item-4955` ahead 2, `wip/seat-prompt-files` ahead 1). A delegate reading
one row now pays **4,563 B instead of 22,432,332 B** (`queue --id 5069`, 4,915x, measured on the landed
trunk); `queue` and `queue --json` stay exit 0 and byte-identical, unknown flags exit 1 at 103 B.

The five things that landed since that pointer: `f9f8f389` (the three capacity rulings), `203849c3`
(#5047 metering plane), `e3118fa0` (#5049 the context-fraction guard, roadmap 208), `89c474d0` (#5039 +
#5063, roadmap 228) and three docs commits. The rig kept working while I verified: #5039, #5063, #5074,
#5064, #5065, #5066, #5069, #5071, #5056 and #5061 were all created or routed by seats during this session.

**Exact next command** (from `/home/chexxor/Git/Durian-Pi`, after writing the brief):

```bash
node tools/seat-turn-shape.mjs                     # confirm no seat is generating
cd /home/chexxor/Git/durian-dev/seatroot
node cli.mjs send devtools --body-file .spike/delegate-20261104/brief-devtools-4.md --request-id d009-devtools --no-stream
```

The brief must be WRITTEN first: it carries **#5079** (re-cut; stop and defer if `cli.mjs`/`src/causes.mjs`
conflict), then #5064/#5065 (the docs rows still queued). Then **#5080 → `impl`** — but `impl` is **dark**
(no broker is up: nothing on `serve`, so no seat self-wakes; impl context 167,445/200,000 = 0.837, so reset
it first).

**Answers already owed to `lead`** (asked in its d008 turn, measured, not yet sent):
1. **#5056 is addressed to `qa`, not `impl`** (`queued impl -> qa`), and qa's window is 24,576 with 23,213
   consumed (0.945) — lead's ranking of that row cannot reach its addressee; #5080 (to impl) is the live route.
2. **`impl` is dark**: the broker is down (no `serve` process), so nothing wakes it; say so and lead can keep
   #5080 queued or let me send it.
3. **#5064 and #5065 are still `queued` to devtools** — not done.
4. **Locked worktrees and terminality:** `item-4799` = terminal (`done`, branch merged, **dirty** with two
   untracked scratch files, so unlock + discard is an operator call); `item-4937` held, `item-4967` claimed,
   `item-4997` held, `item-4970` deferred — **not** terminal, leave locked.

## Why this is the priority

Roadmap items **271, 208 and 228 are done.** The remaining delegate-facing gaps, in the order the team is
working them: **#5066** (#4955's read-verb fix — the row turned `done` at 02:42 on 2026-11-04, but the branch
was never verified against a trunk that has since moved twice, and it is the only branch with unique code
work sitting unlanded), **#5071** (the *complete* known/unknown
flag table for every read verb + the refusal — #5063 deliberately pinned only `queue`), **#5067**
(`wip/seat-prompt-files`, parked by lead and released only after #5071), **#5050** (roadmap 211's pointer
build, gated on #5047 + #5037 + #5045), and **#5052/#5055/#5058** (the verify legs, gated on an operator
answer: the verifier class has no provider).

## State

- **Trunk:** `main = origin/main = 3ac59b55` (#5071 landed this session). `git worktree list` first entry is
  the landing worktree; the seat root mirror at `/home/chexxor/Git/durian-dev/seatroot` is realigned to the
  same sha (branch `seatroot/linux`). Worktrees 8 (5 locked); branches holding unique work: `item-4955`
  (ahead 2), `wip/seat-prompt-files` (ahead 1).
- **Queue (live census, 834-class read):** 5,078 rows — done 3,806 | cancelled 800 | held 337 | queued 117 |
  deferred 15 | claimed 3. Attention: 14 deferred items parked on questions, and **#4970 records NO TARGET**
  (“nobody has been asked”) — route to `lead`/`pm`.
- **`check` = 107 findings**, all store hygiene / rig shape (56 `duplicate-item`, 44 `citation-unresolvable`).
  `context-over-window` = `pass`. `instrument-provenance` = CLEAN.
- **Capacity (rig properties, D201 — never edit, never prefix):** context 200,000 / `MAX_TOKENS` 16,384 /
  `local/iq3_s` reserve 20,480. Spend caps armed 0.05 / 0.10 / 4.00 (D202).
- **Seat context (`status --json` → `context[seat]`, #5049's map):** pm 114,617/200,000 = 0.573 `current`;
  advocate 244,751/24,576 = 9.959 **`behind-boundary`** — the artifact the guard is designed to stay silent
  about, now readable directly off `head.state`.
- **GPU is the dispatch limit** — one 200k build wake at a time on this card.

## Watch-list (delegate)

- **Land #4955 only after lead's landing entry.** `merge-tree` exits **1** at `d1c6d8a6` (conflict:
  `docs/runbooks/session-start-cost.md`) — my earlier "exit 0" was wrong, and devtools proved it at two
  trunks. The row is `done` while the branch is unlanded, and the defect is live on `main` (a wrong
  `DURIG_DB` manufactures a 122,880 B store; the branch refuses with `cause:"no_store"`). Keep
  `seatroot/item-4955` (unlocked, clean) until the entry runs.
- **`demo/broker-stop-audit.test.mjs` (#5056) is a REAL flake, not my imagination:** it failed 2/2 under
  `--jobs 8` at `ea4ace6c` AND 1/1 at `main` `e3118fa0` in the same load window, while passing 3/3
  standalone. Discriminator that settled it: run the full suite at `main` in the same load window. Land
  entries now need that comparison, not just "the branch's suite is red".
- **`item-4799` (`/home/chexxor/Git/Durian-Pi/item-4799`, locked) is DIRTY** with two untracked scratch
  files (`.lcs.txt`, `.ta.txt`) while its row is `done` and its branch is merged. The clean-only guard
  refused removal on purpose. Disposition (discard vs commit) is the operator's.
- **`gemini-3.1-pro` is still catalog-refused at registration** — the refusal line prints on every CLI
  start (and breaks any test that requires pure JSON on stdout) until the operator drops the row or
  re-windows it. Ask.
- **`check`'s 108 findings** (18 `stale-claimed`, 12 `claim-lease-mismatch`, 9 `no-ack`, 9
  `claim-before-routing-gate`) are the team's store hygiene; route to `lead`/`pm`, never fix by hand.

## Operator decisions outstanding

1. Spend-cap **values** (0.05 / 0.10 / 4.00 provisional) and the `gemini-3.1-pro` row.
2. **A provider for the verifier class** — nothing listens on 127.0.0.1:1234, so no non-author verifier has
   ever run here (#5044); it gates #5052/#5055/#5058 and every "independent review" gate.
3. `item-4799`'s dirty scratch worktree (discard or keep).
4. Whether to rank #5056 (the broker-stop-audit flake) above the queued rows — it costs a suite re-run on
   every landing.

## Watch-list (seats)

- **#5063's compat ruling (#5074) is load-bearing:** a documented form that exits 0 on `main` is a *known*
  flag; refusal only after a migration window. #5071 owns the rest of the table.
- **`item-4986` is now pruned** (unlocked, clean, merged) — do not re-create it; the content is in main via
  `c2fc4032`.
- **`tools/queue-rows.mjs` is now a real tool** (`--census`, or named ids over a piped `queue --json` dump).
  Prefer `queue --id <id>` for one row; use the tool for many rows in one store open and for the census, for
  which the CLI still has no verb. The item object's status key is `status`, not `state`.
- **`queue` now takes `--id <id>` and refuses unknown flags cheaply.** Any seat script that passed an
  argument and silently received the 22 MB document now gets exit 1 — that is intended (#5063).

## CLOCK-OUT — 2026-11-04 delegate session (metering plane → 208 → 228)

**Landed and pushed** (`main = origin/main = 89c474d0`, five ranges): `f9f8f389` D201 capacity rulings;
`203849c3` #5047 metering plane (11/11 acceptance probe, suite 249/249); `e3118fa0` #5049 context-fraction
guard, roadmap 208 (suite 250/250, `CONTEXT-OVER-WINDOW PASS`, rule starts green over 12 live seats);
`89c474d0` #5039+#5063 row-scoped queue read, roadmap 228 (suite 252/252 at the merged sha, `cmp`-identical
`queue`/`queue --json`, `queue --id 5069` = 4,563 B live); plus docs. Each landing was done in the operator
checkout where `main` is checked out, then the seat-root mirror was hard-reset to the new sha, then the full
suite was re-run in the seat root (merge-tree's predicted tree matched the merge's tree at both of the last
two landings).

**Hygiene:** pruned `item-5039`, `item-5063` (clean, ancestor-proven) and unlocked+pruned `item-4986`
(row `done`, branch merged, clean — its content is in main via `c2fc4032`). Worktrees 11 → 8. `item-4799`
refused removal: two untracked scratch files; re-locked as found and reported.

**Not mine and not done:** no queue row was claimed, completed, deferred or routed by me; #4955 stays
unlanded pending lead's landing entry after #5066 reports.

**Ruled this session, recorded:** D203 (a documented verb form is a known flag; compat pin before refusal —
lead's ruling, landed by me). `demo/broker-stop-audit.test.mjs` (#5056) is a load-sensitive flake that
reproduces at `main`; the discriminator is in SELFDEV pitfall 12. `tools/queue-rows.mjs` promoted out of
`.spike/`.

**Second clock-out, same day (#5071 landed).** Landed `4f1986ac` as `3ac59b55` after my own read: merge-tree
exit 0 with the predicted tree byte-identical to the merge's, full suite 253/253 `failed: []` at the sha, and
live verb probes — `queue`≡`queue --json` (22,470,935 B, `cmp` 0), `--id 5071` 16,168 B, `--status held --to
devtools` 149,794 B (49 rows, all `held`), `--status held --no-body` 296,287 B (337 rows, `body` absent,
notices retained), refusals 115–196 B naming the known set; every narrowed answer carries `rows`/`counts`/
`attention` over the **un-projected** 5,078 rows plus `narrowed: "payload"`. Suite at merged main was 252/253
with `broker-stop-audit` red — 5/5 pass standalone, the same check was red at `e3118fa0` before this diff, and
`--area broker` is 62/62, so not attributable to #5071; lead re-ranked it as **#5080** and retired the
"load-sensitive" label. Pruned `item-5071` + devtools' `item-5066` verify fork (proved its ref identical to
`item-4955` before deleting). Pushed `89c474d0..3ac59b55` and `3ac59b55..ba768eeb`. Lead's turn minted
#5079/#5083/#5082/#5080/#5087/#5085 and cancelled #5043/#5074/#5067 (see D204).
