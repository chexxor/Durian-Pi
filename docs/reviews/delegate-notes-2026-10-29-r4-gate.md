# Delegate session notes — 2026-10-29 (round-4 research gate discharged)

<!-- cite-ns: quoted -- this file quotes another file footnote namespace; tools/review-cite-check.mjs reads this marker -->
**Host/timezone, per ROADMAP 244:** `Alex-Desktop-Win10`, Fedora `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**,
`America/Chicago` (CDT = UTC−5). Session span 2026-10-29T03:0x–03:3xZ. HEAD at clock-in `8557071e`; working tree clean
except untracked `.scratch/` (1 worktree, `.git/worktrees` empty — unchanged from the previous session's inventory).

## What landed

1. **The round-4 verification gate (`docs/NEXT.md` "Owed from here") is done** → `docs/reviews/harness-r4-verification-2026-10-29.md`.
   Verdict: round 4's Task A is **not paste-able** (its `[^1]`/`[^2]` name different pages than the integrated report's),
   3 of its 4 corrections stand (1 false: copilot-cli#978 is open/reopened), and the nav-link claim is now provable at a
   source pin instead of at a URL.
2. **ROADMAP 250 and 251 registered** (delegate-registered, not scheduled): the citation-key namespace defect and its
   machine check (`tools/review-cite-check.mjs`, which absorbs 244's cheap half), and the stale "nothing is cloned" caveat
   + the out-of-set vendor in §6.
3. **`inputs/fetched/MANIFEST.md` §4 landed** — the delegate-obtained columns 249 says the research sandbox cannot
   produce, measured: 2 pages re-fetched **byte-identical** to their §1 sha256 pins, while the Cline URL rotted
   (`features/` → `customization/`); plus the three user-report issues' live state.
4. **`docs/NEXT.md` rewritten in place** (199 → 190 lines, under the 200-line cap), with the round-4 section replaced by
   the verdict and one paragraph cut **VERBATIM** to `docs/NEXT-ARCHIVE.md` under "CUT VERBATIM 2026-10-29T03:1xZ".
   `node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs` → both PASS.

## Measured this session (all re-run, not recalled)

- The six-command read-only baseline re-ran clean: `git worktree list --porcelain` (1 entry), `channel-preflight` (3.5 s),
  `broker-serve --status` (BLOCK `seat-shell-availability`, 5 notes), `queue-drain-audit` (1.0 s, 4,821 rows,
  91 non-terminal LANDING / 71 already on main, 69 orphan candidates), `latency-budget` (3.2 s),
  `instrument-provenance` + `scripts/clockin.mjs` (46 ms + 2.6 s), `harness-usage-census` (0.2 s).
- Queue census **identical** to the pointer's: 4,821 = 3,748 done / 777 cancelled / 277 held / 19 deferred; **0 claimable**;
  broker down, last pass 2026-10-28T17:09:58.308Z. `tools/vendor-pins.mjs --check` PASS at 14 clones.
- **The pointer's own probe confirms the binding constraint is spooling:** `queue --json` → **0** rows name
  ROADMAP 217/232/233/235–251.
- `.scratch/` is **not** gitignored (only `.spike/`, `.gitignore:21`); `git check-ignore` returns a match for
  `.spike/extract-pi-src.mjs` and none for `.scratch/transcript-write-bodies.mjs`. So ROADMAP 4480's
  "`.scratch/`/`.spike/` are gitignored" is half false, and **2 of the 8 instruments ROADMAP 233 calls
  "gone and unrecordable" are on disk right now, one of them one `git add` from safety.**

## What cost turns, and the shortcut for next time

1. **`docs/NEXT.md`'s 200-line cap is the tax on every pointer edit** (three failed `next-pointer.test.mjs` runs this
   session). Shortcut: write the replacement paragraph to `.spike/next-block.txt` first and splice it with a
   one-line `node` script that prints the resulting line count *before* the test runs — that turned each cycle from
   ~2 turns into 1, and the final pass was clean on the first try.
2. **Marker/anchor census was hand-run again** (three `node -e` one-liners over the three report files). This is the
   fourth session to hand-write it and the third to lose the script (233). Shortcut: this is exactly ROADMAP **250**'s
   `tools/review-cite-check.mjs`; the census this note reports is reproducible from the appendix of
   `docs/reviews/harness-r4-verification-2026-10-29.md` until that tool exists.
3. **A research report's factual claims about GitHub issues were checkable in one call each** — `api.github.com` returns
   `state`, `state_reason`, `reactions.total_count`, `comments` and the body. That is how a "two of three are closed"
   claim turned out **half false** (issue #978 is open/reopened) in ~3 s. Shortcut: any future review that cites an issue
   as evidence should carry those four fields (now in `MANIFEST.md` §4), because the *HTML* issue page is not pinned and
   the API is.
4. **Byte-reproducible ≠ findable.** The re-fetch reproduced the sha256 pins exactly and still showed the URL had moved.
   Shortcut: always record `%{http_code} %{size_download}` **plus the final URL after redirects** (curl `-L` + the
   effective URL) in the same breath as the hash.
5. **Do not run the suite from this checkout while 232 is open** (`scripts/suite.mjs:36` enumerates with `readdirSync`,
   so a deleted member is a silent shrink). Only the two executable readers of the files I touched were run — and note
   `grep -l docs/ROADMAP demo/*.test.mjs` → **no reader exists** for the roadmap or the MANIFEST, so edits there fail
   silently: that asymmetry is worth knowing before trusting "the tree is green".
6. **`clockin.mjs` printed the stale-suite warning unprompted** ("last suite: 238/238 at 2026-10-28T03:55Z … main is now
   `8557071e`") — good design; keep it. `instrument-provenance` flagged my own new note as "untracked but cited" the
   moment I wrote it, i.e. 233's detector works and fires early. Use it as a pre-commit gate, not just a clock-in probe.

## Speed proposals for the operator (no action implied)

- Land **250**'s tool before commissioning **any** further research round: every round currently re-introduces citation
  debt by hand, and the round-4 gate cost a full session to police.
- Land **233**'s decision (commit-or-discard) before the next session on either host: two instruments are still
  recoverable today, and that window is a function of nobody running a cleanup.
- The spool grant (OPERATOR OWES item 5) is the single cheapest unblock: measured 0 rows for the whole blocking cluster.

## 8. SAME DAY, SECOND SESSION (2026-10-29T03:4x–04:0xZ = 2026-10-28 22:4x–23:0x CDT, Linux, `Alex-Desktop-Win10`)

Resumed from the previous session's next step. **Built** ROADMAP 250's two delegate halves —
`tools/review-cite-check.mjs` and the alias table `docs/reviews/harness-citation-registry.md` — registered **252**,
and appended URL-liveness rows as **MANIFEST §6**. No report prose was rewritten: the findings the instrument raises
in the harness family **are** the deliverable, and re-keying rounds 3–4 is seat work.

**What this session re-measured, and what it changed in the pointer:**

| Claim inherited from §1–§7 / `NEXT.md` | What the instrument said |
|---|---|
| 9 dangling keys; "round 4 names a source for **6 of 9**, 3 unresolved" | **3 confirmed + 5 inferred + 1 unnamed** — and one key (`b736c3`) has no candidate anywhere |
| round 3 is "verified: 60 citations, all URLs 200" | round 3 **collides on `[^1]`, `[^2]` and `[^3]`** with round 2 (`[^3]` = `learn.chatgpt.com/docs/hooks` vs `…/config-file/config-advanced`). Verification ≠ key-compatibility; the merge must re-key round 3 too |
| the Goose rows are "fixed from the pin" (243) | the *citations* moved; the **page** `learn.chatgpt.com/docs/guides/goose-2-extensions` is **still 404 with no redirect**, and §2 matrix rows 17–19 cite it again — fixing References only fixes half |
| `extensions-design.md` is 128 lines | `wc -l` = **127**; content lines = **128** (no trailing newline). The report was right and the naive check was wrong |

**What cost turns — all instrument bug-hunting, none research:**
1. **Extension alternation order** (`md|mdx` matched `md`) invented a phantom path for a file that exists at the pin. ~6 turns.
2. **`wc -l` semantics** vs content lines. ~4 turns. Ranges now resolve against content lines, "N lines" prose against `wc`, and a pure missing-newline gap scores soft.
3. **A URL regex that swallowed a trailing backtick** invented 3 dead URLs on a line that had none. ~3 turns.
4. **Bot-blocks scored as dead** — the first `--fetch` run called **14 live pages dead** (9×403, 4×429, 1×401). The most dangerous of the six: a gate that calls live pages dead gets the page deleted. ~2 turns.
5. **"Family" inferred from cross-citation** merged 22 unrelated reports and printed **81 fake collisions**. ~4 turns.
6. **Own-tree size claims scored hard** — 23 instead of 6. ~2 turns.
7. **It charged its own evidence note for a defect it was illustrating** — the `[^1]:` pair inside a ``` demo block
   became a real `DUP DEFINITION`. ~3 turns. Footnote syntax is now skipped inside fences (paths, sizes and URLs still
   count there, because real citations are written in fences); a checker that scores *examples* as *assertions* teaches
   authors to stop writing examples.
8. `--json --top 0` **corrupted its own machine output** — `--json` took `--top` as its filename and `0` leaked into the
   positional path list, and `Number(0) || 12` turned "print no groups" back into 12. ~2 turns, and it mattered only
   because I analyzed the JSON it wrote.

**Proposals to shorten the next effort (same shape as §5):**
- **Land the instrument before the finding.** Six turns went re-deriving facts the corpus already held; the checker paid
  for itself the first time it contradicted the pointer that summoned it (it corrected two `NEXT.md` numbers inside its
  first run). Keep 250's shape: one file, zero deps, `--self-test` inside the file.
- **Pin every false finding as a self-test case the moment it is fixed.** 3 → 12 cases; it caught a regression while I
  was still typing, for 137 ms.
- **Run the corpus, not just the target file.** The harness family was 10 findings; the same 1.3 s over 127 files (81 of
  them clean) found **292 hard**, including a single file defining `[^1]` three times (so two of its three targets are
  unreachable under
  any renderer tie-break). Cheap + wide beats expensive + narrow.
- **Never trust an offline claim about a URL.** Every URL verdict now carries a MANIFEST probe timestamp or is soft.
  "Fixed from the pin" is precisely how a dead link survives a fix.
- **A correction is not a bad claim.** The gate must pass "680, not the 1,457 from memory"; firing on corrections trains
  readers to ignore the gate — the exact failure mode 240–243 exist to prevent.
- **Roadmap and MANIFEST have no executable reader** (re-confirmed: `grep -rl docs/ROADMAP\|inputs/fetched/MANIFEST
  demo/*.test.mjs scripts/*.mjs` → nothing). Edits there fail silently, so a numbered item can be duplicated or a
  manifest row malformed and every test stays green. A `tools/review-cite-check.mjs --gate` wired into the `check` rule
  (213's family) is the cheap close.

**Deliberately not done:** no report prose edited (250's re-keying and the 94/108/71 corpus repair are queue work);
no `src/` change; no queue row created; no push.
