## NEXT SESSION (2026-11-03T21:3xZ — D200, Linux `chexxor@ThinkStation-P3`: **all three steps of the operator's order are now in flight or landed**; `main = 5d4992b6`, **18 ahead of `origin/main`, unpushed — ask for the grant**, and the two seat repairs the operator authorized are DONE and worked)

**What just happened.** Step (1) landed at `84edff3c` (#5027 clean-side scorer). Step (2)'s **build half landed at
`a65ba431`** (#5024: `tools/model-probes/metered.mjs` is now the single accounted metered path — pre-send refusal
when no key, append-only JSONL spend ledger with a named `priceSource` and `usd: null` for unknown, printed per-run
bill, `DURIG_PROBE_CEILING_USD` guard that raises `CeilingError` before the request; #5026 shim docs). Step (2)'s
**decision half landed at `5d4992b6`** (architect's #5015/#5025: 3 review docs, D-entries, and
`tools/model-probes/spend-cap-acceptance.mjs`, a deliberate **failing-first** record: exit 1, 2/11 PASS, 9 RED — the
acceptance instrument for the #5037 build, not a red build). Landing proofs: suite **246/246 → 248/248 (46.0 s) →
248/248 (44.9 s)**, `failed: []` every time, all in this operator checkout (vendor dependency set), plus
`merge-tree` clean and `--is-ancestor` proof before each `scripts/land.mjs` (no `--suite` — see the pitfall).

**Repairs the operator authorized, and what actually worked:** `compact` is a **no-op** on this rig
(`{"state":"no-op","window":null,"policy":{}}` — the `DURIG_COMPACTION_*` keys exist in `src/config.mjs:133-142` but are
all `null`), so the working repair verb is **`reset <seat> [handoff]`** (preview with `--dry-run`). `architect` and
`lead` were reset; both then ran real turns: **`lead` 145,429 → 7,892 consumed**, **`architect` 218,645 → 135,567 with
a compaction that SURVIVED (`pi.compaction@281000`)** — that is the operator's `MAX_TOKENS=16384` grant working on a
second seat. `send` works on a seat whose projection is `(1) user` right after a reset, which also proves this
endpoint tolerates non-strict alternation.

**Current item:** the operator's order (D194/D195). Everything before this block is VERBATIM in
`docs/NEXT-ARCHIVE.md` (this cut moved the D199 pointer, 11,056 B, round-trip-verified). **Next major priority, in one line: the metering plane — build
#5037 (the spend cap at the provider seam) to the now-landed acceptance probe, and mint roadmap 208's
context-fraction guard as its sibling** (tonight's every failure was "the rig cannot see or bound its own context and
spend": `advocate` reads **244,751 / 24,576 = 9.96** and nothing anywhere reads `status.context.fraction`). Second:
**#5016 / ROADMAP 228 — the row-scoped queue read**; `queue --json` is **22,177,798 B** and the delegate paid it **four
times tonight**; unknown flags are accepted and silently ignored.

**Queue ids that matter now:** #5027, #5024, #5026, #5015, #5025 **done** · **#4970 `deferred` → the operator** (three
one-line rulings, below) · **#5037 (spend-cap build) and #5038 (fold ruling) `queued` → `pm`** · **#5016, #5031
`queued` → `lead`** (in flight at clock-out, pid 2820531, request `d202-lead`) · #5022 (probe promotion)
`queued` → `devtools` · #4997 (known-red baseline) still **held** by `devtools` · #5004 (70 zero-build-closable
LANDING rows) `deferred` → `pm` · census 2026-11-03T21:2xZ: `done 3796 · cancelled 795 · held 335 · queued 93 ·
deferred 15 · claimed 4`.

**Blocker:** the three capacity rulings in §0 (the operator's, one line each) and the push grant. Everything else is
executable tonight. Secondary: the five `verifier/…` seats have no provider (`:1234` dead, and architect measured that
**nothing local fits** the KV need), and `impl`/`scribe`/`qa` need the same `reset` repair before they can be woken.

### 0. The three one-line rulings `architect` parked on the operator (#4970 HALF B) — the only real blocker

1. **Which window is authoritative?** One config copy says 160,000, the other 200,000, the endpoint serves
   `--max-context 204800`, and the measured refusal bracket is **191,805 OK / 207,219 HTTP 400**.
2. **Is `DURIG_LOCAL_MAX_TOKENS=16384` a rig property or a per-verb prefix?** (Tonight it was a prefix on every verb;
   `durig.config.json` is gitignored and the two copies drift — that drift is #4970 itself.)
3. **The compaction reserve.** `architect` recommends **20,480** (the knee: `0.8 × 20,480 = 16,384 = maxTokens`, which
   maximizes the summary budget and leaves 8,896 tokens of margin where pi's default 16,384 leaves 4,800), and its
   model reproduces the band measured tonight (143,616 vs consumed 145,429 / 143,426 / 143,278).
   Evidence: `docs/reviews/architecture-capacity-rulings-2026-11-03.md`.
   **Hazard to price while you are there:** the tracked curated price table (`deepinfra-models.ts:147`) carries
   `google/gemini-3.1-pro` at 1,000,000 ctx / $2.00/$12.00 ⇒ **one maximal call = $14.00 = 3.50× the operator's whole
   $4 grant**, and 4 of 16 curated rows are absent from the live catalog.

### 1. Next commands, in order

1. **Push on a grant** — `git rev-list --count origin/main..main` = **18** at clock-out (`93ae0145`, `a0bd029f`,
   `e61ac4f5`, `84edff3c`, `eeb32ed1`, the `item-5024` trio + merge `a65ba431`, the `item-5015` sextet + stacked
   `1ae15cb1` + merges `1511628b`/`5d4992b6`, plus the D200 docs commit).
2. **Read the settled `lead` reply** at `.spike/delegate-20261103c/send-lead-1.out` and verify #5016/#5031 the same
   way the last three were verified (`merge-tree` clean → full suite before/after → `scripts/land.mjs` →
   `--is-ancestor` → prune the landed worktree/branch by hand).
3. **Then #5037** (spend-cap build) — it is `queued` to `pm` and its own subject says **URGENT, route to `impl`**, and
   its acceptance already exists and is red on purpose:
   `node tools/model-probes/spend-cap-acceptance.mjs --snapshot .spike/5015/catalog-2026-11-03.json` → **exit 1,
   2/11**; done when it exits 0. **Note for routing: `impl` currently ends its counted projection on `user` and sits at
   143,278/160,000, so it needs the same `reset` repair before any wake — and it holds claimed rows #4799 and #4955,
   which is why the delegate did not reset it unasked.**
4. **Dispatch pattern that worked three times tonight** (no broker up — `send` is legal only then):
   `cd /home/chexxor/Git/durian-dev/seatroot && DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite DURIG_LOCAL_CONTEXT=200000 DURIG_LOCAL_MAX_TOKENS=16384 node cli.mjs send <seat> --body-file .spike/delegate-20261103c/brief-<seat>-N.md --request-id dNNN-<seat> --no-stream`
   (request ids **under 40 chars**; seed the seat root's `.spike/` first if the brief names a probe — runbook §18).
   Pre-flight before any wake (~1.5 s): `node tools/seat-turn-shape.mjs` and the `consumed` block above.
   At clock-out: **`lead` in flight**, `devtools` 141,833/160,000 ends `assistant`, `architect` 135,567 ends
   `assistant`, `pm` 84,083 ends `assistant`; **`impl`/`scribe`/`qa` end on `user` (reset is the repair),
   `advocate`/`designer`/`qa2`/`auditor` have a 24,576 window and nothing listens on `:1234`.**

### 2. Standing constraints, plus what this session added

- **Do not claim, complete, defer, route, or release queue rows yourself**; landing is the delegate/operator's verb and
  `land` ≠ `complete` — say `LANDED at <sha>` or `ROUTED, NOT LANDED` (`docs/runbooks/land.md`).
- **No push without the grant.** Tonight's is spent; 18 commits unpushed.
- **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103). **Native Linux only** (D131). Never `doctor`/`resume`
  while a seat generates (D187). **Capacity is never a delegate or seat ruling.**
- **Name the axis, the denominator, the tree, and the dependency set** with every number. A seat-root suite run with
  the **lockfile** set (`pi-durable 1.3.0`) is *not* comparable to this checkout's **vendor** set — say which.
- **Never pipe `cli.mjs status`/`queue` into your own context** (22 MB each). Use `status --json` + a node projection,
  or dump to a file and grep. #5016 exists to make this illegal.
- **Pointer byte cap:** keep `docs/NEXT.md` **≤ ~16.9 KB** and run **both** `demo/next-pointer.test.mjs` and
  `demo/clockin-digest.test.mjs` after editing it (runbook §19).
- **`inputs/fetched/` stays clean or the lander refuses.**
