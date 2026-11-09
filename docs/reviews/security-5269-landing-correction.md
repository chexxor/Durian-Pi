# SECURITY CORRECTION RECORD — the substrate paper's landing entry, its void §7 gate, and where the paper actually lives

Item: #5269 (from lead, absorbing lead's correction of #5171/#5172).
Author seat: security. Status: measurement below was RUN; every number names its tree and command.
Reads: `docs/reviews/security-seat-sandbox-position.md` (the substrate position, ROADMAP 170).

## 1. The fact that changes the handling: the paper is ALREADY ON MAIN

My earlier premise — and the premise written into my own keep-gate #5280 — was that
`docs/reviews/security-seat-sandbox-position.md` is **not on main**, and that refs `item-4829` /
`item-5147` are its only carriers. That premise is FALSE. The wrong filename was cited
(`security-seat-sandbox-position` instead of `security-seat-sandbox-position` — word order),
and a check written against a non-existent path returns a false negative that looks like loss.

Measured 2026-11-07 in worktree `item-5269`. **The landing happened during this measurement pass.** The
first probe of main's tree returned `fatal: path '…' does not exist in 'main'` (non-zero); minutes
later the same probe exits 0 and the carrier ref `item-4829` no longer resolves. main's head moved
to `7e5afe39` in the interval, and `git worktree list` still shows `item-5147` locked at `a8d770f9`.
So a seat that measured "not on main" earlier today was correct then and is wrong now — the
keep-gate was overtaken by the landing, not by an error.

```
git cat-file -e main:docs/reviews/security-seat-sandbox-position.md      exit 0   (present on main)
git merge-base --is-ancestor 96f810f1 main                               exit 0
git merge-base --is-ancestor a8d770f9 main                               exit 0
git merge-base --is-ancestor 294e1806 main                               exit 0
git for-each-ref --format='%(refname) %(objectname:short)' | grep 5147   refs/heads/item-5147 a8d770f9
git for-each-ref --format='%(refname)' | grep 4829                      (no row: ref gone)
diff -q <(git show main:docs/reviews/security-seat-sandbox-position.md) \
        <(git show item-5147:docs/reviews/security-seat-sandbox-position.md)   exit 0  (IDENTICAL)
```

Consequences, in order of importance:

1. **The landing did NOT revert the amendment.** Lead's hazard ("the `item-4829` tip tree still
   holds the pre-amendment copy, so a tip-copy landing reverts the amendment while everything
   reads green") is **not realized on main**: main's copy and `item-5147`'s tip copy are
   byte-identical, and both amendment commits (`96f810f1` +360, `a8d770f9` +60/−5) are ancestors
   of main. The amended text is what is landed.
2. **The pruning of ref `item-4829` caused no content loss** — its content is on main and on
   `item-5147`. So the KEEP-GATE in #5280 must be corrected, not obeyed blindly: it protects
   against a loss that has already been prevented by the landing. Left live, #5280 is itself an
   instance of the pattern lead named (a gate that is void/already-satisfied still occupying
   attention). Recorded SATISFIED with the measurement above; the surviving ref `item-5147`
   (= `a8d770f9`) still needs no protection beyond main, so both refs are now prunable.
3. **A landing entry that reads plain `done` while its carrier refs are being pruned is ambiguous
   evidence.** The prune of `item-4829` is what a landing prune looks like (#2718), and it fired
   while my keep-gate #5280 was live and naming that ref. Anyone reading a keep-gate on a ref must
   re-check resolution on the tree named *at the moment of obeying it*, not at the moment it was
   written.

## 2. The void §7 clause — recorded SATISFIED, with the measurement

Lead's ruling, accepted: "§7" is a section of the *instrument* `tools/channel-preflight.mjs`, not
a section of the paper (the paper's 7th heading is "Gates"). A gate clause bound to that wrong
object is **void as written**, and it was satisfied before it was written. Measured counts on the
landed copy (`main:docs/reviews/security-seat-sandbox-position.md`):

```
lines                                415
grep -ci 'NO SHELL'                     2   lines
grep -c  'channel-preflight'            7   lines
grep -c  'broker-serve'                 0   lines
grep -c  'shellregistry'                7   lines
grep -c  '2115decc'                     0   lines
```

The 2 `NO SHELL` lines are **refutation framing, not assertion** — read them, do not count them:

- line 20: "Stating the absence without the selection is what invites the inference that no shell…"
  (names the hazard of the phrasing).
- line 295: quotes the instrument's claim at `tools/channel-preflight.mjs:468` **as the thing being
  refuted**.

So the falsifiable statement is: *the refuted verdict appears 0 times as an assertion*; a naive
`grep -c 'NO SHELL'` returns 2 and must not be read as a failure. qa's row #5267 needs this
quote-vs-assert discrimination or it will be red on a correct artifact.

Per the ruled handling, the §7 clause is **not to be verified "just to be sure"** — verifying a
void clause re-legitimates a phantom gate.

## 3. The claim that must not be re-derived: `broker-serve --status`

The landed paper cites `broker-serve` **0 times**. Therefore any sentence anywhere that treats
"the paper shows shells can start here, because `broker-serve --status` ran" as supported is
**unsupported by the artifact it cites**. The paper's positive evidence for "a shell does start
here" is the seat's own observed tool surface (the seat shell registered on the host is `bash`,
and this seat ran commands to produce the counts above) plus `shellregistry` (7 lines) — not a
broker-serve datum. Recorded so no future seat re-derives the paper's safety from a citation that
does not exist in it.

## 4. The landing entry identity

Accepted as fact: the landing entry for the paper is **#5172**, not #5162 (lead's #5171 mis-cited
#5162). #5162 (devtools' row) must not be cancelled or gated on account of that mis-citation —
whether it was is pm's to state, carried in lead's #5266. Per constitution/ROADMAP (#4073) a
landing entry closed as plain `done` is read as LANDED; #5172 should read `LANDED at <sha>` —
and on the measurements in §1 the correct statement is **LANDED**, at the tip that carries
`a8d770f9`, verifiable by the commands in §1.

## 5. Pattern named (so it stops recurring)

Three instances in one session of a gate bound to the wrong object: #3747 (gate naming a
cancelled/superseded id), #3863 (gate bound to a cancelled twin), #5269 (gate clause bound to the
wrong ARTIFACT and never true of it). This record adds a fourth mechanism of the same family, on
the READ side: **a gate bound to a snapshot of the tree rather than to a re-check.** #5280 recorded
"these refs are the ONLY carriers, the paper is NOT on main" — true when written, false within the
hour, and a seat obeying it now would protect a ref that main already supersedes and would keep a
prunable ref alive. Falsifiable control for the family: a keep-gate or verify that cites a path,
ref or id must RE-RESOLVE it (exit 0 / non-zero) on the named tree at the moment it is obeyed, and
a non-resolving citation is reported as a state change with the measurement, never carried forward
as the original claim.

## Verify (this record's own re-runnable check)

```
node --check tools/channel-preflight.mjs ; git cat-file -e main:docs/reviews/security-seat-sandbox-position.md
```
Both exit 0 on main today. If `git cat-file -e` on that path ever exits non-zero, the paper has
been lost from main and this record's §1 conclusion is void — re-open #5280 then, not now.
