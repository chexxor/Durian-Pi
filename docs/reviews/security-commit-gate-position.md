> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# SECURITY POSITION — the commit-time secret gate (#700 scanner as pre-flight)

**Status: position by the `security` seat, item #1368, 2026-10-17. Ratifies/corrects impl's #1317
landed gate; the artifacts under review are `53f6049` (#700 cherry-pick: `src/config.mjs` +
`demo/secrets.test.mjs`) and `6400e8e` (the gate: `src/seatguard.mjs` +
`demo/commit-secrets.test.mjs` + `src/config.mjs` exports). Shape per
`docs/runbooks/security-trust-boundary-review.md` (#1322). Per-item artifact; no standing
security-doc set (lead #1297). Not a verification — qa verifies; this seat positions.

**Grounding (lines read this session, object ids cited):** `6400e8e:src/config.mjs` L56–61
(`SECRET_PREFIX_PATTERNS`: `^sk-[A-Za-z0-9_-]{16,}$`, `^hf_[A-Za-z0-9]{16,}$`,
`^ghp_[A-Za-z0-9]{20,}$`, `^AIza[0-9A-Za-z_-]{20,}$`); `53f6049:src/config.mjs` L48–54
(`SECRET_VALUE_PATTERNS` = prefixes + the 40+ entropy rule); `6400e8e:src/seatguard.mjs` L174–216
(`GIT_COMMIT_RE`, `TOKEN_RE = /[A-Za-z0-9_+=\-]{16,}/g`, `secretOffendersInDiff`, `stagedDiff`
(`diff --cached` + `-a/--all` via `diff HEAD`), the refusal text at L221–225, the silent
`catch { return null }` at L214–216); demo asserts a 40-hex sha is not refused (per impl #1367).

## Scope

A seat's own `git commit` (also the `git -C <root>` form) is intercepted before execution; its
staged content (index, and the worktree for `-a/--all`) is scanned with `--unified=0`; each ADDED
line's 16+-char tokens are tested against the provider-prefix set; on hit the commit is refused with
file names and **never the value** (a durable read must not carry the secret). The boundary: the
last automated look at content before it becomes portable history. Posture (from #1300): the value
is burned the instant it is committed; the gate's job is to make the common case fail LOUDLY at the
moment, not to guarantee detection.

## Threat model and posture ruling

| Threat | Ruling | Falsification probe |
|---|---|---|
| **T-scan** A secret-shaped value in plain prose evades the tokenizer (aliases, spaced hex, split lines). | FALSE NEGATIVE accepted by design — the prefix set is a precision-first first look, not a guarantee; review-tier scans (leaked-secret's table) and the read-side tier (#828) carry recall. | `commit-secrets.test.mjs` keeps asserting ordinary-not-refused (40-hex sha); a NEW probe asserts each gate-covered class IS refused when staged (G-A probe). |
| **T-fp** A pattern refuses ordinary content → commit outage (impl's standing bar, cited from the gate's own comment L168–172). | The entropy rule is correctly EXCLUDED from the commit gate — it fires on hashes/ids/base64 ordinary in diffs. Precision bar for any gate addition: the pattern must not match content ordinary in THIS tree's diffs. | Demo asserts: 40-hex sha, and any newly-added pattern's ordinary-content witness, are NOT refused. |
| **T-silent** The gate's `catch { return null }` (L214–216) is a SILENT fail-open: `git` diff errors (fsmonitor, diff-driver, encoding) other than "git missing/no HEAD" disable scanning with zero signal. | CORRECTED below (C2): fail-open stays, but it must be loud. | A demo probe corrupts the diff invocation and asserts the warning is printed and the commit is allowed ONLY with the warning (G-B probe). |
| **T-gap** Classes in the leaked-secret table (AKIA, xox, PEM block, JWT) are NOT gate-covered — the runbook's table can read as a promise the gate does not deliver. | RULED below (C3): the table becomes the two-tier REGISTRY; the gate takes the high-precision subset; review keeps the superset. | The runbook's table carries the gate/review column; the demo probes the added classes (G-A/G-C). |

## Corrections

### C1 — prefix-only posture: RATIFIED, with the two-tier registry as the standing shape
The commit gate carries only high-precision, low-false-positive classes; recall lives in the review
tier (the leaked-secret table, human-triaged) — matching my posture rule (prefer the false negative)
and the reason the entropy rule stays out of the gate. The runbook's class table is NOT narrowed —
it is RE-DIMENSIONED: each row gains a "commit gate" column (enforced / review-only), so the table
documents what the gate delivers and what only review delivers. Table promises more than the gate
delivers ONLY if the column is missing (fix: the column).

### C2 — fail-open on git error: RATIFIED AS LOUD-SILENCE-REMOVED
The fail-open is defensible at THIS enforcement point only because the commit requires the same
`git` whose failure opens the gate: if `git` cannot run, the commit cannot land either, so an
unscanned commit via that path is already impossible (the gate is advisory beside the real gate,
git's own exit). But the current `catch { return null }` is silent — the precedent in the same
file (L44–47, cwd snapshot) prints `SEATGUARD WARNING: …` on the same shape of degraded service.
Required: the gate's degraded-run is warned on stderr with the error MESSAGE only (never diff
content, never a token), and the demo asserts warning-on-failed-scan (G-B). Standing generalization
for any future enforcement point whose channel does NOT require the failing tooling (e.g., a
broker-side merge/receive hook scanning content the broker itself assembles): there the same gate
MUST fail closed — record that as its position requirement before such a hook lands (ties to the
codemode audit sink posture: post-incident forensics reads even what failed to run).

### C3 — the gap: EXTEND the gate's prefix set with the runbook's open classes (minus JWT initially), and re-dimension the table
Gate additions (each satisfies the T-fp precision bar for ordinary dev content; all anchored to
full tokens as TOKEN_RE extracts them):
- `AKIA[A-Z0-9]{16}` (AWS access key id — uppercase-only body; a 40-hex sha is lowercase, still not a hit)
- `xox[abprs]-[A-Za-z0-9-]{10,}` (Slack)
- `gho_[A-Za-z0-9]{20,}` and `github_pat_[A-Za-z0-9_]{22,}` (GitHub's other token families; `ghp_` already covered)
- `AIza` is already covered (Google)
- PEM private-key header as a SEPARATE raw-line pass, not a token pattern: the tokenizer cannot
  catch it. `TOKEN_RE` breaks the header at spaces (`-----BEGIN`, `RSA`, `PRIVATE`, `KEY-----` are
  each < 16 chars or dash-truncated), so a token-anchored PEM regex tests only what never arrives.
  Required: a per-ADDED-LINE regex `/^-----BEGIN [A-Z ]*PRIVATE KEY-----$/` (trim-aware) applied to
  the same `+ lines` loop, keeping the refusal's name-file-not-value contract.
- JWT: kept **review-only initially** — `eyJ`-anchored tokens are precise, but sample JWTs are
  ordinary fixture content in many repos' tests; until a probe can name THIS repo's fixture
  behavior, the gate does not take the class. Revisit
  with the fixtures witness (add to demo on adoption).

## Non-goals
- Not a recall guarantee: aliases, split-token, encoded, and non-provider-private-key classes pass
  (T-scan); the review tier and read-side detection carry them (#828, leaked-secret Diagnose).
- Not a decision about `SECRET_VALUE_PATTERNS`' entropy rule placement — it is correctly scoped to
  config-FILE values (full tokens by construction; no tokenizer ambiguity; #700's contract).
- Not the broker-side envelope (landing pass, push) — the push guard is the operator grant;
  a receive-side scan is a NEW boundary needing its own position (C2's generalization clause).

## Gates for the impl follow-up (all offline, all falsifiable)
1. **G-A (prefix set):** C3's additions land in `SECRET_PREFIX_PATTERNS` + the PEM line pass in the
   gate; demo asserts each new class IS refused and the 40-hex sha is STILL not refused.
2. **G-B (loud fail-open):** stderr `SEATGUARD WARNING` on scan failure naming the failure kind only;
   demo asserts the warning and that no diff content or token is printed.
3. **G-C (registry):** `leaked-secret.md` table gains the "commit gate: enforced/review-only" column
   matching what actually lands; the method runbook keeps linking it as the single home.
4. **G-D (no-silent-anything):** the demo asserts the refusal text and the warning text print no
   token — the never-echo contract holds on both paths.

## Residual risk (named)
- **Split/concat secrets pass the gate — ACCEPTED residual (qa #1366 falsification).** A provider
  key reconstructed across string concatenation, a line break, or successive commits is invisible
  to a per-token shape: qa's probe `const k = "sk-" + "Ab3dEf6h" + "9x…"` commits with **no
  offender** (each fragment fails TOKEN_RE's 16+ or the anchored prefix test). This is impl's
  DELIBERATE precision-first trade, documented in-code (6400e8e gate comment L168–172); impl is
  NOT changing code for it. Severity LOW; the mitigation sits with the REVIEWER, not the gate:
  review-tier scans (the leaked-secret Diagnose and the trust-boundary-review method) must eyeball
  concatenation and reassembly of key-shaped values in diffs. Recorded **review-only** in the G-C
  column when #1381 lands.
- Split/sealed/encoded secrets and non-provider key material (SSH ed25519 blob bodies, age keys)
  pass the gate — accepted false-negative tier (T-scan); rotation discipline (leaked-secret Do) is
  the backstop, not the gate.
- Fail-open remains fail-open: a diff-API failure that still lets a commit through scans nothing
  (C2 makes it loud, not closed). At ANY future non-git-dependent enforcement point this flips to
  fail-closed by C2's generalization clause.
- JWT (and any provider-prefix list) is a moving boundary: prefixes are added as classes are
  witnessed, not as a claim of completeness.

## Falsification record (qa #1366) — confirmed sound, do not re-litigate
For the same artifacts (`53f6049`, `6400e8e`), qa confirmed: a secret under a **non-key filename**
is blocked; `-a`/`--all` staged content IS scanned via `git diff HEAD`; **no false positives** on a
40-hex sha, an ordinary Windows path, or a 24-char alnum token; the refusal text carries
`{path}` only and **never the value**; fail-open on git failure **returns null** (gate does not
block). The last one confirms the CURRENT blocking behavior and is consistent with C2's analysis
(the commit requires the same git); the LOUD-WARNING correction (C2/G-B) remains separately open
with impl, unchanged by this record.

## Routing
Impl follow-up (G-A/G-B/G-D + the PEM line pass): route to impl (pm). G-C is MY follow-up (the
table column) and I will take it when G-A lands so the column matches reality. Adoption/scope:
lead/pm (I do not adjudicate). New positions required BEFORE: any broker-side receive hook
(C2), any credential exercise surface (codemode Q3 stance stands).

## Citations
- Impl delivery: #1367 (artifacts 53f6049, 6400e8e; flags: prefix-only, fail-open, the gap).
- My finding + runbook: #1315/#1300 (docs/runbooks/leaked-secret.md — the class table being
  re-dimensioned in G-C).
- Method/probes shape: docs/runbooks/security-trust-boundary-review.md (#1322); two-layer denial
  precedent: ROADMAP 32.
- The SC boundary the gate runs inside: src/confine.mjs (SC1–SC3, SECRET_NAME env deny);
  describeConfig's set/unset print — the three wired layers around this one.
