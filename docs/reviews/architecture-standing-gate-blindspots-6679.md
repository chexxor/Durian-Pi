# Review: the standing gate can print PASS for a tree with no standing check (#6679 / #6518)

**Question.** pm amended #6518 with three blind spots in the gate that is supposed to close the authority-before-state class, and set acceptance as `node tools/probes/gate-detector-coverage.mjs` exiting 0. Are the three real, and is the acceptance criterion the right shape?

**Run.** `node tools/probes/detector-blindspots-6679.mjs` → exit 1, six blind spots, branch `item-6679` at HEAD `35001c3a`, pi-durable 1.3.0 from the lockfile. The probe does not argue: it builds synthetic trees from the real `src/rig.mjs`, runs the **real** gates (`tools/probes/verb-ordering.mjs`, `tools/probes/authority-symmetry.mjs`) as child processes against each tree, and reports what they print. Every sha below is the sha of the bytes the gate actually read.

## Measured

| # | Claim | Measurement |
|---|---|---|
| 1 | The detector pattern misses `release_work`'s authority test | `verb-ordering.mjs` on the real tree prints `PASS release_work — no authority refusal`. The verb contains **4 `isParty` references** and **0** matches for `/\b(it|item)\.to !== me|\b(it|item)\.from !== me/`. The gate's model verb is invisible to it. |
| 2 | Slicing bodies at `name: "<verb>_work"` blinds the gate once the rule moves to a helper | Synthetic tree where each verb calls `admitRow(item, me, verb)` and the rule lives in a top-level helper: `verb-ordering.mjs` prints **8 verb verdicts PASS, 0 FAIL**; `authority-symmetry.mjs` reports **6 verbs with "none found"**. The helper is never scanned. |
| 3 | Absence reads as satisfaction | Synthetic tree with **every** ownership check deleted (authority lines: 0, sha `da8ee810faa7`): `verb-ordering.mjs` prints **8 PASS / 0 FAIL** verb verdicts. Its overall exit is still 1 — but only because of an unrelated assertion about `claim_work`'s by-id message. The authority class itself reports clean. |
| 4 | The gate reads through `process.cwd()` | `verb-ordering.mjs:20` — `readFileSync(join(process.cwd(), "src/rig.mjs"))`. Run with a different cwd it read sha `da8ee810faa7` while the probe's own tree is `970ec9980e0a`, and it prints **no tree identity**. |
| 5 | Stale pointers in the rows | pm's cited line numbers (1111, 1200, 1233, 1314, 1362, 1275) are stale; the verbs start at **1125, 1224, 1251, 1373, 1423, 1293** at this HEAD. pm's corrected list matches measurement exactly. |
| 6 | **Not in pm's list:** the gate's verb set is a literal, and it already omits the mint path | Both gates print verdicts for **8** verbs; `src/rig.mjs` declares **9**. `send_work` is never examined — the verb where `blockedBy` is created and where #6673's standing rule must fire. |

## The defect, named

**The gate passes on absence.** `verb-ordering.mjs:41` — `if (authLine < 0) { console.log("PASS ... no authority refusal"); continue; }`. That line is the whole problem: a rule about *ordering* is certified by the *non-existence* of the thing being ordered. Delete the ownership check and the verdict improves. Any gate whose PASS condition can be satisfied by removing code is not a gate; it is a pattern counter that likes silence.

Three consequences follow, and pm's amendment names two of them but not the inversion itself:
- moving the rule into `admitRow` (which is the right fix, D275) makes **every verb look clean** under the current slicing, so the fix that closes the class also disables the check that keeps it closed;
- the gate covers verbs by name, so a verb added later — or the mint verb it never listed — is outside the class by construction;
- the gate's own remediation text points at a line number, and seats follow pointers.

## The contract a class-closing gate must satisfy

**Two layers, one pass criterion.**

1. **Behavioural assertions are the proof.** For each verb × each admission step (existence, terminality, authority, applicability) run the real tool against a real row in that condition and assert the **class** of the refusal — a token the probe matches (`terminal`, `not-a-party`, `wrong-status`, `unknown-item`), never the sentence. pm's "feed a terminal row addressed to someone else" is one cell of a 4×9 table; one cell per verb is not enough, because the ordering *is* the defect and ordering is only observable across cells.
2. **A static scan is a lint, not a proof.** It answers "is the rule in the right place in every verb", and it must:
   - **derive its verb set from the source it scans** (`name: "<verb>_work"` is already enumerated by the slicer; use it, don't restate it);
   - **treat the shared helper as a pseudo-verb**: a verb passes only if its body contains a call to `admitRow(` **and** the helper body contains the four steps in order. `admitRow` is scanned as a body, not skipped;
   - **fail closed on absence**: a verb with neither an inline authority check nor a call to the helper is FAIL, not PASS;
   - **name the tree it certified**: read via `new URL("../../src/rig.mjs", import.meta.url)`, print the sha of the bytes read, and exit 1 if the sha is not the sha of the tree the caller claims to be verifying.

**No line numbers in fix text.** Cite the verb name. Line numbers drift within a day at this commit rate, and a wrong pointer is a seat sent to the wrong verb.

## Failure modes at this seam, with the recovery path

| mode | what happens | recovery |
|---|---|---|
| silent | ownership checks deleted → every verb PASS | fail-closed scan: presence is required; behavioural cell for "not a party" refuses |
| cascade | the fix moves the rule to a helper, the scan goes blind, and the next regression lands unnoticed | helper-as-pseudo-verb + every verb must call it; the probe asserts the call sites |
| contradiction | two gates (ordering, symmetry) classify the same verb differently and both are cited as authority | one shared slicer, one verb set, one classification function; the probe runs both and reports the disagreement |
| loop | the gate is run, fails, gets "fixed" by deleting the pattern | the gate's own test: the no-authority tree must be RED. If a tree with no checks passes, the fix is the tree, not the gate |
| context | gate output grows with per-verb, per-step assertions | assert classes (tokens), not sentences; print one line per cell |
| provenance | a verify pass in a scratch worktree certifies whichever file its cwd resolves to | read from `import.meta.url`, print the sha, and require the sha to match the tree named in the completion evidence |
| trigger | the gate exists but nobody runs it — `grep probes src/checkup.mjs` finds nothing; `check` does not run probes | put the behavioural layer in the demo suite (`npm run demo` runs `demo/offline.mjs`), which the fleet already treats as the oracle, and keep the static scan in `tools/probes/`. Whether to wire the scan into `check` as a rule is a scope call for **lead** |

## Options and the trade-off

- **(a) Amend the regex to also match `isParty`.** Cheapest; fails the moment the rule moves to a helper or a new verb appears. It patches the symptom measured in row 1.
- **(b) Behavioural assertions as the criterion, static scan as a lint, with the four scan rules above.** Chosen. Cost: the probe spawns a harness and runs ~36 faux turns, which is slower than a regex and needs the lockfile-matched tree. Accepted, because the guarantee being bought is "no verb can refuse on ownership before it knows the row's state", and that guarantee is only observable in behaviour.
- **(c) Drop the static gate entirely, keep only behaviour.** Rejected: the scan is what catches the ordering regression in a verb nobody exercised this week, and it is cheap.

Trade-off stated: the gate becomes slower and stricter, and it will RED on trees that today read clean (the helper-moved tree, the no-authority tree, the 9-verb tree). That is the point — those trees are the failure the class gate exists to catch.

## What acceptance should be

`node tools/probes/gate-detector-coverage.mjs` exiting 0 is the right acceptance form **only if** the probe contains the three adversarial trees this review measured: authority-deleted must be RED, helper-moved must be RED, and the verb set must be derived from the source. A probe that merely asserts the current verbs pass certifies the patch, not the class. Until those trees are in it, the gate is a golden, not a gate.
