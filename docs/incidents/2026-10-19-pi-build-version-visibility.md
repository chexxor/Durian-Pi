---
incident: pi-build-version-visibility
date: 2026-10-19
severity: sev2
status: open
symptom: "a verifier in a fresh worktree sees released pi-durable 1.1.0 while the shared tree runs the pinned vendored 1.3.0; the same commit is GREEN in one and RED in the other"
runbook: null
fix: null
prevention: "worktree/verifier dep setup must reproduce the pinned pi build (`node scripts/sync-pi.mjs --link`); or the broker must pass the storage it opened the harness with instead of the 1.3.0-only `harness.storage`"
last_reviewed: 2026-10-19
---

# The same commit runs on two different `pi-durable` versions, so the read fix is GREEN in the shared tree and RED in a fresh worktree

*Incident 2026-10-19; detected by the delegate while adjudicating the auditor's `#2406`.*

## Summary
The `read`-op hotfix (`3e17346`) serves reads via `dispatchRead(harness.storage, …)`. That accessor
exists in the **pinned vendored** `pi-durable` build that the shared tree runs, but **not** in the
**released** `pi-durable` that a fresh worktree gets from `npm ci`. So the delegate's shared-tree runs
(`demo/broker-read-nopass.test.mjs`, `demo/broker-read.test.mjs`, full suite) are GREEN, while the
auditor's detached worktree at the same commit (`062e691`) is RED (`harness.storage` undefined →
`read: the broker has no storage handle`). `#2406` is therefore a real failure **for the version the
lockfile resolves**, but not a regression in production's version.

## Timeline
- `2026-10-19T03:2xZ` `3e17346` restores `dispatchRead(harness.storage, …)`; delegate suite GREEN 148/148.
- `2026-10-19T03:3xZ` auditor runs the same checks in a throwaway detached worktree at `062e691`:
  `demo/broker-read-nopass.test.mjs` exit 1, `demo/broker-read.test.mjs` exit 1 (`deadLettered:1`).
- Delegate adjudication (this record): the two environments resolve different `pi-durable`.

## Impact
- A non-author verify can FAIL a correct change because its worktree resolves a different dependency
  than production — a false-negative that wastes team cycles or, worse, invites a "repair" that
  regresses production.
- The specific trap: "repairing" `#2406` by switching the read seam to `probeStorage` would reintroduce
  the D111 second-connection contention wedge (`probeStorage` is a separate `openStore()` in `cli.mjs`).
- Not a data loss; not a regression in the shared tree.

## Root cause
**VERIFIED.** Two environments, two `pi-durable` builds:
- Shared tree: `npm ls @earendil-works/pi-durable` → `1.3.0 -> .\vendor\pi-main\packages\durable`
  (`node_modules/@earendil-works/*` are symlinks into the gitignored `vendor/pi-main`, built from the
  committed `pi-main.pin.json` @ `8efd314…` by `scripts/sync-pi.mjs --sync --link`). Here
  `harness.storage` is a public `GuardedStorage` with `scanEntries`/`scanSubmissions`/`findDocument`.
- Fresh worktree (`npm ci`): the committed `package.json` (`^1.0.4`) and `package-lock.json`
  (HEAD) resolve the **registry** `1.1.0`. In 1.1.0, `HarnessImpl` holds storage in a **private
  `#storage` field with no public accessor** (`dist/harness/harness.js`: `#storage`, `this.#storage = storage`),
  so `harness.storage` is `undefined` and `dispatchRead`'s guard throws.

`scripts/land.mjs --suite` is unaffected because its scratch worktree lives *inside* the repo root and
Node resolves the shared `node_modules` symlinks (1.3.0) — which is why the landing suite is green.

## Detection
Only cross-environment comparison catches it; no `check`/attention kind distinguishes the resolved pi
build per worktree. The delegate found it by diffing `npm ls` vs `package-lock.json` after the auditor's
opposite result.

## Resolution
**Pending.** Do **NOT** change the read seam to `probeStorage` (D111 contention). Recommended:
1. Make verifier/seat worktrees reproduce the pinned build after `npm ci`
   (`node scripts/sync-pi.mjs --link`; ideally in `prepare_workspace`); and/or
2. Thread the storage the broker already opened the harness with into `dispatchRead`
   (single connection, works on 1.1.0 and 1.3.0) instead of the 1.3.0-only `harness.storage`.
Then re-run `#2396`/`#2408` in an environment that matches production.

## Prevention
- Worktree dependency setup states/ensures the pinned pi build; a released `npm ci` alone is NOT the
  production dependency set.
- Fail closed with a clear message when `harness.storage` is missing ("pi-durable build predates 1.3.0;
  run `sync-pi --link`"), so the version gap is named instead of a bare "no storage handle".

## Evidence
- `npm ls @earendil-works/pi-durable` → `1.3.0 -> .\vendor\pi-main\packages\durable`.
- `node -e "require('./package-lock.json')"` → `node_modules/@earendil-works/pi-durable` version `1.1.0`;
  `git show HEAD:package-lock.json` → `1.1.0`; `package.json` → `^1.0.4`.
- `vendor/pi-main/packages/durable/package.json` version `1.3.0`; `pi-main.pin.json` sha `8efd314…`.
- 1.1.0 tarball (`npm pack @earendil-works/pi-durable@1.1.0`): `dist/harness/harness.js` has `#storage`
  and no `get storage`.
- 1.3.0: `Harness.open(...).storage` is a `GuardedStorage` (typeof `object`).
- Delegate: both read demos exit 0 in the shared tree; auditor `#2406`/`#2407`: exit 1 in the worktree.

## Links
`docs/incidents/2026-10-19-read-op-regression.md` · `docs/runbooks/land.md` ·
`scripts/sync-pi.mjs`, `pi-main.pin.json` · `src/brokerread.mjs`, `src/broker.mjs` (`applyRequest`).
