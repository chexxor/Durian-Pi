---
runbook: store-secret-detected
symptom: "`status`/`watch` shows a `secret_detected` attention notice — a secret-shaped value is in the committed store"
writes: false
precondition: "read-only"
last_verified: 2026-10-16
verified_by: impl
evidence: "item #828; src/secretdetect.mjs; demo/secretdetect.test.mjs"
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
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status
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
