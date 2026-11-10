# Work-item lifecycle — the queue's states, who may move them, and why work gets stuck

**Authority.** This is the canonical **lifecycle** model for a queue item: its statuses, the legal
transitions between them, the seats/tools allowed to make each move, what wakes a seat, and what makes a
stuck item visible. It is the companion to [`WORK-ITEM-SCHEMA.md`](WORK-ITEM-SCHEMA.md), which owns the
item's **identity** (ids, titles, `kind`, `blockedBy`); this document owns its **behaviour**.

A delegate or seat arriving cold should read this file *before* trying to unstick anything: the shapes
below explain why a row can be registered, correct, and still invisible.

| | |
|---|---|
| `last_verified` | 2026-10-19 |
| `verified_by` | delegate |
| Evidence | live store (2,961 items), `src/rig.mjs`, `src/driver.mjs`, `src/attention.mjs`; every number has a command in §10 |

---

## 1. The record

A queue item is a document in `RigQueue` (`src/rig.mjs`) with the fields listed in
[`WORK-ITEM-SCHEMA.md`](WORK-ITEM-SCHEMA.md) §2. The lifecycle-relevant ones are:

| Field | Role in the lifecycle |
|---|---|
| `id`, `from`, `to` | identity and the two parties who may move it |
| `status` | the lifecycle state (§2) |
| `question`, `deferredTo` | set when `deferred` (§2, §5) |
| `heldReason` | free prose set when `held` — **not** machine-read |
| `cancelReason` | why a terminal `cancelled` item is terminal |
| `transitions` | append-only audit trail; the only history |
| `notice` | structural: a notification, not work |

`status` and `transitions` are the source of truth. A title that repeats a status is drift, not data
(WORK-ITEM-SCHEMA R2/R4).

## 2. The state machine

Six statuses. **Terminal** means `done` **or** `cancelled` (both are invisible to the driver and to any
"non-terminal work" view — `isTerminalItem`, `src/rig.mjs:181`).

```
                 send_work
                    │
                    ▼
   send_work(held) ┌─────────┐   release_work      ┌────────┐
   ───────────────►│  held   │───────────────────► │ queued │
                   └─────────┘   (sender or        └────┬───┘
                        ▲         recipient)            │ claim_work
                        │                               ▼
                   hold_work                       ┌─────────┐
                        │                         │ claimed │
                        └─────────────────────────┤         │
                                        defer_work└────┬────┘
                                            │           │ complete_work
                                            ▼           ▼
                                     ┌──────────┐    ┌──────┐
                                     │ deferred │    │ done │  (terminal)
                                     └────┬─────┘    └──────┘
                                          │ resume_work
                                          └──────────► claimed
                                   cancel_work ──► cancelled  (terminal, from ANY non-terminal)
```

| From | To | Tool | Who may do it |
|---|---|---|---|
| — | `queued` | `send_work` | any seat with an org edge to the recipient |
| — | `held` | `send_work({held:true})` | the sender; creates the row unclaimable + non-waking |
| `queued` | `claimed` | `claim_work` | the recipient (oldest-first, or `{itemId}`) |
| `claimed` | `done` | `complete_work` | the claimer |
| `claimed` | `deferred` | `defer_work` | the claimer (sets `question` + `deferredTo`) |
| `deferred` | `claimed` | `resume_work` | the claimer (once answered) |
| `claimed` | `held` | `hold_work` | the claimer |
| `held` | `queued` | `release_work` | **the sender or the recipient** (`src/rig.mjs:783`) |
| any non-terminal | `cancelled` | `cancel_work` | the sender or the recipient |

Two facts a reader must internalise:

1. **`held` has exactly two exits: `release_work` → `queued`, or `cancel_work` → `cancelled`.** There is
   no automatic exit and no other tool. A held row nobody releases is a held row forever.
2. **`deferred` is not stuck in the same way.** A `deferredTo: <seat>` deferral *enqueues a `QUESTION`
   item* to that seat, which the driver wakes (`defer_work`, `src/rig.mjs:663-713`). A
   `deferredTo: human` deferral enqueues nothing but is surfaced by attention (§5).

## 3. Why `held` exists at all (and why it is the orphan shape)

`held` was added so a "registered, do not start" **backlog/roadmap registration** could sit in the queue
*without* starving a working seat: it is unclaimable, and it never takes the seat's oldest-first claim
slot (`src/rig.mjs:338-349`). It does still generate a wake — the `parked` one (§4) — so the seat learns
the row exists instead of polling for it. That is the correct tool for a genuine backlog row. It is the wrong tool for
"waiting on a thing that will finish by itself", because:

- The hold reason is **free prose** (`heldReason`), so nothing can query whether the reason still holds.
- The gate is **prose in the subject/body** ("gated on #2788"), which WORK-ITEM-SCHEMA §1 measures as
  unqueryable at scale (325 prose gates, 69 resolvable).
- **Gate completion does not propagate.** Completing `#2788` does not touch a row that says "gated on
  #2788"; cancelling a gate is even worse — the dependent can outlive it and still read as "blocked".
- **No ownership of the park.** The row names the seat that will *do* the work, not who *releases* it,
  nor a review date.

The result (measured 2026-10-19): **153 held rows**, 113 of them `impl`; median **~16 h** already held,
**49 rows >24 h**, max ~75 h. About **51** of them name a gate whose cited items are all already terminal.
See [`incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`](incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md).

## 4. Liveness — what actually wakes a seat

The driver wakes a seat for three conditions (`selectWakes`, `src/driver.mjs:71-130`):

- **`hasQueued`** — a `queued` item addressed to it (suppressed while `paused`), or
- **`hasStalledClaim`** — a `claimed` item it holds with no in-flight submission, no live lease, and no
  operator stop,
- **`hasParked`** — no queued work AND no stalled claim, but the seat has at least one non-terminal
  `held` or `deferred` row. This is #4607: a parked row is not a claim offer, yet silence left the seat
  polling, so it gets its own wake that names the state instead of advertising work.

Each reason carries its own FIXED wake body so the seat is never told to do something its queue refuses:
`WAKE_CONTENT` (queued), `WAKE_CONTENT_STALLED` (stalled claim), `WAKE_CONTENT_PARKED` (parked rows only)
— `src/driver.mjs:21-56`. They are constants, not per-item strings, because the wake is committed as a
user entry and a varying body would zero the prompt cache (ROADMAP 33).

**Known wording gap, not fixed here:** the `send_work` tool descriptions in `src/rig.mjs` still say a held
item is "unclaimable and un-waking" (`src/rig.mjs:635`) and "unclaimable and no wake" (`src/rig.mjs:686`).
Those two sentences disagree with `selectWakes` above, and the code wins: a held row is unclaimable but does
produce the `parked` wake. Correcting the tool text is a `rig.mjs` change, so it is routed to the seat that
owns that file rather than patched in a docs commit.

All three are suppressed if a submission is already pending for the seat's conversation, or the seat is
busy. Proven by `node demo/held-item.test.mjs` (exit 0), which asserts "a HELD item wakes its seat" and
that the wake's `reason` is `parked`.

So:

> A `queued` item eventually wakes its seat. A `claimed`-but-stalled item re-wakes its seat. A `held` item
> wakes nobody to CLAIM — it wakes its seat only to say the row is parked; it becomes claimable through
> `release_work`. A `deferred` item wakes its seat the same parked way, plus a `QUESTION` item is queued to
> the seat named in `deferredTo` (§3), and `deferredTo: human` is surfaced by attention (§5).

## 5. What is surfaced — the attention kinds

`src/attention.mjs` derives a small set of kinds for `status`/`watch`. They are the operator-visible
early-warning system:

| Kind | Fires for |
|---|---|
| `deferred_awaiting_answer` | a `deferred` item, sharpened to human vs seat (`src/attention.mjs:359-366`) |
| `repeated_failure` | a seat failing repeatedly |
| `malformed_tool_call` | a degenerate tool call |
| `last_run_failed` | the seat's last run failed (e.g. `no_model`) |
| `admitted_not_started` | a submission placed but no slot held |
| `idle_with_queued_work` | a seat with `queued` work that is not running |

**There is no kind for a stale park.** No `gate-cleared-unreleased`, no `parked-review-due`, no
`orphan-no-progress`. `deferred` is covered only incidentally (its kind is about *answering*, not about
*staleness*); `held` is covered by nothing. This is the detection gap the redesign closes
([`reviews/queue-lifecycle-redesign.md`](reviews/queue-lifecycle-redesign.md) §4).

**Streaming caveat (CR-2, adopted in the advocate's closure of the queue-lifecycle redesign; rule-id wiring is
#3023).** Everything above is a **state snapshot**: a kind is rendered because the state is true now, not because an
event happened. If/when a surface **streams** queue-scoped attention kinds — a robot consumer or the TUI live view
rendering them continuously rather than on a poll — **per-epoch dedup is mandatory before that surface ships**: one
fire per epoch per item. Without it the same state is re-emitted every pass, the snapshot becomes a nag stream, and the
operator can no longer tell a new fact from a repeat. This is a precondition on future work, not a description of code
that exists today: no streaming consumer of these kinds is built, and `computeQueueAttention` is not in `src/` as of
this reading (`grep -rn "computeQueueAttention" src/ demo/` → no matches, exit 1).

## 6. The stuck taxonomy (say which one, then act)

| Shape | How to recognise it | Is it surfaced? | Correct response |
|---|---|---|---|
| **Queued, unclaimed** | `status: queued` | yes (`idle_with_queued_work`) | wait for the owner's next wake, or `pm` re-routes |
| **Stalled claim** | `claimed` + no live lease + no pending submission | yes (re-wake) | the driver re-wakes automatically; a human fixes only a broken seat |
| **Deferred on a seat** | `deferred`, `deferredTo: <seat>` | yes | the question item is queued to that seat; `pm` chases if unanswered |
| **Deferred on the human** | `deferred`, `deferredTo: human` | yes (`deferred_awaiting_answer`) | the operator answers; the seat `resume_work`s |
| **Held, genuinely blocked** | `held` + a `blockedBy`/prose gate that is still non-terminal | **no** | leave it; it releases when the gate lands |
| **Held, gate cleared (orphan)** | `held` + all cited gates terminal | **no** | **release it** (`release_work`) or cancel it |
| **Held, pure backlog registration** | `held` + no gate, a roadmap/backlog intent | **no** | leave it (or move the intent to the roadmap ledger) |
| **Held, window-gated** | `held` + "operator window"/"do not start" | **no** | leave it; it is waiting on the operator, not the rig |

The dangerous rows are the middle three: they are identical to `status` and differ only in meaning that
lives in prose. §7's audit is how you tell them apart.

## 7. Auditing the queue (read-only)

The canonical read is the broker-served queue snapshot. Do **not** open a second writer (D111):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/delegate/queue-audit.json
```

Then classify non-terminal rows (a self-contained report; run from the repo root):

```bash
python - <<'PY'
import json, io, re, collections
d = json.load(io.open('.spike/delegate/queue-audit.json', encoding='utf-8'))
items = d['items']; byid = {i['id']: i for i in items}
print('status histogram:', dict(collections.Counter(i['status'] for i in items)))
gate = re.compile(r'(GATED|release when|gated on|SEQUENCE AFTER|behind|prerequisite)', re.I)
ref = re.compile(r'#(\d{1,4})')
cleared = []
for i in items:
    if i['status'] != 'held':
        continue
    hay = (i['subject'] or '') + ' ' + (i['body'] or '')
    if not gate.search(hay):
        continue
    cited = {r: byid[r]['status'] for r in {int(x) for x in ref.findall(hay)} if r in byid and r != i['id']}
    if cited and all(s in ('done', 'cancelled') for s in cited.values()):
        cleared.append(i)
print('held rows whose cited gates are all terminal (orphan candidates):', len(cleared))
for i in cleared:
    print('  #%s -> %s  %s' % (i['id'], i['to'], (i['subject'] or '')[:90]))
PY
```

**Read the result as a lead, not as proof.** A cited gate can be a false positive: a row legitimately
gated on the *operator* (e.g. `#994` quiet window) or on a roadmap intent may cite a terminal item
incidentally. Confirm each candidate against its body before releasing.

### 7a. The RECORDED park class (#6150) - filter on structure, never on wording

The scan above reads prose. That is the defect #6140 names: a metric built on trigger text can be moved by
wording, so it may ACCEPT a classification but must not DECIDE one. Every row parked through the one write
path (`send_work(..., held: true)` or `hold_work`) now carries a field:

```jsonc
"park": { "class": "open-gate", "basis": "queue gate(s) #3 still live", "gateIds": [3], "recordedAt": "..." }
```

`class` is one of four, decided from stored structure - `blockedBy` ids and an authored `block` - and never
from text:

| class | what it means |
|---|---|
| `rule` | an authored event park with no queue gate: reason + resolver (a schedule, an operator window, a roadmap gate). This is the shape that should eventually live in a doc, not the queue (#6140 destination). |
| `gated-work` | it names queue gates; all of them were terminal when the park was written. |
| `open-gate` | it names queue gates; at least one was still live. Real work, still waiting. |
| `unattributed` | nothing was recorded: no gate ids, no authored block. `legacyBlock` would GUESS a reason from the held status - the record says the guess is a guess. |

Read it with the audit, which prints the counts per class and lists every row where structure and prose
disagree:

```bash
node tools/held-gate-audit.mjs --json .spike/delegate/held-audit.json   # exit 0
```

Measured on a copy of this rig's store on 2026-11-10 (434 held rows): audit classes 23 release-candidate /
8 cancel-candidate / 184 standing-rule / 105 gate-open / 114 unattributed; park classes 43 rule /
64 gated-work / 83 open-gate / 244 unattributed; **239 rows disagree**. Zero rows carry the field yet - no
row is migrated in this change - so every class above is derived from stored structure and labelled
`parkSource: "derived-structure"`. The disagreement is the finding: 184 rows read as standing rules from
wording while 43 have an event park in their structure.

**Migration is a separate project, and it has a hard constraint** (#6140, lead's ruling): a rule moved out
of the queue must land in a doc that names a retrievable source, migrated by cluster where the rule is
actually used, never in one pass - dumping 192 rows into `DECISIONS.md` creates exactly the duplicate-entry
problem #5568 exists to prevent.

## 8. Unsticking decision tree

1. **Is the row `held`?**
   - Gate still pending → leave it; optionally ask `pm` to record `blockedBy` (schema R5) so it becomes
     queryable.
   - Gate cleared, or the hold is stale → the sender or recipient runs `release_work(<id>)`. On the
     delegate's side this is a **routing fact delivered to `pm`** (the delegate does not do seat work);
     `pm` issues the release.
   - No longer worth doing → `cancel_work(<id>, reason)`. Terminal rows never reappear.
   - A pure backlog/roadmap registration → leave it in `held`, or move the intent to the roadmap ledger
     (WORK-ITEM-SCHEMA §11) so the queue stops carrying long-lived parks.
2. **Is the row `deferred`?**
   - `deferredTo: <seat>` → the question item is queued to that seat; chase the seat, not the item.
   - `deferredTo: human` → this is an operator input; surface it (it already appears in `attention`) and
     answer it, after which the owner `resume_work`s.
3. **Is the row `queued` but nobody moves?** → check the seat is alive (`ps`, `status`); the driver
   rewakes `queued` work, so "queued forever" means the seat is down or paused, not the item.
4. **Is the row `claimed` but stalled?** → the driver's stalled-claim re-wake handles it (ROADMAP 42);
   if it persists, the seat is broken — see [`runbooks/seat-reset.md`](runbooks/seat-reset.md).

The delegate's lever for 1–3 is an **intent to `pm`** (`node intent.mjs pm --body-file <file>`), because
`pm` owns routing and release. The delegate verifies the outcome; it does not claim or release items
itself.

## 8a. Your WORKTREE is ephemeral — your BRANCH is the artifact

**A seat works in a worktree that does not outlive its item.** `prepare_workspace` creates `item-<id>` on
branch `item-<id>` (one ref per ITEM — never per seat: two seats on one item share it); `complete_work`'s
teardown, the broker sweep, or a maintainer's prune retires
the **worktree**, and the **branch survives** — it is deleted only once it is merged into `main`. So after
you finish an item, `item-<id>` being gone is **normal**, not lost work. Read the branch, never the tree:

| What you see | What it means | What to do |
|---|---|---|
| `item-<id>` missing, item `done`, `item-<id>` branch exists | retired on completion — **normal** | nothing; your commits are on the branch |
| `item-<id>` missing, item **live** (`claimed`/`queued`) | reaped while live — a **keep** case, never a force | escalate (`runbooks/leaked-worktrees.md`); do not rebuild |
| you never had an `item-<id>` worktree | the F12 seat-root fallback: your cwd is the **shared tree** | say so in your report; do not edit the shared tree |

**Check it, don't assume it** (short ids — see `incidents/2026-10-19-git-sha-redacted-as-secret.md`,
which redacts bare 40-char oids out of tool output):
```bash
node cli.mjs worktree audit            # per-seat roots + every worktree's state
ls -d item-<id> 2>/dev/null; git rev-parse --short item-<id>   # tree vs branch
```

**To touch a branch whose worktree was retired, RE-ATTACH — never rebuild:**
```bash
git worktree add ../item-<id> item-<id>   # re-attaches the branch at its existing tip
```
No commits are lost. Do **not** hand-roll a new branch for an item that already has one — the tool owns
the branch name (`BRANCH-AND-WORKTREE-LIFECYCLE.md` §2).

**Do NOT amend a completed item's branch to fix advisory prose.** A landing note that says "derive the
D-number at land time" cannot be wrong in a way that matters, and amending rewrites the tip of a branch
that a landing list may already pin — forcing a re-verify for no semantic gain. Fold the correction into
the item that owns the file (e.g. the serialized `DECISIONS.md` pass) instead.

*Why this section exists: `incidents/2026-10-19-terminal-worktree-mistaken-for-lost-work.md` — a seat spent
turns re-deriving this and nearly amended a completed branch. The knowledge lived only in the delegate
runbooks, which a seat does not open.*

## 9. Authoritative sources

| Question | Source |
|---|---|
| What does this field mean? | `WORK-ITEM-SCHEMA.md` §2 |
| What are the legal statuses/transitions? | this file §2; `src/rig.mjs` |
| What wakes a seat? | this file §4; `src/driver.mjs` `selectWakes` |
| What is surfaced to the operator? | this file §5; `src/attention.mjs` |
| How do I unstick a parked row? | this file §8; `runbooks/stale-held-backlog.md` |
| Where is my worktree / my branch after the item is done? | this file §8a; `BRANCH-AND-WORKTREE-LIFECYCLE.md` §2 |
| Why did this class break? | `incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md` · `incidents/2026-10-19-terminal-worktree-mistaken-for-lost-work.md` |
| How should this be redesigned? | `reviews/queue-lifecycle-redesign.md` |

## 10. How to re-verify this document

```bash
# 1. the state machine's legal moves (expect the six tools + the two terminal exits)
grep -nE 'name: "(send_work|claim_work|complete_work|defer_work|resume_work|hold_work|release_work|cancel_work)"' src/rig.mjs

# 2. held has exactly two exits: release -> queued, cancel -> cancelled
grep -nE 'item.status = "(queued|held|deferred|claimed|done|cancelled)"' src/rig.mjs

# 3. release_work is sender-or-recipient, held-only
sed -n '781,800p' src/rig.mjs

# 4. what wakes a seat (queued, stalled claim, or parked rows - expect all three branches)
sed -n '71,130p' src/driver.mjs
grep -n 'WAKE_CONTENT' src/driver.mjs   # three fixed bodies, one per wake reason
node demo/held-item.test.mjs            # exit 0; asserts the parked wake and its reason

# 5. the attention kinds (expect none about parks)
grep -nE 'kind: "' src/attention.mjs

# 6. the live histogram and the held ages
DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys,collections;d=json.load(sys.stdin);print(dict(collections.Counter(i['status'] for i in d['items'])))"
```

If the code disagrees with a shape above, the **document** is wrong — correct it; never bend the
lifecycle to match the doc.

### 8a-note — a branch held by ANOTHER worktree (the landing-blocker sub-case)

If `git` says *"`<branch>` is already checked out in the worktree `item-<id>`"*, your branch is not lost and
your rebase is not wrong — **git will not let two trees hold one branch**. Look at the holder before
concluding anything:

```bash
git worktree list | grep -E "\[<branch>\]"          # which tree holds it (and whether it is locked)
```

- **Holder is your own tree** → you are in it; there is nothing to do.
- **Holder is a terminal item's tree** (`done`/`cancelled`) → this is a LANDING BLOCKER, and no seat can
  free it safely from inside a seat run. **Report it; do not `--force`, do not rebuild.** The delegate frees
  it losslessly with `git -C <path> switch --detach` (frees the branch, keeps every file).
- **Holder is a live item's tree** → the branch is in use; it is not yours to move.

Escalating here is correct but slow; say **which** of the three it is, and name the holder path, so the
freed branch is one command away. See
`incidents/2026-10-19-terminal-worktree-mistaken-for-lost-work.md` (RECURRENCE).
