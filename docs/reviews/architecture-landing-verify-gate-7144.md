# The landing gate cannot be bound to a sha that nobody writes down (#7144 / build #7143)

Architect review, 2026-11-12. Tree: branch `item-7144`; `@earendil-works/pi-durable` **1.3.0** from this
worktree's lockfile (seat root 1.5.1 - not comparable). Host: Linux, kernel `7.2.15-300.fc45.x86_64`,
Fedora 45, node v24.22.1, git 2.56.0.

Instrument: `node tools/probes/landing-verify-tip-7144.mjs --db ../selfdev.sqlite` → **exit 0** (it
measures the gap; the falsifier inside it is "not one unlanded branch has a DONE VERIFY row naming it").

## What the gate is today (read, not assumed)

`src/landinggate.mjs` (106 lines) composes the decision from **argv + changedPaths + suite exit** only:
`parseGateFlags`, `requireGate`, `docsOnlyAttestation`. It mentions verify/evidence **zero times**.
`scripts/land.mjs` mentions the words 7 times, none of them a check: the closest is a worktree-name
regex at :340 and a demo filename at :814. `requireGate` runs at land.mjs:410 - before any git write -
and `report()` exits, so a refusal cannot fall through. That ordering is right and must be preserved.

The raw material exists: `complete_work` stores `item.evidence = {command, exitCode, artifact}`
(src/rig.mjs:1111-1116) and `src/checkup.mjs:111-118` already has rules
`verification-without-evidence` and `evidence-tree`.

## The measured blocker: the sha the gate wants is not written down by anyone but the author

Live store, 7283 rows read through `node cli.mjs queue --json --no-body` (DURIG_DB=./selfdev.sqlite):

| measurement | value |
|---|---|
| unlanded `item-*` branches | **102** |
| of those, tip sha named by SOME done row's subject or evidence artifact | **100** |
| of those naming rows, subject says VERIFY | **9** |
| of those naming rows, the author's own completion | **91** |
| unlanded branches with a DONE VERIFY-subject row naming the branch | **2** |
| VERIFY-subject rows total / done / done-with-evidence | 1113 / 787 / 351 |

So a gate that *requires* a verify row naming the literal sha would refuse **100 of 102** pending
landings. pm's row is not wrong about the goal; it is wrong about the readiness of the data, and the
number is checkable before anyone builds it.

## F1 - "a verify row" that the author writes is not verification

91 of the 100 sha-naming rows are the author's own `complete_work`. Accepting them makes the gate a
restatement of the defect it exists to close - it is the same shape as the landing gate before #6090,
where the only thing between an unproven landing and main was whether someone remembered a flag. The
rule in that module's own header is the one to apply here: *a cheap or optional signal may accept, it
may not decide* (#3575).

**Concrete fix:** a row counts only if (a) `status === "done"`, (b) its `from` seat is **not** the seat
that authored the branch's item, (c) `evidence.exitCode === 0`, and (d) its artifact names the sha being
advanced or the branch, with the tree named. Otherwise the report line says
`self-attested by <seat> as <row id>` - visible, not decisive.

## F2 - the sha main advances to is not the sha any verify row names

`scripts/land.mjs:1038-1040`: main is fast-forwarded to `scratchHead` - the head of a **scratch merge
tree** built for multi-branch landings (the #4247-era design: merges happen in a detached scratch worktree
so the shared tree is never mid-merge). For a two-branch landing pass, `scratchHead` is a merge commit
that **no seat ever verified**: the verify row names the branch tip, and the thing that lands is a
derived object. A literal-sha equality test is therefore unpassable *by construction* for multi-branch
passes.

**Concrete fix:** the gate's key is the set of **parents**. Require each named branch tip to have an
independent verify row, and require the merged tree to pass the suite (the gate already does this via
`--suite`/`--changed-suite`). This is the same rule `complete_work` now states: a DERIVED artifact must
be named as MERGED. The refusal text must print both: `verified parents: <sha per branch>; advancing
main to <scratchHead>, which is derived from them`.

## F3 - two rules meet here and one must win

pm's row correctly flags the collision: #5681 says compare literal shas, not ancestry; lead's #3337
amended the tip-drift abort to compare per-file **content** with ancestry as a fast path only. They are
not compatible as written. The decisive rule, stated once:

- verify row names `S`; landing advances to `T`.
- **PASS** if `S == T`.
- **PASS** if `S` is an ancestor of `T` **and** the content of every file the verify row's command
  touched is identical at `T` (the rebase case).
- **REFUSE** if `S` is not an ancestor of `T`, or the content differs - the verification is about a
  different tree than the one landing.

Ancestry alone is never the decision; it is the fast path that decides *which* content comparison to run.

## F4 - the gate reads the store; say which seam and fail which way

`land.mjs` resolves the store path (scripts/land.mjs:264) only for the genlock pre-flight today. A verify
gate needs queue rows. **Concrete fix:** read through the existing read seam (`cli.mjs queue --json`,
which land.mjs can shell out to) rather than opening the sqlite a second time - the single-writer rule
(D42) is about writes, but a second reader is still a seam that must be named, and the read seam already
exists.

Then choose the failure direction explicitly. `requireGate` fails closed: no gate flag means no advance.
The `sharedRoot` check at :277-293 deliberately fails **open** on unreadable output ("a wrong refusal
blocks every legitimate landing"). For this gate, fail-open means an unverified landing gets through
silently - precisely the failure the row is meant to close. Recommend **fail closed with the remediation
named** ("could not read the queue: mint a verify row naming <sha> and re-run"), and put the fact that
the store was unreadable in the JSON report so the landing is attributable.

## F5 - phasing, or the gate manufactures fake verification

Refusing on absence today = 100/102 refusals. The predictable response is to mint a VERIFY row per
landing entry with no verification behind it - a Goodhart failure worse than the one being closed. So:

- **Now:** refuse on **contradiction** (a verify row exists and its sha/content does not match the tree
  landing), and *report* the absence: `no independent verify row names <sha>; self-attested by <seat>`.
- **After** the report line has been read for a week and landing entries routinely carry a verify row:
  promote absence to a refusal, and only for code-tier landings. Docs-only keeps the diff-checked
  attestation (`docsOnlyAttestation` already verifies the claim against the diff).
- The promotion is a ratchet, so it needs the reversibility the ratchet pattern requires (#1780): the
  refusal is a named flag an operator can override, and the override is printed in the report.

## Failure modes at this seam

| failure | mechanism | recovery |
|---|---|---|
| rig stalls | gate demands a row that does not exist (100/102 measured) | phase: contradiction first, absence reported; promote only after the habit exists |
| self-attestation | author's own done row satisfies the rule (91/100) | require `from !== author seat` and exitCode 0 |
| derived tree | main advances to a scratch merge commit nobody verified (:1038-1040) | gate keys on parents; merged tree must pass the suite |
| sha drift | rebase moves the tip after verification | content comparison decides; ancestry is the fast path (#3337) |
| unreadable store | gate silently skips | fail closed, name the remediation, record it in the report |
| ordering | refusal after a partial advance | run the check where `requireGate` runs (:410), before any git write |
| gate inside a script | like D289, land.mjs's own logic guards only the sanctioned path | the tripwire (D289) covers writes that bypass land.mjs |

## Options weighed
- **(A) Strict sha-presence refusal now.** Rejected: measured 100/102 refusals, and it incentivizes
  minting empty verify rows.
- **(B) Contradiction-first, absence reported, then ratchet to refusal.** Chosen: reversible, legible,
  and it cannot be gamed by absence.
- **(C) Let the machine verify entirely (suite only, no row).** Rejected as sole control: the suite proves
  the demos pass, not that a second seat looked at the change; the two are different guarantees and the
  rig has paid for confusing them before.

## Not my decision
Whether the ratchet promotion date is set now or after the report line is read - that is pm's sequencing
and lead's scope call. I changed no broker or land.mjs code.
