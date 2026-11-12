---
runbook: stale-held-backlog
symptom: "an effort has stopped progressing with nothing broken: held rows sit unreleased after their gates finished, and nothing in status/attention says so; ALSO: a queued row can NEVER be claimed and the scan says `gate-cancelled:#<id>""
writes: false                 # read-only audit + an intent spool to pm (never opens a writing Harness)
precondition: "read-only"     # safe with the broker up: `queue` reads are broker-served (D111); `intent.mjs` spools
last_verified: 2026-11-11        # the tool below was run against the live store; see Evidence
verified_by: devtools (2026-11-10 audit); scribe (2026-11-11 re-run of Diagnose step 2 and the schema-message entry)
evidence: "#6071 (the classifier and the tool); live audit 2026-11-10: 6,082 rows, 459 held -> 27 release-candidates, 7 cancel-candidates, 198 standing rules, 106 gate-open, 121 unattributed. Re-run 2026-11-11 by scribe (#6315) in the `item-6315` worktree with UNLINKED deps (pi-durable **1.3.0** from the lockfile): live store exit **0** `rows=6502 held=434`, `git landing commits read: 153`; a worktree-local copy exit **0** `rows=6501 held=434`, same 153. The schema-version refusal did NOT fire in that tree — see If it fails. Umbrella section (#6216): re-verified 2026-11-10 by scribe - `node demo/workable-claim.test.mjs` exit 0, and the store read of #2465/#6123/#6122 below. Release-authority section (#6112, 2026-11-10, impl): `node demo/pm-release-authority.test.mjs` exit 0 in an item worktree with dependencySet built-pin; the same file against `git archive HEAD src` exits 1 with "only the sender or recipient may release it" and the row left held"
check_rule: demo/held-gate-audit.test.mjs
---

# Stale held backlog — find and unstick parked work whose gates cleared

## When to use

- An effort you expected to be moving is not, and `status` shows no fault.
- The operator asks "what is the status of X?" and X turns out to be registered but parked.
- You are doing a periodic queue hygiene pass and want the parked rows classified.
- After an incident of the class in
  [`incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`](../incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md).
- **A row that can never be claimed**: the oldest-workable scan reports `gate-cancelled:#<id>` for a
  `queued` row, and the id it names is a **container** (an umbrella registration), not work.
- You are closing an umbrella and are about to `cancel_work` it.

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
   - gate cleared, still right to do → `release_work(<id>, reason)` (sender or recipient; since **#6112** a
     **coordinating** seat - one declaring no working capability, in this rig `pm` and `lead` - may release a
     parked row it did not mint, and must state the reason. Release is delegable because it is reversible;
     cancel and revise are not, and stay with the parties);
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

## Umbrella rows are pointers, never gates - close them, do not cancel

**Symptom you are searching for:** "a row can never be claimed" / "why is this dependent stuck". The
oldest-workable scan (`selectOldestWorkable`, `src/rig.mjs`) skips the row and prints a reason naming a
container id.

**The machine rule** - `workable()`, `src/rig.mjs:303`, gate loop at `:309-316`. For every id in
`blockedBy`:

| gate target's status | verdict | reason string |
|---|---|---|
| `done` | workable (gate satisfied) | - |
| `cancelled` | NOT workable, **permanently** | `gate-cancelled:#<id>` |
| `queued` / `claimed` / `held` | NOT workable, until it finishes | `gate-open:#<id>(<status>)` |
| no such item | workable (conservative default) | - |

`cancelled` is terminal (`src/checkup.mjs:192`, `TERMINAL_STATUSES = {"done","cancelled"}`) and can never
become `done`. So a gate naming a cancelled id is closed forever: the dependent is not delayed, it is
starved. That is the difference between closing and cancelling a container.

**The convention (lead's ruling, #6214, from the disposition of #2465):**

1. An umbrella row is a **pointer to an audit**, not a dependency. **Never** put an umbrella id in a
   `blockedBy` list.
2. When every child is individually registered with its own owner, the umbrella **CLOSES** -
   `complete_work(<id>, "tracking row processed; nothing landed here")` - it does **not** `cancel_work`.
   Cancelling the container turns every dependent into a permanently unclaimable row.
3. If a dependent genuinely waits on the container's content, gate on the **child that carries the work**,
   not on the container.

**Worked example - #2465 (the container that was done right).** Registered 2026-10-19 by `pm` to `lead`
as "DOCS TRUTH-UP (2026-10-19) - umbrella registration (do not start)", status `held`, **no `blockedBy`
recorded on it**: a container owns no gate. Its six children are each individually registered with an
owner - #2458 scribe, #2459 devtools, #2460 impl, #2461 scribe, #2462 impl, #2463 scribe - so the
container adds a wake and a claim slot without adding work. `lead` released it (`released` transition
2026-11-10T09:03:47Z), claimed it, and closed it; the disposition reached `pm` as #6214.

**The counter-example, live at the time of writing.** #6123 (`pm` -> `scribe`) carries
`blockedBy:[6122]`, and #6122 is `cancelled` - so the scan reports `gate-cancelled:#6122` and that row is
never claimable. Same family, same failure: `docs/reviews/security-5269-landing-correction.md` §5 names
#3747 (gate naming a cancelled/superseded id) and #3863 (gate bound to a cancelled twin). Verified again
2026-11-11 (#6315): the queue document records **no status transition** for #6123 since creation, so it is
still `queued` behind the cancelled #6122.

**The git-ref variant of the same starvation.** A row parked on "<a branch> lands" is unsatisfiable once the
ref is gone: measured 2026-11-11 in the `item-6315` worktree, `git rev-parse item-5211` exits **128** and
`git rev-parse refs/heads/item-5211` exits **128**. `blockedBy` gates see queue-item ids only, never git refs,
so the predicate cannot detect this; the audit's **standing-rule** class is what names the real condition
(`docs/WORK-ITEM-LIFECYCLE.md`), and Diagnose step 5 is the git check that proves it.

**Unverified, stated as a gap:** there is **no `check` rule** that detects this shape today. The rule was
registered as #3747 ("check rule for a NON-TERMINAL item whose `blockedBy` names a CANCELLED/SUPERSEDED
id") - that row is still `held` (created `held`, never transitioned), and `src/checkup.mjs` contains no
such rule (grep `blockedBy` in it returns nothing). The convention is therefore **prose plus the
`workable()` behaviour**, not enforcement.

## The LANDING rows: which are already on main, row by row (#7291)

`tools/queue-drain-audit.mjs` counts `LANDING (LIST|ENTRY)` rows whose cited shas sit in main's history.
A count is not closable evidence: pm can only close rows it can see one at a time. This instrument
prints the per-row proof:

```bash
node tools/probes/landing-ancestry-evidence.mjs --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite \
  --out tools/probes/landing-ancestry-evidence.json
```

Per row it records every cited token, its object type, `git merge-base --is-ancestor <full-sha> refs/heads/main`
exit code (0 = ancestor), membership in `git rev-list refs/heads/main`, the commit subject of the cited
commit, its `blockedBy` gates and their states, and whether the row is itself a gate for another row.

Three rules the sweep must honour, and the measurement behind each:

1. **Ancestors are not artifacts.** For a commit sha, being an ancestor of main is landing. For a
   *branch tip* it is not: it proves the commits are in main's history, not that a generated file named
   on that tip is merged. Rows that name a branch and no sha are reported with the ref's tip and its
   ancestry exit code as a LEAD, never as a verdict.
2. **A row whose gate names another row is not correspondence.** Rows with a `blockedBy` gate, or that
   are the target of another non-terminal row's gate, are excluded from the closable set. Measured
   2026-11-12 (main `a7c9ab0`): 193 non-terminal LANDING rows, 146 with every cited commit in main,
   **117 closable**, 26 held by their own gate, 6 gating another row, 6 citing no sha at all.
3. **The audit's citation floor has a blind spot.** `queue-drain-audit.mjs` counts a token as a sha only
   if it carries a digit *and* a letter, so a real 7-character abbreviation made only of digits
   (`@4357707` in #3673, `@1381612` in #5765) is dropped, and those rows look like they cite nothing.
   Conversely a date like `20261029` matches the same regex. Resolution decides: a token counts only if
   `git cat-file -t` says it is an object, and the landing claim rests only on commits. The probe prints
   both counts (`auditFloorVariantClosable` 140 vs 146 by resolution) so the difference is visible
   rather than silently changing the number.

Run against main `a7c9ab0` on 2026-11-12 by qa, exit **0**.

## Verify
- **The landing-ancestry probe runs and its own numbers are internally consistent** (run 2026-11-12 by qa, exit **0**):

  ```bash
  node tools/probes/landing-ancestry-evidence.mjs --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite --out .spike/delegate/landing-ancestry.json; echo "exit=$?"
  ```

  It printed `LANDING rows non-terminal: 193`, `every cited sha in main's rev-list: 146`, `closable ... 117`,
  and `methods disagree 0` - the two methods (`rev-list` membership and `merge-base --is-ancestor`) agreed on
  every row, which is the check that the count is not an artefact of one git command.


- The audit exits 0 and prints `git landing commits read: <n>` (the git pass ran) and per-seat totals that
  add up to `held`. Re-run 2026-11-11 (#6315), exit **0**:

  ```bash
  node tools/held-gate-audit.mjs --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite --limit 3; echo "exit=$?"
  ```

  header `rows=6502 held=434`, line `git landing commits read: 153`. State which tree and which pi-durable
  produced the verdict: this was an UNLINKED worktree (lockfile 1.3.0), and the same tool on a copy inside
  that worktree also exited 0 (`rows=6501 held=434`).
- **The schema-version entry is reachable from the symptom index**, not only from the rule text (run 2026-11-11, exit 0):

  ```bash
  grep -n "newer than supported version 1" docs/runbooks/README.md; echo "exit=$?"
  ```
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
- **The umbrella rule is pinned by a demo** (run 2026-11-10, exit 0):

  ```bash
  node demo/workable-claim.test.mjs; echo "exit=$?"          # exit 0
  ```

  Its assertion reads `a gate on a CANCELLED item is NOT workable (terminal != done)` and
  `...reason is gate-cancelled` (`demo/workable-claim.test.mjs:74-75`).
- **The release authority is pinned by a demo** (run 2026-11-10, exit 0, #6112):

  ```bash
  node demo/pm-release-authority.test.mjs; echo "exit=$?"   # exit 0
  ```

  It asserts all four shapes separately: a coordinator release with a reason succeeds and records
  `releasedBy=<seat> reason=<why>` in the queue line; a coordinator release without a reason is refused and
  leaves the row held; a non-party working seat is refused by authority; and a release whose gate names a
  CANCELLED row is refused. Falsifier: on HEAD (`git archive HEAD src` into a scratch tree) the same
  coordinator release answers "only the sender or recipient may release it" and the row stays `held`.
- **The entry is reachable from the symptom index, not only from the rule text** (run 2026-11-10, exit 0):

  ```bash
  grep -n "never be claimed" docs/runbooks/README.md; echo "exit=$?"
  ```

  It prints the README Index (symptom) row that points at this runbook. A grep that finds the phrase only
  in this file and not in the README means the index row was not added - the rule is then undiscoverable.

## If it fails

- **`release_work` is refused** ("not held", "not yours", "must carry a reason") → the row was already moved,
  the wrong party is acting, or a coordinator released without saying why; re-read its `status` and `to`/`from`.
  If it refuses with "its gate names #<id>, which is cancelled", the row is not stale-held - it is the
  umbrella-as-gate failure below: fix the gate (or close the container) before un-parking it, otherwise you
  un-park a row that cannot be claimed.
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
- **`cannot open <db>: Durable SQLite schema version 2 is newer than supported version 1`** → a dependency
  failure, not a store failure and not a wedged broker. `src/readclient.mjs:187` tries `openReadOnlyStore`
  (`src/readonlystore.mjs`: a `node:sqlite` `readOnly: true` open that claims no ownership and migrates
  nothing) FIRST; only if that throws does it fall through to `openNodeSqliteStorage` (`src/readclient.mjs:207`),
  which migrates and refuses a store whose `durable_schema.version` exceeds what the installed package
  supports. Both halves measured 2026-11-11: `node_modules/@earendil-works/pi-durable/dist/storage/sqlite/migrations.js`
  declares exactly one migration, `version: 1`, and the live store's `durable_schema` row reads
  `{singleton: 1, version: 2}`. The remedy is the pin/build ladder in [`pi-pin-update.md`](pi-pin-update.md),
  **not** a store repair. Keep it separate from the broker shape (`read queue-census: timed out awaiting the
  broker's result`) — both currently read as "cannot read the store" and need different responses; naming the
  observed and supported versions is what turns it into a diagnosis (registered as **#6314**, devtools, gated
  on **#6175** — that half is still OPEN). Measured state as measured: in the `item-6315` worktree the refusal
  did **not** fire; the audit read both the live store and a worktree-local copy at exit 0. Anyone who hits it
  must name the tree and the pi-durable version, per [`worktree-unlinked-deps.md`](worktree-unlinked-deps.md).

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
