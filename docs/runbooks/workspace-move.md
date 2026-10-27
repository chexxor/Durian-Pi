---
runbook: workspace-move
symptom: "the rig's workspace moved machines or operating systems — a fresh clone or copy, a Linux box for a Windows rig, a new user; worktree registrations, seat cwds, the pin's node_modules links, or commit shas cited in the queue do not resolve"
writes: true
precondition: "broker-stopped"
last_verified: 2026-10-26
verified_by: delegate
evidence: "docs/incidents/2026-10-26-worktree-and-scratch-sweep.md; docs/DECISIONS.md D131; the Windows→Linux move of the selfdev rig"
check_rule: null   # proposed: ROADMAP 190 (sha-citation resolution)
---

# The workspace moved machines or operating systems

**Read this before the first writing verb.** A moved workspace looks healthy and is not: the store, the pin,
the git refs and the paths were written by a different machine, and each of them fails differently. Every
number below is one this delegate measured on the Windows→Linux move of the selfdev rig on 2026-10-26, and
one of them cost work (`docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`).

**Precondition — single writer.** Confirm the broker is stopped before any writing step:

```bash
DURIG_DB=./selfdev.sqlite node broker.mjs status      # expect: not running / stale pidfile
```

## Step 1 — measure the four divergences (read-only)

```bash
node scripts/sync-pi.mjs                       # 1. the pin
DURIG_DB=./selfdev.sqlite node cli.mjs ps      # 2. seat cwds (and the store's worktree count)
git worktree list --porcelain; git branch      # 3. what git actually knows
python3 - <<'PY'                               # 4. does the queue's evidence resolve here?
import json,subprocess,re
d=json.load(open('.spike/delegate/queue-audit.json',encoding='utf-8'))
bad=set()
for i in d['items']:
    for s in set(re.findall(r'\b[0-9a-f]{8,40}\b',(i.get('body') or '')+(i.get('subject') or ''))):
        if re.search(r'[0-9]',s) and re.search(r'[a-f]',s) and \
           subprocess.run(["git","cat-file","-t",s],capture_output=True).returncode: bad.add((i['id'],i['status'],s[:9]))
print("rows citing unresolvable commits:",len(bad)); [print("  ",*x) for x in sorted(bad)[:15]]
PY
```

What "moved, not yet a rig" looks like on this box:

| Divergence | Measured here | What it means |
|---|---|---|
| Pin not linked | `sync-pi.mjs` → `"linked": null`, `buildTree: null`, `drift: true` | no seat can run; the harness's own verbs may rebuild and silently replace links |
| Seat cwds are foreign | `ps`/store held `cwd = C:\Users\Alex\dsh-Projects\pi-opendurig`; `up --refresh --dry-run` proposed re-pointing a seat to a **`C:/…` path on Linux** | every seat would try to work in a path that does not exist |
| Worktree registrations | store reported **13** worktrees; `git worktree list` returned **1** | the copied trees have `.git` pointer files whose gitdir is on the other machine; the pre-`up` scratch cleanup sees garbage, not worktrees |
| Cited evidence | **90 of 178** distinct commit shas cited in the queue resolve **nowhere** — not this clone, not `vendor/pi-main/.git`, not `origin`; **14 non-terminal rows** (#3452 #3506 #3603 #3726 #3743 #3832 #3842 #4378 #4791 #4794 #4799 #4801 …) carry evidence nobody can re-check | the store came over; the git history did not |

## Step 2 — restore the pin and the config, in that order

```bash
node scripts/sync-pi.mjs --sync --link    # expect: buildTree = the pinned sha, and nine @earendil-works/* links
node scripts/sync-pi.mjs                  # re-read: buildTree set; drift only if upstream genuinely moved
cat durig.config.json                     # gitignored: DURIG_DB, provider, concurrency — recreate it, it does not travel
```

`durig.config.json` is **gitignored**, so a moved workspace has no config until you write one. On this box
that meant the DB spelling and the provider both silently reverted (see `docs/SELFDEV.md`: a bare `cli.mjs`
audits an empty `./rig.sqlite`).

## Step 3 — inventory before the first writing verb (this is the step that saves the work)

```bash
{ git worktree list --porcelain; echo ---; git branch --list; echo ---; ls .spike | wc -l; } \
  > .spike/pre-writing-inventory.txt
```

Then, and only then:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run   # read-only preview
DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh             # the writing verb
{ git worktree list --porcelain; echo ---; git branch --list; echo ---; ls .spike | wc -l; } \
  > .spike/post-writing-inventory.txt
diff .spike/pre-writing-inventory.txt .spike/post-writing-inventory.txt
```

**Treat any unexplained deletion in that diff as an incident, not as cleanup.** What happened here: after a
writing verb, `git worktree list` went 13 → 1, twelve `item-*` branches disappeared, `.spike` went 436 → 16,
`git fsck --unreachable` returned **0** unreachable commits, and the shas the pointer called unmerged
(`500969f42`, `8990303`) stopped being objects. `up --refresh --dry-run` — the step whose entire purpose is
to name the damage first — named **none** of it, because it previews model and cwd resets, not removals.

## Step 4 — bring the history, or accept the loss (a decision, not a cleanup)

The 90 unresolvable shas are not a formatting problem: they are commits that live only on the machine the
store came from. Either the old machine pushes them (`git push origin --all`, then `git fetch origin` here)
or you add it as a remote and fetch, or you record in `docs/DECISIONS.md` that the evidence for those items
is unreproducible and stop citing those shas as verification.

Do **not** infer "the work is gone" from a `git worktree list` count, and do not infer "the gate is clear"
from a zero count either: on this box the stray-worktree landing gate (#4656) went from ten strays to zero
because the artifacts were swept, not because anything landed.

## Step 5 — re-measure the OS-shaped baseline

The suite is not the same suite after an OS move. Record the new number rather than reusing the old one:

```bash
for f in demo/*.test.mjs; do timeout 120 node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```

Here: **227 pass / 8 fail**, and the eight are a *different* set from the six recorded in D129 — junction
checks (`confine`, `verify-scratch-per-tree`), Windows path fixtures (`write-targets`), the Job Object path
(`job-object`), worktree plumbing (`worktree-deps-link`, `worktree-prune-branch`), a docs-state check
(`clockin-digest`), and one genuine logic defect that is not OS-shaped at all (`broker-health` reading `up`
with `passAgeMs: 420613`). OS-shaped failures are ROADMAP 185–189; a failure that survives on both OSes is a
bug, not drift, and must not be filed under "Linux".

## Verify (the procedure worked when all of these hold)

1. `sync-pi.mjs` reports `buildTree` = the pinned sha and the nine `@earendil-works/*` symlinks exist under
   `node_modules/`.
2. `git worktree list` and the store's worktree count agree (or the disagreement is recorded as a finding).
3. Every seat's persisted cwd `stat`s on this machine.
4. The pre/post inventory diff shows no deletion you did not choose.
5. `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` is read and its findings acted on — on a
   single-model local rig it will report **`single-model-rig`, severity fix-now** (ROADMAP 189). That is
   expected after a provider move, not a regression to hide.
6. The suite number for this box is written into `docs/NEXT.md`.

## Never

- Bare `up`, or any writing verb, before the Step 3 inventory.
- `git add -A` (the entry point's rule; `docs/DECISIONS.md` D115).
- Trust a count as a verdict — strays, worktrees, line counts, suite totals. Name the tree and the method.
- Carry the old OS's numbers forward: they are the fastest way to lie to the next session.
