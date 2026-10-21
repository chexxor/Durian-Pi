# Security position — narrowing the `high-entropy-token` pattern (interim), checker remains final state

- **Date:** 2026-10-19 · **Owner:** seat `security` · **For:** item #3122 (sev2; routes to impl) · **Ruling context:** lead #2038 = (A) checker-as-discriminator; this is the INTERIM half of that ruling, not its replacement.
- **Surface:** the shared secret-`looksLikeSecret` verdict used by `src/secretdetect.mjs:37` and `src/secretredact.mjs:37` (identical `high-entropy-token` regex, `/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$/`), and the tool-result redaction path it feeds (`src/seatguard.mjs` afterTool hook).
- **Incident (grounds this note):** `docs/incidents/2026-10-19-git-sha-redacted-as-secret.md` — 6 false
  `high-entropy-token` redactions in one `log scribe 12` window; one ate the tree OID of a live
  `git merge-tree --write-tree` probe; blinds landing gate 2 (tip-vs-pin, full-sha compare) and points the
  `store-secret-detected` runbook at "rotate the credential" for object ids that were never credentials.
  This seat hit the same class live twice on 2026-10-19 (merge-tree / worktree pre-flights redacted in-tool).

## Risk argument for the narrow (what it writes off, and why it is defensible NOW)

**What the narrow removes from detection:** any token that is EXACTLY 40 or 64 chars of pure hex (the
git-sha1/sha256 shape) is no longer classified `high-entropy-token`. That writes off the class
"pure-hex 40/64-character credential" — e.g. an HMAC or legacy password hash printed raw in tool output.

**Exploit path:** such a credential leaks through a tool result, is stored in transcripts, is read by
other seats via `edges`, and is never flagged because its shape is a git-object id's shape. That path is
real but requires a provider credential of EXACTLY that shape. durig's known credential families
(`sk-…`, `hf_…`, `ghp_…`, `AIza…` — the prefix patterns at both module sites) carry alphabetic
prefixes/punctuation and remain fully covered; the prefix rule set is untouched by the narrow. That is why
the residual is LOW-lihood today — and it is a RESIDUAL, not a zero, so the narrow expires.

**What the narrow buys immediately (the realized sev2):** unblinding the landing gate
(`land.md` §5 gate: tip matches pin — currently unsatisfiable when a full oid is printed), removing the
phantom-rotation pressure (the runbook's rotate instruction fired on object ids), and ending the
honesty tax (a seat that cannot read its tool result stalls or asserts what it cannot see).

**Why the narrow must be a SKIP PREDICATE inside the one shared verdict, not a second regex edit:**
the duplication of the pattern into two modules is the root-cause amplifier the incident names. One
definition means the eventual checker lands in one place too, and no site can half-apply it. `#2039`'s
gate-ordering lesson (context-first regex shadowing a later discriminator) applies here: a per-table
regex edit in one module and a different predicate in the other is exactly how those two
drift-apart verdicts re-arm.

## Ratified shape (for impl to implement; does NOT adjudicate its sequencing)

- **R-1 — ONE definition:** `src/secretdetect.mjs` exports the pattern table + `looksLikeSecret` (the
  "shared export takes over" note at `secretredact.mjs:30` is finished — `secretredact` imports instead
  of duplicating). Demo asserts the two module entry points have byte-identical verdict tables.
- **R-2 — interim skip:** inside the shared `looksLikeSecret`, a trimmed pure-hex run of exactly 40 or 64
  chars is NOT `high-entropy-token` (prefix families and every other shape redact as today — the
  incident's warning stands: do not weaken redaction generally).
- **R-3 — failing-first demo:** 40-hex and 64-hex bare ids pass through UNREDACTED by both entry points;
  `sk-…`, base64 blob, `ghp_…` still redact; a fail-open slice proves the skip predicate runs inside the
  shared verdict (both modules agree on each fixture).
- **R-4 — visibility:** each pass summary counts redactions by family (a per-pass counter the lab can
  read without opening transcripts) — a false-positive cluster becomes observable.
- **R-5 — runbook honesty note:** `docs/runbooks/store-secret-detected.md` gains the interim line:
  before escalating to rotation, check whether the source command prints bare object ids
  (`git rev-parse`, `merge-tree --write-tree`, `rev-list`, `hash-object`) — a 40/64 pure-hex SHA over git
  output is a false positive until the checker lands.
- **R-6 — expiry clause (binding):** the interim skip is superseded by the CHECKER (lead ruling A):
  40/64-hex redacts again UNLESS it resolves as an object of the rig's bare store or the repo's own
  `.git` (resolvable ids — sha1 of real objects — pass through; unresolvable pure hex redacts). One
  implementation, one cache, one demo extension: seeded temp bare-store fixture object → pass;
  random hex → still redacts. The checker item carries the 71448/71454 fixtures and this incident's
  merge-tree OID as its binding cases, and it KEEPS R-4's counter.

## Non-goals

Not the commit-gate/staged-diff scan (`#1755` pin), not the secretredact demotion of prefix families,
not a general relaxation of `high-entropy-token`, and not an OS-level claim — the credential surface
stays an unverified area (`docs/CODEMODE.md`, `docs/BROKER-SUPERVISION.md`), which is exactly why the
pure-hex residual must carry an expiry instead of an assumption.

## Citations

`src/secretdetect.mjs:37`, `src/secretredact.mjs:37` (+ `:30` shared-export note, `:96–113`, `:118`);
`docs/incidents/2026-10-19-git-sha-redacted-as-secret.md`; `docs/runbooks/store-secret-detected.md`;
`docs/reviews/agent-governance-toolkit-review.md` ASI03 row (credential egress); lead ruling #2038 (A);
this seat's #2039 input (preimage analysis: a CHOSEN secret cannot be name-plant-covered under the
checker — object-name resolution is the discriminator, not a string-class guess).
