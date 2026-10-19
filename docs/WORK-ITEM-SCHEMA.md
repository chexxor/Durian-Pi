# Work item schema — naming, numbering, and identity

**Authority.** This is the canonical schema for work items in this rig. A seat, a delegate, or a human
writing an item, a branch, a worktree, or a reference to one follows it. Where a habit below conflicts
with this document, this document wins and the habit is the bug.

It is *descriptive* about what exists today (so you can read the 2,948 legacy items) and *normative*
about what to write from now on (so the queue stops degrading). Legacy items are never renamed — see §7.

| | |
|---|---|
| `last_verified` | 2026-10-19 |
| `verified_by` | delegate |
| Evidence | measured over the live store (2,948 items) and the repo (86 refs); every number below has a command in §10 |

---

## 1. Why a schema at all (the measured cost of not having one)

The queue has no declared schema. Titles are free prose, and two pieces of *code* parse that prose. The
result, measured today:

| Symptom | Measurement |
|---|---|
| Prose prefixes are unbounded and redundant | **421 distinct** leading ALL-CAPS prefixes; **1,856 of 2,948** items (63%) have no prefix at all |
| Titles carry a signal about *another* item | **1,352 of 2,948** (46%) — the worst case nests recursively: `#5 "DONE #3: DONE #1: …"` |
| Titles encode GATES in prose | **325** items; only **69** name a resolvable `#NNN` |
| Titles exceed a readable length | **1,781** (60%) over 120 chars; longest **324** |
| One rule's findings are mostly artifacts of prose matching | `verification-without-evidence` flags **304** items; only **81** start with `VERIFY`, **223** merely contain the word, **159** are `DONE`-notice copies |

That last line is the whole argument: a rule intended to find *verifications lacking evidence* currently
reports mostly **notifications** and **tasks that happen to use the verb "verify"**. The signal is
drowned by the schema's absence. An agent reading the queue pays that tax on every turn.

## 2. The record as implemented

A queue item has exactly these fields (`node cli.mjs queue`):

| Field | Meaning |
|---|---|
| `id` | integer, monotonically increasing, **never reused** |
| `from` / `to` | the seat (or `operator`) that sent / owns it |
| `subject` | free text — the title (this document constrains it) |
| `body` | the detail: rationale, acceptance, evidence |
| `status` | `queued` · `claimed` · `held` · `deferred` · `done` · `cancelled` |
| `transitions` | append-only history: `queued`/`claimed`/`done`/`revised`/… with `at`, `by` |
| `resultSummary` | the completion record: claim, and (for a verification) the evidence |
| `optimizedVia` | provenance for an optimized instruction |
| `notice` | **structural flag**: this item is a notification, not work |

Terminal means `done` **or** `cancelled` — a `cancelled` item is not work (it must never reappear as
phantom work in a "non-terminal" view).

## 3. Where meaning actually lives today (read this before writing a title)

Two code sites make the *title* load-bearing. Know them, because they decide behaviour:

1. **`isDoneNotice`** (`src/rig.mjs`) — `item.notice === true || /^DONE #\d+: /.test(subject)`.
   The **structural flag is the real mechanism**; the regex is a *legacy fallback* for stores that predate
   the flag. It exists so an acknowledgement cannot spawn another acknowledgement (the `#3 → #5 → #9`
   chain that burns a seat turn per hop).
2. **`isVerificationItem`** (`src/checkup.mjs`) — `/\bVERIFY\b/i.test(subject)`.
   This is the **only** definition of "a verification item", and it is a case-insensitive substring match
   on free text. That is why §1's last row happens.

Consequence: the title is not decoration. Write it to satisfy these parsers, and do not rely on them —
§5 moves the meaning into fields.

## 4. Normative rules

### R1 — Identity
- An id is **opaque**: it encodes no type, priority, or order beyond creation. Never renumber, never
  reuse, never delete an id.
- **Always qualify an id outside this store.** `#2237` means queue item 2237 *here*; an upstream GitHub
  issue is `GH#2237`; a roadmap entry is `RM-157`; a decision is `D-112`; an incident is
  `INC-2026-10-19-<slug>`. The bare `#N` form is reserved for queue ids, and only inside this repo's docs.

### R2 — Title
- One clause stating **the work**, ≤ **100 characters**, ASCII, no trailing metadata soup.
- **Never encode state.** No `DONE`, `RULED`, `REGISTERED`, `HELD`, `DEFERRED`, `CLOSED`, `CONFIRMED`
  as a title prefix — `status` is the state, and a title that repeats it drifts from it (measured:
  `CLOSE #110 … — no re-verify` sits in a `done` item and is a *different* claim from its status).
- **Never lead with another item's id.** A reply, ruling, or acknowledgement is identified by its own
  `kind` and its `re`/`verifyOf`/`supersedes` link, not by pasting the other item's id at the front.
- **The one exception is R6** (a `DONE` notice), because the driver's legacy fallback depends on that
  exact shape.

### R3 — Kind is a field, not a shout
Use the structured `kind` field with this **closed vocabulary**. Do not invent a 422nd prefix.

| `kind` | Use for | Legacy prefixes it replaces |
|---|---|---|
| `task` | ordinary build/do work | `BUILD` `IMPLEMENT` `FIX` `DEFECT` `PERF` `HYGIENE` `AMEND` |
| `verify` | non-author verification of a named artifact | `VERIFY` `PARTNER-CHECK` `CONFIRM` |
| `notice` | a notification (`notice: true`, R6) | `DONE #N:` `RULED #N:` `ACK` `ANSWER` |
| `artifact` | the thing being verified (a branch tip + what changed) | `ARTIFACT` |
| `question` | a request for a ruling | `QUESTION` `ASK` |
| `ruling` | a decision from `lead`/`operator` | `RULING` `RULED` `CORRECTION` |
| `landing` | a landing instruction / list entry | `LANDING LIST` `LANDING PASS` |
| `rebase` | a rebase-and-re-verify pass | `REBASE PASS` `REBASE PRIORITY` |
| `docs` | documentation truth-up | `DOCS` `DOC-TRUTH` `DOCS TRUTH-UP` `RECORD DECISION` |
| `register` | registering backlog/roadmap/known work | `REGISTERED` `REGISTER` `BACKLOG` `ROADMAP` |

`operator` is a valid `from`/`to`, never a role alias. Priority is its own small field
(`operator`/`high`/`normal`), not the word `OPERATOR PRIORITY` in a title.

### R4 — State lives in `status`, once
`queued → claimed → done|cancelled`, with `held` and `deferred` as parked states. A title never restates
it (R2). A `held` item is not claimable; a `deferred` item is waiting on an answer, and the answer is owed
by the named party.

### R5 — Gates and links are structured
`blockedBy: [ids]` — a list; each entry must resolve to a terminal `done` (a `cancelled` gate is a
`gate-cancelled` finding, not a pass). Do **not** write `GATED on #1234` in a title: it is unqueryable and
325 items already prove it decays. This is the field `lead` ruled onto the item record for `#2673`;
`blockedBy` plus optional `verifyOf` / `supersedes` / `re` / `landingOf` replace every prose gate.

### R6 — The notice form (the only title carrying another id)
A notice sets `notice: true` **and** titles itself `DONE #<id>: <the original item's title>`. Nothing else
may begin with a verb signalling another item. A notice must never be responded to with another notice.

### R7 — Names derived by a function, never by hand
- Branch: **`<seat>-item-<id>`** — nothing else.
- Worktree directory: **`item-<id>`**.
- Verification scratch: `.verify-<id>` / `verify<id>-*` (reclaimed on completion).

No `-rebase`, `-fix`, `-v2` suffixes and no `temp-*` names: a rebase happens **in place** (non-force), so
the name never has to change. Measured non-conformance today: **19 of 86 refs** fail this pattern
(`impl-item-1444-fix`, `scribe-item-1565-rebase`, `temp-1558`, `item-9002`, `selfdev-borrow`, …). Those
are legacy (never rename a branch that holds commits others reference — land or drop it first).

### R8 — One fact, one place
The title states the work. The body holds rationale, acceptance, and evidence. The status holds state.
The transition log holds history. A reader must never have to reconcile two sources that disagree.

## 5. The shape that is efficient for an LLM agent

Why the rules above are not bureaucracy — each maps to a failure mode of agents reading a queue:

1. **Structure beats prose for parsing.** An agent reliably reads `kind`, `status`, `blockedBy`; it
   unreliably infers intent from 324 characters of free text. Every prose convention costs tokens and
   introduces a parse error; the 304-vs-81 measurement is that error, quantified.
2. **A closed vocabulary beats optionality.** 421 prefixes mean an agent must either read all of them or
   guess. Ten kinds can be enumerated in a prompt and validated in a `check` rule.
3. **State must not be duplicated.** A title saying `DONE` on an item whose status says `claimed` forces
   the agent to adjudicate a contradiction with no basis. Duplicated state is *guaranteed* drift.
4. **Ids must be stable and opaque.** Agents cite ids in commits, docs, and branches. Any rename or reuse
   silently detaches a citation from its referent.
5. **Bounded titles.** Long titles are truncated in every view (`log`, `status`, `queue` projections), so
   the informative tail is invisible exactly where a decision is made.
6. **Links, not nesting.** `DONE #3: DONE #1: …` composes without bound; a `re` field does not.
7. **Machine-checkable invariants.** A convention that only prose enforces rots — this repo has proved it
   three times (`runbook` rules unfed, `#2848`, the `pitui` verdict). The schema must be checkable.

## 6. Reference syntax (cheat sheet)

| Referent | Write | Never |
|---|---|---|
| queue item | `#2237` | `item 2237`, `2237` |
| roadmap entry | `RM-157`, sub-item `RM-28a` | `ROADMAP 157` / `item 157` |
| decision | `D-53` | `D53` only in prose |
| incident | `INC-2026-10-19-scripts-directory-emptied-on-disk` | "the scripts incident" |
| upstream issue / PR | `GH#1234` | `#1234` (collides with queue ids) |
| commit | full 40 or ≥7-char sha in backticks | `the last commit` |

`#NNNN` and `GH#NNNN` are **different namespaces that currently collide**: the team cites upstream work
with the same `#N` syntax it uses for its own items. Qualify externally-referenced ids always.

## 7. Legacy compatibility — do not rename the past

- **2,948 existing items keep their ids and titles.** Ids are cited from commits, docs, branches, and
  `DECISIONS.md`; a rename would break citations in a way no tool can repair.
- New fields are **additive and optional**: an item without `kind`/`blockedBy`/priority is read through
  the legacy mapping in §4/R3 (leading prefix → kind), and an item with **no** `blockedBy` is treated as
  **unblocked** — absence never means "unknown, so hold".
- Old titles that violate R2 are **not** errors; only newly written items are held to it.

## 8. Enforcement (for `pm` to route — not implemented by this document)

The schema is only real when a check fails on violation:

1. `item-title-schema` (error): a **new** item whose title starts with a state word, or with another
   item's id (except R6), or exceeds 100 chars.
2. `item-kind` (fix-now): a `kind` outside §4/R3's vocabulary.
3. `blockedBy-resolves` (error): a gate that names a non-existent id, or a `cancelled` gate.
4. `branch-name` (fix-now): a ref not matching `<seat>-item-<id>` (this would have caught all 19).
5. New items set `notice: true` rather than relying on `isDoneNotice`'s regex, so R6's fallback can
   eventually be deleted.

## 9. Migration, phased (no big-bang)

1. **Write-only**: from now on, new items use `kind`/priority/`blockedBy`; titles obey R2.
2. **Read both**: tooling maps legacy prefixes → `kind` so one query works across old and new.
3. **Backfill lazily**: when an old item is re-touched (revised, released, re-routed), add its `kind` and
   convert its prose gate to `blockedBy`. Never a bulk rewrite.
4. **Then enforce**: switch on §8's rules, with the legacy exemption (§7) in force.

## 10. How to verify this document

```bash
# item count, field set, status histogram
DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys,collections;d=json.load(sys.stdin);print(len(d['items']));print(list(d['items'][0]));print(collections.Counter(i['status'] for i in d['items']))"

# title-shape measurements in §1 (prefixes, signal-leading titles, gates, lengths)
DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "
import json,sys,re,collections
d=json.load(sys.stdin)['items']
s=[i['subject'] or '' for i in d]
print('signal-leading:',sum(1 for x in s if re.match(r'^\s*(DONE|RULED|RULING|ACK|CONFIRM|ANSWER|TRACE)\b',x,re.I)))
print('gates in prose:',sum(1 for x in s if re.search(r'\bGATE(D)?\b',x,re.I)))
print('over 120 chars:',sum(1 for x in s if len(x)>120))
"

# the two load-bearing parsers this document constrains
grep -n "isDoneNotice" -A 3 src/rig.mjs | tail -4
grep -n "isVerificationItem" -A 2 src/checkup.mjs | tail -3

# branch-name conformance (expect only legacy offenders)
git branch --format='%(refname:short)' | grep -vE '^(pm|impl|qa|qa2|lead|advocate|scribe|devtools|auditor|designer|security|architect)-item-[0-9]+$'
```

If a number above disagrees with the command, the **document** is wrong — correct it; never bend a
convention to match it.

## 11. Roadmap items (`docs/ROADMAP.md`) and their correlation with the queue

The roadmap is the **intent** ledger; the queue is the **work** ledger. They are separate namespaces with
**no structural link in either direction** — this section defines both, because a reader who confuses them
writes `item 78` and means two different things.

### 11.1 The roadmap's numbering, measured

| Property | Measurement (2026-10-19) |
|---|---|
| Numbered entries | **189** lines matching `^\s*<int>[a-z]?\.` |
| Distinct integers | **161**, range **0–160**, **no gaps** |
| Lettered sub-items | **13** (`1a`, `1b`, `10a`–`10c`, `24a`–`24e`, `28a`, `30b`, …) |
| Renumbering | **none observed** — ids are stable; a retired entry leaves its number reserved, never reused |
| Grouping | items live under thematic `##` sections; the **number is the identity**, the section is only a grouping (so moving an item between sections does not change its id) |
| Delivery record | **inline prose in the item text**: `(DELIVERED `sha`)`, sometimes `(part 1 DELIVERED `sha`, part 2 HELD)` |

**So the roadmap numbers ARE usable stable ids — that is a genuine strength to preserve.** The defect is
not the numbering; it is that nothing declares it or check-guards it:

- **No machine-readable link to the queue.** Correlation exists only as prose: **392 queue titles cite
  `ROADMAP <n>`** (76 distinct numbers; most-cited `71`, `42`, `98`, `97`, `48`), and `docs/ROADMAP.md`
  mentions a queue `#NNNN` **69 times** in sequencing notes. Neither side can be queried for the other.
- **The delivery record is inert.** `(DELIVERED \`sha\`)` is a sha inside a sentence; no tool reads it, so
  "is RM-157 delivered?" is a text search, and "which queue item delivered RM-157?" is unanswerable.
- **Two items can share a number across versions of the doc** if an editor ever copies a numbered block;
  the only reason it has not happened is discipline, not enforcement. (The apparent duplicates of `1`–`6`
  today are ordered **reference lists** inside prose — `1. **97** — qa — …` — not duplicate items. Any
  check must distinguish an item definition from a list entry, e.g. by requiring the bold-title form in a
  numbered line, or better, by introducing a declaration syntax — see 11.3.)

### 11.2 The correlation model (normative)

| Concept | Ledger | Id form | Lifetime |
|---|---|---|---|
| A durable intention, feature, or gap | `docs/ROADMAP.md` | `RM-<int>[a-z]` | long; retired ids stay reserved |
| A unit of work someone is doing now | the store queue | `#<int>` | short; closed when done |
| A decision | `docs/DECISIONS.md` | `D-<int>` | permanent |
| An incident | `docs/incidents/` | `INC-<date>-<slug>` | permanent |
| A sealed change | git | commit sha | permanent |

**Rules:**
- **R9 — One direction of ownership.** The roadmap item owns the *intent*; the queue item owns the *act*.
  Never create a roadmap entry to track a queue item, or a queue item to re-state a roadmap entry.
- **R10 — Link, never restate.** A queue item that implements roadmap intent carries
  `roadmap: ["RM-157"]` (structured, additive). It does **not** paste the roadmap title into its own.
- **R11 — Record delivery on the ROADMAP side.** When a queue item lands, the roadmap entry gains
  `deliveredBy: [#<queue id>, <sha>]` — the durable doc keeps the link, because queue items are numerous
  and the roadmap is the thing a human reads a year later. Keep the existing inline `(DELIVERED \`sha\`)`
  prose for human readers; the field is for tools.
- **R12 — Sub-items are their own ids.** `RM-28a` is not `RM-28`; a land that satisfies `28a` does not
  close `28`. Cite the letter.
- **R13 — The word "item" is banned bare.** Write `RM-157` or `#157`. This is the single most common
  ambiguity in the history: **86 queue titles** say `item <n>`, and they mean the roadmap in some cases
  (`rule ITEM 3 (ROADMAP 30b)`) and the queue in others (`Close item #34`).

### 11.3 Enforcement (for `pm` to route)

1. `roadmap-id-unique` (error): two item **definitions** with the same `RM` id. Must parse definitions, not
   ordered lists — a naive `^\d+\.` matcher reports 5 false duplicates for `1` today.
2. `roadmap-ids-contiguous` (informational): surface gaps and sub-items so a retirement is deliberate.
3. `queue-roadmap-link` (fix-now): a queue `kind: task` item that cites `ROADMAP <n>` in its title but
   carries no `roadmap` field — convert it (this is the migration signal, and it is bounded: 392 titles).
4. `roadmap-delivery-resolves` (error): a `deliveredBy` queue id that does not exist, or a sha that is not
   an ancestor of `main`.

### 11.4 Migration

Write-only first: new roadmap entries keep the integer id and gain no ceremony; new queue items that serve
roadmap intent carry `roadmap: ["RM-<n>"]`. Backfill lazily — when a roadmap entry is next touched, add
`deliveredBy`. Never renumber, never bulk-rewrite prose.

### 11.5 Re-verify the roadmap claims

```bash
# 189 definitions, 161 distinct ints, 0..160 complete, 13 lettered sub-items, no true gaps
grep -nE '^\s*[0-9]+[a-z]?\.\s' docs/ROADMAP.md | wc -l

# queue titles citing roadmap numbers (expect ~392 titles / 76 distinct)
DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "
import json,sys,re,collections
d=json.load(sys.stdin)['items']; s=[i['subject'] or '' for i in d]
refs=[x for x in s if re.search(r'ROADMAP\s+\d+',x,re.I)]
print(len(refs), len({int(n) for x in refs for n in re.findall(r'ROADMAP\s+(\d+)',x,re.I)}))
"

# roadmap -> queue mentions (expect ~69)
grep -cE '#[0-9]{3,4}' docs/ROADMAP.md
```

## Evidence
Measured 2026-10-19 by the delegate over `selfdev.sqlite` (2,948 items), `docs/ROADMAP.md` (189 numbered
entries / 161 ids), and the repo (86 refs), as part of a land+prune pass that had to join queue prose with
git state by hand for every landing decision, and that hit the `verification-without-evidence`
false-positive class (304 flagged, 81 genuine) while reporting results to the operator. Two of this
document's own first-draft claims were wrong and were corrected by the measurements above: a mis-parsed
`/^DONE #(\d+)/` set that dropped a digit, and a `^\d+\.` roadmap matcher that reported six "gaps" and five
"duplicate" ids that were an ordered reference list, not real defects.
