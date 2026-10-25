# Delegate cold start — the digest, and why it exists

Written by the delegate, 2026-10-25, at operator direction. It documents the committed cold-start digest
(`scripts/clockin.mjs`, `npm run clockin`) and the measurements that justify it (D126). The delegate built it;
a non-author (qa2 / auditor) has NOT yet verified it, and that is stated rather than assumed.

## 1. The problem, measured on this repo on 2026-10-25

The `AGENTS.md` clock-in ritual — read `docs/NEXT.md`, read `docs/SELFDEV.md`, `git status`, `cli.mjs status` —
costs a new session more tokens than a small task costs to do:

| What the ritual touches                               |           Measured size |    ≈ tokens | Note                                                                       |
| ----------------------------------------------------- | ----------------------: | ----------: | -------------------------------------------------------------------------- |
| `docs/NEXT.md`                                        | 396,843 B / 4,704 lines | **~99,000** | over the 50 KB / 2,000-line read cap, so it arrives in **8 chunked reads** |
| …the _useful_ part: the top `## NEXT SESSION` pointer |            92–110 lines |      ~2,400 | everything below is history                                                |
| `docs/SELFDEV.md`                                     |    57,589 B / 749 lines |     ~14,400 | ~400 of its lines are the local-model capacity/benchmark treatise          |
| `docs/ROADMAP.md`                                     | 235,997 B / 2,837 lines |     ~59,000 | the runbook already says: never read it whole                              |
| `cli.mjs status` stdout                               |        **22,740,436 B** |  ~5,700,000 | if it ever reaches a session directly                                      |
| `cli.mjs queue` stdout                                |        **21,168,982 B** |  ~5,300,000 | 4,818 rows **including full bodies**                                       |

≈**113,000 tokens** of reading before a session knows what to do. The same clock-in through the digest costs
**~3,600 tokens**.

## 2. The tool

```
node scripts/clockin.mjs              # or: npm run clockin
node scripts/clockin.mjs --db <path>  # a specific store
node scripts/clockin.mjs --json       # the same state as one JSON document
node scripts/clockin.mjs --no-git --no-runbooks   # skip the branch walk / staleness probe
```

Read-only. The store is selected by `--db`, `DURIAN_PI_DB` or `DURIG_DB` (default `./selfdev.sqlite`) — the same
store the rig uses. Measured on this rig: **6-7 s, ~12 KB printed** against the full 4,818-row store.
`demo/clockin-digest.test.mjs` (area `toolchain`) proves it stays under its 20 KB budget, prints no row bodies,
resolves the broker by PID rather than by the state file, and runs clean against a fixture store it builds itself.

`.spike/delegate/clockin.mjs` is the prototype this replaced; it is superseded, kept only as the origin of the
measurements.

### Output contract (eight sections, in this order)

1. `## POINTER` — the live `## NEXT SESSION` section of `docs/NEXT.md` **verbatim**, with the line range it came
   from and the size of the file it came from. It never reads the rest of the file.
2. `## RIG` — seat count, `attention` count, `last_run_failed` per seat (70-char reason), and which seats have
   items parked awaiting the operator.
3. `## QUEUE` — row counts by status and the `deferred` ids with their target seat, from the same
   `cli.mjs status` document (so the 21 MB `cli.mjs queue` dump is never run).
4. `## GIT` — refs, worktrees, and **every unmerged branch joined to its queue row's status**, e.g.
   `item-4746 +1 [#4746 done]`, which is what landing debt actually looks like.
5. `## RUNBOOKS` — one line from `.spike/stale-runbooks.mjs` plus the stale names.
6. `## PROVIDER` — the resolved `DURIG_*` config (note: `cli.mjs config` puts these keys at the TOP level, not
   under a `config` object) and a live probe of the local endpoint (`127.0.0.1:$STRATA_PORT/v1/models`).
7. `## READ MAP` — `docs/SELFDEV.md` section headings with line numbers, so a session reads the one section it
   needs instead of 749 lines.
8. `## COST` — wall time and bytes printed, so the cost of the ritual stays visible.

### Invariants worth keeping if anyone re-implements it

- **Broker liveness is checked, not assumed.** `selfdev.sqlite.broker.json` names pid `14784`; on 2026-10-25 that
  pid belonged to `svchost.exe`, not node. The digest resolves the pid through `tasklist` and prints
  `broker: DOWN` plus `lastPassAt` age in minutes. A `broker.json` file is NOT evidence of a live broker.
- **No row bodies.** Bodies are why `status`/`queue` are tens of megabytes. The digest prints counts and ids.
- **One `cli.mjs` call, parsed in-process.** `execFileSync` with a 64 MB `maxBuffer`, JSON trimmed at the last
  `}` to drop the trailing `note:` line the CLI appends. Nothing from those calls reaches the session raw.
- **It prints the pointer verbatim.** That is the point (the pointer is the only part of `NEXT.md` that is live)
  and it is the reason the pointer must stay short: every pointer line is paid for by every later session.
  `demo/next-pointer.test.mjs` now caps `docs/NEXT.md` at 200 lines and `scripts/clockin.mjs` states the cap in its
  own output.
- **A fake live broker PID in `<db>.broker.json` is dangerous, and not only to this tool.** Writing a live PID into
  a fixture store's broker file made `cli.mjs status` itself behave as though a broker were attached, and it hung
  for the full 120 s of the test's spawn timeout (SIGTERM). Measured 2026-10-25 while writing
  `demo/clockin-digest.test.mjs` — which is why that test proves the "UP" path with the pure probe and never with a
  fixture broker file.

## 3. What a session must NOT do (each of these is a measured token trap)

- Do not read `docs/NEXT.md` whole. Read the pointer section, or run the digest.
- Do not read `docs/SELFDEV.md` whole. Use the `## READ MAP` section numbers.
- Never print `cli.mjs status` or `cli.mjs queue` to a terminal or a tool result. Redirect to `.spike/` and
  aggregate with `python` (see `.spike/stale-runbooks.mjs`, `.spike/delegate/clockin.mjs` for the pattern).
- Do not re-derive facts the digest already reports (unmerged branches, stale runbooks, provider config) by hand.
- In a time-boxed suite run, report **"reached N of 234"**, not "failed": a SIGTERM'd demo prints FAIL with
  `exit 143`. `demo/up-model-reset.test.mjs` did exactly that on 2026-10-25 and passes alone. The last known
  marker is `.spike/delegate/suite-marker.json`.

## 4. Evidence this session produced with it

- `broker: DOWN pid=14784 since=2026-10-22T17:39:46Z lastPassAt=2026-10-24T03:12:11Z age=1377 min`.
- 8 seats' `last_run_failed` = `model_error: 402: You need positive balance to do inference…` — the store's newest
  failing assistant entry (`entryId 273958`, conversation 86607, seat `qa2`) carries the same text.
- Queue: 4,818 rows — `done 3748`, `cancelled 777`, `held 274`, `deferred 19`, nothing `queued`/`claimed`.
- Landing debt: 17 unmerged refs including `item-4745/4746/4747/4749/4750/4752/4755/4778/4786/4790`,
  `item-3033`, `devtools-item-4054/4064/4083`.
- Runbooks: `dated 28 | stale 13 | probe failures 0` (the `docs/runbooks/README.md` caveat still says FOUR).
- After the split landed: `node scripts/clockin.mjs` measured **6.7 s, 15,322 B, 147 lines, stderr empty** — under
  its 20 KB budget. **Of that, 10,359 B is the pointer itself**, which is the next cheap win (§6.4).

## 5. Where the boundary still sits

The tool is now committed (`scripts/clockin.mjs` + `npm run clockin`), so a fresh clone gets it. What is still NOT
done is the seat-facing half: `cli.mjs` has no brief form of its own, so a SEAT that runs `cli.mjs status` or
`cli.mjs queue` still pays 22.7 MB / 21.2 MB. That belongs to `devtools` (§6), and the delegate did not build it
into the CLI because the CLI is the seats' surface, not the delegate's.

## 6. What this document still asks the team for

1. **`devtools` — a brief form inside `cli.mjs`** (`clockin`, or `status --brief` / `queue --brief` that omits row
   bodies), so the budget is enforced where seats actually hit it rather than in a side script. The acceptance
   checks are already written down and already met by `scripts/clockin.mjs`: under 20 KB on this store, and the
   broker reported DOWN when the recorded pid is not a live node process.
2. **`scribe` — nothing left on the split: it is done.** `docs/NEXT.md` is now the 118-line pointer (10,359 B)
   and its 4,610 older lines are verbatim in `docs/NEXT-ARCHIVE.md` (384,427 B), landed 2026-10-25 as an
   author-explained rewrite (commit `8fcac11c`). `item-4747` @`9f624ff4` and `item-4750` @`27a23d6a` are SUPERSEDED
   by that re-cut (their pointer was the 2026-10-21 one) and their refs were left in place — deleting a ref is not
   the delegate's call. #4750's byte-faithful verify must be re-run against `main` by a non-author, which is what
   #4814 asks for.
3. **`scribe` — put `docs/SELFDEV.md` on a diet**: move the ~400-line local-model capacity/benchmark treatise
   (lines ~352-749) to a notes file and leave a 5-line pointer plus the seat table. That is the remaining
   whole-file cost a clock-in pays.
4. **The pointer should stop restating what the digest already prints.** With the split landed, the digest's own
   output is now dominated by the pointer it quotes: 10,359 B of 15,322 B. The `**Measured at clock-in**` block in
   `docs/NEXT.md` duplicates the `## RIG`, `## QUEUE`, `## GIT` and `## PROVIDER` sections the same call produces.
   A pointer trimmed to the ruling, the two paths, the queue ids and the commands (~40 lines) would roughly halve
   every session's cold start. The cap test (200 lines) permits today's length; it does not make it cheap.

Body text for 1 and 3 is spooled at `.spike/delegate/intent-fast-clockin.md`, ready to send to `pm` once the
provider blocker is cleared and a broker can deliver it.
