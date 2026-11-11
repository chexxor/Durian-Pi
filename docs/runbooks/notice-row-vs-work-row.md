---
runbook: notice-row-vs-work-row
symptom: "a row whose subject starts `CANCELLED #<id>:` was claimed, or the queue says a cancelled item is done"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: scribe
evidence: "item #6343; demo/curate.test.mjs, demo/cancel-notifies-sender.test.mjs, demo/wake-claimability.test.mjs (all exit 0)"
check_rule: null
---

# A notice row is not the work row

## When to use
You see a queue row whose subject begins `CANCELLED #<id>:` (or `DONE #<id>:`) and you are unsure whether
that row is the work itself, or a message *about* the work. Same for the report "a cancelled item was
claimed and marked done".

## Impact
`cancel_work` terminates the work row and then mints a **second, live row** — the notice. If the notice is
read as the work row, three things go wrong: a seat spends a turn "completing" a message; a coordinator
reports the cancelled work as resurrected; and a dependent row gated on the cancelled id stays parked,
because a cancelled gate can never be satisfied.

## Preconditions
Read-only. **Run from the shared repo root, not from an item worktree.** Measured 2026-11-11: in
`item-6339`'s worktree, `DURIG_DB=./selfdev.sqlite node cli.mjs status` reported
`db: /home/chexxor/Git/Durian-Pi/item-6339/selfdev.sqlite`, exit 1, cause `no_store` — a relative name
resolves against the worktree's cwd, and no store is tracked in the repo (`git ls-files | grep -c sqlite`
→ `0`). See `store-probe-identity.md` §"WHICH selfdev.sqlite".

## Diagnose (read-only)
Run these in the **shared repo root**, not in an item worktree (see the Preconditions section):

```bash
node cli.mjs status --json
DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/delegate/queue-audit.json
```

The first line exits 0 and its `db` field names the store THIS cwd resolves to; the second dumps every
row so the snippet below can pick out the notice rows.

Then pull the notice rows out of that dump (a multi-line construct, so CI reports it as a gap rather
than running it):

```bash
python - <<'PY'
import json, io
d = json.load(io.open('.spike/delegate/queue-audit.json', encoding='utf-8'))
byid = {i['id']: i for i in d['items']}
for i in d['items']:
    s = i.get('subject') or ''
    if s.startswith(('CANCELLED #', 'DONE #')):
        named = int(s.split('#', 1)[1].split(':', 1)[0])
        print(f"notice #{i['id']} status={i['status']} to={i['to']} names work #{named} status={byid[named]['status'] if named in byid else 'absent'}")
PY
```
A notice row's own status is `queued` (or `claimed`/`done` once someone works it); the **cancelled** status
belongs to the id named in the subject. That distinction is the whole read.

## Do
1. **Do not claim a notice expecting work.** It is claimable by design (`send_work`'s notice path,
   `src/rig.mjs:217-224`); read it, then complete it with a one-line result.
2. **If the work must still happen, mint a new row.** A `cancelled` row is terminal and cannot be revived
   (`isTerminalItem`, `src/rig.mjs:275`; both claim paths require `status === "queued"`, `src/rig.mjs:351`
   and `:856`).
3. **Fix the gate, not the wording.** A dependent row gated on a cancelled id is not waiting — it is
   orphaned. `release_work` refuses to un-park it (`src/rig.mjs:1346-1347`) and `workable` answers
   `gate-cancelled:#<id>` (`src/rig.mjs:332`). Attach a live gate or cancel the dependent:
   `runbooks/attach-a-gate.md`.
4. **Do not treat "terminal" as "satisfied"** when auditing: `derivePark` counts `done` and `cancelled`
   together (`src/queue-lifecycle.mjs:426`, `:448`), the claim predicate does not.

## Verify
```bash
node demo/curate.test.mjs                 # exit 0: "a cancelled item never wakes its seat"
node demo/cancel-notifies-sender.test.mjs # exit 0: the CANCELLED #<id> notice is enqueued
node demo/wake-claimability.test.mjs      # exit 0: "cancelled gate: 0 wakes"
```
All three exited 0 on 2026-11-11 against `main 35001c3a`.

## If it fails
If you find a row whose stored status is genuinely `cancelled` and which was nonetheless claimed, that
contradicts `src/rig.mjs:351`/`:856` — capture its `transitions` array from the queue dump and escalate;
do not assume it is a notice.

## Escalate to
**impl** for the claim predicate (`src/rig.mjs`), **pm** for the queue census and the parked-row release.

## Evidence
Item #6343 (`docs/WORK-ITEM-LIFECYCLE.md` §2, fact 4, added 2026-11-11); the three demos named in Verify,
run in worktree `item-6343` off `main 35001c3a`, all exit 0.

The Diagnose snippet was exercised on a crafted three-row dump (exit 0): it printed
`notice #6252 status=queued to=scribe names work #6251 status=cancelled`. It has **not** been run against
this rig's live store — no store is tracked in the repo (`git ls-files | grep -c sqlite` → `0`), and a
relative `DURIG_DB` path resolves inside an item worktree, not the shared root (see `store-probe-identity.md`).
A reader running it against the real store gets the same shape of output; if the dump's item shape differs,
report it rather than trusting this page.
