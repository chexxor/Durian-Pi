---
review: broker-receive-path-enforcement
item: #6185
seat: architect
asked_by: pm
date: 2026-11-10
tree: item-6185 @ 20308665
status: position stated; the fixes are routed, not implemented here
---

# What may enforce on the broker receive path, and who may write the audit sink

## 1. The topology, drawn before it is discussed

```
producer  (cli.mjs send / watch / a seat tool)
   │  writeIntent(dbPath, intent)          src/broker.mjs:184   atomic temp+rename,
   │                                       time-ordered name, requestId minted if absent
   ▼
<db>.broker.inbox/NNNNNNNNNNNNNNNN-pid-x.json
   │
   │  drainIntentInbox()                   src/broker.mjs:761   the broker, the SINGLE writer,
   │                                      at the head of every pass
   ├─ JSON.parse fails ──────────────► deadLetterIntent(reason)      NO onDiagnostic emitted
   ├─ readIntentResult(requestId) hit ─► unlink, duplicates++        idempotent re-drain
   ├─ op ∉ SPOOL_OPS ─────────────────► dead-letter + diagnostic "unknown op"
   ├─ authorizeSpoolRequest(request)     PURE  src/broker.mjs:505
   │      gated ops (CONTROL_PLANE_OPS ∪ CROSS_SEAT_OPS) →
   │         appendGateAudit(...)  for ALLOWED and REFUSED alike   src/broker.mjs:547
   │      refused → dead-letter with a STRUCTURED code + diagnostic "intent-refused"
   └─ applyRequest(...) with the broker's OWN harness
          ok     → writeIntentResult(requestId), unlink, delivered++
          closed handle → retry, INTENT_RETRY_LIMIT = 3, then dead-letter "retry-exhausted"
          other error    → dead-letter "apply-failed"
```

**Input/output contract of the enforcement step.** It receives one parsed request; it produces
`{allowed, code, detail}`; it is **not** responsible for scope, for repair, for waking a seat, or for
deciding whether the work is worth doing. It is admission control. `authorizeSpoolRequest` is exported
pure (`src/broker.mjs:505`) precisely so the rule can be tested with no broker and no store —
`node demo/control-plane-gate.test.mjs` does exactly that and exits 0.

**What may NOT enforce there**, and why, each measured:
- **A model call.** Admission runs inside the pass; a model call there makes the gate's latency and
  failure mode unbounded, and a gate that can fail is not a gate.
- **A second store opener.** The read seam already learned this the hard way: pi-durable keeps the
  harness's storage private and `document()` takes `BEGIN IMMEDIATE` even for a read, so a second
  connection contends with the harness in-process and times out the 5 s busy window →
  `SessionFailed` → wedge (`src/broker.mjs:620-630`). Enforcement must not open anything.
- **A repair.** A refusal that also re-writes the payload makes the gate's decision and the payload's
  state entangled; the drain is already idempotent by `requestId` and a repair would break that.

## 2. What enforcement currently does, measured

Probe: `node docs/evidence/2026-11-10-broker-receive-path/probe-drain.mjs` → **exit 0**. Stub
harness, temp db paths, no model, no key, no broker process, no store opened.

| Payload | pass 1 | pass 2 | Result |
|---|---|---|---|
| unparseable bytes | delivered 0, dead 1 | delivered 0, dead 0 | gone; **no diagnostic emitted** |
| valid JSON, no `op` | delivered 0, dead 1 | delivered 0, dead 0 | dead-lettered, `intent-undeliverable:unknown seat: undefined` |
| op typo `controll` | delivered 0, dead 1 | delivered 0, dead 0 | dead-lettered, `intent-undeliverable:unknown op` |
| `pause` from `from="qa"` | delivered 0, dead 1 | delivered 0, dead 0 | refused: `pause is a control-plane op; only from="operator" may apply it (from="qa")` |

The healthy path is fail-closed and idempotent: the payload leaves the spool and does not loop, and
the refusal carries a structured code so the producer reports "refused", not "pending".

## 3. The admission rule checks a *defaulted* discriminator, and a classifier deny would fire on the rig's own evidence

Probe: `node docs/evidence/2026-11-10-broker-receive-path/probe.mjs` → **exit 0**. Two measurements the
position turns on:

**A payload with no `op` is admitted, not refused.** `requestOp` defaults a missing op to `message`
(`src/broker.mjs:469-471`), so `op` absent → `op="message"` → `ALLOW code=content-op`. It only fails
later, at seat lookup, as `apply failed: unknown seat: undefined`. A typo `controll` is likewise
allowed by the admission rule and dead-lettered by the drain's `SPOOL_OPS` membership check — two
different code paths reaching opposite verdicts on the same payload. **Fix:** admission must reject an
absent or unknown discriminator at the gate, not inherit a default. Enforcement that runs on a value
the parser invented is not enforcement.

**A content-classifier deny at the receive path denies the rig's own evidence traffic.** Of six
routine payloads a gate would see, five are secret-shaped to the existing classifier: an evidence sha
the constitution requires a completion to name, a sha256 in an ADR, a worktree branch name, an npm
integrity hash from the lockfile, and a real key — all `FIRES` on `high-entropy-token`; only a bare
item id or short sha does not. The exemption that exists (`src/gitobject.mjs`) is **confirmation-based**
(`git cat-file -e`) and is a subprocess with a probe budget; putting that at ingest means a subprocess
per spooled intent. **Fix:** enforce on *structure* (op, actor, target, capability), never on content
shape. A deny keyed on entropy is a deny you cannot turn on.

## 4. The defect in the recovery leg — a deny is DECIDED but its record can fail, and the counter lies

Same probe, last section. When `<db>.broker.inbox.error` exists **as a file** rather than a
directory:

```
BROKER: could not dead-letter intent ...: EEXIST: file already exists, mkdir '.../probe.sqlite.broker.inbox.error'
dead-letter target is a FILE (cannot dead-letter)
  pass1 delivered=0 deadLettered=1 | pass2 delivered=0 deadLettered=1
  payload still in the inbox after two passes: 1
VERDICT: with the dead-letter sink unusable, the un-evaluable payload stays queued: 1 file(s) after two passes.
```

Three things are wrong at once:

1. `deadLetterIntent` swallows its own failure (`src/broker.mjs:305-307`) — it logs to stderr and
   returns normally.
2. The caller then does `deadLettered += 1` (`src/broker.mjs:791`, `:812`, `:856`) **regardless of
   whether the record was written**, so the pass reports a deny as recorded when it was not.
3. There is no attempt cap on that branch. `INTENT_RETRY_LIMIT` (`src/broker.mjs:262`) bounds only
   the closed-handle retry. So the un-evaluable payload is re-parsed and re-refused **every pass,
   forever** — the loop failure mode, with no plateau exit.

Recovery path: distinguish `dead-lettered` from `could-not-dead-letter`; count the latter as
`stuck`; emit a diagnostic; bound it with the same attempt sidecar already used for retry
(`file.retry`, `src/broker.mjs:270-280`); and make `deadLetterIntent` create the error directory
idempotently rather than throwing on a pre-existing non-directory.

## 5. Who may write the audit sink — the honest answer is "whoever can run a program"

`appendGateAudit` is called from exactly one place, inside the drain (`src/broker.mjs:801`). But the
sink itself — `<db>.broker.audit.log` — is not protected by an authority rule:

- `src/confine.mjs` has **0** hits for `audit`, `inbox` or `spool`. The seat environment's extra read
  root is `.durig` only (`src/seattools.mjs:295`).
- The guard is **lexical**. Measured on this rig: `echo '{"probe":"x"}' >> /home/chexxor/Git/Durian-Pi/selfdev.sqlite.broker.audit.log` is **refused** ("this shell command WRITES outside your worktree"); `node -e "fs.appendFileSync('/home/chexxor/Git/Durian-Pi/selfdev.sqlite.broker.audit.log', ...)"` **succeeds**. The guard inspects the command's own tokens (redirects, git subcommands, listed write forms); the file operations *inside* a program are invisible to it. (The appended probe line was removed immediately after the measurement; the sink was left as found.)

So the current protection is an accident of how the command is spelled, not an authority. That is
the seam #6185 is asking about.

**Options considered.**

**(a) Extend the guard to name the sink paths.** Helps against shell redirection; does nothing
against an interpreter, and the seat's shell *is* an interpreter. A partial layer, cheap, and worth
having — but it cannot be the authority.

**(b) Make the sink's authority come from its content, not from its path.** The broker writes rows
that name the decision it made and the spool file it decided on
(`{requestId, op, from, to, sourceFile, decision, code, at}`), and the enforceable artifact is the
structured `refusal` object written onto the dead-lettered record (`src/broker.mjs:295-303`). A
reader cross-checks the sink against the dead-letter `.reason` files and the recorded result
(`writeIntentResult`). Nothing ever *acts* on the sink; it is evidence.

**Decision: (b), with (a) as a layer.** The trade-off named out loud: (b) costs a cross-check at read
time and forbids anyone from treating the audit log as a decision source — a small convenience loss
— in exchange for the sink being forgeable-proof *in the only place it matters*: the broker's own
decision, which is a function of broker-held state, not of a file a seat can append to.
`authorizeSpoolRequest`'s own docstring already states the doctrine: `from` is producer-stamped and
all seats share one OS user, so the check "refuses the non-operator case and LAYERS with the spool-dir
write denial… same-user forgeability of `from` is a KNOWN RESIDUAL (UNVERIFIED-FOR-PREVENTION). Never
claim otherwise" (`src/broker.mjs:495-500`). The audit sink must carry the same honest label.

## 6. Failure modes at this seam, each with a recovery path

| Mode | Mechanism | Recovery | Falsifiable by |
|---|---|---|---|
| **Silent** | an unparseable payload is dead-lettered with no `onDiagnostic` | emit the diagnostic on the parse-failure branch | the probe's first row: `diagnostics: (none)` |
| **Loop** | dead-letter fails → payload re-drained every pass, unbounded | attempt sidecar + a `stuck` counter + a diagnostic | the probe's last section (2 passes, 1 file still present) |
| **Misreport** | `deadLettered++` counted even when the record write failed | split the counters: `deadLettered` vs `stuck` | the probe's `deadLettered=1` with the file still in the inbox |
| **Defaulted discriminator** | a payload with no `op` is admitted as `message` (`src/broker.mjs:469-471`) and only fails later at seat lookup | refuse an absent/unknown op at the gate | `probe.mjs` section 1: `op absent entirely -> ALLOW code=content-op` |
| **Classifier deny** | an entropy-keyed gate fires on shas, branch names and lockfile hashes — the rig's own evidence | enforce on structure only; never on content shape | `probe.mjs` section 2: 5 of 6 routine payloads `FIRES` |
| **Forgeable audit** | the sink is writable by any seat process | broker-only writes + cross-check against the dead-letter records; never treat the sink as input | `confine.mjs` has 0 hits for `audit`; the two measured writes above |
| **Unbounded sink** | `appendFileSync`, no rotation; the sibling `.broker.log` is already 25,739,355 bytes on this rig | a cap/rotation and a bounded read like `cli.mjs queue --held --with-gates` | `ls -l <db>.broker.*` |
| **Contradiction** | a gate says "refused" while the result channel says "pending" | already fixed for the dead-letter path: refusals carry a structured code so the producer reports refused, not pending | `demo/control-plane-gate.test.mjs` exit 0 |
| **Unanswered refusal** | a DENY writes **no** row in `<db>.broker.inbox.out`, so a producer polling by `requestId` gets nothing and cannot tell "refused" from "still queued" | write a refusal result row `{requestId, op, ok:false, code, detail}` on every refusal branch — `readIntentResult` exists for the success path only | `node tools/probes/receive-path.mjs`: `a DENY writes a result the producer can poll expect=>=1 result row got=0 result row(s) in .broker.inbox.out for 2 denied intents` |
| **Cascade** | a bad payload poisons the pass it is drained in | refusal is dead-lettered before `applyRequest` is reached, so nothing downstream sees it | the probe: `delivered=0` on every refusal |

## 7. What must be built (routed, not done here)

1. `deadLetterIntent` returns a boolean; the drain splits `deadLettered` / `stuck` and emits a
   diagnostic for the latter. Add the attempt cap to that branch.
2. Emit `onDiagnostic` on the JSON.parse failure branch.
3. Write a **refusal result row** so a producer polling by `requestId` gets a verdict instead of
   silence.
3. `requestOp` must not default: an absent or unknown `op` is refused at the gate.
4. Name the sink paths in the guard as a layer (`.broker.audit.log`, `.broker.inbox*`), and state in
   the code and the docs that this is a layer, not a boundary.
5. A bounded reader for the sink (it has none today), so "what did the gate decide?" is answerable
   without a 25 MB read.

## 8. Evidence

- `node docs/evidence/2026-11-10-broker-receive-path/probe-drain.mjs` → exit 0; output quoted above.
- `node tools/probes/receive-path.mjs` → **exit 0**, 15 cases, **6 measured failures**: an undeclared
  op ADMITTED, a payload with no `op` ADMITTED, a non-string `op` ADMITTED, no result row for a denied
  intent, and a deny that re-drains forever when its dead-letter sink is unusable. This is the probe
  the build must turn green.
- `node demo/control-plane-gate.test.mjs` → exit 0 (control-plane and cross-seat spool ops are
  operator-only, refused with a structured code and audited; the spool cannot create; the same-user
  bypass is documented as a known residual).
- `grep -n "audit|inbox|spool" src/confine.mjs` → no matches.
- Code read: `src/broker.mjs:172-190` (spool write), `:288-307` (`deadLetterIntent`), `:505-541`
  (`authorizeSpoolRequest`), `:547-554` (`appendGateAudit`), `:761-861` (`drainIntentInbox`).
