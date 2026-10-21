---
runbook: <filename-stem>
symptom: "<the words a person would use>"
writes: false
precondition: "read-only"        # "broker-stopped" | "read-only" | "none"
last_verified: unverified        # set to the date the Verify step actually ran
verified_by: <name>
evidence: "<item(s)/commit(s) that proved it>"
check_rule: null                 # optional: the check rule that re-tests this
---

# <Runbook title>

## When to use
<the observable symptom, in the words a person would use>

## Impact
<what breaks if you do nothing; blast radius>

## Preconditions
<what must be true; usually: the broker is stopped and verified>

## Diagnose (read-only)
```bash
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status
```

## Do
1. <a literal, copy-pasteable step; complete env on every line>
2. <a writing step names the stop-and-verify that precedes it>

## Verify
<command + expected output>

## If it fails
<rollback, or the runbook to escalate to>

## Escalate to
<seat/role + the condition>

## Evidence
<item/commit + last verified date>
