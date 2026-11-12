# Landing verification: `item-4977` @ `5d65d59c` — the broker preflight asks the registry, not vendored text

**Verifier:** `scribe`, item #6792 (not the author; the branch was written by devtools).
**Date:** 2026-11-12. **Every number below names its tree and its dependency plane.**

## 1. Was it landed, and what is on main

| Question | Measurement | Exit |
|---|---|---|
| Is the tip reachable? | `git merge-base --is-ancestor 5d65d59c main` → true | 0 |
| Is the fix's CONTENT on main? | `git rev-parse main:demo/broker-serve-shell-availability.test.mjs` = `81b8d42d…`; the branch tip blob is `de87e124…` — **different**, because main moved on (the demo was amended by #4995, "the anti-vacuity control is pinned to a frozen fixture, not to a moving ref", `e04ef32c`) | 0 |
| Do the three corrected doc rows still exist? | `tools/README.md:25,29`, `docs/runbooks/hygiene-and-dead-model-pointers.md:69,172`, `docs/runbooks/session-start-cost.md:116` all carry the registry-based wording | 0 |
| Which tree was verified? | a detached scratch created inside the item worktree: `git worktree add --detach .main-check main`, `git rev-parse HEAD` = `fb20ca2477ff9be09fa0d070b256af2de33bbb10` | 0 |

Ancestry here agrees with content, so it is a fast path, not the verdict (#3272/#3337): the blob check is what says the merged tree carries the fix.

## 2. The merged-tree legs, on the PINED plane

Scratch at main `fb20ca24`, `node_modules` symlinked to the seat root's (`@earendil-works/pi-durable` **1.5.1**, a symlink into `vendor/pi-main/packages/durable`; `./codemode` present in its export map):

| Command | Result | Exit |
|---|---|---|
| `node demo/broker-serve-shell-availability.test.mjs` | `PASS` (both host directions pinned on injected hosts) | **0** |
| `node tools/broker-serve.mjs --status --no-probe` | `NOTE seat-shell-availability: the seat shell tool "bash" CAN start on linux — /usr/bin/bash`, with the per-candidate truth spelled out (`bash … CAN start [preferred on this host] \| powershell … WITHHELD on linux — RM-306`); the only BLOCK in that run is `store-missing: ./rig.sqlite does not exist` | **0** |
| `node scripts/test.mjs --area guard` | **29/29** in 9.4 s | **0** |
| `node scripts/test.mjs --area check` | **13/13** in 3.9 s | **0** |
| `node scripts/test.mjs --area docs` | **7/7** in 43.6 s | **0** |
| `node demo/test-areas.test.mjs` | **311 tests across 9 areas**, 0 ghosts; `demo/broker-serve-shell-availability.test.mjs` is mapped in the `broker` area (77 demos) | **0** |

Two figures in the routing row are stale: the suite is **311 tests in 9 areas**, not 245; and the `deepinfra-catalog` red **did not reproduce** here — it ran green in 0.6 s inside the docs area. It is not reported here as a pre-existing red, because on this tree and plane it is not red.

## 3. The same merged tree on the LOCKFILE plane — the red is the plane, not the code

Same scratch at the same `fb20ca24`, `node_modules` resolving to the lockfile's released `@earendil-works/pi-durable` **1.3.0** (`sync-pi --link` fails in an item worktree because `vendor/pi-main` is not built there):

| Command | Result | Exit |
|---|---|---|
| `node scripts/test.mjs --area guard` | **28/29**; `demo/guard.test.mjs` fails 13 checks ("the trigger detected the runaway turn — null", "HALT succeeded", "the conversation is still readable through the single harness") | **1** |
| `node demo/guard.test.mjs` run alone, same tree, pinned plane | `PASS — a run that degrades in flight is detected, halted, and resolved; the item survives` | **0** |

One file, one tree, two planes, opposite verdicts. That is the cleanest demonstration in the rig of the rule the verify row states: a suite number from an unlinked worktree is a statement about the plane, not about `main`. It is **not** evidence of a guard defect.

## 4. One doc claim the verification contradicts

`docs/runbooks/hygiene-and-dead-model-pointers.md:172` still says the BLOCK "still does [appear]" at `43e26dcc` "because the fix is unlanded". The fix **is** landed (merge `e2f85719`, "merge: land item-4977 onto main"), and on main today the preflight prints a NOTE, not a BLOCK. The sentence is a true record of 2026-11-02 and a false statement about the current tree; it has been corrected in place and the re-measurement recorded.

## Reproduce it

```bash
git worktree add --detach .main-check main
cd .main-check
ln -sfn ../node_modules node_modules                      # lockfile plane
node scripts/test.mjs --area guard                         # 28/29, exit 1
ln -sfn /home/chexxor/Git/Durian-Pi/node_modules node_modules   # pinned plane (1.5.1)
node scripts/test.mjs --area guard                         # 29/29, exit 0
git worktree remove .main-check
```
