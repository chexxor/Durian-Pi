---
runbook: workspace-move
symptom: "the rig's workspace moved machines or operating systems — a fresh clone or copy, a Linux box for a Windows rig, a new user; worktree registrations, seat cwds, the pin's node_modules links, or commit shas cited in the queue do not resolve"
writes: true
precondition: "broker-stopped"
last_verified: 2026-10-29
verified_by: delegate
evidence: "docs/incidents/2026-10-26-worktree-and-scratch-sweep.md; docs/DECISIONS.md D131; the Windows→Linux move of the selfdev rig; re-run 2026-10-29 by a delegate on Linux (Fedora 7.2.11-200.fc44.x86_64, node v24.22.1, box Alex-Desktop-Win10) — Steps 1/3 read-only against ./selfdev.sqlite, measured output inline below; docs/reviews/cross-os-rig-portability-2026-10-29.md; ROADMAP 210, 217, 221, 232, 263-267"
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
node tools/rig-portability-audit.mjs           # 4. is this rig runnable HERE at all? exit 1 = findings, naming the layer
python3 - <<'PY'                               # 5. does the queue's evidence resolve here?
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

**Write an inventory as one name per line — no headers, no counts, no git output mixed in.** Measured this session: the
pre-writing inventory was written in a mixed format, so the post-verb name-diff printed `pre=9` "lines" against **160** real
files and buried the verdict (there was **zero** loss) in format noise. Regenerate bare-name inventories before trusting a
diff — and note that a count-only inventory is doubly unsafe here, because the artifact counts itself.

What "moved, not yet a rig" looks like on this box:

| Divergence | Measured here | What it means |
|---|---|---|
| Pin not linked | `sync-pi.mjs` → `"linked": null`, `buildTree: null`, `drift: true` | no seat can run; the harness's own verbs may rebuild and silently replace links |
| Seat cwds are foreign | `ps`/store held `cwd = C:\Users\Alex\dsh-Projects\pi-opendurig`; `up --refresh --dry-run` proposed re-pointing a seat to a **`C:/…` path on Linux** | every seat would try to work in a path that does not exist |
| Worktree registrations | store reported **13** worktrees; `git worktree list` returned **1** | the copied trees have `.git` pointer files whose gitdir is on the other machine; the pre-`up` scratch cleanup sees garbage, not worktrees |
| Cited evidence | **90 of 178** distinct commit shas cited in the queue resolve **nowhere** — not this clone, not `vendor/pi-main/.git`, not `origin`; **14 non-terminal rows** (#3452 #3506 #3603 #3726 #3743 #3832 #3842 #4378 #4791 #4794 #4799 #4801 …) carry evidence nobody can re-check | the store came over; the git history did not |

**What the Step 1 numbers hide, and what 2026-10-29 re-measurement added.** Run `node tools/rig-portability-audit.mjs`
before **any** writing verb on a moved workspace. It composes the product's own seam (`resolveSeatRoot`, `classifyGitRoot`,
`sameRoot`, `classifyWorktrees`) rather than re-deriving them, and per seat asks: *what is this seat's root, does it resolve
here, and which layer supplied it?* Here it exits 1 with **15 findings**, 12 of them `seat-root-unresolvable`. Two facts fall
out of it that the table above cannot show:

1. **A seat's real root is the store's `pi.agent.cwd`, not the rig file.** `resolveSeatRoot` returns a persisted cwd
   **unconditionally** (`src/seatroot.mjs:29`), and `classifyGitRoot` reports the phantom as **`main-worktree`** — so a woken
   file-capable seat is told it is in the *live checkout* while its file tools aim at a path that does not exist on this
   host. The tracked `rig.selfdev.json` is clean (0 host-absolute hits), which is exactly why a check that reads only the rig
   file reports green (210's amendment; the trap is written into that row now).
2. **The keep-guard that protects a seat's own tree does not survive the move** (266 — *distinct* from 232's missing
   liveness guard; do not conflate them). `classifyWorktrees` (`src/broker.mjs:988-1010`) marks
   `keepReason: "seat-root"` only on an **exact normalized-string** match, so after a host move none of the stored roots match
   any registered tree and the guard **silently never fires** — while the sweep that consumes it runs at **every broker start**
   (`reconcileOrphanedWorktrees`, `src/broker.mjs:1145-1170`). `rig-portability-audit.mjs --self-test` proves it with one
   classifier and two synthetic roots: same-host → `seat-root`; the stored foreign-shaped root → `not-terminal`. Until 266
   lands, a post-move `worktree audit` is **evidence about the ledger, never a safe place to reap**, and 232's mitigation
   stands (rehearse `run`/`send`/`up --worktree` only in a disposable clone — `/home/chexxor/Git/Durian-Pi-ops/durian-pi`
   today): from now on "nothing is `reapable`" is true only because the rows are already gone.

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
{ git worktree list --porcelain; echo ---; git branch --list; echo ---; ls .spike | sort; } \
  > .spike/pre-writing-inventory.txt
```

(**Names, not a count.** A count is weak evidence: observed 2026-10-29, a pre and a post inventory both printed `171`
even though each snapshot counted *itself*, i.e. one scratch entry in and one unaccounted for. A name diff answers the
question; a count could not. The `Never` list at the end of this file already says *"trust a count as a verdict"* — the
inventory step has to obey it.)

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

**Measured 2026-10-29, and this part surprises people: `--refresh` alone repairs nothing about cwd.** The tracked rig
declares **no** `cwd` for any seat, and `cli.mjs:679` computes `seatCwd = seat.cwd ?? spec.cwd ?? CFG.DURIG_SEAT_ROOT`,
writing it **only when defined**. So the preview above returned 12 seats of which **7 reported `{}` and 5 a `model` change
only — zero seats got a `cwd` change, and the phantom foreign root stayed in the store.** Export the host root and the same
command previews the whole repair:

```bash
DURIG_SEAT_ROOT=/path/to/this/host/checkout DURIG_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run
# 12/12 seats now preview changes.cwd = {from: "C:\\Users\\Alex\\dsh-Projects\\pi-opendurig", to: "<the exported root>"}
```

**Do not apply that shape by reflex.** Pointing twelve seats at one root — least of all at the **live checkout** — collides
with per-item worktree isolation and hands every file-capable seat the main tree (the F21 hazard in `docs/SELFDEV.md`), which
`classifyGitRoot` calls `main-worktree` either way. Per-seat roots under a seat-root base are what 221 ruling A (a
workspace-root-relative identity) and 265's **missing `up --root` flag** are for: `docs/DECISIONS.md:6314` grants an
`up --root` **that does not exist** (`node cli.mjs help` has no such flag), so today the only mechanism is the environment
variable above — bulk by construction. Record which one you used, and what you left unpointed, in `docs/NEXT.md`.

## Step 4 — bring the history, or accept the loss (a decision, not a cleanup)

The 90 unresolvable shas are not a formatting problem: they are commits that live only on the machine the
store came from. Either the old machine pushes them (`git push origin --all`, then `git fetch origin` here)
or you add it as a remote and fetch, or you record in `docs/DECISIONS.md` that the evidence for those items
is unreproducible and stop citing those shas as verification.

Do **not** infer "the work is gone" from a `git worktree list` count, and do not infer "the gate is clear"
from a zero count either: on this box the stray-worktree landing gate (#4656) went from ten strays to zero
because the artifacts were swept, not because anything landed.


### Chasing a cited sha that resolves nowhere

A sha is a **pointer to evidence, not the evidence**. Before hunting for an object, ask whether the *change*
is on `main` — most unresolvable citations are stale pointers to a pre-landing commit, not lost work. The
ladder, cheapest rung first (each rung measured on 2026-10-26):

1. **Recompute the true missing set** against the store, never from memory: every sha-shaped token in every
   queue row, tested with `git cat-file -t`. (178 cited; 90 missing before the Windows fetch; **3** missing
   across live rows after it.)
2. **Every object store on every mounted volume.** `git cat-file -t` against each `.git` you can find, then
   `git remote add win <path> && git fetch win '+refs/heads/*:refs/remotes/win/*'`. This recovered **52 of 90**
   with no other work. For objects that hang off *no* ref (deleted branch, dangling):
   `git --git-dir=<win>/.git rev-list --objects <sha> --not --branches --tags > o.txt` →
   `git --git-dir=<win>/.git pack-objects --stdout < o.txt > r.pack` →
   `git index-pack --stdin < r.pack`. **`git index-pack <file>` only builds an index next to the file; it does
   not install the pack** — use `--stdin` or nothing lands. That recovered 4 more (`53fd8c6f8`, `bcf1a191c`,
   `dd2583b12`, `be40620c9`).
3. **Patch-equivalence — the highest-yield rung, and it needs no objects.** `git log -S'<a distinctive line from
   the described change>'`, `git log --grep='#<item-id>'`, or `git patch-id`. This resolved **all 3** remaining
   live shas.
4. **Re-run the evidence the sha stood for.** Rows usually name their oracle ("`node demo/x.test.mjs` exit 0").
   If it passes on `main`, the claim is verified whatever the sha was.
5. **Transcript archaeology.** pi-durable stores tool results verbatim, so `entries.record` holds the seat's own
   completion text — branch, base commit, file count, and the change described — and often the `write`/`edit`
   payloads themselves. That is how you reconstruct when 3–4 fail: replay the edits onto the recorded base
   commit, mint a commit, and cite it **with provenance** ("recovered from transcript entry N onto base X").
   You cannot reproduce the original sha without the original committer and timestamps, and should not try —
   a forged-looking sha is worse than an honest recovery note.
6. **Amend the row** to cite something resolvable, or state in writing that the evidence is unreproducible.
   Never leave a citation a successor cannot check.

**Worked example (the whole class, in one row).** `#3743`/`#4378` cite `0c6fd7665`; no object has that sha, and
`git rev-parse --disambiguate=0c6fd76` returns exactly one commit — `0c6fd76e4659b1deeaa7c0765c2654469a57abfd`,
"fix(broker): the liveness probe is FAIL-SAFE — unknown means ALIVE, ESRCH is the only dead (#3398)". So the seat
cited its **branch** commit, which landing then rewrote. The change is on main (three call sites now read
`err?.code !== "ESRCH"`) and `demo/broker-liveness.test.mjs` **passes**. Nothing was lost; the pointer was stale.
Same for `eb7e69c1e` (#3506 → `ce79c354`, `selectOldestWorkable` exported, `demo/workable-claim.test.mjs`
passes) and `5d8c6237a` (#3603, cited only as context in a row held on #2788).

The root cause is not the sweep — it is that the queue cites **machine-local git objects as durable evidence**.
That is ROADMAP **190**: bind durable records to store-native ids (`entries.id` / `record_ids`), and let a
`check` rule count unresolvable citations so this is a failing test rather than an archaeology project.

## Step 5 — re-measure the OS-shaped baseline

The suite is not the same suite after an OS move. Record the new number rather than reusing the old one:

```bash
node scripts/test.mjs            # 8 at once by default; add --jobs 16 when nothing else runs
```

(Recorded for the trail: the number below was measured 2026-10-26 with the serial per-file loop
`for f in demo/*.test.mjs; do timeout 120 node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`, before the
runner's default became concurrent. Same tests, different wall time.)

Here: **227 pass / 8 fail**, and the eight are a *different* set from the six recorded in D129 — junction
checks (`confine`, `verify-scratch-per-tree`), Windows path fixtures (`write-targets`), the Job Object path
(`job-object`), worktree plumbing (`worktree-deps-link`, `worktree-prune-branch`), a docs-state check
(`clockin-digest`), and one genuine logic defect that is not OS-shaped at all (`broker-health` reading `up`
with `passAgeMs: 420613`). OS-shaped failures are ROADMAP 185–189; a failure that survives on both OSes is a
bug, not drift, and must not be filed under "Linux".

**Re-attribution of the `clockin-digest` entry (2026-11-02, #4985, fixed at `c4db1fd9`):** it was neither
docs-state nor OS-shaped. Its cause was the tool interpolating branch NAMES into a git range while the tree was
DETACHED — `git rev-list --count main..(no branch)` → exit 128 (git 2.56.0 lists a literal `(no branch)` for a
detached HEAD) — measured on Linux in a scratch worktree at `43e26dcc`, and it is what stopped the item-4966
landing's `--changed-suite` at 129 of 242 derived tests. Moving a workspace onto a named branch (this runbook's
own remedy, recorded in D173) hides it; the tool is now fixed, and `demo/clockin-digest.test.mjs` creates the
detached tree itself so the failing shape is part of the test. The other entries in that list are untouched.

## Verify (the procedure worked when all of these hold)

1. `sync-pi.mjs` reports `buildTree` = the pinned sha and the nine `@earendil-works/*` symlinks exist under
   `node_modules/`.
2. `git worktree list` and the store's worktree count agree (or the disagreement is recorded as a finding).
3. Every seat's persisted cwd `stat`s on this machine — proved by `node tools/rig-portability-audit.mjs` exiting 0, not by
   `cli.mjs ps`, which prints name/conversationId/role and **no cwd at all**. On 2026-10-29, three years of the store's own
   history later, **twelve** seats still resolved to a `C:\Users\Alex\…` path and `classifyGitRoot` called that phantom
   `main-worktree` — which is worse than an obvious failure, because the seat is told it is in the live checkout (221).
4. The pre/post inventory diff shows no deletion you did not choose.
5. `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` is read and its findings acted on — on a
   single-model local rig it will report **`single-model-rig`, severity fix-now** (ROADMAP 189). That is
   expected after a provider move, not a regression to hide.
6. The suite number for this box is written into `docs/NEXT.md`.

## Never

- Bare `up`, or any writing verb, before the Step 3 inventory.
- `git add -A` (the entry point's rule; `docs/DECISIONS.md` D115).
- Trust a count as a verdict — strays, worktrees, line counts, suite totals. Name the tree and the method.
- "Fix" a dead seat cwd by pointing every seat at one root, the live checkout included. That is the F21 hazard wearing a
  repair costume; per-seat roots are the fix (221, 265).
- Carry the old OS's numbers forward: they are the fastest way to lie to the next session.
