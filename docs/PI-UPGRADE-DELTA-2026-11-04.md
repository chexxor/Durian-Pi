# pi-durable upgrade delta — 2026-11-04 (delegate research, measured)

Ordered by the operator: *"update our version of pi-durable to ensure we have latest … a proper update which
includes identifying changes and new features and ensuring we accommodate them appropriately in this project."*
This file is the **delta and the accommodation map**; decomposition, sequencing and routing are the team's. The
delegate ran no build and changed no source.

Host for every number here: **Linux Fedora 44, kernel `7.2.14-200.fc44.x86_64`, node v24.22.1, git 2.56.0**
(OS + distro + kernel, never `user@hostname` — operator ruling, 2026-11-04).

## 1. Refresh this file (all cheap, all read-only)

```bash
node scripts/sync-pi.mjs                                  # drift: pinned sha vs upstream tip
git -C vendor/pi-main fetch --tags origin                 # tags v1.4.0, v1.5.0 now resolve
git -C vendor/pi-main rev-list --left-right --count <pin>...origin/main
git -C vendor/pi-main show origin/main:packages/durable/CHANGELOG.md    # the breaking list, by release
node .spike/delegate-20261104b/store-schema-probe.mjs ./selfdev.sqlite  # store schema version (readOnly open)
node .spike/delegate-20261104b/spec-compat-probe.mjs origin/main        # every specifier we import, still there?
```

`.spike/` is gitignored — if these probes are still useful, `lead` mints a row to promote them into `tools/`.

## 2. The gap

| fact | value |
|---|---|
| our pin | `2ec55d808d455b1a64a2bf7888198207a096120a`, `pinnedAt 2026-10-19T07:20Z`, stamped **1.3.0** |
| upstream tip | `fcebc099565d8f30c15b321ff6a1af5f34d89400` = **1.5.0** |
| behind | **508 commits** (0 ahead) as measured 11:0xZ — releases skipped: **v1.4.0 (2026-10-21)**, **v1.5.0 (2026-11-02)**. **CORRECTION same day:** at 12:3xZ tip is **`707888ec…`** and the gap is **515**; `git -C vendor/pi-main rev-parse origin/main` still printed `fcebc099` because that is a stale local remote-tracking ref — fetch in the same command as any upstream count. devtools caught this on #5089. |
| per package | durable 55 · ai 65 · coding-agent 155 · chord 226 · tui 36 · agent 12 · mcp 19 · codemode 7 · telemetry 10 |
| npm channel | `@earendil-works/pi-durable` `dist-tags.latest = 1.5.0` |
| live `node_modules` | **symlinks into `vendor/pi-main/packages/*`** — the `--link` state is active, at the pinned build |
| upstream packages we do not build | **`schema`**, **`env`**, `evals` (all 1.5.0) |

Two decisions precede any build: **(a) pin to tags (`v1.4.0` → `v1.5.0`) or keep tracking `main`** —
`scripts/sync-pi.mjs --update` can only move to main's tip (`parseArgs`: `--check/--sync/--update/--link/--unlink`),
so tag-pinning is a small script + `demo/syncpi.test.mjs` change; D129 already ruled the *published* 1.4.0 **not
drop-in**, so pin policy is a standing decision. **(b) `settings.restartLimit`** — 1.4.0 parks a task after 5
cut-off restarts, 1.5.0 makes parked tasks **end visibly** (`restart_limit`, and `Harness.retryTask()` /
`task_parked` removed). That lands on degenerate-seat supervision; set the value deliberately.

## 3. Store risk (settled, and it cuts both ways)

- Tip's `SQLITE_MIGRATIONS` is **identical to the pin's** (max version **2**) → the upgrade runs **no new store
  migration**.
- Our live store is **already at version 2**: `durable_schema = {singleton: 1, version: 2}` (read-only open).
- Therefore **`selfdev.sqlite` cannot be opened by released pi-durable ≤ 1.3.0** (1.4.0's own note), and
  `sync-pi --unlink` is **not** a rollback. **Back up `selfdev.sqlite*` with the broker down before any run that
  opens it under a new build.**

## 4. What breaks in our tree — symbol-level, not path-level

`spec-compat-probe.mjs` resolved every `@earendil-works/...` specifier we import against the tip tree: **all of
them still resolve** (`./storage/sqlite/node`, `./env/node`, `./tools`, `./providers/faux`, `./models`,
`./api/openai-completions`, `./utils/*`, `chord/context`). The breakage is in **named exports**:

| upstream removal / change | our exposure |
|---|---|
| `Session.documentState()` → `watchDoc()` | `cli.mjs` 16, `src/broker.mjs` 7, `src/reset.mjs`, ~20 demos |
| `Conversation.viewState()` → `Conversation.watch(ctx, window)` | `src/tui/durable/adapter.mjs` 3, `demo/tui-conversation-header.test.mjs` |
| **`watchEvents()` and every `AgentEvent*` type removed** (spec §9.4 deleted; CHANGELOG carries the `ConversationTranscript` migration) | `src/tui/durable/bridge.mjs` (the pi-durable→pi-coding-agent bridge), `src/tui/durable/adapter.mjs`, **`src/inflight.mjs`** (degeneration guard), `demo/guard.test.mjs`, `demo/inflight.test.mjs` |
| `subscribeCommits()` now sees **stored** commits only; progress commits deferred (`settings.progress.persistWithinMs`, default 1000 ms) | `src/scheduler.mjs`, `src/inflight.mjs`, the broker-liveness demos (`broker`, `broker-liveness`, `broker-intent-wake`, `broker-wake-return`, `broker-cooldown-revisit`, `scheduler`) |
| watch listener signature `({value, ops, retired}, ctx)`; end reasons `ended`/`failed`; `retired` end gone | `retired` 3 hits / 2 files; `session_closed`/`session_failed` 0 |
| pi-ai **no longer re-exports TypeBox**; tools take JSON Schema via **`@earendil-works/pi-schema`**; `typebox` is no longer an upstream dependency | `src/rig.mjs:13` `import { Type } from "@earendil-works/pi-ai"`, 16 × `Type.Object`, 11 × `defineTool`; `src/seattools.mjs`; `demo/secretredact.test.mjs`. Our set is `Optional 23, String 21, Object 16, Number 11, Literal 6, Union 4, Boolean 3, Array 2, Null 1, Integer 1`; **no `Refine`/`Codec`/`Format`**, so nothing silently stops working |
| **tool-arg validation is JSON-Schema-only with pi-schema coercion** (`null`→`"null"`, `"3.5"`→`3`, single value→array; new error wording) | re-run every tool-arg demo; do not assume parity |
| `defineDoc`/`defineDocFamily` **require `checkpointWhen`** | `src/rig.mjs` 6 docs — a store-growth vs read-cost ruling |
| `TaskRuntime.sleep()` removed; `sleepUntil`/`setTimer`/`ToolExecutionApi.now()` added — hand-built fakes must add them | demo fakes that construct `TaskRuntime` |
| `Storage.commit(batches, receive, ctx)` → `CommitResult`; `mintId()` narrowed; `runCounted`; `FileChange`; `HostCallback` `"telemetry"`; `ToolControl.terminate: boolean` | **no custom Storage in our tree** (`class *Storage`, `mintId` → 0 hits), so the `commit()` rewrite does not land on us |
| `ConversationView.entries` is now a **window** (min 50, max 2×min) + `ConversationWindow` / `ConversationTranscript`; **`pi.live` is no longer `{}` after a run that ended without an answer** — it holds `runFailure`; test `run === undefined` | `pi.live` appears in 13 files / 40 hits — audit every idle-by-equality test |

Clean: `Harness.taskGraph()` (0 hits), no custom `Storage`, no TypeBox-only features.

## 5. New features worth accommodating, ranked by the rig problem they solve

1. **`mode: "read-only"`** on `openNodeSqliteStorage` / `openNodeSqliteDatabase` (`chord`'s
   `NodeSqliteDatabaseOptions`; **absent at our pin**) → upstream refuses to open a missing file, which is exactly
   the invariant #4955 / #5079 / #5083 hand-rolled across **31 `openNodeSqliteStorage` call sites**.
2. **`pi.live.runFailure`** (typed `model_error`, `no_model`, `aborted`, `reset`, `faulted`, `orphaned`,
   `restart_limit`) + **`settings.afterFailedRun`** (`keep`/`continue`/`withdraw`) → replaces prose-parsing of
   `attention[].detail` (`auditor` `last_run_failed`) and decides what happens to inputs parked behind a failed
   run (the qa rows behind a dead verifier endpoint).
3. **Durable sleeps** (`sleepUntil`, `{status:"sleeping"}`), **`Harness.wake()` / `onWake`**, **`setTimer`**,
   **`now()`** → the broker's cooldown / backoff / heartbeat machinery (`broker-cooldown-revisit`,
   `broker-intent-wake`, the stale-`PASS` dormant-broker class) stops hand-rolling wall-clock timers.
4. **`ConversationWindow` / `ConversationTranscript`** → honest TUI memory, and the right frame for
   `qa 20,110/24,576 = 0.818` and `advocate consumed 244,751 against a 24,576 window` (SELFDEV pitfall 27).
5. **`HarnessOptions.models` / `.settings` accept functions** → the config live-reload story (ROADMAP ~800 ties
   live-reload to how a version gets pinned); today a config change needs `up`/restart.
6. **`settings.progress.persistWithinMs`** → upstream measures 5.7× fewer storage transactions and 2.9× fewer disk
   writes with 32 parallel streams; our history is single-writer and `database is locked`.
7. **`HarnessOptions.identity`** (ClientIdentity → `User-Agent`/provider attribution) and
   **`HarnessOptions.telemetry`** (`DURABLE_TELEMETRY_SCHEMA`, no payloads) → the metrics layer and the D205
   attribution question.
8. **`@earendil-works/pi-schema`** (`obj/str/num`, closed by default, `{open:true}`) — cheap for us because durig
   is JS (no `Static<>` call sites), but pair it with the coercion change in §4.

## 6. Gates the team already owns

`node scripts/test.mjs --all --jobs 8 --json` (**254 demos, 62 s at the pin** — measured 2026-11-04) plus named:
`demo/syncpi.test.mjs`, `demo/pitui.test.mjs`, `demo/worktree-deps-link.test.mjs`, the broker/liveness set (the
`subscribeCommits` change), the TUI set (`tui-conversation-header`, `viewmodel`, `chatview`),
`demo/read-no-create-store.test.mjs`, and a **scratch-store run** (absent `/tmp` DB under the new build: assert the
migration path and the read-only refusal; re-run the behaviour gate that checks *exit code + named `cause` + store
file absent*, currently an unpromoted probe). Every stage: broker down
(`docs/runbooks/broker-safe-change.md`), item branch in a worktree, land per `docs/runbooks/land.md`, **re-point
seats before pruning** (SELFDEV pitfall 24).

**No runbook exists for this procedure.** It lives in `docs/SELFDEV.md` §"Pinned-pi reproduction in worktrees" and
in D129, and the last pin move produced an incident (`docs/incidents/2026-10-19-pi-build-version-visibility.md`).
A `docs/runbooks/pi-pin-update.md` with `last_verified` set by the run that actually did this is the cheap
durable win.
