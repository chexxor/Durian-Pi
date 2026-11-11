---
runbook: intent-stuck-in-inbox
symptom: "a `cli.mjs send`/`watch` intent never lands; the pass reports `dead=N` but the payload is still in `<db>.broker.inbox`; or a command vanishes with no verdict and nothing in `status` explains it; or `queue`/`status` times out with a fresh heartbeat and an inbox full of unread `read` intents (#6139)"
writes: false                    # this procedure only reads the spool; the probe writes only its own temp dirs
precondition: "none (the probe needs no broker and opens no store)"
last_verified: 2026-11-11
verified_by: impl
evidence: "item #6185; `node docs/evidence/2026-11-10-broker-receive-path/probe-drain.mjs` exit 0 in worktree item-6185 @ 20308665; `node demo/control-plane-gate.test.mjs` exit 0. #6139 leg, measured 2026-11-11 in worktree item-6139 off main 580c1343 with `sync-pi --sync && --link` (dependencySet built-pin, pi-durable 1.5.1): `node demo/read-intent-starvation.test.mjs` exit 0, `node demo/intent-spool-census.test.mjs` exit 0, `node scripts/test.mjs --all` 302/302 exit 0; the RED baseline for the starvation leg ran against HEAD's broker (pre-fix copy) and failed 2 checks: `reason=timed out awaiting the broker's result; pending=2` after 4 s with both intents still in the spool"
check_rule: null                 # nothing re-tests dead-letter reachability after the fact — see Evidence
---

# An intent that is refused but never leaves the inbox

## When to use

You spooled a command and nothing happened. The drain says it was handled — `INTENT delivered=0
dead=1` — but the payload is still in the inbox, and the next pass says `dead=1` again. Or a payload
disappeared with **no** diagnostic line at all.

## Impact

Two distinct failures, and confusing them is the trap:

- **Genuinely dead-lettered**: the payload moved to `<db>.broker.inbox.error/<name>.error.json` with a
  `.reason` file. It is out of the spool and will not loop. This is the healthy fail-closed path.
- **Stuck**: the dead-letter could not be written (the `.error` path exists as a **file**, or is not
  writable), so the payload stays in the inbox and is re-parsed and re-refused **every pass, forever**.
  `deadLetterIntent` swallows the failure (`src/broker.mjs:305-307`) and the caller still increments
  `deadLettered` (`src/broker.mjs:791`, `:812`, `:856`), so the pass **reports a deny as recorded when
  it was not**. `INTENT_RETRY_LIMIT` (3) bounds only the closed-handle branch, not this one.

Blast radius: one stuck payload means the drain re-visited it every pass; nothing else is corrupted,
but the queue's counts are lying, and a fleet read through those counts under-reports refusals.

## Reads queued behind one stuck mutation (#6139)

**Symptom.** `node cli.mjs queue --held --with-gates --json` exits 1 with
`read queue-census: timed out awaiting the broker's result` while the broker is ALIVE — heartbeat
fresh, `lastPassAt` frozen — and `<db>.broker.inbox` still holds the unread `read` intents.

**Why it happened.** Two gates combined. The out-of-band read drain ran only when EVERY pending
intent was a read (`onlyReadIntents`), and `drainSpool` took the seat roster with
`harness.snapshot(...)` before applying anything, so a single mutating intent whose handle is wedged
made the whole drain throw **before** any read in the same spool was served. One stuck mutation held
every read behind it, indefinitely.

**What the code does now.** Reads are drained first, and the roster is taken lazily, immediately
before the first mutation. A mutation the broker cannot apply is DELAYED — it stays in the spool for
the real pass — and never blocks a read. The out-of-band drain runs in `readOnly` mode, so it touches
reads only.

**Read the spool instead of guessing.** The census is a file read, so it answers even while every
broker-routed read is timing out:

```bash
node cli.mjs status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).broker.spool))'
# { count, reads, mutations, unreadable, oldestAt, oldestAgeMs, newestAt }
```

`count>0` with `reads>0` and a large `oldestAgeMs` means the drain is not running (this runbook). A
frozen pass with an EMPTY spool is the other wedge — see `broker-down-or-stalled.md`. A timed-out read
now says so in its own message: `timed out awaiting the broker's result (spool: pending=2 reads=1
mutations=1 oldest=5401ms)`.

```bash
node demo/read-intent-starvation.test.mjs   # exit 0: a wedged handle cannot starve reads
node demo/intent-spool-census.test.mjs      # exit 0: the census counts, ages, and rides in the timeout
```

## Preconditions

None. The diagnosis is a directory listing; nothing here opens the store.

## Diagnose (read-only)

```bash
DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite
ls -1 "$DB.broker.inbox" | wc -l                      # still-queued intents
ls -ld "$DB.broker.inbox.error"                       # DIRECTORY = healthy; FILE = the stuck case
ls -1 "$DB.broker.inbox.error" | wc -l                # dead-lettered intents
cat "$DB.broker.inbox"/*.reason 2>&1 | head -5        # a reason file means it dead-lettered fine
```

Expected for a stuck payload: `ls -ld` says **file**, and the inbox count does not fall between passes.

Then check whether the refusal even produced a diagnostic: an unparseable payload is dead-lettered with
**no** `onDiagnostic` event at all, so an empty diagnostic stream is not evidence of a healthy path.

## Do

1. **If `.error` is a file**, it is the fixture bug, not a broker bug: move it aside.
   `[judgement]` only do this if the store is quiesced (`node cli.mjs serve --stop` first, then
   `node cli.mjs status` shows no advancing seat) — a live broker may be mid-drain.
2. **Re-spool the refused intent with the same `--request-id`** — a duplicate `requestId` applies ONCE
   (`src/broker.mjs:783-788`), so a retry is idempotent *only* if the original was actually applied.
   If the original was refused, re-spooling with the same id is safe; if it was stuck, fix the sink
   first or it loops again.
3. **Read the refusal, not the counter.** The structured `refusal` object rides on the dead-lettered
   record (`src/broker.mjs:295-303`): `{code, op, from, decision, detail}`. Branch on `code`
   (`not-operator`, `iscreate-not-permitted`, `apply-failed`), never on prose.
4. **If the refusal is `not-operator`**: you are a seat, and the op is control-plane
   (`pause`/`unpause`/`configure`) or cross-seat (`stop`/`reset`/`compact` on another seat). That is by
   design (#1966). Ask the operator, or use the self-target form (`to === from`), which is allowed.

## Verify

The stuck-forever mechanism is pinned by a deterministic probe — no broker, no store, no model:

```bash
node docs/evidence/2026-11-10-broker-receive-path/probe-drain.mjs
```

Expected: exit 0, and the last section reads
`dead-letter target is a FILE (cannot dead-letter) … pass1 deadLettered=1 | pass2 deadLettered=1 …
payload still in the inbox after two passes: 1`, followed by
`(scratch dirs removed; the probe leaves no state behind)`.

Then confirm the spool is actually empty after a pass:

```bash
DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite; ls -1 "$DB.broker.inbox" | wc -l
```

Expected: `0` after a pass. A non-zero count that survives two passes is the stuck case.

## If it fails

- `.error` is a directory and the inbox is still non-empty → that is not this failure; it is
  `broker-down-or-stalled.md` (the drain is not running).
- The intent vanished and `status` shows nothing → check `<db>.broker.inbox.out/` for the recorded
  result; a recorded result means it was applied and the file survived a crash before unlink
  (`src/broker.mjs:783-788`).
- The refusal is a *shape* problem (`block` reason/ref) → `block-shape-refused.md`.

## Escalate to

- `pm` — when a stuck payload is blocking a milestone chain, because the queue counts derived from it
  are wrong and every downstream read inherits the error.
- `operator` — when the refusal is correct but the op genuinely needs control-plane authority.

## Evidence

- Probe output 2026-11-10, exit 0, quoted above; the probe's own scratch dirs are removed.
- `node demo/control-plane-gate.test.mjs` → exit 0: "control-plane + cross-seat spool ops are
  operator-only, refused with a structured code and audited; the spool cannot create; content ops and
  self-targets unaffected; the halt actuator is exempt; the same-user bypass is documented as a known
  residual".
- Code: `src/broker.mjs:172-190` (spool write), `:288-307` (`deadLetterIntent`, swallows failure),
  `:761-861` (`drainIntentInbox`, `deadLettered++` on every branch), `:262` (`INTENT_RETRY_LIMIT`).
- **Why there is no `check_rule`:** nothing currently re-tests whether a dead-letter target is a
  directory, and no rule compares the reported `dead` count with the inbox contents. That comparison
  is exactly what the missing rule would do — registered in
  `docs/reviews/architecture-receive-path-6185.md` §6 as the build.
