---
runbook: null
position: security-evidence-tree-verdict
symptom: "evidence must name a tree by sha, and the redactor destroys every sha the rig writes"
writes: false
precondition: "read-only probes; the ruling routes adoption to pm/impl"
last_verified: 2026-11-09
verified_by: security
evidence: "#5976: 2581 shas, 2581 detected, 2581 redacted (pre-fix). #6014, on main in worktree item-6014 @09a94b4c: 2721 confirmed ids over the 64 cap -> 2721 detect + 2721 redact; 10 ids -> 0 + 0; 40-hex non-object -> 0 detect / 1 redact; pi pin id does not resolve (cat-file exit 128) and renders as `unconfirmed-object`."
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

## Addendum (#6014) — the read-back surface, the probe budget, and foreign-repo ids

`src/gitobject.mjs` is now on main and is consumed by both secret surfaces (`src/secretdetect.mjs:86`, `src/secretredact.mjs:75`). The verdict is correct where it is wired; the open questions are *where else it must be wired* and *what it does when it cannot probe*.

### Measured on main in this worktree (counts only)

| Input | detect | redact | reading |
|---|---|---|---|
| 2721 real commit ids in one text (over the 64-candidate cap) | 2721 | 2721 | every confirmed object is still flagged/destroyed |
| 10 real commit ids | 0 | 0 | parity achieved |
| 40-hex that is not an object | 0 | 1 | surfaces disagree on the non-object class |
| the pi pin id in `pi-main.pin.json` | — | redacted as `unconfirmed-object` | foreign-repo ids do not resolve here (`git cat-file -e <id>^{object}` exit 128) |

### Ruling 1 — the item-body read path is the same verdict, a different wiring site

The verdict classifies **text**, so every surface that emits text to a seat must call `objectExemptor`: `cli.mjs show <id>`, `queue`, `status`, the chat/TUI view, and the trace sink (`src/providers/trace.mjs` calls `secretSpans` and inherits the verdict transitively). It must not invent a rule, and it must not be reduced to "the afterTool hook already covers it": the hook covers *tool results*, not the row the store holds.

Two facts must be separated, and qa's `#5978` should assert both rather than one:

- **Stored**: the queue row's body, as written at enqueue, contains the id.
- **Rendered**: `cli.mjs show <id>` still shows it.

A body that is stored intact and rendered redacted is a display bug. A body mangled *at enqueue* is a store-integrity bug and the worse of the two, because the verifier can never recover the id from any view. Probe that can fail: enqueue an item whose body names a commit id from `git rev-list --all`, then read the raw row and the rendered row and compare. If the raw row lacks the id, the wiring belongs at the enqueue path, not the render path.

### Ruling 2 — the 64-candidate budget is the real bite, and it is exploitable

`MAX_OBJECT_PROBES_PER_PASS = 64` counts distinct candidates and, over the cap, exempts nothing. That is fail-closed in the credential direction, but measured above it destroys **2721 confirmed objects at once**, which is the same evidence-integrity failure the verdict exists to remove, just via a different door. A `git log` of 65 lines, a landing report of 70 patch ids, or `git rev-list --all` all lose every id.

It is also a concealment path with a named exploit: a seat that wants its tool output to lose a specific commit reference pads it with 63 other ids and the whole set redacts. Severity: medium — no credential is exposed, but the history a claim rests on is unrecoverable from the transcript.

Fix, concrete and falsifiable: replace one spawn per id with **one** `git cat-file --batch-check` fed all candidate ids on stdin. Cost is then bounded by a single subprocess, so the cap can rise (256+) without a pathological spawn count. Probe that fails today and passes after: a 200-id corpus of confirmed objects must exempt all 200, and the number of git spawns must be 1.

### Ruling 3 — do not key the exemption on repo provenance

"Which repository may exempt an id" is a new trust boundary, and the probe's answer already depends on `cwd`, which the seat controls. A provenance-keyed exemption would make the exemption attacker-widenable. Keep the classifier narrow: **this repo only**.

Foreign ids belong to the *evidence semantics*, not the classifier: an upstream pi pin is not a tree the rig can verify, so it should be declared, not probed — a checked-in, reviewable set of expected ids (the pin file's own value), exempted as a literal allowlist of exactly those ids. Falsifiable pair: the declared pin id survives rendering; an arbitrary foreign 40-hex not in that set still redacts. Interim, low-cost and safe: the marker already names the class `unconfirmed-object`; make it name the *source* (the file or field the id came from) so a reader can recover it from the ref instead of the transcript.

### Residual blind spot to state, not fix here

The read-side detector's shape table requires letters **and** digits (`(?=.*[A-Za-z])(?=.*\d)`), so a pure-hex credential is invisible to detection (measured: 0 findings for a 40-hex non-object) while the redactor would have destroyed it before commit. That is coherent for content written after #3128 — redaction happens before the entry exists — but content already in the store from before it is unscanned for that class. Any claim of "the store has no credential-shaped content" must therefore name the class it can actually see.

## Citations

- `src/secretdetect.mjs` — `isGitObject`, `isGitObjectEcho`, `GIT_HASH_CONTEXT_RE`, `GIT_HASH_PAIR_RE`.
- `src/secretredact.mjs` — `secretSpans`, `redactText`, `afterTool`; no git-object check.
- `demo/secretredact.test.mjs` — passes (exit 0) with no git-object case, which is why the drift survived.
- Related items: #3128 (held, deferred to a human), #5357 (E-2 evidence validation), #5379 (object type), #4147/#4153/#4157 (artifact names the tree), #1657/#1713 (sha echoes read as secret_detected), #5243/#5365/#5366 (RM-295 credential values).
