# NEXT — current priority and exact next command
<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-30T17:5xZ (**Z** — ROADMAP 244), host-local 2026-10-30 13:2x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D174, D175).
The superseded 141-line pointer is cut **verbatim** to `docs/NEXT-ARCHIVE.md` (entry marker line **8553**, body **8554–8695**).

**A VERDICT NOW EXISTS ON #4849, AND IT EXISTS ONLY BECAUSE THE OPERATOR GRANTED GPU HEADROOM.** The verifier slot went
`8192×4` → `16384×1` → **`24576×1`**, and `qa`'s scoped verify leg (`#4890`) then ran to **`stopReason=stop`**, not length:
in 5,887 → 8,413 → **15,864** with out=624. **15,864 + 624 = 16,488 > 16,384**, so at the old window it would have been cut
again. The store shows it actually read the files — entries **275416** (`read` → `src/shellregistry.mjs`), **275420**
(`read` → `src/seatguard.mjs`), verdict at **275422**: **`VERDICT: PROCEED`** on both claims (C1 rule-based selection,
registry set = guard set, both `{powershell, bash}`; C2 `canStart` vs `preferredOn` coherent, `selectSeatShell` cannot pick
outside `SHELL_CANDIDATES`). Full text: `.spike/fix-20261030/qa-4849-verdict.txt`. **Nothing is closed: #4849 is still
`claimed` with 5 uncommitted files, and the delegate will not close a row it did not earn.**

**What the verdict does NOT cover** (say this before anyone treats PROCEED as a close): qa never emitted pm's
`OUT-OF-SCOPE-NEEDS-RUNTIME-PROOF` label — it was **silent** on runtime behaviour, not explicitly abstaining, so the runtime
half (the 22 `spawn … ENOENT` results going away, the guard permitting `bash` at execution time) is **unverified**; and
**#4891 (qa2, the second leg) has not been run**.

**THE GATE FOR EVERY FUTURE VERIFIER TURN IS THE SHAPE, NOT THE SIZE — and the rule is now the template's own, not a
guess.** The predicate D174 recorded ("consecutive user turns") is WRONG: the instrument that encoded it cleared a turn that
then failed. LM Studio's generated template counts **every `user` plus every `assistant` carrying NO tool calls** and requires
that projection to alternate `user, assistant, user, …` from index 0 (`.lmstudio/.internal/temp/lmstudio-chat-template-*/
chat-template.jinja`, raise at line 48). So **a tool-calling assistant does not satisfy the alternation** — a seat resuming
after a tool turn is in the wrong slot the moment anything appends a user turn. Measured across 12 seats: **6 windows already
carry a parity break and 11 of 12 would be refused on their next `send`** — including healthy local seats, whose provider
tolerates it. Row: **#4886** (`impl`, held).

## NEXT SESSION

**Current item: route qa's verdict to pm (the brief is written; the command is below), then run the second leg #4891 or get
pm's ruling that one capability-scoped leg plus the delegate oracle is enough, then let pm take the landing act on #4849.**
Order of work is still lead's: **217 → 263 → 264 → 221/265 → 266 → 267**, 232 gated on #4846.

**Next commands (delegate, Linux; the first one is the actual next act):**

```bash
# 1. route the verdict (pm holds the landing act; ~12-15 min wall clock on the local model — run it, then wait, don't fork another harness)
env -u DURIG_SEAT_ROOT DURIG_DB=./selfdev.sqlite node cli.mjs send pm --body-file .spike/fix-20261030/send-pm-verdict-4849.md
# 2. BEFORE any send, pre-flight the shape (under a second, read-only, 0 writes) — this is the new instrument
DURIG_DB=./selfdev.sqlite node tools/seat-turn-shape.mjs            # --seat qa | --json | --strict | --explain qa
node demo/seat-turn-shape.test.mjs                                  # its fixture; part of the suite
# 3. rig state — #4849 MUST still be `claimed`; #4886-#4893 held
DURIG_DB=./selfdev.sqlite node cli.mjs queue
DURIG_DB=./selfdev.sqlite node cli.mjs status
# 4. the verifier slot MUST still be 24576×1 — LM Studio restores 8192×4 on app relaunch, so re-check after any restart
node -e 'fetch("http://127.0.0.1:1234/api/v0/models").then(r=>r.json()).then(j=>console.log(j.data.map(m=>[m.id,m.state,m.loaded_context_length].join(" "))))'
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]* --parallel [0-9]*"
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader   # GPU0 ~15.2/16.4 GiB = the verifier; GPU1 ~22.8 GiB = strata's LOCAL model
# 5. the clock-out trio, always all three, in BOTH trees
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs
node tools/instrument-provenance.mjs                                 # suite membership + cite resolution (41 runbooks now)
git for-each-ref refs/rescued | wc -l                                # 489; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**Two operators' decisions are pending, neither the delegate's.** (a) **Auto-compaction configuration** — the recommended
policy and the one call site are written up in `docs/runbooks/compact-a-seat.md` ("What auto-compaction is configured to, and
what to set it to"), carrier row **#4887**; the delegate offered it, the operator has not ruled, and building it is `impl`'s.
(b) The research prompt `docs/reviews/seat-scoped-durable-state-research-prompt.md` still sits with the operator; its landing
is the only trigger for **#4885**.

**Channel:** `send` remains the only wake on this host (a broker start is still refused on `seat-shell-availability`, which
carries **no ack flag**). **Blocker:** none hard; the soft one is that #4886 makes every verifier turn a gamble until it is
fixed — pre-flight with `tools/seat-turn-shape.mjs` instead of discovering it for 12 minutes.

## What landed this session, with its evidence

- **Capacity (operator's grant to spend A4000 headroom):** `lms load mistralai/ministral-3-14b-reasoning -c 24576 --parallel 1
  --gpu max` → GPU0 **15,202/16,376 MiB**, and a **21,135-token** request completed in **19.1 s**. Cost computed from the model
  file's own metadata: **160 KiB/token** → 3.60 GiB of KV at 24,576×1. LM Studio's `--estimate-only` said 14.39 GiB where
  **14.85 GiB** loaded — it runs ~0.35 GiB low. `DURIG_VERIFIER_CONTEXT` now **24576** in both gitignored configs.
- **New instrument (next-session improvement #1, implemented):** `tools/seat-turn-shape.mjs` + `demo/seat-turn-shape.test.mjs`
  — read-only, opens no harness, prints each seat's counted projection, parity breaks, and a **`next send` pre-flight**; `--strict`
  for a gate. It caught its own wrong predicate in the field (above), and its RED→GREEN is in the field: `AT RISK` immediately
  before a failed send, `ADMISSIBLE` after a bare `reset qa` — which is what gated the retry that produced the verdict.
- **Runbook (improvements #3 and #4):** new `docs/runbooks/verifier-serving-headroom.md` (front-matter conformant, indexed twice
  in `docs/runbooks/README.md`) — GPU ownership, the KV formula, the ctx→GiB table, the vendor-tool procedure with a captured
  restore recipe, the three-way post-restart re-check, and **the briefing arithmetic** (one batched brief per seat per session;
  name the claims, cap the files, demand the verdict before the reading; never re-send a failed brief — it is a deposit).
- **Compaction (improvement #2, recommendation only):** the no-op mechanism is now read from shipped source
  (`compaction.js:69-71` completes with no entry when `selectCut` finds nothing; `selectCut` at 211-234; the trigger at
  `generation.js:236-245`) — durian-pi sets **no** policy (`cli.mjs:414-423` → `streamSettings` only), so the defaults make
  auto-compaction **impossible on a 24,576 window** (background threshold **−24,576**) and would size a summary request at up
  to **13,107** tokens. Written into `docs/runbooks/compact-a-seat.md`; D175.
- **Seat acts:** `reset qa` (dry-run first, `writes: 0`) — no handoff, deliberately; one scoped brief; one verdict. `qa2`/
  `auditor` still carry their residue and were left alone. `#4849` untouched: still `claimed`, files still uncommitted on
  `seatroot/linux`, insurance refs `refs/rescued/impl-4849-*` intact (484 → **489**).

## Rig state, re-measured at clock-out 2026-10-30T17:5xZ (Linux) — re-read, do not trust

**Store** `./selfdev.sqlite` (last full backup `.spike/repoint-20261030/store-backup-20261030-005816.sqlite`); 12 seats; `pm`/
`lead` on the live checkout, the other 10 on the seat root, branch `seatroot/linux`. **Queue census 4,893 = 3,756 done / 780
cancelled / 319 held / 20 queued / 17 deferred / 1 claimed (#4849) → CLAIMABLE 21.** **Broker DOWN, deliberately.** **Verifier**
LM Studio Ministral-3-14B-Reasoning Q6_K on **GPU0** (`:1234`, 15,202/16,376 MiB, **ctx 24576, parallel 1**, YaRN over an
original 16,384, file declares 262,144) — qa, qa2, advocate, auditor, designer; **local** `strata` `iq3_s` on **GPU1**
(~22.8/24.6 GiB, `--max-context 204800 --kv int8`) — pm, impl, lead, scribe, devtools, security, architect. `flint` is not a
fallback verifier (40B MoE, 22.51 GiB as Q4_K_M, fits neither card alongside). **Supervisor:** last window logged
`reason=degeneration` for `auditor, devtools, qa2` — pre-existing, UNVERIFIED; the only resets applied are qa's. **Worktrees 2**
(`reapable 0` is not a verdict, 266). **`LocalRTC=yes`** on a dual-boot box while every gate is `Date.now()` arithmetic —
`timedatectl set-local-rtc 0` is the operator's call (ROADMAP 234). `probe-preflight` REFUSES (swap max 50 %), so no probe arm may start.

## OPERATOR GRANTS (twelve through D175)

1–9. Unchanged from the archived pointer (seat-root ruling A; the "queue drains" predicate; mint the refs; instrument hygiene; the
verifier paths; decomposition-not-seats with the scale gate; the Linux isolated seat root; the `send` bootstrap while the broker is
un-startable; research-don't-re-architect).
10. **Host model-serving may be changed through the vendor's own API** — report the headroom you measured; do not spend it again
unasked.
11. **Tree-shape acts on the approved seat root are the delegate's** (branch it, give it a host config) — record what changed under
the seats, because the suite is the constitution's oracle.
12. **NEW: A4000 headroom may be spent for the verifier** — used to go 16,384 → 24,576 (≈1.2 GiB of card left). It is a capacity
spend, not a licence to keep raising: KV is 160 KiB/token on this family, and the shape defect (#4886) is what actually blocks the leg.

## Do not "fix" these on the strength of the docs

**A provider that answers a 26-token probe is not healthy; a 200 at 9,627 tokens is not a working verifier; and a working verifier
still cannot be sent to if its counted projection is in the wrong slot.** **`reset <seat> <handoff>` writes a user turn.**
**An errored or length-cut turn leaves its user message and an empty assistant message in the conversation** — the poison grows
monotonically, and re-sending a brief is a deposit, not a retry. **A compact that writes no entry is usually a legitimate no-op**
(`context below keepRecentTokens — nothing to cut`); the CLI's wording says otherwise (`cli.mjs:1344`, `src/broker.mjs:689`).
**`compact` writing no entry is not a window problem.** **Never treat "the free GPU" as the one you think** — the local model owns
GPU1. **LM Studio restores `--ctx-size 8192 --parallel 4` on app relaunch.** **LM Studio's `--estimate-only` runs ~0.35 GiB low.**
**`pgrep -f "cli.mjs send …"` matches the shell that asked.** **Running any instrument inside a worktree silently changes the rig it
measures** — pin `DURIG_DB` to a scratch store before the suite there. **The portability audit is blind to the `complete_work` root
decay** (#4884). **`complete_work` re-points a seat's persisted cwd to `process.cwd()`** (#4882). **A `--dry-run` that names no
removals is not evidence there are none.** **Never read an exit code through a pipe.** **Append prose with a quoted heredoc +
`cat >>`, not `printf`.** **A promoted instrument is "cited but untracked" until you stage it.** **Run prettier before committing —
`demo/format.test.mjs` gates it.** **LM Studio's GGUF stores each KV value's type as a 4-byte field.** **Never quote shas.**
