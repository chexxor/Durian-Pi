---
incident: git-sha-redacted-as-secret
date: 2026-10-19
severity: sev2
status: open
symptom: "a tool result is replaced by `[redacted by durig: secret-shaped value (high-entropy-token) …]` and the 40-character git SHA / tree OID the command printed is gone"
runbook: store-secret-detected
fix: null
prevention: "exclude bare hex-object runs from the `high-entropy-token` pattern (src/secretdetect.mjs + src/secretredact.mjs) + a demo case; use `--short` in playbook commands until it lands"
last_reviewed: 2026-10-19
---

# A 40-character git SHA is classified as a secret and redacted

*Incident 2026-10-19; found while investigating the `scribe` worktree question
(`2026-10-19-terminal-worktree-mistaken-for-lost-work.md`). Reproduced deterministically by the delegate.*

## Summary

The read-side secret redactor replaces any token matching `high-entropy-token` with a marker, and that
pattern is:

```js
{ name: "high-entropy-token", re: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$/ }
```

A **bare 40-character git SHA-1** is exactly that: 40 chars, hex (letters a–f and digits), inside
`[A-Za-z0-9]`. So `git rev-parse <ref>` and `git merge-tree --write-tree` — whose first output line **is**
a full object id — have their output replaced by the redaction marker. The seat (and the delegate) then
cannot read the very identifier the landing playbook tells them to compare.

Reproduction (delegate, `main = 8e4f987`):

```
node -e "import('./src/secretredact.mjs').then(m=>console.log(m.redactText('384913a82d191119ed7259bff9efa85967959279',{name:'git'})))"
→ [redacted by durig: secret-shaped value (high-entropy-token) from tool git]
```
while a 7-character short SHA (`f450cdd`) and ordinary prose pass through untouched. Observed live in the
`scribe` transcript: **6** occurrences of the marker in one `log scribe 12` window, one of them replacing
the whole first line of a `git merge-tree --write-tree … | Select-Object -First 6` probe — i.e. the tree
OID that probe existed to obtain.

## Timeline

- `2026-10-19 ~21:5xZ` — `scribe`, doing the `#3047` D113 pre-check, runs
  `git merge-tree --write-tree --name-only main fd4c233 …` and friends. The transcript records
  `"[redacted by durig: secret-shaped value (high-entropy-token) from tool powershell (command=…)]"`
  in place of the first output line; the rest of the output (`docs/DECISIONS.md`, the `CONFLICT` line)
  survives.
- Same window: **6** redaction markers in `log scribe 12`. Every affected call is a `git` call that prints
  a **full** object id.
- The delegate reproduces it in one line (above) while auditing the worktree question, and confirms the
  short form is unaffected.

## Impact

- **A seat is blinded on the exact datum the landing procedure is built on.** `land.md` /
  `BRANCH-AND-WORKTREE-LIFECYCLE.md` §5 gate *"the tip matches the landing list"* by comparing a branch
  tip to a pinned sha. If `git rev-parse <branch>` is redacted, gate 2 cannot be evaluated from the tool
  output at all — the seat must infer it indirectly (`--short`, or a `git log --oneline` line).
- **It degrades *honesty*, not just convenience.** A seat that cannot read its tool result has two bad
  options: proceed on assumption, or stall. `scribe` did the honest thing (it said it would not assert what
  it could not retrieve) — but the runbook's P1 honesty rule then converts a tooling defect into lost turns.
- **It creates phantom security work.** The marker says "secret-shaped value … treat as compromised", and
  the runbook for that notice (`store-secret-detected.md`) says **rotate the credential**. A redaction
  notice that fires on a git SHA can therefore send an operator to rotate a credential that was never a
  credential. *(UNVERIFIED for the specific earlier `#119203` `high-entropy-token` finding — that one may
  have been genuine; the whole `secretFindings` array is empty as of this session. Recorded as a risk of
  the same pattern, not as a claim about that finding.)*
- **It is silent and looks intentional.** The marker is well-formed and names a family, so nothing in the
  transcript says "this was a false positive".

## Root cause

**The `high-entropy-token` pattern has no exclusion for hex-only / git-object runs.** It was written to
catch base64-ish credentials (`40+` chars, mixed letters and digits) and a SHA-1 is a member of that
character class by construction. The pattern is duplicated in two modules
(`src/secretdetect.mjs:37` **and** `src/secretredact.mjs:37`), so any fix must land in both or the two
definitions "drift" — the module header even says *"'Secret-shaped' must have ONE definition across
durig."*

Contributing factor: the redaction is applied to **tool call results**, which for a coding agent are
mostly *code and git output* — a population where 40-hex tokens are routine, not rare.

## Detection

**Not detected.** There is no attention kind, no counter, and no log line saying "N tool results were
redacted this pass" that would let a reader notice a false-positive cluster. It was found by reading a
seat's transcript while investigating an unrelated question.

## Resolution

**No repair yet — workaround only.** Do **not** weaken or remove redaction as a stop-gap: it is a real
control and the store does carry transcripts. Until the pattern is fixed:

- **Use short ids in playbooks and probes.** `git rev-parse --short <ref>` is unaffected (7 chars), as is
  `git log --oneline -1 <ref>`. Gate 2 of the landing pass can be evaluated entirely on short ids; the
  full sha is not needed to compare a tip to a pin when the pin can be compared short-vs-short.
- **Do not pipe a bare full oid into prose.** `git merge-tree --write-tree` prints the tree id alone on
  line 1; discard line 1 (`| tail -n +2`) or add `--name-only` and read only the file list, as `scribe`'s
  probe did — the file list and the `CONFLICT` line survive.
- **Treat a `high-entropy-token` marker over git output as a false positive** — check whether the source
  command prints a full object id before escalating it to the operator as a credential.

## Prevention

1. **Narrow the pattern** in **both** `src/secretdetect.mjs` and `src/secretredact.mjs`: a bare
   `/^[0-9a-fA-F]{40}$/` (and `/^[0-9a-fA-F]{64}$/`) must **not** classify as `high-entropy-token` — a hex
   run of a git-object length carries no entropy beyond its alphabet, and a 40/64 hex string is an object
   id far more often than a credential. Keep the mixed-alphabet pattern for everything else (it must still
   catch `sk-…`, base64 blobs, etc.).
2. **A failing-first demo** (`demo/secret-redact.test.mjs` or the existing `secretdetect` demo): a 40-hex
   sha and a 64-hex sha redact to themselves; a real base64 token still redacts; `sk-…` still redacts.
   Both module copies must be asserted, or the duplication re-introduces the drift.
3. **A count, not silence:** if a redaction fires, the pass summary should say how many values were
   redacted and by which family, so a false-positive cluster is visible without reading transcripts.
4. **Route the pattern change as a `security` item** (`security` owns `security-positions`; this is a
   trust-boundary change, not a cosmetic one — the risk of a narrowed pattern must be argued, not assumed).

## Evidence

- `src/secretredact.mjs:37` and `src/secretdetect.mjs:37` — the identical `high-entropy-token` regex.
- `src/secretredact.mjs:96-113` (`secretSpans` candidate rule: a run with no whitespace/quotes/brackets,
  `=`/`:` not a boundary) and `:118` (`redactionMarker`).
- Live transcript: `node cli.mjs log scribe 12` — 6 × `redacted by durig: secret-shaped value
  (high-entropy-token) from tool powershell …`; one replacing the first line of a
  `git merge-tree --write-tree main fd4c233` probe.
- Delegate reproduction at `main = 8e4f987`:
  `redactText('384913a82d191119ed7259bff9efa85967959279', {name:'git'})` → marker;
  `redactText('f450cdd', {})` → unchanged.
- `docs/runbooks/store-secret-detected.md` — the "rotate the credential" instruction this marker triggers.

## Links

- `src/secretredact.mjs`, `src/secretdetect.mjs`, `demo/secretdetect.test.mjs`
- `docs/runbooks/store-secret-detected.md`
- `docs/incidents/2026-10-19-terminal-worktree-mistaken-for-lost-work.md` (found while investigating that)
- `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md` §5 (the tip-vs-pin gate this blinds)
