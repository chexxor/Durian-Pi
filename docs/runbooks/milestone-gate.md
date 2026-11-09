---
runbook: milestone-gate
symptom: "a milestone is claimed done, or a session needs to know how far a milestone actually is; ROADMAP §Milestones says ⏳ next and nobody can say what is left"
writes: false
precondition: "read-only"
last_verified: 2026-11-09
verified_by: delegate
evidence: "2026-11-09, Linux Fedora 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1: `node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite` exits 1 and prints 3 PASS, 1 PARTIAL, 4 FAIL in about 1 s; `node docs/evidence/2026-11-09-milestone-m5/escape-baseline.mjs` prints 6 of 9 escapes reaching no rule. Both read only the store and two src/ modules."
check_rule: null
---

# Decide whether a milestone is actually done (milestone-gate)

## When to use
- You are about to say "M5 is complete", or a doc says it is, and you need the fact rather than the claim.
- A session starts and needs to know where a milestone stands without reading a 6,000-line roadmap.
- An enforcement change landed and you need to know whether it closed a gap or moved it.

## The rule (D251)
A milestone is closed when **its gate exits 0**. ROADMAP §Milestones states milestones as sentences; a sentence
has no falsifier. `docs/MILESTONES.md` is the ledger: each milestone row carries the gate command and the date it
last measured.

## Diagnose (read-only, no broker, no key, no model)

```bash
node docs/evidence/2026-11-09-milestone-m5/gate.mjs --db ./selfdev.sqlite
```

Each criterion prints its **probe** — the exact measurement that decided the verdict — so a FAIL can be argued
with. Exit 1 means at least one criterion is unmet; the list at the bottom names the roadmap ids that close them.

Baseline measured 2026-11-09:

| criterion | verdict | what the probe saw |
|---|---|---|
| C1 structured enforcement record exists | FAIL | 0 audit/decision documents; 0 audit-record identifiers in 7 enforcement files |
| C2 decisions countable from the store | PARTIAL | 1,532 entries contain the prose `refused by durig:`; 0 structured rows |
| C3 reach is data, attached to the claim | FAIL | `toolRemovalsFor(seat)`; 0 rule-as-data identifiers in the policy files |
| C4 egress governed by a destination policy | FAIL | `refusalFor()` refused 0 of 3 probes |
| C5 security position precedes code | PASS | `docs/reviews/security-seat-sandbox-position.md` |
| C6 budgeted read path over stored history | FAIL | 0 recall tools; 209,680 entries with no read path |
| C7 cache economics measured | FAIL | ledger records 0 cached tokens (see the trap below) |
| C8 mediator not the only defence, or the limit stated | PASS | the position doc states it explicitly |

## The trap that makes a green gate meaningless

**The ledger is the wrong source for cache economics.** `spend.jsonl` shows `cached_tokens: 0` on every row
because a row is written only for a **metered** endpoint (`src/providers/spend.mjs` `isMeteredModel`). Loopback
traffic — most of the rig's traffic — never appears there. The real numbers are in the durable entries:

```bash
node -e '
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});
let n=0,input=0,cacheRead=0;
for(const r of db.prepare("select record from entries where record like ?").all("%\"cacheRead\"%")){
  try{const u=(JSON.parse(r.record).model||[])[0]?.usage; if(!u)continue;
    n++;input+=Number(u.input||0);cacheRead+=Number(u.cacheRead||0);}catch{}}
console.log(n,"turns  fresh input",input," cacheRead",cacheRead," hit rate",(100*cacheRead/(input+cacheRead)).toFixed(1)+"%");'
```

Measured 2026-11-09: **73,326 turns, 695,331,530 fresh input, 9,639,752,590 cacheRead — 93.3% of prompt-side
tokens are cache reads**, and the verifier model `openai/gpt-oss-120b` has a **0.0%** hit rate over 1,476 turns.
A gate that reports C7 from the ledger alone is measuring an empty table.

## Before/after for an enforcement change

```bash
node docs/evidence/2026-11-09-milestone-m5/escape-baseline.mjs
```

prints the guard's verdict on the nine escapes ROADMAP 268's acceptance names. Baseline: **6 of 9 reach no rule**,
including `rm -rf <sibling worktree>` (`shellWriteRefusal` does not classify `rm` as a write) and
`cat ~/.ssh/id_rsa`. Any change that closes an escape must move this table; a change that does not run it has not
been tested against the thing it claims to fix.

## What this runbook does NOT do
It does not schedule anything, close any row, or declare a milestone complete. Registration is in ROADMAP
**347–349**; the rows are the PM's to mint.
