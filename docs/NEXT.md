# NEXT.md — current state and next actions

**Last update:** 2026-11-09T20:3xZ (delegate session **N20** — the harness compaction guard is built, gated,
end-to-end verified and documented; nothing was claimed in the queue).

**Milestone this window worked** — **ensuring LLM task completion (D226 / D240, first tranche ROADMAP 331)**.
This pass closed the **harness-plane** half of it: auto-compaction in the interactive/delegate session can no
longer fail. Registered as **ROADMAP 351**, decided as **D252**, runbook
**`docs/runbooks/harness-compaction-guard.md`**, pitfalls **211–215**. The team's rows for this cluster,
**#5931–#5942**, are still unclaimed; the delegate asserted nothing.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D240, ROADMAP 331)**; this pass closed the
harness-plane half of it (ROADMAP **351**, **D252**). The *other* open thread is the auto-clean ceiling (D249,
ROADMAP **311** cut 2 / **344**), still spooled, not delivered.

**Current item:** the guard is built, gated and documented; **the only thing left on this thread is the seat plane**,
which needs the same bound applied through a pi-durable `beforeCompact` extension — and arming any extension is an
operator grant (`DURIG_EXTENSIONS` is unset; `cli.mjs config` reports `null`). Procedure:
**`docs/runbooks/continuation-notes.md`** and **`docs/runbooks/harness-compaction-guard.md`**. The team's rows
**#5931–#5942** remain unclaimed; the delegate asserted nothing.

**First thing to run:**
`node tools/compaction-guard-install.mjs --check && node tools/compaction-guard-test.mjs && node tools/compaction-guard-e2e.mjs`
(expect `UP TO DATE`, `ALL PASS` 28 checks in ~0.5 s, then `ALL PASS` with one real local model call in ~4–8 s).
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

**Unverified:** no unguarded control run reproducing the failure at a faithful span (~160k tokens ≈ 30 min on this
box); the auto-compaction (mid-turn `threshold`) path shares the hook with manual `/compact` but only the manual
path was exercised end-to-end; the seat plane's own compaction is untested here.

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
- **Verified three ways.** Gate: `node tools/compaction-guard-test.mjs` → **ALL PASS, 28 checks, 0.53 s**, no
  model/key/network/broker. E2E: `node tools/compaction-guard-e2e.mjs` → **ALL PASS**; span 158,764 chars →
  1,481-char summary, `sentMaxTokens 4000`, `thinkingOff true`, `stopReason "stop"`, `compact()` 4.0 s. Forced
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
node tools/compaction-guard-e2e.mjs              # one real local model call, ~4-8 s
node scripts/clockin.mjs                          # BEFORE starting a broker; it hangs while one drives
node tools/broker-serve.mjs --status
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit
```

The git verdict from N17 still holds: worktrees **9**, refs **12** (`git worktree list | wc -l`, `git branch
--format='%(refname:short)' | wc -l`); read the live tip with `git rev-parse --short main`.

## Current item (priority order)

1. **Arm the continuity extension** (operator grant) — procedure in `docs/runbooks/continuation-notes.md`. The
   seat plane is *not* protected by this guard: pi-durable caps its own summarization output at
   `min(floor(0.8*reserveTokens), model.maxTokens)` and has its own failure string. A pi-durable `beforeCompact`
   extension is the way to apply the same bound to seats — that is the same arming step.
2. **Decide how a landing closes its row** (D249) — spooled as `delegate-20261109-auto-clean`, undrained while the
   broker is down.
3. **Re-cut `item-5301`** (the `worktree reap` verb, ROADMAP 311 cut 2) — a seat job.
4. **#5785** — code on `main`, row `deferred`; a zero-build close for its owner.
5. **Ratify or revise M5's eight acceptance criteria** (operator) — `docs/MILESTONES.md` §M5,
   `docs/reviews/milestone-m5-solidified-2026-11-09.md` §4; gate baseline **3 PASS, 1 PARTIAL, 4 FAIL**.

**Promotion candidates** (gitignored `.spike/`, read-only, no model spend, broker-down safe):
`.spike/probe-extension-discovery.mjs` (prints the extension set the harness actually loads — the only instrument
that answers "which extension wins a `session_before_*` event?"), `.spike/probe-compaction-composition.mjs`
(compaction with both project extensions loaded). Promotion is a row from `lead` (#5617 is the precedent).

## State the team is in

The fleet is stopped with the broker. Queue: 6,021 rows, `done 4154 / cancelled 873 / held 461 / deferred 383 /
claimed 12 / queued 138`. Landed-but-non-terminal rows: **#5221, #5226, #5387, #5501, #5829** — their owners close
them. Rows **#5931–#5942** unclaimed. The delegate asserted no row.

**Blocker (operator grants only):** no provider registers a model on this box (`DURIG_LOCAL_API_KEY` unset → 401 on
127.0.0.1:8080; `DURIG_VERIFIER_API_KEY` unset → 402 balance), and the spend cap refuses `google/gemini-3.1-pro`
($14 exposure against a $4 store cap). 10 intents are spooled in `selfdev.sqlite.broker.inbox/`, **118** dead-letters
in `selfdev.sqlite.broker.inbox.error/`.

**Unverified:** (1) **no unguarded control run** reproducing the operator's failure on a span big enough to be
faithful (a faithful control needs a ~160k-token prompt, ≈30 min on this box at ~83 tok/s); the mechanism is
established from the shipped harness code plus the provider probe. (2) Auto-compaction (mid-turn, reason
`threshold`) shares the hook with manual `/compact` (`agent-session.js:2224`, `:2514`) but only the manual path was
exercised end-to-end. (3) Whether a seat's pi-durable compaction can fail the same way — its own cap is smaller, and
nothing here tested it.

**Cost:** the spend ledger is unchanged at **2,030 lines / $0.92401 cumulative** (last row 2026-11-09T05:22:59Z);
every call this pass went to the local loopback server, which the ledger does not meter, so **$0.00** was spent.
Wall clock ~25 min of which the E2E runs are ~20 s total; the gate is 0.5 s.

**Traps this window** — `docs/SELFDEV.md` **211–215** (the failure is a request-shape bug; a one-character typo in a
safety net is invisible to `node --check`; last-non-null wins on `session_before_*`; `thinking_budget: 0` is
ignored on this server; the harness plane and the seat plane are different compaction code). Earlier blocks:
191–210, 186–190, 173–185. Grep for the symptom; the file is ~50,000 tokens.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).
