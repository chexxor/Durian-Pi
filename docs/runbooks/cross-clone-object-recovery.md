---
runbook: cross-clone-object-recovery
symptom: "a commit sha cited by a queue row, a decision or a runbook resolves in no object store on this machine; the workspace arrived from another machine/OS and the git history did not travel; commits exist in the object store but no ref reaches them (`unreachable commit`)"
writes: true                 # writes into .git only — packs and refs. It NEVER opens the store, so no broker stop is required
precondition: "read-only through Step 2; minting refs or installing packs needs the operator's grant"
last_verified: 2026-10-29
verified_by: delegate
evidence: "docs/incidents/2026-10-26-worktree-and-scratch-sweep.md; docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md; docs/NEXT.md (2026-10-29, 'Applied under the grant: the pre-move clone's 3 packs → this checkout: 9,301 → 22,362 objects'); every number in 'Evidence' below was re-run 2026-10-29 on Linux (Fedora, box Alex-Desktop-Win10, node v24.22.1)"
check_rule: null             # the *counting* half is ROADMAP 190 (cite store-native ids) + the citation family (250/252)
---

# A cited commit resolves nowhere, and the history came from another clone

**Read this before you chase an object, and before anything runs `git gc` on this checkout.**

A sha is a **pointer to evidence, not the evidence**. Most unresolvable citations are stale pointers to a
pre-landing commit (landing rewrote it), not lost work. Some, though, are the **only copy** — and on a moved
workspace that copy sits in your object store anchored by **no ref at all**, which makes it garbage to every
routine git command. The two failure modes look identical from `git cat-file -t`, and the wrong response to the
first is wasted hours while the wrong response to the second is **permanent loss**.

## Impact

- Unresolvable citations make the queue's own evidence unverifiable: `check` fires `citation-unresolvable`
  (measured ×5 on `rig.selfdev.json`, 2026-10-29) and a verifier cannot re-run what a row claims.
- **Unreachable commits are deleted by ordinary commands.** `git gc` (including `gc --auto` after a commit, and
  anything that shells out to it — some IDEs, some `pre-commit` hooks) prunes unreachable objects older than
  `gc.pruneExpire`, default **2 weeks**. Measured 2026-10-29: this checkout holds **452 unreachable commits**
  dated **2026-10-14 → 2026-10-21**, i.e. already past that window, carrying item-linked work (`25008d8c`
  "#1274", `5e00ee7e` "#1558", `81005c62` "#2111"). The clone that supplied them (`/mnt/d/Git/Durian-Pi`) is
  **not mounted on this box** — re-checked 2026-10-29: `/mnt` is empty. Those commits have one home left.

## Preconditions

1. **This procedure never opens the store**, so the broker's single-writer rule is not in play. Say so, then
   do not stop the broker for it (a needless stop is its own incident — `broker-down-or-stalled.md`).
2. **A grant.** Installing packs from another clone and minting `refs/rescued/*` are writes to the repository
   the operator owns. Ask; do not assume. (On 2026-10-29 the delegate was granted the pack application; the
   `refs/rescued/orphan-*` minting is **still ungranted**.)
3. **Never write to the foreign source.** Read/fetch only. On this rig the Windows source was `/mnt/d/Git/Durian-Pi`
   and the rule is `D:` is never a write target (`docs/DECISIONS.md` D131: native host OS only, and the source
   clone's path survives only as a remote name).

## Diagnose (read-only)

**1. Recompute the true missing set against the live records — never from memory.** Every sha-shaped token in
every queue row, tested with `git cat-file -t`. `docs/runbooks/workspace-move.md` §Step 4 carries the script;
the numbers it produced are the calibration: **178** cited shas, **90** unresolvable before the Windows fetch,
**3** after it. Run `node tools/review-cite-check.mjs` for the docs-side census.

```bash
git cat-file -t <sha>            # commit / blob / tree / tag, or "fatal: Not a valid object name"
```

**2. Is the object here but unreferenced?** This is the fork in the road.

```bash
git count-objects -v                                   # in-pack / packs / loose
git for-each-ref refs/rescued | wc -l                  # how much is already anchored
git fsck --connectivity-only 2>&1 | head               # dangling trees/commits with no ref
git fsck --unreachable 2>/dev/null | grep -c '^unreachable commit'
git fsck --unreachable 2>/dev/null | awk '/^unreachable commit/{print $3}' \
  | while read c; do git log -1 --format='%ad %h %s' --date=short "$c"; done | sort | sed -n '1p;$p'
```

Measured here 2026-10-29: `in-pack 22362` across **2 packs** + 267 loose, **3** dangling trees,
**452** unreachable commits spanning **2026-10-14 → 2026-10-21**, **32** `refs/rescued/*` already minted.
If that count is > 0, **Step 3 of `Do` is urgent, not optional** — and say so in your report.

**3. Find every other object store on the machine** — vendor pins are separate stores and are *not* your
history (`vendor-pins.mjs` clones are `--depth 1` and will never contain the queue's shas):

```bash
git remote -v                       # a leftover remote from the other machine is the cheapest win
for g in $(find . -maxdepth 4 -name .git -type d 2>/dev/null); do printf '%s  ' "$g"; git --git-dir="$g" cat-file -t <sha> 2>&1 | head -1; done
ls .spike/*/inventory-*.txt 2>/dev/null    # prior sessions' inventories name clones that existed then
```

## Do

**Ladder — cheapest rung first. Stop as soon as one rung resolves the citation.** Rungs 1–3 were each executed
on this rig during the 2026-10-26/28 moves; rungs 4–5 are the ones that closed the residue.

**1. Is the *change* on `main`?** Most stale shas name a branch commit that landing rewrote. `git log -S'<a
distinctive added line>'`, `git log --grep='#<item-id>'`, `git patch-id`, or just re-run the oracle the row
names ("`node demo/x.test.mjs` exit 0"). If it passes on `main`, the claim is verified whatever the sha was.
This resolved the last 3 live shas on 2026-10-26 at zero object cost.

**2. Fetch the foreign clone as a remote** (highest yield per minute: **52 of 90** recovered this way).

```bash
git remote add win <path-or-url>            # e.g. a mounted D:, an ssh target, or a bundle someone ships you
git fetch win '+refs/heads/*:refs/remotes/win/*'
```

**3. Install a pack that hangs off no ref** — the rung that recovered 4 more objects (`53fd8c6f8`, `bcf1a191c`,
`dd2583b12`, `be40620c9`), and the one everyone gets wrong:

```bash
git --git-dir=<src>/.git rev-list --objects <sha> --not --branches --tags > .spike/objs.txt
git --git-dir=<src>/.git pack-objects --stdout < .spike/objs.txt > .spike/rescue.pack
git index-pack --stdin < .spike/rescue.pack        # ← --stdin. `git index-pack <file>` only writes an .idx
                                                     #   beside the file; it does NOT install the pack.
```
Then **anchor it immediately** (Step 4) — an installed-but-unreferenced pack is exactly the state that a later
`git gc` deletes.

**4. Mint a ref for anything you rescued or discovered unreferenced.** This is the operator's grant; propose the
exact count in the ask, and keep the namespace honest — the name is a claim about provenance.

```bash
git for-each-ref refs/rescued | wc -l         # existing namespace (32 here): <seat>-item-<id>, item-<id>
git update-ref refs/rescued/orphan-<sha7> <sha>   # per rescued unreachable commit; batch from the fsck list
```
Name the minted set in `docs/NEXT.md` and in the row that cites it, or the next session inherits 480 refs
nobody can explain.

**5. Portable transfer when the other machine is unreachable:** ask its operator to run
`git bundle create durian-history.bundle --all` and ship the file. A bundle carries ref anchors with the pack,
so it beats a raw pack — `git bundle verify` refuses it if the prerequisites are missing, which is a feature.

## Verify (the procedure worked when all of these hold)

1. `git cat-file -t <sha>` returns `commit` for every sha the ladder was meant to recover.
2. `git fsck --unreachable | grep -c '^unreachable commit'` is **0**, or the residue is listed and named.
3. `git for-each-ref refs/rescued | wc -l` grew by exactly the minted count.
4. `git count-objects -v` grew — the packs arrived (2026-10-29 measured: **9,301 → 22,362** objects in-pack).
5. The row that cited the sha now cites something resolvable, or says in writing that the evidence is
   unreproducible. **Never leave a citation a successor cannot check.**

## If it fails

- **The object exists in no store anywhere.** Reconstruct from the store, not from the sha: `entries.record`
  holds the seat's own completion text (branch, base commit, file count) and often the `write`/`edit` payloads
  (`docs/runbooks/tool-result-redacted.md` if the payload was redacted). Replay onto the recorded base, mint a
  commit, and cite it **with provenance** — "recovered from transcript entry N onto base X". You cannot and must
  not reproduce the original sha: a forged-looking sha is worse than an honest recovery note.
- **`git bundle verify` refuses.** Its prerequisites are missing; fetch the missing ancestors first, or bundle
  `--all` from a fuller clone.
- **The count went DOWN after your own command.** That is an incident, not cleanup — stop, write it down, and
  read `docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`. A `--dry-run` that names no
  removals is **not** evidence there are none.

## Escalate to

The operator, for three decisions this procedure cannot make: the **grant** to install foreign packs and mint
`refs/rescued/*`; whether the residue is **worth** anchoring or should be declared unreproducible in
`docs/DECISIONS.md`; and (ROADMAP **190**) the durable fix — bind records to store-native ids
(`entries.id`/`record_ids`) instead of machine-local git objects, so this runbook stops being a recurring need.

## Evidence

All re-run on **Linux** (Fedora, `Alex-Desktop-Win10`, node v24.22.1) 2026-10-29: `git count-objects -v` →
`in-pack: 22362`, `packs: 2`, loose `267`; `git fsck --connectivity-only` → 3 dangling trees;
`git fsck --unreachable` → **452 unreachable commits**, dated **2026-10-14 … 2026-10-21**, sample subjects
`25008d8c docs(runbooks): merge.md documents the mid-merge WRITE refusal (#1274)`, `5e00ee7e feat(test):
partition the demo suite by functional area (#1558)`, `81005c62 docs(rebrand): … (#2111)`;
`git for-each-ref refs/rescued` → **32**; `ls /mnt` → empty, so the Windows source clone is **not** available on
this box. Historical counts (178/90/3 shas, 52 + 4 recovered, 9,301 → 22,362) come from
`docs/runbooks/workspace-move.md` §Step 4 and `docs/NEXT.md`, 2026-10-26 → 2026-10-29.

**Root cause, named so it stops recurring:** the queue cites machine-local git objects as durable evidence
(ROADMAP **190**), and `git`'s reachability model does not know that an unreachable commit is somebody's work.
