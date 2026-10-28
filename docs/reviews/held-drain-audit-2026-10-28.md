# Held-backlog drain audit — 2026-10-28 (delegate, read-only)

**Case:** `docs/NEXT.md` named one un-done step before M5 can be costed — "the audit that makes the milestone
actionable": `docs/runbooks/stale-held-backlog.md` Diagnose steps 2–4, i.e. *which held rows have gates that
already cleared*. This file is that audit. It changes two numbers the current pointer asserts, and it prices the
`drain first` option that is one of the four rulings the operator owes (D141).

**Scope and hygiene.** Read-only against the store and the repo. The delegate claimed, completed, deferred,
released, routed, sent or transitioned **nothing**; released rows are `pm`'s transitions (runbook §Do). No
writing verb (`up`/`worktree`/`run`/`send`/`complete`) was run, so no worktree/branch diff-after was owed — the
pre-inventory is `.spike/delegate/inventory-pre-20261028.txt` (1 worktree = `/home/chexxor/Git/Durian-Pi`, 1
branch = `main`, `.spike` = 37 entries).

**Machine (named, per D131):** native Linux, `Linux Alex-Desktop-Win10 7.2.11-200.fc44.x86_64`, git 2.56.0.
Repo state at measurement: `main` = `0159af9`.

## 1. Baseline re-measured (so the audit sits on a known-good rig)

| Command | Result |
|---|---|
| `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` | `pass: true`, **62 findings** — `duplicate-item` 54, `citation-unresolvable` 5, `single-model-rig` 1, `verification-without-evidence` 1, `evidence-tree` 1; 0 errors |
| `node scripts/test.mjs` | **238/238 in 41.9 s** |
| `DURIG_DB=./selfdev.sqlite node cli.mjs status` | broker `{state: down, reason: "no broker state"}`; attention = 5 seats `deferred_awaiting_answer` (#4813 pm, #4354 impl, #4816 lead, #4817 devtools, #4814 qa2) |
| `node scripts/clockin.mjs` | 111 lines, under the 200-line pointer cap |

Identical to the D141 baseline — nothing in the rig moved between sessions.

## 2. Queue state (the canonical read)

`DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/delegate/queue-audit.json` → **4,818 subjects**:
`done` 3,748 · `cancelled` 777 · `held` **274** · `deferred` **19** · `queued` **0** · `claimed` **0**.

Still true, and still the point: the team is not idle because work finished. It is idle because nothing is
releasable, and 274 rows sit in a state no `status`/`attention` line flags as stale.

## 3. Orphan candidates (runbook Diagnose step 2, the §7 script verbatim)

`docs/WORK-ITEM-LIFECYCLE.md` §7's classifier, run against the fresh snapshot:

- **134** of 274 held rows carry gate-ish prose (`GATED | release when | gated on | SEQUENCE AFTER | behind | prerequisite`);
- **67** of those cite *only* gates that are already terminal (`done`/`cancelled`) — the orphan candidates;
- **12** of the 67 cite **no resolvable queue id at all** (prose gates pointing at nothing — runbook "If it fails", treat as `manual` for `pm`);
- by recipient: `impl` 47, `devtools` 6, `qa` 6, `lead` 3, `auditor` 2, `scribe` 2, `pm` 1.

**Read as a lead, not proof** (§7's own warning), and the sampling confirms why: of seven candidates read in
full, #2636/#3535 are landing entries whose gate cleared, while #994 is legitimately gated on an
**operator-declared quiet window** and #2217 on machine capacity — both cite terminal items incidentally.

## 4. The finding that matters: 70 held rows are bookkeeping for work that already landed

Landing entries are the one family where the row's whole purpose *is* the sha. So ask the sha directly.
Regex `\bLANDING (LIST|ENTRY)\b` on the subject; for every hex token ≥ 7 in subject+body, ask
`git cat-file -e <sha>^{commit}` and `git merge-base --is-ancestor <sha> main`:

| held LANDING rows | count |
|---|---:|
| total | **86** |
| **every cited sha is already an ancestor of `main`** — the landing they exist to record has happened | **70** |
| some cited shas on `main`, some not | 10 |
| cites no sha | 1 (#3673) |
| no cited sha on `main` (unlanded or unresolvable) | 5 |

The 70: 2149, 2226, 2385, 2466, 2476, 2513, 2571, 2591, 2592, 2636, 2637, 2778, 2841, 2993, 3039, 3103, 3120,
3350, 3377, 3430, 3456, 3535, 3607, 3663, 3686, 3699, 3786, 3808, 3822, 3828, 3830, 3841, 3864, 3891, 3934,
3940, 3993, 4025, 4031, 4035, 4039, 4041, 4060, 4084, 4102, 4119, 4123, 4136, 4142, 4151, 4154, 4157, 4168,
4169, 4210, 4230, 4259, 4344, 4364, 4460, 4471, 4513, 4524, 4539, 4540, 4544, 4547, 4595, 4602, 4698.

**26 % of the held backlog is closable with zero build work** — `pm` needs no model, no GPU and no seat turn
beyond a bookkeeping pass. (A looser family, "subject contains LANDING", gives 105 rows, 76 fully landed; the
86/70 pair is the defensible number because the regex is the row's own declared type.)

Wider bucketing over all 274 (loose hex scan, ≥ 7 chars, must contain a letter):

| | rows |
|---|---:|
| every cited sha resolves **and** is on `main` (stale bookkeeping candidate) | 117 |
| every cited sha resolves, none on `main` (a real landing decision) | 5 — #1724, #3452, #3601, #3832, #3842 |
| **some cited sha does not resolve in this repo** | **38** |
| cites no sha (gated on prose / other rows) | 114 |

## 5. Corrected number: 30 unresolvable shas across 38 held rows — and 24 of them are recoverable

`docs/NEXT.md` (D141) asserted: *"of 103 distinct shas `git cat-file --batch-check` resolves 95, `missing` for 8
… so 8 held rows cannot be released, only re-derived or cancelled."* **That is under-scoped by roughly 4×.**
Measured now, two ways:

- strict landing convention `@([0-9a-f]{7,40})`: 132 rows, **135** distinct shas, 120 resolve, **15 missing**;
- loose hex convention (≥ 7 hex, must contain a letter): 160 rows, **237** distinct, 207 resolve, **30 missing**
  across **38 held rows**: 1468, 1522, 1779–1782, 1786, 1788, 1957, 2284, 2399, 2667, 2718, 2804, 2823, 2927,
  3070, 3075, 3112, 3235, 3267, 3272, 3284, 3410, 3460, 3506, 3518, 3552, 3556, 3557, 3575, 3603, 3726, 3743,
  3831, 3877, 4053, 4090.

The D141 figure is not wrong arithmetic; it sampled a narrower citation pattern. This is the recurring lesson
of D136/D138/D140: **a count is only as wide as the regex that found it, so publish the regex with the count.**

**The recoverability result — and it is the opposite of "cannot be released".** The rig has a second remote:
`win → /run/media/chexxor/0094126294125A8C/Users/Alex/dsh-Projects/pi-opendurig` (the Windows box's repo,
currently mounted). Read it directly, read-only, with `git --git-dir=<win>/.git cat-file -t <sha>`:

- **24 of the 30** unresolvable shas **exist as commit objects in the Windows store** — e.g. `fd4c233` = "docs(decisions):
  record D113 — control-plane spool ops are OPERATOR-ONLY", `1d45af6` = "fix(rig): idempotent enqueue by tool-call id
  + send-side duplicate guard (#3192)", `d1516a6` = the D103 root-pointer rename, `e29ddb8` = a dropped **stash** commit
  ("On main: delegate: park devtools #2969 exact-pin WIP for 2026-10-19f landing", parents `abda45b2 dee132ae`).
- **but they are reachable from no ref there**: `git --git-dir=<win>/.git branch -a --contains <sha>` is **empty** for
  every one, and `.git/logs/` mentions only `e29ddb8`. They are **dangling**.
- **Therefore `git fetch win` will NOT recover them.** Fetch transfers objects reachable from advertised refs;
  these are reachable from none. Recovery requires making them reachable first — `git --git-dir=<win>/.git
  update-ref refs/recovered/<sha> <sha>` then fetch — which is a **write to the Windows repo**, so it is an
  operator grant or a seat task, not a delegate action.
- **That recovery path already exists and has worked here.** This repo carries `refs/recovered/53fd8c6f8…`,
  `…/bcf1a191c…`, `…/be40620c9…`, `…/dd2583b12…` — four dangling commits pinned by exactly that convention
  (subjects: incident-report class enforcement #1609; incident age band #1727; `fix(land): await the --suite
  gate` #3652; the compaction-eval harness #1087). Those four are precisely why the 5 rows in §4's
  "real landing decision" bucket still resolve.
- **6 are in neither store:** `0c6fd7665`, `5d8c6237a`, `c04cfac`, `cfb4457`, `e8fdab6`, `eb7e69c1e`. Only
  GitHub `origin` could hold them; **unverified** — no fetch/push was run (no grant, and `git ls-remote origin`
  was not attempted). `cfb4457` is the most expensive loss: six rows cite it (1779, 1780, 1781, 1782, 1786, 1788).

## 6. The sync finding this audit fell out of

`origin/main` = `refs/remotes/win/main` = `b4c86ea`; local `main` = `0159af9`, **33 commits ahead of origin, 0
behind**, and the Windows store does not contain `0159af9` at all. So the record is currently split across two
machines:

- **33 commits of durian-pi's own history exist only on this Linux box** (unpushed — the operator holds the
  push grant, `AGENTS.md` non-negotiables);
- **24 commits that 24 held rows cite as evidence exist only on the Windows drive, and unreachable there.**

Nothing about this is a fault in the rig; it is what a workspace move costs when evidence is a git sha. It is
direct evidence for **D133** (cite `entries.id`, not a sha, as durable evidence) and for M5's substrate half:
a queue that pins its gates on object-store positions has no durable truth layer under it.

## 7. What this does and does not decide

**Supports the `drain first` option's cheapness:** 70 provably-landed rows + 67 orphan candidates is a
bookkeeping pass, not a build, and it is the only capacity in the rig that costs no GPU and no model choice.

**Refutes one stated blocker:** "8 held rows cannot be released, only re-derived or cancelled" — 38 rows cite
an unresolvable sha, 24 of those shas are recoverable with a `refs/recovered/*` pin on the Windows repo, and
only 6 shas are absent from both stores. ROADMAP 190's live-side scope should be re-stated as **30 shas / 38
rows / 2 stores**, not 8 / 8 / 1.

**Does not authorize anything.** The delegate did not release, cancel or re-derive a row, did not write to the
Windows repo, did not fetch, and did not spool an intent — the broker is down, so a spool cannot be confirmed
delivered (runbook §Verify). The routing facts are staged, unspooled, in
`.spike/delegate/pm-intent-held-drain.md`.

**Does not license treating `all-cited-landed` as proof outside the LANDING family.** Of the 117, the 70
LANDING rows are provable by their own declared type; the other 47 need their body read first (#994 and #2217
in that bucket are legitimately held on operator/machine conditions, not on a sha).

## 8. Commands to reproduce

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs queue > .spike/delegate/queue-audit.json
# §3: WORK-ITEM-LIFECYCLE.md §7 classifier (use json.JSONDecoder().raw_decode — the CLI appends a note line)
# §4: subject regex \bLANDING (LIST|ENTRY)\b + git cat-file -e <sha>^{commit} + git merge-base --is-ancestor <sha> main
# §5: loose regex  \b(?=[0-9a-f]{7,40}\b)(?=[0-9]*[a-f])[0-9a-f]{7,40}\b
#     git cat-file --batch-check           (this repo)
#     git --git-dir=/run/media/chexxor/0094126294125A8C/Users/Alex/dsh-Projects/pi-opendurig/.git cat-file -t <sha>
#     git --git-dir=<same-win-repo>/.git branch -a --contains <sha>   → empty for all 24
```

Machine-readable sidecars: `.spike/delegate/held-sha-unresolvable.json` (30 shas → citing rows),
`.spike/delegate/held-sha-reach.json` (missing + unlanded sets),
`.spike/delegate/inventory-pre-20261028.txt` (worktree/branch/scratch inventory).

## 9. Same-session reconciliation with the rig's OWN citation instrument (and a defect in it)

§5 published counts from two ad-hoc regexes. The repo ships the instrument for this job —
`src/citation.mjs`, wired into `check` as `citation-unresolvable` — so the honest move is to run it and
reconcile rather than to keep a private number. Run over the same 4,818-row snapshot:

| extractor | distinct citations | unresolvable | rows affected | **non-terminal rows** |
|---|---:|---:|---:|---:|
| shipped `CITED = /\b[0-9a-f]{8,40}\b/` (+ must carry a digit **and** a letter) | 178 | 73 | 218 | **4** — #3506, #3603, #3743 (held), #4378 (deferred) |
| same rule, lower bound **7** | 1,048 | 213 | 957 | **39** — the 38 held rows of §5 **plus #4378** |

**The finding this exposes is a defect in item 190's built half, not in §5.** `{8,40}` is **blind to every
7-char citation**, and 7 chars is git's default short-sha abbreviation — which is exactly what this rig's
landing convention writes (`impl-item-2356 @02f1a36`-style entries, and 140 of the 213 unresolvable shas at
`{7,40}` are 7-char). So the detector that exists to protect the live queue under-reports the population it
exists to protect by roughly **10×** (4 → 39 non-terminal rows), and `docs/ROADMAP.md` 190's "4 non-terminal
rows + a 308-row terminal baseline" is the sound of that blindness, not a clean bill of health. The 5-char
floor is a real cost (a 7-char token has ~1 in 16 chance of resolving spuriously as an abbreviation of a
different object), so the fix is the lower bound **plus** an ambiguity check, not just `{7,40}`. Machine
sidecar: `.spike/delegate/citation-lowerbound-compare.json`. §5's 30/38 is confirmed as the right magnitude:
`{7,40}` yields 39 non-terminal rows = my 38 held + #4378.

**Method correction to §5 of this same file.** §5 proved "reachable from no ref" with
`git --git-dir=<win>/.git branch -a --contains <sha>`. That is the **wrong probe**: `branch -a` walks only
`refs/heads` and `refs/remotes`, so it cannot see the namespaces this very rig uses for recovery —
`refs/recovered/*` (local) and `refs/archived/*` (the Windows side's 13 commits on no ref, per commit
`4a38a13`). Re-proved properly, over **every** ref tip in the Windows store
(`git --git-dir=<win>/.git rev-list $(for-each-ref --format=%(objectname))` → 1,556 reachable objects):
the win repo has 32 `refs/heads` + 9 `refs/remotes/origin` + HEAD and **no `refs/archived/*`**; **all 24 are
genuinely dangling**, and the remaining 6 are not commit objects there at all. The conclusion stands; the
evidence for it is now the kind that survives the namespace question.

**"Neither store" ≠ "work lost", and the repo already says so.** `src/citation.mjs`'s own header states the
rule cannot tell a **stale pointer** from **lost work**: its worked example is #3743/#4378 citing
`0c6fd7665`, which matches no object while the landing is `0c6fd76e465…` and the change **is** on `main`. So
the 6 shas absent from both stores (`0c6fd7665 5d8c6237a c04cfac cfb4457 e8fdab6 eb7e69c1e`) are candidates
for typo/stale-pointer, and only patch-equivalence decides (`git log -S`, `--grep='#<id>'`, `git patch-id`).
Probed that way: #3506, #3603, #3726, #3743, #4378 return commits, but every hit is the *citation-rule*
commit `6a8180b` or a runbook commit **about the defect**, not the original landing — so those probes do not
clear them. For the `cfb4457` family (#1779–1782, 1786, 1788) `--grep` returns **0** commits. And #4804
(deferred → impl) is the team's own row about this: "THE NINE SHAS ARE NOT REACHABLE — qa2 measured that
`refs/heads/archived/` does not contain …". Route the six to that row rather than opening a seventh.
