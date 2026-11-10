---
runbook: block-shape-refused
symptom: "a send_work carrying `block` dies: 'may only carry queue constraints', 'must look like RM-<n>', or 'reviewBy is mandatory for reason …'; or you are about to park a row and cannot tell which reason matches which constraint kind"
writes: false                    # a send goes THROUGH the broker; this procedure never opens a Harness
precondition: "none"
last_verified: 2026-11-10
verified_by: scribe
evidence: "item 5279; `node demo/queue-lifecycle-m1a.test.mjs` exit 0; the Diagnose probe below printed 3 REFUSED lines from src/queue-lifecycle.mjs normalizeBlock; env-name corrected to DURIG_DB (#5911, 2026-11-10, tree f192f543 - the CLI reads DURIG_DB: cli.mjs:155; only scripts/clockin.mjs:379 takes DURIAN_PI_DB); verify re-run: node demo/queue-lifecycle-m1a.test.mjs exit 0"
check_rule: null                 # no check rule covers block shape today — see Evidence
---

# A `block` was refused — the reason → constraint-kind pairing

## When to use

A `send_work` (or any park) carrying a `block` comes back refused, and the message names a remedy you
did not know:

- `a "dependency" block may only carry queue constraints; use "roadmap-gate" for a roadmap gate or a non-queue constraint`
- `roadmap constraint ref must look like RM-<n>, got "325"`
- `reviewBy is mandatory for reason "dependency" (use a date, or omit it for the default)`

Or you are authoring a park — a parked verify, a parked DECISIONS/ROADMAP row — and the reason and the
constraint kind have to agree but nothing states how.

## Impact

Nothing is corrupted: the validator refuses **before** anything is stored (`normalizeBlock` runs ahead of
`queue.items.push` in the one enqueue path, `src/rig.mjs:414`), so a rejected send **does not half-land**
— proven by `demo/queue-lifecycle-m1a.test.mjs` ("a malformed `block` through send_work writes NO item").
The cost is re-work and a **misleading queue**: each `send_work` is its own item and its own commit, so in
a batch the rows that passed **do land**, and the one row that was refused is simply missing. A reader
holding the gate then reads that absence as a deliberate decision not to register the dependency. Fix it
by **re-sending the whole rejected row**, not by editing the neighbours.

## Preconditions

The broker is up (a send is a submission, not a store write). No `Harness`-opening verb here, so no
stop-and-verify is needed.

## Diagnose (read-only)

Reproduce the refusal against the live validator — it prints the exact remedy, so read the message:

```bash
node -e "import('./src/queue-lifecycle.mjs').then((m) => { const t = [['bare-number roadmap ref', {reason:'roadmap-gate', resolver:'automatic', constraints:[{kind:'roadmap', ref:'325'}]}], ['roadmap constraint under dependency', {reason:'dependency', resolver:'automatic', constraints:[{kind:'roadmap', ref:'RM-325'}]}], ['null reviewBy on a clocked reason', {reason:'dependency', resolver:'automatic', constraints:[{kind:'queue', ref:'#1'}], reviewBy:null}]]; for (const [name, block] of t) { try { m.normalizeBlock(block); console.log('ACCEPTED  ' + name); } catch (e) { console.log('REFUSED   ' + name + ' -> ' + e.message); } } });"
```

Expected: three `REFUSED` lines with the three messages above (exit code is 0 — the probe catches them).

## Do

Author the park so the reason and the constraint kind agree. The rule is narrow: **`dependency` gates on
queue items only; a roadmap gate is its own reason, `roadmap-gate`.** Everything else is a pairing table.

| `reason` | constraints it may carry | `reviewBy` default |
|---|---|---|
| `dependency` | **≥ 1, and ALL `kind: "queue"`** (a `roadmap` or `window` constraint here is refused) | 7 d |
| `roadmap-gate` | **≥ 1 `kind: "roadmap"`**; `queue`/`window` may ride along | 7 d |
| `operator` | any kind, none required | 3 d |
| `schedule` | any kind, none required (a `window` constraint is the usual shape) | 14 d |
| `resource` | any kind, none required | 3 d |
| `manual` | any kind, none required | 7 d |
| `backlog` | any kind, none required | **no clock** (`null`) |
| `question` | any kind, none required | **no clock** (`null`) |

Ref shapes per kind (`src/queue-lifecycle.mjs:74-110`):

- `queue` — a queue-item id: `5272` or `#5272`, both normalized to `#5272`.
- `roadmap` — a string shaped **`RM-<n>`**, optional letter suffix, case-insensitive on input (`rm-325a`
  → stored `RM-325a`). A bare number (`"325"`) is refused.
- `window` — **no `ref`**; it needs a non-empty `note` (e.g. `"after the 11 Nov freeze"`).

`resolver` is always mandatory (a seat name, `operator`/`human`, `automatic`, `#<id>` or `RM-<n>`), and
`reviewBy: null` is accepted **only** for a reason whose default is `null` (`backlog`, `question`) — on a
clocked reason, give a date or omit the key and take the default.

Two worked shapes, both accepted by the live validator:

1. **A parked verify gated on a queue carrier** — the carrier is a queue item, so it is a `dependency`:

   ```json
   {"reason": "dependency", "resolver": "automatic", "constraints": [{"kind": "queue", "ref": "#5272"}]}
   ```

   (`resolver: "automatic"` because a terminal queue gate clears the park by itself.)

2. **A parked DECISIONS/ROADMAP row gated on a roadmap item** — the gate is a roadmap entry, so the reason
   is `roadmap-gate`, and the `ref` must be an `RM-<n>`:

   ```json
   {"reason": "roadmap-gate", "resolver": "RM-325", "constraints": [{"kind": "roadmap", "ref": "RM-325"}]}
   ```

Then **re-send the refused row whole**. Do not hand-edit the rows that already landed to point at it, and
do not "fix" it by dropping the constraint: a `dependency` stripped down to a prose note passes the
validator and stops being a gate, which is the defect this field exists to make unrepresentable.

## Verify

The shape rules are pinned by the demo — run it and it must pass:

```bash
node demo/queue-lifecycle-m1a.test.mjs
```

Expected: `PASS — M1a: …` and exit 0; the two lines that carry this runbook are `roadmap-gate without a
roadmap constraint → refused`, `dependency with a window constraint → refused`, `explicit null reviewBy on
a clocked reason → refused`, and `a malformed block through send_work writes NO item`.

Then confirm the re-sent row exists, with the gate you intended:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs queue
```

Expected: the re-sent item id is present, and its park shows the reason you authored (not a prose gate).

## If it fails

- A **different** message than the three above → read it literally and re-read the table; the validator's
  messages name the remedy (`must be one of dependency|question|…`, `a block must name a non-empty
  \`resolver\``, `a window constraint needs a non-empty \`note\``). The authority is
  `normalizeBlock` in `src/queue-lifecycle.mjs`.
- The row still refuses with `not yours` / `not held`-style wording → that is not a shape problem; that is
  `stale-held-backlog.md` (release/ownership) or `prepare-workspace-refused.md`.
- The row landed but the park is wrong (right shape, wrong gate) → cancel it (`cancel_work`) and re-send;
  a wrong gate reads as a real dependency to every reader of the queue.

## Escalate to

- `pm` — when the refusal is telling you the **row itself** is a roadmap item rather than work (a
  roadmap gate belongs in ROADMAP, and `roadmap-gate` parks a *work* row that waits on it).
- `lead` — when you genuinely need a constraint kind outside `queue | roadmap | window`; the vocabulary is
  in `src/queue-lifecycle.mjs:42` and adding one is a design change, not a docs change.

## Evidence

- Item **5279** (scribe): this runbook exists because a competent sender took two hard refusals from this
  validator in one turn and the pairing was written nowhere.
- Code: `normalizeBlock` / `normalizeQueueRef` / `normalizeRoadmapRef` / `normalizeConstraint`,
  `src/queue-lifecycle.mjs:74-190`; `REVIEW_BY_DAYS` at `src/queue-lifecycle.mjs:52-61`; the send-time
  position of the check at `src/rig.mjs:414` (validate) vs `:416` (`push`).
- Test: `node demo/queue-lifecycle-m1a.test.mjs` → **exit 0**, run 2026-11-07 in the isolated worktree
  `item-5279` (that tree reported `DEPENDENCY NOT LINKED`, resolving `@earendil-works/pi-durable` 1.3.0
  from the lockfile; this demo uses the faux provider and an in-memory store, so the verdict is not
  dependency-sensitive — state the tree anyway).
- Diagnose probe output 2026-11-07: 3 × `REFUSED` with the exact messages quoted above.
- **Why there is no `check_rule`:** nothing re-tests block shape after the fact — `src/checkup.mjs` has 0
  hits for `roadmap-gate`/`normalizeBlock` (measured 2026-11-07). The validator runs at **send time**, on
  the one enqueue path, which is the only place a malformed park can be caught before it is stored; a
  post-hoc rule would re-test a shape the write path already refuses.
