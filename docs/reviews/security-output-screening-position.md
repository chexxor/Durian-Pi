# Security position — screening model OUTPUT (ROADMAP 148 / OWASP ASI03, ASI06): the seam does not exist yet, so screen egress + detect + refuse, and do not call it sanitization

- **Date:** 2026-11-07 · **Owner:** seat `security` · **For:** item #1803 (ROADMAP 148, OWASP ASI03/ASI06) · **Depends on:** RM-295 (credential-VALUE print; fix routed to `devtools` as #5366)
- **Scope of this note:** the OUTPUT channel — assistant text the model emits, the provider request built from committed history, and the read-side surfaces (TUI, `status`/`watch`, queue bodies, compaction) that carry it. It does **not** cover the tool-RESULT path, which already has a sanctioned in-harness seam (`src/secretredact.mjs` `afterTool`), nor the credential STORE (`docs/reviews/credential-architecture-options-2026-11-07.md`).
- **Status:** position BEFORE code. 148 is unstarted; nothing in this note is implemented by it.

## 1. The load-bearing finding: there is no hook that can rewrite assistant text

ROADMAP 148 names its where as `src/secretredact.mjs` + `src/seatguard.mjs`, i.e. "extend the afterTool
redaction to model output". That is **not implementable on the pinned dependency** (`@earendil-works/pi-durable`
1.3.0, resolved from the lockfile in this worktree — not the seat root's `1.3.0`; say which tree a verdict
comes from). The seam inventory, read out of the pinned dist rather than assumed:

| Hook (`GenerationHooks` / `ToolHooks`) | Shape | Can it replace the text? | Citation |
|---|---|---|---|
| `beforeRequest({messages})` | `HookResult<{messages}>` | **YES** — the return replaces the outbound request | `dist/harness/generation.js:117-120` (`if (replaced !== undefined) messages = replaced.messages;`) |
| `afterResponse(message)` | `void \| Promise<void>`, invoked by `hooks.each` | **NO** — return value is discarded | `dist/harness/generation.js:357` |
| `onYield(answer)` | `HookResult<{continue: UserInput}>` | **NO** — can append a user message and continue, cannot rewrite or veto the answer | `dist/harness/types.d.ts` (`GenerationHooks.onYield`) |
| `appendAssistant` (commit site) | internal, "every built-in writer of assistant entries goes through here" | **NO durig-side hook at all** | `dist/harness/generation.js:549` (`tx.appendEntry(AssistantEntry, …)`) |
| `afterTool(call, result)` | `HookResult<ToolExecutionResult>` | YES — but that is the tool path, already used | `dist/harness/types.d.ts` (`ToolHooks.afterTool`) |

Probe **P-1** (re-runnable; exits **0** while the gap exists, non-zero if an upstream release adds a
replacing seam — that is the falsifier):

```
node --input-type=module -e '
import {readFileSync} from "node:fs";
const s=readFileSync("node_modules/@earendil-works/pi-durable/dist/harness/generation.js","utf8");
const ar=s.match(/hooks\.each\("afterResponse"[\s\S]{0,160}/), br=s.match(/hooks\.each\("beforeRequest"[\s\S]{0,200}/);
const noReplace=!/=\s*await\s+hook\(|messages\s*=/.test(ar[0]), beforeReplaces=/messages\s*=\s*\w+\.messages/.test(br[0]);
console.log(JSON.stringify({afterResponse_ignores_return:noReplace,beforeRequest_replaces:beforeReplaces}));
process.exit(noReplace&&beforeReplaces?0:1);'
```

Ran on 2026-11-07 in the `item-1803` worktree: `{"afterResponse_ignores_return":true,"beforeRequest_replaces":true}`,
**exit 0**. Consequence to state plainly to the operator and to `check`: **assistant output is unscreenable at
commit time today**, so 148's acceptance line ("a credential or PII string emitted in assistant output is
redacted or refused") is unachievable-as-written. Do not let an implementation claim it with a hook that only
reports.

## 2. Threat model

Threats are ranked by whether a control exists today. Sentinel discipline: every probe below uses a
**synthetic sentinel value**, never a live credential (D205: record the fact, never the secret).

| # | Threat | Path | Proposed control | Falsification probe |
|---|---|---|---|---|
| T1 | **Re-egression of a resident secret to the provider.** Anything already in committed history (pre-redaction writes, an escape class, another seat's `edges` read) is re-sent upstream on **every** subsequent request. | `beforeRequest` builds `messages` from `runtime.context(...)` — the committed view | Screen `messages` in a `beforeRequest` hook with the **one shared** verdict; replace spans, keep the locator. This is the only output-side replacement available today, and it is a real reduction: it bounds the provider to one copy rather than N turns. | P-2: sentinel committed in a seat's transcript; assert the sentinel never appears in the `messages` a registering `beforeRequest` hook receives. Red |
| T2 | **Display/delivery leak.** Assistant text with a secret reaches TUI, `status`/`watch`, queue bodies, a pasted report. RM-295 is the same class one layer over: `tools/broker-serve.mjs:465-471` puts whole `DURIG_(LOCAL\|VERIFIER)_*` env entries — including `*_API_KEY` — into the `env:` line every runbook tells a seat to run. | preflight stdout; render path | **Presence-only reporting** for any env/credential echo (RM-295's prescribed fix, #5366), and screen at the *delivery* boundary, not the store. Name it as delivery-layer masking, never as sanitization. | P-3: run `broker-serve --status` and `--dry-run` with a sentinel in each `DURIG_*_API_KEY`; assert sentinel absent from stdout/stderr (the `toolchain` demo RM-295 prescribes). Must FAIL before the fix, PASS after. |
| T3 | **Detection has blind spots at exactly the places the payload moved to.** Read-side detection (`src/secretdetect.mjs`) scans `entry.model[0]` text parts and `toolCall.arguments` only. `ToolResultEntry.data.diagnostics` (structured diagnostics) and image parts are never scanned — and the harness itself warns the payload field was RENAMED `content`→`output`, which already silently dropped one redaction (#1610). | `entryTextSegments` | Widen the scan to every payload field the entry actually carries, mirroring `afterTool`'s `["output","content"]` loop; one shared span vocabulary. | P-4 (re-runnable, exits 0 today = gap open): assert `entryTextSegments` reads `entry.data` and image payloads; today prints `{"readsModel":true,"readsDiagnosticsData":false,"readsImageParts":false}`, **exit 0**. |
| T4 | **Copy multiplication by compaction.** A surviving secret is summarized into a `CompactionEntry` (`model:[UserMessage]`), so one leak becomes a durable, quotable copy that also re-enters every future context. | compaction task → `CompactionEntry` | Screen the summary the same way as any message; treat a compaction that would carry a secret as a **finding**, not a silent rewrite. | P-5: sentinel in a compacted range; assert absent from the resulting summary entry. |
| T5 | **PII class with no shared verdict.** 148 asks for a PII class. Naive SSN/email/date-shaped regexes will redact operator dates, task ids and shas — the exact failure already recorded twice (`docs/incidents/2026-10-19-git-sha-redacted-as-secret.md`; the 40-hex-in-body hazard #5252, where redaction made "assert sha X" instructions unexecutable). | new pattern table | PII starts **report-only** (attention notice, never in-place mutation) with the checker-as-discriminator discipline of lead #2038, and a **single** definition in `src/config.mjs` consumed by detect, redact and any new output screen. Prefix families stay as they are. | P-6: fixture of false-positive shapes (40-hex oid, ISO date, SSN-shaped task id) stays byte-identical through the new class; a synthetic SSN-shaped sentinel in assistant text raises a notice. |
| T6 | **The screen itself becomes the leak.** A marker, locator, notice or audit record that echoes the value re-publishes it, now in a surface that is designed to be pasted. | `redactionMarker`/`callLocator`/`secretNotices` | Keep the existing discipline as a **gate on any new screen**: name the family and the where, never the value; the record must be assertable value-free. | P-7: assert no sentinel substring in the marker, the notice detail, or the recorded finding object. |
| T7 | **Silent fail-open.** A screen that throws, or that is registered on the wrong task, or that writes the redaction into a field the harness does not read back, drops the protection and looks green. | hook registration / field rename drift | Fail **closed** for the surfaces durig owns; register on the task that runs the code path; the demo must prove the hook FIRED, not that the output looked clean. | P-8: assert the hook is registered and that a mutation it makes is observable at the boundary it claims (not merely that the sentinel is missing). |

## 3. Non-goals

- Not a network DLP, not provider-side content policy, not PII retention law analysis.
- Not a second writer on the store: durig must never intercept the store write (A1; the transcript writer
  lives inside pi-durable). Every control above sits at a hook, a render, or a read.
- Not rotation: a credential that reached any output is **compromised at the moment it printed**; rotation is
  an operator event (RM-295's values are already in a transcript, so #5366's fix is necessary and not sufficient).
- This position does **not** sequence 148 against other rows; routing is lead/pm's call.

## 4. Gates before 148's code lands

- **G-1** — the implementation names **which** route it takes, in its own header: (a) upstream request for a
  replacing `afterResponse` (cross-repo, gates any claim of redaction), (b) `beforeRequest` egress screening
  (available today, bounds re-egression), (c) read/delivery-side masking plus read-side detection (available
  today). Only (a) can honestly satisfy 148's acceptance text; (b)+(c) are real risk reduction and must be
  labelled as such.
- **G-2** — one secret verdict, one place (`src/config.mjs`), consumed by `secretdetect`, `secretredact` and
  any new screen. A fourth copy of `SECRET_VALUE_PATTERNS` fails review.
- **G-3** — failing-first demos exist for P-3 (RM-295) and P-4 (T3 blind spot) and are green after, red before.
- **G-4** — the 40-hex/oid non-redaction demos stay green; a screen that blinds a landing gate is a regression, not a hardening.
- **G-5** — no probe, demo, runbook or report prints a real credential value; sentinels only, truncated quotes at most.
- **G-6** — ROADMAP 148's acceptance text is amended to record the seam gap (or an ADR is written for route (a)), so the row cannot be closed on a report-only hook.

## 5. What would show this note is right

- P-1 exit 0 (no replacing seam) and P-4 exit 0 (detection blind spot) as run above — both re-runnable from
  any checkout that resolves the pinned 1.3.0.
- P-3 red at `7e5afe39` and green after #5366, which is the falsifiable signature of the RM-295 class.
- If a future pi-durable pin makes P-1 exit non-zero, section 1 is obsolete and route (a) becomes available —
  that is the intended way for this position to be proven wrong.
