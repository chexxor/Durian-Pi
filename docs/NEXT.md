# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T17:0xZ (**Z** — ROADMAP 244), host-local 2026-10-30 12:0x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D174).
The superseded 122-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (entry marker line **8426**, body **8427–8549**).

**THE VERIFIER LEG IS ALIVE, AND IT IS NOT THE WINDOW THAT WAS KILLING IT.** The seat request is refused **before** any window is
reached — `Engine protocol predict request returned 500 … Jinja Exception: After the optional system message, conversation roles
must alternate user and assistant roles …` — by LM Studio's converted template (`chat-template.jinja` lines 43–52, its own comment:
"Checks for alternating user/assistant messages"). Minimum trigger, measured: after `reset qa` **with** a handoff, the outgoing
conversation is **`system, user, user`** (the handoff is a user turn, `send` appends another). The residue behind it predates the
provider move: **qa 184 user turns / 193 errored assistants / 1 with any text; qa2 189/189/1; auditor 158/159/0; pm 140; lead 181;
impl 157**, and 180 of qa's errors are `402 … You need positive balance to do inference` — the verifier used to be a **paid cloud
provider**, those turns were never answered, and the store came over in the move without the answers. The local model tolerates
consecutive user turns, which is exactly why only the verifier could not wake. Full why-and-evidence: **D174**.

**The window raise the operator authorized was still needed, and it is not sufficient.** `lms load mistralai/ministral-3-14b-reasoning
-c 16384 --parallel 1 --gpu max` (the app's `:1234` REST surface on this build exposes only `GET /api/v0/models`; `POST/PATCH/PUT/DELETE`
answer `Unexpected endpoint or method`). Pinned three ways: `/api/v0/models` → `loaded_context_length: 16384`; the `llama-server`
cmdline → `--ctx-size 16384 --parallel 1`; the **same 9,627-token probe that returned HTTP 400 now returns HTTP 200**. `qa` then woke,
planned, read `src/shellregistry.mjs` (8,754 ch) and `src/seattools.mjs` (16,505 ch), and was cut **mid-review** at
`in=14184 out=1 stopReason=length`. **A whole-file review of #4849 does not fit in any window this box serves today.**

**#4849 is UNVERIFIED, still `claimed`, and nothing landed.** Per pm's ruling on this session's findings brief, a turn ending on
`length` is **NOT-FINISHED, never a verdict**, and the oracle requirement attaches to **claims, not to seats**: a read/write-only leg
may certify what is readable in the diff and assertable at the call site, and must return `OUT-OF-SCOPE-NEEDS-RUNTIME-PROOF` for the
spawn behaviour it cannot observe. **pm minted 8 rows, all held, none released**: #4886 (role-sequence defect, impl), #4887 (`compact`
writes no entry, impl), **#4888 = ROADMAP 208 at last** (lead), #4889 (D173 correction, scribe), **#4890/#4891 = the two verify-only
legs for #4849** (qa primary, qa2 boundary — qa2 must first name the model it is actually served), #4892 (auditor reconciles the suite
control), #4893 (the one remaining suite failure, devtools).

## NEXT SESSION

**Current item: run the two scoped verify legs (#4890 qa, #4891 qa2) on a *named, pinned scope* small enough to fit the window, then
carry their verdicts to lead for the landing act on #4849.** One host decision gates whether they fit at all (below). Order is still
lead's: **217 → 263 → 264 → 221/265 → 266 → 267**, 232 gated on #4846.

**The one decision the operator holds (host capacity, delegate cannot spend it):** raise the verifier window again, or accept
delegate-chunked briefs. Measured cost, from the model file's own metadata (`.spike/gguf-arch.mjs`: 40 layers × 8 KV heads × (128+128)
× 2 B at `--cache-type-k/v f16` = **160 KiB/token**): 8192×4 = 5.00 GiB of KV (what was running), 16384×1 = 2.50 GiB (what is running
now — the raise *shrank* the pool), 24576×1 = 3.6 GiB. LM Studio's `--estimate-only`: 13.43 GiB @16384, **14.39 @24576**, 15.36 @32768,
against a **16,376 MiB A4000** whose measured usage went 12,648 → 13,914 MiB. So 24576 is ~1.4 GiB of headroom left on that card
(estimate has run ~0.5 GiB low against measurement); 32768 is not credible. Chunking instead: one leg per file-group, verdict per leg.

**Two traps to not re-fall into.** (1) **The GPUs were recorded backwards in D173.** The verifier is on **GPU0 = RTX A4000** (unloading it
dropped GPU0 12,648 → 59 MiB). The 22.9 GiB on **GPU1 = RTX 3090** is the **local** model and is **not LM Studio**: `strata --serve
--pack …/iq3_s --native Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S… --max-context 204800 --kv int8`, and its `/v1/models` says `"gpus":[1]`.
Any plan that spends "free space on GPU1" spends the local model's card. (2) **`reset <seat> <handoff>` writes a user turn**, so a reset
with a handoff followed by `send` produces the very sequence a strict template rejects. Reset **without** a handoff until #4886 lands.

**Archive:** everything superseded is verbatim in `docs/NEXT-ARCHIVE.md` (marker 8426, body 8427–8549); grants 1–7 and the older do-not
lists live there, not here.

**Next commands (delegate, read-only first, in this order; Linux):**

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs queue            # #4849 MUST still be `claimed`, not `done`; #4886-#4893 MUST be held
DURIG_DB=./selfdev.sqlite node cli.mjs status           # attention notices; 2 measures out of band -> node cli.mjs metrics
DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit   # 2 registered worktrees; `reapable: 0` is NOT a verdict (266)
node tools/rig-portability-audit.mjs                    # LIVE checkout: 2 findings (both 217). Seat root with --db/--rig: 1. Read both.
node tools/roadmap-queue-coverage.mjs                   # CLAIMABLE 21; items >=200 with no row naming them: 51 (was 52 — 208 is now named)
node tools/broker-serve.mjs --status                    # broker DOWN by design; BLOCK seat-shell-availability persists until 217 lands
curl -s http://127.0.0.1:1234/v1/chat/completions -H 'content-type: application/json' -d '{"model":"mistralai/ministral-3-14b-reasoning","messages":[{"role":"user","content":"x x x <9000 tokens>"}],"max_tokens":8}'   # now HTTP 200; a 400 here means the slot fell back to 8192
node -e 'const b="x ".repeat(9500);fetch("http://127.0.0.1:1234/api/v0/models").then(r=>r.json()).then(j=>console.log(j.data.map(m=>[m.id,m.state,m.loaded_context_length].join(" "))))'   # verifier must read loaded_context_length 16384
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs   # the clock-out trio, always all three
git for-each-ref refs/rescued | wc -l                   # 489 (was 484; the 5 new = the #4849 files). Read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**To run the verify legs (the actual next work):** write a **scoped** brief naming the claims in play — the registry/guard selection rule
(`src/seatguard.mjs`'s guard set vs the registered set, `src/shellregistry.mjs`'s `canStart`/`preferredOn` split) — not "review all five
files", which is what overflowed. Send with **`DURIG_SEAT_ROOT` unset** from the live checkout:
`env -u DURIG_SEAT_ROOT DURIG_DB=./selfdev.sqlite node cli.mjs send qa --body-file <file>`. Pins for the tree under review:
`/home/chexxor/Git/durian-dev/seatroot`, branch **`seatroot/linux`**, 5 uncommitted files, and the delegate's own oracle results in
`/home/chexxor/Git/durian-dev/seatroot/.spike/review-4849-evidence.md`. **Channel:** `send` remains the only wake on this host (a broker
start is refused on `seat-shell-availability`, which carries **no ack flag**).

**Blocker:** two, none mine to lift. **(a)** The verifier window: 16,384 cannot hold a whole-file review (measured `in=14184 out=1`);
24,576 leaves ~1.4 GiB on the A4000. Operator's call. **(b)** The operator still holds the research prompt
`docs/reviews/seat-scoped-durable-state-research-prompt.md`; its landing is the only trigger for **#4885**.

## What landed this session, with its evidence

- **Host: the verifier is re-served at 16,384 / parallel 1** by the operator's grant to use LM Studio's own API; `DURIG_VERIFIER_CONTEXT`
  corrected 8192 → 16384 in the gitignored `./durig.config.json`. Before/after on one command: HTTP 400 `n_ctx 8192` → HTTP 200 at the
  same 9,627 tokens. Restore recipe captured verbatim: `.spike/fix-20261030/verifier-llama-server-cmdline.pre.txt`.
- **Rig: the tree-shape inconsistency is fixed** (operator: "fix the inconsistency"). Seat root detached HEAD → branch `seatroot/linux`
  (same commit, working tree untouched); a gitignored `durig.config.json` placed there carrying an **absolute** `DURIG_DB` so an
  instrument there cannot silently measure an empty store (#4884). RED-then-GREEN in that tree: `local-model-pointer` (was "no `local`
  provider is configured") and `clockin-digest` (was `git rev-list --count main..(no branch)`) now exit 0.
- **Suite control, both trees, `DURIG_DB` pinned to a scratch store so no demo touches the operator's store** (`.spike/fix-20261030/
  suite-{seatroot,live}.txt`): **237 PASS / 1 FAIL in each tree, the identical `demo/deepinfra-catalog.test.mjs`** — the main-4 / seat-root-3
  divergence is **zero** and no failure is attributable to #4849. pm did not trust it: #4892 asks auditor to reconcile it.
- **Insurance minted:** `src/shellregistry.mjs` was untracked with **no blob anywhere** in the object DB; all five #4849 files are now
  `refs/rescued/impl-4849-*` blob refs, each round-tripped byte-identical. refs/rescued 484 → **489**.
- **Seat acts:** `reset qa` twice via the product's own verb (`--dry-run` first, `writes: 0`), which is what woke the leg. `qa2` and
  `auditor` carry the same residue (189 / 158 unanswered turns) and were **left alone** — a rig-level call, not a delegate's.
- **Routed, not fixed by the delegate:** findings brief to **pm** (`.spike/fix-20261030/send-pm-findings.md`) → 8 rows minted and held,
  and pm's done-condition ruling (four verdicts; `length` ⇒ NOT-FINISHED; oracle attaches to claims, not seats).

## Rig state, re-measured at clock-out 2026-10-30T17:0xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (last full backup `.spike/repoint-20261030/store-backup-20261030-005816.sqlite`); 12 seats; `pm`/`lead` on the
live checkout, the other 10 on the approved seat root, now on branch `seatroot/linux`. **Queue census 4,893 = 3,756 done / 780 cancelled /
319 held / 20 queued / 17 deferred / 1 claimed (#4849) → CLAIMABLE 21** (8 new rows all held). **Broker DOWN, deliberately** (no
`cli.mjs serve`/`src/broker.mjs` process; `ps`, `status` and `broker-serve --status` agree). **Portability gate:** 2 findings live checkout,
1 from the seat root. **Worktrees 2**; `reapable 0`; unreachable commits 0; phantom dirs 0; tracked changes: `docs/DECISIONS.md`,
`docs/NEXT.md`, `docs/NEXT-ARCHIVE.md` at this cut. **Providers:** local `strata` `iq3_s` on **GPU1** (22.9/24.6 GiB, `--max-context 204800`)
— pm, impl, lead, scribe, devtools, security, architect; verifier LM Studio Ministral-3-14B-Reasoning Q6_K on **GPU0** (`:1234`, 13,914/16,376
MiB, **ctx 16384, parallel 1**, YaRN over an original 16,384, file declares 262,144) — qa, qa2, advocate, auditor, designer. `flint` is
**not** a fallback verifier: 40B MoE, 22.51 GiB on disk as Q4_K_M, cannot fit either card alongside what is loaded. **Supervisor:** last
window logged `reason=degeneration` for `auditor, devtools, qa2` — pre-existing, UNVERIFIED, no reset applied beyond the two on `qa`.
**Box:** 94 GB RAM, ~21 GiB available; `probe-preflight` REFUSES (swap max 50 %), so no probe arm may start. **`LocalRTC=yes`** on a
dual-boot box while every gate is `Date.now()` arithmetic — `timedatectl set-local-rtc 0` is operator's call (ROADMAP 234).

## OPERATOR GRANTS (eleven through D174)

1–7. Unchanged from the archived pointer (seat-root ruling A; the "queue drains" predicate; mint the refs; instrument hygiene; the verifier
paths; decomposition-not-seats with the scale gate; the Linux isolated seat root).
8. **The `send` bootstrap is sanctioned while the broker is un-startable** — `cli.mjs send pm|lead|impl|qa --body-file …`. Deprecated as a
second harness owner; admissible only because no broker runs; the delegate runs the oracle and no seat closes its own row on a degraded host.
9. **Do not re-architect per seat; research it.** The delegate crafts the prompt, the operator routes it, the delegate lands the report.
10. **NEW: host model-serving may be changed through the vendor's own API** — used for the verifier ctx/parallel change on explicit
instruction. It is a spend of the operator's GPU, so report the headroom you measured and do not spend it again unasked.
11. **NEW: tree-shape acts on the approved seat root are the delegate's** (branch it, give it a host config) — they are host ops, not seat
work; record what changed under the seats in the pointer, because the suite is the constitution's oracle.

## Do not "fix" these on the strength of the docs

**A provider that answers a 26-token probe is not healthy** — probe with a *real request size*; and now: **a 200 at 9,627 tokens is still
not a working verifier** — the leg lives or dies on role *sequence*, not size. **`reset <seat> <handoff>` appends a user turn** →
`system, user, user` → a strict template answers 500 in ~30 ms with zero tokens. **An errored turn leaves its user message in the
conversation**, so the next attempt is structurally inadmissible and the poison grows monotonically (qa: 193 errored turns, 1 answer).
**`compact` writing no entry is not a window problem.** **Never treat "the free GPU" as the one you think** — the local model owns GPU1.
**`pgrep -f "cli.mjs send …"` matches the shell that asked** — test the process line or the JSON's `stopReason`. **Running any instrument
inside a worktree silently changes the rig it measures** — the seat root now has a config with an absolute `DURIG_DB`, so pin `DURIG_DB`
to a scratch store before running the suite there. **The portability audit is blind to the `complete_work` root decay** (#4884 is the
carrier). **`complete_work` re-points a seat's persisted cwd to `process.cwd()`** — never treat a re-point as durable before #4882.
**A `--dry-run` that names no removals is not evidence there are none.** **Never read an exit code through a pipe.** **Append prose with a
quoted heredoc + `cat >>`, not `printf`.** **A promoted instrument is "cited but untracked" until you stage it.** **Never quote shas.**
**LM Studio's GGUF stores each KV value's type as a 4-byte field** — a 1-byte reader desyncs by 3 bytes (`.spike/gguf-arch.mjs`).
