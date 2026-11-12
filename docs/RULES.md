# Standing rules — the index

**Status:** working home for standing rules. Audience: every seat, plus the operator.
**Why this file exists:** lead's ruling (#6368) is that a standing rule belongs in a document a
machine can read, not in a queue row that keeps waking a seat. devtools builds the queue-side class
that moves those rows (#6586); this file is the destination they move *to*.
**What it is not:** a restatement of the rules. It is an index. Each rule has exactly one home — the
doc or the code that carries it — and this table points at that home. Per #6286 Step 0e, grep before
adding anywhere else: a rule with two homes is two chances to contradict.

## The row shape

| column | what it holds |
|---|---|
| **Rule** | the rule in one sentence |
| **Status** | `instrumented` or `prose-only` |
| **Mechanism** | the thing that acts on it: a `check` rule id, a named module/tool, or the honest word `none` |
| **Owner** | the seat named in the fix, or `operator` when the fix is a rig declaration the operator runs |
| **Last verified** | the command that was run, and its exit code |
| **Prevents** | the failure the rule exists to stop |

## The conversion rule

A rule is `instrumented` **only when there is a measured instance it would have caught** — a test,
a refusal, a finding, a number. Everything else is `prose-only`, and that is a legible state, not a
defect: it says *this rule has no actuator*. Same principle as #6080 (INTENDED vs RESOLVED) and
#3539 (a rule that starts red gets disabled rather than silently ignored).

Do not convert a prose rule to instrumented by writing a mechanism first and finding an example later.
The measured instance comes first; the actuator follows it.

## Index

### A. Instrumented — `check` rule ids

`node cli.mjs check <rig>.json` prints all 23 rule ids with a status; the ids are declared in
`src/checkup.mjs` as `RULES` ("Rule ids are the stable API: scripts match on them, prose may change",
`src/checkup.mjs:43`). **The ruling named `tools/check-rules.json`; that file does not exist in this
tree** — the declaration lives in `src/checkup.mjs`, so the code wins and every row below names a
rule id from it.

Verified 2026-11-12 in worktree `item-6587`: `node cli.mjs check rig.v2.json` → exit **0**, 23 distinct
`"id"` fields in the report.

| Rule | Status | Mechanism | Owner | Last verified | Prevents |
|---|---|---|---|---|---|
| A seat's constitution is missing or is not the one the rig declares | instrumented | `constitution-missing`, `constitution-not-applied` (src/checkup.mjs) | operator | `node cli.mjs check rig.v2.json` exit 0 | a seat acting on rules nobody agreed to |
| A seat has no org edge, so it cannot send | instrumented | `unreachable-seat` | operator | same, exit 0 | delegation that silently goes nowhere |
| An edge names a seat that does not exist | instrumented | `dangling-edge` | operator | same, exit 0 | a routing table pointing at ghosts |
| The rig declares a seat the store lacks, or the store holds an undeclared one | instrumented | `store-missing-seat`, `stray-seat` | operator | same, exit 0 | a roster and a store that disagree |
| No seat is an independent verifier | instrumented | `no-verifier-seat` | operator | same, exit 0 (finding present: rig.v2.json has no verifier seat) | `complete_work` being self-declared |
| Every seat resolves to the same model | instrumented | `single-model-rig` | operator | same, exit 0 (finding present on rig.v2.json) | a shared blind spot nobody can see |
| A seat declares no capabilities | instrumented | `seat-without-capabilities` | operator | same, exit 0 | a degenerate seat with no working tools |
| A runbook is stale, unverified, or malformed | instrumented | `runbook-stale`, `runbook-unverified`, `runbook-front-matter` | the seat that changed the procedure | `node demo/runbook-rules.test.mjs` exit 0 | following a procedure that rotted |
| A docs-ownership class names a seat the rig does not declare | instrumented | `ownership-seat-missing` | operator | same, exit 0; currently `skipped`: "the rig declares no `ownership` block" | an artifact nobody is responsible for |
| A verification completed with no re-runnable evidence | instrumented | `verification-without-evidence` | the completing seat | `node demo/check-evidence.test.mjs` exit 0 | a "done" that cannot be checked |
| Evidence names an artifact but no tree | instrumented | `evidence-tree` (#4153) | the completing seat | `node cli.mjs check rig.v2.json` exit 0 | a green whose tree is unknown |
| A queue item cites a commit this clone does not hold | instrumented | `citation-unresolvable` (ROADMAP 190) | the citing seat | `node demo/checkup-citation.test.mjs` exit 0 | evidence that decays with the clone |
| A feat commit landed with no FEATURES row and no "no feature surface" note | instrumented | `feature-row-missing` | the authoring seat | `node demo/feature-row.test.mjs` exit 0 | features the docs never learned about |
| A queue row duplicates the intent of a terminal item | instrumented | `duplicate-item` | pm | `node cli.mjs check rig.v2.json` exit 0 | the same work minted twice |
| The shared working tree is not on its integration branch | instrumented | `shared-tree-on-main` | the seat running git | `node demo/shared-tree-on-main.test.mjs` exit 0 | a seat committing to a feature branch by accident |
| A commit message carries a BOM / NUL / stray CR | instrumented | `commit-message-encoding` (#4349) | the committing seat | `node demo/commit-message-encoding.test.mjs` exit 0 | a trailer corrupted invisibly |
| A tracked file's newline structure collapsed or its encoding broke | instrumented | `text-integrity` (#4305) | the editing seat | `node demo/text-integrity.test.mjs` exit 0 | a file `node --check` cannot see is broken |
| A seat moved more tokens than its own window allows | instrumented | `context-over-window` (#5049) | qa | `node demo/context-over-window.test.mjs` exit 0 | a consumed fraction that was never read |
| A doc states a count the code does not declare | instrumented | `doc-count-drift` (#6155) | scribe | `node demo/doc-count-drift.test.mjs` exit 0 — "23 rules declared, 6 measures, 2 doc claims read, all consistent" | a number with no source |

### B. Instrumented — mechanisms outside `check`

| Rule | Status | Mechanism | Owner | Last verified | Prevents |
|---|---|---|---|---|---|
| Staging must name explicit paths — never `git add -A` / `git add .` | instrumented | `src/confine.mjs` refusal patterns (9 `{re, why}` entries) | the committing seat | `node demo/confine.test.mjs` exit 0 — "all confine canaries held"; live on this host: this item's own `grep "add -A"` probe was refused by the guard | a seat staging someone else's uncommitted work |
| `push` needs the operator's grant | instrumented | `src/confine.mjs:298` (`unless: operatorGranted("DURIG_ALLOW_PUSH")`) | operator | `node demo/allow-push-env-name.test.mjs` exit 0 | an unreviewed artifact leaving the rig |
| A landing is gated; an optional gate is not a gate | instrumented | `src/landinggate.mjs` (#6090) | the landing seat | `node demo/landing-gate.test.mjs` exit 0 — 31 ok, 0 failed | a merge accepted on a signal that was never run |
| No write verb runs while a merge is in progress | instrumented | `src/mergeguard.mjs` | the seat running git | `node demo/mergeguard.test.mjs` exit 0 | a half-merged tree committed as if complete |
| A terminal, unlocked, clean worktree is reaped; a locked or branch-held one survives | instrumented | `src/seatroot` sweep + `scripts` worktree sweep | operator | `node demo/worktree-sweep.test.mjs` exit 0; `node demo/broker-worktree-sweep.test.mjs` exit 0 | leaked worktrees accumulating (see `docs/runbooks/leaked-worktrees.md`) |
| A degenerating seat is detected, halted, waited on, and reset | instrumented | `src/degeneration.mjs` + `src/guard.mjs` (`GUARD_STEPS = ["detect","halt","wait-idle","resolve"]`) | qa | `node demo/degeneration.test.mjs` exit 0 | a seat burning turns on nothing |
| A secret never reaches a commit | instrumented | `src/secretdetect.mjs` pre-flight (`secretOffendersInDiff`) | the committing seat | `node demo/commit-secrets.test.mjs` exit 0 | a credential in the repo history |
| Held rows are classified, not left to rot | instrumented | `tools/held-gate-audit.mjs` (classes: release-candidate / cancel-candidate / standing-rule / gate-open / unattributed) | pm | `node demo/held-gate-audit.test.mjs` exit 0 | 184 held rows pretending to be work |

### C. Prose-only — no actuator, and that is stated

| Rule | Status | Mechanism | Owner | Why it is prose |
|---|---|---|---|---|
| Every factual claim cites a retrieved passage | prose-only | `none` | every seat | no machine can tell a citation from a memory |
| Report done/blocked/unverified honestly; never claim a check you did not run | prose-only | `none` for the claim itself; the *artifact* half is instrumented (`verification-without-evidence`, `evidence-tree`) | every seat | the intent of a report is not measurable; the evidence attached to it is |
| One concern per change; prove it with the test that exercises it | prose-only | `none` | every seat | "one concern" is a judgement call |
| Read an item as an intent and deepen it in four steps before the first tool call | prose-only | `none` | every seat | the deepening is a reasoning step, not a state change |
| Fold before minting: grep `DECISIONS.md` before adding an entry (#6286 Step 0e) | prose-only | `none` | pm, lead | nothing detects a duplicated decision yet |
| Work in your item worktree; never write outside your seat root | prose-only as stated in `constitution.txt` P2 Isolation | the *refusal* is instrumented: `src/confine.mjs` / seat guard refuses writes outside the worktree | every seat | the rule is prose, the guard is the actuator — this row is the honest split |
| Confirm `git rev-parse --show-toplevel` before any mutating git command | prose-only | `none` | every seat | the guard refuses specific verbs; it cannot prove the caller checked its root |

## How to check this index

The index's own invariant: **every row's Mechanism either names a rule id that exists, or says
`none` explicitly.** Run:

```bash
node -e 'import("./src/checkup.mjs").then(r=>{const ids=new Set(r.RULES.map(x=>x.id));const lines=require("node:fs").readFileSync("docs/RULES.md","utf8").split("\n");let inIndex=false;const rows=[];for(const l of lines){if(/^## Index/.test(l)){inIndex=true;continue}if(!inIndex||!l.startsWith("|"))continue;if(/^\|\s*(-+\s*\|)+$/.test(l))continue;if((l.split("|")[1]||"").trim()==="Rule")continue;rows.push(l)}const bad=[];for(const l of rows){const m=(l.split("|")[3]||"").trim();if(!m){bad.push("empty mechanism: "+l.slice(0,60));continue}if(m==="`none`")continue;const named=/\.mjs|confine|seatguard|secretdetect|mergeguard|landinggate|degeneration|held-gate-audit|sweep/.test(m);const hit=(m.match(/[a-z0-9-]+/g)||[]).some(t=>ids.has(t));if(!named&&!hit)bad.push("unresolved mechanism: "+m)}console.log(bad.length?"FAIL\n"+bad.join("\n"):"PASS "+rows.length+" index rows; "+ids.size+" rule ids declared")})'
```

Run 2026-11-12 in worktree `item-6587`: `PASS 34 index rows; 23 rule ids declared`, exit **0**
(19 rows in A, 8 in B — 27 instrumented; 7 in C — prose-only).

A row whose mechanism is neither a declared id nor a named module is a defect in this file, not in
the rig.

## What is still missing

- No rig declares an `ownership` block (`ownership-seat-missing` reports `skipped`, "the rig declares
  no `ownership` block"), so the Owner column here is prose, not enforceable. Instrumenting it is
  devtools' #6586 territory.
- `tools/check-rules.json`, named in lead's ruling, does not exist in this tree; the ids are in
  `src/checkup.mjs`. If devtools minting #6586 creates that file, this index's Mechanism column needs
  to be re-pointed at it and this section re-verified.
- The 184 held rows classified as standing rules (`docs/runbooks/stale-held-backlog.md`, measured
  2026-11-10) are not migrated here. Migration is a separate project with a hard constraint (#6140):
  move them by cluster, into the doc where the rule is actually used, never in one pass.
