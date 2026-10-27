# durian-pi — status and handoff

Written **2026-10-10** at the operator's request, pausing after the
viewing/formatting milestone. Read this first when resuming; `docs/ROADMAP.md`
holds the ordered next work and `docs/DECISIONS.md` the reasoning.

Updated **2026-10-11**: the pi pin moved to `main`'s tip and the tuios patch was
rebased onto upstream `main` — both rebuilt and re-verified (D17, and
`../docs/TUIOS-PRS.md` in the project workspace). Later the same day `check` shipped (D25)
and found that the converter was dropping OpenRig's rig-level `edges:` list (D26);
the fix restored every lost send permission, the docs pod joined the rig (D27),
and the corrected constitution was applied to the live store (backup:
`C:/tmp/<store>.bak-2026-10-11`). Finally, measurement shipped (D28):
`metrics`, four measures, metric notices on the attention channel — 21 demos. The
OpenRig daemon was also recovered (dead since 2026-10-06, and reported as a
starved event loop because a recycled PID was trusted as the daemon), and the
owed `security.sec` consult was finally taken (D30).

Updated **2026-10-13 (direct implementation)**: the interactive client's **data
layer** landed without choosing a screen (D40). ROADMAP items **7** (pure view
model + peer navigation graph), **8** (one importable, read-only read API), and
**40(c)** (the in-flight partial rendered as streaming, never as an entry) are
built; `demo/viewmodel.test.mjs` and `demo/livestream.test.mjs` are demos 48–49 and
the suite is 49/49. The TUI-vs-browser choice below is now a presentation decision,
not a prerequisite. Still owed: independent `qa` verification of these three
items, and the screen itself (item 17). Note the direct path: this work was done by
the operator's agent, not routed through the selfdev seats, because the team was
blocked (one seat root at a time against `#148`'s worktree, and `impl`'s context
was degenerate).

Updated **2026-10-13 (delegate session — event-driven tranche + usability batch)**: drove the
selfdev team through the event-driven/Pi-integration work and a usability batch. All of it lives
in the seat worktree `C:/tmp/durig-dev/pi-rebase/durig` (uncommitted); the live tree's direct
work above is separate.

- **PIECE 1 spike** (event-driven wake): DONE + qa-verified (#209/#215/#218). `.spike/pi-wake/` —
  a Pi extension polls `durian-pi watch --once --json` and calls `pi.sendUserMessage`; both directions
  proven against the real global Pi in RPC mode (`prove-wake.mjs` exit 0).
- **PIECE 2 feed**: DONE + qa-verified (#210/#223/#236), then **renamed** `src/readapi.mjs` →
  `src/eventfeed.mjs` to keep it separate from the shared read API (#240/#247). New
  `events --since/--follow` verb — read-only, monotonic `seq` cursor.
- **PIECE 3** (resident broker) gate **RULED IN** (#237); registered **gated** (#238) on a D-entry
  that supersedes (not erases) D11, plus a security position only if it opens a socket. Not started.
- **Usability fixes** (all done + qa-verified): #259 (help/exit contract), #260
  (`queue --active/--status/--all` + summary), #261 (`ps`/`status` surface seat `root`+`model`),
  #262 (attention human/seat split).
- **Ordering gap** ruled claim-by-id (#214) and fixed (#239): `claim_work({ itemId })` with the
  status whitelist preserved (D41).
- **Store-write contention** on the send path fixed (#257, D42); **`worktree` refuses a dirty
  source** (#255, D43); **worktree pin** corrected (##219, sha `7d75a0e`).
- The worktree demo suite is now **50/50**. Findings F18–F29 recorded in `docs/DOGFOOD.md`.
- Nothing pushed; publishing and integration remain the operator's.

Updated **2026-10-14 (delegate session — auto-wake investigation + repairs)**:
- **`peek_queue` fix verified** (`demo/peekqueue.test.mjs` PASS): the tool now returns a **bounded
  inline view** (status counts + first 20 items + a truncation footer) instead of only a file path —
  the operator's complaint. Worktree; artifact **#293** to qa.
- **Corrupt `pi.live` repair**: `impl`'s conversation was wedged (P5/#110,
  `unresolvable path ["generation","message","content",0]`). `stop`+`resume`, `reset`, and a
  `["r",{}]` root-replace all failed; **retiring** the corrupt incarnation fixed it. Tool:
  `scripts/repair-pi-live.mjs <db> <conversationId>`. Separately, `src/readapi.mjs` `readLiveState`
  now **survives an unreadable `pi.live`** (warns once, reads `{}`), so `log --follow`/`watch` no
  longer crash on one corrupt seat.
- **Auto-wake finding**: only **read-only viewers** were running (`watch`, several `log --follow`);
  they cannot wake seats (D11), so `devtools` idled with 3 queued items + a stalled claim. `run` is an
  external clock; the self‑driving/event‑driven wake is **PIECE 3 (#238), gated** — that is the next
  session's priority. Findings F30–F33 and the long‑wait/cache‑refresh note recorded in DOGFOOD.
- Nothing pushed.

Updated **2026-10-14 (later delegate session — the resident broker landed)**:
- **PIECE 3 (resident broker) is DONE and committed.** `serve` (`src/broker.mjs` + `src/scheduler.mjs`,
  D45) reacts to the store's in-process commit stream — no external clock; `up` auto-starts it on a
  TTY (`--no-serve`/`DURIAN_PI_NO_SERVE=1` opt out) and at most one runs per database (`<db>.broker.json`,
  D46). Commits `8337d0a` (scheduler, 1/2), `6cfef88` (`serve` + shared wake pass, 2/2), `ddf7cca`
  (auto-start, D46), `b542936` (`revise_work`/`cancel_work`, D47). Verified: the broker was observed
  **auto-waking `devtools`** (its stalled #192) against `selfdev.sqlite` with no manual `run`/`send`;
  `demo/broker.test.mjs`, `demo/scheduler.test.mjs`, `demo/autostart.test.mjs` all exit 0.
- **F36 (the queue cannot be curated) is FIXED** by D47; the ~40-item triage it exposed
  (`docs/QUEUE-TRIAGE-2026-10-14.md`) is still owed.
- **Next:** the broker's two registered follow-ups — **F34** (a broker-driven generation carries no
  seat in the genlock lease, `src/genlock.mjs:83`) and **F35** (`serve --stop` on Windows tears down
  mid-pass; needs a cooperative, pass-settling stop). Item **#287** is a `claimed` but **stale** doc
  item whose content D45/D46 overtook; it needs re-scoping or cancelling.
- Docs trued up this session: `docs/NEXT.md`, `docs/ROADMAP.md`, `docs/STATUS.md` (the earlier
  entries still described the broker as gated/next). The old worktree
  `C:/tmp/durig-dev/pi-rebase/durig` no longer exists; its work is on `main`.
- Nothing pushed.

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
| Dependencies | released `@earendil-works/*` 1.1.0 are the default; pi `main` is pinned (`42705224`) and linked via `scripts/sync-pi.mjs` |

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
  migration. durian-pi still writes only through pi-durable's existing `defineDoc`
  documents and entry APIs. The format work is pure read-side rendering.
- **The storage layer is unchanged.** durian-pi still imports
  `openNodeSqliteStorage` at one seam and runs no SQL of its own; every table
  (`entries`, `submissions`, `documents`, `document_revisions`, …) is pi-durable's
  schema. Our four domain objects are versioned JSON documents keyed by `kind`.
- **The JSON contract is unchanged.** stdout remains one JSON document per command;
  human views exist only when stdout is a terminal (D19).
- **The queue protocol and org edges are unchanged.**
- **`cli.mjs` remains non-interactive by decision** (D21), not by omission.

## Facts needed to resume

- Working directory: `durian-pi/`. Default provider `deepinfra` (needs
  `DEEPINFRA_API_KEY`); offline mode needs nothing (`DURIAN_PI_PROVIDER=faux`).
- `DURIAN_PI_DB` selects the store; without it the default is `./rig.sqlite`. Use
  `node cli.mjs config` to see what is actually in effect.
- Dependency state: `node_modules` is **linked to pinned pi `main`** (`--link`),
  pin `42705224`, drift `false`, all 39 demos passing on it. A fresh clone is on
  the 1.1.0 releases; re-run `node scripts/sync-pi.mjs --sync --link` to
  reproduce the linked state.
- The tuios patch is rebased onto upstream `main` as `6160892d` on branch
  `rebase/conpty-main` in `C:/tmp/tuios-rebase`; it is **not pushed**, because
  updating PR #596 needs a force-push and has not been authorized.
- No build or lint step exists in `durian-pi/package.json`. The check surface is the
  demo suite plus `node --check`.

## Test surface

30 offline demo tests, each run as `node demo/<name>.test.mjs` (exit 0 = pass):
`cli`, `chatlog`, `watchview`, `streamcli`, `streamview`, `syncpi`, `config`,
`refresh`, `seatmodel`, `eval`, `optimizer`, `singleflight`, `blocked`, `watch`,
`race`, `persistence`, `repeat-call`, `constitution`, `check`, `converter`,
`metrics`, `provenance`, `extensions`, `starter`, `defer`, `primer`, `confine`,
`seatguard`, `seattools`, `worktree`.

They are the regression gate for the pi-main link as well as for feature work
(D17). **KNOWN REDS BASELINE (2026-10-21): `check` and `starter` are RED for ONE cause.**
`30270c0`'s commit message begins with a UTF-8 BOM (`ef bb bf` at byte 0, byte-level established) and the
`commit-message-encoding` rule CORRECTLY finds it. The CLI reads REAL history (so `check` reports
`commit-message-encoding` — the demo diff is exactly `+ 'commit-message-encoding'`), while the pure audit
is fed `commitMessages: []` and the rule passes there. NEITHER SIDE IS WRONG — ONE IS FED REAL HISTORY AND
THE OTHER IS FED NONE. THE FIX IS AN OPERATOR DECISION ABOUT MAIN'S HISTORY (amend or re-write `30270c0`),
NOT a reconciliation: adding `commit-message-encoding` to the expected set would make `check` GREEN WHILE
THE BOM REMAINS ON MAIN — a rule licensed in the ledger and unenforced in fact. A LEDGER EDITED TO MATCH A
TRUE FINDING DOES NOT RECORD THE TRUTH; IT RETIRES IT. Until the operator decides, both demos fail for the
right reason (recorded baseline, not a silent red).

**SUITE ON LINUX: 238/238 (2026-10-27), and it now runs CONCURRENT by default.** Measure it with
`node scripts/test.mjs` — **41.2s** here. Do NOT hand-loop `for f in demo/*.test.mjs; do node "$f"; done`: that
is serial and costs **276.8s** for the same tests (D135). The runner also prints per-test durations and the five
slowest, reports a hung demo as `TIMEOUT` rather than hanging forever, and `demo/test-runner-concurrency.test.mjs`
pins the default so nobody loses the concurrency again.

**SUITE ON LINUX: 236/236 (2026-10-26).** The Windows-era baseline was 229/235 and this box measured
**227 pass / 8 fail** at the relinked pin; D129's "six Linux-shaped defects" was stale in both count and
membership. The eight are now zero, and two of them were **product bugs, not OS drift**: `linkWorktreeDeps`
handed a script path to `npm` as a command (so deps-linking never worked on any platform), and
`waitForProcessDeath` on POSIX answered on the first `kill(pid,0)` instead of polling to its deadline (a false
"still running"). The other six were Windows-shaped fixtures fixed at the cause. Full reasoning in commit
`3bff94a`; the config-leak half is ROADMAP 193. **This is the first green suite on Linux — re-measure it rather
than quoting it**, and note that a tuning key in the ENVIRONMENT can still move a spawned demo (193's blind
spot).

**KNOWN REDS BASELINE (2026-10-26): the `citation-unresolvable` rule is fix-now RED, on purpose.**
Measured on the Windows→Linux move: **178 distinct commit shas are cited across the queue and 90 resolved
nowhere** — not this clone, not `vendor/pi-main/.git`, not `origin` after a clean fetch. The history repair
(mount the Windows volume read-only, fetch its 32 branches, recover four objects that hung off no ref) brought
that to **80**, and patch-equivalence resolved the four remaining LIVE citations: `0c6fd7665` is a stale
pointer to the landing `0c6fd76e465` (#3398, three call sites on main now read `!== "ESRCH"`,
`demo/broker-liveness.test.mjs` passes), `eb7e69c1e` to `ce79c354` (#2673, `demo/workable-claim.test.mjs`
passes), and `5d8c6237a` is context in a row held on #2788. So the rule's five findings are: **4 live rows whose
citation is a STALE POINTER (amend to the landing commit), and 1 baseline covering 308 terminal rows** whose
`done` cannot be re-checked from a clean clone. The baseline is recorded rather than zeroed for the reason this
file already states about `30270c0`: a ledger edited to match a true finding retires the truth. The rule CANNOT
tell a stale pointer from lost work — only patch-equivalence can — so it reports what it measured and its fix
names the ladder. Root cause is ROADMAP 190: the queue cites machine-local git objects as durable evidence;
new work must cite store-native ids (`entries.id` / `record_ids`).

## Research review (2026-10-10)

`docs/Patterns_and_Pitfalls_of_LLM_Agents.md` (MAST failure taxonomy, Anthropic's
production and swarm research, practitioner consensus) was reviewed against the
implementation; D23 records the conclusion and ROADMAP.md carries the full gap
table. Short version: **the architecture is on the right side of the evidence and
is not changing.** Loss of conversation history, silent shared-state corruption and
the absence of a coordination substrate are impossible or already answered here by
construction, and observability — the part practitioners call hard — is where durian-pi
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
   over SSE avoids that trade entirely. **The prerequisites now exist** (ROADMAP 7,
   8, 40c; D40), so this is purely a presentation choice rather than a build-order
   dependency.
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

- **Carry-not-refuse means a worktree fork includes other seats' uncommitted
  work.** Since #506, a dirty shared tree forks WITH its visible content
  (returned + logged, so never silent): a seat's worktree may contain another
  seat's in-flight edits. Reviewing a seat's diff includes deciding whether a
  carried path belongs to the item; merge-time attribution is manual for now.
- **Seats have no working tools.** `src/rig.mjs` registers exactly seven:
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

Updated **2026-10-14 (later delegate session — lost-tranche recovery + structural safety)**:
- **Recovered the lost worktree tranche onto `main`** from branch `pi-rebase` (`3bf61b1`): #307
  claim-by-id, #308 worktree dirty-source guard, #309 `held`+hold/release, #310 store-write retry
  (`src/storewrite.mjs`), #311 event feed (`src/eventfeed.mjs` + `events`), #312 bounded `peek_queue`.
  **F34 (#299) fixed** (the genlock lease now names the driven seat). Suite 55/56.
- **Guard incident:** a seat ran `git stash;` — the seatguard regex ended in `(\s|$)` so the `;`
  slipped through and it wiped the whole uncommitted tree; recovered from `stash@{0}`. **Phase 1
  (#329)** fixes the anchors (`\b` + `-C` forms) and makes refusals teach the safe path; the rule is
  now in the constitution (P3 Safety), `docs/SELFDEV.md`, and `docs/failing-first-recipe.md`.
- **Web research** (`docs/Shared_Working_Tree_Safety_Research.md`) settled the design (D48):
  structural per-task worktrees + `npm ci --prefer-offline` + guard-as-backstop. **Phase 2 (#330)**
  registered; blocked on Git ≥ 2.54 (host was 2.42.0).
- **Known regression to fix with #328:** #329 edited `constitution.txt` but did not regenerate
  `rig.starter.json`'s inline copy, so `demo/starter.test.mjs` now drifts on CONTENT as well as CRLF.
- Nothing pushed.

## Updated 2026-10-15 (delegate session — Phase 2, policy, concurrency, broker)

- **#330 Phase 2 DONE and qa-verified (#351–#356):** per-task worktree lifecycle in
  `src/worktree.mjs` (create-on-claim + branch, `git worktree lock`, remove-on-completion,
  per-worktree `npm ci --prefer-offline`, git-identity validation, rebase+`rerere`, cleanup only via
  `git worktree remove` refusing dirty/junction), and Windows Job-Object reaping in
  `src/job-object.mjs`. Demos `demo/worktree-lifecycle.test.mjs`, `demo/job-object.test.mjs`.
- **Commit authority moved to the developer (D50):** the guard now ALLOWS `git commit` (plain and
  `-C` forms) but still refuses every destructive form and `git push` (push stays operator-only,
  grantable to the delegate). `constitution.txt` P2 Authority, the `constitutionInline` copies in
  `rig.selfdev.json`/`rig.starter.json`, `AGENTS.md`, and the shared seat instructions updated;
  `demo/starter.test.mjs` is GREEN, clearing the #328 drift.
- **Docs-ownership norm adopted:** docs are written by whoever has the most knowledge (dev→impl,
  project→pm, QA/architecture→qa/lead); **scribe** manages project-level docs (FEATURES/STATUS/README)
  and delegates/owns the others. Recorded in `docs/SELFDEV.md` and `docs/WORKFLOWS.md`.
- **Concurrency clarified and fixed:** one store/harness writer per DB; `DURIAN_PI_MAX_CONCURRENT_SEATS`
  generation slots; per-task worktrees allow concurrent editing; `serve` + the slot cap is the
  sanctioned concurrency. A 4-slot test found and fixed four broker defects: `serve --max-duration`
  was not a real bound; F34 attributed every concurrent lease to the last-woken seat (now
  AsyncLocalStorage per generation); `serve --stop` forced a kill under load (now cooperative);
  the broker did not write `<db>.broker.log`. `peek_queue(all=true)` now returns the uncapped
  non-terminal listing so coordinators can groom (#433).
- **TUI:** C1 `src/readapi.mjs` and C2 `src/viewmodel.mjs` committed (`789ead6`); C3
  `src/tui/client.mjs` + `demo/tui-client.test.mjs` built; the designer's UX review found no `--help`
  surface, now added (`cli.mjs --help`/`help`, usage to stderr, exit 0).
- **Suite:** 68/68 at the time of writing; `docs/FEATURES.md` corrected against the code.
- Nothing pushed.

## Updated 2026-10-15 (scribe doc-gate closure session)

The operator's commit gate items that were mostly written by the delegate this session were
closed as verified by the scribe (per the runbook directive to verify, not redo). Each claim
was checked against the code and the named demo before being recorded; every proof demo I ran
in this session exited 0:

- **#390 (FEATURES/STATUS Phase 2 gap):** the Phase 2 rows (per-task worktree lifecycle,
  per-worktree `npm ci --prefer-offline`, git-identity validation, rebase+`rerere`,
  `git worktree remove`-only cleanup, Job-Object reaping) and the corrected "no `node_modules`
  junction" worktree row were already present and accurate; I added the missing **guard/authority
  row** (D50) to `docs/FEATURES.md` §2.
- **#398 (concurrency clarification):** `docs/SELFDEV.md` already stated the store/harness-not-files
  WHY; I recorded the three-layer model in `.agents/skills/durian-pi/SKILL.md`, added **D53** to
  `docs/DECISIONS.md`, and extended the FEATURES.md broker row (“sanctioned concurrency — one
  writer per DB, N seats”). WORKFLOWS.md is the advocate's separate item (out of #398's scope).
- **#401 (broker operator switch):** added the “The resident broker: switching it on and off”
  section to `README.md` (TTY `up` auto-start, `--no-serve`/`DURIAN_PI_NO_SERVE=1` opt-out,
  `serve --stop` reaps, raising `DURIAN_PI_MAX_CONCURRENT_SEATS` enables parallel work).
- **#470/#471 (DECISIONS confirm + gate nudge):** D50 confirmed present and accurate
  (`docs/DECISIONS.md:1335`); D53 added as a test-grounded clarification.

**Suite count I ran** (honest, not the full suite): **12 named demos, all exit 0** —
`demo/confine.test.mjs`, `demo/seatguard.test.mjs`, `demo/worktree-lifecycle.test.mjs`,
`demo/job-object.test.mjs`, `demo/readapi.test.mjs`, `demo/tui-client.test.mjs`,
`demo/viewmodel.test.mjs`, `demo/autostart.test.mjs`, `demo/singleflight.test.mjs`,
`demo/storewrite.test.mjs`, `demo/broker-cooperative-stop.test.mjs`, `demo/config.test.mjs`.
I did not run the whole suite (71 `demo/*.test.mjs` files exist in this tree, two of them
uncommitted), so I am not asserting a full-suite figure.

**Outstanding in #469's scope:** TUI **C4** (#405) was reported "done but blocked" by qa, its
corrected verification still owed; U1-U7 TUI re-prioritisation (#480–#487) is registered. The
live tree is dirty (uncommitted broker/cli/pi-pin edits and two new demos) — operator owns the
commit decision. Nothing pushed.

## Updated 2026-10-15 (scribe project-level truth-up - groom, broker lifecycle, dirty-tree finding)

Session narrative for this session's landed work, recorded per ASK G (#508):

- **Queue groomed to broker-safe.** pm cancelled 45 and impl cancelled 28 bookkeeping/stale rows
  (73 total); the queue was left at **39 real-work rows, 0 bookkeeping**, and stale claims
  resolved (#289/#290/#291/#294/#335 and #287). Archive: .durian-pi/queue-archive-2026-10-15.json.
- **Resident broker driven, then force-cleared after a cooperative-stop hang, then restarted.**
  serve was started (pid 14180, <db>.broker.json); later it was **force-cleared** when
  serve --stop (cooperative) did not settle, per the runbook finding that a cooperative stop
  can hang and leaves stale genlock/pidfile state; then restarted (pid 24952) and again after the
  scribe reset (pid 33688). Runbook lesson: after a forced kill, check for and remove stale
  .genlock.N slots whose pid is dead and any stray cli.mjs (send|run|serve) processes.
- **Dirty-tree / worktree-guard finding (ASK F).** The per-task worktree lifecycle is wired into
  the broker's wake path (src/broker.mjs calls claimWorktree, sets the seat's DURIAN_PI_SEAT_ROOT,
  removes on completion - #473). **Superseded by #506:** at #508 time the dirty-source guard
  (uncommittedInSource) REFUSED a dirty tree - pm's first broker wake failed on an uncommitted
  docs/NEXT.md and the seat fell back to the shared tree; that was a correct finding then. #506
  amends the refusal: a dirty source is now CARRIED into the fork via carryVisibleState and returned
  as {carried} (tracked edits, staged adds and untracked files/dirs copy recursively; deleted-but-
  uncommitted paths stay deleted), so per-task isolation no longer depends on a pristine tree. The
  FEATURES.md section 5 ASK F row was renamed accordingly by impl (Dirty-source carry (amends F23
  refusal, ASK F #506)).

FEATURES.md changes this item: added the ASK F broker-wired-worktree/dirty-source-guard row citing
src/broker.mjs claim path, src/worktree.mjs uncommittedInSource + carryVisibleState,
demo/worktree.test.mjs and demo/worktree-lifecycle.test.mjs (the row has since been renamed by
impl to Dirty-source carry (amends F23 refusal, ASK F #506)).
**Not added at the time (correct withholding):** the status seat last-activity row (#502 / ASK B) - I verified the field did NOT exist in the code then (cmdStatus/
readRigHealth exposed no last-activity), so it was correctly not documented (never-document-what-does-not-exist, not copied on trust).
**Superseded since:** the lastActivity field has LANDED - impl #618 cli status seat last-activity, ISO-8601 via readRigHealth (src/readapi.mjs sets seat.lastActivity = new Date(lastTs).toISOString()), and the FEATURES.md status row (section 2) now names it. The tokens/cost/model metrics row is #504's (lead-coordinated), not added here. Nothing pushed.

## Updated 2026-10-17 (scribe — docs truth-up for the landed work, #1233)

The registration lag noted in #1233 was checked against `main` before writing; only work verifiably on `main` is recorded here, each claim grounded by the named demo (run in the item-1233 worktree, all exit 0 unless noted):

- **#873 `compact` verb landed** (merge 2bce86e). Manual context compaction: summarizes a seat's OLDER turns into a `pi.compaction` summary entry so the model context shrinks without losing the durable transcript; refuses a live generation lease and a driving broker; drives the compaction task to completion and proves the summary entry landed. Proof: `demo/compact.test.mjs` exit 0. Already in FEATURES.md (compact row + Context-compaction row); no doc change needed beyond confirming it.
- **#874 per-turn wall-clock bound landed** (7013294, merged via #1040). The degeneration guard's wall-clock cause reads `AssistantMessage.durationMs` (a number the harness already persists, not a parse of prose); the threshold is high (5 min) so a legitimately slow turn is never reset — only a run that badly outgrows the bound. Proof: `demo/degeneration-duration.test.mjs` exit 0.
- **#875 degenerate-text registry landed** (merge e4ed785). The prose guard became a NAMED-PATTERN registry (`TEXT_PATTERNS` in `src/attention.mjs`), each pattern a pure predicate over one assistant turn's text, named in the reset reason as `degenerate-text=<name>=<count>>=<bound>`, and proven against real turn fixtures (`demo/fixtures/degenerate-text/` positive = real loop, negative = healthy turn). Replaces the D78 word/fragment heuristic that false-reset five healthy seats (reverted `449e870`). Adds `scripts/degen-scan.mjs` and the `docs/runbooks/degeneration-guard.md` runbook. Proof: `demo/degeneration-text.test.mjs` exit 0.
- **#998 worktree recursive-carry fix landed** (7901501, merged via #1040). `carryVisibleState` now excludes LINKED worktree roots (a sibling `item-<id>` or the just-created target appears in the source's status as an untracked directory), so the dirty-source fork never copies a whole foreign checkout and never self-copies into its own source (`ERR_FS_CP_EINVAL`). Proof: `demo/worktree-recursive-carry.test.mjs` exit 0.
- **#1165/#1171 scratch-worktree landing helper landed** (eb87766). `scripts/land.mjs` merges branches in a SCRATCH DETACHED worktree, runs the suite there (`--suite`), and advances `main` only by a clean fast-forward, so the shared tree is never mid-merge (the 2026-10-17 landing-safety incident). It is also the pre-flight enforcement chokepoint (#1164 Q3): refuses a dirty tree, a mid-merge tree, and a held genlock slot. Proof: `demo/land-helper.test.mjs` exit 0.
- **#1109 / #1108 (TUI input overlay + context read-surface) NOT recorded** — they are NOT on `main` at this commit (2f0004 sits on unmerged branch `impl-item-1109`, 1 commit ahead of main; no #1108 landed commit exists). Per the never-document-what-is-not-there rule, they are withheld here and reported to pm as not-landed, not stale-documented.

Proof-surface note: the FEATURES.md section 10 count was corrected to 115 demos with the honest measured state — 111 pass on this checkout; the 4 failures are pre-existing environmental (the starter constitution-drift family `starter`/`commit-model`/`seat-commit-instructions` per #976, and `worktree-lifecycle`'s Windows `git worktree remove` temp-permission cleanup artifact), not feature regressions. Nothing pushed.
## Updated 2026-10-17 (scribe — currency truth-up re-derived against current main, #1401)

Re-derived from the #1233 truth-up (which could not land as-is) against current main, on top of the
mojibake decode (#1400). Each claim grounded by the named demo, run in the item-1401 worktree (all
exit 0 unless noted):

- **#873 `compact` verb landed.** Manual context compaction — summarizes a seat's OLDER turns into a
  `pi.compaction` summary entry so the model context shrinks without losing the durable transcript;
  refuses a live generation lease and a driving broker; drives the compaction task to completion and
  proves the summary entry landed. Proof: `demo/compact.test.mjs`; FEATURES.md §2/§5 already carry the
  `compact` command and Context-compaction rows.
- **#874 per-turn wall-clock bound landed** (`7013294`). A degeneration cause reading
  `AssistantMessage.durationMs`, threshold 5 min (`maxTurnDurationMs: 5 * 60_000`), so a legitimately
  slow turn is never reset — only a run that badly outgrows the bound. Proof: `demo/degeneration-duration.test.mjs` exit 0.
- **#875 degenerate-text named-pattern registry landed.** `TEXT_PATTERNS` in `src/attention.mjs` — each
  pattern a pure predicate over one assistant turn's text, reason `degenerate-text=<name>=<count>>=<bound>`,
  validated against real turn fixtures (positive = real loop, negative = healthy turn); adds
  `scripts/degen-scan.mjs` and the `docs/runbooks/degeneration-guard.md` runbook. Proof: `demo/degeneration-text.test.mjs` exit 0.
- **#998 worktree recursive-carry fix landed** (`7901501`). `carryVisibleState` excludes linked worktree
  roots (a sibling `item-<id>` or the just-created target appears in the source's status as an untracked
  directory), so the dirty-source fork never copies a foreign checkout and never self-copies
  (`ERR_FS_CP_EINVAL`). Proof: `demo/worktree-recursive-carry.test.mjs` exit 0.
- **#1165/#1171 scratch-worktree landing helper landed** (`eb87766`). `scripts/land.mjs` merges the named
  branches into a SCRATCH DETACHED worktree, runs the suite there (`--suite`), and advances `main` only
  by a clean fast-forward; it is the pre-flight enforcement chokepoint (#1164 Q3) refusing a dirty tree,
  a tree already mid-merge, and a held genlock slot; a conflict stops and reports the paths. Proof:
  `demo/land-helper.test.mjs` exit 0.

**Demo count re-measured:** 115 `demo/*.test.mjs` files on this checkout (read-only count). The broker
upgrade `234e06e` validated the full demo suite 115/0 and the TUI suite 15/15 on pin `8efd314f` — I did
NOT re-run all 115 (a full-suite run exceeds the per-turn bound, consistent with the #1337 note); the
named demos above are the evidence for the rows. FEATURES.md §10 updated from the stale "49 offline tests".

Base note: this truth-up is based on the decoded FEATURES.md/STATUS.md (scribe-item-1400) so it carries
no mojibake, and is stacked after the decode for landing. Nothing pushed.
