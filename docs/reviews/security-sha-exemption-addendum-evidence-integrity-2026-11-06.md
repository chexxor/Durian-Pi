# Security addendum — the unshipped sha exemption now damages EVIDENCE, not just output noise

- **Date:** 2026-11-06 · **Owner:** seat `security` · **For:** item **#4922** (a position + a re-measurement; NOT the build, NOT a release decision).
- **Extends, does not replace:** `docs/reviews/security-sha-exemption-position.md` (P-1…P-7, G1…G5, 2026-10-19, item #4391). That position is still correct and **still unbuilt**; this addendum adds (a) a re-measurement on today's tree, (b) a damage class it did not cover — **queue row bodies and the `complete_work` evidence field** — and (c) two controls (E-1, E-2) for that class.
- **Supersedes nothing.** `docs/reviews/security-secret-shape-narrow-position.md` R-2 stays superseded (no blanket pure-hex skip). Direction is unchanged from lead **#2040 ruling A**: the **checker is the final discriminator for any 40/64-hex** — *not* a wider allowlist.

## Scope

One concern: what the **redaction** surface (`src/secretredact.mjs` `afterTool`, which rewrites a tool result before pi-durable commits it) does to a **git object name**, and what that costs a seat that must *act on* or *cite* that name. The credential-detection surface (`src/secretdetect.mjs`) and the commit-diff gate (`src/seatguard.mjs`, prefix families only, #1317) are referenced, not re-litigated.

## Measured state today (main `46c28b73`, Linux, `@earendil-works/pi-durable 1.3.0` from the lockfile; exit 0 on all three)

Re-runnable, verbatim:

```
git rev-list --all | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=d.trim().split("\n").filter(Boolean);const re=/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+_=-]{40,}$/;console.log("total",r.length,"classified-secret-shaped",r.filter(x=>re.test(x)).length)})'
node --input-type=module -e 'import {secretSpans} from "./src/secretredact.mjs"; import {secretTokens} from "./src/secretdetect.mjs"; import {spawnSync} from "node:child_process"; const t=spawnSync("git",["log","--format=%H %s","-40"],{encoding:"utf8"}).stdout; console.log("redact spans",secretSpans(t).length,"| detect findings",secretTokens(t).length)'
git grep -l isGitObject -- src/ demo/
```

| Measurement | Result 2026-11-06 | Reading |
|---|---|---|
| Commit ids in all refs vs ids the redactor classifies `high-entropy-token` | **2386 / 2386 (100%)** | Not a heuristic collision: **every** full object name this repo has ever made is secret-shaped to the redactor. |
| `git log --format=%H %s` (40 lines) through `secretSpans` | **40 spans** → 40 injected markers | One tool call, one destroyed column. |
| The same text through `secretTokens` (detector) | **39 findings** | The 2026-10-19 context gate (`GIT_HASH_CONTEXT_RE` requires a prose word before the hex) **misses the output-column shape** — so the notice stream is still ~97% object ids. #2623's held complaint, unimproved. |
| `git grep -l isGitObject` | **`src/secretdetect.mjs`, `demo/secretdetect.test.mjs` only** | P-1 (hoist the verdict to ONE shared site consumed by both surfaces) has **not** shipped: the exclusion still lives in one module. |
| Matrix re-run: `HEAD=<real sha>` | detect **0** / redact **1** | The cross-surface **drift the prior position called "live" is still live**, 18 days on. |
| Matrix re-run: bare real sha (`rev-parse` / `merge-tree --write-tree` line 1) | detect **1** / redact **1** | P-3 (bare-resolution extension) **not shipped**. |
| Matrix re-run: bare random 40-hex | detect **1** / redact **1** | Canary intact — the fail-safe direction is not broken. Do not regress it. |
| 9-char short sha | detect 0 / redact 0 | The workaround works — at a cost, below. It is everywhere: `src/worktree.mjs:422-429` (`shortSha` = `slice(0, 9)`, applied whenever a ref is a 40/64-hex), `src/seattools.mjs:55` (same 9-char trim), and `docs/runbooks/land.md:618-622` which tells every operator to **"Use `--short` ids … never conclude 'the branch has no tip' from a redacted line"** — i.e. the runbook already documents the hazard and prescribes avoidance instead of a control. |

**Live instance in this seat's own transcript, 2026-11-06:** `git log -1 --format='%H %ad %an' main` returned the id replaced by `[redacted by durig: secret-shaped value (high-entropy-token) from tool bash …]`, and the `peek_queue` view rendered a sha-bearing item subject the same way. This seat had to fall back to 8-char ids to write its own evidence rows on #5232/#5241. That is the mechanism #4922 reports, observed while doing verification work — not inferred.

## What is NEW since 2026-10-19: the damage moved from *noise* to *evidence*

The earlier position argued cost in terms of false positives and a verifier's comparator shas. The #4916/#4922 instance is different in kind:

1. **An instruction becomes unexecutable.** A queue body is written by one seat, rendered into another seat's context. `assert sha <40-hex>` arrives as `assert sha [redacted …]`. The sender believed it transmitted a patch id; the recipient received an unactionable placeholder. Both parties see a clean exchange.
2. **The evidence contract is attacked at the transport layer.** The constitution and `complete_work` require `evidence.artifact` to name **the tree the check ran against** (a sha, a branch, or `main`) — that is what makes a `done` re-checkable (ROADMAP 48/W2), and the landing protocol's content-probe/tip-drift abort (#3265, #3337) is keyed to object names. A redacted pin means the required field cannot be produced by honest transcription.
3. **Silent substitution is the worst outcome, and it is plausible.** A seat that saw `<first-9>…[redacted]` tends to write the short form, or a neighbouring id, and *believes* it pinned a tree. Then every downstream re-check runs against a **different tree than the claim**, and the green is real but about something else. This is the failure the #5227/RM-295 row is about (a `done` with no artifact on any ref), one layer down.
4. **The mitigation everyone reaches for — shorten the id — is itself the weaker control.** Shortening is resolvable but not exact: it re-opens ambiguity as the object set grows, it cannot be diffed byte-exactly, and it does not survive `git cat-file`-style object queries in a shallow or partial clone. `docs/runbooks/land.md` mandating `--short` is *compensation for a missing control*, and should be labelled that way, not celebrated as the design.

## Threat model (exploit path → fix → falsification probe)

| # | Threat / damage path | Fix (concrete) | Falsification probe (must be able to fail) |
|---|---|---|---|
| T1 | **Unverifiable completion.** A seat's tool result carries the sha; redaction replaces it; `evidence.artifact` is filled with the marker, an empty-ish value, or a guess. The completion is re-checkable in form and not in fact. | (a) ship **P-3** so a confirmed object survives redaction; (b) **E-1:** `complete_work` REFUSES an `evidence.artifact` that contains a redaction marker or that does not resolve as a tree name, with the remedy spelled out ("name a branch, `main`, or a resolvable object id"). | Feed `complete_work` an artifact equal to the marker text ⇒ **refused**, item stays open. Feed it `main`, a branch, and `git rev-parse HEAD`'s output read live ⇒ **accepted**, and the pin round-trips through the tool surface with **0** redaction spans. |
| T2 | **False-premise re-check (silent substitution).** A seat reconstructs a truncated/mis-transcribed id and stores it; later verifiers re-run against the wrong tree and report a real green about a different artifact. | **E-2:** an evidence artifact must be a name that **resolves in the tree it claims** (`git rev-parse --verify <name>`, and for a full id `git cat-file -e <id>^{object}`) at completion time; unresolvable ⇒ refuse, don't warn. This is the same resolution oracle the detector already uses — one mechanism, not a new predicate. | Store an artifact of the form `<real 9-char prefix>+<junk>` ⇒ refused. Store `HEAD`/branch/`main` ⇒ accepted. Assert a full 40-hex pin is accepted **only** when it resolves. |
| T3 | **A real leak hides inside the FP flood.** 39/40 of the detector's findings on ordinary `git log` output are object ids, so the `secret_detected` notice is dismissed as noise — exactly how a genuine 40-hex credential gets ignored. | Ship **P-3** (bare 40/64-hex exempts *iff* resolution confirms): it cuts the FP class on **both** surfaces at once and leaves the canary untouched. | The second command above: today `detect findings = 39`; **expected 0** once shipped, with the random-hex canary case still firing (re-assert the `demo/secretdetect.test.mjs` "bare non-object STILL FIRES" canary verbatim). |
| T4 | **Exemption forgery by prose context.** An author (or injected content) writes `commit <hex-encoded-credential>` to dodge redaction. | No change needed — keep the shipped requirement that **context never exempts alone**; resolution does. Never adopt a context-only or alphabet-only rule. | `commit <random-40-hex>` must still produce a redaction span and a detector finding; a still-redacting fixture belongs in the failing-first demo. |
| T5 | **Probe amplification.** A pathological output (`cat-file --batch-all-objects`, a packed-refs dump) hands the redactor thousands of candidate hexes ⇒ a per-tool-call probe storm. | Ship **P-4**'s budget: harvest distinct candidates, memoize, **named cap per result**, over-budget ⇒ **REDACT**, not pass. | Heavy fixture with N ≫ cap distinct hex candidates: assert spawn count ≤ cap and that the excess tokens came out redacted. |
| T6 | **Cross-repo ids stay redacted** (upstream `pi` pins, `vendor/pi-main.pin.json`, a github-cited sha). Not confirmed in our object DB ⇒ still eaten. | Accepted residual (as at 2026-10-19), but make it **legible**: **P-5** per-pass counters by family, and the marker should say `unconfirmed-object` rather than `high-entropy-token` when the token is pure 40/64-hex, so a reader knows *why* it vanished and can re-read it via a ref name. | A doc/demo quoting a foreign-repo sha: assert the marker names the *unconfirmed-object* class and the counter increments; assert no raw foreign sha reaches the model. |

## Non-goals (explicit)

- **Not** a wider name allowlist, a key-name table, or a blanket pure-hex skip — those are the rejected forms (lead #2040 A; R-2 superseded).
- **Not** the commit-diff gate, the egress path, or the credential surface (both still UNVERIFIED areas — `docs/CODEMODE.md`, `docs/BROKER-SUPERVISION.md`).
- **Not** a licence to weaken redaction anywhere a value is not a confirmed object. Every change here is fail-closed.
- **Not** built by this seat. Analysis and routing only; adoption is `lead`/`pm`.

## Gates (for whoever builds it; this seat does not sequence the queue)

- **G-A** P-1 first: the exclusion is **hoisted to the one shared verdict** and consumed by both surfaces. Today `isGitObject` exists only inside `src/secretdetect.mjs`; copying it into `secretredact.mjs` re-arms the drift this addendum measures. (Same one-predicate direction as #3128 and #4922.)
- **G-B** failing-first: the demo asserts **today's red numbers** (100% of ids classified; `detect findings = 39` on the `--format=%H %s` fixture) before it asserts the fix. A demo written only after the fix is not evidence.
- **G-C** E-1/E-2 also land RED-first, and their refusal text must name the remedy (the guard-refusal-naming-its-verb convention already in force).
- **G-D** the canaries stay: bare random 40-hex fires on both sides; `sk-`/`ghp_`/`hf_`/`AIza` families still redact; `KEY=<hex>` RHS still redacts.
- **G-E** when it ships, the compensating conventions get amended rather than left as folklore: `docs/runbooks/land.md:618-622`'s `--short` mandate and the 9-char shortening at `src/worktree.mjs:422-429` and `src/seattools.mjs:55` should say *why* they exist (a missing exemption) and that a full pin is admissible once it resolves.

## Citations

`src/secretredact.mjs` (`SECRET_VALUE_PATTERNS.high-entropy-token`, `secretSpans`, `afterTool`, no object exclusion); `src/secretdetect.mjs` (`HEX_OBJECT_RE`, `GIT_HASH_CONTEXT_RE`, `GIT_HASH_PAIR_RE`, `isGitObject` + memo + fail-safe note); `src/config.mjs` (`looksLikeSecret`, #700/#1317 posture); `demo/secretredact.test.mjs` (4 marker assertions — none about object names); `demo/secretdetect.test.mjs` (the object-exclusion canaries); prior position `docs/reviews/security-sha-exemption-position.md` (P-1…P-7, G1…G5) and `docs/reviews/security-secret-shape-narrow-position.md` @`b9dfd61` (R-1…R-6, R-2 superseded); `docs/incidents/2026-10-19-git-sha-redacted-as-secret.md` (Prevention §1 still to amend, P-6); `docs/runbooks/store-secret-detected.md`; held carrier items **#3128** (the build, held), **#2623 / #2624** (the same-gap defect and the checker-is-the-discriminator re-registration, held), **#3296** (the keep-gate: `security-item-3122 @b9dfd61` is #3128's named input); lead **#2040 ruling A**; #1620/#1660/#1712 (the detect-side landing). Queue instances observed 2026-11-06: **#4916** (pinned patch-ids lost from a body — the trigger for #4922), **#5232/#5241** (this seat forced to short ids while writing evidence rows).

**Verdict:** the exemption that was ratified in shape on 2026-10-19 is **still unbuilt**, and its absence has graduated from a false-positive nuisance (T3, T6) to an integrity hazard against the evidence chain (T1, T2). The fix is the already-ratified checker-based parity (P-1…P-4), plus two refusals (E-1, E-2) that make a destroyed or substituted tree pin impossible to accept.
