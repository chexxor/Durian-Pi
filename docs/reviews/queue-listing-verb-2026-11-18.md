# QUEUE LISTING VERB — "show me the queue in human terms, sortable" (2026-11-18)

**Spool it (the operator runs this; the delegate did not):**

```bash
node intent.mjs pm --body-file docs/reviews/queue-listing-verb-2026-11-18.md --request-id <uuid>
# then start/keep the broker so the spool drains: node cli.mjs up rig.selfdev.json  (or serve)
```

`pm` owns decomposition and routing. Name lineage on every `send_work` mint: **`ROADMAP 381`** — the
fleet is 1,024 open work rows against a band of 120 (`10/seat x 12 seats`), so a **parentless** mint is
REFUSED by the lineage rule at `src/rig.mjs:309` (`mintGate`); see `docs/ROADMAP.md` 381.

## What the operator asked for, in their words

A new CLI action that **lists the queue items in a human-friendly way with all relevant details/attributes**,
and that **lets the operator sort them** in the ways that matter (age, seat, status, priority, gate state, cost).

## Why it is not already there (measured 2026-11-18, host Linux / Fedora Linux 45 (Forty Five) / kernel
`7.2.15-300.fc45.x86_64` / node v24.22.1 / git 2.56.0, store `./selfdev.sqlite`, HEAD at this window)

| Today's surface | What it actually is | Cost measured |
| --- | --- | --- |
| `node cli.mjs queue --json --no-body` | machine view, every row, **no sorting**, no lease/age column set | 2 s (prior window) / 18,270,766 B printed |
| `node cli.mjs queue --human --limit 3 --no-body` | a **LEASE view, not an item listing** — it prints the 3 live leases and says `rows without a lease are not listed (the view is the leases, not the census: 7742 rows exist)`; exit `124` because it exceeded a 30 s tool bound (32.2 s wall) | **>30 s** (`.spike/q-18.out` 2,695 B) |
| `node cli.mjs status --json` | per-seat health + attention + `queueCensus.shape`; aggregate only, not a list | **18.6 s** (`.spike/status-18.out`) |
| `node cli.mjs watch --once` footer | one number per status — `queue 876 queued ...`, the number is not a count of work (ROADMAP 377) | ~0.1 s |
| `tools/queue-pressure.mjs` | census + band verdict + **open work per seat** (`impl=439 devtools=239 pm=121 scribe=99 qa=81 lead=23 auditor=11 security=4 qa2=2 advocate=2 unaddressed=2 architect=1`) | 5.1 s exit 1 |
| `tools/claim-order.mjs` | which row a claim takes per seat (the claim ORDER, not a listing) | see its header |
| `intent.mjs queue --op queue --action pressure` | the same census through the broker spool | — |

So: **no verb lists items with their attributes, and nothing sorts.** `cli.mjs queue` flags today are
`--json --id --status --to --no-body --held --with-gates --human --limit` (`cli.mjs:1298-1325`,
`QUEUE_USAGE`), the bounded view cap is `QUEUE_VIEW_ROW_CAP = 200` (`src/readapi.mjs:302`), and
`projectQueueView` (`src/readapi.mjs:326`) takes `{cap, dropTerminal}` — **no `sort` key**.

## Requirements for `pm` to carry (numbered, so the seat can tick them)

1. **One verb, two planes.** Human view only when stdout is a TTY, one JSON document otherwise (D19).
   Suggested surface: `node cli.mjs queue --list [--sort <key>] [--dir asc|desc] [--status/--to/--ids …]
   [--limit N] [--fields <list>]` — a new flag on the existing `queue` verb, not a new top-level verb,
   unless the team prefers the latter; state the choice and why in the row.
2. **Attributes per row, named in the header** (so the human view is self-describing): id, status, `to`
   (owner seat), subject, age since `queued`, age since last event, priority + lease state
   (`HONOURED`/`INERT`/`lapsed` — `src/deferlease.mjs:79-116`), tier + token estimate, gate state
   (open / satisfied / cancelled — `src/heldgate.mjs`), lineage (`ROADMAP n`, `#id`, `blockedBy`,
   artifact path — `lineageOf` at `src/queueclass.mjs`), disposition (work / notice / registration
   — `src/queueclass.mjs` shape), and "awaiting operator" (`item.deferredTo === "human"`).
3. **Sort keys must be the rig's own vocabulary, not an invention**: `age`, `priority`, `seat`,
   `status`, `kind`, `tier`, `gate`, `id` — each declared, each refusing an unknown key **by name**
   (the fail-open this replaces: `queue --zork` used to exit 0 printing the whole 22 MB document,
   ROADMAP 228; the flag table at `cli.mjs:1289+` is already the declarative refusal, extend it).
4. **Stable ordering, and say which key breaks ties.** A sort that reshuffles on re-run makes a human
   re-find nothing; tie-break on `id` ascending, and print the sort key in the header line.
5. **Bounded output with the bound printed** (`QUEUE_VIEW_ROW_CAP = 200` default, `--limit` up to the cap,
   `--full-queue` as the explicit ask for the whole document) — a 7,742-row print is a defect, not a feature.
6. **Cost stated on the row that ships it, in seconds**, and it must beat the naive path: reading the
   queue document is the floor (`queue --json --no-body` ~2 s); the view must not re-scan the store per row.
7. **Fast loop of its own (D213):** a hermetic fixture pin (`demo/queue-list-sort.test.mjs` on a seeded
   in-memory store, mocked `fauxProvider` plane — no key, no network) that pins the sort order, the
   tie-break, the unknown-key refusal, and the cap; registered in `demo/test-areas.json` so
   `scripts/test.mjs --area readapi` (or the area the team picks) turns it green in one bounded call.
8. **D212 — the plane question must be answered, not skipped.** A queue-listing sort is a **read surface**:
   prefer extending `src/readapi.mjs` (`projectQueueView` gains a `sort` key) + the `cli.mjs` flag table,
   because the base has no seam a `pi-durable` extension can reach for a CLI read verb; if the team would
   rather ship it as an extension, name the seam it needs instead of editing the base.

## Deliverable

- Code: `src/readapi.mjs` + `cli.mjs` (or the extension the team chooses) — one verb, sorted, attributed.
- A `demo/` pin named above, plus a row in `docs/ROADMAP.md` 381 marked **shipped** with measured seconds.
- Docs: the flag line in `docs/FEATURES.md` and the pointer's "Run these first" block, each carrying the
  measured cost and the host line (OS + distro + kernel + node, never `user@hostname`).

## Evidence to keep verbatim (fetch date 2026-11-18)

- `timeout 30 node cli.mjs queue --human --limit 3 --no-body` → **exit 124** (32.2 s wall, hit its bound);
  header `queue — human lease view db=…`; last line `rows without a lease are not listed (the view is the
  leases, not the census: 7742 rows exist)`.
- `timeout 60 node tools/queue-pressure.mjs` → **exit 1, 5.1 s**: `rows 7742 · live 1200 = work 1024 +
  notice 5 + registration 171`; ages `<=2d=0 3-7d=345 8-14d=464 15-30d=73 >30d=45 no-queued-event=273`;
  `awaiting operator: 286`; verdict `FAIL — out of band: 1024 open work rows against a band of 120 … over
  by 904 · growing past the fleet: net +302 in 7 d is at least one full band (120)`.
- `timeout 60 node tools/channel-preflight.mjs` → exit 0, 6.5 s: `claimable (queued)=553 in-flight (claimed)=28
  parked (held+deferred)=619`; per seat `pm 87 / impl 254 / qa 21 / lead 0 / advocate 1 / scribe 60 /
  devtools 127 / auditor 0 / designer 0 / security 1 / qa2 0 / architect 0` claimable; `VERDICT: 553 claimable
  rows — a start has real work to wake onto`.
- `timeout 60 node tools/keycheck.mjs --level=auth` → exit 1, 0.14 s: `deepinfra` and `verifier` read
  `auth: incomplete`, `credentialSource: null`, `verdict: NOT-OK`, `configKeyGap: ["DEEPINFRA_API_KEY"]`;
  `local` reads `auth: complete`, endpoint `loopback 127.0.0.1:8080`, advertises `qwen3.8-flash-next-q2_0`.
  **A seat turn on the configured metered provider fails as `no_model`/auth before any request.**
