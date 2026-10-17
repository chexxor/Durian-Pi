---
incident: qa-context-degeneration
date: 2026-10-17
severity: sev2
status: mitigated
symptom: "a seat outputs incoherent/repeated text and burns tokens; the degeneration guard never resets it"
runbook: degeneration-guard
fix: null
prevention: "#1703, #1704, #1705"
last_reviewed: 2026-10-17
---

# qa degenerates on a saturated context and the guard never resets it

*Incident 2026-10-17; detected by the delegate; analysis by the delegate; recovery run by the
delegate under operator sanction + lead ruling #1708.*

## Summary
`qa` (conv 15, `zai-org/GLM-5.3-Flash`, `thinkingLevel: high`) degraded into incoherent, repeating
output while its context climbed to **367,559 tokens** on a single turn. The degeneration guard never
reset it: `assessRun` only judges the "current run" (entries above the last `pi.user`), and the broker
submits a `pi.user` wake after essentially every turn, so the run window was 1–2 turns and no bound
ever accumulated. In the same pass, the guard *over*-reset `impl` for a cause it misread (a tool
duration counted as a model stall). qa also hung in a runaway "outputting" turn that the broker's F11
drain waited on forever.

## Timeline
- Earlier: `impl` gets **285+** `degeneration` resets in one broker session (false positive); `qa`
  gets **0** (false negative) while its turns degrade.
- `#71502` (qa): assistant turn at `usage.totalTokens = 367559`, `durationMs = 357941`, no tool call;
  its text says *"My recent turns have degraded into incoherent outputs again."*
- `#70973` / `#71053` (qa): word-salad loops ("the ask carries the next …", "seek the ask, seek at
  the queue …"); `#70742` mixes CJK (`...only for the审理`).
- Delegate routes the fix (`opr-20261017-degeneration-guard-fix`) → pm registers `#1703`/`#1704`/
  `#1705`; lead rules `#1708` (recover qa now, delegate authorised, operator must declare the window).
- qa hung outputting; `serve --stop` returned `stopped:true` but the broker stayed in the F11 drain,
  refreshing qa's genlock forever.
- Delegate: backed up the store, force-killed the drain pid, `resume`, then **`compact qa`**.

## Impact
qa burned tokens without producing value and could not verify (its job), while the broker's drain
blocked quiescence (so no landing pass could run). `impl` lost context to repeated false resets.

## Root cause
**Defect B — false negative (qa).** `assessRun` builds the run from entries newer than the last
`pi.user`. The broker submits `pi.user` "You have queued work" after essentially every qa turn, so
`repeats`/`toolTurns`/`degenerate-text`/`turnDurationMs` never accumulate and `contextTokens`
(367k) never reaches the fixed `maxContextTokens: 400_000`. A seat that degrades across many SHORT
runs is invisible.

**Defect A — false positive (impl).** `assessRun` computes `turnDurationMs` from
`messageOf(entry)?.durationMs` over the whole run, including **tool-result** entries. Entry `#72059`
is a `pi.tool-result` (full demo sweep, `ran=123 fail=0`) at `durationMs=301935`; the assistant turn
that issued it was `#72057` at `2075 ms`. A legitimate ~5-min TOOL run trips the "per-turn wall-clock
stall" bound; and the broker's long-lived read handle does not observe the `pi.reset` it just wrote,
so the `items[0].kind === "pi.reset"` idempotence check never fires and it re-resets every pass.

## Detection
`status` attention `generation_in_flight` held for many minutes with no new transcript entry, plus the
incoherent turns themselves. There is **no** durable detection for context-pressure degeneration yet —
the guard's own context bound is the closest thing and it did not fire.

## Resolution
One operator-sanctioned window: `serve --stop` → backup (`.spike/store-backup-20261017-165036`) →
force-kill the draining broker (qa never settled) → `resume` → **`compact qa`** (`taskId 72644`,
`summaryEntryId 72645`) → restart. A second short cycle was needed because qa's post-compact
submission landed `admitted_not_started` (item 37(b): the broker will not re-arm it and `resume`
refuses while the broker drives). Result: qa context **367k → ~48k tokens**, coherent on-task turns,
**0** degeneration escalations after restart.

## Prevention
The guard fixes are registered but **NOT LANDED** (`#1703` duration window, `#1704` reset idempotence,
`#1705` run window / context bound — all `queued`). Until they land this can recur. The context-bound
half is **model-sensitive**: GLM-5.3-Flash *advertises* ~1,048,576 tokens but qa degraded at 367k, so
the fix must use the model-aware window (the `DURIG_CONTEXT_WINDOW` seam / `src/context.mjs`
denominator), not a fixed constant. Prevention stays `null`-equivalent until those land.

## Evidence
- `docs/incidents/` — this report; `.spike/serve.err` held 285+ `impl` degeneration lines and **0**
  for `qa`.
- `selfdev.sqlite` conv 15: `#71502` (`totalTokens=367559`, `durationMs=357941`), `#70973`, `#71053`,
  `#70742`; conv 9: 20+ consecutive `pi.reset` ids `72099`–`72118`.
- `selfdev.sqlite` conv 9 `pi.reset` handoff text: `per-turn wall-clock bound (turn-duration-ms=301935>=300000)`.
- `src/degeneration.mjs:104` (top-level `items[0]` skip), `:145-152` (run window + `contextTokens`),
  `:44` (`maxContextTokens: 400_000`); `src/supervisor.mjs:141` (`planResets`), `:164` (`applyResets`).
- Broker log: `START pid=37388` (19:53Z, no `EXIT`), kill + `resume` + `compact qa` at `21:52Z`; new
  `START pid=32840` (22:03Z).
- qa post-compact turns (`#72752`, `#72770`) coherent, ~48k tokens.
- Advertised window: `vendor/pi-main/packages/ai/dist/providers/data/baseten.json`
  (`zai-org/GLM-5.3-Flash` → `1048576`); `durig.config.json` `DURIG_MODEL = zai-org/GLM-5.3-Flash`.

## Links
`docs/runbooks/degeneration-guard.md` · `docs/runbooks/seat-reset.md` ·
`docs/context` (`src/context.mjs`, ROADMAP 27) · queue items `#1703`, `#1704`, `#1705`, `#1707`,
`#1708` · `docs/incidents/2026-10-17-broker-crash.md`
