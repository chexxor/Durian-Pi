> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.

# Selfdev queue triage — 2026-10-14

**Reviewed:** all 92 non-done items in `selfdev.sqlite` (51 queued, 9 claimed, 32 deferred), against
current state (git log on `main`, DECISIONS D40–D46, `docs/NEXT.md`, `docs/ROADMAP.md`) and the live
broker run. **Method:** subjects + bodies + last-transition date, cross-checked against what has
actually landed.

## Headline

1. **Most "active" volume is bookkeeping, not work.** 30 of 51 queued items are `notice:true` DONE
   acknowledgements to `pm`/`lead`; ~10 more are completion reports filed as ordinary work (not
   flagged `notice`). That is ~40 of 60 active items. The broker wakes the recipient and grinds them
   **oldest-first**, so its first many passes spend real model turns acking October-13 notices. This
   is the "lot of old items" risk, and it is real.
2. **The 32 `deferred` items are not at risk.** `selectWakes` wakes a seat only for `queued` items or
   a stalled `claimed` run; `deferred` is parked and invisible to the broker.
3. **There is no way to curate the queue through its surface.** The Router offers
   `send_work`/`claim_work`/`complete_work`/`defer_work`/`resume_work`/`hold_work`/`release_work`/
   `peek_queue`; statuses are only `queued`/`claimed`/`done`/`deferred`/`held`. **No `cancel_work`,
   no `revise_work`** — an item's subject/body cannot be edited and a stale item cannot be cancelled.
   "Update the descriptions/scope" is therefore **blocked on tooling** (logged as F36).

## CLOSE — moot / superseded (work has landed or the decision is resolved)

| id | to | why it is moot |
|---|---|---|
| 110 | impl | P5 driver crash — fixed (`src/driver.mjs` guard + `demo/driversurvive.test.mjs`, D39) |
| 147 | impl | bounded `run` — `--max-duration` landed (`cmdRun`) |
| 177 | impl | rebase STEP 2 — #224 ruled "#177 AS MOOT" |
| 238 | impl | PIECE 3 resident broker "REGISTERED (gated)" — **built** (D45/D46); gate satisfied |
| 240 | lead | F23 readapi collision — **resolved** operator-directed (#248/#250) |
| 198 | pm | scope ruling for #189 — informational; the ruling is recorded |
| 226 | pm | question re #188 — #188 delivered (#227) |

## CLOSE / ACK — completion reports and DONE notices (no work remains)

These are protocol traffic, not work. `pm`/`lead` should claim+complete them (or they should be
bulk-acked) — nothing else is owed.

- 30 queued `notice:true` DONE acks: `195,196,199,200,206,207,224,225,229,230,231,232,233,234,235,237,264,265,267,269,271,277,279,281,283,284,285,286,295,297`
- completion reports filed as work (not flagged `notice`): `216,217,227,228,248,250,276`

## RESCOPE — scope is stale; re-issue or retire

| id | to | assessment |
|---|---|---|
| 202 | pm | "TUI CLIENT DECOMPOSITION — 6 items" — the operator is building the TUI directly on `main` (`src/readapi.mjs`, `src/viewmodel.mjs`); this decomposition predates that. Re-issue against the actual code, or retire. |
| 203 | pm | "BLOCKED: seat-root guard flipped mid-#148 to `…/pi-rebase`" — #148 is paused (#180) and the rebase landed; confirm the blocker is gone, then close or rescope. |
| 178, 186 | qa | independent verification of the rebase/pin — the pin landed and was documented (#284/#285). Either the verification still has value (keep) or it is superseded (retire). Needs a qa read before closing. |

## KEEP — valid and current

| id | to | subject |
|---|---|---|
| 251 | devtools | PIN GUARD: JSON.parse-validate `pi-main.pin.json` in sync-pi |
| 258 | devtools | F24-2: stale genlock slot (`pid undefined`) should be absorbed silently |
| 263 | qa | verify F25 (help exit 0 / unknown verb) |
| 278 | qa | verify #239 claim-by-id |
| 280 | qa | verify #257 F24 store-write retry |
| 282 | qa | verify #255 F23 worktree-dirty refusal |
| 288 | qa | verify F30/F31 hold/release tools |
| 293 | qa | verify peek_queue bounded output |
| 287 | impl | doc update (ROADMAP/DECISIONS) routed from lead |
| 289, 290 | impl | long mid-task waits + large context (handoff/compact/refresh) |
| 291, 292 | impl | F32 CRLF edit matcher; F33 settled-overlay snapshot helper |
| 294 | impl | mid-turn seat steering (sequenced after #291/#292) |
| 296 | impl | inline PUSH-ARCHITECTURE §3.2/§7 for lead (lead has no read tool) |
| 241 | lead | QUESTION #160: where model-change → reset fires (blocks #148 half 2) |

## DEFERRED — parked; the broker will not touch them

`60,61,62,63,90,101,148,154,156,160,164,165,166,170,171,172,174,180,188,193,220,252,253,254,275`
— intentionally parked. Note `110,147,177,238` also appear in this set and are moot (see CLOSE).

## Recommended actions

1. **Add `cancel_work(itemId, reason)` and `revise_work(itemId, {subject, body})`** (F36), or give
   `pm` a sanctioned triage pass. Without one of these, the queue cannot be curated at all.
2. **Have `pm` `complete_work` the moot and bookkeeping items** above (or the operator rules them
   closed). That removes ~40 items from the broker's path.
3. **Pause the broker** (`serve --stop`) until the queue is curated, so it does not spend turns
   acking stale notices.
4. Decide the three RESCOPE items (202, 203, 178/186) — the operator or `lead`.

## Applied — 2026-10-14

- **Cancelled 44 stale/bookkeeping items** in one pass (attributed `by: operator-triage`; store backup
  at `/c/tmp/durig-triage/selfdev.sqlite.pre-triage`): the 5 moot (`110,147,177,238,240`), the 9
  completion reports (`198,216,217,226,227,228,248,250,276`), and the 30 queued DONE notices.
  `cancel_work` (D47) is the in-product equivalent; this pass used the same representation.
- **Remaining active: 20 items** (8 `claimed`, 12 `queued`) — the KEEP set, plus `#298` (a fresh
  DONE notice for #278), plus the three RESCOPE items (`202`, `203`, `178/186`), still open.
- **28 `deferred` items** are parked and untouched (the broker never wakes them).
