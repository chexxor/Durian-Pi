# PIECE 2 (#210/#221) — durable event feed: evidence

> RENAME (#240, operator decision 2026-10-13): the durable event feed and the shared read API stay
> SEPARATE files. The feed module I added was renamed `src/readapi.mjs` -> `src/eventfeed.mjs` (the
> shared read API keeps the `readapi` name). Imports updated in cli.mjs + demo/events.test.mjs; no
> behavior change. Re-run after the rename: `node demo/events.test.mjs` exit 0; `node --check` on
> eventfeed.mjs/cli.mjs/events.test.mjs all exit 0; no `src/readapi.mjs` remains; `events` verb still
> emits {"seq":10001,...} and `--since 10001` does not replay. The pre-rename evidence below is kept
> as the original record (it names the old filename, which is what was built at the time).

Concern (one): a READ-ONLY, ADDITIVE machine-readable event stream with a monotonic, durable
`seq` cursor so a late/reconnecting subscriber resumes instead of replaying (§3.1).

## Changed files
- `src/eventfeed.mjs` (NEW; renamed from `src/readapi.mjs` per #240) — `readFeed(storage, ctx, { sinceSeq })` -> `{ events, nextSeq }`; `buildEvents(items)`; `SEQ_STRIDE`. Opens **storage directly, never a harness** (D11); writes nothing.
- `cli.mjs` — ADDITIVE `events` verb (`--since <seq>`, `--follow`, `--json` default), one import, one dispatch branch, one usage line. No existing verb changed.
- `demo/events.test.mjs` (NEW) — the falsifiable both-directions demo.

## Cursor model (durable, not process-local)
`seq = itemId * 10000 + transitionIndex + 1`, over the queue transition log + item ids. Durable
(storage-derived), strictly increasing in (itemId, transitionIndex). `watch`'s `seq` is a
process-local counter and cannot resume across a restart; this one can.

## Raw evidence (commands + exit codes)

### Failing-first (before src/readapi.mjs existed)
```
$ node demo/events.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\src\readapi.mjs' imported from ...\demo\events.test.mjs
exit=1
```

### After implementation
```
$ node --check src/readapi.mjs   -> exit 0
$ node --check cli.mjs           -> exit 0
$ node --check demo/events.test.mjs -> exit 0

$ node demo/events.test.mjs
EVENTS TEST PASS (read-only feed: quiet=0 events; enqueue emits queue.enqueued with a durable seq;
reconnect from seq does not replay; a later claim emits a strictly greater seq)
exit=0
```

### Live `events` verb (temp rig: `up rig.starter.json` exit=0)
```
$ node cli.mjs events                          # quiet rig
(nothing)
exit=0

# enqueue item 1 via setup-queued-item.mjs -> {"ok":true,"itemId":1,"to":"impl","status":"queued"} exit=0
$ node cli.mjs events
{"seq":10001,"ts":"2026-10-13T18:45:59.094Z","itemId":1,"kind":"queue.enqueued","to":"impl","from":"pm","subject":"EVENTS_LIVE"}
exit=0

$ node cli.mjs events --since 10001            # RECONNECT: no replay of the enqueue
(nothing)
exit=0

# enqueue item 2 -> {"ok":true,"itemId":2,...} exit=0
$ node cli.mjs events
{"seq":10001,...,"itemId":1,"kind":"queue.enqueued",...}
{"seq":20001,...,"itemId":2,"kind":"queue.enqueued",...}
exit=0

$ node cli.mjs events --since 10001            # resume: only item 2 (item 1 excluded)
{"seq":20001,"ts":"2026-10-13T18:46:09.774Z","itemId":2,"kind":"queue.enqueued","to":"impl","from":"pm","subject":"EVENTS_LIVE_2"}
exit=0

$ node cli.mjs events --since 20001
(nothing)
exit=0
```

### --follow (resident) and read-only proof
```
# events --follow --since 20001 running; a new enqueue emitted live:
{"seq":30001,"ts":"2026-10-13T18:46:29.938Z","itemId":3,"kind":"queue.enqueued","to":"impl","from":"pm","subject":"EVENTS_FOLLOW"}

# db SHA256 unchanged by an `events` read:  True   (no write path)
```

### Demo suite (honest)
```
total=49 passing=48 failing=[syncpi.test.mjs]
```
`syncpi.test.mjs` fails on the pre-existing malformed `pi-main.pin.json` (the #176 rebase note is
missing the comma before `"packages"`; `scripts/sync-pi.mjs` readPin throws SyntaxError at pos 729).
That is devtools' defect (#219), not PIECE 2's; the new `demo/events.test.mjs` passes. No attempt
was made to fix it (out of scope; no product change would be justified by this item).

## Known limits (honest)
- The feed currently derives events from the **queue transition log** (enqueue/claimed/done/deferred).
  Per-seat `turn.streaming` / `generation.settled` events (§3.1) are NOT emitted yet — that needs the
  submission/entry scan and the D40 "partial is not a turn" rule; it is additive later work, not a
  change to this cursor.
- `readapi.mjs` did not previously exist; §3.1/§4 named it as the intended home. It is created here
  as the read-only feed module, matching the `watch` read path (storage direct, no harness).