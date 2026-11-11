---
runbook: verifier-leg-unfunded
symptom: "the auditor seat settles `unanswered` with `settledReason: \"no_model\"` and produces zero assistant turns; the `verifier/*` family registers no model row; nothing ever reached the wire"
writes: false
precondition: "read-only"
last_verified: 2026-11-10
verified_by: scribe
evidence: "#6130 (item-6130, branch `item-6130`, forked from `main f192f543`). Measured there 2026-11-10: `node demo/local-provider.test.mjs` exit 0; `node demo/keycheck.test.mjs` exit 0; `node tools/verifier-arm-probe.mjs --family=VERIFIER --model=openai/gpt-oss-120b --base=https://api.deepinfra.com/v1/openai --ceiling=0.15` printed `"keyPresentInEnv": false` and `"verdict": "NOT-ARMABLE"`, exit 1; `node tools/broker-serve.mjs --dry-run --db ./selfdev.sqlite` reported `store: ./selfdev.sqlite (MISSING)`, and piping it to `grep -o DURIG_VERIFIER_API_KEY` returns 1 hit when the variable is set (even empty) and 0 hits when it is absent from the env (grep exit 1)."
check_rule: null
---

# A verifier seat reports `no_model` because the leg is unfunded — that is the honest state

## When to use
A seat whose model starts with `verifier/` (in `rig.selfdev.json` today that is exactly one seat:
`auditor`, `verifier/openai/gpt-oss-120b`) settles `unanswered` with `settledReason: "no_model"` in **under a
second and with zero tokens spent**, or `cli.mjs status` shows the seat with no runs at all. The queue keeps
moving; the verification leg does not.

**Before doing anything else, decide which of two states you are in.** They look identical from the seat and have
opposite correct actions:

| state | what is true | correct action |
|---|---|---|
| **deliberately unfunded** — the operator's `$0` ruling, `DURIG_VERIFIER_API_KEY` is unset in the broker process on purpose | this runbook | route the verification to a funded seat; do not "fix" the key |
| **accidentally lost** — an operator credential rotation dropped the key from the host config | `verifier-model-server.md` §"A seat suddenly reports `metered-endpoint-unkeyed` (after a credential rotation)" | escalate to the operator; a seat never re-keys |

The distinguishing fact is not the seat's message — it is whether the key was **ever** set. The preflight below
prints presence, never value.

## Impact
Nothing crashes. The mechanism is a **refusal, not a throw**: `src/providers/local.mjs:302` (`createLocalProvider`)
collects causes, pushes `metered-endpoint-unkeyed` at **:318**, and emits `{"spend":"registration-refused",…}` at
**:324** for a metered endpoint with no key, registering the provider with **no model row**. The seat then dies at model resolution — `no_model` — before any
request is sent, so no money is spent and no error looks alarming. That silence is the danger: a seat meeting
`no_model` reads it as a defect to work around, and the two workarounds in reach are both destructive — pointing
the verifier at a local model (the verifier stops being independent of the author) or reporting a verification as
done (a false green). `src/fleethealth.mjs:54` classifies the message as `model-unavailable`, which is accurate but
does not tell you it was intended.

**`no_model` here is not a roster fault and not a capacity fault.** No request was ever sent, so no seat was
"turned away"; the model simply does not exist in the registry.

## Preconditions
None. Everything below is read-only and the broker does not need to be stopped.

## Diagnose (read-only)

```bash
# 1. Is the verifier leg armed at all? Offline: names the variable, never its value.
node tools/verifier-arm-probe.mjs --family=VERIFIER --model=openai/gpt-oss-120b \
  --base=https://api.deepinfra.com/v1/openai --ceiling=0.15
#   measured 2026-11-10 in item-6130: "keyPresentInEnv": false, "verdict": "NOT-ARMABLE",
#   "cause": "metered-endpoint-unpriced", exit 1. Probe exit codes: 0 arming-shaped, 1 NOT armable,
#   2 the instrument could not run — read the cause before believing the verdict.
#   "metered-endpoint-unpriced" and "metered-endpoint-unkeyed" are DIFFERENT halves of the same unfunded
#   leg: a fresh item worktree has no durig.config.json, so the unpriced half fires first even when the key
#   is the real problem.

# 2. Which seat actually settled, and with what reason? Needs the LIVE store; a fresh item worktree has no
#    ./selfdev.sqlite (the preflight says so outright: "store: ./selfdev.sqlite (MISSING)").
DURIG_DB=./selfdev.sqlite node cli.mjs status | grep -o 'no_model'   # hit => the leg is dark
```

**Do not read the broker preflight as the diagnosis.** `tools/broker-serve.mjs` masks credential *values*
(#5700) and prints a credential line only for variables the environment actually carries: measured 2026-11-10,
with `DURIG_VERIFIER_API_KEY=` set empty it prints the `unset` line (grep exit 0), and with the variable absent
from the env it prints **no line at all** (grep exit 1). Absence of the line is not evidence of anything.

**The proving demo, offline, no spend:** `node demo/local-provider.test.mjs` (exit 0) asserts exactly this
behaviour — one of its cases is an "unpriced, unkeyed metered endpoint registers NO model row: a seat naming it
dies `no_model` BEFORE any request" (`demo/local-provider.test.mjs:130`). `demo/cli.test.mjs:218` pins the
settled reason itself: `assert.equal(nm.settledReason, "no_model")`.

## Do
1. **Say the state out loud in your completion.** "The verifier leg is unfunded by operator ruling; this seat
   produced no verification" is a finding. Omitting it is how a verification silently stops happening.
2. **Route the verification, do not simulate it.** Send the check to a funded seat — `qa` or `qa2` (both run
   `local/qwen3.8-flash-next-q2_0` in the current roster, measured from `rig.selfdev.json`). When you route it,
   read `docs/runbooks/verifier-independence.md` first: a verifier's only write is a report, and a peer seat
   doing the verifying must declare which kind of independence it actually has. Routing is allowed; calling a
   peer seat "independent verification" without saying so is not.
3. **Never fabricate a verifier.** Do not point the auditor at a local model to make the row exist. That makes the
   seat run and destroys the one property the verifier family is there for.
4. **Never mark a verification done without evidence.** `complete_work` takes `evidence` (`{command, exitCode,
   artifact}`) precisely so a "verified" claim can be re-checked; with no verifier run there is no command to
   name, so the honest entry is *unverified*, not *done*.
5. **Re-keying is the operator's, never a seat's.** If the leg should be funded, park the item with `defer_work`
   naming the missing variable (`DURIG_VERIFIER_API_KEY`) and the measured output above.

## Verify
The runbook is discoverable from the symptom, and the diagnosis it gives is real. Run all four:

```bash
grep -n "verifier-leg-unfunded" docs/runbooks/README.md     # >= 1: the symptom index reaches this file
grep -n "no_model" docs/runbooks/README.md                  # >= 1: the symptom word is in the index
node tools/doc-integrity-guard.mjs                          # 0 hard / 0 soft, exit 0; a runbook not in the index is a SOFT finding
node demo/local-provider.test.mjs                           # exit 0 — the refusal-and-no-model-row mechanism is tested
```

All four ran on 2026-11-10 in `item-6130` off `main f192f543`: 1 index hit for the runbook name, 3 index hits for
the symptom word,
guard `0 hard, 0 soft` exit 0, local-provider test exit 0.

## If it fails
- The preflight prints `"set"` but the seat still dies `no_model` → this is not this runbook; go to
  `verifier-model-server.md` §"A seat suddenly reports `metered-endpoint-unkeyed`" and check whether the verb
  carried `--env-file=`.
- The arm probe exits 2 → the instrument could not run in this tree; that is a tool fault, not an unfunded leg.
  Check `precondition` and the config path before believing any verdict.

## Escalate to
**Operator** for funding (the `$0` ruling is theirs to change, and only they hold the credential). **pm** for
routing the verification leg to `qa`/`qa2`. **Never** another seat on the same work.

## Evidence
#6130, 2026-11-10, scribe, measured in `item-6130` (fork `main f192f543`). Code sites read in that tree:
`src/providers/local.mjs:302,318,324`, `src/fleethealth.mjs:54`, `demo/local-provider.test.mjs:130`,
`demo/cli.test.mjs:218`, `demo/keycheck.test.mjs:129`, `tools/verifier-arm-probe.mjs` (exit codes 0/1/2).
One suite run in this worktree did **not** go green: `node demo/cli.test.mjs` failed at `:108`
("serve exit 0 … worktree: prune in /tmp/durig-cli-… failed: … not a git repository") — an environment fault of
the test's own worktree setup, not evidence about the `no_model` path. The assertion quoted above was read from
the file, not executed here.
