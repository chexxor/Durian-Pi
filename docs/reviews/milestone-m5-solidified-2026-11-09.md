# Solidifying M5: what "the rig can say what a seat was allowed to do, and remember what it saw" actually means

**Delegate session N18, 2026-11-09.** The operator asked for the next milestone to be researched and solidified,
with task decomposition and acceptance criteria that define completion. This document is that. It is a **proposal
for ratification**, not a decision: M5 is delegate-proposed and operator ratification is owed (D141).

Everything below is measured in this tree on Linux (Fedora Linux 45, kernel `7.2.15-300.fc45.x86_64`, node
v24.22.1, git 2.56.0), against `./selfdev.sqlite` (6,021 queue rows, 209,680 durable entries, 131,769 tasks,
13 conversations).

---

## 1. The defect in M5 as written

`docs/ROADMAP.md` §Milestones states M5 as a sentence:

> **M5 — The rig can say what a seat was allowed to do, and can remember what it saw.**

There is no fact about this tree that makes that sentence true or false. It names two capabilities and a sequence,
but no experiment decides whether the rig has them. A milestone with no falsifiable completion test is completed by
whoever writes the next doc saying it is done.

**Fix:** eight acceptance criteria, each with a probe, in a single runnable gate:

```bash
node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite
```

Baseline measured 2026-11-09: **3 PASS, 1 PARTIAL, 4 FAIL.** M5 is not close.

---

## 2. What the measurement found

### 2.1 Enforcement: decisions happen, and nothing is written down

There are **14 mediation points** in the tree, each of which decides allow-or-refuse:

| where | what it decides | record written |
|---|---|---|
| `src/seatguard.mjs:442` `beforeTool` | withheld shell names, spool writes, degraded-cwd writes/commits/shell, control bytes, collapsed multi-line source, git verbs, shell writes outside the worktree, staged secrets | none |
| `src/confine.mjs` | path outside the seat root, symlink escape, read-only env writes | none |
| `src/writetargets.mjs` | which paths a shell command actually writes | none |
| `src/seattools.mjs:272` `toolRemovalsFor(seat)` | which tools a seat has at all | none |
| `src/rig.mjs:75` | whether an org edge permits a send | none |
| `src/providers/spend.mjs` | whether a call is under the spend cap | the spend ledger (money only) |
| `src/worktree.mjs` | whether a tree may be swept | the audit verb's stdout |

Evidence that no record exists: `select count(*) from documents where kind like '%audit%' or kind like '%decision%'`
→ **0**. The word `auditRecord` / `BoundaryGrant` / `BoundaryReview` appears **0** times in the seven enforcement
files.

Refusals do exist — **1,532 durable entries contain the string `refused by durig:`** — but they are prose inside a
tool result, not a row. You cannot ask "which seat was refused under which rule this week" without grepping text.

**The closest shipped prior art** is `@erichll/pi-auto-review`'s `BoundaryRequest` / `BoundaryReview` /
`BoundaryGrant` with a SQLite audit store (ROADMAP 277, pinned vendor clone). That shape is the one to copy.

### 2.2 Reach is per seat, not per claim

`toolRemovalsFor(seat)` takes a seat, is computed at `up`, and is never recomputed at the claim. There is no
declarative rule file: `grep` for `allowRules`, `policyRev`, `denyByDefault` in the policy files returns
**0 matches**. So ROADMAP 173 has nothing to build on yet — the data shape does not exist.

### 2.3 Egress has no policy at all

Probing the actual guard functions with real commands (script: `docs/evidence/2026-11-09-milestone-m5/escape-baseline.mjs` (committed, re-runnable in 0.24 s)):

```
curl -s https://example.com/api        ALLOWED   (no rule matched)
wget http://169.254.169.254/metadata   ALLOWED   (no rule matched)
nc 127.0.0.1 8080                      ALLOWED   (no rule matched)
cat ~/.ssh/id_rsa                      ALLOWED   (no rule matched)
npm install lodash                     ALLOWED   (no rule matched)
pip install requests                   ALLOWED   (no rule matched)
rm -rf /home/chexxor/Git               ALLOWED   (no rule matched)
echo hi > /etc/passwd                  REFUSED   shell-write rule
git push origin main                   REFUSED   push-grant rule
```

The credential half is genuinely closed: the seat env forces `inheritEnv: false` and re-supplies a 12-name
allowlist, and a name that looks like a credential never crosses. What is open is **reach**: a seat shell can
address any host this box can, and `rm -rf` on a sibling worktree is not classified as a write at all.

**The security position already exists** — `docs/reviews/security-seat-sandbox-position.md` (item #4829, done)
names the boundary, the threat model, the enforcement points, eleven falsifiable gates G1–G11, and the residual
risk. ROADMAP 171 is satisfied. The code is not.

### 2.4 Cache economics — the gate is not blocked, it was never instrumented

Earlier sessions concluded "cache economics cannot be measured". That is **wrong, and the correction matters**:
the durable store already carries usage.

```
usage-bearing assistant entries: 73,326
fresh input tokens:              695,331,530
cacheRead tokens:                9,639,752,590
cacheWrite tokens:               0
cache hit rate across the rig:   93.3%
```

Per model, the spread is large and it is the real constraint on any dynamic prompt section:

| model | turns | fresh input | cacheRead | hit rate |
|---|---:|---:|---:|---:|
| deepseek-ai/DeepSeek-V4.1-Flash-1017 | 11,588 | 21,305,067 | 3,002,118,400 | 99.3% |
| deepseek-ai/DeepSeek-V4.1-Flash | 17,015 | 41,240,690 | 3,219,644,928 | 98.7% |
| qwen3.8-flash-next-q2_0 (today's seat model) | 3,708 | 30,021,948 | 234,173,233 | 88.6% |
| Qwen/Qwen3.6-35B-A3B | 4,380 | 202,835,688 | 290,985,584 | 58.9% |
| openai/gpt-oss-120b (today's verifier) | 1,476 | 18,010,943 | **0** | **0.0%** |

The spend ledger reports `cached_tokens: 0` on all 2,030 rows because the ledger meters **money** and only
metered endpoints get ledger rows; the local provider is loopback and unmetered. Cache data lives in the durable
entries, not the ledger. **Any instrument that measures cache economics from the ledger is measuring the wrong
thing** — that is a defect to fix before the memory track builds on it.

The consequence for the memory plan: the verifier model has **zero** cache hits today. Any prompt-section change
paid for by the verifier is paid in full, every call. ROADMAP 175's rule — "a dynamic section must be proven
cache-safe before it ships" — is measurable now, and the answer for the current verifier is *no*.

### 2.5 Memory: nothing exists, and 93 roadmap items have no queue row

`grep -rn "search_history" src/ cli.mjs` → 0. There is no `remember`, no `recall`, no `forget`. Meanwhile
`node tools/roadmap-queue-coverage.mjs` reports **96 of the 150 registered roadmap items >=200 have no queue row naming them** (54 have at least one).
Roadmap intent without a queue row is intent without an owner, a dependency, or a test.

---

## 3. M5, restated so it can be finished

**M5 (proposed statement):** *A seat's reach is decided from data, at the claim, and every such decision is
recorded and queryable after the fact; and the rig can retrieve what it already stored without a model call.*

Two halves, one ordering. Enforcement before memory, because ROADMAP 172's audit record is the prerequisite for
173's grants, 173's grants are the prerequisite for 269's raise/revoke cycle, and the memory write gate (167)
inherits the same mediation substrate.

---

## 4. Definition of done (the eight criteria)

Each is a gate criterion, its probe, and the roadmap item that closes it.

| # | criterion | probe that decides it | closes |
|---|---|---|---|
| C1 | a refusal is written as a structured record (subject, object, permission, rule, result) | `documents where kind like '%audit%'` > 0 **and** an audit-record type present in `src/seatguard.mjs` | 172 |
| C2 | enforcement decisions are countable from the store | a query over structured rows, not a substring grep | 172 |
| C3 | reach comes from declarative rules consulted at the claim | `toolRemovalsFor` takes the claim; a rule file exists | 173, 269 |
| C4 | egress is governed by a destination policy that demonstrably refuses | `refusalFor("curl …")` returns a refusal | 268, 276 |
| C5 | a written security position precedes isolation code | `docs/reviews/security-seat-sandbox-position.md` exists | 171 — **already met** |
| C6 | a token-budgeted read path over stored history exists | a recall tool name in the tool surface | 176, 162 |
| C7 | cache economics are measured | cached tokens > 0 recorded from a source that actually sees them | 175, 161 |
| C8 | the in-process mediator is not presented as the only defence | an OS backstop module, or an explicit statement of the limit | 174, 271 — **already met** by the position doc |

Milestone closure = the gate exits 0. Not "the code exists". Not "the doc says so".

---

## 5. Task decomposition

House rule for every row below: **owner, a dependency, an acceptance check that can run, and an iteration loop
under 30 s** (D213). Rows that need a provider or a broker are marked, and their cost is stated in seconds.

### Package A — the enforcement record (ROADMAP 172) — the milestone's entry point

| id | task | owner | depends on | acceptance (the command that proves it) | loop |
|---|---|---|---|---|---|
| A1 | Define the audit record shape: `{at, subject, runId, claimId, object, objectClass, permission, ruleId, decision, mode, policyRev}` as a `defineDoc` family, modelled on `BoundaryRequest/Review/Grant` | impl | — | `node demo/enforcement-audit.test.mjs` constructs one record and reads it back with all nine fields | <1 s |
| A2 | Make every `block:`/`denied()` site emit a record. 14 sites, enumerated above | impl | A1 | a fixture run of a seat that triggers five known refusals yields exactly five records, each with a rule id | <1 s |
| A3 | Subject identity that survives wake/reset/fork/compaction: a stable `subject` label plus a per-run `runId` | impl | A1 | two runs of the same seat produce distinguishable `runId`s for the same `subject` | <1 s |
| A4 | Redaction in the record: the object is stored redacted, never as a raw secret value (gate G9) | impl + security | A1 | a refusal naming a secret-shaped path stores a redacted preview; a demo asserts no raw value in the row | <1 s |
| A5 | Query surface: `cli.mjs audit --seat X [--rule Y] [--since T] [--limit N]`, bounded like `queue` (D250) | devtools | A2 | on the live store, `cli.mjs audit --json | wc -c` stays under 1 MB and reports the total it truncated | <2 s |
| A6 | Gate C1/C2 turn from FAIL to PASS | qa | A1–A5 | `node docs/evidence/2026-11-09-milestone-m5/gate.mjs` reports C1 and C2 PASS | <2 s |

**Why this is first:** it is the cheapest package (no OS primitives, no provider, no broker), it is the
prerequisite for every other enforcement item, and it turns "the guard blocked something" from a claim into a
fact the operator can inspect.

### Package B — placement rule enforced (ROADMAP 270)

| id | task | owner | depends on | acceptance | loop |
|---|---|---|---|---|---|
| B1 | Name the owning extension for every control in one invariant doc | scribe + security | — | the doc lists each control → owning extension, and every entry names a file that exists (`test -e`) | <1 s |
| B2 | A `check` rule that reports the installed extension set and flags a control living outside one | devtools | B1 | uninstalling the guard in a fixture makes the policy absent **and the rig says so** | <2 s |

This is the operator's explicit architectural ruling (D212) turned into an instrument. It is cheap and it is the
one gate that stops the base from accreting rig-specific behaviour.

### Package C — policy as data (ROADMAP 173)

| id | task | owner | depends on | acceptance | loop |
|---|---|---|---|---|---|
| C1 | The rules document: labels, `allow` rows, `policyRev`, fail-closed loader (an unparsable policy stops the broker rather than running with none) | impl | A1 | a rig with an empty ruleset denies everything; a fixture rule grants exactly one action | <1 s |
| C2 | Complain mode: evaluate and record without blocking, with the same rows as enforce mode | impl | C1 | the same fixture produces identical records in complain and enforce mode, differing only in `decision` | <1 s |
| C3 | `policy explain <subject> <object> <permission>` — the human-facing answer | devtools | C1 | a query returns the rule that matched and the rule that did not | <2 s |
| C4 | Move reach from seat to claim: `toolRemovalsFor` consults the ruleset at claim time | impl | C1 | the same seat, two claims, different reach, both visible in the audit | <1 s |

Gate G4 from the position doc is load-bearing here: **a raise means a new spawn with a wider ruleset; no API
widens a live subject.** Build that invariant into the demo, not into prose.

### Package D — egress (ROADMAP 268, 276)

| id | task | owner | depends on | acceptance | loop |
|---|---|---|---|---|---|
| D1 | Choose the mediation shape: (a) allowlist proxy outside the sandbox, (b) in-process guard on the tool path, (c) OS-level backstop plus guard, (d) network=none plus host proxy. Each option gets a written pro/con and a named failure mode | lead + security | A2 | the decision is recorded in `docs/DECISIONS.md` with the rejected options named | — |
| D2 | The escape probe suite: the nine escapes the baseline names (read a key outside the root, TCP to an ungranted loopback port, TCP to a LAN address, the link-local metadata endpoint, `git config --global core.hooksPath`, `rm -rf` a sibling worktree, an npm lifecycle script writing outside, a redirect outside the root, `git push`) — recorded as a baseline that **passes today** | qa | — | `node demo/egress-escape-baseline.test.mjs` asserts, per probe, the verdict in `escape-baseline-2026-11-09.txt` | <1 s |
| D3 | Implement the chosen shape; the same suite must now block, each block writing an audit row | impl | D1, D2, A2 | the suite flips from ALLOWED to REFUSED on at least the loopback and LAN probes | <1 s |
| D4 | State, in the product docs, what a seat shell can reach — re-tested, not re-asserted | scribe | D3 | a runbook section whose numbers come from the suite's output | — |

D2 before D3 is the point: without a recorded baseline, "we added egress control" is unfalsifiable.

### Package E — the ask/raise/revoke cycle (ROADMAP 269, 277)

Blocked. **G7 in the position doc says 269 is not schedulable until 273 closes** — the verifier model
`openai/gpt-oss-120b` is not registered on this rig (`DURIG_VERIFIER_API_KEY` unset), so an adjudicator is dark
and the ask path fails open by construction. Do not build this before A, C and the verifier grant.

### Package F — the memory read path (ROADMAP 175, 176, 162, 164)

| id | task | owner | depends on | acceptance | loop |
|---|---|---|---|---|---|
| F1 | Instrument cache economics from the right source: usage lives in durable entries, not the ledger; record `cacheRead`/`cacheWrite` per seat per turn | impl | — | a report printing per-model hit rates matching the numbers in §2.4 | <3 s |
| F2 | `search_history` over the immutable transcript: BM25 via pi-durable's `rankDocuments`, budgeted by **tokens**, returning pointers to entry ids | impl | F1 | a fixture transcript yields a known fact inside a stated budget, and refuses to exceed it | <1 s |
| F3 | Cue-triggered delivery at wake/claim/compaction/completion, fenced and labelled `[CONTEXT — may be stale]`, deduped, capped | impl | F2 | a seat that never calls a tool still receives the fact; the same fact is not re-injected every request | <1 s |
| F4 | Static invariants section (human-authored, seat read-only) — the cache-stable half of the prompt | scribe + lead | F1 | changing it invalidates the cached prefix exactly once, measured | needs a provider |
| F5 | Write gate (167), forget/tombstone (168), retention (169) | impl | A2, F3 | the planted-instruction probe lands in quarantine and never in the promoted tier | <1 s |

**F1 and F2 are the highest-value cheap work in the whole milestone.** They need no provider, no broker, no OS
primitives, and they make the rig's 209,680 existing entries usable instead of inert.

---

## 6. Sequencing, in one line

**A → B → C → D → F**, with E gated on the verifier grant and F1 able to start immediately in parallel with A.

The reason F is not first is not preference: the memory plan's own §7 gates every write path on a write gate, and
the write gate needs the mediation substrate that A and C build.

---

## 7. Explicit non-goals (what M5 does *not* include)

- SELinux policy language, type-enforcement compilation, roles/MLS, `audit2allow`-style rule synthesis — rejected
  in writing in `docs/reviews/zero-trust-zero-agent-research.md`.
- Containers, WSL, microVMs — rejected by the native-host non-negotiable and D131.
- Per-turn memory injection — the delivery rule is cue-triggered at boundaries.
- Embeddings, knowledge graphs, LLM consolidation on the write path — rejected in the memory plan.
- Any memory record that can satisfy a permission check (ROADMAP 167's own clause).

---

## 8. What the operator must decide

1. **Ratify M5's definition of done** (the eight criteria, or a revised set). Until that is ratified, "M5
   complete" is undefined.
2. **Choose the egress shape** (D1). This is a product-posture decision: deny-by-default with an allowlist is a
   different product than permissive-with-audit.
3. **Arm the verifier** (`DURIG_VERIFIER_API_KEY`). Without it, Package E cannot start, and the declared second
   family (`verifier/openai/gpt-oss-120b`) never registers a model row, so independence stays a declaration.
4. **Grant `DURIG_EXTENSIONS`** for the continuity extension already built (see
   `docs/runbooks/continuation-notes.md`). That is the closing act of the current milestone, not the next one.

---

## 9. What is NOT solidified yet, stated plainly

- The **cost** of a spawn-time wrapper on this host has not been measured. The research report says Landlock is
  unprivileged and self-imposed; no probe on this box has run one.
- The escape set **is** now a runnable instrument — `docs/evidence/2026-11-09-milestone-m5/escape-baseline.mjs`
  (0.24 s, read-only, committed baseline in the same directory) — but it is a *printed table*, not a demo wired
  into `scripts/test.mjs`. Until it is a demo, an enforcement change can silently move it. D2 is the row that
  closes that.
- The per-seat cache numbers above are aggregated per conversation id, not per seat name; the mapping from
  conversation to seat is not currently exposed by a cheap read. That is a small instrumentation gap worth a row
  (ROADMAP **349**).
