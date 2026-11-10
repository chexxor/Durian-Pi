# NEXT.md — current state and next actions

**Last update:** 2026-11-10T03:1xZ (delegate session **N23** — the fleet is **running**: the broker was restarted with
`DURIG_LOCAL_API_KEY` in its own process env, the spool drained to 0, passes are advancing, and seats are minting
their own rows. The fleet-silence root cause was **not** routing: it was a broker with **no** `DURIG_*` env at all,
so every seat generation 401'd and the supervisor escalated 171 rows as `repeated_failure`.
Measured this window: **8 natural seat compactions since the mechanism armed, 0 truncated, 8 note-backed**; the
100-compaction / 0-truncated acceptance ran clean on a snapshot copy (exit 0, 7.0 s) with a negative control that
reproduces 11 truncations. `milestone-check.mjs` exits **0** with **6** blockers (was 8). **9 branches landed** to
main across this thread (7 earlier + item-6077 + item-5745); worktrees 22 → **11**, refs 14. **N18 is still not
closed**: 10 of 12 seats have no note because they have no claimed work, and ROADMAP 352 (the install gap) is
unlanded — both are team routing decisions the delegate cannot make. **M5** gate unchanged: 3 PASS, 1 PARTIAL,
4 FAIL. Nothing was claimed in the queue by the delegate.

**Milestone this window worked** — **ensuring LLM task completion (D226 / D240, first tranche ROADMAP 331)**.
The harness plane is closed (ROADMAP 351, D252, runbook `docs/runbooks/harness-compaction-guard.md`, pitfalls
211–216). This window closed the **seat plane's mechanism** too: the continuity extension is armed, real seats write
and read notes, and every natural compaction since arming took the note path with **zero** truncations. What is NOT
closed is coverage (10/12 seats have no note — they have no claimed work) and the install gap (ROADMAP 352, rows
**#6036/#6037** `deferred` to human). The team's rows **#5931–#5942** are still unclaimed; the delegate asserted nothing.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D240, ROADMAP 331)**; this pass got the fleet
running (the 401 root cause), exercised the seat plane on real seats, and measured the 100/0 acceptance on a store
snapshot. The *other* open thread is the auto-clean ceiling (D249, ROADMAP **311** cut 2 / **344**), still spooled,
not delivered.

**Current item:** N18's mechanism is proven, its coverage is not. `node
docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite` → **exit 0**, `PASS (mechanism)`,
**6 operational blockers**: 219 lifetime truncated summaries, 209 run-cap refusals, 212 truncations on seats with no
cap refusals, **10 of 12 seats have no continuity note** (they hold no claimed work to note), scribe at 111% of its
declared window, impl claimed 1 item and completed none. Live evidence since arming (2026-11-09T23:47:45Z): **8
compactions, 0 truncated, 8 note-backed**. The 100/0 number is a **driven measurement on a snapshot copy**, not 100
natural fleet compactions — say that, do not round it. `node
.spike/compaction-acceptance.mjs --target 100 --mode armed` → exit 0 in **7.0 s**: 100 compaction tasks, 0 truncated,
100 provider calls = 100 growth turns + **0 summariser requests**; control `--mode control --stopReason length` → 11
truncated (the counter is not vacuous). **Next milestone M5** is ready: 171 → 172 → 173 → 175 → 176
(`docs/reviews/milestone-m5-solidified-2026-11-09.md`), gate re-runnable in 1.6 s, four criteria open (C1, C3, C4, C6).
The broker is healthy (pid in `<db>.broker.json`, passes advancing); the team's rows **#5931–#5942** (N18) and
**#6036/#6037** (ROADMAP 352) are still `deferred` to human; the delegate asserted nothing and sent pm an intent
(requestId `fef4cf53-996d-450b-863e-26f8549dbd47`) asking it to release them.
`node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite` (1.6 s, no model, no broker — expect
`3 PASS, 1 PARTIAL, 4 FAIL`) then
`node docs/evidence/2026-11-08-context-window/milestone-check.mjs --db ./selfdev.sqlite` (3.7 s, expect `PASS
(mechanism)` exit 0 with 8 blockers; a `FAIL` now means code, not configuration). Then the harness-plane guard chain:
`node tools/compaction-guard-install.mjs --check && node tools/compaction-guard-test.mjs && node tools/compaction-guard-e2e.mjs && COMPACT_GUARD_E2E_MODE=auto node tools/compaction-guard-e2e.mjs`
(expect `UP TO DATE ... (+ .pi/extensions/compaction-guard-core.mjs)`, `ALL PASS` 28 checks in ~0.5 s, then
`ALL PASS` manual mode 3–5 s, then `ALL PASS` auto mode **50–86 s** — measured 52 s and 86 s on this box on the same
commit; the spread is local-server input throughput, not the guard. Both use the local model, no money).
Then `node scripts/clockin.mjs`, then `node tools/broker-serve.mjs --status`, then
`DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (expect `total: 9`, `reapable: 0`, all `seat-root`), then
`node cli.mjs status` once a broker is healthy.

**State:** refs **12**, worktrees **9**, `main` tip — read it with `git rev-parse --short main` (a pinned sha here
goes stale by its own commits). Continuity evidence still stands:
`docs/evidence/2026-11-08-context-window/milestone-check-2026-11-09-live.txt` and the M5 gate baseline
`docs/evidence/2026-11-09-milestone-m5/gate-baseline-2026-11-09.txt` (**3 PASS, 1 PARTIAL, 4 FAIL** — that is M5's
honest baseline, not a bug).

**Blocker:** the broker is down and no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401 on
127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). Only the operator holds those grants; 10 intents are spooled and **118** sit
as dead-letters in `selfdev.sqlite.broker.inbox.error`.

**Unverified:** the seat plane's own compaction is untested here; the exact failing turn of the operator's session
cannot be recovered from the transcript (failure events are not persisted). The threshold path is now exercised end-to-end and the unguarded failure was reproduced verbatim — see below.

**Cheap probe that proves the guard is in place:** `node tools/compaction-guard-install.mjs --check` → exit 0, and
in a live session `/compaction-guard` prints caps and `fired=`.

## What this pass actually changed (evidence, not activity)

- **A guard now exists on the extension plane** (D212 — no base change): tracked source
  `tools/compaction-guard-extension.js` + `tools/compaction-guard-core.mjs`, installed to
  `.pi/extensions/compaction-guard.js` by `tools/compaction-guard-install.mjs` (`.pi/` is gitignored on purpose:
  machine-local keys, `.gitignore:15`).
- **Measured root cause**, not a guess: `dist/core/compaction/compaction.js:495` — "summaries use the model's
  output limit (#9512)" (no explicit cap); `:454/:459` make a `stopReason: "length"` a hard failure;
  `dist/core/agent-session.js:2594-2595` prints it. Provider probe on the local server: `max_tokens:32` →
  `finish_reason "length"`, all 32 completion tokens are `reasoning_content`; `max_tokens:48` +
  `chat_template_kwargs {"enable_thinking": false}` → "stop", 5 tokens.
- **The failure was reproduced, then closed, on the path the operator hit.** Auto (threshold) compaction on a
  640,861-char span with the guard NOT loaded emitted `Auto-compaction failed: Summarization failed: generation
  hit the token cap and the summary is incomplete` — the operator's string, verbatim. With the guard loaded the
  same span succeeded: `details {"guard":true,"reason":"bounded"}`, 2,320-char summary, 8.4 s, no failure event.
  Permanent gate: `COMPACT_GUARD_E2E_MODE=auto node tools/compaction-guard-e2e.mjs` → ALL PASS (6 checks, 52 s,
  408,516-char span bounded). Unguarded control at a *small* span (63,340 tokens) succeeded in 254 s — the cap is
  a large-span failure, not every compaction.
- **A second bug found and fixed this pass:** the extension imported its core as `./compaction-guard-core.mjs`
  with a `../../tools/...` fallback (`tools/compaction-guard-extension.js:44) — correct only at
  `<repo>/.pi/extensions/`. Anywhere else the extension silently does not load and the session runs unguarded
  (SELFDEV **217**). `tools/compaction-guard-install.mjs` now installs the core next to the extension and
  `--check` verifies both files.
- **Verified three ways.** Gate: `node tools/compaction-guard-test.mjs` → **ALL PASS, 28 checks, 0.53 s**, no
  model/key/network/broker. E2E: `node tools/compaction-guard-e2e.mjs` → **ALL PASS**; span 158,764 chars →
  1,454-char summary, `sentMaxTokens 4000`, `thinkingOff true`, `stopReason "stop"`, `compact()` 3.4 s. Forced
  length stop (`COMPACT_GUARD_OUTPUT_TOKENS=256`): **ALL PASS**, `details.reason "length-rescued"`, 7,591-char
  checkpoint, 5.1 s. Composition: with `@woksin/pi-context-budget` also loaded, compaction succeeded in 6.9 s with
  `details {"guard":true,"reason":"bounded","spanChars":155353}`.
- **A bug found and fixed in this pass:** the guard's deterministic-fallback line read `srecord(...)` — a
  `ReferenceError` on exactly the path that is supposed to make failure impossible. `node --check` does not catch
  it. The handler is now wrapped in its own try/catch (`details.reason: "guard-fault-fallback"`), and the gate has
  two checks for it.

## Exact next command

```bash
cd /home/chexxor/Git/Durian-Pi
node tools/compaction-guard-install.mjs --check   # exit 0 = the guard is installed and current
node tools/compaction-guard-test.mjs              # ALL PASS (28 checks) in ~0.5 s, no broker, no key, no model
node tools/compaction-guard-e2e.mjs              # manual path: one real local model call, ~5 s
COMPACT_GUARD_E2E_MODE=auto node tools/compaction-guard-e2e.mjs   # the threshold path, 50-86 s (witness, not a loop)
node scripts/clockin.mjs                          # BEFORE starting a broker; it hangs while one drives
node tools/broker-serve.mjs --status
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit
```

The git verdict from N17 still holds: worktrees **9**, refs **12** (`git worktree list | wc -l`, `git branch
--format='%(refname:short)' | wc -l`); read the live tip with `git rev-parse --short main`.

## Current item (priority order)

1. **Close the install gap** (registered as **ROADMAP 352**, unclaimed): nothing at session start runs
   `tools/compaction-guard-install.mjs`, so a fresh clone, a new worktree or another machine starts **unguarded with
   no signal** (`.pi/` is gitignored by design, `.gitignore:15`). Fix shape: `scripts/clockin.mjs` prints a `guard:`
   line from `install --check` (<100 ms, no model/key/network), and a `demo/compaction-guard-gate.test.mjs` wrapper
   puts the 28-check gate inside the area suite (discovery scans only `demo/*.test.mjs`, `src/testareas.mjs:31-38`, so
   today the pre-landing gate never runs it). A seat job, not a delegate job.
2. **Get a provider that registers a model** (operator grant) — the extension is armed
   (`durig.config.json`, `cli.mjs config`), so the remaining step is a live seat run: `DURIG_LOCAL_API_KEY` unset →
   **401** on 127.0.0.1:8080. Until then N18's acceptance cannot be measured, and the gate will keep reporting
   "armed but never exercised" as a blocker (pitfall **219**). Procedure: **`docs/runbooks/continuation-notes.md`**.
3. **Decide how a landing closes its row** (D249) — spooled as `delegate-20261109-auto-clean`, undrained while the
   broker is down.
4. **Re-cut `item-5301`** (the `worktree reap` verb, ROADMAP 311 cut 2) — a seat job.
5. **#5785** — code on `main`, row `deferred`; a zero-build close for its owner.
6. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5,
   `docs/reviews/milestone-m5-solidified-2026-11-09.md` §4; gate baseline **3 PASS, 1 PARTIAL, 4 FAIL**.

**Promotion candidates** (gitignored `.spike/`, broker-down safe, no spend beyond the local model):
`.spike/probe-extension-discovery.mjs` (prints the extension set the harness actually loads — the only instrument
that answers "which extension wins a `session_before_*` event?"), `.spike/probe-compaction-composition.mjs`
(compaction with both project extensions loaded), `.spike/probe-auto-compaction-path.mjs` (drives the harness's own
threshold compaction with project compaction settings overridden), `.spike/control-unguarded-compaction.mjs` (the
negative control: pi's default path on the same span, **5–15 min** because the request carries no output cap).
The auto-path and control logic are already folded into the tracked
`tools/compaction-guard-e2e.mjs` (`COMPACT_GUARD_E2E_MODE=auto`); promoting the other two keeps the discovery and
composition reads available after `.spike/` is cleared. Promotion is a row from `lead` (#5617 is the precedent) —
the broker is down, so it could not be routed this window.

## State the team is in

The fleet is stopped with the broker. Queue: 6,021 rows, `done 4154 / cancelled 873 / held 461 / deferred 383 /
claimed 12 / queued 138`. Landed-but-non-terminal rows: **#5221, #5226, #5387, #5501, #5829** — their owners close
them. Rows **#5931–#5942** unclaimed. The delegate asserted no row.

**Blocker (operator grants only):** no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401 on
127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). 10 intents are spooled in `selfdev.sqlite.broker.inbox/`, **118** dead-letters
in `selfdev.sqlite.broker.inbox.error/`.

**Unverified:** (1) the exact turn the operator's session failed on is not recoverable from the transcript
(compaction failure events are not persisted); the mechanism is established from the shipped harness code, the
provider probe and the reproduced threshold-path failure above. (2) Whether a seat's pi-durable compaction can
fail the same way — its own cap is smaller, and nothing here tested it.

**Cost:** the spend ledger is unchanged at **2,030 lines / $0.92401 cumulative** (last row 2026-11-09T05:22:59Z);
every call this pass went to the local loopback server, which the ledger does not meter, so **$0.00** was spent.
Wall clock: the gate is **0.46 s**, the manual e2e **3.25 s**, the auto (threshold) e2e **85.5 s** — that last one is
the only expensive instrument on this thread and it is a once-per-session witness, not a loop (SELFDEV **218**).

**Traps this window** — `docs/SELFDEV.md` **219–220** (a store-based gate cannot tell "broken" from "armed and never
run" — prove the mechanism on the mocked plane before blaming it; `cli.mjs config` reporting a setting is not proof it
is in effect: check the registry install, then the `pi.agent` selection, then a real request in the transcript). Also
**211–218** (the failure is a request-shape bug; a one-character typo in a
safety net is invisible to `node --check`; last-non-null wins on `session_before_*`; `thinking_budget: 0` is
ignored on this server; the harness plane and the seat plane are different compaction code; an e2e seeded under
`keepRecentTokens` (20000) fails as "session too small", not as a guard failure; an extension whose core module
does not resolve simply does not load, and nothing says the guard is off; the auto-mode e2e is a 50–86 s witness, not
a fast loop, and a doc that pins a second-count goes stale the same day). Earlier blocks:
191–210, 186–190, 173–185. Grep for the symptom; the file is ~50,000 tokens.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
