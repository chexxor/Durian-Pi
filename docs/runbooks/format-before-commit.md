---
runbook: format-before-commit
symptom: "my diff shows whitespace or line-ending churn I did not intend"
writes: false
precondition: "read-only"
last_verified: 2026-11-04
verified_by: impl
evidence: "#934 (the `format` verb + demo/format.test.mjs), #933 (prettier 3.9.10 pin + .prettierrc.json); #5049 re-ran `node demo/format.test.mjs` (exit 0) and measured the CR population: 20 of 763 tracked files carry CR bytes, `src/attention.mjs` the only one under `src/` (475 at main), and `format --check` reports touched and untouched files alike as `unformatted`"
check_rule: null
---

# Format your changed files before commit

## When to use
A diff carries whitespace or line-ending churn you did not intend, or you are about to
commit and want your change formatted with the repo's fixed style first. Run it AFTER
your edits and BEFORE `git add` / commit. (This is a seat workflow; the operator-facing
surface is the same command.)

## Impact
Doing nothing: EOL / whitespace noise leaks into diffs, and an exact-match `oldText`
edit can miss because the file on disk is CRLF while the `oldText` you read is LF
(DOGFOOD F32 / #328 / #291). The whole-tree normalize is **not** this procedure — it is
a separate, gated, stop-the-world change (docs/FORMATTER.md, "Sequencing").

## Preconditions
None on the store: `format` opens no harness and reads/writes no store, so it is safe to
run while the broker is live (D11). It needs the pinned prettier devDependency installed
(`npm ci`).

## Diagnose (read-only)
```bash
node cli.mjs format --check -- <the files you changed>
```
Non-zero exit with `"unformatted" > 0` means those files are not formatted. `--check`
writes nothing.

## Do
1. Name the files you changed explicitly (no glob, no default tree walk).
2. ```bash
   node cli.mjs format -- <file1> <file2> ...
   ```
   This rewrites ONLY those paths with prettier 3.9.10 + `.prettierrc.json`.
3. `git add` the SAME explicit paths, then commit (one concern per commit).

## Verify
```bash
node demo/format.test.mjs                                  # exit 0
node cli.mjs format --check -- <a file you just formatted> # exit 0, "unformatted": 0
```
`format --check` is the gate to keep beside `node --check`: it exits non-zero on an
unformatted file. NOTE: run it on files you have formatted — the repo is deliberately
NOT normalized yet (137/138 files carry style issues; the normalize is gated on an
operator-declared quiet window), so a tree-wide `format --check` is expected to fail and
is NOT the gate today.

## If it fails
- A changed file carries CR bytes → `tools/what-to-test.mjs` (the derived-suite selector the operator's
  `scripts/land.mjs --changed-suite` uses) reports `BYTE SCAN FAIL … control byte 0x0d` for **every line** of that
  file, sets `ok:false`, and the derived suite refuses — the change is forced onto the FULL GATE. Measured
  2026-11-04 (over 764 tracked files, binary extensions excluded): 20 carry CR bytes, and **`src/attention.mjs` is the only one in `src/`** (475 CRs
  at `main`; every other source file I touched had 0). Do NOT "fix" it by formatting one file inside an unrelated
  item: `.prettierrc.json` sets `endOfLine: "lf"`, so `node cli.mjs format -- src/attention.mjs` rewrites all ~511
  lines and buries the change's real diff in line-ending churn. Normalizing it is a FORMATTER.md-gated call for the
  operator (the tree-wide normalize is deliberately deferred; `format --check` reports essentially every file,
  touched or not, as `unformatted`). Report the CR file and let the operator schedule the normalize.
- `format needs the pinned prettier devDependency` → run `npm ci`.
- A file still reports `unformatted` after `format` → it is outside the checkout, so
  prettier found no `.prettierrc.json`; run the verb from inside the repo.
- Do NOT start the whole-tree normalize from here; it needs an operator-declared quiet
  window (docs/FORMATTER.md "Sequencing").

## Escalate to
`devtools` for the tool choice / pin / config; the operator for the whole-tree normalize
window.

## Evidence
#934 (the `format [--check] [-- <paths>]` verb + `demo/format.test.mjs`) and #933
(prettier 3.9.10 + `.prettierrc.json`). Verify last ran 2026-10-16.
