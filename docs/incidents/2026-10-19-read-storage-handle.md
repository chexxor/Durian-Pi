---
incident: read-storage-handle
date: 2026-10-19
severity: sev2
status: mitigated
symptom: "`node cli.mjs` reads (`ps`/`queue`/`status`/`watch`) and `npm run ui` fail with `read: the broker has no storage handle (probeStorage)`"
runbook: broker-down-or-stalled
fix: "a70c30d"
prevention: "demo/broker-read.test.mjs (now covers readStorage) + a suite-green-on-main gate (same gap as read-op-regression)"
last_reviewed: 2026-10-19
---

# Broker-served reads died on `harness.storage`, a field pi-durable does not expose

*Incident 2026-10-19; detected live by the operator as `node cli.mjs watch --once`; diagnosed by the delegate.*

## Summary
The broker's `read` handler served every spooled read from `harness.storage`:

```js
// src/broker.mjs applyRequest()
return await dispatchRead(harness.storage, request, { dbPath, context });
```

pi-durable's `HarnessImpl` keeps its storage in a **private `#storage` field with no getter**, so
`harness.storage` is `undefined`. `dispatchRead` throws (`src/brokerread.mjs:52`), the read is
**dead-lettered**, and the CLI surfaces it: `node cli.mjs watch --once` →
`{"ok":false,"error":"read health: apply failed: read: the broker has no storage handle
(probeStorage) to serve this request"}`. Every read verb (`ps`, `queue`, `status`, `watch`) and
`npm run ui` are affected whenever a healthy broker owns the store.

## Timeline
- **`8d48cb1`** (2026-10-18) changed `dispatchRead(probeStorage, …)` → `dispatchRead(harness.storage, …)`,
  intending to serve reads from the harness's own pi-durable connection to avoid in-process lock
  contention with a second `openStore()` connection. The intent was right; the property does not exist.
- **`c5daca5`** (#2211) and **`3e17346`** (the delegate's `read`-op restoration hotfix) kept
  `harness.storage` — the hotfix restored the op but not the handle.
- **Masked while the broker was down/wedged.** `src/readclient.mjs` routes a read through the broker only
  when `brokerAlive`; otherwise it opens the store directly (`readLocal`). With the broker not serving,
  CLI reads fell back to the direct path and worked, hiding the broken broker handler.
- **2026-10-19 ~05:03Z** the broker was restarted healthy (`pid 17828`) after the operator-directed
  architect-seat change. Every CLI read now routed through the broker and failed.
- Operator runs `node cli.mjs watch --once` → the error above; `npm run ui` is broken the same way.
- Delegate diagnosis: a probe on a real `Harness` returns `typeof harness.storage === "undefined"` and
  `"storage" in harness === false`; `node demo/broker-read.test.mjs` is RED (`{delivered:0,
  deadLettered:1}`).
- **Fix `a70c30d`** (see Resolution). Broker restarted **`pid 5116`** (`START 05:22:17Z`); `watch --once`
  and `ps` return `"ok":true`.

## Impact
- The **operator's entire window into the team** (`ps`/`queue`/`status`/`watch`) and `npm run ui` were
  unusable on any broker restarted from `main`.
- Every `read` intent was dead-lettered (`.broker.inbox.error/`), so the spool accumulated dead letters.
- **No data risk:** seats and the driver were unaffected (they use the harness directly, not the spool),
  so the rig kept working — which is exactly what masked the regression.
- `demo/broker-read.test.mjs` was RED on `main`, so the suite could not be green.

## Root cause
**VERIFIED.** durig reached into a private library field. `node_modules/@earendil-works/pi-durable`
(`dist/harness/harness.js`) declares `#storage` and never exposes it; `Harness.open(storage, …)` wraps
the `Storage` the caller passed. `8d48cb1`'s one-connection goal was correct, but it should have retained
the `Storage` object `openHarness` created rather than reading it back off the harness. `3e17346` then
re-added the same wrong reference while restoring the `read` op.

## Detection
The live symptom (the operator). The durable detector already existed: **`demo/broker-read.test.mjs`**
(last touched by `8d48cb1`) proves broker-served reads and was RED — the same
**"the committed suite was not run green on `main`"** gap as
`2026-10-19-read-op-regression.md`. A green landing suite and a fresh broker heartbeat both failed to
surface it: a fresh heartbeat is not health, and `status` has no attention kind for "the suite is red".

## Resolution
**`a70c30d`** — `openHarness` now returns the exact `Storage` it hands to `Harness.open`; that handle is
threaded as `readStorage` through `runWakeLoop` → `drivePass` → `drainIntentInbox` → `applyRequest`, and
`dispatchRead(readStorage ?? probeStorage, …)` serves the read. `cmdServe` and `cmdRun` pass the harness's
storage (`probeStorage` stays the separate raw handle that its own comment justifies for corruption
probes). One pi-durable instance, one connection. Broker restarted `pid 5116`; `demo/broker-read.test.mjs`
and the read demos are GREEN. A non-author verify is owed; status stays `mitigated` until it passes.

## Prevention
- **Keep `demo/broker-read.test.mjs` green** — it now covers `readStorage`; run it before any commit that
  touches the read path, and never land the read path on a RED demo.
- **Gate the committed suite on `main`** before a landing window (the shared gap with
  `read-op-regression`); a post-verify commit can currently leave `main` red with no attention notice.
- **Do not read library state off an object's internals.** Retain the value you constructed; add a unit
  assertion that `openHarness` returns a usable `Storage` (the probe used here is re-runnable).

## Evidence
- `node demo/broker-read.test.mjs` — before: `AssertionError … {delivered:0, deadLettered:1}`, exit 1;
  after `a70c30d`: exit 0.
- Probe (`.spike/delegate/harness-storage-probe.mjs`, a real `Harness` over `MemoryStorage`):
  `typeof harness.storage = undefined`, `'storage' in harness = false`.
- `node cli.mjs ps`/`queue`/`watch --once` — before restart: the `no storage handle` error; after
  `pid 5116`: `"ok":true`.
- `src/brokerread.mjs:52` throws on falsy storage; `git blame -L 377 src/broker.mjs` → `3e17346`.
- `selfdev.sqlite.broker.log` — `START pid=17828` (exposed the bug) → `START pid=5116` (fixed).
- UNVERIFIED (not this incident): the 3 suite failures `land-helper` / `prepare-workspace` /
  `worktree-reuse-deps` do not touch the read path (no `drivePass`/`openHarness`/`readData` reference)
  and are suspected to come from the uncommitted `scripts/land.mjs` / `src/worktree.mjs` WIP.

## Links
`docs/incidents/2026-10-19-read-op-regression.md` (same surface, different root cause) ·
`docs/runbooks/broker-down-or-stalled.md` · `src/brokerread.mjs`, `src/readclient.mjs`,
`demo/broker-read.test.mjs` · `docs/DECISIONS.md` D111 (broker-served reads).
