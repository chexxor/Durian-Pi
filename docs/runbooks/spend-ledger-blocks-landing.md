---
runbook: spend-ledger-blocks-landing
symptom: "scripts/land.mjs refuses with \"the shared tree is NOT clean (… UNTRACKED INCLUDED)\" and one of the named paths is the rig's own spend ledger, `selfdev.sqlite.spend.jsonl` (or any `<db>.spend.jsonl`)"
writes: true
precondition: "read-only"       # the diagnose steps are read-only; the Do steps MOVE a file, they never delete or ignore it
last_verified: 2026-11-12
verified_by: devtools
evidence: "item #5459 (this entry); the measured pass is lead's land+prune carry-over #5327 part 5 (md5 4033d0131c571ec087eed355e82d0353 before and after); #5347 changes the gate to an intersection (branch item-5347, NOT landed); the ignore rule that already covers the ledger is 5335b64e"
check_rule: null
---

# The landing gate trips over the spend ledger: move it, verify it, never ignore it

## When to use

`node scripts/land.mjs <branch> --repo <shared root> --db ./selfdev.sqlite` exits 1 and its report says the
shared tree is **not clean**, naming an UNTRACKED file beside the store - classically
`selfdev.sqlite.spend.jsonl`. You are mid-landing and the refusal is about a file nobody authored.

## Impact

Two failure modes point at the same file, and both are live:

1. **The landing stops.** A gate that refuses on the rig's own continuously-written artefacts is
   unpassable in a live rig, so a proven branch sits unlanded (measured in #5250: the pass refused on
   three paths - a tracked `docs/ROADMAP.md` edit in flight, an untracked `install.sh`, and the spend
   ledger).
2. **Someone "fixes" it by deleting or ignoring the ledger.** The spend caps READ it:
   `src/config.mjs:223` registers `DURIG_SPEND_LEDGER`, and `src/config.mjs:626` describes exactly this
   file (`selfdev.sqlite.spend.jsonl`, 2,248 lines measured) as the money record the caps are computed
   from. Silently dropping it out of the tree makes the accounting blind: a cap that cannot see spend
   reports a green fleet while the money is gone. This is ROADMAP row 310 (spend durability) colliding
   with the landing gate - the collision is between two mechanisms that are each correct alone.

## Preconditions

- Do NOT stop the broker to move a sidecar file; the ledger is a sidecar, not the store. Nothing here
  requires the broker to be down.
- Know which semantics the gate you are running has (see "Which rule is in force" below). Do not
  assume: read the refusal text.

## Diagnose (read-only)

```bash
cd /home/chexxor/Git/Durian-Pi
git status --porcelain
git check-ignore -v selfdev.sqlite.spend.jsonl
```

- `git check-ignore -v` exits **0** and names the matching pattern: the ledger is already ignored
  (`.gitignore:11 *.spend.jsonl`, added by `5335b64e`), so on current main it **cannot** appear in
  `git status --porcelain`. If your refusal names it, you are on an older tree, or the file is listed
  under a name the pattern does not cover - name the pattern you saw.
- The refusal itself is emitted at `scripts/land.mjs` (the pre-flight block, `land.mjs:302-330` on
  main tip `517dc58d`): it counts EVERY line of `git status --porcelain`, untracked included.

**Which rule is in force.** Main's pre-flight is a blanket cleanliness test. Item **#5347** (branch
`item-5347`, two commits, NOT landed as of 2026-11-12) replaces it with an **intersection**: only a
dirty path the landing itself writes refuses; rig artefacts and other seats' in-flight edits are
reported as `dirtyPathsNotTouched` and the landing proceeds. Under #5347 this symptom stops being a
blocker, because the landing never writes the ledger. Until it lands, the relocation below is the
procedure.

## Do

1. **Record the checksum before you touch anything.**
   ```bash
   cd /home/chexxor/Git/Durian-Pi
   md5sum selfdev.sqlite.spend.jsonl
   ```
   Write the hash down. The measured pass recorded `4033d0131c571ec087eed355e82d0353`.
2. **Relocate, do not delete.** Move it out of the shared root with a name that keeps it findable:
   ```bash
   cd /home/chexxor/Git/Durian-Pi
   mv selfdev.sqlite.spend.jsonl .spike/selfdev.sqlite.spend.jsonl.hold
   ```
   The broker keeps writing beside the store; if the ledger is being appended while you move it, the
   hash you recorded will not match the moved file. That is not corruption - it means a seat spent
   during the move. Re-record the hash from the MOVED file and compare against the moved file after
   restoring.
3. **Land**, with the gate's own gate flag:
   ```bash
   cd /home/chexxor/Git/Durian-Pi
   node scripts/land.mjs <branch> --repo /home/chexxor/Git/Durian-Pi --db ./selfdev.sqlite --suite
   ```
4. **Restore and verify by checksum.** The file must return byte-identical to what you moved:
   ```bash
   cd /home/chexxor/Git/Durian-Pi
   mv .spike/selfdev.sqlite.spend.jsonl.hold selfdev.sqlite.spend.jsonl
   md5sum selfdev.sqlite.spend.jsonl
   ```
   Same hash as step 1 (or, if a seat spent during the landing, a hash whose file is a strict
   superset - confirm by line count, not by eyeballing).
5. **Never** add a `.gitignore` entry, `git clean`, or a `check` exception to make the ledger invisible.
   Ignoring it is exactly how the record was lost once before (`5335b64e`'s own note: "the spend ledger
   was untracked-and-not-ignored (649 KB, 1796 rows) and is now ignored, the same shape that lost it
   once before").

## Verify

Both commands ran on 2026-11-12 in this item's worktree (tree `517dc58d`, dependencySet = lockfile
`@earendil-works/pi-durable` 1.3.0, not `--link`ed):

```bash
git check-ignore -v selfdev.sqlite.spend.jsonl          # exit 0 -> pattern .gitignore:11 *.spend.jsonl
node demo/land-helper.test.mjs                          # exit 0 -> the clean-tree refusal and the FF are exercised
```

And the move-and-verify procedure itself, on a fixture ledger (never on the live rig's file):

```bash
cd /home/chexxor/Git/Durian-Pi/item-5459
printf '{"spend":1}\n{"spend":2}\n' > selfdev.sqlite.spend.jsonl
md5sum selfdev.sqlite.spend.jsonl
mv selfdev.sqlite.spend.jsonl selfdev.sqlite.spend.jsonl.hold
mv selfdev.sqlite.spend.jsonl.hold selfdev.sqlite.spend.jsonl
md5sum selfdev.sqlite.spend.jsonl
```

Expected: the two hashes are identical and the last command exits 0. If they differ, the file changed
while it was held - restore the version whose line count matches the recorded one and re-run.

## If it fails

- **Hash mismatch after restore:** do not overwrite. Keep both files, name them `…before` / `…after`,
  and report both hashes plus line counts. The ledger is append-only money data; a lost tail means lost
  spend records, not a cosmetic difference.
- **The refusal names a TRACKED path** (e.g. `docs/ROADMAP.md`): that is a different rule - a tracked
  edit in flight is a seat's work, and stopping-and-reporting is the rule in `docs/runbooks/land.md`.
  Do not move another seat's tracked edit.
- **The refusal names `item-<id>/` at the repo root:** that is the stray-worktree class, see
  `docs/runbooks/leaked-worktrees.md`.

## Escalate to

- **impl** (the landing pass): if the gate refuses on dirt the landing cannot write, that is #5347's
  semantics; say which paths were named so the intersection can be checked.
- **the operator**: any change to spend caps or to what the ledger may be excluded from (`D193` - the
  cap is the operator's decision, and only the operator's).

## Evidence

- lead's land+prune carry-over #5327 part 5: the measured relocation, md5 `4033d0131c571ec087eed355e82d0353`
  before and after; the pass landed with the ledger moved aside.
- `git check-ignore -v selfdev.sqlite.spend.jsonl` -> `.gitignore:11 *.spend.jsonl` (exit 0), pattern
  added by commit `5335b64e`.
- `scripts/land.mjs:302-330` at main `517dc58d`: blanket `UNTRACKED INCLUDED` refusal.
- #5347 (branch `item-5347` @ `9780b0bf` + runbook commit) turns the gate into an intersection; verified
  RED at `9611c45d` / GREEN at the branch tip with `node demo/landing-preflight-dirt.test.mjs`.
- Verified 2026-11-12 by devtools: `git check-ignore -v …` exit 0; `node demo/land-helper.test.mjs` exit 0.
