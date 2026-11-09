---
runbook: git-form-refusal
symptom: "a seat's `git <verb>` dies with `was NOT checked by this guard`, or a `git config` write dies naming `$HOME/.gitconfig` / `/etc/gitconfig`; you cannot tell whether the guard refused on purpose or never looked at the verb"
writes: false
precondition: "read-only"
last_verified: 2026-11-04
verified_by: impl
evidence: "#5145 on `item-5145`: `node demo/git-guard-census.test.mjs` exit 0, PASS line reads `172 subcommands listed by git on this host; 56 claimed read + 24 claimed writing + 15 owned by their own rule; 91 refused`; the allowed-to-refused move measured by diffing `refusalFor` at `main` against the branch over every verb in `git help -a` — **84 forms moved, 3 of them unchecked-shape (`submodule`, `format-rev`, `hook`), 7 already refused** (`checkout clean push reset revert stash switch`). git 2.56.0, `Linux (kernel 7.2.15-300.fc45.x86_64) node v24.22.1`."
check_rule: "demo/git-guard-census.test.mjs"
---

# A git form was refused, and you need to know which kind

## When to use
One of these two refusal shapes appeared in your turn:

- ``refused by durig: `git <verb>` was NOT checked by this guard — it is in no claim list in src/confine.mjs …``
- ``refused by durig: `git config` scope write - `--global` writes `$HOME/.gitconfig` …``

Both come from `refusalFor` in `src/confine.mjs`, which now states what it checked instead of
carrying a deny list and letting everything else through (#5145). The two shapes mean different things,
and the difference is the whole point: **named refusal** = the guard looked at that form and refuses it
for a stated reason; **NOT checked** = the form is in no claim list, so it is refused rather than passed.

## Impact
Read the shape wrong and you burn the turn. A `NOT checked` refusal is not a bug in the guard and not a
permission you can wait out — it means nobody classified the verb, so the fix is to name the act and ask,
not to retry with a variant. A config scope refusal is the guard protecting every other seat: a
`--global`/`--system` write is persistent, host-wide, and its values (`core.fsmonitor`,
`core.hooksPath`, `alias.x '!…'`, `include.path`, `credential.helper store`, `url.<base>.insteadOf`) are
commands or remote rewrites, i.e. code execution outside the worktree that survives your item.

## Diagnose (read-only)
1. Read the first clause of the refusal. It names either a reason family ("object-DB maintenance on the
   SHARED store", "writes the index or the object database directly, past the #1317 commit-content gate",
   "the credential subsystem", "interactive UI", "a foreign VCS", "internal plumbing") or the words
   `NOT checked`.
2. Ask what the guard claims. The three claim lists are data, not prose:
   ```
   node --input-type=module -e 'const c=await import("./src/confine.mjs");console.log("read",c.GIT_READ_CLAIMED.size,"writing",c.GIT_WRITING_CLAIMED.size,"rule-owned",c.GIT_RULE_OWNED.size,"named-refused",c.GIT_REFUSED_NAMED.size)'
   # measured here: read 56 writing 24 rule-owned 15 named-refused 82
   ```
   A verb in `GIT_READ_CLAIMED` or `GIT_WRITING_CLAIMED` is allowed; one in `GIT_RULE_OWNED` is judged by
   its own argument/path-aware entry; one in `GIT_REFUSED_NAMED` is refused with its reason; anything else
   is `NOT checked`.
3. For a config refusal, read the file it names. `--global` → `$HOME/.gitconfig`, `--system` →
   `/etc/gitconfig`, `--worktree` → the repo's common `config.worktree`, `-f <path>` → a path outside your
   worktree, `-C <path>` → a repository that is not yours.

## Do
- Config: repo-local writes of ordinary keys work in your own worktree (`git config rerere.enabled true`,
  `git config user.name …`), and every read works (`--get`, `--list`, `--show-origin`, a bare key, and
  `--global --get` — reading is not writing). Do **not** try to make a scope refusal go away by writing the
  same key with `-f $HOME/.gitconfig`: that is the same act and it is refused the same way.
- A named refusal where a procedure needs the verb: quote the runbook line in a `defer_work`. Runbooks
  that depend on refused-adjacent verbs were kept allowed deliberately — `git worktree`, `git update-ref`
  (`cross-clone-object-recovery.md`, `leaked-worktrees.md`, `resolve-merge-conflict.md`), `git bundle`,
  `git fsck`, `git hash-object` **without `-w`** (`tracked-files-missing-on-disk.md`), `git clone`
  (`competitor-review.md`), `git fetch`, `git remote`, `git rerere`.
- `git gc`/`repack`/`prune`/`pack-refs`/`commit-graph` are refused for seats because they act on the shared
  object database, and `gc` deletes the unreachable commits other seats' citations point at — that is
  `cross-clone-object-recovery.md`'s premise, so the operator runs them. Note this does **not** stop git's
  own `gc --auto`, which runs inside `git commit`; if a rescue depends on nothing being gc'd, say so in the
  completion.

## Verify
`node demo/git-guard-census.test.mjs` exits 0 and prints the census line. Its load-bearing assertion is
"NO subcommand is allowed by silence": every verb `git help -a` lists on the host is either in a claim list
or refused. Run it after any change to the lists — a verb that a future git adds lands in the `NOT checked`
bucket by default, which is the safe direction, and the demo prints the host's verb count so a version bump
is visible.

## If it fails
A verb you need is `NOT checked` and a runbook or a receipt says it used to run: the census moved it, and
the move is deliberate but may be wrong for that procedure. Say so with the verb named; do not add it to a
claim list from a seat — the claim lists are a policy statement the operator and qa review.

## Escalate to
`operator` for anything that writes host or repo-wide state (global/system config, `gc`, credential
helpers, ref moves outside your item). `lead` if a claim list is refusing a verb a documented procedure
requires — that is a scope decision, not a workaround.

## Evidence
Measured at `main` before the change (the RED run is reproduced in the header of
`demo/git-guard-census.test.mjs`, which is why the demo is the permanent artifact): these returned **no
refusal at all** — `git config --global core.fsmonitor 'rm -rf $HOME'`, `git config --global
core.hooksPath …`, `git config --global alias.x '!… | sh'`, `git config --global credential.helper store`,
`git config --system http.proxy …`, `git config -f <outside> …`, `git -C <other tree> config …`, `git
commit-tree`, `git write-tree`, `git update-index --add …`, `git credential-store store`. The plumbing
three matter most: the #1317 commit-content gate is wired to the literal text `git commit`
(`GIT_COMMIT_RE`, `src/seatguard.mjs`), so writing objects through `hash-object -w` + `update-index` +
`write-tree` + `commit-tree` produced a commit that never passed the gate.
