---
runbook: null
position: security-evidence-tree-verdict
symptom: "evidence must name a tree by sha, and the redactor destroys every sha the rig writes"
writes: false
precondition: "read-only probes; the ruling routes adoption to pm/impl"
last_verified: 2026-11-09
verified_by: security
evidence: "item #5976 probe, item-5976 worktree @429f2b5a: 2581 shas from `git rev-list --all`, 2581 detected, 2581 redacted; `node demo/secretdetect.test.mjs` exit 0, `node demo/secretredact.test.mjs` exit 0"
check_rule: null
---

# Security position: one git-object verdict, and a field-level carve-out for evidence

## Scope

Two surfaces decide whether a 40-hex token is a secret:

- **detect** — `src/secretdetect.mjs`: `secretTokens()` / `scanEntriesForSecrets()` / `secretNotices()`, run on COMMITTED entries, raises `secret_detected` attention.
- **redact** — `src/secretredact.mjs`: `secretSpans()` / `redactText()` / `afterTool()`, run at the pi-durable `afterTool` commit boundary, so the value never enters the store.

Both carry their own verbatim copy of `SECRET_VALUE_PATTERNS`. Only detect consults `isGitObject`. That is the whole collision.

## Measured, on the tree named above (counts only, no values)

| Case | detect | redact | survives redaction |
|---|---|---|---|
| bare sha in prose (`the tip is <40hex>`) | 1 | 1 | no |
| `HEAD=<40hex>` | 0 | 1 | no |
| 7-char short sha | 0 | 0 | yes |
| `sk-…` credential canary | 1 | 1 | no |
| pure-hex 40, NOT a git object | 1 | 0 | yes |

`git rev-list --all` → **2581 shas, 2581 confirmed by `git cat-file -e <sha>^{object}`; detect 2581, redact 2581.** Every sha in the repo is classified secret-shaped by both surfaces. The last row is where the two surfaces *disagree in the other direction*: detect exempts nothing there (correct, it is not an object) while redact leaves it — the drift pm reported as 40 redact spans vs 40 detect findings.

Re-run:

```bash
node -e 'import {secretTokens} from "./src/secretdetect.mjs"; import {secretSpans} from "./src/secretredact.mjs";
const s=require("node:child_process").spawnSync("git",["rev-list","--all"]).stdout.toString().trim().split("\n");
console.log(s.length, s.reduce((a,h)=>a+secretTokens(h).length,0), s.reduce((a,h)=>a+secretSpans(h).length,0));'
node demo/secretdetect.test.mjs   # exit 0
node demo/secretredact.test.mjs   # exit 0
```

Note the second measurement is self-demonstrating: in this session `git rev-parse HEAD` printed `[redacted by durig: …]` while `git rev-parse --short HEAD` printed `429f2b5a`. The rig asks for a full sha and cannot carry one.

## Threat model

| Threat | Control (proposed) | Falsification probe |
|---|---|---|
| Evidence integrity: a `DONE` claim names an artifact tree that no verifier can resolve because the sha was redacted at commit | Verdict shared between detect and redact; `evidence.artifact` validated by the same oracle at `complete_work` time | Feed a real commit sha through `afterTool`; assert the sha is still present in the committed entry. Today it is not. |
| A seat reports "green" against a tree it never ran (unverifiable green) | Artifact must name the object TYPE (commit vs blob/tree/tag), not merely "an object" | `git cat-file -e <blob>^{object}` succeeds for a blob — a blob pin must fail a tree-pin assertion. |
| False "store compromised" alarms: hundreds of `secret_detected` notices from sha echoes, seats told to rotate credentials that were never leaked (precedent: #1657, #1713) | Probe-confirmed exemption, not pattern-based | Count notices over the sha corpus: 2581 today, 0 after the verdict. |
| Over-exemption: a genuine 40-hex credential is waved through because it looks hex | Objecthood is *confirmed by probe*, never inferred from shape | `a…a` (40 hex, not an object) must still fire. It does. |
| Probe unavailable (no git, no repo, spawn failure) silently exempts | Fail closed: unconfirmed objecthood means the token still fires | Stub a probe returning false; the token fires. Covered by `demo/secretdetect.test.mjs`. |

Residual, stated plainly: a credential whose value happens to equal an object hash present in this repo would be exempted. That requires constructing content whose sha equals the secret; the probability is negligible and the value would already be published in the repo. Not worth a control.

## Ruling (the three questions pm asked)

**1. Which surfaces, and in what order.** One exported verdict in `src/secretdetect.mjs` —
`secretVerdict(token, {cwd}) → {secret: bool, family, gitObject: bool}` — consumed in this order:

1. **redact** (`secretredact.mjs`) first. It runs at the commit boundary; once content is committed with the sha destroyed, detection can never recover it. A divergence where detect exempts and redact destroys is the worst direction, because the store becomes silently lossy while the detector reports clean.
2. **detect** (`secretdetect.mjs`) second, calling the same verdict.
3. **render/queue export** third — anything that prints an item body, a completion result, or a status detail.
4. **`complete_work` evidence validation** last, reusing the oracle it already plans to use (#5357 E-2), so the field is checked against git rather than pattern-matched.

`git grep -l isGitObject -- src/ demo/` currently returns only `src/secretdetect.mjs` and `demo/secretdetect.test.mjs`: the verdict exists in one place but is consumed by one surface. That is the contradiction, and it is fixable only by making the other surfaces consume it.

**2. Is the probe-confirmed exemption sufficient?** For classification, yes — and it is the right control, because objecthood is confirmable while "looks like hex" is not. Two things are additionally required:

- **Drop the prose-context requirement.** `GIT_HASH_CONTEXT_RE` demands a git word before the hash, so a bare sha in a sentence is judged as a value on its own — that is why 2581/2581 shas fire on the detect side. A confirmed object is a git object regardless of the words around it. Keep the pair form (`HEAD=<sha>`) and keep fail-closed on probe failure.
- **A field-level carve-out is still needed.** Redaction works on tool-result *text*; it cannot protect a structured field. So the evidence-tree rule cannot be satisfied by a prose exemption: `evidence.artifact` must be validated as data (does this object exist, is it a commit, is it an ancestor of the tree the claim is about) and exempted from text redaction because it is never prose. Without that, `land.md:618-622` telling seats to "use --short ids" remains, as I said when I registered it, compensation for a missing control.

**3. The detect/redact drift** is not a separate defect — it is the direct consequence of two independent pattern lists and one orphaned oracle. It belongs to the shared verdict. The gate is an assertion that the two surfaces return the same verdict for the same input, on a corpus that includes real shas, a real `sk-` canary, and a pure-hex non-object.

## Non-goals

- No new credential surface: no tokens, no OS identity, no authentication layer. (Attribution remains zero-widening, per #3966.)
- No wider allowlist. "Pure hex" is not a class; only probe-confirmed objecthood is.
- No change to the store write path. The broker owns the store (A1); this is read-side plus the sanctioned `afterTool` seam.
- Not this position: the build sequencing. pm mints the rows.

## Gates — what must hold before the code lands

- **G1** One verdict function, one definition of secret-shaped. A second `SECRET_VALUE_PATTERNS` literal is a gate failure.
- **G2** Exemption by confirmed objecthood, never by shape.
- **G3** Fail closed: probe unavailable or false → the token fires.
- **G4** A demo asserting parity between detect and redact on the sha corpus, with the `sk-` canary still redacted and the 40-hex non-object still detected.
- **G5** `evidence.artifact` names the object type, and a non-commit object cannot satisfy a tree pin (#5379).
- **G6** The demo suite runs on the **merged** tree, not the branch tip — a parity test that passes only on a tip proves nothing about main.

## Citations

- `src/secretdetect.mjs` — `isGitObject`, `isGitObjectEcho`, `GIT_HASH_CONTEXT_RE`, `GIT_HASH_PAIR_RE`.
- `src/secretredact.mjs` — `secretSpans`, `redactText`, `afterTool`; no git-object check.
- `demo/secretredact.test.mjs` — passes (exit 0) with no git-object case, which is why the drift survived.
- Related items: #3128 (held, deferred to a human), #5357 (E-2 evidence validation), #5379 (object type), #4147/#4153/#4157 (artifact names the tree), #1657/#1713 (sha echoes read as secret_detected), #5243/#5365/#5366 (RM-295 credential values).
