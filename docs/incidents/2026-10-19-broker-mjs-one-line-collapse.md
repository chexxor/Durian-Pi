---
incident: broker-mjs-one-line-collapse
date: 2026-10-19
severity: sev2
status: resolved
symptom: "a source file was silently collapsed to one line"
runbook: write-corruption-recovery
fix: null
prevention: "recover `src/broker.mjs` from HEAD (operator `git checkout --`), and record the guard miss/bypass: the #623 refusal (refusalForWrite, src/seatguard.mjs) did NOT fire for this write path"
last_reviewed: 2026-10-19
---

# `src/broker.mjs` in the shared tree collapsed to a single line (the #623 shape), via a guard-bypassing write

*Incident 2026-10-19; detected by the delegate during the clock-out doc review; analysis by the delegate.*

## Summary
While reviewing the session for the clock-out, the delegate found the shared working tree's
`src/broker.mjs` (a tracked file) collapsed to **one line with zero line terminators** — 62,727 bytes,
`LF=0 CR=0 NUL=0` — and carrying **older** content (no `"configure"` in `SPOOL_OPS`, no
`onlyReadIntents`). As JavaScript, the file's leading `//` comment now runs to EOF, so the module
exports nothing and every `node cli.mjs` import of it breaks. The committed revision in `HEAD` is
intact (1,429 lines, `onlyReadIntents` present), so no committed history is lost; only the working-tree
copy is damaged. This is the `#623` silent write-corruption shape (`docs/runbooks/write-corruption-recovery.md`).

## Timeline
- `2026-10-19T02:40:19Z` (`2026-10-18 21:40:19 -0500`) — `src/broker.mjs` mtime; the file is the
  collapsed one-line copy.
- `02:40:38Z` — the broker logged `WAKE-RETRY in=2000ms seats=qa pass-threw` (a persistent
  `qa` conv-15 `Session failed after a storage error`); the wedge and the collapse are minutes apart.
- `02:4x–02:5xZ` — several reads of `src/broker.mjs` from the delegate's shell returned 0 lines / a
  1-line diff while the byte count stayed ~62 KB (the file also appeared transiently empty), then a
  stable collapsed state; a `cli.mjs watch` viewer (pid 14472) and the wedged `serve` (pid 16864) were
  running throughout, and a seat's edit activity was suspected.

## Impact
The shared tree cannot be used for a `node cli.mjs` operation until `src/broker.mjs` is restored — any
verb importing it (nearly all) sees a module with no exports. This directly blocks the next planned
work (a git branch-management pass) and any broker restart. No committed data loss: `HEAD` holds the
intact 1,429-line file, so recovery is a single-file restore.

## Root cause
**Partially VERIFIED; the exact writer is not identified.** Verified facts:
- The collapse is the exact `#623` shape the runbook describes: a multi-line source with `HEAD` intact,
  reported by git as ~0 added lines vs ~1,429 removed (`git diff --numstat -- src/broker.mjs` →
  `1  1429`).
- **The guard did not prevent it.** `refusalForWrite` (`src/seatguard.mjs`, the `0102f3c` refusal) exists,
  yet the file collapsed. A likely bypass is visible in the tree: an untracked `fix-broker.mjs` performs
  `fs.writeFileSync('src/broker.mjs', c)` — a raw Node write (not the guarded `write` tool) — and an
  untracked `src/borker.mjs.head` is a **UTF-16** copy (129 KB, 1,378 lines, char-spaced) whose name is a
  typo, the signature of a PowerShell `git show … > file` redirect. So at least one writer in this window
  used a non-guarded bulk-write path.
- UNVERIFIED: which process wrote the collapsed bytes (a seat's tool, a delegate-side scratch script, or
  a wedged-run write interrupted mid-flight). The wedge at `02:40:38Z` and the collapse at `02:40:19Z`
  are close enough that a run killed mid-write is plausible, but this is inference, not proof.

## Detection
Human/agent inspection only. The collapse is invisible until a file is opened or git is diffed; there
is no `status`/attention kind for it, and this one arrived through a write path the guard does not
cover.

## Resolution
**Not yet done — operator-only per the runbook.** Recover the file from its last-good revision:
```bash
git checkout -- src/broker.mjs        # OPERATOR ONLY (a seat cannot run checkout; the runbook says so)
# then verify: wc -l src/broker.mjs  -> 1429 ; node --check src/broker.mjs  -> clean
```
A non-operator recovery is: `git show HEAD:src/broker.mjs` and write that multi-line content back
through the guarded `write` tool (never a scratch script or redirect).

## Resolution — 2026-10-19T03:00Z (recovered)
Recovered non-destructively by the delegate, operator-directed: the collapsed working-tree copy was
saved to `.spike/delegate/broker.mjs.collapsed-backup-20261019`, then `HEAD`'s content was written back
(`git show HEAD:src/broker.mjs`), and the file was converted to CRLF so `git status` is clean under the
repo's `core.autocrlf=true`. **No `git checkout`/discard was used**; the `configure` WIP is preserved in
`stash@{0}`. Verified: 1,429 lines, `node --check` clean, `import` exports 38 names, `git diff --quiet`
exit 0. The connected wedge is a separate incident (`docs/incidents/2026-10-18-broker-retry-hotloop.md`).

## Prevention
- The `#623` guard is a *narrow refusal*, not a boundary; this incident is evidence it did not cover a
  `fs.writeFileSync`/PowerShell path. Route a guard-coverage item (does `refusalForWrite` see only the
  tool, and can a non-tool write be detected/blocked, or at least the collapse detected after the fact?).
- Add an attention kind or `check` rule for "a tracked `.mjs`/`.ts` source is a single line while
  `HEAD` is multi-line" — cheap, and would have surfaced this on the next pass.
- Do not leave raw-write scratch scripts (`fix-broker.mjs`) or redirect artifacts (`src/borker.mjs.head`)
  in the tree; they are the bypass path.

## Evidence
- `wc -c src/broker.mjs` = `62727`; `tr -cd '\n' | wc -c` = `0`; `tr -cd '\r' | wc -c` = `0`.
- `git diff --numstat -- src/broker.mjs` = `1  1429  src/broker.mjs`.
- `grep -c '"configure"' src/broker.mjs` = 0; `grep -c onlyReadIntents src/broker.mjs` = 0;
  `git show HEAD:src/broker.mjs | grep -c onlyReadIntents` = 2; `git show HEAD:src/broker.mjs | wc -l` = 1429.
- `stat src/broker.mjs` mtime `2026-10-18 21:40:19 -0500`.
- Untracked bypass artifacts: `fix-broker.mjs` (`fs.writeFileSync('src/broker.mjs', …)`),
  `src/borker.mjs.head` (UTF-16, typo).

## Recurrence — 2026-10-19T05:4xZ (UTF-16 re-encode, same file, same bypass artifacts)
Found during the operator's clock-out workspace check: `src/broker.mjs` was again unreadable — not a
one-line collapse this time but a **UTF-16LE re-encode** (`git diff --stat` = `Bin 68464 -> 128014
bytes`; `node --check` `SyntaxError: Invalid or unexpected token` with null-separated characters). Every
demo imports `src/broker.mjs`, so the whole suite went red (**18** failures, incl. `worktree`, `watch`,
`stop`, `starter`, `ui-readstate`); all pass again after recovery. The untracked `src/borker.mjs.head`
(UTF-16LE, CRLF, 129,468 bytes) and `fix-broker.mjs` were still present — the same bypass artifacts the
Prevention names, and the likely vector (a Windows `>`/`Set-Content` redirect emits UTF-16). Recovered
non-destructively per `write-corruption-recovery.md`: backed up to
`.spike/delegate/broker.mjs.utf16-backup-20261019`, wrote `HEAD`'s content back, converted to CRLF
(`node --check` clean, `git status --porcelain -- src/broker.mjs` empty, `demo/broker-read.test.mjs`
exit 0). Suite returned to the 3 WIP-caused failures (`land-helper`, `prepare-workspace`,
`worktree-reuse-deps`).

## Links
`docs/runbooks/write-corruption-recovery.md` (the #623 recovery; `git checkout --` is operator-only) ·
`docs/incidents/2026-10-18-broker-retry-hotloop.md` (the concurrent wedge) ·
`docs/incidents/2026-10-19-read-op-regression.md` (the follow-up: `main` cannot serve `read`) ·
`docs/incidents/2026-10-18-broker-dormant-stalled.md` (mentions the collapse guard) ·
`src/seatguard.mjs` (`refusalForWrite`).
