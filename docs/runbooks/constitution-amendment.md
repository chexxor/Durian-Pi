---
runbook: constitution-amendment
symptom: "you edited (or are about to edit) constitution.txt; or the 3 constitution-mirror demos fail their 'starter constitutionInline === constitution.txt' assertion"
writes: false
precondition: "read-only"
last_verified: 2026-10-28
verified_by: delegate
evidence: "#1257 (runbook authored); #1287 (Verify run 2026-10-17: all 3 constitution-mirror demos exit 0 on main); the #976/#977 class; recurrence fa4b22f (D90 P3 Runbooks) -> main RED, fixed by b52133f; delegate Verify 2026-10-28 (Linux): the P2 Work protocol amendment landed, all 3 mirror demos exit 0, and `check` caught the THIRD copy — `constitution-not-applied` reported store 2693 bytes vs rig file 3643 until `up` ran"
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
store (`writes: false`). **That is true only through step 3.** The seats read the constitution from a THIRD copy — a
`durig.constitution` document in the **store** (`src/rig.mjs:618` registers the `durig-constitution` prompt section
that returns that document's text; `cli.mjs:392` installs the Router extension that carries it for every seat) — so an
amendment is not in anyone's system prompt until a **writing verb** runs: `DURIG_DB=<store> node cli.mjs up <rig>`
re-applies it (`cli.mjs:726` writes the doc whenever the spec declares a constitution). Confirm no broker is live
before that step (`node tools/broker-serve.mjs --status`; single-writer rule in
`docs/runbooks/broker-down-or-stalled.md`). If the drift predates your change and `main` is already RED, raise that as its
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
   `rig.starter.json`'s `constitutionInline` to the exact amended text of `constitution.txt` (JSON-escaped).
   Do it with `node tools/mirror-constitution.mjs` (delegate instrument, added 2026-10-28; productization is ROADMAP
   **212**), **not** by hand and **never** by re-serializing the whole file: the starter's literal escapes apostrophes
   as `\u0027`, so the plain `JSON.stringify` form of that value is not in the file — a substring swap built from it
   misses, while a whole-file rewrite turns a one-line amendment into a 300-line diff. The instrument locates the value
   span, proves the span round-trips to the parsed value, re-escapes in the style the file already uses, re-parses, and
   writes only if the result equals `constitution.txt` (`inline 2693 -> 3643 chars; only the value span changed: true`).
   `--check` reports drift without writing. Never land a `constitution.txt` change with a stale starter inline copy.
3. Run the three constitution-mirror demos; all three must exit 0:
   ```bash
   node demo/starter.test.mjs
   node demo/commit-model.test.mjs
   node demo/seat-commit-instructions.test.mjs
   ```
4. **Apply it to the store the seats actually run on** (a writing verb — see Preconditions). Preview read-only, then
   apply:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --dry-run   # -> "constitution": {"changed": true}
   DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json             # writes the durig.constitution doc
   ```
   A rig that SOURCES the file (`rig.selfdev.json` → `"constitution": "constitution.txt"`) needs no inline edit; a rig
   carrying an inline copy needs both step 2 and this step.
5. Land `constitution.txt` and `rig.starter.json` together as one change, explicit paths only
   (commit discipline per P2 Authority).

## Verify
The three demos above exit 0, **and** the store agrees with the file:
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json   # constitution-missing, constitution-not-applied both pass
```
That is the gate — the demos are the evidence, not a summary of it. The `check` pair is what proves the seats will
receive the text; the demos alone only prove the on-disk copies agree.

## If it fails
- A demo fails the "`constitutionInline` === `constitution.txt`" assertion → the inline copy drifted;
  regenerate it (step 2) and rerun.
- `check` reports `constitution-not-applied` → file and starter agree but the **store** does not; run step 4.
  Measured 2026-10-28 before applying: `store holds 2693 bytes starting "# Rig constitution…"; the rig file has 3643 …`,
  and the finding's own `fix` line names the exact `up` command.
- `check` reports `text-integrity … [no-trailing-newline] rig.starter.json` right after your edit → almost never yours.
  The rule scans files that differ from HEAD (`src/textintegrity.mjs:trackedChangedPaths`), so it surfaces a latent
  defect in a blob months older than your change (`git show HEAD:rig.starter.json | tail -c 12` → `"\n}`, no final
  0x0a). Add the missing byte inside your change — the gate will not go green otherwise — and say so in the commit
  message. The standing class is ROADMAP **211**; `node tools/text-integrity-scan.mjs` reads the whole tracked tree at
  HEAD without needing a dirty working tree (2026-10-28: 42 files with faults — 31 `no-trailing-newline`, 11 `bom`).
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
  `node demo/seat-commit-instructions.test.mjs` all exit 0 (main `6c384ac`).
- **Verify ran 2026-10-28 (delegate, Linux `Alex-Desktop-Win10`, node v24.22.1):** the operator-instructed
  `P2 Work protocol` amendment landed through this procedure. `node tools/mirror-constitution.mjs` re-mirrored
  `rig.starter.json` (2,693 → 3,643 chars, value span only, file 9,803 → 10,755 bytes); the three mirror demos exit 0;
  `check rig.selfdev.json` went from `constitution-not-applied` **error** (store 2,693 bytes vs file 3,643) to both
  constitution rules **pass** after `up rig.selfdev.json`; and reading the store document the way
  `demo/constitution.test.mjs` does (`findDocument({kind:"durig.constitution", scope:{kind:"session"}})`) returns 3,643
  chars with `P2 Work protocol` present. Two failure modes found on the way are written into "If it fails" above and
  registered as ROADMAP 211/212. `last_verified: 2026-10-28`.
