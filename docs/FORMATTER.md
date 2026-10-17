# App-level syntax formatter — tool choice, pin, and normalize plan

**Item:** ROADMAP 90 (devtools half: tool choice + pin + normalize plan; impl owns the `format` verb).
**Status:** tool chosen and pinned; config landed; whole-tree normalize PLANNED, NOT RUN (stop-the-world, gated — see Sequencing).

## Tool choice

**Prettier 3.9.10** — chosen over Biome/dprint, on grounds verified in code:

| | Prettier | Biome |
|---|---|---|
| Runtime deps | **zero** (`npm view prettier@3.9.10 dependencies` → empty) | ships 8 platform-native binaries as optionalDependencies |
| Native binary | **none** (pure JS) | yes (per-platform) |
| Install scripts | **none** | none |
| `--check` gate | yes, exits non-zero | yes |

Why Prettier: the repo deliberately has **zero devDependencies** and "no build, no lint". Prettier adds
exactly ONE dependency with no transitive deps and no native artifact, so the minimalism survives; it is
identical on every platform (the design constraint "must not depend on a Windows-only mechanism" holds);
and its `--check`/`--write` semantics match the acceptance exactly.

## Pin (recorded)

`package.json` → `devDependencies`:
```json
"prettier": "3.9.10"
```
Exact (no caret), so the version cannot drift. `package-lock.json` pins `node_modules/prettier` at
3.9.10. Installed with `npm install --save-dev --save-exact prettier@3.9.10` (exit 0; "added 1 package" —
confirms zero transitive deps). No install scripts, so this host's `allowScripts` block does not apply.

## Config (the fixed format)

`.prettierrc.json`:
```json
{
  "useTabs": true,
  "tabWidth": 2,
  "printWidth": 100,
  "endOfLine": "lf"
}
```
Grounds: `useTabs` matches the **28-of-35** tab-dominant source files (minimizes normalize churn);
everything else is Prettier's default, and the default **double quotes** match the existing census
(4137 double vs 342 single); `printWidth: 100` tracks the code's observed width (p95 = 92). `endOfLine:
"lf"` is the setting that stops EOL churn — see the open coordination note below.

## Normalize plan (PLANNED — do not run ahead of the gate)

Read-only census (`npx prettier --check "src/**/*.mjs" "*.mjs" "demo/**/*.mjs"`, no writes):
**137 of 138 files have code-style issues** — the normalize touches essentially the whole tree, as the
item predicted.

Plan when the gate clears:
1. Confirm the tree is QUIET and the #885 `cli.mjs` gate has landed (see Sequencing).
2. `npx prettier --write` over the explicit tracked source set (never `git add -A`; explicit paths).
3. Run the full `demo/*.test.mjs` loop + `node --check` as the regression gate.
4. Commit the normalize as its OWN concern (it is a whitespace/EOL-only diff), explicit paths.

## Sequencing (binding)

- AFTER the **#885** `cli.mjs` landing (the #624 `cmdInit` artifact) and when the shared tree is quiet —
  the normalize rewrites nearly every file and MUST NOT collide with in-flight uncommitted work.
- NOT an automatic on-write formatter: formatting between a seat's read and its edit makes the
  exact-match `oldText` stale and the edit misses (design constraint, binding).
- NOT a global git pre-commit hook: a hook rewrites files outside the staged set, violating
  explicit-paths-only and touching the shared tree (design constraint, binding).

## Open decisions / coordination

- **Indentation (tabs vs 2-space) is a repo-wide style call.** `useTabs: true` is the low-churn
  recommendation (matches the 28-file majority), but it is a one-line flip if the team prefers 2-space.
  Flagged for pm/operator ratification.
- **EOL stance** (`endOfLine: "lf"` + `core.autocrlf=true` + no `.gitattributes`) is entangled with
  impl's line-ending items **#766** and **#916** and DOGFOOD **F32** / ROADMAP **#328**. A
  `.gitattributes` (`* text=auto eol=lf`) is the complementary half and should be landed with those
  items, not unilaterally here.
- **Seat-facing runbook** (`format your changed files before commit`) should land WITH impl's `format`
  verb, so it documents a command that exists.

## Evidence

- `npx prettier --version` → 3.9.10 (exit 0).
- `npx prettier --find-config-path cli.mjs` → `.prettierrc.json` (config is picked up).
- `npx prettier --check …` → "Code style issues found in 137 files" (read-only; no writes).
- No auto-hook added; no file formatted; pin recorded.

## Verification run (this item)

Changed files: `package.json`, `package-lock.json`, `.prettierrc.json`, `docs/FORMATTER.md` — no `.mjs`
changed, so `node --check` has nothing to apply to (both JSON files validated with `JSON.parse`, exit 0).

Full `demo/*.test.mjs` loop: **94/97 exit 0**. The 3 failures (`commit-model`, `seat-commit-instructions`,
`starter`) are a **pre-existing, committed** drift unrelated to this item: `constitution.txt` (committed)
contains the "P3 Runbooks" clause but `rig.starter.json`'s `constitutionInline`
(committed, clean) do not — the tests compare the two and fail with "the inline constitution has drifted
from constitution.txt — regenerate the starter". Both compared files are clean in git, so the failures
reproduce at HEAD regardless of this change; they trace to commit `fe0c74c` (P3 Runbooks) landing without
a rig regenerate. None of the 3 tests reference prettier.
