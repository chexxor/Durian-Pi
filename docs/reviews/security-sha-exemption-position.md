# Security position — exempting git object names from the redaction guard (#4391)

- **Date:** 2026-10-19 · **Owner:** seat `security` · **For:** item #4391 (a position; NOT the build, NOT
  the release of #3128, NOT the broader secret-shape work) · **Ruling context:** lead #2040 = (A) "the
  CHECKER is the final discriminator for ANY 40/64-hex" (#2624); lead #1660 shipped the checker for the
  DETECT side (commit `069f26e`, items #1620/#1712). This doc supersedes **R-2 only** of
  `docs/reviews/security-secret-shape-narrow-position.md` (@b9dfd61 interim): the blanket pure-hex skip
  is NOT the answer; the parity form below is what any release of #3128 may carry.

## Scope

Two consumers of the ONE secret-shape verdict (`looksLikeSecret`: `src/config.mjs` export, imported by
both modules):

- **Redaction** — `src/secretredact.mjs` `afterTool`, fired inside the harness at the
  `hook(ToolTask,…)` seam so the redacted result is what the model, transcript and store keep.
- **Detection** — `src/secretdetect.mjs` `secretTokens` → `secretFindings` + the `secret_detected`
  attention notice, scanning COMMITTED entries.

The commit-time diff gate (`src/seatguard.mjs`, prefix families only per the #1317 comment block in
`src/config.mjs`) is NOT in scope: a sha in a diff is ordinary there, and that gate's FN-over-FP posture
is already written down and stays.

## The shipped state — the exemption ALREADY exists, asymmetrically

Lead #1660's checker landed on the DETECT side only (`069f26e`, 2026-10-17): `HEX_OBJECT_RE` +
`GIT_HASH_CONTEXT_RE`/`GIT_HASH_PAIR_RE` + `isGitObject` (`git cat-file -e <hex>^{object}`, per-`(cwd,
hex)` memo, fail-safe). Exclusion semantics: a 40/64-hex token is NOT a secret iff it sits in a git-hash
context AND confirms as a real object; probe failure ⇒ still fires. Live probe (exit 0, this worktree,
HEAD = `da0155…`):

| Token | detect (`secretTokens`) | redact (`redactText`) |
|---|---|---|
| `HEAD=<real sha>` | `[]` — correctly exempt | **redacted** — the shipped control never reached this surface |
| bare `<real sha>` | **fires** (no context word) | **redacted** |
| bare `<random hex>` | fires (fail-safe) | redacted (fail-safe) |

So #4391's instance is anatomically the REDACTION side missing a control the rig already SHIPPED — plus
the one gap BOTH sides share: a **bare, context-less, resolvable** object id (the `git rev-parse` /
`merge-tree --write-tree` line-1 shape, and the `--is-ancestor <sha> main` verdict value a verifier must
be able to quote) fires and redacts today. It is also why #2623 exists (held defect: "#1658's exclusion
does not cover the incident's own shapes") and why production reshaped itself around the FP:
`src/worktree.mjs:313` and `src/seattools.mjs:50` shorten shas to 9 chars *because* a full sha "would be
swallowed out of the very message that has to say which commit it means"; `demo/prepare-workspace-*.test.mjs`
assert their own outputs carry no bare 40-hex; `docs/runbooks/land.md` enforces `--short`.

## Q1 — is a git object name safe to exempt?

**The name is.** Content-addressed, published with every commit, carries no payload, path or credential,
and is the primary key of every `--is-ancestor`/`git show` claim this queue's landing protocol runs on.
Redacting it protects nothing and blinds exactly the evidence a verifier is required to produce.

**The shape is not — and only RESOLUTION can tell them apart.** "This hex is an object name" is provable
by one mechanism: `git cat-file -e <hex>^{object}` against a git DB we own. That probe is fail-safe by
construction (spawn failure, non-repo, no-such-object ⇒ "still a candidate secret"), small (only 40/64-hex
tokens are probed), and memoized. Against an ADVERSARIAL planting the probe is preimage-hard: to pass
exemption, a chosen secret string would have to BE the SHA-1/SHA-256 of an existing object — the attacker
cannot settle the digest and keep the string (same argument recorded at the #1620/#1712 landing and in
@b9dfd61's #2039 note). So: exempt names, claimed by **context + confirmed resolution**, never by
alphabet.

## Q2 — blanket pure-hex skip vs the position-aware form

**Blanket pure-hex skip (R-2 as carried in #3128) — recommend AGAINST.** Three grounds, each checkable:

1. **It is strictly weaker than the shipped control.** #1658 exempts a hex token only after CONTEXT + a
   confirming probe, and its own demo asserts the boundary the blanket skip would erase: "a bare
   non-object 40-hex still fires". A blanket skip would exempt what the shipped fail-safe direction
   deliberately does not.
2. **It manufactures cross-surface drift.** The same token must render the same verdict on both
   consumers: today `HEAD=<real sha>` is exempt on detection and redacted on redaction (drift, live);
   a blanket redaction skip would produce the opposite divergence — a bare random hex that REDACTION
   dutifully leaves in the store while DETECTION later raises `secret_detected` for that same committed
   content — a notice whose token is sitting unredacted in the very store the notice watches. That is the
   "ONE definition across durig" failure the incident named, now enforced by two different predicates.
3. **It buys nothing extra.** The FP relief it claims over the parity form is only the context-less
   UNRESOLVABLE case — the accepted residual below — paid for by writing off every pure-hex credential
   shape (Q3).

**The narrow POSITION-AWARE form (context forms alone: `git show <hex>`, `--is-ancestor <hex> main`,
`commit <hex>`) — necessary but insufficient.** Without the probe it exempts a FORGED context by shape
evidence alone — the guarantee it needs is exactly the preimage-backed check; and it does not cover the incident's own master shapes —
bare command-output lines carry no context word at all.

**The answer: reach parity of the shipped #1658 exclusion onto the REDACTION path, and extend it by
resolution to the bare line.** Everything already shipped on detection becomes the one shared verdict;
redaction stops eating confirmed object names; the one NEW falsifiable control is
resolution-backed-bare-line (fixes `rev-parse`/`merge-tree` outputs and #4391's comparator). Fail-closed
everywhere a probe says "unconfirmed".

## Q3 — the residual risk, stated plainly

- **False-negative class retained (the point of the checker):** a real secret that is pure 40/64-hex
  still redacts UNLESS it resolves as an object. To exempt it would need our git DB to contain an object
  with that id — preimage-feasible only by committing to OUR repo with the attacker's chosen digest, not
  by knowing a hash. Context-less random hex keeps firing/redacting (canary exists on both sides).
- **Accepted false-positive residual:** foreign-repo / unresolvable shas quoted in prose, docs or queue
  items still redact; an unresolvable hex in a tool result still redacts. That is the FP the blanket skip
  would have bought relief for — accepted as residual because its frequency is lower, cheap workarounds
  exist today (`--short`), and P2 prefers false negatives to false positives on a heuristic.
- **Priced not at all, and only interim-covered:** the credential surface remains an UNVERIFIED area
  (`docs/CODEMODE.md`, `docs/BROKER-SUPERVISION.md`); the exclusion is therefore resolution-grounded
  rather than likelihood-grounded, which is what makes it acceptable rather than lucky.
- **Performance surface of the probe:** `spawnSync git cat-file` per candidate hex — memoized, and MUST
  be budget-bounded per side effect (harvest distinct candidates, cap probes per call, over-budget ⇒
  fail-closed redact) so a pathological `cat-file --batch-all-objects`-shaped output cannot turn a tool
  call into a probe storm. Demo must pin the bound.

## Ratified shape (what #3128 may release; does not adjudicate sequencing)

- **P-1 ONE verdict:** hoist the echo-exclusion (`HEX_OBJECT_RE`, `GIT_HASH_CONTEXT_RE`,
  `GIT_HASH_PAIR_RE`, `isGitObject`) into the shared definition site (the `config.mjs` export cluster)
  and consume it from BOTH `secretdetect` and `secretredact`; no surface-local copy. Demo asserts the two
  entry points byte-agree per fixture.
- **P-2 parity semantics on redaction:** context + confirmed object ⇒ pass; anything else redacts,
  escape-free, fail-safe on probe failure — matching the shipped detection canaries verbatim.
- **P-3 bare-resolution extension (new control):** a bare context-less 40/64-hex token passes iff
  `isGitObject` confirms; otherwise redacts/fires as today. This is the fix for every instance observed
  to date (merge-tree line 1, `rev-parse` output, #4391's comparator shas).
- **P-4 the probe budget:** per-result candidate harvest + memo + a named cap; over-budget is REDACT, not
  pass.
- **P-5 the count (R-4 of @b9dfd61) still ships:** per-pass redaction/exemption counters by family —
  a skip-caused FN and a residual FP cluster are otherwise invisible in silence.
- **P-6 docs truth-up on landing:** the open incident's Prevention §1 ("a bare 40-hex … must NOT
  classify as high-entropy-token") and the `store-secret-detected.md` false-positive-class note predate
  #1658 and must be amended to the resolution-backed semantics, or the durable record will still advise
  the blanket skip.
- **P-7 route #2623 as the carrier:** the held defect item names the same gap ("does not cover the
  incident's own shapes") — land the P-3 extension with it rather than minting a third item for one
  predicate.

## Gates (hold on the release of #3128, not on this position)

- **G1** P-1 lands with or before any exemption change; per-surface predicates re-arm the drift.
- **G2** failing-first demo: the probe matrix above (`HEAD=real` / bare real / bare random) asserting
  BOTH surfaces, plus still-redacts fixtures (prose-embedded, JSON string, `KEY=` RHS, mixed alphabet,
  `sk-`/`ghp_` families).
- **G3** P-4's budget bound asserted with a heavy-fixture demo.
- **G4** the expiry logic of @b9dfd61 R-6 is SATISFIED by P-2/P-3 rather than superseded: any future
  change preserving the probe requirement needs no new expiry; a proposal REMOVING resolution from the
  verdict is a new trust-boundary decision and comes back through this seat.
- **G5** the diff gate is untouched (prefix-only per #1317), and `#3296`'s keep-gate semantics are
  unaffected (this position does not cancel, release or rebase anything).

## Citations

`src/secretdetect.mjs` (exclusion block: context regexes, `isGitObject`, memo, fail-safe note; demo
canaries "bare non-object STILL FIRES" / "confirmed object excludes" in `demo/secretdetect.test.mjs`);
`src/secretredact.mjs` (no echo exclusion; `secretSpans`/`afterTool`); `src/config.mjs` (shared
`SECRET_VALUE_PATTERNS` + #1317 posture comment); commit `069f26e` (#1658, detect-side only, lead
#1660); `docs/incidents/2026-10-19-git-sha-redacted-as-secret.md` (instance 1; Prevention §1 to amend);
#4391 item text (instance 2); `src/worktree.mjs:313`, `src/seattools.mjs:50`, `docs/runbooks/land.md`,
`demo/prepare-workspace-base.test.mjs:84`, `demo/prepare-workspace-create-base.test.mjs:87`
(workarounds); `docs/runbooks/store-secret-detected.md` (rotate step + FP-class note); the three live
probes in this doc (exit 0, `redactText`/`secretTokens`); prior position
`docs/reviews/security-secret-shape-narrow-position.md` @b9dfd61 (R-1..R-6; R-2 superseded here); held
items #2623 (the same-gap defect), #3128 (the build), #3296 (the keep-gate).
