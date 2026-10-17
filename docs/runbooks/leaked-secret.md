---
runbook: leaked-secret
symptom: "a secret (API key, token, private key, password) was committed or otherwise exposed"
writes: false
precondition: "read-only"
last_verified: 2026-10-17
verified_by: security
evidence: "#1300 (clean class-pattern scan over tree/history/logs at rev 7e5d16e; Verify run 2026-10-17)"
check_rule: null
---

# Leaked or committed secret

## When to use
A secret-shaped value surfaced in a source file, a commit, a queue item, a session log, a `.spike/`
backup, or the store: `sk-ant…`, `AKIA…`, `ghp…`, `xox…`, `-----BEGIN…PRIVATE KEY-----`, a JWT, or a
`password:`/`api_key:` assignment in a config. Includes the self-referential case: a seat reports the
leak by pasting the value into a queue item, creating a second copy.

## Impact
The value is **burned the instant it is written anywhere durig cannot unpublish**: a commit (portable
history the operator may later push), `.spike/` patch backups, `selfdev.sqlite` and the spooled inbox
(durable, readable by every seat — all seats run as the same Windows user, so file permissions are a
norm, not a control), and session logs. Removing it from source is necessary but **never sufficient**:
the provider value must be rotated. One burned value can outlive every cleanup below if it reached a
log or a store row.

## Preconditions
Read-only: nothing here opens a writing Harness (`writes: false`). Removal happens as ordinary work in
an item worktree. The only broker-level write this can call for — redacting a value already sitting in
the store or an inbox file — is **escalated to the delegate as a broker-stopped procedure**
(see `broker-safe-change.md`), never done from this runbook.

## Diagnose (read-only)
Scan by **class pattern, never by value**: the scan commands below are themselves logged, and
`git log -S<the value>` would print the leak again. Map the report's redacted preview to a class:

| Secret class | Probe pattern (tested to compile) |
|---|---|
| Anthropic key | `sk-ant-[A-Za-z0-9_-]{8,}` |
| AWS access key | `AKIA[A-Z0-9]{16}` |
| GitHub token | `ghp_[A-Za-z0-9]{30,}\\|gho_[A-Za-z0-9]{30,}\\|github_pat_[A-Za-z0-9_]{22,}` |
| Slack token | `xox[abprs]-[A-Za-z0-9-]{10,}` |
| Google key | `AIza[A-Za-z0-9_-]{30,}` |
| Private key block | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |
| JWT | `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.` |
| Config assignment | `(?i)(api[_-]?key\|token\|secret\|password)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}` |

```bash
# tracked tree (run from any worktree or the shared tree; read-only)
git grep -nE '<class-pattern>' -- .
# which commits ever contained the class (pickaxe by class string, never by value)
git log --oneline --all -S'sk-ant-' -- .
# what is staged right now
git diff --cached --stat
```
```powershell
# broker logs at the project root (not tracked, so not visible from an item worktree);
# -Quiet prints True/False only, never the matched text
Select-String -Path .spike\serve.out, .spike\serve.err, selfdev.sqlite.broker.log -Pattern '<class-pattern>' -Quiet
```
[judgement] The store and queue bodies are read with seat tools (`peek_queue`, `cli.mjs queue`), not
dumped to the terminal; if you suspect a store copy, report that suspicion and escalate — the delegate
scans the store broker-stopped.

## Do
1. **Report, never echo.** Record location (file:line / item id / log file), secret *type*, and a
   redacted preview (at most 4 leading characters, rest masked, e.g. `sk-…an••••`). No value in any
   queue item, completion summary, or commit message — those are durable reads. If a queue item or
   log already carries the raw value, treat that copy as leak #2 and include it in the inventory.
2. **Contain: rotate first.** The value is burned; only rotation (out-of-band, via the provider)
   makes the leak benign. durig seats hold no provider credentials — request rotation with
   `defer_work` to the operator. Do not wait for cleanup to start this.
3. **Remove from HEAD going forward.** In your own item worktree, replace the value with an env read
   or a boolean `set`/`unset` (see `describeConfig` in `src/config.mjs`), commit **explicit paths
   only** (never `git add -A` — it sweeps `.spike/` backups and other seats' files), and say in the
   completion what was removed and where. This does NOT un-leak the history.
4. **Inventory the copies.** `git log --all -S` + worktree list; the delegate adds `.spike/`, inbox
   and store. Report the list, then **leave history rewrite to the operator** — `filter-branch`/BFG/
   force-rebase decisions belong to the person who holds push; durig never pushes without
   `DURIG_ALLOW_PUSH`, so the leak is local until the operator publishes.
5. **Close the mechanism that let the value in.** Controls confirmed at rev 7e5d16e:
   - `src/confine.mjs` L110/L122: an env name matching `SECRET_NAME`
     (`/(key|token|secret|password|passwd|credential|cookie|authorization)/i`) never crosses into a
     seat environment, allowlist or not (SC3; "the seat asked for the key" is overridden).
   - `src/config.mjs` `describeConfig`: prints `DEEPINFRA_API_KEY` as `"set"/"unset"`, never the value.
   - **Finding (high): the commit path has no automated gate.** Item #700's scanner
     (`SECRET_VALUE_PATTERNS` / `looksLikeSecret` / `assertNoSecretsInFile`) is proposed in
     `docs/NEXT.md` (~L501) but never landed at this rev — nothing automated stops a secret-shaped
     line from being committed today. Concrete fix: land #700 as a commit-time pre-flight +
     demo assertion; route adoption to lead/pm (do not adjudicate scope yourself; tie-ins: #828
     read-side detection, #837 redaction).

## Verify
Every pattern is **anchored to a value shape** (minimum-length body): a bare prefix would match this
runbook's own pattern table, and this file is the one sanctioned carrier of the class strings.
```bash
git grep -nE '<pattern 1>\|<pattern 2>' -- . ':!docs/runbooks/leaked-secret.md'   # exit 1 = clean
git log --oneline --all -S'<class substring>' -- .        # no hits NEWER than the fix commit
```
Rotation is operator-confirmed out-of-band; it is not verifiable from durig — say so in the completion
rather than implying it was checked.

## If it fails
- The scan still matches after the fix commit: copies remain — repeat Diagnose; each hit is inventory,
  not a new burn (the value is already burned; only rotation changes that).
- The value is still active and rotation is blocked (no operator available): treat as open exposure —
  hold further writes touching the file and defer to the operator.
- A store or spooled-inbox copy is more than a suspicion: escalate to the delegate to redact
  broker-stopped (see `broker-safe-change.md`).

## Escalate to
- **Operator:** rotation, any history rewrite, publication status (push grant / `DURIG_ALLOW_PUSH`).
- **Delegate:** store / inbox redaction (broker-stopped procedure).
- **lead/pm:** landing #700's scanner and the #828/#837 tie-ins — they adopt; this seat recommends
  only.

The trust-boundary **review method** MOVED 2026-10-17 (item #1322, lead ruling #1316) to
[security-trust-boundary-review.md](security-trust-boundary-review.md). This file keeps the failure
mode and the class-pattern table; the method links here instead of duplicating it.

## Evidence
- Authored by `security`, item #1300 (2026-10-17), under the #1297 lead ruling (one durable surface:
  this runbook; reviews stay per-item artifacts).
- Controls named at rev 7e5d16e: `src/confine.mjs` SECRET_NAME deny + `describeConfig` set/unset are
  wired; the commit-time scanner is absent (`docs/NEXT.md` ~L501, item #700 incomplete) — finding
  routed to lead/pm.
- Verify actually ran 2026-10-17 by `security`: class-pattern `git grep` over the tracked tree
  (exit 1, no matches), pickaxe for `sk-ant-` and `AKIA` (0 hits each), no log files present in the
  item worktree — clean state at rev 7e5d16e.
- #1322 (2026-10-17): the review-method appendix MOVED (not duplicated) to
  `security-trust-boundary-review.md`; this file keeps only the secret failure mode (lead #1316).
