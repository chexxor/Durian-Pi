---
runbook: tool-result-redacted
symptom: "a tool result shows `[redacted by durig: secret-shaped value (…)]` where a value used to be"
writes: false
precondition: "read-only"
last_verified: 2026-10-16
verified_by: impl
evidence: "item #837; src/secretredact.mjs; demo/secretredact.test.mjs"
check_rule: null
---

# A tool result was redacted before commit

## When to use
A tool result in a transcript, the chat view or `log` shows a marker instead of the text a tool
produced:

```
DEEPINFRA_API_KEY=[redacted by durig: secret-shaped value (openai-key) from tool read (path=.env)]
```

The marker means the in-harness redaction extension (`src/secretredact.mjs`, registered as the
`afterTool` hook on the `durig.guard` extension) found a secret-shaped value in a tool result and
replaced it AT THE COMMIT BOUNDARY — before the result entry was written. The model, the transcript
and the store all saw the redacted text.

## Impact
The store is NOT carrying the value: this is a caught leak, not a live one. What still needs a human is
the SOURCE — the file or command the tool read from still holds a live credential — and any OTHER
channel the tool wrote to (its stderr, a second file, a terminal a person was watching) which durig
does not see. The redaction bounds the damage; it does not make the credential safe.

## Preconditions
Read-only. The Diagnose step only reads the store; it opens no writing harness.

## Diagnose (read-only)
1. Read the marker: it names the tool, a safe argument (the `path=`/`command=` that carries no secret)
   and the value's family (`openai-key`, `github-pat`, …). The value itself is deliberately absent.
2. Find the call in the transcript to see which file/command it was:
   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs log <seat>
   ```
3. Decide whether the value could have left the process by any channel the redaction does not cover
   (the tool's own stderr, a file it wrote, an operator's screen).

## Do
1. **[judgement] If the value could have escaped** (it was printed to a terminal, written elsewhere,
   or the source file is shared/committed), rotate the credential. The store is clean; the source and
   the other channels are not.
2. **[judgement] Treat the SOURCE as the problem**: fix or remove the file that made a tool read a
   secret, or narrow the tool/seat so it cannot read it again.
3. Do not paste the value anywhere while investigating — the marker exists so nobody has to.

## Verify
The redaction the Diagnose step relies on fires at the commit boundary and never echoes the value:
```bash
node demo/secretredact.test.mjs
```
Expected: `PASS — tool results are redacted before commit` (exit 0). The demo runs a real tool whose
result carries a secret on a real harness and asserts the COMMITTED transcript contains no value.

## If it fails
If a secret-shaped value appears in a COMMITTED entry with no marker, redaction did not fire for that
tool — check that the `durig.guard` extension is installed (cli.mjs `openHarness`) and that the entry
was not written by a path outside the harness. For a value that already reached the store, use
`store-secret-detected` (read-side detection, item #828). Known blind spots: a secret in a model's own
prose (not a tool result) is not redacted — that is detection #828's job; and the marker names WHERE
only when the tool's argument itself carries no secret.

## Escalate to
operator — the rotation decision, when the value may have escaped.

## Evidence
Item #837 (lead #832). Redaction: `src/secretredact.mjs`, registered as the `afterTool` hook on
`SeatGuard` (`src/seatguard.mjs`). Prove: `node demo/secretredact.test.mjs` (2026-10-16).
