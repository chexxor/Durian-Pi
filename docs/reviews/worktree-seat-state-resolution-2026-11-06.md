# Design note — one resolver, one ledger reader: the shape `pruneWorktrees` (`src/worktree.mjs:649`) and the broker sweep (`src/broker.mjs:1167`) must converge on

**Item #4846 (architect) · 2026-11-06 · opens the gate on #4850 / ROADMAP 232.**
**Status: design-of-record, Proposed. No product code was touched here.** This note is the artifact ROADMAP 241
says must exist *before* 232 is claimed (`docs/DECISIONS.md:6492` records that 232's row #4850 was gated on #4846
because "the note had no row to hang a gate on"). It is **not** 232 and must not be reported as it: 232 is the build;
this is the shape the build must land on.

Host of every measurement below: **Linux Fedora 45 7.2.15-300.fc45.x86_64 node v24.22.1, git 2.56.0**, inside the
isolated item worktree `/home/chexxor/Git/Durian-Pi/item-4846`. Per the standing rule from 232's own mitigation
(`docs/ROADMAP.md` 232 "the working checkout is never the experiment"), **no worktree-exercising command was run
against the shared checkout or the live store**: every probe below created its own standalone `git init` repository
under `.spike/probe-4846/` (gitignored) and was deleted after capture. The incident that this design prevents is
`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`.

---

## 1. The question, restated

232 asks for "a caller-supplied allow-list of roots it may clear, and a refusal naming any registration that looks
foreign". That phrasing is a *patch*, and a patch at `:649` will not survive: the allow-list has to be **computed**,
and the thing that computes it is the same thing that decides whether a worktree is a seat's live root (266), whether a
registration is the rig's own (WORKTREE-ROT 3/3, `src/broker.mjs:960-967`), and what `worktree audit` prints (ROADMAP
76). If 232 invents its own path comparison, durian-pi will hold a **fourth** normalizer, which 263 explicitly forbids
("Do not: add a third normalizer in the fix").

So the deeper request is: **name the single resolution seam that answers "is this registered working tree known to
this host, and is it ours?" — and make every actor that can destroy a registration, or protect a tree, call it.**
The rawest material is not the roadmap prose; it is **what git itself decides**, because `git worktree prune` is
currently the only actor in durian-pi that acts on a *foreign* registration. I read the code at the cited lines and
ran git's semantics in a throwaway repo rather than reasoning from the incident write-ups.

## 2. Measured: what git actually decides, and what is readable before it acts

Probe: `.spike/probe-4846/prune-semantics.sh` (throwaway `git init` repo; three worktrees added, two of their
directories then deleted out-of-band). Every line is reproduced output, not paraphrase.

| # | Probe | Measured result | Why it matters |
|---|---|---|---|
| P1 | `git worktree list --porcelain` on a repo with a missing tree | emits a **`prunable gitdir file points to non-existent location`** line under that row | The destructive set is **readable through the reader we already use**, without acting. This is the seam. |
| P2 | `ls .git/worktrees` | `wt-a wt-b x` | The ledger is a directory of registrations; `prune` mutates it wholesale. |
| P3 | `git worktree prune -n -v` | prints `Removing worktrees/wt-a: gitdir file points to non-existent location` (and `worktrees/x`), exit 0; registrations **unchanged** | 232's `--dry-run prints the exact list prune would clear` is satisfiable with a git-native flag; no new enumeration code. |
| P4 | `git worktree lock <name>` on the two **missing** rows, then `git worktree prune -v` | exit 0, **nothing removed** (`wt-a wt-b x` all survive) | A **lock is a per-registration quarantine that `prune` respects**, even for a row whose directory this host cannot read. This is the cheap reversible control 232 needs today. |
| P5 | `git worktree unlock wt-a` then `prune -v` | `Removing worktrees/wt-a` | The quarantine is **reversible**; an operator can release a row and let it clear. |
| P6 | lock a row whose directory exists, then prune | untouched | Locking is safe on live trees (but see F6 — it has a cost). |
| P7 | `git worktree remove wt-b` while locked | `fatal: cannot remove a locked working tree; use 'remove -f -f' to override or unlock first` | A lock blocks **git's** removal verb — but see F11: durian-pi's own `removeClaimedWorktree` deliberately unlocks first, so a lock is a barrier to the *prune plane and to other tools*, not to our own teardown. |
| P7b | read of `removeClaimedWorktree` | `// Unlock first if held — a locked worktree cannot be removed even with --force` (`src/worktree.mjs:1207-1229`, the unlock call at `:1225`) | The product **defeats its own lock** on the removal path, on purpose. Any quarantine that lives only as a git `locked` row is therefore only a guard against the plane 232 is about (prune), not against every teardown. |
| P8 | `git worktree prune --expire "1.second.ago" -v` on a just-orphaned row | **nothing removed** | git has a **grace-period gate**. A bare prune can be made host-move-safe by refusing to clear anything younger than the cutoff. |
| P9 | after pruning two registrations, `git for-each-ref refs/heads` | `a b c main x` — **every branch survived** | A wrong prune destroys the **registration**, not the commits. The recovery path for a mistaken prune is re-registration/ref-reading, **not** "the work is gone". |
| P10 | `git log --oneline -1 a` after its registration was pruned | `3ab833f seed` | Confirms P9 from the other side: the ref is readable without a registration. |

Two consequences for the register, and they cut in opposite directions:

- A prune is **less** destructive than the incident narrative implies for **tracked** work (P9/P10: refs survive),
  which means the *evidence* loss is the registration list itself — exactly what 212/209-214 consume, and exactly what
  232's "Blind spots" line calls data loss even when it is mechanically correct.
- It is **more** destructive than P9 suggests for **untracked** work: the same event also took untracked files
  (`docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md`, and the `.gitignore` note at
  `.scratch/` records eight instruments lost that way). So the design must protect the *registration* (evidence) and
  the *tree* (work) with different controls.

## 3. The topology: four resolvers of one question, and only the blind one has a verb

| Resolver | Site | What it decides | Host-qualified? | Records its decision? | Destructive? |
|---|---|---|---|---|---|
| **R1 git's own prunability view** | `pruneWorktrees`, `src/worktree.mjs:649-658` (`git -C <repo> worktree prune`, best-effort, `console.warn` on failure) | "this host cannot read the tree → delete the registration" | **No — host-blind by definition** | No: returns `{pruned:true}`, count never surfaced; call sites ignore the return | **Yes, wholesale** |
| **R2 `classifyWorktrees`'s `norm`** | `src/broker.mjs:989` (266 and 263 cite the block as `:988-1010`) (`.replace(/\\/g,"/").replace(/\/+$/,"").toLowerCase()`) | "is this registered tree one of the seats' roots" (keep-reason `seat-root`) | **No** — a stored `C:\Users\…` root can never match a Linux registration; measured by 266 and re-measured here (§5 F2) | keep-reason only, and only when the sweep reports it | No, but it is the **guard that never fires** (266) |
| **R3 `resolveSeatRoot` / `sameRoot`** | `src/seatroot.mjs:28-38` | "which tree is this seat actually in" (persisted cwd → `DURIG_SEAT_ROOT` → process cwd) | No — `:29` returns a persisted cwd **unconditionally, unvalidated** (263's headline) | `describeSeatRoot` prints `source` and a MISMATCH line — the only recorded resolution we have | No |
| **R4 the 263 resolver** | *not built* — `src/seatroot.mjs:28` still returns `{root, source}`, read 2026-11-06 | proposed: `{root, source, kind, reason}`, validating each layer, refusing to silently join a foreign-shaped value | yes (by design) | yes (`reason`) | no |

**A fifth normalization exists that 263 did not count.** 263 names two normalizers (`seatroot.mjs:36`, `broker.mjs:988`).
There is a **third**: `auditWorktrees` builds its own inline key at `src/broker.mjs:1069`
(`String(wt.worktree).replace(/\\/g,"/").replace(/\/+$/,"").toLowerCase()`) to index `dirty`, in addition to the one in
`classifyWorktrees` it calls two lines later. So 263's acceptance ("no second normalizer survives") must be read as
**three sites to collapse**, and 232 must not become the fourth.

**The defect this topology produces, stated exactly.** `auditWorktrees` reads the ledger with
`await listWorktrees(repoPath)` at `src/broker.mjs:1065` — **without `{strict:true}`**. So does the second act-caller,
`cleanVerifyScratch`, at `src/broker.mjs:1091` — a caller that then *removes* trees, exactly the class the strict
message says must not read loosely. The non-strict path returns `[]` on failure (`src/worktree.mjs:1414`), whose strict
sibling at `:1403-1408` already says *"refusing to answer 'none' when the truth is 'unknown' (pass { strict: false }
only for a caller that REPORTS rather than decides)"*. The sweep
then does the *safe* thing with an empty read — it reaps nothing — and then, at `src/broker.mjs:1167`, **prunes
unconditionally**, with its own comment: *"Prune once at the end so the sweep self-heals those, **whether or not it
removed anything this pass**"*. That is the seam defect in one sentence:

> **The destructive act is not gated by the same predicate as the read.** A read that failed, a store with no seats,
> and a resolver that cannot fire (266) all still permit the one verb that can erase 36 rows to 1.

And the prune is called from three places, so "fix `:649`" is already the wrong target: `src/broker.mjs:1167` (end of sweep,
`src/worktree.mjs:667` (`removeWorktree`) and `src/worktree.mjs:1326` (`removeClaimedWorktree`, whose comment says it is
*"the single choke point for every teardown path … so pruning here clears the stale registration of any OTHER
out-of-band-deleted tree at the same time"*). That last clause is the intent inverted: a **choke point for our own
teardown** was written as a **licence to clear other people's rows**. It is the mechanism by which a delegate running
the product's own demo suite collapsed a ledger it never intended to touch (232's measurement: 36 → 1).

## 4. The design (decision of record)

**Name the seam: a `worktreeLedger(repoPath)` reader plus a `resolveRegistration(row, host, roots)` verdict, and no
actor destroys a registration except through a decision that carries a verdict.** Four rules; each is falsifiable.

**D-a — One reader, and decision-makers read strictly.** `listWorktrees` (`src/worktree.mjs:1379`) is the only opener
(ROADMAP 213's single-reader rule, restated in 232's blind spots: *"any fix that shells out to `git worktree list
--porcelain` again must not re-introduce a second ledger reader"*). Extend its parser to carry the **`prunable
<reason>`** line it already sees and discards (its parser handles only `worktree`/`branch`/`locked`,
`src/worktree.mjs:1384-1397`) — measured P1. `auditWorktrees` (`src/broker.mjs:1066`) and every caller that **acts**
must pass `{strict:true}`; only a caller that *reports* may pass `strict:false`. Probe: a demo that makes the list read
fail and asserts the sweep throws rather than sweeping.

**D-b — The verdict vocabulary, computed by 263's resolver, is the only input to a destructive verb.**
For each row: `this-host-present` · `this-host-missing` (ours, dir gone: the real ghost problem `prune` legitimately
solved, 25 cleared on 2026-10-19) · `foreign` (path shape belongs to another OS/host: drive-letter prefix, foreign
hostname, or outside the caller's roots) · `unknown` (the resolver could not decide). **Act only on
`this-host-missing`.** `foreign` and `unknown` are never cleared, ever.

**D-c — Foreign/unknown rows are QUARANTINED, not deleted and not ignored**: `git worktree lock <name>`, recorded.
Measured: a locked row survives `prune` (P4) and survives **git's** `worktree remove` (P7), and unlock restores the
previous behaviour (P5). Quarantine is reversible, git-native, per-registration, and needs no new ledger format.
**Its limit, measured in code:** it guards the *prune* plane and other tools, **not** durian-pi's own teardown —
`removeClaimedWorktree` unlocks first by design (`src/worktree.mjs:1207-1229`, unlock at `:1225`, comment: *"Unlock
first if held — a locked worktree cannot be removed even with --force"*), and `cleanVerifyScratch`/`removeVerifyScratch`
(`src/broker.mjs:1089`, `:1117`) call it with the intent of tearing scratch down. So the **record** of the quarantine is
load-bearing, not the lock: a verdict of `foreign`/`unknown` must be checked by the removal verbs themselves, and the
lock is the defence against the plane this item is about (F11).

**D-d — Never call bare `git worktree prune` from a decision path.** Three options were weighed (§6); the accepted
shape is: delete the unconditional `pruneWorktrees` at `src/broker.mjs:1167` and `src/worktree.mjs:667`, make
`removeClaimedWorktree`'s teardown (`src/worktree.mjs:1326`) prune **only** the registration of the tree it just
removed (i.e. nothing, since `git worktree remove` already clears its own — that call is what turns a targeted
teardown into a whole-ledger sweep), and keep any surviving prune behind **both** an allow-list of roots and git's own
age gate (`--expire`, measured P8). If a bare prune is kept anywhere for operator use, it is a **named verb**, not a
side effect of the sweep.

**D-e — N is never silent.** The prune count and the quarantined set go out as diagnostics in the sweep's existing
vocabulary (`onDiagnostic`, `keepReason`s defined by ROADMAP 76 — 266's Do-not list requires that vocabulary stays),
raise an attention row when N > 0 (232's acceptance names `src/attention.mjs`), and the count appears in
`tools/broker-serve.mjs --status`. `tools/instrument-provenance.mjs:130` already prints
`git worktree registrations: N` on every run, and `:133` already warns that *"a checkout with ZERO worktree
registrations cannot answer a sweep question (ROADMAP 232)"* — so the before/after instrument exists and only needs the
sweep to emit the delta it can currently only observe after the fact.

**D-f — `unknown` beats `keep` beats `act`.** If the resolver cannot classify a stored seat root — the 266 case, where
the keep-guard is unreachable — the sweep **skips itself** and reports, rather than proceeding with a guard that cannot
fire. This is the rig's own principle, "DEGRADE TO UNKNOWN, NOT EMPTY" (`docs/ROADMAP.md` #4058 addendum to #3575) and
"a cheap signal may ACCEPT but must never DECIDE" (#3575): a `[]` from a non-strict read is a cheap signal that must
never decide a destructive act.

## 5. Failure modes, each with a recovery path and the probe that falsifies it

| # | Class | Failure mode at the seam | Recovery path | Falsifiable probe |
|---|---|---|---|---|
| F1 | hard | The sweep's prune erases a foreign registration; evidence for 209-214 is gone (232; 36 → 1, twice) | Quarantine instead (D-c). If it already happened: **refs survive a prune** (P9/P10), and the pre-move ledger is committed at `docs/incidents/evidence-2026-10-24-windows-ledger.txt` (84 lines) — that file **is** 212's input list | A demo plants a foreign-shaped registration, runs the sweep, asserts it survives and that a `quarantined` diagnostic named it |
| F2 | silent | The `seat-root` keep-guard no-ops after a host move (`classifyWorktrees` exact string equality, `src/broker.mjs:988-1010`) | D-f: the sweep **refuses and reports** when any stored root is foreign-shaped, per 266 | `node tools/rig-portability-audit.mjs --self-test` — **but it is not honest today**: measured `SELF-TEST PASS … for a foreign-OS root: not-terminal` (exit 0). It asserts the classifier's *current behaviour*, so it certifies the hole and reads as an all-clear. The self-test must assert the protective property (foreign root ⇒ sweep refuses), which makes it **red until 263/266 land** |
| F3 | silent | A prune happens and nothing records how many rows went (232: "a silent N is how this went unseen twice") | D-e: diagnostic + attention row + `--status` count | A demo asserts the sweep emits `pruned:N` / `quarantined:M` with the names |
| F4 | partial | Read succeeds, then the tree changes before the act (another writer, or an out-of-band delete) | Act **per name** with a verdict attached, re-read the ledger afterwards and report the delta; never act on a set computed from a stale read. Idempotent: a second pass on an already-cleared row is a no-op | A demo removes a row between the read and the act and asserts the act is refused for that name, not applied to a neighbor |
| F5 | loop | Quarantined rows never clear: every sweep re-reports the same M rows, attention fatigue, and 212's plan never converges | Quarantine record carries owner + `reviewBy`; an operator verb (`unlock` + explicit clear) releases it; the count is a plateau visible in `--status`, not a growing list | `check`-area finding: a quarantined row older than its `reviewBy` is surfaced as attention, so the loop is bounded and visible |
| F6 | cascade | A lock strands a reapable tree: git's `worktree remove` refuses a locked row (P7), so a row the sweep quarantined and later becomes reapable can be stranded, and a viewer or the harness sees a permanent `locked` row it did not put there | The quarantine must be **recorded as ours** (name, verdict, reason, time), so a later sweep can distinguish "our quarantine" from a user's lock, and may unlock a row it quarantined once the path resolves on this host again | A demo quarantines, re-creates the directory, and asserts the sweep re-claims rather than skipping it silently |
| F11 | cascade | **The quarantine is defeated by our own verbs**: `removeClaimedWorktree` unlocks before removing (`src/worktree.mjs:1207-1229`), and `cleanVerifyScratch` / `removeVerifyScratch` (`src/broker.mjs:1089`, `src/broker.mjs:1117`) call it deliberately, so a `foreign`/`unknown` scratch-shaped row can be unlocked and torn down by a verifier finishing its run — the lock holds against `prune` (P4) but not against the product | The quarantine **record**, not the lock, is the authority: the removal verbs consult the verdict and REFUSE with a named reason (the rig's existing refusal style — every guard names its verb), and the lock is belt-and-braces for the prune plane only | A demo quarantines a foreign-shaped scratch-named row, runs `cleanVerifyScratch`, and asserts it comes back in `kept` with the verdict as the reason |
| F7 | contradiction | git says a row is `prunable`; our resolver says `unknown` or `foreign`. Two parts disagree | **Explicit arbitration (D-f): git's verdict may never win against a keep.** git's `prunable` is a *candidate*, not an authority — the literal instance of "a cheap signal may accept but never decide" | A demo makes a foreign-shaped row `prunable` in git's eyes and asserts our verdict keeps it |
| F8 | cascade | The demo suite run from a real checkout prunes that checkout's ledger — the incident's actual mechanism, because the harness cannot see the broker's own call (241's *Do not*: "the broker's own `pruneWorktrees` call runs where no outer extension can see it") | D-d removes the unconditional calls, so a suite run has no unscoped prune to perform; interim: keep 232's rule that the working checkout is never the experiment (disposable clone) | A demo asserts that a teardown of a scratch tree does **not** change the count of registrations unrelated to it (today `src/worktree.mjs:1326` guarantees it does) |
| F9 | context | A path value survives from another OS and is trusted: `resolveSeatRoot` returns a persisted cwd unconditionally (`src/seatroot.mjs:29`), and `classifyGitRoot` calls that phantom `main-worktree` (`:49-61`) — a seat is told it is in the live tree while its tools aim at nothing | 263's `{root, source, kind, reason}` validating each layer, host-conditional folding (263's blind spot: `sameRoot`'s Windows case-folding is load-bearing, so the seam must not "normalize everything to POSIX") | 263's acceptance fixture: persisted cwd built on the **other** OS → red, naming seat, path, shape and OS |
| F10 | loop | A guard built by **verb-matching** (`git worktree prune` is denied textually) silently stops firing — the Copilot-CLI class 241 collected (#2893 timeout→allow, #3590 ask auto-approved, #2540 hooks never fire, #5098 a sandbox change kills `sessionStart`), all `advertised-elsewhere` | Do not build this by intercepting the verb; make the plane unreachable (D-d). 241's Codex finding is the transferable shape: `core-plugins/src/git_policy.rs:7-85` defends git by **reachability**, redirecting `GIT_DIR` at a throwaway repo for automatic git (`docs/reviews/codex-enforcement-design-2026-10-28.md` §3) | A demo asserts no production code path contains a `worktree prune` invocation without an allow-list argument — a source-level guard, since a runtime guard on our own broker-to-itself call is unenforceable |

## 6. Options considered

**A. Quarantine only (git-native, no product change).** A move step locks every foreign-shaped registration, so any
bare `prune` — ours or a viewer's — skips them (P4). *Cost:* one runbook step plus a small tool. *Risk:* protects only
what was locked before the first prune; the sweep still prunes unscoped, so F1/F8 stay live for anything unregistered
yet. *Reversible:* fully (P5).
**B. Scope the plane (D-a…D-f).** One reader, computed verdicts, act-per-name, quarantine the rest, report N. *Cost:*
touches `worktree.mjs`, `broker.mjs`, `attention.mjs`, and depends on 263's resolver. *Risk:* more code in the most
safety-loaded path we have; a wrong verdict can strand trees (F6). *Reversible:* yes per-registration (P5), and the
reader extension is additive.
**C. Never prune.** `worktree audit` reports ghosts; clearing needs an operator verb. *Cost:* near zero. *Risk:* the
ghost problem is real and was fixed once (the comment at `src/worktree.mjs:643-647` cites 25 cleared on 2026-10-19) —
232's own Do-not says the fix is a scoping grant, not removal.

**Decision: B, with A shipped immediately as the interim act** (the runbook gains the lock step before B lands, because
A is the mitigation that works while the resolver does not exist). Both are reversible; C is rejected as the primary
answer but retained as the shape of the surviving operator verb. Trade-off accepted: B puts more code in the sweep in
exchange for removing the only unscoped destructive verb in the product — the rig buys a *narrower* blast radius, not a
smarter sweeper.

## 7. The 241 five-column table, for our own column

ROADMAP 241's signal-for-closure names five questions per harness; the Codex and Copilot-CLI columns already exist in
`docs/reviews/codex-enforcement-design-2026-10-28.md` (§1 rule layers and who can write them, §2 fail-open vs
fail-closed, §3 the git plane by reachability, §4 whether decisions are recorded) and
`docs/reviews/codex-permission-model-and-guard-plane-2026-10-28.md`. This note adds the **durian-pi column for the
prune plane**, which is the plane 232 is about:

| Question | durian-pi today (cited) | After the design in §4 |
|---|---|---|
| Where does the rule live? | Nowhere declarative: it is a side effect in code at `src/worktree.mjs:649`, invoked at `src/broker.mjs:1167`, `src/worktree.mjs:667`, `src/worktree.mjs:1326` | A verdict computed by one resolver; the allow-list is a **caller-supplied argument** (232's wording), and the quarantine lives in git's own admin dir as a `locked` row — readable by `git worktree list --porcelain`, i.e. out-of-band from our store, the way Codex persists hook trust (`docs/reviews/codex-enforcement-design-2026-10-28.md` §1) |
| Who can bypass it? | Any seat, accidentally, by running the product's demo suite from a real checkout — the measured mechanism of the 36→1 collapse | The bypass must go through the resolver, so a bypass is an explicit verb with a name; a seat cannot reach a bare prune by calling the sweep |
| What happens when the guard breaks? | Fail-**open** toward destruction: a non-strict read yields `[]`, the sweep reaps nothing, **and the prune still runs** (`src/broker.mjs:1066` + `:1167`) | Fail-**closed** toward keeping: resolver unknown ⇒ the sweep skips and reports (D-f). This is the axis §2 of the Codex note says decides the design, and today durian-pi sits on the wrong side of it for this one verb |
| Is the decision recorded where a reviewer can read it? | No: `pruneWorktrees` returns `{pruned:true}` and every caller ignores it | Yes: `pruned:N` / `quarantined:M` diagnostics in ROADMAP 76's vocabulary, an attention row, a `--status` count, and `tools/instrument-provenance.mjs`'s registration count as the before/after |
| Does a repo commit propagate the guard? | No — and a commit is what *lost* the last guard: the harness-side guard is not in the product, and `.gitignore`'s `.scratch/` entry records instruments lost to a sweep | Partially, and deliberately so: the **allow-list rule and the verdict live in the repo** (code + demo + this note), while the **quarantine state lives in git's admin dir** (machine-local like `locked`, never committed). Do not commit quarantine — a foreign machine's lock is not this machine's fact. |

## 8. Gate on 232: what it may and may not do

232 is now buildable against a named shape. What it must inherit, in order:

1. **263 lands the resolver first.** A scoping grant cannot be computed by a normalizer that is not host-qualified;
   building 232 on `norm` would add the forbidden fourth normalizer. (lead's published order is `217 → 263 → 264 →
   221/265 → 266 → 267` with 232 gated on this note, so this constraint is already consistent with it — flagged for
   lead to confirm, not decided here.)
2. **266's skip-on-unresolvable lands with or before 232**, because it is the guard that keeps 232 from being an
   emergency while §4's verdict does not exist yet.
3. 232 then implements D-a/D-b/D-c/D-d/D-e, with 232's own acceptance kept verbatim: a prune that would clear a
   registration outside the caller's roots **refuses and names it**; `--dry-run` prints the exact list; a demo plants a
   foreign registration and asserts it survives a sweep **and a removal**; the `pruned` count reaches
   `tools/broker-serve.mjs --status`; and a test run that changes the **main** checkout's ledger fails unless that
   checkout is the one it owns.
4. **Add to 232's acceptance** (new, from §2 and §3): the ledger reader must carry `prunable` and act-callers must be
   strict; and the quarantine must be recorded with an owner so F6's stranding is recoverable.

## 9. What this note did not do

No product code, no demo run against the shared checkout or the live store, no 232 build, no queue adjudication. The
probe scratch under `.spike/probe-4846/` was deleted after capture (gitignored, and left clean per the cleanup rule).
241 remains **not closed** on the roadmap's own terms — the unread Codex files it lists (`permission_profile_catalog.rs`,
`permissions_toml.rs`, `requirements_layers/permissions.rs`, `permission_path.rs`, `network_policy*.rs`,
`requirements_exec_policy.rs`, and where `plugin_trust` is persisted) are still unread; this note needs none of them, and
the out-of-band-trust claim stays `advertised-elsewhere` until that file is found. F5's `reviewBy` mechanics ride 263's
`reviewBy` defaults row (#3050), not a new one.
