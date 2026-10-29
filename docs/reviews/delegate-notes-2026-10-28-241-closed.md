# Delegate session notes — 2026-10-29T02:4x–03:3xZ (host-local 2026-10-28 21:4x–22:3x CDT)

Host `Alex-Desktop-Win10` (Linux, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1), zone `America/Chicago` (CDT = UTC−5).
Item worked: **ROADMAP 241's second half** (the research gate the operator put in front of 232). Deliverable:
`docs/reviews/codex-permission-model-and-guard-plane-2026-10-28.md`; register: **247**, **248**, 241 updated.

## What was true at clock-in, re-measured (nothing had rotted; do not re-measure these for 24 h)

`tools/channel-preflight.mjs` 4.0 s · `broker-serve.mjs --dry-run` 3.6 s, still **BLOCK** on `seat-shell-availability` and
no longer on `live-tree-dirty` (tree clean) · queue **4,821 rows = 3,748 done / 777 cancelled / 277 held / 19 deferred,
0 claimable** · `queue-drain-audit` 1.2 s (91 non-terminal LANDING rows, 71 already on main, 69 orphan candidates) ·
`instrument-provenance` PROVENANCE CLEAN (cite drift 2, soft) · `harness-usage-census` **19 sessions / 2,669 calls /
296 ad-hoc (11.1%)** on this host alone · `vendor-pins --check` **PASS at 14 clones** · worktrees **1**, `.git/worktrees`
empty · broker **down**, pid 1771484 dead, last pass 2026-10-28T17:09:58.308Z · spool holds 1 intent
(`delegate-routing-fact-20261028-2150`, 349 min at clock-in).

## The measurement that reorders the queue of priorities

**No queue row anywhere names ROADMAP 217, 232, 233 or 235–248.** Checked against this session's own dump: 4,821 rows,
`subject` matched against `ROADMAP (217|232|233|235-248)` → **0 hits**; the non-terminal 296 subjects name old numbers
(63/64/67, 71, 90–96 …). The pointer has been treating ROADMAP rows as work the team "should land first" when they have
never been decomposed or spooled at all. Consequence: landing 217 is now *research-complete and queue-less*, and the
cheap unblock is an operator grant to spool one intent to `pm` (registered as **OPERATOR OWES item 5**). Read the ROADMAP
and the queue as different objects: **a ROADMAP row is a promise; a queue row is work.**

## Trouble, and the shortcut for next time

1. **`docs/NEXT.md` has a hard 200-line cap enforced by a test, and I overran it twice.** Shortest path, in order:
   `wc -l docs/NEXT.md` **before** editing; if the budget is tight, **cut to `docs/NEXT-ARCHIVE.md` first** (append the
   block verbatim with a dated heading), then rewrite the pointer with **long lines** (this file already wraps at ~120–130
   chars — wrapping to 100 is what turns one paragraph into six lines). Then run
   `node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs` and confirm `wc -l ≤ 200`. Final state this
   session: **199 lines**, both tests PASS.
2. **The citation self-check is worth its 10 minutes, and it found a bug in itself, not in the note.** 59 rows of
   `(clone, path, line, substring)` over the two pins + a `wc -l` table: **58 PASS**, the single FAIL was a placeholder
   probe for a file the note declares unread. Fixing that honestly meant *narrowing the claim* (I quote the file's
   3-line header and say the rest is unread), never moving the goalposts. Re-derivation recipe:
   `docs/reviews/codex-permission-model-and-guard-plane-2026-10-28.md` Appendix A.
3. **233 is still eating the delegate's own instruments.** The check script sits in `.spike/` (gitignored) and will not
   survive; the note carries the recipe instead. Proposal 5 in `docs/NEXT.md` names the permanent version
   (`tools/review-cite-check.mjs`, path:line resolution + asserted line counts).
4. **Reading `queue --json` in python: `transitions` is already a list, not a string.** `ast.literal_eval` on it raises
   and, swallowed, silently reports zero events — I nearly reported "no `done` transitions exist". Use the parsed value
   directly; the vocabulary is `queued/claimed/done/deferred/resumed/cancelled/revised/held/released`. Also remember the
   trailing `note: N measure(s) out of band…` line: read with `json.JSONDecoder().raw_decode`.
5. **The pins are on disk and cheap to read.** Every 241 answer came from `sed`/`rg` inside `vendor/eval/<clone>` in a
   few seconds — no web, no research agent, no grant. If a ROADMAP row says "unread file X at a pin", the default next
   action is *open the file*, not *commission research*.

## Speed proposals (wall-clock, for the operator to grade)

- **Move the 241-style reads earlier in a research cycle.** Round 3 cost a full off-host research round to *narrow* the
  question; the answer then cost ~40 minutes of local reading at a pin already in this repo. Rule of thumb now: **if the
  claim is about a shipped harness's behaviour and the harness is pinned, read the pin first and spend the research
  agent only on what the pin cannot answer** (Copilot CLI's implementation stays unanswerable — that clone is
  README+changelog, `docs/VENDOR-PINS.md`).
- **Register the "no queue row" check as part of clock-in** (one grep over `queue --json`, <1 s, now written into the
  pointer's next-command block): it is the difference between "the team is slow" and "the team was never told".
- **Decide the two standing grants between sessions, not inside them.** 217's fix and 232's ledger scoping are both
  research-complete; the wall-clock cost is the round-trip, not the work.
