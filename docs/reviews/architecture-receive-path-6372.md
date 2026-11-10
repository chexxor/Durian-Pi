---
review: the receive path fails closed but reports progress - what the DENY fix must actually change
item: #6372
seat: architect
asked_by: pm
date: 2026-11-11
tree reviewed: main (worktree item-6365)
probes: tools/probes/refusal-legibility.mjs (exit 1), tools/probes/receive-path.mjs (exit 0 with 6 FAIL lines)
status: design position and corrected diagnosis; impl builds (#6371)
---

# Where the routed diagnosis is right, and where it is off by one

**Right: admission is not total.** `requestOp` (`src/broker.mjs:473-475`) defaults a missing `op` to `"message"`, and `authorizeSpoolRequest` ends with `return { allowed: true, code: "content-op" }` (`:543`). So the predicate's default is ALLOW for anything not in `CONTROL_PLANE_OPS` or `CROSS_SEAT_OPS`, and a payload with no declared op is admitted as a message. The vocabulary check lives elsewhere (`:820`), in the drain. Measured: `{op:"controll", from:"impl"}`, `{body:"hello"}` and `{op:42, from:"impl"}` all return `allowed: true` from the predicate.

**Off by one: "a DENY writes no result row, so a producer polling by `requestId` cannot distinguish refused from still queued."** It half-holds. Measured with a refused control-plane intent carrying a requestId:

- the dead-letter record keeps the original payload, so `requestId` is present;
- `readIntentError` (`:335-352`) matches on it and `awaitIntentResult` (`:363-390`) returns `{ok: false, reason: "refused: not-operator: pause is a control-plane op..."}` in a single poll.

So the producer *is* told, today, **when the dead-letter sink works**. The defect is narrower and worse than "no result row": legibility is a function of a directory that can be unusable. When `<db>.broker.inbox.error` exists as a file, `deadLetterIntent` swallows the failure (`:305-307`), the caller still increments `deadLettered` (`:799`, `:823`, `:851`, `:889`), the payload stays in the inbox, and the producer's poll runs out its 120 s bound - a hang with a label. The probe measures exactly that: pass 1 `deadLettered=1` with 1 payload still in the inbox; pass 2 `deadLettered=1` with 1 still there.

**Writing a result row is therefore necessary but not sufficient.** If the fix only adds a row to `.broker.inbox.out`, the loop and the lying counter survive.

# The counter is the observability defect

One number, four meanings: unreadable (`:798`), unknown op (`:821`), refused by policy (`:842`), apply failed (`:873`, `:886`) - and a **failed** dead-letter also increments it. A policy refusal is not a failure, and a failure to record a refusal is not a refusal. Splitting them is not cosmetic: `docs/runbooks/intent-stuck-in-inbox.md` carries `check_rule: null`, i.e. nothing re-tests dead-letter reachability after the fact, so the only signal that the recovery path is broken is the counter that says it worked. Recovery: `refused`, `deadLettered`, `deadLetterFailed`, `applyFailed`, and a check rule that reads them.

# A contradiction the fix would create

The result channel is also the **idempotency ledger**: `if (readIntentResult(dbPath, requestId)) { consume; duplicates += 1; continue; }` (`:816`). If refusals are written there, then a re-spooled request with the same `requestId` is silently consumed as a duplicate - and the runbook tells operators to do precisely that: "re-spool the refused intent with the same `--request-id`" (`docs/runbooks/intent-stuck-in-inbox.md`, Do 2).

Two ways out, and the choice has to be made deliberately:
- **(a) the ledger means "applied".** The guard checks `result.ok === true`; refusals are recorded with `ok: false` and do not block a retry. Keeps one channel, matches the operator procedure.
- **(b) refusals live in a separate channel** and the ledger stays applied-only. Also coherent, but then the producer needs two lookups and the timeout path must consult both.

I take (a). It preserves the existing producer contract (`awaitIntentResult` already returns `ok:false` with a reason) and it keeps the ledger's meaning single. Whichever is chosen, the rule must be stated in the code comment at `:816` and asserted by a demo: refuse, grant, re-spool the same requestId, assert it applies.

# Failure modes, recovery, check

| failure | class | recovery | falsifiable check |
|---|---|---|---|
| undeclared or malformed op admitted as a message | silent | total predicate: vocabulary check plus DENY default, with a code (`op-not-declared`, `op-not-a-string`) | probe cases that are FAIL today |
| dead-letter sink unusable, payload stays, counter says progress | loop + silent | separate `deadLetterFailed`; bound with the retry sidecar already used for closed handles (`recordRetryAttempt`, `INTENT_RETRY_LIMIT`); fall back to quarantining the payload so the drain terminates | two drains, inbox count must fall to 0 |
| producer polls and times out because the refusal only exists in a directory it does not read | partial | write the refusal row, or keep `readIntentError` as the source and make the poll fail fast when the sink failed | a refused intent resolves in one poll, not 120 s |
| re-spooled requestId silently dropped as a duplicate | contradiction | ledger means "applied", not "seen" (`ok === true`) | refuse, grant, re-spool same id, assert applied |
| the acceptance probe exits 0 while printing 6 FAILs | silent | exit 1 on any failure so it can be wired into `check` and the demo suite | run it: exit code, not the human reading the lines |
| fallback lookup cost as the dead-letter backlog grows | performance (bounded) | none needed today: measured 1.8 ms per lookup against 200 records, 600 lookups per full poll bound; flag it if the backlog reaches thousands | the same probe prints the number |

# The layer-vs-boundary point, verified rather than asserted

`src/seatguard.mjs:389-397` already says it in the code: the spool path-deny is "BEST-EFFORT, not the boundary ... this is a LAYER under the authoritative `from`-gate", and `demo/control-plane-gate.test.mjs` (exit 0, run in this worktree) documents the same-user bypass. So the requirement is met for the existing guard; the new DENY handling must carry the same wording rather than implying the path-deny is the enforcement. The authoritative enforcement is `authorizeSpoolRequest`; everything else narrows the surface.

# Decision to record

**Status: proposed, for lead/impl to ratify at land time.** Context: the receive path fails closed for declared ops but is fail-open for undeclared ones, and its recovery mechanism can itself fail while reporting success. Decision: admission is total - a request must declare an op in `SPOOL_OPS`, and anything else is refused with a structured code at the predicate, not at the drain. Refusals produce a result row with `ok: false`; the idempotency guard reads `ok`; dead-letter failures are counted separately and bounded. Consequences: producers get a verdict in one poll; the `dead=N` line becomes interpretable; a check rule can watch the recovery path; a legacy producer that omits `op` now gets a legible refusal instead of being treated as a message. Reversibility: the vocabulary check can be relaxed back to a default-allow with one line if a real producer turns out to depend on it - the strict form is the reversible choice because it fails loudly rather than silently.
