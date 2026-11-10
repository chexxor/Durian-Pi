---
runbook: store-secret-detected
symptom: "`status`/`watch` shows a `secret_detected` attention notice — a secret-shaped value is in the committed store"
writes: false
precondition: "read-only"
last_verified: 2026-11-10
verified_by: impl
evidence: "item #828; src/secretdetect.mjs; demo/secretdetect.test.mjs; env-name corrected to DURIG_DB (#5911, 2026-11-10, tree f192f543 - the CLI reads DURIG_DB: cli.mjs:155; only scripts/clockin.mjs:379 takes DURIAN_PI_DB); verify re-run: node demo/secretdetect.test.mjs exit 0"
check_rule: null
---

# A secret landed in the store (read-side detection)

## When to use
`node cli.mjs status` (or `watch`) shows an attention notice of kind `secret_detected`, naming a seat,
an entry id and a location inside that entry, e.g.:

```
alpha secret_detected   secret-shaped value in committed store content:
  entry #12 (pi.assistant) content[0].text@41 [openai-key]. The value is NOT shown here. …
```

This is a **detection** signal, not prevention: durian-pi cannot stop a secret from being written, because
the transcript writer lives inside pi-durable and intercepting it would make durian-pi a second writer on
the broker's store (an A1 violation). So durian-pi reads the committed entries and tells you WHERE a
secret-shaped value is — and never the value itself (a detection surface that echoed the secret would
*be* the leak). Same discipline as the config guard (`config-secret-refused`).

## Impact
The credential is now in the durable store and in anything that copied it (a backup, a shared DB, a
transcript dump). The notice does not tell you the value, so a reader cannot act on it by accident — but
it is also why the value must be treated as **compromised** the moment the notice appears: assume it has
already been read.

## Preconditions
Read-only. The Diagnose step only reads; it opens no writing harness.

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
```
Look for `"kind":"secret_detected"` in the `attention` array (and the matching `secretFindings`), which
name the seat, the entry id, the location inside the entry (`content[i].text` / `content[i].arguments`)
and the family (`openai-key`, `github-pat`, …). The value is deliberately absent.

## Do
1. **[judgement] Rotate the credential.** This is the only durable fix: detection cannot un-leak a
   value, and the value must be assumed read. Do this first.
2. **[judgement] Treat every copy as compromised** — the store, its backups, any transcript dump, any
   place the store was copied. Rotating is what makes those copies worthless; purging is hygiene.
3. Purge the value from the store **only after stopping the broker and confirming it exited** (single
   writer — see `broker-down-or-stalled`). There is currently **no durian-pi verb that deletes a store
   entry**; purging is an operator action (rebuild the store, or delete the offending entry out-of-band
   with the broker stopped). Name this as the current gap rather than pretending a verb exists.
4. Do not paste the value into any queue item, doc, or commit while handling the incident — the notice
   exists precisely so nobody has to.

## Verify
The detector the Diagnose step relies on fires on a secret and stays silent (and value-free) otherwise:
```bash
node demo/secretdetect.test.mjs
```
Expected: `PASS — secret detection verified` (exit 0). The demo asserts a committed secret raises a
`secret_detected` notice AND that the serialized notice surface contains neither secret value.

## If it fails
If the notice names a location you cannot reconcile with the entry (a rotated/compacted entry id), the
page is bounded (`SCAN_LIMIT`, `src/rigstory.mjs`), so an entry older than the page is not scanned — that
is a known blind spot, not a false positive. Escalate rather than guess.

## Escalate to
operator — to rotate the credential and to authorise the store purge (no deletion verb exists today).

## Evidence
Item #828 (lead #824 part b). Detector: `src/secretdetect.mjs`; wired into `src/readapi.mjs`
(`readRigHealth` → `secretFindings` + the `secret_detected` attention notice). Prove:
`node demo/secretdetect.test.mjs` (2026-10-16).

2026-10-19 — **FALSE-POSITIVE CLASS: a bare 40-character git SHA is classified `high-entropy-token`.**
`git rev-parse <ref>` and `git merge-tree --write-tree` print a full object id, and the
`high-entropy-token` pattern (`src/secretdetect.mjs:37`, duplicated at `src/secretredact.mjs:37`) matches
exactly that character class, so the tool result is replaced by the redaction marker and the seat cannot
read the id. Reproduced: `redactText('384913a82d191119ed7259bff9efa85967959279')` → marker; `'f450cdd'`
(short) → unchanged. Six occurrences in one `log scribe 12` window. **Before escalating a
`high-entropy-token` finding to the operator for ROTATION, check whether the value was a git object id** —
rotating a credential that was never a credential is a real cost. Workaround until the pattern is
narrowed: use `--short` ids in playbooks, or discard line 1 of a `--write-tree` result.
Record: `docs/incidents/2026-10-19-git-sha-redacted-as-secret.md`. **SUPERSEDED (position P-6,
2026-10-21): the blanket pure-hex skip this note implies is REFUTED.** The resolution-backed form
(docs/reviews/security-sha-exemption-position.md) exempts a bare 40/64-hex ONLY when `isGitObject`
confirms (`git cat-file -e <hex>^{object}`) and otherwise redacts/fires as today — FAILS CLOSED. Read the
position before treating a `high-entropy-token` finding over git output as a false positive; the check
still fires unless the value IS a git object id.

## Shipped: one git-object verdict, both surfaces (#3128)

The resolution-backed exemption above is now CODE, in `src/gitobject.mjs`, and BOTH surfaces consume it:
`secretSpans` (`src/secretredact.mjs`, the `afterTool` redactor) and `secretTokens` (`src/secretdetect.mjs`,
the read-side detector). Neither surface declares its own predicate any more — that was the drift: on this
tree, before the change, every commit id in every ref classified as secret-shaped in the redactor
(`git rev-list --all` → 2516 ids, 2516 matches) while the detector's exclusion lived in one module only.

What a seat sees now:
- a 40/64-hex that `git cat-file -e <id>^{object}` CONFIRMS is left alone — `git rev-parse HEAD`, the line-1
  output of `git merge-tree --write-tree`, and `evidence.artifact` pins all survive redaction;
- a 40/64-hex that does NOT resolve is still redacted, and the marker now names the class
  (`unconfirmed-object`) instead of a generic `high-entropy-token`, so the reader knows WHY the value went
  away and can re-read it through a ref name;
- probes are budgeted: `MAX_OBJECT_PROBES_PER_PASS = 64` distinct ids per tool result. Over the budget,
  nothing is exempted — the token is redacted. Unverifiable means redact, never pass.

**Verify (ran, exit 0):** `node demo/sha-object-verdict.test.mjs` — asserts the matrix (real ids survive,
planted non-objects still fire, `commit <random hex>` forged context does NOT exempt) and counts the
class on this tree: 0 of 2516 ref ids redact. `node demo/secretdetect.test.mjs` and
`node demo/secretredact.test.mjs` also exit 0.
