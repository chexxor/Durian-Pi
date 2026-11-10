---
runbook: stale-held-backlog
symptom: "an effort has stopped progressing with nothing broken: held rows sit unreleased after their gates finished, and nothing in status/attention says so"
writes: false                 # read-only audit + an intent spool to pm (never opens a writing Harness)
precondition: "read-only"     # safe with the broker up: `queue` reads are broker-served (D111); `intent.mjs` spools
last_verified: 2026-11-10        # the tool below was run against the live store; see Evidence
verified_by: devtools
evidence: "#6071 (the classifier and the tool); live audit 2026-11-10: 6,082 rows, 459 held -> 27 release-candidates, 7 cancel-candidates, 198 standing rules, 106 gate-open, 121 unattributed"
check_rule: demo/held-gate-audit.test.mjs
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

1. **Read the parked rows in ONE bounded pass** (the canonical read):

   ```bash
   DURIG_DB=./selfdev.sqlite node cli.mjs queue --held --with-gates --json > .spike/delegate/held-gates.json
   ```

   `--with-gates` answers **"was a gate recorded?"** - it cannot answer whether the gate is still closed,
   and it caps at 200 rows (`GATE_VIEW_CAP`), so a fleet-wide census needs the step below.

2. **Classify the held rows** - this is the "is the gate still closed?" pass, in one process (#6071):

   ```bash
   DURIG_DB=./selfdev.sqlite node tools/held-gate-audit.mjs --json .spike/delegate/held-audit.json
   ```

   Five classes, and the distinction is the whole point:
   - **release-candidate** - every gate the row names is `done`/`cancelled`, no trigger text, nothing else
     parks it. These are the orphan rows.
   - **cancel-candidate** - the row's own work has a `merge: land item-<id>` commit on main, or the artifact
     it asks for is already in the tree and contains what it names.
   - **standing-rule** - the row's text names an EVENT it waits for (a quiet window, an operator ruling, a
     branch that must land). A terminal gate id next to such a row proves nothing; the tool names the real
     condition and, for a branch gate, reports the git check it ran.
   - **gate-open** - at least one cited gate is still live. Not stale.
   - **unattributed** - nothing was written about why the row is parked (the #5770 class). Ask for a
     structured gate rather than calling it stale.

   If the broker is wedged and the read times out (`read queue-census: timed out awaiting the broker's
   result`), audit a COPY: `cp selfdev.sqlite .spike/delegate/audit.sqlite` - a copy has no broker state,
   so the read falls back to a local read-only harness open. Never open a second Harness on the live store.

   **The recorded park class (#6150) - read this, not the prose.** Every row parked through the ONE enqueue
   path or `hold_work` now carries `park: {class, basis, gateIds, recordedAt}` written at the moment it is
   parked, with `class` in the closed set `rule | gated-work | open-gate | unattributed` derived from STORED
   STRUCTURE (`blockedBy`, an authored `block`) and never from wording. The audit prints the counts by park
   class and lists every row where structure and prose disagree.
   - `rule` - an authored event park with no queue gate (reason + resolver, e.g. `schedule`/`operator`);
   - `gated-work` - it names queue gates and all of them were terminal when the park was written;
   - `open-gate` - it names queue gates and at least one was still live;
   - `unattributed` - nothing was recorded: no gate ids, no authored block. `legacyBlock` would GUESS a
     reason from the held status; the record says the guess is a guess.
   Rows parked before the field existed are NOT migrated (that is a project, not a fix), so their class is
   derived on the spot and labelled `parkSource: "derived-structure"`. A metric that counts "standing rules"
   must filter on the field: on the snapshot below 184 rows read as standing rules from trigger text while
   only 43 have an event park in their structure, and 239 rows disagree. The disagreement is the finding -
   do not resolve it by editing wording.

3. **For an effort you know by name, ask the pointed question** (the durable-TUI case):

   ```bash
   node tools/queue-rows.mjs 2096 2097 2098 2600 2626 2629 2630 2733 2788 2789 2797 2804 2826 < .spike/delegate/held-gates.json
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

- The audit exits 0 and prints `git landing commits read: <n>` (the git pass ran) and per-seat totals that
  add up to `held`.
- The rules are pinned by `node demo/held-gate-audit.test.mjs` (exit 0): a gate-cleared row, a still-open
  gate, a standing rule with no recorded gate, a branch-landing gate, a satisfied artifact and a
  file-exists-but-content-missing row are each classified differently. A classifier that flagged all of
  them the same way would pass nothing here.
- The park RECORD is pinned by the same file: a row whose prose says `DO NOT START` but whose only gate is a
  LIVE queue row is recorded `open-gate` and its `parkDisagreement` is reported, not swallowed; a row with
  nothing recorded derives `unattributed` and names what the status mapping would have guessed; an authored
  `schedule` park records `rule`. `node demo/hold-queued-row.test.mjs` (exit 0) pins the WRITE path: `hold_work`
  writes the class, `release_work` clears it, so a running row cannot be counted as parked.
  Falsifier, actually run (2026-11-10): commenting out `item.park = parkRecord(queue, item);` in the
  `hold_work` handler of `src/rig.mjs` makes `node demo/hold-queued-row.test.mjs` exit 1 on "the park class is
  recorded on the row"; restoring the line returns it to exit 0.
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
- **Structure and prose disagree on most rows** → expected while the population is unmigrated: prose-only
  parks record nothing, so `unattributed` is the honest class. Ask the owning seat to re-park with a
  `block` (reason + resolver) or `blockedBy` ids; never reword the subject to make the count look clean.
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
