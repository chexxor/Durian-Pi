# Security position — verifier "read-only": guarantee or convention (item #3613, lead #3609 finding)

- **Date:** 2026-10-19 · **Owner:** seat `security` · **Decides:** what durig has actually guaranteed about verifier read-only confinement
- **Measured finding (scribe #3609, not inferred):** `VERIFIER_REMOVALS = [write, edit]` only
  (`src/seattools.mjs:193`); a verifier keeps `shell`; `verifierEnv` refuses the FILE API but its `exec`
  wrapper pins cwd and strips env while LETTING ANY COMMAND RUN (`src/confine.mjs:497` comment +
  `demo/confine.test.mjs`, which proves both halves in one suite); the disposable-copy premise is
  **promised** by the docstring (`confine.mjs:536` "confined to a DISPOSABLE COPY") but **not produced**
  by the wiring — `makeSeatEnv` passes the seat's real root (`src/seattools.mjs:255`).
- **Agreed design antecedent (docs, read this session):** `docs/SEAT-TOOLS.md` records the 2026-10-11
  decision that denying "any `exec` that writes" is **undecidable for a shell** and that SC2 is therefore
  resolved as a SNAPSHOT — plus SC3's promise that host non-negotiables (wsl/docker/destructive git) are
  refused **structurally in `exec`**, never by string match.

## (a) Verdict: today it is a CONVENTION wearing a guarantee's name — decompose it, then finish the guarantee

Property-by-property, because one word ("read-only") is now hiding three different facts:

| Property | Today | Falsifiable basis |
|---|---|---|
| Verifier's FILE API cannot write | **GUARANTEE (enforced)** | `readOnlyGuard` refusal + demo half 1 (`confine.test.mjs`) |
| Verifier's exec is stripped of env, cwd pinned | **GUARANTEE (enforced)** | `verifierEnv` (`inheritEnv: false` overridden deliberately, `confine.mjs:497-530`) + SC3 |
| Verifier's shell writes land in a DISPOSABLE copy | **CONVENTION** | nothing in `makeSeatEnv` mints or verifies a snapshot; qa/auditor hold it because their worktrees happen to be scratch; `docs/SEAT-TOOLS.md` itself says the guarantee is SC2-the-snapshot, and the snapshot is not wired |
| "A verifier cannot modify what it verifies" (the property everyone means) | **NOT A GUARANTEE at all** — already FALSE for two seats | designer `24b7fc9` and advocate `7387716` are verifier-CLASSIFIED (substring role-text match in `src/verifierrole.mjs` `VERIFIER_TERMS`) and COMMIT on main via persistent worktrees |

The classification is the active defect today, not a future risk: `VERIFIER_TERMS` substring-matches
name+role text, so "design reviewer" and "UX reviewer" classify as verifiers while being advisory
PRODUCERS. The latent path lead named (first certifying seat in a persistent worktree) rides on the same
unclocked seam: `makeSeatEnv` will happily snapshot nothing. So: AGREE with lead's
LATENT-CRITICAL severity read for the certifying seats, and RAISE the misclassification itself to ACTIVE
(not latent): it already means "verifier-class" is not a truthful label for two seats.

## (b) Answer: make it a GUARANTEE — with the composition that preserves the verification oracle

The oracle constraint (a verifier MUST run `node demo/<name>.test.mjs`) rules out removing `shell`; and a
read-only shell is undecidable (docs' own 2026-10-11 record). The minimal enforcement is therefore
**structural, not lexical** — the same verdict shape as my control-plane gate (#2220): prevent what a
boundary can decide structurally, detect the rest, and label honestly.

1. **C-1 (the load-bearing fix): the harness mints the disposable copy.** For any seat that is
   verifier-classified, `makeSeatEnv`/the seat env MUST bind to a snapshot scratch root minted by the
   harness (named in the verify-scratch inventory + registered for reaping), NOT the caller-supplied
   root; a persistent root MUST be refused for verifier binding. Probe: forge a verifier seat whose
   roster root is its item worktree — the resulting env root is a fresh scratch path, and the refusal
   lands structured (`verifier_requires_snapshot`). `node_modules` is junctioned into the scratch so the
   suite runs; the existing reaper (terminal+clean scratch) is the teardown.
2. **F-2 (fix the classification truth): verifier = seats whose PRODUCT is a verdict** (qa, qa2,
   auditor), set explicitly in the roster — `VERIFIER_TERMS` substring matching is replaced or fenced
   with an explicit advisory-producer exclusion so designer/advocate become AUTHOR seats again. Probe:
   `check` prints per-seat classification; designer/advocate must show author-class. This is REQUIRED
   for C-1: minting scratch for real producers would break their work.
3. **D-3 (detect-and-layer, from my #2220 shape):** every verify entrance records the bound root in the
   item's evidence; `checkup` flags any verifier-class execution whose recorded root is outside the
   scratch inventory — so convention decay is VISIBLE, never silent. Probe: a deliberate
   persistent-root verifier run makes `check` report it by name.
4. **E-4 (best-effort exec layer, never a promise):** extend the existing exec refuse list with the
   mutating shapes (commit/amend/branch-force/push/tag, `git -C <shared path>`) — valuable as a layer,
   and DEFEATABLE by the shell's own admission (aliases, `-EncodedCommand`); it is never the guarantee
   (SEAT-TOOLS' structural-refusal promise applies to the host non-negotiables, which stay).
5. **H-5 (honesty in docs, immediate, before any code):** SC2's row in `docs/SEAT-TOOLS.md` states the
   three-fact table above verbatim (file-API enforced; env discipline enforced; shell-write
   isolation = disposable-by-scratch — convention until C-1), and the capability profiles stop reading
   "read-only" unqualified.

**Verdict sentence for the record:** verifier isolation = **enforced file-API refusal + enforced env
discipline + a disposable-root guarantee that must land under C-1, with F-2 classification truth and
D-3 detection as conditions of the word "guarantee".** Everything else — shell-internal writes inside
the scratch — stays a convention ON PURPOSE, because that is what "disposable copy" means.

## (c) What to write down today (whatever the implementation date)

Until C-1/F-2 land, the docs and capability profiles must say: *"verifier read-only is enforced at the
file API and env layers; the write-isolation of shell activity rests on the verifier working in a
disposable scratch (policy, reaped, audited), and is not a confinement guarantee."* No verification
argument may cite the current state as a guarantee — this position is that citation's rebuttal.

## Non-goals

Not a low-privilege OS account (SEAT-TOOLS' strongest option; out of scope until the split-writer/daemon
era reopens it); not making exec provably read-only (undecidable; do not build a string-grammar castle);
not the codemode capability work (docs/CODEMODE.md); not re-opening the approval protocol (ROADMAP 149).
Sequencing per lead's note: this MUST NOT preempt the active-bug cluster — register C-1/F-2/D-3/E-4 as
items; H-5 alone is doc-only and can land any time.

## Citations

`src/seattools.mjs:141,187,193,206,220,239,255`; `src/confine.mjs:497-539` (exec comment; docstring
promise; `authorEnv`/`verifierEnv`); `src/verifierrole.mjs` (`VERIFIER_TERMS`, substring match);
`demo/confine.test.mjs` (both halves proven); `docs/SEAT-TOOLS.md` (SC2 row; 2026-10-11 snapshot
decision; SC3 structural refusal); scribe #3609 measurement; designer `24b7fc9` / advocate `7387716`
(committed by verifier-classified seats); #2220 position (detect-and-layer); `src/worktree.mjs` reaper
(P2 cleanup: reaps terminal+unlocked+clean worktrees — the scratch teardown already exists);
docs/runbooks/ + `docs/incidents/2026-10-17-*` for the mid-merge history behind verifierrole's ONE
definition rule.
