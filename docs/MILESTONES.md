# Milestones — what has been completed, what is in flight, what is next

A session reads this file when it needs to know **which milestone it is working on and what "done" means for it**.
`docs/ROADMAP.md` § "Milestones" carries the short version; this file carries the ledger, the evidence, and the
acceptance criteria.

Two vocabularies are in use and they must not be conflated:

- **Product milestones M1–M5** — the named, durable ones in `docs/ROADMAP.md` § "Milestones".
- **The working milestone** — the one-liner at the top of `docs/NEXT.md` under `## NEXT SESSION`, e.g.
  "ensuring LLM task completion (D226) — first tranche ROADMAP 331". A working milestone is a tranche of a product
  milestone, or a hole the product milestones did not anticipate. It is closed when its gate exits 0.

The trap this file exists to prevent: a working milestone can be *declared* closed because the code exists, while
the product-level outcome it served is still unmeasured. Every row below therefore carries the command that
decides it.

---

## M1 — the rig runs and routes. ✅ done

Queue semantics, org edges, the Router at harness open, seat prompts, real-model end-to-end (D3, D4, D5, D16).

**How it is checked today:** `node cli.mjs doctor` plus the `rig` and `broker` test areas.

## M2 — the operator can see the rig. ✅ done

`watch`/`log` human views, the live stream on `send`, turn-grouped transcripts, the wrong-database guardrail
(D18, D19, D20).

**How it is checked today:** the `tui` test area (45 demos).

## M3 — seats can do work, and the rig verifies it. ✅ delivered, one gap open

Both halves are in the tree: tools are installed and capability-narrowed (`src/seattools.mjs`), and a completion
carries evidence (`checkup.mjs` `verification-without-evidence` and `evidence-tree` rules live in `check`).

**Still open:** independence. `cli.mjs check` reports `single-model-rig` — all 12 seats resolve to the same model
family. Registered as ROADMAP 189, D137/D140. This gap is why M5's verifier-adjudicated grants (ROADMAP 269)
cannot be accepted yet: a verifier that is the same model as the subject is not a verifier.

## M4 — interactive client over the same store. ⏸ parked

The data layer and a durable TUI exist. Parked on the operator's TUI Q2 (Q1 was answered: the operator wants the
operator UI to read the same store, and `cli.mjs status`/`queue` now do — see below), not on a missing
prerequisite.

## M5 — the rig can say what a seat was allowed to do, and can remember what it saw. ⏳ next

Definition of done and decomposition: `docs/reviews/milestone-m5-solidified-2026-11-09.md`. Gate:
`node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite` — **2 PASS, 2 PARTIAL, 4 FAIL** as of
2026-11-09. Operator ratification is owed (D141).

---

## Working milestones, most recent first

### N17 — land the landed, and stop the worktrees leaking (D249, ROADMAP 311 cut 2, ROADMAP 344)

**Outcome sought:** branches whose content is in `main` do not pin worktrees and do not stay open in the queue.

**Tasks documented for it, and their measured state on 2026-11-09:**

| task | state | evidence |
|---|---|---|
| land `item-5387`, `item-5501`, `item-5829`, `item-5226`, `item-5221` | done | `main` `6787bd24` → `ea12fe04`, zero `--force` |
| close the composition regression the landing pass exposed | done | `ea12fe04` restores `LOCAL2_ENV_PREFIX`; full suite 278/278 caught it (pitfall 186) |
| sweep trees and refs | done | 58 worktrees → 9; 60 refs → 12; every removal proved an ancestor of `main` first |
| name the ceiling | done | 49 item trees had branches provably ancestors of `main` while their rows stayed non-terminal; `src/broker.mjs:1117` classifies those as `live` |
| register the ceiling as a rule | done | `docs/DECISIONS.md` D249; ROADMAP 311 cut 2 and 344 amended |
| land the consuming verb (`cli.mjs worktree reap`) | **not landable** | `item-5301` tip `39f8c92c`: `cli.mjs` does not parse (backticks inside the `usages:` template literal); once removed, `reapWorktrees` returns a shape its own demo (`demo/worktree-reap.test.mjs:114`) does not match — it returns removed ids where the demo asserts `candidates` / `refusedSoleCarrier` / `kept` / `counts` |
| close the rows left open by the landings | **open — owner action** | `#5221` held, `#5226` held, `#5387` deferred, `#5501` deferred, `#5829` claimed; `#5785` deferred (owner `impl`); the 16 patch-equivalent-but-not-ancestor refs registered but not scheduled |
| choose the D249 remedy | **open — operator or PM decision** | three options spooled to `pm` as `delegate-20261109-auto-clean`; recommendation was option (b), the author seat closes its own row |

**Why it is parked rather than finished:** the remaining work is a queue-state decision, not a git operation. A
delegate closing those rows would be asserting an acceptance the verification gate has not granted.

**The probe that falsifies it:** `DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` → `total: 9`,
`reapable: 0`, all `seat-root`. If a future pass finds a merged tree whose row is terminal and still
`keepReason: "live"`, D249 is wrong.

### N18 — ensuring LLM task completion (D226 → re-ordered by the operator into D240; first tranche ROADMAP 331)

**Outcome sought:** a seat can finish an item it cannot hold in one context window.

**Tasks documented for it, and their measured state:**

| # | task | state | evidence |
|---|---|---|---|
| 1 | ratify the continuation contract | done | folded into D130 L5 as D240; store document is truth, `DURIG_NOTES_DIR` is a convenience mirror |
| 2 | the mechanism, on the extension plane | done | `extensions/continuity.mjs`; `node demo/continuity-note.test.mjs` → `CONTINUITY PASS`, 5 scenarios, 0.4 s |
| 3 | compaction supplies the note instead of summarising | done | faux model `callCount` 22 before = 22 after: zero summariser calls |
| 4 | a seat wakes into the note | done | `node demo/offline.mjs`, 0.29 s: one `pi.reset` boundary, fresh context = 1 message carrying the note, item `done` with the result summary |
| 5 | ROADMAP 331 itself — repair the compaction fallback | done | `src/config.mjs` nests `modelOverrides` inside `compaction` and expands family keys against the provider-family vocabulary in `src/providers/local.mjs`; `demo/config.test.mjs` green |
| 6 | extend the milestone gate | done | `docs/evidence/2026-11-08-context-window/milestone-check.mjs` reads per-seat notes through pi-durable storage, separates mechanism failure from operational blocker, reports truncations since the first real `write_note` |
| 7 | bound the read surfaces the mechanism depends on | done | `cli.mjs status --json` 28,543,835 B → 587,109 B on the live store; census and deferred backlog travel with the view (D250); `--full-queue` refuses with a count |
| 8 | the operator workflow | done | `docs/runbooks/continuation-notes.md`, indexed in the README symptom table; pitfalls 191–202; D250 |
| 9 | **arm it on the live rig** | **open — operator action** | `cli.mjs config` prints `DURIG_EXTENSIONS: null`; `selfdev.sqlite` has 0 `durig.notes` documents; 12 seats have no note |
| 10 | the decomposition the PM minted | open | `#5931`–`#5942`, all `queued`, all unclaimed |

**Why row 9 is not delegate work:** `DURIG_EXTENSIONS` changes what code runs in every seat on this rig. That is a
capacity grant, and the operator holds it.

**Milestone-level caveat, stated rather than smoothed over:** ROADMAP 331's acceptance is "truncated summaries drop
to zero over 100 compactions measured by `compacteval`". That cannot be measured until real seat runs stop failing
— the live store carries 2,354 compactions, 432 failed, 219 truncated, 209 refused by the run cap, and the broker
is down with 10 intents spooled and 0 delivered. The mechanism is proven offline; the outcome is not yet measured
on a running fleet.

---

## What the next milestone is, and how it was chosen

Written out in full in `docs/reviews/milestone-m5-solidified-2026-11-09.md`, with the decomposition, the acceptance
criteria and the gate. The short version:

**Candidate considered:** make the rig remember. **What measuring it showed:** the rig cannot yet say what a seat
was *allowed* to do — 1,532 guard refusals exist in the transcript as prose, and 0 exist as a record; reach is
decided per seat at `up`, never per claim; egress has no policy at all (`refusalFor()` passes `curl` to any host);
and the cache-economics premise that gates dynamic prompt sections has never been measured (2,030 metered calls, 0
cached tokens recorded).

**Therefore M5 is sequenced as:** write the security position (171) → record every mediation decision (172) → make
reach data rather than code (173) → measure cache economics (175) → give the rig a budgeted read path over what it
already stores (176) → only then build memory.

The ordering is not preference. `docs/reviews/memory-implementation-plan.md` §7 gates every memory write on a
write gate that does not exist, and gates every dynamic prompt section on cache economics that have never been
measured. Building memory first would build it on an unverified premise.
