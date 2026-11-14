# Landing attempts against `main` at `a707a047` — verbatim gate verdicts (2026-11-14)

**Why this file exists.** The branch catch-up's claim is "everything a rule can merge is landed; the rest is
dispositioned". A claim like that is only checkable if the *attempt* is recorded, not asserted. Every ref whose
`git merge-tree` exits 0 (i.e. a rule **can** merge it) was run through the rig's own landing chokepoint, and the
refusal is quoted here verbatim. Refs are never deleted (rule R-B #3270).

**Host for every number:** Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1,
git 2.56.0.

## The census that produced the list

```bash
git for-each-ref --format='%(refname:short)' refs/heads        # 194 refs, main included
git merge-base --is-ancestor <ref> refs/heads/main              # 139 exit 0 (landed), 54 exit 1 (unlanded)
git merge-tree --write-tree refs/heads/main <ref>               # 4 of the 54 exit 0 (rule-mergeable), 50 exit 1
node tools/merge-containment-proof.mjs --branch refs/heads/main --refs <all 54, comma-separated> --json
# -> {"refs":54,"refs_with_loss":54,"elapsed_s":"22.3"}, exit 1
```

Exit 1 with 54/54 loss paths is the finding, not a crash: **no unlanded ref is a no-op**, so none of the 54 can be
closed by `tools/absorb-refs.mjs` (absorption requires the ref's content to be provably present in `main`). Each of
the 54 has a dated row in `docs/DISPOSITIONS.md`.

## The four rule-mergeable refs — all refused by the derived gate

| ref | merge-tree | land verdict | failing demo in the scratch | derived gate size |
|---|---|---|---|---|
| `item-3570-recut` | exit 0 | exit 1, `main` NOT advanced | `demo/compaction-acceptance-gate.test.mjs` | 166/359 tests, areas NOT RUN [none] |
| `item-7232-recut` | exit 0 | exit 1, `main` NOT advanced | `demo/by-id-claim-gate.test.mjs` | 31/359 tests, areas NOT RUN [readapi] |
| `landing-20261114-b3a` | exit 0 | exit 1, `main` NOT advanced | `demo/by-id-claim-gate.test.mjs` | 52/359 tests, areas NOT RUN [readapi] |
| `landing-20261114-c2` | exit 0 | exit 1, `main` NOT advanced | `demo/by-id-claim-gate.test.mjs` | 31/359 tests, areas NOT RUN [readapi] |

Verbatim lines from each run (full JSON reports in gitignored `.spike/land-attempt-20261114-<ref>.out`, reproducible
with the command below):

```
STOPPED: demo/compaction-acceptance-gate.test.mjs failed in the scratch worktree (exit 1) — main was NOT advanced.
STOPPED: demo/by-id-claim-gate.test.mjs failed in the scratch worktree (exit 1) — main was NOT advanced.   (x3)
PROVENANCE tree=a707a047 branch=HEAD node=v24.22.1 host=linux 7.2.15-300.fc45.x86_64 pi-durable=1.5.1
```

Reproduce (≈70 s each):

```bash
node scripts/land.mjs item-3570-recut --repo /home/chexxor/Git/Durian-Pi --db ./selfdev.sqlite --changed-suite
```

## Why `item-3570-recut` is not a mechanical fix

The compaction-gate failure is the area-manifest invariant: the recut adds `demo/revise-gate-write.test.mjs`
(300 lines) without mapping it in `demo/test-areas.json`. Mapping it is a provable lossless edit, so it was tried
in a scratch worktree built from the merge result:

```bash
TREE=$(git merge-tree --write-tree refs/heads/main refs/heads/item-3570-recut)
C=$(git commit-tree "$TREE" -p refs/heads/main -m "probe: merge result of item-3570-recut onto main")
git worktree add --detach .spike/try-3570 "$C"
node .spike/try-3570/demo/revise-gate-write.test.mjs   # exit 1 — "GATE WRITE PATH: 2 failing assertion(s)"
```

With the mapping added the ref's **own** demo is red on two assertions: `prose in a gate is REFUSED at the schema
boundary` (expects `blockedBy.0: must be integer`; the rig's wording is `blockedBy entry must be a positive integer
queue-item id, got …`) and `a stranger cannot write a gate on a row it is not party to` (the party check exists —
`src/rig.mjs:2080` — but the transcript the assertion greps is not what the harness records at this HEAD). Those are
semantic gaps a union rule cannot close; they belong to the item's author. Weakening the assertions would erase the
defect, so the ref is kept and held.
