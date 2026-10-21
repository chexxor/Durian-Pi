---
runbook: stale-held-backlog
symptom: "an effort has stopped progressing with nothing broken: held rows sit unreleased after their gates finished, and nothing in status/attention says so"
writes: false                 # read-only audit + an intent spool to pm (never opens a writing Harness)
precondition: "read-only"     # safe with the broker up: `queue` reads are broker-served (D111); `intent.mjs` spools
last_verified: 2026-10-19
verified_by: delegate
evidence: "INC-2026-10-19 held-rows-orphaned-by-cleared-gates; live audit 153 held rows / ~51 with terminal gates"
check_rule: null
---

# Stale held backlog — find and unstick parked work whose gates cleared

## When to use

- An effort you expected to be moving is not, and `status` shows no fault.
- The operator asks "what is the status of X?" and X turns out to be registered but parked.
- You are doing a periodic queue hygiene pass and want the parked rows classified.
- After an incident of the class in
  [`incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`](../incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md).

## Impact

Silent loss of forward progress. The work is *registered and correct*, so nothing looks wrong; only a
human noticing reveals it. Measured 2026-10-19: **153 held rows**, 113 to `impl`, median ~16 h held,
**49 rows >24 h**, and ~51 whose cited gates are already terminal.

## Preconditions

- None beyond the store. This is **read-only** against the store: `node cli.mjs queue` is served by the
  broker's own connection (D111), and `node intent.mjs` only writes a request file to the spool. Do **not**
  open a second writing Harness to inspect the queue.
- Resolve the store/rig pair first: `DURIG_DB=./selfdev.sqlite` (never a bare `cli.mjs`, which defaults to
  `rig.json`).

## Diagnose (read-only)

1. **Snapshot the queue** (the canonical read):

   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/delegate/queue-audit.json
   ```

2. **Classify the non-terminal rows.** The full script lives in
   [`WORK-ITEM-LIFECYCLE.md`](../WORK-ITEM-LIFECYCLE.md) §7 ("Auditing the queue"); it prints the status
   histogram and the **held rows whose cited gates are all terminal** — the orphan candidates.

3. **For an effort you know by name, ask the pointed question** (the durable-TUI case):

   ```bash
   python - <<'PY'
   import json, io
   d = json.load(io.open('.spike/delegate/queue-audit.json', encoding='utf-8'))
   for i in d['items']:
       if i['id'] in (2096,2097,2098,2600,2626,2629,2630,2733,2788,2789,2797,2804,2826):
           print('#%s %-9s -> %-9s %s' % (i['id'], i['status'], i['to'], (i['subject'] or '')[:90]))
   PY
   ```

4. **Check whether the gate items are actually terminal:**

   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin);m={i['id']:i['status'] for i in d['items']};print({k:m.get(k) for k in (2788,2789,2629,2799,2600)})"
   ```

5. **Check the git side for a "delivered but unlanded" doc** (a common partner symptom):

   ```bash
   git merge-base --is-ancestor <sha> main && echo "on main" || echo "UNLANDED"
   git branch -a --contains <sha>
   ```

## Do

The delegate does **not** claim, release, or route queue items. It classifies and delivers a routing fact
to `pm`; `pm` issues the transition. For each candidate:

1. **Read the body and confirm the hold reason** — the audit is a heuristic, not proof. A row may be
   legitimately gated on the operator (`#994` quiet window), a provider, or a roadmap intent that merely
   cites a terminal item.
2. **Decide the correct action:**
   - gate cleared, still right to do → `release_work(<id>)` (sender or recipient);
   - no longer worth doing → `cancel_work(<id>, reason)`;
   - genuinely still blocked → leave it, but ask `pm` to record `blockedBy` so it is queryable
     ([`WORK-ITEM-SCHEMA.md`](../WORK-ITEM-SCHEMA.md) R5) rather than prose.
3. **Spool the finding to `pm`** as an operator-authorized intent (never inline; never `send` while the
   broker drives):

   ```bash
   # write the body to a file first (a shell backtick must not be command-substituted — dogfood F1)
   DURIG_DB=./selfdev.sqlite node intent.mjs pm --body-file .spike/delegate/<name>.md \
     --request-id <stable-id>
   ```

   The body should name, per row: the id, the held reason, the gate and its status, the recommended
   transition, and the unlpocking action that follows (e.g. "landing list X is gated on this").
4. **Confirm delivery:**

   ```bash
   cat selfdev.sqlite.broker.inbox.out/<stable-id>.json      # {"ok":true,"delivered":true}
   tail -n 5 selfdev.sqlite.broker.log                        # INTENT delivered=1 dead=0 dup=0
   ```

## Verify

- The intent result file has `"delivered":true`.
- After `pm` acts, the targeted rows are no longer `held` (re-run Diagnose step 2 and watch the candidate
  count fall), and the dependent work is `queued`/`claimed`.
- If a doc was "delivered but unlanded", it appears on `main` after the landing window:
  `git cat-file -e main:<path> && echo present`.

## If it fails

- **`release_work` is refused** ("not held", "not yours") → the row was already moved or the wrong party
  is acting; re-read its `status` and `to`/`from`.
- **The gate id does not resolve** → the row's gate is prose referring to an item that never existed under
  that number; treat it as `manual` and hand it to `pm`.
- **The intent is dead-lettered** (`<db>.broker.inbox.error/`) → the broker rejected the body; read the
  `.reason` file, fix the body, re-spool with the same `--request-id` is **not** safe after a dead-letter
  (the broker may have partially applied it) — use a fresh id and note the original.
- **The broker is down** (`state` missing/stale) → no layer can apply a transition; recover the broker
  first ([`broker-down-or-stalled.md`](broker-down-or-stalled.md)).

## Escalate to

- `pm` — owns routing, releases, and `send_work`; all ActiveRecord transitions go through it.
- `lead` — when the *status model itself* is the blocker (e.g. a row that is legitimately parked but
  cannot be expressed without prose). The durable fix is
  [`reviews/queue-lifecycle-redesign.md`](../reviews/queue-lifecycle-redesign.md).
- The operator — when the gate is an operator decision (a quiet window, a pricing source, a secret
  rotation), not a team action.

## Evidence

- Incident: `docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`.
- Live audit (2026-10-19): 153 `held`, 113 to `impl`, median ~16 h, 49 >24 h, ~51 orphan candidates.
- The intent that unstuck the durable-TUI chain:
  `selfdev.sqlite.broker.inbox.out/operator-durable-tui-unblock-2026-10-19-1.json` (`delivered:true`).
- Model: `docs/WORK-ITEM-LIFECYCLE.md`; schema: `docs/WORK-ITEM-SCHEMA.md` §1/§4-R5.
