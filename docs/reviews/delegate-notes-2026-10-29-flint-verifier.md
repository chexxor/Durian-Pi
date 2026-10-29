# Delegate session 2026-10-29 — the verifier model, and the "review + merge before `done`" ruling

**Delegate session, partially verified; Linux host `Alex-Desktop-Win10` (Fedora), node v24.22.1, UTC.** Every
number below came from a command run in this session; where a run was still in flight at clock-out it says so.
Structure per `docs/runbooks/write-docs-critically.md` §Session notes.

## What the operator asked

(1) Use the LM Studio server at `http://127.0.0.1:1234` as the verifier provider and **update the verifier seats
before starting the team**; (2) enforce a process where **every work item is reviewed and merged to `main` before
the item is completed**; (3) permission to **unload `ministral`, load `flint`, and change model configuration to
keep both if they fit**; (4) start the broker/team; (5) collect workflow, skill and tool improvements so future
sessions move faster.

## What was read, and what it showed

**The author/verifier family invariant has been false for the whole Linux period.** `DURIG_DB=./selfdev.sqlite
node cli.mjs check rig.selfdev.json` → `single-model-rig`, **fix-now**: "all 12 seats resolve to `local/iq3_s`, so
a shared blind spot is systemic". Same command, same run: `verification-without-evidence` **fix-now** naming
**435** verification items, `duplicate-item` ×**54**, `evidence-tree` ×1 (#2175, #2213 name an artifact that names
no tree), `citation-unresolvable` ×5 (a `held` row cites `eb7e69c1e`, absent from this clone).

**How many verifier seats there are — and the docs are wrong.** The product's own predicate
(`src/verifierrole.mjs`, `seatsAreVerifier(seat)`, terms `["verif","qa","review","editor"]`), called on the real
`rig.selfdev.json` seat objects, matches **five**: `qa`, `qa2`, `auditor`, `advocate`, `designer`. `docs/SELFDEV.md`
names three. A delegate that edits "the verifier seats" by reading `SELFDEV.md` leaves two verifiers on the author's
family. (Docs defect — scribe's, not a delegate edit; routed to `pm` in the spool.)

**What a verifier seat's prompt actually is**, over **60,503** `pi.assistant` turns joined to seats by the
conversationIds `cli.mjs status` prints (`input + cacheRead`): `qa` p50 **55,538** / p95 251,311 / max 356,355 ·
`advocate` p50 **108,435** · `designer` p50 **66,258** · `auditor` p95 329,252 · `qa2` p95 48,640; **37,348** turns
exceed 32,768. So 65,536 is a **floor**, not headroom, and **208** (the context-fraction guard) is the fix.

**The server was lying in both directions.** `GET /api/v1/models` listed flint **loaded** at
`context_length: 262144` while every call returned HTTP 400 `Failed to load model "recursivesi/flint"` — a zombie
instance. And ministral was loaded at **8,192** while `durig.config.json` declared `DURIG_VERIFIER_CONTEXT: 13273`:
the rig has been stating a window it was never given.

## What was changed (all reversible, none of it committed to a running rig)

- **Model server:** ministral **unloaded** (freed **~12.7 GB** on the RTX 3090: 22,315 → 9,635 MiB); flint
  unloaded and **reloaded** with a flat body — `context_length: 65536`, `flash_attention: true`,
  `offload_kv_cache_to_gpu: true`, `eval_batch_size: 2048` — in **18.3 s**, `parallel: 4`, `num_experts: 6`.
  Servability proven by a completion, and flint answers with a **reasoning budget**: at `max_tokens: 8` it returned
  `finish_reason: stop` with **empty `content`**; at 400 it spent **250 of 279 completion tokens on reasoning**.
- **`rig.selfdev.json`:** exactly 5 lines changed (verified by `git diff --stat`) — `qa`, `qa2`, `advocate`,
  `auditor`, `designer` → `"model": "verifier/recursivesi/flint"`. Instructions untouched.
- **`durig.config.json`** (gitignored, machine-scoped): `DURIG_VERIFIER_MODEL: recursivesi/flint`,
  `DURIG_VERIFIER_CONTEXT: 65536`, `DURIG_VERIFIER_MAX_TOKENS: 8192` (was `32768` — an output budget larger than
  the whole window that was being declared for it; **D136** raised it to survive a truncation artifact, so if
  `finish_reason: length` with an empty answer reappears at 8192, raise it deliberately and record it).
- **Verified after the change:** `demo/local-model-pointer.test.mjs` **PASS** (`providers=local=iq3_s,
  verifier=recursivesi/flint, pinned seats=12`), `demo/second-local-provider.test.mjs` **PASS**, and
  `cli.mjs check rig.selfdev.json` → `single-model-rig` **pass, found 0**.
  **That pass is a string comparison, which is exactly the trap `D137` names.**

## The gate, and the finding that changes the decision

`node tools/model-probes/gate.mjs http://127.0.0.1:1234/v1 recursivesi/flint flint-ctx65k --replicate 3
--pair-comments strip-both` (k=3, fragment view, corpus = 8 items: 3 mutants with execution proofs, 5 from fix
history; 199-line matched-pair table printed; `--plan` first, which spends nothing).

Result before I stopped it (3 items, 7 calls): **6 of 7 completed cells returned `TRUNCATED-EMPTY`** —
`finish_reason=length` at the instrument's default `max_tokens: 3000` with **empty content**, at 141–275 s per call.
The **only** cell that produced visible text (H1 `clean`, 141.2 s, `finish=stop`, 2,006 tokens) was scored
**FALSE-ALARM**: it confidently invented "missing ESM imports" in `src/worktree.mjs` and a `ReferenceError` that the
file does not have. One cell died with `REQUEST FAILED fetch failed`.

So the headline is not "flint is weak" — it is that **flint spends its whole output budget reasoning and never
reaches the answer** at this budget, which is the same failure **D136/D137** recorded for Ministral at 128/256
tokens, now at 3000. The instrument already had the knob (`ask()` reads `CAL_MAX_TOKENS`, default 3000) and the
usage line does not mention it. Re-run in flight at clock-out:
`CAL_MAX_TOKENS=9000 … flint-ctx65k-out9k --replicate 1` (log `.spike/gate/flint-65k-k1-out9k.out`, PID 2338643) —
k=1 is 19 cells ≈ **60–70 min**; the k=3 matrix at that budget is ≈ **2.5–3 h**. **No verdict yet.**

**Do not read the `single-model-rig` pass as certification.** Per `D137`, a verifier that fails the gate is worse
than no verifier, because `check` only compares strings. If the k=1 run still truncates at 9000, or the false
alarms persist, the answer is a **remote cross-family verifier**, not a return to ministral-at-8192 (0/2, `D137`)
and not single-family `iq3_s`.

## The merge-before-`done` ruling: what the code does today, and the item registered

`complete_work(itemId, resultSummary, evidence?)` at `src/rig.mjs:931` sets `done` **in the same commit as the
author's own declaration**, `evidence` is `Type.Optional`, and the same handler runs workspace cleanup that
**retires the item worktree** (`src/rig.mjs:1055`; `src/seatguard.mjs:75` records that it also silently resets the
seat's cwd). Nothing anywhere requires a merge — `docs/runbooks/land.md` records items closed while their branches
were unlanded (#3990, #4163), and **ROADMAP 100** asks only for the *measure*. Registered as **ROADMAP 253**:
`done` requires a cross-family verifier's **re-runnable** evidence **and** an artifact that is an ancestor of
`main`, with a pre-`done` state pair (`awaiting_review` → `awaiting_merge`) so the review and the merge are two
records, `scripts/land.mjs`'s landing lock staying the merge mechanism, and criterion (5) — the refused transition
must leave the worktree and the claim **intact**, because a gate that cleans up before refusing destroys the thing
it wanted landed. **217 lands first or 253 gets switched off**: a Linux seat has no spawnable shell tool today, so
it cannot produce the re-runnable evidence the gate demands.

## What was NOT done, and why

- **The team was not started.** `tools/broker-serve.mjs --status`: heartbeat **11.5 h** old, broker not running,
  spool holding 1 stranded intent; `cli.mjs status`: **0 claimable rows** (0 `queued`, 0 `claimed`) — the 30+
  ROADMAP items since 217 still have **no queue rows**, so a started team would idle or improvise. And
  `--dry-run` **refuses** with `seat-shell-availability` + `live-tree-dirty`. The verdict and the intent go to the
  operator instead; the release brief remains `.spike/delegate/pm-release-brief-2026-10-28.md` (unspooled), and a
  fresh intent for the verifier facts is queued in `.spike/delegate/`.
- **No product code changed.** The enforcement belongs to the team; writing it myself would break the
  failing-first and review path and would be the "delegate doing the seat's work" the entry point forbids.

## The errors I made this session (recorded so the next one does not repeat them)

1. **I called `seatsAreVerifier(name, role)` — two strings — and got `false` for every seat.** The predicate takes
   **the seat object** (`seat.name + " " + (seat.role || "")`). A wrong signature on an internal function can read as
   "this rig has no verifier seats", which is a very comfortable wrong conclusion.
2. **My first byte-range patcher searched forward from the seat name and so matched the *next* seat's `model`
   line** — it would have rewritten the wrong seat twice. The guard ("the line I found is not this seat's model
   line") fired; my *second* attempt then used offsets computed **before** the first patch and missed `qa2` (+13
   bytes of drift). Rule for hand-editing a JSON rig: recompute offsets after every write, and assert the final
   `git diff --stat` line count.
3. **`tools/model-probes.mjs` does not exist** — `model-probes` is a **directory**. The 2026-10-27 commit name
   "graduate the model probes into `tools/model-probes`" reads like a file; `ls tools/` before citing it.
4. **I was about to edit `gate.mjs` to raise the output budget** before noticing `ask()` already reads
   `CAL_MAX_TOKENS`. Read the function, not just the usage line.
5. **Two `unload` calls returned `HTTP 000`** to curl while the action had **landed**. Verify by re-listing, never
   by retrying.

## Proposals that would make the next session shorter (the operator's fifth ask)

1. **Runbook, written this session:** `docs/runbooks/verifier-model-server.md` (+ its index row). The endpoint set,
   the flat `load` schema, `unload` taking `instance_id` not `model`, the zombie-instance trap, the `HTTP 000`
   trap, the config↔server consistency chain, and the measured cost of a gate run. This was the single largest
   time sink.
2. **Skill, edited this session:** `.agents/skills/delegating-to-durian-pi/SKILL.md` gained an instrument table —
   11 instruments with their **measured cost** and what each refuses — because `tools/harness-usage-census.mjs`
   measures **24.0%** of tool calls in the audited corpus as one-off measurement code (87 per session) and 11.1% on
   this host.
3. **Gate cost and smoke-testing.** `gate.mjs` prints the matched-pair table before spending anything (`--plan`),
   but it has no way to run *some* items: a k=1 full-corpus smoke test costs ~60–70 min on a local 40B. Propose
   `--only <id|file>` to `pm` (the instrument is `tools/`, not `src/`, but the team should own it). Also print the
   output budget in the run header — a run where most cells are `TRUNCATED-EMPTY` is measuring the **budget**, not
   the model, and the header does not say so today.
4. **A `verifier-fit` measure, cheap and already implied by 208:** per seat, prompt tokens as a **percent of that
   seat's declared window**, using the store's own `input + cacheRead`. I computed it with throwaway SQL; 208 makes
   it permanent and `check` reports the fraction rather than a raw count.
5. **The ledger-surgery gate, restated once more** (three incidents, one of them this session's *neighbourhood*):
   any verb that deletes ledger rows or registrations — `git worktree prune`, `pruneWorktrees`, worktree removal —
   runs behind the existing `--reconcile-ledger` opt-in flag and a backup. The `complete_work` worktree retirement
   in 253's path is the same code family.
6. **Two queue-hygiene facts for `pm`:** `duplicate-item` fires **54 times** and `citation-unresolvable` **5 times**
   on `rig.selfdev.json` today. Cheap, mechanical, and they currently bury real findings in a 60-finding list.
