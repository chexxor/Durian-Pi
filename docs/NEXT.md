**Last update:** 2026-11-14 (delegate). Every shipped commit in this milestone is a ROW below, **in commit order** —
enforced by `node tools/pointer-sha-coverage.mjs --base 03bdbf4d` (0.2-0.6 s, exit 0/1), not by eye. The ONE exempt
commit is the one carrying this file (`git log -1 --format=%h -- docs/NEXT.md` names it); a session that edits this file
adds the previous carrier as a row or the tool fails. Nothing pushed — the push grant is the operator's.

**Milestone this window worked** — **the unlanded-ref residue (the work-item lifecycle, D265; ROADMAP 347 "Milestone
closure is prose")**: 46 refs landed by rule, 40 held. Every commit in `03bdbf4d..HEAD`, oldest first:

| sha | shipped |
|---|---|
| `851c3e9c` | docs(runbook): broker-down-or-stalled.md - the he… |
| `8c0de873` | #5065: runbook row - a thin item worktree CAN run… |
| `d34b15d1` | feat(tools): landing-closure probe (#4378) — a ro… |
| `a15a5a48` | docs(dispositions): ledger row superseding #5611'… |
| `6c8b0320` | #7601: re-anchor the stale G11 line pin in the sa… |
| `5140de6e` | docs(roadmap+dispositions): #5501 — RM-318 closes… |
| `d04f124d` | docs(spec,#7615): make the landing spec's numbers… |
| `e375f724` | docs(dispositions): #7353 - register scribe-item-… |
| `655c44e2` | N19 pool row 3: revise_work can annotate `require… |
| `1782b495` | N19 pool doctrine: one paragraph in the shared co… |
| `4ed6b8d0` | N19 pool tranche 1: read-only pool-migrate propos… |
| `517dc58d` | N19 row 5 seam: usableContextBudget falls back to… |
| `bfa0472e` | #5347 landing preflight: refuse on dirt the landi… |
| `9780b0bf` | #5347 runbook (docs/runbooks/land.md): the pre-fl… |
| `c91b3550` | docs(dispositions): #7371 - register scribe-item-… |
| `3c9e6337` | docs(runbook): #7371 - land.md's remaining H2->H4… |
| `36f57a36` | pool-migrate: read the roster through the seats D… |
| `69a63baf` | docs(dispositions): #7372 - register scribe-item-… |
| `657d8c60` | merge: land win/item-4786 onto main |
| `c0f4709a` | #5459 runbook: the landing gate trips over the sp… |
| `a6d2b6e7` | docs(decisions): #7373 - D122 mint status recorde… |
| `06b5d2ec` | docs(dispositions): #7373 - register scribe-item-… |
| `99250682` | N19 pool: record what shipped and was measured, a… |
| `78bc0364` | pool: the live check finding on #7660, and the tr… |
| `55d2fba1` | docs(runbook): #7374 - land.md's lock figures are… |
| `dea8f63f` | docs(dispositions): #7374 - register scribe-item-… |
| `1c0c5920` | pool: the gate is proven on the real roster, and … |
| `2bfb9e43` | NEXT: the resident broker predates the skip-line … |
| `f6177f21` | pool: narrow the annotation authority back to the… |
| `02105352` | pool: print the refusal, record the LIVE roster r… |
| `784bc2a9` | docs(runbook): #7375 - land.md's KEEP-ALL-SECTION… |
| `a5fff83c` | docs(dispositions): #7375 - register scribe-item-… |
| `c4b0ea7e` | pool: the gate refusing a project row from a byte… |
| `d37bd216` | pool-gate-live-roster: the header still carried t… |
| `5363e377` | NEXT: the sha table now names c4b0ea7e and d37bd2… |
| `9caf9638` | #5819 runbook worktree-unlinked-deps: the pi-sche… |
| `3f3de023` | #5819 runbook land.md: a landing proof is a tripl… |
| `ac6b7a8a` | pool: the lifecycle doc stops contradicting the v… |
| `2e5e8f18` | feat(landing): one queue split rule for the row s… |
| `4f9e87d9` | pool: the LIVE scheduler now refuses #7700 by nam… |
| `8abc961e` | NEXT: record the one 336/337 flake (restart-limit… |
| `44da626c` | docs(test-areas): map demo/tui-queue-split.test.m… |
| `35ff79f2` | NEXT: the broker record is five windows with the … |
| `7008d11d` | NEXT: re-cut to 115 lines / 8.8 KB — the clockin … |
| `1f6605db` | docs(dispositions): #7376 - register scribe-item-… |
| `446c4084` | pool: the gate FIRED on two live seats — #7700 re… |
| `06de1bba` | pool: delete the sentences that denied the live f… |
| `a8bd182b` | docs(runbook): #7377 - date the race/lock measure… |
| `28004fd0` | docs(dispositions): #7377 - register scribe-item-… |
| `18c7a3b8` | NEXT: pool census re-read (5 pooled / 3 open; arc… |
| `8135b68c` | docs(reviews, #5854): re-measure #4922's addendum… |
| `f52b05e0` | fix(genlock, #5020): the lander's live-holder pro… |
| `88ec4aeb` | docs(runbooks, #5020): land.md states what the la… |
| `3fb50030` | pool: record the pause/unpause evidence and when … |
| `5b8e3644` | NEXT: the sha table ends with a HEAD row so the p… |
| `a3e8f7d4` | docs(reviews) #7515: content probe of the 119 alr… |
| `0e6445f4` | docs(runbooks) #7515: stale-held-backlog gains ru… |
| `0de543ae` | pool: unpause the fleet, fix the time-bomb demo, … |
| `11290f1e` | NEXT: record the live window 1574499, the green -… |
| `280d6ad3` | pointer: the fleet is unpaused and seen to drive … |
| `8f4a63ce` | pointer: every shipped sha is a row, in commit or… |
| `313c525b` | pointer+pitfalls: the suite numbers at HEAD, the … |
| `54fa9649` | pointer: the re-leased window 1903310 is the one … |
| `6f478c69` | merge: land item-4378 onto main |
| `fb056834` | merge: land item-4812 onto main |
| `847bb984` | merge: land item-5020 onto main |
| `fafb14f9` | merge: land item-5065 onto main |
| `1069cc89` | merge: land item-5347 onto main |
| `8b803244` | merge: land item-5459 onto main |
| `c7942ed8` | merge: land item-5501 onto main |
| `dd7615a0` | merge: land item-5825 onto main |
| `f0beb3d5` | merge: land item-7515 onto main |
| `bc90acb9` | merge: land item-7601 onto main |
| `33cee497` | merge: land item-7615 onto main |
| `a0caa286` | merge: land item-5819 (append-only ledger conflic… |
| `1977e058` | merge: land item-6002 (append-only ledger conflic… |
| `70ae5124` | merge: land item-7371 (append-only ledger conflic… |
| `03e3fe9d` | merge: land item-7372 (append-only ledger conflic… |
| `d1e78382` | merge: land item-7373 (append-only ledger conflic… |
| `81b77238` | merge: land item-7374 (append-only ledger conflic… |
| `007cca82` | merge: land item-7375 (append-only ledger conflic… |
| `9e9dab59` | merge: land item-7376 (append-only ledger conflic… |
| `45ef4633` | merge: land item-7377 (append-only ledger conflic… |
| `94f21a75` | merge-correction: place the #5819 runbook additio… |
| `8d3f3dad` | merge-correction: restore the trailing newline th… |
| `82a3c51d` | merge: land landing-20261114 onto main |
| `ab96bf0b` | docs(dispositions): landing pass 2026-11-14 — 20 … |
| `16166492` | docs+tools: landing-pass pitfalls 330-333 and the… |
| `dd47ef89` | the pointer rewrite: the landing pass, 20 refs landed, item-6959 held, suite 341/341 |
| `f3f72792` | docs(NEXT): the sha table names every commit in 03bdbf4d..HEAD (92 rows, tool-verified) |
| `94eddcdd` | docs(NEXT): condense the pointer to 197 lines (the 200-line cap) + the previous carrier row |
| `3c6d01fc` | docs(NEXT): suite numbers at HEAD, the pm route, pointer within the cap |
| `cf42a577` | docs(decisions): D265 addendum — a conflicted ref is an anchor collision, not a verdict |
| `62dee2d1` | fix(tools)+docs: branch-census mirrors the broker's `LIVE_STATUSES`; the prune pass, pitfall 334 |
| `43223085` | merge: land landing-20261114-docs onto main — 43 conflicted refs union-resolved by rule, 37 colliding `## D<n>` re-minted D275..D311 |
| `06cd45ae` | merge: land landing-20261114-c4 onto main — `item-4821`, `item-7702`, `item-7272`, containment proven |
| `28690eb8` | feat(tools): chain-resolve + conflict-resolvability + merge-containment-proof, `demo/chain-resolve-rules.test.mjs`, 40 held-ref dispositions, pitfalls 335–338 |
| `b3365b1c` | feat(tools): `conflict-hunk-shape` — hunk-level taxonomy of every conflict; the DISPOSITIONS count elision that turned `check`/`doc-count-drift`/`starter` green |
| `78666643` | docs(pointer+SELFDEV): the pointer re-cut under the 200-line cap, pitfalls 339–340, suite 346/346 in 152.0 s |
| `26f35059` | docs(dispositions): the seven wording-only hunks read in full — stale imports, provenance, one superseded pin |
| `38deb7d1` | docs(pointer): rows for the two previous carriers, the run-list counts re-measured, pointer at 199 lines |
| `3d07f9f5` | docs(pointer): the suite number at this HEAD, the POOL-QUEUE-SPEC pointer folded into the pool row |
| `1a60386b` | docs(SELFDEV+NEXT): pitfall 343 (DECISIONS.md D265/D266 collide; `tools/probes/adr-number-collisions.mjs` exit 1), pitfall 342, suite 346/346 in 154.6 s |
| `e6aad7a5` | merge: land landing-20261114-docsonly onto main — `item-6537`, `item-6549` union-resolved by rule, containment proven 0 loss, docs area 8/8 |
| `f2959764` | tools+docs: `chain-resolve` rules 8–9 (import union + link proof, provenance union), classes `I`/`P` + `--with-text` in `conflict-hunk-shape`, DISPOSITIONS correction, pitfall 344 — check 15/15 in 5.6 s, suite 346/346 in 151.6 s |
| `8b5a19e1` | merge: land landing-20261114-c10 onto main — `item-6173` (seat restart limit 3 at the `openHarness` seam) + `item-6238` (pi-pin / unlinked-deps runbooks), containment proven 0 loss, suite 347/347 in 153.9 s |
| `4b52ecc8` | tools(ref-recut --refresh, conflict-blocks --full/--census): the re-cut instruments, measured 25 refs in 4.7 s |
| `1751a3c2` | merge: land item-6343/6374/6435/6664/7090 recuts (scripts/land.mjs --changed-suite, derived gate 73/354 green) |
| `a9b0d007` | absorb 9 refs whose added lines are already in main verbatim (tools/absorb-refs.mjs; tree unchanged, refs kept) |
| `af86fefe` | docs+tools: absorb-refs.mjs, disposition-rows.mjs, merge-containment-proof --all-lost; 19 disposition rows + verbatim residue |
| `1872bc25` | docs(NEXT): the conflict pass closed out — 19 ancestors, 17 held with residue; the self-merge seam is next |
| *(this commit)* | docs(NEXT): the two rows above — exempt, a file cannot name the commit that carries it |

**Broker windows.** A window is a LEASE leased from OUTSIDE: `--max-duration` is checked only at the top of the broker
loop (`src/broker.mjs:2058`), so a pass in flight starves it. Open every window as `nohup timeout --signal=TERM
--kill-after=60 <N> node cli.mjs serve --max-duration 3600 &`, then `node cli.mjs resume` before closing. Liveness is
the last ` PASS ` line (pitfall 304), never the pid.

**The fleet is UNPAUSED and was seen to DRIVE.** Closed at **`00:19:28Z`** by `node cli.mjs unpause`, verified on a
**broker** `status --json` (never `--local`; pitfall 326): `control {paused:false}`. Re-read the state, do not trust this line.

**Host for every number here** (measured with the measurement): **Linux**, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node **v24.22.1**, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** **the conflict pass — 36 conflicted refs as of main `8b5a19e1` are now closed out: 19 are ancestors
of `main` with `tools/merge-containment-proof.mjs` reporting 0 loss, 17 are dispositioned with their verbatim residue
recorded, nothing pushed, no ref deleted (R-B #3270).** As of main `af86fefe`:
- **5 landed through `scripts/land.mjs`** (`item-6343`, `item-6374`, `item-6435`, `item-6664`, `item-7090`) —
  `node scripts/land.mjs item-6343-recut item-6374-recut item-6435-recut item-6664-recut item-7090-recut --db ./selfdev.sqlite --changed-suite` → `ok:true`, derived gate 73/354 green, main `1751a3c2`.
- **9 absorbed** (`item-5002`, `item-6177`, `item-6268`, `item-6314`, `item-6326`, `item-6336`, `item-6562`, `item-6643`, `item-7158`; `item-7448` came along as an ancestor of 7158) — every line they added is already in main verbatim, so the merge takes main's tree. Instrument: `node tools/absorb-refs.mjs --refs a,b` (10 refs, 1.5 s); proof it changed nothing: `git diff --quiet refs/heads/main 1751a3c2` exit 0.
- **17 held** with a row in `docs/DISPOSITIONS.md` and the verbatim hunk in `docs/evidence/2026-11-14-recut-residue/<ref>-residue.txt`; regenerate with `node tools/disposition-rows.mjs --refs a,b --out docs/DISPOSITIONS.md` (19 refs, 3.0 s). `item-7018` is flagged byte-equivalent to `item-6184` — resolve once.

**Two things the next session must not re-derive:** (a) an R5 "both sides" union of two evolutionary versions of the *same* statement is a **regression**, not a merge — `item-6374` landed a duplicate assertion and a stale "24 rules" doc line that the gate caught; always land with `--changed-suite`. (b) `item-3570`'s recut is blocked by a real defect, not a merge conflict: the harness rejects `revise_work` with `blockedBy: unknown field` even though `src/rig.mjs` lists `blockedBy` in the tool's `parameters` (probe: `node .spike/probe-3570.mjs`).

**Not started — the second half of this goal:** the seat **self-merge seam** on the extension plane (D212; the seam to grow is `scripts/land.mjs`'s #4247 shared-root guard, which refuses a landing run from an item worktree), an SLA instrument that names ready-but-unlanded refs, a `cli.mjs check` rule that goes red on a stale ready ref, and a `fauxProvider` demo proving a seat's own item becomes an ancestor of main.

**Older current item, still true:** the **N19 pool is CLOSED** — the gate fired on live seats (#7700 refused by
`architect` and `pm` as `too-big`); re-read it with `node .spike/pool-rows.mjs ./selfdev.sqlite` (1.2 s, read-only). Read
`docs/POOL-QUEUE-SPEC.md` **§13, §13.3b, §13.4** and `docs/reviews/2026-11-13-capability-ownership-ruling.md` (FIVE
decisions) before touching the pool; the window seam is in `src/config.mjs` (`usableContextBudget`), a SEAM (D212).

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
timeout 120 node tools/conflict-blocks.mjs --census                       # ~0.4 s — every recut worktree still marked
node tools/absorb-refs.mjs --dry-run --refs <the refs whose proof says 0 loss>   # ~0.15 s/ref
node cli.mjs worktree audit --json                                            # ~1 s
node scripts/land.mjs <branch> --db ./selfdev.sqlite --changed-suite         # ~80-106 s — the gate, not a suggestion
timeout 320 node scripts/test.mjs --all --jobs 4                            # ~121-152 s
node cli.mjs check rig.selfdev.json                                         # ~20 s — MUST name the rig: bare `check` audits ./rig.json
node tools/pointer-sha-coverage.mjs --base 03bdbf4d                         # 0.2 s — exit 1 if this file skips a shipped sha
```

**Blocker:** the mechanical lane is **exhausted** — 46 refs landed, **40 still conflict with `main` and cannot be merged
by rule**. Measured hunk by hunk (`node tools/conflict-hunk-shape.mjs --refs <held> --json .spike/hunk-shape.json`, 2 s):
**175 hunks — 128 semantic, 34 paraphrase, 4 stale-number, 4 unionable, 2 append-collisions; zero of the 40 fully
mechanical.** Seven have no semantic hunk at all (`item-5301`, `item-5301-resolved`, `item-6173`, `item-6211`,
`item-6343`, `item-6643`, `item-6664`) — reading them in full shows they are stale imports and provenance disputes, not
wording (`docs/DISPOSITIONS.md` addendum below); `tools/chain-resolve.mjs` refuses them with "anchor/edit not locatable".
The other 33 are an author re-cut per docs/runbooks/branch-cleanup.md Step 0b/0d, all 40 recorded row-by-row in
`docs/DISPOSITIONS.md` ("Conflict-resolution pass, 2026-11-14"). `item-7232` is the sharpest case: it merges cleanly but
its failing-first test is red without `item-6556`'s `src/rig.mjs` change, which is itself conflicted — land the pair or
neither. The census reports `needsLanding: 0`; the residue is the 40 held refs, not unlanded clean ones.
(2) **No pool migration is applied** — the tool stays a proposal. The dry-run's tranche names non-owner claimants for
most proposed rows (105 of 165 at `00:2xZ`; re-run, the team keeps minting; list `.spike/pool-ownership-gaps.txt`).
#7660 needs its author (`lead`) or `pm` to clear `requires:"docs"` (`check` reports `pool-dead-gate`).

**The suite, with seconds.** At `38deb7d1` (this pointer): `--all --jobs 4` → **346/346 in 150.4 s** (Linux Fedora 45,
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1); slowest `runbook-diagnose` 58.8 s, `clockin-digest` 24.3 s. At
`28690eb8` it was 342/345; the three red (`check`, `doc-count-drift`, `starter`) had ONE cause — a ledger row quoted a
`check` rule count and `doc-count-drift` read the quotation as a live claim (the code declares 27). Eliding the number
turned all three green. The `--jobs 4` flake in `demo/restart-limit-behaviour.test.mjs` is contention-driven
(`--jobs 2` is the reproducible green): a red at `--jobs 4` is not a defect — re-run the named test alone.

**Known red:** `node demo/offline.mjs` exits **1** — `ASSERT FAIL: the fresh context should be short, got 7 messages`
(pm's #6924) — recorded, not touched. `demo/priority-directive-scope.test.mjs` went red on a hardcoded `expiresAt`;
**fixed** (time-relative), lesson pitfall 327.

**Operator decisions owed.** (a) **Do not grant a blanket "main wins" rule for the seven wording-only refs**
(`item-5301`, `item-5301-resolved`, `item-6173`, `item-6211`, `item-6343`, `item-6643`, `item-6664`). Read every
hunk in full (`.spike/noE-full-hunks.txt`, 2 s): four of them are `cli.mjs` **import** lines naming symbols main
no longer exports (`reapWorktrees`, `runControlSettings`, `progressSettings` — zero hits in `src/`), two are
`verified_by: architect` vs `verified_by: impl` provenance plus a DECISIONS.md block, and only `item-6343` is a
provably-superseded line pin. Recommendation: route all seven to `pm` as a re-cut; the decision the operator owns
is whether the rig should mint a *union-import* rule (keep both sides, verify every symbol exists) rather than a
side-picking one. (b) pool, options in
`docs/reviews/2026-11-13-capability-ownership-ruling.md`: who may annotate `requires`; is `ownership` advisory or
enforced at claim; `devtools` vs `code`; should `send_work` refuse an unadvertised `requires`; should a pool claim
notify its author. `node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --limit 5` has NO write path by design.

**Traps this window** — `docs/SELFDEV.md` **330–343**: a landing plan is valid only against the HEAD it was computed on;
`git merge-tree` prints a tree oid on line 1 even when it CONFLICTS (the exit code is the verdict); a hand-resolved merge
that drops the trailing newline is refused by the text-integrity gate; a branch adding a demo without an area mapping is
not landable; a quoted count in a ledger reads as a live claim; a `wording-only` code hunk is a provable import union only
if the merged module exports every name it imports. Older **318–329**: `seats` LIST vs DOCUMENT roster; "armed" ≠ "fired";
a count is not a trace; `--max-duration` bounds the loop not the wall clock; a hand-written sha table skips a sha.

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)
