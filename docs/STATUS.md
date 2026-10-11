# durig — status and handoff

Written **2026-10-10** at the operator's request, pausing after the
viewing/formatting milestone. Read this first when resuming; `docs/ROADMAP.md`
holds the ordered next work and `docs/DECISIONS.md` the reasoning.

Updated **2026-10-11**: the pi pin moved to `main`'s tip and the tuios patch was
rebased onto upstream `main` — both rebuilt and re-verified (D17, and
`docs/TUIOS-PRS.md` in the project workspace). Later the same day `check` shipped (D25)
and found that the converter was dropping OpenRig's rig-level `edges:` list (D26);
the fix restored every lost send permission, the docs pod joined the rig (D27),
and the corrected constitution was applied to the live tutor-pi store (backup:
`C:/tmp/tutor-pi.sqlite.bak-2026-10-11`). Finally, measurement shipped (D28):
`metrics`, four measures, metric notices on the attention channel — 21 demos. The
OpenRig daemon was also recovered (dead since 2026-10-06, and reported as a
starved event loop because a recycled PID was trusted as the daemon), and the
owed `security.sec` consult was finally taken (D30).

## Where we stopped

Milestone **M2 (operator can see the rig)** is finished and verified, and the
measurement layer that was made to precede the change it judges is built (D28):
`metrics` reports four measures with their bands, baselines, evidence classes and
blind spots, and the out-of-band ones ride the attention channel in `status` and
`watch`.

Work pauses between **item 2's drill** and **M3 (seats can actually do work)**,
the gap that matters more than any remaining viewer feature. The drill is the half
of measurement that is not code: a fixed task set that makes two configurations
comparable, without which the before/after comparison the roadmap wants is
confounded by construction (D24).

Everything below was verified against the real store, not asserted from intent.

## What works now

| Area | State |
|---|---|
| Rig bootstrap, seats, org edges, queue protocol | working; real-model e2e proven (D16) |
| Routing | pm decomposes into queue items; worker claims, completes, DONE notice returns to pm |
| `watch` | human dashboard on a TTY (seat, role, current work, last words), NDJSON when piped |
| `log <seat>` | turn-grouped transcript with timestamps and elapse deltas; `--follow` tails new turns |
| `send` | streams the live generation to stderr; non-`done` settles explain themselves |
| Failure honesty | wrong database is announced, never silently empty (D18) |
| `check` | audits a rig file **and** the store; eight rules with stable ids, severity by who can fix it, and any rule it cannot judge reported as skipped-with-reason, never a pass (D25) |
| Dependencies | released `@earendil-works/*` 1.1.0 are the default; pi `main` is pinned (`ea448f45`) and linked via `scripts/sync-pi.mjs` |

## Architecture: what changed, and what deliberately did not

**Changed (presentation only):**

- Two new render modules: `src/rigstory.mjs` (read a seat's latest words and tool
  call from storage) and `src/chatview.mjs` (turn-grouped transcript rendering).
- `src/watchview.mjs` renders the rig snapshot for a human.
- `cli.mjs` `watch` and `log` gained `--json`/`--human`, `--follow`, `--full`,
  `--tool-bg`, `--theme`; both read storage directly and never open a harness.
- Read commands report the resolved `db` and warn when it holds no seats.

**Not changed (and this is the important half):**

- **Persistence is untouched.** No new document kind, no new field, no schema or
  migration. Durig still writes only through pi-durable's existing `defineDoc`
  documents and entry APIs. The format work is pure read-side rendering.
- **The storage layer is unchanged.** Durig still imports
  `openNodeSqliteStorage` at one seam and runs no SQL of its own; every table
  (`entries`, `submissions`, `documents`, `document_revisions`, …) is pi-durable's
  schema. Our four domain objects are versioned JSON documents keyed by `kind`.
- **The JSON contract is unchanged.** stdout remains one JSON document per command;
  human views exist only when stdout is a terminal (D19).
- **The queue protocol and org edges are unchanged.**
- **`cli.mjs` remains non-interactive by decision** (D21), not by omission.

## Facts needed to resume

- Working directory: `durig/`. Default provider `deepinfra` (needs
  `DEEPINFRA_API_KEY`); offline mode needs nothing (`DURIG_PROVIDER=faux`).
- `DURIG_DB` selects the store; without it the default is `./rig.sqlite`. Use
  `node cli.mjs config` to see what is actually in effect.
- Dependency state: `node_modules` is **linked to pinned pi `main`** (`--link`),
  pin `ea448f45`, drift `false`, all 19 demos passing on it. A fresh clone is on
  the 1.1.0 releases; re-run `node scripts/sync-pi.mjs --sync --link` to
  reproduce the linked state.
- The tuios patch is rebased onto upstream `main` as `6160892d` on branch
  `rebase/conpty-main` in `C:/tmp/tuios-rebase`; it is **not pushed**, because
  updating PR #596 needs a force-push and has not been authorized.
- No build or lint step exists in `durig/package.json`. The check surface is the
  demo suite plus `node --check`.

## Test surface

30 offline demo tests, each run as `node demo/<name>.test.mjs` (exit 0 = pass):
`cli`, `chatlog`, `watchview`, `streamcli`, `streamview`, `syncpi`, `config`,
`refresh`, `seatmodel`, `eval`, `optimizer`, `singleflight`, `blocked`, `watch`,
`race`, `persistence`, `repeat-call`, `constitution`, `check`, `converter`,
`metrics`, `provenance`, `extensions`, `starter`, `defer`, `primer`, `confine`,
`seatguard`, `seattools`, `worktree`.

They are the regression gate for the pi-main link as well as for feature work
(D17). All 30 pass on the current tree.

## Research review (2026-10-10)

`docs/Patterns_and_Pitfalls_of_LLM_Agents.md` (MAST failure taxonomy, Anthropic's
production and swarm research, practitioner consensus) was reviewed against the
implementation; D23 records the conclusion and ROADMAP.md carries the full gap
table. Short version: **the architecture is on the right side of the evidence and
is not changing.** Loss of conversation history, silent shared-state corruption and
the absence of a coordination substrate are impossible or already answered here by
construction, and observability — the part practitioners call hard — is where durig
over-invested.

The gaps the research exposes are **protocol, not structure**: `complete_work` is
self-declared with no evidence and no verifier step (MAST FC3); there are no
termination conditions (FC1, 12.4%) and nothing detects step repetition (FC1, the
most frequent mode at 15.7%); there is no verb by which a seat can defer a decision
to a human (FC2, 6.8%); and all 15 seats resolve to one model while per-seat models
are already supported, so a bias is systemic rather than isolated. The roadmap was
re-ordered accordingly: measurement first (now built, D28), then the one item that
needs no new code — verifier model diversity — and the measures exist to judge it.

The document itself was corrected: the leftover chat preamble was removed, as were
six unexplained percentages beside the reference list, and its MAST dataset size
was updated from an earlier revision (the paper now reports 1600+ traces across 7
frameworks, not 150+ across 5). Both load-bearing citations were fetched and
confirmed rather than taken on trust.

## Decisions needed from the operator

1. **Scope of M3 (seats with real tools).** Read-only corpus access first, or file
   edits plus a test runner? This is the blocking gap: seats can coordinate but
   cannot read the textbook, run a check, or produce a grounded answer, and it is
   the same work item as adding a verification loop (D23).
2. **TUI or browser for the interactive client (M4).** Deferred by D21. Collapsing
   a turn in place requires owning the terminal screen; a read-only browser client
   over SSE avoids that trade entirely.
3. **Pods design** — namespace-scoped queues vs a flat queue with pod tags
   (deferred twice; the OpenRig converter currently drops pods with a warning).
4. **The drill task set** (item 2's remaining half). A fixed set of tasks hard
   enough to move the measures, so two configurations are comparable. D24 labels a
   passive window **confounded**, so without this the before/after comparison
   item 3 wants measures "the rig got changed" and "the work changed" together.
   This is a content decision — which tasks, and what counts as done — not a code
   one, and `metrics` is built and waiting for it.
5. **The scribe's security conditions, before it goes live (item 1b).**
   `security.sec` ruled the docs-pod seat **FAIL as scoped**: on a single-user host
   its read-all-transcripts grant is not controlled by persona prose, so it needs a
   fail-closed secret/PII gate (canary-falsifiable) plus a republish allowlist
   before it may be applied — or drop the `devtools.dev` observation edge. It
   escalated to `advise.lead` (`qitem-20261011052428-c1e0716d`, urgent,
   `gate:spec-review`). Nothing is applied to the live rig yet, so this is a
   go/no-go on the *first* application, not a rollback. Declining is a legitimate
   answer; the dissent is recorded either way.
   **Sharpened 2026-10-11:** the M3 tools (item 4) are `registry.install(CodingTools)`
   — read, write, edit and **bash** on this machine. That is arbitrary code
   execution handed to seats, so the M3 scope ruling is the security-relevant
   decision it was always going to be, and it wants the same treatment as this item
   (a `security.sec` position before it lands) rather than being read as "just add
   tools".

## Known gaps worth remembering

- **Seats have no working tools.** `src/rig.mjs` registers exactly six:
  `send_work`, `claim_work`, `complete_work`, `defer_work`, `resume_work`,
  `peek_queue`. A live worker seat
  reported itself blocked and refused to claim a completed deliverable, which is
  the P1 honesty rule working correctly on top of a missing capability.
- **Nothing in the rig verifies anything.** A grep for `verif|escalat|deadline|`
  `retry|budget|veto|reputation` across `src/*.mjs` and `cli.mjs` returns only the
  CLI poll loops, so our pair-review and Ledger norms are enforced by convention
  alone (D23).
- **`log --follow` renders inconsistently**: the backfill is one call and each
  later entry its own, so column alignment and turn grouping differ between them.
- **Cross-process updates are polled** at 750 ms; SQLite has no cross-process
  notification (D11, RESEARCH.md).
