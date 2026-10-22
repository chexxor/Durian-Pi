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
*without* starving a working seat: it is unclaimable and it does **not** wake anyone
(`src/rig.mjs:338-349`). That is the correct tool for a genuine backlog row. It is the wrong tool for
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

The driver wakes a seat only for two conditions (`selectWakes`, `src/driver.mjs:38-72`):

- **`hasQueued`** — a `queued` item addressed to it (suppressed while `paused`), or
- **`hasStalledClaim`** — a `claimed` item it holds with no in-flight submission, no live lease, and no
  operator stop.

Suppressed if a submission is already pending for the seat's conversation, or the seat is busy. **`held`
and `deferred` are not wake conditions.** So:

> A `queued` item always eventually wakes its seat. A `held` item never wakes anyone. A `deferred` item
> wakes the seat it was deferred *to* only if that was a seat (via the enqueued question), or the human
> via attention.

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

# 4. what wakes a seat (queued or stalled claim only)
sed -n '38,72p' src/driver.mjs

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
