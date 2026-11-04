## NEXT SESSION (2026-11-03T20:5xZ — D201/D202, Linux `chexxor@ThinkStation-P3`: the **metering plane is LANDED and armed** (`main = 203849c3`, **pushed**, 0 ahead of `origin/main`); the **208 guard is built, row `done`, and waits on one exclusive-window merge**; **228 is briefed but not dispatched**)

**Current item:** the operator's three-step order (metering plane → ROADMAP 208 → ROADMAP 228). Step 1 is done and
landed; step 2 is built and waits on one exclusive-window merge (command 1 below); step 3 is briefed and waits on a
free engine (command 2). Everything before this block is VERBATIM in `docs/NEXT-ARCHIVE.md` (this cut moved the D200
pointer, 89 lines, byte-identical against `c486120b:docs/NEXT.md`).

**What just happened, in the operator's order.** (0) The operator's three capacity rulings **landed as rig properties** at
`f9f8f389` (D201): declared window **200,000** (the seat root's copy = "Copy B" is authoritative; the operator
checkout's stale 160,000 aligned to it), `DURIG_LOCAL_MAX_TOKENS=16384` in the **tracked** `durig.config.default.json`,
and a **local-class** compaction override `{"local/iq3_s":{"reserveTokens":20480}}` — deliberately *not* the global key,
which would put a 20,480 reserve on the 24,576 verifier window (a 4,096-token band = compaction every turn). (1) The
**metering plane landed**: `#5047` → `item-5047 @ efe45e66` → **`main = 203849c3`** (D202). Landing read, run by the
delegate: acceptance probe **exit 0, 11/11, 0 RED** (`P6b`: over-cap rows none, drifted rows none), full suite in the
approved seat root **249 passed, `"failed": []`, 44.6 s**, `instrument-provenance` CLEAN, `--is-ancestor` proof. (2) The
**208 guard is built** — `#5049` is `done` on `item-5049 @ eaa7fa0e` (5 commits, 14 files, +833/−35,
`merge-tree` exit 0) — **not landed**: `docs/runbooks/merge.md` forbids a landing pass while a seat is generating, and
`impl` was still generating (it went on to build `#4955` at `item-4955 @ e2a3cb5a` in the same turn). (3) **228 was not
dispatched** — one 24 GB card with a 200,000 declared window runs **one** build wake at a time (~5 GiB KV per 200k slot
on top of ~21 GiB of weights; `nvidia-smi` read 14.9 GB then 22.9 GB for a single seat).

**Next commands, in order.**
1. **Land #5049 when the rig is quiescent** (the only thing standing between you and priority #2 being in `main`):
   confirm no seat generates (`node tools/seat-turn-shape.mjs` from the **operator checkout** — it opens
   `./selfdev.sqlite` relative to cwd), then in `/home/chexxor/Git/Durian-Pi` (where `main` is checked out):
   `git merge-tree --write-tree main item-5049` (expect exit 0) → `git merge --no-ff eaa7fa0e -m "merge: land item-5049
   onto main (#5049 context-fraction guard)"` → realign the seat root mirror (`git rev-parse <mirror>^{tree} <new-main>^{tree}`
   equal, then `git -C /home/chexxor/Git/durian-dev/seatroot reset --hard <new-main>`) → full suite **in the seat root**
   (`node scripts/test.mjs --all --jobs 8`, ~45 s, expect 250+ and `failed: []`) → `node demo/context-over-window.test.mjs`
   → `node cli.mjs check` and read the new `context-over-window` rule's verdict against the **live** store (the seat
   could not run that leg: an item worktree's `pi-durable@1.3.0` refuses the store with *"Durable SQLite schema version
   2 is newer than supported version 1"*). Prune by hand — the seat's `complete_work` cleanup refused again
   (`refusing to remove …/item-5049: junction/symlink detected at undefined/node_modules`).
   **Landing read the delegate already accepted:** `tools/what-to-test.mjs --base=main --json` answers `ok:false` because
   `src/attention.mjs` carries CR bytes (515 findings at the tip, **475 already at `main`**) — run the **full gate**, do
   not CRLF-normalize in a feature branch. `demo/broker-stop-audit.test.mjs` failed 1 of the seat's 3 full-suite runs
   and 3/3 standalone; that is row **#5056**, not this diff.
2. **Then 228, as `lead` cut it: #5039 (re-cut `item-4986`) → #5040 (landing) → #5041 (unknown-flag refusal).**
   Brief is written at `.spike/delegate-20261104/brief-devtools-1.md` (gitignored — copy it to the seat root's
   `.spike/` and re-check its numbers first). Measured at dispatch: `rev-list --left-right --count main...item-4986` =
   **69 / 2**, tip `95836ec3`, and `merge-tree` **exits 1 with TWO conflicts**, not the one `lead` recorded —
   `demo/test-areas.json` (regenerate via `src/testareas.mjs`, do not hand-union) **and**
   `docs/runbooks/session-start-cost.md` (resolve as UNION). No code file conflicts. Fail-open is live on `main` today:
   `node cli.mjs queue --id 5012 --zork` **exits 0 and prints the whole 21 MB document** — both `--id` and `--zork` are
   ignored; `--status/--to/--no-body/--fields` are absent on `main` **and** on `item-4986`, so #5041 is real work
   (`docs/ROADMAP.md:4137`). Dispatch pattern (no broker up):
   `cd /home/chexxor/Git/durian-dev/seatroot && node cli.mjs send devtools --body-file .spike/delegate-20261104/brief-devtools-1.md --request-id dNNN-devtools --no-stream`
   (request ids < 40 chars). `devtools` was at **141,833 / 200,000 (0.71)** — `reset devtools "<handoff>"` first, it is
   the highest local-class seat.
3. **Route three findings to `pm`** (the delegate does not patch or route them itself): (a) `#5047` shipped no
   `docs/FEATURES.md` row and no "no feature surface" note — the Feature block of `docs/runbooks/merge.md`; (b) **#5056**
   the load-sensitive suite member; (c) `impl` built **#4955** at `item-4955 @ e2a3cb5a` (row still `claimed`) — verify
   and land it or send it back, it is unbriefed work.
4. **Answers the operator owes** (each blocks something): the **cap values** 0.05 / 0.10 / 4.00 are the probe's
   proposals now armed as tracked defaults (D202 — the store cap is D193's $4 and was **not raised**); whether
   `google/gemini-3.1-pro` is **dropped or re-windowed** — its one maximal call is $14.00 = 3.50× the whole grant, so it
   is refused at registration and that refusal **prints on every CLI start** until ruled; the **verifier class** has no
   provider (nothing on `:1234`, five seats, window 24,576), which is why no non-author **verifier-family** review of
   #5047 or #5049 was possible and why `#5052`/`#5055` (qa verify legs) cannot run.

**Queue ids that matter now:** #5047 `done` (+ DONE note #5053) · **#5049 `done` UNLANDED** (+ #5055 verify request,
#5056 flake finding, #5057 full evidence — read the row body, it carries commands and exits) · **#5039 → #5040 → #5041**
`queued` → `lead`/`devtools` (228) · #5050 `queued` → `impl` (pointer build, gated on the metering plane, now released) ·
#5052 `queued` → `qa` · #5045 `queued` → `architect` (the three D201 numbers + two release verbs) · #5048 `queued` →
`lead` (does #4970 HALF B fold ROADMAP 92/94?) · #4955 `claimed` by `impl` · #4887 `queued` (parked then released by
`impl` on purpose, to keep oldest-first off priority #1) · `advocate` still prints **244,751 / 24,576 = 9.96**.

**Blocker:** the exclusive window for step 1 (a seat was generating); the operator's four rulings above; the dead
verifier provider. Nothing else blocks. Broker was **down** all session (so `send` was legal), the local engine is
`:47831` (`strata --serve --max-context 204800`), and `main` is **fully pushed**.

**Standing constraints.** Do not claim, complete, defer, route or release rows yourself; landing is the delegate's verb
and `land ≠ complete` (`docs/runbooks/land.md`). No push without the grant — **tonight's grant was spent through
`203849c3`**, ask again. `DURIG_DB` for the CLI, never `DURIAN_PI_DB` (D103). Native host OS only (D131). Capacity is
never a delegate or seat ruling. **Land in the worktree where `main` is checked out — the seat root is on branch
`seatroot/linux`, and a merge there lands on the mirror** (measured: a `4ed8096` merge there left `main` at `f9f8f389`,
and a `push origin main` then pushed the un-landed main). Never pipe `status`/`queue` into your own context (21–22 MB):
dump to a file and project; `scripts/test.mjs --json` and `cli.mjs check` print non-JSON lines before their JSON, so
parse from the first `{\n`. Name the axis, the denominator, the tree and the dependency set with every number.
**`docs/NEXT.md` ≤ 199 lines by `wc -l`** and run **both** `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs`
after editing it; `node tools/doc-integrity-guard.mjs` for the rest. `inputs/fetched/` stays clean or the lander refuses.
