---
runbook: constitution-amendment
symptom: "you edited (or are about to edit) constitution.txt; or the 3 constitution-mirror demos fail their 'starter constitutionInline === constitution.txt' assertion"
writes: false
precondition: "read-only"
last_verified: 2026-10-21
verified_by: scribe
evidence: "#1257 (runbook authored); #1287 (Verify run 2026-10-17: all 3 constitution-mirror demos exit 0 on main); the #976/#977 class; recurrence fa4b22f (D90 P3 Runbooks) -> main RED, fixed by b52133f"
check_rule: null
---

# Amend the constitution (and keep the starter mirror true)

## When to use
You are changing `constitution.txt` (any amendment), or you landed / are about to land a change and
`demo/starter.test.mjs`, `demo/commit-model.test.mjs` or `demo/seat-commit-instructions.test.mjs` fail
their "starter `constitutionInline` === `constitution.txt`" assertion.

## Impact
`rig.starter.json` carries the constitution **inline** (`constitutionInline`) so the starter is
self-contained — `init` scaffolds `rig.json` from it and a fresh directory has no `constitution.txt`
(see commit `3eac452`, #976), so the inline copy is a genuine copy that can drift, not a reference.
The three constitution-mirror demos are the gate that catches the drift. An amendment that updates
`constitution.txt` but **not** the starter's inline copy turns `main` RED (the whole demo suite is the
oracle; a red `main` blocks landing). This has recurred — #976, then again when the D90 `P3 Runbooks`
amendment (`fa4b22f`) landed without regenerating the starter (main went RED; fixed by `b52133f`). A
starter that ships a stale constitution is worse than no starter: it teaches the wrong constitution
confidently.

## Preconditions
You have the `constitution.txt` amendment drafted. The broker does **not** need to be stopped: this
procedure edits a tracked file and runs the read-only demo suite; it opens no `Harness` and writes no
store (`writes: false`). If the drift predates your change and `main` is already RED, raise that as its
own item first (this class: #1258) — do not hide a pre-existing red inside your amendment.

## Diagnose (read-only)
Run the three constitution-mirror demos and see which fail:

```bash
node demo/starter.test.mjs
node demo/commit-model.test.mjs
node demo/seat-commit-instructions.test.mjs
```

Each asserts EOL-insensitive equality between `rig.starter.json` `constitutionInline` and
`constitution.txt` (starter.test.mjs; commit-model.test.mjs; seat-commit-instructions.test.mjs). The
comparison is EOL-insensitive on purpose (#977/D83), so a failure is a **content** difference, never a
line-ending one.

## Do
1. Edit `constitution.txt` with your amendment.
2. **Regenerate the starter's inline copy IN THE SAME CHANGE** (mandatory): set
   `rig.starter.json`'s `constitutionInline` to the exact amended text of `constitution.txt`
   (JSON-escaped). There is no script for this yet; edit the JSON field directly, then let the demos
   prove the match. Never land a `constitution.txt` change with a stale starter inline copy.
3. Run the three constitution-mirror demos; all three must exit 0:
   ```bash
   node demo/starter.test.mjs
   node demo/commit-model.test.mjs
   node demo/seat-commit-instructions.test.mjs
   ```
4. Land `constitution.txt` and `rig.starter.json` together as one change, explicit paths only
   (commit discipline per P2 Authority).

## Verify
All three demos above exit 0. That is the gate — the demos are the evidence, not a summary of it.

## If it fails
- A demo fails the "`constitutionInline` === `constitution.txt`" assertion → the inline copy drifted;
  regenerate it (step 2) and rerun.
- The failure is a pre-existing drift, not yours (main was already RED before your amendment) →
  do not fold it into your change; raise/keep the main-red item (#1258 class) so the re-sync lands and
  is verified separately.

## Escalate to
- `impl` — owns the starter re-sync when `main` is RED from a drift that predates your amendment
  (#1256/#1258 class), and `qa` verifies it (#1266).

## Evidence
- `3eac452` (#976): the inline copy must stay because `init` scaffolds from it; re-synced.
- `4339d42` (#977): the three mirror assertions became EOL-insensitive.
- `fa4b22f` (D90 P3 Runbooks): amended `constitution.txt` WITHOUT regenerating the starter → main RED
  (the recurrence this runbook exists to prevent).
- `b52133f` (main): re-synced `rig.starter.json`'s `constitutionInline` to `constitution.txt`,
  returning the 3 constitution-mirror demos to green.
- **Verify ran 2026-10-17 (#1287):** `node demo/starter.test.mjs`, `node demo/commit-model.test.mjs`,
  `node demo/seat-commit-instructions.test.mjs` all exit 0 (main `6c384ac`). `last_verified: 2026-10-17`.
