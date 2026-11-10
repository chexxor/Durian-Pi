# pi-durable v1.5.1 delta review — 2026-11-10 (delegate, measured)

Ordered by the operator: *"Update the version of pi-durable we are using. I see it has released v1.5.1 today.
Review the changes to the pi-durable library and add items to the appropriate roadmap to ensure we are best
utilizing pi-durable."*

This file is the **delta and the accommodation map**, the successor to
[`docs/PI-UPGRADE-DELTA-2026-11-04.md`](../PI-UPGRADE-DELTA-2026-11-04.md). Decomposition, sequencing and routing
are the team's; the delegate ran the move, measured it, and **reverted it** in the first window.

**STATUS NOW (same day, second window): the pin is landed.** `pi-main.pin.json` pins tag **`v1.5.1`**
(`dd30101cfc5b0609411dd80b6f93adbc14db14cf`), the symbol migration is in the tree at commit **`d3dd1300`**, and
`node scripts/test.mjs --all --jobs 8` reports **280/280 in 47.6 s** on this box. Sections 1–5 below are the
first window's measurement, kept verbatim because the numbers are still true of the gap they measured; **section 8
is what actually landed and how each red was closed**. Nothing is pushed — the operator holds that grant. The procedure is `docs/runbooks/pi-pin-update.md`; the stop rule it cites — "a pin bump
that leaves `documentState`/`viewState`/`AgentEvent*`/pi-ai's `Type`/`checkpointWhen` un-migrated is a half-done
change" — is exactly what the measurement below proves.

**Host for every number here**, measured in the same command as the measurement: **Linux**, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0`. Probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## 1. The gap, as measured

| fact | value | how to re-measure |
|---|---|---|
| our pin | `2ec55d808d455b1a64a2bf7888198207a096120a`, `pinnedAt 2026-10-19T07:20:20Z`, **9 packages**, `ref: null` | `node -e 'const p=require("./pi-main.pin.json");console.log(p.sha.slice(0,8),p.pinnedAt,p.packages.length,p.ref)'` |
| upstream tip | `b2aabe02966a6b4528c7498a3bb406c14396932d` | `git -C vendor/pi-main rev-parse origin/main` |
| `v1.5.1` | `dd30101cfc5b0609411dd80b6f93adbc14db14cf` (tag; `v1.5.0`, `v1.4.0` sit between it and the pin) | `git -C vendor/pi-main rev-parse v1.5.1` |
| gap pin → `v1.5.1` | **729 commits** (0 ahead) | `git -C vendor/pi-main rev-list --left-right --count <pin>...v1.5.1` → `0 729` |
| gap pin → tip | **743 commits** (0 ahead) — `node scripts/sync-pi.mjs --check` prints the same `behind: 743` | `node scripts/sync-pi.mjs --check` |
| releases skipped | **v1.4.0 (2026-10-21)**, **v1.5.0 (2026-11-02)**, **v1.5.1 (2026-11-09)** | `git -C vendor/pi-main show v1.5.1:packages/durable/CHANGELOG.md` |
| upstream packages | 12: agent, ai, chord, codemode, coding-agent, durable, env, evals, **schema**, telemetry, tui | `git -C vendor/pi-main show v1.5.1:packages` |
| our pin builds | 9; **`pi-schema` is missing** and `packages/durable/package.json` at v1.5.1 **depends on `@earendil-works/pi-schema` 1.5.1** | `git -C vendor/pi-main show v1.5.1:packages/durable/package.json \| grep -A6 dependencies` |

**Trap, and it already bit a doc:** the vendored clone **arrived shallow** — at session start
`vendor/pi-main/.git/shallow` listed 2 shas and `git rev-list --count HEAD` printed **1**. Any "N commits behind"
written from a shallow clone is bounded by the fetch depth, not the upstream truth. `scripts/sync-pi.mjs:277` says
so in words. This session ran `git -C vendor/pi-main fetch --unshallow origin` once (**6,994 commits reachable
afterwards**, and `.git/shallow` is gone); the 729/743 counts above are from that state. Re-measure before quoting
a count, and say which state you measured. `scripts/sync-pi.mjs:277` knows this and says *"the vendored
clone is shallow/missing history; run: git -C vendor/pi-main fetch --unshallow origin"* — the numbers above are
from **after** that unshallow (6,994 commits reachable). Quote the depth with the count, or don't quote a count.

**Pin policy is already shipped, and the pin does not use it.** `sync-pi --check` prints, today, on this tree:

> `POLICY GAP (#5093): the pin names no ref and floats on branch "main"; pin a TAG so the validated checkpoint is
> named and ageable`

`--update <tag>` resolves refs through `resolveRef` (`scripts/sync-pi.mjs:195`) and writes `ref`/`refType`, so the
plumbing #5093 asked for exists; running it against `v1.5.1` is the cheap half of the move.

## 2. Store risk: settled again, and it still cuts both ways

Re-measured on this session's live store (read-only open):

```bash
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});
console.log(JSON.stringify(db.prepare("SELECT * FROM durable_schema").all()))'
# → [{"singleton":1,"version":2}]
git -C vendor/pi-main show 2ec55d80:packages/durable/src/storage/sqlite/migrations.ts | grep -o 'version: [0-9]'  # 1 2
git -C vendor/pi-main show v1.5.1:packages/durable/src/storage/sqlite/migrations.ts | grep -o 'version: [0-9]'    # 1 2
```

**The move migrates nothing** (identical migration sets at both ends), so the 1.4.0 breaking note — *"Opening a
SQLite storage migrates it to schema version 2 automatically … A migrated database cannot be opened by 1.3.0 or
earlier"* — does not bite this store. It bites a **fresh** store created at 1.5.x, which is why `sync-pi --unlink`
is still not a rollback. A backup is the only rollback: this session made one
(`.spike/backups/20261110T0551Z/selfdev.sqlite`, 617,492,480 bytes, sha256 `0996cd61…`, `cmp` exit 0) before any
run that opened the store under the new build.

## 3. What the move actually did (measured, then reverted)

Every stage ran with the broker down, the scratch-store gate passed, and the same suite re-run at the previous pin
in the same window for attribution (`docs/runbooks/pi-pin-update.md` step 4).

| stage | command | result |
|---|---|---|
| pin move | `node scripts/sync-pi.mjs --update v1.5.1` | pin `ref:"v1.5.1"`, `refType:"tag"`, `sha dd30101c…`, `previous[]` recorded |
| build order | `node scripts/sync-pi.mjs --sync` | **fails at chord**: `src/store/json-column.ts(5,33): error TS2307: Cannot find module '@earendil-works/pi-schema'` — chord builds before durable/ai, so **`pi-schema` must be FIRST in the pin's `packages` array** |
| build, schema first | `--sync` | exit 0, **14 s**, 10 packages built |
| link | `--link` | exit 0, **14 s**, 10 linked, `dependencySet: built-pin`, `package.json`/`package-lock.json` unchanged |
| suite as-is | `node scripts/test.mjs --all --jobs 8` | **93 PASS / 187 FAIL**, exit 1 |
| suite, 4-line `Type` shim | same suite | **184 PASS / 94 FAIL / 2 TIMEOUT**, **127.5 s** |
| revert | `git checkout -- pi-main.pin.json; --sync; --link` | pi-durable **1.3.0** linked again; **278/280 in 59.7 s** |

The two reds at the restored pin are **not** the pin: `demo/next-pointer.test.mjs` and `demo/clockin-digest.test.mjs`
fail because `docs/NEXT.md` is over the 200-line pointer cap (`wc -l` 203 → 204 counted).

### 3.1 The breakage, attributed by signature (the 4-line shim run)

A shim is not a fix, but it **localises** the damage: changing only four import lines —
`src/seattools.mjs:16`, `src/rig.mjs:13`, `extensions/continuity.mjs:38`, `demo/secretredact.test.mjs:13` — from
`import { Type } from "@earendil-works/pi-ai"` to `import { Type } from "typebox"` takes 187 failures to 94.
(`typebox` 1.3.27 is in `node_modules` and appears 7× in `package-lock.json`; **our `package.json` does not declare
it**, so this is a diagnostic, not a migration path.)

| signature in the failure capture | blocks | where it lands |
|---|---|---|
| `harness.documentState is not a function` | **37** | `src/broker.mjs`, `src/reset.mjs`, `cli.mjs`, 45 demos |
| (assertion-style, **no stderr line**) | **36** | broker-health/log/pass-survival/seat-attr/session-reopen/wakepath/read-nopass, chatlog, check, cli, compact, config, constitution, continuity-note, coordinator-queue, dry-run, extensions, livestream, local-slot-gate, refresh, reset, resume, seatmodel, seatroot, starter, stop, stop-lease-identity, streamcli, thinkinglevel, the six `tui-durable-*`, tui-round-trip-terminal, up-model-reset, watchview, cli-broker-refuse, … |
| `conversation.viewState is not a function` | **5** | `demo/tui-durable-{boot,compaction-tui,compaction,persistence,tools}.test.mjs` |
| `harness.subscribeCommits is not a function` | **4** | `demo/broker-cooldown-revisit`, `broker-intent-wake`, `broker-liveness`, `scheduler` (and `src/inflight.mjs`, `src/scheduler.mjs`, `cli.mjs` import it) |
| `change.definition.checkpointWhen is not a function` | **3** | `demo/events`, `queue-held-gates`, `watch` — thrown inside pi-durable's transaction assembly: `git -C vendor/pi-main grep -n 'checkpointWhen' v1.5.1 -- packages/durable/src` → `session/transaction.ts:1058` calls it unconditionally |
| `…pi-durable does not provide an export named 'watchEvents'` | **2** | `demo/guard.test.mjs`, `demo/inflight.test.mjs` (also `src/inflight.mjs`, `src/tui/durable/adapter.mjs`) |
| `Cannot read properties of undefined (reading 'started')` | 1 | `demo/autostart.test.mjs` |
| `Cannot read properties of undefined (reading 'getAuth')` | 1 | `demo/seat-turn-shape.test.mjs` |
| `writes is not iterable` | 1 | `demo/readboundary-corrupt-live.test.mjs` — the `Storage.commit(batches, …)` signature change |
| **TIMEOUT at 120 s** | **2** | `demo/command-spool.test.mjs`, `demo/compact-spool.test.mjs` — they pass fast at the pin; a pass/wait that never resolves at 1.5.x is the lead |

Our own exposure, counted on this tree (`grep -rc` over `src demo extensions cli.mjs`):

| symbol | hits / files |
|---|---|
| `documentState` | **117 / 49** |
| `pi.live` | 45 / 14 |
| `Type.Object` | 24 / 4 (`src/rig.mjs`, `src/seattools.mjs`, `extensions/continuity.mjs`, `demo/secretredact.test.mjs`) |
| `defineTool` | 21 / 4 |
| `subscribeCommits` | 9 / 9 |
| `watchEvents` | 10 / 4 (`src/inflight.mjs`, `src/tui/durable/adapter.mjs`, `demo/guard`, `demo/inflight`) |
| `viewState` | 4 / 2 |
| `checkpointWhen` | **0 / 0** — `src/rig.mjs` defines 5 docs (`Seats`, `Edges`, `Constitution`, `RigControl`, `RigQueue`) with **no** `checkpointWhen`; 1.4.0 made it required with **no default** |

## 4. What v1.5.1 and v1.5.0 give us (each claim read from the shipped changelog)

Ranked by the rig problem they solve, not by release order.

1. **Per-conversation compaction settings** (`configure({ compaction })`, stored in `pi.agent`, inherited by
   children and forks; resolution order *conversation model override → harness → conversation fields → harness
   policy*, and *"a conversation's `enabled: false` also beats the harness's model overrides"* — **#11771**).
   This is the native version of what ROADMAP **331** hand-builds as `modelOverrides` nesting and what the
   compaction guard (ROADMAP **351**, D252) currently patches on the extension plane.
2. **`SqliteStorage.commit()` group commit** — *"a few SQL statements per call instead of about eight per batch …
   a group commit over a remote SQLite takes a few round trips, not hundreds"*. Our single-writer store and the
   `database is locked` history (ROADMAP **331/355**) are the reason this matters more here than upstream.
3. **Deferred progress commits** (`settings.progress.persistWithinMs`, default 1,000 ms; upstream measures ~5.7×
   fewer storage transactions and 2.9× fewer disk writes for 32 parallel streams) — and the semantic change that
   comes with it: **`subscribeCommits()` now sees only stored commits**; a listener that showed live progress must
   move to `watchDoc()`/`Conversation.watch()`; `persistWithinMs: 0` restores the old behaviour. Our broker pass
   loop and the degeneration guard (`src/inflight.mjs`) listen on commits — this is the row that must decide
   whether the pass cadence changes, and it is already visible in the 36 assertion-style failures above.
4. **`Tx.submission(id)`** (1.5.1) — *"reads a committed submission record by ID, so a tool can find the entries
   of its run's inputs (`pi.live.run.inputs`) without scanning the transcript"*. Direct fit for `cli.mjs resume`,
   status reads and the viewer, all of which today scan.
5. **Read-only storage opens** — JSONL: `{ readOnly: true }` (`JsonlStorage.open()`, `openNodeJsonlStorage()`),
   which *"creates and writes nothing, skips torn records in memory, holds the state committed at open, and
   `commit()` rejects with `JsonlStorageReadOnlyError`"*; and the changelog's own warning that **`HarnessOptions.readOnly`
   does not reach the storage open** (**#11939**). We hand-roll "don't create a store on a read" across the CLI
   (`demo/read-no-create-store.test.mjs` exists because the behaviour was not guaranteed).
6. **Turn shape and spend shape** (1.5.0): `AgentState.maxTurns` (`configure({ maxTurns })`) bounds tool rounds
   per run and ends the run `unanswered` with `RunFailureReason` `turn_limit`, feeding `settings.afterFailedRun`;
   `whenIdle: "reject"` refuses an input in one admission instead of a host check plus a racy submit;
   `GenerationHooks.beforeProviderRequest({ model, payload }, api)` rewrites **one** generation request body;
   `GenerationHooks.afterRun(run, api)` returns run-end tasks. Together these are the levers for ROADMAP **324**
   (per-family spend) and **331** (run shape) that we currently emulate with config and prose.
7. **Watch semantics** (1.5.0): listeners take one change object `({ value, ops }, ctx)`; past **10,000** pending
   ops a watch delivers one root replacement; `ConversationView.entries` is a **window** (start 50, cap 100, with
   `ConversationView.before`); `pi.live` keeps `runFailure` after a run with no answer — **idleness is
   `run === undefined`, not `{}`**. The last one is a silent-behaviour trap: `pi.live` appears in 14 files here.
8. **Crash-loop guard / `restartLimit`** (1.4.0, changed in 1.5.0): parked tasks no longer park — they **end
   visibly** (tool error result `restart_limit`, `runFailure` reason `restart_limit`, `task_interrupted` reports).
   Our degenerate-seat supervision (ROADMAP **219–212** family) reads exactly these signals.
9. **JSON Schema tools via `pi-schema`** — builders `obj/str/num/int/bool/lit/union/oneOf/opt/arr/nul/nullable`
   (read from `packages/schema/src/index.ts` at v1.5.1), **closed by default**, `{ open: true }` to allow extra
   properties. `src/rig.mjs:675` uses `Type.Object({}, { additionalProperties: true })`, so a mechanical translation
   would silently start rejecting fields — that is the one place the migration needs judgement, not a regex.

## 5. Decisions the team has to make before the pin can move

1. **Which tag, staged or single** (ROADMAP **353**). `v1.4.0` cannot go green on its own (1.4.0 already requires
   `checkpointWhen` and removes `TaskRuntime.sleep`), so the runbook's stop rule — take the later release in one
   move and record why — applies.
2. **A `checkpointWhen` policy for the five rig docs** (ROADMAP **355**): `() => false` keeps ordinary changes as
   deltas and costs nothing but read cost; a predicate that writes a base periodically costs store growth. The
   transitions a reader *acts on* (claim, complete, defer, hold, release) are the honest candidates. Measure against
   the backup baseline (617,492,480 bytes).
3. **`persistWithinMs`** — keep the 1,000 ms default and move live-progress listeners to `watchDoc()`, or set 0 and
   keep the transaction load. Not a prose decision: it must be in config and pinned by a demo.
4. **`restartLimit`** — the value the harness is constructed with, at the single `openHarness()` seam, named by a
   demo.
5. **Whether the delegate does it** — no. Claiming and implementing queue rows is the team's; the delegate's
   deliverable is this file plus ROADMAP **353–357**.

## 6. Re-run these (all cheap, all read-only unless noted)

```bash
node scripts/sync-pi.mjs --check                       # drift + the #5093 policy gap, read-only
git -C vendor/pi-main fetch --tags origin              # prerequisite for every tag claim above
git -C vendor/pi-main show v1.5.1:packages/durable/CHANGELOG.md   # the ground truth, by release
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.env.DURIG_DB||"./selfdev.sqlite",{readOnly:true});console.log(JSON.stringify(db.prepare("SELECT * FROM durable_schema").all()))'
node scripts/test.mjs --all --jobs 8 --json           # the baseline the migration must beat: 278/280, 59.7 s
```

The full captures of the two moved-pin runs are in gitignored `.spike/pin-update/`
(`pin-v1.5.1.json`, `suite-after.{json,err}`, `suite-typebox-probe.{txt,err}`, `suite-restored.{txt,err}`). They are
worth promoting (ROADMAP **312**) only if the team wants the raw failure list in the repo; the counts and
signatures above are already in this file.

## 7. Unverified

- The **36 no-stderr failures** are not attributed symbol-by-symbol; they are assertion-style checks whose expected
  shapes/counts change. The team must run the suite at the moved pin to classify them — the probe run's stderr file
  is the starting point.
- Whether `pi-schema` builders behave identically to our current schemas (especially the closed-by-default
  difference) is untested; `src/rig.mjs:675` is the one known divergence.
- Whether the two 120 s timeouts (`command-spool`, `compact-spool`) are a deferred-commit effect or a pass-loop
  effect is untested; both pass fast at the pin.
- The `watchEvents` removal hits `src/tui/durable/adapter.mjs` and `src/inflight.mjs`; only the two demos failed in
  this run because those modules are loaded lazily by the failing paths.

## 8. What landed, and how every red closed (second window, 2026-11-10)

Host for every number in this section, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0`.

### 8.1 The pin, as written

| field | value | re-measure |
|---|---|---|
| `ref` / `refType` | `v1.5.1` / `tag` | `node scripts/sync-pi.mjs --check` |
| `pinnedSha` | `dd30101cfc5b0609411dd80b6f93adbc14db14cf` | same |
| `policyGap` | `null` — the `#5093` "pin floats on main" gap is closed by naming a tag | same |
| packages built | **10**, with `{"name":"@earendil-works/pi-schema","dir":"packages/schema"}` as the **FIRST** entry | `node -e 'console.log(require("./pi-main.pin.json").packages.map(p=>p.dir))'` |
| drift | `true`, `behind: 14` vs tip `b2aabe02…` | same |

**Contract note, said plainly:** the task's success clause asked for `drift: false`. For a *tag* pin that is
unsatisfiable while upstream moves — drift is the point of pinning a tag. `ref`/`refType` are exactly as required;
`drift: false` is a mis-specified clause, not a failed step.

### 8.2 The migration, symbol by symbol

| removed at 1.5.1 | replacement | sites |
|---|---|---|
| `pi-ai`'s `Type` | `@earendil-works/pi-schema` builders `obj/str/num/int/arr/lit/union/bool/opt/nul`; `additionalProperties: true` → `open: true` | 4 files (`src/seattools.mjs`, `src/rig.mjs`, `extensions/continuity.mjs`, `demo/secretredact.test.mjs`) |
| `Session.documentState()` | `Session.snapshot()` — returns the **value**, not a `{value}` wrapper | 117 hits / 49 files |
| `Session.subscribeCommits(listener)` | `Session.observeCommits({advance,end})` behind a new seam **`src/commitstream.mjs`** `followCommits(harness, listener)` | `cli.mjs` + 6 demos |
| `watchEvents(harness, convId, ctx)` (gone) | new seam **`src/livewatch.mjs`** `watchLive()`, translating `pi.live` (`LiveDoc`) into the old event shapes | `demo/guard`, `demo/inflight`, `src/tui/durable/adapter.mjs` |
| `Conversation.viewState()` (gone) | `Conversation.watch(context)` → `WatchHandle<ConversationView>`, adapted by `attachConversationView()` | `src/tui/durable/adapter.mjs` |
| `Storage.commit(writes, ctx)` | `Storage.commit(batches, receive, ctx)` | `scripts/repair-pi-live.mjs`, `demo/livestream`, `demo/driversurvive{,-pre}`, `demo/readboundary-corrupt-live` |
| `checkpointWhen` now **required** by `defineDoc` (`session/transaction.ts:1058` calls it unconditionally) | `checkpointWhen: () => false` on the 6 rig docs — **provisional**, the real policy is ROADMAP **355** | 5 in `src/rig.mjs`, `ContinuityNotes` in `extensions/continuity.mjs` |
| `Harness.open` now requires `models` (`harness/types.ts:709`) | `models: createModels()` | `demo/broker-wakepath`, `demo/up-model-reset`, `demo/seat-turn-shape` |
| `pi.live` is **version 3** (was 1) | demos read the doc's real version instead of hard-coding 1 | 3 demos |

Two traps this window found, both worth remembering:

1. **The bulk rename ate a different API's `.value`.** `Storage.document(id, "current", ctx)` still returns a
   `StoredDocument` with `.value` (`packages/durable/src/types.ts:905-911`); only `documentState`→`snapshot`
   dropped the wrapper. Hand-fixed at `src/broker.mjs:1290` and `cli.mjs:3287`. `.spike/pin-update/migrate-symbols.mjs`
   is not safe to re-run blindly.
2. **A refused delta is silent.** `Storage.commit` returns `{stored: 0, refused: {}}` when a delta declares a
   version other than the document's (`packages/durable/src/storage/store/commit.ts:285`). It does **not** throw.
   A corruption fixture that declares the wrong version quietly stops being a corruption fixture.

### 8.3 Every formerly-failing demo, attributed

Suite progression on this box, `node scripts/test.mjs --all --jobs 8`: **93 → 251 → 266 → 272 → 280 PASS** (47.6 s
at the end; the same suite at the old pin was 280/280 in 61.8 s — the move made the suite **faster**, not slower).
Captures: `.spike/pin-update/suite-mig{,2,3}.{txt,err}`.

| demo | symptom at the moved pin | cause (measured) | disposition |
|---|---|---|---|
| `demo/driversurvive-pre.test.mjs` | "Missing expected rejection … the exact F14 unresolvable path" | the injected orphan delta declared `version: 1`; `pi.live` is version **3**, so `Storage.commit` **refused** it (`{stored:0,refused:{}}`) and the document was never corrupted | **fixed** — version read from the document; the demo now asserts `corruptResult.stored === 1` so a silent refusal cannot masquerade as a pass |
| `demo/driversurvive.test.mjs` | "the driver survives the bad document and wakes the healthy seat" (`2 !== 1`) | same root cause: with no corruption, both seats wake | **fixed** — same version read, same guard assertion |
| `demo/dry-run.test.mjs` | "the unchanged constitution is reported as no change" (`true !== false`) | `previewUp` read `constitutionDoc?.value?.text` / `edgesDoc?.value?.edges` off `harness.snapshot()` results, which now return the value directly → `undefined` ≠ the spec text → "changed" | **fixed** in `cli.mjs:931-933` |
| `demo/tui-durable-boot.test.mjs` | user message and answer never rendered | `watchEvents` is gone, so no `message_start`/`message_end` reached `InteractiveMode`; `src/livewatch.mjs` was emitting a placeholder assistant message shaped `{type:"assistant"}` where the renderer keys on `role` | **fixed** — `attachConversationView()` + `#emitEntryEvents()` in the adapter, `role`-shaped placeholder in `src/livewatch.mjs`, `bridge.streamingMessage` getter |
| `demo/tui-durable-compaction.test.mjs` | the compaction boundary never reached the session entries | same missing event source; and v1.5.1's view returns the **whole window** with head markers "where they were written" (`packages/durable/src/harness/view.ts:40-41`) instead of the active transcript, head marker first | **fixed** — `#activeTranscript()` re-orders the head marker to the front, and events are emitted **after** the session manager is replaced (the renderer's `entries[0]?.id !== event.entry.id` guard needs the boundary already present) |
| `demo/tui-durable-compaction-tui.test.mjs` | "[compaction]" row absent | same as above (rendering path) | **fixed** — same two changes |
| `demo/tui-round-trip-terminal.test.mjs` | durable user message/answer absent from the injected terminal | same as above | **fixed** — same two changes |
| `demo/clockin-digest.test.mjs` | the digest exits 1 in a DETACHED scratch tree | **not** a 1.5.1 API break: the scratch worktree is cut from `HEAD`, and `HEAD` still held the pre-migration source while `node_modules` was already linked to 1.5.1 — `import { Type } from "@earendil-works/pi-ai"` → SyntaxError. Measured: `node cli.mjs status` in a detached scratch at the pre-migration HEAD fails with exactly that line | **fixed by committing the migration** (`d3dd1300`); re-measured 280/280 after the commit |
| `demo/command-spool.test.mjs`, `demo/compact-spool.test.mjs` | 120 s TIMEOUT at the shimmed pin | the pass loop awaited a `subscribeCommits` signal that never arrived | **resolved** — `src/commitstream.mjs` `followCommits()`; no TIMEOUT line appears in any run since |

**No demo was weakened.** Every change above is in `src/`, `cli.mjs`, or a fixture's construction; the assertions
themselves are unchanged, and two demos gained an assertion (the fixture-landing guard) rather than losing one.

### 8.4 Still open, and who owns it

- **`checkpointWhen`** — `() => false` on all 6 rig docs is the upstream default applied mechanically. ROADMAP **355**.
- **`persistWithinMs`** — the TUI's streaming now rides `pi.live`'s throttled partials (default 1,000 ms), so
  in-flight rendering is coarser than it was at the old pin. Measured qualitatively, not benchmarked. ROADMAP **355**.
- **`restartLimit`** — untouched; the harness is still opened with upstream's default. ROADMAP **355**.
- **Fidelity gaps in `src/livewatch.mjs`, stated out loud:** `turn_start`/`turn_end` are derived from the
  generation attempt, not a turn record; tool *results* are synthesised from committed `pi.tool-result` entries
  rather than streamed. A seat that needs exact tool streaming must grow the seam, not patch the demo.
