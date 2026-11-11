---
runbook: pi-pin-update
symptom: "the pinned pi must move (an ordered update, or a tag we skipped becomes available); or a fresh worktree refuses the live store with `Durable SQLite schema version 2 is newer than supported version 1`; or a `git grep` over `vendor/pi-main` returned 0 hits and you are about to conclude something is absent upstream"
writes: true
precondition: "broker-stopped"
last_verified: 2026-11-11
verified_by: delegate (read-only half on #5089 2026-11-04; the WRITE half run end-to-end 2026-11-10, staged then reverted; the drift half re-measured read-only 2026-11-11)
evidence: "#5089 (the mint) and the read-only half of this procedure run ON that row, Linux Fedora 44 `7.2.14-200.fc44.x86_64` node v24.22.1: `node scripts/sync-pi.mjs --check` exit 0 `drift=true` pin `2ec55d80` tip `707888ec`; `git -C vendor/pi-main rev-list --left-right --count <pin>...origin/main` = **0 ahead / 515 behind** (the delta doc's 508 was already stale); `git -C vendor/pi-main fetch --tags origin` exit 0, tags `v1.2.0 v1.3.0 v1.4.0 v1.5.0`; pin and tip `migrations.ts` both carry exactly `version: 1, version: 2`; live `durable_schema = {singleton:1, version:2}` (read-only open); scratch-`/tmp`-DB gate: `status`/`queue`/`ps`/`show` exit 1, `cause:no_store`, `-wal`/`-shm` ABSENT; and the lockout itself - an un-linked worktree refused `selfdev.sqlite` (exit 1, \"schema version 2 is newer than supported version 1\") until `--sync` + `--link`, after which the same read exited 0. 2026-11-10, Linux Fedora 45 `7.2.15-300.fc45.x86_64` node v24.22.1 (the WRITE half, staged then reverted): `--update v1.5.1` → pin `dd30101c`, `refType: tag`; `--sync` 14 s / 10 packages (needs `pi-schema` FIRST in `packages`, else chord fails TS2307); `--link` 14 s / 10 linked; suite **93 PASS / 187 FAIL**; revert → **278/280 in 59.7 s**; migrations identical at both ends (`version: 1, 2`) so **nothing migrates**; backup `cmp` exit 0. Migration inventory: `docs/reviews/pi-1.5.1-delta-review-2026-11-10.md`, ROADMAP **353–357**. 2026-11-11, read-only, item-6200 in an item worktree at main `35001c3a`, dependencySet built-pin (v1.5.1 built + linked): `node scripts/sync-pi.mjs` exit 0, pin `dd30101cfc5b` tag `v1.5.1`, upstream tip `75ca6e7d0849`, **behind 90 / ahead 0**, `tagsBetween: []` - the tip carries NO tag, so a tip bump pins an unreleased commit; every pin package's `package.json` reads **1.5.2** at the tip vs 1.5.1 at the pin. The BUMP COST, measured in a throwaway scratch worktree whose copy of the pin named the tip (the shipped `pi-main.pin.json` was never edited, and nothing landed): `--sync --link` 36 s, 10 packages built, 10 linked, `dependencySet: built-pin`, and the full suite **300/300 exit 0 in 92.4 s** - the same 300/300 exit 0 as the pinned tree (89.7 s). Churn between pin and tip is concentrated in `apps/` (285 files, not in the pin set), `packages/chord` (91), `packages/durable` (52), `packages/coding-agent` (43); the exported symbols that changed there (`defineState`'s key type widened, `JoinPolicy` gaining `"any"`, `KeyedSlot`/`KeySource`/`RunEndTask` removed) appear in **0** durig files, and `documentState` is still present upstream at both ends - the migration `demo/pi-symbol-migration.test.mjs` pins is ours, not upstream's."}
check_rule: null
---

# Move the pinned pi (the vendored clone, its pin, and everything that depends on them)

## When to use

Upstream `earendil-works/pi` has moved and durig must follow it — an ordered update, a release we skipped, or a
symbol we need. Also use it when a **fresh worktree cannot open the live store** (`schema version 2 is newer than
supported version 1`), when you are about to state that something is **absent** from upstream, or when a suite
verdict differs between the seat root and a worktree.

This is the procedure. The *delta* — what actually changed upstream and what it breaks in our tree — is a tracked
document, not this file: **[`../PI-UPGRADE-DELTA-2026-11-04.md`](../PI-UPGRADE-DELTA-2026-11-04.md)** (§2 gap,
§4 symbol breakage, §5 features to accommodate, §6 gates). Cite it; do not retype it. Predecessors:
`docs/SELFDEV.md` §"Pinned-pi reproduction in worktrees", **D129**, and the incident the last pin move produced,
[`../incidents/2026-10-19-pi-build-version-visibility.md`](../incidents/2026-10-19-pi-build-version-visibility.md).

## Impact

Two ways to lose the rig, and both look like success:

1. **You open the live store under a build that writes a schema the current pin cannot re-read.** Our store is
   **already at `durable_schema = {singleton: 1, version: 2}`** (measured 2026-11-04, read-only), and released
   pi-durable ≤ 1.3.0 supports v1 only. So the store **cannot be re-opened by the released line we would fall
   back to**: `sync-pi --unlink` — the obvious reflex — **is not a rollback**. **A backup is the only rollback.**
   Say it that plainly in every brief, because the reflex is wrong. (At the time of writing tip's
   `SQLITE_MIGRATIONS` is identical to the pin's — max version 2, both measured — so *this* update migrates
   nothing. That is a fact about a specific pair of commits, not a law: re-measure it every time.)
2. **You conclude something from a stale vendor clone.** `git grep` over `vendor/pi-main` answers **0 hits** for a
   clone that simply hasn't fetched, and a zero is indistinguishable from absence. That is how the `watchEvents()`
   deletion sat unnoticed across 508 commits. Same family as the `--json` fail-open and `no_store`: a cheap silent
   zero is the most expensive signal.

Blast radius: every seat, the broker, the TUI, the degeneration guard, and the store.

## Preconditions

- **Broker stopped and verified** — [broker-safe-change.md](broker-safe-change.md): `node cli.mjs serve --stop`
  proceeding **only** on `"stopped": true`, then prove no `serve` process and no `broker.json`. A pin move changes
  the library the broker is running inside; never do it under a live broker.
- **You are on an item branch in a worktree**, and you land per [land.md](land.md) — never mid-merge.
- **The dependency set is established before ANY command opens the store.** A worktree's `npm ci` resolves the
  **lockfile's released** `@earendil-works/*`, which at the current pin **cannot read our v2 store** — measured
  2026-11-04: a fresh worktree answered `{"ok":false,"error":"cannot open …/selfdev.sqlite: Durable SQLite schema
  version 2 is newer than supported version 1"}` at exit 1, and the *same* command exited 0 after
  `--sync` + `--link`. This is D129's finding ("an UN-LINKED PIN, not a version gap") and the 2026-10-19 incident,
  and it also makes every suite verdict from that tree non-comparable. See
  [worktree-unlinked-deps.md](worktree-unlinked-deps.md).
- **Name the store with `DURIG_DB`, never `DURIAN_PI_DB`.** Re-measured 2026-11-10 in worktree
  `item-5911` @ `f192f543` (Linux, node v24.22.1): with **both** set the CLI opened the `DURIG_DB` path; with
  **only** `DURIAN_PI_DB` set it opened the fallback `./rig.sqlite` (exit 1, `cause: no_store`). Only
  `scripts/clockin.mjs:379` honours the old name, and it takes it **first**; `CONFIG_KEYS`
  (`src/config.mjs:116-219`) carries 39 keys, none of them `DURIAN_PI_DB`. The stale literal used to sit in
  **16 runbook files / 31 command lines**, including `_template.md` — swept by #5911 on 2026-11-10, so the only
  `DURIAN_PI_DB` mentions left under `docs/runbooks/` are this row's own trap discussion. Copying one of those
  lines during a pin update means you back up, migrate, or gate **the wrong file**. (D103, ROADMAP 191.)

## Diagnose (read-only; safe with the broker up, changes nothing)

```bash
node -e 'const p=require("./pi-main.pin.json");console.log(p.sha.slice(0,8), p.pinnedAt, p.packages.length)'
node scripts/sync-pi.mjs --check                       # drift as a verdict, with the tip it compared to
git -C vendor/pi-main fetch --tags origin              # PREREQUISITE for the three commands below
git -C vendor/pi-main rev-parse --short origin/main    # NAME this sha in every upstream-facing claim
git -C vendor/pi-main rev-list --left-right --count "$(node -e 'process.stdout.write(require("./pi-main.pin.json").sha)')...origin/main"
git -C vendor/pi-main rev-list --count HEAD        # 1 = the clone is SHALLOW, so the count above is depth-bounded
git -C vendor/pi-main show <pin>:packages/durable/package.json | grep '"version"'   # what the pin IS
```

Read the store's schema with a **read-only** open, so you know whether a build would migrate it:

```bash
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.env.DURIG_DB,{readOnly:true});console.log(JSON.stringify(db.prepare("SELECT * FROM durable_schema").all()))'
```

Compare migrations across the pair you are about to swap (`version: N` lines are the migration set):

```bash
git -C vendor/pi-main show origin/main:packages/durable/src/storage/sqlite/migrations.ts | grep -o 'version: [0-9]'
```

Do **not** reach for `git describe --tags <pin>`: our pin is on `main`, ahead of the tag it was stamped near, and
`describe` answers `fatal: No tags can describe …` (measured 2026-11-04). The stamped version is the
`package.json` version at the pin sha.

## Do

**0. Stop the broker** (Preconditions) and record it. Every stage below runs with the broker down.

**1. Back up the store and prove the backup.** Before any run that opens the store under a new build:

```bash
mkdir -p .spike/backups/$(date -u +%Y%m%dT%H%MZ)
cp selfdev.sqlite* .spike/backups/<stamp>/            # the -wal/-shm sidecars too
sha256sum .spike/backups/<stamp>/selfdev.sqlite       # put the sha IN THE ROW
cmp selfdev.sqlite .spike/backups/<stamp>/selfdev.sqlite   # exit 0 = byte-identical
ls -l selfdev.sqlite                                  # the size baseline for any growth report
```

The **sha256 and the byte size go into the row body**, not just a sentence that a backup exists: a restore is only
worth claiming if it is checkable, and the size is the baseline that makes a later `checkpointWhen` store-growth
report mean anything. (2026-11-04 baseline, delegate: `463,142,912 bytes`, sha256 recorded on that row.)

**2. Scratch store before live store.** Under the new build, open a **`/tmp` path that does not exist** and assert
the migration path and the refusal — never `./selfdev.sqlite`, never an unset variable. The gate is
**exit code + named `cause` + sidecar files ABSENT afterwards** (not "0 bytes written"):

```bash
DURIG_DB=/tmp/pin-scratch.sqlite DURIG_NO_SERVE=1 node cli.mjs status   # expect exit 1, cause named, file absent
DURIG_DB=/tmp/pin-scratch.sqlite DURIG_NO_SERVE=1 node cli.mjs queue
DURIG_DB=/tmp/pin-scratch.sqlite DURIG_NO_SERVE=1 node cli.mjs ps
DURIG_DB=/tmp/pin-scratch.sqlite DURIG_NO_SERVE=1 node cli.mjs show 1
node -e 'const{existsSync}=require("node:fs");for(const s of ["","-wal","-shm"])console.log("/tmp/pin-scratch.sqlite"+s+":",existsSync("/tmp/pin-scratch.sqlite"+s))'
```

As of 2026-11-04 this gate is an **unpromoted probe**: `.spike/delegate-20261104b/gate2.mjs` in the **shared root**
(`.spike/` is gitignored, so an item worktree will not contain it — measured). The row that promotes it into
`tools/` with a self-guard against the live store is queued (named **#5090** on the dispatch, **#5109** in the row
body — reconcile the ids before a brief cites one). Until it lands, the inline block above is the gate. Measured at
the current pin: all four verbs **exit 1**, `cause: no_store`, all three files **absent**.

**3. Move the pin — to a TAG, deliberately.** The ruling is standing: **we pin a tag, we never float on `main`**,
and `--update`-to-tip is not a default (D129 already ruled the *published* 1.4.0 **not drop-in**, so pin movement
is a decision). `scripts/sync-pi.mjs parseArgs` knows only `--check/--sync/--update/--link/--unlink` (measured
2026-11-04), so **today** tag-pinning is an explicit edit plus a rebuild:

```bash
node -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync("pi-main.pin.json","utf8"));
p.sha="<full sha of the tag, from: git -C vendor/pi-main rev-parse v1.4.0>";p.tag="v1.4.0";p.pinnedAt=new Date().toISOString();
fs.writeFileSync("pi-main.pin.json",JSON.stringify(p,null,2)+"\n")'
git -C vendor/pi-main rev-parse v1.4.0                # the sha you just wrote, resolved from the FETCHED clone
node scripts/sync-pi.mjs --sync                       # sparse-checkout + build the pinned commit
node scripts/sync-pi.mjs --link                       # node_modules -> vendor/pi-main/packages/* (npm --no-save)
node scripts/sync-pi.mjs --check                      # must now report the pin you set, not the old one
```

`--sync` re-applies the **sparse checkout** (`sparse-checkout init --cone` then `set` to the pin's package dirs),
so a package upstream split out must be **added to the pin's `packages` array** or it silently isn't built
(upstream has `schema`, `env`, `evals` that we do not build — delta §2). **Order inside the array is a build order**:
measured 2026-11-10, `pi-schema` must come **first** — chord compiles before durable/ai and fails
`src/store/json-column.ts(5,33): error TS2307: Cannot find module '@earendil-works/pi-schema'` otherwise (durable,
ai, agent and chord all depend on it at 1.5.1). `--link` uses `npm install --no-save`, so
`package.json`/`package-lock.json` stay clean; if they show a diff after `--link`, something else happened.

**4. Gates at EVERY stage boundary**, not once at the end (the suite is ~62 s):

```bash
node scripts/test.mjs --all --jobs 8 --json     # name tree + sha + count + failed[] every time
node demo/syncpi.test.mjs                       # the pin/sync tool itself
node demo/worktree-deps-link.test.mjs           # the link state that makes verdicts comparable
node demo/pitui.test.mjs
node demo/read-no-create-store.test.mjs
node scripts/test.mjs --area broker             # the subscribeCommits deferral lands here
```

When a run is red, classify it before attributing it. The runner's `--- <file> (exit N) ---` blocks are
machine-readable, so a red set is a set of CAUSES, not a list of filenames:

```bash
node scripts/test.mjs --all --jobs 8 > .spike/suite.out 2> .spike/suite.err
node tools/suite-signature.mjs .spike/suite.err    # exit 0 with reds, 1 with none, 2 on bad usage
```

Measured 2026-11-10 on a real capture from an un-linked worktree: **22 reds, 18 distinct causes**, the largest
group being four broker demos sharing `SessionFailed at util.js:56:69`. Merging those four is correct. Merging
eight different causes into one line is what the scratch classifier in `.spike/pin-update/signature-classify.mjs`
did during the 1.5.1 move — its key was the first line matching `AssertionError|Error:|TIMEOUT`, else
`"(no stderr line)"`. `demo/suite-signature.test.mjs` runs the promoted tool and that predecessor against the
same capture and asserts the tool separates more causes than the predecessor did.

plus the broker/liveness set (`broker`, `broker-liveness`, `broker-intent-wake`, `broker-wake-return`,
`broker-cooldown-revisit`, `scheduler`) and the TUI set (`tui-conversation-header`, `viewmodel`, `chatlog`,
`streamview`, `watchview`). Name demos that exist: the delta doc's "`chatview`" is **not** a demo in `demo/` — the
files are `chatlog`, `streamview`, `watchview` (measured 2026-11-04, 40 `tui-*` demos).
**Never `land.mjs --suite`** (#4997). A suite red at a pin boundary is attributed by re-running the **same** suite
at the previous pin/tree **in the same load window** before calling it the branch's (#5080).

**5. Accommodate, don't just bump.** The symbol migration and the feature ledger are delta §4/§5; a pin bump that
leaves `documentState`/`viewState`/`AgentEvent*`/pi-ai's `Type`/`checkpointWhen` un-migrated is a half-done change.
The sweep is a tool now, not a scratch file (measured 2026-11-10, #6176):

```bash
node tools/pi-symbol-migration.mjs --dry-run --json   # what would change, and what needs a human
node tools/pi-symbol-migration.mjs                    # write it
```

`snapshot()` returns the VALUE, not a `DocumentState` wrapper, so the rename is only half of it: every `.value`
read on a snapshot has to go too. The tool scans `src/`, `cli.mjs`, `scripts/`, `tools/`, `extensions/`, `demo/`
for `documentState`, and prints `residue` — lines its regexes cannot reach (a nested call) — and exits 1, so a
half-migrated tree cannot be reported as done. Done means `grep -rlE documentState src cli.mjs` returns empty.
`demo/pi-symbol-migration.test.mjs` pins the four shapes plus the negative control: a `.value` belonging to
something other than a snapshot must survive untouched.

Two config decisions must be **in config and named by a demo**, never in prose:

- `settings.restartLimit = 3` — never 0, never an unconfigured default (1.4.0 parks a task after repeated
  cut-off restarts; 1.5.0 ends parked tasks **visibly**, `restart_limit`). Measured 2026-11-04: **no** `CONFIG_KEYS`
  entry matches `HARNESS/SETTINGS/RESTART/CHECKPOINT` (24 keys), and the Harness is constructed at one seam,
  `openHarness()` in `cli.mjs` — so the value goes there and a demo must pin it.
- `defineDoc`'s required `checkpointWhen` on our 6 docs (`src/rig.mjs`) — checkpoint the transitions a reader
  **acts on** (claim, complete, defer, hold, release), not every prose or metric edit; report the store-size delta
  against the step-1 baseline.

**6. Two stop rules, held.** (a) A staged pin move exists **for attribution, not ceremony**: if the intermediate
tag cannot go green without the later release's migrations, take the later release **in one move and record why**.
(b) **A green obtained by weakening `src/inflight.mjs` or `demo/guard.test.mjs` is a red in disguise** — that is
the degeneration guard; it defers to `lead` rather than being translated under pressure.

**7. Land and clean up.** Land per [land.md](land.md) (compare the merge tree to a same-turn
`merge-tree --write-tree` prediction), then **re-point seats before pruning** any worktree —
`node tools/rig-portability-audit.mjs` (read-only, ~1 s) prints the seat→root map; SELFDEV pitfall 24.

## Verify

A runbook is done only when this ran. The read-only half ran on **#5089, 2026-11-04**, Linux Fedora 44
`7.2.14-200.fc44.x86_64`, node v24.22.1 — every number below is that run's:

| step | command | result |
|---|---|---|
| pin identity | `node -e … pi-main.pin.json` | `2ec55d80`, `pinnedAt 2026-10-19T07:20:20Z`, **9 packages**; `package.json` at that sha: `"version": "1.3.0"` |
| drift verdict | `node scripts/sync-pi.mjs --check` | **exit 0**, `ok=true drift=true reason="upstream has moved"`, pin `2ec55d80` → tip **`707888ec`** |
| fetch | `git -C vendor/pi-main fetch --tags origin` | **exit 0**; tags `v1.2.0 v1.3.0 v1.4.0 v1.5.0` resolve |
| behind/ahead | `git -C vendor/pi-main rev-list --left-right --count <pin>...origin/main` | **`0 515`** — the delta doc's `508` was measured at tip `fcebc099` and went stale in days. Since #6061 `sync-pi` does this count itself: a shallow vendored clone is deepened (`git fetch --unshallow origin`) and recounted, reported as `gap: "measured", deepened: true`; a failed fetch reports `gap: "unknown"` naming every command tried |
| migration parity | `show <ref>:…/migrations.ts \| grep -o 'version: [0-9]'` | pin: `1 2` · tip: `1 2` → **no new migration for this pair** |
| store schema | read-only `SELECT * FROM durable_schema` | `[{singleton:1, version:2}]` |
| scratch gate | 4 verbs at an absent `/tmp` DB | all **exit 1**, `cause: no_store`, `db` absolute, `.sqlite`/`-wal`/`-shm` **ABSENT** |
| the lockout | un-linked worktree vs the same store | **exit 1** `schema version 2 is newer than supported version 1`; after `--sync` + `--link`, **exit 0** |
| env-var trap | `DURIAN_PI_DB=… node cli.mjs status` alone | opened the fallback **`./rig.sqlite`** → the old name is ignored |

The pin was **not** moved by that run (this row is mint-before-the-move); it verified the read-only half. The
write half is verified by the stage it is first used in (#5095/#5096) — then bump `last_verified`.

## If it fails

- **Restore is a file copy, and it costs the rows written since the backup.** `cp` the step-1 backup back over
  `selfdev.sqlite*` (broker down), verify it by the recorded sha256, and **name what was lost** — a restore silently
  deletes every transition after the backup, so the row and the queue must be told.
- **`sync-pi --unlink` is not a rollback.** It restores the released packages, and released ≤ 1.3.0 cannot open a
  v2 store. It is how you get into the lockout, not out of it.
- **Suite red at a boundary:** re-run at the previous pin in the same load window (#5080) and name which tree your
  verdict came from; the known load-sensitive flake is `broker-stop-audit` (#5056) — re-run it standalone before
  chasing it. Group the reds by cause before writing the brief (`node tools/suite-signature.mjs <capture>`):
  "8 pre-existing reds" is a claim nobody can check; "18 causes, four of them one storage error" is.
- **A tool result shows `[redacted by durian-pi: secret-shaped value]`** because a 40-hex sha passed through it:
  print shas as 8-char prefixes (`${sha:0:8}`) or quote them in report text — [tool-result-redacted.md](tool-result-redacted.md).
- Escalate a store that will not open under **either** build to [store-corruption-recovery.md](store-corruption-recovery.md).

## Escalate to

`lead` — for the pin-policy decision (which tag, staged or single, `restartLimit`, `checkpointWhen`), for any
temptation to weaken the degeneration guard to get green, and for the landing entry. Operator — for the push and
for any capacity/cost ruling. Never proceed by choosing the cheaper interpretation of a ruling.

## Evidence

Minted on **#5089** (docs-only; no pin, no code touched) from the measurements above, 2026-11-04. Read the delta in
[`../PI-UPGRADE-DELTA-2026-11-04.md`](../PI-UPGRADE-DELTA-2026-11-04.md) before adding a claim: a claim without a
command that proves it does not belong here.
