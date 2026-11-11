# Review: #6519 - the authority-before-state class, and the gate that is supposed to keep it closed

**Tree:** branch `item-6517`, HEAD `560db92e`. **Read as:** review of pm's scope widening of #6511 and of the minted standing gate #6518. No implementation was done here.

## The class is correctly scoped

Five verbs reach an authority-only refusal before they know the row's state - `defer_work`, `resume_work`, `hold_work`, `revise_work`, `cancel_work` - measured by `node tools/probes/verb-ordering.mjs` (exit 1, 6 problems). Folding them into one row (#6511) is right: it is one invariant, one commit, and the failure it prevents is the one #5778 already documented - a coordinator reads "item #N is addressed to impl (from lead)" for a **done** row and reports closed work as parked.

Keeping #6634-style "who may act" separate from "check order" is also right: they are different contracts and merging them would make one commit answer two questions.

## Defect 1 - the gate cannot see the authority check in the verb it cites as the model

**Evidence.** The gate's detector is `/\b(it|item)\.to !== me|\b(it|item)\.from !== me/`. Run at HEAD:

```
release_work authority lines matched by the gate regex: 0 []
actual party check in release_work:
  'const isParty = item.to === me || item.from === me;'
  'if (!isParty && !coordinating)'
  'if (!isParty && !reason)'
```

`release_work` is reported `PASS - no authority refusal`. It **has** one. It is safe today only because `isTerminalItem` precedes it (`src/rig.mjs:1318` before `:1337`).

**Failure mode.** Silent. Move the party check above the terminal check and the gate reports GREEN - the exact regression #5778 fixed, in the verb the gate names as the reference.
**Fix.** Widen the detector to the shapes that actually appear: `isParty`, `!isParty`, `coordinating`, and any `const isParty = ...` binding, and treat a refusal that *names the row's status in the message* as state-establishing. A gate that detects one spelling is a gate that polices one spelling, not one invariant.

## Defect 2 - the fix that closes the class blinds the gate

**Evidence.** The probe slices bodies by `name: "<verb>_work"` and never reads a shared helper. `grep admitRow src/rig.mjs` is currently empty, but the fix pm adopted for #6510/#6511 is a shared `admitRow(item, me, verb)` helper. Once the authority check lives in the helper, each verb body contains no authority line, so the loop prints `PASS ... no authority refusal` for all five.
**Failure mode.** Cascade: the gate goes green *because* the fix landed, and thereafter any re-inline that restores the wrong order is invisible - the standing gate becomes a one-off test wearing a standing gate's clothes.
**Fix.** The gate must scan the helper too (slice from `function admitRow` as a pseudo-verb), and the assertion set must include the case "authority check exists somewhere on this code path". Better still, make it behavioural rather than textual: for each verb, feed a **terminal row addressed to someone else** and assert the refusal names the status (`already done (terminal)`) rather than the owner. Text order is a proxy; the refusal string is the contract.

## Defect 3 - the gate reads the file from `process.cwd()`

**Evidence.** `tools/probes/verb-ordering.mjs:21`: `readFileSync(join(process.cwd(), "src/rig.mjs"))`. Landing and verify passes run in scratch worktrees whose cwd is not the repo root.
**Failure mode.** Either ENOENT (loud, recoverable) or, worse, a green from a *different* tree than the one being verified. A gate's verdict must name the tree it read.
**Fix.** `readFileSync(new URL("../../../src/rig.mjs", import.meta.url))` - the pattern the other probes in `tools/probes/` already use - and print the sha it read.

## Defect 4 - the routing's line citations are stale at HEAD

**Evidence.** pm cites defer `:1111/:1113`, resume `:1200/:1202`, hold `:1233`, revise `:1314`, cancel `:1362`, release `:1275/:1277`. At `560db92e` the verbs start at `:829` claim, `:993` complete, `:1125` defer, `:1224` resume, `:1251` hold, `:1293` release, `:1373` revise, `:1423` cancel.
**Fix.** Cite the verb and the invariant, never a line number (pitfall 262: every land merge drifts the citations). This is the third stale-citation instance in this tranche; it is a routing discipline, not a code bug.

## Failure taxonomy

| Class | Here | Recovery |
|---|---|---|
| Silent | gate reports PASS while an authority check exists | widen the detector to the real spellings |
| Cascade | helper extraction makes every verb look safe | scan the helper; assert behaviour, not text |
| Partial | gate reads the wrong tree via cwd | pin the path to `import.meta.url`, print the sha |
| Contradiction | routing cites lines that do not exist at HEAD | cite verbs, not lines |

## Decision

Folded into the existing D265 ADR in `docs/DECISIONS.md`: a standing gate is only as good as its detector's coverage, and a textual gate must be paired with a behavioural assertion on the refusal string. The concrete ask on #6518 is: widen the detector, scan the helper, pin the file path, and add one behavioural fixture per verb.
