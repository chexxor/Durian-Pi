# Architect's 14 OPEN disposition rows — decisions (#7162)

Deciding seat: `architect`. Measured against **current main**, not the 2026-11-11 census evidence column, per pm's instruction on #7162. All commands run in the item worktree `/home/chexxor/Git/Durian-Pi/item-7162`.

## The measurement

`git merge-tree --write-tree --quiet main <ref>` — exit 0 means clean merge, exit 1 means conflict. Every one of the 14 exits **0**. The sheet's CONFLICT column is stale: main moved after the census, and the refs now merge cleanly.

| ref | tip | ahead of main | merge-tree exit | own contribution (merge-base..tip) | disposition |
|---|---|---|---|---|---|
| `item-6502` | `194702cd` | 3 | 0 | 4 files, all new to main | **LAND** |
| `item-6531` | `22c23aa1` | 4 | 0 | 5 files, all new | **LAND** |
| `item-6561` | `e389f883` | 1 | 0 | 3 files, all new | **LAND** |
| `item-6634` | `e90fc174` | 7 | 0 | 8 files, all new | **LAND** |
| `item-6643` | `12966ba2` | 9 | 0 | 11 files, all new | **LAND** |
| `item-6664` | `3ad2d1ae` | 13 | 0 | 18 files, all new | **LAND** |
| `item-6668` | `f87b59d9` | 3 | 0 | 5 files, all new | **LAND** |
| `item-6671` | `7902bf64` | 4 | 0 | 5 files, all new | **LAND** |
| `item-6679` | `243fe010` | 4 | 0 | 5 files, all new | **LAND** |
| `item-6707` | `67b5fd7b` | 2 | 0 | 3 files, all new | **LAND** |
| `item-6730` | `691b8920` | 2 | 0 | 3 files, all new | **LAND** |
| `item-6731` | `e1485072` | 4 | 0 | 5 files, all new | **LAND** |
| `item-6782` | `e6775ebb` | 2 | 0 | 4 files, all new | **LAND** |
| `item-6517` | `546a886e` | 3 | 0 | 5 files, all new | **LAND** |

No CANCEL: for each ref, the files it adds (`git diff --name-only <merge-base> <ref>`) have no matching blob on main — the reviews and probes are absent, so the intent is not satisfied. No RE-DERIVE: that disposition is for refs that conflict, and none of the 14 conflicts.

Ids to hand to landing pass **#7126**: 6502, 6531, 6561, 6634, 6643, 6664, 6668, 6671, 6679, 6707, 6730, 6731, 6782, 6517. No ref is deleted.

## The land condition — clean merge is not clean landing

Duplicate ADR headings, measured on the merged trees (`git merge-tree --write-tree main <ref>` then `grep -oE '^## D[0-9]+' | sort -V | uniq -d`):

- main **by itself** already carries `D265` and `D266` twice each (`node tools/probes/adr-number-collisions.mjs` → exit 1, "266 ADR entries; 2 number(s) used more than once").
- Six refs add a provisional number main has already consumed by a different landing:
  - `item-6502` → merged tree dup `D268`
  - `item-6531` → dup `D267`
  - `item-6634` / `item-6643` → dup `D268`, `D269`, `D270`
  - `item-6664` → dup `D268`–`D272`
  - `item-6668` → dup `D273`, `D274`
- Six carry provisional numbers in the free range that collide with each other across a single pass: `item-6671` (D275, D276), `item-6679` (D277, D278), `item-6707` (D279), `item-6730` (D280), `item-6731` (D281), `item-6782` (D282). `item-6679`'s own note says "re-mint at land from the MERGED tree; D272-D276 are provisionally taken" — the number is a placeholder, not a decision.

So the disposition is LAND, **conditional on the pass minting each ADR number from the merged scratch at land time** (the mint-from-merged-tree rule, #6561/#6562). Landing these 14 as written would put 12 duplicate D-numbers into the decision log on top of the two main already has.

Cross-row note: `#7702` renumbered #7643's entry to **D277** derived from the merged scratch. `item-6679` also carries D277. Both are provisional; whichever lands later must re-mint. This is the same failure class as #7643/#7669, one turn later.

## Failure mode and recovery

- **Defect:** `merge-tree exit 0` is read as "safe to land". It proves no textual conflict; it says nothing about identifier collisions in a file both sides append to.
- **Recovery:** the landing pass runs `node tools/probes/adr-number-collisions.mjs` (exit 1 = refuse) against the merged scratch before writing, and re-mints any provisional heading. Today that probe exists but is wired to nothing — `grep -rn 'adr-number-collisions' scripts/ src/ tools/ docs/` returns only the probe file itself. Until #6467 lands, the guard is manual and this collision class repeats.
