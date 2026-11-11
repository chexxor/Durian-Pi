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
DURIG_DB=./selfdev.sqlite node cli.mjs status
```
Name the store with the variable **the entry point you are invoking actually reads**: `cli.mjs` and
`intent.mjs` read `DURIG_DB` (`cli.mjs:155`, `intent.mjs:105`, `src/config.mjs` `CONFIG_KEYS`); the one entry
point that also accepts `DURIAN_PI_DB` is `scripts/clockin.mjs:379`, and it takes it first. A command carrying a
name the entry point ignores is not a harmless typo - it silently opens the fallback store (#5911, ROADMAP 191).
And name the FILE: a relative store path resolves against the cwd (`cli.mjs:161`), and an item worktree holds no
store at all (`git ls-files | grep -c sqlite` -> `0`, `.gitignore:2`), so either state "run this from the shared
root" or give the absolute path - a worktree reading of a store is a property of the tree, not of the rig (#6339).

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
